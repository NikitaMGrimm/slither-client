// TEST ONLY: byte-preserved authored pre-R7 source recipe oracle; never shipped as a fallback.
// Original flat prey stand-ins and authored packets. No stock artwork or mappings.
export function createSyntheticPreyResolver(realm, random) {
  if (typeof random !== 'function') throw new TypeError('Prey random source required');
  const colors = ['#ffcf62', '#82d5aa', '#b2a3ef', '#ec957c', '#79c9e4',
    '#df9bc8', '#c3d87a', '#e1b991', '#94b4ea'];
  const palettes = colors.map((color, palette) => {
    const family = (count, glow) => Object.freeze(Array.from({ length: count }, (_, index) => {
      const source = realm.document.createElement('canvas');
      source.width = glow ? 57 + index * 8 : 21 + index * 4;
      source.height = glow ? 53 + index * 6 : 19 + index * 4;
      const context = source.getContext('2d');
      context.fillStyle = color;
      context.globalAlpha = glow ? 0.18 : 1;
      context.beginPath();
      context.arc(source.width / 2, source.height / 2, source.height / (glow ? 2 : 3), 0, 2 * Math.PI);
      context.fill();
      return Object.freeze({
        asset: Object.freeze({ source, kind: 'canvas', status: 'ready', revision: 'synthetic-prey-1',
          width: source.width, height: source.height }),
        width: source.width, height: source.height,
        halfWidth: source.width / 2, halfHeight: source.height / 2,
      });
    }));
    return Object.freeze({ color: palette, bodies: family(4, false), glows: family(3, true) });
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
