import test from 'node:test';
import assert from 'node:assert/strict';
import { getFreeEntitlements, requireFeature } from '../server/entitlements.js';

test('免费版具备完整核心权限，规划中的 VIP 不可执行', () => {
  const entitlements = getFreeEntitlements();
  assert.equal(entitlements.plan, 'free');
  assert.equal(entitlements.features.core_receivables, true);
  assert.equal(entitlements.features.data_backup, true);
  assert.equal(entitlements.features.advanced_reminders, false);
  assert.throws(() => requireFeature(entitlements, 'advanced_reminders'), error => error.code === 'FEATURE_UNAVAILABLE');
  assert.throws(() => requireFeature(entitlements, 'unknown'), error => error.code === 'FEATURE_UNAVAILABLE');
  assert.throws(() => requireFeature({ plan: 'vip', features: { advanced_reminders: true } }, 'advanced_reminders'), error => error.code === 'FEATURE_UNAVAILABLE');
  assert.doesNotThrow(() => requireFeature(entitlements, 'core_receivables'));
});
