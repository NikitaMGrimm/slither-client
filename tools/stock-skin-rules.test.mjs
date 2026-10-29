import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStockSkin } from './stock-skin-policy-oracle.mjs';

// Original synthetic metadata witnesses; no source artwork, URLs or generators.
const custom = (...pairs) => Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, ...pairs.flat());

test('stock mouth selection is complete while ordinary body and nsr policy remain exact', () => {
  for (const nsr of [false, true]) {
    const rule = resolveStockSkin({ skin: 40, cosmetic: 255 }, nsr);
    assert.deepEqual(rule.eyes, { kind: 'mouth-face', geometry: { pupilTravel: 2.3 },
      eyeMarks: { source: 'ecmc', sourceMode: 'whole' }, mouth: { source: 'jmou', sourceMode: 'whole' } });
    assert.deepEqual(rule.unsupportedFeatures, []);
    assert.deepEqual(rule.runs, [{ palette: 26, count: 1 }]); assert.equal(rule.basePalette, 26);
    assert.equal(rule.variantMode, 'ping-pong'); assert.equal(rule.variantPeriod, 7);
    assert.deepEqual(rule.bodyStyle, { detailedSegments: false, swell: 0, rotateSegments: !nsr, headFade: null, tailFade: null });
    assert.equal(rule.antenna, null); assert.equal(rule.faceDecoration, null);
    for (const value of [rule.eyes, rule.eyes.geometry, rule.eyes.eyeMarks, rule.eyes.mouth]) assert(Object.isFrozen(value));
  }
  assert.deepEqual(resolveStockSkin({ skin: 40, attachmentId: 0 }).unsupportedFeatures, ['static-accessory']);
});

test('only accepted custom runs suppress mouth family using the existing allowed-color parser', () => {
  for (const customBytes of [new Uint8Array(), new Uint8Array(9), custom([0, 26]),
    custom([2, 36], [4, 38], [3, 40], [1, 255])]) {
    const rule = resolveStockSkin({ skin: 40, customBytes });
    assert.equal(rule.custom, false); assert.equal(rule.eyes.kind, 'mouth-face');
  }
  for (const customBytes of [custom([1, 26]), custom([0, 1], [2, 40], [1, 7]), custom([1, 41])]) {
    const rule = resolveStockSkin({ skin: 40, customBytes });
    assert.equal(rule.custom, true); assert.equal(rule.eyes.kind, 'standard');
    assert.equal(rule.eyes.pupilTravel, 2.3); assert.equal(rule.variantMode, 'first');
    assert.equal(rule.variantPeriod, 1); assert.deepEqual(rule.unsupportedFeatures, []);
  }
  assert.throws(() => resolveStockSkin({ skin: 40, customBytes: [] }), /Uint8Array/);
});
