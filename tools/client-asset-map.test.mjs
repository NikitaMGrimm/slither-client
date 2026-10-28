import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClientAssetMap } from '../web/client-asset-map.mjs';

test('comparison asset map awaits the explicit factory and preserves its source identities', async () => {
  const realm = {}, random = () => 0.25;
  const sources = { palettes: [{}, {}, {}], background: {}, backgroundImage: {}, adapter: {}, hostAssets: {} };
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const pending = createClientAssetMap({ realm, random, sourceFactory: async options => {
    assert.equal(options.realm, realm); assert.equal(options.random, random);
    await ready;
    return sources;
  } });
  release();
  assert.equal(await pending, sources);
});

test('an explicit broken comparison pack fails instead of creating replacement artwork', async () => {
  await assert.rejects(createClientAssetMap({ realm: {}, sourceFactory: null }), /factory required/);
  await assert.rejects(createClientAssetMap({ realm: {}, sourceFactory: () => ({}) }), /Complete comparison/);
  const failure = new Error('Synthetic private pack unavailable');
  await assert.rejects(createClientAssetMap({ realm: {}, sourceFactory: () => { throw failure; } }), error => error === failure);
});

// Original synthetic Canvas/image doubles record drawing, not browser pixels.
function fixture({ decode } = {}) {
  const canvases = [], images = [], encoded = new Map();
  class Canvas {
    width = 0; height = 0;
    commands = [];
    gradients = [];
    getContext(kind) {
      assert.equal(kind, '2d');
      const canvas = this, commands = this.commands;
      return {
        fillStyle: '#000000',
        createRadialGradient(...coordinates) {
          const gradient = { coordinates, stops: [],
            addColorStop(offset, color) { this.stops.push([offset, color]); },
          };
          canvas.gradients.push(gradient);
          return gradient;
        },
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
  assert.deepEqual(Object.keys(assets).sort(), ['background', 'backgroundImage', 'bodySources', 'palettes']);
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

test('body sources provide three authored seven-variant families and distinct shared effects', async () => {
  const f = fixture(), assets = await createClientAssetMap({ realm: f.realm });
  const { palettes, effects } = assets.bodySources;
  assert.deepEqual(Object.keys(assets.bodySources).sort(), ['effects', 'palettes']);
  assert.equal(palettes.length, 3);
  assert.deepEqual(Object.keys(effects).sort(), ['deathHighlight', 'outline', 'shadow']);
  const sources = [...Object.values(effects)];
  for (const [index, palette] of palettes.entries()) {
    assert.deepEqual(Object.keys(palette).sort(), ['boostGlow', 'variants']);
    assert.equal(palette.variants.length, 7);
    sources.push(...palette.variants, palette.boostGlow);
    const gradients = palette.variants.map(source => source.gradients[0]);
    assert.equal(new Set(gradients.map(gradient => JSON.stringify(gradient.stops))).size, 7);
    for (const gradient of gradients) {
      assert.deepEqual(gradient.coordinates, [25, 23, 0, 32, 32, 31]);
      assert.equal(new Set(gradient.stops.map(([, color]) => color.split(',').slice(0, 3).join(','))).size, 4,
        'body shading must change spatial color, not just uniform opacity');
    }
    const rgb = [[131, 213, 176], [239, 187, 98], [118, 185, 237]][index];
    assert.equal(gradients[3].stops[1][1], `rgba(${rgb.join(',')},1)`, 'middle variant retains the authored hue');
    assert.deepEqual(palette.boostGlow.gradients[0].coordinates, [32, 32, 0, 32, 32, 31]);
  }
  assert.equal(sources.length, 27);
  assert.equal(new Set(sources).size, 27);
  assert.equal(new Set(sources.map(source => JSON.stringify(source.commands))).size, 27);
  for (const source of sources) {
    assert(source instanceof f.realm.HTMLCanvasElement);
    assert.deepEqual([source.width, source.height], [64, 64]);
    assert(!assets.palettes.includes(source));
    assert.equal(source.gradients.length, 1);
    assert.deepEqual(source.commands, [['fillRect', source.gradients[0], 0, 0, 64, 64]]);
  }
});

test('body shading has finite contained gradients, bounded color/alpha and transparent soft edges', async () => {
  const f = fixture(), { bodySources } = await createClientAssetMap({ realm: f.realm });
  const sources = bodySources.palettes.flatMap(palette => [...palette.variants, palette.boostGlow])
    .concat(Object.values(bodySources.effects));
  for (const source of sources) {
    const { coordinates, stops } = source.gradients[0];
    assert.equal(coordinates.length, 6);
    assert(coordinates.every(Number.isFinite));
    const [x0, y0, r0, x1, y1, r1] = coordinates;
    assert(r0 >= 0 && r1 > r0);
    assert(Math.hypot(x0 - x1, y0 - y1) + r0 < r1, 'highlight stays inside the outer circle');
    assert(x1 - r1 > 0 && y1 - r1 > 0 && x1 + r1 < source.width && y1 + r1 < source.height);
    assert(stops.length >= 4);
    const alphas = [];
    let previous = -1;
    for (const [offset, color] of stops) {
      assert(Number.isFinite(offset) && offset >= 0 && offset <= 1 && offset > previous);
      previous = offset;
      const match = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(color);
      assert(match, 'gradient stops use explicit numeric RGBA');
      const channels = match.slice(1).map(Number);
      assert(channels.every(Number.isFinite));
      assert(channels.slice(0, 3).every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255));
      const alpha = channels[3];
      assert(alpha >= 0 && alpha <= 1);
      alphas.push(alpha);
    }
    assert.equal(stops[0][0], 0); assert.equal(stops.at(-1)[0], 1);
    assert(alphas[0] > 0); assert.equal(alphas.at(-1), 0);
    assert(alphas.some(alpha => alpha > 0 && alpha < 1), 'edge fade includes partial coverage');
    assert(alphas.every((alpha, index) => index === 0 || alpha <= alphas[index - 1]));
  }
});

test('body sources need only local Canvas artwork and the two existing generated background images', async () => {
  const f = fixture();
  for (const capability of ['fetch', 'WebSocket', 'XMLHttpRequest']) {
    Object.defineProperty(f.realm, capability, { get() { assert.fail(`Unexpected network capability: ${capability}`); } });
  }
  const assets = await createClientAssetMap({ realm: f.realm });
  assert.equal(f.canvases.length, 32);
  assert.equal(f.images.length, 2);
  assert.equal(f.encoded.size, 2);
  assert(f.images.every(image => image.src.startsWith('data:image/png;base64,') && f.encoded.has(image.src)));
  assert(assets.bodySources.palettes.every(palette => palette.variants.every(source => f.canvases.includes(source))));
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
  const sources = assets => assets.bodySources.palettes.flatMap(palette => [...palette.variants, palette.boostGlow])
    .concat(Object.values(assets.bodySources.effects));
  const firstSources = sources(first), secondSources = sources(second);
  assert(firstSources.every(source => !secondSources.includes(source)));
  assert.equal(JSON.stringify(firstSources.map(source => source.commands)),
    JSON.stringify(secondSources.map(source => source.commands)));
});
