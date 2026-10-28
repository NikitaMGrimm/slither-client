/** Default authored artwork, or an explicitly supplied private comparison pack. */
export async function createClientAssetMap({ realm = globalThis, sourceFactory, random } = {}) {
  if (sourceFactory !== undefined) {
    if (typeof sourceFactory !== 'function') throw new TypeError('Comparison source factory required');
    const sources = await sourceFactory({ realm, random });
    if (!Array.isArray(sources?.palettes) || sources.palettes.length !== 3
      || !sources.background || !sources.adapter || !sources.hostAssets) {
      throw new TypeError('Complete comparison source bundle required');
    }
    return sources;
  }
  const createElement = realm.document.createElement.bind(realm.document);
  const decode = realm.HTMLImageElement.prototype.decode;
  const palettes = ['#83d5b0', '#efbb62', '#76b9ed'].map(color => {
    const canvas = createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.beginPath(); context.arc(16, 16, 16, 0, Math.PI * 2); context.fill();
    return canvas;
  });
  const tile = createElement('canvas');
  const cellScale = 3;
  tile.width = 108 * cellScale; tile.height = 64 * cellScale;
  const context = tile.getContext('2d');
  function hexagon(x, y, radius, color) {
    x *= cellScale; y *= cellScale; radius *= cellScale;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(x + radius, y + radius / 4);
    context.lineTo(x + radius / 4, y + radius);
    context.lineTo(x - radius * 3 / 4, y + radius * 3 / 4);
    context.lineTo(x - radius, y - radius / 4);
    context.lineTo(x - radius / 4, y - radius);
    context.lineTo(x + radius * 3 / 4, y - radius * 3 / 4);
    context.closePath(); context.fill();
  }
  // Four staggered columns and two rows repeat exactly at both tile edges.
  // Draw the overlapping edge cells too; gaps retain the dim backdrop below.
  for (let column = 0; column <= 4; column++) {
    for (let row = -1; row <= 2; row++) {
      const x = column * 27, y = row * 32 + (column % 2) * 16;
      hexagon(x, y, 15, '#09131d');
      hexagon(x, y - 0.5, 13.5, '#26384a');
      hexagon(x, y + 0.5, 13, '#1c2b3b');
    }
  }

  const backdrop = createElement('canvas');
  backdrop.width = 512; backdrop.height = 512;
  const backdropContext = backdrop.getContext('2d');
  backdropContext.fillStyle = '#34475b'; backdropContext.fillRect(0, 0, 512, 512);
  function image(canvas) {
    const source = new realm.Image();
    source.src = canvas.toDataURL();
    return source;
  }
  // Keep the repeating tile separate from the optional whole-scene backdrop.
  const background = image(tile), backgroundImage = image(backdrop);
  await Promise.all([background, backgroundImage].map(source => Reflect.apply(decode, source, [])));

  // Authored shaded stand-ins only; these families do not identify stock skins.
  // All sprites share a 64-square frame with transparent margins and soft edges.
  function radialSprite(stops, lightX = 32, lightY = 32) {
    const canvas = createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(lightX, lightY, 0, 32, 32, 31);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return canvas;
  }
  const bodySources = {
    palettes: ['#83d5b0', '#efbb62', '#76b9ed'].map(color => {
      const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
      function shade(amount, alpha = 1) {
        const channels = rgb.map(channel => Math.round(amount < 0
          ? channel * (1 + amount) : channel + (255 - channel) * amount));
        return `rgba(${channels.join(',')},${alpha})`;
      }
      return {
        // Vary tone while keeping the silhouette and upper-left light fixed.
        variants: Array.from({ length: 7 }, (_, index) => {
          const tone = (index - 3) * 0.045;
          return radialSprite([
            [0, shade(tone + 0.3)], [0.42, shade(tone)],
            [0.82, shade(tone - 0.28)], [0.96, shade(tone - 0.48, 0.9)],
            [1, shade(tone - 0.48, 0)],
          ], 25, 23);
        }),
        boostGlow: radialSprite([
          [0, shade(0.2, 0.68)], [0.2, shade(0.2, 0.55)],
          [0.58, shade(0.1, 0.2)], [0.85, shade(0, 0.04)], [1, shade(0, 0)],
        ]),
      };
    }),
    effects: {
      outline: radialSprite([
        [0, 'rgba(23,34,45,1)'], [0.88, 'rgba(23,34,45,1)'],
        [0.95, 'rgba(23,34,45,0.7)'], [1, 'rgba(23,34,45,0)'],
      ]),
      shadow: radialSprite([
        [0, 'rgba(0,0,0,0.55)'], [0.52, 'rgba(0,0,0,0.42)'],
        [0.8, 'rgba(0,0,0,0.16)'], [1, 'rgba(0,0,0,0)'],
      ]),
      deathHighlight: radialSprite([
        [0, 'rgba(255,255,255,0.9)'], [0.45, 'rgba(255,255,255,0.48)'],
        [0.9, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)'],
      ], 25, 23),
    },
  };
  return { palettes, background, backgroundImage, bodySources };
}
