// Original synthetic fixtures and socket/Wasm doubles; no source archive or network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockSession, stockEndpoint } from '../web/stock-session.mjs';
import { createClientInput } from './fixtures/client-input-fixture.mjs';

const packed = commands => Uint8Array.from(commands.flatMap(command => [0, 0, command.length >> 8, command.length & 255, ...command]));
function frame(...commands) {
  if (commands.length === 1) return Uint8Array.from(commands[0]).buffer;
  return Uint8Array.from(commands.flatMap((command, index) => index === 0
    ? [command.length >> 8, command.length & 255, ...command] : [command.length + 32, ...command])).buffer;
}
function syntheticChallenge() {
  const source = 'var a="HELLO";a+="ABCDEFGHIJKLMNOPQRSTUV";for(var i=0;i<27;i++){idba[i]=a.charCodeAt(i);}';
  let key = 23;
  const encoded = [];
  for (const byte of new TextEncoder().encode(source)) {
    for (const nibble of [byte >> 4, byte & 15]) {
      encoded.push(97 + (nibble + key) % 26); key = (key + 17) % 26;
    }
  }
  return encoded;
}
const challenge = [54, ...syntheticChallenge()];
const setup = [97, ...new Array(22).fill(0), 19, 42];
const own = { token: 1n, wantedHeading: 0, gazeHeading: 0, dead: false,
  turnRate: 0.03, sizeTurnFactor: 1, speedTurnFactor: 1 };
const request = () => ({ endpoint: 'ws://192.0.2.9:1234/slither',
  profile: { clientVersion: 7, password: Uint8Array.from({ length: 20 }, (_, i) => i + 1), protocolVersion: 19 },
  nickname: 'Synthetic', skin: 2, customSkin: new Uint8Array() });
function harness({ rejectPacket = false, createError, subscriber = {}, wasmChanges = {} } = {}) {
  let clock = 1000;
  const packets = [], states = [], errors = [], sockets = [], trace = [];
  const wasm = {
    encode_login(version, password, nickname, skin, custom) {
      return Uint8Array.from([115, 30, version >> 8, version & 255, ...password, skin,
        nickname.length, ...new TextEncoder().encode(nickname), 0, 255, ...custom]);
    },
    solve_challenge(encoded) {
      assert.deepEqual([...encoded], challenge.slice(1));
      return new Uint8Array(27).fill(65);
    },
    decode_frame(bytes, timed) {
      assert.equal(timed, false);
      if (bytes.length === 0) throw new Error('empty synthetic frame');
      if (bytes[0] >= 32) return packed([[...bytes]]);
      const commands = [];
      for (let i = 0; i < bytes.length;) {
        const prefix = bytes[i++];
        if (prefix < 32 && i === bytes.length) throw new Error('truncated synthetic length');
        const length = prefix < 32 ? prefix * 256 + bytes[i++] : prefix - 32;
        if (!length || length > bytes.length - i || bytes[i] < 32) throw new Error('bad synthetic frame');
        commands.push([...bytes.slice(i, i + length)]); i += length;
      }
      return packed(commands);
    },
    setup_protocol_version(command) { if (command.length < 25) throw new Error('synthetic truncated Setup'); return command[23]; },
    ...wasmChanges,
  };
  const session = createStockSession({ wasm, now: () => clock, createSocket(endpoint) {
    trace.push(['construct', endpoint]);
    if (createError) throw createError;
    const socket = { readyState: 0, bufferedAmount: 0, sent: [], closes: 0,
      send(bytes) { trace.push(['send', [...bytes]]); this.beforeSend?.(bytes); this.sent.push([...bytes]); },
      close() { this.closes++; this.readyState = 3; },
      open() { this.readyState = 1; this.onopen?.(); },
      message(...commands) { this.onmessage?.({ data: frame(...commands) }); },
    };
    sockets.push(socket); return socket;
  } });
  const unsubscribe = session.subscribe({
    packet(bytes, timed) {
      trace.push(['packet', [...bytes]]);
      if (rejectPacket) throw rejectPacket;
      packets.push({ bytes: [...bytes], timed });
    },
    state(value) { states.push(value); subscriber.state?.(value); },
    error(error) { errors.push(error); subscriber.error?.(error); },
  });
  const step = (ms = clock, delta = 1, wholeSteps = 1) => session.afterStep({ nowMs: ms, delta, wholeSteps });
  const tick = (...args) => { const action = step(...args); session.commitControl(); return action; };
  function start() { session.play(request()); const action = step(); session.commitControl(); sockets[0]?.open(); return action; }
  function connected(...tail) { start(); sockets[0].message(challenge); sockets[0].message(setup, ...tail); }
  return { session, wasm, sockets, packets, states, errors, trace, start, connected, step, tick, unsubscribe,
    setTime(value) { clock = value; } };
}

test('construct/subscribe/invalid profile never open or reset; staged Play needs native commit', () => {
  const h = harness();
  assert.equal(h.sockets.length, 0);
  const invalid = request(); delete invalid.profile;
  assert.throws(() => h.session.play(invalid));
  assert.equal(h.session.snapshot().phase, 'ready');
  assert.deepEqual(h.session.pendingActions().actions, {});
  h.session.play(request());
  assert.equal(h.sockets.length, 0);
  h.session.commitControl(); assert.equal(h.sockets.length, 0);
  assert.deepEqual(h.step(), { resetWorld: true, connected: false });
  h.session.commitControl(); h.session.commitControl();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sockets[0].binaryType, 'arraybuffer');
  assert.equal(h.trace[0][1], request().endpoint);
});

test('cancelled staged Play cannot construct and an instance cannot retry', () => {
  const h = harness(); h.session.play(request()); h.step(); h.session.close(); h.session.commitControl();
  assert.equal(h.sockets.length, 0);
  assert.throws(() => h.session.play(request()), /one manual Play/i);
});

test('only selected IP/explicit port/exact route is accepted without DNS or fallback', () => {
  assert.equal(stockEndpoint('wss://[2001:db8::1]:444/slither'), 'wss://[2001:db8::1]:444/slither');
  for (const url of ['ws://example.com:1234/slither', 'ws://127.1:1234/slither', 'ws://01.2.3.4:1234/slither',
    'ws://256.2.3.4:1234/slither', 'ws://192.0.2.1/slither', 'ws://192.0.2.1:0/slither',
    'ws://192.0.2.1:65536/slither', 'ws://192.0.2.1:80/slither?x=1', 'ws://x@192.0.2.1:80/slither',
    'ws://[1:2]:80/slither', 'http://192.0.2.1:80/slither', 'ws://192.0.2.1:80/slither#x']) {
    assert.throws(() => stockEndpoint(url), url);
  }
});

test('profile and login validate before mutation, reject getters/truncation, copy caller bytes', () => {
  for (const modify of [r => { r.profile.clientVersion = 65536; }, r => { r.profile.password = new Uint8Array(19); },
    r => { r.profile.protocolVersion = 18; }, r => { r.nickname = '\u0080'; }, r => { r.skin = 256; },
    r => { r.customSkin = new Uint8Array(256); }]) {
    const h = harness(), r = request(); modify(r); assert.throws(() => h.session.play(r));
    assert.equal(h.session.snapshot().phase, 'ready'); assert.equal(h.sockets.length, 0);
  }
  const h = harness(), r = request();
  Object.defineProperty(r.profile, 'clientVersion', { get() { assert.fail('getter executed'); } });
  assert.throws(() => h.session.play(r), /record field/);
  const safe = request(); h.session.play(safe); safe.profile.password.fill(200);
  h.step(); h.session.commitControl(); h.sockets[0].open(); h.sockets[0].message(challenge);
  assert.deepEqual(h.sockets[0].sent[3].slice(4, 24), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(JSON.stringify(h.session.snapshot()).includes('password'), false);
});

for (const [name, modify] of [
  ['non-ASCII nickname', r => { r.nickname = '\u0080'; }],
  ['long nickname', r => { r.nickname = 'x'.repeat(25); }],
  ['negative skin', r => { r.skin = -1; }],
  ['large skin', r => { r.skin = 256; }],
  ['wrong custom byte type', r => { r.customSkin = new Uint16Array(1); }],
  ['long custom skin', r => { r.customSkin = new Uint8Array(256); }],
  ['invalid endpoint', r => { r.endpoint = 'ws://example.invalid:1234/slither'; }],
]) {
  test(`session clears its owned password when rejecting ${name}`, () => {
    const h = harness(), r = request(); modify(r);
    const Native = globalThis.Uint8Array;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Uint8Array');
    const copies = [];
    // Authored observation only: preserve intrinsic brand/prototype while tracking
    // the private session copy, which acquisition-capability tests cannot observe.
    globalThis.Uint8Array = new Proxy(Native, { construct(target, args, newTarget) {
      const value = Reflect.construct(target, args, newTarget);
      if (value.length === 20) copies.push(value);
      return value;
    } });
    try {
      assert.throws(() => h.session.play(r));
      assert.equal(copies.length, 1);
      assert(copies.every(value => value.every(byte => byte === 0)), 'Every session password copy clears on rejection');
      assert.deepEqual([...r.profile.password], Array.from({ length: 20 }, (_, i) => i + 1));
      assert.equal(h.session.snapshot().phase, 'ready');
      assert.deepEqual(h.session.pendingActions().actions, {});
      assert.equal(h.sockets.length, 0);
    } finally { Object.defineProperty(globalThis, 'Uint8Array', descriptor); h.session.close(); }
  });
}

for (const failure of [new Error('Authored encoder failure'), undefined, null]) {
  test(`session clears its password and preserves encoder failure ${String(failure)}`, () => {
    const h = harness({ wasmChanges: { encode_login() { throw failure; } } }), r = request();
    const Native = globalThis.Uint8Array;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Uint8Array');
    const copies = [];
    globalThis.Uint8Array = new Proxy(Native, { construct(target, args, newTarget) {
      const value = Reflect.construct(target, args, newTarget);
      if (value.length === 20) copies.push(value);
      return value;
    } });
    try {
      let threw = false, received;
      try { h.session.play(r); } catch (error) { threw = true; received = error; }
      assert.equal(threw, true); assert.equal(received, failure);
      assert.equal(copies.length, 1); assert(copies[0].every(byte => byte === 0));
      assert.equal(h.session.snapshot().phase, 'ready'); assert.equal(h.sockets.length, 0);
    } finally { Object.defineProperty(globalThis, 'Uint8Array', descriptor); h.session.close(); }
  });
}

test('exact untimed prefixes, closed challenge reply, then login in separate sends', () => {
  const h = harness(); h.start();
  assert.deepEqual(h.sockets[0].sent, [[1], [99, 0]]);
  h.sockets[0].message(challenge);
  assert.equal(h.sockets[0].sent.length, 4);
  assert.deepEqual(h.sockets[0].sent[2], new Array(27).fill(65));
  assert.deepEqual(h.sockets[0].sent[3].slice(0, 4), [115, 30, 0, 7]);
  assert.equal(h.session.snapshot().phase, 'setup');
});

test('Setup and bundled world tail are delivered once; connected/playing precede own', () => {
  const h = harness(); h.connected([115, 0, 4]);
  assert.equal(h.packets.length, 1);
  assert.deepEqual(h.packets[0], { bytes: [...new Uint8Array(frame(setup, [115, 0, 4]))], timed: false });
  assert.equal(h.session.snapshot().connected, true); assert.equal(h.session.snapshot().playing, true);
  assert.equal(h.session.snapshot().phase, 'playing');
  assert.equal(Object.isFrozen(h.states.at(-1)), true);
});

test('own removal is opaque to session life; repeated valid Setup is not re-login', () => {
  const h = harness(); h.connected(); h.sockets[0].message([115, 0, 1, 1]);
  assert.equal(h.session.snapshot().lifeEnded, false); assert.equal(h.session.snapshot().connected, true);
  h.sockets[0].message(setup); assert.equal(h.packets.length, 3); assert.equal(h.sockets[0].sent.length, 4);
});

test('unsupported challenge and challenge/setup bundle fail without solver fallback/login', () => {
  for (const bundled of [false, true]) {
    let calls = 0;
    const failure = new Error('unsupported synthetic family');
    const h = harness({ wasmChanges: { solve_challenge() { calls++; throw failure; } } }); h.start();
    if (bundled) h.sockets[0].message(challenge, setup); else h.sockets[0].message(challenge);
    assert.equal(h.session.snapshot().phase, 'failed'); assert.equal(h.sockets[0].sent.length, 2);
    assert.equal(calls, bundled ? 0 : 1); assert.equal(h.sockets[0].closes, 1);
    if (!bundled) assert.equal(h.errors[0], failure);
  }
});

test('repeated challenge/wrong protocol/noncanonical controls reject before packet callbacks', () => {
  for (const command of [challenge, [112, 1], [118], [118, 0, 0], [...setup.slice(0, 23), 18, 42]]) {
    const h = harness(); h.connected(); h.sockets[0].message(command);
    assert.equal(h.session.snapshot().phase, 'failed'); assert.equal(h.packets.length, 1);
  }
});

test('complete structural decoding precedes controls and typed packet rejection preserves life evidence', () => {
  const h = harness(); h.connected();
  h.sockets[0].onmessage({ data: Uint8Array.of(0, 1, 112, 0).buffer });
  assert.equal(h.session.snapshot().phase, 'failed'); assert.equal(h.packets.length, 1);
  const failure = new Error('synthetic Rust typed tail rejected');
  const r = harness({ rejectPacket: failure }); r.start(); r.sockets[0].message(challenge);
  r.sockets[0].message(setup, [118, 0], [222]);
  assert.equal(r.session.snapshot().lifeEnded, false);
  assert.equal(Object.hasOwn(r.session.pendingActions().actions, 'resetLag'), false);
  assert.equal(r.errors[0], failure);
});

test('nonbinary, empty, oversized and malformed ABI frames stop once', () => {
  for (const data of ['text', new ArrayBuffer(0), new ArrayBuffer(1048577)]) {
    const h = harness(); h.start(); h.sockets[0].onmessage({ data });
    assert.equal(h.session.snapshot().phase, 'failed'); assert.equal(h.sockets[0].closes, 1);
  }
  const h = harness({ wasmChanges: { decode_frame: () => Uint8Array.of(0, 0, 0) } }); h.start(); h.sockets[0].message(challenge);
  assert.equal(h.session.snapshot().phase, 'failed');
});

test('strict handshake deadline has no retry, including constructor failure', () => {
  const h = harness(); h.start(); h.session.beforeUpdate(4333);
  assert.equal(h.session.snapshot().phase, 'challenge');
  h.session.beforeUpdate(4333.01); assert.equal(h.session.snapshot().phase, 'failed');
  h.session.beforeUpdate(100000); assert.equal(h.session.snapshot().constructorAttempts, 1);
  const error = new Error('constructor'); const r = harness({ createError: error });
  r.session.play(request()); r.step(); assert.throws(() => r.session.commitControl(), e => e === error);
  assert.equal(r.session.snapshot().constructorAttempts, 1); assert.equal(r.session.snapshot().phase, 'failed');
});

test('ping strict 250ms threshold, one outstanding, no-own hook and exact input ordering', () => {
  const h = harness(); h.connected();
  const input = createClientInput(); input.setConnected(true);
  let out = input.tick({ nowMs: 250, wholeSteps: 0 }, h.session.sendInput, h.session.betweenKeyboardAndBoost);
  assert.deepEqual(out.intents, []);
  out = input.tick({ nowMs: 251, wholeSteps: 0 }, h.session.sendInput, h.session.betweenKeyboardAndBoost);
  assert.deepEqual(out.intents.map(x => [...x]), [[251]]);
  h.sockets[0].message([112]);
  input.setOwn(own); input.keyDown('ArrowLeft'); input.keyDown('Space');
  input.pointer({ clientX: 900, clientY: 400, viewportWidth: 1000, viewportHeight: 800, follow: true });
  out = input.tick({ nowMs: 502, wholeSteps: 1 }, h.session.sendInput, h.session.betweenKeyboardAndBoost);
  assert.deepEqual(out.intents.map(x => [...x]), [[252, 1], [251], [253]]);
  input.tick({ nowMs: 1000, wholeSteps: 1 }, h.session.sendInput, h.session.betweenKeyboardAndBoost);
  assert.equal(h.sockets[0].sent.filter(x => x.length === 1 && x[0] === 251).length, 2);
});

test('strict lag threshold, no hard pong timeout, ordered pong and no multiplier reset', () => {
  const h = harness(); h.connected(); h.session.betweenKeyboardAndBoost({ nowMs: 1000, protocolVersion: 19 }, h.session.sendInput);
  assert.equal(h.session.beforeUpdate(1750).lagging, false);
  assert.equal(h.session.beforeUpdate(1750.01).lagging, true);
  assert.equal(h.session.beforeUpdate(10000000).connected, true);
  h.sockets[0].message([112]); assert.equal(h.session.snapshot().pingPending, false);
  assert.equal(h.session.snapshot().lagging, false);
  assert.equal(Object.hasOwn(h.session.pendingActions().actions, 'resetLag'), false);
  assert.equal(h.sockets[0].closes, 0);
});

test('gameOver requests independent lag reset; acknowledgements selective and stale-safe', () => {
  const h = harness(); h.connected(); h.sockets[0].message([118, 1]);
  const offer = h.session.pendingActions(); assert.deepEqual(offer.actions, { resetLag: true });
  h.sockets[0].message([118, 2]);
  h.session.acknowledgeActions(offer);
  assert.deepEqual(h.session.pendingActions().actions, {});
  assert.throws(() => h.session.acknowledgeActions(offer), /Stale/);
  h.session.close(); const reset = h.session.pendingActions();
  assert.throws(() => h.session.acknowledgeActions(reset), /No lag reset/);
  assert.equal(h.session.pendingActions().actions.resetWorld, true);
});

test('v0 waits for source return phase and resets BEFORE input/motion, not own removal', () => {
  const h = harness(); h.connected(); h.session.uiTick(1500); h.setTime(1600); h.sockets[0].message([118, 0]);
  assert.equal(h.session.snapshot().connected, true); assert.equal(h.session.snapshot().playing, true);
  assert.equal(h.session.snapshot().phase, 'dead');
  const offer = h.session.pendingActions(); h.session.acknowledgeActions(offer);
  assert.deepEqual(h.tick(3200, 5, 5), {}); assert.equal(h.session.snapshot().returnFraction, 1);
  for (let i = 0; i < 49; i++) h.tick(3201 + i * 40, 5, 5);
  assert.equal(h.sockets[0].closes, 0);
  const input = createClientInput(); input.setConnected(true); input.setOwn(own); input.keyDown('ArrowLeft');
  input.accumulateStep({ wholeSteps: 5 });
  const action = h.step(6000, 5, 5);
  assert.deepEqual(action, { resetWorld: true, connected: false });
  input.reset();
  assert.deepEqual(input.tick({ nowMs: 6000, wholeSteps: 0 }, h.session.sendInput, h.session.betweenKeyboardAndBoost).intents, []);
  assert.equal(input.snapshot().leftSteps, 5); assert.equal(h.sockets[0].closes, 1);
  h.session.commitControl(); assert.equal(h.session.snapshot().connected, false);
});

test('v1 retains connection after return; v2 closes at next pre-motion boundary', () => {
  const h = harness(); h.connected(); h.session.uiTick(1500); h.setTime(1600); h.sockets[0].message([118, 1]);
  for (let i = 0; i < 51; i++) h.tick(3300 + i * 40, 5, 5);
  assert.equal(h.session.snapshot().phase, 'victory'); assert.equal(h.session.snapshot().playing, false);
  assert.equal(h.session.snapshot().connected, true); assert.equal(h.sockets[0].closes, 0);
  h.sockets[0].message([118, 2]); assert.equal(h.sockets[0].closes, 0);
  assert.equal(h.step(6000).resetWorld, true); assert.equal(h.sockets[0].closes, 1);
});

test('v2 while death pending waits, and early v2 without death closes next step', () => {
  const h = harness(); h.connected(); h.session.uiTick(1500); h.setTime(1600);
  h.sockets[0].message([118, 1], [118, 2]); h.step(1601); assert.equal(h.sockets[0].closes, 0);
  const r = harness(); r.connected(); r.sockets[0].message([118, 2]);
  assert.equal(r.session.snapshot().connected, true); r.step(); assert.equal(r.sockets[0].closes, 1);
});

test('UI fade is separate 25ms caller cadence; death does not skip pending fade-in', () => {
  const h = harness(); h.connected(); assert.equal(h.session.snapshot().uiTimerNeeded, true);
  h.session.uiTick(1025); assert.equal(h.session.snapshot().returnFraction, 0.05);
  h.setTime(1100); h.sockets[0].message([118, 0]); h.tick(5000, 5, 5);
  assert.equal(h.session.snapshot().returnFraction, 0.05); assert.equal(h.sockets[0].closes, 0);
  h.session.uiTick(6000); assert.equal(h.session.snapshot().uiTimerNeeded, false);
  h.step(6001, 5, 5); assert.equal(h.session.snapshot().returnFraction, 0.98);
});

test('send/backpressure errors preserve original exception, abort later input and never retry', () => {
  const h = harness(); h.connected();
  const input = createClientInput(); input.setConnected(true); input.setOwn(own); input.keyDown('ArrowLeft'); input.keyDown('Space');
  const error = new Error('send failed'); h.sockets[0].beforeSend = () => { throw error; };
  assert.throws(() => input.tick({ nowMs: 1000, wholeSteps: 1 }, h.session.sendInput, h.session.betweenKeyboardAndBoost), e => e === error);
  assert.equal(input.snapshot().lastTurnMs, 1000); assert.equal(input.snapshot().lastBoostMs, 0);
  assert.equal(h.session.snapshot().phase, 'failed'); assert.equal(h.sockets[0].closes, 1);
  assert.equal(h.errors[0], error);
  const r = harness(); r.connected(); r.sockets[0].bufferedAmount = 4096; r.session.sendInput(Uint8Array.of(0));
  r.sockets[0].bufferedAmount = 4097; assert.throws(() => r.session.sendInput(Uint8Array.of(1)), /queue/);
  assert.equal(r.session.snapshot().constructorAttempts, 1);
});

test('failed ping aborts boost and heading and has no deferred packet queue', () => {
  const h = harness(); h.connected(); const input = createClientInput(); input.setConnected(true); input.setOwn(own); input.keyDown('Space');
  const error = new Error('ping'); h.sockets[0].beforeSend = bytes => { if (bytes[0] === 251) throw error; };
  assert.throws(() => input.tick({ nowMs: 1000, wholeSteps: 0 }, h.session.sendInput, h.session.betweenKeyboardAndBoost), e => e === error);
  assert.equal(input.snapshot().lastBoostMs, 0); assert.equal(h.session.snapshot().lastPingMs, 1000);
  assert.equal(h.sockets[0].sent.length, 4);
});

test('stale callbacks are inert, close is idempotent and sends no release packet', () => {
  const h = harness(); h.connected(); const socket = h.sockets[0];
  const old = { open: socket.onopen, message: socket.onmessage, error: socket.onerror, close: socket.onclose };
  h.session.close('pagehide'); h.session.close('again');
  old.open(); old.message({ data: frame(setup) }); old.error(new Error('stale')); old.close();
  assert.equal(socket.closes, 1); assert.equal(socket.sent.length, 4); assert.equal(h.packets.length, 1);
  assert.equal(h.session.snapshot().reason, 'pagehide'); assert.equal(h.errors.length, 0);
});

test('synchronous socket-message reentry fails without a second negotiation send', () => {
  const h = harness(); h.session.play(request()); h.step(); h.session.commitControl();
  const socket = h.sockets[0]; socket.beforeSend = () => socket.onmessage?.({ data: frame(challenge) }); socket.open();
  assert.equal(h.session.snapshot().phase, 'failed'); assert.equal(socket.closes, 1);
  assert.ok(socket.sent.length <= 1);
});

test('bad control metadata and input bytes reject without sends or action consumption', () => {
  const h = harness(); h.connected();
  for (const bytes of [[], [252], [252, 0], [252, 128], [255], [1, 2, 3]]) assert.throws(() => h.session.sendInput(Uint8Array.from(bytes)));
  assert.equal(h.sockets[0].sent.length, 4);
  assert.throws(() => h.session.afterStep({ nowMs: 1, delta: 6, wholeSteps: 1 }));
  assert.throws(() => h.session.afterStep({ nowMs: 1, delta: 1, wholeSteps: 6 }));
  assert.equal(h.session.snapshot().connected, true);
});

test('a pre-motion step is consumed once and lag acknowledgement cannot consume resetWorld', () => {
  const h = harness(); h.connected(); h.sockets[0].message([118, 0]); h.session.close();
  const offered = h.session.pendingActions();
  assert.deepEqual(offered.actions, { resetLag: true, resetWorld: true, connected: false });
  h.session.acknowledgeActions(offered);
  assert.deepEqual(h.session.pendingActions().actions, { resetWorld: true, connected: false });
  h.step(); assert.throws(() => h.step(), /not committed/); h.session.commitControl();
  assert.deepEqual(h.session.pendingActions().actions, {});
});

test('packet callback cannot synchronously mutate/reenter session or return a Promise', () => {
  for (const mode of ['reenter', 'async']) {
    const h = harness();
    // A separate session keeps the single-subscriber contract intact.
    const session = createStockSession({ wasm: h.wasm, now: () => 1000, createSocket() {
      const socket = { readyState: 0, bufferedAmount: 0, send() {}, close() { this.readyState = 3; } };
      h.sockets.push(socket); return socket;
    } });
    const errors = [];
    session.subscribe({ state() {}, error(e) { errors.push(e); }, packet() {
      if (mode === 'reenter') session.afterStep({ nowMs: 1000, delta: 1, wholeSteps: 1 });
      else return Promise.resolve();
    } });
    session.play(request()); session.afterStep({ nowMs: 1000, delta: 1, wholeSteps: 1 }); session.commitControl();
    const socket = h.sockets[0]; socket.readyState = 1; socket.onopen();
    socket.onmessage({ data: frame(challenge) }); socket.onmessage({ data: frame(setup) });
    assert.equal(session.snapshot().phase, 'failed'); assert.equal(session.snapshot().connected, false);
    assert.match(String(errors[0]), mode === 'reenter' ? /reentry/ : /Synchronous/);
  }
});

test('same-stack close during packet callback cannot resurrect connection state', () => {
  const h = harness();
  const session = createStockSession({ wasm: h.wasm, now: () => 1000, createSocket() {
    const socket = { readyState: 0, bufferedAmount: 0, send() {}, close() { this.readyState = 3; } };
    h.sockets.push(socket); return socket;
  } });
  session.subscribe({ state() {}, error() {}, packet() { h.sockets[0].onclose(); } });
  session.play(request()); session.afterStep({ nowMs: 1000, delta: 1, wholeSteps: 1 }); session.commitControl();
  const socket = h.sockets[0]; socket.readyState = 1; socket.onopen();
  socket.onmessage({ data: frame(challenge) }); socket.onmessage({ data: frame(setup) });
  assert.equal(session.snapshot().phase, 'disconnected'); assert.equal(session.snapshot().connected, false);
});

test('intrinsic profile byte length ignores a shadow getter without invoking it', () => {
  const h = harness(), r = request();
  Object.defineProperty(r.profile.password, 'length', { get() { assert.fail('byte getter invoked'); } });
  h.session.play(r); assert.equal(h.sockets.length, 0);
});

test('notification callbacks may observe but cannot consume native actions or close reentrantly', () => {
  let session;
  const h = harness({ subscriber: { state() {
    assert.ok(session.snapshot());
    assert.throws(() => session.pendingActions(), /reentry/);
    assert.throws(() => session.close(), /reentry/);
  } } });
  session = h.session; h.connected(); session.close();
  assert.equal(h.errors.length, 0); assert.equal(h.sockets[0].closes, 1);
});
