import assert from 'node:assert/strict';
import { createLocalBodyResolver } from '../web/synthetic-body.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';

// Real Wasm + existing providers with authored inert Canvas/source doubles.
// Command/source identity evidence only: no browser, artwork, pixels or sockets.
export function appearancePreviewSmoke(wasm) {
  class CanvasRenderingContext2D {
    images = []; stack = []; calls = []; globalAlpha = 1;
    constructor(canvas) { this.canvas = canvas; }
    save() { this.stack.push(this.globalAlpha); }
    restore() { this.globalAlpha = this.stack.pop(); }
    setTransform() {} translate() {} rotate() {} scale() {}
    beginPath() {} arc() {} moveTo() {} lineTo() {} closePath() {} fill() {} stroke() {}
    drawImage(source, ...args) { this.images.push({ source, args }); this.onImage?.(); }
  }
  class HTMLCanvasElement {
    #width = 64; #height = 64;
    constructor() { this.context = new CanvasRenderingContext2D(this); }
    get width() { return this.#width; } set width(value) { this.#width = value; }
    get height() { return this.#height; } set height(value) { this.#height = value; }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  }
  class HTMLImageElement { complete = true; naturalWidth = 64; naturalHeight = 64; }
  const realm = { HTMLCanvasElement, HTMLImageElement };
  const globals = Object.entries({ ...realm, CanvasRenderingContext2D }).map(([name, value]) => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); return [name, prior];
  });
  let assertions = 0, prepared = 0, finished = 0;
  const equal = (actual, expected) => { assertions++; assert.deepEqual(actual, expected); };
  const rejects = callback => { assertions++; assert.throws(callback); };
  const source = () => new HTMLCanvasElement();
  const target = source(), world = source();
  const prepare = (canvas, width, height) => {
    equal(canvas, target); equal([width, height], [320, 128]); prepared++;
    canvas.width = width; canvas.height = height; canvas.context.images = []; canvas.context.save();
    return Object.freeze({ context: canvas.context, finish() { finished++; canvas.context.restore(); } });
  };
  let local, stock;
  try {
    local = new wasm.AppearancePreview(true); stock = new wasm.AppearancePreview(false);
    const bodySources = {
      palettes: Array.from({ length: 3 }, () => ({ variants: Array.from({ length: 7 }, source), boostGlow: source() })),
      effects: { outline: source(), shadow: source(), deathHighlight: source() },
    };
    const resolveLocal = createLocalBodyResolver(bodySources, realm, wasm.resolve_local_skin);
    const bytes = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2);
    let revision = local.select(1, bytes), reads = 0;
    equal(local.needs_draw(revision), true); bytes[9] = 1;
    const result = local.render(revision, target, world, request => {
      reads++; equal(request.own, false); equal(request.cosmetic, 0); equal(request.customBytes[9], 0);
      equal(Object.hasOwn(request, 'id'), false); return resolveLocal(request);
    }, prepare);
    equal(result.visible, true); equal(Object.isFrozen(result), true); equal(local.needs_draw(revision), false);
    const selected = [0, 2].map(index => bodySources.palettes[index].variants[0]);
    for (const expected of selected) equal(target.context.images.some(command => command.source === expected), true);
    equal(local.render(revision, target, world, () => assert.fail('drawn ticket read a source'), prepare).changed, false);
    equal(reads, 1);
    revision = local.select(2, new Uint8Array());
    for (const status of ['pending', 'unsupported']) {
      const count = prepared;
      equal(local.render(revision, target, world, () => ({ status }), prepare).visible, false);
      equal(prepared, count); equal(local.needs_draw(revision), true);
    }
    rejects(() => local.render(revision - 1n, target, world, resolveLocal, prepare));
    rejects(() => local.render(revision, world, world, resolveLocal, prepare));
    rejects(() => local.select(3, new Uint8Array())); equal(local.revision(), revision);
    const aliased = { ...bodySources, palettes: bodySources.palettes.map((palette, index) => index === 2
      ? { ...palette, variants: palette.variants.map(() => world) } : palette) };
    const aliasResolver = createLocalBodyResolver(aliased, realm, wasm.resolve_local_skin), beforeAlias = prepared;
    rejects(() => local.render(revision, target, world, aliasResolver, prepare)); equal(prepared, beforeAlias);
    let threw = false;
    target.context.onImage = () => { throw undefined; };
    try {
      local.render(revision, target, world, resolveLocal, (canvas, width, height) => {
        const frame = prepare(canvas, width, height);
        return Object.freeze({ context: frame.context, finish() { frame.finish(); throw new Error('secondary finish'); } });
      });
    } catch (error) { threw = true; equal(error, undefined); }
    equal(threw, true); equal(local.needs_draw(revision), true); equal(target.context.stack.length, 0);
    target.context.onImage = undefined;

    // Synthetic ready full stock source route, separate from the three local families.
    const readiness = [];
    const ready = () => { const value = source(); readiness.push({ source: value, state: 'ready', revision: readiness.length + 1 }); return value; };
    const host = { nsr: false, alcsc: Uint8Array.from({ length: 256 }, (_, id) => Number(id <= 35 || [37, 39, 41].includes(id))),
      per_color_imgs: Array.from({ length: 42 }, (_, id) => ({ klp: id !== 36,
        kmcs: Array.from({ length: id === 36 ? 60 : 7 }, ready), kfmc: ready() })) };
    for (const name of ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'kwkbulb', 'pwdbulb', 'playbulb',
      'leafbulb', 'swissbulb', 'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest',
      'jsebi', 'jsepi', 'ecmc', 'jmou']) host[name] = ready();
    host.ecmc.width = 48; host.ecmc.height = 48;
    host.jmou.width = 79; host.jmou.height = 130;
    let random = 0;
    const adapter = createStockSkinAdapter({ resolveSkin: wasm.resolve_skin,
      validateCustomPaletteMask: wasm.stock_custom_palette_mask_valid, realm, readSnapshot: () => ({ revision: 1,
      normalGameplay: true, ownAccessory: -1, host, readiness }), random() { random++; return 0.5; } });
    for (let skin = 0; skin <= 65; skin++) {
      const ticket = stock.select(skin, new Uint8Array()); adapter.beginOperation();
      try { equal(stock.render(ticket, target, world, adapter.resolveRecipe, prepare).visible, true); }
      finally { adapter.endOperation(); }
      equal(target.context.images.length > 0, true); equal(target.context.stack.length, 0);
    }
    equal(random, 0); equal(prepared, finished);
    return { assertions, synthetic: true, browser: false, pixels: false, network: false };
  } finally {
    try { local?.free(); } finally {
      try { stock?.free(); } finally {
        for (const [name, prior] of globals) {
          if (prior) Object.defineProperty(globalThis, name, prior); else delete globalThis[name];
        }
      }
    }
  }
}
