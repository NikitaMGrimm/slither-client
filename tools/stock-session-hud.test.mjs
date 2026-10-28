// Original synthetic protocol fixtures and structural Wasm/socket doubles only.
// No native HUD export, score arithmetic, source acquisition or network is exercised.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { createStockSession } from '../web/stock-session.mjs';
import { createStockClient } from '../web/stock-client.mjs';
import { copyHudIngressPlan, copyHudIngressReport } from '../web/stock-hud-contract.mjs';

const setup = [97, ...new Array(22).fill(0), 19, 42];
const own = [115, 0, 1];
const leaderboard = [108, 2, 0, 17, 0, 33];
const v = value => [118, value];
const packed = commands => Uint8Array.from(commands.flatMap(c => [0, 0, c.length >> 8, c.length & 255, ...c]));
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
const request = () => ({ endpoint: 'ws://192.0.2.9:1234/slither',
  profile: { clientVersion: 7, password: new Uint8Array(20).fill(3), protocolVersion: 19 },
  nickname: 'Authored HUD', skin: 2, customSkin: new Uint8Array() });
const ready = (score = 17) => ({ schema: 1, enabled: true, tableMax: 17,
  own: { token: 1n, id: 0, logicalSegments: 4, fractionalMass: 0.25, scoreAdjustment: 3, scoreIndex: 7 },
  status: 'ready', score, error: null });
const noOwn = () => ({ ...ready(), own: null, status: 'no-own', score: null });
const planFor = (count = 1) => ({ schema: 1, commandCount: count,
  guards: Array.from({ length: count }, () => ({ playing: true, closeRequested: false, deathPending: false })),
  finalCaptureIndices: [] });
const reportFor = (commands, plan) => {
  const events = [];
  let setupDraws = 0;
  commands.forEach((c, commandIndex) => {
    if (c[0] === 97) {
      setupDraws++;
      events.push({ commandIndex, kind: 'setup', tableMax: 17 },
        { commandIndex, kind: 'setup-draw', view: noOwn() });
    } else if (c[0] === 108 && plan.guards[commandIndex].playing) {
      events.push({ commandIndex, kind: 'leaderboard', localRow: 2, rank: 17, population: 33,
        deathPending: plan.guards[commandIndex].deathPending });
    } else if (plan.finalCaptureIndices.includes(commandIndex)) {
      events.push({ commandIndex, kind: 'final-score', view: ready() });
    }
  });
  return { schema: plan.schema, commandCount: commands.length, setupDraws, events,
    ...(plan.schema === 2 ? { leaderboardRows: events.filter(e => e.kind === 'leaderboard')
      .map(e => ({ commandIndex: e.commandIndex, rows: [] })) } : {}) };
};
function assertFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertFrozen(value[key]);
}
function harness({ hud = true, rows = false, subscribe = true } = {}) {
  let clock = 1000, reads = 0, decodes = 0;
  const hooks = {}, sockets = [], calls = [], reports = [], states = [], errors = [], trace = [];
  const wasm = {
    encode_login() { return Uint8Array.of(115, 1, 2); },
    solve_challenge() { return new Uint8Array(27).fill(65); },
    decode_frame(bytes, elapsed) { decodes++; assert.equal(elapsed, false); return packed(decode(bytes)); },
    setup_protocol_version(c) { assert.equal(c.length, 25); return c[23]; },
  };
  const session = createStockSession({ wasm, now() { reads++; return clock; }, createSocket() {
    const socket = { readyState: 0, bufferedAmount: 0, closes: 0, sent: [],
      send(bytes) { this.sent.push([...bytes]); },
      close() { this.closes++; this.readyState = 3; hooks.close?.(); },
      open() { this.readyState = 1; this.onopen?.(); },
      message(...commands) { const buffer = frame(commands); this.onmessage?.({ data: buffer }); return buffer; },
    };
    sockets.push(socket); return socket;
  } });
  const subscriber = {
    packet(...args) {
      trace.push('packet');
      const [bytes, elapsed, plan] = args;
      calls.push({ bytes, elapsed, plan, argc: args.length, snapshot: session.snapshot() });
      if (hooks.packet) return hooks.packet(...args);
      return hud ? reportFor(decode(bytes), plan) : undefined;
    },
    hud(report) { trace.push('hud'); reports.push(report); return hooks.hud?.(report); },
    state(state) { trace.push('state'); states.push(state); hooks.state?.(state); },
    error(error) { trace.push('error'); errors.push(error); hooks.error?.(error); },
  };
  let unsubscribe;
  if (subscribe) {
    if (rows) unsubscribe = session.subscribeWithLeaderboardRows(subscriber);
    else if (hud) unsubscribe = session.subscribeWithHud(subscriber);
    else { const { hud: unused, ...legacy } = subscriber; void unused; unsubscribe = session.subscribe(legacy); }
  }
  const step = (nowMs = clock, delta = 1) => session.afterStep({ nowMs, delta, wholeSteps: 1 });
  function start() {
    session.play(request());
    assert.equal(sockets.length, 0);
    step(); session.commitControl();
    sockets[0].open(); sockets[0].message([54, 65]);
    assert.equal(session.snapshot().phase, 'setup');
  }
  function connect(...tail) { start(); sockets[0].message(setup, ...tail); }
  return { session, hooks, sockets, calls, reports, states, errors, trace, subscriber, unsubscribe, start, connect, step,
    setTime(value) { clock = value; }, counters() { return { reads, decodes }; } };
}
function finishVictory(h) {
  h.session.uiTick(1500);
  for (let index = 0; index < 51; index++) { h.step(3001 + index, 5); h.session.commitControl(); }
}

test('HUD subscription and legacy subscription share one owner and unsubscribe lifetime', () => {
  for (const hud of [false, true]) {
    const h = harness({ hud });
    assert.equal(h.sockets.length, 0);
    assert.throws(() => h.session.subscribe(h.subscriber), /subscriber/);
    assert.throws(() => h.session.subscribeWithHud(h.subscriber), /subscriber/);
    h.unsubscribe();
    assert.throws(() => h.session.subscribeWithHud(h.subscriber), /subscriber/);
    assert.throws(() => h.session.play(request()));
    assert.equal(h.sockets.length, 0);
  }
});

test('cyclic HUD callback prototype graphs reject without consuming the subscriber', () => {
  const h = harness({ subscribe: false });
  let callback, prototypeReads = 0, callbackCalls = 0;
  callback = new Proxy(() => { callbackCalls++; }, { getPrototypeOf() {
    // Keep the regression bounded even on the old validator.
    if (++prototypeReads > 8) throw new Error('Authored cycle probe limit');
    return callback;
  } });
  assert.throws(() => h.session.subscribeWithHud({ ...h.subscriber, hud: callback }), /Synchronous HUD sink/);
  assert.ok(prototypeReads < 8);
  assert.equal(callbackCalls, 0);
  h.session.subscribeWithHud(h.subscriber);
  assert.equal(h.sockets.length, 0);
});

test('fresh HUD callback prototype graphs reject within a fixed visit budget', () => {
  const h = harness({ subscribe: false });
  let prototypeReads = 0, callbackCalls = 0;
  const makePrototype = () => new Proxy(() => { callbackCalls++; }, { getPrototypeOf() {
    // Keep the old unbounded validator from hanging the regression run.
    if (++prototypeReads > 128) throw new Error('Authored fresh prototype probe limit');
    return makePrototype();
  } });
  assert.throws(() => h.session.subscribeWithHud({ ...h.subscriber, hud: makePrototype() }), /Synchronous HUD sink/);
  assert.ok(prototypeReads <= 64);
  assert.equal(callbackCalls, 0);
  h.session.subscribeWithHud(h.subscriber);
  assert.equal(h.sockets.length, 0);
});

test('HUD subscription reflection cannot overwrite a reentrant subscriber', () => {
  for (const site of ['record', 'callback']) {
    const h = harness({ subscribe: false });
    let nested = false, nestedPackets = 0;
    const subscribe = () => {
      if (nested) return;
      nested = true;
      h.session.subscribe({ packet() { nestedPackets++; return 0; },
        state: h.subscriber.state, error: h.subscriber.error });
    };
    const subscriber = site === 'record'
      ? new Proxy(h.subscriber, { ownKeys(target) { subscribe(); return Reflect.ownKeys(target); } })
      : { ...h.subscriber, hud: new Proxy(() => {}, {
        getPrototypeOf(target) { subscribe(); return Reflect.getPrototypeOf(target); },
      }) };
    assert.throws(() => h.session.subscribeWithHud(subscriber), /subscriber/);
    h.start(); h.sockets[0].message(setup);
    assert.equal(nestedPackets, 1);
    assert.equal(h.reports.length, 0);
    assert.equal(h.session.snapshot().connected, true);
  }
});

test('HUD subscription reflection rechecks readiness before claiming ownership', () => {
  const h = harness({ subscribe: false });
  const subscriber = new Proxy(h.subscriber, { ownKeys(target) {
    h.session.close('reflection-close');
    return Reflect.ownKeys(target);
  } });
  assert.throws(() => h.session.subscribeWithHud(subscriber), /subscriber/);
  assert.equal(h.session.snapshot().phase, 'disconnected');
  assert.equal(h.sockets.length, 0);
});

test('HUD subscription requires exactly four own data functions and a synchronous HUD latch', () => {
  let getterReads = 0;
  const bad = [
    s => { delete s.hud; }, s => { s.extra = 1; }, s => { s[Symbol()] = 1; },
    s => { s.hud = 1; }, s => { Object.setPrototypeOf(s, { inherited: true }); },
    s => { Object.defineProperty(s, 'hud', { get() { getterReads++; } }); },
    s => { s.hud = async () => {}; }, s => { s.hud = function* () {}; },
    s => { s.hud = async function* () {}; }, s => { s.hud = (async () => {}).bind(null); },
    s => { const f = async () => {}; Object.setPrototypeOf(f, Function.prototype); s.hud = f; },
    s => { const f = ({ *hud() {} }).hud; Object.setPrototypeOf(f, Function.prototype); s.hud = f; },
  ];
  for (const modify of bad) {
    const h = harness({ subscribe: false }), s = { ...h.subscriber };
    modify(s); assert.throws(() => h.session.subscribeWithHud(s));
    h.session.subscribeWithHud(h.subscriber);
    assert.equal(h.session.snapshot().phase, 'ready');
  }
  assert.equal(getterReads, 0);
  const valid = harness({ subscribe: false });
  valid.session.subscribeWithHud({ ...valid.subscriber, hud: ({ async() {} }).async });
});

test('one full Setup/trailing-own ingress, one receive clock, HUD then state after controls commit', () => {
  const h = harness(); h.start();
  const before = h.counters(); h.trace.length = 0;
  h.hooks.packet = (bytes, elapsed, plan) => {
    assert.equal(h.session.snapshot().connected, false);
    assert.equal(h.session.snapshot().phase, 'setup');
    assert.equal(elapsed, false); assertFrozen(plan);
    assert.deepEqual(plan.guards, [
      { playing: false, closeRequested: false, deathPending: false },
      { playing: true, closeRequested: false, deathPending: false },
    ]);
    assert.throws(() => h.session.pendingActions(), /reentry/);
    return reportFor([setup, own], plan);
  };
  h.hooks.hud = () => { assert.equal(h.session.snapshot().playing, true); };
  const buffer = h.sockets[0].message(setup, own);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].bytes.buffer, buffer);
  assert.equal(h.calls[0].argc, 3);
  assert.deepEqual(h.trace, ['packet', 'hud', 'state']);
  assert.deepEqual(h.counters(), { reads: before.reads + 1, decodes: before.decodes + 1 });
  assert.equal(h.errors.length, 0); assertFrozen(h.reports[0]);
});

test('pre-command guards and exhaustive captures preserve all v policies, opaque indices, Setup and pong', () => {
  const cases = [
    { commands: [setup, own, [82, 3], v(1), [104, 0, 1, 0, 0, 1], [82, 5], v(1), setup], captures: [3, 6], close: false },
    { commands: [setup, own, v(0), [104, 0, 1, 0, 0, 1], v(1)], captures: [2], close: true },
    { commands: [setup, own, v(2), [112], v(1)], captures: [], close: true },
    { commands: [setup, own, v(1), [120], v(1)], captures: [2, 4], close: false },
    { commands: [setup, own, v(255), v(1)], captures: [2], close: true },
    { commands: [setup, v(0), setup, [112], v(1)], captures: [1], close: true },
  ];
  for (const { commands, captures, close } of cases) {
    const h = harness(); h.start(); h.sockets[0].message(...commands);
    assert.equal(h.errors.length, 0);
    const plan = h.calls[0].plan;
    assert.equal(plan.commandCount, commands.length); assert.equal(plan.guards.length, commands.length);
    assert.deepEqual(plan.finalCaptureIndices, captures);
    let playing = false, closeRequested = false, deathPending = false;
    commands.forEach((command, i) => {
      assert.deepEqual(plan.guards[i], { playing, closeRequested, deathPending });
      if (command[0] === 97) playing = true;
      if (command[0] === 118) {
        if (command[1] !== 2) deathPending = true;
        if (command[1] === 2 || (playing && !closeRequested && command[1] !== 1)) closeRequested = true;
      }
    });
    assert.equal(h.session.snapshot().closeRequested, close);
  }
});

test('completed victory remains connected but nonplaying; later v requests lag reset without capture', () => {
  const h = harness(); h.connect(v(1));
  finishVictory(h);
  assert.equal(h.session.snapshot().playing, false);
  assert.equal(h.session.snapshot().connected, true);
  h.sockets[0].message(v(1), leaderboard);
  const plan = h.calls.at(-1).plan;
  assert.deepEqual(plan.guards[0], { playing: false, closeRequested: false, deathPending: false });
  assert.deepEqual(plan.finalCaptureIndices, []);
  assert.deepEqual(h.reports.at(-1).events, []);
  assert.equal(h.session.pendingActions().actions.resetLag, true);
});

test('both subscription modes preserve snapshots, EVERY resetLag revision and selective acknowledgements', () => {
  const modes = [harness({ hud: false }), harness()];
  for (const h of modes) {
    h.connect();
    const offered = h.session.pendingActions();
    h.hooks.packet = (...args) => {
      assert.equal(h.session.snapshot().lifeEnded, false);
      assert.throws(() => h.session.acknowledgeActions(offered), /reentry/);
      return args.length === 3 ? reportFor(decode(args[0]), args[2]) : 0;
    };
    h.sockets[0].message(v(1), v(1), [112], v(2), v(1));
    const next = h.session.pendingActions();
    assert.equal(next.revision, offered.revision + 3);
    assert.deepEqual(next.actions, { resetLag: true });
    assert.throws(() => h.session.acknowledgeActions(offered), /Stale/);
    h.session.acknowledgeActions(next);
    assert.deepEqual(h.session.pendingActions().actions, {});
  }
  assert.deepEqual(modes[0].session.snapshot(), modes[1].session.snapshot());
  assert.equal(modes[0].calls.at(-1).argc, 2);
});

test('initial Play reset waits for commit; selective lag acknowledgement preserves a pending world reset', () => {
  for (const hud of [false, true]) {
    const staged = harness({ hud }); staged.session.play(request());
    const initial = staged.session.pendingActions();
    assert.deepEqual(initial.actions, { resetWorld: true, connected: false });
    assert.throws(() => staged.session.acknowledgeActions(initial), /No lag reset/);
    staged.session.commitControl(); assert.equal(staged.sockets.length, 0);
    assert.deepEqual(staged.step(), initial.actions);
    staged.session.commitControl(); assert.equal(staged.sockets.length, 1);

    const h = harness({ hud }); h.connect(v(1));
    const before = h.session.pendingActions(); h.session.close();
    assert.throws(() => h.session.acknowledgeActions(before), /Stale/);
    const pending = h.session.pendingActions();
    assert.deepEqual(pending.actions, { resetLag: true, resetWorld: true, connected: false });
    h.session.acknowledgeActions(pending);
    assert.deepEqual(h.session.pendingActions().actions, { resetWorld: true, connected: false });
  }
});

test('pong preserves resetLag revision and source ping thresholds with no extra time reads', () => {
  const h = harness(); h.connect(v(1));
  h.session.betweenKeyboardAndBoost({ nowMs: 1300, protocolVersion: 19 }, () => {});
  assert.equal(h.session.beforeUpdate(2050).lagging, false);
  assert.equal(h.session.beforeUpdate(2051).lagging, true);
  const before = h.session.pendingActions(); const counters = h.counters();
  h.sockets[0].message([112]);
  assert.equal(h.session.snapshot().pingPending, false);
  assert.equal(h.session.snapshot().lagging, false);
  assert.deepEqual(h.session.pendingActions(), before);
  assert.equal(h.counters().reads, counters.reads + 1);
  const sent = [];
  h.session.betweenKeyboardAndBoost({ nowMs: 1550, protocolVersion: 19 }, b => sent.push([...b]));
  assert.deepEqual(sent, []);
  h.session.betweenKeyboardAndBoost({ nowMs: 1551, protocolVersion: 19 }, b => sent.push([...b]));
  assert.deepEqual(sent, [[251]]);
});

test('report copies retain signed zero, negatives and large scores without mutable aliases', () => {
  const h = harness(); h.start(); let raw;
  h.hooks.packet = (bytes, elapsed, plan) => {
    raw = reportFor(decode(bytes), plan);
    raw.events.at(-1).view.score = -0;
    return raw;
  };
  h.sockets[0].message(setup, v(1));
  const copy = h.reports[0]; assertFrozen(copy);
  assert.equal(Object.is(copy.events.at(-1).view.score, -0), true);
  assert.notEqual(copy, raw); assert.notEqual(copy.events, raw.events);
  assert.notEqual(copy.events.at(-1).view.own, raw.events.at(-1).view.own);
  raw.events.at(-1).view.own.id = 65535; raw.events.length = 0;
  assert.equal(copy.events.at(-1).view.own.id, 0);
  for (const score of [-100, 2 ** 40, -0]) {
    const report = { schema: 1, commandCount: 1, setupDraws: 0,
      events: [{ commandIndex: 0, kind: 'final-score', view: ready(score) }] };
    assert.equal(Object.is(copyHudIngressReport(report, 1).events[0].view.score, score), true);
  }
});

test('command-time samples are copied in order without deriving scores or rereading later own/table state', () => {
  const h = harness(); h.start();
  const first = ready(-17), second = ready(2 ** 40);
  second.own.scoreAdjustment = 5; second.own.scoreIndex = 9; second.own.fractionalMass = 0.75;
  const laterSetup = { ...second, own: { ...second.own }, tableMax: 29 };
  h.hooks.packet = (bytes, elapsed, plan) => ({ schema: 1, commandCount: plan.commandCount, setupDraws: 2,
    events: [
      { commandIndex: 0, kind: 'setup', tableMax: 17 }, { commandIndex: 0, kind: 'setup-draw', view: noOwn() },
      { commandIndex: 1, kind: 'own-length-scheduled', token: 1n },
      { commandIndex: 3, kind: 'final-score', view: first },
      { commandIndex: 4, kind: 'own-length-scheduled', token: 1n },
      { commandIndex: 6, kind: 'final-score', view: second },
      { commandIndex: 7, kind: 'setup', tableMax: 29 }, { commandIndex: 7, kind: 'setup-draw', view: laterSetup },
    ] });
  h.sockets[0].message(setup, own, [82, 3], v(1), [104, 0, 1, 0, 0, 1], [82, 5], v(1), setup);
  assert.equal(h.errors.length, 0);
  const finals = h.reports[0].events.filter(e => e.kind === 'final-score');
  assert.deepEqual(finals.map(e => [e.commandIndex, e.view.own.token, e.view.own.scoreAdjustment, e.view.tableMax, e.view.score]),
    [[3, 1n, 3, 17, -17], [6, 1n, 5, 17, 2 ** 40]]);
  laterSetup.tableMax = 1; first.own.scoreAdjustment = 20;
  assert.equal(finals[0].view.own.scoreAdjustment, 3);
});

test('invalid result discards all staged control/action revisions in both modes before terminal cleanup', () => {
  for (const hud of [false, true]) {
    const h = harness({ hud }); h.connect();
    const before = h.session.pendingActions();
    const reports = h.reports.length;
    h.hooks.packet = () => undefined; // Legacy undefined is valid: use an explicitly bad result there.
    if (!hud) h.hooks.packet = () => -1;
    h.sockets[0].message(v(1), v(1));
    const after = h.session.pendingActions();
    assert.equal(after.revision, before.revision + 1); // Only terminal reset, no staged lag requests.
    assert.deepEqual(after.actions, { resetWorld: true, connected: false });
    assert.equal(h.session.snapshot().lifeEnded, false);
    assert.equal(h.reports.length, reports);
  }
});

test('legal scheduling markers are optional, at most one, and use u64 BigInt tokens', () => {
  for (const opcode of [115, 110, 78, 43, 104, 114]) {
    const h = harness(); h.connect();
    h.hooks.packet = () => ({ schema: 1, commandCount: 1, setupDraws: 0,
      events: [{ commandIndex: 0, kind: 'own-length-scheduled', token: 18446744073709551615n }] });
    h.sockets[0].message([opcode]);
    assert.equal(h.errors.length, 0);
    assert.equal(h.reports.at(-1).events[0].token, 18446744073709551615n);
  }
});

test('leaderboard requires playing and exactly the pre-command deathPending, including after v2', () => {
  const h = harness(); h.connect(v(2), leaderboard, v(1), leaderboard, setup, leaderboard);
  assert.equal(h.errors.length, 0);
  const headers = h.reports[0].events.filter(e => e.kind === 'leaderboard');
  assert.deepEqual(headers.map(e => e.deathPending), [false, true, true]);
  assert.deepEqual(headers.map(e => [e.localRow, e.rank, e.population]), [[2, 17, 33], [2, 17, 33], [2, 17, 33]]);
});

const malformedReports = [
  ['undefined', () => undefined], ['numeric legacy result', () => 0], ['Promise', () => Promise.resolve({})],
  ['wrong schema', r => ({ ...r, schema: 3 })], ['count mismatch', r => ({ ...r, commandCount: 1 })],
  ['unknown field', r => ({ ...r, extra: true })], ['symbol', r => ({ ...r, [Symbol()]: true })],
  ['inherited record', r => Object.assign(Object.create({}), r)],
  ['missing first setup', r => ({ ...r, events: r.events.slice(2), setupDraws: 1 })],
  ['missing final', r => ({ ...r, events: r.events.filter(e => e.kind !== 'final-score') })],
  ['missing leaderboard', r => ({ ...r, events: r.events.filter(e => e.kind !== 'leaderboard') })],
  ['duplicate final', r => ({ ...r, events: [...r.events, r.events.at(-1)] })],
  ['reordered events', r => ({ ...r, events: r.events.toReversed() })],
  ['setup draw count', r => ({ ...r, setupDraws: 0 })],
  ['setup table mismatch', r => { r.events[0].tableMax = 29; return r; }],
  ['unpaired draw', r => ({ ...r, events: r.events.slice(1) })],
  ['header death guard', r => { r.events.find(e => e.kind === 'leaderboard').deathPending = true; return r; }],
  ['header overflow', r => { r.events.find(e => e.kind === 'leaderboard').localRow = 256; return r; }],
  ['header NaN', r => { r.events.find(e => e.kind === 'leaderboard').rank = NaN; return r; }],
  ['marker on R', r => { r.events.splice(2, 0, { commandIndex: 1, kind: 'own-length-scheduled', token: 1n }); return r; }],
  ['extra setup on R', r => { r.events.splice(2, 0, { commandIndex: 1, kind: 'setup', tableMax: 17 },
    { commandIndex: 1, kind: 'setup-draw', view: noOwn() }); r.setupDraws++; return r; }],
  ['event out of bounds', r => { r.events.at(-1).commandIndex = r.commandCount; return r; }],
  ['final nonready', r => { r.events.at(-1).view = noOwn(); return r; }],
  ['unsafe id', r => { r.events.at(-1).view.own.id = 65536; return r; }],
  ['nonBigInt token', r => { r.events.at(-1).view.own.token = 1; return r; }],
  ['zero token', r => { r.events.at(-1).view.own.token = 0n; return r; }],
  ['token overflow', r => { r.events.at(-1).view.own.token = 2n ** 64n; return r; }],
  ['logical count bound', r => { r.events.at(-1).view.own.logicalSegments = 4097; return r; }],
  ['mass NaN', r => { r.events.at(-1).view.own.fractionalMass = NaN; return r; }],
  ['mass above one', r => { r.events.at(-1).view.own.fractionalMass = 1.01; return r; }],
  ['R overflow', r => { r.events.at(-1).view.own.scoreAdjustment = 256; return r; }],
  ['index mismatch', r => { r.events.at(-1).view.own.scoreIndex = 99; return r; }],
  ['fraction score', r => { r.events.at(-1).view.score = 1.5; return r; }],
  ['infinite score', r => { r.events.at(-1).view.score = Infinity; return r; }],
  ['NaN score', r => { r.events.at(-1).view.score = NaN; return r; }],
  ['ready null table', r => { r.events.at(-1).view.tableMax = null; return r; }],
  ['ready error', r => { r.events.at(-1).view.error = 'index-out-of-range'; return r; }],
];
for (const [name, mutate] of malformedReports) test(`malformed report: ${name} never publishes staged controls/HUD`, () => {
  const h = harness(); h.start();
  h.hooks.packet = (bytes, elapsed, plan) => mutate(reportFor(decode(bytes), plan));
  h.sockets[0].message(setup, [82, 3], leaderboard, v(1));
  assert.equal(h.session.snapshot().phase, 'failed');
  assert.equal(h.session.snapshot().lifeEnded, false);
  assert.equal(h.session.snapshot().connected, false);
  assert.equal(h.reports.length, 0); assert.equal(h.errors.length, 1);
  assert.equal(h.calls.length, 1); assert.equal(h.sockets[0].closes, 1);
});

test('missing last/first of repeated finals and extra v2/opaque capture events reject exhaustively', () => {
  for (const remove of [0, 1]) {
    const h = harness(); h.connect();
    h.hooks.packet = (bytes, elapsed, plan) => {
      const r = reportFor(decode(bytes), plan); r.events.splice(remove, 1); return r;
    };
    h.sockets[0].message(v(1), v(1));
    assert.equal(h.session.snapshot().phase, 'failed');
  }
  for (const command of [v(2), [120], [82, 3]]) {
    const h = harness(); h.connect();
    h.hooks.packet = () => ({ schema: 1, commandCount: 1, setupDraws: 0,
      events: [{ commandIndex: 0, kind: 'final-score', view: ready() }] });
    h.sockets[0].message(command);
    assert.equal(h.session.snapshot().phase, 'failed');
  }
});

test('missing repeated Setup and false-playing leaderboard cannot hide behind valid shapes', () => {
  const h = harness(); h.connect();
  h.hooks.packet = (bytes, elapsed, plan) => {
    const r = reportFor(decode(bytes), plan); r.events.splice(2, 2); r.setupDraws--; return r;
  };
  h.sockets[0].message(setup, setup); assert.equal(h.session.snapshot().phase, 'failed');
  const other = harness(); other.connect(v(1)); finishVictory(other);
  other.hooks.packet = () => ({ schema: 1, commandCount: 1, setupDraws: 0,
    events: [{ commandIndex: 0, kind: 'leaderboard', localRow: 0, rank: 0, population: 0, deathPending: false }] });
  other.sockets[0].message(leaderboard); assert.equal(other.session.snapshot().phase, 'failed');
});

test('invalid optional markers reject unknown opcodes, duplicate indices and non-u64 tokens', () => {
  for (const { command, tokens } of [
    { command: [82, 3], tokens: [1n] }, { command: [104], tokens: [1n, 1n] },
    ...[0n, -1n, 2n ** 64n, 1, '1'].map(token => ({ command: [104], tokens: [token] })),
  ]) {
    const h = harness(); h.connect();
    h.hooks.packet = () => ({ schema: 1, commandCount: 1, setupDraws: 0,
      events: tokens.map(token => ({ commandIndex: 0, kind: 'own-length-scheduled', token })) });
    h.sockets[0].message(command); assert.equal(h.session.snapshot().phase, 'failed');
  }
});

test('closed plan copies validate bounds, current realm, dense own data and strictly increasing indices', () => {
  const input = planFor(2); input.finalCaptureIndices = [0, 1];
  const copy = copyHudIngressPlan(input); assertFrozen(copy);
  input.guards[0].playing = false; input.finalCaptureIndices[0] = 1;
  assert.equal(copy.guards[0].playing, true); assert.deepEqual(copy.finalCaptureIndices, [0, 1]);
  let getterReads = 0;
  for (const modify of [
    p => { p.commandCount = 0; }, p => { p.commandCount = 4097; }, p => { p.schema = 3; },
    p => { p.guards.length = 0; }, p => { delete p.guards[0]; }, p => { p.guards.extra = 1; },
    p => { p.guards[Symbol()] = 1; }, p => { p.guards[0].playing = 1; },
    p => { p.guards[0] = Object.create(p.guards[0]); },
    p => { Object.defineProperty(p.guards, '0', { get() { getterReads++; } }); },
    p => { Object.defineProperty(p.guards[0], 'playing', { get() { getterReads++; } }); },
    p => { p.finalCaptureIndices = [1, 0]; }, p => { p.finalCaptureIndices = [0, 0]; },
    p => { p.finalCaptureIndices = [2]; }, p => { p.finalCaptureIndices = [-1]; },
    p => { p.finalCaptureIndices = [0.5]; }, p => { p.finalCaptureIndices = new Uint8Array([0]); },
    p => { p.guards = vm.runInNewContext('[{playing:true,closeRequested:false,deathPending:false},{playing:true,closeRequested:false,deathPending:false}]'); },
    p => { p.guards = new (class extends Array {})(...p.guards); },
    p => { Object.setPrototypeOf(p, { inherited: 1 }); }, p => { p.extra = 1; },
  ]) {
    const p = planFor(2); modify(p); assert.throws(() => copyHudIngressPlan(p));
  }
  assert.equal(getterReads, 0);
  const nullRecord = Object.assign(Object.create(null), planFor());
  assertFrozen(copyHudIngressPlan(nullRecord));
});

test('oversized arrays reject before ownKeys/element visitation and copying', () => {
  let visits = 0;
  const oversized = maximum => new Proxy(new Array(maximum + 1), {
    ownKeys() { visits++; throw new Error('Must reject length first'); },
    getOwnPropertyDescriptor(target, key) {
      if (key !== 'length') visits++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const p = planFor(); p.guards = oversized(4096);
  assert.throws(() => copyHudIngressPlan(p), TypeError);
  p.guards = planFor().guards; p.finalCaptureIndices = oversized(1);
  assert.throws(() => copyHudIngressPlan(p), TypeError);
  assert.throws(() => copyHudIngressReport({ schema: 1, commandCount: 1, setupDraws: 0, events: oversized(2) }, 1), TypeError);
  assert.equal(visits, 0);
});

test('closed report rejects hostile getters, thenables, array holes/extras, foreign realms and accessor elements without reading them', () => {
  let getters = 0;
  const getter = { get() { getters++; throw new Error('Getter executed'); }, configurable: true };
  const modifiers = [
    r => { Object.defineProperty(r, 'then', getter); },
    r => { Object.defineProperty(r, 'events', getter); },
    r => { Object.defineProperty(r.events, '0', getter); },
    r => { Object.defineProperty(r.events[0], 'kind', getter); },
    r => { Object.defineProperty(r.events[0].view.own, 'id', getter); },
    r => { delete r.events[0]; }, r => { r.events.extra = true; }, r => { r.events[Symbol()] = 1; },
    r => { r.events = vm.runInNewContext('[]'); },
    r => { r.events = Object.assign(Object.create(Array.prototype), { length: 1, 0: r.events[0] }); },
    r => { r.events[0].view.own.wireId = 0; }, r => { r.events[0].view.result = {}; },
    r => { r.events[0].view.own = Object.create(r.events[0].view.own); },
  ];
  for (const modify of modifiers) {
    const r = { schema: 1, commandCount: 1, setupDraws: 0,
      events: [{ commandIndex: 0, kind: 'final-score', view: ready() }] };
    modify(r); assert.throws(() => copyHudIngressReport(r, 1));
  }
  assert.equal(getters, 0);
});

test('session rejects report then-getters without reading them; Promise Proxy structural traps can run', () => {
  let reads = 0;
  const h = harness(); h.start();
  h.hooks.packet = () => Object.defineProperty({}, 'then', { get() { reads++; throw new Error('then'); } });
  h.sockets[0].message(setup);
  assert.equal(reads, 0); assert.equal(h.errors.length, 1); assert.equal(h.reports.length, 0);
  const primary = Symbol('Promise Proxy structure');
  const other = harness(); other.start();
  other.hooks.packet = () => new Proxy(Promise.resolve(), { getPrototypeOf() { reads++; throw primary; } });
  other.sockets[0].message(setup);
  assert.equal(reads, 1); assert.equal(other.errors[0], primary);
});

test('event kind must remain the selected closed variant across Proxy descriptor reads', () => {
  let reads = 0;
  const value = new Proxy({ commandIndex: 0, kind: 'own-length-scheduled', token: 1n }, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === 'kind' && ++reads > 1) return { ...descriptor, value: 'unrecognized-variant' };
      return descriptor;
    },
  });
  assert.throws(() => copyHudIngressReport({ schema: 1, commandCount: 1, setupDraws: 0, events: [value] }, 1));
});

test('explicit nonready view status consistency is enforced on Setup draws', () => {
  const unsupported = () => ({ ...ready(), status: 'unsupported', score: null, error: 'index-out-of-range',
    own: { ...ready().own, logicalSegments: 4096, scoreAdjustment: 255, scoreIndex: 4351 } });
  const check = view => copyHudIngressReport({ schema: 1, commandCount: 1, setupDraws: 1,
    events: [{ commandIndex: 0, kind: 'setup', tableMax: 17 }, { commandIndex: 0, kind: 'setup-draw', view }] }, 1);
  assertFrozen(check(noOwn())); assertFrozen(check(unsupported()));
  for (const view of [
    { ...ready(), enabled: false }, { ...noOwn(), error: 'index-out-of-range' },
    { ...noOwn(), own: ready().own }, { ...ready(), status: 'no-tables', score: null },
    { ...ready(), status: 'unsupported', score: null, error: 'index-out-of-range' },
    { ...unsupported(), error: 'zero-table-max' }, { ...unsupported(), error: 'invalid-fractional-mass' },
    { ...unsupported(), error: 'unknown' }, { ...noOwn(), score: 0 }, { ...ready(), tableMax: 0 },
    { ...unsupported(), status: 'ready', score: 10, error: null },
  ]) assert.throws(() => check(view));
  // Structural view admission includes no-tables; setup-pair consistency forbids it there.
  assert.throws(() => check({ ...noOwn(), tableMax: null, status: 'no-tables' }));
});

test('ordinary dense maximum plan and report bounds are accepted; mock framing rejects 4097', () => {
  const p = planFor(4096); p.finalCaptureIndices = Array.from({ length: 4096 }, (_, i) => i);
  assertFrozen(copyHudIngressPlan(p));
  const r = { schema: 1, commandCount: 4096, setupDraws: 4096,
    events: Array.from({ length: 4096 }, (_, commandIndex) => [
      { commandIndex, kind: 'setup', tableMax: 17 }, { commandIndex, kind: 'setup-draw', view: noOwn() },
    ]).flat() };
  assert.equal(copyHudIngressReport(r, 4096).events.length, 8192);
  const h = harness(); h.connect(); h.sockets[0].message(...Array.from({ length: 4096 }, () => [120]));
  assert.equal(h.errors.length, 0); assert.equal(h.calls.at(-1).plan.commandCount, 4096);
  h.sockets[0].message(...Array.from({ length: 4097 }, () => [120]));
  assert.equal(h.errors.length, 1);
});

test('structural Proxy failures preserve the exact primary, including falsy trap failures', () => {
  for (const primary of [undefined, null, false, 0, Symbol('trap'), { trap: true }]) {
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
      const h = harness(); h.start();
      h.hooks.packet = (bytes, elapsed, plan) => new Proxy(reportFor(decode(bytes), plan), {
        [trap]() { throw primary; },
      });
      h.hooks.close = () => { throw new Error('Secondary close'); };
      h.hooks.state = s => { if (s.phase === 'failed') throw new Error('Secondary state'); };
      h.hooks.error = () => { throw new Error('Secondary error'); };
      h.sockets[0].message(setup);
      assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary);
      assert.equal(h.reports.length, 0); assert.equal(h.sockets[0].closes, 1);
    }
  }
});

test('HUD and state observers can read copied snapshots but cannot mutate session/actions or commit', () => {
  const h = harness(); h.start();
  const mutations = [
    () => h.session.pendingActions(), () => h.session.acknowledgeActions({}), () => h.step(),
    () => h.session.commitControl(), () => h.session.close(), () => h.session.beforeUpdate(1000),
    () => h.session.uiTick(1000), () => h.session.sendInput(Uint8Array.of(1)),
    () => h.session.betweenKeyboardAndBoost({ nowMs: 1000, protocolVersion: 19 }, () => {}),
  ];
  const observe = () => {
    assert.equal(h.session.snapshot().playing, true);
    for (const mutation of mutations) assert.throws(mutation, /reentry/);
  };
  h.hooks.hud = observe; h.hooks.state = observe;
  h.sockets[0].message(setup, v(1));
  assert.equal(h.errors.length, 0);
  assert.deepEqual(h.session.pendingActions().actions, { resetLag: true });
});

test('nonundefined or Promise HUD returns reject synchronously without reading then', () => {
  let thenReads = 0;
  for (const value of [null, false, 0, {}, Promise.resolve(),
    Object.defineProperty({}, 'then', { get() { thenReads++; throw new Error('then'); } })]) {
    const h = harness(); h.start(); h.hooks.hud = () => value;
    h.sockets[0].message(setup, v(1));
    assert.equal(h.session.snapshot().phase, 'failed');
    assert.equal(h.session.snapshot().lifeEnded, true); // Native and controls already committed.
    assert.equal(h.reports.length, 1); assert.equal(h.errors.length, 1);
  }
  assert.equal(thenReads, 0);
});

test('packet/HUD/state failures preserve original values over close/state/error failures with one close and no retries', () => {
  for (const site of ['packet', 'hud', 'state']) for (const primary of [undefined, null, false, 0, Symbol('primary'), { primary: true }]) {
    const h = harness(); h.start();
    const socket = h.sockets[0], staleMessage = socket.onmessage, staleOpen = socket.onopen;
    h.hooks[site] = (...args) => {
      if (site !== 'state' || args[0].phase !== 'failed') throw primary;
      throw new Error('Secondary state');
    };
    h.hooks.close = () => { throw new Error('Secondary close'); };
    h.hooks.error = () => { throw new Error('Secondary error'); };
    assert.doesNotThrow(() => socket.message(setup, v(1)));
    assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary);
    assert.equal(h.session.snapshot().phase, 'failed');
    assert.equal(h.session.snapshot().lifeEnded, site !== 'packet');
    assert.equal(socket.closes, 1);
    const calls = h.calls.length, states = h.states.length;
    staleMessage({ data: frame([setup]) }); staleOpen();
    h.session.close(); h.session.commitControl();
    assert.equal(h.calls.length, calls); assert.equal(h.states.length, states);
    assert.equal(h.sockets.length, 1); assert.equal(socket.closes, 1);
    assert.throws(() => h.session.play(request()));
  }
});

test('a close-only or stop-state undefined failure is present and reaches the error sink', () => {
  for (const site of ['close', 'state']) {
    const h = harness(); h.connect();
    h.hooks[site] = () => { throw undefined; };
    h.hooks.error = () => { throw new Error('Secondary sink'); };
    h.session.close();
    assert.equal(h.errors.length, 1); assert.equal(h.errors[0], undefined);
    assert.equal(h.sockets[0].closes, 1);
  }
});

test('detach failure still attempts other detach fields, close and notifications without replacing primary', () => {
  const primary = Symbol('primary'), secondary = Symbol('detach');
  const h = harness(); h.start();
  const socket = h.sockets[0];
  Object.defineProperty(socket, 'onopen', { set() { throw secondary; }, configurable: true });
  h.hooks.packet = () => { throw primary; };
  socket.message(setup);
  assert.equal(h.errors[0], primary); assert.equal(socket.closes, 1);
  assert.equal(socket.onmessage, null); assert.equal(socket.onerror, null); assert.equal(socket.onclose, null);
});

test('same-stack transport close or error in packet cannot resurrect staged controls or HUD', () => {
  for (const event of ['onclose', 'onerror']) for (const hud of [false, true]) {
    const h = harness({ hud }); h.start();
    const socket = h.sockets[0];
    h.hooks.packet = (bytes, elapsed, plan) => {
      socket[event](new Error('Transport terminal'));
      return hud ? reportFor(decode(bytes), plan) : 0;
    };
    socket.message(setup, v(1));
    assert.equal(h.session.snapshot().connected, false); assert.equal(h.session.snapshot().playing, false);
    assert.equal(h.session.snapshot().lifeEnded, false); assert.equal(h.reports.length, 0);
    assert.equal(socket.closes, 1);
  }
});

test('terminal changes inside report structural traps also win before the staged commit', () => {
  const h = harness(); h.start(); let stopped = false;
  h.hooks.packet = (bytes, elapsed, plan) => new Proxy(reportFor(decode(bytes), plan), {
    ownKeys(target) {
      if (!stopped) { stopped = true; h.sockets[0].onclose(); }
      return Reflect.ownKeys(target);
    },
  });
  h.sockets[0].message(setup, v(1));
  assert.equal(h.session.snapshot().phase, 'disconnected');
  assert.equal(h.session.snapshot().lifeEnded, false); assert.equal(h.reports.length, 0);
});

test('canonical controls/protocol/challenge reject before packet and preserve default subscription numeric contract', () => {
  for (const commands of [[[112, 0]], [[118]], [[118, 1, 0]], [[54, 65]], [[...setup.slice(0, 23), 18, 42]]]) {
    const h = harness(); h.connect(); const count = h.calls.length;
    h.sockets[0].message(...commands);
    assert.equal(h.calls.length, count); assert.equal(h.session.snapshot().phase, 'failed');
  }
  for (const result of [undefined, 0, 4096]) {
    const h = harness({ hud: false }); h.start(); h.hooks.packet = () => result;
    h.sockets[0].message(setup); assert.equal(h.errors.length, 0); assert.equal(h.calls[0].argc, 2);
  }
  for (const result of [-1, 4097, null, false, Promise.resolve(0), {}]) {
    const h = harness({ hud: false }); h.start(); h.hooks.packet = () => result;
    h.sockets[0].message(setup); assert.equal(h.session.snapshot().phase, 'failed');
  }
});

const rawRow = (ordinal = 1, name = [0, 65, 255]) => ({ ordinal, count: 65535,
  fractionalMass: 8388608 / 16777215, rawColor: 255, paletteIndex: 3, name });
const subscriptionMethods = ['subscribe', 'subscribeWithHud', 'subscribeWithLeaderboardRows'];
const subscriberFor = (h, method) => {
  if (method !== 'subscribe') return h.subscriber;
  const { hud, ...legacy } = h.subscriber; void hud; return legacy;
};

test('three subscription choices compete for the same permanent owner before Play', () => {
  for (const first of subscriptionMethods) {
    const h = harness({ subscribe: false });
    const unsubscribe = h.session[first](subscriberFor(h, first));
    for (const next of subscriptionMethods) assert.throws(() => h.session[next](subscriberFor(h, next)), /subscriber/);
    unsubscribe(); unsubscribe();
    for (const next of subscriptionMethods) assert.throws(() => h.session[next](subscriberFor(h, next)), /subscriber/);
    assert.throws(() => h.session.play(request()), /Play/); assert.equal(h.sockets.length, 0);
  }
});

test('row subscription shares closed callback grammar, synchronous-kind checks and bounded prototype admission', () => {
  let getters = 0;
  const mutations = [
    s => { delete s.hud; }, s => { s.extra = 1; }, s => { s[Symbol()] = true; },
    s => { s.packet = 1; }, s => { s.hud = 1; }, s => { s.state = null; }, s => { s.error = null; },
    s => { Object.setPrototypeOf(s, {}); },
    s => { Object.defineProperty(s, 'hud', { get() { getters++; } }); },
    s => { s.hud = async () => {}; }, s => { s.hud = function* () {}; },
    s => { s.hud = async function* () {}; }, s => { s.hud = (async () => {}).bind(null); },
    s => { const f = async () => {}; Object.setPrototypeOf(f, Function.prototype); s.hud = f; },
    s => { const f = ({ *hud() {} }).hud; Object.setPrototypeOf(f, Function.prototype); s.hud = f; },
  ];
  for (const mutate of mutations) {
    const h = harness({ subscribe: false }), s = { ...h.subscriber }; mutate(s);
    assert.throws(() => h.session.subscribeWithLeaderboardRows(s));
    h.session.subscribeWithLeaderboardRows(h.subscriber);
  }
  assert.equal(getters, 0);
  for (const cycle of [false, true]) {
    const h = harness({ subscribe: false }); let visits = 0, callback;
    const make = () => new Proxy(() => assert.fail('must not invoke callback'), { getPrototypeOf() {
      if (++visits > 128) throw new Error('test probe bound'); return cycle ? callback : make();
    } });
    callback = make();
    assert.throws(() => h.session.subscribeWithLeaderboardRows({ ...h.subscriber, hud: callback }), /Synchronous HUD sink/);
    assert(visits <= 64); h.session.subscribeWithLeaderboardRows(h.subscriber);
  }
  const h = harness({ subscribe: false });
  h.session.subscribeWithLeaderboardRows(Object.assign(Object.create(null), { ...h.subscriber, hud: ({ async() {} }).async }));
});

test('row subscription rejects foreign direct and bound asynchronous kinds without invoking callbacks', () => {
  let calls = 0;
  for (const expression of ['async function(){}', 'function*(){}', 'async function*(){}']) {
    for (const bound of [false, true]) {
      const foreign = vm.runInNewContext(`(${expression})${bound ? '.bind(null)' : ''}`);
      const callback = new Proxy(foreign, { apply() { calls++; assert.fail('must not invoke callback'); } });
      const h = harness({ subscribe: false });
      assert.throws(() => h.session.subscribeWithLeaderboardRows({ ...h.subscriber, hud: callback }), /Synchronous HUD sink/);
      h.session.subscribeWithLeaderboardRows(h.subscriber);
      assert.equal(h.sockets.length, 0);
    }
  }
  assert.equal(calls, 0);
});

test('row callback kind descriptors avoid getters and admit foreign synchronous callbacks', () => {
  for (const bound of [false, true]) {
    const callback = vm.runInNewContext(`(function(){})${bound ? '.bind(null)' : ''}`);
    const h = harness({ subscribe: false });
    assert.doesNotThrow(() => h.session.subscribeWithLeaderboardRows({ ...h.subscriber, hud: callback }));
    assert.equal(h.sockets.length, 0);
  }
  let reads = 0;
  const callback = () => {};
  const prototype = Object.create(Function.prototype);
  Object.defineProperty(prototype, Symbol.toStringTag, { get() { reads++; throw new Error('must not read tag'); } });
  Object.setPrototypeOf(callback, prototype);
  const h = harness({ subscribe: false });
  h.session.subscribeWithLeaderboardRows({ ...h.subscriber, hud: callback });
  assert.equal(reads, 0);
  // Schema1 keeps its pre-existing descriptor admission and reflection order.
  const legacy = harness({ subscribe: false });
  Object.setPrototypeOf(callback, new Proxy(Function.prototype, {
    getOwnPropertyDescriptor() { throw new Error('row-only reflection'); },
  }));
  assert.doesNotThrow(() => legacy.session.subscribeWithHud({ ...legacy.subscriber, hud: callback }));
});

test('row subscription rechecks owner and readiness after record/callback reflection', () => {
  for (const site of ['record', 'callback']) for (const nested of subscriptionMethods) {
    const h = harness({ subscribe: false }); let entered = false;
    const enter = () => { if (!entered) { entered = true; h.session[nested](subscriberFor(h, nested)); } };
    const value = site === 'record' ? new Proxy(h.subscriber, { ownKeys(target) { enter(); return Reflect.ownKeys(target); } })
      : { ...h.subscriber, hud: new Proxy(() => {}, { getPrototypeOf(target) { enter(); return Reflect.getPrototypeOf(target); } }) };
    assert.throws(() => h.session.subscribeWithLeaderboardRows(value), /subscriber/);
    assert(entered); assert.equal(h.sockets.length, 0);
  }
  const h = harness({ subscribe: false });
  const value = new Proxy(h.subscriber, { ownKeys(target) { h.session.close('reflection-close'); return Reflect.ownKeys(target); } });
  assert.throws(() => h.session.subscribeWithLeaderboardRows(value), /subscriber/);
  assert.equal(h.session.snapshot().phase, 'disconnected'); assert.equal(h.sockets.length, 0);
});

test('schema2 session + actual controller release sources before control commit, HUD, then state', () => {
  const h = harness({ rows: true }); h.start();
  let active = false, commits = 0, native;
  const controller = createStockClient({
    scene: {
      apply_frame_and_render_standard_with_face_presentation_and_prey() { assert.fail('legacy native'); },
      render_standard_with_face_presentation_at_size() { assert.fail('no extra draw'); },
      advance() { assert.fail('no animation step'); }, set_gaze_heading() { assert.fail('no gaze'); },
      apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud(...args) {
        h.trace.push('native'); commits++; assert(active);
        assert.equal(h.session.snapshot().playing, false);
        const plan = args.at(-1); assert.equal(plan.schema, 2); assertFrozen(plan);
        native = reportFor(decode(args[0]), plan);
        native.leaderboardRows[0].rows = [rawRow()];
        native.leaderboardRows[2].rows = [rawRow(), rawRow(2, [])];
        return native;
      },
    },
    adapter: {
      beginOperation() { h.trace.push('begin'); assert(!active); active = true; return {}; },
      endOperation() {
        h.trace.push('release'); assert(active); active = false;
        assert.equal(h.session.snapshot().playing, false);
        native.leaderboardRows[0].rows[0].name[1] = 66;
      },
      resolveAppearance() {}, resolveRecipe() {}, resolveAntennaRandom() { assert.fail('no random'); },
    },
    hostAssets: { resolveFood() {}, resolvePrey() {} },
    quality: { advance() { assert.fail('no quality step'); }, update_statistics() { assert.fail('no statistics'); } },
    target: {}, palettes: [{}, {}, {}], background: {}, width: 1, height: 1,
  });
  h.hooks.packet = (...args) => controller.packetWithHud(...args);
  h.hooks.hud = report => {
    assert(!active); assert.equal(h.session.snapshot().playing, true); assert.equal(h.session.snapshot().lifeEnded, true);
    assert.equal(h.session.snapshot().closeRequested, true);
    assert.deepEqual(report.leaderboardRows.map(b => b.commandIndex), [1, 3, 6]);
    assert.deepEqual(report.leaderboardRows[0].rows[0].name, [0, 65, 255]);
    assert.deepEqual(report.leaderboardRows[1].rows, []); assertFrozen(report);
  };
  const before = h.counters(), sends = h.sockets[0].sent.length; h.trace.length = 0;
  h.sockets[0].message(setup, leaderboard, [120], leaderboard, v(2), v(1), leaderboard);
  assert.deepEqual(h.trace, ['packet', 'begin', 'native', 'release', 'hud', 'state']);
  assert.equal(commits, 1); assert.equal(controller.diagnostics().draws, 1);
  assert.deepEqual(h.counters(), { reads: before.reads + 1, decodes: before.decodes + 1 });
  assert.equal(h.sockets[0].sent.length, sends); assert.equal(h.errors.length, 0);
  const p = h.calls[0].plan;
  assert.deepEqual(p.finalCaptureIndices, []);
  assert.deepEqual(p.guards[6], { playing: true, closeRequested: true, deathPending: true });
});

test('all three modes preserve shared control folds, action revisions, lifecycle, sends, clock/decode counts', () => {
  const modes = [harness({ hud: false }), harness(), harness({ rows: true })];
  for (const h of modes) {
    h.connect();
    h.sockets[0].message(leaderboard, v(1), [112], v(1));
    const offer = h.session.pendingActions(); h.session.acknowledgeActions(offer);
    finishVictory(h);
    h.sockets[0].message(leaderboard, v(1));
    h.sockets[0].message(setup, leaderboard, v(2), v(1), leaderboard);
    h.step(4000); h.session.commitControl();
  }
  for (const h of modes.slice(1)) {
    assert.deepEqual(h.session.snapshot(), modes[0].session.snapshot());
    assert.deepEqual(h.session.pendingActions(), modes[0].session.pendingActions());
    assert.deepEqual(h.sockets.map(s => s.sent), modes[0].sockets.map(s => s.sent));
    assert.deepEqual(h.counters(), modes[0].counters());
  }
  for (const h of modes.slice(1)) {
    assert.equal(h.reports[2].events.length, 0, 'nonplaying row command and final capture omitted');
    if (h === modes[2]) {
      assert.deepEqual(h.reports[2].leaderboardRows, []);
      assert(h.calls.every(c => c.plan.schema === 2));
    } else {
      assert(!Object.hasOwn(h.reports[2], 'leaderboardRows'));
      assert(h.calls.every(c => c.plan.schema === 1));
    }
  }
});

test('valid wrong-mode reports and malformed/mismatched sidecars reject before staged controls commit', () => {
  for (const rows of [false, true]) {
    const h = harness({ rows }); h.start();
    h.hooks.packet = (bytes, elapsed, plan) => reportFor(decode(bytes), { ...plan, schema: rows ? 1 : 2 });
    h.sockets[0].message(setup, v(1), leaderboard);
    assert.equal(h.session.snapshot().lifeEnded, false); assert.equal(h.reports.length, 0);
    assert.equal(h.errors.length, 1); assert.match(h.errors[0].message, /Invalid HUD data/);
  }
  for (const mutate of [
    r => { r.leaderboardRows = []; }, r => { r.leaderboardRows.reverse(); },
    r => { r.leaderboardRows[0].commandIndex = 0; }, r => { r.leaderboardRows[1].commandIndex = 1; },
    r => { r.leaderboardRows.push({ commandIndex: 2, rows: [] }); },
    r => { r.leaderboardRows[0].rows = [rawRow(2)]; },
    r => { r.leaderboardRows[0].rows = [rawRow(1, new Array(256).fill(0))]; },
  ]) {
    const h = harness({ rows: true }); h.start();
    h.hooks.packet = (bytes, elapsed, plan) => { const r = reportFor(decode(bytes), plan); mutate(r); return r; };
    h.sockets[0].message(setup, leaderboard, v(1), leaderboard);
    assert.equal(h.session.snapshot().phase, 'failed'); assert.equal(h.session.snapshot().lifeEnded, false);
    assert.equal(h.reports.length, 0); assert.equal(h.calls.length, 1); assert.equal(h.errors.length, 1);
  }
});

test('row membership cannot smuggle a board for a nonplaying command', () => {
  const h = harness({ rows: true }); h.connect(v(1)); finishVictory(h);
  h.hooks.packet = () => ({ schema: 2, commandCount: 1, setupDraws: 0,
    events: [{ commandIndex: 0, kind: 'leaderboard', localRow: 0, rank: 0, population: 0, deathPending: false }],
    leaderboardRows: [{ commandIndex: 0, rows: [rawRow()] }] });
  h.sockets[0].message(leaderboard);
  assert.equal(h.session.snapshot().phase, 'failed'); assert.equal(h.errors.length, 1);
});

test('row reflection reentry and transport termination are checked again before control commit', () => {
  for (const stop of [false, true]) {
    const h = harness({ rows: true }); h.start();
    h.hooks.packet = (bytes, elapsed, plan) => {
      const r = reportFor(decode(bytes), plan);
      r.leaderboardRows[0].rows = [rawRow(1, new Proxy([65], { ownKeys(target) {
        assert.throws(() => h.session.close(), /reentry/);
        assert.throws(() => h.session.commitControl(), /reentry/);
        assert.throws(() => h.session.afterStepWithHud({ nowMs: 1000, delta: 1, wholeSteps: 1 }), /reentry/);
        if (stop) h.sockets[0].onclose();
        return Reflect.ownKeys(target);
      } }))];
      return r;
    };
    h.sockets[0].message(setup, v(1), leaderboard);
    assert.equal(h.session.snapshot().phase, stop ? 'disconnected' : 'victory');
    assert.equal(h.session.snapshot().lifeEnded, !stop); assert.equal(h.reports.length, stop ? 0 : 1);
  }
});

test('new row callback inherits synchronous result/reentry checks and postcommit no-replay failure semantics', () => {
  for (const site of ['packet', 'report', 'hud', 'state']) for (const primary of [undefined, null, false, 0, Symbol('primary')]) {
    const h = harness({ rows: true }); h.start();
    if (site === 'report') h.hooks.packet = (bytes, elapsed, plan) => {
      const r = reportFor(decode(bytes), plan);
      r.leaderboardRows[0].rows = [rawRow(1, new Proxy([65], { ownKeys() { throw primary; } }))]; return r;
    };
    else h.hooks[site] = () => { throw primary; };
    h.hooks.close = () => { throw new Error('secondary close'); };
    h.hooks.error = () => { throw new Error('secondary error'); };
    const socket = h.sockets[0], late = socket.onmessage;
    socket.message(setup, v(1), leaderboard);
    assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary);
    assert.equal(h.session.snapshot().lifeEnded, site === 'hud' || site === 'state');
    assert.equal(socket.closes, 1);
    late({ data: frame([setup, leaderboard]) });
    assert.equal(h.calls.length, 1); assert.equal(socket.closes, 1); assert.equal(h.sockets.length, 1);
  }
  let reads = 0;
  for (const result of [false, {}, Promise.resolve(), Object.defineProperty({}, 'then', { get() { reads++; } })]) {
    const h = harness({ rows: true }); h.start(); h.hooks.hud = () => result;
    h.sockets[0].message(setup, v(1), leaderboard);
    assert.equal(h.errors.length, 1); assert.equal(h.reports.length, 1);
    assert.equal(h.session.snapshot().lifeEnded, true);
  }
  assert.equal(reads, 0);
  const h = harness({ rows: true }); h.start();
  h.hooks.hud = () => {
    assert.equal(h.session.snapshot().playing, true);
    for (const mutation of [() => h.session.close(), () => h.session.pendingActions(),
      () => h.session.commitControl(), () => h.session.uiTick(1000)]) assert.throws(mutation, /reentry/);
  };
  h.sockets[0].message(setup, leaderboard); assert.equal(h.errors.length, 0);
});

test('row unsubscribe blocks later delivery and cannot renew owner or Play', () => {
  const h = harness({ rows: true }); h.connect();
  const count = h.reports.length, socket = h.sockets[0], late = socket.onmessage;
  h.unsubscribe(); h.unsubscribe();
  socket.message(leaderboard); late({ data: frame([leaderboard]) });
  assert.equal(h.reports.length, count);
  for (const method of subscriptionMethods) assert.throws(() => h.session[method](subscriberFor(h, method)), /subscriber/);
  assert.throws(() => h.session.play(request())); assert.equal(h.sockets.length, 1);
});
