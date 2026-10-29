import assert from 'node:assert/strict';
import { createStockSession } from '../web/stock-session.mjs';

/** Authored real-Wasm policy checks; no browser, reference, storage or socket. */
export function menuPreferencesSmoke(wasm) {
  const p = new wasm.MenuPreferences(false, '');
  let restored;
  try {
    assert.equal(p.view().skin, 0); assert.deepEqual([...p.view().customSkin], []);
    p.set_nickname(' \u007f ');
    const custom = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 255, 41, 2, 37]);
    p.select(65, custom); custom[8] = 0;
    assert.equal(p.view().customSkin[8], 255);
    const copy = p.view(); copy.customSkin[8] = 0;
    assert.equal(p.view().customSkin[8], 255);
    const prior = p.serialize();
    for (const skin of [-1, .5, 66, 256, NaN, Infinity]) {
      assert.throws(() => p.select(skin, new Uint8Array())); assert.equal(p.serialize(), prior);
    }
    restored = new wasm.MenuPreferences(false, prior);
    assert.deepEqual(restored.view(), p.view());
    restored.free(); restored = new wasm.MenuPreferences(true, prior);
    assert.equal(restored.view().skin, 0); assert.equal(restored.view().nickname, '');
    p.action('reset'); p.action('build'); p.action('next-color'); p.action('longer'); p.action('add-stripe');
    assert.deepEqual([...p.view().customSkin], [0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 1]);
    assert.equal(wasm.resolve_skin(p.view().skin, p.view().customSkin, false).custom, true);
    assert.equal(p.view().nickname, ' \u007f ');
    const selected = p.view(), bytes = selected.customSkin.slice();
    let encoded, socketAttempts = 0;
    const session = createStockSession({ wasm: { ...wasm, encode_login(...args) {
      encoded = wasm.encode_login(...args); return encoded;
    } }, now: () => 0, createSocket() { socketAttempts++; throw Error('No socket in menu policy smoke'); } });
    const unsubscribe = session.subscribe({ packet() {}, state() {}, error(error) { throw error; } });
    try {
      session.play({ endpoint: 'ws://192.0.2.1:1234/slither',
        profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 },
        nickname: selected.nickname, skin: selected.skin, customSkin: selected.customSkin });
      selected.customSkin.fill(0);
      assert.deepEqual(encoded, Uint8Array.from([115, 30, 0, 1, ...new Array(20).fill(0), 0, 3, 32, 127, 32, 0, 255, ...bytes]));
      assert.equal(socketAttempts, 0);
    } finally { session.close('menu-smoke-cleanup'); unsubscribe(); }
    assert.throws(() => p.action('connect'));
    p.reset(); assert.equal(p.view().nickname, '');
  } finally { restored?.free(); p.free(); }
  console.log('Synthetic real-Wasm menu selection, copied runs, bounded restore and stock-session login bytes passed.');
}
