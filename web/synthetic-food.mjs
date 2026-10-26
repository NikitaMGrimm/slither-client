// Original flat food stand-ins, with caller-owned independent random inputs.
// These colors, sizes and raster recipes do not map official food textures.
export function createSyntheticFoodResolver(realm, random) {
  if (typeof random !== 'function') throw new TypeError('Food random source required');
  const colors = ['#ffd35a', '#74dd9a', '#a9a4f2', '#ee9276', '#68c9e8',
    '#ed92cb', '#c0d476', '#e9b78b', '#8ba9e9', '#d6dde3'];
  const palettes = colors.map((color, palette) => {
    const families = ['body', 'outline', 'glow'].map(kind => Array.from({ length: 8 }, (_, index) => {
      const source = realm.document.createElement('canvas');
      source.width = 15 + 4 * index;
      source.height = 13 + 2 * index;
      const context = source.getContext('2d');
      context.fillStyle = kind === 'outline' ? '#17202a' : color;
      context.globalAlpha = kind === 'glow' ? 0.25 : 1;
      context.beginPath();
      context.arc(source.width / 2, source.height / 2, Math.max(1, source.height / 2 - (kind === 'body' ? 2 : 0)), 0, Math.PI * 2);
      context.fill();
      return Object.freeze({
        asset: Object.freeze({ source, kind: 'canvas', status: 'ready', revision: 'synthetic-food-1',
          width: source.width, height: source.height }),
        width: source.width, height: source.height, halfWidth: source.width / 2, halfHeight: source.height / 2,
      });
    }));
    return Object.freeze({ color: palette, count: 8, bodies: Object.freeze(families[0]),
      outlines: Object.freeze(families[1]), glows: Object.freeze(families[2]) });
  });
  return request => {
    const palette = palettes[request.palette];
    if (!palette) throw new RangeError('Unsupported synthetic food palette');
    return { randomPhaseUnit: random(), randomWobbleUnit: random(), palette };
  };
}
