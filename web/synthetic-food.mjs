import { copyEntitySourcePalettes, paintAuthoredCanvas } from './authored-source-recipes.mjs';

// Existing authored food sources: Rust owns the numeric plan, JS owns objects/random callbacks.
export function createSyntheticFoodResolver(realm, random, sourcePlan) {
  if (typeof random !== 'function') throw new TypeError('Food random source required');
  const recipes = copyEntitySourcePalettes(sourcePlan);
  const palettes = recipes.map(palette => {
    const family = recipes => Object.freeze(recipes.map(recipe => {
      const source = paintAuthoredCanvas(realm, recipe);
      return Object.freeze({
        asset: Object.freeze({ source, kind: 'canvas', status: 'ready', revision: 'synthetic-food-1',
          width: source.width, height: source.height }),
        width: source.width, height: source.height, halfWidth: recipe.halfWidth, halfHeight: recipe.halfHeight,
      });
    }));
    return Object.freeze({ color: palette.color, count: palette.count, bodies: family(palette.bodies),
      outlines: family(palette.outlines), glows: family(palette.glows) });
  });
  return request => {
    const palette = palettes[request.palette];
    if (!palette) throw new RangeError('Unsupported synthetic food palette');
    return { randomPhaseUnit: random(), randomWobbleUnit: random(), palette };
  };
}
