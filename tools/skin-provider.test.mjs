import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createSkinProvider } from '../web/skin-provider.mjs';
import { createLocalBodyResolver } from '../web/synthetic-body.mjs';
import { resolveLocalSkinDouble } from './stock-skin-policy-double.mjs';

// Original synthetic metadata, realm doubles, and assets; no external references.
test('local provider preserves built-in stripes and projection collisions over exact existing sources', () => {
  const { realm } = fixture();
  const source = () => new realm.HTMLCanvasElement();
  const bodySources = {
    palettes: Array.from({ length: 3 }, () => ({ variants: Array.from({ length: 7 }, source), boostGlow: source() })),
    effects: { outline: source(), shadow: source(), deathHighlight: source() },
  };
  const calls = [];
  const resolve = createLocalBodyResolver(bodySources, realm, (skin, bytes) => {
    assert(bytes instanceof Uint8Array, 'explicit custom byte array reaches the local policy');
    calls.push({ skin, bytes }); return resolveLocalSkinDouble(skin, bytes);
  });
  for (const [skin, runs] of [
    [9, [...Array.from({ length: 11 }, (_, index) => ({ palette: index % 2 ? 0 : 1, count: 1 })), { palette: 1, count: 9 }]],
    [10, [{ palette: 0, count: 5 }, { palette: 1, count: 5 }, { palette: 1, count: 5 }]],
    [15, Array.from({ length: 9 }, (_, index) => ({ palette: index % 3, count: 1 }))],
    [29, [{ palette: 2, count: 2 }, { palette: 1, count: 1 }, { palette: 2, count: 4 }, { palette: 1, count: 1 }, { palette: 2, count: 2 }]],
    [20, [{ palette: 0, count: 5 }, { palette: 0, count: 5 }]],
  ]) {
    const { recipe, status } = resolve({ skin, customBytes: new Uint8Array(), cosmetic: 0 });
    assert.equal(status, 'ready'); assert.equal(calls.at(-1).skin, skin);
    assert.deepEqual(recipe.runs, runs); assert.equal(recipe.basePalette, runs[0].palette);
    assert.equal(recipe.custom, false); assert.equal(recipe.variantMode, 'ping-pong'); assert.equal(recipe.variantPeriod, 7);
    assert.equal(recipe.eyes.kind, 'standard'); assert.equal(recipe.attachment, null);
    assert.equal(recipe.faceDecoration, undefined); assert.equal(recipe.antenna, undefined);
    assert.deepEqual(recipe.bodyStyle, { detailedSegments: false, swell: 0, rotateSegments: true, headFade: null, tailFade: null });
    for (const run of runs) {
      const actual = recipe.palettes[run.palette], expected = bodySources.palettes[run.palette];
      for (const [index, use] of actual.variants.entries()) assert.equal(use.asset.source, expected.variants[index]);
      assert.equal(actual.boostGlow.asset.source, expected.boostGlow);
    }
    assert(Object.isFrozen(recipe.runs)); assert(recipe.runs.every(Object.isFrozen));
  }
  const bytes = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 1, 5, 9, 36, 0, 7, 2, 5, 2, 41, 3, 39, 1, 5, 255);
  const recipe = resolve({ skin: 60, customBytes: bytes }).recipe;
  assert.notEqual(calls.at(-1).bytes, bytes);
  assert.deepEqual(calls.at(-1).bytes, bytes);
  assert.deepEqual(recipe.runs, [{ palette: 2, count: 3 }, { palette: 2, count: 2 }, { palette: 0, count: 3 }, { palette: 2, count: 1 }]);
  assert.equal(recipe.custom, true); assert.equal(recipe.variantMode, 'first'); assert.equal(recipe.variantPeriod, 1);
  bytes.fill(0);
  assert.equal(recipe.runs[0].count, 3);
  assert.throws(() => resolve({ skin: 10, customBytes: new Uint8Array(256) }));
  assert.equal(calls.length, 6, 'invalid custom input fails before the policy callback');
});

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

test('source content revisions stay independent of the enclosing catalog revision', () => {
  const f = fixture();
  const unchanged = f.resolve().recipe.palettes[0].variants[0].asset;
  assert(!Object.hasOwn(unchanged, 'revision'), 'legacy assets keep their existing output shape');
  f.catalog[0].revision = 'content-1';
  f.catalog[1].revision = -0;
  const first = f.resolve();
  f.snapshot.revision = 'synthetic-2';
  const second = f.resolve();
  assert.equal(second.revision, 'synthetic-2');
  for (const value of [first, second]) {
    const [a, b] = value.recipe.palettes.map(palette => palette.variants[0].asset);
    assert.equal(a.revision, 'content-1');
    assert(Object.is(b.revision, -0));
    assert.equal(a.source, f.canvas);
    assert(Object.isFrozen(a));
  }
});

test('source content revisions validate the same closed domain without invoking getters', () => {
  const f = fixture();
  for (const invalid of [null, '', 'x'.repeat(129), NaN, Infinity, -1, 1.5, {}, true]) {
    f.catalog[0].revision = invalid;
    assert.throws(() => f.resolve(), /revision/);
  }
  let reads = 0;
  Object.defineProperty(f.catalog[0], 'revision', { get() { reads++; return 1; } });
  assert.throws(() => f.resolve(), /Accessor unsupported at revision/);
  assert.equal(reads, 0);
});

const sideGeometry = () => ({ forward: 11.375, lateral: 3.125, lateralBias: 0.375,
  rotationOffset: 0.287, imageScale: 0.3125, pivotX: 9.25, pivotY: -7.5, width: 47, height: 31 });
function addDecoration(f) {
  f.metadata.faceDecoration = { kind: 'paired-side-images', geometry: sideGeometry(), image: { asset: 0 } };
}

const antennaGeometry = () => ({ kind: 'ordinary-chain', nodes: 8,
  outerColor: 0x123456, innerColor: 0xabcdef, innerOpacity: 0.375,
  repeatedInnerStrokes: true, rotateBulb: false,
  bulb: { offsetX: -7.25, offsetY: 2.5, width: 19, height: 23, scale: 0.625, opacity: 0.75 } });
function addAntenna(f) {
  f.metadata.antenna = { kind: 'ordinary-chain', geometry: antennaGeometry(),
    image: { asset: 0, sourceMode: 'whole' } };
}

function addSingleEye(f) {
  f.metadata.eyes = { kind: 'single-image', geometry: { baseSize: 20, pupilSize: 8, pupilTravel: 3 },
    baseImage: { asset: 0 }, pupilImage: { asset: 1 } };
}

function addMouthFace(f) {
  f.metadata.eyes = { kind: 'mouth-face', geometry: { pupilTravel: 1.625 },
    eyeMarks: { asset: 0, sourceMode: 'whole' }, mouth: { asset: 1, sourceMode: 'whole' } };
}

test('mouth face copies the complete exclusive family, exact sources, signed zero and explicit whole modes', () => {
  for (const make of [fixture, bodyFixture]) {
    const f = make(); const old = f.resolve(); const original = f.metadata.eyes;
    addMouthFace(f); const input = f.metadata.eyes; input.geometry.pupilTravel = -0;
    const { recipe, status } = f.resolve(); const eyes = recipe.eyes;
    assert.equal(status, 'ready');
    assert.deepEqual(Object.keys(eyes), ['kind', 'geometry', 'eyeMarks', 'mouth']);
    assert(Object.is(eyes.geometry.pupilTravel, -0)); assert.notEqual(eyes.geometry, input.geometry);
    assert(Object.isFrozen(eyes)); assert(Object.isFrozen(eyes.geometry));
    for (const [key, index] of [['eyeMarks', 0], ['mouth', 1]]) {
      const use = eyes[key]; assert.notEqual(use, input[key]);
      assert.equal(use.sourceMode, 'whole'); assert.equal(use.asset, recipe.palettes[index].variants[0].asset);
      assert.equal(use.asset.source, f.catalog[index].source);
      for (const value of [use, use.asset, use.sourceRect]) assert(Object.isFrozen(value));
      assert(!Object.isFrozen(use.asset.source));
    }
    assert(recipe.supportedFeatures.includes('mouth-face'));
    assert(!recipe.supportedFeatures.includes('standard-eyes'));
    assert(!recipe.supportedFeatures.includes('single-image-eye'));
    input.geometry.pupilTravel = 7; input.eyeMarks.asset = 1;
    assert(Object.is(eyes.geometry.pupilTravel, -0)); assert.equal(eyes.eyeMarks.asset.source, f.canvas);
    const alias = f.resolve().recipe.eyes; assert.equal(alias.eyeMarks.asset, alias.mouth.asset);
    f.metadata.eyes = original; assert.deepEqual(f.resolve(), old);
  }
});

test('mouth face requires finite own geometry and both explicit whole source uses without any supplied crop', () => {
  const f = fixture(); addMouthFace(f);
  for (const pupilTravel of [0, -0, Number.MIN_VALUE, 4096]) {
    f.metadata.eyes.geometry.pupilTravel = pupilTravel;
    assert(Object.is(f.resolve().recipe.eyes.geometry.pupilTravel, pupilTravel));
  }
  for (const pupilTravel of [undefined, null, true, '1', {}, NaN, Infinity, -Infinity, -Number.MIN_VALUE, 4096.001]) {
    f.metadata.eyes.geometry.pupilTravel = pupilTravel; assert.throws(() => f.resolve());
  }
  f.metadata.eyes.geometry.pupilTravel = 2;
  for (const key of ['eyeMarks', 'mouth']) {
    const use = f.metadata.eyes[key];
    for (const value of [undefined, null, {}, Promise.resolve()]) {
      f.metadata.eyes[key] = value; assert.throws(() => f.resolve());
    }
    f.metadata.eyes[key] = use;
    for (const sourceMode of [undefined, null, 'crop', 'WHOLE', {}, true]) {
      use.sourceMode = sourceMode; assert.throws(() => f.resolve());
    }
    use.sourceMode = 'whole';
    for (const sourceRect of [undefined, null, [0, 0, 20, 30], [0, 0, 40, 50], [1, 2, 3, 4]]) {
      use.sourceRect = sourceRect; assert.throws(() => f.resolve());
    }
    delete use.sourceRect;
  }
  for (const decoration of [{ kind: 'none' }, { kind: 'paired-side-images' }, {}, false, Promise.resolve()]) {
    f.metadata.faceDecoration = decoration; assert.throws(() => f.resolve());
  }
  for (const faceDecoration of [undefined, null]) {
    f.metadata.faceDecoration = faceDecoration;
    assert.equal(f.resolve().recipe.faceDecoration, undefined);
  }
});

test('mouth metadata never invokes accessors and rejects inherited requirements and decorated promises', () => {
  const paths = [f => [f.metadata, 'eyes'],
    ...['kind', 'geometry', 'eyeMarks', 'mouth'].map(k => f => [f.metadata.eyes, k]),
    f => [f.metadata.eyes.geometry, 'pupilTravel'],
    ...['eyeMarks', 'mouth'].flatMap(k => ['asset', 'sourceMode', 'sourceRect'].map(p => f => [f.metadata.eyes[k], p]))];
  for (const locate of paths) {
    const f = fixture(); addMouthFace(f); const [record, key] = locate(f);
    const original = Object.getOwnPropertyDescriptor(record, key); let reads = 0;
    Object.defineProperty(record, key, { configurable: true, get() { reads++; return original?.value; } });
    assert.throws(() => f.resolve(), /Accessor/); assert.equal(reads, 0);
    delete record[key];
    if (key !== 'sourceRect') {
      Object.setPrototypeOf(record, { [key]: original.value }); assert.throws(() => f.resolve());
    }
  }
  for (const key of ['eyes', 'geometry', 'eyeMarks', 'mouth']) {
    const f = fixture(); addMouthFace(f); const record = key === 'eyes' ? f.metadata : f.metadata.eyes;
    record[key] = Object.assign(Promise.resolve(), record[key]); assert.throws(() => f.resolve(), /synchronous/);
  }
});

test('mouth sources share catalog status precedence and immutable revision snapshots with all existing uses', () => {
  for (const key of ['eyeMarks', 'mouth']) {
    const f = bodyFixture(); addMouthFace(f); addAntenna(f);
    f.catalog.push({ source: null, state: 'ready', revision: -0 }); f.metadata.eyes[key].asset = 4;
    const pending = f.resolve(); assert.equal(pending.status, 'pending');
    assert.equal(pending.recipe.eyes[key].asset.status, 'pending');
    assert.equal(pending.recipe.eyes[key].sourceMode, 'whole'); assert.equal(pending.recipe.eyes[key].sourceRect, null);
    f.metadata.unsupportedFeatures = ['required-synthetic-feature']; assert.equal(f.resolve().status, 'unsupported');
    f.metadata.unsupportedFeatures = []; f.catalog[0].state = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
    f.catalog[0].state = 'ready';
    const source = new f.realm.HTMLCanvasElement(); f.catalog[4] = { source, state: 'pending', revision: -0 };
    assert.equal(f.resolve().status, 'pending');
    f.catalog[4].state = 'ready'; f.snapshot.revision = 2;
    const ready = f.resolve(); assert.equal(ready.status, 'ready');
    assert(Object.is(ready.recipe.eyes[key].asset.revision, -0));
    f.catalog[4].revision = +0; source.width = 7; f.snapshot.revision = 3;
    const after = f.resolve(); assert.equal(after.recipe.eyes[key].asset.source, source);
    assert(Object.is(after.recipe.eyes[key].asset.revision, +0));
    assert.equal(ready.recipe.eyes[key].asset.width, 20); assert.equal(after.recipe.eyes[key].asset.width, 7);
    assert.equal(pending.recipe.eyes[key].asset.source, null);
    source.width = 0; assert.equal(f.resolve().status, 'pending');
    f.catalog[4].state = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
  }
  const f = fixture(); f.metadata.status = 'ready'; addMouthFace(f);
  f.metadata.status = 'pending'; assert.equal(f.resolve().recipe, null);
  f.metadata.status = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
});

test('single image eyes copy and freeze geometry and both uses while borrowing exact shared sources', () => {
  for (const make of [fixture, bodyFixture]) {
    const f = make(); addSingleEye(f);
    const input = f.metadata.eyes;
    input.geometry.pupilTravel = -0;
    input.pupilImage.sourceRect = [1, 2, 7, 9];
    const { recipe, status } = f.resolve(); const eyes = recipe.eyes;
    assert.equal(status, 'ready');
    assert.deepEqual(Object.keys(eyes), ['kind', 'geometry', 'baseImage', 'pupilImage']);
    assert.equal(eyes.kind, 'single-image');
    assert.deepEqual(eyes.geometry, input.geometry);
    assert(Object.is(eyes.geometry.pupilTravel, -0));
    assert.notEqual(eyes.geometry, input.geometry);
    for (const key of ['baseImage', 'pupilImage']) {
      assert.deepEqual(Object.keys(eyes[key]), ['asset', 'sourceRect', 'sourceMode']);
      assert.notEqual(eyes[key], input[key]);
      for (const value of [eyes[key], eyes[key].asset, eyes[key].sourceRect]) assert(Object.isFrozen(value));
    }
    assert(Object.isFrozen(eyes)); assert(Object.isFrozen(eyes.geometry));
    assert.equal(eyes.baseImage.asset, recipe.palettes[0].variants[0].asset);
    assert.equal(eyes.pupilImage.asset, recipe.palettes[1].variants[0].asset);
    assert.equal(eyes.baseImage.asset.source, f.canvas);
    assert.equal(eyes.pupilImage.asset.source, f.image);
    assert.equal(eyes.baseImage.sourceMode, 'whole');
    assert.deepEqual(eyes.baseImage.sourceRect, [0, 0, 20, 30]);
    assert.equal(eyes.pupilImage.sourceMode, 'crop');
    assert.deepEqual(eyes.pupilImage.sourceRect, [1, 2, 7, 9]);
    assert(recipe.supportedFeatures.includes('single-image-eye'));
    assert(!recipe.supportedFeatures.includes('standard-eyes'));
    input.geometry.baseSize = 91; input.baseImage.asset = 1; input.pupilImage.sourceRect[0] = 3;
    assert.equal(eyes.geometry.baseSize, 20);
    assert.equal(eyes.baseImage.asset.source, f.canvas);
    assert.equal(eyes.pupilImage.sourceRect[0], 1);
    assert(!Object.isFrozen(f.canvas)); assert(!Object.isFrozen(f.image));
    f.metadata.eyes.baseImage.asset = 1;
    const alias = f.resolve().recipe.eyes;
    assert.equal(alias.baseImage.asset, alias.pupilImage.asset);
    assert.equal(alias.baseImage.asset.source, f.image);
    f.catalog.push({ source: f.image, state: 'pending' });
    f.metadata.eyes.baseImage.asset = f.catalog.length - 1;
    const duplicate = f.resolve().recipe.eyes;
    assert.equal(duplicate.baseImage.asset.source, duplicate.pupilImage.asset.source);
    assert.notEqual(duplicate.baseImage.asset, duplicate.pupilImage.asset);
  }
});

test('single image geometry requires finite bounded own numbers and preserves admitted signed zero', () => {
  const f = fixture(); addSingleEye(f);
  for (const key of ['baseSize', 'pupilSize', 'pupilTravel']) {
    const geometry = f.metadata.eyes.geometry; const original = geometry[key];
    const positive = key !== 'pupilTravel';
    for (const value of [NaN, Infinity, -Infinity, -Number.MIN_VALUE, 4096.000000000001,
      null, undefined, '1', true, {}, ...(positive ? [0, -0] : [])]) {
      geometry[key] = value; assert.throws(() => f.resolve(), undefined, key);
    }
    for (const value of [Number.MIN_VALUE, 0.125, 4096, ...(positive ? [] : [0, -0])]) {
      geometry[key] = value; assert(Object.is(f.resolve().recipe.eyes.geometry[key], value));
    }
    delete geometry[key]; Object.setPrototypeOf(geometry, { [key]: original });
    assert.throws(() => f.resolve(), undefined, key);
    Object.setPrototypeOf(geometry, Object.prototype); geometry[key] = original;
  }
});

test('single image uses distinguish omitted rectangles from full and partial crops without body style', () => {
  const f = fixture(); addSingleEye(f);
  for (const [key, full] of [['baseImage', [0, 0, 20, 30]], ['pupilImage', [0, 0, 40, 50]]]) {
    const input = f.metadata.eyes[key];
    const whole = f.resolve().recipe.eyes[key];
    input.sourceRect = [...full];
    const crop = f.resolve().recipe.eyes[key];
    assert.equal(whole.sourceMode, 'whole'); assert.equal(crop.sourceMode, 'crop');
    assert.deepEqual(whole.sourceRect, crop.sourceRect);
    input.sourceRect = [-0, -0, 1.5, 2.5];
    const partial = f.resolve().recipe.eyes[key];
    assert.deepEqual(partial.sourceRect, input.sourceRect);
    assert(Object.is(partial.sourceRect[0], -0)); assert(Object.is(partial.sourceRect[1], -0));
    for (const rect of [null, [], [0, 0, 1], [0, 0, 1, 1, 1], [-1, 0, 1, 1], [0, 0, 0, 1],
      [0, 0, 1, -0], [0, 0, Infinity, 1], [NaN, 0, 1, 1], [0, 0, '1', 1],
      [0, 0, full[2] + 1, 1], [0, full[3], 1, 1]]) {
      input.sourceRect = rect; assert.throws(() => f.resolve());
    }
    delete input.sourceRect;
    for (const asset of [-1, 2, 0.5, '0', null, undefined]) {
      const original = input.asset; input.asset = asset; assert.throws(() => f.resolve()); input.asset = original;
    }
  }
  assert.equal(Object.hasOwn(f.resolve().recipe.palettes[0].variants[0], 'sourceMode'), false);
});

test('each single image use contributes native readiness and unsupported status independently', () => {
  for (const key of ['baseImage', 'pupilImage']) {
    const f = fixture(); addSingleEye(f);
    f.catalog.push({ source: null, state: 'ready' }); f.metadata.eyes[key].asset = 2;
    let value = f.resolve(); assert.equal(value.status, 'pending');
    assert.equal(value.recipe.eyes[key].asset.status, 'pending');
    assert.equal(value.recipe.eyes[key].sourceRect, null);
    assert.equal(value.recipe.eyes[key].sourceMode, 'whole');
    f.metadata.eyes[key].sourceRect = [1, 2, 3, 4];
    value = f.resolve(); assert.equal(value.recipe.eyes[key].sourceRect, null);
    assert.equal(value.recipe.eyes[key].sourceMode, 'crop');
    const source = new f.realm.HTMLCanvasElement();
    f.catalog[2] = { source, state: 'pending' };
    assert.equal(f.resolve().status, 'pending');
    f.catalog[2].state = 'ready'; assert.equal(f.resolve().status, 'ready');
    source.width = 0; assert.equal(f.resolve().status, 'pending');
    assert.equal(f.resolve().recipe.eyes[key].sourceRect, null);
    source.width = 20; source.height = 0; assert.equal(f.resolve().status, 'pending');
    source.height = 30; f.catalog[2].state = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
    f.catalog[2] = { source: null, state: 'unsupported' }; assert.equal(f.resolve().status, 'unsupported');
    const image = new f.realm.HTMLImageElement(); image.complete = false;
    f.catalog[2] = { source: image, state: 'ready' }; assert.equal(f.resolve().status, 'pending');
    image.complete = true; f.catalog[2].state = 'pending'; assert.equal(f.resolve().status, 'ready');
    image.naturalWidth = 0; assert.equal(f.resolve().status, 'pending');
    image.naturalWidth = 40; image.naturalHeight = 0; assert.equal(f.resolve().status, 'pending');
    image.naturalHeight = 50;
    f.metadata.unsupportedFeatures = ['synthetic-required-mouth']; assert.equal(f.resolve().status, 'unsupported');
    f.metadata.unsupportedFeatures = []; f.catalog[0].state = 'pending'; assert.equal(f.resolve().status, 'pending');
    f.catalog[2].state = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
    for (const source of [{}, { width: 20, height: 30 }, new Uint8Array(4)]) {
      f.catalog[2] = { source, state: 'ready' }; assert.throws(() => f.resolve(), /trusted realm/);
    }
  }
});

test('single image sources refresh by revision without mutating previously resolved snapshots', () => {
  const f = fixture(); addSingleEye(f);
  for (const revision of [-0, 0, 'synthetic-single-eye']) {
    f.snapshot.revision = revision; assert(Object.is(f.resolve().revision, revision));
  }
  const before = f.resolve();
  f.canvas.width = 29; f.image.naturalHeight = 61; f.snapshot.revision = 2;
  const after = f.resolve();
  for (const [key, size, oldSize, newSize] of [['baseImage', 'width', 20, 29], ['pupilImage', 'height', 50, 61]]) {
    assert.equal(after.recipe.eyes[key].asset.source, before.recipe.eyes[key].asset.source);
    assert.notEqual(after.recipe.eyes[key].asset, before.recipe.eyes[key].asset);
    assert.equal(before.recipe.eyes[key].asset[size], oldSize);
    assert.equal(after.recipe.eyes[key].asset[size], newSize);
  }
  assert.deepEqual(after.recipe.eyes.baseImage.sourceRect, [0, 0, 29, 30]);
  assert.deepEqual(after.recipe.eyes.pupilImage.sourceRect, [0, 0, 40, 61]);
  f.catalog[0].source = new f.realm.HTMLCanvasElement();
  assert.notEqual(f.resolve().recipe.eyes.baseImage.asset.source, before.recipe.eyes.baseImage.asset.source);
  f.metadata.eyes.pupilImage.sourceRect = [0, 0, 40, 61];
  f.image.naturalHeight = 50; assert.throws(() => f.resolve(), /sourceRect exceeds/);
});

test('single image metadata rejects own accessors, inherited required fields and decorated Promises', () => {
  const paths = [f => [f.metadata, 'eyes'],
    ...['kind', 'geometry', 'baseImage', 'pupilImage'].map(key => f => [f.metadata.eyes, key]),
    ...['baseSize', 'pupilSize', 'pupilTravel'].map(key => f => [f.metadata.eyes.geometry, key]),
    ...['baseImage', 'pupilImage'].flatMap(image => ['asset', 'sourceRect'].map(key => f => [f.metadata.eyes[image], key])),
    ...['baseImage', 'pupilImage'].map(image => f => [f.metadata.eyes[image].sourceRect, '0'])];
  for (const locate of paths) {
    const f = fixture(); addSingleEye(f);
    for (const key of ['baseImage', 'pupilImage']) f.metadata.eyes[key].sourceRect = [0, 0, 2, 3];
    const [record, key] = locate(f); const original = Object.getOwnPropertyDescriptor(record, key);
    let calls = 0;
    Object.defineProperty(record, key, { configurable: true, get() { calls++; return original.value; } });
    assert.throws(() => f.resolve(), /Accessor/); assert.equal(calls, 0);
    Object.defineProperty(record, key, original);
    if (key !== 'sourceRect') {
      delete record[key]; Object.setPrototypeOf(record, { [key]: original.value });
      assert.throws(() => f.resolve());
    }
  }
  for (const key of ['eyes', 'geometry', 'baseImage', 'pupilImage']) {
    const f = fixture(); addSingleEye(f);
    const record = key === 'eyes' ? f.metadata : f.metadata.eyes;
    record[key] = Object.assign(Promise.resolve(), record[key]);
    assert.throws(() => f.resolve(), /synchronous/);
  }
});

test('single image eyes reject paired decoration while preserving antenna, body and effect metadata', () => {
  const f = bodyFixture(); addSingleEye(f); addAntenna(f);
  const before = f.resolve();
  assert.deepEqual(before.recipe.supportedFeatures, ['body-palettes', 'single-image-eye',
    'outline', 'shadow', 'death-highlight', 'standard-body-style', 'ordinary-antenna']);
  assert.deepEqual(before.recipe.bodyStyle, f.metadata.bodyStyle);
  assert.equal(before.recipe.antenna.image.asset, before.recipe.eyes.baseImage.asset);
  assert.equal(before.recipe.effects[0].asset, before.recipe.eyes.baseImage.asset);
  for (const value of [null, undefined]) {
    f.metadata.faceDecoration = value; assert.deepEqual(f.resolve(), before);
    assert.equal(Object.hasOwn(f.resolve().recipe, 'faceDecoration'), false);
  }
  addDecoration(f); assert.throws(() => f.resolve(), /require standard eyes/);
  for (const kind of ['none', 'mouth-overlay', 'accessory']) {
    f.metadata.faceDecoration.kind = kind; assert.throws(() => f.resolve());
  }
});

test('standard and none eye output shapes and tags remain exact after selecting single image eyes', () => {
  const f = fixture(); const legacy = f.resolve(); const standard = f.metadata.eyes;
  addSingleEye(f); assert.equal(f.resolve().recipe.eyes.kind, 'single-image');
  f.metadata.eyes = standard; assert.deepEqual(f.resolve(), legacy);
  assert.deepEqual(legacy.recipe.eyes, standard);
  assert.deepEqual(legacy.recipe.supportedFeatures, ['body-palettes', 'standard-eyes']);
  f.metadata.eyes = { kind: 'none' };
  const none = f.resolve();
  assert.deepEqual(none.recipe.eyes, { kind: 'none' });
  assert.deepEqual(none.recipe.supportedFeatures, ['body-palettes']);
  assert.deepEqual(Object.keys(none.recipe), Object.keys(legacy.recipe));
  for (const value of [legacy, none]) {
    assert.equal(Object.hasOwn(value.recipe.palettes[0].variants[0], 'sourceMode'), false);
  }
});

test('optional ordinary antenna preserves exact absent/null legacy shapes and borrowed identity', () => {
  for (const make of [fixture, bodyFixture]) {
    const f = make(); const legacy = f.resolve();
    for (const value of [undefined, null]) {
      f.metadata.antenna = value; assert.deepEqual(f.resolve(), legacy);
      assert.equal(Object.hasOwn(f.resolve().recipe, 'antenna'), false);
    }
    addAntenna(f); const { recipe } = f.resolve(); const antenna = recipe.antenna;
    assert.deepEqual(recipe.supportedFeatures, [...legacy.recipe.supportedFeatures, 'ordinary-antenna']);
    assert.equal(antenna.image.asset, recipe.palettes[0].variants[0].asset);
    assert.equal(antenna.image.asset.source, f.canvas);
    assert.equal(antenna.image.sourceMode, 'whole');
    assert.deepEqual(antenna.image.sourceRect, [0, 0, 20, 30]);
    for (const value of [antenna, antenna.geometry, antenna.geometry.bulb, antenna.image]) assert(Object.isFrozen(value));
    f.metadata.antenna.geometry.bulb.width = 31;
    assert.equal(antenna.geometry.bulb.width, 19);
    assert.equal(recipe.attachment, null);
  }
});

test('ordinary antenna validates every numeric field without losing admitted signed zeros', () => {
  const f = fixture(); addAntenna(f); const a = f.metadata.antenna;
  const fields = [
    ['innerOpacity', 0, 1, false], ['outerColor', 0, 0xffffff, true], ['innerColor', 0, 0xffffff, true],
    ['offsetX', -65535, 65535, false], ['offsetY', -65535, 65535, false],
    ['width', Number.MIN_VALUE, 65535, false], ['height', Number.MIN_VALUE, 65535, false],
    ['scale', Number.MIN_VALUE, 256, false], ['opacity', 0, 1, false],
  ];
  for (const [key, min, max, integral] of fields) {
    const bulb = Object.hasOwn(a.geometry.bulb, key);
    const input = bulb ? a.geometry.bulb : a.geometry; const original = input[key];
    for (const value of [NaN, Infinity, -Infinity, min - 1, max + 1, null, undefined, '1', {},
      ...(integral ? [1.25] : [])]) {
      input[key] = value; assert.throws(() => f.resolve(), undefined, key);
    }
    input[key] = min; assert.doesNotThrow(() => f.resolve());
    input[key] = max; assert.doesNotThrow(() => f.resolve());
    input[key] = -0;
    if (min > 0) assert.throws(() => f.resolve());
    else assert(Object.is((bulb ? f.resolve().recipe.antenna.geometry.bulb : f.resolve().recipe.antenna.geometry)[key], -0));
    delete input[key]; Object.setPrototypeOf(input, { [key]: original }); assert.throws(() => f.resolve());
    Object.setPrototypeOf(input, Object.prototype);
    let calls = 0;
    Object.defineProperty(input, key, { configurable: true, get() { calls++; return original; } });
    assert.throws(() => f.resolve(), /Accessor/); assert.equal(calls, 0);
    Object.defineProperty(input, key, { configurable: true, writable: true, enumerable: true, value: original });
  }
});

test('ordinary topology, flags and unsupported post-bulb strokes are explicit', () => {
  const f = fixture(); addAntenna(f); const a = f.metadata.antenna;
  for (const nodes of [8, 9, 11]) { a.geometry.nodes = nodes; assert.equal(f.resolve().recipe.antenna.geometry.nodes, nodes); }
  for (const nodes of [0, 7, 8.5, 10, 12, '8', null, undefined]) {
    a.geometry.nodes = nodes; assert.throws(() => f.resolve());
  }
  a.geometry.nodes = 8;
  for (const key of ['rotateBulb', 'repeatedInnerStrokes']) {
    for (const value of [false, true]) { a.geometry[key] = value; assert.equal(f.resolve().recipe.antenna.geometry[key], value); }
    for (const value of [0, 1, 'false', null, undefined]) { a.geometry[key] = value; assert.throws(() => f.resolve()); }
    a.geometry[key] = false;
  }
  for (const record of [a, a.geometry]) {
    record.kind = 'static-attachment'; assert.throws(() => f.resolve()); record.kind = 'ordinary-chain';
    record.postBulbStrokes = false; assert.doesNotThrow(() => f.resolve());
    for (const value of [true, 1, null, 'false']) { record.postBulbStrokes = value; assert.throws(() => f.resolve()); }
    delete record.postBulbStrokes;
  }
  assert.equal(Object.hasOwn(f.resolve().recipe.antenna.geometry, 'postBulbStrokes'), false);
});

test('antenna requires explicit whole-source borrowing and rejects even a full crop', () => {
  const f = fixture(); addAntenna(f); const image = f.metadata.antenna.image;
  for (const mode of [undefined, null, 'crop', 'scaled', 1]) {
    image.sourceMode = mode; assert.throws(() => f.resolve());
  }
  image.sourceMode = 'whole';
  for (const rect of [[0, 0, 20, 30], [1, 1, 2, 2], null, []]) {
    image.sourceRect = rect; assert.throws(() => f.resolve());
  }
  delete image.sourceRect; assert.doesNotThrow(() => f.resolve());
  let calls = 0; Object.defineProperty(image, 'sourceMode', { get() { calls++; return 'whole'; } });
  assert.throws(() => f.resolve(), /Accessor/); assert.equal(calls, 0);
});

test('antenna readiness and unsupported requirements share provider status and revision policy', () => {
  const f = fixture(); addAntenna(f);
  const source = new f.realm.HTMLCanvasElement();
  f.catalog.push({ source, state: 'pending' }); f.metadata.antenna.image.asset = 2;
  let value = f.resolve(); assert.equal(value.status, 'pending');
  assert.equal(value.recipe.antenna.image.asset.source, source);
  f.catalog[2].state = 'ready'; assert.equal(f.resolve().status, 'ready');
  f.snapshot.revision = -0; assert(Object.is(f.resolve().revision, -0));
  f.metadata.unsupportedFeatures = ['required-special-topology']; assert.equal(f.resolve().status, 'unsupported');
  assert.deepEqual(f.resolve().recipe.unsupportedFeatures, ['required-special-topology']);
  f.metadata.unsupportedFeatures = []; f.catalog[2].state = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
  f.catalog[2] = { source: null, state: 'ready' }; assert.equal(f.resolve().status, 'pending');
  f.catalog[2] = { source, state: 'ready' }; source.width = 0; assert.equal(f.resolve().status, 'pending');
  source.width = 20;
  f.metadata.attachment = { asset: 0, anchor: 'head', scale: 1, pivotX: 0, pivotY: 0, opacity: 1 };
  value = f.resolve(); assert(value.recipe.supportedFeatures.includes('ordinary-antenna'));
  assert(value.recipe.supportedFeatures.includes('head-attachment')); assert(value.recipe.attachment);
});

test('antenna nested metadata is synchronous own data and never invokes accessors', () => {
  const f = fixture(); addAntenna(f);
  for (const [record, key] of [[f.metadata, 'antenna'], [f.metadata.antenna, 'geometry'],
    [f.metadata.antenna, 'image'], [f.metadata.antenna.geometry, 'bulb']]) {
    const original = record[key]; record[key] = Object.assign(Promise.resolve(), original);
    assert.throws(() => f.resolve(), /synchronous/); record[key] = original;
    let calls = 0; Object.defineProperty(record, key, { configurable: true, get() { calls++; return original; } });
    assert.throws(() => f.resolve(), /Accessor/); assert.equal(calls, 0);
    Object.defineProperty(record, key, { configurable: true, writable: true, enumerable: true, value: original });
  }
});

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

test('optional own projects exact booleans and preserves absent legacy requests before callbacks', () => {
  const f = fixture(); f.resolve({ skin: 7 });
  assert.deepEqual(f.calls.at(-1)[1], { skin: 7, customBytes: undefined, x: undefined, y: undefined, attachmentId: undefined });
  for (const own of [true, false]) {
    f.resolve({ skin: 7, own, cosmetic: 71 });
    assert.equal(f.calls.at(-1)[1].own, own); assert(Object.isFrozen(f.calls.at(-1)[1]));
  }
  const count = f.calls.length;
  for (const own of [undefined, null, 0, 1, 'true', {}, Promise.resolve(true)]) {
    assert.throws(() => f.resolve({ skin: 7, own }), /own/);
  }
  assert.throws(() => f.resolve({ skin: 7, get own() { assert.fail('own getter'); } }), /Accessor/);
  assert.equal(f.calls.length, count);
  const inherited = Object.assign(Object.create({ own: true }), { skin: 7 });
  f.resolve(inherited); assert(!Object.hasOwn(f.calls.at(-1)[1], 'own'));
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
    const f = bodyFixture(); addAntenna(f);
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

// Original synthetic static accessory metadata; no stock selection or renderer claim.
const staticAttachment = () => ({ kind: 'static-head-image', asset: 0, sourceMode: 'crop',
  sourceRect: [0, 0, 20, 30], anchor: 'head', forward: 5, scale: 0.25,
  pivotX: 3, pivotY: 7, opacity: 1 });

test('static head attachment retains a full crop and complete frozen metadata without bodyStyle', () => {
  for (const make of [fixture, bodyFixture]) {
    for (const mouth of [false, true]) {
      const f = make(); if (mouth) addMouthFace(f);
      addAntenna(f); if (!mouth) addDecoration(f);
      f.metadata.attachment = staticAttachment();
      const input = f.metadata.attachment;
      f.catalog[0].revision = 'accessory-content';
      const { recipe, status } = f.resolve(); const attachment = recipe.attachment;
      assert.equal(status, 'ready');
      assert.deepEqual(Object.keys(attachment).sort(), ['kind', 'asset', 'sourceMode', 'sourceRect',
        'anchor', 'forward', 'scale', 'pivotX', 'pivotY', 'opacity'].sort());
      assert.equal(attachment.kind, 'static-head-image'); assert.equal(attachment.forward, 5);
      assert.equal(attachment.sourceMode, 'crop'); assert.equal(attachment.anchor, 'head');
      assert.equal(attachment.scale, 0.25); assert.equal(attachment.pivotX, 3);
      assert.equal(attachment.pivotY, 7); assert.equal(attachment.opacity, 1);
      assert.deepEqual(attachment.sourceRect, [0, 0, 20, 30]);
      assert.notEqual(attachment, input); assert.notEqual(attachment.sourceRect, input.sourceRect);
      assert.equal(attachment.asset, recipe.palettes[0].variants[0].asset);
      assert.equal(attachment.asset, recipe.antenna.image.asset);
      assert.equal(attachment.asset.source, f.canvas); assert.equal(attachment.asset.revision, 'accessory-content');
      for (const value of [attachment, attachment.asset, attachment.sourceRect]) assert(Object.isFrozen(value));
      assert(!Object.isFrozen(f.canvas));
      assert.equal(recipe.supportedFeatures.filter(tag => tag === 'head-attachment').length, 1);
      if (make === bodyFixture && !mouth) assert.equal(recipe.supportedFeatures.length, 9);
      input.forward = 9; input.sourceRect[2] = 1; input.pivotX = 10;
      assert.equal(attachment.forward, 5); assert.equal(attachment.sourceRect[2], 20); assert.equal(attachment.pivotX, 3);
    }
  }
});

test('static head attachment uses declared partial extents and common actual-source containment', () => {
  const f = fixture(); f.metadata.attachment = staticAttachment();
  const input = f.metadata.attachment; input.asset = 1; input.sourceRect = [0, 0, 20.5, 12.25];
  const attachment = f.resolve().recipe.attachment;
  assert.equal(attachment.sourceMode, 'crop'); assert.equal(attachment.asset.source, f.image);
  assert.equal(attachment.asset.width, 40); assert.equal(attachment.asset.height, 50);
  assert.deepEqual(attachment.sourceRect, [0, 0, 20.5, 12.25]);
  for (const sourceRect of [[0, 0, 41, 12], [0, 0, 20, 51]]) {
    input.sourceRect = sourceRect; assert.throws(() => f.resolve(), /actual asset dimensions/);
  }
  input.sourceRect = [0, 0, Number.MIN_VALUE, 50]; assert.equal(f.resolve().status, 'ready');
  f.image.naturalWidth = 65535; f.image.naturalHeight = 65535;
  input.sourceRect = [0, 0, 65535, 65535]; assert.deepEqual(f.resolve().recipe.attachment.sourceRect, input.sourceRect);
});

test('static head attachment requires explicit crop and canonical positive-zero origins', () => {
  for (const sourceRect of [undefined, null, [], [0, 0, 1], [0, 0, 1, 1, 1],
    [-0, 0, 1, 1], [0, -0, 1, 1], [1, 0, 1, 1], [0, 0.5, 1, 1],
    [-1, 0, 1, 1], [0, 0, 0, 1], [0, 0, -0, 1], [0, 0, 1, -1],
    [0, 0, Infinity, 1], [0, 0, 1, NaN], [0, 0, 65536, 1], [0, 0, '1', 1]]) {
    const f = fixture(); f.metadata.attachment = { ...staticAttachment(), sourceRect };
    assert.throws(() => f.resolve(), undefined, `sourceRect ${String(sourceRect)}`);
  }
  for (const sourceMode of [undefined, null, 'whole', 'CROP', true, {}]) {
    const f = fixture(); f.metadata.attachment = { ...staticAttachment(), sourceMode };
    assert.throws(() => f.resolve());
  }
});

test('static head attachment bounds geometry without coercion and preserves signed-zero metadata', () => {
  for (const [key, values] of [['forward', [0, -0, Number.MIN_VALUE, 4096]],
    ['scale', [Number.MIN_VALUE, 0.25, 256]], ['pivotX', [-65535, -0, 0, 65535]],
    ['pivotY', [-65535, -0, 0, 65535]]]) {
    for (const value of values) {
      const f = fixture(); f.metadata.attachment = { ...staticAttachment(), [key]: value };
      const before = f.resolve().recipe.attachment;
      assert(Object.is(before[key], value), key);
      if (Object.is(value, -0)) {
        f.metadata.attachment[key] = +0; f.snapshot.revision = 'changed';
        const after = f.resolve().recipe.attachment;
        assert(Object.is(before[key], -0)); assert(Object.is(after[key], +0));
        assert(!Object.is(before[key], after[key]), 'retained coherence can distinguish the exact admitted bits');
      }
    }
  }
  let coerced = 0;
  const coercible = { valueOf() { coerced++; return 1; }, toString() { coerced++; return '1'; } };
  for (const key of ['forward', 'scale', 'pivotX', 'pivotY']) {
    const outside = key === 'forward' ? [-Number.MIN_VALUE, 4096.001]
      : key === 'scale' ? [0, -0, -1, 256.001] : [-65535.001, 65535.001];
    for (const value of [undefined, null, true, '1', coercible, NaN, Infinity, -Infinity, ...outside]) {
      const f = fixture(); f.metadata.attachment = { ...staticAttachment(), [key]: value };
      assert.throws(() => f.resolve(), undefined, key);
    }
  }
  assert.equal(coerced, 0);
  for (const [key, values] of [['asset', [-1, 2, 0.5, '0', undefined]],
    ['anchor', [undefined, null, 'body', 'HEAD', {}]], ['opacity', [undefined, null, 0, -0, 0.5, 1.01, '1', NaN]]]) {
    for (const value of values) {
      const f = fixture(); f.metadata.attachment = { ...staticAttachment(), [key]: value };
      assert.throws(() => f.resolve(), undefined, key);
    }
  }
});

test('static head attachment is a closed own-data record and never observes rejected accessors', () => {
  for (const key of Object.keys(staticAttachment())) {
    const f = fixture(); const input = staticAttachment(); f.metadata.attachment = input;
    const value = input[key]; let reads = 0;
    Object.defineProperty(input, key, { configurable: true, get() { reads++; return value; } });
    assert.throws(() => f.resolve()); assert.equal(reads, 0, key);
    delete input[key]; Object.setPrototypeOf(input, { [key]: value });
    assert.throws(() => f.resolve(), undefined, `inherited ${key}`);
  }
  for (const key of ['extra', 'then', Symbol('extra')]) {
    const f = fixture(); f.metadata.attachment = staticAttachment(); let reads = 0;
    Object.defineProperty(f.metadata.attachment, key, { get() { reads++; return () => {}; } });
    assert.throws(() => f.resolve()); assert.equal(reads, 0);
  }
  for (const kind of [undefined, null, 'unknown', 'static-attachment', 1, {}]) {
    const f = fixture(); f.metadata.attachment = { ...staticAttachment(), kind };
    assert.throws(() => f.resolve());
  }
  const f = fixture(); f.metadata.attachment = Object.assign(Object.create(null), staticAttachment());
  assert.equal(f.resolve().recipe.attachment.kind, 'static-head-image');
});

test('static head attachment rejects decorated promises and own/inherited crop accessors without observation', () => {
  const f = fixture(); f.metadata.attachment = Object.assign(Promise.resolve(), staticAttachment());
  assert.throws(() => f.resolve(), /synchronous/);
  for (const index of ['0', '1', '2', '3']) {
    const g = fixture(); const input = staticAttachment(); g.metadata.attachment = input;
    const value = input.sourceRect[index]; let reads = 0;
    Object.defineProperty(input.sourceRect, index, { configurable: true, get() { reads++; return value; } });
    assert.throws(() => g.resolve(), /Accessor/); assert.equal(reads, 0);
    delete input.sourceRect[index]; Object.setPrototypeOf(input.sourceRect, { [index]: value });
    assert.throws(() => g.resolve());
  }
  const g = fixture(); g.metadata.attachment = staticAttachment();
  g.metadata.attachment.sourceRect = Object.assign(Promise.resolve(), { 0: 0, 1: 0, 2: 20, 3: 30, length: 4 });
  assert.throws(() => g.resolve());
});

test('static head attachment rejects selected single-image and none families even with pending assets', () => {
  for (const kind of ['single-image', 'none']) {
    for (const state of ['ready', 'pending', 'unsupported']) {
      const f = fixture();
      if (kind === 'single-image') addSingleEye(f); else f.metadata.eyes = { kind };
      f.metadata.attachment = staticAttachment(); f.catalog[0].state = state;
      assert.throws(() => f.resolve());
      f.metadata.attachment = null; assert.equal(f.resolve().recipe.attachment, null);
    }
  }
});

test('static head attachment shares readiness, feature precedence, exact source uses and revision snapshots', () => {
  for (const mouth of [false, true]) {
    const f = bodyFixture(); if (mouth) addMouthFace(f);
    f.metadata.attachment = { ...staticAttachment(), asset: 4 };
    f.catalog.push({ source: null, state: 'ready', revision: -0 });
    const pending = f.resolve(); assert.equal(pending.status, 'pending');
    assert.equal(pending.recipe.attachment.sourceMode, 'crop');
    assert.equal(pending.recipe.attachment.sourceRect, null);
    assert.equal(pending.recipe.attachment.asset.source, null);
    assert(pending.recipe.supportedFeatures.includes('head-attachment'));
    f.metadata.unsupportedFeatures = ['required-synthetic-feature']; assert.equal(f.resolve().status, 'unsupported');
    f.metadata.unsupportedFeatures = []; f.catalog[4].state = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
    const image = new f.realm.HTMLImageElement(); image.complete = false;
    f.catalog[4] = { source: image, state: 'pending', revision: -0 };
    assert.equal(f.resolve().status, 'pending'); image.complete = true;
    const ready = f.resolve(); assert.equal(ready.status, 'ready');
    assert.equal(ready.recipe.attachment.asset.source, image);
    assert(Object.is(ready.recipe.attachment.asset.revision, -0));
    f.catalog[4].revision = +0; f.snapshot.revision = 'after'; image.naturalWidth = 25;
    const after = f.resolve(); assert(Object.is(after.recipe.attachment.asset.revision, +0));
    assert.equal(ready.recipe.attachment.asset.width, 40); assert.equal(after.recipe.attachment.asset.width, 25);
    assert.equal(pending.recipe.attachment.asset.source, null);
    image.naturalHeight = 0; assert.equal(f.resolve().status, 'pending');
    f.catalog[4].state = 'unsupported'; assert.equal(f.resolve().status, 'unsupported');
    f.catalog[4] = { source: new f.realm.HTMLCanvasElement(), state: 'pending' }; assert.equal(f.resolve().status, 'pending');
    f.catalog[4].state = 'ready'; assert.equal(f.resolve().status, 'ready');
    f.metadata.attachment.asset = 0;
    const alias = f.resolve().recipe;
    assert.equal(alias.attachment.asset, alias.palettes[0].variants[0].asset);
  }
});

test('nonready host envelopes do not observe tagged attachment metadata or install geometry', () => {
  const f = fixture(); let reads = 0;
  Object.defineProperty(f.metadata, 'attachment', { get() { reads++; return staticAttachment(); } });
  for (const status of ['pending', 'unsupported']) {
    f.metadata.status = status;
    assert.deepEqual(f.resolve(), { schema: 1, revision: 'synthetic-1', status, recipe: null });
  }
  assert.equal(reads, 0); f.metadata.status = 'ready';
  assert.throws(() => f.resolve(), /Accessor/); assert.equal(reads, 0);
});

test('tagged accessory borrowing observes only native readiness scalars and never source content capabilities', () => {
  const f = fixture(); f.metadata.attachment = { ...staticAttachment(), asset: 2 };
  const image = new f.realm.HTMLImageElement(); f.catalog.push({ source: image, state: 'ready' });
  for (const key of ['src', 'currentSrc', 'decode', 'cloneNode', 'getContext', 'getImageData', 'toDataURL', 'toBlob']) {
    Object.defineProperty(image, key, { get() { assert.fail(`accessory source ${key}`); } });
  }
  Object.freeze(image);
  assert.equal(f.resolve().recipe.attachment.asset.source, image);
  for (const source of [{ naturalWidth: 40, naturalHeight: 50, complete: true }, fixture().image]) {
    f.catalog[2].source = source; assert.throws(() => f.resolve(), /trusted realm/);
  }
  const bad = new f.realm.HTMLImageElement(); let reads = 0;
  Object.defineProperty(bad, 'complete', { get() { reads++; return true; } });
  f.catalog[2].source = bad; assert.throws(() => f.resolve(), /Accessor/); assert.equal(reads, 0);
});

test('legacy untagged attachments retain exact shapes, mode inference, opacity and family compatibility', () => {
  for (const make of [fixture, bodyFixture]) {
    for (const kind of ['standard', 'single-image', 'mouth-face', 'none']) {
      const f = make(); if (kind === 'single-image') addSingleEye(f);
      else if (kind === 'mouth-face') addMouthFace(f); else if (kind === 'none') f.metadata.eyes = { kind };
      const absent = f.resolve();
      for (const rect of [undefined, [1, 2, 5, 6]]) {
        f.metadata.attachment = { asset: 0, anchor: 'head', scale: 2, pivotX: -0, pivotY: 4, opacity: 0.5,
          ...(rect === undefined ? {} : { sourceRect: rect }) };
        const result = f.resolve();
        assert.equal(result.status, 'ready');
        const asset = result.recipe.palettes[0].variants[0].asset;
        assert.deepEqual(result.recipe.attachment, { asset, sourceRect: rect ?? [0, 0, 20, 30],
          ...(make === bodyFixture ? { sourceMode: rect === undefined ? 'whole' : 'crop' } : {}),
          anchor: 'head', scale: 2, pivotX: -0, pivotY: 4, opacity: 0.5 });
        assert.deepEqual(result.recipe.supportedFeatures, [...absent.recipe.supportedFeatures.filter(tag => tag !== 'standard-body-style'),
          'head-attachment', ...(make === bodyFixture ? ['standard-body-style'] : [])]);
      }
      delete f.metadata.attachment; assert.deepEqual(f.resolve(), absent);
      f.metadata.attachment = null; assert.deepEqual(f.resolve(), absent);
    }
  }
});
