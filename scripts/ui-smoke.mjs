// Local browser smoke test: production UI, isolated in-memory API fixtures.
// No production endpoint, account, database, or signing material is accessed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReceivable, updateReceivable, addFollowUp, addPayment, removePayment } from '../src/domain.js';
import { FEATURE_CATALOG, getFreeEntitlements } from '../server/entitlements.js';
import { serializeBackup, validateImportRecords } from '../src/backup.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const siteRoot = process.argv.includes('--dist') ? join(root, 'dist') : root;
const artifacts = join(root, 'tmp', 'ui-smoke');
await mkdir(artifacts, { recursive: true });
const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = days => new Date(Date.parse(`${localToday}T12:00:00Z`) + days * 86400000).toISOString().slice(0,10);
let records = [
  { ...createReceivable({ id: 'smoke-1', clientName: '星桥咨询', projectName: '年度顾问服务', totalAmount: 14000, invoiceSent: true, dueDate: shift(-8) }), version: 1 },
  { ...createReceivable({ id: 'smoke-2', clientName: '青禾文化', projectName: '品牌设计', totalAmount: 5800, invoiceSent: true, dueDate: shift(4), nextFollowUpDate: localToday }), version: 1 },
  { ...createReceivable({ id: 'smoke-3', clientName: '远山工作室', projectName: '网站开发', totalAmount: 10800, invoiceSent: true, dueDate: shift(14) }), version: 1 },
];
records[0] = { ...addPayment(records[0], { amount: 2000, paidAt: shift(-2), method: '银行转账' }), version: 1 };
let offline = false;
let authenticated = true;
let currentUserEmail = 'demo@example.test';
let adminUser = false;
let deleteAccountCalls = 0;
let deletionUnavailable = false;
let latePaymentResponse = null;
let paymentResponseHeld = false;
let lateUnauthorizedResponse = null;
let unauthorizedResponseHeld = false;
const mutationRequests = [];
const requestPaths = [];
let mutationGate = null;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    requestPaths.push(path);
    if (path === '/api/auth/me') return authenticated ? json(res,200,{ user:{ id:'smoke-user', email:currentUserEmail, isAdmin:adminUser, emailVerified:true } }) : json(res,401,{error:{code:'AUTH_REQUIRED',message:'请先登录'}});
    if (path === '/api/auth/login' && process.argv.includes('--account-deletion-acceptance')) {
      for await (const chunk of req) { /* Consume the synthetic login body before responding. */ }
      authenticated=true;currentUserEmail='new-session@example.test';
      requestPaths.push('synthetic-login-body-consumed');
      res.once('finish',()=>requestPaths.push('synthetic-login-response-finished'));
      return json(res,200,{user:{id:'new-session-user',email:currentUserEmail,isAdmin:false,emailVerified:true}});
    }
    if (path === '/api/account' && req.method === 'DELETE') {
      deleteAccountCalls++;
      let body=''; for await (const chunk of req) body+=chunk;
      const input=JSON.parse(body);
      if (deletionUnavailable) return json(res,503,{error:{code:'UNAVAILABLE',message:'模拟服务不可用'}});
      if (adminUser) return json(res,403,{error:{code:'ADMIN_DELETION_BLOCKED',message:'管理员不可自助注销'}});
      if (input.password!=='isolated deletion input' || input.confirmation!=='注销' || input.acknowledged!==true) return json(res,403,{error:{code:'PASSWORD_INCORRECT',message:'当前密码不正确，未注销账号'}});
      authenticated=false;records=[];res.writeHead(204);res.end();return;
    }
    if (path === '/api/auth/logout') return json(res,503,{error:{message:'模拟退出失败'}});
    if (path === '/api/auth/resend-verification') return json(res,202,{message:'如果该邮箱尚未验证，验证邮件将发送。'});
    if (path === '/api/account/entitlements') return json(res,200,{ ...getFreeEntitlements(), catalog:FEATURE_CATALOG });
    if (path.startsWith('/api/receivables')) {
      if (offline) return json(res,503,{error:{code:'NETWORK_ERROR',message:'模拟同步失败'}});
      if (req.method === 'GET') {
        if (lateUnauthorizedResponse && !unauthorizedResponseHeld) {
          unauthorizedResponseHeld=true;
          await lateUnauthorizedResponse;
          return json(res,401,{error:{code:'AUTH_REQUIRED',message:'旧会话失效'}});
        }
        return json(res,200,{records});
      }
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || '{}');
      mutationRequests.push({ method: req.method, path, version: input.version });
      if (mutationGate) await mutationGate;
      if (path === '/api/receivables/import' && req.method === 'POST') {
        const incoming = validateImportRecords(input.records);
        let importedCount = 0;
        for (const record of incoming) {
          if (records.some(existing => existing.id === record.id)) continue;
          records.push({ ...record, version: 1 });
          importedCount += 1;
        }
        return json(res,200,{ records, importedCount, skippedCount: incoming.length - importedCount });
      }
      if (path === '/api/receivables' && req.method === 'POST') {
        const record={...createReceivable(input),version:1}; records.push(record); return json(res,201,{record});
      }
      const parts=path.split('/'); const index=records.findIndex(r=>r.id===decodeURIComponent(parts[3]));
      if(index<0)return json(res,404,{error:{message:'记录不存在'}});
      const old=records[index];
      if(old.version!==input.version)return json(res,409,{error:{code:'STALE_VERSION',message:'版本已变化'}});
      let updated;
      if(parts[4]==='follow-ups')updated=addFollowUp(old,input);
      else if(parts[4]==='payments'&&req.method==='DELETE')updated=removePayment(old,decodeURIComponent(parts[5]));
      else if(parts[4]==='payments')updated=addPayment(old,input);
      else if(req.method==='PUT' && parts.length===4)updated=updateReceivable(old,input);
      else return json(res,404,{error:{message:'未实现的测试请求'}});
      records[index]={...updated,version:old.version+1};
      const responseRecord=records[index];
      if (parts[4]==='payments' && req.method==='DELETE' && latePaymentResponse) {
        paymentResponseHeld=true;
        await latePaymentResponse;
      }
      return json(res,200,{record:responseRecord});
    }
    if(path.startsWith('/api/'))return json(res,404,{error:{message:'未实现的测试请求'}});
    if(!['/','/index.html'].includes(path)&&!path.startsWith('/src/')&&!path.startsWith('/assets/')&&!path.startsWith('/privacy/')&&!path.startsWith('/terms/')){res.writeHead(404);res.end();return;}
    const file=resolve(siteRoot,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!file.startsWith(resolve(siteRoot)+'\\')&&!file.startsWith(resolve(siteRoot)+'/')){res.writeHead(403);res.end();return;}
    let data=await readFile(file);
    if (serveOnly && extname(file) === '.html') data = Buffer.from(data.toString().replace('<body>', '<body><div style="position:sticky;top:0;z-index:9999;background:#facc15;color:#111;padding:8px;text-align:center">测试版 · 仅示例数据 · 不连接正式账号</div>'));
    res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'})[extname(file)]||'application/octet-stream'});res.end(data);
  } catch(error){json(res,500,{error:{message:error.message}});}
});
const serveOnly = process.argv.includes('--serve');
await new Promise(resolve=>server.listen(serveOnly ? 18765 : 0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
if (serveOnly) {
  console.log(`Synthetic test data only: ${origin}`);
  await new Promise(() => {});
}
const profile=await mkdtemp(join(tmpdir(),'radar-ui-smoke-'));
const browser=spawn(process.env.UI_TEST_BROWSER||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket; let nextId=0; let acceptDialogs=true; const pending=new Map(); const errors=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text+':'+(result.exceptionDetails.exception?.description||''));return result.result.value;}
async function wait(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await pause(100);}throw new Error(`UI condition failed: ${expression}`);}
async function screenshot(name){await pause(400);const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(join(artifacts,name),Buffer.from(result.data,'base64'));}
try {
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await pause(100);}}
  assert.ok(port,'Browser debugging port unavailable');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);if(request){clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown'){errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);}else if(message.method==='Page.javascriptDialogOpening'){send('Page.handleJavaScriptDialog',{accept:acceptDialogs}).catch(()=>{});}});
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:origin});await wait("!document.querySelector('#app-shell')?.hidden && document.querySelector('#today-list .receivable-card')");
  assert.equal(await evaluate("document.querySelector('#metric-outstanding').textContent"),'¥28,600.00');
  assert.equal(await evaluate("document.querySelector('#today-list').children.length"),2);
  await screenshot('desktop.png');
  acceptance: {
  if (process.argv.includes('--account-deletion-acceptance')) {
    await evaluate("document.querySelector('[data-view=account]').click();document.querySelector('#delete-account-button').click()");
    assert.equal(await evaluate("document.querySelector('#delete-account-dialog').open"), true);
    await evaluate("document.querySelector('#delete-account-password').value='temporary';document.querySelector('#delete-account-dialog [data-close-dialog]').click()");
    await wait("!document.querySelector('#delete-account-dialog').open && document.querySelector('#delete-account-password').value===''");
    assert.equal(deleteAccountCalls, 0);
    assert.equal(await evaluate("document.querySelector('#delete-account-password').value"), '');
    await evaluate("document.querySelector('#delete-account-button').click();document.querySelector('#delete-account-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await wait("document.querySelector('#delete-account-error').textContent.length>0");
    assert.equal(deleteAccountCalls, 0);
    await evaluate("document.querySelector('#delete-account-password').value='wrong';document.querySelector('#delete-account-confirmation').value='注销';document.querySelector('#delete-account-acknowledged').checked=true;document.querySelector('#delete-account-form').requestSubmit()");
    await wait("document.querySelector('#delete-account-error').textContent.includes('密码不正确')");
    assert.equal(authenticated, true);
    assert.equal(records.length, 3);
    deletionUnavailable=true;
    await evaluate("document.querySelector('#delete-account-password').value='isolated deletion input';document.querySelector('#delete-account-form').requestSubmit()");
    await wait("document.querySelector('#delete-account-error').textContent.includes('服务不可用') && document.querySelector('#delete-account-form').dataset.busy!=='true'");
    assert.equal(authenticated, true);
    deletionUnavailable=false;
    // Admin entry is blocked, not merely hidden on the server.
    await evaluate("document.querySelector('#delete-account-dialog').close()");
    adminUser=true;
    await send('Page.navigate',{url:origin});
    await wait("!document.querySelector('#app-shell').hidden && !document.querySelector('#admin-link').hidden");
    assert.equal(await evaluate("document.querySelector('#delete-account-button').disabled"), true);
    adminUser=false;
    await send('Page.navigate',{url:origin});
    await wait("!document.querySelector('#app-shell').hidden && !document.querySelector('#delete-account-button').disabled");
    // A previous payment correction committed but its HTTP response arrives after deletion.
    let releasePayment;
    latePaymentResponse=new Promise(resolve=>{releasePayment=resolve;});
    await evaluate("document.querySelector('[data-view=all]').click();document.querySelector('[data-open-record=smoke-1]').click();document.querySelector('[data-remove-payment]').click()");
    for(let attempt=0;attempt<30 && !paymentResponseHeld;attempt++) await pause(50);
    assert.equal(paymentResponseHeld,true);
    await evaluate("document.querySelector('#record-dialog [data-close-dialog]').click()");
    let releaseUnauthorized;
    lateUnauthorizedResponse=new Promise(resolve=>{releaseUnauthorized=resolve;});
    await evaluate("document.querySelector('[data-refresh-records]').click()");
    for(let attempt=0;attempt<30 && !unauthorizedResponseHeld;attempt++) await pause(50);
    assert.equal(unauthorizedResponseHeld,true);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await evaluate("document.querySelector('[data-view=account]').click();document.querySelector('#delete-account-button').click();document.querySelector('#delete-account-password').value='isolated deletion input';document.querySelector('#delete-account-confirmation').value='注销';document.querySelector('#delete-account-acknowledged').checked=true");
    await screenshot('account-deletion-mobile.png');
    const beforeCalls=deleteAccountCalls;
    await evaluate("for(let i=0;i<10;i++)document.querySelector('#delete-account-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await wait("document.querySelector('#app-shell').hidden && !document.querySelector('#auth-shell').hidden");
    releasePayment();
    latePaymentResponse=null;
    await pause(250);
    assert.equal(await evaluate("document.querySelectorAll('dialog[open]').length"),0,'Late business response must not reopen a private dialog after deletion');
    assert.equal(deleteAccountCalls, beforeCalls+1);
    assert.equal(records.length, 0);
    assert.equal(await evaluate("document.querySelector('#delete-account-password').value"), '');
    assert.equal(await evaluate("document.querySelector('#all-list').children.length"), 0);
    assert.equal(await evaluate("document.querySelector('#account-email').textContent"), '');
    assert.equal(await evaluate("document.querySelector('#auth-error').textContent.includes('已注销')"), true);
    await evaluate("document.querySelector('#login-form [name=email]').value='new-session@example.test';document.querySelector('#login-form [name=password]').value='isolated new login';document.querySelector('#login-form').requestSubmit()");
    try {
      await wait("!document.querySelector('#app-shell').hidden && document.querySelector('#account-email').textContent==='new-session@example.test'");
    } catch (error) {
      console.log('NEW_SESSION_DIAGNOSTIC', await evaluate("({authError:document.querySelector('#auth-error').textContent,appHidden:document.querySelector('#app-shell').hidden,loginBusy:document.querySelector('#login-form').dataset.busy,accountAssigned:document.querySelector('#account-email').textContent})"), errors, requestPaths.slice(-12));
      throw error;
    }
    releaseUnauthorized();
    lateUnauthorizedResponse=null;
    await pause(250);
    assert.equal(await evaluate("!document.querySelector('#app-shell').hidden && document.querySelector('#account-email').textContent==='new-session@example.test'"),true,'Old unauthorized response cannot log out the new account');
    assert.deepEqual(errors, []);
    console.log('ACCOUNT_DELETION_UI_PASS: cancel, validation, wrong password, service failure, admin protection, repeat submit, clear session/data');
    break acceptance;
  }
  if (process.argv.includes('--backup-acceptance')) {
    const example = createReceivable({ clientName: '备份UI验收', projectName: '合成示例', totalAmount: 98.76, invoiceSent: true, dueDate: shift(10) });
    const backupText = serializeBackup([example]);
    const chooseFile = text => evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(text)}],'acceptance.json',{type:'application/json'}));const input=document.querySelector('#backup-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await evaluate("document.querySelector('[data-view=account]').click();window.__backupSaveCalls=[];window.Capacitor={isNativePlatform:()=>true,Plugins:{RadarFiles:{saveText:async input=>{window.__backupSaveCalls.push(input);const error=new Error('cancelled');error.code='SAVE_CANCELLED';throw error;}}}};");
    const before = JSON.stringify(records);
    const requestsBefore = mutationRequests.length;
    await chooseFile(backupText);
    await wait("document.querySelector('#toast').textContent.includes('未导入数据') && document.querySelector('#backup-file').value===''");
    assert.equal(JSON.stringify(records), before);
    assert.equal(mutationRequests.length, requestsBefore, 'Cancelling the pre-import backup must not call import API');
    const captured = await evaluate('window.__backupSaveCalls');
    assert.equal(captured.length, 1);
    assert.deepEqual(JSON.parse(captured[0].content).records, records, 'Pre-import backup must include all existing records');
    console.log('BACKUP_CANCEL_PASS: system-save cancellation stops import and retains data');
    await evaluate('window.Capacitor.Plugins.RadarFiles.saveText=async input=>{window.__backupSaveCalls.push(input);return {saved:true};}');
    await chooseFile(backupText);
    await wait("document.querySelector('#toast').textContent.includes('导入 1 笔') && document.querySelector('#backup-file').value===''");
    assert.equal(records.filter(record => record.id === example.id).length, 1);
    const count = records.length;
    await chooseFile(backupText);
    await wait("document.querySelector('#toast').textContent.includes('跳过 1 笔') && document.querySelector('#backup-file').value===''");
    assert.equal(records.length, count);
    const requestsAfterRestore = mutationRequests.length;
    await chooseFile('{invalid');
    await wait("document.querySelector('#toast').textContent.includes('无法读取') && document.querySelector('#backup-file').value===''");
    assert.equal(mutationRequests.length, requestsAfterRestore);
    assert.equal(records.length, count);
    await chooseFile(serializeBackup([]));
    await wait("document.querySelector('#toast').textContent.includes('没有可导入') && document.querySelector('#backup-file').value===''");
    assert.equal(mutationRequests.length, requestsAfterRestore);
    assert.deepEqual(errors, []);
    console.log('BACKUP_UI_ACCEPTANCE_PASS: restore once, duplicate skipped, malformed and empty files blocked, file input reset');
    break acceptance;
  }
  if (process.argv.includes('--sync-conflict-acceptance')) {
    // A fixture-side change represents another device; no production API is used.
    for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
    const index = records.findIndex(record => record.id === 'smoke-2');
    const openedVersion = records[index].version;
    await evaluate("document.querySelector('[data-view=all]').click();document.querySelector('[data-open-record=smoke-2]').click();document.querySelector('#detail-edit').click();document.querySelector('#notes').value='B端未保存草稿'");
    records[index] = { ...records[index], notes: 'A端最新修改，不能被旧稿覆盖', version: openedVersion + 1 };
    // Reproduce the same path used by focus/online/periodic refresh while editing.
    await evaluate("document.querySelector('[data-refresh-records]').click()");
    await wait("document.querySelector('#sync-status').textContent.includes('已同步')");
    assert.equal(await evaluate("document.querySelector('#notes').value"), 'B端未保存草稿');
    await evaluate("document.querySelector('#receivable-form').requestSubmit()");
    await wait("document.querySelector('#receivable-form').dataset.busy!=='true'");
    await screenshot(`sync-stale-editor-after-save-${width}.png`);
    assert.equal(mutationRequests.at(-1)?.version, openedVersion);
    assert.equal(records[index].notes, 'A端最新修改，不能被旧稿覆盖', 'Refreshing a stale editor must not silently overwrite the other device');
    assert.equal(records[index].version, openedVersion + 1);
    assert.equal(await evaluate("!document.querySelector('#view-form').hidden"), true);
    assert.equal(await evaluate("document.querySelector('#notes').value"), 'B端未保存草稿');
    assert.equal(await evaluate("document.querySelector('#form-error').textContent.includes('其他设备')"), true);
    // Clicking save again must not silently upgrade the stale editor version.
    await evaluate("document.querySelector('#receivable-form').requestSubmit()");
    await wait("document.querySelector('#receivable-form').dataset.busy!=='true'");
    assert.equal(records[index].version, openedVersion + 1);
    assert.equal(records[index].notes, 'A端最新修改，不能被旧稿覆盖');
    // Explicitly reopening loads the new baseline and permits an intentional edit.
    await evaluate("window.__radarHandleBack();document.querySelector('[data-view=all]').click();document.querySelector('[data-open-record=smoke-2]').click();document.querySelector('#detail-edit').click()");
    assert.equal(await evaluate("document.querySelector('#notes').value"), 'A端最新修改，不能被旧稿覆盖');
    await evaluate("document.querySelector('#notes').value='核对后重新编辑';document.querySelector('#receivable-form').requestSubmit()");
    await wait("!document.querySelector('#view-today').hidden");
    assert.equal(records[index].notes, '核对后重新编辑');
    assert.equal(records[index].version, openedVersion + 2);
    console.log(`SYNC_CONFLICT_ACCEPTANCE_PASS width=${width}: stale save and retry blocked, remote changes and draft retained, explicit reopen saves`);
    }
    await evaluate("document.querySelector('[data-view=all]').click();document.querySelector('[data-open-record=smoke-3]').click();document.querySelector('#detail-edit').click();document.querySelector('#notes').value='另一端删除前的草稿'");
    records = records.filter(record => record.id !== 'smoke-3');
    const countAfterDelete = records.length;
    await evaluate("document.querySelector('[data-refresh-records]').click()");
    await wait("document.querySelector('#sync-status').textContent.includes('已同步')");
    await evaluate("document.querySelector('#receivable-form').requestSubmit()");
    await wait("document.querySelector('#receivable-form').dataset.busy!=='true'");
    assert.equal(records.length, countAfterDelete, 'A deleted record must not be recreated by its stale editor');
    assert.equal(mutationRequests.at(-1).method, 'PUT');
    assert.equal(await evaluate("document.querySelector('#form-error').textContent.includes('不存在') && document.querySelector('#notes').value==='另一端删除前的草稿'"), true);
    assert.deepEqual(errors, []);
    console.log('SYNC_DELETED_RECORD_PASS: stale edit does not recreate remotely deleted record');
    break acceptance;
  }
  if (process.argv.includes('--duplicate-save-acceptance')) {
    async function submitRepeatedly(formId, width, kind, assertSaved) {
      const beforeRequests = mutationRequests.length;
      const beforeRecords = JSON.stringify(records);
      let release;
      mutationGate = new Promise(resolve => { release = resolve; });
      try {
        await evaluate(`(()=>{const form=document.getElementById(${JSON.stringify(formId)});const button=form.querySelector('button[type=submit]');for(let i=0;i<10;i++)button.click();for(let i=0;i<10;i++)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));})()`);
        await wait(`document.getElementById(${JSON.stringify(formId)}).dataset.busy==='true'`);
        for(let attempt=0;attempt<30 && mutationRequests.length===beforeRequests;attempt++) await pause(50);
        assert.equal(mutationRequests.length, beforeRequests + 1, `${kind}: twenty repeated attempts send only one request`);
        assert.equal(JSON.stringify(records), beforeRecords, `${kind}: gated response leaves fixture data unchanged`);
        assert.equal(await evaluate(`document.getElementById(${JSON.stringify(formId)}).querySelector('button[type=submit]').disabled`), true);
        assert.equal(await evaluate(`document.getElementById(${JSON.stringify(formId)}).querySelector('button[type=submit]').textContent`), '请稍候…');
        await screenshot(`duplicate-save-${kind}-${width}.png`);
      } finally {
        release();
        mutationGate = null;
      }
      await wait(`document.getElementById(${JSON.stringify(formId)}).dataset.busy!=='true'`);
      await pause(150);
      assert.equal(mutationRequests.length, beforeRequests + 1);
      assert.equal(await evaluate(`document.getElementById(${JSON.stringify(formId)}).querySelector('button[type=submit]').disabled`), false);
      assertSaved();
      console.log(`DUPLICATE_SAVE_PASS width=${width} kind=${kind}: 10 clicks + 10 submit events, one request, one saved entry, controls restored`);
    }
    for (const width of [1440, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      const count = records.length;
      const client = `重复保存验收${width}`;
      await evaluate(`document.querySelector('[data-new-record]').click();document.querySelector('#client-name').value=${JSON.stringify(client)};document.querySelector('#project-name').value='隔离测试';document.querySelector('#total-amount').value='123.45';document.querySelector('#invoice-sent').checked=true`);
      await submitRepeatedly('receivable-form', width, 'create', () => {
        assert.equal(records.length, count + 1);
        assert.equal(records.filter(record => record.clientName === client).length, 1);
      });
      const record = records.find(record => record.clientName === client);
      await evaluate(`document.querySelector('[data-view=all]').click();document.querySelector('[data-open-record="${record.id}"]').click();document.querySelector('#detail-payment').click();document.querySelector('#payment-amount').value='1'`);
      await submitRepeatedly('payment-form', width, 'payment', () => {
        const updated = records.find(item => item.id === record.id);
        assert.equal(updated.paymentRecords.length, 1);
        assert.equal(updated.paymentRecords[0].amount, 1);
        assert.equal(updated.version, 2);
      });
      await evaluate(`document.querySelector('[data-open-record="${record.id}"]').click();document.querySelector('#detail-follow-up').click();document.querySelector('#follow-result').value='重复保存验收，仅示例'`);
      await submitRepeatedly('follow-form', width, 'follow-up', () => {
        const updated = records.find(item => item.id === record.id);
        assert.equal(updated.followUpRecords.length, 1);
        assert.equal(updated.version, 3);
      });
    }
    assert.deepEqual(errors, []);
    break acceptance;
  }
  if (process.argv.includes('--network-acceptance')) {
    await send('Network.enable');
    const network = offline => send('Network.emulateNetworkConditions', {
      offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    for (const width of [1440, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 });
      const before = JSON.stringify(records);
      const count = records.length;
      const amount = await evaluate("document.querySelector('#metric-outstanding').textContent");
      await network(true);
      await evaluate("document.querySelector('[data-refresh-records]').click()");
      await wait("!document.querySelector('#sync-alert').hidden");
      assert.equal(await evaluate("document.querySelector('#sync-status').textContent.includes('失败')"), true);
      assert.equal(await evaluate("document.querySelector('#metric-outstanding').textContent"), amount);
      await evaluate(`document.querySelector('[data-new-record]').click();document.querySelector('#client-name').value='断网验收${width}';document.querySelector('#project-name').value='仅隔离示例';document.querySelector('#total-amount').value='123.45';document.querySelector('#notes').value='恢复网络前不得创建';document.querySelector('#receivable-form').requestSubmit()`);
      await wait("document.querySelector('#form-error').textContent.includes('网络连接失败') && document.querySelector('#receivable-form').dataset.busy !== 'true'");
      assert.equal(JSON.stringify(records), before, 'Offline request must not mutate fixture server data');
      assert.equal(await evaluate("!document.querySelector('#view-form').hidden && document.querySelector('#client-name').value"), `断网验收${width}`);
      assert.equal(await evaluate("document.querySelector('#total-amount').value"), '123.45');
      assert.equal(await evaluate("document.querySelector('#notes').value"), '恢复网络前不得创建');
      assert.equal(await evaluate("document.querySelector('#receivable-form button[type=submit]').disabled"), false);
      await screenshot(`network-offline-${width}.png`);
      await network(false);
      await evaluate("document.querySelector('#receivable-form').requestSubmit()");
      await wait("!document.querySelector('#view-today').hidden");
      assert.equal(records.length, count + 1, 'Retry should create exactly one fixture record');
      assert.equal(records.filter(record => record.clientName === `断网验收${width}`).length, 1);
      await evaluate("document.querySelector('[data-retry-sync]').click()");
      await wait("document.querySelector('#sync-alert').hidden && document.querySelector('#sync-status').textContent.includes('已同步')");
      await screenshot(`network-recovered-${width}.png`);
      console.log(`NETWORK_ACCEPTANCE_PASS width=${width}: refresh error, old data retained, save failure, draft retained, controls unlocked, retry created once, sync recovered`);
    }
    assert.deepEqual(errors, []);
    break acceptance;
  }
  assert.equal(await evaluate('window.__radarHandleBack()'),false,'Idle today allows native exit');
  await evaluate("document.querySelector('[data-view=account]').click()");
  assert.equal(await evaluate('window.__radarHandleBack()'),true);
  assert.equal(await evaluate("!document.querySelector('[data-view-panel=today]').hidden"),true);
  await evaluate("document.querySelector('[data-open-record=smoke-1]').click();document.querySelector('#detail-reminder').click()");
  assert.equal(await evaluate('window.__radarHandleBack()'),true);
  assert.equal(await evaluate("document.querySelector('#reminder-dialog').open"),false);
  await evaluate("document.querySelector('[data-new-record]').click();document.querySelector('#client-name').value='未保存测试'");
  acceptDialogs=false;
  assert.equal(await evaluate('window.__radarHandleBack()'),true);
  assert.equal(await evaluate("!document.querySelector('[data-view-panel=form]').hidden && document.querySelector('#client-name').value==='未保存测试'"),true);
  acceptDialogs=true;
  assert.equal(await evaluate('window.__radarHandleBack()'),true);
  assert.equal(await evaluate("!document.querySelector('[data-view-panel=today]').hidden"),true);
  await evaluate("document.querySelector('[data-open-record=smoke-1]').click();document.querySelector('#detail-payment').click();document.querySelector('#payment-amount').value='1'");
  acceptDialogs=false;
  assert.equal(await evaluate('window.__radarHandleBack()'),true);
  assert.equal(await evaluate("document.querySelector('#payment-dialog').open && document.querySelector('#payment-amount').value==='1'"),true);
  acceptDialogs=true;
  assert.equal(await evaluate('window.__radarHandleBack()'),true);
  assert.equal(await evaluate("document.querySelector('#payment-dialog').open"),false);
  await evaluate("document.querySelector('[data-new-record]').click();document.querySelector('#receivable-form').dataset.busy='true'");
  assert.equal(await evaluate('window.__radarHandleBack()'),true);
  assert.equal(await evaluate("!document.querySelector('[data-view-panel=form]').hidden"),true);
  await evaluate("document.querySelector('#receivable-form').dataset.busy='false';window.__radarHandleBack()");
  const point=await evaluate("(()=>{const r=document.querySelector('.hero-card').getBoundingClientRect();return{x:r.x+r.width*.7,y:r.y+r.height*.6}})()");
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(200);
  assert.ok(await evaluate("document.querySelector('.hero-card').style.getPropertyValue('--mx')"));
  await evaluate("document.querySelector('[data-view=all]').click();document.querySelector('#record-search').value='青禾';document.querySelector('#record-search').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('#all-list .receivable-card').length"),1);
  assert.ok((await evaluate("document.querySelector('#ledger-total').textContent")).includes('5,800.00'));
  await evaluate("document.querySelector('#record-search').value='不存在';document.querySelector('#record-search').dispatchEvent(new Event('input'))");
  assert.ok(await evaluate("document.querySelector('[data-clear-filters]') !== null"));
  await evaluate("document.querySelector('[data-clear-filters]').click();document.querySelector('[data-open-record=smoke-1]').click();document.querySelector('[data-remove-payment]').click()");
  await wait("document.querySelector('#record-dialog').open && !document.querySelector('[data-remove-payment]')");
  assert.ok((await evaluate("document.querySelector('#detail-content').textContent")).includes('14,000.00'));
  await evaluate("document.querySelector('#detail-follow-up').click();document.querySelector('#follow-result').value='已联系，三天后再确认';document.querySelector('#follow-next-date').value="+JSON.stringify(shift(3))+";document.querySelector('#follow-form').requestSubmit()");
  await wait("!document.querySelector('#follow-dialog').open");
  assert.equal(await evaluate("document.querySelectorAll('#today-list .receivable-card').length"),1);
  await evaluate("document.querySelector('[data-new-record]').click();document.querySelector('#client-name').value='新客户';document.querySelector('#project-name').value='新项目';document.querySelector('#total-amount').value='500';document.querySelector('#invoice-sent').checked=true;document.querySelector('#receivable-form').requestSubmit()");
  await wait("document.querySelector('#view-today').hidden===false");
  assert.ok((await evaluate("document.querySelector('#metric-outstanding').textContent")).includes('31,100.00'));
  await evaluate("document.querySelector('[data-view=account]').click()");
  await wait("document.querySelectorAll('#vip-catalog > div').length===4");
  assert.ok((await evaluate("document.querySelector('#view-account').textContent")).includes('渝ICP备2026023184号-2A'));
  await screenshot('account.png');
  await evaluate("document.querySelector('#logout-button').click()");await wait("document.querySelector('#logout-error').textContent.includes('退出未完成')");
  assert.equal(await evaluate("document.querySelector('#logout-button').disabled"),false);
  offline=true;await evaluate("document.querySelector('[data-refresh-records]').click()");await wait("!document.querySelector('#sync-alert').hidden");
  offline=false;await evaluate("document.querySelector('#sync-alert [data-retry-sync]').click()");await wait("document.querySelector('#sync-alert').hidden");
  await evaluate("document.querySelector('[data-view=today]').click()");
  for(const width of [390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});await pause(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true,`Horizontal overflow at ${width}`);
    if(width===390)await screenshot('mobile.png');
  }
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.radar-decoration'),'::before').animationName"),'none');
  authenticated=false;await send('Page.navigate',{url:origin});await wait("document.readyState==='complete' && document.activeElement?.name==='email' && !document.querySelector('#auth-shell').hidden");
  await evaluate("document.querySelector('[data-auth-view=resend]').click();document.querySelector('#resend-form input').value='demo@example.test';document.querySelector('#resend-form').requestSubmit()");
  await wait("!document.querySelector('[data-auth-panel=status]').hidden");
  assert.ok((await evaluate("document.querySelector('#auth-status-message').textContent")).includes('验证邮件'));
  await evaluate("document.querySelector('[data-auth-view=login]').click()");
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
  await screenshot('login-mobile.png');
  assert.deepEqual(errors,[]);
  console.log('UI_SMOKE_PASS: back navigation + unsaved confirmation + busy guard, desktop/mobile, search, empty state, correction, follow-up deferral, creation, VIP catalog, offline/retry, hover, reduced motion, logout failure, verification resend');
  console.log(`Screenshots: ${artifacts}`);
  }
} finally {
  socket?.close(); browser.kill();
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Test closed'));}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
