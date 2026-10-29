import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStockSkin } from './stock-skin-policy-oracle.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';

import { stockSkinSourceFixture as fixture } from './stock-skin-source-fixture.mjs';

const custom = (...pairs) => Uint8Array.of(3, 8, 1, 42, 9, 0, 201, 7, ...pairs.flat());
const expand = rule => rule.runs.flatMap(({ palette, count }) => Array(count).fill(palette));

function selectAccessory(f, { image = true, source, id = 71 } = {}) {
  source ??= new f.realm[image ? 'HTMLImageElement' : 'HTMLCanvasElement']();
  const selection = { id, geometry: { forward: -0, imageScale: 0.375, pivotX: -3.25, pivotY: 7.5 },
    source, width: 48, height: 48 };
  const commitment = { source, state: 'ready', revision: 'authored-accessory-content-1' };
  f.snapshot.ownAccessory = id; f.snapshot.ownAccessorySelection = selection;
  f.readiness.push(commitment);
  return { selection, commitment, source };
}

test('accessory opt-in preserves legacy no-selection recipes and only adds explicit numeric null', () => {
  const f = fixture(); const g = fixture('accessory');
  // The absent legacy selection is not probed for any source metadata.
  Object.defineProperty(g.snapshot, 'unusedAccessoryCatalog', { get() { assert.fail('catalog lookup'); } });
  f.adapter.beginOperation(); g.adapter.beginOperation();
  for (const skin of [0, 24, 27, 40, 41]) {
    const legacy = f.adapter.resolveAppearance({ skin });
    assert.equal(Object.hasOwn(legacy, 'accessory'), false);
    assert.deepEqual(g.adapter.resolveAppearance({ skin }), { ...legacy, accessory: null });
    assert.deepEqual(g.adapter.resolveRecipe({ skin }).recipe.supportedFeatures,
      f.adapter.resolveRecipe({ skin }).recipe.supportedFeatures);
    assert.equal(g.adapter.resolveRecipe({ skin }).recipe.attachment, null);
  }
  assert.equal(f.randomCalls, 0); assert.equal(g.randomCalls, 0);
  f.adapter.endOperation(); g.adapter.endOperation();
  for (const appearanceMode of [null, '', 'automatic', true]) {
    assert.throws(() => createStockSkinAdapter({ appearanceMode }), /appearance mode/);
  }
});

test('explicit own alone binds ready numeric geometry and a coherent full source crop', () => {
  for (const image of [true, false]) for (const skin of [0, 24, 40, 41]) {
    const f = fixture('accessory'); const { selection, source } = selectAccessory(f, { image });
    f.adapter.beginOperation();
    for (const own of [true, false, undefined]) {
      const request = { skin, cosmetic: 71, ...(own === undefined ? {} : { own }) };
      const appearance = f.adapter.resolveAppearance(request);
      const { recipe, status } = f.adapter.resolveRecipe(request);
      assert.equal(status, 'ready');
      if (own === true) {
        assert.deepEqual(appearance.accessory, selection.geometry);
        assert.notEqual(appearance.accessory, selection.geometry);
        assert(Object.isFrozen(appearance.accessory)); assert(Object.is(appearance.accessory.forward, -0));
        const use = recipe.attachment;
        assert.equal(use.kind, 'static-head-image'); assert.equal(use.asset.source, source);
        assert.equal(use.asset.kind, image ? 'image' : 'canvas');
        assert.equal(use.asset.revision, 'authored-accessory-content-1');
        assert.equal(use.sourceMode, 'crop'); assert.deepEqual(use.sourceRect, [+0, +0, 48, 48]);
        assert(Object.is(use.sourceRect[0], +0) && Object.is(use.sourceRect[1], +0));
        assert.deepEqual({ forward: use.forward, imageScale: use.scale, pivotX: use.pivotX, pivotY: use.pivotY }, appearance.accessory);
        assert.equal(use.anchor, 'head'); assert.equal(use.opacity, 1);
        assert(recipe.supportedFeatures.includes('head-attachment'));
      } else {
        assert.equal(appearance.accessory, null); assert.equal(recipe.attachment, null);
        assert(!recipe.supportedFeatures.includes('head-attachment'));
      }
    }
    assert.equal(f.adapter.resolveRecipe({ skin, own: true, cosmetic: 0 }).recipe.attachment.asset.source, source);
    assert.equal(f.adapter.resolveRecipe({ skin, own: true, attachmentId: 71 }).status, 'unsupported');
    assert.equal(f.randomCalls, 0); f.adapter.endOperation();
  }
});

test('selected SingleImage rejects while accepted custom suppression resolves eligibility first', () => {
  const f = fixture('accessory'); selectAccessory(f);
  f.snapshot.nicknamePaletteRgb = Array.from({ length: 42 }, () => [1, 2, 3]);
  f.adapter.beginOperation();
  for (const method of ['resolveAppearance', 'resolveRecipe']) {
    assert.throws(() => f.adapter[method]({ skin: 27, own: true }), error => error.status === 'unsupported');
  }
  assert.equal(f.randomCalls, 0);
  assert.equal(f.adapter.resolveAppearance({ skin: 27, own: false }).accessory, null);
  assert.equal(f.adapter.resolveRecipe({ skin: 27, own: false }).recipe.eyes.kind, 'single-image');
  const request = { skin: 27, own: true, customBytes: custom([1, 25]) };
  assert.equal(f.adapter.resolveAppearance(request).face.kind, 'paired');
  assert.equal(f.adapter.resolveRecipe(request).recipe.attachment.kind, 'static-head-image');
  f.adapter.endOperation();
});

test('selected source must be ready before operation metadata or tint randomness can publish', () => {
  for (const change of [
    (f, a) => { a.selection.source = null; },
    (f, a) => { a.source.complete = false; },
    (f, a) => { a.source.naturalWidth = 0; },
    (f, a) => { a.selection.width = 0; },
    (f, a) => { a.commitment.state = 'pending'; },
    f => { f.readiness.pop(); },
    f => { delete f.snapshot.ownAccessorySelection; },
  ]) {
    const f = fixture('accessory'); const a = selectAccessory(f); change(f, a);
    assert.throws(() => f.adapter.beginOperation(), error => error.status === 'pending');
    assert.throws(() => f.adapter.resolveAppearance({ skin: 0, own: true }), /operation required/);
    assert.throws(() => f.adapter.endOperation(), /operation required/); assert.equal(f.randomCalls, 0);
  }
  const f = fixture('accessory'); const a = selectAccessory(f); a.source.complete = false;
  assert.throws(() => f.adapter.beginOperation(), error => error.status === 'pending');
  a.source.complete = true; f.adapter.beginOperation();
  assert(f.adapter.resolveAppearance({ skin: 0, own: true }).accessory); f.adapter.endOperation();
});

test('malformed selections reject as unsupported with no accessor calls or silent null', () => {
  for (const change of [
    f => { f.snapshot.ownAccessory = -1; },
    (f, a) => { a.selection.id++; },
    (f, a) => { a.selection.extra = 1; },
    (f, a) => { a.selection.geometry.extra = 1; },
    (f, a) => { a.selection.geometry.forward = NaN; },
    (f, a) => { a.selection.geometry.imageScale = 0; },
    (f, a) => { a.selection.geometry.pivotX = 65536; },
    (f, a) => { a.selection.width = 47; },
    (f, a) => { a.selection.source = {}; },
    (f, a) => { a.commitment.state = 'unsupported'; },
    (f, a) => { a.selection.geometry = Promise.resolve(a.selection.geometry); },
    (f, a) => { Object.defineProperty(a.selection, 'source', { get() { assert.fail('accessor called'); } }); },
    (f, a) => { Object.defineProperty(a.selection.geometry, 'forward', { get() { assert.fail('accessor called'); } }); },
    (f, a) => { const geometry = a.selection.geometry; delete a.selection.geometry; Object.setPrototypeOf(a.selection, { geometry }); },
  ]) {
    const f = fixture('accessory'); const a = selectAccessory(f); change(f, a);
    assert.throws(() => f.adapter.beginOperation(), error => error.status === 'unsupported');
    assert.equal(f.randomCalls, 0);
  }
  const f = fixture(); selectAccessory(f);
  assert.throws(() => f.adapter.beginOperation(), error => error.status === 'unsupported' && /face mode/.test(error.message));
});

test('selected ID, source identity, extent and geometry stay fixed across successful operations', () => {
  for (const change of [
    (f, a) => { f.snapshot.ownAccessory = ++a.selection.id; },
    (f, a) => { a.selection.geometry.forward = +0; },
    (f, a) => { a.selection.geometry.pivotY++; },
    (f, a) => { a.selection.source = new f.realm.HTMLImageElement(); f.readiness.push({ ...a.commitment, source: a.selection.source }); },
    (f, a) => { a.selection.width = ++a.source.naturalWidth; },
    f => { f.snapshot.ownAccessory = -1; f.snapshot.ownAccessorySelection = null; },
  ]) {
    const f = fixture('accessory'); const a = selectAccessory(f);
    f.resolve({ skin: 0, own: true }); change(f, a); f.snapshot.revision = 'new-operation';
    assert.throws(() => f.adapter.beginOperation(), /selection changed/);
    assert.throws(() => f.adapter.resolveAppearance({ skin: 0, own: true }), /operation required/);
  }
  const f = fixture('accessory'); f.resolve({ skin: 0 }); selectAccessory(f); f.snapshot.revision = 'selected';
  assert.throws(() => f.adapter.beginOperation(), /selection changed/);
});

test('held selections are copied while content revisions may advance with capture revisions', () => {
  const f = fixture('accessory'); const a = selectAccessory(f);
  f.adapter.beginOperation(); const before = f.adapter.resolveAppearance({ skin: 40, own: true });
  a.selection.geometry.forward = 15;
  assert.deepEqual(f.adapter.resolveAppearance({ skin: 40, own: true }).accessory, before.accessory);
  assert(Object.is(f.adapter.resolveRecipe({ skin: 40, own: true }).recipe.attachment.forward, -0));
  a.selection.geometry.forward = -0; f.adapter.endOperation();
  a.commitment.revision = 'content-2';
  assert.throws(() => f.adapter.beginOperation(), /without a new revision/);
  f.snapshot.revision = 'capture-2';
  const after = f.resolve({ skin: 40, own: true });
  assert.equal(after.recipe.attachment.asset.revision, 'content-2');
  a.commitment.revision = -0; f.snapshot.revision = 'capture-3';
  assert(Object.is(f.resolve({ skin: 0, own: true }).recipe.attachment.asset.revision, -0));
  a.commitment.revision = +0;
  assert.throws(() => f.adapter.beginOperation(), /without a new revision/);
  f.snapshot.revision = 'capture-4';
  assert(Object.is(f.resolve({ skin: 0, own: true }).recipe.attachment.asset.revision, +0));
  f.adapter.beginOperation(); a.source.complete = false;
  assert.throws(() => f.adapter.resolveAppearance({ skin: 0, own: true }), error => error.status === 'pending');
  assert.throws(() => f.adapter.resolveRecipe({ skin: 0, own: true }), error => error.status === 'pending');
  f.adapter.endOperation(); a.source.complete = true;
  assert.equal(f.resolve({ skin: 0, own: true }).status, 'ready');
});

test('selected aliases share the existing catalog and invalid own data rejects before tint', () => {
  const f = fixture('accessory'); selectAccessory(f, { source: f.host.per_color_imgs[0].kmcs[0] });
  // Alias commitments must retain the body's existing content revision.
  f.readiness.pop(); f.adapter.beginOperation();
  const recipe = f.adapter.resolveRecipe({ skin: 0, own: true }).recipe;
  assert.equal(recipe.attachment.asset, recipe.palettes[0].variants[0].asset);
  for (const own of [undefined, null, 1, 'true']) for (const method of ['resolveAppearance', 'resolveRecipe']) {
    assert.throws(() => f.adapter[method]({ skin: 0, own }), /own/);
  }
  for (const method of ['resolveAppearance', 'resolveRecipe']) {
    assert.throws(() => f.adapter[method]({ skin: 0, get own() { assert.fail('own getter'); } }), /Accessor/);
    assert.equal(f.adapter[method]({ skin: 0, own: false })[method === 'resolveRecipe' ? 'status' : 'accessory'],
      method === 'resolveRecipe' ? 'ready' : null);
  }
  assert.equal(f.randomCalls, 0); f.adapter.endOperation();
});

test('selected readiness rechecks before publishing metadata after caller-owned tint randomness', () => {
  const f = fixture('accessory'); const a = selectAccessory(f);
  f.snapshot.nicknamePaletteRgb = Array.from({ length: 42 }, () => [1, 2, 3]);
  f.adapter.beginOperation();
  f.random = () => { a.source.complete = false; return 0.5; };
  assert.throws(() => f.adapter.resolveAppearance({ skin: 0, own: true }), error => error.status === 'pending');
  f.adapter.endOperation(); a.source.complete = true; f.random = () => 0.5;
  f.adapter.beginOperation(); assert(f.adapter.resolveAppearance({ skin: 0, own: true }).accessory); f.adapter.endOperation();
});

test('stock mouth face borrows two whole canvas roles and installs numeric geometry without readiness', () => {
  const f = fixture(); const mouth = f.readiness.find(entry => entry.source === f.host.jmou);
  mouth.state = 'pending'; f.adapter.beginOperation();
  const appearance = f.adapter.resolveAppearance({ skin: 40 });
  assert.deepEqual(appearance, { face: { kind: 'mouth-face', geometry: { pupilTravel: 2.3 } }, antenna: null });
  assert(Object.isFrozen(appearance.face)); assert(Object.isFrozen(appearance.face.geometry));
  assert.equal(f.adapter.resolveRecipe({ skin: 40 }).status, 'pending');
  mouth.state = 'ready'; mouth.revision = 'painted'; f.snapshot.revision = 'paint-complete';
  assert.equal(f.adapter.resolveRecipe({ skin: 40 }).status, 'pending', 'held commitment remains pending');
  assert.equal(f.adapter.resolveRecipe({ skin: 0 }).status, 'ready');
  f.adapter.endOperation();
  const { recipe, status } = f.resolve({ skin: 40 }); assert.equal(status, 'ready');
  assert.equal(recipe.eyes.kind, 'mouth-face'); assert.deepEqual(recipe.eyes.geometry, appearance.face.geometry);
  for (const [key, slot] of [['eyeMarks', 'ecmc'], ['mouth', 'jmou']]) {
    const use = recipe.eyes[key]; assert.equal(use.asset.source, f.host[slot]); assert.equal(use.sourceMode, 'whole');
    assert.deepEqual(use.sourceRect, [0, 0, f.host[slot].width, f.host[slot].height]);
    assert.equal(use.asset.revision, f.readiness.find(entry => entry.source === f.host[slot]).revision);
  }
  assert.equal(recipe.palettes[0].variants[0].asset.source, f.host.per_color_imgs[26].kmcs[0]);
  assert.equal(recipe.antenna, undefined); assert.equal(recipe.faceDecoration, undefined);
  assert.deepEqual(recipe.supportedFeatures, ['body-palettes', 'mouth-face', 'outline', 'shadow', 'death-highlight', 'standard-body-style']);
  assert.equal(f.randomCalls, 0);
});

test('stock mouth sources require independent ready commitments, preserve unsupported precedence and custom suppression', () => {
  for (const slot of ['ecmc', 'jmou']) {
    const f = fixture(); const entry = f.readiness.find(entry => entry.source === f.host[slot]);
    entry.state = 'pending'; assert.equal(f.resolve({ skin: 40 }).status, 'pending');
    for (const customBytes of [new Uint8Array(), custom([0, 26]), custom([2, 40])]) {
      assert.equal(f.resolve({ skin: 40, customBytes }).status, 'pending');
    }
    const accepted = f.resolve({ skin: 40, customBytes: custom([1, 26]) });
    assert.equal(accepted.status, 'ready'); assert.equal(accepted.recipe.eyes.kind, 'standard');
    entry.state = 'unsupported'; f.snapshot.revision = 'unsupported';
    assert.equal(f.resolve({ skin: 40 }).status, 'unsupported');
    f.host[slot] = null; f.snapshot.revision = 'missing';
    assert.equal(f.resolve({ skin: 40 }).status, 'pending');
    assert.equal(f.resolve({ skin: 40, attachmentId: 1 }).status, 'unsupported');
  }
  const f = fixture(); f.readiness.splice(f.readiness.findIndex(entry => entry.source === f.host.jmou), 1);
  assert.equal(f.resolve({ skin: 40 }).status, 'pending');
  const g = fixture(); g.readiness.find(entry => entry.source === g.host.ecmc).state = 'pending';
  g.readiness.find(entry => entry.source === g.host.jmou).state = 'unsupported';
  assert.equal(g.resolve({ skin: 40 }).status, 'unsupported');
});

test('mouth slots share the held catalog, content tokens, replacement and shape drift checks with old source paths', () => {
  const f = fixture(); f.host.ecmc = f.host.per_color_imgs[26].kmcs[0];
  f.host.jmou = f.host.komc; f.host.jmou.width = 79; f.host.jmou.height = 130;
  const commitment = f.readiness.find(entry => entry.source === f.host.jmou); commitment.revision = -0;
  f.adapter.beginOperation();
  const before = f.adapter.resolveRecipe({ skin: 40 });
  assert.equal(before.recipe.eyes.eyeMarks.asset, before.recipe.palettes[0].variants[0].asset);
  assert.equal(before.recipe.eyes.mouth.asset, before.recipe.effects[0].asset);
  assert(Object.is(before.recipe.eyes.mouth.asset.revision, -0));
  const replacement = new f.realm.HTMLCanvasElement(); replacement.width = 79; replacement.height = 130;
  f.host.jmou = replacement; f.snapshot.revision = 'replaced';
  f.readiness.push({ source: replacement, state: 'ready', revision: 'new-mouth' });
  assert.equal(f.adapter.resolveRecipe({ skin: 40 }).recipe.eyes.mouth.asset.source, before.recipe.eyes.mouth.asset.source);
  f.adapter.endOperation();
  assert.equal(f.resolve({ skin: 40 }).recipe.eyes.mouth.asset.source, replacement);
  const entry = f.readiness.at(-1); entry.revision = 'same-size-paint';
  assert.throws(() => f.adapter.beginOperation(), /without a new revision/);
  f.snapshot.revision = 'paint-revised';
  assert.equal(f.resolve({ skin: 40 }).recipe.eyes.mouth.asset.revision, 'same-size-paint');
  f.adapter.beginOperation(); replacement.width = 80;
  assert.throws(() => f.adapter.resolveRecipe({ skin: 40 }), /during operation/); f.adapter.endOperation();
  f.snapshot.revision = 'shape-changed'; assert.throws(() => f.adapter.beginOperation(), /mouth canvas/);
  for (const slot of ['ecmc', 'jmou']) {
    const g = fixture(); const image = new g.realm.HTMLImageElement();
    image.naturalWidth = g.host[slot].width; image.naturalHeight = g.host[slot].height;
    g.host[slot] = image; assert.throws(() => g.adapter.beginOperation(), /mouth canvas/);
    const h = fixture(); let reads = 0;
    Object.defineProperty(h.host, slot, { get() { reads++; return null; } });
    assert.throws(() => h.adapter.beginOperation(), /Accessor/); assert.equal(reads, 0);
  }
});

test('ordinary coverage spans every requested byte and custom suppression precedes exclusions', () => {
  const f = fixture();
  f.adapter.beginOperation();
  for (let skin = 0; skin < 256; skin++) {
    const rule = resolveStockSkin({ skin, cosmetic: skin });
    assert.equal(rule.runs[0].palette, rule.basePalette);
    const result = f.adapter.resolveRecipe({ skin, cosmetic: skin });
    assert.equal(result.status, 'ready', `skin ${skin}`);
    const appearance = f.adapter.resolveAppearance({ skin });
    if (skin === 27 || skin === 40) {
      assert.equal(appearance.face.kind, skin === 27 ? 'single-image' : 'mouth-face');
      assert.deepEqual(appearance.face.geometry, result.recipe.eyes.geometry);
      assert.equal(appearance.face.eyes, undefined);
      assert.equal(appearance.face.decoration, undefined);
    } else {
      assert.equal(appearance.face.kind, 'paired');
      assert.deepEqual(appearance.face.eyes, result.recipe.eyes);
      assert.deepEqual(appearance.face.decoration, result.recipe.faceDecoration
        ? { kind: 'paired-side-images', geometry: result.recipe.faceDecoration.geometry } : { kind: 'none' });
    }
    assert.deepEqual(appearance.antenna, result.recipe.antenna?.geometry ?? null);
    if (skin < 9 || skin > 65) assert.deepEqual(expand(rule), [skin % 9]);
    const accepted = f.adapter.resolveRecipe({ skin, customBytes: custom([2, 0], [1, 27]), cosmetic: skin });
    assert.equal(accepted.status, 'ready');
    assert.equal(accepted.recipe.custom, true);
    assert.equal(accepted.recipe.variantMode, 'first');
    assert.equal(accepted.recipe.variantPeriod, 1);
    assert.equal(accepted.recipe.bodyStyle.detailedSegments, false);
    assert.equal(accepted.recipe.faceDecoration, undefined);
    assert.equal(accepted.recipe.antenna, undefined);
    assert.equal(accepted.recipe.eyes.distance, 6);
    assert.equal(accepted.recipe.eyes.pupilTravel, 2.3);
    assert.equal(f.adapter.resolveAppearance({ skin, customBytes: custom([1, 27]) }).face.kind, 'paired');
  }
  assert.equal(f.reads, 1); assert.equal(f.randomCalls, 0);
  f.adapter.endOperation();
});

test('ordered rule examples preserve head origin, repeated end runs and full cycle lengths', () => {
  // Compact authored review witnesses, not imported reference artifacts.
  const witnesses = [
    [9, 20, [7, 9, 7, 9], [10, 10, 10]], [10, 15, [9, 9, 9, 9, 9, 1], [7, 7, 7]],
    [11, 15, [11, 11, 11, 11, 11, 7], [12, 12, 12]], [12, 15, [7, 7, 7, 7, 7, 9], [13, 13, 13]],
    [13, 15, [14, 14], [7]], [14, 14, [9, 9], [7]], [15, 9, [0, 1, 2], [6, 7, 8]],
    [16, 14, [15], [4]], [17, 14, [9], [16]], [18, 14, [7], [9]], [19, 1, [9], [9]],
    [20, 10, [3], [0]], [21, 26, [3], [18]], [22, 21, [5], [13]], [23, 21, [16], [7]],
    [24, 18, [23], [18]], [25, 21, [21], [22]], [26, 1, [24], [24]], [27, 1, [25], [25]],
    [28, 21, [18], [7]], [29, 10, [11, 11, 4, 11], [4, 11, 11]],
    [30, 8, [10, 10, 19, 20], [10, 20, 19]], [31, 2, [10], [10]], [32, 2, [20], [20]],
    [33, 3, [12], [11]], [34, 18, [7, 7, 9, 13], [16, 16, 9]], [35, 8, [7, 7, 9], [6, 9, 9]],
    [36, 8, [16, 16, 9], [15, 9, 9]], [37, 1, [22], [22]], [38, 1, [18], [18]],
    [39, 1, [23], [23]], [40, 1, [26], [26]], [41, 1, [27], [27]], [42, 32, [2], [7]],
    [43, 1, [28], [28]], [44, 1, [29], [29]], [45, 14, [7, 7, 7, 9], [7, 7, 7]],
    [46, 1, [7], [7]], [47, 24, [16, 16, 16, 18], [16, 16, 16]], [48, 1, [7], [7]],
    [49, 15, [23], [9, 23, 23]], [50, 30, [18], [7]], [51, 13, [7, 7, 7, 9], [16, 9, 9]],
    [52, 18, [7], [7]], [53, 1, [30], [30]], [54, 1, [31], [31]], [55, 1, [32], [32]],
    [56, 1, [33], [33]], [57, 1, [34], [34]], [58, 1, [35], [35]], [59, 1, [18], [18]],
    [60, 1, [36], [36]], [61, 36, [30], [34]], [62, 10, [17], [39]], [63, 6, [7], [11]],
    [64, 4, [16], [11]], [65, 8, [4], [9]],
  ];
  assert.equal(witnesses.length, 57);
  for (const [skin, length, start, end] of witnesses) {
    const sequence = expand(resolveStockSkin({ skin }));
    assert.equal(sequence.length, length, `length ${skin}`);
    assert.deepEqual(sequence.slice(0, start.length), start, `head ${skin}`);
    assert.deepEqual(sequence.slice(-end.length), end, `tail ${skin}`);
  }
  assert.deepEqual(expand(resolveStockSkin({ skin: 21 })).slice(13, 20), [20, 19, 20, 19, 20, 19, 20]);
  assert.deepEqual(resolveStockSkin({ skin: 61 }).runs.map(run => run.palette), [30, 35, 33, 31, 32, 34]);
});

test('custom byte lengths, arbitrary headers, odd pairs, rejection and maximal compression', () => {
  for (const length of [0, 8, 9]) assert.equal(resolveStockSkin({ skin: 24, customBytes: new Uint8Array(length) }).custom, false);
  assert.deepEqual(resolveStockSkin({ skin: 24, customBytes: custom([1, 0]) }).runs, [{ palette: 0, count: 1 }]);
  const odd = Uint8Array.from([...custom([2, 5]), 255]);
  assert.deepEqual(resolveStockSkin({ skin: 27, customBytes: odd }).runs, [{ palette: 5, count: 2 }]);
  assert.deepEqual(resolveStockSkin({ skin: 0, customBytes: custom([1, 5], [9, 36], [0, 7], [2, 5], [3, 38], [4, 40], [2, 41]) }).runs,
    [{ palette: 5, count: 3 }, { palette: 41, count: 2 }]);
  for (const palette of [36, 38, 40, 42, 255]) assert.equal(resolveStockSkin({ skin: 24, customBytes: custom([255, palette]) }).antenna.geometry.nodes, 8);
  const empty = resolveStockSkin({ skin: 27, customBytes: custom([0, 7]) });
  assert.deepEqual(empty.unsupportedFeatures, []); assert.equal(empty.eyes.kind, 'single-image');
  const maximum = new Uint8Array(255);
  for (let i = 8; i < 254; i += 2) { maximum[i] = 255; maximum[i + 1] = 0; }
  assert.deepEqual(resolveStockSkin({ skin: 60, customBytes: maximum }).runs, [{ palette: 0, count: 31365 }]);
  const f = fixture(); assert.equal(f.resolve({ skin: 60, customBytes: maximum }).status, 'ready');
  assert.throws(() => resolveStockSkin({ skin: 0, customBytes: new Uint8Array(256) }), /length/);
  assert.throws(() => resolveStockSkin({ skin: 0, customBytes: [] }), /Uint8Array/);
});

test('42 host palette families validate and all normally selectable palettes borrow exact whole sources', () => {
  const f = fixture();
  const seen = new Set();
  f.adapter.beginOperation();
  for (let skin = 0; skin <= 65; skin++) {
    const rule = resolveStockSkin({ skin });
    const { recipe } = f.adapter.resolveRecipe({ skin });
    rule.runs.forEach((run, i) => {
      const local = recipe.runs[i].palette;
      const family = recipe.palettes[local];
      seen.add(run.palette);
      assert.equal(family.variants.length, run.palette === 36 ? 60 : 7);
      family.variants.forEach((use, index) => {
        assert.equal(use.asset.source, f.host.per_color_imgs[run.palette].kmcs[index]);
        assert.equal(use.sourceMode, 'whole');
      });
      assert.equal(family.boostGlow.asset.source, f.host.per_color_imgs[run.palette].kfmc);
    });
    assert.equal(recipe.variantPeriod, rule.basePalette === 36 ? 60 : 7);
    assert.equal(recipe.variantMode, rule.basePalette === 36 ? 'cycle' : 'ping-pong');
    for (const [index, slot] of ['komc', 'ksmc', 'kdmc'].entries()) {
      assert.equal(recipe.effects[index].asset.source, f.host[slot]);
      assert.equal(recipe.effects[index].opacity, 1);
      assert.equal(recipe.effects[index].sourceMode, 'whole');
    }
  }
  for (const palette of [26, 37, 39, 41]) {
    const { recipe } = f.adapter.resolveRecipe({ skin: 0, customBytes: custom([1, palette]) });
    assert.equal(recipe.palettes[0].variants[0].asset.source, f.host.per_color_imgs[palette].kmcs[0]); seen.add(palette);
  }
  const dense = f.adapter.resolveRecipe({ skin: 60 }).recipe;
  for (const [key, palette] of [['headFade', 37], ['tailFade', 38]]) {
    const fade = dense.bodyStyle[key]; seen.add(palette);
    assert.equal(fade.length, 30);
    assert.equal(dense.palettes[fade.palette].variants[0].asset.source, f.host.per_color_imgs[palette].kmcs[0]);
    assert.equal(dense.palettes[fade.palette].boostGlow, undefined);
  }
  assert.equal(dense.bodyStyle.detailedSegments, true);
  assert.equal(seen.size, 41);
  assert.equal(seen.has(40), false); // Palette 40 belongs only to the excluded builder policy.
  f.adapter.endOperation();
  f.host.per_color_imgs[40].kmcs.pop();
  assert.throws(() => f.adapter.beginOperation(), /variant family/);
});

test('all ordinary antennas, paired overrides and fractional offset bit witnesses are represented', () => {
  const cases = [[24, 8, 'acbulb', false, true, 'c024000000000000'], [25, 9, 'cdbulb', true, false, 'c014000000000000'],
    [37, 9, 'kwkbulb', true, true, 'c043800000000000'], [39, 9, 'pwdbulb', true, true, 'c042000000000000'],
    [42, 9, 'playbulb', true, true, 'c03d000000000000'], [45, 9, 'leafbulb', true, true, 'c0400e147ae147ae'],
    [46, 9, 'swissbulb', true, true, 'c03fc7ae147ae148'], [47, 9, 'moldovabulb', true, true, 'c04119999999999a'],
    [48, 9, 'vietnambulb', true, true, 'c03f733333333333'], [49, 11, 'argentinabulb', true, true, 'c0408ccccccccccd'],
    [59, 11, 'movbulb', true, true, 'c044800000000000'], [62, 9, 'bonkbulb', true, true, 'c03d000000000000']];
  const f = fixture();
  for (const [skin, nodes, slot, rotate, repeat, bits] of cases) {
    const recipe = f.resolve({ skin }).recipe;
    const chain = recipe.antenna.geometry;
    assert.equal(chain.nodes, nodes); assert.equal(chain.rotateBulb, rotate); assert.equal(chain.repeatedInnerStrokes, repeat);
    assert.equal(recipe.antenna.image.asset.source, f.host[slot]); assert.equal(recipe.antenna.image.sourceMode, 'whole');
    const bytes = Buffer.alloc(8); bytes.writeDoubleBE(chain.bulb.offsetX); assert.equal(bytes.toString('hex'), bits);
    assert.equal(recipe.eyes.eyeOpacity, skin === 24 ? .75 : 1);
  }
  const wide = f.resolve({ skin: 41 }).recipe;
  assert.deepEqual([wide.eyes.distance, wide.eyes.separation, wide.eyes.radius, wide.eyes.pupilRadius, wide.eyes.pupilTravel, wide.eyes.outlineWidth], [34, 14, 8, 4.5, 3, 3]);
  assert.equal(wide.eyes.angleSmoothing, .12);
  assert.equal(wide.faceDecoration.image.asset.source, f.host.sest);
  assert.deepEqual(wide.faceDecoration.geometry, { forward: 13, lateral: 6, lateralBias: .5, rotationOffset: .4,
    imageScale: .25, pivotX: 28, pivotY: 44, width: 105, height: 88 });
  for (const [skin, color] of [[25, 0xff5609], [44, 0xd4d4d4], [63, 0], [64, 0xffff80]]) assert.equal(f.resolve({ skin }).recipe.eyes.eyeColor, color);
  assert.equal(f.resolve({ skin: 63 }).recipe.eyes.pupilColor, 0xcccccc);
  assert.equal(f.resolve({ skin: 63 }).recipe.eyes.pupilRadius, 2.5);
  assert(Object.is(f.resolve({ skin: 0 }).recipe.bodyStyle.swell, +0));
});

test('stock single-image face borrows both exact objects with fixed crops and independent destination geometry', () => {
  const f = fixture();
  f.host.jsebi.width = 80; f.host.jsebi.height = 96;
  f.host.jsepi.width = 60; f.host.jsepi.height = 72;
  f.adapter.beginOperation();
  const appearance = f.adapter.resolveAppearance({ skin: 27, x: -0, y: -0, cosmetic: 0 });
  assert.deepEqual(appearance, { face: { kind: 'single-image', geometry: { baseSize: 29, pupilSize: 14, pupilTravel: 4 } }, antenna: null });
  const result = f.adapter.resolveRecipe({ skin: 27, cosmetic: 255 });
  assert.equal(result.status, 'ready');
  const { recipe } = result;
  assert.equal(recipe.eyes.kind, 'single-image');
  assert.deepEqual(recipe.eyes.geometry, appearance.face.geometry);
  assert.equal(recipe.bodyStyle.swell, .06);
  assert.equal(recipe.bodyStyle.detailedSegments, false);
  assert.equal(recipe.palettes[recipe.basePalette].variants[0].asset.source, f.host.per_color_imgs[25].kmcs[0]);
  assert.equal(recipe.faceDecoration, undefined); assert.equal(recipe.antenna, undefined);
  assert(recipe.supportedFeatures.includes('single-image-eye'));
  assert(!recipe.supportedFeatures.includes('standard-eyes'));
  for (const [key, source, crop] of [['baseImage', f.host.jsebi, [0, 0, 64, 64]], ['pupilImage', f.host.jsepi, [0, 0, 48, 48]]]) {
    assert.equal(recipe.eyes[key].asset.source, source);
    assert.deepEqual(recipe.eyes[key].sourceRect, crop);
    assert.equal(recipe.eyes[key].sourceMode, 'crop');
    assert(Object.isFrozen(recipe.eyes[key])); assert(Object.isFrozen(recipe.eyes[key].sourceRect));
    assert(!Object.isFrozen(source));
  }
  assert(Object.isFrozen(appearance.face)); assert(Object.isFrozen(appearance.face.geometry));
  assert.equal(f.randomCalls, 0);
  f.adapter.endOperation();
});

test('single-image appearance is readiness independent while both face sources need explicit ready commitments', () => {
  for (const slot of ['jsebi', 'jsepi']) {
    const f = fixture(); const entry = f.readiness.find(entry => entry.source === f.host[slot]);
    entry.state = 'pending';
    f.adapter.beginOperation();
    assert.equal(f.adapter.resolveAppearance({ skin: 27 }).face.geometry.pupilTravel, 4);
    assert.equal(f.adapter.resolveRecipe({ skin: 27 }).status, 'pending');
    assert.equal(f.adapter.resolveRecipe({ skin: 0 }).status, 'ready');
    const accepted = f.adapter.resolveRecipe({ skin: 27, customBytes: custom([1, 25]) });
    assert.equal(accepted.status, 'ready'); assert.equal(accepted.recipe.eyes.kind, 'standard');
    assert.equal(accepted.recipe.eyes.pupilTravel, 2.3); assert(Object.is(accepted.recipe.bodyStyle.swell, +0));
    assert.equal(f.adapter.resolveAppearance({ skin: 27, customBytes: custom([1, 25]) }).face.kind, 'paired');
    f.adapter.endOperation();
    entry.state = 'ready'; f.snapshot.revision = `${slot}-committed`;
    assert.equal(f.resolve({ skin: 27 }).status, 'ready');
  }
  const f = fixture(); f.host.jsebi = null; f.host.jsepi = null;
  assert.equal(f.resolve({ skin: 27 }).status, 'pending');
  const g = fixture();
  g.readiness.find(entry => entry.source === g.host.jsebi).state = 'pending';
  g.readiness.find(entry => entry.source === g.host.jsepi).state = 'unsupported';
  assert.equal(g.resolve({ skin: 27 }).status, 'unsupported');
  const h = fixture(); h.host.jsebi = new h.realm.HTMLImageElement();
  h.host.jsebi.naturalWidth = h.host.jsebi.naturalHeight = 64;
  assert.equal(h.resolve({ skin: 27 }).status, 'pending'); // Native complete is not a commitment.
});

test('single-image aliases, changed source slots/revisions and crop validation use existing coherence rules', () => {
  const f = fixture(); f.host.jsepi = f.host.jsebi;
  f.snapshot.revision = -0;
  const result = f.resolve({ skin: 27 });
  assert(Object.is(result.revision, -0));
  assert.equal(result.recipe.eyes.baseImage.asset, result.recipe.eyes.pupilImage.asset);
  assert.notDeepEqual(result.recipe.eyes.baseImage.sourceRect, result.recipe.eyes.pupilImage.sourceRect);
  const replacement = new f.realm.HTMLCanvasElement(); replacement.width = replacement.height = 64;
  f.host.jsepi = replacement; f.readiness.push({ source: replacement, state: 'ready', revision: 'new-pupil' });
  assert.throws(() => f.adapter.beginOperation(), /without a new revision/);
  f.snapshot.revision = +0;
  assert.equal(f.resolve({ skin: 27 }).recipe.eyes.pupilImage.asset.source, replacement);
  const g = fixture(); g.host.jsebi.width = 63;
  assert.throws(() => g.resolve({ skin: 27 }), /sourceRect exceeds/);
  assert.throws(() => g.adapter.resolveAppearance({ skin: 27 }), /operation required/);
});

test('readiness commitments gate sized canvases and native-ready images without paint inference', () => {
  const f = fixture();
  f.readiness.find(entry => entry.source === f.host.kwkbulb).state = 'pending';
  f.adapter.beginOperation();
  assert.equal(f.adapter.resolveAppearance({ skin: 37 }).antenna.nodes, 9);
  assert.equal(f.adapter.resolveRecipe({ skin: 37 }).status, 'pending');
  assert.equal(f.adapter.resolveRecipe({ skin: 0 }).status, 'ready');
  f.readiness.find(entry => entry.source === f.host.kwkbulb).state = 'ready';
  assert.equal(f.adapter.resolveRecipe({ skin: 37 }).status, 'pending');
  f.adapter.endOperation();
  f.snapshot.revision = 'paint-committed';
  assert.equal(f.resolve({ skin: 37 }).status, 'ready');
  f.host.kwkbulb = new f.realm.HTMLImageElement();
  f.snapshot.revision = 'new-image';
  assert.equal(f.resolve({ skin: 37 }).status, 'pending');
  f.readiness.push({ source: f.host.kwkbulb, state: 'ready', revision: 'new-bulb-image' });
  f.host.kwkbulb.complete = false;
  f.snapshot.revision = 'image-loading';
  assert.equal(f.resolve({ skin: 37 }).status, 'pending');
  f.host.kwkbulb.complete = true;
  f.snapshot.revision = 'image-ready';
  assert.equal(f.resolve({ skin: 37 }).status, 'ready');
  f.host.sest = null;
  f.snapshot.revision = 'missing-side';
  assert.equal(f.resolve({ skin: 41 }).status, 'pending');
  f.readiness.find(entry => entry.source === f.host.komc).state = 'unsupported';
  f.snapshot.revision = 'unsupported-effect';
  assert.equal(f.resolve({ skin: 41 }).status, 'unsupported');
  const g = fixture();
  g.readiness.find(entry => entry.source === g.host.per_color_imgs[0].kmcs[1]).state = 'pending';
  assert.equal(g.resolve({ skin: 0 }).status, 'pending');
  const accepted = g.resolve({ skin: 0, customBytes: custom([1, 0]) });
  assert.equal(accepted.status, 'ready');
  assert.equal(accepted.recipe.palettes[0].variants.length, 1);
});

test('operation copies source slots, aliases and policy; replacement and revisions appear only next operation', () => {
  const f = fixture();
  f.host.per_color_imgs[1].kmcs[0] = f.host.per_color_imgs[0].kmcs[0];
  f.snapshot.revision = -0;
  f.adapter.beginOperation();
  const request = { skin: 0, customBytes: custom([1, 0], [1, 1]), x: -0, y: -0, cosmetic: 255 };
  const before = f.adapter.resolveRecipe(request);
  assert(Object.is(before.revision, -0));
  assert.equal(before.recipe.palettes[0].variants[0].asset, before.recipe.palettes[1].variants[0].asset);
  const old = f.host.per_color_imgs[0].kmcs[0];
  const replacement = new f.realm.HTMLCanvasElement();
  f.host.per_color_imgs[0].kmcs[0] = replacement; f.snapshot.revision = +0;
  assert.equal(f.adapter.resolveRecipe(request).recipe.palettes[0].variants[0].asset.source, old);
  assert(Object.is(f.adapter.resolveRecipe(request).revision, -0));
  f.adapter.endOperation();
  f.readiness.push({ source: replacement, state: 'ready', revision: 'new-body-source' });
  const after = f.resolve(request); assert(Object.is(after.revision, +0));
  assert.equal(after.recipe.palettes[0].variants[0].asset.source, replacement);
  assert.equal(before.recipe.palettes[0].variants[0].asset.source, old);
  f.host.nsr = true;
  assert.throws(() => f.adapter.beginOperation(), /policy changed/);
  f.host.nsr = false; f.host.alcsc[40] = 1;
  assert.throws(() => f.adapter.beginOperation(), /palette policy/);
});

test('host shape, source realms, accessor rejection and non-ready initialization clean up without retained operations', () => {
  for (const mutate of [f => f.snapshot.normalGameplay = false, f => f.snapshot.ownAccessory = 0,
    f => f.host.per_color_imgs[0].klp = false, f => f.host.per_color_imgs[36].kmcs.pop(),
    f => f.host.per_color_imgs[0].kmcs[0] = {}, f => f.readiness.push({ source: f.host.komc, state: 'pending', revision: 'conflict' }),
    f => Object.defineProperty(f.host, 'nsr', { get() { throw new Error('getter executed'); } })]) {
    const f = fixture(); mutate(f);
    assert.throws(() => f.adapter.beginOperation());
    assert.throws(() => f.adapter.resolveAppearance({ skin: 0 }), /operation required/);
    assert.throws(() => f.adapter.endOperation(), /operation required/);
  }
  const f = fixture();
  f.host.per_color_imgs[0].kmcs[0].width = 0;
  assert.equal(f.resolve({ skin: 0 }).status, 'pending');
  f.host.per_color_imgs[0].kmcs[0].width = 48;
  assert.throws(() => f.resolve({ skin: 0 }), /without a new revision/);
  f.snapshot.revision = 'sized';
  assert.equal(f.resolve({ skin: 0 }).status, 'ready');
  assert.throws(() => resolveStockSkin({ get skin() { throw new Error('executed'); } }), /Accessor/);
  assert.throws(() => resolveStockSkin({ skin: '0' }), /skin/);
  assert.throws(() => f.resolve({ skin: 0, x: NaN }), /x/);
  assert.equal(f.resolve({ skin: 0, attachmentId: 0 }).status, 'unsupported');
});

test('revision commitments reject changed sources/readiness and in-operation native dimensions', () => {
  const f = fixture();
  f.resolve({ skin: 0 });
  const entry = f.readiness.find(value => value.source === f.host.acbulb);
  entry.state = 'pending';
  assert.throws(() => f.adapter.beginOperation(), /without a new revision/);
  f.snapshot.revision = 'pending-bulb';
  assert.equal(f.resolve({ skin: 24 }).status, 'pending');
  f.adapter.beginOperation();
  f.host.komc.width = 52;
  assert.throws(() => f.adapter.resolveRecipe({ skin: 0 }), /during operation/);
  f.adapter.endOperation();
  assert.throws(() => f.adapter.beginOperation(), /without a new revision/);
  f.snapshot.revision = 'resized-effect';
  assert.equal(f.resolve({ skin: 0 }).status, 'ready');
  const g = fixture();
  // Reordering aliases can preserve the unique catalog insertion order.
  g.host.per_color_imgs[1].kmcs = [...g.host.per_color_imgs[0].kmcs];
  g.resolve({ skin: 0 });
  [g.host.per_color_imgs[1].kmcs[0], g.host.per_color_imgs[1].kmcs[1]]
    = [g.host.per_color_imgs[1].kmcs[1], g.host.per_color_imgs[1].kmcs[0]];
  assert.throws(() => g.adapter.beginOperation(), /without a new revision/);
});

test('explicit per-source revisions survive capture churn and remain exact on shared body/face/antenna uses', () => {
  const f = fixture(); const shared = f.host.per_color_imgs[0].kmcs[0];
  const sharedCommitment = f.readiness.find(entry => entry.source === shared);
  shared.width = shared.height = 64;
  sharedCommitment.revision = -0;
  f.host.per_color_imgs[0].kfmc = shared; f.host.komc = shared; f.host.acbulb = shared;
  f.host.jsebi = shared; f.host.jsepi = shared;
  f.snapshot.revision = 'capture-one';
  const before = f.resolve({ skin: 0 });
  assert.equal(before.revision, 'capture-one');
  for (const use of [before.recipe.palettes[0].variants[0], before.recipe.palettes[0].boostGlow, before.recipe.effects[0]]) {
    assert.equal(use.asset.source, shared); assert(Object.is(use.asset.revision, -0));
  }
  const unrelated = f.readiness.find(entry => entry.source === f.host.kwkbulb);
  unrelated.state = 'pending'; unrelated.revision = 'unrelated-content-change';
  f.snapshot.revision = 'capture-two';
  const after = f.resolve({ skin: 0 });
  assert.equal(after.revision, 'capture-two');
  assert.equal(after.recipe.palettes[0].variants[0].asset.source, shared);
  assert(Object.is(after.recipe.palettes[0].variants[0].asset.revision, -0));
  assert(Object.is(f.resolve({ skin: 24 }).recipe.antenna.image.asset.revision, -0));
  const eyes = f.resolve({ skin: 27 }).recipe.eyes;
  assert.equal(eyes.baseImage.asset, eyes.pupilImage.asset); assert(Object.is(eyes.baseImage.asset.revision, -0));
  sharedCommitment.revision = +0;
  assert.throws(() => f.adapter.beginOperation(), /without a new revision/);
  f.snapshot.revision = 'capture-three';
  assert(Object.is(f.resolve({ skin: 0 }).recipe.palettes[0].variants[0].asset.revision, +0));
});

test('readiness revision tokens are required, bounded, own-data and Object.is-coherent for duplicates', () => {
  for (const token of [undefined, null, '', 'x'.repeat(129), -1, NaN, Infinity, 1.25, {}, 2n]) {
    const f = fixture(); f.readiness[0].revision = token;
    assert.throws(() => f.adapter.beginOperation(), /revision/); assert.equal(f.randomCalls, 0);
  }
  const f = fixture(); let getters = 0;
  Object.defineProperty(f.readiness[0], 'revision', { get() { getters++; return 'fake'; } });
  assert.throws(() => f.adapter.beginOperation(), /Accessor/); assert.equal(getters, 0);
  const g = fixture(); const entry = g.readiness[0]; entry.revision = -0;
  g.readiness.push({ source: entry.source, state: entry.state, revision: -0 });
  assert(Object.is(g.resolve({ skin: 0 }).recipe.palettes[0].variants[0].asset.revision, -0));
  g.readiness.at(-1).revision = +0;
  assert.throws(() => g.adapter.beginOperation(), /Conflicting source readiness/);
  const h = fixture(); const commitment = h.readiness[0]; commitment.revision = 'old-content';
  h.adapter.beginOperation(); commitment.revision = 'new-content'; h.snapshot.revision = 'changed-outside-held-view';
  assert.equal(h.adapter.resolveRecipe({ skin: 0 }).recipe.palettes[0].variants[0].asset.revision, 'old-content');
  h.adapter.endOperation();
  assert.equal(h.resolve({ skin: 0 }).recipe.palettes[0].variants[0].asset.revision, 'new-content');
});

test('R2 native source getters reject incoherent scalar shadows without invoking own accessors', () => {
  for (const key of ['width', 'height', 'naturalWidth', 'naturalHeight', 'complete']) {
    const f = fixture();
    const source = key === 'width' || key === 'height'
      ? f.host.per_color_imgs[0].kmcs[0] : new f.realm.HTMLImageElement();
    if (source instanceof f.realm.HTMLCanvasElement) source.width = source.height = 64;
    if (source instanceof f.realm.HTMLImageElement) {
      f.host.per_color_imgs[0].kmcs[0] = source; f.readiness.push({ source, state: 'ready', revision: 'image-native' });
    }
    const Constructor = source instanceof f.realm.HTMLCanvasElement ? f.realm.HTMLCanvasElement : f.realm.HTMLImageElement;
    const intrinsic = Object.getOwnPropertyDescriptor(Constructor.prototype, key).get;
    const native = Reflect.apply(intrinsic, source, []);
    Object.defineProperty(source, key, { configurable: true, value: typeof native === 'boolean' ? !native : 96 });
    assert.notEqual(source[key], Reflect.apply(intrinsic, source, []));
    assert.throws(() => f.adapter.beginOperation(), /Shadowed native source scalar/);
    assert.equal(f.randomCalls, 0);
    let called = 0;
    Object.defineProperty(source, key, { configurable: true, get() { called++; return native; } });
    assert.throws(() => f.adapter.beginOperation(), /Accessor unsupported/); assert.equal(called, 0);
    Object.defineProperty(source, key, { configurable: true, value: native });
    const result = f.resolve({ skin: 0 }); assert.equal(result.status, 'ready');
    assert.equal(result.recipe.palettes[0].variants[0].asset.source, source);
    assert.equal(result.recipe.palettes[0].variants[0].asset.width, source instanceof f.realm.HTMLCanvasElement ? 64 : 48);
  }
  const f = fixture(); const source = f.host.per_color_imgs[0].kmcs[0];
  f.adapter.beginOperation();
  Object.defineProperty(source, 'width', { value: 96, configurable: true });
  assert.throws(() => f.adapter.resolveRecipe({ skin: 0 }), /Shadowed native source scalar/);
  f.adapter.endOperation();
});

test('antenna randomness is draw-owned, exact length/order, no retry and bounded before consumption', () => {
  const f = fixture();
  assert.throws(() => f.adapter.resolveAntennaRandom({ nodeCount: 8, randomPairCount: 7 }), /operation required/);
  f.adapter.beginOperation();
  for (const nodes of [8, 9, 11]) {
    const before = f.randomCalls;
    const tape = f.adapter.resolveAntennaRandom({ nodeCount: nodes, randomPairCount: nodes - 1 });
    assert(tape instanceof Float64Array); assert.equal(tape.length, 2 * (nodes - 1));
    assert.deepEqual([...tape], Array.from({ length: tape.length }, (_, i) => (before + i) % 64 / 64));
  }
  const before = f.randomCalls;
  assert.throws(() => f.adapter.resolveAntennaRandom({ nodeCount: 9, randomPairCount: 8.5 }), /request/);
  assert.equal(f.randomCalls, before);
  let attempts = 0; f.random = () => { attempts++; return attempts === 3 ? 1 : .5; };
  assert.throws(() => f.adapter.resolveAntennaRandom({ nodeCount: 8, randomPairCount: 7 }), /unit/);
  assert.equal(attempts, 3);
  f.adapter.endOperation();
  f.read = () => { assert.throws(() => f.adapter.beginOperation(), /reentry/); return f.snapshot; };
  f.adapter.beginOperation(); assert.throws(() => f.adapter.beginOperation(), /already active/); f.adapter.endOperation();
});

test('optional caller-owned nickname palette supplies selected base channels and three units per appearance', () => {
  // Authored synthetic channels; no stock palette values are represented.
  const table = () => Array.from({ length: 42 }, (_, i) => [i, 100 + i, 255 - i]);
  const f = fixture(); f.snapshot.nicknamePaletteRgb = table();
  f.adapter.beginOperation();
  const cases = [[0], [9], [26], [60], [65], [200], [60, custom([1, 41])], [24, custom([0, 5], [2, 40], [1, 7])]];
  for (const [skin, customBytes] of cases) {
    const before = f.randomCalls, request = customBytes ? { skin, customBytes } : { skin };
    const { basePalette } = resolveStockSkin(request, false);
    const { nicknameTint } = f.adapter.resolveAppearance(request);
    assert.deepEqual(nicknameTint, { baseRgb: table()[basePalette],
      randomUnits: [before, before + 1, before + 2].map(n => (n % 64) / 64) }, `skin ${skin}`);
    assert(Object.isFrozen(nicknameTint) && Object.isFrozen(nicknameTint.baseRgb) && Object.isFrozen(nicknameTint.randomUnits));
    assert.equal(f.randomCalls, before + 3);
  }
  const before = f.randomCalls;
  assert.equal(f.adapter.resolveRecipe({ skin: 60 }).status, 'ready');
  assert.throws(() => f.adapter.resolveAppearance({ skin: 0, x: NaN }), /Finite/);
  assert.equal(f.randomCalls, before, 'recipes and rejected appearances draw no tint units');
  f.adapter.endOperation();

  f.snapshot.nicknamePaletteRgb[3][1] = 7;
  assert.throws(() => f.adapter.beginOperation(), /without a new revision/);
  f.snapshot.revision = 'authored-palette-2';
  f.adapter.beginOperation();
  assert.deepEqual(f.adapter.resolveAppearance({ skin: 3 }).nicknameTint.baseRgb, [3, 7, 252]);
  f.adapter.endOperation();

  const g = fixture(); g.adapter.beginOperation();
  assert.equal(Object.hasOwn(g.adapter.resolveAppearance({ skin: 3 }), 'nicknameTint'), false);
  assert.equal(g.randomCalls, 0, 'missing palette metadata keeps the neutral path without randomness');
});

test('explicit nickname palette metadata is bounded own data before any operation', () => {
  const valid = () => Array.from({ length: 42 }, () => [1, 2, 3]);
  const invalid = [null, {}, valid().slice(1), [...valid(), [1, 2, 3]], new Uint8Array(126)];
  for (const [index, color] of [[0, [1, 2]], [5, [1, 2, 256]], [9, [1, -1, 2]], [41, [1.5, 2, 3]], [2, ['1', 2, 3]], [3, null]]) {
    const table = valid(); table[index] = color; invalid.push(table);
  }
  for (const table of invalid) {
    const f = fixture(); f.snapshot.nicknamePaletteRgb = table;
    assert.throws(() => f.adapter.beginOperation(), /nickname palette|Incompatible|Invalid|Expected record/);
    assert.equal(f.randomCalls, 0);
  }
  const f = fixture(); let getters = 0;
  f.snapshot.nicknamePaletteRgb = valid();
  Object.defineProperty(f.snapshot.nicknamePaletteRgb[4], '1', { get() { getters++; return 2; } });
  assert.throws(() => f.adapter.beginOperation(), /Accessor/); assert.equal(getters, 0);
});
