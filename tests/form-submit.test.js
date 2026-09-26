import test from 'node:test';
import assert from 'node:assert/strict';

import { runWithFormBusy } from '../src/form-submit.js';

function createForm() {
  const input = { disabled: false };
  const button = { disabled: false, textContent: '保存', dataset: {} };
  const form = {
    dataset: {},
    querySelector: () => button,
    querySelectorAll: () => [input, button],
  };
  return { form, input, button };
}

test('表单保存期间阻止重复提交并在结束后恢复控件', async () => {
  const { form, input, button } = createForm();
  let release;
  let calls = 0;
  const action = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = runWithFormBusy(form, action);
  const second = runWithFormBusy(form, action);

  assert.equal(calls, 1);
  assert.equal(input.disabled, true);
  assert.equal(button.textContent, '请稍候…');
  release();
  await Promise.all([first, second]);
  assert.equal(input.disabled, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '保存');
});

test('提交结束后保留原本禁用的控件状态', async () => {
  const { form, input } = createForm();
  input.disabled = true;

  await runWithFormBusy(form, async () => {});

  assert.equal(input.disabled, true);
});
