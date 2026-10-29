import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { stockSkinSourceFixture } from './stock-skin-source-fixture.mjs';
import { stockSkinPolicyDouble } from './stock-skin-policy-double.mjs';

// Authored copied-ABI witnesses only. No implicit Wasm build or browser source.
test('stock policy capabilities are mandatory before source reads or randomness', () => {
  for (const missing of ['resolveSkin', 'validateCustomPaletteMask']) {
    const options = { ...stockSkinPolicyDouble,
      readSnapshot() { assert.fail('source read'); }, random() { assert.fail('random'); } };
    delete options[missing];
    assert.throws(() => createStockSkinAdapter(options), /Rust stock skin policy/);
  }
});

test('adapter consumes the injected copied descriptor and forwards admitted bytes/nsr', () => {
  const calls = [];
  const f = stockSkinSourceFixture(undefined, { ...stockSkinPolicyDouble, resolveSkin(...args) {
    calls.push(args);
    const rule = stockSkinPolicyDouble.resolveSkin(...args);
    return { ...rule, basePalette: 2, runs: [{ palette: 2, count: 5 }],
      eyes: { ...rule.eyes, distance: 12 } };
  } });
  f.host.nsr = true;
  const bytes = Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 2, 1);
  f.adapter.beginOperation();
  const request = { skin: 0, cosmetic: 255, customBytes: bytes };
  assert.equal(f.adapter.resolveAppearance(request).face.eyes.distance, 12);
  const result = f.adapter.resolveRecipe(request);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.recipe.runs, [{ palette: 0, count: 5 }]);
  assert.equal(result.recipe.palettes[0].variants[0].asset.source, f.host.per_color_imgs[2].kmcs[0]);
  assert.equal(result.recipe.bodyStyle.rotateSegments, false);
  for (const [skin, copy, nsr] of calls) {
    assert.equal(skin, 0); assert.equal(nsr, true); assert.deepEqual(copy, bytes); assert.notEqual(copy, bytes);
  }
  bytes.fill(255);
  assert.equal(calls[0][1][8], 2);
  f.adapter.endOperation();
});

test('request own-data/typed-byte rejection precedes the Rust call and entropy', () => {
  let calls = 0;
  const f = stockSkinSourceFixture(undefined, { ...stockSkinPolicyDouble,
    resolveSkin(...args) { calls++; return stockSkinPolicyDouble.resolveSkin(...args); } });
  f.adapter.beginOperation();
  for (const request of [{ skin: 256 }, { skin: 0, cosmetic: -1 }, { skin: 0, attachmentId: 65536 },
    { skin: 0, customBytes: [] }, { skin: 0, customBytes: new Uint8Array(256) },
    { get skin() { assert.fail('accessor executed'); } },
    { skin: 0, get customBytes() { assert.fail('accessor executed'); } }]) {
    assert.throws(() => f.adapter.resolveAppearance(request), error => error.code !== 'ERR_ASSERTION');
  }
  assert.equal(calls, 0); assert.equal(f.randomCalls, 0);
  assert.equal(f.adapter.resolveRecipe({ skin: 0, attachmentId: 0 }).status, 'unsupported');
  assert.throws(() => f.adapter.resolveAppearance({ skin: 0, attachmentId: 0 }), /static-accessory/);
  f.adapter.endOperation();
});

test('mask policy receives a copy and rejects before activating the source operation', () => {
  let seen;
  const f = stockSkinSourceFixture(undefined, { ...stockSkinPolicyDouble,
    validateCustomPaletteMask(mask) { seen = mask; return stockSkinPolicyDouble.validateCustomPaletteMask(mask); } });
  f.host.alcsc[36] = 1;
  assert.throws(() => f.adapter.beginOperation(), /custom palette policy/);
  assert.notEqual(seen, f.host.alcsc);
  assert.throws(() => f.adapter.resolveAppearance({ skin: 0 }), /operation required/);
  f.host.alcsc[36] = 0;
  f.adapter.beginOperation(); f.adapter.endOperation();
});

test('Rust callback failure/reentry preserves the primary value and consumes no entropy', () => {
  let f;
  f = stockSkinSourceFixture(undefined, { ...stockSkinPolicyDouble, resolveSkin() {
    assert.throws(() => f.adapter.resolveAppearance({ skin: 0 }), /reentry/);
    throw undefined;
  } });
  f.adapter.beginOperation();
  let caught = false;
  try { f.adapter.resolveAppearance({ skin: 0 }); } catch (error) { caught = true; assert.equal(error, undefined); }
  assert.equal(caught, true); assert.equal(f.randomCalls, 0);
  f.adapter.endOperation();
});
