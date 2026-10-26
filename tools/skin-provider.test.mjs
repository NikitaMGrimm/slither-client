import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createSkinProvider } from '../web/skin-provider.mjs';

// Original synthetic metadata, realm doubles, and assets; no external references.
function fixture() {
  class HTMLCanvasElement { width = 20; height = 30; }
  class HTMLImageElement { complete = true; naturalWidth = 40; naturalHeight = 50; }
  const realm = { HTMLCanvasElement, HTMLImageElement };
  const canvas = new HTMLCanvasElement();
  const image = new HTMLImageElement();
  const catalog = [{ source: canvas, state: 'ready' }, { source: image, state: 'pending' }];
  const metadata = {
    status: 'ready', basePalette: 0, custom: false,
    runs: [{ palette: 0, count: 2 }, { palette: 1, count: 3 }, { palette: 0, count: 1 }],
    palettes: [{ variants: [{ asset: 0 }] }, { variants: [{ asset: 1 }] }],
    variantMode: 'cycle', variantPeriod: 1,
    eyes: { kind: 'standard', distance: 4, separation: 2, radius: 3, pupilRadius: 1,
      pupilTravel: 0.5, outlineWidth: 0, eyeColor: 0xeeeeee, pupilColor: 0x111111,
      outlineColor: 0, eyeOpacity: 1, pupilOpacity: 0.8, angleSmoothing: 0.1 },
    effects: [], unsupportedFeatures: [],
  };
  const calls = [];
  const raw = Object.freeze({ synthetic: true });
  const provider = createSkinProvider({ trusted: true, realm,
    resolveHostRecipe(request) { calls.push(['resolve', request]); return raw; },
    normalizeHostRecipe(value, request) { assert.equal(value, raw); calls.push(['normalize', request]); return metadata; },
  });
  const snapshot = { revision: 'synthetic-1', assetCatalog: catalog };
  const resolve = request => provider.resolve(request ?? { skin: 7 }, snapshot);
  return { realm, canvas, image, catalog, metadata, calls, provider, snapshot, resolve };
}

test('explicit trust, realm constructors, and both callbacks are required', () => {
  const f = fixture();
  const options = { trusted: true, realm: f.realm, resolveHostRecipe() {}, normalizeHostRecipe() {} };
  for (const key of ['trusted', 'realm', 'resolveHostRecipe', 'normalizeHostRecipe']) {
    assert.throws(() => createSkinProvider({ ...options, [key]: undefined }));
  }
  assert.throws(() => createSkinProvider({ ...options, realm: { HTMLCanvasElement: {}, HTMLImageElement: {} } }));
});

test('request and snapshot rejection precede all callback work', () => {
  const f = fixture();
  for (const skin of [-1, 256, 0.5, NaN, Infinity, '7', null, undefined]) assert.throws(() => f.resolve({ skin }));
  for (const customBytes of [null, [], new Uint16Array(1), new Uint8Array(256)]) assert.throws(() => f.resolve({ skin: 0, customBytes }));
  const oversized = new Uint8Array(256);
  Object.defineProperty(oversized, 'length', { value: 1 });
  assert.throws(() => f.resolve({ skin: 0, customBytes: oversized }), /customBytes length/);
  for (const key of ['x', 'y']) for (const value of [NaN, Infinity, '0', null]) assert.throws(() => f.resolve({ skin: 0, [key]: value }));
  for (const attachmentId of [-1, 65536, 0.5, '0']) assert.throws(() => f.resolve({ skin: 0, attachmentId }));
  for (const revision of ['', 'x'.repeat(129), -1, 0.5, NaN, null]) {
    assert.throws(() => f.provider.resolve({ skin: 0 }, { ...f.snapshot, revision }));
  }
  for (const assetCatalog of [null, new Array(4097), [{ source: null, state: 'unknown' }]]) {
    assert.throws(() => f.provider.resolve({ skin: 0 }, { ...f.snapshot, assetCatalog }));
  }
  assert.equal(f.calls.length, 0);
});

test('boundary requests preserve exact numeric values and copy custom bytes', () => {
  const f = fixture();
  const bytes = new Uint8Array(255).fill(37);
  for (const skin of [0, 255]) {
    assert.equal(f.resolve({ skin, customBytes: bytes, x: -1.25, y: 2.75, attachmentId: 65535 }).status, 'ready');
    const request = f.calls.at(-1)[1];
    assert.equal(request, f.calls.at(-2)[1]);
    assert.equal(request.skin, skin);
    assert.equal(request.x, -1.25);
    assert.equal(request.y, 2.75);
    assert.equal(request.attachmentId, 65535);
    assert(Object.isFrozen(request));
    assert.notEqual(request.customBytes, bytes);
    request.customBytes[0] = 9;
    assert.equal(bytes[0], 37);
  }
  assert.equal(f.resolve({ skin: 0, customBytes: new Uint8Array() }).status, 'ready');
  const guarded = new Uint8Array([1, 2]);
  Object.defineProperty(guarded, 'length', { get() { assert.fail('payload length accessor'); } });
  assert.equal(f.resolve({ skin: 0, customBytes: guarded }).status, 'ready');
});

test('preserves runs, exact frozen source identity, and copied frozen metadata', () => {
  const f = fixture();
  for (const asset of [f.canvas, f.image]) Object.freeze(asset);
  const before = [f.canvas, f.image].map(Object.getOwnPropertyDescriptors);
  const result = f.resolve();
  assert.equal(result.status, 'ready');
  assert.equal(result.schema, 1);
  assert.equal(result.revision, 'synthetic-1');
  assert.deepEqual(result.recipe.runs, f.metadata.runs);
  assert.equal(result.recipe.palettes[0].variants[0].asset.source, f.canvas);
  assert.equal(result.recipe.palettes[1].variants[0].asset.source, f.image);
  assert.deepEqual(result.recipe.palettes[1].variants[0].sourceRect, [0, 0, 40, 50]);
  f.metadata.runs[0].count = 8;
  f.metadata.eyes.radius = 17;
  assert.equal(result.recipe.runs[0].count, 2);
  assert.equal(result.recipe.eyes.radius, 3);
  for (const value of [result, result.recipe, result.recipe.runs, result.recipe.runs[0], result.recipe.palettes,
    result.recipe.palettes[0], result.recipe.palettes[0].variants, result.recipe.palettes[0].variants[0],
    result.recipe.palettes[0].variants[0].asset, result.recipe.palettes[0].variants[0].sourceRect,
    result.recipe.eyes, result.recipe.effects, result.recipe.supportedFeatures, result.recipe.unsupportedFeatures]) {
    assert(Object.isFrozen(value));
  }
  assert.deepEqual([f.canvas, f.image].map(Object.getOwnPropertyDescriptors), before);
});

test('canvas readiness is explicit; revision refresh handles same identity and replacement', () => {
  const f = fixture();
  f.catalog[0].state = 'pending';
  const pending = f.resolve();
  assert.equal(pending.status, 'pending');
  assert.equal(pending.recipe.palettes[0].variants[0].asset.width, 20);
  f.catalog[0].state = 'ready';
  f.snapshot.revision = 2;
  const ready = f.resolve();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.revision, 2);
  assert.equal(ready.recipe.palettes[0].variants[0].asset.source, f.canvas);
  assert.equal(pending.recipe.palettes[0].variants[0].asset.status, 'pending');
  f.canvas.width = 21;
  f.snapshot.revision = 3;
  const content = f.resolve();
  assert.equal(content.recipe.palettes[0].variants[0].asset.width, 21);
  assert.equal(ready.recipe.palettes[0].variants[0].asset.width, 20);
  f.catalog[0].source = new f.realm.HTMLCanvasElement();
  f.snapshot.revision = 4;
  const replacement = f.resolve();
  assert.notEqual(replacement.recipe.palettes[0].variants[0].asset.source, f.canvas);
  assert.equal(ready.recipe.palettes[0].variants[0].asset.source, f.canvas);
  assert.equal(f.calls.length, 8);
});

test('attachments stay pending when absent; existing native images can become ready', () => {
  const f = fixture();
  f.metadata.attachment = { asset: 2, sourceRect: [0, 0, 10, 10], anchor: 'head', scale: 1, pivotX: -3, pivotY: 4, opacity: 1 };
  f.catalog.push({ source: null, state: 'ready' });
  let result = f.resolve({ skin: 3, attachmentId: 9 });
  assert.equal(result.status, 'pending');
  assert.equal(result.recipe.attachment.asset.source, null);
  assert.equal(result.recipe.attachment.sourceRect, null);
  const image = new f.realm.HTMLImageElement();
  image.complete = false;
  f.catalog[2] = { source: image, state: 'pending' };
  f.snapshot.revision = 2;
  assert.equal(f.resolve().status, 'pending');
  image.complete = true;
  f.snapshot.revision = 3;
  result = f.resolve();
  assert.equal(result.status, 'ready');
  assert.equal(result.recipe.attachment.asset.source, image);
  assert.deepEqual(result.recipe.attachment.sourceRect, [0, 0, 10, 10]);
});

test('empty canvas/image dimensions and failed native images stay pending', () => {
  for (const key of ['width', 'height']) {
    const f = fixture(); f.canvas[key] = 0; assert.equal(f.resolve().status, 'pending');
  }
  for (const key of ['naturalWidth', 'naturalHeight']) {
    const f = fixture(); f.image[key] = 0; assert.equal(f.resolve().status, 'pending');
  }
  const f = fixture(); f.image.complete = false; assert.equal(f.resolve().status, 'pending');
});

test('standard effect metadata and attachment share wrappers without freezing host objects', () => {
  const f = fixture();
  f.metadata.effects = ['boost-glow', 'outline', 'shadow', 'death-highlight'].map(kind => ({ kind, asset: 0, opacity: 0.5 }));
  f.metadata.attachment = { asset: 0, anchor: 'head', scale: 2, pivotX: 0, pivotY: 0, opacity: 1 };
  const result = f.resolve();
  for (const effect of result.recipe.effects) {
    assert.equal(effect.asset, result.recipe.palettes[0].variants[0].asset);
    assert.equal(effect.opacity, 0.5);
  }
  assert.equal(result.recipe.attachment.asset, result.recipe.effects[0].asset);
  assert.deepEqual(result.recipe.supportedFeatures, ['body-palettes', 'standard-eyes', 'boost-glow', 'outline', 'shadow', 'death-highlight', 'head-attachment']);
  assert(!Object.isFrozen(f.canvas));
});

test('unsupported features and assets are explicit and take precedence over pending', () => {
  const f = fixture();
  f.metadata.eyes = { kind: 'none' };
  f.metadata.unsupportedFeatures = ['synthetic-special-face'];
  f.catalog[0].state = 'pending';
  assert.equal(f.resolve().status, 'unsupported');
  assert.deepEqual(f.resolve().recipe.eyes, { kind: 'none' });
  assert.deepEqual(f.resolve().recipe.supportedFeatures, ['body-palettes']);
  f.metadata.unsupportedFeatures = [];
  f.catalog[1].state = 'unsupported';
  assert.equal(f.resolve().status, 'unsupported');
  for (const status of ['pending', 'unsupported']) {
    f.metadata.status = status;
    assert.deepEqual(f.resolve(), { schema: 1, revision: 'synthetic-1', status, recipe: null });
  }
});

test('sourceRect must fit actual backing or intrinsic dimensions', () => {
  for (const sourceRect of [[-1, 0, 1, 1], [0, 0, 0, 1], [0, 0, 1, Infinity], [19, 0, 2, 1], [0, 29, 1, 2], [0, 0, 1]]) {
    const f = fixture(); f.metadata.palettes[0].variants[0].sourceRect = sourceRect;
    assert.throws(() => f.resolve(), /sourceRect/);
  }
  const f = fixture();
  f.image.width = 1000; f.image.height = 1000;
  f.metadata.palettes[1].variants[0].sourceRect = [0, 0, 41, 1];
  assert.throws(() => f.resolve(), /actual asset dimensions/);
  f.metadata.palettes[1].variants[0].sourceRect = [0.5, 1.5, 39.5, 48.5];
  assert.equal(f.resolve().status, 'ready');
  f.catalog[0].state = 'pending';
  f.metadata.palettes[0].variants[0].sourceRect = [0, 0, 21, 1];
  assert.throws(() => f.resolve(), /actual asset dimensions/);
});

test('rejects wrong source realm/type, invalid dimensions, and invalid native readiness', () => {
  for (const source of [{ width: 20, height: 30 }, fixture().canvas, undefined]) {
    const f = fixture(); f.catalog[0].source = source; assert.throws(() => f.resolve(), /trusted realm/);
  }
  for (const value of [-1, 1.5, 65536, NaN, '20']) {
    const f = fixture(); f.canvas.width = value; assert.throws(() => f.resolve(), /asset width/);
  }
  const f = fixture(); f.image.complete = 1; assert.throws(() => f.resolve(), /image complete/);
});

test('bounded collections, indices, counts and variants reject atomically', () => {
  const mutations = [
    m => { m.runs = []; }, m => { m.runs = new Array(257); },
    m => { m.runs[0].count = 0; }, m => { m.runs[0].count = 65535; },
    m => { m.runs[0].palette = 2; }, m => { m.basePalette = -1; },
    m => { m.palettes = []; }, m => { m.palettes = new Array(257); },
    m => { m.palettes[0].variants = []; }, m => { m.palettes[0].variants = new Array(257); },
    m => { m.palettes[0].variants[0].asset = 2; },
    m => { m.variantPeriod = 2; }, m => { m.variantPeriod = 257; },
    m => { m.variantMode = 'invented'; }, m => { m.custom = true; },
    m => { m.unsupportedFeatures = new Array(257); }, m => { m.unsupportedFeatures = ['Invalid tag']; },
    m => { m.eyes.radius = Infinity; }, m => { m.eyes.eyeColor = 0x1000000; },
    m => { m.eyes.eyeOpacity = 1.01; }, m => { m.eyes.kind = 'special'; },
    m => { m.effects = [{ kind: 'unknown', asset: 0, opacity: 1 }]; },
    m => { m.effects = Array(2).fill({ kind: 'outline', asset: 0, opacity: 1 }); },
    m => { m.attachment = { asset: 0, anchor: 'head', scale: 0, pivotX: 0, pivotY: 0, opacity: 1 }; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    const previous = f.resolve();
    mutate(f.metadata);
    assert.throws(() => f.resolve());
    assert.equal(previous.recipe.runs[0].count, 2);
    assert.equal(previous.status, 'ready');
  }
});

test('valid collection limits and variant selection metadata retain order', () => {
  const f = fixture();
  f.metadata.runs = Array.from({ length: 256 }, (_, i) => ({ palette: i, count: 1 }));
  f.metadata.palettes = Array.from({ length: 256 }, () => ({ variants: Array.from({ length: 256 }, () => ({ asset: 0 })) }));
  f.metadata.variantPeriod = 256;
  f.metadata.variantMode = 'ping-pong';
  assert.equal(f.resolve().recipe.runs.length, 256);
  f.metadata.custom = true;
  f.metadata.variantMode = 'first';
  assert.equal(f.resolve().recipe.variantMode, 'first');
  f.metadata.runs = [{ palette: 0, count: 65535 }];
  assert.equal(f.resolve().recipe.runs[0].count, 65535);
});

test('callback errors propagate and no failed or successful resolution is cached', () => {
  const f = fixture();
  let fail = true;
  const error = new Error('synthetic callback failure');
  const provider = createSkinProvider({ trusted: true, realm: f.realm,
    resolveHostRecipe() { if (fail) throw error; return null; }, normalizeHostRecipe() { return f.metadata; },
  });
  assert.throws(() => provider.resolve({ skin: 0 }, f.snapshot), value => value === error);
  fail = false;
  assert.equal(provider.resolve({ skin: 0 }, f.snapshot).status, 'ready');
  f.catalog[0].state = 'pending';
  assert.equal(provider.resolve({ skin: 0 }, f.snapshot).status, 'pending');
  const asyncProvider = createSkinProvider({ trusted: true, realm: f.realm, resolveHostRecipe() {},
    normalizeHostRecipe: async () => f.metadata });
  assert.throws(() => asyncProvider.resolve({ skin: 0 }, f.snapshot), /recipe status/);
});

test('reads only whitelisted data fields and trusted DOM scalar getters', () => {
  const f = fixture();
  for (const object of [f.realm, f.canvas, f.image, f.metadata]) {
    Object.defineProperty(object, 'unrelated', { get() { assert.fail('unrelated access'); } });
  }
  const middle = Object.create(f.realm.HTMLCanvasElement.prototype);
  Object.defineProperty(middle, 'width', { get() { assert.fail('intermediate getter'); } });
  delete f.canvas.width;
  Object.defineProperty(f.realm.HTMLCanvasElement.prototype, 'width', { get() { return 20; } });
  Object.setPrototypeOf(f.canvas, middle);
  assert.equal(f.resolve().status, 'ready');
  Object.defineProperty(f.metadata.eyes, 'radius', { get() { assert.fail('metadata getter'); } });
  assert.throws(() => f.resolve(), /Accessor unsupported/);
  const g = fixture();
  Object.defineProperty(g.canvas, 'width', { get() { assert.fail('own scalar getter'); } });
  assert.throws(() => g.resolve(), /Accessor unsupported/);
});

test('import and resolution never access ambient DOM, network, pixels or source URLs', async () => {
  const keys = ['document', 'Image', 'fetch', 'WebSocket', 'XMLHttpRequest', 'setTimeout', 'setInterval'];
  const originals = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  try {
    for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, get() { assert.fail(`global ${key}`); } });
    const { createSkinProvider: create } = await import('../web/skin-provider.mjs?synthetic-side-effects');
    const f = fixture();
    for (const source of [f.canvas, f.image]) {
      for (const key of ['getContext', 'getImageData', 'toDataURL', 'toBlob', 'src', 'currentSrc', 'decode', 'cloneNode']) {
        Object.defineProperty(source, key, { get() { assert.fail(`source ${key}`); }, set() { assert.fail(`source write ${key}`); } });
      }
      Object.freeze(source);
    }
    const provider = create({ trusted: true, realm: f.realm, resolveHostRecipe() { return f.metadata; }, normalizeHostRecipe: value => value });
    assert.equal(provider.resolve({ skin: 0 }, f.snapshot).status, 'ready');
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
  const source = await readFile(new URL('../web/skin-provider.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|fetch|WebSocket|XMLHttpRequest|createElement|getContext|getImageData|toDataURL|toBlob|eval)\s*\(|\bnew\s+(?:Image|HTMLCanvasElement|HTMLImageElement)\b/);
});
