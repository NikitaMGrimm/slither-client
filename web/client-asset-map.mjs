/** Original Canvas stand-ins for the default local client; no external artwork. */
export async function createClientAssetMap({ realm = globalThis } = {}) {
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
  return { palettes, background, backgroundImage };
}
