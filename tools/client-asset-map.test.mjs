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
        moveTo(...args) { commands.push(['moveTo', ...args]); },
        lineTo(...args) { commands.push(['lineTo', ...args]); },
        closePath() { commands.push(['closePath']); },
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

test('asset map preserves the authored palettes and returns ready tile and 512-square backdrop images', async () => {
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
  assert.notEqual(assets.background, assets.backgroundImage);
  assert.notEqual(assets.background.src, assets.backgroundImage.src);
  for (const [image, width, height] of [[assets.background, 324, 192], [assets.backgroundImage, 512, 512]]) {
    assert(image instanceof f.realm.HTMLImageElement);
    assert.equal(image.complete, true);
    assert.deepEqual([image.naturalWidth, image.naturalHeight], [width, height]);
    assert.deepEqual([f.encoded.get(image.src).width, f.encoded.get(image.src).height], [width, height]);
  }
  const backdrop = f.encoded.get(assets.backgroundImage.src);
  assert.deepEqual(backdrop.commands, [['fillRect', '#34475b', 0, 0, 512, 512]]);
  assert.equal(f.images.length, 2);
});

test('hex tile uses finite closed polygons and repeats matching artwork across both seams', async () => {
  const f = fixture(), assets = await createClientAssetMap({ realm: f.realm });
  const tile = f.encoded.get(assets.background.src), paths = [];
  let points, closed;
  for (const [operation, ...args] of tile.commands) {
    switch (operation) {
      case 'beginPath': points = []; closed = false; break;
      case 'moveTo': assert.equal(points.length, 0); points.push(args); break;
      case 'lineTo': assert(points.length > 0); points.push(args); break;
      case 'closePath': closed = true; break;
      case 'fill':
        assert.equal(closed, true); assert.equal(points.length, 6);
        assert(points.every(point => point.length === 2 && point.every(Number.isFinite)));
        assert.match(args[0], /^#[0-9a-f]{6}$/);
        paths.push({ color: args[0], points });
        break;
      default: assert.fail(`Unexpected tile operation: ${operation}`);
    }
  }
  assert(paths.length > 0);
  const signatures = new Set(paths.map(path => JSON.stringify(path)));
  const wrapped = (path, dx, dy) => signatures.has(JSON.stringify({ color: path.color,
    points: path.points.map(([x, y]) => [x + dx, y + dy]) }));
  for (const [axis, extent] of [[0, tile.width], [1, tile.height]]) {
    const crossing = paths.filter(path => {
      const values = path.points.map(point => point[axis]);
      return Math.min(...values) < 0 && Math.max(...values) > 0;
    });
    assert(crossing.length > 0, 'edge cells must cross the tile boundary');
    for (const path of crossing) {
      assert(wrapped(path, axis === 0 ? extent : 0, axis === 1 ? extent : 0),
        'opposite edges must contain the same translated polygon and shade');
    }
  }
});

test('asset map waits for both generated images before publishing sources', async () => {
  const releases = new Map();
  const f = fixture({ decode: canvas => new Promise(resolve => releases.set(canvas.width, resolve)) });
  let ready = false;
  const pending = createClientAssetMap({ realm: f.realm }).then(assets => { ready = true; return assets; });
  assert.equal(releases.size, 2);
  releases.get(324)();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, false);
  assert.equal(f.images[0].complete, true); assert.equal(f.images[1].complete, false);
  releases.get(512)();
  const assets = await pending;
  assert.equal(ready, true); assert.equal(assets.backgroundImage.complete, true);
});

test('a failed tile or backdrop decode rejects the map', async () => {
  for (const size of [324, 512]) {
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
