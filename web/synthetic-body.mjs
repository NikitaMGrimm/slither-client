import { createSkinProvider } from './skin-provider.mjs';

// Original flat stand-ins for the three authored synthetic appearances only.
// These are demonstration recipes, not a mapping of stock skin identifiers.
export function createSyntheticBodyResolver(palettes, realm) {
  if (!Array.isArray(palettes) || palettes.length !== 3) throw new TypeError('Three synthetic palettes required');
  const effects = ['#263440', '#000000', '#ffffff'].map(color => {
    const canvas = realm.document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.beginPath(); context.arc(32, 32, 32, 0, Math.PI * 2); context.fill();
    return canvas;
  });
  const snapshot = {
    revision: 1,
    assetCatalog: [...palettes, ...effects].map(source => ({ source, state: 'ready' })),
  };
  const provider = createSkinProvider({
    trusted: true,
    realm: { HTMLCanvasElement: realm.HTMLCanvasElement, HTMLImageElement: realm.HTMLImageElement },
    resolveHostRecipe(request) {
      if (![0, 1, 2].includes(request.skin) || request.customBytes?.length
        || (request.cosmetic !== undefined && request.cosmetic !== 0)) return { status: 'unsupported' };
      return {
        status: 'ready', basePalette: request.skin, custom: false,
        palettes: palettes.map((_, asset) => ({ variants: [{ asset }], boostGlow: { asset } })),
        runs: [{ palette: request.skin, count: 1 }], variantMode: 'first', variantPeriod: 1,
        eyes: { kind: 'standard', distance: 6, separation: 6, radius: 6, pupilRadius: 3.5,
          pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0,
          outlineColor: 0, eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 },
        effects: ['outline', 'shadow', 'death-highlight'].map((kind, index) => ({ kind, asset: index + 3, opacity: 1 })),
        bodyStyle: { detailedSegments: false, swell: 0, rotateSegments: true, headFade: null, tailFade: null },
        attachment: null, unsupportedFeatures: [],
      };
    },
    normalizeHostRecipe: recipe => recipe,
  });
  return request => provider.resolve(request, snapshot);
}

/** Bind authored local artwork to a caller-supplied Rust numeric skin policy. */
export function createLocalBodyResolver(bodySources, realm, resolveSkin) {
  if (typeof resolveSkin !== 'function') throw new TypeError('Local skin policy required');
  const assetCatalog = [];
  function asset(source) {
    const index = assetCatalog.length;
    assetCatalog.push({ source, state: 'ready' });
    return { asset: index };
  }
  const palettes = bodySources.palettes.map(palette => ({
    variants: palette.variants.map(asset), boostGlow: asset(palette.boostGlow),
  }));
  const effects = [['outline', 'outline'], ['shadow', 'shadow'], ['death-highlight', 'deathHighlight']]
    .map(([kind, source]) => ({ kind, ...asset(bodySources.effects[source]), opacity: 1 }));
  const snapshot = { revision: 1, assetCatalog };
  const provider = createSkinProvider({
    trusted: true,
    realm: { HTMLCanvasElement: realm.HTMLCanvasElement, HTMLImageElement: realm.HTMLImageElement },
    resolveHostRecipe: request => resolveSkin(request.skin, request.customBytes),
    normalizeHostRecipe: rule => ({
      status: 'ready', basePalette: rule.basePalette, custom: rule.custom,
      palettes, effects, runs: rule.runs, variantMode: rule.variantMode, variantPeriod: rule.variantPeriod,
      eyes: rule.eyes, bodyStyle: rule.bodyStyle, attachment: null, unsupportedFeatures: rule.unsupportedFeatures,
    }),
  });
  return request => provider.resolve(request, snapshot);
}
