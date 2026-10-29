import { stockSkinCutoverSmoke } from './stock-skin-cutover-smoke.mjs';
import assert from 'node:assert/strict';
import { resolveStockSkin } from './stock-skin-policy-oracle.mjs';
import { resolveLocalSkinDouble } from './stock-skin-policy-double.mjs';
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

  // All requested bytes retain built-in counts/order while special source roles
  // remain suppressed. The authored oracle/double is test-only, never a fallback.
  for (let skin = 0; skin <= 255; skin++) {
    const expected = resolveLocalSkinDouble(skin);
    for (const bytes of [new Uint8Array(), new Uint8Array(255).fill(255),
      custom([0, 1], [2, 36], [3, 38], [4, 40], [5, 42])]) {
      equal(wasm.resolve_local_skin(skin, bytes), expected, `authored local skin ${skin}`);
    }
  }
  for (const [skin, expected] of [
    [9, [...Array.from({ length: 11 }, (_, index) => ({ palette: index % 2 ? 9 : 7, count: 1 })), { palette: 10, count: 9 }]],
    [10, [{ palette: 9, count: 5 }, { palette: 1, count: 5 }, { palette: 7, count: 5 }]],
    [15, Array.from({ length: 9 }, (_, index) => ({ palette: index, count: 1 }))],
    [29, [{ palette: 11, count: 2 }, { palette: 4, count: 1 }, { palette: 11, count: 4 }, { palette: 4, count: 1 }, { palette: 11, count: 2 }]],
    [20, [{ palette: 3, count: 5 }, { palette: 0, count: 5 }]],
  ]) equal(wasm.resolve_local_skin(skin, new Uint8Array()).runs, expected, `local builtin ${skin} stripe boundaries`);
  const projected = Uint8Array.of(...custom([1, 5], [9, 36], [0, 7], [2, 5], [2, 41], [3, 39], [1, 5]), 255);
  const localCustom = { ...resolveStockSkin({ skin: 0, customBytes: custom([3, 5], [2, 41], [3, 39], [1, 5]) }),
    basePalette: 5, runs: [{ palette: 5, count: 3 }, { palette: 41, count: 2 }, { palette: 39, count: 3 }, { palette: 5, count: 1 }] };
  for (const skin of [24, 25, 27, 40, 41, 44, 60, 63, 64, 255]) {
    equal(wasm.resolve_local_skin(skin, projected), { ...localCustom, skin },
      `local standard palettes preserve admitted run boundaries for ${skin}`);
  }
  equal(wasm.resolve_local_skin(60, maximum).runs, [{ palette: 0, count: 31365 }],
    'maximum authored custom count remains compact');

  // Real Wasm selection through the production local binder, with authored
  // source doubles. This witnesses source identity and runs, not browser pixels.
  class Canvas { width = 64; height = 64; }
  class Image {}
  const bodySources = {
    palettes: Array.from({ length: 42 }, (_, paletteId) => ({
      variants: Array.from({ length: paletteId === 36 ? 60 : 7 }, () => new Canvas()), boostGlow: new Canvas(),
    })),
    effects: { outline: new Canvas(), shadow: new Canvas(), deathHighlight: new Canvas() },
  };
  const bind = createLocalBodyResolver(bodySources,
    { HTMLCanvasElement: Canvas, HTMLImageElement: Image }, wasm.resolve_local_skin);
  for (const skin of [9, 10, 15, 20, 25, 29, 44, 60, 63, 64]) {
    const { recipe, status } = bind({ skin, customBytes: new Uint8Array() });
    equal(status, 'ready', 'local builtin through actual Wasm/provider');
    equal(recipe.runs, resolveLocalSkinDouble(skin).runs, 'builtin run boundaries survive source binding');
    equal(recipe.eyes, [25, 44, 63, 64].includes(skin)
      ? resolveStockSkin({ skin }).eyes : resolveStockSkin({ skin: 0 }).eyes,
    'supported numeric face survives actual Wasm/source binding');
    equal([recipe.variantMode, recipe.variantPeriod, recipe.eyes.kind, recipe.attachment],
      [skin === 60 ? 'cycle' : 'ping-pong', skin === 60 ? 60 : 7, 'standard', null], 'local builtin keeps its supported shading/face roles');
    for (const run of recipe.runs) {
      equal(recipe.palettes[run.palette].variants.every((use, index) => use.asset.source === bodySources.palettes[run.palette].variants[index]), true,
        'builtin uses the exact existing seven shaded sources');
    }
  }
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
  for (const skin of [25, 44, 63, 64]) {
    const original = wasm.resolve_local_skin(skin, new Uint8Array());
    equal(original.eyes, resolveStockSkin({ skin }).eyes, 'authoritative ordinary face');
    original.eyes.pupilRadius = 999; original.runs[0].count = 999;
    equal(wasm.resolve_local_skin(skin, new Uint8Array()).eyes, resolveStockSkin({ skin }).eyes, 'fresh local face');
    assert.throws(() => wasm.resolve_local_skin(skin, new Uint8Array(256))); assertions++;
  }
  const local = wasm.resolve_local_skin(41, new Uint8Array());
  local.runs[0].palette = 99;
  local.eyes.radius = 999;
  equal(wasm.resolve_local_skin(41, new Uint8Array()),
    resolveLocalSkinDouble(41), 'local results are fresh nested records');
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
  for (const [raw, count, expected] of [[null, 0, -1], ['-1', 0, -1], ['0', 32, 0], ['31', 32, 31]]) {
    equal(wasm.stock_accessory_id(raw, count), expected, 'ready-only persisted accessory selection');
  }
  for (const raw of ['', '-0', '+1', '01', '32', '4294967296']) {
    assert.throws(() => wasm.stock_accessory_id(raw, 32)); assertions++;
  }
  for (const [skin, expected] of [[0, 6], [41, 34], [40, 6]]) {
    equal(wasm.stock_accessory_forward(skin, new Uint8Array()), expected, 'appearance-owned head forward');
  }
  assert.throws(() => wasm.stock_accessory_forward(27, new Uint8Array())); assertions++;
  for (const skin of [27, 40, 41]) {
    equal(wasm.stock_accessory_forward(skin, custom([2, 1])), 6, 'custom override precedes accessory face eligibility');
  }
  return assertions + stockSkinCutoverSmoke(wasm);
}
