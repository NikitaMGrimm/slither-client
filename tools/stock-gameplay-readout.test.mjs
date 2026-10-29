import { TestSessionPolicy } from './fixtures/session-policy-double.mjs';
import { ProfileLiteralParserDouble } from './fixtures/profile-literals-double.mjs';
import { TestDesktopInput } from './fixtures/client-input-fixture.mjs';
import { HudHistoryDouble } from './hud-history-double.mjs';
// Authored composition fixtures: actual session/input/controller/reducer, native/source/clock doubles.
// Scores are explicit observations, never a second score formula or a protocol implementation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockGameplay } from './fixtures/stock-gameplay-fixture.mjs';
import { createStockClient } from './fixtures/stock-client-fixture.mjs';

const nativeName = 'apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud';
const login = () => ({ endpoint: 'ws://192.0.2.9:1234/slither',
  profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 },
  nickname: 'Authored HUD', skin: 0, customSkin: new Uint8Array() });
const own = (token = 1n) => ({ token, id: 7, rawHead: { x: 300, y: 400 }, wantedHeading: .4,
  gazeHeading: 0, dead: false, turnRate: .03, sizeTurnFactor: 1, speedTurnFactor: 1 });
const ready = (score = -0, token = 1n) => ({ schema: 1, enabled: true, tableMax: 17,
  own: { token, id: 7, logicalSegments: 4, fractionalMass: .5, scoreAdjustment: 3, scoreIndex: 7 },
  status: 'ready', score, error: null });
const noOwn = () => ({ schema: 1, enabled: true, tableMax: 17, own: null, status: 'no-own', score: null, error: null });
const header = (rank = 7, population = 23) => [108, 2, rank >> 8, rank & 255, population >> 8, population & 255];
const frame = commands => Uint8Array.from(commands.length === 1 ? commands[0] : commands.flatMap((c, i) =>
  i === 0 ? [c.length >> 8, c.length & 255, ...c] : [c.length + 32, ...c])).buffer;
function caught(callback) {
  let present = false, value;
  try { callback(); } catch (error) { present = true; value = error; }
  assert(present, 'Expected thrown value, including undefined');
  return value;
}

function harness({ mode = true, callback, configure } = {}) {
  const trace = [], pending = [], errors = [], sockets = [], intervals = new Map(), faults = {};
  let time = 0, held = false, borrowed = false, ingress = false, serial = 0;
  let commands = [], commits = 0, scoreReads = 0, nativeConnected = false, currentOwn = null;
  let observedView = ready(), gameplay;
  const outside = () => { assert(!held, 'source capture released'); assert(!borrowed, 'native borrow released'); assert(!ingress, 'ingress unwound'); };
  function hit(name) {
    trace.push(name);
    faults[`${name}Effect`]?.();
    if (Object.hasOwn(faults, name)) throw faults[name];
  }
  const controlView = () => ({ own: currentOwn, follows: true, camera: { x: 0, y: 0 }, zoom: 1 });
  const scene = {
    control_view() { outside(); hit('control-view'); return controlView(); },
    set_connected(value) { outside(); hit('set-connected'); nativeConnected = value; },
    reset_lag() { outside(); hit('reset-lag'); },
    enable_score_tracking() { assert.fail('score tracking remains explicit caller ownership'); },
    score_view() { outside(); scoreReads++; hit('score'); return observedView; },
    observe_minimap_ui_fraction(value) { outside(); trace.push(['minimap-ui-fraction', value]); },
    advance() { assert.fail('one same-step native clock only'); },
    set_gaze_heading() { assert.fail('gaze must return through native control'); },
    advance_with_control(nowMs, lagging, callback) {
      assert(held); assert(!borrowed); trace.push(['clock', nowMs, lagging]);
      borrowed = true;
      try {
        const request = { nowMs, wholeSteps: faults.wholeSteps ?? 1, delta: faults.delta ?? 1, control: controlView() };
        hit('before-control');
        const actions = callback(request);
        assert(Object.keys(actions).every(key => ['gazeHeading', 'resetWorld', 'resetLag', 'connected', 'minimapUiFraction'].includes(key)));
        trace.push(['actions', actions]); hit('after-control');
        if (actions.resetWorld) { currentOwn = null; nativeConnected = false; hit('reset-world'); }
        if (actions.connected !== undefined) nativeConnected = actions.connected;
        hit('motion');
      } finally { borrowed = false; }
      return { free() { assert(!borrowed); hit('free'); } };
    },
    render_standard_with_face_presentation_at_size() { assert(held); assert(!borrowed); hit('render'); },
    apply_frame_and_render_standard_with_face_presentation_and_prey() {
      assert(held); hit('legacy-packet'); commits++; return commands.filter(c => c[0] === 97).length;
    },
    [nativeName](...args) {
      assert(held); assert(!borrowed); borrowed = true;
      try {
        hit('packet');
        const plan = args[15], events = [];
        let setupDraws = 0, setupIndex = 0, finalIndex = 0;
        commands.forEach((command, commandIndex) => {
          const opcode = command[0];
          if (opcode === 97) {
            setupDraws++;
            events.push({ commandIndex, kind: 'setup', tableMax: 17 },
              { commandIndex, kind: 'setup-draw', view: faults.setupViews?.[setupIndex++] ?? noOwn() });
          } else if (opcode === 108 && plan.guards[commandIndex].playing) {
            events.push({ commandIndex, kind: 'leaderboard', localRow: command[1],
              rank: command[2] * 256 + command[3], population: command[4] * 256 + command[5],
              deathPending: plan.guards[commandIndex].deathPending });
          } else if (plan.finalCaptureIndices.includes(commandIndex)) {
            events.push({ commandIndex, kind: 'final-score', view: faults.finalViews?.[finalIndex++] ?? observedView });
          } else if ([115, 104, 114, 110, 78, 43].includes(opcode) && !faults.noOwnMarker) {
            events.push({ commandIndex, kind: 'own-length-scheduled', token: faults.token ?? 1n });
          }
        });
        const report = { schema: 1, commandCount: commands.length, setupDraws, events };
        faults.report?.(report); commits++; hit('native-commit'); return report;
      } finally { borrowed = false; }
    },
  };
  const quality = {
    begin_connection() { outside(); hit('quality-connection'); },
    advance(_step, playing) { assert(!borrowed); trace.push(['quality', playing]); hit('quality'); },
    update_statistics(_now, count, playing) { assert(!borrowed); trace.push(['statistics', count, playing]); hit('statistics'); return false; },
  };
  const controller = createStockClient({ scene, quality,
    adapter: {
      beginOperation() { assert(!held); held = true; hit('begin'); return { revision: 'authored' }; },
      endOperation() { assert(held); held = false; hit('release'); },
      resolveAppearance() {}, resolveRecipe() {}, resolveAntennaRandom() {},
    },
    hostAssets: { resolveFood() {}, resolvePrey() {} },
    target: {}, palettes: [{}, {}, {}], background: {}, width: 960, height: 540,
  });
  const routed = Object.fromEntries(['packet', 'packetWithHud', 'frame', 'render', 'resize'].map(name =>
    [name, (...args) => { const result = controller[name](...args); hit(`${name}-return`); return result; }]));
  const options = { scene, quality, controller: routed,
    wasm: { DesktopInput: TestDesktopInput, SessionPolicy: TestSessionPolicy, HudHistory: HudHistoryDouble, ProfileLiteralParser: ProfileLiteralParserDouble,
      encode_login() { return Uint8Array.of(115, 1); }, solve_challenge() { return new Uint8Array(27); },
      setup_protocol_version() { return 19; },
      decode_frame(bytes) {
        hit('decode'); commands = [];
        if (bytes[0] >= 32) commands.push([...bytes]);
        else for (let i = 0; i < bytes.length;) {
          const prefix = bytes[i++], length = prefix < 32 ? prefix * 256 + bytes[i++] : prefix - 32;
          commands.push([...bytes.slice(i, i + length)]); i += length;
        }
        return Uint8Array.from(commands.flatMap(c => [0, 0, c.length >> 8, c.length & 255, ...c]));
      },
    },
    createSocket() {
      outside(); hit('construct');
      const socket = { readyState: 0, bufferedAmount: 0, sent: [], closes: 0,
        send(bytes) { this.sent.push([...bytes]); trace.push(['send', [...bytes]]); hit('send'); },
        close() { this.closes++; this.readyState = 3; hit('close'); },
        open() { this.readyState = 1; ingress = true; try { this.onopen?.(); } finally { ingress = false; } },
        message(...parts) { ingress = true; try { this.onmessage?.({ data: frame(parts) }); } finally { ingress = false; } },
      };
      sockets.push(socket); return socket;
    },
    now: () => time,
    defer(fn) { hit('defer'); pending.push(fn); },
    setInterval(fn, ms) { outside(); assert.equal(ms, 25); hit('interval'); const id = ++serial; intervals.set(id, fn); return id; },
    clearInterval(id) { outside(); intervals.delete(id); hit('clear-interval'); },
    onStatus() { outside(); hit('status'); },
    onFatal(error) { outside(); errors.push(error); hit('fatal'); },
    ...(mode === 'absent' ? {} : { hudReadout: mode }),
    ...(callback === undefined ? {} : { onHudPacket: callback }),
  };
  configure?.(options, { scene, routed, faults, trace });
  gameplay = createStockGameplay(options);
  function flush() { let budget = 100; while (pending.length) { assert(budget-- > 0); pending.shift()(); } }
  function start() {
    gameplay.play(login()); gameplay.frame(8); flush();
    sockets[0].open(); sockets[0].message([54, 1]); flush();
  }
  function connected() { start(); sockets[0].message([97], [115], header()); flush(); }
  return { gameplay, controller, routed, options, scene, quality, faults, trace, pending, errors, intervals, sockets,
    flush, start, connected,
    at(value) { time = value; },
    interval(value) { time = value; for (const fn of [...intervals.values()]) fn(); },
    setView(view) { observedView = view; }, setOwn(value) { currentOwn = value; },
    get scoreReads() { return scoreReads; }, get commits() { return commits; }, get nativeConnected() { return nativeConnected; } };
}

// Entirely authored inert bytes; digest is a DOUBLE, not reference acquisition.
function profileEnvironment({ fetchResult, current = () => true } = {}) {
  const payload = new Uint8Array(224092).fill(32), allocations = [], timeouts = new Map();
  payload.set(new TextEncoder().encode('var v=17;'), 181647);
  payload.set(new TextEncoder().encode(`var k=[${Array.from({ length: 20 }, (_, i) => i).join(',')}];`), 181670);
  let reads = 0, fetches = 0;
  const capabilities = Object.freeze({
    fetch() { fetches++; return fetchResult ?? Promise.resolve({}); },
    digest() { return Promise.resolve(Uint8Array.from('5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095'.match(/../g), x => Number.parseInt(x, 16))); },
    createAbort: () => Object.freeze({ signal: {}, abort() {} }),
    setTimeout(fn) { timeouts.set(1, fn); return 1; }, clearTimeout(id) { timeouts.delete(id); }, now: () => 0,
    environment: () => Object.freeze({ origin: 'https://slither.io', topLevel: true, secureContext: true }),
    responseInfo: () => Object.freeze({ status: 200, type: 'basic', url: 'https://slither.io/s/game1107249518.js', redirected: false, body: {} }),
    getReader: () => ({}),
    read: () => Promise.resolve(++reads === 1 ? { done: false, value: payload.slice() } : { done: true, value: undefined }),
    cancelReader: () => Promise.resolve(), releaseReader() {},
    bytes: Object.freeze({
      allocate(n) { const bytes = new Uint8Array(n); allocations.push(bytes); return bytes; },
      length: bytes => bytes.length, copy: (target, bytes, offset) => target.set(bytes, offset), clear: bytes => bytes.fill(0),
    }),
  });
  return { liveProfile: { capabilities, isCurrentDocument: current }, allocations, get fetches() { return fetches; } };
}
const liveLogin = () => { const { profile: _profile, ...request } = login(); return request; };

for (const mode of ['absent', false]) test(`default neutrality (${mode}) and lazy draw methods`, () => {
  const h = harness({ mode, configure(options, { scene, routed }) {
    for (const [owner, key] of [[scene, 'score_view'], [routed, 'packetWithHud']]) {
      Object.defineProperty(owner, key, { get() { assert.fail('unused capability'); } });
    }
    delete routed.render; delete routed.resize;
  } });
  assert.equal(h.gameplay.hudSnapshot(), null);
  h.connected(); assert(h.trace.includes('legacy-packet')); assert.equal(h.errors.length, 0);
  assert.match(String(caught(() => h.gameplay.render())), /render/); h.flush();
  assert.equal(h.gameplay.hudSnapshot(), null);
});

test('packet-only callback remains independent of reducer mode', () => {
  let calls = 0;
  const h = harness({ mode: false, callback() { calls++; }, configure(_options, { scene }) {
    Object.defineProperty(scene, 'score_view', { get() { assert.fail('packet-only score capability'); } });
  } });
  h.connected(); assert.equal(calls, 1); assert.equal(h.gameplay.hudSnapshot(), null);
  assert(!h.trace.includes('legacy-packet')); h.gameplay.dispose();
});

test('readout construction validates explicit mode and required capabilities before session', () => {
  for (const mode of [null, 0, 1, {}, 'true']) assert.match(String(caught(() => harness({ mode }))), /boolean/);
  for (const capability of ['packetWithHud', 'score_view']) {
    assert.match(String(caught(() => harness({ configure(options, { scene, routed }) {
      delete (capability === 'score_view' ? scene : routed)[capability];
      Object.defineProperty(options.wasm, 'decode_frame', { get() { assert.fail('session construction'); } });
    } }))), new RegExp(capability));
  }
});

test('packet candidates coalesce, observers see prior commit, getter performs no work, run entry flushes', () => {
  let h, previous, calls = 0;
  h = harness({ callback() {
    calls++; assert.equal(h.gameplay.hudSnapshot(), previous); assert(h.gameplay.diagnostics().active);
    for (const invoke of [() => h.gameplay.frame(9), () => h.gameplay.render(), () => h.gameplay.resize(960, 540),
      () => h.gameplay.event({ type: 'blur' }), () => h.gameplay.play(login()), () => h.gameplay.dispose()]) {
      assert.match(String(caught(invoke)), /reentr/);
    }
  } });
  h.start(); previous = h.gameplay.hudSnapshot();
  h.sockets[0].message([97], [115], header(7, 23));
  h.sockets[0].message(header(3, 29));
  assert.equal(calls, 2); assert.equal(h.gameplay.hudSnapshot(), previous);
  const length = h.trace.length; h.gameplay.hudSnapshot(); assert.equal(h.trace.length, length);
  h.gameplay.event({ type: 'blur' });
  const state = h.gameplay.hudSnapshot();
  assert.equal(state.rank, 3); assert.equal(state.bestRank, 3); assert.equal(state.maxPopulation, 29);
  assert.equal(state.fade, 0); assert.equal(state.dirty, true); assert.equal(state.ownToken, 1n);
  assert(Object.isFrozen(state)); assert(Object.isFrozen(state.requestedOpacity));
  assert.equal(h.scoreReads, 0); h.flush(); assert.equal(h.gameplay.hudSnapshot(), state); h.gameplay.dispose();
});

test('late observer failure discards every coalesced packet candidate', () => {
  let h, fail = false;
  h = harness({ callback() { if (fail) throw undefined; } }); h.start();
  const previous = h.gameplay.hudSnapshot();
  h.sockets[0].message([97], [115], header()); fail = true;
  h.sockets[0].message(header(2, 30));
  assert.equal(h.gameplay.hudSnapshot(), previous); h.flush();
  assert.deepEqual(h.errors, [undefined]); assert.equal(h.gameplay.hudSnapshot(), null);
});

test('delayed reconciliation failure suppresses semantic publication', () => {
  const h = harness(); h.start(); const previous = h.gameplay.hudSnapshot();
  h.faults.status = new Error('late status'); h.sockets[0].message([97], [115], header());
  assert.equal(h.gameplay.hudSnapshot(), previous); h.flush();
  assert.deepEqual(h.errors, [h.faults.status]); assert.equal(h.gameplay.hudSnapshot(), null);
});

test('reconciliation reentry cannot publish pending HUD before the outer status observer succeeds', () => {
  let h, previous, armed = false;
  const primary = new Error('outer late observer');
  h = harness({ configure(options) {
    options.onStatus = () => {
      if (!armed) return;
      assert.equal(h.gameplay.hudSnapshot(), previous);
      assert.match(String(caught(() => h.gameplay.render())), /reentr/);
      assert.equal(h.gameplay.hudSnapshot(), previous);
      throw primary;
    };
  } });
  h.start(); previous = h.gameplay.hudSnapshot(); armed = true;
  h.sockets[0].message([97], [115], header()); h.flush();
  assert.deepEqual(h.errors, [primary]); assert.equal(h.scoreReads, 0); assert.equal(h.gameplay.hudSnapshot(), null);
});

test('render and same-size resize preserve results, release before required read, add no step/quality', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot();
  const from = h.trace.length;
  for (const key of ['renderEffect', 'releaseEffect', 'scoreEffect']) h.faults[key] = () => assert.equal(h.gameplay.hudSnapshot(), previous);
  h.setView(ready(-5)); const result = h.gameplay.render();
  assert.equal(result.draws, h.controller.diagnostics().draws); assert.equal(h.scoreReads, 1);
  assert.deepEqual(h.trace.slice(from), ['begin', 'render', 'release', 'render-return', 'score']);
  assert.deepEqual(h.gameplay.hudSnapshot().current, { score: -5, rank: 7, population: 23, ownToken: 1n });
  assert.equal(h.gameplay.hudSnapshot().dirty, false);
  for (const key of ['renderEffect', 'releaseEffect', 'scoreEffect']) delete h.faults[key];
  const clockCount = h.trace.filter(x => Array.isArray(x) && x[0] === 'clock').length;
  const resized = h.gameplay.resize(960, 540); assert.equal(resized.draws, result.draws + 1);
  assert.equal(h.scoreReads, 1); assert.equal(h.gameplay.hudSnapshot().fade, 0);
  assert.equal(h.trace.filter(x => Array.isArray(x) && x[0] === 'clock').length, clockCount);
  h.gameplay.dispose(); assert.equal(h.gameplay.hudSnapshot(), null); assert.equal(previous.dirty, true);
});

test('facades return controller object identity and acquire draw capabilities lazily', () => {
  const renderResult = {}, resizeResult = {};
  const h = harness({ mode: false, configure(_options, { routed }) {
    routed.render = function () { assert.equal(this, routed); return renderResult; };
    routed.resize = function (w, h) { assert.equal(this, routed); assert.deepEqual([w, h], [123, 456]); return resizeResult; };
  } });
  assert.equal(h.gameplay.render(), renderResult); assert.equal(h.gameplay.resize(123, 456), resizeResult); h.gameplay.dispose();
});

test('direct controller draws remain outside gameplay observation; diagnostics keys remain unchanged', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot();
  h.controller.render(); assert.equal(h.scoreReads, 0); assert.equal(h.gameplay.hudSnapshot(), previous);
  assert.deepEqual(Object.keys(h.gameplay.diagnostics()), ['disposed', 'active', 'profilePhase', 'session', 'input']);
  h.gameplay.render(); assert.equal(h.scoreReads, 1); h.gameplay.dispose();
});

test('separate scene compositions retain distinct private identities even with equal native tokens', () => {
  const a = harness(), b = harness(); a.connected(); b.connected();
  assert.equal(typeof a.gameplay.hudSnapshot().sceneIdentity, 'symbol');
  assert.notEqual(a.gameplay.hudSnapshot().sceneIdentity, b.gameplay.hudSnapshot().sceneIdentity);
  assert.equal(a.gameplay.hudSnapshot().ownToken, b.gameplay.hudSnapshot().ownToken);
  a.gameplay.dispose(); b.gameplay.dispose();
});

test('first socket commit failure withholds completed local candidate and never retries', () => {
  const h = harness(); h.gameplay.play(login()); const previous = h.gameplay.hudSnapshot();
  h.faults.construct = undefined;
  assert.equal(caught(() => h.gameplay.frame(8)), undefined); assert.equal(h.gameplay.hudSnapshot(), previous);
  assert(h.trace.indexOf('release') < h.trace.indexOf('construct'));
  assert.equal(h.gameplay.diagnostics().session.constructorAttempts, 1); assert.equal(h.scoreReads, 0);
  h.flush(); assert.deepEqual(h.errors, [undefined]); assert.equal(h.gameplay.hudSnapshot(), null);
  caught(() => h.gameplay.frame(16)); assert.equal(h.trace.filter(x => x === 'construct').length, 1);
});

test('frame stages lifecycle before motion and reads only after quality/free/statistics/render/release', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot(); h.faults.delta = .5;
  for (const phase of ['before-control', 'after-control', 'motion', 'quality', 'free', 'statistics', 'render', 'release', 'score']) {
    h.faults[`${phase}Effect`] = () => assert.equal(h.gameplay.hudSnapshot(), previous);
  }
  const from = h.trace.length; h.gameplay.frame(16);
  const state = h.gameplay.hudSnapshot(); assert.equal(state.fade, .01 * .5); assert.equal(state.requestedOpacity.header, .85 * (.01 * .5));
  const names = h.trace.slice(from).filter(x => typeof x === 'string');
  for (const [a, b] of [['after-control', 'motion'], ['motion', 'quality'], ['quality', 'free'], ['free', 'statistics'],
    ['statistics', 'render'], ['render', 'release'], ['release', 'score']]) assert(names.indexOf(a) < names.indexOf(b));
  assert.equal(h.scoreReads, 1); assert.equal(h.errors.length, 0);
  for (const key of Object.keys(h.faults)) delete h.faults[key]; h.gameplay.dispose();
});

test('Setup consumes intermediate journal score, later scheduling dirties, final is independent of bundle-end view', () => {
  const h = harness(); h.connected(); h.faults.setupViews = [ready(-11), ready(88)];
  h.faults.finalViews = [ready(1001)]; h.setView(ready(9000));
  h.sockets[0].message([97], [104], [118, 1], [82], [97]); h.flush();
  const state = h.gameplay.hudSnapshot();
  assert.equal(state.current.score, 88); assert.equal(state.final.score, 1001); assert.equal(state.final.exclamation, true);
  assert.equal(state.dirty, false); assert.equal(state.fade, -1); assert.equal(h.scoreReads, 0);
  assert.equal(h.errors.length, 0); h.gameplay.dispose();
});

test('Setup after dirty consumption cannot fabricate a refresh; packet without Setup cannot read', () => {
  const h = harness(); h.connected(); h.gameplay.render(); const displayed = h.gameplay.hudSnapshot().current;
  h.faults.setupViews = [ready(99), ready(100)]; h.sockets[0].message([97], [97]); h.flush();
  assert.deepEqual(h.gameplay.hudSnapshot().current, displayed);
  const reads = h.scoreReads; h.sockets[0].message(header(2, 40)); h.flush(); assert.equal(h.scoreReads, reads);
  assert.equal(h.gameplay.hudSnapshot().dirty, true); h.gameplay.dispose();
});

test('required nonready Setup sample fails after native commit with no prefix semantic publication', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot(), commits = h.commits;
  h.sockets[0].message([97], [104]);
  assert.equal(h.commits, commits + 1); assert.equal(h.gameplay.hudSnapshot(), previous);
  assert.equal(h.gameplay.diagnostics().session.phase, 'failed'); h.flush(); assert.equal(h.errors.length, 1);
  assert.equal(h.gameplay.hudSnapshot(), null); assert.equal(h.scoreReads, 0);
});

for (const [rank, population] of [[0, 23], [7, 0], [0, 0]]) test(`ineligible rank/population ${rank}/${population} never reads`, () => {
  const h = harness(); h.start(); h.sockets[0].message([97], [115], header(rank, population)); h.flush();
  h.gameplay.render(); h.gameplay.resize(960, 540); h.gameplay.frame(16);
  assert.equal(h.scoreReads, 0); assert.equal(h.gameplay.hudSnapshot().dirty, true); assert.equal(h.gameplay.hudSnapshot().current, null);
  h.gameplay.dispose();
});

for (const view of [noOwn(), { ...noOwn(), tableMax: null, status: 'no-tables' },
  { ...ready(), enabled: false }, { ...ready(), score: NaN }, undefined]) test(`required score rejects ${view?.status ?? 'missing'}/${view?.enabled}`, () => {
  const h = harness(); h.connected(); h.setView(view); const previous = h.gameplay.hudSnapshot();
  caught(() => h.gameplay.render()); assert.equal(h.gameplay.hudSnapshot(), previous); assert.equal(h.scoreReads, 1);
  h.flush(); assert.equal(h.errors.length, 1); assert.equal(h.gameplay.hudSnapshot(), null);
});

test('R alone and absent own marker never dirty; equal own schedule uses latest explicit observation', () => {
  const h = harness(); h.connected(); h.setView(ready(-0)); h.gameplay.render();
  assert(Object.is(h.gameplay.hudSnapshot().current.score, -0));
  h.setView(ready(2 ** 40)); h.sockets[0].message([82]); h.flush(); h.gameplay.render(); assert.equal(h.scoreReads, 1);
  h.faults.noOwnMarker = true; h.sockets[0].message([104], [114], [115]); h.flush(); h.gameplay.render(); assert.equal(h.scoreReads, 1);
  h.faults.noOwnMarker = false; h.sockets[0].message([104], [82]); h.flush(); h.gameplay.render();
  assert.equal(h.scoreReads, 2); assert.equal(h.gameplay.hudSnapshot().current.score, 2 ** 40); h.gameplay.dispose();
});

for (const victory of [0, 1]) test(`completing actual lifecycle ${victory} retains raw opacity and resets only actual world action`, () => {
  const h = harness(); h.connected(); h.gameplay.render(); h.interval(500);
  h.at(600); h.sockets[0].message([118, victory]); h.flush(); const history = h.gameplay.hudSnapshot();
  h.faults.delta = 5; h.gameplay.frame(2200); assert.equal(h.gameplay.hudSnapshot().fade, 0, 'strict age equality holds');
  for (let i = 0; i < 49; i++) h.gameplay.frame(2201 + i);
  if (victory) { h.sockets[0].message(header()); h.flush(); assert.equal(h.gameplay.hudSnapshot().dirty, true); }
  const beforeCompletionReads = h.scoreReads;
  h.gameplay.frame(2250); h.gameplay.frame(2251);
  assert.equal(h.scoreReads, beforeCompletionReads, 'post-lifecycle playing=false with dirty must not read');
  const completed = h.gameplay.hudSnapshot();
  assert.equal(completed.fade, -1); assert.deepEqual(completed.requestedOpacity, { readout: -1, header: -.85, rows: -1, announcement: -1 });
  assert.equal(h.gameplay.diagnostics().session.playing, false);
  assert.equal(completed.rank, victory ? 7 : 0); assert.equal(completed.ownToken, victory ? 1n : null);
  assert.deepEqual(completed.current, history.current); assert.deepEqual(completed.final, history.final);
  const reads = h.scoreReads; h.gameplay.render(); h.gameplay.frame(2300); assert.equal(h.scoreReads, reads);
  if (victory) { h.sockets[0].message(header(1, 99)); h.flush(); assert.equal(h.gameplay.hudSnapshot().rank, 7); }
  h.gameplay.dispose();
});

test('minimap forwards existing UI ticks and return fractions without another clock or native reentry', () => {
  const h = harness({ configure(options) { options.minimapTracking = true; } });
  h.connected();
  const clockCount = () => h.trace.filter(value => Array.isArray(value) && value[0] === 'clock').length;
  const clocks = clockCount();
  assert.equal(h.intervals.size, 1);
  h.interval(100);
  const fractions = () => h.trace.filter(value => Array.isArray(value) && value[0] === 'minimap-ui-fraction');
  assert.equal(fractions().at(-1)[1], h.gameplay.diagnostics().session.returnFraction);
  h.interval(500);
  assert.equal(fractions().at(-1)[1], 1);
  assert.equal(clockCount(), clocks, 'the existing UI timer adds no world update');
  assert.equal(h.intervals.size, 0);
  h.at(600); h.sockets[0].message([118, 1]); h.flush();
  h.faults.delta = 5;
  h.gameplay.frame(2200);
  assert(!Object.hasOwn(h.trace.filter(value => Array.isArray(value) && value[0] === 'actions').at(-1)[1], 'minimapUiFraction'));
  h.gameplay.frame(2201);
  let actions = h.trace.filter(value => Array.isArray(value) && value[0] === 'actions').at(-1)[1];
  assert.equal(actions.minimapUiFraction, h.gameplay.diagnostics().session.returnFraction);
  for (let index = 1; index <= 50; index++) h.gameplay.frame(2201 + index);
  actions = h.trace.filter(value => Array.isArray(value) && value[0] === 'actions'
    && Object.hasOwn(value[1], 'minimapUiFraction')).at(-1)[1];
  assert.equal(actions.minimapUiFraction, 0);
  assert.equal(fractions().length, 2, 'return observations travel through native control actions');
  assert.equal(h.gameplay.diagnostics().session.playing, false);
  h.gameplay.dispose();
});

test('ordinary world reset preserves dirty/current/final without retagging history', () => {
  const h = harness(); h.connected(); h.gameplay.render(); h.at(10); h.sockets[0].message([118, 1], [104]); h.flush();
  const history = h.gameplay.hudSnapshot(); h.sockets[0].onclose(); h.flush(); h.gameplay.frame(16);
  const reset = h.gameplay.hudSnapshot(); assert.equal(reset.ownToken, null); assert.equal(reset.rank, 0); assert.equal(reset.dirty, true);
  assert.deepEqual(reset.current, history.current); assert.deepEqual(reset.final, history.final);
  assert.equal(reset.fade, history.fade); assert.deepEqual(reset.requestedOpacity, history.requestedOpacity); h.gameplay.dispose();
});

test('world reset with no pending refresh retains dirty=false and historical current', () => {
  const h = harness(); h.connected(); h.gameplay.render(); const previous = h.gameplay.hudSnapshot();
  h.sockets[0].onclose(); h.flush(); h.gameplay.frame(16);
  const reset = h.gameplay.hudSnapshot(); assert.equal(reset.dirty, false); assert.equal(reset.ownToken, null);
  assert.deepEqual(reset.current, previous.current); assert.equal(h.scoreReads, 1); h.gameplay.dispose();
});

test('acquisition lock covers frame/render/resize and preserves live input while awaiting bytes', async () => {
  let finishFetch;
  const profile = profileEnvironment({ fetchResult: new Promise(resolve => { finishFetch = resolve; }) });
  const h = harness({ configure(options) { options.liveProfile = profile.liveProfile; } });
  const operation = h.gameplay.playWithLiveProfile(liveLogin());
  h.gameplay.event({ type: 'keydown', code: 'ArrowLeft' });
  const traceLength = h.trace.length;
  assert.equal(h.gameplay.frame(8), undefined); assert.equal(h.gameplay.render(), undefined); assert.equal(h.gameplay.resize(960, 540), undefined);
  assert.equal(h.trace.length, traceLength); assert.equal(h.gameplay.diagnostics().input.leftHeld, true);
  h.gameplay.event({ type: 'keyup', code: 'ArrowLeft' });
  finishFetch({}); await operation; assert.equal(profile.fetches, 1); assert.equal(h.sockets.length, 0);
  assert.equal(h.gameplay.diagnostics().input.leftHeld, false); h.gameplay.frame(16); assert.equal(h.sockets.length, 1);
  assert(profile.allocations.every(bytes => bytes.every(value => value === 0))); h.gameplay.dispose();
});

for (const phase of ['before', 'after']) test(`current-document ${phase} frame rejection withholds HUD and socket commit`, async () => {
  let valid = true;
  const profile = profileEnvironment({ current: () => valid });
  const h = harness({ configure(options) { options.liveProfile = profile.liveProfile; } });
  await h.gameplay.playWithLiveProfile(liveLogin()); const previous = h.gameplay.hudSnapshot();
  if (phase === 'before') valid = false;
  else h.faults['frame-returnEffect'] = () => { valid = false; };
  const primary = caught(() => h.gameplay.frame(8)); assert.equal(primary.code, 'stale-intent');
  assert.equal(h.gameplay.hudSnapshot(), previous); assert.equal(h.sockets.length, 0); assert.equal(h.scoreReads, 0);
  if (phase === 'before') assert.equal(h.trace.filter(x => x === 'begin').length, 0);
  else assert(h.trace.includes('release'));
  h.flush(); assert.deepEqual(h.errors, [primary]); assert.equal(h.gameplay.hudSnapshot(), null);
});

test('own identity survives no active head; wrong token score is terminal', () => {
  const h = harness(); h.connected(); h.setOwn(null); h.gameplay.render(); assert.equal(h.gameplay.hudSnapshot().current.ownToken, 1n);
  h.sockets[0].message([104]); h.flush(); const previous = h.gameplay.hudSnapshot(); h.setView(ready(7, 2n));
  caught(() => h.gameplay.render()); assert.equal(h.gameplay.hudSnapshot(), previous); h.flush(); assert.equal(h.errors.length, 1);
});

for (const phase of ['motion', 'quality', 'free', 'statistics', 'render', 'release']) test(`frame ${phase} failure withholds local step candidate`, () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot(), primary = new Error(phase);
  h.faults[phase] = primary; assert.equal(caught(() => h.gameplay.frame(16)), primary);
  assert.equal(h.gameplay.hudSnapshot(), previous); assert.equal(h.scoreReads, 0); h.flush(); assert.deepEqual(h.errors, [primary]);
});

test('input whole-step debt accumulates before lifecycle and retains keyboard/ping/boost order', () => {
  const h = harness(); h.connected(); h.setOwn(own());
  for (const code of ['ArrowLeft', 'Space']) h.gameplay.event({ type: 'keydown', code });
  h.faults.wholeSteps = 3;
  h.faults['after-controlEffect'] = () => assert.equal(h.gameplay.diagnostics().input.leftSteps, 3);
  h.gameplay.frame(40); delete h.faults['after-controlEffect'];
  h.faults.wholeSteps = 2; const from = h.sockets[0].sent.length; h.gameplay.frame(300);
  assert.deepEqual(h.sockets[0].sent.slice(from).slice(0, 3), [[252, 5], [251], [253]]);
  assert.equal(h.gameplay.diagnostics().input.leftSteps, 0); h.gameplay.dispose();
});

test('HUD mode rejects actual extreme session fade history while legacy remains admitted', () => {
  for (const mode of [true, false]) {
    const h = harness({ mode }); h.connected(); h.interval(-Number.MAX_VALUE); h.interval(Number.MAX_VALUE);
    assert.equal(h.gameplay.diagnostics().session.returnFraction, 1);
    // A backwards finite clock can leave the legacy incoming fraction negative.
    h.faults.setupViews = [ready()];
    h.sockets[0].message([97]); h.flush(); h.interval(-Number.MAX_VALUE);
    assert(h.gameplay.diagnostics().session.returnFraction < 0);
    const previous = h.gameplay.hudSnapshot();
    if (mode) { caught(() => h.gameplay.frame(16)); assert.equal(h.gameplay.hudSnapshot(), previous); h.flush(); assert.equal(h.errors.length, 1); }
    else { h.gameplay.frame(16); assert.equal(h.errors.length, 0); h.gameplay.dispose(); }
  }
});

for (const primary of [undefined, null, false, 0, new Error('identity primary'), Object.freeze({ primary: true })]) test(`first primary survives score/observer cleanup (${String(primary)})`, () => {
  for (const origin of ['score', 'reflection', 'observer', 'release']) {
    let fail = false;
    const h = harness({ callback() { if (origin === 'observer' && fail) throw primary; } }); h.connected();
    const previous = h.gameplay.hudSnapshot(); h.faults['clear-interval'] = new Error('secondary timer cleanup');
    h.faults.close = new Error('secondary socket cleanup'); fail = true;
    if (origin === 'observer') h.sockets[0].message([104]);
    else if (origin === 'reflection') {
      h.setView(new Proxy(ready(), { getPrototypeOf() { throw primary; } }));
      assert.equal(caught(() => h.gameplay.render()), primary);
    }
    else { h.faults[origin] = primary; assert.equal(caught(() => h.gameplay.render()), primary); }
    assert.equal(h.gameplay.hudSnapshot(), previous); h.flush();
    assert.deepEqual(h.errors, [primary]); assert.equal(h.gameplay.hudSnapshot(), null); assert.equal(h.sockets[0].closes, 1);
    assert.equal(h.trace.filter(x => x === 'clear-interval').length, 1); h.gameplay.dispose(); h.flush(); assert.equal(h.errors.length, 1);
  }
});

test('new score reflection preserves thrown undefined and rejects reentry without inspecting then', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot();
  h.setView(new Proxy(ready(), { getPrototypeOf() { assert.equal(h.gameplay.hudSnapshot(), previous); throw undefined; } }));
  assert.equal(caught(() => h.gameplay.render()), undefined); h.flush(); assert.deepEqual(h.errors, [undefined]);
  const g = harness(); g.connected(); const prior = g.gameplay.hudSnapshot();
  g.faults.scoreEffect = () => {
    assert.equal(g.gameplay.hudSnapshot(), prior);
    assert.match(String(caught(() => g.gameplay.render())), /reentr/);
  };
  g.gameplay.render(); assert.equal(g.errors.length, 0); g.gameplay.dispose();
});

test('retained fatal values reject later HUD ingress before another native commit', () => {
  for (const primary of [undefined, null, false, 0, new Error('fatal identity'), Object.freeze({ primary: true })]) {
    for (const failedDefer of [false, true]) {
      const h = harness(); h.connected();
      h.faults.score = primary;
      if (failedDefer) h.faults.defer = new Error('Authored unavailable scheduler');
      assert.equal(caught(() => h.gameplay.render()), primary);
      const commits = h.commits, previous = h.gameplay.hudSnapshot();
      let after, phase, closes, snapshot;
      try {
        h.sockets[0].message([104]);
        after = h.commits; phase = h.gameplay.diagnostics().session.phase;
        closes = h.sockets[0].closes; snapshot = h.gameplay.hudSnapshot();
      } finally { h.gameplay.dispose(); h.flush(); }
      assert.equal(after, commits, 'No native ingress after a retained fatal value');
      assert.equal(phase, 'failed'); assert.equal(closes, 1); assert.equal(snapshot, previous);
      assert.deepEqual(h.errors, [primary]); assert.equal(h.gameplay.hudSnapshot(), null);
      assert.equal(h.sockets[0].closes, 1);
    }
  }
});

test('a secondary scheduling failure cannot replace a thrown undefined primary', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot();
  h.faults.score = undefined; h.faults.defer = new Error('secondary defer');
  assert.equal(caught(() => h.gameplay.render()), undefined); assert.equal(h.gameplay.hudSnapshot(), previous);
  delete h.faults.defer;
  // A later terminal cleanup entry must not replay the failed draw or read.
  h.gameplay.dispose(); assert.equal(h.scoreReads, 1); assert.equal(h.gameplay.hudSnapshot(), null);
  assert.deepEqual(h.errors, [undefined]);
});

for (const primary of [undefined, new Error('first cleanup')]) test(`first cleanup failure is primary without an earlier operation failure (${String(primary)})`, () => {
  const h = harness(); h.connected(); h.gameplay.event({ type: 'keydown', code: 'ArrowLeft' });
  h.faults['clear-interval'] = primary;
  assert.equal(caught(() => h.gameplay.dispose()), primary);
  assert.deepEqual(h.errors, [primary]); assert.equal(h.gameplay.hudSnapshot(), null);
  assert.equal(h.gameplay.diagnostics().input.connected, false, 'pagehide still gates input');
  assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected', 'session close still attempted');
  assert.equal(h.sockets[0].closes, 1); h.gameplay.dispose(); h.flush(); assert.equal(h.errors.length, 1);
});

test('baseline cleanup regression: callback primary reaches onFatal once despite throwing clearInterval', () => {
  let fail = false;
  const h = harness({ callback() { if (fail) throw undefined; } }); h.connected();
  h.faults['clear-interval'] = new Error('secondary timer cleanup'); fail = true;
  h.sockets[0].message([104]); h.flush();
  assert.deepEqual(h.errors, [undefined]); assert.equal(h.gameplay.diagnostics().disposed, true);
  assert.equal(h.trace.filter(x => x === 'clear-interval').length, 1);
  assert.equal(h.sockets[0].closes, 1); h.gameplay.dispose(); h.flush(); assert.equal(h.errors.length, 1);
});

test('readout without packet callback retains undefined after successful draw and secondary timer cleanup', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot();
  const draws = h.controller.diagnostics().draws;
  h.faults.score = undefined; h.faults['clear-interval'] = new Error('secondary timer cleanup');
  assert.equal(caught(() => h.gameplay.render()), undefined);
  assert.equal(h.controller.diagnostics().draws, draws + 1, 'native/controller draw is already committed');
  assert.equal(h.gameplay.hudSnapshot(), previous); assert.equal(h.errors.length, 0);
  h.flush(); assert.deepEqual(h.errors, [undefined]); assert.equal(h.gameplay.hudSnapshot(), null);
  assert.equal(h.trace.filter(x => x === 'clear-interval').length, 1); assert.equal(h.sockets[0].closes, 1);
  h.gameplay.dispose(); h.flush(); assert.equal(h.errors.length, 1);
});

test('baseline scheduling regression: frame release primary undefined survives defer failure', () => {
  const h = harness({ mode: false }); h.connected();
  h.faults.release = undefined; h.faults.defer = new Error('secondary defer');
  assert.equal(caught(() => h.gameplay.frame(16)), undefined);
  delete h.faults.defer; h.gameplay.dispose();
});

test('timer clear failure during reconciliation is attempted once and becomes the first primary', () => {
  const h = harness(); h.connected(); h.faults['clear-interval'] = undefined;
  h.interval(500); h.flush(); assert.deepEqual(h.errors, [undefined]);
  assert.equal(h.trace.filter(x => x === 'clear-interval').length, 1);
  assert.equal(h.sockets[0].closes, 1); assert.equal(h.gameplay.hudSnapshot(), null);
});

test('observer primary survives failed defer and is delivered at explicit safe disposal', () => {
  let fail = false;
  const primary = Object.freeze({ observer: 'primary' });
  const h = harness({ callback() { if (fail) throw primary; } }); h.connected(); const previous = h.gameplay.hudSnapshot();
  h.faults.defer = new Error('secondary scheduling'); fail = true;
  h.sockets[0].message([104]); assert.equal(h.gameplay.hudSnapshot(), previous);
  h.gameplay.dispose(); assert.deepEqual(h.errors, [primary]); assert.equal(h.gameplay.hudSnapshot(), null);
  assert.equal(h.sockets[0].closes, 1);
});

test('throwing fatal notification cannot replace the retained primary or repeat cleanup', () => {
  let received;
  const h = harness({ configure(options) {
    options.onFatal = error => { assert.equal(received, undefined); received = { error }; throw new Error('secondary fatal sink'); };
  } }); h.connected(); h.faults.score = null;
  assert.equal(caught(() => h.gameplay.render()), null); h.flush(); assert.equal(received.error, null);
  h.gameplay.dispose(); h.flush(); assert.equal(h.trace.filter(x => x === 'clear-interval').length, 1);
});

test('fatal session change during controller release cannot trigger a score read or publish a candidate', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot(), primary = new Error('session error');
  h.faults.releaseEffect = () => h.sockets[0].onerror(primary);
  assert.equal(caught(() => h.gameplay.frame(16)), primary); assert.equal(h.scoreReads, 0);
  assert.equal(h.gameplay.hudSnapshot(), previous); h.flush(); assert.deepEqual(h.errors, [primary]);
});

test('score getter terminal side effect cannot authorize semantic publication', () => {
  const h = harness(); h.connected(); const previous = h.gameplay.hudSnapshot(), primary = new Error('score side effect');
  h.faults.scoreEffect = () => h.sockets[0].onerror(primary);
  assert.equal(caught(() => h.gameplay.render()), primary); assert.equal(h.gameplay.hudSnapshot(), previous);
  assert.equal(h.scoreReads, 1); h.flush(); assert.deepEqual(h.errors, [primary]);
});

test('callback return rejection never reads then and stale detached callbacks cannot restore state', () => {
  let fail = false;
  const result = Object.defineProperty({}, 'then', { get() { assert.fail('then getter'); } });
  const h = harness({ callback() { if (fail) return result; } }); h.connected();
  const stale = h.sockets[0].onmessage; fail = true; h.sockets[0].message([104]); h.flush();
  assert.equal(h.errors.length, 1); assert.match(String(h.errors[0]), /return undefined/);
  const commits = h.commits; stale({ data: frame([[104]]) }); assert.equal(h.commits, commits); assert.equal(h.gameplay.hudSnapshot(), null);
});
