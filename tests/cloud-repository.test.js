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
