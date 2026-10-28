import { HudHistoryDouble } from './hud-history-double.mjs';
// Original synthetic fixtures; no native scene, DOM, reference or transport inputs.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createHudState, reduceHudState } from '../web/stock-hud-state.mjs';
import * as api from '../web/stock-hud-view.mjs';

const { projectHudView, requireHudView } = api;
const scene = Symbol('synthetic scene');
const statuses = [
  ['ready', null], ['pending', 'nodes-pending'], ['pending', 'text-unselected'],
  ...['stale-document', 'binding-not-selected', 'native-dom-unavailable',
    'binding-failed', 'disposed'].map(reason => ['unavailable', reason]),
];
function binding(overrides = {}) {
  return { schema: 1, bindingIdentity: Symbol('binding'), documentIdentity: Symbol('document'),
    sceneIdentity: scene, scope: 'readout-and-final', state: 'ready', reason: null, ...overrides };
}
function scoreView(score, token = 1n) {
  return { schema: 1, enabled: true, tableMax: 300,
    own: { token, id: 0, logicalSegments: 3, fractionalMass: .25, scoreAdjustment: 0, scoreIndex: 3 },
    status: 'ready', score, error: null };
}
function change(state, input) { return reduceHudState(state, state.sceneIdentity, input); }
function packet(state, events) {
  return change(state, { kind: 'packet', report: { schema: 1, commandCount: events.length,
    setupDraws: 0, events: events.map((event, commandIndex) => ({ commandIndex, ...event })) } });
}
function header(state, rank = 7, population = 23) {
  return packet(state, [{ kind: 'leaderboard', localRow: 0, rank, population, deathPending: false }]);
}
function histories(current = true, final = true, score = 123, token = 1n) {
  let state = createHudState(scene, HudHistoryDouble);
  if (current) state = change(header(state), { kind: 'draw', playing: true, view: scoreView(score, token) });
  if (final) state = packet(state, [{ kind: 'final-score', view: scoreView(score, token) }]);
  return state;
}
function step(state, lifecycle, delta = 0) {
  return change(state, { kind: 'step', delta, lifecycle: { schema: 1, deathPending: false,
    returnActive: false, returnCompleted: false, returnFraction: 0, ...lifecycle } });
}
function exactThrow(operation, expected) {
  let caught = false;
  try { operation(); } catch (error) { caught = true; assert.strictEqual(error, expected); }
  assert.equal(caught, true, 'must throw, including when the thrown value is undefined');
}

test('exports only the two selected seams and admits only genuine issued immutable views', () => {
  assert.deepEqual(Object.keys(api).sort(), ['projectHudView', 'requireHudView']);
  const state = histories();
  const input = binding();
  const view = projectHudView(state, input);
  assert.strictEqual(requireHudView(view), view);
  for (const record of [view, view.binding, view.requestedOpacity, view.current,
    view.current.value, view.final, view.final.value]) assert.equal(Object.isFrozen(record), true);
  assert.notStrictEqual(view.current.value, state.current);
  assert.notStrictEqual(view.final.value, state.final);
  assert.notStrictEqual(view.requestedOpacity, state.requestedOpacity);
  assert.deepEqual(view.requestedOpacity, state.requestedOpacity);
  input.state = 'unavailable'; input.reason = 'disposed'; input.sceneIdentity = Symbol('other');
  assert.deepEqual(view.binding, { state: 'ready', reason: null });
  assert.equal(view.sceneIdentity, scene);
  assert.throws(() => { view.current.value.score = 0; }, TypeError);
  let reads = 0;
  const wrapped = new Proxy(view, { get() { reads++; throw new Error('unreachable'); } });
  for (const fake of [null, undefined, false, 0, 1n, Symbol(), {}, { ...view }, wrapped,
    Object.create(view), Promise.resolve(view)]) assert.throws(() => requireHudView(fake), TypeError);
  assert.equal(reads, 0);
});

test('snapshot membership and scene coherence reject clones/wrappers without inspecting fields', () => {
  const state = histories();
  let reads = 0;
  const wrapped = new Proxy(state, { get() { reads++; throw undefined; } });
  const revoked = Proxy.revocable(state, {}); revoked.revoke();
  for (const fake of [undefined, false, 0, {}, { ...state }, wrapped, revoked.proxy,
    createHudState(Symbol('other scene'), HudHistoryDouble)]) assert.throws(() => projectHudView(fake, binding()), TypeError);
  assert.equal(reads, 0);
});

test('closed binding own-data grammar rejects malformed records without getters or coercion', () => {
  const state = histories();
  let effects = 0;
  const poison = { valueOf() { effects++; throw 0; }, toString() { effects++; throw false; },
    [Symbol.toPrimitive]() { effects++; throw null; } };
  const invalid = [null, undefined, false, 0, '', [], () => {}, Promise.resolve(),
    new Number(1), vm.runInNewContext('({})'), Object.create(binding())];
  for (const key of Object.keys(binding())) {
    const missing = binding(); delete missing[key]; invalid.push(missing);
    invalid.push(binding({ [key]: poison }));
    const accessor = binding();
    Object.defineProperty(accessor, key, { get() { effects++; throw undefined; } });
    invalid.push(accessor);
  }
  const symbolKey = binding(); symbolKey[Symbol('unknown')] = 0; invalid.push(symbolKey);
  const thenable = binding();
  Object.defineProperty(thenable, 'then', { get() { effects++; throw undefined; } });
  invalid.push(thenable, binding({ extra: 0 }), binding({ schema: 2 }), binding({ schema: '1' }),
    binding({ scope: 'final' }), binding({ state: 'unknown' }), binding({ reason: 'unknown' }));
  for (const field of ['bindingIdentity', 'documentIdentity', 'sceneIdentity']) {
    for (const value of [null, undefined, '', 1, 1n, {}, Symbol]) invalid.push(binding({ [field]: value }));
  }
  const reasons = [null, ...statuses.map(([, reason]) => reason).filter(reason => reason !== null)];
  for (const stateName of ['ready', 'pending', 'unavailable']) {
    for (const reason of reasons) {
      if (!statuses.some(([s, r]) => s === stateName && r === reason)) {
        invalid.push(binding({ state: stateName, reason }));
      }
    }
  }
  for (const value of invalid) assert.throws(() => projectHudView(state, value), TypeError);
  assert.equal(effects, 0);
  const nullPrototype = Object.assign(Object.create(null), binding());
  assert.equal(projectHudView(state, nullPrototype).readiness, 'ready');
  const nonenumerable = binding();
  Object.defineProperty(nonenumerable, 'schema', { value: 1, enumerable: false });
  assert.equal(projectHudView(state, nonenumerable).readiness, 'ready');
});

test('binding reflection propagates every thrown identity and never reads properties or then', () => {
  const state = histories();
  for (const primary of [undefined, null, false, 0, new Error('reflection')]) {
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
      const value = new Proxy(binding(), { [trap]() { throw primary; } });
      exactThrow(() => projectHudView(state, value), primary);
    }
  }
  let reads = 0;
  const observed = new Proxy(binding(), { get() { reads++; throw new Error('no property access'); } });
  assert.equal(projectHudView(state, observed).readiness, 'ready');
  const disappearing = new Proxy(binding(), { getOwnPropertyDescriptor() { return undefined; } });
  assert.throws(() => projectHudView(state, disappearing), TypeError);
  const revoked = Proxy.revocable(binding(), {}); revoked.revoke();
  assert.throws(() => projectHudView(state, revoked.proxy), TypeError);
  assert.equal(reads, 0);
});

test('binding validation precedes snapshot admission and retains exact identities on fresh observations', () => {
  const primary = new Error('binding observation failed');
  exactThrow(() => projectHudView(undefined,
    new Proxy(binding(), { ownKeys() { throw primary; } })), primary);
  const state = histories();
  const first = projectHudView(state, binding());
  const nextBinding = binding();
  const next = projectHudView(state, nextBinding);
  assert.notStrictEqual(next, first);
  assert.notEqual(next.bindingIdentity, first.bindingIdentity);
  assert.notEqual(next.documentIdentity, first.documentIdentity);
  assert.equal(next.sceneIdentity, first.sceneIdentity);
  assert.equal(next.bindingIdentity, nextBinding.bindingIdentity);
  assert.equal(next.documentIdentity, nextBinding.documentIdentity);
  assert.deepEqual(next.current.value, first.current.value);
  assert.strictEqual(requireHudView(first), first);
  assert.strictEqual(requireHudView(next), next);
});

test('all binding statuses, selected scopes and history combinations keep truthful role readiness', () => {
  for (const scope of ['readout', 'readout-and-final']) {
    for (const hasCurrent of [false, true]) for (const hasFinal of [false, true]) {
      const state = histories(hasCurrent, hasFinal);
      for (const [status, bindingReason] of statuses) {
        const view = projectHudView(state, binding({ scope, state: status, reason: bindingReason }));
        assert.equal(view.current.data, hasCurrent ? 'ready' : 'unavailable');
        assert.equal(view.current.value === null, !hasCurrent);
        assert.equal(view.current.readiness, status === 'ready' ? (hasCurrent ? 'ready' : 'pending') : status);
        assert.equal(view.current.reason, status !== 'ready' ? bindingReason : hasCurrent ? null : 'no-displayed-current');
        if (scope === 'readout') {
          assert.deepEqual(view.final, { data: 'unavailable', readiness: 'unavailable',
            reason: 'scope-excluded', value: null });
        } else {
          assert.equal(view.final.data, hasFinal ? 'ready' : 'unavailable');
          assert.equal(view.final.value === null, !hasFinal);
          assert.equal(view.final.readiness, status === 'ready' ? (hasFinal ? 'ready' : 'pending') : status);
          assert.equal(view.final.reason, status !== 'ready' ? bindingReason : hasFinal ? null : 'no-captured-final');
        }
        const missing = !hasCurrent ? 'no-displayed-current'
          : scope === 'readout-and-final' && !hasFinal ? 'no-captured-final' : null;
        assert.equal(view.readiness, status === 'ready' ? (missing ? 'pending' : 'ready') : status);
        assert.equal(view.reason, status === 'ready' ? missing : bindingReason);
      }
    }
    for (const [state, reason] of statuses) {
      const view = projectHudView(null, binding({ scope, state, reason }));
      assert.equal(view.readiness, 'unavailable');
      assert.equal(view.reason, state === 'unavailable' ? reason : 'hud-disabled-or-disposed');
      assert.equal(view.fade, null); assert.equal(view.requestedOpacity, null);
      assert.deepEqual(view.current, { data: 'unavailable', readiness: 'unavailable',
        reason: 'hud-disabled-or-disposed', value: null });
      assert.deepEqual(view.final, { data: 'unavailable', readiness: 'unavailable',
        reason: scope === 'readout' ? 'scope-excluded' : 'hud-disabled-or-disposed', value: null });
    }
  }
});

test('displayed/captured histories outlive newer headers, loss of live own and token replacement', () => {
  const first = histories(true, true, 456, 1n);
  const newer = header(first, 9, 30);
  const reset = change(newer, { kind: 'world-reset' });
  const replacement = packet(reset, [{ kind: 'own-length-scheduled', token: 18446744073709551615n }]);
  for (const state of [newer, reset, replacement]) {
    const view = projectHudView(state, binding());
    assert.deepEqual(view.current.value, { score: 456, scoreText: '456', rank: 7, rankText: '7',
      population: 23, populationText: '23', ownToken: 1n });
    assert.deepEqual(view.final.value, { score: 456, scoreText: '456', exclamation: false, suffix: '', ownToken: 1n });
    assert.equal(view.readiness, 'ready');
  }
  assert.equal(reset.rank, 0); assert.equal(reset.population, 0); assert.equal(reset.ownToken, null);
  assert.notEqual(replacement.ownToken, replacement.current.ownToken);
  const next = change(header(replacement, 65535, 65535),
    { kind: 'draw', playing: true, view: scoreView(789, replacement.ownToken) });
  const view = projectHudView(next, binding());
  assert.equal(view.current.value.rankText, '65535');
  assert.equal(view.current.value.populationText, '65535');
  assert.equal(view.current.value.ownToken, 18446744073709551615n);
  assert.equal(view.final.value.ownToken, 1n);
  assert.equal(projectHudView(change(next, { kind: 'draw', playing: false, view: null }), binding())
    .current.value.score, 789);
  const minimum = change(header(createHudState(scene, HudHistoryDouble), 1, 1),
    { kind: 'draw', playing: true, view: scoreView(0) });
  assert.equal(projectHudView(minimum, binding()).current.value.rankText, '1');
  assert.equal(projectHudView(minimum, binding()).current.value.populationText, '1');
});

test('primitive decimal scores preserve -0, negative and large safe integers without formatting extras', () => {
  for (const [score, text] of [[-20, '-20'], [-5, '-5'], [-0, '0'], [0, '0'], [1000, '1000'],
    [1001, '1001'], [4294967296, '4294967296'], [-4294967296, '-4294967296'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'], [Number.MIN_SAFE_INTEGER, '-9007199254740991']]) {
    const view = projectHudView(histories(true, true, score), binding());
    assert.equal(Object.is(view.current.value.score, score), true);
    assert.equal(Object.is(view.final.value.score, score), true);
    assert.equal(view.current.value.scoreText, text); assert.equal(view.final.value.scoreText, text);
    assert.match(text, /^-?[0-9]{1,16}$/); assert.ok(text.length <= 17);
  }
  // The reducer's integer grammar can issue these incompatible observations;
  // this view's narrower token domain must reject rather than round them.
  for (const score of [Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1, 1e21, Number.MAX_VALUE]) {
    assert.throws(() => projectHudView(histories(true, false, score), binding()), TypeError);
    const finalOnly = histories(false, true, score);
    assert.throws(() => projectHudView(finalOnly, binding()), TypeError);
    assert.equal(projectHudView(finalOnly, binding({ scope: 'readout' })).final.value, null);
  }
});

test('conversion uses captured numeric intrinsics and no locale, score math or clock', () => {
  const state = histories(true, true, -4294967296);
  const original = [Number.prototype.toString, Number.isSafeInteger,
    Number.prototype.toLocaleString, Math.pow, Date.now];
  const forbidden = () => { throw new Error('ambient conversion/math/clock'); };
  let view;
  try {
    Number.prototype.toString = forbidden; Number.isSafeInteger = forbidden;
    Number.prototype.toLocaleString = forbidden; Math.pow = forbidden; Date.now = forbidden;
    view = projectHudView(state, binding());
  } finally {
    [Number.prototype.toString, Number.isSafeInteger,
      Number.prototype.toLocaleString, Math.pow, Date.now] = original;
  }
  assert.equal(view.current.value.scoreText, '-4294967296');
  assert.equal(view.final.value.scoreText, '-4294967296');
});

test('final suffix follows captured final flag while current can advance independently', () => {
  for (const [captured, current, suffix] of [[1000, 1001, ''], [1001, 1000, '!']]) {
    const state = histories(true, true, captured);
    const newer = change(header(state), { kind: 'draw', playing: true, view: scoreView(current) });
    const view = projectHudView(newer, binding());
    assert.equal(view.final.value.exclamation, newer.final.exclamation);
    assert.equal(view.final.value.suffix, suffix);
    assert.equal(view.final.value.score, captured);
    assert.equal(view.current.value.score, current);
  }
});

test('raw opacity requests distinguish initial/setup zero from return completion negatives', () => {
  const initial = createHudState(scene, HudHistoryDouble);
  const ready = histories();
  const zeroDelta = step(ready, {}, -0);
  const incoming = step(ready, {}, 5);
  const returning = step(incoming, { deathPending: true, returnActive: true, returnFraction: .37 });
  const complete = step(returning, { returnActive: true, returnCompleted: true });
  const setup = change(complete, { kind: 'packet', report: { schema: 1, commandCount: 1, setupDraws: 1,
    events: [{ kind: 'setup', commandIndex: 0, tableMax: 300 },
      { kind: 'setup-draw', commandIndex: 0, view: scoreView(999) }] } });
  for (const state of [initial, ready, zeroDelta, incoming, returning, complete, setup]) {
    const view = projectHudView(state, binding());
    assert.equal(Object.is(view.fade, state.fade), true);
    for (const key of ['readout', 'header', 'rows', 'announcement']) {
      assert.equal(Object.is(view.requestedOpacity[key], state.requestedOpacity[key]), true);
    }
  }
  assert.equal(projectHudView(initial, binding()).fade, -1);
  assert.deepEqual(projectHudView(initial, binding()).requestedOpacity,
    { readout: 0, header: 0, rows: 0, announcement: 0 });
  const completed = projectHudView(complete, binding());
  assert.equal(completed.fade, -1);
  assert.deepEqual(completed.requestedOpacity, { readout: -1, header: -.85, rows: -1, announcement: -1 });
  assert.equal(completed.current.value.score, 123); assert.equal(completed.final.value.score, 123);
  assert.equal(projectHudView(setup, binding()).fade, -1);
  assert.deepEqual(projectHudView(setup, binding()).requestedOpacity,
    { readout: 0, header: 0, rows: 0, announcement: 0 });
});
