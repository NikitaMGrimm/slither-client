// Authored controller/native/source doubles only; no Wasm, browser or network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockClient } from './fixtures/stock-client-fixture.mjs';

const nativeName = 'apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud';
const guard = () => ({ playing: true, closeRequested: false, deathPending: false });
const plan = (commandCount = 1) => ({ schema: 1, commandCount,
  guards: Array.from({ length: commandCount }, guard), finalCaptureIndices: [] });
const own = () => ({ token: 18446744073709551615n, id: 0, logicalSegments: 4,
  fractionalMass: .5, scoreAdjustment: 3, scoreIndex: 7 });
const view = (score = -0) => ({ schema: 1, enabled: true, tableMax: 17,
  own: own(), status: 'ready', score, error: null });
const report = (commandCount = 1) => ({ schema: 1, commandCount, setupDraws: 0, events: [] });
const richReport = () => ({ schema: 1, commandCount: 6, setupDraws: 2, events: [
  { commandIndex: 0, kind: 'setup', tableMax: 17 },
  { commandIndex: 0, kind: 'setup-draw', view: view() },
  { commandIndex: 1, kind: 'own-length-scheduled', token: 1n },
  { commandIndex: 2, kind: 'leaderboard', localRow: 255, rank: 0, population: 65535, deathPending: true },
  { commandIndex: 3, kind: 'final-score', view: view(-41) },
  { commandIndex: 4, kind: 'setup', tableMax: 17 },
  { commandIndex: 4, kind: 'setup-draw', view: view(2 ** 40) },
] });
function frozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  for (const child of Object.values(value)) frozen(child);
}
function caught(callback, expected) {
  let failed = false;
  try { callback(); } catch (error) { failed = true; assert.equal(error, expected); }
  assert(failed, 'must throw even when the value is undefined');
}
function fixture({ hud = true } = {}) {
  const trace = [], calls = [], held = Object.freeze({ revision: 'synthetic' });
  let active = false;
  const hooks = {};
  const adapter = {
    beginOperation() { trace.push('begin'); hooks.begin?.(); assert(!active); active = true; return held; },
    endOperation() { assert(active); active = false; trace.push('end'); hooks.end?.(); },
    resolveAppearance(request) { assert(active); trace.push('appearance'); return request; },
    resolveRecipe(request) { assert(active); trace.push('recipe'); return request; },
    resolveAntennaRandom(request) { assert(active); trace.push('random'); return request; },
  };
  const hostAssets = {
    resolveFood(request, snapshot) { assert.equal(snapshot, held); assert(active); trace.push('food'); return request; },
    resolvePrey(request, snapshot) { assert.equal(snapshot, held); assert(active); trace.push('prey'); return request; },
  };
  const scene = {
    apply_frame_and_render_standard_with_face_presentation_and_prey(...args) { trace.push('legacy'); calls.push(args); return 2; },
    render_standard_with_face_presentation_at_size() { trace.push('render'); },
    advance() { trace.push('advance'); return { free() { trace.push('free'); } }; },
    set_gaze_heading() { assert.fail('no gaze in packet'); },
    enable_score_tracking() { assert.fail('caller must explicitly opt in'); },
    score_view() { assert.fail('no bundle-end score observation'); },
    decode_frame() { assert.fail('no extra decode'); },
  };
  if (hud) scene[nativeName] = (...args) => {
    assert(active); trace.push('native'); calls.push(args);
    return hooks.native ? hooks.native(args) : report(args.at(-1).commandCount);
  };
  const quality = {
    advance() { trace.push('quality'); },
    update_statistics(_now, draws) { trace.push(['statistics', draws]); return false; },
  };
  const input = { scene, quality, adapter, hostAssets, target: {}, palettes: [{}, {}, {}], background: {}, width: 960, height: 540 };
  const client = createStockClient(input);
  return { client, input, scene, trace, calls, hooks, get active() { return active; } };
}

test('HUD uses one held capture, exact ABI plus plan last, stable resolver identities and one draw charge', () => {
  const f = fixture(), bytes = Uint8Array.of(97), original = plan(6), native = richReport();
  f.hooks.native = args => {
    assert.equal(args.length, 16); assert.equal(args[0], bytes); assert.equal(args[1], true);
    assert.equal(args[5], f.input.target); assert.deepEqual(args.slice(6, 9), f.input.palettes);
    assert.equal(args[9], f.input.background); assert.deepEqual(args.slice(10, 12), [960, 540]);
    assert.equal(args[14], f.input.quality); assert.notEqual(args[15], original);
    assert.deepEqual(args[15], original); frozen(args[15]);
    for (const index of [2, 3, 4, 12, 13]) { const request = {}; assert.equal(args[index](request), request); }
    return native;
  };
  f.hooks.end = () => { native.events[0].tableMax = 29; f.trace.push('released'); };
  const copied = f.client.packetWithHud(bytes, true, original);
  f.trace.push('returned');
  assert.deepEqual(f.trace, ['begin', 'native', 'appearance', 'food', 'prey', 'recipe', 'random', 'end', 'released', 'returned']);
  assert.equal(copied.events[0].tableMax, 17); assert.notEqual(copied, native); frozen(copied);
  assert(Object.is(copied.events[1].view.score, -0));
  assert.equal(copied.events[4].view.score, -41); assert.equal(copied.events[6].view.score, 2 ** 40);
  assert.equal(copied.events[1].view.own.token, 18446744073709551615n);
  assert.deepEqual(f.client.diagnostics(), { draws: 2, drawsSinceStatistics: 2, width: 960, height: 540, stopped: false });
  f.client.packet(bytes);
  for (const index of [2, 3, 4, 12, 13]) assert.equal(f.calls[0][index], f.calls[1][index]);
  assert.equal(f.calls[1].length, 15); assert.equal(f.calls[1][1], false);
  for (const index of [2, 3, 4, 12, 13]) assert.throws(() => f.calls[0][index]({}), /outside operation/);
  f.client.update(8);
  assert.deepEqual(f.trace.at(-1), ['statistics', 4], 'two successful draws charged once per packet');
});

test('legacy construction and packets do not inspect new native capability or enable score mode', () => {
  const f = fixture({ hud: false });
  Object.defineProperty(f.scene, nativeName, { get() { assert.fail('lazy capability only'); } });
  assert.equal(createStockClient(f.input).packet(Uint8Array.of(1)), 2);
  assert.deepEqual(f.trace, ['begin', 'legacy', 'end']);
});

const invalidPlans = [
  ['missing', () => undefined], ['null', () => null], ['Promise', () => Promise.resolve(plan())],
  ['schema', () => ({ ...plan(), schema: 3 })], ['zero', () => plan(0)],
  ['oversize', () => ({ ...plan(), commandCount: 4097 })],
  ['mismatched guards', () => ({ ...plan(), guards: [] })],
  ['guard hole', () => ({ ...plan(), guards: Array(1) })],
  ['guard accessor', () => ({ ...plan(), guards: [{ ...guard(), get playing() { assert.fail('getter'); } }] })],
  ['guard inherited', () => ({ ...plan(), guards: [Object.create(guard())] })],
  ['nonboolean', () => ({ ...plan(), guards: [{ ...guard(), playing: 1 }] })],
  ['record inherited', () => Object.create(plan())],
  ['record foreign prototype', () => Object.assign(Object.create({}), plan())],
  ['symbol', () => ({ ...plan(), [Symbol()]: true })],
  ['then accessor', () => ({ ...plan(), get then() { assert.fail('then'); } })],
  ['guards extra', () => { const p = plan(); p.guards.extra = true; return p; }],
  ['array inherited', () => { const p = plan(); Object.setPrototypeOf(p.guards, {}); return p; }],
  ['guard index getter', () => { const p = plan(); Object.defineProperty(p.guards, 0, { get() { assert.fail('index getter'); } }); return p; }],
  ['capture duplicates', () => ({ ...plan(2), finalCaptureIndices: [1, 1] })],
  ['capture order', () => ({ ...plan(2), finalCaptureIndices: [1, 0] })],
  ['capture range', () => ({ ...plan(), finalCaptureIndices: [1] })],
  ['cyclic', () => { const p = plan(); p.guards[0] = p; return p; }],
  ['large guards before enumeration', () => ({ ...plan(), guards: new Proxy(Array(4097), { ownKeys() { assert.fail('must bound first'); } }) })],
];
for (const [name, create] of invalidPlans) test(`plan preflight rejects ${name} before capture/native`, () => {
  const f = fixture();
  assert.throws(() => f.client.packetWithHud(Uint8Array.of(1), false, create()), TypeError);
  assert.deepEqual(f.trace, []); assert(f.client.diagnostics().stopped);
});

test('bytes, required header and lazy native capability reject before capture', () => {
  for (const bytes of [undefined, [], new Uint16Array(1), Object.create(Uint8Array.prototype), new Proxy(new Uint8Array(1), {})]) {
    const f = fixture(); assert.throws(() => f.client.packetWithHud(bytes, false, plan()), TypeError); assert.deepEqual(f.trace, []);
  }
  for (const header of [undefined, null, 0, 1, 'false', new Boolean(false)]) {
    const f = fixture(); assert.throws(() => f.client.packetWithHud(new Uint8Array(1), header, plan()), TypeError); assert.deepEqual(f.trace, []);
  }
  const f = fixture({ hud: false });
  assert.throws(() => f.client.packetWithHud(new Uint8Array(1), false, plan()), /capability/); assert.deepEqual(f.trace, []);
});

test('preflight reflection/capability traps run under guard and preserve exact thrown primaries', () => {
  for (const primary of [undefined, null, false, 0, new Error('reflection')]) {
    const f = fixture();
    const p = new Proxy(plan(), { ownKeys() {
      assert.throws(() => f.client.packetWithHud(new Uint8Array(1), false, plan()), /reentry/);
      assert.throws(() => f.client.packet(new Uint8Array(1)), /reentry/);
      assert.throws(() => f.client.dispose(), /reentry/);
      throw primary;
    } });
    caught(() => f.client.packetWithHud(new Uint8Array(1), false, p), primary);
    assert.deepEqual(f.trace, []); assert(f.client.diagnostics().stopped);
  }
  const f = fixture({ hud: false });
  Object.defineProperty(f.scene, nativeName, { get() {
    assert.throws(() => f.client.render(), /reentry/); return () => report();
  } });
  f.client.packetWithHud(new Uint8Array(1), false, plan());
  assert.deepEqual(f.trace, ['begin', 'end']);
});

test('plan is copied before held source capture and maximum command budget stays bounded', () => {
  const f = fixture(), p = plan(4096);
  f.hooks.begin = () => { p.commandCount = 1; p.guards[0].playing = false; };
  f.hooks.native = args => { assert.equal(args[15].commandCount, 4096); assert.equal(args[15].guards[0].playing, true); return report(4096); };
  assert.equal(f.client.packetWithHud(new Uint8Array(1), false, p).commandCount, 4096);
});

const invalidReports = [
  ['numeric', () => 1], ['undefined', () => undefined], ['null', () => null],
  ['Promise', () => Promise.resolve(report())], ['count mismatch', () => report(2)],
  ['schema', () => ({ ...report(), schema: 0 })], ['draw bound', () => ({ ...report(), setupDraws: 2 })],
  ['missing setup pair', () => ({ ...report(), setupDraws: 1, events: [{ commandIndex: 0, kind: 'setup', tableMax: 17 }] })],
  ['missing draw count', () => ({ ...richReport(), setupDraws: 1, commandCount: 1 })],
  ['events oversize before enumeration', () => ({ ...report(), events: new Proxy(Array(3), { ownKeys() { assert.fail('bound first'); } }) })],
  ['events hole', () => ({ ...report(), events: Array(1) })],
  ['record getter', () => ({ ...report(), get setupDraws() { assert.fail('getter'); } })],
  ['then getter', () => ({ ...report(), get then() { assert.fail('then'); } })],
  ['kind getter', () => ({ ...report(), events: [{ commandIndex: 0, get kind() { assert.fail('kind'); } }] })],
  ['event symbol', () => ({ ...report(), events: [{ commandIndex: 0, kind: 'own-length-scheduled', token: 1n, [Symbol()]: 0 }] })],
  ['unknown event', () => ({ ...report(), events: [{ commandIndex: 0, kind: 'then' }] })],
  ['token rounded number', () => ({ ...report(), events: [{ commandIndex: 0, kind: 'own-length-scheduled', token: 1 }] })],
  ['token zero', () => ({ ...report(), events: [{ commandIndex: 0, kind: 'own-length-scheduled', token: 0n }] })],
  ['token overflow', () => ({ ...report(), events: [{ commandIndex: 0, kind: 'own-length-scheduled', token: 2n ** 64n }] })],
  ['duplicate index', () => ({ ...report(), events: [0, 0].map(commandIndex => ({ commandIndex, kind: 'own-length-scheduled', token: 1n })) })],
  ['no final ready', () => ({ ...report(), events: [{ commandIndex: 0, kind: 'final-score', view: { ...view(), status: 'no-own', own: null, score: null } }] })],
  ...[NaN, Infinity, .5].map(score => [`score ${score}`, () => ({ ...report(), events: [{ commandIndex: 0, kind: 'final-score', view: view(score) }] })]),
  ['bad score index', () => ({ ...report(), events: [{ commandIndex: 0, kind: 'final-score', view: { ...view(), own: { ...own(), scoreIndex: 8 } } }] })],
];
for (const [name, create] of invalidReports) test(`report rejects ${name}, releases once and stops without a successful count`, () => {
  const f = fixture(); f.hooks.native = create;
  assert.throws(() => f.client.packetWithHud(new Uint8Array(1), false, plan()), TypeError);
  assert.deepEqual(f.trace, ['begin', 'native', 'end']);
  assert.equal(f.active, false); assert.equal(f.client.diagnostics().draws, 0); assert(f.client.diagnostics().stopped);
  assert.throws(() => f.client.packetWithHud(new Uint8Array(1), false, plan()), /stopped/);
});

test('native, report reflection and release failures preserve primary identity including undefined/null', () => {
  for (const phase of ['native', 'report']) for (const primary of [undefined, null, false, 0, new Error('primary')]) {
    for (const cleanup of [undefined, null, new Error('secondary release')]) {
      const f = fixture();
      f.hooks.native = () => {
        if (phase === 'native') throw primary;
        return new Proxy(report(), { ownKeys() { throw primary; } });
      };
      f.hooks.end = () => { throw cleanup; };
      caught(() => f.client.packetWithHud(new Uint8Array(1), false, plan()), primary);
      assert.deepEqual(f.trace, ['begin', 'native', 'end']); assert(!f.active); assert(f.client.diagnostics().stopped);
    }
  }
});

test('release alone fails after native commit/draw charge, withholds the report and never replays', () => {
  for (const cleanup of [undefined, null, new Error('release')]) {
    const f = fixture(); let commits = 0;
    f.hooks.native = () => { commits++; return richReport(); };
    f.hooks.end = () => { assert.equal(f.client.diagnostics().draws, 2); throw cleanup; };
    caught(() => f.client.packetWithHud(new Uint8Array(1), false, plan(6)), cleanup);
    assert.equal(commits, 1); assert.equal(f.client.diagnostics().draws, 2);
    assert.throws(() => f.client.packetWithHud(new Uint8Array(1), false, plan(6)), /stopped/);
    assert.equal(commits, 1); assert(!f.active); f.client.dispose();
  }
});

test('capture failure has no unmatched release; same-stack native/release reentry cannot mutate controller', () => {
  const f = fixture(); f.hooks.begin = () => { throw undefined; };
  caught(() => f.client.packetWithHud(new Uint8Array(1), false, plan()), undefined);
  assert.deepEqual(f.trace, ['begin']); assert(!f.active);
  const g = fixture();
  const probe = () => {
    for (const call of [() => g.client.packetWithHud(new Uint8Array(1), false, plan()), () => g.client.render(),
      () => g.client.frame(1), () => g.client.resize(2, 2), () => g.client.dispose()]) assert.throws(call, /reentry/);
  };
  g.hooks.native = () => { probe(); return report(); }; g.hooks.end = probe;
  assert.equal(g.client.packetWithHud(new Uint8Array(1), false, plan()).setupDraws, 0);
  assert.deepEqual(g.trace, ['begin', 'native', 'end']); assert(!g.client.diagnostics().stopped);
});

test('closed null-prototype data copies correctly; report Proxy traps stay inside operation guard', () => {
  const f = fixture(), p = Object.assign(Object.create(null), plan());
  p.guards[0] = Object.assign(Object.create(null), p.guards[0]);
  f.hooks.native = () => new Proxy(Object.assign(Object.create(null), report()), {
    ownKeys(value) {
      assert.throws(() => f.client.dispose(), /reentry/);
      assert.throws(() => f.client.packetWithHud(new Uint8Array(1), false, plan()), /reentry/);
      assert(f.active); return Reflect.ownKeys(value);
    },
  });
  const copied = f.client.packetWithHud(new Uint8Array(1), false, p);
  assert.deepEqual(copied, report()); frozen(copied);
  assert.deepEqual(f.trace, ['begin', 'native', 'end']);
});

test('closed score/event consistency rejects incompatible native reports without recomputation', () => {
  const cases = [
    v => { v.enabled = false; }, v => { v.error = 'index-out-of-range'; },
    v => { v.own.id = 65536; }, v => { v.own.token = 0n; },
    v => { v.own.logicalSegments = 4097; }, v => { v.own.fractionalMass = NaN; },
    v => { v.own.fractionalMass = 1.01; }, v => { v.own.scoreAdjustment = 256; },
    v => { v.tableMax = 0; }, v => { v.status = 'unsupported'; v.score = null; v.error = 'invalid-fractional-mass'; },
    v => { Object.defineProperty(v.own, 'token', { get() { assert.fail('token getter'); } }); },
  ];
  for (const change of cases) {
    const f = fixture();
    f.hooks.native = () => {
      const value = view(); change(value);
      return { ...report(), events: [{ commandIndex: 0, kind: 'final-score', view: value }] };
    };
    assert.throws(() => f.client.packetWithHud(new Uint8Array(1), false, plan()), TypeError);
    assert.deepEqual(f.trace, ['begin', 'native', 'end']); assert.equal(f.client.diagnostics().draws, 0);
  }
});

const rowsReport = () => ({ ...richReport(), schema: 2, leaderboardRows: [{ commandIndex: 2,
  rows: [{ ordinal: 1, count: 65535, fractionalMass: 1 / 16777215, rawColor: 255, paletteIndex: 3, name: [0, 65, 255] }] }] });
const rowsPlan = (count = 6) => ({ ...plan(count), schema: 2 });

test('schema2 uses the same ABI/held sources/draw and clock charges, copying raw rows before release', () => {
  const f = fixture(), native = rowsReport();
  f.hooks.native = args => { assert.equal(args[15].schema, 2); frozen(args[15]); return native; };
  f.hooks.end = () => { native.leaderboardRows[0].rows[0].name[1] = 66; };
  const copied = f.client.packetWithHud(Uint8Array.of(108), false, rowsPlan());
  assert.deepEqual(copied.leaderboardRows[0].rows[0].name, [0, 65, 255]); frozen(copied);
  assert.deepEqual(f.trace, ['begin', 'native', 'end']);
  assert.equal(f.client.diagnostics().draws, 2);
  f.client.update(8);
  assert.deepEqual(f.trace.slice(3), ['advance', 'quality', 'free', ['statistics', 2]]);
  const legacy = fixture(); legacy.hooks.native = richReport;
  assert.equal(Object.hasOwn(legacy.client.packetWithHud(Uint8Array.of(108), false, plan(6)), 'leaderboardRows'), false);
});

test('valid reports must match the selected schema in either direction before draw counting', () => {
  for (const schema of [1, 2]) {
    const f = fixture(); f.hooks.native = () => schema === 1 ? rowsReport() : richReport();
    assert.throws(() => f.client.packetWithHud(Uint8Array.of(108), false, { ...plan(6), schema }),
      { name: 'TypeError', message: 'Invalid HUD data' });
    assert.deepEqual(f.trace, ['begin', 'native', 'end']);
    assert.equal(f.client.diagnostics().draws, 0); assert(!f.active); assert(f.client.diagnostics().stopped);
  }
});

test('distinct authored row names survive schema2 and retain exact equal schema1 header compatibility', () => {
  for (const schema of [1, 2]) {
    const outputs = [65, 66].map(name => {
      const f = fixture();
      f.hooks.native = args => {
        assert.equal(args[0].at(-1), name);
        const native = schema === 2 ? rowsReport() : richReport();
        if (schema === 2) native.leaderboardRows[0].rows[0].name = [name];
        return native;
      };
      return f.client.packetWithHud(Uint8Array.of(108, name), false, { ...plan(6), schema });
    });
    if (schema === 1) assert.deepEqual(...outputs);
    else {
      assert.notDeepEqual(...outputs);
      assert.deepEqual(outputs.map(r => r.leaderboardRows[0].rows[0].name), [[65], [66]]);
      assert.deepEqual(outputs[0].events, outputs[1].events);
    }
  }
});

test('nested row/name reflection stays guarded and preserves first failures over source-release failure', () => {
  for (const primary of [undefined, null, false, 0, Symbol('row primary')]) {
    const f = fixture();
    f.hooks.native = () => {
      const native = rowsReport();
      native.leaderboardRows[0].rows[0].name = new Proxy([65], { ownKeys() {
        for (const call of [() => f.client.packetWithHud(Uint8Array.of(1), false, rowsPlan()),
          () => f.client.render(), () => f.client.dispose()]) assert.throws(call, /reentry/);
        assert(f.active); throw primary;
      } });
      return native;
    };
    f.hooks.end = () => { throw new Error('secondary release'); };
    caught(() => f.client.packetWithHud(Uint8Array.of(108), false, rowsPlan()), primary);
    assert.deepEqual(f.trace, ['begin', 'native', 'end']); assert(!f.active);
    assert.equal(f.client.diagnostics().draws, 0);
    assert.throws(() => f.client.packetWithHud(Uint8Array.of(108), false, rowsPlan()), /stopped/);
  }
});

test('schema2 source-release failure withholds copied rows after one native commit and never replays', () => {
  for (const primary of [undefined, false, new Error('release')]) {
    const f = fixture(); let commits = 0;
    f.hooks.native = () => { commits++; return rowsReport(); };
    f.hooks.end = () => { throw primary; };
    caught(() => f.client.packetWithHud(Uint8Array.of(108), false, rowsPlan()), primary);
    assert.equal(f.client.diagnostics().draws, 2); assert.equal(commits, 1);
    assert.throws(() => f.client.packetWithHud(Uint8Array.of(108), false, rowsPlan()), /stopped/);
    assert.equal(commits, 1); assert(!f.active);
  }
});
