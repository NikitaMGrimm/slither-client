import assert from 'node:assert/strict';

// Executes the real, freshly built Rust projection; no DOM, reference or socket.
export function startPageSmoke(wasm) {
  const ready = wasm.start_page_view('ready', false, false);
  assert.deepEqual(ready, { visible: true, busy: false, disabled: false, status: 'Ready.', button: 'Play' });
  assert.equal(Object.isFrozen(ready), true);
  for (const status of ['preparing', 'connecting']) {
    const view = wasm.start_page_view(status, true, false);
    assert.equal(view.busy, true); assert.equal(view.disabled, true); assert.equal(view.button, 'Connecting…');
    const hidden = wasm.start_page_view(status, true, true);
    assert.equal(hidden.visible, false); assert.equal(hidden.busy, false);
  }
  assert.equal(wasm.start_page_view('connected', true, true).visible, false);
  assert.equal(wasm.start_page_view('not-connected', true, false).disabled, true);
  assert.equal(wasm.start_page_view('not-connected', false, false).disabled, false);
  for (const status of ['unavailable', 'failed']) assert.equal(wasm.start_page_view(status, false, false).disabled, true);
  assert.throws(() => wasm.start_page_view('unrecognized', false, false));
  return 'ready/busy/playing/return/lock/invalid-status projections';
}
