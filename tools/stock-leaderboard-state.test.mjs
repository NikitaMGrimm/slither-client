import { LeaderboardHistoryDouble } from './leaderboard-history-double.mjs';
import { HudHistoryDouble } from './hud-history-double.mjs';
// Authored synthetic schema2 reports; numeric results are projector doubles,
// The flagged ABI run selects real Rust history; score arithmetic and browser CSS stay separate.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import * as api from '../web/stock-leaderboard-state.mjs';
import { copyHudIngressReport } from '../web/stock-hud-contract.mjs';
import { createHudState, reduceHudState } from '../web/stock-hud-state.mjs';
import { projectHudView } from '../web/stock-hud-view.mjs';

const scene = Symbol('synthetic leaderboard scene');
const fresh = () => api.createLeaderboardState(scene, LeaderboardHistoryDouble);
const setup = (commandIndex, tableMax = 3) => [
  { kind: 'setup', commandIndex, tableMax },
  { kind: 'setup-draw', commandIndex, view: { schema: 1, enabled: true, tableMax,
    own: null, status: 'no-own', score: null, error: null } },
];
const header = (commandIndex, changes = {}) => ({ kind: 'leaderboard', commandIndex,
  localRow: 0, rank: 0, population: 0, deathPending: false, ...changes });
const row = (ordinal = 1, changes = {}) => ({ ordinal, count: 2, fractionalMass: .5,
  rawColor: 0, paletteIndex: 0, name: [65], ...changes });
const bytes = text => Array.from(text, character => character.charCodeAt(0));
const report = (events, boards) => ({ schema: 2,
  commandCount: Math.max(1, ...events.map(event => event.commandIndex + 1)),
  setupDraws: events.filter(event => event.kind === 'setup').length,
  events, leaderboardRows: boards });
const boardReport = (rows = [row()], changes = {}) => report(
  [...setup(0), header(1, changes)], [{ commandIndex: 1, rows }]);
const complete = (state, raw, results, ownNickname = 'Local') => api.completeLeaderboardPacket(
  state, api.prepareLeaderboardPacket(state, raw), results, ownNickname);
const freezeTree = value => {
  if (value && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) freezeTree(child);
  }
};

// Forward real or synthetic generated methods while faulting only the conversion boundary.
function conversionBoundary(overrides) {
  function History() { return new LeaderboardHistoryDouble(); }
  for (const name of ['is_open', 'prepare', 'requests', 'begin_plan', 'admit_name', 'admit_score',
    'complete', 'discard_plan', 'reset', 'commit', 'snapshot', 'projection', 'free']) {
    const original = Object.getOwnPropertyDescriptor(LeaderboardHistoryDouble.prototype, name).value;
    Object.defineProperty(History.prototype, name, { value: overrides[name]?.(original) ?? original });
  }
  return History;
}

test('native per-element admission preserves failure order before later result reflection', () => {
  let observations = 0;
  const later = new Proxy([0], { ownKeys() { observations++; throw 9; } });
  const raw = report([...setup(0), header(1), header(2)],
    [{ commandIndex: 1, rows: [row()] }, { commandIndex: 2, rows: [row()] }]);
  assert.throws(() => complete(fresh(), raw, [[NaN], later]), TypeError);
  assert.equal(observations, 0);
  const scores = new Proxy([[0]], { ownKeys() { observations++; throw 8; } });
  assert.throws(() => complete(fresh(), boardReport(), scores, '\0'), TypeError);
  assert.equal(observations, 0);
});

test('direct generated completion consumes the native plan even when result conversion fails', () => {
  const native = new LeaderboardHistoryDouble();
  const plan = native.prepare(boardReport());
  try {
    native.begin_plan(plan);
    assert.throws(() => native.complete(plan, [], 'Local'), TypeError);
    assert.throws(() => native.complete(plan, [[42]], 'Local'), TypeError);
    assert.equal(native.is_open(), true);
  } finally { native.discard_plan(plan); native.free(); }
});

test('copied-output failure releases candidate, consumes plan and keeps old native history usable', () => {
  for (const primary of [undefined, null, false, 0, new Error('leaderboard copy')]) {
    let armed = false, frees = 0;
    const History = conversionBoundary({
      snapshot: original => function () { if (armed) throw primary; return Reflect.apply(original, this, []); },
      free: original => function () { frees++; return Reflect.apply(original, this, []); },
    });
    const state = api.createLeaderboardState(scene, History);
    const plan = api.prepareLeaderboardPacket(state, boardReport());
    armed = true;
    let caught = false;
    try { api.completeLeaderboardPacket(state, plan, [[42]], 'Local'); }
    catch (error) { caught = true; assert.equal(error, primary); }
    assert.equal(caught, true);
    assert.equal(frees, 1);
    armed = false;
    assert.throws(() => api.completeLeaderboardPacket(state, plan, [[42]], 'Local'), TypeError);
    assert.equal(complete(state, boardReport(), [[43]]).board.rows[0].score, 43);
  }
});

test('caught reentry during native output conversion cannot close the old history', () => {
  let active, armed = false;
  const History = conversionBoundary({ snapshot: original => function () {
    const result = Reflect.apply(original, this, []);
    if (armed) assert.throws(() => api.resetLeaderboardWorld(active), TypeError);
    return result;
  } });
  active = api.createLeaderboardState(scene, History);
  armed = true;
  assert.throws(() => complete(active, boardReport(), [[42]]), TypeError);
  armed = false;
  assert.equal(complete(active, boardReport(), [[43]]).board.rows[0].score, 43);
});

test('the JS transition guard covers the native freshness observation itself', () => {
  let active, armed = true;
  const History = conversionBoundary({ is_open: original => function () {
    if (armed) assert.throws(() => api.resetLeaderboardWorld(active), TypeError);
    return Reflect.apply(original, this, []);
  } });
  active = api.createLeaderboardState(scene, History);
  assert.throws(() => api.prepareLeaderboardPacket(active, boardReport()), TypeError);
  armed = false;
  assert.equal(complete(active, boardReport(), [[43]]).board.rows[0].score, 43);
});

test('plan cleanup failure is attempted once before commit and preserves the exact primary', () => {
  let armed = true, attempts = 0;
  const History = conversionBoundary({ discard_plan: original => function (plan) {
    attempts++;
    Reflect.apply(original, this, [plan]);
    if (armed) throw undefined;
  } });
  const state = api.createLeaderboardState(scene, History);
  let caught = false;
  try { complete(state, boardReport(), [[42]]); }
  catch (error) { caught = true; assert.equal(error, undefined); }
  assert.equal(caught, true);
  assert.equal(attempts, 1);
  armed = false;
  assert.equal(complete(state, boardReport(), [[43]]).board.rows[0].score, 43);
});

test('failed reset conversion leaves pending native plans valid', () => {
  let armed = false;
  const History = conversionBoundary({ snapshot: original => function () {
    if (armed) throw 7;
    return Reflect.apply(original, this, []);
  } });
  const state = api.createLeaderboardState(scene, History);
  const plan = api.prepareLeaderboardPacket(state, boardReport());
  armed = true;
  assert.throws(() => api.resetLeaderboardWorld(state), error => error === 7);
  armed = false;
  assert.equal(api.completeLeaderboardPacket(state, plan, [[42]], 'Local').board.rows[0].score, 42);
});

test('exact exports, initial closed state, Symbol identity and pure private admission', () => {
  assert.deepEqual(Object.keys(api).sort(), ['completeLeaderboardPacket', 'createLeaderboardState',
    'leaderboardSemanticView', 'prepareLeaderboardPacket', 'requireLeaderboardState', 'resetLeaderboardWorld']);
  const state = fresh();
  assert.deepEqual(state, { schema: 1, sceneIdentity: scene, tableMax: null,
    setupSeen: false, revision: 0n, board: null });
  freezeTree(state);
  assert.equal(api.requireLeaderboardState(state), state);
  let observations = 0;
  const proxy = new Proxy(state, { get() { observations++; }, ownKeys() { observations++; } });
  for (const value of [null, undefined, {}, { ...state }, proxy, async () => {}, function* () {}]) {
    assert.throws(() => api.requireLeaderboardState(value), TypeError);
    assert.throws(() => api.resetLeaderboardWorld(value), TypeError);
  }
  assert.equal(observations, 0);
  for (const value of [null, 1, {}, 'scene']) assert.throws(() => api.createLeaderboardState(value, LeaderboardHistoryDouble));
});

test('actual schema2 copy plus genuine existing HUD reducer/view retain distinct row names only here', () => {
  const rawA = boardReport([row(1, { name: [65] })]);
  const rawB = boardReport([row(1, { name: [66] })]);
  const old = raw => projectHudView(reduceHudState(createHudState(scene, HudHistoryDouble), scene,
    { kind: 'packet', report: copyHudIngressReport(raw, 2) }), {
    schema: 1, bindingIdentity: Symbol.for('synthetic binding'), documentIdentity: scene,
    sceneIdentity: scene, scope: 'readout', state: 'ready', reason: null });
  assert.deepEqual(old(rawA), old(rawB));
  assert.equal(complete(fresh(), rawA, [[42]]).board.rows[0].nameText, 'A');
  assert.equal(complete(fresh(), rawB, [[42]]).board.rows[0].nameText, 'B');
});

test('ordered board/Setup/board/Setup uses command-time N, validates all before return', () => {
  let state = complete(fresh(), report(setup(0, 1), []), []);
  const raw = report([header(0), ...setup(1, 4), header(2), ...setup(3, 7)], [
    { commandIndex: 0, rows: [row(1, { count: 0, fractionalMass: 0 })] },
    { commandIndex: 2, rows: [] },
  ]);
  const plan = api.prepareLeaderboardPacket(state, raw);
  assert.deepEqual(plan, { schema: 1, sceneIdentity: scene, requests: [
    { commandIndex: 0, tableMax: 1, counts: [0], fractionalMasses: [0] },
    { commandIndex: 2, tableMax: 4, counts: [], fractionalMasses: [] },
  ] });
  freezeTree(plan);
  raw.leaderboardRows[0].rows[0].count = 123;
  state = api.completeLeaderboardPacket(state, plan, [[-20], []], '');
  assert.equal(state.revision, 2n);
  assert.equal(state.tableMax, 7);
  assert.deepEqual(state.board.rows, []);
  freezeTree(state);
  const last = complete(state, report([header(0)], [{ commandIndex: 0, rows: [row()] }]), [[91]]);
  assert.equal(last.tableMax, 7);
  assert.equal(last.board.rows[0].score, 91);
});

test('missing prior Setup, late bad tail, wrong schema/order/palette never expose a plan', () => {
  const state = fresh();
  const bad = [report([header(0), ...setup(1)], [{ commandIndex: 0, rows: [row()] }]),
    { ...boardReport(), schema: 1 }, boardReport([row(1, { paletteIndex: 3 })]),
    boardReport([row(1, { name: [256] })]), boardReport([row(2)]),
    boardReport([row(1, { count: 65536 })]), boardReport([row(1, { fractionalMass: NaN })]),
    report([...setup(0), header(1), header(1)], [{ commandIndex: 1, rows: [] },
      { commandIndex: 1, rows: [] }])];
  for (const raw of bad) assert.throws(() => api.prepareLeaderboardPacket(state, raw), TypeError);
  assert.deepEqual(state, fresh());
  assert.equal(complete(state, boardReport(), [[-5]]).revision, 1n);
});

test('equal and empty boards increment exact BigInt revisions; Setup/reset never rescore', () => {
  let state = complete(fresh(), boardReport(), [[-5]]);
  const board = state.board;
  state = complete(state, report(setup(0, 65000), []), []);
  assert.equal(state.board, board);
  assert.equal(state.revision, 1n);
  state = api.resetLeaderboardWorld(state);
  assert.equal(state.board, board);
  assert.equal(state.tableMax, 65000);
  state = complete(state, boardReport(), [[-5]]);
  assert.equal(state.revision, 2n);
  assert.notEqual(state.board, board);
  state = complete(state, boardReport([]), [[]]);
  assert.equal(state.revision, 3n);
  assert.deepEqual(state.board, { rows: [] });
});

test('all rows, marker0/1/255 and ordinal256; headers0/death do not gate rows', () => {
  const rows = Array.from({ length: 256 }, (_, index) => row(index + 1));
  for (const localRow of [0, 1, 255]) {
    const state = complete(fresh(), boardReport(rows, { localRow, deathPending: true }),
      [rows.map(() => 10)], 'Own');
    assert.equal(state.board.rows.length, 256);
    assert.deepEqual(state.board.rows.filter(row => row.own).map(row => row.ordinal),
      localRow ? [localRow] : []);
    assert.equal(state.board.rows[255].numberText, '#256');
  }
});

test('all palette bytes and exact raw opacity order, never clamped/premultiplied', () => {
  const colors = ['#c080ff', '#9099ff', '#80d0d0', '#80ff80', '#eeee70',
    '#ffa060', '#ff9090', '#ff4040', '#e030e0'];
  const rows = Array.from({ length: 256 }, (_, rawColor) => row(rawColor + 1,
    { rawColor, paletteIndex: rawColor % 9 }));
  const state = complete(fresh(), boardReport(rows, { localRow: 255 }), [rows.map(() => 0)]);
  for (const [index, projected] of state.board.rows.entries()) {
    assert.equal(projected.cssColor, colors[index % 9]);
    assert.equal(projected.opacityRequest, index === 254 ? 1
      : .7 * (.3 + .7 * (1 - (index + 1) / 10)));
  }
  for (const ordinal of [1, 10, 11, 14, 15, 255]) assert.equal(
    state.board.rows[ordinal - 1].opacityRequest, ordinal === 255 ? 1
      : .7 * (.3 + .7 * (1 - ordinal / 10)));
  assert.ok(state.board.rows[14].opacityRequest < 0);
  assert.equal(state.board.rows[255].cssColor, '#80ff80');
});

test('every byte code unit, 255-byte remote bound, controls/newlines/NUL and literal escapes', () => {
  const rows = Array.from({ length: 256 }, (_, value) => row(value + 1, { name: [value] }));
  const projected = complete(fresh(), boardReport(rows), [rows.map(() => 0)]).board.rows;
  for (let unit = 0; unit < 256; unit++) assert.equal(projected[unit].nameText,
    unit === 0 ? '' : unit === 13 ? '\n' : unit === 32 ? '\u00a0' : String.fromCharCode(unit));
  const inputs = [Array(255).fill(255), bytes('A&<>"\' &amp;  '),
    [65, 13, 10, 66, 13, 67, 0, 1, 160, 9], bytes('\\u0041&#65;')];
  const expected = ['\u00ff'.repeat(255), 'A&<>"\'\u00a0&amp;\u00a0\u00a0',
    'A\nB\nC\x01\u00a0\t', '\\u0041&#65;'];
  const state = complete(fresh(), boardReport(inputs.map((name, i) => row(i + 1, { name }))), [[0, 0, 0, 0]]);
  assert.deepEqual(state.board.rows.map(row => row.nameText), expected);
});

test('seven-digit filter, punctuation/non-ASCII do not reset; own substitution bypasses filter', () => {
  const inputs = ['123456', '1.2 3-4!5?6', '1234567', '123456A7', '123456z7',
    '123456\u00ff7', '1234A123456', '1234A1234567', '123456\r7'];
  const expected = ['123456', '1.2\u00a03-4!5?6', '', '123456A7', '123456z7', '', '1234A123456', '', ''];
  const rows = inputs.map((value, i) => row(i + 1, { name: bytes(value) }));
  assert.deepEqual(complete(fresh(), boardReport(rows), [rows.map(() => 0)]).board.rows.map(row => row.nameText), expected);
  const own = complete(fresh(), boardReport([row(1, { name: bytes('1234567') })], { localRow: 1 }),
    [[0]], '1234567 A&<>\x7f');
  assert.equal(own.board.rows[0].nameText, '1234567\u00a0A&<>\x7f');
  assert.equal(own.board.rows[0].own, true);
  for (const nickname of ['', 'X'.repeat(24), '\x7f']) complete(fresh(), boardReport(), [[0]], nickname);
});

test('safe numeric doubles preserve -0/negative/wide; NaN iff exact out-of-table count', () => {
  const values = [-0, -20, 4294967297, Number.MAX_SAFE_INTEGER, NaN];
  const rows = values.map((_, i) => row(i + 1, { count: i === 4 ? 2052 : 2 }));
  const state = complete(fresh(), boardReport(rows), [values]);
  assert.ok(Object.is(state.board.rows[0].score, -0));
  assert.deepEqual(state.board.rows.map(row => row.scoreText), ['0', '-20', '4294967297', '9007199254740991', 'NaN']);
  values[0] = 5;
  assert.ok(Object.is(state.board.rows[0].score, -0));
  for (const bad of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '5', null])
    assert.throws(() => complete(fresh(), boardReport(), [[bad]]), TypeError);
  assert.throws(() => complete(fresh(), boardReport([row(1, { count: 2052 })]), [[0]]), TypeError);
});

test('plan private base identity, single-use, stale alternatives/reset and history admission', () => {
  const state = fresh(), other = fresh();
  const plan = api.prepareLeaderboardPacket(state, boardReport());
  assert.throws(() => api.completeLeaderboardPacket(other, plan, [[0]], ''), TypeError);
  assert.throws(() => api.completeLeaderboardPacket(state, { ...plan }, [[0]], ''), TypeError);
  const stale = api.prepareLeaderboardPacket(state, boardReport());
  const next = api.completeLeaderboardPacket(state, plan, [[0]], '');
  assert.throws(() => api.completeLeaderboardPacket(state, stale, [[0]], ''), TypeError);
  assert.throws(() => api.completeLeaderboardPacket(next, plan, [[0]], ''), TypeError);
  assert.equal(api.requireLeaderboardState(state), state);
  const pending = api.prepareLeaderboardPacket(next, boardReport());
  const reset = api.resetLeaderboardWorld(next);
  assert.throws(() => api.completeLeaderboardPacket(next, pending, [[0]], ''), TypeError);
  assert.throws(() => api.completeLeaderboardPacket(reset, pending, [[0]], ''), TypeError);
  assert.equal(api.requireLeaderboardState(next), next);
});

test('invalid completion consumes plan but leaves state usable/unchanged', () => {
  for (const scores of [[], [[0, 1]], [new Float64Array([0])], [[,]], [[0], []], null]) {
    const state = fresh(), plan = api.prepareLeaderboardPacket(state, boardReport());
    assert.throws(() => api.completeLeaderboardPacket(state, plan, scores, ''), TypeError);
    assert.throws(() => api.completeLeaderboardPacket(state, plan, [[0]], ''), TypeError);
    assert.deepEqual(state, fresh());
    assert.equal(complete(state, boardReport(), [[1]]).revision, 1n);
  }
  for (const ownNickname of [undefined, null, 1, new String('X'), 'X'.repeat(25), '\0', '\r', '\u0080']) {
    const state = fresh(), plan = api.prepareLeaderboardPacket(state, boardReport());
    assert.throws(() => api.completeLeaderboardPacket(state, plan, [[0]], ownNickname), TypeError);
  }
});

test('closed current-realm dense report/results reject accessors/extras/foreign/async without invocation', () => {
  let calls = 0;
  const getter = boardReport();
  Object.defineProperty(getter, 'events', { get() { calls++; return []; } });
  const extras = boardReport(); extras[Symbol('extra')] = 1;
  const rowGetter = boardReport();
  Object.defineProperty(rowGetter.leaderboardRows[0].rows[0], 'name', { get() { calls++; return []; } });
  for (const raw of [getter, extras, rowGetter, vm.runInNewContext('({schema:2})'),
    async () => { calls++; }, function* () { calls++; }]) {
    assert.throws(() => api.prepareLeaderboardPacket(fresh(), raw), TypeError);
  }
  const scoreGetter = [0];
  Object.defineProperty(scoreGetter, '0', { get() { calls++; return 0; } });
  const extra = [0]; extra.foo = 1;
  for (const values of [scoreGetter, extra, vm.runInNewContext('[0]'), [async () => { calls++; }]])
    assert.throws(() => complete(fresh(), boardReport(), [values]), TypeError);
  assert.equal(calls, 0);
});

test('bounded hostile data rejected before ownKeys/element observation and caught reentry poisons', () => {
  let keys = 0;
  const huge = new Proxy(new Array(149796), { ownKeys() { keys++; throw 8; } });
  assert.throws(() => api.prepareLeaderboardPacket(fresh(), boardReport(huge)), TypeError);
  assert.equal(keys, 0);
  const state = fresh(), plan = api.prepareLeaderboardPacket(state, boardReport());
  const scores = new Proxy(new Array(2), { ownKeys() { keys++; throw 9; } });
  assert.throws(() => api.completeLeaderboardPacket(state, plan, scores, ''), TypeError);
  assert.equal(keys, 0);
  const active = fresh();
  const hostile = new Proxy(boardReport(), { ownKeys(target) {
    assert.throws(() => api.resetLeaderboardWorld(active), TypeError);
    return Reflect.ownKeys(target);
  } });
  assert.throws(() => api.prepareLeaderboardPacket(active, hostile), TypeError);
  assert.equal(complete(active, boardReport(), [[0]]).revision, 1n);
  const base = fresh(), pending = api.prepareLeaderboardPacket(base, boardReport());
  const input = new Proxy([[0]], { ownKeys(target) {
    assert.throws(() => api.prepareLeaderboardPacket(base, boardReport()), TypeError);
    return Reflect.ownKeys(target);
  } });
  assert.throws(() => api.completeLeaderboardPacket(base, pending, input, ''), TypeError);
  assert.equal(complete(base, boardReport(), [[0]]).revision, 1n);
});

test('maximum 4096 ordered empty boards are all planned/completed without a row/header gate', () => {
  let state = complete(fresh(), report(setup(0, 1), []), []);
  const events = Array.from({ length: 4096 }, (_, index) => header(index));
  const raw = report(events, events.map(event => ({ commandIndex: event.commandIndex, rows: [] })));
  const plan = api.prepareLeaderboardPacket(state, raw);
  assert.equal(plan.requests.length, 4096);
  assert.deepEqual(plan.requests[4095], { commandIndex: 4095, tableMax: 1,
    counts: [], fractionalMasses: [] });
  state = api.completeLeaderboardPacket(state, plan, events.map(() => []), '');
  assert.equal(state.revision, 4096n);
  assert.deepEqual(state.board.rows, []);
});

test('maximum aggregate 149795 rows retained; aggregate/name budgets precede name-key enumeration', () => {
  const rows = Array.from({ length: 149795 }, (_, index) => row(index + 1, { name: [] }));
  const state = complete(fresh(), boardReport(rows), [rows.map(() => -0)]);
  assert.equal(state.board.rows.length, 149795);
  assert.equal(state.board.rows[149794].numberText, '#149795');
  assert.ok(Object.is(state.board.rows[149794].score, -0));
  let keys = 0;
  const notEnumerated = new Proxy(rows, { ownKeys() { keys++; throw 7; } });
  const oversized = report([...setup(0), header(1), header(2)], [
    { commandIndex: 1, rows: notEnumerated }, { commandIndex: 2, rows: [row()] },
  ]);
  assert.throws(() => api.prepareLeaderboardPacket(fresh(), oversized), TypeError);
  const name = new Proxy(new Array(255), { ownKeys() { keys++; throw 8; } });
  assert.throws(() => api.prepareLeaderboardPacket(fresh(), boardReport(
    Array.from({ length: 4003 }, (_, index) => row(index + 1, { name })))), TypeError);
  assert.equal(keys, 0);
});

test('no emitted boards needs no Setup; unpaired raw board and bad empty-board scores reject', () => {
  let state = complete(fresh(), report([], []), []);
  assert.equal(state.tableMax, null);
  assert.equal(state.board, null);
  assert.equal(state.revision, 0n);
  assert.throws(() => api.prepareLeaderboardPacket(state,
    report([], [{ commandIndex: 0, rows: [row()] }])), TypeError);
  assert.throws(() => complete(fresh(), boardReport([]), [[0]]), TypeError);
});

test('local nickname frozen per board; null prototypes admitted; falsy primaries preserved', () => {
  let state = complete(fresh(), boardReport([row()], { localRow: 1 }), [[10]], 'First');
  const historical = state;
  const raw = Object.assign(Object.create(null), report(setup(0, 1), []));
  state = complete(state, raw, [], 'Second');
  assert.equal(state.board.rows[0].nameText, 'First');
  state = complete(state, boardReport([row()], { localRow: 1 }), [[10]], 'Second');
  assert.equal(state.board.rows[0].nameText, 'Second');
  assert.equal(historical.board.rows[0].nameText, 'First');
  for (const primary of [undefined, null, false, 0, '', NaN]) {
    const base = fresh();
    const hostile = new Proxy(boardReport(), { getPrototypeOf() { throw primary; } });
    let caught = false;
    try { api.prepareLeaderboardPacket(base, hostile); }
    catch (error) { caught = true; assert.ok(Object.is(error, primary)); }
    assert.equal(caught, true);
    assert.equal(complete(base, boardReport(), [[0]]).revision, 1n);
  }
});
