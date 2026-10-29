import { TestDesktopInput } from './fixtures/client-input-fixture.mjs';
import { HudHistoryDouble } from './hud-history-double.mjs';
// Authored session + gameplay + actual controller with native/Wasm/source doubles.
// No real socket, native/Wasm execution, reference, browser or score calculation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockGameplay } from '../web/stock-gameplay.mjs';
import { createStockClient } from '../web/stock-client.mjs';

const nativeName = 'apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud';
const request = () => ({ endpoint: 'ws://192.0.2.9:1234/slither',
  profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 },
  nickname: 'Synthetic', skin: 0, customSkin: new Uint8Array() });
const frame = commands => Uint8Array.from(commands.length === 1 ? commands[0] : commands.flatMap((c, i) =>
  i === 0 ? [0, c.length, ...c] : [c.length + 32, ...c])).buffer;
const scoreView = (score = -0) => ({ schema: 1, enabled: true, tableMax: 17,
  own: { token: 1n, id: 7, logicalSegments: 4, fractionalMass: .5, scoreAdjustment: 3, scoreIndex: 7 },
  status: 'ready', score, error: null });
function journal(commands, plan) {
  const events = [];
  let setupDraws = 0;
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
    const command = commands[commandIndex];
    if (command[0] === 97) {
      setupDraws++;
      events.push({ commandIndex, kind: 'setup', tableMax: 17 },
        { commandIndex, kind: 'setup-draw', view: scoreView() });
    } else if (command[0] === 108 && plan.guards[commandIndex].playing) {
      events.push({ commandIndex, kind: 'leaderboard', localRow: 2, rank: 0, population: 33,
        deathPending: plan.guards[commandIndex].deathPending });
    } else if (plan.finalCaptureIndices.includes(commandIndex)) {
      events.push({ commandIndex, kind: 'final-score', view: scoreView(-41) });
    } else if ([115, 104].includes(command[0])) {
      events.push({ commandIndex, kind: 'own-length-scheduled', token: 1n });
    }
  }
  return { schema: 1, commandCount: commands.length, setupDraws, events };
}
function harness({ hud = true, callback, configure, controllerOverride } = {}) {
  const trace = [], pending = [], errors = [], statuses = [], sockets = [], intervals = new Map();
  const faults = {};
  let time = 0, held = false, borrowed = false, ingress = false, nativeConnected = false;
  let commands, decodes = 0, commits = 0, lastNative, forwardedPlan, serial = 0;
  const outside = () => { assert(!borrowed, 'native borrow released'); assert(!held, 'held capture released'); assert(!ingress, 'session ingress unwound'); };
  const scene = {
    control_view() { assert(!borrowed); return { own: null, follows: true, camera: { x: 0, y: 0 }, zoom: 1 }; },
    set_connected(value) { outside(); trace.push('set-connected'); nativeConnected = value; },
    reset_lag() { outside(); trace.push('reset-lag'); },
    advance() { assert.fail('production uses same-step control'); },
    set_gaze_heading() { assert.fail('gaze is returned by control'); },
    advance_with_control(nowMs, lagging, control) {
      assert(!borrowed); trace.push(['clock', nowMs, lagging]); borrowed = true;
      try {
        const actions = control({ nowMs, wholeSteps: 1, delta: 1, control: scene.control_viewForTest });
        trace.push(['actions', actions]);
        if (actions.resetWorld) { nativeConnected = false; trace.push('reset-world'); }
        if (actions.connected !== undefined) nativeConnected = actions.connected;
        trace.push('motion');
      } finally { borrowed = false; }
      return { free() { assert(!borrowed); trace.push('free-step'); } };
    },
    control_viewForTest: { own: null, follows: true, camera: { x: 0, y: 0 }, zoom: 1 },
    render_standard_with_face_presentation_at_size() { assert(held); assert(!borrowed); trace.push('render'); },
    apply_frame_and_render_standard_with_face_presentation_and_prey() {
      trace.push('legacy-packet'); commits++; return commands.filter(c => c[0] === 97).length;
    },
    enable_score_tracking() { assert.fail('no implicit score opt-in'); },
    score_view() { assert.fail('no score read or recomputation'); },
  };
  if (hud) scene[nativeName] = (...args) => {
    assert(held); assert(!borrowed); borrowed = true; trace.push('hud-native'); lastNative = args;
    try {
      if (faults.nativeEffect) faults.nativeEffect();
      if (Object.hasOwn(faults, 'native')) throw faults.native;
      const report = journal(commands, args[15]);
      faults.report?.(report);
      commits++; trace.push('native-commit'); return report;
    } finally { borrowed = false; trace.push('native-return'); }
  };
  const quality = {
    begin_connection() { outside(); trace.push('quality-connection'); },
    advance(_step, playing) { assert(!borrowed); trace.push(['quality', playing]); },
    update_statistics(_now, count, playing) { assert(!borrowed); trace.push(['statistics', count, playing]); return false; },
  };
  const controller = createStockClient({ scene, quality,
    adapter: {
      beginOperation() { assert(!held); held = true; trace.push('begin'); return { revision: 'authored' }; },
      endOperation() { assert(held); held = false; trace.push('release'); if (Object.hasOwn(faults, 'release')) throw faults.release; },
      resolveAppearance() {}, resolveRecipe() {}, resolveAntennaRandom() {},
    },
    hostAssets: { resolveFood() {}, resolvePrey() {} },
    target: {}, palettes: [{}, {}, {}], background: {}, width: 960, height: 540,
  });
  const routed = { packet: (...args) => controller.packet(...args), frame: (...args) => controller.frame(...args) };
  if (hud) routed.packetWithHud = (...args) => {
    forwardedPlan = args[2]; trace.push('hud-route'); const result = controller.packetWithHud(...args); trace.push('packet-return'); return result;
  };
  const options = { scene, quality, controller: controllerOverride ?? routed,
    wasm: { DesktopInput: TestDesktopInput, HudHistory: HudHistoryDouble,
      encode_login() { return Uint8Array.of(115, 1); }, solve_challenge() { return new Uint8Array(27); },
      setup_protocol_version() { return 19; },
      decode_frame(bytes) {
        decodes++; trace.push('decode'); commands = [];
        if (bytes[0] >= 32) commands.push([...bytes]);
        else for (let i = 0; i < bytes.length;) {
          const prefix = bytes[i++], length = prefix < 32 ? prefix * 256 + bytes[i++] : prefix - 32;
          commands.push([...bytes.slice(i, i + length)]); i += length;
        }
        return Uint8Array.from(commands.flatMap(c => [0, 0, 0, c.length, ...c]));
      },
    },
    createSocket() {
      outside(); trace.push('construct');
      const socket = { readyState: 0, bufferedAmount: 0, sent: [], closes: 0,
        send(bytes) { this.sent.push([...bytes]); trace.push(['send', [...bytes]]); },
        close() { this.closes++; this.readyState = 3; trace.push('close'); if (Object.hasOwn(faults, 'close')) throw faults.close; },
        open() { this.readyState = 1; ingress = true; try { this.onopen?.(); } finally { ingress = false; } },
        message(...parts) { ingress = true; try { this.onmessage?.({ data: frame(parts) }); } finally { ingress = false; } },
      };
      sockets.push(socket); return socket;
    },
    now: () => time,
    defer(fn) { trace.push('defer'); pending.push(fn); },
    setInterval(fn, ms) { outside(); assert.equal(ms, 25); const id = ++serial; intervals.set(id, fn); return id; },
    clearInterval(id) { outside(); intervals.delete(id); },
    onStatus(value) { outside(); statuses.push(value); trace.push('status'); },
    onFatal(error) { outside(); errors.push(error); trace.push('fatal'); },
    ...(hud ? { onHudPacket: callback === undefined ? (report => { trace.push('hud-observed'); assert(Object.isFrozen(report)); }) : callback } : {}),
  };
  configure?.(options, { trace, scene, routed, faults });
  const gameplay = createStockGameplay(options);
  function flush() { let budget = 100; while (pending.length) { assert(budget-- > 0); pending.shift()(); } }
  function start() {
    gameplay.play(request()); assert.equal(sockets.length, 0);
    gameplay.frame(8); assert.equal(sockets.length, 1); flush();
    sockets[0].open(); sockets[0].message([54, 1]); flush();
  }
  return { gameplay, controller, options, scene, quality, faults, trace, sockets, errors, statuses, pending, intervals,
    flush, start, setTime(value) { time = value; },
    get held() { return held; }, get borrowed() { return borrowed; }, get ingress() { return ingress; },
    get decodes() { return decodes; }, get commits() { return commits; },
    get lastNative() { return lastNative; }, get forwardedPlan() { return forwardedPlan; } };
}

test('actual HUD composition forwards plan, holds/release once, publishes copied data after packet completion and defers native reconciliation', () => {
  let h, observed, calls = 0;
  h = harness({ callback(report) {
    calls++; observed = report; h.trace.push('hud-callback');
    assert(!h.held); assert(!h.borrowed); assert(h.ingress);
    assert.equal(h.gameplay.diagnostics().session.connected, true, 'session controls committed before observer');
    assert.equal(h.gameplay.diagnostics().active, true);
    assert(Object.isFrozen(report.events[1].view.own)); assert(Object.is(report.events[1].view.score, -0));
  } });
  h.start(); const start = h.trace.length, decodes = h.decodes;
  h.sockets[0].message([97], [115, 0, 7], [108, 2, 0, 17, 0, 33], [118, 1]);
  assert.equal(calls, 1); assert.equal(h.decodes - decodes, 1); assert.equal(h.commits, 1);
  assert.equal(h.lastNative.length, 16); assert.equal(h.lastNative[1], false);
  assert.notEqual(h.lastNative[15], h.forwardedPlan); assert.deepEqual(h.lastNative[15], h.forwardedPlan);
  assert.deepEqual(h.forwardedPlan.guards, [
    { playing: false, closeRequested: false, deathPending: false },
    ...Array.from({ length: 3 }, () => ({ playing: true, closeRequested: false, deathPending: false })),
  ]);
  assert.deepEqual(h.forwardedPlan.finalCaptureIndices, [3]);
  assert.deepEqual(observed.events.map(e => [e.commandIndex, e.kind]), [[0, 'setup'], [0, 'setup-draw'],
    [1, 'own-length-scheduled'], [2, 'leaderboard'], [3, 'final-score']]);
  assert.deepEqual(h.trace.slice(start), ['decode', 'hud-route', 'begin', 'hud-native', 'native-commit',
    'native-return', 'release', 'packet-return', 'hud-callback', 'defer']);
  assert.equal(h.intervals.size, 0); assert.equal(h.controller.diagnostics().draws, 2, 'one initial frame plus one Setup');
  h.flush(); assert.equal(h.intervals.size, 1); assert(h.trace.includes('reset-lag')); assert(h.trace.includes('set-connected'));
  assert.equal(h.errors.length, 0); h.gameplay.dispose();
});

test('absence and explicit undefined retain legacy packet/native requirements and numeric dispatch', () => {
  for (const explicit of [false, true]) {
    const h = harness({ hud: false, configure(options, { scene, routed }) {
      if (explicit) options.onHudPacket = undefined;
      Object.defineProperty(scene, nativeName, { get() { assert.fail('new native capability'); } });
      Object.defineProperty(routed, 'packetWithHud', { get() { assert.fail('new controller capability'); } });
    } });
    h.start(); h.sockets[0].message([97], [112]); h.flush();
    assert.equal(h.commits, 1); assert(h.trace.includes('legacy-packet')); assert(!h.trace.includes('hud-route'));
    assert.equal(h.gameplay.diagnostics().session.playing, true); assert.equal(h.errors.length, 0); h.gameplay.dispose();
  }
});

test('callback and controller capabilities validate before session construction/subscription', () => {
  for (const callback of [null, 0, {}, Promise.resolve(), async () => {}, function* () {}, async function* () {}]) {
    assert.throws(() => harness({ callback, configure(options) {
      Object.defineProperty(options.wasm, 'decode_frame', { get() { assert.fail('session not yet constructed'); } });
    } }), /Synchronous onHudPacket/);
  }
  assert.throws(() => harness({ controllerOverride: { packet() {}, frame() {} }, configure(options) {
    Object.defineProperty(options.wasm, 'decode_frame', { get() { assert.fail('session not yet constructed'); } });
  } }), /packetWithHud/);
});

test('HUD callback admission avoids callback getters, bounds arbitrary prototype chains and detects cycles', () => {
  const callback = () => {};
  for (const name of ['then', Symbol.toStringTag, 'constructor']) Object.defineProperty(callback, name, { get() { assert.fail('callback getter'); } });
  const h = harness({ callback }); h.start(); h.sockets[0].message([97]); h.flush(); assert.equal(h.errors.length, 0); h.gameplay.dispose();
  let cyclic, calls = 0;
  cyclic = new Proxy(() => {}, { getPrototypeOf() { calls++; return cyclic; } });
  assert.throws(() => harness({ callback: cyclic }), /Synchronous/); assert.equal(calls, 2);
  calls = 0;
  const fresh = () => new Proxy({}, { getPrototypeOf() { calls++; return fresh(); } });
  const endless = new Proxy(() => {}, { getPrototypeOf() { calls++; return fresh(); } });
  assert.throws(() => harness({ callback: endless }), /Synchronous/); assert.equal(calls, 64);
  for (const fn of [async () => {}, function* () {}, async function* () {}]) {
    Object.setPrototypeOf(fn, Function.prototype);
    assert.throws(() => harness({ callback: fn }), /Synchronous/);
  }
  for (const primary of [undefined, null, new Error('prototype trap')]) {
    let caught = false;
    try { harness({ callback: new Proxy(() => {}, { getPrototypeOf() { throw primary; } }) }); }
    catch (error) { caught = true; assert.equal(error, primary); }
    assert(caught);
  }
});

test('HUD callback runs under active guard: frame/event/play/dispose/live-profile reentry reject; copied reads remain available', async () => {
  let h, rejected;
  h = harness({ callback(report) {
    assert(Object.isFrozen(report)); assert.equal(h.gameplay.diagnostics().active, true);
    for (const call of [() => h.gameplay.frame(9), () => h.gameplay.event({ type: 'blur' }),
      () => h.gameplay.play(request()), () => h.gameplay.dispose()]) assert.throws(call, /reentry|reentrant/);
    rejected = h.gameplay.playWithLiveProfile({}).catch(error => error);
  } });
  h.start(); h.sockets[0].message([97]); h.flush();
  assert.match(String(await rejected), /reentrant/); assert.equal(h.errors.length, 0);
  assert.equal(h.gameplay.diagnostics().active, false); h.gameplay.dispose();
});

test('nonundefined/Promise HUD returns fail without reading then, exactly once after release', () => {
  for (const result of [null, false, 0, 1, Promise.resolve(),
    Object.defineProperty({}, 'then', { get() { assert.fail('must not read then'); } })]) {
    let calls = 0;
    const h = harness({ callback() { calls++; return result; } }); h.start();
    h.sockets[0].message([97]);
    assert.equal(h.errors.length, 0); assert.equal(calls, 1); assert.equal(h.gameplay.diagnostics().session.phase, 'failed');
    assert.equal(h.commits, 1); assert(!h.held); assert(!h.borrowed);
    h.flush(); assert.equal(h.errors.length, 1); assert.match(String(h.errors[0]), /return undefined/);
    assert.equal(h.sockets[0].closes, 1); assert.equal(h.gameplay.diagnostics().disposed, true);
    assert.throws(() => h.gameplay.frame(20), /stopped/); assert.equal(calls, 1);
  }
});

test('HUD observer primary values survive terminal close failure, deferred cleanup and onFatal by exact identity', () => {
  for (const primary of [undefined, null, false, 0, new Error('observer')]) {
    let calls = 0, h;
    h = harness({ callback() {
      calls++; assert(!h.held); assert(!h.borrowed); throw primary;
    } }); h.start();
    h.faults.close = new Error('secondary close');
    h.sockets[0].message([97], [118, 1]);
    assert.equal(h.errors.length, 0); assert.equal(calls, 1); assert.equal(h.commits, 1);
    assert.equal(h.gameplay.diagnostics().session.lifeEnded, true, 'controls committed before observer failure');
    assert.equal(h.gameplay.diagnostics().session.phase, 'failed'); assert.equal(h.sockets[0].closes, 1);
    h.flush(); assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary);
    assert.equal(h.gameplay.diagnostics().disposed, true); assert.equal(h.sockets[0].closes, 1);
    assert.equal(h.trace.filter(x => x === 'fatal').length, 1); assert.equal(h.trace.filter(x => x === 'reset-lag').length, 0);
  }
});

test('controller failure and release-only failure withhold HUD, preserve primary and prohibit replay/socket commit', () => {
  for (const failure of ['native', 'release']) for (const primary of [undefined, null, new Error('primary')]) {
    let calls = 0;
    const h = harness({ callback() { calls++; } }); h.start(); const releases = h.trace.filter(x => x === 'release').length;
    h.faults[failure] = primary;
    if (failure === 'native') h.faults.release = new Error('secondary release');
    h.faults.close = new Error('secondary close');
    h.sockets[0].message([97], [118, 1]);
    assert.equal(calls, 0); assert.equal(h.errors.length, 0);
    assert.equal(h.commits, failure === 'release' ? 1 : 0, 'outer failure cannot roll native state back');
    assert.equal(h.trace.filter(x => x === 'release').length, releases + 1);
    assert.equal(h.gameplay.diagnostics().session.lifeEnded, false);
    assert.equal(h.gameplay.diagnostics().session.phase, 'failed'); assert(!h.held); assert(!h.borrowed);
    h.flush(); assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary); assert.equal(h.sockets[0].closes, 1);
    assert.throws(() => h.gameplay.frame(20), /stopped/); assert.equal(h.sockets.length, 1);
  }
});

test('same-stack native reentry fails terminally before replay and held capture still releases', () => {
  let h, calls = 0;
  h = harness({ callback() { calls++; } }); h.start();
  h.faults.nativeEffect = () => h.gameplay.frame(9);
  h.sockets[0].message([97]); assert.equal(calls, 0); assert(!h.held); assert(!h.borrowed);
  h.flush(); assert.equal(h.errors.length, 1); assert.match(String(h.errors[0]), /reentrant/);
  assert.equal(h.sockets[0].closes, 1); assert.equal(h.commits, 0);
});

test('same-stack socket close wins over staged controls; detached stale callbacks cannot replay', () => {
  let calls = 0;
  const h = harness({ callback() { calls++; } }); h.start();
  const stale = h.sockets[0].onmessage;
  h.faults.nativeEffect = () => h.sockets[0].onclose();
  h.sockets[0].message([97], [118, 1]);
  assert.equal(calls, 0); assert.equal(h.commits, 1); assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
  assert.equal(h.gameplay.diagnostics().session.connected, false); assert.equal(h.gameplay.diagnostics().session.playing, false);
  assert.equal(h.gameplay.diagnostics().session.lifeEnded, false); assert.equal(h.errors.length, 0);
  const decodes = h.decodes; stale({ data: frame([[97]]) }); assert.equal(h.decodes, decodes);
  h.flush(); assert.equal(h.errors.length, 0); assert.equal(h.sockets[0].closes, 1); h.gameplay.dispose();
});

const invalidReports = [
  ['missing Setup', r => { r.events = []; r.setupDraws = 0; }],
  ['missing final', r => { r.events = r.events.filter(e => e.kind !== 'final-score'); }],
  ['missing leaderboard', r => { r.events = r.events.filter(e => e.kind !== 'leaderboard'); }],
  ['wrong death guard', r => { r.events.find(e => e.kind === 'leaderboard').deathPending = true; }],
  ['extra final at opaque', r => { r.events.push({ commandIndex: 4, kind: 'final-score', view: scoreView() }); }],
  ['illegal schedule at opaque', r => { r.events.push({ commandIndex: 4, kind: 'own-length-scheduled', token: 1n }); }],
  ['getter', r => { Object.defineProperty(r, 'setupDraws', { get() { assert.fail('getter'); } }); }],
  ['count mismatch', r => { r.commandCount++; }],
  ['out of order', r => { r.events.reverse(); }],
];
for (const [name, change] of invalidReports) test(`invalid native/session report ${name} publishes no HUD or accepted controls`, () => {
  let calls = 0;
  const h = harness({ callback() { calls++; } }); h.start(); h.faults.report = change;
  h.sockets[0].message([97], [115], [108, 2, 0, 17, 0, 33], [118, 1], [120]);
  assert.equal(calls, 0); assert.equal(h.errors.length, 0); assert.equal(h.gameplay.diagnostics().session.phase, 'failed');
  assert.equal(h.gameplay.diagnostics().session.lifeEnded, false); assert.equal(h.commits, 1);
  assert(!h.held); assert(!h.borrowed); h.flush(); assert.equal(h.errors.length, 1); assert.equal(h.sockets[0].closes, 1);
});

test('opaque controls/repeated victory/v2 guards pass through without new clocks, draws or score lookup', () => {
  const batches = [];
  const h = harness({ callback(report) { batches.push(report); } }); h.start();
  h.sockets[0].message([97], [115], [120], [118, 1], [104], [118, 1], [97]);
  assert.deepEqual(h.forwardedPlan.finalCaptureIndices, [3, 5]);
  assert.equal(h.forwardedPlan.guards[5].deathPending, true);
  assert.equal(batches[0].setupDraws, 2);
  assert.equal(batches[0].events.filter(e => e.kind === 'final-score').length, 2);
  const clocks = h.trace.filter(e => Array.isArray(e) && e[0] === 'clock').length;
  const draws = h.controller.diagnostics().draws;
  h.sockets[0].message([118, 2], [118, 1], [108, 0, 0, 0, 0, 0]);
  assert.deepEqual(h.forwardedPlan.finalCaptureIndices, []);
  assert.equal(batches[1].setupDraws, 0); assert.equal(h.controller.diagnostics().draws, draws);
  assert.equal(h.trace.filter(e => Array.isArray(e) && e[0] === 'clock').length, clocks);
  assert.equal(h.errors.length, 0); h.flush(); h.gameplay.dispose();
});

test('HUD opt-in preserves reset/quality/render/release before first socket and pong/v lag-reset order', () => {
  const h = harness();
  assert.deepEqual(h.trace, []); h.start();
  const names = h.trace.filter(x => typeof x === 'string');
  assert(names.indexOf('quality-connection') < names.indexOf('reset-world'));
  assert(names.indexOf('reset-world') < names.indexOf('render'));
  assert(names.indexOf('render') < names.indexOf('release'));
  assert(names.indexOf('release') < names.indexOf('construct'));
  h.sockets[0].message([97]); h.flush();
  h.setTime(300); h.gameplay.frame(300); h.flush();
  assert.deepEqual(h.sockets[0].sent.at(-1), [251]);
  h.sockets[0].message([112]); h.flush(); assert.equal(h.trace.filter(x => x === 'reset-lag').length, 0);
  h.sockets[0].message([118, 1]); assert.equal(h.trace.filter(x => x === 'reset-lag').length, 0);
  h.flush(); assert.equal(h.trace.filter(x => x === 'reset-lag').length, 1);
  h.gameplay.frame(320); h.flush(); assert.equal(h.trace.filter(x => x === 'reset-lag').length, 1);
  assert.equal(h.errors.length, 0); assert.equal(h.gameplay.diagnostics().session.playing, true);
  h.gameplay.dispose();
});

test('report reflection can close transport but cannot resurrect staged Setup or publish observer', () => {
  let calls = 0;
  const h = harness({ callback() { calls++; } }); h.start();
  h.faults.report = report => {
    const events = report.events;
    report.events = new Proxy(events, { ownKeys(value) { h.sockets[0].onclose?.(); return Reflect.ownKeys(value); } });
  };
  h.sockets[0].message([97]);
  assert.equal(calls, 0); assert.equal(h.commits, 1); assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
  assert.equal(h.gameplay.diagnostics().session.connected, false); assert.equal(h.gameplay.diagnostics().session.playing, false);
  assert(!h.held); assert(!h.borrowed); h.flush(); assert.equal(h.errors.length, 0);
  assert.equal(h.sockets[0].closes, 1); h.gameplay.dispose();
});
