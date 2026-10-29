import assert from 'node:assert/strict';
import { createLocalBodyResolver } from '../web/synthetic-body.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';

// Real Wasm + existing providers with authored inert Canvas/source doubles.
// Command/source identity evidence only: no browser, artwork, pixels or sockets.
export function appearancePreviewSmoke(wasm) {
  class CanvasRenderingContext2D {
    images = []; stack = []; calls = []; globalAlpha = 1; transforms = [];
    constructor(canvas) { this.canvas = canvas; }
    save() { this.stack.push({ alpha: this.globalAlpha, transforms: this.transforms.slice() }); }
    restore() { const value = this.stack.pop(); this.globalAlpha = value.alpha; this.transforms = value.transforms; }
    setTransform(...args) { this.transforms = [['setTransform', ...args]]; }
    translate(...args) { this.transforms.push(['translate', ...args]); }
    rotate(...args) { this.transforms.push(['rotate', ...args]); }
    scale(...args) { this.transforms.push(['scale', ...args]); }
    beginPath() {} arc() {} moveTo() {} lineTo() {} closePath() {}
    fill() { this.calls.push({ kind: 'fill', alpha: this.globalAlpha }); } stroke() {}
    drawImage(source, ...args) {
      const image = { source, args, alpha: this.globalAlpha, transforms: this.transforms.slice() };
      this.images.push(image); this.calls.push({ kind: 'image', ...image }); this.onImage?.(source);
    }
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
    canvas.width = width; canvas.height = height; canvas.context.images = []; canvas.context.calls = []; canvas.context.save();
    return Object.freeze({ context: canvas.context, finish() { finished++; canvas.context.restore(); } });
  };
  let local, stock;
  try {
    local = new wasm.AppearancePreview(true); stock = new wasm.AppearancePreview(false);
    // Both records cross host boundaries; inherited setters must never run under the Rust borrow.
    const requestKeys = ['skin', 'customBytes', 'own', 'cosmetic', 'x', 'y'];
    const viewKeys = ['schema', 'revision', 'changed', 'width', 'height', 'visible', 'statusText'];
    for (const mode of ['setter', 'nonwritable']) {
      const keys = [...requestKeys, ...viewKeys];
      const prior = keys.map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]);
      const ticket = local.select(1, new Uint8Array());
      let writes = 0, request, view;
      try {
        for (const key of keys) Object.defineProperty(Object.prototype, key, mode === 'setter'
          ? { configurable: true, set() { writes++; } }
          : { configurable: true, writable: false, value: 'inherited' });
        view = local.render(ticket, target, world, value => { request = value; return { status: 'pending' }; }, prepare);
      } finally {
        for (const [key, descriptor] of prior) {
          if (descriptor) Object.defineProperty(Object.prototype, key, descriptor); else delete Object.prototype[key];
        }
      }
      equal(writes, 0); equal(prepared, 0); equal(view.visible, false); equal(local.needs_draw(ticket), true);
      for (const [record, fields] of [[request, requestKeys], [view, viewKeys]]) {
        equal(Object.getPrototypeOf(record), null); equal(Object.isFrozen(record), true);
        equal(Object.keys(record).sort(), [...fields].sort());
        for (const key of fields) equal(Object.hasOwn(Object.getOwnPropertyDescriptor(record, key), 'value'), true);
      }
      equal(request.skin, 1); equal(request.own, false); equal(request.customBytes.length, 0);
    }
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
      try { equal(stock.render(ticket, target, world, request => {
        equal(request.own, true); return adapter.resolveRecipe(request);
      }, prepare).visible, true); }
      finally { adapter.endOperation(); }
      equal(target.context.images.length > 0, true); equal(target.context.stack.length, 0);
    }
    // Synthetic selected ID only, not stock catalog data. Each adapter retains one selection.
    const chosen = ready(), explicit = { forward: -0, imageScale: .375, pivotX: 3, pivotY: 7 };
    const snapshot = { revision: 'accessory-capture-1', normalGameplay: true, ownAccessory: 71, host, readiness,
      ownAccessorySelection: { id: 71, geometry: explicit, source: chosen, width: 64, height: 64 } };
    const selectedAdapter = createStockSkinAdapter({ resolveSkin: wasm.resolve_skin,
      validateCustomPaletteMask: wasm.stock_custom_palette_mask_valid, resolveAccessoryForward: wasm.stock_accessory_forward,
      realm, appearanceMode: 'accessory', readSnapshot: () => snapshot, random() { random++; return .5; } });
    const custom = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2);
    for (const [skin, bytes] of [[0, new Uint8Array()], [24, new Uint8Array()], [40, new Uint8Array()], [41, new Uint8Array()], [27, custom]]) {
      const ticket = stock.select(skin, bytes); selectedAdapter.beginOperation(); let reads = 0;
      try { equal(stock.render(ticket, target, world, request => {
        reads++; equal(request.own, true); equal(request.cosmetic, 0);
        const value = selectedAdapter.resolveRecipe(request);
        equal(value.recipe.attachment.asset.source, chosen);
        equal(Object.is(value.recipe.attachment.forward, -0), true);
        return value;
      }, prepare).visible, true); }
      finally { selectedAdapter.endOperation(); }
      equal(reads, 1); equal(target.context.stack.length, 0);
      const image = target.context.images.filter(row => row.source === chosen); equal(image.length, 1);
      equal(image[0].args, [+0, +0, 64, 64, -1.125, -2.625, 24, 24]);
      equal(image[0].alpha, 1);
      equal(image[0].transforms, [['setTransform', 1, 0, 0, 1, 0, 0], ['translate', 280, 64], ['rotate', 0]]);
      const at = target.context.calls.findIndex(row => row.source === chosen);
      if (skin === 40) {
        equal(target.context.calls.slice(at + 1).filter(row => row.kind === 'image').map(row => row.source), [host.ecmc, host.ecmc, host.jmou]);
        equal(target.context.images.slice(-3).map(row => row.alpha), [1, 1, 1]);
      } else {
        equal(target.context.calls.slice(at + 1).some(row => row.kind === 'fill'), false, 'paired eyes precede accessory');
        if (skin === 41) equal(target.context.images.slice(-2).map(row => row.source), [host.sest, host.sest]);
      }
    }
    let ticket = stock.select(27, new Uint8Array()); selectedAdapter.beginOperation();
    try { const before = prepared; rejects(() => stock.render(ticket, target, world, selectedAdapter.resolveRecipe, prepare));
      equal(prepared, before); equal(stock.needs_draw(ticket), true); }
    finally { selectedAdapter.endOperation(); }
    const chosenCommitment = readiness.find(entry => entry.source === chosen);
    chosenCommitment.revision = 'selected-content-next'; snapshot.revision = 'accessory-capture-2';
    ticket = stock.select(0, new Uint8Array()); selectedAdapter.beginOperation();
    try { equal(stock.render(ticket, target, world, request => {
      const value = selectedAdapter.resolveRecipe(request);
      equal(value.recipe.attachment.asset.source, chosen);
      equal(value.recipe.attachment.asset.revision, 'selected-content-next'); return value;
    }, prepare).visible, true); }
    finally { selectedAdapter.endOperation(); }
    chosenCommitment.state = 'pending';
    const beforePending = prepared; rejects(() => selectedAdapter.beginOperation()); equal(prepared, beforePending);
    chosenCommitment.state = 'ready';
    // Cached selection keeps its session fields; only the Rust appearance forward varies.
    const cachedSnapshot = { ...snapshot, ownAccessorySelection: null, ownCachedAccessorySelection: {
      ...snapshot.ownAccessorySelection, geometry: { imageScale: .375, pivotX: 3, pivotY: 7 } } };
    const cached = createStockSkinAdapter({ resolveSkin: wasm.resolve_skin,
      validateCustomPaletteMask: wasm.stock_custom_palette_mask_valid, resolveAccessoryForward: wasm.stock_accessory_forward,
      realm, appearanceMode: 'accessory', readSnapshot: () => cachedSnapshot, random() { random++; return .5; } });
    for (const skin of [0, 40, 41]) {
      ticket = stock.select(skin, new Uint8Array()); cached.beginOperation();
      try { equal(stock.render(ticket, target, world, cached.resolveRecipe, prepare).visible, true); }
      finally { cached.endOperation(); }
      const image = target.context.images.find(row => row.source === chosen);
      equal(image.transforms[1], ['translate', 280 + wasm.stock_accessory_forward(skin, new Uint8Array()), 64]);
    }
    // Both targets remain forbidden even when explicitly admitted as the selected source.
    for (const forbidden of [target, world]) {
      const badSnapshot = { ...snapshot, readiness: [...readiness, { source: forbidden, state: 'ready', revision: 'forbidden-1' }],
        ownAccessorySelection: { ...snapshot.ownAccessorySelection, source: forbidden, width: forbidden.width, height: forbidden.height } };
      const bad = createStockSkinAdapter({ resolveSkin: wasm.resolve_skin,
        validateCustomPaletteMask: wasm.stock_custom_palette_mask_valid, realm, appearanceMode: 'accessory',
        readSnapshot: () => badSnapshot, random() { random++; return .5; } });
      ticket = stock.select(1, new Uint8Array()); bad.beginOperation();
      try { const before = prepared; rejects(() => stock.render(ticket, target, world, bad.resolveRecipe, prepare)); equal(prepared, before); }
      finally { bad.endOperation(); }
    }
    ticket = stock.select(2, new Uint8Array()); selectedAdapter.beginOperation();
    try {
      target.context.onImage = source => { if (source === chosen) chosen.width++; };
      rejects(() => stock.render(ticket, target, world, selectedAdapter.resolveRecipe, prepare));
      equal(stock.needs_draw(ticket), true); equal(target.context.stack.length, 0);
    } finally { target.context.onImage = undefined; chosen.width = 64; selectedAdapter.endOperation(); }
    selectedAdapter.beginOperation();
    try {
      let failed = false;
      target.context.onImage = source => { if (source === chosen) throw undefined; };
      try { stock.render(ticket, target, world, selectedAdapter.resolveRecipe, (canvas, width, height) => {
        const frame = prepare(canvas, width, height);
        return Object.freeze({ context: frame.context, finish() { frame.finish(); throw Error('secondary accessory frame finish'); } });
      }); } catch (error) { failed = true; equal(error, undefined); }
      equal(failed, true); equal(stock.needs_draw(ticket), true); equal(target.context.stack.length, 0);
    } finally { target.context.onImage = undefined; selectedAdapter.endOperation(); }
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
