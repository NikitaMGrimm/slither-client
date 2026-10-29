import { normalCustomPalette, resolveStockSkin } from './stock-skin-policy-oracle.mjs';

// Explicit build-independent test doubles only. Product code must receive the generated Wasm functions.
export function resolveSkinDouble(skin, customBytes, nsr) {
  return resolveStockSkin({ skin, customBytes: Uint8Array.from(customBytes) }, nsr);
}
export function resolveLocalSkinDouble(skin, customBytes = new Uint8Array()) {
  const rule = resolveSkinDouble(skin % 3, customBytes, false);
  const runs = (rule.custom ? rule.runs : resolveStockSkin({ skin }).runs)
    .map(({ palette, count }) => ({ palette: palette % 3, count }));
  return { ...rule, skin, runs, basePalette: runs[0].palette };
}
export function validCustomPaletteMaskDouble(mask) {
  return mask.length === 256 && mask.every((value, palette) => value === Number(normalCustomPalette(palette)));
}
export const stockSkinPolicyDouble = Object.freeze({ resolveSkin: resolveSkinDouble,
  validateCustomPaletteMask: validCustomPaletteMaskDouble });
export const stockSkinWasmDouble = Object.freeze({ resolve_skin: resolveSkinDouble,
  stock_custom_palette_mask_valid: validCustomPaletteMaskDouble });
