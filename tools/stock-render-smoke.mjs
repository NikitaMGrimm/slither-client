import assert from 'node:assert/strict';
import { Path2D, recordPatternPath } from './pattern-path-fixture.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockEntityAssets } from '../web/stock-food-provider.mjs';
import { createStockGameplay } from '../web/stock-gameplay.mjs';
import { createStockSession } from '../web/stock-session.mjs';
import { projectHudView } from '../web/stock-hud-view.mjs';
import { bindStockHudDom } from '../web/stock-hud-dom.mjs';
import { syntheticChallenge } from './reference-parity.mjs';

// Original authored synthetic packets, live-source doubles and Canvas command
// recorder. This exercises real Wasm, without raster pixels or a host runtime.
const u16 = value => [value >>> 8 & 255, value & 255];
const u24 = value => [value >>> 16 & 255, value >>> 8 & 255, value & 255];
const center = 32550;
const absolute = value => u24(Math.round((center + value) * 5));
const bundle = (...commands) => Uint8Array.from(commands.flatMap(command => [...u16(command.length), ...command]));
const setup = () => [97, ...u24(center), ...u16(430), ...u16(300), ...u16(217),
  48, ...u16(539), ...u16(40), ...u16(1400), ...u16(33), ...u16(28), ...u16(430),
  19, 42, ...u16(1), ...u24(1000)];
function snake(id, skin, x = 0, y = 0, custom = []) {
  return [115, ...u16(id), ...u24(0), 48, ...u24(0), ...u16(128), ...u24(0), skin,
    ...absolute(x), ...absolute(y), 0, custom.length, ...custom, 0,
    ...absolute(x - 122), ...absolute(y), ...Array.from({ length: 10 }, () => [143, 127]).flat(), ...u16(0)];
}
const food = (offset = 128) => [70, 108, 108, 0, offset, 128, 20];
const prey = id => [121, ...u16(id), 0, ...absolute(15), ...absolute(-10), 20, 48,
  ...u24(0), ...u24(0), ...u16(1000)];
const custom = [3, 8, 1, 42, 9, 0, 201, 7, 2, 0];

/** Exercise actual stock adapters/controller through an initialized Wasm module. */
export function stockRenderSmoke(wasm, { control = true } = {}) {
  if (typeof control !== 'boolean') throw new TypeError('Explicit stock smoke control boolean required');
  if (control && typeof wasm.AnimatedScene?.prototype.advance_with_control !== 'function') {
    throw new Error('Stock smoke requires native advance_with_control; use explicit source-only mode for older candidates');
  }
  let assertions = 0;
  const cases = [];
  const eq = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
  const ok = (value, message) => { assertions++; assert.ok(value, message); };
  const rejects = (callback, match, message) => { assertions++; assert.throws(callback, match, message); };

  // Original fixed-tree capability doubles; no real Document or browser is used.
  function hudTree(beforeWrite) {
    const metadata = new WeakMap(), styleData = new WeakMap(), writes = [];
    const data = node => {
      if (!metadata.has(node)) throw new TypeError('Authored HUD Node receiver');
      return metadata.get(node);
    };
    const make = (type, name, document, value = '') => {
      const node = Object.create(null), style = Object.create(null);
      metadata.set(node, { type, name, document, value, parent: null, children: [], style });
      styleData.set(style, new Map());
      return node;
    };
    const document = make(9, null, null);
    const element = name => make(1, name, document);
    const children = (parent, nodes) => {
      data(parent).children = nodes;
      for (const node of nodes) data(node).parent = parent;
    };
    const atom = (name, label) => {
      const result = { element: element(name), text: make(3, null, document, label) };
      children(result.element, [result.text]); return result;
    };
    const mount = element('section'); children(document, [mount]);
    const readout = { root: element('div'), lengthLine: element('div'), rankLine: element('div'),
      lengthLabel: atom('span', 'authored length'), lengthValue: atom('b', 'unwritten'),
      rankLabel: atom('span', 'authored rank'), rankValue: atom('span', 'unwritten'),
      separator: atom('span', 'authored separator'), populationValue: atom('span', 'unwritten') };
    const final = { root: element('div'), label: atom('span', 'authored final'), value: atom('b', 'unwritten') };
    children(readout.root, [readout.lengthLine, readout.rankLine]);
    children(readout.lengthLine, [readout.lengthLabel.element, readout.lengthValue.element]);
    children(readout.rankLine, [readout.rankLabel.element, readout.rankValue.element,
      readout.separator.element, readout.populationValue.element]);
    children(final.root, [final.label.element, final.value.element]);
    children(mount, [readout.root, final.root]);
    const dom = {
      nodeType: node => data(node).type, ownerDocument: node => data(node).document,
      parentNode: node => data(node).parent, firstChild: node => data(node).children[0] ?? null,
      nextSibling(node) {
        const parent = data(node).parent;
        if (parent === null) return null;
        const siblings = data(parent).children;
        return siblings[siblings.indexOf(node) + 1] ?? null;
      },
      isConnected(node) { data(node); return true; },
      localName: node => data(node).name,
      namespaceURI(node) { data(node); return 'http://www.w3.org/1999/xhtml'; },
      style: node => data(node).style,
      setText(node, value) {
        beforeWrite(); eq(data(node).type, 3); data(node).value = value;
        writes.push(['text', node, value]);
      },
      setStyle(style, property, value) {
        beforeWrite(); ok(styleData.has(style)); styleData.get(style).set(property, value);
        writes.push(['style', style, property, value]);
      },
    };
    return { dom, nodes: { schema: 1, document, mount, textPolicy: 'authored', readout, final },
      readout, final, writes, text: node => data(node).value,
      style: (node, property) => styleData.get(data(node).style).get(property) };
  }

  class CanvasRenderingContext2D {
    trace = []; stack = []; alpha = 1; blend = 'source-over'; transforms = []; path = [];
    fillStyle = '#000000'; strokeStyle = '#000000'; lineWidth = 1; lineCap = 'butt'; lineJoin = 'miter';
    failSource = null;
    reset() {
      this.trace.push({ op: 'reset' }); this.stack = []; this.alpha = 1; this.blend = 'source-over';
      this.transforms = []; this.path = []; this.fillStyle = '#000000'; this.strokeStyle = '#000000';
      this.lineWidth = 1; this.lineCap = 'butt'; this.lineJoin = 'miter';
    }
    get globalAlpha() { return this.alpha; }
    set globalAlpha(value) {
      if (Number.isFinite(value) && value >= 0 && value <= 1) this.alpha = value;
      this.trace.push({ op: 'alpha', requested: value, effective: this.alpha });
    }
    get globalCompositeOperation() { return this.blend; }
    set globalCompositeOperation(value) { this.blend = value; }
    state() {
      return { alpha: this.alpha, blend: this.blend, transforms: this.transforms.slice(),
        fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
        lineCap: this.lineCap, lineJoin: this.lineJoin };
    }
    save() { this.stack.push(this.state()); }
    restore() { assert.ok(this.stack.length > 0, 'Canvas restore must balance a save'); Object.assign(this, this.stack.pop()); }
    setTransform(...values) { this.transforms = [['identity', ...values]]; }
    translate(...values) { this.transforms.push(['translate', ...values]); }
    scale(...values) { this.transforms.push(['scale', ...values]); }
    rotate(...values) { this.transforms.push(['rotate', ...values]); }
    createPattern(source, repetition) { return { source, repetition }; }
    fillRect(...args) { this.trace.push({ op: 'rect', args }); }
    beginPath() { this.path = []; }
    arc(...args) { this.path.push(['arc', ...args]); }
    moveTo(...args) { this.path.push(['move', ...args]); }
    lineTo(...args) { this.path.push(['line', ...args]); }
    closePath() { this.path.push(['close']); }
    fill(path) { if (recordPatternPath(this, path)) return; this.trace.push({ op: 'fill', path: this.path.slice(), ...this.state() }); }
    stroke() { this.trace.push({ op: 'stroke', path: this.path.slice(), ...this.state() }); }
    drawImage(source, ...args) {
      if (source === this.failSource) throw new Error('Authored stock Canvas image fault');
      assert.ok(source instanceof HTMLCanvasElement || source instanceof HTMLImageElement, 'Existing exact raster source required');
      assert.ok([2, 4, 8].includes(args.length) && args.every(Number.isFinite), 'Supported finite image overload');
      this.trace.push({ op: 'image', source, args, ...this.state() });
    }
  }
  class HTMLCanvasElement {
    #width; #height;
    context = new CanvasRenderingContext2D();
    constructor(name, width = 48, height = 48) {
      this.name = name; this.#width = width; this.#height = height; this.context.canvas = this;
    }
    get width() { return this.#width; }
    set width(value) { this.#width = value; this.context.reset(); }
    get height() { return this.#height; }
    set height(value) { this.#height = value; this.context.reset(); }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  }
  class HTMLImageElement {
    #width; #height; #complete;
    constructor(name, width = 48, height = 48, complete = true) {
      this.name = name; this.#width = width; this.#height = height; this.#complete = complete;
    }
    get naturalWidth() { return this.#width; }
    get naturalHeight() { return this.#height; }
    get complete() { return this.#complete; }
  }
  const realm = { HTMLCanvasElement, HTMLImageElement, CanvasRenderingContext2D, Path2D };
  const globals = new Map(Object.entries(realm).map(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    return [key, descriptor];
  }));

  function fixture() {
    const readiness = [];
    const source = (name, width = 48, height = 48, image = false) => {
      const object = image ? new HTMLImageElement(name, width, height) : new HTMLCanvasElement(name, width, height);
      readiness.push({ source: object, state: 'ready', revision: `authored-content:${readiness.length}` });
      return object;
    };
    const host = { nsr: false,
      alcsc: Uint8Array.from({ length: 256 }, (_, index) => Number(index <= 35 || [37, 39, 41].includes(index))),
      per_color_imgs: Array.from({ length: 42 }, (_, color) => ({ klp: color !== 36,
        kmcs: Array.from({ length: color === 36 ? 60 : 7 }, (_, index) => source(`body:${color}:${index}`)),
        kfmc: source(`boost:${color}`) })) };
    for (const slot of ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'kwkbulb', 'pwdbulb', 'playbulb',
      'leafbulb', 'swissbulb', 'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest']) {
      host[slot] = source(slot, 48, 48, slot === 'sest');
    }
    host.jsebi = source('jsebi', 64, 64);
    host.jsepi = source('jsepi', 48, 48);
    host.ecmc = source('ecmc', 48, 48);
    host.jmou = source('jmou', 79, 130);
    for (let color = 0; color <= 9; color++) {
      const entry = host.per_color_imgs[color]; entry.ic = 2;
      for (const [family, width, height, halfWidth, halfHeight, count] of [
        ['imgs', 'fws', 'fhs', 'fw2s', 'fh2s', 2], ['oimgs', 'ofws', 'ofhs', 'ofw2s', 'ofh2s', 2],
        ['gimgs', 'gfws', 'gfhs', 'gfw2s', 'gfh2s', 3], ['pr_imgs', 'pr_fws', 'pr_fhs', 'pr_fw2s', 'pr_fh2s', 4],
      ]) {
        for (const key of [family, width, height, halfWidth, halfHeight]) entry[key] = [];
        for (let index = 0; index < count; index++) {
          entry[family].push(source(`${family}:${color}:${index}`, 48, 48, family === 'pr_imgs' && index === 1));
          entry[width].push(43.5 + index); entry[height].push(41.25 + index);
          entry[halfWidth].push(index === 0 ? -0 : 20.125 + index); entry[halfHeight].push(19.75 + index);
        }
      }
    }
    // One authored exact object intentionally crosses body, food and prey pools.
    const shared = host.per_color_imgs[0].kmcs[0];
    host.per_color_imgs[0].gimgs.fill(shared);
    const target = new HTMLCanvasElement('target', 960, 540);
    const background = new HTMLImageElement('background', 32, 32);
    let raw = { revision: 1, normalGameplay: true, ownAccessory: -1, host, readiness };
    let held = null;
    const events = [], recipes = [], foods = [], preys = [], tapes = [], steps = [];
    let captures = 0, ends = 0, units = 0;
    const random = () => { units++; return (units % 32) / 32; };
    const actualAdapter = createStockSkinAdapter({ realm, random, readSnapshot() {
      assert.equal(held, null, 'No stale held capture'); captures++; held = raw; events.push('capture'); return held;
    } });
    const adapter = {
      beginOperation: () => actualAdapter.beginOperation(),
      endOperation() { try { return actualAdapter.endOperation(); } finally { held = null; ends++; events.push('end'); } },
      resolveAppearance: request => actualAdapter.resolveAppearance(request),
      resolveRecipe(request) {
        assert.equal(held, raw); const result = actualAdapter.resolveRecipe(request);
        recipes.push({ request, result }); return result;
      },
      resolveAntennaRandom(request) {
        const result = actualAdapter.resolveAntennaRandom(request); tapes.push({ request, result }); return result;
      },
    };
    const entities = createStockEntityAssets({ realm, random, snapshotForOperation(operation) {
      assert.notEqual(held, null, 'Factory must use held skin capture'); assert.equal(held, raw);
      assert.ok(Object.is(operation.revision, held.revision)); events.push('entity-held'); return held;
    } });
    const hostAssets = {
      resolveFood(request, operation) { const result = entities.resolveFood(request, operation); foods.push({ request, result }); return result; },
      resolvePrey(request, operation) { const result = entities.resolvePrey(request, operation); preys.push({ request, result }); return result; },
    };
    const scene = new wasm.AnimatedScene(0);
    const quality = new wasm.DesktopQuality(1, 0);
    quality.begin_connection();
    for (const name of ['advance', 'advance_with_control']) {
      if (typeof scene[name] !== 'function') continue;
      const actual = scene[name].bind(scene);
      scene[name] = (...args) => {
        events.push(name); const step = actual(...args);
        const record = { step, delta: step.delta, freed: false }; steps.push(record);
        const free = step.free.bind(step);
        step.free = () => { assert.equal(record.freed, false, 'One owned step free'); free(); record.freed = true; events.push('free'); };
        return step;
      };
    }
    for (const name of ['apply_frame_and_render_standard_with_face_presentation_and_prey', 'render_standard_with_face_presentation_at_size']) {
      const actual = scene[name].bind(scene);
      scene[name] = (...args) => { events.push(name.startsWith('apply') ? 'packet' : 'render'); return actual(...args); };
    }
    const qualityAdvance = quality.advance.bind(quality), statistics = quality.update_statistics.bind(quality);
    quality.advance = (step, playing) => {
      assert.equal(step, steps.at(-1).step, 'Quality borrows the actual returned step');
      assert.equal(steps.at(-1).freed, false); events.push('quality'); return qualityAdvance(step, playing);
    };
    quality.update_statistics = (...args) => { events.push(['statistics', ...args]); return statistics(...args); };
    const client = createStockClient({ scene, quality, adapter, hostAssets, target,
      palettes: host.per_color_imgs.slice(0, 3).map(entry => entry.kmcs[0]), background, width: 960, height: 540 });
    return { client, scene, quality, target, host, readiness, shared, recipes, foods, preys, tapes, steps, events,
      get captures() { return captures; }, get ends() { return ends; }, get held() { return held; }, get units() { return units; },
      get raw() { return raw; },
      churn() { host.leafbulb = source('replacement-unrelated-bulb'); raw = { ...raw, revision: raw.revision + 1 }; },
      changeContent() { readiness.find(entry => entry.source === shared).revision = 'authored-content:changed'; raw = { ...raw, revision: raw.revision + 1 }; },
      state() { return [scene.snapshot(), scene.food_state(), scene.prey_state()]; },
      images() { return target.context.trace.filter(command => command.op === 'image'); },
      resets() { return target.context.trace.filter(command => command.op === 'reset').length; },
      close() { client.dispose(); scene.free(); quality.free(); },
    };
  }
  function checkOperation(f, callback) {
    const before = f.captures, ends = f.ends;
    const result = callback();
    eq(f.captures, before + 1, 'Exactly one raw capture per draw/packet operation');
    eq(f.ends, ends + 1, 'Release exactly the operation that captured');
    eq(f.held, null); eq(f.target.context.stack.length, 0, 'Balanced native Canvas scopes');
    return result;
  }
  const seed = f => checkOperation(f, () => f.client.packet(bundle(setup(), snake(0, 0),
    snake(7, 25, 45, 35), snake(8, 27, -50, 25), snake(9, 27, 20, -40, custom),
    snake(10, 40, -20, -35, custom), snake(11, 41, 70, -20), food(), prey(31), setup())));
  try {
    {
      const f = fixture();
      try {
        eq(seed(f), 2, 'Both ordered Setup draws are counted');
        eq(f.client.diagnostics().draws, 2); eq(f.steps.length, 0, 'Packets/Setup never update');
        eq(f.scene.food_state().foods.length, 1); eq(f.scene.prey_state().preys.length, 1);
        eq(f.foods.length, 1); eq(f.preys.length, 1);
        eq([f.foods[0].result.palette.count, f.preys[0].result.palette.bodies.length, f.preys[0].result.palette.glows.length], [2, 4, 3]);
        eq(f.foods[0].result.palette.glows[0].asset.source, f.shared);
        eq(f.preys[0].result.palette.glows[0].asset.source, f.shared);
        const recipe = id => f.recipes.find(entry => entry.request.id === id).result.recipe;
        eq(recipe(0).eyes.kind, 'standard'); eq(recipe(7).antenna.kind, 'ordinary-chain');
        eq(recipe(8).eyes.kind, 'single-image');
        for (const id of [9, 10]) {
          eq(recipe(id).custom, true); eq(recipe(id).eyes.kind, 'standard'); eq(recipe(id).antenna, undefined);
          eq(recipe(id).bodyStyle.swell, 0); eq(recipe(id).bodyStyle.detailedSegments, false);
        }
        const pair = f.images().filter(command => [f.host.jsebi, f.host.jsepi].includes(command.source));
        eq(pair.length, 2); eq(pair.map(command => command.source), [f.host.jsebi, f.host.jsepi]);
        ok(pair.every(command => command.args.length === 8 && command.blend === 'source-over'));
        ok(pair.every(command => !command.transforms.some(transform => transform[0] === 'rotate')));
        eq(pair.map(command => command.args.slice(0, 4)), [[0, 0, 64, 64], [0, 0, 48, 48]]);
        const trace = f.target.context.trace;
        const firstImage = prefix => trace.findIndex(command => command.op === 'image' && command.source.name.startsWith(prefix));
        ok(firstImage('oimgs:0:') < firstImage('imgs:0:'), 'Food outlines precede food bodies');
        ok(firstImage('imgs:0:') < firstImage('pr_imgs:0:'), 'Food bodies precede prey bodies');
        ok(firstImage('pr_imgs:0:') < firstImage('body:'), 'Prey bodies precede standard snake bodies');
        ok(trace.some(command => command.op === 'fill' && command.path[0]?.[0] === 'arc'), 'Actual ordinary paired eye paths are present');
        const faceSources = new Set([f.host.jsebi, f.host.jsepi, f.host.sest]);
        const lastFace = trace.findLastIndex(command => command.op === 'fill' && command.path[0]?.[0] === 'arc'
          || command.op === 'image' && faceSources.has(command.source));
        const lateImages = trace.slice(lastFace + 1).filter(command => command.op === 'image');
        eq(lateImages.length, 8, 'Both retained entities paint four late glow calls after the selected snake faces');
        ok(lateImages.every(command => command.source === f.shared && command.blend === 'lighter'));
        const observed = [];
        checkOperation(f, () => f.client.frame(40, { onStep(value) {
          ok(Object.isFrozen(value)); eq(f.steps.at(-1).freed, true); observed.push(value);
        } }));
        eq(observed.length, 1); eq(observed[0].nowMs, 40);
        eq(f.events.filter(event => event === 'advance').length, 1);
        eq(f.events.filter(event => event === 'quality').length, 1);
        eq(f.events.filter(event => event === 'free').length, 1);
        const ordered = f.events.filter(event => ['advance', 'quality', 'free', 'render'].includes(event));
        eq(ordered, ['advance', 'quality', 'free', 'render']);
        eq(f.events.find(Array.isArray), ['statistics', 40, 2, true]);
        eq(f.client.diagnostics().draws, 3);
        checkOperation(f, () => f.client.frame(48));
        ok(f.tapes.length > 0, 'Real antenna preparation requests supplied random units');
        ok(f.tapes.every(({ request, result }) => result instanceof Float64Array && result.length === 2 * request.randomPairCount));
        ok(f.images().some(command => command.source === f.host.cdbulb));
        ok(f.images().some(command => command.source === f.shared));
        eq(f.units, 2 * (f.foods.length + f.preys.length) + f.tapes.reduce((total, entry) => total + entry.result.length, 0),
          'Actual entity and antenna callbacks consume exactly their supplied units');
        const captures = f.captures;
        f.client.update(56);
        eq(f.captures, captures, 'Update alone does not capture or draw');
        const beforeResize = [f.scene.food_state().foods, f.scene.prey_state().preys, f.quality.snapshot(), f.steps.length];
        const draws = f.client.diagnostics().draws;
        checkOperation(f, () => f.client.resize(800, 480));
        eq([f.target.width, f.target.height], [800, 480]);
        eq([f.scene.food_state().foods, f.scene.prey_state().preys, f.quality.snapshot(), f.steps.length], beforeResize);
        eq(f.client.diagnostics().draws, draws + 1);
        const intervalDraws = f.client.diagnostics().drawsSinceStatistics;
        checkOperation(f, () => f.client.frame(1101));
        eq(f.events.findLast(Array.isArray), ['statistics', 1101, intervalDraws, true]);
        eq(f.client.diagnostics().drawsSinceStatistics, 1, 'Due statistics consume prior draws before this frame is counted');
        eq(JSON.parse(f.quality.snapshot()).lastStatisticsMs, 1101);
        eq(f.steps.at(-1).freed, true);
        cases.push('real-stock-faces-factories-order-clock-resize');
      } finally { f.close(); }
    }
    {
      const f = fixture();
      try {
        seed(f);
        const retained = f.scene.food_state().foods[0];
        const priorRevision = f.foods[0].result.palette.glows[0].asset.revision;
        f.churn();
        checkOperation(f, () => f.client.packet(bundle(food(129), prey(32))));
        eq(f.scene.food_state().foods.find(entry => entry.instance === retained.instance), retained);
        eq(f.preys.at(-1).result.palette.glows[0].asset.revision, priorRevision);
        eq(f.foods.at(-1).result.palette.glows[0].asset.revision, priorRevision);
        checkOperation(f, () => f.client.render());
        const lastOwn = f.recipes.findLast(entry => entry.request.id === 0).result.recipe;
        eq(lastOwn.palettes[0].variants[0].asset.source, f.shared);
        eq(lastOwn.palettes[0].variants[0].asset.revision, priorRevision);
        eq(f.client.diagnostics().stopped, false);
        cases.push('retained-source-revisions-and-body-food-prey-aliases');
      } finally { f.close(); }
    }
    {
      const f = fixture();
      try {
        seed(f); f.changeContent();
        const before = f.state(), resets = f.resets(), draws = f.client.diagnostics().draws;
        rejects(() => f.client.render(), /incoherent|revision/i);
        eq(f.state(), before); eq(f.resets(), resets, 'Content mismatch fails before target reset');
        eq(f.client.diagnostics().draws, draws); eq(f.client.diagnostics().stopped, true); eq(f.held, null);
        rejects(() => f.client.render(), /stopped/);
        cases.push('explicit-content-mismatch-is-atomic-and-terminal');
      } finally { f.close(); }
    }
    {
      const f = fixture();
      try {
        eq(checkOperation(f, () => f.client.packet(bundle(setup(), snake(0, 40), setup()))), 2);
        const recipe = f.recipes.at(-1).result.recipe;
        eq(recipe.eyes.kind, 'mouth-face'); eq(recipe.eyes.geometry.pupilTravel, 2.3);
        eq(recipe.eyes.eyeMarks.asset.source, f.host.ecmc);
        eq(recipe.eyes.mouth.asset.source, f.host.jmou);
        const faceImages = () => f.images().filter(call => call.source === f.host.ecmc || call.source === f.host.jmou);
        const checkFace = () => {
          eq(faceImages().map(call => call.source), [f.host.ecmc, f.host.ecmc, f.host.jmou]);
          for (const call of faceImages()) {
            eq(call.args.length, 4, 'whole-source overload from actual stock adapter');
            eq([call.alpha, call.blend], [1, 'source-over']);
            eq(call.transforms.map(transform => transform[0]), ['identity', 'translate', 'rotate']);
          }
          eq(f.client.diagnostics().stopped, false); eq(f.held, null);
        };
        checkFace();
        f.target.context.trace = [];
        checkOperation(f, () => f.client.frame(44)); checkFace();
        cases.push('complete-stock-mouth-held-sources-and-frame');
      } finally { f.close(); }
    }
    {
      const f = fixture();
      try {
        f.readiness.find(entry => entry.source === f.host.jmou).state = 'pending';
        const before = f.state();
        rejects(() => f.client.packet(bundle(setup(), snake(0, 40), setup())), /pending or unsupported/);
        eq(f.state(), before); eq(f.resets(), 0); eq(f.steps.length, 0); eq(f.units, 0);
        eq(f.captures, 1); eq(f.ends, 1); eq(f.held, null); eq(f.client.diagnostics().stopped, true);
        cases.push('unpainted-stock-mouth-before-clear');
      } finally { f.close(); }
    }
    {
      const f = fixture();
      try {
        seed(f); f.host.per_color_imgs[0].fws[0] = NaN;
        const before = f.state(), resets = f.resets(), units = f.units;
        rejects(() => f.client.packet(Uint8Array.from(food(129))), /metric/);
        eq(f.state(), before); eq(f.resets(), resets); eq(f.units, units);
        eq(f.held, null); eq(f.client.diagnostics().stopped, true);
        cases.push('malformed-real-factory-terminal');
      } finally { f.close(); }
    }
    {
      const f = fixture();
      try {
        seed(f); f.target.context.failSource = f.host.jsepi;
        const before = f.state(), resets = f.resets(), draws = f.client.diagnostics().draws;
        rejects(() => f.client.render(), /Authored stock Canvas image fault/);
        eq(f.state(), before); ok(f.resets() > resets, 'Native submission started before the injected image fault');
        eq(f.target.context.stack.length, 0); eq(f.client.diagnostics().draws, draws);
        eq(f.client.diagnostics().stopped, true); eq(f.held, null);
        cases.push('late-native-canvas-fault-restores-and-rolls-back');
      } finally { f.close(); }
    }
    if (control) {
      const f = fixture();
      try {
        checkOperation(f, () => f.client.packet(bundle(setup(), snake(0, 0), food(), prey(31), setup())));
        f.client.update(40);
        const prior = f.scene.control_view();
        const priorPupil = JSON.parse(f.scene.snapshot()).own.eyes.pupilY;
        const start = f.events.length;
        let callbacks = 0, observations = 0;
        checkOperation(f, () => f.client.frame(48, { control(request) {
          callbacks++; eq(request.nowMs, 48); eq(request.control, prior);
          ok(request.delta > 0); eq(request.wholeSteps, 1); eq(request.step, undefined);
          ok(typeof request.control.own.token === 'bigint');
          return { gazeHeading: Math.PI / 2 };
        }, onStep(value) {
          observations++; eq(f.steps.at(-1).freed, true); eq(value.delta, 1); eq(value.wholeSteps, 1);
        } }));
        eq(callbacks, 1); eq(observations, 1);
        eq(f.scene.control_view().own.gazeHeading, Math.PI / 2);
        ok(f.scene.control_view().own.rawHead.x !== prior.own.rawHead.x, 'Motion follows the copied pre-motion control readout');
        ok(JSON.parse(f.scene.snapshot()).own.eyes.pupilY > priorPupil, 'Control gaze affects this same update');
        eq(f.events.slice(start).filter(event => typeof event === 'string' && ['advance', 'advance_with_control', 'quality', 'free', 'render'].includes(event)),
          ['advance_with_control', 'quality', 'free', 'render']);
        cases.push('real-premotion-control-own-readout-same-tick-gaze');
      } finally { f.close(); }
      {
        const f = fixture();
        try {
          seed(f);
          let playing = true, reads = 0;
          const flags = [];
          const advance = f.quality.advance.bind(f.quality);
          const statistics = f.quality.update_statistics.bind(f.quality);
          f.quality.advance = (step, value) => { flags.push(['quality', value]); return advance(step, value); };
          f.quality.update_statistics = (...args) => { flags.push(['statistics', args[2]]); return statistics(...args); };
          checkOperation(f, () => f.client.frame(40, { playing: true,
            control() { playing = false; return { resetWorld: true, connected: false }; },
            readPlaying() {
              reads++;
              eq(f.scene.control_view().own, null, 'Playing is observed outside the completed native borrow');
              eq(f.steps.at(-1).freed, false);
              return playing;
            },
            onStep() { playing = true; },
          }));
          eq(reads, 1);
          eq(flags, [['quality', false], ['statistics', false]], 'Both quality phases share the post-lifecycle value');
          eq(f.scene.food_state().sourceCount, 0);
          eq(f.scene.prey_state().sourceCount, 0);
          eq(f.steps.at(-1).freed, true);
          cases.push('real-post-lifecycle-playing-and-populated-registry-reset');
        } finally { f.close(); }
      }
      for (const [withHud, withReadout] of [[false, false], [true, false], [true, true]]) {
        const f = fixture();
        let gameplay, hudBinding;
        try {
          if (withHud) f.scene.enable_score_tracking();
          let now = 0, nextTimer = 0;
          const queue = [], timers = new Map(), sockets = [], fatal = [], flags = [], reports = [], observedHud = [];
          const nativeScore = f.scene.score_view.bind(f.scene);
          let scoreReads = 0;
          f.scene.score_view = () => {
            eq(f.held, null, 'Readout score access follows source release');
            scoreReads++; return nativeScore();
          };
          const advance = f.quality.advance.bind(f.quality);
          const statistics = f.quality.update_statistics.bind(f.quality);
          f.quality.advance = (step, value) => { flags.push(['quality', value]); return advance(step, value); };
          f.quality.update_statistics = (...args) => { flags.push(['statistics', args[2]]); return statistics(...args); };
          const drain = () => {
            let count = 0;
            while (queue.length) {
              assert.ok(++count <= 1000, 'Bounded authored microtask fixture');
              queue.shift()();
            }
          };
          gameplay = createStockGameplay({ scene: f.scene, quality: f.quality, controller: f.client, wasm, hudReadout: withReadout,
            now: () => now, defer: callback => queue.push(callback),
            setInterval(callback, period) { eq(period, 25); const id = ++nextTimer; timers.set(id, callback); return id; },
            clearInterval: id => timers.delete(id), onStatus() {}, onFatal: error => fatal.push(error),
            onHudPacket: withHud ? report => {
              eq(f.held, null, 'HUD publication follows held-source release');
              eq(f.captures, f.ends);
              ok(Object.isFrozen(report)); ok(Object.isFrozen(report.events));
              rejects(() => gameplay.frame(now), /reentrant/);
              rejects(() => gameplay.dispose(), /reentry/);
              if (withReadout) observedHud.push(gameplay.hudSnapshot());
              reports.push(report);
            } : undefined,
            createSocket(endpoint) {
              eq(endpoint, 'ws://192.0.2.9:1234/slither');
              eq(f.held, null, 'Socket construction follows held-source release');
              eq(f.steps.at(-1).freed, true, 'Socket construction follows owned-step release');
              const socket = { readyState: 0, bufferedAmount: 0, sent: [], closes: 0,
                send(bytes) { this.sent.push(Array.from(bytes)); },
                close() { this.closes++; this.readyState = 3; } };
              sockets.push(socket); return socket;
            },
          });
          const hud = withReadout ? hudTree(() => eq(f.held, null, 'HUD setters follow source release')) : null;
          hudBinding = withReadout ? bindStockHudDom({ documentIdentity: Symbol('authored Document'),
            sceneIdentity: gameplay.hudSnapshot().sceneIdentity, scope: 'readout-and-final',
            dom: hud.dom, nodes: hud.nodes, isCurrentDocument: () => true }) : null;
          const projectCommitted = () => {
            eq(f.held, null, 'Projection follows the completed source operation');
            const before = [scoreReads, f.captures, f.ends, f.steps.length, f.client.diagnostics().draws];
            const view = projectHudView(gameplay.hudSnapshot(), hudBinding.readiness());
            const writes = hud.writes.length, receipt = hudBinding.render(view);
            eq(receipt.readoutWritten, view.current.readiness === 'ready');
            eq(receipt.finalWritten, view.final.readiness === 'ready');
            if (receipt.readoutWritten) {
              eq(hud.text(hud.readout.lengthValue.text), view.current.value.scoreText);
              eq(hud.text(hud.readout.rankValue.text), view.current.value.rankText);
              eq(hud.text(hud.readout.populationValue.text), view.current.value.populationText);
              eq(hud.style(hud.readout.root, 'opacity'), String(view.requestedOpacity.readout));
            }
            if (receipt.finalWritten) eq(hud.text(hud.final.value.text), view.final.value.scoreText + view.final.value.suffix);
            if (!receipt.readoutWritten && !receipt.finalWritten) eq(hud.writes.length, writes);
            eq(hud.text(hud.readout.lengthLabel.text), 'authored length');
            eq(hud.text(hud.final.label.text), 'authored final');
            eq(hud.style(hud.final.root, 'opacity'), undefined, 'Final host visibility stays owner policy');
            eq([scoreReads, f.captures, f.ends, f.steps.length, f.client.diagnostics().draws], before,
              'Projection and passive rendering perform no native score, source, step or draw operation');
            return view;
          };
          if (withReadout) {
            const view = projectCommitted();
            eq(view.readiness, 'pending'); eq(view.reason, 'no-displayed-current');
            eq(view.current.value, null); eq(view.final.value, null);
          }
          gameplay.play({ endpoint: 'ws://192.0.2.9:1234/slither',
            profile: { clientVersion: 7, password: Uint8Array.from({ length: 20 }, (_, i) => i + 1), protocolVersion: 19 },
            nickname: 'Synthetic', skin: 27, customSkin: new Uint8Array() });
          eq(sockets.length, 0);
          gameplay.frame(now); drain();
          eq(sockets.length, 1);
          const socket = sockets[0]; socket.readyState = 1; socket.onopen(); drain();
          eq(socket.sent.slice(0, 2), [[1], [99, 0]]);
          socket.onmessage({ data: Uint8Array.from([54, ...syntheticChallenge('B'.repeat(27))]).buffer }); drain();
          eq(socket.sent[2].length, 27); eq(socket.sent[3][0], 115);
          now = 40;
          socket.onmessage({ data: bundle(setup(), snake(0, 27), food(), prey(31), setup()).buffer }); drain();
          eq(gameplay.diagnostics().session.connected, true);
          ok(f.scene.food_state().sourceCount > 0); ok(f.scene.prey_state().sourceCount > 0);
          if (withHud) {
            eq(reports.length, 1); eq(reports[0].commandCount, 5); eq(reports[0].setupDraws, 2);
            eq(reports[0].events.map(event => [event.commandIndex, event.kind]),
              [[0, 'setup'], [0, 'setup-draw'], [1, 'own-length-scheduled'], [4, 'setup'], [4, 'setup-draw']]);
            eq(reports[0].events[1].view.status, 'no-own');
            eq(reports[0].events[4].view.status, 'ready');
            if (withReadout) {
              eq(observedHud[0].ownToken, null, 'A private packet observer sees only committed state');
              eq(gameplay.hudSnapshot().ownToken, reports[0].events[2].token);
              eq(gameplay.hudSnapshot().dirty, true); eq(gameplay.hudSnapshot().current, null);
              eq(gameplay.hudSnapshot().requestedOpacity, { readout: 0, header: 0, rows: 0, announcement: 0 });
              eq(scoreReads, 0, 'Ineligible Setup samples require no native score getter');
              now = 42;
              socket.onmessage({ data: Uint8Array.of(108, 0, 0, 17, 0, 33).buffer }); drain();
              eq(gameplay.hudSnapshot().fade, 0); eq(gameplay.hudSnapshot().dirty, true);
              eq(gameplay.hudSnapshot().current, null); eq(scoreReads, 0);
              const steps = f.steps.length, quality = f.quality.snapshot(), draws = f.client.diagnostics().draws;
              gameplay.render();
              eq(scoreReads, 1); eq(gameplay.hudSnapshot().dirty, false);
              eq(gameplay.hudSnapshot().current, { score: nativeScore().score, rank: 17, population: 33,
                ownToken: nativeScore().own.token });
              const projected = projectCommitted();
              eq(projected.current.readiness, 'ready'); eq(projected.final.readiness, 'pending');
              eq(projected.readiness, 'pending'); eq(projected.current.value.rankText, '17');
              eq(projected.current.value.populationText, '33');
              eq(projected.current.value.scoreText, String(gameplay.hudSnapshot().current.score));
              gameplay.resize(960, 540);
              eq(scoreReads, 1, 'A clean resized readout does not poll scores');
              eq(f.steps.length, steps); eq(f.quality.snapshot(), quality);
              eq(f.client.diagnostics().draws, draws + 2);
              now = 43; gameplay.frame(now); drain();
              eq(gameplay.hudSnapshot().fade, 0.01 * f.steps.at(-1).delta);
              eq(scoreReads, 1, 'Alive fading does not dirty the readout');
            }
            const before = f.scene.score_view(), qualityBefore = f.quality.snapshot();
            const stepsBefore = f.steps.length, drawsBefore = f.client.diagnostics().draws;
            now = 44;
            socket.onmessage({ data: bundle([112], [108, 0, 0, 17, 0, 33], [118, 1],
              [104, 0, 0, ...u24(8388607)], [82, 9], setup()).buffer }); drain();
            eq(reports.length, withReadout ? 3 : 2);
            const report = reports.at(-1);
            eq(report.events.map(event => [event.commandIndex, event.kind]),
              [[1, 'leaderboard'], [2, 'final-score'], [3, 'own-length-scheduled'], [5, 'setup'], [5, 'setup-draw']]);
            eq(report.events[1].view, before, 'Final sample precedes later mass/R/Setup through every real layer');
            eq(report.events[0].deathPending, false); eq(report.events[0].rank, 17); eq(report.events[0].population, 33);
            eq(report.events[4].view.own.scoreAdjustment, 9);
            eq(report.events[4].view, f.scene.score_view());
            eq(f.steps.length, stepsBefore); eq(f.quality.snapshot(), qualityBefore);
            eq(f.client.diagnostics().draws, drawsBefore + 1, 'One actual Setup draw is counted once');
            ok(Object.isFrozen(report.events[1].view.own));
            if (withReadout) {
              const view = gameplay.hudSnapshot();
              eq(view.final, { score: before.score, exclamation: before.score > 1000, ownToken: before.own.token });
              eq(view.current, { score: report.events[4].view.score, rank: 17, population: 33,
                ownToken: before.own.token });
              eq(view.dirty, false); eq(view.fade, -1);
              eq(view.requestedOpacity, { readout: 0, header: 0, rows: 0, announcement: 0 });
              ok(Object.isFrozen(view.current)); ok(Object.isFrozen(view.final));
              const projected = projectCommitted();
              eq(projected.readiness, 'ready'); eq(projected.final.value.score, before.score);
              eq(projected.final.value.ownToken, before.own.token);
              eq(projected.current.value.score, report.events[4].view.score);
              eq(projected.requestedOpacity, view.requestedOpacity);
            }
          }
          now = 48;
          gameplay.event({ type: 'pointermove', clientX: 480, clientY: 100 }, { width: 960, height: 540 });
          gameplay.frame(now); drain();
          eq(f.scene.control_view().own.gazeHeading, -Math.PI / 2);
          ok(JSON.parse(f.scene.snapshot()).own.eyes.pupilY < 0);
          now = withHud ? 544 : 540;
          for (const callback of [...timers.values()]) callback();
          drain(); eq(timers.size, 0);
          now = 600;
          socket.onmessage({ data: Uint8Array.of(115, 0, 0, 1).buffer }); drain();
          eq(gameplay.diagnostics().session.playing, true, 'Own removal is not session life-end');
          now = 640;
          socket.onmessage({ data: Uint8Array.of(118, 0).buffer }); drain();
          for (let count = 0; gameplay.diagnostics().session.playing && count < 60; count++) {
            now = Math.max(now + 40, 2241);
            if (gameplay.diagnostics().session.pingPending) { socket.onmessage({ data: Uint8Array.of(112).buffer }); drain(); }
            gameplay.frame(now); drain();
          }
          eq(fatal, []);
          eq(gameplay.diagnostics().session.playing, false);
          eq(gameplay.diagnostics().session.connected, false);
          eq(flags.slice(-2), [['quality', false], ['statistics', false]]);
          eq(socket.closes, 1);
          eq(f.scene.control_view().own, null);
          eq(f.scene.food_state().sourceCount, 0); eq(f.scene.prey_state().sourceCount, 0);
          eq(f.held, null); eq(f.captures, f.ends);
          if (withReadout) {
            const view = gameplay.hudSnapshot();
            eq(view.ownToken, null); eq(view.rank, 0); eq(view.population, 0);
            eq(view.fade, -1); eq(view.requestedOpacity, { readout: -1, header: -0.85, rows: -1, announcement: -1 });
            ok(view.current !== null); ok(view.final !== null);
            const projected = projectCommitted();
            eq(projected.readiness, 'ready');
            eq(projected.current.value.ownToken, view.current.ownToken);
            eq(projected.final.value.ownToken, view.final.ownToken);
            eq(projected.requestedOpacity, { readout: -1, header: -0.85, rows: -1, announcement: -1 });
            gameplay.dispose(); eq(gameplay.hudSnapshot(), null);
            const stopped = projectCommitted();
            eq(stopped.readiness, 'unavailable'); eq(stopped.reason, 'hud-disabled-or-disposed');
            eq(stopped.current.value, null); eq(stopped.final.value, null);
          }
          cases.push(withReadout ? 'real-staged-readout-to-passive-HUD-through-completion-history'
            : withHud ? 'real-hud-session-controller-render-and-life-end-composition'
            : 'real-gameplay-session-input-render-and-life-end-composition');
        } finally {
          try { hudBinding?.dispose(); } finally { try { gameplay?.dispose(); } finally { f.close(); } }
        }
      }
      for (const failedDefer of [false, true]) {
        const f = fixture();
        let gameplay;
        try {
          f.scene.enable_score_tracking();
          let now = 0, nextTimer = 0, scoreReads = 0, timerCleanup = 0;
          let refuseDefer = false;
          const queue = [], timers = new Map(), sockets = [], failures = [];
          const secondary = new Error('Authored timer cleanup failure');
          const drain = () => {
            let count = 0;
            while (queue.length) { ok(++count <= 1000); queue.shift()(); }
          };
          gameplay = createStockGameplay({ scene: f.scene, quality: f.quality, controller: f.client,
            wasm, hudReadout: true, now: () => now, defer(callback) {
              if (refuseDefer) throw new Error('Authored unavailable scheduler');
              queue.push(callback);
            },
            setInterval(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
            clearInterval(id) { timerCleanup++; timers.delete(id); throw secondary; },
            onStatus() {}, onFatal: value => failures.push(value),
            createSocket() {
              const socket = { readyState: 0, bufferedAmount: 0, closes: 0,
                send() {}, close() { this.closes++; this.readyState = 3; } };
              sockets.push(socket); return socket;
            },
          });
          gameplay.play({ endpoint: 'ws://192.0.2.9:1234/slither',
            profile: { clientVersion: 7, password: new Uint8Array(20).fill(3), protocolVersion: 19 },
            nickname: 'Authored readout failure', skin: 27, customSkin: new Uint8Array() });
          gameplay.frame(now); drain();
          const socket = sockets[0]; socket.readyState = 1; socket.onopen(); drain();
          socket.onmessage({ data: Uint8Array.from([54, ...syntheticChallenge('B'.repeat(27))]).buffer }); drain();
          now = 40;
          socket.onmessage({ data: bundle(setup(), snake(0, 27), [108, 0, 0, 17, 0, 33]).buffer }); drain();
          const committed = gameplay.hudSnapshot();
          eq(committed.dirty, true); eq(committed.current, null); eq(timers.size, 1);
          const beforeDraws = f.client.diagnostics().draws;
          refuseDefer = failedDefer;
          f.scene.score_view = () => {
            eq(f.held, null, 'Required score getter runs after the successful Canvas/source operation');
            scoreReads++; throw undefined;
          };
          let threw = false, observed;
          try { gameplay.render(); } catch (value) { threw = true; observed = value; }
          eq(threw, true); eq(observed, undefined); eq(scoreReads, 1);
          eq(gameplay.hudSnapshot(), committed, 'Failed required read does not publish a partial state');
          eq(f.client.diagnostics().draws, beforeDraws + 1, 'The completed native draw is not rolled back');
          eq(f.held, null); eq(f.captures, f.ends);
          const captures = f.captures, nativeState = f.state();
          socket.onmessage({ data: Uint8Array.of(104, 0, 0, ...u24(8388607)).buffer });
          eq(f.captures, captures, 'Retained fatal blocks later ingress before source capture');
          eq(f.state(), nativeState, 'A failed gameplay cannot commit another native packet');
          eq(socket.closes, 1); eq(gameplay.hudSnapshot(), committed);
          if (failedDefer) {
            let cleanupThrew = false, cleanupFailure;
            try { gameplay.dispose(); } catch (value) { cleanupThrew = true; cleanupFailure = value; }
            eq(cleanupThrew, true); eq(cleanupFailure, undefined);
          }
          drain();
          eq(failures.length, 1); eq(failures[0], undefined, 'Secondary cleanup cannot mask the primary');
          eq(timerCleanup, 1); eq(timers.size, 0); eq(socket.closes, 1);
          eq(gameplay.diagnostics().disposed, true); eq(gameplay.hudSnapshot(), null);
          rejects(() => gameplay.frame(48), /stopped|reentrant/);
          cases.push(failedDefer ? 'real-fatal-readout-blocks-ingress-despite-unavailable-scheduler'
            : 'real-required-readout-primary-undefined-survives-cleanup-and-withholds-publication');
        } finally {
          try { gameplay?.dispose(); } finally { f.close(); }
        }
      }
      for (const victory of [false, true]) {
        const f = fixture();
        let session;
        try {
          f.scene.enable_score_tracking();
          let now = 0;
          const sockets = [], failures = [];
          session = createStockSession({ wasm, now: () => now, createSocket() {
            eq(f.held, null); eq(f.steps.at(-1).freed, true);
            const socket = { readyState: 0, bufferedAmount: 0, sent: [], closes: 0,
              send(bytes) { this.sent.push(Array.from(bytes)); },
              close() { this.closes++; this.readyState = 3; } };
            sockets.push(socket); return socket;
          } });
          session.subscribeWithHud({ packet: (bytes, elapsed, plan) => f.client.packetWithHud(bytes, elapsed, plan),
            hud() {}, state() {}, error: value => failures.push(value) });
          session.play({ endpoint: 'ws://192.0.2.9:1234/slither',
            profile: { clientVersion: 7, password: new Uint8Array(20).fill(3), protocolVersion: 19 },
            nickname: 'Synthetic lifecycle', skin: 27, customSkin: new Uint8Array() });
          const frame = time => {
            now = time;
            const flags = session.beforeUpdate(now);
            let observed;
            f.client.frame(now, { lagging: flags.lagging, playing: flags.playing,
              readPlaying: () => session.snapshot().playing,
              control(request) {
                const result = session.afterStepWithHud(request);
                observed = { result, delta: request.delta };
                return result.actions;
              } });
            session.commitControl();
            eq(f.held, null); eq(f.steps.at(-1).freed, true);
            ok(Object.isFrozen(observed.result)); ok(Object.isFrozen(observed.result.actions));
            ok(Object.isFrozen(observed.result.lifecycle));
            eq(observed.result.lifecycle.returnFraction, session.snapshot().returnFraction);
            return observed;
          };
          eq(sockets.length, 0);
          const initial = frame(0);
          eq(initial.result.lifecycle, { schema: 1, deathPending: false,
            returnActive: false, returnCompleted: false, returnFraction: 0 });
          eq(sockets.length, 1);
          const socket = sockets[0]; socket.readyState = 1; socket.onopen();
          socket.onmessage({ data: Uint8Array.from([54, ...syntheticChallenge('B'.repeat(27))]).buffer });
          now = 40;
          socket.onmessage({ data: bundle(setup(), snake(0, 27)).buffer });
          session.uiTick(540);
          now = 600; socket.onmessage({ data: Uint8Array.of(118, victory ? 1 : 0).buffer });
          const boundary = frame(2200);
          eq(boundary.result.lifecycle.deathPending, true);
          eq(boundary.result.lifecycle.returnActive, false, 'The lifecycle uses the strict 1600ms boundary');
          const active = frame(2201);
          eq(active.result.lifecycle.returnActive, true); eq(active.result.lifecycle.returnCompleted, false);
          eq(active.result.lifecycle.returnFraction, 1 - 0.004 * active.delta,
            'The observed facet uses the actual native clock delta once');
          let completed;
          for (let count = 0; count < 60; count++) {
            const observed = frame(now + 40);
            if (observed.result.lifecycle.returnCompleted) { completed = observed; break; }
          }
          ok(completed, 'Return completes within the bounded authored schedule');
          eq(completed.result.lifecycle, { schema: 1, deathPending: false,
            returnActive: true, returnCompleted: true, returnFraction: 0 });
          eq(session.snapshot().playing, false); eq(session.snapshot().connected, victory);
          eq(socket.closes, victory ? 0 : 1);
          eq(f.scene.control_view().connected, victory);
          eq(f.scene.control_view().own === null, !victory);
          const following = frame(now + 40);
          eq(following.result.lifecycle.returnActive, false); eq(following.result.lifecycle.returnCompleted, false);
          eq(failures, []); eq(f.captures, f.ends);
          cases.push(victory ? 'real-same-step-victory-return-lifecycle' : 'real-same-step-disconnect-return-lifecycle');
        } finally {
          try { session?.dispose(); } finally { f.close(); }
        }
      }
      for (const malformed of [() => Promise.resolve({}), () => ({ unknownAction: true }), () => ({ gazeHeading: NaN }),
        () => Object.defineProperty({}, 'gazeHeading', { get() { throw new Error('Getter must not run'); }, enumerable: true })]) {
        const f = fixture();
        try {
          seed(f); const before = f.state(), qualityBefore = f.quality.snapshot(), resets = f.resets(), steps = f.steps.length;
          rejects(() => f.client.frame(48, { control: malformed }), /synchronous|record|unknown|finite|own data/);
          eq(f.state(), before); eq(f.resets(), resets); eq(f.steps.length, steps);
          eq(f.quality.snapshot(), qualityBefore, 'Rejected control actions do not advance quality');
          eq(f.client.diagnostics().stopped, true); eq(f.held, null); eq(f.captures, f.ends);
          rejects(() => f.client.update(56), /stopped/);
        } finally { f.close(); }
      }
      cases.push('native-control-malformed-action-rollback-terminal');
    }
    return Object.freeze({ assertions, cases: Object.freeze(cases), control: control ? 'passed' : 'not-requested' });
  } finally {
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

async function cli(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--source-only' && options.sourceOnly === undefined) options.sourceOnly = true;
    else if (['--js', '--wasm'].includes(key) && options[key] === undefined && args[index + 1]) options[key] = args[++index];
    else throw new Error('Usage: stock-render-smoke.mjs --js ABSOLUTE_JS --wasm ABSOLUTE_WASM [--source-only]');
  }
  for (const key of ['--js', '--wasm']) if (!path.isAbsolute(options[key] ?? '')) throw new Error(`Explicit absolute ${key} path required`);
  const pins = () => ['--js', '--wasm'].map(key => {
    const bytes = fs.readFileSync(options[key]);
    return { path: options[key], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const before = pins();
  let result;
  try {
    const wasm = await import(pathToFileURL(options['--js']).href);
    wasm.initSync({ module: fs.readFileSync(options['--wasm']) });
    result = stockRenderSmoke(wasm, { control: !options.sourceOnly });
  } finally {
    assert.deepEqual(pins(), before, 'Explicit candidate JS/Wasm must stay unchanged');
    console.log(JSON.stringify({ pins: before, result: result ?? null }, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}
