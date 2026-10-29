import { normalCustomPalette, resolveStockSkin } from './stock-skin-policy-oracle.mjs';

// Explicit build-independent test doubles only. Product code must receive the generated Wasm functions.
export function resolveSkinDouble(skin, customBytes, nsr) {
  return resolveStockSkin({ skin, customBytes: Uint8Array.from(customBytes) }, nsr);
}
export function validCustomPaletteMaskDouble(mask) {
  return mask.length === 256 && mask.every((value, palette) => value === Number(normalCustomPalette(palette)));
}
export const stockSkinPolicyDouble = Object.freeze({ resolveSkin: resolveSkinDouble,
  validateCustomPaletteMask: validCustomPaletteMaskDouble });
export const stockSkinWasmDouble = Object.freeze({ resolve_skin: resolveSkinDouble,
  stock_custom_palette_mask_valid: validCustomPaletteMaskDouble });
