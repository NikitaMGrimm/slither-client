// Authored synthetic live-object doubles and independently specified metadata.
// No original artwork, generators, source execution, or expected runtime output.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStockEntityAssets, createStockFoodProvider } from '../web/stock-food-provider.mjs';
import { createStockPreyProvider } from '../web/stock-prey-provider.mjs';

const pixels = new WeakMap();
class Canvas {
  constructor(width = 31, height = 19) { pixels.set(this, { width, height }); }
  get width() { return pixels.get(this).width; }
  get height() { return pixels.get(this).height; }
}
class Image {
  constructor(width = 23, height = 17, complete = true) { pixels.set(this, { width, height, complete }); }
  get naturalWidth() { return pixels.get(this).width; }
  get naturalHeight() { return pixels.get(this).height; }
  get complete() { return pixels.get(this).complete; }
}
const realm = { HTMLCanvasElement: Canvas, HTMLImageElement: Image };
const slots = [
  ['imgs', 'fws', 'fhs', 'fw2s', 'fh2s'],
  ['oimgs', 'ofws', 'ofhs', 'ofw2s', 'ofh2s'],
  ['gimgs', 'gfws', 'gfhs', 'gfw2s', 'gfh2s'],
  ['pr_imgs', 'pr_fws', 'pr_fhs', 'pr_fw2s', 'pr_fh2s'],
];
function fixture({ revision = 'capture-1', foodCount = 2, bodyCount = 4, glowCount = 3 } = {}) {
  const readiness = [];
  const record = { ic: foodCount };
  for (const [familyIndex, keys] of slots.entries()) {
    const count = familyIndex === 2 ? glowCount : familyIndex === 3 ? bodyCount : foodCount;
    keys.forEach(key => { record[key] = []; });
    for (let index = 0; index < count; index++) {
      const source = index % 2 ? new Image() : new Canvas();
      readiness.push({ source, state: 'ready', revision });
      const values = [source, 11.25 + index, 13.5 + index, index === 0 ? -0 : 2.125 + index, 7.75 + index];
      keys.forEach((key, position) => { record[key].push(values[position]); });
    }
  }
  const raw = { revision, normalGameplay: true, ownAccessory: -1,
    host: { per_color_imgs: Array.from({ length: 42 }, () => record) }, readiness };
  const operation = { revision };
  const log = [];
  let cursor = 0;
  const tape = [0.125, 0.875, 0.25, 0.75, 0, -0];
  const options = { realm, snapshotForOperation(actual) {
    assert.equal(actual, operation);
    log.push('snapshot');
    return raw;
  }, random() { log.push(`random:${cursor}`); return tape[cursor++]; } };
  return { raw, record, operation, log, options, cursor: () => cursor, assets: createStockEntityAssets(options) };
}
const foodRequest = (rawColor = 9, extra = {}) => ({ rawColor, palette: rawColor <= 9 ? rawColor : rawColor % 9, ...extra });
const preyRequest = (rawColor = 9, extra = {}) => ({ rawColor, palette: rawColor % 9, ...extra });
const pending = error => error.name === 'StockEntityAssetError' && error.status === 'pending';

test('food borrows every selectable entry and preserves independent declared halves', () => {
  const f = fixture();
  const result = f.assets.resolveFood(foodRequest(9, { zoom: 0.25, size: 0 }), f.operation);
  assert.equal(result.palette.color, 9);
  assert.equal(result.palette.count, 2);
  assert.deepEqual(result.palette.bodies.map(e => e.asset.source), f.record.imgs);
  assert.equal(result.palette.outlines[1].asset.source, f.record.oimgs[1]);
  assert.equal(result.palette.glows.length, 2);
  const entry = result.palette.bodies[0];
  assert.deepEqual(entry, { asset: { source: f.record.imgs[0], kind: 'canvas', status: 'ready', revision: 'capture-1', width: 31, height: 19 },
    width: 11.25, height: 13.5, halfWidth: -0, halfHeight: 7.75 });
  assert.equal(result.palette.bodies[1].asset.kind, 'image');
  assert.deepEqual([result.randomPhaseUnit, result.randomWobbleUnit], [0.125, 0.875]);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.palette) && Object.isFrozen(result.palette.bodies));
  assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.asset));
  f.record.fws[0] = 999;
  assert.equal(entry.width, 11.25);
});

test('prey preserves independent complete family lengths and final glow availability', () => {
  const f = fixture();
  const result = f.assets.resolvePrey(preyRequest(), f.operation);
  assert.equal(result.palette.color, 0);
  assert.equal(result.palette.bodies.length, 4);
  assert.equal(result.palette.glows.length, 3);
  assert.equal(result.palette.bodies[3].asset.source, f.record.pr_imgs[3]);
  assert.equal(result.palette.glows.at(-1).asset.source, f.record.gimgs[2]);
  assert.deepEqual([result.randomPhaseUnit, result.randomRateUnit], [0.125, 0.875]);
  assert.equal('randomWobbleUnit' in result, false);
});

test('complete families expose distinct native creation-index witnesses without adapter selection', () => {
  const f = fixture({ foodCount: 4, glowCount: 4 });
  const food = f.assets.resolveFood(foodRequest(0, { zoom: 0.5, size: 8.25 }), f.operation);
  // Authored arithmetic witness: body/outline 1, inner glow 1, outer glow 2.
  assert.equal(food.palette.bodies[1].asset.source, f.record.imgs[1]);
  assert.equal(food.palette.outlines[1].asset.source, f.record.oimgs[1]);
  assert.equal(food.palette.glows[1].asset.source, f.record.gimgs[1]);
  assert.equal(food.palette.glows[2].asset.source, f.record.gimgs[2]);
  const prey = f.assets.resolvePrey(preyRequest(0, { zoom: 0.5, size: 9 }), f.operation);
  assert.equal(prey.palette.bodies[1].asset.source, f.record.pr_imgs[1]);
  assert.equal(prey.palette.glows[3].asset.source, f.record.gimgs[3]);
});

test('canonical palette normalization differs for color nine and selects actual per-color slots', () => {
  for (const rawColor of [0, 8, 9, 10, 18, 255]) {
    for (const food of [true, false]) {
      const f = fixture();
      const expected = food && rawColor <= 9 ? rawColor : rawColor % 9;
      f.raw.host.per_color_imgs = Array.from({ length: 42 }, (_, color) => color === expected ? f.record : null);
      const result = food ? f.assets.resolveFood(foodRequest(rawColor), f.operation) : f.assets.resolvePrey(preyRequest(rawColor), f.operation);
      assert.equal(result.palette.color, expected);
    }
  }
});

test('both callbacks consume precisely two units in shared event order without preselecting', () => {
  const f = fixture();
  const a = f.assets.resolveFood(foodRequest(0, { zoom: 0.1, size: 0 }), f.operation);
  const b = f.assets.resolvePrey(preyRequest(0, { zoom: 4, size: 51 }), f.operation);
  const c = f.assets.resolveFood(foodRequest(0, { zoom: 8, size: 51 }), f.operation);
  assert.deepEqual(f.log, ['snapshot', 'random:0', 'random:1', 'snapshot', 'random:2', 'random:3', 'snapshot', 'random:4', 'random:5']);
  assert.deepEqual([a.randomPhaseUnit, a.randomWobbleUnit, b.randomPhaseUnit, b.randomRateUnit, c.randomPhaseUnit, c.randomWobbleUnit],
    [0.125, 0.875, 0.25, 0.75, 0, -0]);
  assert.deepEqual(a.palette, c.palette);
});

test('food ignores unselectable source and numeric tails including accessors', () => {
  const f = fixture();
  let reads = 0;
  for (const keys of slots.slice(0, 3)) for (const key of keys) {
    Object.defineProperty(f.record[key], '2', { get() { reads++; throw Error('tail'); }, configurable: true });
  }
  assert.equal(f.assets.resolveFood(foodRequest(), f.operation).palette.count, 2);
  assert.equal(reads, 0);
});

test('prey inspects all source entries but ignores numeric tails', () => {
  const f = fixture();
  for (const key of slots[3].slice(1)) Object.defineProperty(f.record[key], '4', { get() { throw Error('metadata tail'); } });
  assert.equal(f.assets.resolvePrey(preyRequest(), f.operation).palette.bodies.length, 4);
  const g = fixture();
  Object.defineProperty(g.record.pr_imgs, '3', { get() { throw Error('source accessor invoked'); } });
  assert.throws(() => g.assets.resolvePrey(preyRequest(), g.operation), /Accessor unsupported/);
  assert.equal(g.cursor(), 0);
});

test('missing, pending and unsupported commitments fail before entropy', () => {
  for (const state of [undefined, 'pending', 'unsupported']) {
    const f = fixture();
    if (state === undefined) f.raw.readiness.shift(); else f.raw.readiness[0].state = state;
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation), error => error.status === (state === 'unsupported' ? 'unsupported' : 'pending'));
    assert.equal(f.cursor(), 0);
  }
  const f = fixture();
  f.record.imgs[0] = null;
  assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation), pending);
});

test('native canvas/image readiness and dimensions are required before entropy', () => {
  for (const change of [state => { state.width = 0; }, state => { state.height = 65536; }, state => { state.complete = false; }]) {
    const f = fixture();
    const source = f.record.imgs[1];
    change(pixels.get(source));
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation));
    assert.equal(f.cursor(), 0);
  }
});

test('required own data guards reject accessors, inherited metadata, holes and promises', () => {
  const changes = [
    f => { Object.defineProperty(f.record, 'ic', { get() { throw Error('invoked'); } }); },
    f => { const count = f.record.ic; delete f.record.ic; Object.setPrototypeOf(f.record, { ic: count }); },
    f => { delete f.record.fw2s[0]; },
    f => { f.record.imgs = Promise.resolve([]); },
    f => { f.record.imgs[0] = {}; },
    f => { f.raw.readiness = Promise.resolve([]); },
    f => { f.raw.host = Promise.resolve({}); },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation), error => !/invoked/.test(error.message));
    assert.equal(f.cursor(), 0);
  }
  const f = fixture();
  let reads = 0;
  const request = { palette: 0, get rawColor() { reads++; return 0; } };
  assert.throws(() => f.assets.resolveFood(request, f.operation), /Accessor unsupported/);
  assert.equal(reads, 0);
  assert.deepEqual(f.log, []);
});

test('native scalar accessors cannot be shadowed and intrinsic getters bypass data lies', () => {
  for (const accessor of [true, false]) {
    const f = fixture();
    let reads = 0;
    Object.defineProperty(f.record.imgs[0], 'width', accessor ? { get() { reads++; return 31; } } : { value: 999 });
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation), /Accessor unsupported|Shadowed native/);
    assert.equal(reads, 0);
    assert.equal(f.cursor(), 0);
  }
});

test('aliases preserve exact identity and shared asset snapshots without changing declared metrics', () => {
  const f = fixture({ revision: -0 });
  f.record.oimgs[0] = f.record.imgs[0];
  f.record.gimgs[0] = f.record.imgs[0];
  const result = f.assets.resolveFood(foodRequest(), f.operation);
  assert.equal(result.palette.bodies[0].asset, result.palette.outlines[0].asset);
  assert.equal(result.palette.bodies[0].asset, result.palette.glows[0].asset);
  assert.equal(result.palette.glows[0].asset.source, f.record.imgs[0]);
  assert.ok(Object.is(result.palette.glows[0].asset.revision, -0));
  const prey = f.assets.resolvePrey(preyRequest(), f.operation);
  assert.equal(prey.palette.glows[0].asset.source, result.palette.glows[0].asset.source);
  assert.ok(Object.is(prey.palette.glows[0].asset.revision, result.palette.glows[0].asset.revision));
});

test('revision domain and Object.is signed-zero operation coherence reject before entropy', () => {
  for (const value of [undefined, '', 'a'.repeat(129), -1, 1.5, Infinity, NaN, {}, Promise.resolve(0)]) {
    const f = fixture(); f.raw.revision = f.operation.revision = value;
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation));
    assert.equal(f.cursor(), 0);
  }
  for (const [raw, operation] of [[-0, 0], [0, -0], ['1', 1]]) {
    const f = fixture({ revision: raw }); f.operation.revision = operation;
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation), /revision mismatch/);
    assert.equal(f.cursor(), 0);
  }
  const f = fixture();
  const resolve = createStockFoodProvider({ ...f.options, snapshotForOperation() {
    f.operation.revision = 'changed'; return f.raw;
  } });
  assert.throws(() => resolve(foodRequest(), f.operation), /revision mismatch/);
  assert.equal(f.cursor(), 0);
});

test('family count bounds, missing prefixes and invalid declared metrics reject before entropy', () => {
  for (const value of [0, -1, 1.5, 4097, NaN]) {
    const f = fixture(); f.record.ic = value;
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation)); assert.equal(f.cursor(), 0);
  }
  for (const count of [0, 4097]) {
    const f = fixture(); f.record.pr_imgs.length = count;
    assert.throws(() => f.assets.resolvePrey(preyRequest(), f.operation)); assert.equal(f.cursor(), 0);
  }
  for (const [key, value] of [['fws', 0], ['fhs', Infinity], ['fw2s', -1], ['fh2s', NaN]]) {
    const f = fixture(); f.record[key][0] = value;
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation)); assert.equal(f.cursor(), 0);
  }
  const f = fixture(); f.record.ofws.pop();
  assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation)); assert.equal(f.cursor(), 0);
});

test('one-entry and 4096-entry boundaries retain aliases and exact selectable counts', () => {
  for (const count of [1, 4096]) {
    const f = fixture();
    f.record.ic = count;
    for (const keys of slots) for (const key of keys) f.record[key] = Array(count).fill(f.record[key][0]);
    const food = f.assets.resolveFood(foodRequest(), f.operation);
    const prey = f.assets.resolvePrey(preyRequest(), f.operation);
    assert.equal(food.palette.bodies.length, count);
    assert.equal(food.palette.outlines.length, count);
    assert.equal(food.palette.glows.length, count);
    assert.equal(prey.palette.bodies.length, count);
    assert.equal(prey.palette.glows.length, count);
    assert.equal(food.palette.bodies.at(-1).asset, food.palette.bodies[0].asset);
  }
});

test('unrelated pending source commitments do not block ready selected families', () => {
  const f = fixture();
  f.raw.readiness.push({ source: new Canvas(), state: 'pending', revision: 'unrelated' });
  assert.equal(f.assets.resolveFood(foodRequest(), f.operation).palette.count, 2);
  assert.equal(f.assets.resolvePrey(preyRequest(), f.operation).palette.bodies.length, 4);
});

test('conflicting readiness and malformed captures do not consume random units', () => {
  for (const change of [
    f => f.raw.readiness.push({ source: f.record.imgs[0], state: 'pending', revision: 'capture-1' }),
    f => { f.raw.normalGameplay = false; },
    f => { f.raw.ownAccessory = 0; },
    f => { f.raw.host.per_color_imgs.length = 43; },
    f => { f.raw.readiness[0].state = 'loaded'; },
  ]) {
    const f = fixture(); change(f);
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation)); assert.equal(f.cursor(), 0);
  }
});

test('invalid entropy stops exactly at the failing random call and preserves signed zero', () => {
  for (const invalid of [-1, 1, Infinity, NaN, '0', Promise.resolve(0)]) {
    for (const position of [0, 1]) {
      const f = fixture(); let calls = 0;
      const resolve = createStockFoodProvider({ ...f.options, random() { return calls++ === position ? invalid : 0.5; } });
      assert.throws(() => resolve(foodRequest(), f.operation), /random unit/);
      assert.equal(calls, position + 1);
    }
  }
});

test('random-side source/revision/readiness changes reject after the two ordered units', () => {
  for (const change of [
    f => { pixels.get(f.record.imgs[0]).width++; },
    f => { f.raw.revision = 'changed'; },
    f => { f.operation.revision = 'changed'; },
    f => { f.raw.readiness[0].state = 'pending'; },
  ]) {
    const f = fixture(); let calls = 0;
    const resolve = createStockFoodProvider({ ...f.options, random() { calls++; if (calls === 2) change(f); return 0.5; } });
    assert.throws(() => resolve(foodRequest(), f.operation));
    assert.equal(calls, 2);
  }
});

test('combined adapter rejects cross-factory reentry and releases its guard after failure', () => {
  const f = fixture(); let assets; let reenter = true;
  assets = createStockEntityAssets({ ...f.options, random() { return reenter ? assets.resolvePrey(preyRequest(), f.operation) : 0.5; } });
  assert.throws(() => assets.resolveFood(foodRequest(), f.operation), /reentry/);
  reenter = false;
  assert.equal(assets.resolveFood(foodRequest(), f.operation).palette.count, 2);
  const g = fixture();
  g.raw.readiness[0].state = 'pending';
  assert.throws(() => g.assets.resolveFood(foodRequest(), g.operation), pending);
  g.raw.readiness[0].state = 'ready';
  assert.equal(g.assets.resolveFood(foodRequest(), g.operation).palette.count, 2);
});

test('standalone prey factory uses the same current operation capture with no retained catalog', () => {
  const f = fixture();
  const resolve = createStockPreyProvider(f.options);
  const first = resolve(preyRequest(), f.operation);
  const replacement = new Canvas(15, 9);
  f.record.pr_imgs[0] = replacement;
  f.raw.readiness.push({ source: replacement, state: 'ready', revision: 'capture-2' });
  f.raw.revision = f.operation.revision = 'capture-2';
  const second = resolve(preyRequest(), f.operation);
  assert.notEqual(first.palette.bodies[0].asset.source, replacement);
  assert.equal(second.palette.bodies[0].asset.source, replacement);
  assert.equal(second.palette.bodies[0].asset.revision, 'capture-2');
});

test('unrelated catalog revision changes preserve unchanged retained food/prey source revisions', () => {
  const f = fixture({ revision: 1 });
  for (const entry of f.raw.readiness) entry.revision = 1;
  const unrelated = { source: new Canvas(), state: 'pending', revision: 1 };
  f.raw.readiness.push(unrelated);
  const first = f.assets.resolveFood(foodRequest(0), f.operation);
  unrelated.state = 'ready';
  unrelated.revision = 2;
  f.raw.revision = f.operation.revision = 2;
  const prey = f.assets.resolvePrey(preyRequest(0), f.operation);
  const second = f.assets.resolveFood(foodRequest(0), f.operation);
  assert.equal(prey.palette.glows[0].asset.source, first.palette.glows[0].asset.source);
  assert.ok(Object.is(prey.palette.glows[0].asset.revision, first.palette.glows[0].asset.revision));
  assert.ok(Object.is(second.palette.bodies[0].asset.revision, first.palette.bodies[0].asset.revision));
});

test('source content revisions are independent of capture revision and preserve signed zero', () => {
  const f = fixture();
  f.raw.readiness[0].revision = -0;
  const first = f.assets.resolveFood(foodRequest(), f.operation);
  assert.ok(Object.is(first.palette.bodies[0].asset.revision, -0));
  f.raw.revision = f.operation.revision = 'repaint-operation';
  f.raw.readiness[0].revision = 0;
  const second = f.assets.resolveFood(foodRequest(), f.operation);
  assert.ok(Object.is(second.palette.bodies[0].asset.revision, 0));
  assert.ok(!Object.is(first.palette.bodies[0].asset.revision, second.palette.bodies[0].asset.revision));
  assert.equal(second.palette.outlines[0].asset.revision, 'capture-1');
});

test('missing, malformed and accessor source revisions reject before entropy', () => {
  for (const value of [undefined, '', -1, 0.5, NaN, Infinity, {}, Promise.resolve(0)]) {
    const f = fixture(); f.raw.readiness[0].revision = value;
    assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation));
    assert.equal(f.cursor(), 0);
  }
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.raw.readiness[0], 'revision', { get() { reads++; return 1; } });
  assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation), /Accessor unsupported/);
  assert.equal(reads, 0); assert.equal(f.cursor(), 0);
});

test('aliased commitments require Object.is-equal content revisions', () => {
  const f = fixture();
  f.raw.readiness[0].revision = -0;
  f.raw.readiness.push({ source: f.record.imgs[0], state: 'ready', revision: 0 });
  assert.throws(() => f.assets.resolveFood(foodRequest(), f.operation), /Conflicting/);
  assert.equal(f.cursor(), 0);
  f.raw.readiness.at(-1).revision = -0;
  const result = f.assets.resolveFood(foodRequest(), f.operation);
  assert.ok(Object.is(result.palette.bodies[0].asset.revision, -0));
});

test('post-entropy source content revision changes reject even with a stable operation', () => {
  const f = fixture(); let calls = 0;
  const resolve = createStockFoodProvider({ ...f.options, random() {
    if (++calls === 2) f.raw.readiness[0].revision = 'repainted';
    return 0.5;
  } });
  assert.throws(() => resolve(foodRequest(), f.operation), /source revision changed/);
  assert.equal(calls, 2);
});
