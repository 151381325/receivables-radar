// Local browser smoke test: production UI, isolated in-memory API fixtures.
// No production endpoint, account, database, or signing material is accessed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReceivable, addFollowUp, addPayment, removePayment } from '../src/domain.js';
import { FEATURE_CATALOG, getFreeEntitlements } from '../server/entitlements.js';

const root = fileURLToPath(new URL('../', import.meta.url));
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
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/auth/me') return authenticated ? json(res,200,{ user:{ id:'smoke-user', email:'demo@example.test', isAdmin:false, emailVerified:true } }) : json(res,401,{error:{code:'AUTH_REQUIRED',message:'请先登录'}});
    if (path === '/api/auth/logout') return json(res,503,{error:{message:'模拟退出失败'}});
    if (path === '/api/auth/resend-verification') return json(res,202,{message:'如果该邮箱尚未验证，验证邮件将发送。'});
    if (path === '/api/account/entitlements') return json(res,200,{ ...getFreeEntitlements(), catalog:FEATURE_CATALOG });
    if (path.startsWith('/api/receivables')) {
      if (offline) return json(res,503,{error:{code:'NETWORK_ERROR',message:'模拟同步失败'}});
      if (req.method === 'GET') return json(res,200,{records});
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || '{}');
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
      else return json(res,404,{error:{message:'未实现的测试请求'}});
      records[index]={...updated,version:old.version+1};return json(res,200,{record:records[index]});
    }
    if(path.startsWith('/api/'))return json(res,404,{error:{message:'未实现的测试请求'}});
    if(!['/','/index.html'].includes(path)&&!path.startsWith('/src/')&&!path.startsWith('/privacy/')&&!path.startsWith('/terms/')){res.writeHead(404);res.end();return;}
    const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
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
let socket; let nextId=0; const pending=new Map(); const errors=[];
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
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);if(request){clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown'){errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);}else if(message.method==='Page.javascriptDialogOpening'){send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});}});
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:origin});await wait("!document.querySelector('#app-shell')?.hidden && document.querySelector('#today-list .receivable-card')");
  assert.equal(await evaluate("document.querySelector('#metric-outstanding').textContent"),'¥28,600.00');
  assert.equal(await evaluate("document.querySelector('#today-list').children.length"),2);
  await screenshot('desktop.png');
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
  console.log('UI_SMOKE_PASS: desktop/mobile, search, empty state, correction, follow-up deferral, creation, VIP catalog, offline/retry, hover, reduced motion, logout failure, verification resend');
  console.log(`Screenshots: ${artifacts}`);
} finally {
  socket?.close(); browser.kill();
  for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('Test closed'));}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
