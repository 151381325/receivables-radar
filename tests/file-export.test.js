import test from 'node:test';
import assert from 'node:assert/strict';
import { saveTextFile } from '../src/file-export.js';

test('native export waits for actual file write before reporting saved', async () => {
  let finish;
  const native = { isNativePlatform: () => true, Plugins: { RadarFiles: { saveText(options) {
    assert.deepEqual(options, { filename: 'backup.json', content: '{}', mimeType: 'application/json' });
    return new Promise(resolve => { finish = resolve; });
  } } } };
  let settled = false;
  const pending = saveTextFile('backup.json', '{}', 'application/json;charset=utf-8', { Capacitor: native }).then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish({ saved: true });
  assert.equal((await pending).status, 'saved');
});

test('native cancellation is not reported as saved', async () => {
  const Capacitor = { isNativePlatform: () => true, Plugins: { RadarFiles: { saveText: async () => { throw Object.assign(new Error('cancel'), { code: 'SAVE_CANCELLED' }); } } } };
  assert.equal((await saveTextFile('backup.json', '{}', 'application/json', { Capacitor })).status, 'cancelled');
});

test('old native app cannot silently fall back to unsupported blob download', async () => {
  await assert.rejects(saveTextFile('backup.json', '{}', 'application/json', { Capacitor: { isNativePlatform: () => true } }), /更新/);
});

test('native write failure propagates instead of displaying success', async () => {
  const Capacitor = { isNativePlatform: () => true, Plugins: { RadarFiles: { saveText: async () => { throw new Error('无法写入文件'); } } } };
  await assert.rejects(saveTextFile('backup.json', '{}', 'application/json', { Capacitor }), /无法写入/);
});

test('browser starts a download but never claims a confirmed file save', async () => {
  const events = [];
  const link = { click() { events.push('click'); }, remove() { events.push('remove'); } };
  let cleanup;
  const platform = {
    Blob,
    URL: { createObjectURL(blob) { assert.equal(blob.type, 'application/json'); return 'blob:test'; }, revokeObjectURL(url) { events.push(url); } },
    document: { createElement: () => link, body: { append(element) { assert.equal(element, link); events.push('append'); } } },
    setTimeout(fn) { cleanup = fn; },
  };
  assert.equal((await saveTextFile('backup.json', '{}', 'application/json', platform)).status, 'started');
  assert.equal(link.download, 'backup.json');
  assert.deepEqual(events, ['append', 'click', 'remove']);
  cleanup();
  assert.deepEqual(events, ['append', 'click', 'remove', 'blob:test']);
});

test('native bridge without write confirmation is rejected', async () => {
  const Capacitor = { isNativePlatform: () => true, Plugins: { RadarFiles: { saveText: async () => ({}) } } };
  await assert.rejects(saveTextFile('backup.json', '{}', 'application/json', { Capacitor }), /尚未保存/);
});
