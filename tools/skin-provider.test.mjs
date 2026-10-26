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

function bodyFixture() {
  const f = fixture();
  f.catalog.push({ source: new f.realm.HTMLCanvasElement(), state: 'ready' },
    { source: new f.realm.HTMLImageElement(), state: 'pending' });
  f.metadata.palettes[0].boostGlow = { asset: 2, sourceRect: [1, 2, 5, 6] };
  f.metadata.palettes[1].boostGlow = { asset: 3 };
  f.metadata.effects = ['outline', 'shadow', 'death-highlight'].map(kind => ({ kind, asset: 0, opacity: 1 }));
  f.metadata.bodyStyle = { detailedSegments: true, swell: -0.125, rotateSegments: false, headFade: null, tailFade: null };
  return f;
}

const sideGeometry = () => ({ forward: 11.375, lateral: 3.125, lateralBias: 0.375,
  rotationOffset: 0.287, imageScale: 0.3125, pivotX: 9.25, pivotY: -7.5, width: 47, height: 31 });
function addDecoration(f) {
  f.metadata.faceDecoration = { kind: 'paired-side-images', geometry: sideGeometry(), image: { asset: 0 } };
}

test('optional paired-side metadata preserves the exact legacy shape when absent or null', () => {
  const f = fixture(); const legacy = f.resolve();
  for (const value of [undefined, null]) {
    f.metadata.faceDecoration = value; assert.deepEqual(f.resolve(), legacy);
  }
  addDecoration(f); const { recipe } = f.resolve();
  assert(recipe.supportedFeatures.includes('paired-side-images'));
  assert.equal(recipe.faceDecoration.image.asset, recipe.palettes[0].variants[0].asset);
  assert.equal(recipe.faceDecoration.image.asset.source, f.canvas);
  assert.equal(recipe.faceDecoration.image.sourceMode, 'whole');
  assert.equal(Object.hasOwn(recipe.palettes[0].variants[0], 'sourceMode'), false);
  assert(Object.isFrozen(recipe.faceDecoration)); assert(Object.isFrozen(recipe.faceDecoration.geometry));
  const before = { ...recipe.faceDecoration.geometry };
  f.metadata.faceDecoration.geometry.forward++;
  assert.deepEqual(recipe.faceDecoration.geometry, before);
  f.metadata.faceDecoration.image.sourceRect = [0, 0, 20, 30];
  const crop = f.resolve().recipe.faceDecoration.image;
  assert.equal(crop.sourceMode, 'crop'); assert.deepEqual(crop.sourceRect, [0, 0, 20, 30]);
});

test('paired side geometry validates every field and retains all admitted signed zeros', () => {
  const f = fixture(); addDecoration(f); const input = f.metadata.faceDecoration;
  for (const key of Object.keys(sideGeometry())) {
    const original = input.geometry[key];
    const positive = ['imageScale', 'width', 'height'].includes(key);
    const upper = key === 'rotationOffset' ? Math.PI : key === 'imageScale' ? 256
      : ['width', 'height', 'pivotX', 'pivotY'].includes(key) ? 65535 : 4096;
    const lower = ['pivotX', 'pivotY'].includes(key) ? -65535 : positive ? Number.MIN_VALUE : 0;
    for (const value of [NaN, Infinity, -Infinity, upper + 1, lower - 1, null, '1', undefined]) {
      input.geometry[key] = value; assert.throws(() => f.resolve(), undefined, key);
    }
    input.geometry[key] = -0;
    if (positive) assert.throws(() => f.resolve());
    else assert(Object.is(f.resolve().recipe.faceDecoration.geometry[key], -0));
    input.geometry[key] = original;
    for (const accessor of [false, true]) {
      input.geometry = sideGeometry(); delete input.geometry[key];
      if (accessor) Object.defineProperty(input.geometry, key, { get() { throw new Error('must not run'); } });
      else Object.setPrototypeOf(input.geometry, { [key]: original });
      assert.throws(() => f.resolve());
    }
    input.geometry = sideGeometry();
  }
  for (const key of ['kind', 'geometry', 'image']) {
    const original = input[key]; delete input[key]; assert.throws(() => f.resolve()); input[key] = original;
  }
  input.kind = 'antenna'; assert.throws(() => f.resolve()); input.kind = 'paired-side-images';
  const valid = input.geometry; input.geometry = Object.assign(Promise.resolve(), valid);
  assert.throws(() => f.resolve()); input.geometry = valid;
  f.metadata.eyes = { kind: 'none' }; assert.throws(() => f.resolve());
});

test('side images share asset readiness, unsupported precedence and revision snapshots', () => {
  const f = fixture(); addDecoration(f);
  f.catalog.push({ source: null, state: 'pending' }); f.metadata.faceDecoration.image.asset = 2;
  let result = f.resolve(); assert.equal(result.status, 'pending'); assert(result.recipe.faceDecoration.geometry);
  assert.equal(result.recipe.faceDecoration.image.sourceMode, 'whole');
  f.metadata.unsupportedFeatures = ['required-antenna']; assert.equal(f.resolve().status, 'unsupported');
  f.metadata.unsupportedFeatures = []; f.catalog[2].state = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
  f.catalog[2] = { source: f.canvas, state: 'pending' }; assert.equal(f.resolve().status, 'pending');
  f.snapshot.revision = 'synthetic-2'; f.catalog[2].state = 'ready';
  result = f.resolve(); assert.equal(result.status, 'ready');
  assert.equal(result.recipe.faceDecoration.image.asset.source, f.canvas);
  const old = result;
  f.canvas.width = 28; f.snapshot.revision = 'synthetic-3';
  assert.equal(f.resolve().recipe.faceDecoration.image.asset.width, 28);
  assert.equal(old.recipe.faceDecoration.image.asset.width, 20);
});

test('only opt-in body output distinguishes whole-source from an explicit full crop', () => {
  const f = bodyFixture();
  f.metadata.palettes[0].variants = [{ asset: 0 }, { asset: 0, sourceRect: [0, 0, 20, 30] }];
  const result = f.resolve();
  const [whole, crop] = result.recipe.palettes[0].variants;
  assert.equal(whole.sourceMode, 'whole');
  assert.equal(crop.sourceMode, 'crop');
  assert.deepEqual(whole.sourceRect, crop.sourceRect);
  assert.equal(whole.asset, crop.asset);
  assert.equal(result.recipe.palettes[0].boostGlow.sourceMode, 'crop');
  assert.equal(result.recipe.palettes[1].boostGlow.sourceMode, 'whole');
  assert(result.recipe.effects.every(use => use.sourceMode === 'whole'));
  f.metadata.attachment = { asset: 0, anchor: 'head', scale: 1, pivotX: 0, pivotY: 0, opacity: 1 };
  assert.equal(f.resolve().recipe.attachment.sourceMode, 'whole');
  f.catalog[0].source = null;
  const pending = f.resolve().recipe.palettes[0].variants;
  assert.equal(pending[0].sourceMode, 'whole');
  assert.equal(pending[1].sourceMode, 'crop');
  assert.equal(pending[0].sourceRect, null);
  assert.equal(pending[1].sourceRect, null);
  delete f.metadata.bodyStyle;
  const legacy = f.resolve().recipe;
  for (const use of [...legacy.palettes[0].variants, ...legacy.effects, legacy.attachment]) {
    assert.equal(Object.hasOwn(use, 'sourceMode'), false);
  }
});

test('optional cosmetic request metadata is bounded and copied without changing legacy requests', () => {
  const f = fixture();
  f.resolve({ skin: 7, cosmetic: 255, attachmentId: 255 });
  assert.equal(f.calls.at(-1)[1].cosmetic, 255);
  for (const cosmetic of [-1, 256, 0.5, null, '0']) assert.throws(() => f.resolve({ skin: 7, cosmetic }));
  f.resolve({ skin: 7 });
  assert.equal(Object.hasOwn(f.calls.at(-1)[1], 'cosmetic'), false);
});

test('absent and null body style preserve the exact legacy shape and feature tags', () => {
  const f = fixture();
  f.metadata.effects = [{ kind: 'boost-glow', asset: 0, opacity: 0.25 }];
  const previous = f.resolve();
  assert.deepEqual(Object.keys(previous.recipe), ['basePalette', 'custom', 'runs', 'palettes', 'variantMode',
    'variantPeriod', 'eyes', 'effects', 'attachment', 'supportedFeatures', 'unsupportedFeatures']);
  assert.deepEqual(previous.recipe.supportedFeatures, ['body-palettes', 'standard-eyes', 'boost-glow']);
  assert.deepEqual(Object.keys(previous.recipe.palettes[0]), ['variants']);
  for (const bodyStyle of [null, undefined]) {
    f.metadata.bodyStyle = bodyStyle;
    assert.deepEqual(f.resolve(), previous);
  }
  f.metadata.palettes[0].boostGlow = { asset: 1 };
  const additive = f.resolve();
  assert.equal(Object.hasOwn(additive.recipe, 'bodyStyle'), false);
  assert.deepEqual(additive.recipe.supportedFeatures, previous.recipe.supportedFeatures);
  assert.equal(additive.recipe.palettes[0].boostGlow.asset.source, f.image);
});

test('standard body metadata copies and freezes style, fades, crops and per-run glow identities', () => {
  const f = bodyFixture();
  f.metadata.palettes.push({ variants: [{ asset: 1 }] });
  for (const palette of f.metadata.palettes.slice(0, 2)) palette.variants.push({ asset: 0 });
  f.metadata.variantMode = 'ping-pong';
  f.metadata.variantPeriod = 2;
  f.metadata.bodyStyle.headFade = { palette: 2, length: 2.5 };
  f.metadata.bodyStyle.tailFade = { palette: 0, length: 6 };
  const result = f.resolve();
  assert.equal(result.schema, 1);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.recipe.bodyStyle, f.metadata.bodyStyle);
  assert.deepEqual(result.recipe.runs, f.metadata.runs);
  assert.equal(result.recipe.variantMode, 'ping-pong');
  assert.equal(result.recipe.variantPeriod, 2);
  assert.deepEqual(result.recipe.runs.map(run => result.recipe.palettes[run.palette].boostGlow.asset.source),
    [f.catalog[2].source, f.catalog[3].source, f.catalog[2].source]);
  assert.deepEqual(result.recipe.palettes[0].boostGlow.sourceRect, [1, 2, 5, 6]);
  assert.deepEqual(result.recipe.palettes[1].boostGlow.sourceRect, [0, 0, 40, 50]);
  assert.deepEqual(result.recipe.supportedFeatures,
    ['body-palettes', 'standard-eyes', 'outline', 'shadow', 'death-highlight', 'standard-body-style']);
  for (const value of [result.recipe.bodyStyle, result.recipe.bodyStyle.headFade, result.recipe.bodyStyle.tailFade,
    result.recipe.palettes[0].boostGlow, result.recipe.palettes[0].boostGlow.sourceRect]) assert(Object.isFrozen(value));
  f.metadata.bodyStyle.swell = 3;
  f.metadata.bodyStyle.headFade.length = 11;
  f.metadata.palettes[0].boostGlow.sourceRect[0] = 4;
  assert.equal(result.recipe.bodyStyle.swell, -0.125);
  assert.equal(result.recipe.bodyStyle.headFade.length, 2.5);
  assert.equal(result.recipe.palettes[0].boostGlow.sourceRect[0], 1);
});

test('body style preserves base-family variant mode and period without deriving them from runs or style', () => {
  for (const variantMode of ['first', 'cycle', 'ping-pong']) {
    const f = bodyFixture();
    f.metadata.variantMode = variantMode;
    f.metadata.variantPeriod = 60;
    f.metadata.custom = variantMode === 'first';
    f.metadata.bodyStyle.detailedSegments = false;
    for (const palette of f.metadata.palettes) palette.variants = Array.from({ length: 60 }, () => ({ asset: 0 }));
    const { recipe } = f.resolve();
    assert.equal(recipe.variantMode, variantMode);
    assert.equal(recipe.variantPeriod, 60);
    assert.equal(recipe.custom, f.metadata.custom);
    assert.equal(recipe.runs.length, 3);
  }
});

test('glows use the existing shared borrower and refresh readiness, dimensions and identity by revision', () => {
  const f = bodyFixture();
  f.metadata.palettes[0].variants[0] = { asset: 2 };
  f.metadata.effects[0].asset = 2;
  f.catalog[2].state = 'pending';
  f.catalog[3].source.complete = false;
  const pending = f.resolve();
  const glow = pending.recipe.palettes[0].boostGlow;
  assert.equal(pending.status, 'pending');
  assert.equal(glow.asset, pending.recipe.palettes[0].variants[0].asset);
  assert.equal(glow.asset, pending.recipe.effects[0].asset);
  assert.equal(pending.recipe.palettes[1].boostGlow.asset.status, 'pending');
  f.catalog[2].state = 'ready';
  f.catalog[3].source.complete = true;
  f.snapshot.revision = 2;
  const ready = f.resolve();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.revision, 2);
  assert.notEqual(ready.recipe.palettes[0].boostGlow.asset, glow.asset);
  assert.equal(ready.recipe.palettes[0].boostGlow.asset.source, glow.asset.source);
  assert.equal(glow.asset.status, 'pending');
  f.catalog[2].source.width = 21;
  f.snapshot.revision = 3;
  const resized = f.resolve();
  assert.equal(resized.recipe.palettes[0].boostGlow.asset.width, 21);
  assert.equal(ready.recipe.palettes[0].boostGlow.asset.width, 20);
  f.catalog[2].source = new f.realm.HTMLCanvasElement();
  f.snapshot.revision = 4;
  assert.notEqual(f.resolve().recipe.palettes[0].boostGlow.asset.source, glow.asset.source);
  assert.equal(glow.asset.source, ready.recipe.palettes[0].boostGlow.asset.source);
});

test('missing glow sources stay pending, native sizes and catalog unsupported take precedence', () => {
  const f = bodyFixture();
  f.catalog[2].source = null;
  const absent = f.resolve();
  assert.equal(absent.status, 'pending');
  assert.equal(absent.recipe.palettes[0].boostGlow.sourceRect, null);
  f.catalog[3].source.naturalWidth = 0;
  assert.equal(f.resolve().recipe.palettes[1].boostGlow.asset.status, 'pending');
  f.catalog[3].state = 'unsupported';
  assert.equal(f.resolve().status, 'unsupported');
  f.catalog[3].state = 'pending';
  f.metadata.unsupportedFeatures = ['synthetic-body-extension'];
  assert.equal(f.resolve().status, 'unsupported');
  f.metadata.unsupportedFeatures = [];
  f.catalog[2].source = new f.realm.HTMLCanvasElement();
  f.catalog[2].source.width = 5;
  assert.throws(() => f.resolve(), /sourceRect exceeds/);
});

test('advertised body style requires base and run glows and all three unity-opacity shared effects', () => {
  for (const index of [0, 1]) {
    const f = bodyFixture();
    delete f.metadata.palettes[index].boostGlow;
    f.metadata.effects.push({ kind: 'boost-glow', asset: 0, opacity: 1 });
    assert.throws(() => f.resolve(), /requires boostGlow/);
  }
  const base = bodyFixture();
  base.metadata.palettes.push({ variants: [{ asset: 0 }] });
  base.metadata.basePalette = 2;
  assert.throws(() => base.resolve(), /requires boostGlow/);
  base.metadata.palettes[2].boostGlow = { asset: 2 };
  assert.equal(base.resolve().status, 'ready');
  for (const kind of ['outline', 'shadow', 'death-highlight']) {
    const f = bodyFixture();
    f.metadata.effects = f.metadata.effects.filter(effect => effect.kind !== kind);
    assert.throws(() => f.resolve(), /requires .* with opacity 1/);
    for (const opacity of [0, 0.5]) {
      f.metadata.effects.push({ kind, asset: 0, opacity });
      assert.throws(() => f.resolve(), /requires .* with opacity 1/);
      f.metadata.effects.pop();
    }
  }
});

test('style and fade fields are explicit bounded scalars with no defaults or coercion', () => {
  for (const key of ['detailedSegments', 'swell', 'rotateSegments', 'headFade', 'tailFade']) {
    const f = bodyFixture();
    delete f.metadata.bodyStyle[key];
    assert.throws(() => f.resolve());
  }
  for (const key of ['detailedSegments', 'rotateSegments']) {
    for (const value of [0, 1, 'true', null, undefined]) {
      const f = bodyFixture(); f.metadata.bodyStyle[key] = value;
      assert.throws(() => f.resolve(), /Invalid/);
    }
  }
  for (const swell of [-4096.01, 4096.01, NaN, Infinity, -Infinity, '0', null]) {
    const f = bodyFixture(); f.metadata.bodyStyle.swell = swell;
    assert.throws(() => f.resolve(), /swell/);
  }
  for (const swell of [-4096, -0, 0, 4096]) {
    const f = bodyFixture(); f.metadata.bodyStyle.swell = swell;
    assert(Object.is(f.resolve().recipe.bodyStyle.swell, swell));
  }
  for (const key of ['headFade', 'tailFade']) {
    for (const value of [undefined, {}, { length: 1 }, { palette: 0 },
      ...[-1, 2, 0.5, '0', NaN].map(palette => ({ palette, length: 1 })),
      ...[-1, -0, 0, 65536, Infinity, NaN, '1', null].map(length => ({ palette: 0, length }))]) {
      const f = bodyFixture(); f.metadata.bodyStyle[key] = value;
      assert.throws(() => f.resolve());
    }
    for (const length of [Number.MIN_VALUE, 0.5, 65535]) {
      const f = bodyFixture(); f.metadata.bodyStyle[key] = { palette: 1, length };
      assert.equal(f.resolve().recipe.bodyStyle[key].length, length);
    }
  }
  const f = bodyFixture();
  f.metadata.palettes.push({ variants: [] });
  f.metadata.bodyStyle.headFade = { palette: 2, length: 1 };
  assert.throws(() => f.resolve(), /variants/);
  for (const boostGlow of [null, {}, { asset: 4 }, { asset: '2' }]) {
    const g = bodyFixture(); g.metadata.palettes[0].boostGlow = boostGlow;
    assert.throws(() => g.resolve());
  }
});

test('new metadata rejects accessors and inherited required fields without reading unknown fields or mutating inputs', () => {
  const paths = [f => [f.metadata, 'bodyStyle'], f => [f.metadata.palettes[0], 'boostGlow'],
    f => [f.metadata.palettes[0].boostGlow, 'asset'], f => [f.metadata.palettes[0].boostGlow, 'sourceRect'],
    ...['detailedSegments', 'swell', 'rotateSegments', 'headFade', 'tailFade'].map(key => f => [f.metadata.bodyStyle, key]),
    ...['palette', 'length'].map(key => f => [f.metadata.bodyStyle.headFade, key])];
  for (const locate of paths) {
    const f = bodyFixture();
    f.metadata.bodyStyle.headFade = { palette: 0, length: 2 };
    const before = f.resolve();
    const [target, key] = locate(f);
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, get() { assert.fail('new metadata getter'); } });
    assert.throws(() => f.resolve(), /Accessor unsupported/);
    Object.defineProperty(target, key, original);
    assert.deepEqual(f.resolve(), before);
  }
  const f = bodyFixture();
  const inherited = { swell: f.metadata.bodyStyle.swell };
  delete f.metadata.bodyStyle.swell;
  Object.setPrototypeOf(f.metadata.bodyStyle, inherited);
  assert.throws(() => f.resolve(), /swell/);
  f.metadata.bodyStyle.swell = inherited.swell;
  const objects = [f.metadata, f.metadata.bodyStyle, ...f.metadata.palettes, ...f.catalog,
    ...f.catalog.map(entry => entry.source), f.metadata.palettes[0].boostGlow,
    f.metadata.palettes[0].boostGlow.sourceRect, f.snapshot];
  for (const object of objects) {
    Object.defineProperty(object, 'syntheticUnknown', { get() { assert.fail('unknown field getter'); } });
    Object.freeze(object);
  }
  const descriptors = objects.map(Object.getOwnPropertyDescriptors);
  assert.equal(f.resolve().status, 'ready');
  assert.deepEqual(objects.map(Object.getOwnPropertyDescriptors), descriptors);
});

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
    const f = bodyFixture();
    for (const { source } of f.catalog) {
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
