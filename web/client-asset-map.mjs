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
  tile.width = 40; tile.height = 40;
  const context = tile.getContext('2d');
  // Leave gaps transparent so the separate dim backdrop remains visible below.
  context.fillStyle = '#263440'; context.fillRect(0, 0, 1, 1);

  const backdrop = createElement('canvas');
  backdrop.width = 512; backdrop.height = 512;
  const backdropContext = backdrop.getContext('2d');
  backdropContext.fillStyle = '#45505d'; backdropContext.fillRect(0, 0, 512, 512);
  backdropContext.fillStyle = '#53606d';
  for (let offset = 64; offset < 512; offset += 64) {
    backdropContext.fillRect(offset, 0, 1, 512);
    backdropContext.fillRect(0, offset, 512, 1);
  }
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
