import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalBodyResolver, createSyntheticBodyResolver } from '../web/synthetic-body.mjs';

// Original synthetic DOM sources; no external artwork, browser or sockets.
class Canvas {
  width = 32; height = 32;
  getContext(kind) { assert.equal(kind, '2d'); return { beginPath() {}, arc() {}, fill() {} }; }
}
class Image {}
const realm = { HTMLCanvasElement: Canvas, HTMLImageElement: Image,
  document: { createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); } } };

test('synthetic body recipes preserve the three exact palette objects and explicit whole sources', () => {
  const palettes = [new Canvas(), new Canvas(), new Canvas()];
  const resolve = createSyntheticBodyResolver(palettes, realm);
  for (let skin = 0; skin < 3; skin++) {
    const result = resolve({ skin, customBytes: new Uint8Array(), cosmetic: 0, x: 0, y: 0 });
    assert.equal(result.status, 'ready');
    assert.equal(result.recipe.basePalette, skin);
    assert.deepEqual(result.recipe.runs, [{ palette: skin, count: 1 }]);
    for (let index = 0; index < 3; index++) {
      const palette = result.recipe.palettes[index];
      assert.equal(palette.variants[0].asset.source, palettes[index]);
      assert.equal(palette.boostGlow.asset.source, palettes[index]);
      assert.equal(palette.variants[0].sourceMode, 'whole');
    }
    assert.equal(result.recipe.effects.length, 3);
    assert.equal(result.recipe.attachment, null);
    assert.equal(result.recipe.eyes.kind, 'standard');
  }
});

test('synthetic recipes reject unseen appearances instead of approximating stock skins', () => {
  const palettes = [new Canvas(), new Canvas(), new Canvas()];
  const resolve = createSyntheticBodyResolver(palettes, realm);
  for (const request of [{ skin: 3 }, { skin: 255 }, { skin: 0, customBytes: Uint8Array.of(7) }, { skin: 1, cosmetic: 4 }]) {
    assert.equal(resolve(request).status, 'unsupported');
  }
  assert.throws(() => createSyntheticBodyResolver(palettes.slice(1), realm), /Three synthetic palettes/);
});

function localSourcesDouble() {
  return {
    palettes: Array.from({ length: 3 }, () => ({
      variants: Array.from({ length: 7 }, () => new Canvas()), boostGlow: new Canvas(),
    })),
    effects: { outline: new Canvas(), shadow: new Canvas(), deathHighlight: new Canvas() },
  };
}

// Labelled copied-Rust-rule double: numeric policy itself is tested natively.
function localRuleDouble() {
  return { skin: 251, custom: false, basePalette: 1,
    runs: [{ palette: 1, count: 1 }], variantMode: 'ping-pong', variantPeriod: 7,
    eyes: { kind: 'standard', distance: 6, separation: 6, radius: 6, pupilRadius: 3.5,
      pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0, outlineColor: 0,
      eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 },
    bodyStyle: { detailedSegments: false, swell: 0, rotateSegments: true, headFade: null, tailFade: null },
    antenna: null, faceDecoration: null, unsupportedFeatures: [],
  };
}

test('local binding maps exact seven-variant/glow/effect objects and forwards raw inputs to the policy double', () => {
  const bodySources = localSourcesDouble(), rule = localRuleDouble(), calls = [];
  const resolve = createLocalBodyResolver(bodySources, realm, (skin, customBytes) => {
    calls.push({ skin, customBytes }); return rule;
  });
  assert.deepEqual(calls, []);
  const customBytes = Uint8Array.of(0, 255, 7, 3);
  const request = { skin: 251, customBytes, cosmetic: 79, x: 3, y: -4 };
  const result = resolve(request);
  assert.equal(calls.length, 1); assert.equal(calls[0].skin, 251);
  assert.deepEqual(calls[0].customBytes, customBytes);
  assert.notEqual(calls[0].customBytes, customBytes, 'provider retains its existing payload-copy boundary');
  assert.deepEqual(request, { skin: 251, customBytes: Uint8Array.of(0, 255, 7, 3), cosmetic: 79, x: 3, y: -4 });
  assert.equal(result.status, 'ready');
  assert.equal(result.recipe.basePalette, 1); assert.equal(result.recipe.custom, false);
  assert.deepEqual(result.recipe.runs, rule.runs);
  assert.equal(result.recipe.variantMode, rule.variantMode); assert.equal(result.recipe.variantPeriod, rule.variantPeriod);
  assert.deepEqual(result.recipe.bodyStyle, rule.bodyStyle); assert.deepEqual(result.recipe.eyes, rule.eyes);
  const used = [];
  for (const [index, family] of result.recipe.palettes.entries()) {
    assert.equal(family.variants.length, 7);
    for (const [variant, use] of family.variants.entries()) {
      assert.equal(use.asset.source, bodySources.palettes[index].variants[variant]);
      assert.equal(use.sourceMode, 'whole'); used.push(use.asset.source);
    }
    assert.equal(family.boostGlow.asset.source, bodySources.palettes[index].boostGlow);
    assert.equal(family.boostGlow.sourceMode, 'whole'); used.push(family.boostGlow.asset.source);
  }
  for (const [index, key] of ['outline', 'shadow', 'deathHighlight'].entries()) {
    const effect = result.recipe.effects[index];
    assert.equal(effect.kind, ['outline', 'shadow', 'death-highlight'][index]);
    assert.equal(effect.asset.source, bodySources.effects[key]);
    assert.equal(effect.sourceMode, 'whole'); assert.equal(effect.opacity, 1); used.push(effect.asset.source);
  }
  assert.equal(new Set(used).size, 27);
  assert.equal(result.recipe.attachment, null);
  assert(Object.isFrozen(result.recipe));
});

test('local binding uses policy outputs for numeric choices and retains provider validation', () => {
  const rule = localRuleDouble(), calls = [];
  const resolve = createLocalBodyResolver(localSourcesDouble(), realm, (skin, customBytes) => {
    calls.push([skin, customBytes]); return rule;
  });
  rule.basePalette = 0;
  rule.runs = [{ palette: 2, count: 4 }, { palette: 0, count: 2 }];
  rule.variantMode = 'cycle'; rule.variantPeriod = 3;
  rule.eyes.radius = 7;
  rule.bodyStyle = { detailedSegments: true, swell: 0.1, rotateSegments: false,
    headFade: { palette: 1, length: 12 }, tailFade: { palette: 2, length: 10 } };
  const { recipe } = resolve({ skin: 251, cosmetic: 255 });
  assert.equal(calls[0][1], undefined);
  assert.equal(recipe.basePalette, 0); assert.deepEqual(recipe.runs, rule.runs);
  assert.equal(recipe.variantMode, 'cycle'); assert.equal(recipe.variantPeriod, 3);
  assert.deepEqual(recipe.bodyStyle, rule.bodyStyle); assert.deepEqual(recipe.eyes, rule.eyes);
  assert.throws(() => resolve({ skin: 256 }), /skin/);
  assert.equal(calls.length, 1, 'invalid request must fail before policy invocation');
  rule.variantPeriod = 8;
  assert.throws(() => resolve({ skin: 251 }), /variant period/);
  assert.throws(() => createLocalBodyResolver(localSourcesDouble(), realm, undefined), /policy/);
});
