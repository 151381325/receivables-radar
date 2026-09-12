import test from 'node:test';
import assert from 'node:assert/strict';

import { createRepository } from '../src/storage.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('空仓库返回空数组', () => {
  const repository = createRepository(memoryStorage(), 'test-key');
  assert.deepEqual(repository.list(), []);
});

test('按 ID 保存时更新原记录而不产生重复项', () => {
  const repository = createRepository(memoryStorage(), 'test-key');
  repository.save({ id: 'r1', clientName: '旧名称' });
  repository.save({ id: 'r1', clientName: '新名称' });

  assert.deepEqual(repository.list(), [{ id: 'r1', clientName: '新名称' }]);
});

test('仓库可以查询和删除指定记录', () => {
  const repository = createRepository(memoryStorage(), 'test-key');
  repository.replaceAll([{ id: 'r1' }, { id: 'r2' }]);

  assert.deepEqual(repository.get('r2'), { id: 'r2' });
  assert.deepEqual(repository.remove('r1'), [{ id: 'r2' }]);
  assert.equal(repository.get('missing'), null);
});

test('损坏的本地数据安全返回空数组', () => {
  const repository = createRepository(memoryStorage({ 'test-key': '{bad' }), 'test-key');
  assert.deepEqual(repository.list(), []);
});
