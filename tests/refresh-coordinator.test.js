import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshCoordinator } from '../src/refresh-coordinator.js';

test('同一账号刷新去重，新账号不等待或复用旧账号请求', async () => {
  const coordinator = createRefreshCoordinator();
  const oldAccount = {}, newAccount = {};
  let finishOld, oldLoads = 0, newLoads = 0;
  const pending = coordinator(oldAccount, () => { oldLoads++; return new Promise(resolve => { finishOld = resolve; }); });
  const duplicate = coordinator(oldAccount, () => { throw new Error('must deduplicate'); });
  const fresh = coordinator(newAccount, async () => { newLoads++; return 'new account data'; });
  assert.equal(await fresh, 'new account data');
  assert.equal(newLoads, 1);
  assert.equal(oldLoads, 1);
  finishOld('old data');
  assert.equal(await pending, 'old data');
  assert.equal(await duplicate, 'old data');
});
