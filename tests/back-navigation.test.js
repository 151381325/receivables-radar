import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackHandler } from '../src/back-navigation.js';

function scenario(context, discard = true) {
  const state = { appVisible: true, view: 'today', dialogs: [], formDirty: false, busy: false, ...context };
  const handler = createBackHandler({
    getContext: () => state,
    confirmDiscard: () => discard,
    closeDialog: id => { state.dialogs = state.dialogs.filter(dialog => dialog.id !== id); },
    showToday: () => { state.view = 'today'; },
  });
  return { state, handler };
}

test('back closes the top dialog before changing page or allowing exit', () => {
  const { state, handler } = scenario({ view: 'all', dialogs: [{ id: 'detail' }, { id: 'message' }] });
  assert.equal(handler(), true);
  assert.deepEqual(state.dialogs, [{ id: 'detail' }]);
  assert.equal(state.view, 'all');
});

test('cancelling discard leaves unsaved dialog open and consumes back', () => {
  const { state, handler } = scenario({ dialogs: [{ id: 'follow', dirty: true }] }, false);
  assert.equal(handler(), true);
  assert.equal(state.dialogs[0].id, 'follow');
});

test('confirming discard closes unsaved dialog without saving anything', () => {
  const { state, handler } = scenario({ dialogs: [{ id: 'follow', dirty: true }] });
  assert.equal(handler(), true);
  assert.equal(state.dialogs.length, 0);
});

test('unsaved receivable form remains on screen if discard is cancelled', () => {
  const { state, handler } = scenario({ view: 'form', formDirty: true }, false);
  assert.equal(handler(), true);
  assert.equal(state.view, 'form');
});

test('confirmed form discard and ordinary secondary pages return to today', () => {
  for (const view of ['form', 'all', 'account']) {
    const { state, handler } = scenario({ view, formDirty: true });
    assert.equal(handler(), true);
    assert.equal(state.view, 'today');
  }
});

test('back cannot leave while a save is running, even from today', () => {
  const { handler } = scenario({ busy: true });
  assert.equal(handler(), true);
});

test('only idle today or an unauthenticated page allows native fallback', () => {
  assert.equal(scenario({}).handler(), false);
  assert.equal(scenario({ appVisible: false }).handler(), false);
});
