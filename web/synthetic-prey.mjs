import { copyEntitySourcePalettes, paintAuthoredCanvas } from './authored-source-recipes.mjs';

// Existing authored prey sources: Rust owns the numeric plan, JS owns objects/random callbacks.
export function createSyntheticPreyResolver(realm, random, sourcePlan) {
  if (typeof random !== 'function') throw new TypeError('Prey random source required');
  const recipes = copyEntitySourcePalettes(sourcePlan);
  const palettes = recipes.map(palette => {
    const family = recipes => Object.freeze(recipes.map(recipe => {
      const source = paintAuthoredCanvas(realm, recipe);
      return Object.freeze({
        asset: Object.freeze({ source, kind: 'canvas', status: 'ready', revision: 'synthetic-prey-1',
          width: source.width, height: source.height }),
        width: source.width, height: source.height, halfWidth: recipe.halfWidth, halfHeight: recipe.halfHeight,
      });
    }));
    return Object.freeze({ color: palette.color, bodies: family(palette.bodies), glows: family(palette.glows) });
  });
  return request => {
    const palette = palettes[request.palette];
    if (!palette) throw new RangeError('Unsupported synthetic prey palette');
    return { randomPhaseUnit: random(), randomRateUnit: random(), palette };
  };
}

export function syntheticPreyCommands() {
  const u16 = n => [n >>> 8 & 255, n & 255];
  const u24 = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
  return [[31, 55, -45, 0], [32, 75, 40, 2], [33, -55, -50, 4]].map(([id, x, y, color]) =>
    [121, ...u16(id), color, ...u24((32550 + x) * 5), ...u24((32550 + y) * 5),
      22, 48, ...u24(0), ...u24(0), ...u16(64)]);
}
