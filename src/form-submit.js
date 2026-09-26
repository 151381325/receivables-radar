const disabledStates = new WeakMap();

export function setFormBusy(form, busy) {
  const button = form.querySelector('[type="submit"]');
  const controls = [...form.querySelectorAll('input, button, select, textarea')];
  form.dataset.busy = String(busy);
  if (busy) {
    disabledStates.set(form, controls.map((element) => element.disabled));
    controls.forEach((element) => { element.disabled = true; });
  } else {
    const previousStates = disabledStates.get(form) ?? [];
    controls.forEach((element, index) => { element.disabled = previousStates[index] ?? false; });
    disabledStates.delete(form);
  }
  if (button) {
    button.dataset.label ||= button.textContent;
    button.textContent = busy ? '请稍候…' : button.dataset.label;
  }
}

export async function runWithFormBusy(form, action) {
  if (form.dataset.busy === 'true') return undefined;
  setFormBusy(form, true);
  try {
    return await action();
  } finally {
    setFormBusy(form, false);
  }
}
