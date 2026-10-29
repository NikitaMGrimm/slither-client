import assert from 'node:assert/strict';

/** Authored direct real-Wasm loading projection; no DOM, scheduling or connection. */
export function menuLoadingSmoke(wasm) {
  const keys = ['visible', 'busy', 'text'];
  for (const mode of ['setter', 'nonwritable']) {
    const prior = keys.map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]);
    let writes = 0, view;
    try {
      for (const key of keys) Object.defineProperty(Object.prototype, key, mode === 'setter'
        ? { configurable: true, set() { writes++; } }
        : { configurable: true, writable: false, value: 'inherited' });
      view = wasm.menu_loading_view('loading', false);
    } finally {
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(Object.prototype, key, descriptor); else delete Object.prototype[key];
      }
    }
    assert.equal(writes, 0, 'loading copy never invokes inherited setters');
    assert.equal(Object.getPrototypeOf(view), null);
    for (const key of keys) assert.equal(Object.hasOwn(Object.getOwnPropertyDescriptor(view, key), 'value'), true);
    assert.deepEqual({ ...view }, { visible: true, busy: true, text: 'Loading client…' });
  }
  for (const code of ['loading','waiting-assets','ready-not-connected','connected','disconnected',
    'host-unavailable','csp-or-module-unavailable','client-failed','disposed']) {
    for (const mounted of [false,true]) {
      const view=wasm.menu_loading_view(code,mounted),copy=wasm.menu_loading_view(code,mounted);
      assert.equal(Object.isFrozen(view),true);assert.notEqual(view,copy);assert.deepEqual(view,copy);
      assert.deepEqual(Object.keys(view).sort(),['busy','text','visible']);
      assert.equal(typeof view.visible,'boolean');assert.equal(typeof view.busy,'boolean');assert.equal(typeof view.text,'string');
      if (['host-unavailable','csp-or-module-unavailable','client-failed','disposed'].includes(code)) {
        assert.equal(view.visible,true);assert.equal(view.busy,false);
      } else assert.equal(view.visible,!mounted);
      assert.equal(view.text.includes('%'),false);
    }
  }
  for(const code of ['', 'ready', 'retry', '__proto__'])assert.throws(()=>wasm.menu_loading_view(code,false));
  assert.equal(wasm.menu_loading_view('client-failed',true).text,wasm.start_page_view('failed',false,false).status);
  console.log('Synthetic real-Wasm authored loading/status/handoff/failure copied projections passed.');
}
