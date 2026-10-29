import { ProfileLiteralParserDouble } from './fixtures/profile-literals-double.mjs';
import { loadWasm } from './reference-context.mjs';
const ProfileLiteralParser = process.env.SLITHER_PROFILE_LITERALS_WASM === '1'
  ? (await loadWasm()).ProfileLiteralParser : ProfileLiteralParserDouble;
// Actual authored acquirer/gameplay/session with synthetic bytes and inert socket/capability doubles.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createStockGameplay } from '../web/stock-gameplay.mjs';

const HASH = '5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095';
const request = () => ({ endpoint: 'ws://192.0.2.9:1234/slither', nickname: 'Synthetic live',
  skin: 2, customSkin: Uint8Array.of(1, 2, 3) });
const externalRequest = () => ({ ...request(), profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 } });
const defer = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const own = () => ({ token: 1n, id: 7, rawHead: { x: 300, y: 400 }, wantedHeading: 0.4,
  gazeHeading: 0, dead: false, turnRate: 0.03, sizeTurnFactor: 1, speedTurnFactor: 1 });
const allZero = bytes => bytes.every(value => value === 0);
function syntheticPayload() {
  const bytes = new Uint8Array(224092).fill(32);
  bytes.set(new TextEncoder().encode('var v=17;'), 181647);
  bytes.set(new TextEncoder().encode(`var k=[${Array.from({ length: 20 }, (_, i) => i).join(',')}];`), 181670);
  return bytes;
}

function harness(options = {}) {
  let time = 0, borrowed = false, sceneOwn = null, connected = false, reads = 0;
  let fetched = 0, aborts = 0, checks = 0, qualityCalls = 0;
  const trace = [], sockets = [], deferred = [], timers = new Map(), intervals = new Map();
  const errors = [], statuses = [], allocations = [], chunks = [], encoded = [];
  const reached = { fetch: defer(), read: defer(), digest: defer() };
  let h;
  const outside = () => assert.equal(borrowed, false, 'native borrow reentry');
  const payload = syntheticPayload();
  const profileCaps = Object.freeze({
    fetch(url, init) {
      fetched++; trace.push(['fetch', url, init]); reached.fetch.resolve();
      return options.fetch ? options.fetch(h) : Promise.resolve({});
    },
    digest(algorithm, source) {
      assert.equal(algorithm, 'SHA-256'); assert.deepEqual(source, payload); reached.digest.resolve();
      // Deliberate digest DOUBLE; the buffer is wholly authored, not the pinned source.
      return options.digest ? options.digest(h) : Promise.resolve(Uint8Array.from(HASH.match(/../g), x => Number.parseInt(x, 16)));
    },
    createAbort() { trace.push(['abort-controller']); return Object.freeze({ signal: {}, abort() { aborts++; } }); },
    setTimeout(callback, delay) { assert.ok(delay > 0 && delay <= 5000); timers.set(1, callback); return 1; },
    clearTimeout(id) { timers.delete(id); },
    now: () => time,
    environment: () => Object.freeze({ origin: 'https://slither.io', topLevel: true, secureContext: true }),
    responseInfo: () => Object.freeze({ status: 200, type: 'basic', url: 'https://slither.io/s/game1107249518.js', redirected: false, body: {} }),
    getReader: () => ({}),
    read() {
      reads++; reached.read.resolve();
      if (options.read) return options.read(h, reads);
      if (reads > 1) return Promise.resolve({ done: true, value: undefined });
      const chunk = payload.slice(); chunks.push(chunk);
      return Promise.resolve({ done: false, value: chunk });
    },
    cancelReader: () => Promise.resolve(), releaseReader() {},
    bytes: Object.freeze({
      allocate(n) { const value = new Uint8Array(n); allocations.push(value); return value; },
      length(value) {
        if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer) throw new TypeError('Synthetic ordinary bytes required');
        return value.length;
      },
      copy: (target, value, offset) => target.set(value, offset),
      clear(value) { options.onClear?.(h, value); value.fill(0); },
    }),
  });
  const scene = {
    control_view() { outside(); trace.push(['view']); return { own: sceneOwn, camera: { x: 100, y: 200 }, follows: true, zoom: 0.5, connected }; },
    set_connected(value) { outside(); connected = value; trace.push(['connected', value]); },
    reset_lag() { outside(); trace.push(['reset-lag']); },
  };
  const quality = { begin_connection() { outside(); qualityCalls++; trace.push(['quality']); options.onQuality?.(h); } };
  const controller = {
    packet(bytes, elapsed) { outside(); assert.equal(elapsed, false); trace.push(['packet', [...bytes]]); },
    frame(nowMs, config) {
      outside(); trace.push(['frame', nowMs]);
      const control = scene.control_view();
      borrowed = true;
      let actions;
      try {
        actions = config.control({ nowMs, wholeSteps: 1, delta: 1, control });
        if (actions.resetWorld) { sceneOwn = null; connected = false; }
        if (actions.connected !== undefined) connected = actions.connected;
        trace.push(['motion', actions]);
      } finally { borrowed = false; }
      trace.push(['end-operation']); options.afterFrame?.(h);
      if (options.frameFailure) throw options.frameFailure;
      return actions;
    },
  };
  const wasm = {
    ProfileLiteralParser: options.literalParser ?? ProfileLiteralParser,
    encode_login(version, password, nickname, skin, custom) {
      encoded.push({ version, password: [...password], nickname, skin, custom: [...custom] });
      options.onEncode?.(h);
      if (!/^[\x20-\x7f]{0,24}$/.test(nickname) || skin < 0 || skin > 255 || custom.length > 255) throw new Error('Synthetic semantic rejection');
      return Uint8Array.from([115, 30, version >> 8, version & 255, ...password, skin, nickname.length,
        ...new TextEncoder().encode(nickname), 0, 255, ...custom]);
    },
    solve_challenge: () => new Uint8Array(27), setup_protocol_version: () => 19,
    decode_frame(bytes) { return Uint8Array.from([0, 0, 0, bytes.length, ...bytes]); },
  };
  const args = { scene, controller, quality, wasm,
    createSocket(endpoint) {
      outside(); trace.push(['construct', endpoint]);
      const socket = { readyState: 0, bufferedAmount: 0, sent: [], closes: 0,
        send(bytes) { this.sent.push([...bytes]); }, close() { this.closes++; this.readyState = 3; },
        open() { this.readyState = 1; this.onopen?.(); },
        message(bytes) { this.onmessage?.({ data: Uint8Array.from(bytes).buffer }); },
      };
      sockets.push(socket); return socket;
    },
    now: () => time,
    defer(callback) { deferred.push(callback); },
    setInterval(callback, delay) { outside(); assert.equal(delay, 25); intervals.set(1, callback); return 1; },
    clearInterval(id) { outside(); intervals.delete(id); },
    onStatus(value) { outside(); statuses.push(value); options.onStatus?.(h, value); },
    onFatal(error) { outside(); errors.push(error); },
  };
  if (options.available !== false) args.liveProfile = { capabilities: profileCaps, isCurrentDocument() {
    checks++; return options.check ? options.check(h, checks) : true;
  } };
  const gameplay = createStockGameplay(args);
  h = { gameplay, trace, sockets, errors, statuses, allocations, chunks, encoded, timers, intervals, reached,
    flush() { for (let i = 0; deferred.length; i++) { assert.ok(i < 100); deferred.shift()(); } },
    tick(value) { time = value; return gameplay.frame(value); },
    event(type, data = {}) { return gameplay.event({ type, ...data }, { width: 960, height: 540 }); },
    setOwn(value) { sceneOwn = value; },
    get counts() { return { fetched, reads, aborts, checks, qualityCalls }; },
    assertWiped() { for (const value of [...allocations, ...chunks]) assert.equal(allZero(value), true); },
  };
  return h;
}

test('optional absence keeps external route and has no startup acquisition work', async () => {
  const h = harness({ available: false });
  assert.equal(h.counts.fetched, 0); assert.equal(h.allocations.length, 0);
  await assert.rejects(h.gameplay.playWithLiveProfile(request()), e => e.code === 'unavailable');
  assert.equal(h.counts.fetched, 0); assert.equal(h.allocations.length, 0);
  h.gameplay.play(externalRequest()); h.tick(8);
  assert.equal(h.sockets.length, 1); assert.equal(h.counts.qualityCalls, 1);
});

test('actual acquirer success keeps stage locked through full resolution, then one native reset/commit constructs socket', async () => {
  let staged = 0;
  const h = harness({ check(h) {
    if (h.gameplay.diagnostics().session.phase === 'opening' && h.gameplay.diagnostics().profilePhase === 'acquiring') {
      staged++;
      const frames = h.trace.filter(x => x[0] === 'frame').length;
      assert.equal(h.tick(8), undefined); h.flush();
      assert.equal(h.trace.filter(x => x[0] === 'frame').length, frames);
      assert.equal(h.sockets.length, 0); assert.ok(h.counts.qualityCalls <= 1);
      if (h.counts.qualityCalls === 1) {
        for (const value of h.allocations.filter(bytes => bytes.length === 20 || bytes.length === 224092)) {
          assert.equal(allZero(value), true, 'acquirer source/password clear before quality');
        }
      }
    }
    return true;
  } });
  assert.equal(h.counts.fetched, 0); assert.equal(h.allocations.length, 0);
  await h.gameplay.playWithLiveProfile(request());
  assert.ok(staged >= 1); assert.equal(h.gameplay.diagnostics().profilePhase, 'ready');
  assert.equal(h.sockets.length, 0); assert.equal(h.counts.qualityCalls, 1);
  assert.deepEqual(h.encoded[0].password, Array.from({ length: 20 }, (_, i) => i));
  h.assertWiped();
  h.tick(16); assert.equal(h.sockets.length, 1);
  assert.ok(h.trace.findLastIndex(x => x[0] === 'end-operation') < h.trace.findIndex(x => x[0] === 'construct'));
  assert.equal(h.counts.fetched, 1); h.gameplay.dispose(); assert.equal(h.sockets[0].closes, 1);
});

test('socket commit ends acquisition checks while connected frames and disposal retain session ownership', async () => {
  let current = true;
  const h = harness({ check: () => current });
  await h.gameplay.playWithLiveProfile(request());
  h.tick(8);
  const checks = h.counts.checks;
  const socket = h.sockets[0];
  socket.open(); socket.message([54, 1]); socket.message([97]); h.flush(); h.setOwn(own());
  assert.equal(h.gameplay.diagnostics().session.connected, true);
  current = false;
  h.tick(16); h.tick(24); h.flush();
  assert.equal(h.gameplay.diagnostics().profilePhase, 'committed');
  assert.equal(h.counts.checks, checks, 'established sessions do not revisit acquisition readiness');
  assert.equal(h.gameplay.diagnostics().session.connected, true);
  assert.equal(h.sockets.length, 1); assert.equal(socket.closes, 0);
  await assert.rejects(h.gameplay.playWithLiveProfile(request()), e => e.code === 'already-attempted');
  assert.equal(h.counts.fetched, 1);
  h.gameplay.dispose(); h.gameplay.dispose();
  assert.equal(socket.closes, 1); h.assertWiped();
});

test('pending frames have no side effects; duplicate/live/external calls cannot allocate another acquirer', async () => {
  const pending = defer(); const h = harness({ fetch: () => pending.promise });
  const operation = h.gameplay.playWithLiveProfile(request()); await h.reached.fetch.promise;
  const allocated = h.allocations.length;
  assert.equal(h.tick(1), undefined); assert.equal(h.tick(2), undefined); h.flush();
  assert.equal(h.trace.some(x => ['frame', 'quality', 'motion', 'connected', 'reset-lag'].includes(x[0])), false);
  await assert.rejects(h.gameplay.playWithLiveProfile(request()), e => e.code === 'already-attempted');
  assert.throws(() => h.gameplay.play(externalRequest()), e => e.code === 'acquiring');
  assert.equal(h.allocations.length, allocated); assert.equal(h.counts.fetched, 1);
  pending.resolve({}); await operation; assert.equal(h.sockets.length, 0);
});

test('preflight snapshots endpoint/login bytes and rejects malformed shape without fetch or attempt', async () => {
  for (const make of [() => ({ ...request(), endpoint: 'ws://example.com:1234/slither' }),
    () => ({ ...request(), nickname: 3 }), () => ({ ...request(), skin: 0.5 }),
    () => ({ ...request(), customSkin: new Uint16Array(1) }),
    () => ({ ...request(), customSkin: new Uint8Array(256) }),
    () => ({ ...request(), profile: externalRequest().profile })]) {
    const h = harness(); await assert.rejects(h.gameplay.playWithLiveProfile(make()));
    assert.equal(h.counts.fetched, 0); assert.equal(h.counts.qualityCalls, 0);
    assert.equal(h.gameplay.diagnostics().profilePhase, 'idle');
    h.gameplay.play(externalRequest()); h.tick(8); assert.equal(h.sockets.length, 1);
  }
  const pending = defer(); const h = harness({ fetch: () => pending.promise }); const intent = request();
  const original = [...intent.customSkin]; const operation = h.gameplay.playWithLiveProfile(intent);
  intent.endpoint = 'ws://192.0.2.99:9999/slither'; intent.nickname = 'Changed'; intent.skin = 99; intent.customSkin.fill(9);
  pending.resolve({}); await operation; h.tick(8);
  assert.equal(h.sockets.length, 1); assert.equal(h.trace.find(x => x[0] === 'construct')[1], request().endpoint);
  assert.deepEqual(h.encoded[0].custom, original); assert.equal(h.encoded[0].nickname, request().nickname);
  assert.equal(h.encoded[0].skin, request().skin);
});

test('held keys/boost release and pointer changes during await remain current without sends/steps', async () => {
  const pending = defer(); const h = harness({ fetch: () => pending.promise }); h.setOwn(own());
  h.event('keydown', { code: 'ArrowLeft' }); h.event('keydown', { code: 'Space' });
  assert.equal(h.gameplay.diagnostics().input.leftHeld, true); assert.equal(h.gameplay.diagnostics().input.boostKeyHeld, true);
  const operation = h.gameplay.playWithLiveProfile(request());
  h.event('keyup', { code: 'ArrowLeft' }); h.event('keyup', { code: 'Space' });
  h.event('pointermove', { clientX: 580, clientY: 370 }); h.tick(8); h.flush();
  const waiting = h.gameplay.diagnostics().input;
  assert.equal(waiting.leftHeld, false); assert.equal(waiting.boostKeyHeld, false);
  assert.equal(waiting.own.requestedBoost, false); assert.deepEqual(waiting.pointer, { x: 100, y: 100 });
  assert.equal(h.trace.some(x => ['frame', 'motion', 'quality'].includes(x[0])), false);
  pending.resolve({}); await operation; h.tick(16);
  assert.equal(h.gameplay.diagnostics().input.leftHeld, false);
  assert.deepEqual(h.gameplay.diagnostics().input.pointer, { x: 100, y: 100 });
  const socket = h.sockets[0]; socket.open(); socket.message([54, 1]); socket.message([97]); h.flush(); h.setOwn(own());
  h.tick(300);
  assert.equal(socket.sent.some(x => x[0] === 252 || x[0] === 253), false, 'no stale arrow or boost desire after Play');
});

test('post-consumer stale rejection closes staged session before any pending RAF can construct', async () => {
  let postStage = false;
  const h = harness({ check(h) {
    if (h.gameplay.diagnostics().session.phase === 'opening') {
      postStage = true; assert.equal(h.tick(12), undefined); h.flush(); return false;
    }
    return true;
  } });
  await assert.rejects(h.gameplay.playWithLiveProfile(request()));
  assert.equal(postStage, true); assert.equal(h.encoded.length, 1);
  assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
  assert.equal(h.sockets.length, 0); assert.equal(h.counts.qualityCalls, 0); h.assertWiped();
  assert.throws(() => h.tick(16), /stopped/); h.flush(); assert.equal(h.sockets.length, 0);
  await assert.rejects(h.gameplay.playWithLiveProfile(request()));
  assert.equal(h.counts.fetched, 1);
});

test('post-stage acquirer cleanup rejection never unlocks native/reset/commit', async () => {
  let failed = false;
  const h = harness({ onClear(h, value) {
    if (!failed && value.length === 20 && h.gameplay.diagnostics().session.phase === 'opening') {
      failed = true; throw new Error('Synthetic native cleanup failure');
    }
  } });
  await assert.rejects(h.gameplay.playWithLiveProfile(request()), e => e.code === 'cleanup-failed');
  assert.equal(h.encoded.length, 1); assert.equal(h.sockets.length, 0);
  assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
  h.flush(); assert.throws(() => h.tick(16), /stopped/); assert.equal(h.counts.qualityCalls, 0);
});

test('dispose during fetch/digest and after stage aborts and suppresses late completion', async () => {
  for (const phase of ['fetch', 'digest']) {
    const pending = defer(); const h = harness({ [phase]: () => pending.promise });
    const operation = h.gameplay.playWithLiveProfile(request()); await h.reached[phase].promise;
    h.gameplay.dispose(); await assert.rejects(operation);
    if (phase === 'fetch') pending.resolve({});
    else pending.resolve(Uint8Array.from(HASH.match(/../g), x => Number.parseInt(x, 16)));
    await nextTurn(); assert.equal(h.sockets.length, 0); assert.equal(h.counts.qualityCalls, 0);
    assert.equal(h.gameplay.diagnostics().disposed, true); h.assertWiped();
  }
  const h = harness({ check(h) {
    if (h.gameplay.diagnostics().session.phase === 'opening') h.gameplay.dispose();
    return true;
  } });
  await assert.rejects(h.gameplay.playWithLiveProfile(request()));
  assert.equal(h.sockets.length, 0); assert.equal(h.gameplay.diagnostics().disposed, true); h.assertWiped();
});

test('quality failure after full acquisition cancels stage before unlock', async () => {
  const sentinel = new Error('Synthetic quality failure');
  const h = harness({ onQuality(h) { assert.equal(h.tick(12), undefined); throw sentinel; } });
  await assert.rejects(h.gameplay.playWithLiveProfile(request()), e => e === sentinel);
  assert.equal(h.sockets.length, 0); assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
  h.flush(); assert.equal(h.errors[0], sentinel); h.assertWiped();
});

test('readiness loss after full controller operation but before commit cancels without socket', async () => {
  let valid = true;
  const h = harness({ check: () => valid, afterFrame() { valid = false; } });
  await h.gameplay.playWithLiveProfile(request());
  assert.throws(() => h.tick(8), e => e.code === 'stale-intent');
  assert.equal(h.trace.some(x => x[0] === 'end-operation'), true);
  assert.equal(h.sockets.length, 0); assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
  h.flush(); assert.equal(h.sockets.length, 0);
});

test('live-profile DEL nickname stages unchanged before the ordinary socket commit', async () => {
  const h = harness(), nickname = '\u007f'.repeat(24);
  await h.gameplay.playWithLiveProfile({ ...request(), nickname });
  assert.equal(h.encoded[0].nickname, nickname);
  assert.equal(h.sockets.length, 0);
  h.tick(8);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.counts.fetched, 1);
  h.gameplay.dispose(); h.flush(); h.assertWiped();
});

test('acquirer failure and semantic staging rejection consume one attempt without silent external fallback', async () => {
  const h = harness({ digest: () => new Uint8Array(32) });
  await assert.rejects(h.gameplay.playWithLiveProfile(request()), e => e.code === 'hash-mismatch');
  assert.throws(() => h.gameplay.play(externalRequest()), /stopped/); h.flush();
  assert.equal(h.counts.fetched, 1); assert.equal(h.sockets.length, 0); h.assertWiped();
  const bad = harness();
  await assert.rejects(bad.gameplay.playWithLiveProfile({ ...request(), nickname: '\u0080' }), e => e.code === 'consumer-failed');
  assert.equal(bad.counts.fetched, 1); assert.equal(bad.sockets.length, 0); assert.equal(bad.counts.qualityCalls, 0);
});

test('external Play first prevents profile allocation and checker reentry cannot run events/native work', async () => {
  const h = harness(); h.gameplay.play(externalRequest());
  await assert.rejects(h.gameplay.playWithLiveProfile(request()), e => e.code === 'already-attempted');
  assert.equal(h.counts.fetched, 0); assert.equal(h.allocations.length, 0); h.tick(8); assert.equal(h.sockets.length, 1);
  const p = harness({ check(h) {
    assert.throws(() => h.event('keydown', { code: 'ArrowLeft' }), /reentrant/);
    assert.throws(() => h.gameplay.play(externalRequest()), /reentrant/);
    assert.equal(h.tick(7), undefined);
    return true;
  } });
  await p.gameplay.playWithLiveProfile(request());
  assert.equal(p.gameplay.diagnostics().input.leftHeld, false);
  assert.equal(p.trace.some(x => x[0] === 'frame'), false); assert.equal(p.sockets.length, 0);
});

test('acquisition started by reconciliation notification locks that same frame before native work', async () => {
  const pending = defer(); let operation;
  const h = harness({ fetch: () => pending.promise, onStatus(h) {
    if (!operation) { operation = h.gameplay.playWithLiveProfile(request()); operation.catch(() => {}); }
  } });
  assert.equal(h.tick(1), undefined);
  assert.equal(h.trace.some(event => event[0] === 'frame'), false);
  assert.equal(h.sockets.length, 0);
  pending.resolve({}); await operation;
  h.tick(8); assert.equal(h.sockets.length, 1);
});

test('dispose after staging still closes pending launch when owned intent clear throws', async () => {
  const cleanupFailure = { syntheticCleanup: true };
  let observedPhase, disposedOnce = false, caught;
  const h = harness({
    onClear(h, value) { if (disposedOnce && value.length === 3) throw cleanupFailure; },
    check(h) {
      if (!disposedOnce && h.gameplay.diagnostics().session.phase === 'opening') {
        disposedOnce = true;
        try { h.gameplay.dispose(); } catch (error) { caught = error; }
        observedPhase = h.gameplay.diagnostics().session.phase;
      }
      return true;
    },
  });
  await assert.rejects(h.gameplay.playWithLiveProfile(request()));
  assert.equal(caught, cleanupFailure);
  assert.equal(observedPhase, 'disconnected', 'dispose must synchronously close and wipe the pending login stage');
  assert.equal(h.gameplay.diagnostics().disposed, true); assert.equal(h.sockets.length, 0);
  assert.throws(() => h.tick(8), /stopped/);
});

test('secondary intent cleanup errors do not mask object or undefined primary acquisition failures', async () => {
  for (const primary of [{ syntheticPrimary: true }, undefined]) {
    const cleanupFailure = { syntheticCleanup: true };
    const h = harness({ onQuality() { throw primary; },
      onClear(h, value) { if (value.length === 3) throw cleanupFailure; } });
    let rejected = false, actual;
    await h.gameplay.playWithLiveProfile(request()).then(() => assert.fail('unexpected success'), error => {
      rejected = true; actual = error;
    });
    assert.equal(rejected, true); assert.equal(actual, primary);
    assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
    assert.equal(h.sockets.length, 0); assert.equal(h.gameplay.diagnostics().profilePhase, 'failed');
    h.flush(); assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary);
    assert.throws(() => h.tick(8), /stopped/);
  }
});
