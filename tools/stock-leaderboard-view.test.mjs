import { LeaderboardHistoryDouble } from './leaderboard-history-double.mjs';
import { HudHistoryDouble } from './hud-history-double.mjs';
// Authored synthetic reports and projector-double result arrays. Genuine existing
// HUD membership; the flagged ABI run selects real histories, without browser acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createLeaderboardState, prepareLeaderboardPacket, completeLeaderboardPacket,
  resetLeaderboardWorld } from '../web/stock-leaderboard-state.mjs';
import { createHudState, reduceHudState } from '../web/stock-hud-state.mjs';
import { projectHudView } from '../web/stock-hud-view.mjs';
import * as api from '../web/stock-leaderboard-view.mjs';

const scene = Symbol('synthetic scene'), bindingIdentity = Symbol('binding'), documentIdentity = Symbol('document');
const binding = (changes = {}) => ({ schema: 1, sceneIdentity: scene, bindingIdentity,
  documentIdentity, state: 'ready', reason: null, ...changes });
const create = () => ({ state: createLeaderboardState(scene, LeaderboardHistoryDouble), hud: createHudState(scene, HudHistoryDouble) });
const setupEvents = (index = 0, tableMax = 1) => [
  { kind: 'setup', commandIndex: index, tableMax },
  { kind: 'setup-draw', commandIndex: index, view: { schema: 1, enabled: true,
    tableMax, own: null, status: 'no-own', score: null, error: null } },
];
const header = (commandIndex, deathPending = false) => ({ kind: 'leaderboard', commandIndex,
  localRow: 0, rank: 0, population: 0, deathPending });
const row = (name = [65], count = 0) => ({ ordinal: 1, count, fractionalMass: 0,
  rawColor: 255, paletteIndex: 3, name });
const report = (events, leaderboardRows = []) => ({ schema: 2,
  commandCount: Math.max(1, ...events.map(event => event.commandIndex + 1)),
  setupDraws: events.filter(event => event.kind === 'setup').length, events, leaderboardRows });
function packet(pair, raw, results) {
  return { state: completeLeaderboardPacket(pair.state,
    prepareLeaderboardPacket(pair.state, raw), results, 'Local'),
  hud: reduceHudState(pair.hud, scene, { kind: 'packet', report: raw }) };
}
const board = (pair = create(), rows = [row()], scores = [-20], death = false) => packet(pair,
  report([...setupEvents(), header(1, death)], [{ commandIndex: 1, rows }]), [scores]);
const view = (pair, observed = binding()) => api.projectLeaderboardView(pair.state, pair.hud, observed);
const step = (pair, delta = 1, changes = {}) => ({ state: pair.state,
  hud: reduceHudState(pair.hud, scene, { kind: 'step', delta, lifecycle: { schema: 1,
    deathPending: false, returnActive: false, returnCompleted: false, returnFraction: 1, ...changes } }) });
function frozen(value) {
  if (value && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) frozen(child);
  }
}

test('exact issued closed view grammar and independent deep copies', () => {
  assert.deepEqual(Object.keys(api).sort(), ['projectLeaderboardView', 'requireLeaderboardView']);
  const pair = board(), result = view(pair);
  assert.deepEqual(result, { schema: 1, sceneIdentity: scene, bindingIdentity, documentIdentity,
    revision: 1n, binding: { state: 'ready', reason: null }, readiness: 'ready', reason: null,
    setupSeen: true, boardPresent: true, requestedOpacity: { heading: 0, rows: 0 }, rows: [
      { ordinal: 1, numberText: '#1', score: -20, scoreText: '-20', nameText: 'A',
        cssColor: '#80ff80', own: false, opacityRequest: .7 * (.3 + .7 * (1 - 1 / 10)) },
    ] });
  frozen(result);
  assert.equal(api.requireLeaderboardView(result), result);
  assert.notEqual(result.rows, pair.state.board.rows);
  assert.notEqual(result.rows[0], pair.state.board.rows[0]);
  assert.notEqual(result.rows, view(pair).rows);
  for (const value of [null, { ...result }, new Proxy(result, { ownKeys() { throw 9; } })])
    assert.throws(() => api.requireLeaderboardView(value), TypeError);
});

test('startup/Setup pending board versus accepted empty board; heading opacity before rows', () => {
  let pair = create();
  assert.equal(view(pair).reason, 'no-board');
  assert.equal(view(pair).setupSeen, false);
  pair = packet(pair, report(setupEvents()), []);
  assert.deepEqual(view(pair).binding, { state: 'ready', reason: null });
  assert.equal(view(pair).readiness, 'pending');
  assert.equal(view(pair).setupSeen, true);
  assert.equal(view(pair).boardPresent, false);
  pair = packet(pair, report([header(0)], [{ commandIndex: 0, rows: [] }]), [[]]);
  assert.equal(view(pair).readiness, 'ready');
  assert.equal(view(pair).boardPresent, true);
  assert.deepEqual(view(pair).rows, []);
  assert.equal(view(pair).revision, 1n);
});

test('large accepted boards display only the top ten without discarding history', () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ ...row(), ordinal: index + 1 }));
  const pair = board(create(), rows, rows.map(() => 42));
  const first = view(pair), nextFrame = view(step(pair));
  assert.equal(pair.state.board.rows.length, 1000);
  assert.equal(first.rows.length, 10);
  assert.deepEqual(first.rows.map(value => value.numberText),
    Array.from({ length: 10 }, (_, index) => `#${index + 1}`));
  assert.deepEqual(nextFrame.rows, first.rows);
});

test('genuine actual HUD membership and exact same scene; no spoof/proxy reflection', () => {
  const pair = board();
  const legacy = projectHudView(pair.hud, { ...binding(), scope: 'readout' });
  assert.equal(legacy.current.value, null);
  assert.equal(view(pair).rows[0].nameText, 'A');
  let traps = 0;
  const proxy = new Proxy(pair.hud, { ownKeys() { traps++; }, get() { traps++; } });
  for (const hud of [null, {}, { ...pair.hud }, proxy, createHudState(Symbol('other'), HudHistoryDouble)])
    assert.throws(() => api.projectLeaderboardView(pair.state, hud, binding()), TypeError);
  for (const state of [{ ...pair.state }, {}, new Proxy(pair.state, { get() { traps++; } })])
    assert.throws(() => api.projectLeaderboardView(state, pair.hud, binding()), TypeError);
  assert.equal(traps, 0);
  assert.throws(() => view(pair, binding({ sceneIdentity: Symbol('other') })), TypeError);
});

test('disabled grammar and precedence; no stale binding becomes write authority', () => {
  const disabled = api.projectLeaderboardView(null, null, binding());
  assert.deepEqual(disabled, { schema: 1, sceneIdentity: scene, bindingIdentity, documentIdentity,
    revision: null, binding: { state: 'ready', reason: null }, readiness: 'unavailable',
    reason: 'leaderboard-disabled-or-disposed', setupSeen: false, boardPresent: false,
    requestedOpacity: null, rows: [] });
  assert.throws(() => api.projectLeaderboardView(null, createHudState(scene, HudHistoryDouble), binding()), TypeError);
  assert.equal(api.projectLeaderboardView(null, null,
    binding({ state: 'unavailable', reason: 'disposed' })).reason, 'disposed');
  for (const [state, reasons] of [['pending', ['nodes-pending', 'text-unselected']],
    ['unavailable', ['stale-document', 'binding-not-selected', 'native-dom-unavailable', 'binding-failed', 'disposed']]]) {
    for (const reason of reasons) {
      const result = view(board(), binding({ state, reason }));
      assert.deepEqual(result.binding, { state, reason });
      assert.equal(result.readiness, state);
      assert.equal(result.reason, reason);
      assert.equal(result.rows[0].nameText, 'A');
    }
  }
});

test('binding closed own-data/current-realm grammar rejects callbacks/getters without invocation', () => {
  const pair = board();
  let calls = 0;
  const getter = binding(); Object.defineProperty(getter, 'state', { get() { calls++; return 'ready'; } });
  const tagged = binding(); Object.defineProperty(tagged, Symbol.toStringTag, { get() { calls++; return 'Object'; } });
  const bad = [getter, tagged, { ...binding(), extra: true }, Object.assign(Object.create({}), binding()),
    vm.runInNewContext('({schema:1})'), async () => { calls++; }, function* () { calls++; },
    binding({ schema: 2 }), binding({ state: 'ready', reason: 'disposed' }),
    binding({ state: 'pending', reason: null }), binding({ state: 'unavailable', reason: 'nodes-pending' }),
    binding({ bindingIdentity: 'x' }), binding({ documentIdentity: {} })];
  for (const value of bad) assert.throws(() => view(pair, value), TypeError);
  assert.equal(calls, 0);
  const nullPrototype = Object.assign(Object.create(null), binding());
  assert.equal(view(pair, nullPrototype).readiness, 'ready');
});

test('fade lifecycle exactly borrows genuine HUD opacities; row requests/revision unchanged', () => {
  let pair = board();
  const rows = pair.state.board.rows, revision = pair.state.revision;
  pair = step(pair, 2.5);
  assert.deepEqual(view(pair).requestedOpacity, { heading: .85 * .025, rows: .025 });
  pair = step(pair, 5, { deathPending: true });
  assert.equal(view(pair).requestedOpacity.rows, .025);
  pair = step(pair, 0, { deathPending: true, returnActive: true, returnFraction: .4 });
  assert.deepEqual(view(pair).requestedOpacity, { heading: .85 * .4, rows: .4 });
  pair = step(pair, 0, { returnActive: true, returnCompleted: true, returnFraction: 0 });
  assert.deepEqual(view(pair).requestedOpacity, { heading: -.85, rows: -1 });
  assert.equal(pair.state.board.rows, rows);
  assert.equal(view(pair).revision, revision);
  assert.equal(view(pair).rows[0].opacityRequest, rows[0].opacityRequest);
});

test('world reset/Setup preserve historical names/scores; next board and equal boards replace', () => {
  let pair = step(board(), 1);
  const old = view(pair);
  pair = { state: resetLeaderboardWorld(pair.state), hud: reduceHudState(pair.hud, scene, { kind: 'world-reset' }) };
  assert.deepEqual(view(pair).rows, old.rows);
  assert.deepEqual(view(pair).requestedOpacity, old.requestedOpacity);
  assert.equal(view(pair).setupSeen, true);
  pair = packet(pair, report(setupEvents(0, 65000)), []);
  assert.deepEqual(view(pair).rows, old.rows);
  assert.deepEqual(view(pair).requestedOpacity, { heading: 0, rows: 0 });
  for (const name of [[66], [66]]) {
    pair = packet(pair, report([header(0)], [{ commandIndex: 0, rows: [row(name)] }]), [[42]]);
  }
  assert.equal(view(pair).revision, 3n);
  assert.equal(view(pair).rows[0].nameText, 'B');
  assert.equal(view(pair).rows[0].scoreText, '42');
});

test('pending death board still replaces names without initiating fade', () => {
  const pair = board(create(), [row([66])], [-0], true);
  assert.equal(pair.hud.fade, -1);
  assert.equal(view(pair).rows[0].nameText, 'B');
  assert.ok(Object.is(view(pair).rows[0].score, -0));
  assert.equal(view(pair).rows[0].scoreText, '0');
  assert.equal(view(pair).readiness, 'ready');
});

test('NaN literal survives copied views and does not become missing/unavailable data', () => {
  const pair = board(create(), [row([65], 2050)], [NaN]);
  const result = view(pair);
  assert.equal(result.readiness, 'ready');
  assert.ok(Number.isNaN(result.rows[0].score));
  assert.equal(result.rows[0].scoreText, 'NaN');
});

test('caught reflective reentry poisons projection; falsy reflection errors survive', () => {
  const pair = board();
  const hostile = new Proxy(binding(), { ownKeys(target) {
    assert.throws(() => view(pair), TypeError);
    return Reflect.ownKeys(target);
  } });
  assert.throws(() => view(pair, hostile), TypeError);
  assert.equal(view(pair).readiness, 'ready');
  for (const primary of [undefined, null, false, 0, '', NaN]) {
    let caught = false;
    try { view(pair, new Proxy(binding(), { getPrototypeOf() { throw primary; } })); }
    catch (error) { caught = true; assert.ok(Object.is(error, primary)); }
    assert.equal(caught, true);
    assert.equal(view(pair).readiness, 'ready');
  }
});
