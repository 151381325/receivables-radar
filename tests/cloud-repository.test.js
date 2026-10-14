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
