import assert from 'node:assert/strict';
import { resolveStockSkin } from '../web/stock-skin-rules.mjs';
import { createLocalBodyResolver } from '../web/synthetic-body.mjs';

// Authored numeric differential witnesses only; no artwork, browser or network.
const custom = (...pairs) => Uint8Array.of(255, 40, 7, 99, 0, 255, 64, 3, ...pairs.flat());

/** Exercise a caller-supplied fresh Wasm build and return the assertion count. */
export function skinPolicySmoke(wasm) {
  let assertions = 0;
  const equal = (actual, expected, label) => {
    // Strict deep equality preserves exact floats and distinguishes signed zero.
    assert.deepEqual(actual, expected, label);
    assertions++;
  };
  const compare = (skin, customBytes = new Uint8Array(), nsr = false) => {
    equal(wasm.resolve_skin(skin, customBytes, nsr),
      resolveStockSkin({ skin, customBytes }, nsr), `stock skin ${skin}, nsr ${nsr}`);
  };

  // Mixed patterns, cycle seams, dense fades, all special faces and antennas.
  const skins = [0, 8, 9, 10, 15, 21, 24, 25, 27, 29, 30, 34, 37, 39, 40, 41,
    42, 44, 45, 46, 47, 48, 49, 53, 58, 59, 60, 61, 62, 63, 64, 65, 66, 255];
  for (const skin of skins) {
    for (const nsr of [false, true]) compare(skin, new Uint8Array(), nsr);
  }

  const inputs = [new Uint8Array(8), new Uint8Array(9), custom([0, 7]),
    custom([2, 36], [3, 38], [4, 40], [1, 42], [1, 255]),
    custom([1, 5], [9, 36], [0, 7], [2, 5], [3, 38], [4, 40], [2, 41], [1, 5]),
    custom([1, 0], [2, 35], [1, 37], [2, 39], [1, 41]),
    Uint8Array.of(...custom([2, 26]), 255)];
  for (const skin of [24, 27, 40, 41, 60, 63]) {
    for (const input of inputs) {
      for (const nsr of [false, true]) compare(skin, input, nsr);
    }
  }
  const maximum = new Uint8Array(255);
  for (let offset = 8; offset + 1 < maximum.length; offset += 2) maximum[offset] = 255;
  compare(60, maximum);

  // Explicit choices also cover special stock skins that local stand-ins suppress.
  for (const [skin, palette] of [[0, 0], [1, 1], [2, 2], [24, 0], [25, 1], [26, 2],
    [27, 0], [40, 1], [41, 2], [60, 0], [255, 0]]) {
    const expected = { ...resolveStockSkin({ skin: palette }), skin };
    for (const bytes of [new Uint8Array(), new Uint8Array(255).fill(255),
      custom([0, 1], [2, 36], [3, 38], [4, 40], [5, 42])]) {
      equal(wasm.resolve_local_skin(skin, bytes), expected, `authored local skin ${skin}`);
    }
  }
  const projected = Uint8Array.of(...custom([1, 5], [9, 36], [0, 7], [2, 5], [2, 41], [3, 39], [1, 5]), 255);
  const localCustom = { ...resolveStockSkin({ skin: 0, customBytes: custom([3, 2], [2, 2], [3, 0], [1, 2]) }),
    basePalette: 2, runs: [{ palette: 2, count: 3 }, { palette: 2, count: 2 }, { palette: 0, count: 3 }, { palette: 2, count: 1 }] };
  for (const skin of [24, 27, 40, 41, 60, 255]) {
    equal(wasm.resolve_local_skin(skin, projected), { ...localCustom, skin },
      `authored modulo-three projection preserves admitted run boundaries for ${skin}`);
  }
  equal(wasm.resolve_local_skin(60, maximum).runs, [{ palette: 0, count: 31365 }],
    'maximum authored custom count remains compact');

  // Real Wasm selection through the production local binder, with authored
  // source doubles. This witnesses source identity and runs, not browser pixels.
  class Canvas { width = 64; height = 64; }
  class Image {}
  const bodySources = {
    palettes: Array.from({ length: 3 }, () => ({
      variants: Array.from({ length: 7 }, () => new Canvas()), boostGlow: new Canvas(),
    })),
    effects: { outline: new Canvas(), shadow: new Canvas(), deathHighlight: new Canvas() },
  };
  const bind = createLocalBodyResolver(bodySources,
    { HTMLCanvasElement: Canvas, HTMLImageElement: Image }, wasm.resolve_local_skin);
  const customBytes = custom([2, 0], [3, 1], [4, 2]);
  const { recipe } = bind({ skin: 40, customBytes, cosmetic: 255 });
  equal(recipe.custom, true, 'authored custom selection reaches the production binder');
  equal(recipe.runs, [{ palette: 0, count: 2 }, { palette: 1, count: 3 }, { palette: 2, count: 4 }],
    'authored custom run lengths and order survive Wasm/source binding');
  equal([recipe.basePalette, recipe.variantMode, recipe.variantPeriod, recipe.eyes.kind, recipe.attachment],
    [0, 'first', 1, 'standard', null], 'custom local policy retains plain face and first shading');
  for (const run of recipe.runs) {
    equal(recipe.palettes[run.palette].variants[0].asset.source === bodySources.palettes[run.palette].variants[0],
      true, 'authored custom body source identity');
    equal(recipe.palettes[run.palette].boostGlow.asset.source === bodySources.palettes[run.palette].boostGlow,
      true, 'authored custom glow source identity');
  }

  // Returned nested records and input bytes cannot alias later resolver results.
  const bytes = custom([3, 5]);
  const copied = wasm.resolve_skin(27, bytes, false);
  const expected = resolveStockSkin({ skin: 27, customBytes: bytes });
  bytes.fill(0);
  equal(copied, expected, 'input mutation leaves the copied descriptor intact');
  copied.runs[0].count = 999;
  copied.bodyStyle.rotateSegments = false;
  copied.eyes.pupilTravel = 999;
  compare(27, custom([3, 5]));
  const local = wasm.resolve_local_skin(41, new Uint8Array());
  local.runs[0].palette = 99;
  local.eyes.radius = 999;
  equal(wasm.resolve_local_skin(41, new Uint8Array()),
    { ...resolveStockSkin({ skin: 2 }), skin: 41 }, 'local results are fresh nested records');
  const retainedCustom = wasm.resolve_local_skin(40, projected);
  projected.fill(0);
  equal(retainedCustom, { ...localCustom, skin: 40 }, 'local custom result does not borrow input bytes');
  retainedCustom.runs[0].count = 999;
  equal(wasm.resolve_local_skin(40, custom([3, 5], [2, 41], [3, 39], [1, 5])),
    { ...localCustom, skin: 40 }, 'local custom runs are fresh nested records');

  for (const resolve of [() => wasm.resolve_skin(0, new Uint8Array(256), false),
    () => wasm.resolve_local_skin(0, new Uint8Array(256))]) {
    assert.throws(resolve);
    assertions++;
  }
  return assertions;
}
