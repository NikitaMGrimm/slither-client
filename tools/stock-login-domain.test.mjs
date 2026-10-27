// Original synthetic fixtures and opaque Wasm/transport doubles; no reference or network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockSession } from '../web/stock-session.mjs';

function request(nickname) {
  return { endpoint: 'ws://192.0.2.9:1234/slither',
    profile: { clientVersion: 0x1234, protocolVersion: 19,
      password: Uint8Array.from({ length: 20 }, (_, index) => index + 1) },
    nickname, skin: 255, customSkin: Uint8Array.of(0, 127, 255) };
}

function harness({ rejectEncoding = false, failure } = {}) {
  const calls = [], sockets = [], states = [];
  let clockReads = 0;
  const session = createStockSession({
    wasm: {
      encode_login(version, password, nickname, skin, custom) {
        calls.push({ version, password, nickname, skin, custom });
        assert.deepEqual([...password], Array.from({ length: 20 }, (_, index) => index + 1));
        if (rejectEncoding) throw failure;
        // Opaque authored result: this double deliberately does not encode a login.
        return Uint8Array.of(42);
      },
      solve_challenge() { assert.fail('No challenge in staging tests'); },
      decode_frame() { assert.fail('No incoming frames in staging tests'); },
      setup_protocol_version() { assert.fail('No Setup in staging tests'); },
    },
    now() { clockReads++; return 1000; },
    createSocket(endpoint) {
      const socket = { endpoint, readyState: 0, bufferedAmount: 0,
        send() { assert.fail('No sends in staging tests'); },
        close() { this.readyState = 3; } };
      sockets.push(socket);
      return socket;
    },
  });
  session.subscribe({ state(value) { states.push(value); },
    packet() { assert.fail('No packets in staging tests'); },
    error() { assert.fail('No session failure in staging tests'); } });
  return { session, calls, sockets, states, get clockReads() { return clockReads; } };
}

function assertForwarded(h, input) {
  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.equal(call.nickname, input.nickname);
  assert.equal(call.version, 0x1234);
  assert.equal(call.skin, 255);
  assert.deepEqual([...call.custom], [0, 127, 255]);
  assert.notEqual(call.custom, input.customSkin);
  assert.notEqual(call.password, input.profile.password);
  assert.deepEqual([...call.password], new Array(20).fill(0));
  assert.deepEqual([...input.profile.password], Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(h.session.snapshot().phase, 'opening');
  assert.equal(h.session.snapshot().constructorAttempts, 0);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.clockReads, 0);
}

test('literal DEL forwards unchanged at the 24-byte boundary; socket waits for ordinary reset commit', () => {
  const h = harness(), input = request('\u007f'.repeat(24));
  try {
    h.session.play(input);
    assertForwarded(h, input);
    assert.equal(h.calls[0].nickname.charCodeAt(23), 127);
    h.session.commitControl();
    assert.equal(h.sockets.length, 0);
    assert.deepEqual(h.session.afterStep({ nowMs: 1000, delta: 1, wholeSteps: 1 }),
      { resetWorld: true, connected: false });
    assert.equal(h.sockets.length, 0);
    h.session.commitControl();
    assert.equal(h.sockets.length, 1);
    assert.equal(h.sockets[0].endpoint, input.endpoint);
    assert.equal(h.session.snapshot().constructorAttempts, 1);
    h.session.commitControl();
    assert.equal(h.sockets.length, 1);
  } finally { h.session.close(); }
});

test('every ASCII byte 0x20 through 0x7f at every admitted length forwards exactly', () => {
  for (let byte = 32; byte <= 127; byte++) {
    for (let length = 0; length <= 24; length++) {
      const h = harness(), input = request(String.fromCharCode(byte).repeat(length));
      try { h.session.play(input); assertForwarded(h, input); }
      finally { h.session.close(); }
    }
  }
  for (const nickname of ['', ' ', '  A  B  ', ' \u007f  A \u007f ']) {
    const h = harness(), input = request(nickname);
    try { h.session.play(input); assertForwarded(h, input); }
    finally { h.session.close(); }
  }
});

test('controls, non-ASCII and 25-byte names reject before any staged mutation', () => {
  const invalid = [];
  for (let byte = 0; byte <= 255; byte++) {
    if (byte < 32 || byte >= 128) invalid.push(`A${String.fromCharCode(byte)}Z`);
    else invalid.push(String.fromCharCode(byte).repeat(25));
  }
  invalid.push('\u0100', '\u2028', '\uffff', '\ud800', '\udfff', '\u{10000}', '\u{10ffff}',
    'A\n', 'A\r', 'A\r\n', 'A\u2028', 'A\u2029');
  for (const nickname of invalid) {
    const h = harness(), input = request(nickname);
    try {
      const before = h.session.snapshot(), pending = h.session.pendingActions();
      assert.throws(() => h.session.play(input), /Invalid login fields/);
      assert.deepEqual(h.session.snapshot(), before);
      assert.deepEqual(h.session.pendingActions(), pending);
      assert.equal(h.calls.length, 0);
      assert.equal(h.states.length, 0);
      assert.equal(h.sockets.length, 0);
      assert.equal(h.clockReads, 0);
      assert.deepEqual([...input.profile.password], Array.from({ length: 20 }, (_, index) => index + 1));
      // Rejection leaves the same session Play-eligible.
      const valid = request('\u007f');
      h.session.play(valid);
      assertForwarded(h, valid);
    } finally { h.session.close(); }
  }
});

test('encoder rejection preserves readiness and exact thrown values, clearing the borrowed password copy', () => {
  for (const failure of [new Error('Original synthetic encoder rejection'), undefined, null, false, 0, '']) {
    const h = harness({ rejectEncoding: true, failure }), input = request('\u007f');
    try {
      const before = h.session.snapshot(), pending = h.session.pendingActions();
      let threw = false, received;
      try { h.session.play(input); } catch (error) { threw = true; received = error; }
      assert.equal(threw, true);
      assert.equal(received, failure);
      assert.equal(h.calls.length, 1);
      assert.deepEqual([...h.calls[0].password], new Array(20).fill(0));
      assert.deepEqual([...input.profile.password], Array.from({ length: 20 }, (_, index) => index + 1));
      assert.deepEqual(h.session.snapshot(), before);
      assert.deepEqual(h.session.pendingActions(), pending);
      assert.equal(h.states.length, 0);
      assert.equal(h.sockets.length, 0);
      assert.equal(h.clockReads, 0);
    } finally { h.session.close(); }
  }
});
