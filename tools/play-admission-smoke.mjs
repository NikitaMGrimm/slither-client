import assert from 'node:assert/strict';
import { createStockSession } from '../web/stock-session.mjs';

/** Authored real-Wasm admission/menu/session composition; no browser or transport. */
export function playAdmissionSmoke(wasm) {
  for (const local of [false, true]) for (const profile of [false, true]) {
    const policy = new wasm.PlayAdmission(local, profile);
    try {
      assert.equal(policy.available(), local || profile);
      assert.equal(policy.accepted(), false);
      assert.equal(policy.lock_unavailable(), !(local || profile));
      assert.equal(policy.accept(), local || profile);
      assert.equal(policy.accepted(), true); assert.equal(policy.accept(), false);
      for (const phase of ['ready', 'opening', 'playing', 'victory', 'disconnected', 'failed', '', 'unknown']) {
        for (const playing of [true, false]) {
          assert.equal(policy.return_ready(phase, playing), local && (phase === 'disconnected' || phase === 'victory' && !playing));
          assert.equal(policy.accepted(), true, 'return observation never releases acceptance');
        }
      }
      assert.throws(() => policy.complete_return());
      if (local) {
        assert.equal(policy.return_ready('victory', false), true);
        policy.complete_return(); assert.equal(policy.accepted(), false);
        assert.equal(policy.accept(), true);
      }
    } finally { policy.free(); }
  }
  const policy = new wasm.PlayAdmission(true, false), menu = new wasm.MenuPreferences(true, '');
  let encoded;
  const session = createStockSession({ wasm: { ...wasm, encode_login(...args) {
    encoded = wasm.encode_login(...args); return encoded;
  } }, now:()=>0, createSocket() { assert.fail('No transport in Play admission ABI composition'); } });
  const unsubscribe = session.subscribe({ packet(){}, state(){}, error(error){throw error;} });
  try {
    for (const nickname of ['', ' \u007f ', 'x'.repeat(24)]) assert.equal(policy.nickname_valid(nickname), true);
    for (const nickname of ['\u001f', '\u0080', 'x'.repeat(25), '\ud800']) assert.equal(policy.nickname_valid(nickname), false);
    menu.set_nickname(' Retained '); menu.select(2, Uint8Array.from([0,0,0,0,0,0,0,0,3,2]));
    const selected = menu.view(), saved = menu.serialize(), bytes = selected.customSkin.slice();
    assert.equal(policy.accept(), true);
    session.play({ endpoint:'ws://127.0.0.1:19400/slither', nickname:selected.nickname, skin:selected.skin, customSkin:selected.customSkin,
      profile:{clientVersion:0,password:new Uint8Array(20),protocolVersion:19} });
    selected.customSkin.fill(0);
    assert.deepEqual(encoded, Uint8Array.from([115,30,0,0,...new Array(20).fill(0),2,10,...Buffer.from(' Retained '),0,255,...bytes]));
    assert.equal(policy.accept(), false); assert.equal(menu.serialize(), saved);
    assert.equal(policy.return_ready('disconnected', false), true);
    policy.complete_return(); assert.equal(menu.serialize(), saved);
    assert.equal(policy.accepted(), false, 'return permits only a later explicit acceptance');
  } finally { session.close('play-policy-smoke'); unsubscribe(); menu.free(); policy.free(); }
  console.log('Synthetic real-Wasm Play admission, local return and copied menu/session login composition passed.');
}
