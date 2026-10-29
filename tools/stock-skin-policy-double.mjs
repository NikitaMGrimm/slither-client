import { normalCustomPalette, resolveStockSkin } from './stock-skin-policy-oracle.mjs';

// Explicit build-independent test doubles only. Product code must receive the generated Wasm functions.
export function resolveSkinDouble(skin, customBytes, nsr) {
  return resolveStockSkin({ skin, customBytes: Uint8Array.from(customBytes) }, nsr);
}
export function resolveLocalSkinDouble(skin, customBytes = new Uint8Array()) {
  const rule = resolveSkinDouble(skin, customBytes, false);
  const plain = resolveSkinDouble(0, new Uint8Array(), false);
  return { ...rule, runs: rule.runs.map(run => ({ ...run })), bodyStyle: { ...plain.bodyStyle },
    eyes: !rule.custom && [25, 44, 63, 64].includes(skin) ? { ...rule.eyes } : { ...plain.eyes },
    faceDecoration: null, antenna: null };
}
export function validCustomPaletteMaskDouble(mask) {
  return mask.length === 256 && mask.every((value, palette) => value === Number(normalCustomPalette(palette)));
}
export const stockSkinPolicyDouble = Object.freeze({ resolveSkin: resolveSkinDouble,
  validateCustomPaletteMask: validCustomPaletteMaskDouble });
export const stockSkinWasmDouble = Object.freeze({ resolve_skin: resolveSkinDouble,
  stock_custom_palette_mask_valid: validCustomPaletteMaskDouble });
