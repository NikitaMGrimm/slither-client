import assert from 'node:assert/strict';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { stockSkinSourceFixture } from './stock-skin-source-fixture.mjs';
import { stockSkinPolicyDouble } from './stock-skin-policy-double.mjs';
import { normalCustomPalette, resolveStockSkin } from './stock-skin-policy-oracle.mjs';

const custom = (...pairs) => Uint8Array.of(255, 40, 7, 99, 0, 255, 64, 3, ...pairs.flat());

/** Exact authored pre-cutover differential, with real Rust and borrowed source doubles. */
export function stockSkinCutoverSmoke(wasm) {
  let assertions = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); assertions++; };
  const mask = Uint8Array.from({ length: 256 }, (_, p) => Number(normalCustomPalette(p)));
  equal(wasm.stock_custom_palette_mask_valid(mask), true, 'normal mask');
  for (let palette = 0; palette < mask.length; palette++) {
    for (const invalid of [1 - mask[palette], 2, 255]) {
      const changed = mask.slice(); changed[palette] = invalid;
      equal(wasm.stock_custom_palette_mask_valid(changed), false, `mask drift ${palette}/${invalid}`);
    }
  }
  for (const length of [0, 255, 257]) equal(wasm.stock_custom_palette_mask_valid(new Uint8Array(length)), false, 'mask length');
  const maximum = new Uint8Array(255);
  for (let i = 8; i + 1 < maximum.length; i += 2) { maximum[i] = 255; maximum[i + 1] = i % 4 ? 41 : 39; }
  const cases = Array.from({ length: 256 }, (_, skin) => ({ skin }));
  for (const skin of [24, 25, 27, 40, 41, 60, 63, 255]) {
    for (const customBytes of [new Uint8Array(9), custom([0, 7], [2, 36], [3, 38], [4, 40], [2, 255]),
      custom([1, 5], [4, 36], [0, 7], [2, 5], [3, 41], [2, 39], [1, 5]), maximum]) cases.push({ skin, customBytes });
  }
  for (let palette = 0; palette < 256; palette++) cases.push({ skin: 27, customBytes: custom([255, palette]) });
  for (const nsr of [false, true]) {
    const f = stockSkinSourceFixture('accessory', { resolveSkin: wasm.resolve_skin,
      validateCustomPaletteMask: wasm.stock_custom_palette_mask_valid, resolveAccessoryForward: wasm.stock_accessory_forward });
    f.host.nsr = nsr; f.random = () => .25;
    f.snapshot.nicknamePaletteRgb = Array.from({ length: 42 }, (_, p) => [p, 100 + p, 255 - p]);
    const legacy = createStockSkinAdapter({ ...stockSkinPolicyDouble, realm: f.realm,
      appearanceMode: 'accessory', random: () => .25, readSnapshot: () => f.snapshot,
      resolveAccessoryForward(skin, bytes) {
        const rule = resolveStockSkin({ skin, customBytes: bytes });
        return rule.eyes.kind === 'standard' ? rule.eyes.distance : resolveStockSkin({ skin: 0 }).eyes.distance;
      } });
    f.adapter.beginOperation(); legacy.beginOperation();
    try {
      for (const request of cases) {
        const label = `stock ${request.skin}/${request.customBytes?.length ?? 0}/nsr${nsr}`;
        equal(wasm.resolve_skin(request.skin, request.customBytes ?? new Uint8Array(), nsr), resolveStockSkin(request, nsr), label + ' descriptor');
        equal(f.adapter.resolveAppearance(request), legacy.resolveAppearance(request), label + ' appearance/tint');
        equal(f.adapter.resolveRecipe(request), legacy.resolveRecipe(request), label + ' recipe/source identity/order');
      }
      equal(f.adapter.resolveRecipe({ skin: 40, attachmentId: 0 }).status, 'unsupported', 'unbound requested attachment remains unsupported');
    } finally { f.adapter.endOperation(); legacy.endOperation(); }
    // A new fixed-selection session checks the additive per-appearance accessory projection.
    const source = new f.realm.HTMLImageElement();
    f.snapshot.ownAccessory = 2;
    f.snapshot.ownCachedAccessorySelection = { id: 2, source, width: 48, height: 48,
      geometry: { imageScale: .375, pivotX: -0, pivotY: 7.5 } };
    f.readiness.push({ source, state: 'ready', revision: 'authored-selected-load' });
    f.snapshot.revision = 'authored-selected';
    const selected = createStockSkinAdapter({ resolveSkin: wasm.resolve_skin,
      validateCustomPaletteMask: wasm.stock_custom_palette_mask_valid, resolveAccessoryForward: wasm.stock_accessory_forward,
      realm: f.realm, appearanceMode: 'accessory', random: () => .25, readSnapshot: () => f.snapshot });
    const expected = createStockSkinAdapter({ ...stockSkinPolicyDouble, realm: f.realm,
      appearanceMode: 'accessory', random: () => .25, readSnapshot: () => f.snapshot,
      resolveAccessoryForward(skin, bytes) { const rule = resolveStockSkin({ skin, customBytes: bytes });
        return rule.eyes.kind === 'standard' ? rule.eyes.distance : resolveStockSkin({ skin: 0 }).eyes.distance; } });
    selected.beginOperation(); expected.beginOperation();
    try {
      for (const skin of [0, 27, 40, 41, 60]) for (const own of [false, true]) for (const bytes of [new Uint8Array(), custom([2, 1])]) {
        const request = { skin, own, customBytes: bytes };
        if (skin === 27 && own && !bytes.length) {
          for (const adapter of [selected, expected]) {
            assert.throws(() => adapter.resolveAppearance(request), error => error.status === 'unsupported'); assertions++;
            assert.throws(() => adapter.resolveRecipe(request), error => error.status === 'unsupported'); assertions++;
          }
        } else {
          equal(selected.resolveAppearance(request), expected.resolveAppearance(request), 'selected numeric forward/custom/own');
          equal(selected.resolveRecipe(request), expected.resolveRecipe(request), 'selected recipe/source/forward');
        }
      }
    } finally { selected.endOperation(); expected.endOperation(); }
  }
  return assertions;
}
