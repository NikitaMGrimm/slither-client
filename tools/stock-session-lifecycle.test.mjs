// Authored synthetic fixtures and structural Wasm/socket doubles only. No native or network execution.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockSession } from '../web/stock-session.mjs';

const setup = [97, ...new Array(22).fill(0), 19, 42];
const request = () => ({ endpoint: 'ws://192.0.2.9:1234/slither',
  profile: { clientVersion: 7, password: new Uint8Array(20).fill(3), protocolVersion: 19 },
  nickname: 'Authored lifecycle', skin: 2, customSkin: new Uint8Array() });
const stepRequest = (nowMs = 1000, delta = 1, wholeSteps = 1) => ({ nowMs, delta, wholeSteps });
function frame(commands) {
  if (commands.length === 1) return Uint8Array.from(commands[0]).buffer;
  return Uint8Array.from(commands.flatMap((c, i) => i === 0
    ? [c.length >> 8, c.length & 255, ...c] : [c.length + 32, ...c])).buffer;
}
function decode(bytes) {
  if (!bytes.length) throw new Error('Empty synthetic frame');
  if (bytes[0] >= 32) return [[...bytes]];
  const commands = [];
  for (let i = 0; i < bytes.length;) {
    const prefix = bytes[i++];
    const length = prefix < 32 ? prefix * 256 + bytes[i++] : prefix - 32;
    if (!length || length > bytes.length - i) throw new Error('Truncated synthetic frame');
    commands.push([...bytes.slice(i, i + length)]); i += length;
  }
  if (commands.length > 4096) throw new Error('Synthetic command bound');
  return commands;
}
const scoreView = () => ({ schema: 1, enabled: true, tableMax: 17,
  own: { token: 1n, id: 0, logicalSegments: 4, fractionalMass: 0.25, scoreAdjustment: 3, scoreIndex: 7 },
  status: 'ready', score: 17, error: null });
function reportFor(commands, plan) {
  const events = [];
  let setupDraws = 0;
  commands.forEach((c, commandIndex) => {
    if (c[0] === 97) {
      setupDraws++;
      events.push({ commandIndex, kind: 'setup', tableMax: 17 },
        { commandIndex, kind: 'setup-draw', view: { ...scoreView(), own: null, status: 'no-own', score: null } });
    } else if (plan.finalCaptureIndices.includes(commandIndex)) {
      events.push({ commandIndex, kind: 'final-score', view: scoreView() });
    }
  });
  return { schema: 1, commandCount: commands.length, setupDraws, events };
}
function frozen(value) {
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child);
}
function lifecycle(value, deathPending, returnActive, returnCompleted, returnFraction) {
  assert.deepEqual(value, { schema: 1, deathPending, returnActive, returnCompleted, returnFraction });
}
function thrown(callback) {
  let caught = false, value;
  try { callback(); } catch (error) { caught = true; value = error; }
  assert.equal(caught, true, 'Expected a throw, including a falsy thrown value');
  return value;
}
function harness({ hud = true, observe = hud, subscribe = true } = {}) {
  let clock = 1000, reads = 0, decodes = 0;
  const hooks = {}, sockets = [], trace = [], states = [], errors = [], packets = [];
  const session = createStockSession({ now() { reads++; return clock; },
    wasm: {
      encode_login() { return Uint8Array.of(115, 1, 2); },
      solve_challenge() { return new Uint8Array(27).fill(65); },
      decode_frame(bytes, elapsed) {
        decodes++; assert.equal(elapsed, false);
        return Uint8Array.from(decode(bytes).flatMap(c => [0, 0, c.length >> 8, c.length & 255, ...c]));
      },
      setup_protocol_version(c) { assert.equal(c.length, 25); return c[23]; },
    },
    createSocket(endpoint) {
      trace.push(['construct', endpoint]);
      hooks.construct?.();
      const socket = { readyState: 0, bufferedAmount: 0, closes: 0, sent: [],
        send(bytes) { trace.push(['send', [...bytes]]); hooks.send?.(); this.sent.push([...bytes]); },
        close() { this.closes++; trace.push(['close']); this.readyState = 3; hooks.close?.(); },
        open() { this.readyState = 1; this.onopen?.(); },
        message(...commands) { this.onmessage?.({ data: frame(commands) }); },
      };
      sockets.push(socket); return socket;
    },
  });
  const subscriber = {
    packet(bytes, elapsed, plan) {
      trace.push(['packet', [...bytes], elapsed]); packets.push([...bytes]);
      hooks.packet?.();
      return hud ? reportFor(decode(bytes), plan) : undefined;
    },
    hud() { return hooks.hud?.(); },
    state(state) { trace.push(['state', state]); states.push(state); hooks.state?.(); },
    error(error) { trace.push(['error', error]); errors.push(error); hooks.error?.(); },
  };
  function select() {
    if (hud) return session.subscribeWithHud(subscriber);
    const { hud: unused, ...legacy } = subscriber; void unused;
    return session.subscribe(legacy);
  }
  const unsubscribe = subscribe ? select() : undefined;
  const step = value => observe ? session.afterStepWithHud(value) : session.afterStep(value);
  function connect() {
    session.play(request()); step(stepRequest()); session.commitControl();
    sockets[0].open(); sockets[0].message([54, 65]); sockets[0].message(setup);
  }
  return { session, hooks, sockets, trace, states, errors, packets, step, connect, select, unsubscribe,
    setTime(value) { clock = value; }, counters() { return { reads, decodes }; } };
}
// The same operations exercise legacy subscription, HUD subscription with the legacy facade,
// and HUD subscription with the new facade. Only the last receives lifecycle metadata.
function paired() {
  const all = [harness({ hud: false, observe: false }), harness({ observe: false }), harness()];
  const verify = () => {
    const inspect = h => ({ snapshot: h.session.snapshot(), offered: h.session.pendingActions(),
      trace: h.trace, states: h.states, errors: h.errors, packets: h.packets, counters: h.counters(),
      sockets: h.sockets.map(s => ({ readyState: s.readyState, closes: s.closes, sent: s.sent, binaryType: s.binaryType })) });
    assert.deepEqual(inspect(all[1]), inspect(all[0]));
    assert.deepEqual(inspect(all[2]), inspect(all[0]));
  };
  const each = callback => { const result = all.map(callback); verify(); return result; };
  const call = (name, ...args) => each(h => h.session[name](...args));
  function step(nowMs = 1000, delta = 1, wholeSteps = 1) {
    const counters = all.map(h => h.counters());
    const results = each(h => h.step(stepRequest(nowMs, delta, wholeSteps)));
    all.forEach((h, i) => assert.deepEqual(h.counters(), counters[i]));
    assert.deepEqual(results[0], results[1]); assert.deepEqual(results[2].actions, results[0]);
    assert.deepEqual(Object.keys(results[2]), ['actions', 'lifecycle']); frozen(results[2]);
    return results[2];
  }
  function connect() {
    call('play', request());
    assert.equal(all[0].sockets.length, 0);
    assert.deepEqual(step().actions, { resetWorld: true, connected: false });
    assert.equal(all[0].sockets.length, 0);
    call('commitControl'); each(h => h.sockets[0].open());
    message([54, 65]); message(setup);
  }
  const message = (...commands) => each(h => h.sockets[0].message(...commands));
  const tick = (...args) => { const result = step(...args); call('commitControl'); return result; };
  return { all, verify, each, call, step, tick, connect, message, setTime: ms => each(h => h.setTime(ms)) };
}

test('HUD facade rejects unselected and legacy modes before request reads or staged Play consumption', () => {
  for (const subscribe of [false, true]) {
    const h = harness({ hud: false, observe: false, subscribe });
    const before = h.session.snapshot(), offer = h.session.pendingActions();
    const tripwire = { get nowMs() { assert.fail('Mode rejection must precede request reads'); } };
    assert.throws(() => h.session.afterStepWithHud(tripwire), /HUD subscription/);
    assert.deepEqual(h.session.snapshot(), before);
    assert.deepEqual(h.session.pendingActions(), offer);
    if (!subscribe) h.select();
    h.session.play(request());
    assert.throws(() => h.session.afterStepWithHud(tripwire), /HUD subscription/);
    h.session.commitControl(); assert.equal(h.sockets.length, 0);
    assert.deepEqual(h.step(stepRequest()), { resetWorld: true, connected: false });
    h.session.commitControl(); assert.equal(h.sockets.length, 1);
  }
});

test('ready HUD facade is deeply frozen, consumes one step and does not implicitly activate resources', () => {
  const h = harness({ subscribe: false });
  assert.throws(() => h.session.afterStepWithHud(stepRequest()), /HUD subscription/);
  h.select(); const before = h.session.snapshot();
  const result = h.step(stepRequest());
  assert.deepEqual(result.actions, {}); lifecycle(result.lifecycle, false, false, false, 0); frozen(result);
  assert.deepEqual(h.session.snapshot(), before); assert.deepEqual(h.counters(), { reads: 0, decodes: 0 });
  assert.throws(() => { result.lifecycle.deathPending = true; }, TypeError);
  assert.throws(() => { result.actions.resetWorld = true; }, TypeError);
  assert.throws(() => h.session.afterStep(stepRequest()), /not committed/);
  h.session.commitControl(); assert.deepEqual(h.session.afterStep(stepRequest()), {});
  assert.throws(() => h.step(stepRequest()), /not committed/);
  h.session.commitControl(); assert.equal(h.sockets.length, 0);
  h.session.play(request());
  assert.deepEqual(h.step(stepRequest()).actions, { resetWorld: true, connected: false });
  assert.equal(h.sockets.length, 0); h.session.commitControl(); assert.equal(h.sockets.length, 1);
});

test('staged Play reset and control revision race retain exact socket construction gates', () => {
  const p = paired(); p.call('play', request()); p.call('commitControl');
  assert.equal(p.all[0].sockets.length, 0);
  const reset = p.step(); lifecycle(reset.lifecycle, false, false, false, 0);
  assert.deepEqual(reset.actions, { resetWorld: true, connected: false });
  p.call('close', 'cancelled'); p.call('commitControl');
  assert.equal(p.all[0].sockets.length, 0);
  assert.deepEqual(p.all[0].session.pendingActions().actions, { resetWorld: true, connected: false });
  p.tick(); assert.deepEqual(p.all[0].session.pendingActions().actions, {});
});

for (const value of [0, 1, 2, 255]) {
  test(`strict death gate, zero delta, completion and next step preserve v${value} actions and lifecycle`, () => {
    const p = paired(); p.connect(); p.call('uiTick', 1500); p.setTime(1600); p.message([118, value]);
    if (value === 2) {
      const result = p.step(1600, 0, 0);
      lifecycle(result.lifecycle, false, false, false, 1);
      assert.deepEqual(result.actions, { resetWorld: true, connected: false });
      assert.equal(p.all[0].sockets[0].closes, 1);
      p.call('commitControl'); lifecycle(p.tick(6000).lifecycle, false, false, false, 1);
      return;
    }
    const offers = p.all.map(h => h.session.pendingActions());
    p.each((h, i) => h.session.acknowledgeActions(offers[i]));
    lifecycle(p.tick(3200, 5, 5).lifecycle, true, false, false, 1);
    lifecycle(p.tick(3201, 0, 0).lifecycle, true, true, false, 1);
    let fraction = 1;
    for (let i = 0; i < 49; i++) {
      fraction -= 0.004 * 5;
      const result = p.tick(3202 + i, 5, 5);
      lifecycle(result.lifecycle, true, true, false, fraction); assert.deepEqual(result.actions, {});
    }
    const complete = p.step(6000, 5, 5);
    lifecycle(complete.lifecycle, false, true, true, 0);
    assert.deepEqual(complete.actions, value === 1 ? {} : { resetWorld: true, connected: false });
    assert.equal(p.all[0].session.snapshot().connected, value === 1);
    assert.equal(p.all[0].session.snapshot().playing, false);
    assert.equal(p.all[0].sockets[0].closes, value === 1 ? 0 : 1);
    p.each(h => assert.throws(() => h.step(stepRequest()), /not committed/));
    p.call('commitControl'); lifecycle(p.tick(6001, 5, 5).lifecycle, false, false, false, 0);
    if (value === 1) {
      p.message([118, 2]); assert.equal(p.all[0].sockets[0].closes, 0);
      const close = p.tick(6002); lifecycle(close.lifecycle, false, false, false, 0);
      assert.deepEqual(close.actions, { resetWorld: true, connected: false });
    }
  });
}

test('incoming 25ms fade delays return despite old death', () => {
  const p = paired(); p.connect(); p.call('uiTick', 1025);
  p.setTime(1100); p.message([118, 0]);
  lifecycle(p.tick(5000, 5, 5).lifecycle, true, false, false, 0.05);
  p.call('uiTick', 1050); lifecycle(p.tick(5001, 0, 0).lifecycle, true, false, false, 0.1);
  p.call('uiTick', 6000); lifecycle(p.tick(6001, 5, 5).lifecycle, true, true, false, 0.98);
});

test('zero delta completes a zero fraction only inside the actual subtraction branch', () => {
  const p = paired(); p.connect(); p.message([118, 1]); p.call('close', 'authored transport stop');
  // stop preserves death and fraction but ends the incoming UI timer.
  lifecycle(p.tick(2600, 0, 0).lifecycle, true, false, false, 0);
  lifecycle(p.tick(2601, 0, 0).lifecycle, false, true, true, 0);
  lifecycle(p.tick(2602, 0, 0).lifecycle, false, false, false, 0);
});

for (const value of [0, 1]) {
  test(`v${value}/v2 deferred close remains active only in the subtraction branch`, () => {
    const p = paired(); p.connect(); p.call('uiTick', 1500); p.setTime(1600);
    p.message([118, value], [118, 2]);
    lifecycle(p.tick(1601).lifecycle, true, false, false, 1);
    assert.equal(p.all[0].sockets[0].closes, 0);
    let result;
    for (let i = 0; i < 50; i++) result = p.tick(3300 + i, 5, 5);
    lifecycle(result.lifecycle, false, true, true, 0);
    assert.deepEqual(result.actions, { resetWorld: true, connected: false });
    assert.equal(p.all[0].sockets[0].closes, 1);
  });
}

test('Setup during an active pending death restarts incoming UI without clearing actual death state', () => {
  const p = paired(); p.connect(); p.call('uiTick', 1500); p.setTime(1600); p.message([118, 1]);
  lifecycle(p.tick(3201, 5, 5).lifecycle, true, true, false, 0.98);
  p.setTime(3300); p.message(setup);
  assert.equal(p.all[0].session.snapshot().phase, 'playing');
  lifecycle(p.tick(5000, 5, 5).lifecycle, true, false, false, 0.98);
  p.call('uiTick', 3325); lifecycle(p.tick(5001, 0, 0).lifecycle, true, true, false, 1);
  assert.equal(p.all[0].session.snapshot().lifeEnded, true);
});

test('repeated life actions preserve revisions, stale acknowledgements and uncommitted step races', () => {
  const p = paired(); p.connect(); p.call('uiTick', 1500); p.message([118, 1]);
  const offers = p.each(h => h.session.pendingActions());
  p.message([118, 1], [118, 1]);
  p.each((h, i) => assert.throws(() => h.session.acknowledgeActions(offers[i]), /Stale/));
  assert.equal(p.all[0].session.pendingActions().revision, offers[0].revision + 2);
  assert.deepEqual(p.step().actions, { resetLag: true });
  p.message([118, 1]); p.call('commitControl');
  assert.deepEqual(p.all[0].session.pendingActions().actions, { resetLag: true });
  const fresh = p.all.map(h => h.session.pendingActions());
  p.each((h, i) => h.session.acknowledgeActions(fresh[i]));
  p.tick(); assert.deepEqual(p.all[0].session.pendingActions().actions, {});
});

test('repeated v in outgoing return restarts the strict age gate while retaining its actual fraction', () => {
  const p = paired(); p.connect(); p.call('uiTick', 1500); p.message([118, 1]);
  lifecycle(p.tick(2601, 5, 5).lifecycle, true, true, false, 0.98);
  p.setTime(3000); p.message([118, 1], [118, 1]);
  lifecycle(p.tick(4600, 5, 5).lifecycle, true, false, false, 0.98);
  lifecycle(p.tick(4601, 0, 0).lifecycle, true, true, false, 0.98);
});

test('ping/lag/pong hooks keep strict boundaries and do not gain time reads or resets', () => {
  const p = paired(); p.connect();
  const ping = nowMs => p.each(h => h.session.betweenKeyboardAndBoost({ nowMs, protocolVersion: 19 }, h.session.sendInput));
  ping(250); assert.equal(p.all[0].sockets[0].sent.length, 4);
  ping(251); assert.deepEqual(p.all[0].sockets[0].sent.at(-1), [251]);
  p.call('beforeUpdate', 1001); assert.equal(p.all[0].session.snapshot().lagging, false);
  p.call('beforeUpdate', 1002); assert.equal(p.all[0].session.snapshot().lagging, true);
  lifecycle(p.tick(1002, 0, 0).lifecycle, false, false, false, 0);
  ping(5000); assert.equal(p.all[0].sockets[0].sent.length, 5);
  p.message([112]); assert.deepEqual(p.tick().actions, {});
  assert.equal(p.all[0].session.snapshot().lagging, false);
  ping(5001); assert.equal(p.all[0].sockets[0].sent.length, 6);
});

for (const [name, value] of [
  ['missing', undefined], ['null', null], ['nonfinite time', stepRequest(NaN)],
  ['time type', stepRequest('1')], ['nonfinite delta', stepRequest(1000, Infinity)],
  ['negative delta', stepRequest(1000, -1)], ['large delta', stepRequest(1000, 6)],
  ['fractional whole steps', stepRequest(1000, 1, 0.5)], ['large whole steps', stepRequest(1000, 1, 6)],
]) {
  test(`invalid ${name} request leaves pending death/actions and step latch untouched`, () => {
    const p = paired(); p.connect(); p.call('uiTick', 1500); p.message([118, 0]);
    const before = p.all.map(h => ({ state: h.session.snapshot(), offer: h.session.pendingActions(), counters: h.counters() }));
    p.each((h, i) => {
      assert.throws(() => h.step(value));
      assert.deepEqual({ state: h.session.snapshot(), offer: h.session.pendingActions(), counters: h.counters() }, before[i]);
    });
    lifecycle(p.tick(2600, 0, 0).lifecycle, true, false, false, 1);
    lifecycle(p.tick(2601, 0, 0).lifecycle, true, true, false, 1);
  });
}

test('accepted inherited/accessor/extra fields and exact unusual scalar values retain legacy admission', () => {
  const p = paired(); p.connect();
  p.each(h => {
    let reads = 0;
    const value = Object.create({ get nowMs() { reads++; return -100; }, delta: -0, wholeSteps: -0 });
    value.unused = Symbol('authored extra');
    h.step(value); assert.equal(reads, 1); h.session.commitControl();
  });
  p.call('uiTick', 975); lifecycle(p.tick(-100, -0, -0).lifecycle, false, false, false, -0.05);
  const q = paired(); q.setTime(Number.MAX_VALUE); q.connect();
  q.call('uiTick', -Number.MAX_VALUE);
  lifecycle(q.tick(Number.MAX_VALUE, 0, 0).lifecycle, false, false, false, -Infinity);
  q.call('uiTick', Number.MAX_VALUE);
  lifecycle(q.tick(Number.MAX_VALUE, 0, 0).lifecycle, false, false, false, NaN);
});

test('pending-death request retains the original second time-property read and validation order', () => {
  const p = paired(); p.connect(); p.call('uiTick', 1500); p.message([118, 1]);
  p.each(h => {
    const reads = [];
    const result = h.step({
      get nowMs() { reads.push('nowMs'); return reads.length === 1 ? 2600 : 2601; },
      get delta() { reads.push('delta'); return 0; },
      get wholeSteps() { reads.push('wholeSteps'); return 0; },
    });
    assert.deepEqual(reads, ['nowMs', 'delta', 'wholeSteps', 'nowMs']);
    if (result.lifecycle) lifecycle(result.lifecycle, true, true, false, 1);
    h.session.commitControl();
  });
});

for (const place of ['packet', 'hud', 'state', 'error']) {
  test(`HUD facade rejects ${place} notification reentry without consuming a control step`, () => {
    const h = harness(); h.connect();
    let attempts = 0;
    h.hooks[place] = () => {
      attempts++;
      assert.throws(() => h.session.afterStepWithHud(stepRequest()), /Session reentry/);
      assert.throws(() => h.session.afterStep(stepRequest()), /Session reentry/);
    };
    if (place === 'error') h.hooks.packet = () => { throw false; };
    h.sockets[0].message(setup);
    assert.equal(attempts, 1);
    const result = h.step(stepRequest()); frozen(result);
    assert.equal(h.session.snapshot().phase, place === 'error' ? 'failed' : 'playing');
    h.session.commitControl();
  });
}

for (const primary of [undefined, null, false, 0, '', { authored: 'primary' }]) {
  test(`packet primary ${String(primary)} survives secondary cleanup and terminal lifecycle observation`, () => {
    const p = paired(); p.connect(); p.message([118, 1]);
    p.each(h => {
      h.hooks.packet = () => { throw primary; };
      h.hooks.close = () => { throw new Error('secondary close'); };
      h.hooks.state = () => { throw new Error('secondary state'); };
      h.hooks.error = () => { throw new Error('secondary error'); };
    });
    p.message([112]);
    p.each(h => { assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary); });
    const result = p.tick(); lifecycle(result.lifecycle, true, false, false, 0);
    assert.deepEqual(result.actions, { resetLag: true, resetWorld: true, connected: false });
    p.call('close'); assert.equal(p.all[0].sockets[0].closes, 1);
    lifecycle(p.tick(3000, 0, 0).lifecycle, false, true, true, 0);
  });
}

for (const primary of [undefined, null, false, 0, '']) {
  test(`life-return close failure ${String(primary)} preserves first failure and completed edge`, () => {
    const p = paired(); p.connect(); p.call('uiTick', 1500); p.message([118, 0]);
    p.each(h => {
      h.hooks.close = () => { throw primary; };
      h.hooks.state = () => { throw new Error('secondary state'); };
      h.hooks.error = () => { throw new Error('secondary error'); };
    });
    let result;
    for (let i = 0; i < 50; i++) result = p.tick(3000 + i, 5, 5);
    lifecycle(result.lifecycle, false, true, true, 0);
    p.each(h => { assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary); });
    assert.equal(p.all[0].sockets[0].closes, 1);
  });
}

for (const primary of [undefined, null, false, 0, '']) {
  test(`HUD observer primary ${String(primary)} retains death through terminal stop for either facade`, () => {
    const all = [harness({ observe: false }), harness()];
    for (const h of all) {
      h.connect(); h.hooks.hud = () => { throw primary; };
      h.hooks.close = () => { throw new Error('secondary close'); };
      h.hooks.error = () => { throw new Error('secondary error'); };
      h.sockets[0].message([118, 1]);
      assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary);
    }
    assert.deepEqual(all[0].session.snapshot(), all[1].session.snapshot());
    const actions = all[0].step(stepRequest()); const result = all[1].step(stepRequest());
    assert.deepEqual(result.actions, actions); lifecycle(result.lifecycle, true, false, false, 0);
    all.forEach(h => h.session.commitControl());
    assert.deepEqual(all[0].session.pendingActions(), all[1].session.pendingActions());
    lifecycle(all[1].step(stepRequest(2601, 0, 0)).lifecycle, false, true, true, 0);
    assert.equal(all[1].sockets[0].closes, 1);
  });
}

test('constructor failure remains original at commit, without extra time reads or a second construction', () => {
  for (const primary of [undefined, false, 0]) {
    const p = paired(); p.call('play', request()); p.step();
    p.each(h => { h.hooks.construct = () => { throw primary; }; });
    p.each(h => assert.equal(thrown(() => h.session.commitControl()), primary));
    assert.equal(p.all[0].session.snapshot().constructorAttempts, 1);
    p.call('commitControl'); p.tick();
    assert.equal(p.all[0].session.snapshot().constructorAttempts, 1);
  }
});

test('HUD mode selection persists after unsubscribe without adding another subscriber or callback', () => {
  const h = harness(); h.unsubscribe();
  const result = h.step(stepRequest()); lifecycle(result.lifecycle, false, false, false, 0);
  assert.throws(() => h.select(), /subscriber/); assert.throws(() => h.session.play(request()));
  h.session.commitControl(); assert.equal(h.sockets.length, 0); assert.equal(h.states.length, 0);
});
