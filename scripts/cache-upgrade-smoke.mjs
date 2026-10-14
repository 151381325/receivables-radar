// Isolated Caddy + Chrome warm-cache upgrade test. No production API or user data.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './site-build.mjs';

const root = await mkdtemp(join(tmpdir(), 'radar-cache-upgrade-'));
const name = `radar-cache-check-${Date.now()}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false, browser, socket, id = 0;
const pending = new Map(), cached = new Set();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function expectPage(origin, version) {
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: origin });
  for (let attempt = 0; attempt < 70; attempt++) {
    if (await evaluate(`document.title === 'v${version}'`)) return;
    await pause(100);
  }
  throw new Error(`Did not load expected version ${version}`);
}
try {
  for (const path of ['src', 'admin', 'terms', 'privacy']) await mkdir(join(root, path), { recursive: true });
  const html = '<!doctype html><link rel="stylesheet" href="./src/style.css"><title>loading</title><body><script type="module" src="./src/main.js"></script>';
  await writeFile(join(root, 'index.html'), html);
  for (const page of ['admin', 'terms', 'privacy']) await writeFile(join(root, page, 'index.html'), '<!doctype html><title>legal</title>');
  await writeFile(join(root, 'src/main.js'), "import { value } from './dependency.js'; document.title = 'v' + value;");
  await writeFile(join(root, 'src/dependency.js'), 'export const value = 1;');
  await writeFile(join(root, 'src/style.css'), 'body { color: rgb(17, 34, 51); }');
  const first = await buildSite({ rootDirectory: root, outputDirectory: join(root, 'dist') });
  const config = (await readFile(new URL('../deploy/Caddyfile', import.meta.url), 'utf8')).replaceAll('root * /srv', 'root * /srv/dist');
  const configPath = join(root, 'Caddyfile');
  await writeFile(configPath, config);
  docker('run', '--rm', '-d', '--name', name, '-p', '127.0.0.1::80', '-e', 'SITE_ADDRESS=:80',
    '--mount', `type=bind,source=${root},target=/srv,readonly`,
    '--entrypoint', 'caddy', process.env.CACHE_TEST_CADDY_IMAGE || 'receivables-radar-web:latest', 'run', '--config', '/srv/Caddyfile');
  started = true;
  const port = docker('port', name, '80/tcp').split(':').at(-1);
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* startup */ }
    await pause(100);
  }
  for (const path of ['/', '/today', '/admin/', '/terms/', '/privacy/', '/src/main.js']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-cache', path);
  }
  const resource = await fetch(origin + first.resourcePrefix + 'main.js');
  assert.equal(resource.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const missing = await fetch(origin + first.resourcePrefix + 'missing.js');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('cache-control'), 'no-store');

  const profile = join(root, 'chrome-profile');
  browser = spawn(process.env.UI_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let browserPort;
  for (let attempt = 0; attempt < 70; attempt++) {
    try { browserPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await pause(100); }
  }
  assert.ok(browserPort, 'Chrome unavailable');
  const targets = await (await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer); pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    }
    if (message.method === 'Network.responseReceived' && message.params.response.fromDiskCache) cached.add(message.params.response.url);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await expectPage(origin, 1);
  assert.equal(await evaluate('getComputedStyle(document.body).color'), 'rgb(17, 34, 51)');
  await expectPage(origin, 1);
  assert.ok([...cached].some(url => url.includes(first.resourcePrefix)), 'Must first demonstrate real cache reuse');

  await writeFile(join(root, 'src/dependency.js'), 'export const value = 2;');
  await writeFile(join(root, 'src/style.css'), 'body { color: rgb(51, 34, 17); }');
  const second = await buildSite({ rootDirectory: root, outputDirectory: join(root, 'dist') });
  assert.notEqual(second.version, first.version);
  // Keep browser profile and caches intact while the deployment changes.
  await expectPage(origin, 2);
  assert.equal(await evaluate('getComputedStyle(document.body).color'), 'rgb(51, 34, 17)');
  console.log('CACHE_UPGRADE_PASS: Caddy headers, cached v1 -> v2 JS/dependency/CSS without clearing cache');
} finally {
  socket?.close(); browser?.kill();
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Test closed')); }
  if (started) docker('stop', name);
}
