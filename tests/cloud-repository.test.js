import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudRepository } from '../src/cloud-repository.js';

test('云端仓库仅在 API 成功后更新缓存', async () => {
  const api = { listReceivables: async () => [], createReceivable: async () => { throw new Error('offline'); } };
  const repository = createCloudRepository(api);
  await repository.load();
  await assert.rejects(() => repository.create({ id: 'rec-1' }), /offline/);
  assert.deepEqual(repository.list(), []);
});

test('迟到的加载响应不能覆盖刚保存的新记录', async () => {
  let resolveLoad;
  const repository = createCloudRepository({ listReceivables: () => new Promise(resolve => { resolveLoad = resolve; }), createReceivable: async () => ({ id: 'new', version: 1 }) });
  const loading = repository.load();
  await repository.create({ id: 'new' });
  resolveLoad([]);
  await loading;
  assert.equal(repository.list()[0].id, 'new');
});

test('会话清理后迟到的保存响应不能恢复旧账号缓存或继续成功回调', async () => {
  let finish;
  const repository = createCloudRepository({ createReceivable: () => new Promise(resolve => { finish = resolve; }) });
  const saving = repository.create({ clientName: '旧会话示例' });
  repository.clear();
  finish({ id: 'old-session-record', clientName: '旧会话示例', version: 1 });
  await assert.rejects(saving, error => error.code === 'SESSION_CHANGED');
  assert.deepEqual(repository.list(), []);
});

for (const [method, apiMethod, args, response] of [
  ['update', 'updateReceivable', ['r', {}], { id: 'r' }],
  ['addPayment', 'addPayment', ['r', {}], { id: 'r' }],
  ['removePayment', 'removePayment', ['r', 'p', 1], { id: 'r' }],
  ['addFollowUp', 'addFollowUp', ['r', {}], { id: 'r' }],
  ['remove', 'deleteReceivable', ['r', 1], undefined],
  ['importRecords', 'importReceivables', [[]], { records: [{ id: 'r' }] }],
  ['load', 'listReceivables', [], [{ id: 'r' }]],
]) {
  test(`会话清理后拒绝迟到的 ${method} 响应`, async () => {
    let finish;
    const repository = createCloudRepository({ [apiMethod]: () => new Promise(resolve => { finish = resolve; }) });
    const pending = repository[method](...args);
    repository.clear();
    finish(response);
    await assert.rejects(pending, error => error.code === 'SESSION_CHANGED');
    assert.deepEqual(repository.list(), []);
  });
}
