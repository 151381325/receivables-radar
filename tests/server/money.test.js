import test from 'node:test';
import assert from 'node:assert/strict';
import { fenToYuan, yuanToFen } from '../../server/receivables/money.js';

test('人民币元与分之间精确转换', () => {
  assert.equal(yuanToFen(12.34), 1234);
  assert.equal(yuanToFen('0.10'), 10);
  assert.equal(fenToYuan(1234), 12.34);
});

test('金额转换拒绝负数和超过两位小数', () => {
  assert.throws(() => yuanToFen(-1), /必须大于0/);
  assert.throws(() => yuanToFen('1.234'), /最多两位小数/);
  assert.throws(() => fenToYuan(12.5), /整数分/);
});
