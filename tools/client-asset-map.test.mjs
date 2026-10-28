import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClientAssetMap } from '../web/client-asset-map.mjs';

// Original synthetic Canvas/image doubles record drawing, not browser pixels.
function fixture({ decode } = {}) {
  const canvases = [], images = [], encoded = new Map();
  class Canvas {
    width = 0; height = 0;
    commands = [];
    getContext(kind) {
      assert.equal(kind, '2d');
      const commands = this.commands;
      return {
        fillStyle: '#000000',
        beginPath() { commands.push(['beginPath']); },
        arc(...args) { commands.push(['arc', ...args]); },
        fill() { commands.push(['fill', this.fillStyle]); },
        fillRect(...args) { commands.push(['fillRect', this.fillStyle, ...args]); },
      };
    }
    toDataURL() {
      const url = `data:image/png;base64,synthetic-${canvases.indexOf(this)}`;
      encoded.set(url, this);
      return url;
    }
  }
  class Image {
    complete = false; naturalWidth = 0; naturalHeight = 0;
    constructor() { images.push(this); }
    async decode() {
      const canvas = encoded.get(this.src);
      assert(canvas, 'only locally generated sources may load');
      await decode?.(canvas);
      this.naturalWidth = canvas.width; this.naturalHeight = canvas.height; this.complete = true;
    }
  }
  const realm = { HTMLCanvasElement: Canvas, HTMLImageElement: Image, Image,
    document: { createElement(tag) {
      assert.equal(this, realm.document); assert.equal(tag, 'canvas');
      const canvas = new Canvas(); canvases.push(canvas); return canvas;
    } },
  };
  return { realm, canvases, images, encoded };
}

test('asset map keeps the authored palettes and repeating tile, with a separate ready 512-square backdrop', async () => {
  const f = fixture(), assets = await createClientAssetMap({ realm: f.realm });
  assert.deepEqual(Object.keys(assets).sort(), ['background', 'backgroundImage', 'palettes']);
  assert.equal(assets.palettes.length, 3);
  assert.equal(new Set(assets.palettes).size, 3);
  for (const [index, color] of ['#83d5b0', '#efbb62', '#76b9ed'].entries()) {
    const canvas = assets.palettes[index];
    assert(canvas instanceof f.realm.HTMLCanvasElement);
    assert.deepEqual([canvas.width, canvas.height], [32, 32]);
    assert.deepEqual(canvas.commands, [['beginPath'], ['arc', 16, 16, 16, 0, Math.PI * 2], ['fill', color]]);
  }
  assert.deepEqual(f.encoded.get(assets.background.src).commands, [
    ['fillRect', '#263440', 0, 0, 1, 1],
  ]);
  assert.notEqual(assets.background, assets.backgroundImage);
  assert.notEqual(assets.background.src, assets.backgroundImage.src);
  for (const [image, size] of [[assets.background, 40], [assets.backgroundImage, 512]]) {
    assert(image instanceof f.realm.HTMLImageElement);
    assert.equal(image.complete, true);
    assert.deepEqual([image.naturalWidth, image.naturalHeight], [size, size]);
    assert.deepEqual([f.encoded.get(image.src).width, f.encoded.get(image.src).height], [size, size]);
  }
  const backdrop = f.encoded.get(assets.backgroundImage.src);
  assert.deepEqual(backdrop.commands[0], ['fillRect', '#45505d', 0, 0, 512, 512]);
  assert(backdrop.commands.slice(1).every(([kind, color]) => kind === 'fillRect' && color === '#53606d'));
  assert.equal(f.images.length, 2);
});

test('asset map waits for both generated images before publishing sources', async () => {
  const releases = new Map();
  const f = fixture({ decode: canvas => new Promise(resolve => releases.set(canvas.width, resolve)) });
  let ready = false;
  const pending = createClientAssetMap({ realm: f.realm }).then(assets => { ready = true; return assets; });
  assert.equal(releases.size, 2);
  releases.get(40)();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, false);
  assert.equal(f.images[0].complete, true); assert.equal(f.images[1].complete, false);
  releases.get(512)();
  const assets = await pending;
  assert.equal(ready, true); assert.equal(assets.backgroundImage.complete, true);
});

test('a failed tile or backdrop decode rejects the map', async () => {
  for (const size of [40, 512]) {
    const failure = new Error(`Synthetic decode failure: ${size}`);
    const f = fixture({ decode(canvas) { if (canvas.width === size) throw failure; } });
    await assert.rejects(createClientAssetMap({ realm: f.realm }), error => error === failure);
    assert.equal(f.images.length, 2);
  }
});

test('asset maps create independent source objects for separate local hosts', async () => {
  const f = fixture();
  const first = await createClientAssetMap({ realm: f.realm });
  const second = await createClientAssetMap({ realm: f.realm });
  assert(first.palettes.every((source, index) => source !== second.palettes[index]));
  assert.notEqual(first.background, second.background);
  assert.notEqual(first.backgroundImage, second.backgroundImage);
});
