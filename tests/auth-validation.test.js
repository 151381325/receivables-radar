import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePasswordConfirmation } from '../src/auth-validation.js';

test('两次密码一致时允许提交', () => {
  assert.equal(validatePasswordConfirmation('secure password', 'secure password'), '');
});

test('两次密码不一致时返回明确提示', () => {
  assert.equal(validatePasswordConfirmation('secure password', 'different password'), '两次输入的密码不一致');
});
