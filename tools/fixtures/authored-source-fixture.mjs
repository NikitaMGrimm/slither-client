import { createClientAssetMap, authoredPaletteRgb } from './authored-client-asset-map-oracle.mjs';
import { createSyntheticFoodResolver } from './authored-food-source-oracle.mjs';
import { createSyntheticPreyResolver } from './authored-prey-source-oracle.mjs';

// Authored in-memory source recorder. No browser, URL request, pixel read or timers.
export function authoredSourceRealm({ decode, events = [] } = {}) {
  const canvases = [], images = [], encoded = new Map();
  class Canvas {
    #width = 0; #height = 0;
    commands = [];
    get width() { return this.#width; } set width(value) { this.#width = value; events.push(['width', canvases.indexOf(this), value]); }
    get height() { return this.#height; } set height(value) { this.#height = value; events.push(['height', canvases.indexOf(this), value]); }
    getContext(kind) {
      const id = canvases.indexOf(this), canvas = this;
      events.push(['context', id, kind]);
      const call = (name, ...args) => { canvas.commands.push([name, ...args]); events.push([name, id, ...args]); };
      return {
        set fillStyle(value) {
          if (typeof value === 'string') call('fillStyle', value);
          else { canvas.commands.push(['radialGradient', value.circles, value.stops]); events.push(['selectGradient', id]); }
        },
        set globalAlpha(value) { call('globalAlpha', value); },
        createRadialGradient(...circles) {
          events.push(['gradient', id, ...circles]);
          return { circles, stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); events.push(['stop', id, offset, color]); } };
        },
        beginPath() { call('beginPath'); }, arc(...args) { call('arc', ...args); },
        moveTo(...args) { call('moveTo', ...args); }, lineTo(...args) { call('lineTo', ...args); },
        closePath() { call('closePath'); }, fill() { call('fill'); }, fillRect(...args) { call('fillRect', ...args); },
      };
    }
    toDataURL() { const url = `authored-fixture:${canvases.indexOf(this)}`; encoded.set(url, this); events.push(['encode', canvases.indexOf(this)]); return url; }
  }
  class Image {
    complete = false; naturalWidth = 0; naturalHeight = 0;
    constructor() { images.push(this); events.push(['image', images.indexOf(this)]); }
    async decode() {
      const canvas = encoded.get(this.src); if (!canvas) throw new Error('Unknown authored fixture source');
      events.push(['decode', images.indexOf(this)]);
      await decode?.(canvas);
      this.complete = true; this.naturalWidth = canvas.width; this.naturalHeight = canvas.height;
      events.push(['decoded', images.indexOf(this)]);
    }
  }
  const realm = { HTMLCanvasElement: Canvas, HTMLImageElement: Image, Image, document: { createElement(tag) {
    if (tag !== 'canvas') throw new Error('Authored Canvas only');
    const canvas = new Canvas(); canvases.push(canvas); events.push(['canvas', canvases.indexOf(canvas)]); return canvas;
  } } };
  return { realm, canvases, images, encoded, events };
}

const recipe = canvas => ({ width: canvas.width, height: canvas.height,
  halfWidth: canvas.width / 2, halfHeight: canvas.height / 2, commands: canvas.commands });
const f = authoredSourceRealm();
const assets = await createClientAssetMap({ realm: f.realm });
const food = createSyntheticFoodResolver(f.realm, () => .25), prey = createSyntheticPreyResolver(f.realm, () => .25);
const entities = (resolve, count, outlines) => Array.from({ length: count }, (_, palette) => {
  const value = resolve({ palette }).palette;
  return { color: value.color, count: value.count ?? value.bodies.length,
    bodies: value.bodies.map(entry => recipe(entry.asset.source)),
    outlines: outlines ? value.outlines.map(entry => recipe(entry.asset.source)) : [],
    glows: value.glows.map(entry => recipe(entry.asset.source)) };
});
const cached = { schema: 1, paletteRgb: authoredPaletteRgb, palettes: assets.palettes.map(recipe),
  tile: recipe(f.encoded.get(assets.background.src)), backdrop: recipe(f.encoded.get(assets.backgroundImage.src)),
  bodySources: { palettes: assets.bodySources.palettes.map(palette => ({ variants: palette.variants.map(recipe), boostGlow: recipe(palette.boostGlow) })),
    effects: Object.fromEntries(Object.entries(assets.bodySources.effects).map(([key, source]) => [key, recipe(source)])) },
  food: entities(food, 10, true), prey: entities(prey, 9, false) };

/** Explicit test-only copied ABI double from the preserved authored pre-R7 oracle. */
export function authoredSourceRecipesDouble() { return structuredClone(cached); }
