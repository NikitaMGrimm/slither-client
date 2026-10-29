import { TestSessionPolicy } from './fixtures/session-policy-double.mjs';
import { ProfileLiteralParserDouble } from './fixtures/profile-literals-double.mjs';
import { TestDesktopInput } from './fixtures/client-input-fixture.mjs';
import { LeaderboardHistoryDouble } from './leaderboard-history-double.mjs';
import { HudHistoryDouble } from './hud-history-double.mjs';
// Authored integration: actual gameplay/session/controller/state, with native,
// socket, source and numeric-projector doubles. Flagged runs select real history ABIs only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStockGameplay } from '../web/stock-gameplay.mjs';
import { createStockClient } from './fixtures/stock-client-fixture.mjs';
import { requireLeaderboardState } from '../web/stock-leaderboard-state.mjs';

const login = () => ({ endpoint: 'ws://192.0.2.9:1234/slither',
  profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 },
  nickname: 'Own 1234567', skin: 0, customSkin: new Uint8Array() });
const noOwn = tableMax => ({ schema: 1, enabled: true, tableMax, own: null,
  status: 'no-own', score: null, error: null });
const board = (rows = [], localRow = 0) => [108, localRow, 0, 0, 0, 0, ...rows.flat()];
const row = (count = 2, mass = 8388607, color = 255, name = [65]) =>
  [count >> 8, count & 255, mass >> 16, (mass >> 8) & 255, mass & 255, color, name.length, ...name];
const frame = commands => Uint8Array.from(commands.length === 1 ? commands[0]
  : commands.flatMap(command => [command.length >> 8, command.length & 255, ...command])).buffer;

function harness({ configure, callback, rows = true } = {}) {
  const trace = [], pending = [], errors = [], sockets = [], projections = [], faults = {};
  const intervals = new Map();
  let held = false, borrowed = false, ingress = false, commands = [], gameplay, time = 0, timerSerial = 0;
  const outside = () => { assert(!held, 'held sources released'); assert(!borrowed, 'native borrow released'); };
  function hit(name) {
    trace.push(name); faults[`${name}Effect`]?.();
    if (Object.hasOwn(faults, name)) throw faults[name];
  }
  const scene = {
    control_view() { outside(); hit('control-view'); return { own: null, follows: true, camera: { x: 0, y: 0 }, zoom: 1 }; },
    set_connected() { outside(); assert(!ingress); hit('connected'); },
    reset_lag() { outside(); assert(!ingress); hit('reset-lag'); },
    score_view() { assert.fail('zero-rank boards never request own score'); },
    advance() { assert.fail('only existing same-step clock'); },
    set_gaze_heading() { assert.fail('gaze returned by existing control'); },
    advance_with_control(nowMs, _lagging, control) {
      assert(held); assert(!borrowed); borrowed = true; hit('clock');
      try {
        const actions = control({ nowMs, delta: faults.delta ?? .5, wholeSteps: 0,
          control: { own: null, follows: true, camera: { x: 0, y: 0 }, zoom: 1 } });
        if (actions.resetWorld) hit('reset-world');
      } finally { borrowed = false; }
      return { free() { outsideBorrow(); hit('free-step'); } };
    },
    render_standard_with_face_presentation_at_size() { assert(held); outsideBorrow(); hit('render'); },
    apply_frame_and_render_standard_with_face_presentation_and_prey() {
      hit('legacy-packet'); return commands.filter(command => command[0] === 97).length;
    },
    apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud(...args) {
      assert(held); outsideBorrow(); borrowed = true; hit('native-packet');
      try {
        const plan = args[15], events = [], leaderboardRows = [];
        assert.equal(plan.schema, rows ? 2 : 1);
        for (const [commandIndex, command] of commands.entries()) {
          if (command[0] === 97) {
            const tableMax = command[1] ?? 17;
            events.push({ commandIndex, kind: 'setup', tableMax },
              { commandIndex, kind: 'setup-draw', view: noOwn(tableMax) });
          } else if (command[0] === 108 && plan.guards[commandIndex].playing) {
            events.push({ commandIndex, kind: 'leaderboard', localRow: command[1], rank: 0, population: 0,
              deathPending: plan.guards[commandIndex].deathPending });
            const copied = [];
            for (let offset = 6; offset < command.length;) {
              const [hi, lo, m1, m2, m3, rawColor, length] = command.slice(offset, offset + 7);
              copied.push({ ordinal: copied.length + 1, count: hi * 256 + lo,
                fractionalMass: (m1 * 65536 + m2 * 256 + m3) / 16777215,
                rawColor, paletteIndex: rawColor % 9, name: command.slice(offset + 7, offset + 7 + length) });
              offset += 7 + length;
            }
            leaderboardRows.push({ commandIndex, rows: copied });
          } else if (plan.finalCaptureIndices.includes(commandIndex)) {
            events.push({ commandIndex, kind: 'final-score', view: {
              schema: 1, enabled: true, tableMax: 3, status: 'ready', score: 42, error: null,
              own: { token: 1n, id: 7, logicalSegments: 1, fractionalMass: 0, scoreAdjustment: 0, scoreIndex: 1 },
            } });
          }
        }
        const report = { schema: plan.schema, commandCount: commands.length,
          setupDraws: commands.filter(command => command[0] === 97).length, events,
          ...(rows ? { leaderboardRows } : {}) };
        faults.report?.(report); hit('native-commit'); return report;
      } finally { borrowed = false; hit('native-return'); }
    },
  };
  function outsideBorrow() { assert(!borrowed); }
  const quality = {
    begin_connection() { outside(); hit('begin-connection'); },
    advance() { outsideBorrow(); hit('quality'); },
    update_statistics() { outsideBorrow(); hit('statistics'); return false; },
  };
  const controller = createStockClient({ scene, quality,
    adapter: {
      beginOperation() { assert(!held); held = true; hit('capture'); return {}; },
      endOperation() { assert(held); held = false; hit('release'); },
      resolveAppearance() {}, resolveRecipe() {}, resolveAntennaRandom() {},
    }, hostAssets: { resolveFood() {}, resolvePrey() {} },
    target: {}, palettes: [{}, {}, {}], background: {}, width: 960, height: 540 });
  const routed = Object.fromEntries(['packet', 'packetWithHud', 'frame', 'render', 'resize'].map(name =>
    [name, (...args) => { const result = controller[name](...args); hit(`${name}-return`); return result; }]));
  const projector = {
    project(tableMax, counts, masses) {
      outside(); assert(ingress, 'projection inside original session ingress'); hit('project');
      assert.equal(Object.getPrototypeOf(counts), Float64Array.prototype);
      assert.equal(Object.getPrototypeOf(masses), Float64Array.prototype);
      projections.push({ tableMax, counts: [...counts], masses: [...masses] });
      return faults.result ? faults.result(counts) : Float64Array.from(counts, count => count > tableMax + 2048 ? NaN : -0);
    },
  };
  const options = { scene, quality, controller: routed, hudReadout: true, leaderboardRows: rows,
    leaderboardProjector: projector,
    wasm: { DesktopInput: TestDesktopInput, SessionPolicy: TestSessionPolicy, LeaderboardHistory: LeaderboardHistoryDouble, HudHistory: HudHistoryDouble,
      ProfileLiteralParser: ProfileLiteralParserDouble,
      encode_login(_version, _password, nickname) { hit('encode'); faults.encodedNickname = nickname; return Uint8Array.of(115); },
      solve_challenge() { return new Uint8Array(27); }, setup_protocol_version() { return 19; },
      decode_frame(bytes) {
        hit('decode'); commands = [];
        if (bytes[0] >= 32) commands.push([...bytes]);
        else for (let offset = 0; offset < bytes.length;) {
          const length = bytes[offset++] * 256 + bytes[offset++];
          commands.push([...bytes.slice(offset, offset + length)]); offset += length;
        }
        return Uint8Array.from(commands.flatMap(command => [0, 0, command.length >> 8, command.length & 255, ...command]));
      },
    },
    createSocket() {
      outside(); assert(!ingress); hit('construct');
      const socket = { readyState: 0, bufferedAmount: 0, closes: 0, sent: [],
        send(bytes) { this.sent.push([...bytes]); hit('send'); },
        close() { this.readyState = 3; this.closes++; hit('close'); },
        open() { this.readyState = 1; ingress = true; try { this.onopen?.(); } finally { ingress = false; } },
        message(...parts) { ingress = true; try { this.onmessage?.({ data: frame(parts) }); } finally { ingress = false; } },
      };
      sockets.push(socket); return socket;
    },
    now: () => time, defer(fn) { pending.push(fn); },
    setInterval(fn) { outside(); assert(!ingress); intervals.set(++timerSerial, fn); return timerSerial; },
    clearInterval(id) { outside(); assert(!ingress); intervals.delete(id); hit('clear-timer'); },
    onStatus() { outside(); assert(!ingress); hit('status'); },
    onFatal(error) { outside(); assert(!ingress); errors.push(error); hit('fatal'); },
    onHudPacket(report) { outside(); assert(ingress); hit('hud'); callback?.(report, gameplay); },
  };
  configure?.(options, { faults, trace, scene, routed, projector });
  gameplay = createStockGameplay(options);
  function flush() { let budget = 50; while (pending.length) { assert(budget--); pending.shift()(); } }
  function start(request = login()) {
    gameplay.play(request); gameplay.frame(8); flush();
    sockets[0].open(); sockets[0].message([54, 1]); flush();
  }
  return { gameplay, trace, errors, faults, sockets, projections, controller, start, flush, options, intervals,
    tick(value) { time = value; for (const fn of [...intervals.values()]) fn(); } };
}

// Inert authored profile bytes and a labelled digest double; this performs no fetch.
function liveProfileDouble() {
  const payload = new Uint8Array(224092).fill(32);
  payload.set(new TextEncoder().encode('var v=17;'), 181647);
  payload.set(new TextEncoder().encode(`var k=[${Array.from({ length: 20 }, (_, i) => i).join(',')}];`), 181670);
  let reads = 0;
  return { isCurrentDocument: () => true, capabilities: {
    fetch: () => Promise.resolve({}),
    digest: () => Promise.resolve(Uint8Array.from('5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095'
      .match(/../g), value => Number.parseInt(value, 16))),
    createAbort: () => ({ signal: {}, abort() {} }), setTimeout: () => 1, clearTimeout() {}, now: () => 0,
    environment: () => ({ origin: 'https://slither.io', topLevel: true, secureContext: true }),
    responseInfo: () => ({ status: 200, type: 'basic', url: 'https://slither.io/s/game1107249518.js', redirected: false, body: {} }),
    getReader: () => ({}),
    read: () => Promise.resolve(++reads === 1 ? { done: false, value: payload.slice() } : { done: true, value: undefined }),
    cancelReader: () => Promise.resolve(), releaseReader() {},
    bytes: { allocate: length => new Uint8Array(length), length: bytes => bytes.length,
      copy: (target, bytes, offset) => target.set(bytes, offset), clear: bytes => bytes.fill(0) },
  } };
}

test('selected construction requires HUD and a narrow synchronous projector before effects', () => {
  for (const configure of [options => { options.hudReadout = false; },
    options => { options.leaderboardRows = 1; }, options => { options.leaderboardProjector = null; },
    options => { options.leaderboardProjector = { project: async () => {} }; },
    options => { options.leaderboardProjector = { project() {}, free() {} }; },
    options => { options.leaderboardProjector = { get project() { assert.fail('project getter'); } }; }]) {
    assert.throws(() => harness({ configure(options, context) {
      configure(options, context);
      Object.defineProperty(options.wasm, 'decode_frame', { get() { assert.fail('session construction before option admission'); } });
    } }), TypeError);
  }
});

test('actual schema2 packets project once per ordered/equal/empty board after source release and commit both histories later', () => {
  let previousRows, previousHud, calls = 0;
  const h = harness({ callback(report, gameplay) {
    calls++; assert.equal(report.schema, 2);
    assert.equal(gameplay.leaderboardSnapshot(), previousRows);
    assert.equal(gameplay.hudSnapshot(), previousHud);
    assert.equal(gameplay.diagnostics().session.playing, true, 'session controls precede HUD completion');
  } });
  h.start(); previousRows = h.gameplay.leaderboardSnapshot(); previousHud = h.gameplay.hudSnapshot();
  assert.equal(requireLeaderboardState(previousRows), previousRows);
  assert.equal(previousRows.sceneIdentity, previousHud.sceneIdentity);
  const remote = row(65535, 16777215, 255, [38, 32, 255]);
  const offset = h.trace.length;
  h.sockets[0].message([97, 3], board([remote, row()], 2), [97, 7], board(), board(), [97, 11]);
  assert.deepEqual(h.projections, [
    { tableMax: 3, counts: [65535, 2], masses: [1, 8388607 / 16777215] },
    { tableMax: 7, counts: [], masses: [] }, { tableMax: 7, counts: [], masses: [] },
  ]);
  assert.equal(calls, 1); assert.equal(h.gameplay.leaderboardSnapshot(), previousRows);
  const trace = h.trace.slice(offset);
  assert(trace.indexOf('release') < trace.indexOf('packetWithHud-return'));
  assert(trace.indexOf('packetWithHud-return') < trace.indexOf('project'));
  assert(trace.lastIndexOf('project') < trace.indexOf('hud'));
  h.flush(); const state = h.gameplay.leaderboardSnapshot();
  assert.equal(state.revision, 3n); assert.equal(state.tableMax, 11); assert.deepEqual(state.board.rows, []);
  assert.equal(h.gameplay.hudSnapshot().rank, 0); assert.equal(h.errors.length, 0);
  h.gameplay.dispose(); assert.equal(h.gameplay.leaderboardSnapshot(), null);
});

test('nickname is the exact admitted Play copy, historical text stays frozen and defaults ignore projector capability', () => {
  const h = harness(); const request = login();
  h.faults.encodeEffect = () => { request.nickname = 'Mutated during encode'; };
  h.start(request); request.nickname = 'Changed later';
  h.sockets[0].message([97, 3], board([row(), row()], 2)); h.flush();
  const first = h.gameplay.leaderboardSnapshot();
  assert.equal(first.board.rows[1].nameText, 'Own\u00a01234567');
  assert.equal(h.faults.encodedNickname, 'Own 1234567');
  assert.equal(first.board.rows[1].own, true); assert(Object.is(first.board.rows[0].score, -0));
  assert.equal(first.board.rows[0].cssColor, '#80ff80');
  assert(!JSON.stringify(h.gameplay.diagnostics()).includes('Own 1234567'));
  h.sockets[0].message([97, 9]); h.flush();
  assert.equal(h.gameplay.leaderboardSnapshot().board, first.board);
  assert.equal(h.projections.length, 1, 'Setup never rescores history');
  h.gameplay.dispose();
  for (const mode of ['absent', false]) {
    const legacy = harness({ rows: false, configure(options) {
      if (mode === 'absent') delete options.leaderboardRows;
      options.leaderboardProjector = Object.defineProperty({}, 'project', { get() { assert.fail('unused projector'); } });
    } });
    assert.equal(legacy.gameplay.leaderboardSnapshot(), null);
    legacy.start(); legacy.sockets[0].message([97, 3], board()); legacy.flush();
    assert.equal(legacy.projections.length, 0); assert.equal(legacy.errors.length, 0); legacy.gameplay.dispose();
  }
});

test('coalesced packets inherit pending table state; actual reset preserves board and does not project on frames or resize', () => {
  const h = harness(); h.start();
  h.sockets[0].message([97, 3], board([row()])); h.sockets[0].message(board([row(4)]));
  h.flush(); const state = h.gameplay.leaderboardSnapshot();
  assert.equal(state.revision, 2n); assert.equal(state.tableMax, 3);
  h.sockets[0].onclose(); h.flush();
  const resets = h.trace.filter(value => value === 'reset-world').length;
  h.gameplay.frame(16); h.gameplay.resize(960, 540); h.flush();
  assert.equal(h.trace.filter(value => value === 'reset-world').length, resets + 1);
  assert.equal(h.gameplay.leaderboardSnapshot().board, state.board);
  assert.equal(h.gameplay.leaderboardSnapshot().tableMax, 3);
  assert.equal(h.projections.length, 2); assert.equal(h.errors.length, 0); h.gameplay.dispose();
});

test('live-profile path retains only the successful admitted nickname before mutable request changes', async () => {
  const h = harness({ configure(options) { options.liveProfile = liveProfileDouble(); } });
  const { profile: _profile, ...request } = login();
  const admitted = h.gameplay.playWithLiveProfile(request);
  request.nickname = 'Changed while awaiting';
  await admitted;
  assert.equal(h.sockets.length, 0);
  h.gameplay.frame(8); h.flush(); h.sockets[0].open(); h.sockets[0].message([54, 1]); h.flush();
  h.sockets[0].message([97, 3], board([row()], 1)); h.flush();
  assert.equal(h.faults.encodedNickname, 'Own 1234567');
  assert.equal(h.gameplay.leaderboardSnapshot().board.rows[0].nameText, 'Own\u00a01234567');
  assert(!JSON.stringify(h.gameplay.diagnostics()).includes('Own 1234567'));
  assert.equal(h.errors.length, 0); h.gameplay.dispose();
});

test('invalid admission is correctable; invalid report/result never commits a board prefix', () => {
  const h = harness();
  assert.throws(() => h.gameplay.play({ ...login(), nickname: 'x'.repeat(25) }), /login/);
  assert.equal(h.gameplay.diagnostics().session.phase, 'ready');
  h.start(); h.sockets[0].message([97, 3], board([row()], 1)); h.flush();
  assert.equal(h.gameplay.leaderboardSnapshot().board.rows[0].nameText, 'Own\u00a01234567');
  h.gameplay.dispose();
  for (const configureFault of [
    faults => { faults.report = report => { report.leaderboardRows[1].rows[0].paletteIndex = 0; }; },
    faults => { faults.result = counts => Array.from(counts); },
    faults => { faults.result = () => Float64Array.of(1, 2); },
    faults => { faults.result = () => Float64Array.of(.5); },
  ]) {
    const rejected = harness(); rejected.start(); configureFault(rejected.faults);
    const previous = rejected.gameplay.leaderboardSnapshot();
    rejected.sockets[0].message([97, 3], board([row()]), board([row()]));
    assert.equal(rejected.gameplay.leaderboardSnapshot(), previous);
    rejected.flush(); assert.equal(rejected.errors.length, 1);
    assert.equal(rejected.gameplay.leaderboardSnapshot(), null);
  }
});

test('projection/release/HUD/reconciliation failures withhold both candidates and preserve the first thrown value', () => {
  for (const at of ['project', 'release', 'hud', 'connected']) for (const primary of [undefined, new Error(at)]) {
    const h = harness(); h.start();
    const rowsBefore = h.gameplay.leaderboardSnapshot(), hudBefore = h.gameplay.hudSnapshot();
    h.faults[at] = primary; h.faults.close = new Error('secondary close');
    h.sockets[0].message([97, 3], board([row()]));
    assert.equal(h.gameplay.leaderboardSnapshot(), rowsBefore);
    assert.equal(h.gameplay.hudSnapshot(), hudBefore);
    h.flush(); assert.equal(h.errors.length, 1); assert.equal(h.errors[0], primary);
    assert.equal(h.gameplay.leaderboardSnapshot(), null); assert.equal(h.gameplay.hudSnapshot(), null);
    assert.equal(h.sockets[0].closes, 1);
    assert.equal(h.projections.length, at === 'release' || at === 'project' ? 0 : 1);
  }
});

test('caught projector/HUD reentry poisons selected publication and releases owned state without freeing caller projector', () => {
  for (const at of ['project', 'hud']) {
    const h = harness(); h.start();
    h.faults[`${at}Effect`] = () => {
      assert.throws(() => h.gameplay.frame(10), /reentr/);
      assert.throws(() => h.gameplay.dispose(), /reentr/);
    };
    h.sockets[0].message([97, 3], board([row()])); h.flush();
    assert.equal(h.errors.length, 1); assert.match(String(h.errors[0]), /reentr/);
    assert.equal(h.gameplay.leaderboardSnapshot(), null);
    assert.equal(h.trace.filter(value => value === 'fatal').length, 1);
  }
});

test('local explicit Play replaces only a normally disconnected session after existing death/return, with one reset before the new socket', () => {
  const h = harness({ configure(options) { options.localSession = true; } });
  h.start(); const oldSocket = h.sockets[0], staleMessage = oldSocket.onmessage;
  oldSocket.message([97, 3], board([row()], 1)); h.flush(); h.tick(500);
  assert.throws(() => h.gameplay.play(login()), /One manual Play/);
  oldSocket.message([118, 0]); h.flush();
  assert.equal(h.gameplay.diagnostics().session.phase, 'dead');
  h.faults.delta = 5;
  h.gameplay.frame(2100);
  assert.equal(h.gameplay.diagnostics().session.phase, 'dead', 'existing strict death age');
  for (let step = 0; step < 51; step++) h.gameplay.frame(2101 + step * 8);
  h.flush();
  assert.equal(h.gameplay.diagnostics().session.phase, 'disconnected');
  assert.equal(h.gameplay.diagnostics().session.reason, 'life-returned');
  assert.equal(h.gameplay.diagnostics().session.playing, false);
  assert.equal(oldSocket.closes, 1); assert.equal(h.intervals.size, 0);
  const rowsBefore = h.gameplay.leaderboardSnapshot(), hudBefore = h.gameplay.hudSnapshot();
  const clocks = h.trace.filter(value => value === 'clock').length, sends = oldSocket.sent.length;
  const offset = h.trace.length;
  h.gameplay.play({ ...login(), nickname: 'Second local' });
  assert.equal(h.sockets.length, 1, 'explicit Play stages existing reset transaction');
  assert.equal(h.gameplay.leaderboardSnapshot(), rowsBefore);
  assert.equal(h.gameplay.hudSnapshot(), hudBefore);
  assert.equal(h.trace.filter(value => value === 'clock').length, clocks);
  assert.equal(oldSocket.sent.length, sends);
  h.flush(); assert.equal(h.sockets.length, 1);
  h.gameplay.frame(2600); h.flush();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.trace.filter(value => value === 'clock').length, clocks + 1);
  const restart = h.trace.slice(offset);
  assert(restart.indexOf('reset-world') < restart.indexOf('release'));
  assert(restart.indexOf('release') < restart.indexOf('construct'));
  assert.equal(h.gameplay.leaderboardSnapshot().board, rowsBefore.board);
  assert.equal(h.gameplay.leaderboardSnapshot().sceneIdentity, rowsBefore.sceneIdentity);
  assert.equal(h.gameplay.hudSnapshot().sceneIdentity, hudBefore.sceneIdentity);
  const beforeStale = h.trace.length;
  staleMessage({ data: frame([[97, 3]]) }); assert.equal(h.trace.length, beforeStale);
  const next = h.sockets[1]; next.open(); next.message([54, 1]); h.flush();
  next.message([97, 3], board([row()], 1)); h.flush();
  assert.equal(h.gameplay.leaderboardSnapshot().board.rows[0].nameText, 'Second\u00a0local');
  assert.equal(rowsBefore.board.rows[0].nameText, 'Own\u00a01234567');
  assert.equal(h.gameplay.leaderboardSnapshot().revision, rowsBefore.revision + 1n);
  assert.equal(h.errors.length, 0); h.gameplay.dispose(); assert.equal(next.closes, 1);
});

test('local renewal clears the old timer, retains pending board history, rejects invalid login before native/socket work and never renews a fatal session', () => {
  const h = harness({ configure(options) { options.localSession = true; } }); h.start();
  h.sockets[0].message([97, 3], board([row()], 1)); h.flush();
  const staleTimer = [...h.intervals.values()][0];
  h.sockets[0].message(board([row(4)], 1));
  h.sockets[0].onclose();
  const clocks = h.trace.filter(value => value === 'clock').length;
  assert.throws(() => h.gameplay.play({ ...login(), nickname: 'x'.repeat(25) }), /login/);
  assert.equal(h.sockets.length, 1); assert.equal(h.intervals.size, 0);
  assert.equal(h.trace.filter(value => value === 'clock').length, clocks);
  h.gameplay.play(login()); h.flush();
  assert.equal(h.gameplay.leaderboardSnapshot().revision, 2n);
  const offset = h.trace.length; staleTimer(); assert.equal(h.trace.length, offset, 'old timer cannot tick the new owner');
  h.gameplay.frame(16); h.flush(); assert.equal(h.sockets.length, 2); h.gameplay.dispose();

  const fatal = harness({ configure(options) { options.localSession = true; } }); fatal.start();
  fatal.faults.project = new Error('projector failure');
  fatal.sockets[0].message([97, 3], board([row()]));
  assert.throws(() => fatal.gameplay.play(login()), /stopped/);
  fatal.flush(); assert.equal(fatal.sockets.length, 1); assert.equal(fatal.errors.length, 1);
});

test('localSession defaults keep one-Play semantics and require an explicit boolean', () => {
  for (const localSession of [undefined, false]) {
    const h = harness({ configure(options) { options.localSession = localSession; } }); h.start();
    h.sockets[0].message([97, 3]); h.flush(); h.sockets[0].onclose(); h.flush();
    assert.throws(() => h.gameplay.play(login()), /One manual Play/);
    assert.equal(h.sockets.length, 1); h.gameplay.dispose();
  }
  assert.throws(() => harness({ configure(options) { options.localSession = 'true'; } }), /boolean/);
});

test('only local explicit Play closes a returned v1 victory connection and stages the next reset/socket', () => {
  for (const localSession of [false, true]) {
    const h = harness({ configure(options) { options.localSession = localSession; } });
    h.start(); const oldSocket = h.sockets[0];
    oldSocket.message([97, 3], board([row()], 1)); h.flush(); h.tick(500);
    oldSocket.message([118, 1]); h.flush();
    assert.equal(h.gameplay.diagnostics().session.phase, 'victory');
    assert.equal(h.gameplay.diagnostics().session.playing, true);
    assert.throws(() => h.gameplay.play(login()), /One manual Play/);
    assert.equal(oldSocket.closes, 0);
    h.faults.delta = 5;
    for (let step = 0; step < 51; step++) h.gameplay.frame(2101 + step * 8);
    h.flush();
    const returned = h.gameplay.diagnostics().session;
    assert.equal(returned.phase, 'victory'); assert.equal(returned.playing, false);
    assert.equal(returned.connected, true); assert.equal(oldSocket.closes, 0, 'no automatic victory close');
    if (!localSession) {
      assert.throws(() => h.gameplay.play(login()), /One manual Play/);
      assert.equal(oldSocket.closes, 0); assert.equal(h.sockets.length, 1); h.gameplay.dispose(); continue;
    }
    const rowsBefore = h.gameplay.leaderboardSnapshot(), hudBefore = h.gameplay.hudSnapshot();
    const sends = oldSocket.sent.length, clocks = h.trace.filter(value => value === 'clock').length;
    const offset = h.trace.length;
    h.gameplay.play({ ...login(), nickname: 'After victory' });
    assert.equal(oldSocket.closes, 1); assert.equal(oldSocket.onmessage, null);
    assert.equal(oldSocket.sent.length, sends, 'no victory text or additional sends');
    assert.equal(h.trace.filter(value => value === 'clock').length, clocks);
    assert.equal(h.sockets.length, 1, 'new socket waits for existing native reset commit');
    assert.equal(h.gameplay.leaderboardSnapshot(), rowsBefore); assert.equal(h.gameplay.hudSnapshot(), hudBefore);
    h.flush(); assert.equal(h.sockets.length, 1);
    h.gameplay.frame(2600); h.flush();
    assert.equal(h.sockets.length, 2); assert.equal(oldSocket.sent.length, sends);
    assert.equal(h.trace.filter(value => value === 'clock').length, clocks + 1);
    const restart = h.trace.slice(offset);
    assert(restart.indexOf('reset-world') < restart.indexOf('release'));
    assert(restart.indexOf('release') < restart.indexOf('construct'));
    assert.equal(h.gameplay.leaderboardSnapshot().board, rowsBefore.board);
    assert.equal(h.gameplay.leaderboardSnapshot().sceneIdentity, rowsBefore.sceneIdentity);
    assert.equal(h.gameplay.hudSnapshot().sceneIdentity, hudBefore.sceneIdentity);
    assert.equal(h.errors.length, 0); h.gameplay.dispose();
  }
});
