// Project-authored status delta. Supplied owners may be actual Wasm in the later
// coherent ABI phase; native effects are inert. The legacy oracle stays immutable.
import assert from 'node:assert/strict';
import {createStockGameplay} from '../web/stock-gameplay.mjs';
import {createGameplayComposition} from './fixtures/gameplay-composition-fixture.mjs';

export function connectingStatusSmoke(wasm) {
  let cases = 0;
  function fixture() {
    const statuses = [];
    const fixture = createGameplayComposition(createStockGameplay, wasm, {
      configure(options) {
        const previous = options.onStatus;
        options.onStatus = code => { previous(code); statuses.push(code); };
      },
    });
    return {...fixture, statuses};
  }
  const f = fixture(), {h} = f;
  try {
    h.gameplay.render(); h.flush(); assert.equal(f.statuses.at(-1), 'ready-not-connected');
    h.gameplay.play(f.login()); h.flush();
    assert.equal(h.gameplay.diagnostics().session.phase, 'opening');
    assert.equal(h.sockets.length, 0, 'status reconciliation does not commit a transport');
    assert.equal(f.statuses.at(-1), 'connecting', 'deferred opening retains busy status'); cases++;
    const count = f.statuses.length; h.flush();
    assert.equal(f.statuses.length, count, 'no second notification without a state change');
    h.gameplay.frame(8); h.flush();
    assert.equal(h.sockets.length, 1); assert.equal(h.sockets[0].sent.length, 0);
    assert.equal(f.statuses.at(-1), 'connecting');
    h.sockets[0].open(); h.flush();
    assert.equal(h.gameplay.diagnostics().session.phase, 'challenge');
    assert.deepEqual(h.sockets[0].sent, [[1], [99, 0]]);
    assert.equal(f.statuses.at(-1), 'connecting'); cases++;
    h.sockets[0].message([54, 1]); h.flush();
    assert.equal(h.gameplay.diagnostics().session.phase, 'setup');
    assert.equal(f.statuses.at(-1), 'connecting'); cases++;
    h.sockets[0].message([97, 3]); h.flush();
    assert.equal(h.gameplay.diagnostics().session.connected, true);
    assert.equal(f.statuses.at(-1), 'connected'); cases++;
    h.sockets[0].onclose(); h.flush();
    assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
    assert.equal(f.statuses.at(-1), 'disconnected');
    assert.deepEqual(h.errors, []); assert.equal(h.sockets.length, 1); cases++;
  } finally { h.gameplay.dispose(); h.controller.dispose(); }
  for (const terminal of ['close', 'error']) {
    const f = fixture(), {h} = f, primary = new Error('Authored transport failure');
    try {
      h.gameplay.play(f.login()); h.gameplay.frame(8); h.flush();
      assert.equal(f.statuses.at(-1), 'connecting');
      if (terminal === 'close') h.sockets[0].onclose(); else h.sockets[0].onerror(primary);
      h.flush();
      const observed = h.gameplay.diagnostics();
      assert.equal(observed.session.phase, terminal === 'close' ? 'disconnected' : 'failed');
      if (terminal === 'close') assert.equal(f.statuses.at(-1), 'disconnected');
      else { assert.equal(observed.disposed, true); assert.deepEqual(h.errors, [primary]); }
      assert.equal(h.sockets[0].closes, 1); assert.equal(h.sockets.length, 1); cases++;
    } finally { h.gameplay.dispose(); h.controller.dispose(); }
  }
  return {cases, scope:'Actual gameplay/session/controller adapters; caller-supplied policy owners and inert native effects. Explicit intentional status delta, not legacy equality.'};
}

export function connectingStatusScalarSmoke(wasm) {
  let cases = 0;
  for (const [phase, connected, expected] of [
    ['ready', false, 1], ['ready', true, 1],
    ...['opening', 'challenge', 'setup'].flatMap(phase => [[phase, false, 4], [phase, true, 2]]),
    ...['playing', 'victory', 'dead', 'failed', 'disconnected', 'unknown'].flatMap(phase => [[phase, false, 3], [phase, true, 2]]),
  ]) { assert.equal(wasm.GameplayPolicy.status(phase, connected), expected, phase); cases++; }
  return {cases, abi:'Existing static status export takes the copied phase STRING and connected boolean; numeric1/2/3 retain their meanings,4 is connecting.'};
}
