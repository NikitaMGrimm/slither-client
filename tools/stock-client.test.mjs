import { stockSkinPolicyDouble } from './stock-skin-policy-double.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';

// Authored scene/quality doubles verify dispatch and ownership, not Wasm math.
function fixture() {
  const events = [];
  const target = {}, palettes = [{}, {}, {}], background = {};
  let active = false, nextStatistics = false, setupCount = 2;
  let lastPacket, lastRender, failure, onRead, onFood, onRender;
  const foodValue = { authored: 'food-factory-return' }, preyValue = { authored: 'prey-factory-return' };
  const adapter = {
    beginOperation() { events.push('begin'); onRead?.(); assert.equal(active, false); active = true; return Object.freeze({ revision: 'authored' }); },
    resolveAppearance(request) { assert(active); events.push(['appearance', request]); return { face: { kind: 'paired', eyes: { authored: true } }, antenna: null }; },
    resolveRecipe(request) { assert(active); events.push(['recipe', request]); return { schema: 1, revision: 'authored', status: 'ready', recipe: { authored: true } }; },
    resolveAntennaRandom(request) { assert(active); events.push(['random', request]); return Float64Array.of(.25, .75); },
    endOperation() { events.push('end'); assert(active); active = false; },
  };
  const scene = {
    advance(now, lagging) { events.push(['advance', now, lagging]); return { free() { events.push('free-step'); } }; },
    set_gaze_heading(value) { events.push(['gaze', value]); },
    apply_frame_and_render_standard_with_face_presentation_and_prey(...args) {
      events.push('packet'); lastPacket = args;
      args[2]({ skin: 24, id: 7, cosmetic: 255, x: -0, y: 2, customBytes: new Uint8Array() });
      assert.equal(args[3]({ palette: 0 }), foodValue);
      assert.equal(args[4]({ palette: 1 }), preyValue);
      // Model callbacks for each ordered Setup draw are still in one ingress.
      for (let i = 0; i < setupCount; i++) {
        args[12]({ skin: 24, id: 7, own: true, drawOrdinal: i });
        args[13]({ nodeCount: 8, randomPairCount: 7 });
      }
      if (failure) throw failure;
      return setupCount;
    },
    render_standard_with_face_presentation_at_size(...args) {
      events.push('render'); lastRender = args;
      args[7]({ skin: 41, id: 7, own: true, drawOrdinal: 0 });
      onRender?.();
      if (failure) throw failure;
    },
    prepare_draw() { throw new Error('Must not prepare before rendering'); },
    free() { throw new Error('Scene is caller-owned'); },
  };
  const quality = {
    advance(step, playing) { events.push(['quality-advance', playing]); assert.equal(typeof step.free, 'function'); },
    update_statistics(now, count, playing) { events.push(['statistics', now, count, playing]); return nextStatistics; },
    free() { throw new Error('Quality is caller-owned'); },
  };
  const hostAssets = {
    resolveFood(request, operation) { events.push(['food', request.palette, operation]); onFood?.(); return foodValue; },
    resolvePrey(request, operation) { events.push(['prey', request.palette, operation]); return preyValue; },
  };
  const input = { scene, quality, adapter, hostAssets, target, palettes, background, width: 960, height: 540 };
  const client = createStockClient(input);
  return { client, input, scene, quality, adapter, events, target, palettes, background,
    get active() { return active; }, get lastPacket() { return lastPacket; }, get lastRender() { return lastRender; },
    set failure(value) { failure = value; }, set nextStatistics(value) { nextStatistics = value; },
    set setupCount(value) { setupCount = value; }, set onRead(value) { onRead = value; },
    set onFood(value) { onFood = value; }, set onRender(value) { onRender = value; } };
}

test('generalized packet dispatch installs real face, food, prey, recipe and random capabilities in exact Wasm argument order', () => {
  const f = fixture();
  const bytes = Uint8Array.of(1, 2, 3);
  assert.equal(f.client.packet(bytes, true), 2);
  const args = f.lastPacket;
  assert.equal(args.length, 15); assert.equal(args[0], bytes); assert.equal(args[1], true);
  assert.equal(args[5], f.target); assert.deepEqual(args.slice(6, 9), f.palettes); assert.equal(args[9], f.background);
  assert.deepEqual(args.slice(10, 12), [960, 540]); assert.equal(args[14], f.quality);
  const food = f.events.find(event => event[0] === 'food');
  const prey = f.events.find(event => event[0] === 'prey');
  assert.equal(food[2], prey[2]); assert(Object.isFrozen(food[2])); assert.equal(food[2].revision, 'authored');
  assert.equal(f.events.filter(event => event === 'begin').length, 1);
  assert.equal(f.events.filter(event => event === 'end').length, 1);
  assert.equal(f.events.filter(event => event[0] === 'recipe').length, 2);
  assert.equal(f.events.filter(event => event[0] === 'random').length, 2);
  assert(!f.events.some(event => event[0] === 'advance'));
  assert.deepEqual(f.client.diagnostics(), { draws: 2, drawsSinceStatistics: 2, width: 960, height: 540, stopped: false });
  assert.throws(() => args[3]({ palette: 0 }), /outside operation/);
  assert.throws(() => args[2]({ skin: 0 }), /outside operation/);
});

test('operation cleanup preserves the primary thrown value even when both failures are undefined', () => {
  for (const primary of [new Error('original render failure'), undefined]) {
    for (const cleanup of [new Error('cleanup failure'), undefined]) {
      const f = fixture();
      const end = f.adapter.endOperation;
      f.adapter.endOperation = () => { end(); throw cleanup; };
      f.onRender = () => { throw primary; };
      let threw = false;
      try { f.client.render(); }
      catch (error) { threw = true; assert.equal(error, primary); }
      assert.equal(threw, true);
      assert.equal(f.active, false);
      assert.equal(f.events.filter(event => event === 'end').length, 1);
      assert.equal(f.client.diagnostics().stopped, true);
      assert.throws(() => f.client.render(), /stopped/);
      assert.doesNotThrow(() => f.client.dispose(), 'cleanup always releases the operation guard');
    }
  }
});

test('cleanup alone propagates its original thrown value and stops the controller', () => {
  for (const cleanup of [new Error('cleanup failure'), undefined]) {
    const f = fixture();
    const end = f.adapter.endOperation;
    f.adapter.endOperation = () => { end(); throw cleanup; };
    let threw = false;
    try { f.client.render(); }
    catch (error) { threw = true; assert.equal(error, cleanup); }
    assert.equal(threw, true);
    assert.equal(f.client.diagnostics().draws, 1);
    assert.equal(f.client.diagnostics().stopped, true);
    assert.equal(f.active, false);
    assert.doesNotThrow(() => f.client.dispose());
  }
});

test('frame does one advance and quality update before one stock draw; statistics see prior successful Setup draws', () => {
  const f = fixture(); f.client.packet(Uint8Array.of(0)); f.events.length = 0;
  f.nextStatistics = true;
  const view = f.client.frame(40, { lagging: true, playing: false, gazeHeading: -0 });
  assert.deepEqual(f.events.slice(0, 6), ['begin', ['gaze', -0], ['advance', 40, true], ['quality-advance', false], 'free-step', ['statistics', 40, 2, false]]);
  assert.equal(f.events[6], 'render'); assert.equal(f.events.at(-1), 'end');
  assert.equal(f.events.filter(event => event[0] === 'advance').length, 1);
  assert.equal(f.events.filter(event => event === 'render').length, 1);
  assert.equal(view.draws, 3); assert.equal(view.drawsSinceStatistics, 1);
  assert.equal(f.lastRender.length, 10);
  assert.equal(f.lastRender[0], f.target); assert.deepEqual(f.lastRender.slice(1, 4), f.palettes);
  assert.equal(f.lastRender[4], f.background); assert.deepEqual(f.lastRender.slice(5, 7), [960, 540]);
  assert.equal(f.lastRender[9], f.quality);
});

test('update, resize and explicit rendering keep separate clocks, sizes and successful-draw counts', () => {
  const f = fixture();
  f.setupCount = 0; assert.equal(f.client.packet(Uint8Array.of(0)), 0);
  f.events.length = 0;
  assert.equal(f.client.update(8).draws, 0);
  assert.deepEqual(f.events, [['advance', 8, false], ['quality-advance', true], 'free-step', ['statistics', 8, 0, true]]);
  f.events.length = 0;
  assert.equal(f.client.resize(800, 600).draws, 1);
  assert.equal(f.client.render().draws, 2);
  assert.deepEqual(f.lastRender.slice(5, 7), [800, 600]);
  assert(!f.events.some(event => event[0] === 'advance'));
  assert.equal(f.events.filter(event => event === 'begin').length, 2);
  assert(Object.isFrozen(f.client.diagnostics()));
});

test('optional onStep copies lagged numbers once from the single existing step and runs after free before statistics/draw', () => {
  for (const method of ['update', 'frame']) {
    const f = fixture();
    let freed = false, observed, invocations = 0;
    const wasmStep = {
      get whole_steps() { assert.equal(freed, false); f.events.push('read-whole'); return 2; },
      get delta() { assert.equal(freed, false); f.events.push('read-delta'); return .375; },
      get unlagged_delta() { throw new Error('Must copy lagged delta only'); },
      free() { assert.equal(freed, false); freed = true; f.events.push('free-step'); },
    };
    f.scene.advance = (now, lagging) => { f.events.push(['advance', now, lagging]); return wasmStep; };
    f.client[method](17.5, { lagging: true, gazeHeading: -.25, onStep(view) {
      invocations++; observed = view; assert.equal(freed, true);
      assert(Object.isFrozen(view)); assert.deepEqual(Object.keys(view), ['nowMs', 'wholeSteps', 'delta']);
      assert.deepEqual(view, { nowMs: 17.5, wholeSteps: 2, delta: .375 });
      assert.notEqual(view, wasmStep); assert.equal(view.free, undefined);
      assert.throws(() => { view.wholeSteps = 5; }, TypeError);
      f.events.push('on-step');
    } });
    const prefix = method === 'frame' ? ['begin'] : [];
    assert.deepEqual(f.events.slice(0, prefix.length + 9), [...prefix, ['gaze', -.25], ['advance', 17.5, true],
      ['quality-advance', true], 'read-whole', 'read-delta', 'free-step', 'on-step', ['statistics', 17.5, 0, true],
      ...(method === 'frame' ? ['render'] : [])]);
    assert.equal(invocations, 1);
    assert.equal(f.events.filter(event => Array.isArray(event) && event[0] === 'advance').length, 1);
    assert.equal(f.events.filter(event => event === 'read-whole').length, 1);
    assert.equal(f.events.filter(event => event === 'read-delta').length, 1);
    assert.deepEqual(observed, { nowMs: 17.5, wholeSteps: 2, delta: .375 }); // Safe after Wasm ownership ends.
  }
});

test('optional control routes one native pre-motion advance and shares its returned step with quality and observation', () => {
  for (const method of ['update', 'frame']) {
    const f = fixture(); let controls = 0, freed = false;
    const step = { whole_steps: 2, delta: .25, free() { assert.equal(freed, false); freed = true; f.events.push('free-step'); } };
    const view = { nowMs: 12, wholeSteps: 2, delta: .25, control: { own: { token: 9n,
      rawHead: { x: 10, y: 20 }, gazeHeading: 0 }, connected: true } };
    const actions = { gazeHeading: -.5, resetWorld: false, resetLag: true, connected: false };
    const control = request => {
      assert.equal(request, view); controls++; f.events.push('control'); return actions;
    };
    f.scene.advance_with_control = (now, lagging, callback) => {
      assert.equal(callback, control); f.events.push(['advance-control', now, lagging]);
      assert.equal(callback(view), actions); return step;
    };
    f.quality.advance = (actual, playing) => {
      assert.equal(actual, step); assert.equal(freed, false); f.events.push(['quality-advance', playing]);
    };
    f.client[method](12, { lagging: true, playing: false, control, onStep(copy) {
      assert.equal(freed, true); assert.deepEqual(copy, { nowMs: 12, wholeSteps: 2, delta: .25 });
      f.events.push('observed');
    } });
    assert.equal(controls, 1);
    const expected = [...(method === 'frame' ? ['begin'] : []), ['advance-control', 12, true], 'control',
      ['quality-advance', false], 'free-step', 'observed', ['statistics', 12, 0, false]];
    assert.deepEqual(f.events.slice(0, expected.length), expected);
    assert(!f.events.some(event => Array.isArray(event) && ['advance', 'gaze'].includes(event[0])));
    assert.equal(f.events.filter(event => event === 'render').length, method === 'frame' ? 1 : 0);
  }
});

test('readPlaying samples the same-frame lifecycle once after native return for both quality and statistics', () => {
  for (const method of ['update', 'frame']) {
    const f = fixture(); let playing = true, reads = 0, frees = 0;
    const step = { whole_steps: 0, delta: 0, free() { frees++; f.events.push('free-step'); } };
    f.scene.advance_with_control = (now, lagging, control) => {
      f.events.push(['advance-control', now, lagging]);
      control({ nowMs: now, wholeSteps: 0, delta: 0, control: {} });
      f.events.push('native-return'); return step;
    };
    const view = f.client[method](8, { playing: true,
      control() { f.events.push('lifecycle'); playing = false; return {}; },
      readPlaying(...args) {
        assert.deepEqual(args, []); assert.equal(frees, 0);
        assert.equal(f.active, method === 'frame');
        assert.equal(f.events.at(-1), 'native-return'); reads++; f.events.push('read-playing'); return playing;
      },
      onStep() { f.events.push('observed'); playing = true; },
    });
    const expected = [...(method === 'frame' ? ['begin'] : []), ['advance-control', 8, false], 'lifecycle',
      'native-return', 'read-playing', ['quality-advance', false], 'free-step', 'observed', ['statistics', 8, 0, false]];
    assert.deepEqual(f.events.slice(0, expected.length), expected);
    assert.equal(reads, 1); assert.equal(frees, 1); assert.equal(view.stopped, false);
    assert.equal(view.draws, method === 'frame' ? 1 : 0);
    assert.equal(f.events.filter(event => event === 'render').length, method === 'frame' ? 1 : 0);
    assert.equal(f.active, false);
  }
});

test('readPlaying omission preserves legacy and zero-step control playing paths without extra reads', () => {
  const legacy = fixture(); legacy.client.update(0, { playing: false, readPlaying: undefined });
  assert.deepEqual(legacy.events, [['advance', 0, false], ['quality-advance', false], 'free-step', ['statistics', 0, 0, false]]);
  for (const withReader of [false, true]) {
    const f = fixture(); let reads = 0, playing = false;
    f.scene.advance_with_control = (now, _lagging, control) => {
      f.events.push('advance-control'); control({ nowMs: now, wholeSteps: 0, delta: 0, control: {} });
      return { free() { f.events.push('free-step'); } };
    };
    f.client.update(0, { playing: true, control() { playing = false; return {}; },
      ...(withReader ? { readPlaying() { reads++; return playing; } } : {}) });
    assert.deepEqual(f.events, ['advance-control', ['quality-advance', !withReader], 'free-step', ['statistics', 0, 0, !withReader]]);
    assert.equal(reads, Number(withReader));
  }
});

test('readPlaying callback shape and required control reject before capture or any advance', () => {
  for (const method of ['update', 'frame']) {
    const f = fixture();
    for (const readPlaying of [null, false, 0, {}, Promise.resolve(false), async () => false, function* () {}]) {
      assert.throws(() => f.client[method](8, { control() { return {}; }, readPlaying }), /Synchronous readPlaying/);
      assert.deepEqual(f.events, []); assert.equal(f.client.diagnostics().stopped, false);
    }
    assert.throws(() => f.client[method](8, { readPlaying: () => false }), /readPlaying requires control/);
    assert.deepEqual(f.events, []); assert.equal(f.client.diagnostics().stopped, false);
  }
});

test('readPlaying throw or nonboolean frees once, skips remaining consumers and preserves primary through cleanup failure', () => {
  const failure = new Error('playing state read failed');
  const cases = [
    { read() { throw failure; }, primary: failure },
    { read() { throw undefined; }, primary: undefined },
    { read() { throw null; }, primary: null },
    ...[undefined, null, 0, 1, 'false', {}, Promise.resolve(false), new Boolean(false)].map(value => ({ read: () => value, invalid: true })),
  ];
  for (const method of ['update', 'frame']) {
    for (const example of cases) {
      const f = fixture(); let reads = 0, frees = 0;
      f.scene.advance_with_control = (_now, _lagging, control) => {
        f.events.push('advance-control'); control({ control: {} });
        return { free() { frees++; f.events.push('free-step'); } };
      };
      const end = f.adapter.endOperation;
      f.adapter.endOperation = () => { end(); throw new Error('secondary cleanup failure'); };
      let caught = false;
      try { f.client[method](8, { control: () => ({}), readPlaying() { reads++; return example.read(); } }); }
      catch (error) {
        caught = true;
        if (example.invalid) assert.match(String(error), /Explicit boolean required/);
        else assert.equal(error, example.primary);
      }
      assert.equal(caught, true); assert.equal(reads, 1); assert.equal(frees, 1);
      assert.deepEqual(f.events, [...(method === 'frame' ? ['begin'] : []), 'advance-control', 'free-step', ...(method === 'frame' ? ['end'] : [])]);
      assert.equal(f.active, false); assert.equal(f.client.diagnostics().stopped, true);
      assert.equal(f.client.diagnostics().draws, 0);
      assert.throws(() => f.client[method](16), /stopped/);
      assert.doesNotThrow(() => f.client.dispose(), 'operation guard released despite both failures');
    }
  }
});

test('native control failure never samples readPlaying or consumes quality/statistics', () => {
  const f = fixture(); let reads = 0; const failure = new Error('native control failed');
  f.scene.advance_with_control = () => { throw failure; };
  assert.throws(() => f.client.frame(8, { control: () => ({}), readPlaying() { reads++; return false; } }), error => error === failure);
  assert.equal(reads, 0); assert.deepEqual(f.events, ['begin', 'end']);
  assert.equal(f.active, false); assert.equal(f.client.diagnostics().stopped, true);
});

test('control validation rejects invalid hooks, missing native capability and competing legacy gaze before effects', () => {
  for (const method of ['update', 'frame']) {
    const f = fixture();
    for (const control of [null, 0, {}, Promise.resolve(), async () => {}, function* () {}]) {
      assert.throws(() => f.client[method](8, { control }), /Synchronous control/);
      assert.deepEqual(f.events, []); assert.equal(f.client.diagnostics().stopped, false);
    }
    assert.throws(() => f.client[method](8, { control() { return {}; } }), /advance_with_control/);
    assert.deepEqual(f.events, []);
    f.scene.advance_with_control = () => { throw new Error('Must not advance invalid mixed options'); };
    assert.throws(() => f.client[method](8, { control() { return {}; }, gazeHeading: 0 }), /Return gazeHeading from control/);
    assert.deepEqual(f.events, []); assert.equal(f.client.diagnostics().stopped, false);
  }
});

test('native control failure stops without receiving/freeing a step or replaying external callback effects', () => {
  for (const method of ['update', 'frame']) {
    const f = fixture(); const failure = new Error('control send failed'); let externalAttempts = 0;
    f.scene.advance_with_control = (now, lagging, callback) => {
      f.events.push(['advance-control', now, lagging]); callback({ nowMs: now, wholeSteps: 1, delta: .5, control: {} });
      throw new Error('Callback should already have thrown');
    };
    assert.throws(() => f.client[method](8, { control() { externalAttempts++; throw failure; } }), error => error === failure);
    assert.equal(externalAttempts, 1);
    assert.deepEqual(f.events, [...(method === 'frame' ? ['begin'] : []), ['advance-control', 8, false], ...(method === 'frame' ? ['end'] : [])]);
    assert.equal(f.active, false); assert(f.client.diagnostics().stopped);
    assert.throws(() => f.client[method](16), /stopped/); assert.equal(externalAttempts, 1);
  }
});

test('invalid optional observers reject before snapshot/gaze/advance without stopping a valid controller', () => {
  for (const method of ['update', 'frame']) {
    const f = fixture();
    for (const onStep of [null, false, 0, {}, Promise.resolve(), async () => {}, function* () {}, async function* () {}]) {
      assert.throws(() => f.client[method](8, { gazeHeading: 1, onStep }), /Synchronous onStep/);
      assert.deepEqual(f.events, []);
      assert.equal(f.client.diagnostics().stopped, false);
    }
    // Explicit undefined preserves the original no-observation path/getter needs.
    f.client[method](8, { onStep: undefined });
    assert.equal(f.events.filter(event => Array.isArray(event) && event[0] === 'advance').length, 1);
  }
});

test('observer failure after freeing consumed step stops controller and skips statistics/draw with operation cleanup', () => {
  for (const method of ['update', 'frame']) {
    const f = fixture(); const error = new Error('authored observer failure');
    let calls = 0;
    f.scene.advance = (now, lagging) => {
      f.events.push(['advance', now, lagging]);
      return { whole_steps: 1, delta: .125, free() { f.events.push('free-step'); } };
    };
    assert.throws(() => f.client[method](8, { onStep() {
      calls++; assert.equal(f.events.at(-1), 'free-step'); throw error;
    } }), value => value === error);
    assert.equal(calls, 1);
    assert.deepEqual(f.events, [...(method === 'frame' ? ['begin'] : []), ['advance', 8, false],
      ['quality-advance', true], 'free-step', ...(method === 'frame' ? ['end'] : [])]);
    assert.equal(f.active, false); assert(f.client.diagnostics().stopped);
    assert.equal(f.client.diagnostics().draws, 0);
    assert.throws(() => f.client[method](16), /stopped/);
  }
});

test('step getter failures, invalid numeric views, async results and observer reentry honor consumed-step failure policy', () => {
  for (const bad of [{ whole_steps: 6, delta: 1 }, { whole_steps: 1.5, delta: 1 },
    { whole_steps: 1, delta: NaN }, { whole_steps: 1, delta: 5.1 },
    { get whole_steps() { throw new Error('step getter failed'); }, delta: 1 }]) {
    const f = fixture();
    f.scene.advance = () => Object.create(bad, { free: { value() { f.events.push('free-step'); } } });
    assert.throws(() => f.client.frame(8, { onStep() { throw new Error('Must not observe invalid step'); } }), /Invalid observed|step getter failed/);
    assert.deepEqual(f.events, ['begin', ['quality-advance', true], 'free-step', 'end']);
    assert(f.client.diagnostics().stopped);
  }
  for (const makeObserver of [() => () => Promise.resolve(), f => view => {
    assert(Object.is(view.delta, -0)); f.client.render();
  }]) {
    const f = fixture();
    f.scene.advance = () => ({ whole_steps: 0, delta: -0, free() { f.events.push('free-step'); } });
    assert.throws(() => f.client.frame(8, { onStep: makeObserver(f) }), /synchronous|reentry/);
    assert.equal(f.events.at(-1), 'end'); assert.equal(f.active, false); assert(f.client.diagnostics().stopped);
  }
  const f = fixture(); let observed = 0;
  f.quality.advance = () => { throw new Error('quality failed before snapshot'); };
  assert.throws(() => f.client.frame(8, { onStep() { observed++; } }), /quality failed/);
  assert.equal(observed, 0); assert.deepEqual(f.events, ['begin', ['advance', 8, false], 'free-step', 'end']);
});

test('failed packet/draw calls release snapshot, preserve controller counts/size and stop replay', () => {
  for (const method of ['packet', 'resize', 'frame']) {
    const f = fixture(); const error = new Error(`authored ${method} failure`); f.failure = error;
    const invoke = () => method === 'packet' ? f.client.packet(Uint8Array.of(0))
      : method === 'resize' ? f.client.resize(800, 600) : f.client.frame(8);
    assert.throws(invoke, value => value === error);
    assert.equal(f.events.at(-1), 'end'); assert.equal(f.active, false);
    assert.deepEqual(f.client.diagnostics(), { draws: 0, drawsSinceStatistics: 0, width: 960, height: 540, stopped: true });
    const before = f.events.length;
    assert.throws(() => f.client.render(), /stopped/); assert.equal(f.events.length, before);
    if (method === 'frame') assert(f.events.some(event => event[0] === 'advance')); // Update already committed; no rollback claim.
    f.client.dispose(); f.client.dispose();
  }
});

test('failed read/quality/callback cleanup and reentry cannot retry stateful work', () => {
  const f = fixture(); f.onRead = () => { throw new Error('snapshot unavailable'); };
  assert.throws(() => f.client.frame(8), /snapshot unavailable/);
  assert.deepEqual(f.events, ['begin']); assert.equal(f.active, false); assert(f.client.diagnostics().stopped);
  const g = fixture();
  g.quality.advance = () => { throw new Error('quality failed'); };
  assert.throws(() => g.client.frame(8), /quality failed/);
  assert.deepEqual(g.events, ['begin', ['advance', 8, false], 'free-step', 'end']);
  const h = fixture();
  h.onFood = () => h.client.packet(Uint8Array.of(0));
  assert.throws(() => h.client.packet(Uint8Array.of(0)), /reentry/);
  assert.equal(h.active, false); assert.equal(h.events.at(-1), 'end');
  const k = fixture(); k.onRender = () => k.client.dispose();
  assert.throws(() => k.client.render(), /reentry/); assert.equal(k.events.at(-1), 'end');
  const j = fixture(); j.adapter.endOperation = () => { throw new Error('cleanup failed'); };
  assert.throws(() => j.client.render(), /cleanup failed/); assert(j.client.diagnostics().stopped);
});

test('argument checks precede scene calls and disposal leaves caller resources intact', () => {
  const f = fixture();
  for (const action of [() => f.client.packet([]), () => f.client.packet(Uint8Array.of(1), 0),
    () => f.client.update(NaN), () => f.client.frame(1, { lagging: 1 }), () => f.client.frame(1, { gazeHeading: Infinity }),
    () => f.client.resize(0, 500), () => f.client.resize(800, 4097)]) assert.throws(action);
  assert.deepEqual(f.events, []); assert.equal(f.client.diagnostics().stopped, false);
  f.palettes[0] = 'changed outside constructor';
  f.client.render(); assert.notEqual(f.lastRender[1], f.palettes[0]);
  f.client.dispose(); f.client.dispose();
  assert.throws(() => f.client.frame(20), /stopped/);
  assert.equal(f.client.diagnostics().draws, 1);
  assert.throws(() => createStockClient({ ...f.input, width: -1 }), /size/);
});

test('native 4096 backing bound rejects constructor and resize 4097 before any advance or callback', () => {
  const f = fixture();
  for (const [width, height] of [[4097, 1], [1, 4097], [4097, 4097]]) {
    assert.throws(() => createStockClient({ ...f.input, width, height }), /size/);
    assert.throws(() => f.client.resize(width, height), /size/);
    assert.deepEqual(f.events, []);
    assert.equal(f.client.diagnostics().stopped, false);
    assert.equal(f.client.diagnostics().draws, 0);
  }
  const minimum = createStockClient({ ...f.input, width: 1, height: 1 });
  assert.deepEqual(f.events, []);
  minimum.dispose();
  f.client.resize(4096, 4096);
  assert.deepEqual(f.lastRender.slice(5, 7), [4096, 4096]);
  assert(!f.events.some(event => event[0] === 'advance'));
});

test('active controller integrates stock resolver and exact borrowed sources through real provider with synthetic host', () => {
  class HTMLCanvasElement {
    #width = 48; #height = 48;
    get width() { return this.#width; } set width(value) { this.#width = value; }
    get height() { return this.#height; } set height(value) { this.#height = value; }
  }
  class HTMLImageElement {
    get complete() { return true; } get naturalWidth() { return 40; } get naturalHeight() { return 40; }
  }
  const source = new HTMLCanvasElement();
  const base = new HTMLCanvasElement(); base.width = 80; base.height = 96;
  const pupil = new HTMLCanvasElement(); pupil.width = 60; pupil.height = 72;
  const host = { nsr: false, alcsc: Uint8Array.from({ length: 256 }, (_, p) => Number(p <= 35 || [37, 39, 41].includes(p))),
    per_color_imgs: Array.from({ length: 42 }, (_, p) => ({ kmcs: Array(p === 36 ? 60 : 7).fill(source), klp: p !== 36, kfmc: source })),
    komc: source, ksmc: source, kdmc: source, acbulb: source, sest: source, jsebi: base, jsepi: pupil };
  let revision = 1, captures = 0, randomUnits = 0;
  const adapter = createStockSkinAdapter({ ...stockSkinPolicyDouble, realm: { HTMLCanvasElement, HTMLImageElement },
    readSnapshot() { captures++; return { revision, normalGameplay: true, ownAccessory: -1, host,
      readiness: [source, base, pupil].map((source, i) => ({ source, state: 'ready',
        revision: ['body-content', 'base-content', 'pupil-content'][i] })) }; },
    random() { randomUnits++; return .375; } });
  const observed = [], factories = [];
  const request = { skin: 24, id: 0, x: -0, y: 0, cosmetic: 255, customBytes: new Uint8Array() };
  const scene = {
    advance() { return { free() {} }; }, set_gaze_heading() {},
    apply_frame_and_render_standard_with_face_presentation_and_prey(...args) {
      const appearance = args[2](request);
      assert.equal(appearance.face.kind, 'paired');
      assert.equal(appearance.antenna.nodes, 8);
      const single = args[2]({ ...request, skin: 27 });
      assert.deepEqual(single, { face: { kind: 'single-image', geometry: { baseSize: 29, pupilSize: 14, pupilTravel: 4 } }, antenna: null });
      args[3]({ palette: 0 }); args[4]({ palette: 1 });
      for (let i = 0; i < 2; i++) {
        const resolved = args[12](request); observed.push(resolved);
        assert.deepEqual(resolved.recipe.eyes, appearance.face.eyes);
        assert.deepEqual(resolved.recipe.antenna.geometry, appearance.antenna);
        assert.equal(args[13]({ nodeCount: 8, randomPairCount: 7 }).length, 14);
        const face = args[12]({ ...request, skin: 27, drawOrdinal: 1 }); observed.push(face);
        assert.deepEqual(face.recipe.eyes.geometry, single.face.geometry);
      }
      // Same wire ID does not bind the next appearance's distinct style.
      assert.equal(args[2]({ ...request, skin: 41 }).face.eyes.distance, 34);
      return 2;
    },
    render_standard_with_face_presentation_at_size(...args) {
      observed.push(args[7]({ ...request, skin: 41 }));
      observed.push(args[7]({ ...request, skin: 27, drawOrdinal: 1 }));
    },
  };
  const quality = { advance() {}, update_statistics() { return false; } };
  const client = createStockClient({ scene, quality, adapter,
    hostAssets: { resolveFood(_r, op) { factories.push(op.revision); return {}; }, resolvePrey(_r, op) { factories.push(op.revision); return {}; } },
    target: new HTMLCanvasElement(), palettes: [source, source, source], background: new HTMLImageElement(), width: 960, height: 540 });
  assert.equal(client.packet(Uint8Array.of(0)), 2);
  revision = 2; client.frame(8); client.resize(800, 600);
  assert.equal(captures, 3); assert.equal(randomUnits, 28); assert.deepEqual(factories, [1, 1]);
  assert.deepEqual(observed.map(value => value.revision), [1, 1, 1, 1, 2, 2, 2, 2]);
  for (const value of observed) {
    assert.equal(value.status, 'ready'); assert.equal(value.recipe.palettes[0].variants[0].asset.source, source);
    assert.equal(value.recipe.palettes[0].variants[0].asset.revision, 'body-content');
    if (value.recipe.eyes.kind === 'single-image') {
      assert.equal(value.recipe.eyes.baseImage.asset.source, base);
      assert.equal(value.recipe.eyes.pupilImage.asset.source, pupil);
      assert.equal(value.recipe.eyes.baseImage.asset.revision, 'base-content');
      assert.equal(value.recipe.eyes.pupilImage.asset.revision, 'pupil-content');
      assert.deepEqual(value.recipe.eyes.baseImage.sourceRect, [0, 0, 64, 64]);
      assert.deepEqual(value.recipe.eyes.pupilImage.sourceRect, [0, 0, 48, 48]);
    }
  }
  assert.equal(client.diagnostics().draws, 4);
});

test('fixed accessory mode routes packet, HUD, frame, resize and explicit draws without requiring face methods', () => {
  const f = fixture(), selected = [];
  const packet = f.scene.apply_frame_and_render_standard_with_face_presentation_and_prey;
  const render = f.scene.render_standard_with_face_presentation_at_size;
  f.scene.apply_frame_and_render_standard_with_accessory_presentation_and_prey = (...args) => {
    selected.push('packet'); return packet(...args);
  };
  f.scene.render_standard_with_accessory_presentation_at_size = (...args) => {
    selected.push('render'); return render(...args);
  };
  let hudArgs;
  f.scene.apply_frame_and_render_standard_with_accessory_presentation_and_prey_and_hud = (...args) => {
    selected.push('hud'); hudArgs = args;
    const request = { own: true, skin: 40, cosmetic: 255 };
    args[2](request);
    assert.equal(f.events.findLast(event => event[0] === 'appearance')[1], request);
    return { schema: 1, commandCount: 1, setupDraws: 0, events: [] };
  };
  for (const name of ['apply_frame_and_render_standard_with_face_presentation_and_prey',
    'render_standard_with_face_presentation_at_size',
    'apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud']) {
    Object.defineProperty(f.scene, name, { get() { assert.fail('face capability inspected in accessory mode'); } });
  }
  const input = { ...f.input, appearanceMode: 'accessory' }, client = createStockClient(input);
  input.appearanceMode = 'face';
  const bytes = Uint8Array.of(0), plan = { schema: 1, commandCount: 1,
    guards: [{ playing: true, closeRequested: false, deathPending: false }], finalCaptureIndices: [] };
  assert.equal(client.packet(bytes), 2);
  assert.equal(client.packetWithHud(bytes, true, plan).setupDraws, 0);
  assert.equal(hudArgs.length, 16); assert.equal(hudArgs[0], bytes); assert.equal(hudArgs[1], true);
  assert.equal(hudArgs[5], f.target); assert.deepEqual(hudArgs.slice(6, 9), f.palettes);
  assert.deepEqual(hudArgs.slice(10, 12), [960, 540]); assert.equal(hudArgs[14], f.quality);
  assert.deepEqual(hudArgs[15], plan);
  client.frame(8); client.resize(800, 600); client.render();
  assert.deepEqual(selected, ['packet', 'hud', 'render', 'render', 'render']);
  assert.equal(f.events.filter(event => event[0] === 'advance').length, 1);
  assert.equal(f.events.filter(event => event === 'begin').length, 5);
  assert.equal(f.events.filter(event => event === 'end').length, 5);
  assert.deepEqual(client.diagnostics(), { draws: 5, drawsSinceStatistics: 5, width: 800, height: 600, stopped: false });
});

test('appearance mode is explicit and validates selected capabilities before source operations', () => {
  const f = fixture();
  for (const appearanceMode of [null, '', 'auto', 'FACE', false, {}]) {
    assert.throws(() => createStockClient({ ...f.input, appearanceMode }), /appearance mode/);
  }
  assert.throws(() => createStockClient({ ...f.input, appearanceMode: 'accessory' }), /accessory_presentation/);
  for (const name of ['apply_frame_and_render_standard_with_accessory_presentation_and_prey',
    'render_standard_with_accessory_presentation_at_size',
    'apply_frame_and_render_standard_with_accessory_presentation_and_prey_and_hud']) {
    Object.defineProperty(f.scene, name, { get() { assert.fail('default face mode inspected accessory capability'); } });
  }
  createStockClient(f.input).render();
  assert.deepEqual(f.events, ['begin', 'render', ['recipe', { skin: 41, id: 7, own: true, drawOrdinal: 0 }], 'end']);
});
