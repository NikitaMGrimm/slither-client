import { HudHistoryDouble } from './hud-history-double.mjs';
// Original authored synthetic fixtures; no external inputs or native capabilities.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import * as hud from '../web/stock-hud-state.mjs';
import { copyHudScoreView } from '../web/stock-hud-contract.mjs';

const scene = Symbol('synthetic scene');
const fresh = () => hud.createHudState(scene, HudHistoryDouble);
const reduce = (state, change) => hud.reduceHudState(state, scene, change);
const ready = (score = 42, token = 7n) => ({
  schema: 1, enabled: true, tableMax: 3,
  own: { token, id: 0, logicalSegments: 2, fractionalMass: .5, scoreAdjustment: 1, scoreIndex: 3 },
  status: 'ready', score, error: null,
});
const noOwn = () => ({ ...ready(), own: null, status: 'no-own', score: null });
const report = (events, commandCount = Math.max(1, ...events.map(e => e.commandIndex + 1))) => ({
  schema: 1, commandCount, setupDraws: events.filter(e => e.kind === 'setup').length, events,
});
const packet = (state, events, count) => reduce(state, { kind: 'packet', report: report(events, count) });
const own = (commandIndex = 0, token = 7n) => ({ kind: 'own-length-scheduled', commandIndex, token });
const board = (commandIndex = 0, rank = 7, population = 23, deathPending = false) => ({
  kind: 'leaderboard', commandIndex, rank, population, localRow: 2, deathPending,
});
const setup = (commandIndex = 0, view = ready()) => [
  { kind: 'setup', commandIndex, tableMax: view.tableMax },
  { kind: 'setup-draw', commandIndex, view },
];
const final = (commandIndex = 0, score = 1001, token = 7n) => ({
  kind: 'final-score', commandIndex, view: ready(score, token),
});
const pending = () => packet(fresh(), [own(), board(1)]);
const draw = (state, view = ready(), playing = true) => reduce(state, { kind: 'draw', playing, view });
const step = (state, delta = .5, changes = {}) => reduce(state, {
  kind: 'step', delta,
  lifecycle: { schema: 1, deathPending: false, returnActive: false,
    returnCompleted: false, returnFraction: 1, ...changes },
});
const reset = state => reduce(state, { kind: 'world-reset' });

test('generated history methods are captured once and copied fields grant no reduction authority', () => {
  const state = pending();
  const prototype = HudHistoryDouble.prototype;
  const names = ['snapshot', 'reduce', 'required', 'values', 'free'];
  const saved = names.map(name => Object.getOwnPropertyDescriptor(prototype, name));
  let next, values;
  try {
    for (const name of names) Object.defineProperty(prototype, name,
      { configurable: true, value() { assert.fail('late generated method lookup'); } });
    assert.equal(hud.hudReadoutRequired(state, true), true);
    next = draw(state, ready(73));
    values = hud.hudSemanticValues(next, true);
  } finally {
    names.forEach((name, index) => Object.defineProperty(prototype, name, saved[index]));
  }
  assert.equal(next.current.score, 73);
  assert.equal(values.current.scoreText, '73');
  assert.throws(() => reduce({ ...next }, { kind: 'world-reset' }), TypeError);
});

test('missing ABI fails closed; failed native snapshot copy releases the handle and preserves primary', () => {
  assert.throws(() => hud.createHudState(scene), TypeError);
  for (const primary of [undefined, null, false, 0, new Error('snapshot copy')]) {
    let frees = 0;
    class History {
      snapshot() { throw primary; }
      required() {}
      reduce() {}
      values() {}
      free() { frees++; throw new Error('secondary cleanup'); }
    }
    let caught = false;
    try { hud.createHudState(scene, History); }
    catch (error) { caught = true; assert.equal(error, primary); }
    assert.equal(caught, true);
    assert.equal(frees, 1);
  }
});
const opacities = (readout, header = .85 * readout) => ({ readout, header, rows: readout, announcement: readout });

function failsUnchanged(state, change) {
  const before = structuredClone({ ...state, sceneIdentity: null });
  assert.throws(() => reduce(state, change), TypeError);
  assert.deepEqual({ ...state, sceneIdentity: null }, before);
}

test('only three state exports; exact empty closed frozen state', () => {
  assert.deepEqual(Object.keys(hud).sort(), ['createHudState', 'hudReadoutRequired', 'hudSemanticValues', 'reduceHudState']);
  assert.deepEqual(fresh(), {
    schema: 1, sceneIdentity: scene, ownToken: null, rank: 0, population: 0,
    bestRank: 999999999, maxPopulation: 0, dirty: false, fade: -1,
    requestedOpacity: opacities(0), current: null, final: null,
  });
  const state = fresh();
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.requestedOpacity), true);
  for (const identity of [null, {}, 1, 'scene']) assert.throws(() => hud.createHudState(identity, HudHistoryDouble), TypeError);
});

test('state admission rejects clones, readonly claims, getters and proxies without reflection', () => {
  let traps = 0;
  const proxy = new Proxy(fresh(), { getPrototypeOf() { traps++; throw 1; }, ownKeys() { traps++; throw 2; } });
  const claimed = Object.freeze({ ...fresh() });
  for (const state of [null, undefined, 1, claimed, proxy, { get schema() { throw 3; } }]) {
    assert.throws(() => hud.hudReadoutRequired(state, true), TypeError);
    assert.throws(() => reduce(state, { kind: 'world-reset' }), TypeError);
  }
  assert.equal(traps, 0);
  assert.throws(() => hud.reduceHudState(fresh(), Symbol('synthetic scene'), { kind: 'world-reset' }), TypeError);
  assert.throws(() => hud.hudReadoutRequired(fresh(), 1), TypeError);
});

test('readout gate uses dirty, exact playing, rank and population only', () => {
  assert.equal(hud.hudReadoutRequired(fresh(), true), false);
  const state = pending();
  assert.equal(hud.hudReadoutRequired(state, true), true);
  assert.equal(hud.hudReadoutRequired(state, false), false);
  const held = draw(state, null, false);
  assert.equal(held.dirty, true);
  assert.equal(held.current, null);
  for (const [rank, population] of [[0, 23], [7, 0], [0, 0]]) {
    const blocked = packet(state, [board(0, rank, population)]);
    assert.equal(hud.hudReadoutRequired(blocked, true), false);
    assert.equal(draw(blocked, null).dirty, true);
    failsUnchanged(blocked, { kind: 'draw', playing: true, view: ready() });
  }
});

test('extrema include zero; local row and readout history are independent', () => {
  let state = draw(pending(), ready(77));
  state = packet(state, [board(0, 0, 40), board(1, 5, 0), board(2, 9, 23)]);
  assert.equal(state.bestRank, 0);
  assert.equal(state.maxPopulation, 40);
  assert.deepEqual(state.current, { score: 77, rank: 7, population: 23, ownToken: 7n });
  state = draw(state, ready(88));
  assert.deepEqual(state.current, { score: 88, rank: 9, population: 23, ownToken: 7n });
});

for (const score of [-5, -0, 4294967297, Number.MAX_SAFE_INTEGER + 1]) {
  test(`existing copier and reducer preserve Number score ${Object.is(score, -0) ? '-0' : score}`, () => {
    const source = ready(score, 18446744073709551615n);
    const copy = copyHudScoreView(source);
    assert.notEqual(copy, source);
    assert.notEqual(copy.own, source.own);
    assert.equal(Object.isFrozen(copy.own), true);
    assert.equal(Object.is(copy.score, score), true);
    const state = draw(packet(fresh(), [board()]), source);
    assert.equal(Object.is(state.current.score, score), true);
    assert.equal(state.current.ownToken, 18446744073709551615n);
    source.score = 999;
    source.own.token = 8n;
    assert.equal(Object.is(state.current.score, score), true);
    assert.equal(state.current.ownToken, 18446744073709551615n);
    assert.equal(Object.isFrozen(state.current), true);
  });
}

test('ordinary eligible draw rejects all nonready views and malformed ready grammar', () => {
  const unsupported = { ...ready(), tableMax: 1, own: { ...ready().own, logicalSegments: 4096, scoreIndex: 4097 },
    status: 'unsupported', score: null, error: 'index-out-of-range' };
  const views = [null, undefined, noOwn(), { ...ready(), tableMax: null, status: 'no-tables', score: null },
    unsupported, { ...ready(), enabled: false }, { ...ready(), error: 'unknown' },
    { ...ready(), score: NaN }, { ...ready(), score: Infinity }, { ...ready(), score: 1.5 },
    { ...ready(), own: { ...ready().own, token: 7 } },
    { ...ready(), own: { ...ready().own, scoreIndex: 99 } }];
  for (const view of views) failsUnchanged(pending(), { kind: 'draw', playing: true, view });
});

test('shared copier retains the existing three nonready cases without requiring readiness', () => {
  const unsupported = { ...ready(), tableMax: 1, own: { ...ready().own, logicalSegments: 4096, scoreIndex: 4097 },
    status: 'unsupported', score: null, error: 'index-out-of-range' };
  for (const view of [noOwn(), { ...ready(), tableMax: null, status: 'no-tables', score: null }, unsupported]) {
    const copy = copyHudScoreView(view);
    assert.deepEqual(copy, view);
    assert.notEqual(copy, view);
    assert.equal(Object.isFrozen(copy), true);
  }
});

test('no-event/R-only reports preserve consumed history; equal own schedule dirties again', () => {
  const shown = draw(pending(), ready(100));
  const noEvent = packet(shown, [], 4096);
  assert.equal(noEvent.dirty, false);
  assert.deepEqual(draw(noEvent, null).current, shown.current);
  const scheduled = packet(noEvent, [own()]);
  assert.equal(scheduled.dirty, true);
  assert.equal(draw(scheduled, ready(100)).dirty, false);
  assert.equal(draw(packet(shown, [own()]), ready(123)).current.score, 123);
  assert.equal(packet(shown, [own()]).current.score, 100);
});

test('Setup consumes its intermediate sample before later own/final changes', () => {
  const state = packet(pending(), [...setup(0, ready(10)), own(1), final(2, 2000)]);
  assert.deepEqual(state.current, { score: 10, rank: 7, population: 23, ownToken: 7n });
  assert.deepEqual(state.final, { score: 2000, exclamation: true, ownToken: 7n });
  assert.equal(state.dirty, true);
  assert.equal(state.fade, -1);
  assert.deepEqual(state.requestedOpacity, opacities(0));
});

test('Setup-draw has playing=true at its command; later headers do not change its sample', () => {
  const state = packet(pending(), [...setup(0, ready(11)), board(1, 4, 18)]);
  assert.deepEqual(state.current, { score: 11, rank: 7, population: 23, ownToken: 7n });
  assert.equal(state.rank, 4);
  assert.equal(state.fade, 0);
  assert.equal(state.dirty, true);
  assert.deepEqual(state.requestedOpacity, opacities(0));
});

test('repeated Setup does not refresh without a new dirty event; each reset still occurs', () => {
  const state = packet(pending(), [...setup(0, ready(10)), ...setup(1, ready(20))]);
  assert.equal(state.current.score, 10);
  assert.equal(state.dirty, false);
  assert.equal(state.fade, -1);
  const again = packet(pending(), [...setup(0, ready(10)), own(1), ...setup(2, ready(20))]);
  assert.equal(again.current.score, 20);
  assert.equal(again.dirty, false);
});

test('Setup alone changes only visibility when no readout is pending', () => {
  const before = step(packet(draw(pending(), ready(70)), [final(0, 1200)]), 5);
  const after = packet(before, setup(0, noOwn()));
  assert.deepEqual(after, { ...before, fade: -1, requestedOpacity: opacities(0) });
  assert.equal(after.dirty, false);
  assert.equal(after.ownToken, 7n);
  assert.equal(after.final.score, 1200);
  assert.equal(after.current.score, 70);
  assert.notEqual(after.current, before.current);
  assert.notEqual(after.final, before.final);
  assert.deepEqual(draw(after, null, false), after);
});

test('Setup may ignore a structurally valid ineligible nonready/token sample', () => {
  const empty = packet(fresh(), setup(0, noOwn()));
  assert.equal(empty.ownToken, null);
  assert.equal(empty.current, null);
  const bound = packet(fresh(), [own()]);
  assert.equal(packet(bound, setup(0, ready(9, 8n))).ownToken, 7n);
  assert.equal(packet(bound, setup(0, noOwn())).dirty, true);
  failsUnchanged(pending(), { kind: 'packet', report: report(setup(0, noOwn())) });
});

test('final capture is ready, last-wins, strictly >1000 and mutates no readout/fade fields', () => {
  const state = step(pending());
  for (const [score, exclamation] of [[1000, false], [1001, true], [-0, false]]) {
    const next = packet(state, [final(0, 9000), final(1, score)]);
    assert.deepEqual(next, { ...state, final: { score, exclamation, ownToken: 7n } });
    assert.equal(Object.isFrozen(next.final), true);
  }
  assert.equal(packet(fresh(), [final()]).ownToken, 7n);
  failsUnchanged(state, { kind: 'packet', report: report([{ ...final(), view: noOwn() }]) });
});

test('command indices restart per report and are never retained globally', () => {
  const last = packet(fresh(), [own(4095)], 4096);
  const next = packet(last, [board()]);
  assert.equal(draw(next).current.ownToken, 7n);
  assert.deepEqual(Object.keys(next), Object.keys(fresh()));
});

test('live token binding rejects replacement across own, draw, Setup and final paths', () => {
  const state = pending();
  for (const change of [
    { kind: 'packet', report: report([own(0, 8n)]) },
    { kind: 'draw', playing: true, view: ready(9, 8n) },
    { kind: 'packet', report: report(setup(0, ready(9, 8n))) },
    { kind: 'packet', report: report([final(0, 9, 8n)]) },
  ]) failsUnchanged(state, change);
  assert.equal(draw(state, { ...ready(), own: { ...ready().own, id: 60000 } }).ownToken, 7n);
});

test('reset clears only live world fields; old histories coexist with a new token', () => {
  let state = packet(step(draw(pending(), ready(10))), [own(), final(1, 2000)]);
  const cleared = reset(state);
  assert.deepEqual(cleared, { ...state, ownToken: null, rank: 0, population: 0,
    bestRank: 999999999, maxPopulation: 0 });
  assert.equal(cleared.dirty, true);
  state = packet(cleared, [...setup(0, noOwn()), own(1, 8n)]);
  assert.equal(state.ownToken, 8n);
  assert.equal(state.current.ownToken, 7n);
  assert.equal(state.final.ownToken, 7n);
  state = draw(packet(state, [board()]), ready(30, 8n));
  assert.equal(state.current.ownToken, 8n);
  assert.equal(state.final.ownToken, 7n);
  assert.equal(reset(state).dirty, false);
  assert.equal(draw(reset(state), null).dirty, false);
});

test('alive fade analytical checkpoints, zero delta, saturation and sentinel hold', () => {
  assert.deepEqual(step(fresh()).requestedOpacity, opacities(0));
  let state = pending();
  assert.equal(state.fade, 0);
  state = step(state);
  assert.equal(state.fade, .005);
  assert.deepEqual(state.requestedOpacity, opacities(.005, .00425));
  assert.deepEqual(step(state, 0), state);
  state = step(state, 5);
  assert.equal(state.fade, .055);
  for (let i = 0; i < 20; i++) state = step(state, 5);
  assert.equal(state.fade, 1);
  assert.deepEqual(state.requestedOpacity, opacities(1, .85));
  assert.deepEqual(step(state, 5), state);
});

test('pending death holds exact prior requests; leaderboard starts only a live sentinel', () => {
  const hidden = packet(fresh(), [...setup(0, noOwn()), board(1, 7, 23, true)]);
  assert.equal(hidden.fade, -1);
  assert.deepEqual(step(hidden, 5, { deathPending: true }), hidden);
  const alive = step(pending());
  assert.deepEqual(step(alive, 5, { deathPending: true }), alive);
  const header = packet(alive, [board(0, 3, 10)]);
  assert.equal(header.fade, .005);
  assert.deepEqual(header.requestedOpacity, alive.requestedOpacity);
});

test('active return uses exact supplied F even at delta zero; completion wins and reset preserves it', () => {
  const active = step(pending(), 0, { deathPending: true, returnActive: true, returnFraction: .6 });
  assert.equal(active.fade, .6);
  assert.deepEqual(active.requestedOpacity, opacities(.6, .51));
  const done = step(active, 0, { returnActive: true, returnCompleted: true, returnFraction: 0 });
  assert.equal(done.fade, -1);
  assert.deepEqual(done.requestedOpacity, opacities(-1, -.85));
  assert.deepEqual(reset(done).requestedOpacity, opacities(-1, -.85));
  assert.deepEqual(step(reset(done), 5), reset(done));
  assert.deepEqual(draw(done, null, false).requestedOpacity, done.requestedOpacity);
  const setupAgain = packet(done, setup(0, ready()));
  assert.deepEqual(setupAgain.requestedOpacity, opacities(0));
});

test('inactive lifecycle flags/F do not invent a return edge', () => {
  const a = step(pending(), 1, { returnFraction: 0 });
  assert.equal(a.fade, .01);
  const b = step(pending(), 1, { deathPending: true, returnFraction: .75 });
  assert.equal(b.fade, 0);
  assert.deepEqual(b.requestedOpacity, opacities(0));
});

test('step rejects out-of-domain numeric data and inconsistent closed metadata atomically', () => {
  const state = pending();
  for (const delta of [NaN, Infinity, -Infinity, -.01, 5.01, '1', null]) {
    assert.throws(() => step(state, delta), TypeError);
  }
  const invalidLife = [
    ...[NaN, Infinity, -Infinity, -.01, 1.01, '0', null].map(returnFraction => ({ returnFraction })),
    { schema: 2 }, { deathPending: 0 }, { returnActive: 1 }, { returnCompleted: 'false' },
    { returnCompleted: true, returnFraction: 0 },
    { returnCompleted: true, returnActive: true, deathPending: true, returnFraction: 0 },
    { returnCompleted: true, returnActive: true, returnFraction: .1 },
    { returnActive: true, deathPending: false, returnFraction: .5 },
    { returnActive: true, deathPending: true, returnFraction: 0 },
    { extra: true }, { [Symbol()]: 0 },
  ];
  const before = state.requestedOpacity;
  for (const changes of invalidLife) assert.throws(() => step(state, .5, changes), TypeError);
  assert.equal(state.requestedOpacity, before);
  assert.equal(state.fade, 0);
});

test('closed change/lifecycle reject accessors, inheritance, thenables and unknown variants', () => {
  let reads = 0;
  const life = { schema: 1, deathPending: false, returnActive: false, returnCompleted: false,
    get returnFraction() { reads++; return 1; } };
  for (const change of [
    { get kind() { reads++; return 'world-reset'; } },
    Object.create({ kind: 'world-reset' }), { kind: 'constructor' }, { kind: 'toString' },
    { kind: 'world-reset', extra: 1 }, { kind: 'world-reset', [Symbol()]: 1 },
    { kind: 'world-reset', then() {} }, Promise.resolve({ kind: 'world-reset' }),
    { kind: 'step', delta: 1, lifecycle: life },
    { kind: 'draw', playing: true }, { kind: 'draw', playing: 1, view: null },
  ]) failsUnchanged(fresh(), change);
  assert.equal(reads, 0);
  assert.deepEqual(reduce(fresh(), Object.assign(Object.create(null), { kind: 'world-reset' })), fresh());
});

test('shared score copier rejects accessor/inherited/extra/promise records without score getters', () => {
  let reads = 0;
  const accessor = { ...ready(), get score() { reads++; return 1; } };
  for (const view of [accessor, Object.create(ready()), { ...ready(), [Symbol()]: 1 },
    { ...ready(), then() {} }, Promise.resolve(ready()),
    { ...ready(), own: { ...ready().own, get token() { reads++; return 7n; } } },
    { ...ready(), own: { ...ready().own, token: 0n } },
    { ...ready(), own: { ...ready().own, token: 18446744073709551616n } },
  ]) assert.throws(() => copyHudScoreView(view), TypeError);
  assert.equal(reads, 0);
});

test('late structural/semantic packet failure leaves no partial candidate or mutation', () => {
  const state = pending();
  const lateBad = { ...final(3), view: { ...ready(), score: NaN } };
  failsUnchanged(state, { kind: 'packet', report: report([...setup(0), own(1), board(2, 1, 99), lateBad]) });
  failsUnchanged(state, { kind: 'packet', report: report([...setup(0), board(1, 1, 99), own(2, 8n)]) });
  failsUnchanged(state, { kind: 'packet', report: report([board(0, 1, 99), ...setup(1, noOwn())]) });
  assert.equal(state.current, null);
  assert.equal(state.rank, 7);
  assert.equal(state.fade, 0);
  assert.equal(draw(state).current.score, 42);
});

test('report copy excludes getters, sparse/foreign/extra arrays and out-of-order indices', () => {
  let reads = 0;
  const countGetter = { ...report([]), get commandCount() { reads++; return 1; } };
  const sparse = new Array(1);
  const foreign = vm.runInNewContext('[]');
  const extra = []; extra[Symbol()] = 1;
  for (const bad of [countGetter, { ...report([]), events: sparse }, { ...report([]), events: foreign },
    { ...report([]), events: extra }, report([own(), board()]), report([own(1), board(0)]),
    report([{ kind: 'R', commandIndex: 0 }]), report([{ ...own(), [Symbol()]: 1 }]),
    { ...report([]), commandCount: 0 }, { ...report([]), commandCount: 4097 },
    report([{ kind: 'setup-draw', commandIndex: 0, view: ready() }]),
    { ...report(setup()), setupDraws: 0 },
  ]) failsUnchanged(fresh(), { kind: 'packet', report: bad });
  assert.equal(reads, 0);
});

test('copied packet/lifecycle data cannot later mutate snapshots', () => {
  const source = report([board()]);
  const state = reduce(fresh(), { kind: 'packet', report: source });
  source.events[0].rank = 1;
  source.events.push(own(1));
  assert.equal(state.rank, 7);
  const change = { kind: 'step', delta: .5, lifecycle: {
    schema: 1, deathPending: true, returnActive: true, returnCompleted: false, returnFraction: .7,
  } };
  const after = reduce(state, change);
  change.lifecycle.returnFraction = 0;
  assert.equal(after.fade, .7);
  assert.equal(Reflect.ownKeys(after).length, 12);
});

test('8192-event boundary is accepted without retaining events; oversize rejected before enumeration', () => {
  const events = [];
  for (let index = 0; index < 4096; index++) events.push(...setup(index, noOwn()));
  const result = packet(fresh(), events, 4096);
  assert.deepEqual(result, fresh());
  assert.equal(Object.hasOwn(result, 'events'), false);
  let enumerations = 0;
  const oversized = new Proxy(new Array(8193), { ownKeys() { enumerations++; throw new Error('unbounded'); } });
  failsUnchanged(result, { kind: 'packet', report: { ...report([], 4096), events: oversized } });
  assert.equal(enumerations, 0);
});

test('cyclic/fresh proxy prototypes are inspected once, never walked recursively', () => {
  let inspections = 0;
  let cyclic;
  cyclic = new Proxy({ kind: 'world-reset' }, { getPrototypeOf() { inspections++; return cyclic; } });
  failsUnchanged(fresh(), cyclic);
  assert.equal(inspections, 1);
  const make = () => new Proxy({ kind: 'world-reset' }, { getPrototypeOf() { inspections++; return make(); } });
  failsUnchanged(fresh(), make());
  assert.equal(inspections, 2);
  const cycle = { ...ready() }; cycle.own = cycle;
  assert.throws(() => copyHudScoreView(cycle), TypeError);
  const change = { kind: 'step', delta: 1 }; change.lifecycle = change;
  failsUnchanged(fresh(), change);
});

test('reflection propagates exact falsy thrown values and preserves input', () => {
  const state = pending();
  for (const thrown of [undefined, null, false, 0, new Error('identity')]) {
    for (const change of [
      new Proxy({ kind: 'world-reset' }, { getOwnPropertyDescriptor() { throw thrown; } }),
      { kind: 'draw', playing: true, view: new Proxy(ready(), { ownKeys() { throw thrown; } }) },
      { kind: 'packet', report: new Proxy(report([]), { getOwnPropertyDescriptor() { throw thrown; } }) },
    ]) {
      let caught = false;
      try { reduce(state, change); } catch (error) { caught = true; assert.equal(error, thrown); }
      assert.equal(caught, true);
      assert.equal(state.current, null);
      assert.equal(state.dirty, true);
    }
  }
});
