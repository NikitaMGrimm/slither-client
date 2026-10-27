import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createSkinProvider } from '../web/skin-provider.mjs';
import { bundle, syntheticScene, syntheticSetup, syntheticStep } from '../web/synthetic-scene.mjs';
import { denseScene } from '../web/dense-scene.mjs';
import { faceRenderSmoke } from './face-render-smoke.mjs';
import { foodRenderSmoke } from './food-render-smoke.mjs';

// Original synthetic sources and Canvas recorder. This executes the real Wasm
// ABI, but models Canvas state; it is neither a browser nor a raster oracle.
export function bodyRenderSmoke(wasm) {
  let assertions = 0;
  const eq = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
  const ok = (value, message) => { assertions++; assert(value, message); };
  const rejects = (fn, message) => { assertions++; assert.throws(fn, message); };
  class CanvasRenderingContext2D {
    trace = []; stack = []; alpha = 1; blend = 'source-over'; transforms = []; alphaWrites = [];
    failSource = null; failMethod = null; failSourceAt = 1; failSourceCount = 0; failMethodAfterEyes = null;
    reset() { this.trace.push({ op: 'reset' }); this.stack = []; this.alpha = 1; this.blend = 'source-over'; this.transforms = []; this.alphaWrites = []; }
    get globalAlpha() { return this.alpha; }
    set globalAlpha(requested) {
      if (Number.isFinite(requested) && requested >= 0 && requested <= 1) this.alpha = requested;
      this.trace.push({ op: 'alpha', requested, effective: this.alpha });
      this.alphaWrites = [...this.alphaWrites.slice(-1), { requested, effective: this.alpha }];
    }
    get globalCompositeOperation() { return this.blend; }
    set globalCompositeOperation(value) { this.blend = value; this.trace.push({ op: 'blend', value }); }
    save() { this.stack.push({ alpha: this.alpha, blend: this.blend, transforms: this.transforms.slice() }); this.trace.push({ op: 'save' }); }
    restore() { Object.assign(this, this.stack.pop()); this.trace.push({ op: 'restore' }); }
    setTransform(...args) { this.throwIf('setTransform'); this.transforms = [['setTransform', ...args]]; }
    translate(...args) { this.throwIf('translate'); this.transforms.push(['translate', ...args]); }
    scale(...args) { this.throwIf('scale'); this.transforms.push(['scale', ...args]); }
    rotate(...args) { this.throwIf('rotate'); this.transforms.push(['rotate', ...args]); }
    throwIf(method) {
      if (this.failMethod === method || (this.failMethodAfterEyes === method && this.trace.filter(v => v.op === 'fill').length >= 4)) {
        throw new Error(`synthetic Canvas ${method}`);
      }
    }
    createPattern(source, repetition) { this.throwIf('createPattern'); return { source, repetition }; }
    beginPath() { this.path = []; }
    arc(...args) { this.throwIf('arc'); this.path.push(args); }
    closePath() {}
    fillRect(...args) { this.trace.push({ op: 'fillRect', args }); }
    stroke() { this.trace.push({ op: 'stroke', path: this.path, color: this.strokeStyle, width: this.lineWidth, alpha: this.alpha }); }
    fill() { this.trace.push({ op: 'fill', path: this.path, color: this.fillStyle, alpha: this.alpha, blend: this.blend }); }
    drawImage(source, ...args) {
      if (source === this.failSource && ++this.failSourceCount === this.failSourceAt) throw new Error('synthetic Canvas drawImage');
      this.trace.push({ op: 'image', source, args, alpha: this.alpha, blend: this.blend,
        transforms: this.transforms.slice(), alphaWrites: this.alphaWrites.slice() });
    }
  }
  class HTMLCanvasElement {
    context = new CanvasRenderingContext2D(); _width = 32; height = 32;
    constructor(name = 'canvas') { this.name = name; this.context.canvas = this; }
    get width() { return this._width; }
    set width(value) { this._width = value; this.context.reset(); }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  }
  class HTMLImageElement { complete = true; naturalWidth = 64; naturalHeight = 64; constructor(name = 'image') { this.name = name; } }
  const realm = { HTMLCanvasElement, HTMLImageElement };
  const globals = new Map(Object.entries({ ...realm, CanvasRenderingContext2D }).map(([key, value]) => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return [key, prior];
  }));
  const vanillaEyes = () => ({ kind: 'standard', distance: 6, separation: 6, radius: 6,
    pupilRadius: 3.5, pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0,
    outlineColor: 0, eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 });
  function fixture({ eyes = true, detailed = false, eyeStyle = null, faceStyle = null } = {}) {
    const scene = new wasm.AnimatedScene(0);
    const quality = new wasm.DesktopQuality(1, 0);
    const target = new HTMLCanvasElement('target'); target.width = 960; target.height = 540;
    target.context.trace = [];
    const foods = [0, 1, 2].map(i => new HTMLCanvasElement(`food${i}`));
    const background = new HTMLImageElement('background');
    const sources = [new HTMLCanvasElement('body0'), new HTMLImageElement('body1'),
      new HTMLCanvasElement('glow0'), new HTMLImageElement('glow1'),
      new HTMLCanvasElement('outline'), new HTMLImageElement('shadow'), new HTMLCanvasElement('death')];
    const metadata = {
      status: 'ready', basePalette: 0, custom: false,
      runs: [{ palette: 0, count: 2 }, { palette: 1, count: 3 }],
      palettes: [
        { variants: [{ asset: 0 }, { asset: 7, sourceRect: [0, 0, 32, 32] }], boostGlow: { asset: 2 } },
        { variants: [{ asset: 1, sourceRect: [2, 3, 12, 14] }, { asset: 1 }], boostGlow: { asset: 3 } },
      ], variantMode: 'cycle', variantPeriod: 2, eyes: eyes ? (faceStyle?.eyes ?? eyeStyle ?? vanillaEyes()) : { kind: 'none' },
      effects: ['outline', 'shadow', 'death-highlight'].map((kind, i) => ({ kind, asset: i + 4, opacity: 1 })),
      bodyStyle: { detailedSegments: detailed, swell: 0, rotateSegments: true, headFade: null, tailFade: null },
      attachment: null, unsupportedFeatures: [],
    };
    const catalog = [...sources, sources[0]].map(source => ({ source, state: 'ready' }));
    const faceSource = new HTMLCanvasElement('asymmetric-face');
    faceSource.width = 43; faceSource.height = 29;
    catalog.push({ source: faceSource, state: 'ready' });
    if (faceStyle?.decoration.kind === 'paired-side-images') metadata.faceDecoration = {
      kind: 'paired-side-images', geometry: { ...faceStyle.decoration.geometry }, image: { asset: 8 },
    };
    const snapshot = { revision: 'synthetic-1', assetCatalog: catalog };
    const requests = [];
    const provider = createSkinProvider({ trusted: true, realm, resolveHostRecipe: request => request,
      normalizeHostRecipe: () => metadata });
    let transform = value => value;
    const resolve = request => { requests.push(request); return transform(provider.resolve(request, snapshot), request); };
    const render = (callback = resolve) => scene.render_standard(target, ...foods, background, callback, quality);
    const state = () => [scene.snapshot(), scene.drawn_snakes(), Array.from(scene.camera_samples()),
      Array.from(scene.own_body_samples()), Array.from(scene.own_body()), Array.from(scene.length_samples()),
      Array.from(scene.boundary_samples())];
    const close = () => { scene.free(); quality.free(); };
    if (faceStyle) scene.apply_frame_with_face_geometry(syntheticScene(), false, () => faceStyle);
    else if (eyeStyle) scene.apply_frame_with_eye_geometry(syntheticScene(), false, () => eyeStyle);
    else scene.apply_frame(syntheticScene(), false);
    scene.advance(40, false).free();
    return { scene, quality, target, foods, background, sources, metadata, catalog, snapshot, requests,
      provider, resolve, render, state, close, faceSource, transform: fn => { transform = fn; } };
  }
  function appearance(custom = [], cosmetic = 0) {
    const packed = wasm.decode_frame(syntheticScene(), false);
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    let offset = 4 + view.getUint32(0);
    const length = view.getUint32(offset); offset += 4;
    const raw = Array.from(packed.slice(offset, offset + length));
    const customOffset = 23 + raw[22];
    raw.splice(customOffset, 2, custom.length, ...custom, cosmetic);
    return Uint8Array.from(raw);
  }
  function bodyImages(f) { return f.target.context.trace.filter(v => v.op === 'image' && f.sources.includes(v.source)); }
  function checkAtomic(f, mutate, callback) {
    const before = f.state(); const trace = f.target.context.trace.slice();
    let failure;
    mutate?.(); rejects(() => { try { f.render(callback); } catch (e) { failure = e; throw e; } });
    eq(f.state(), before, 'failed preflight preserves all model diagnostics');
    eq(f.target.context.trace, trace, 'failed preflight precedes target reset');
    eq(f.target.context.stack.length, 0);
    return failure;
  }
  try {
    faceRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok, rejects, checkAtomic, bodyImages });
    foodRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok, rejects });
    const style = { ...vanillaEyes(), distance: 9.25, separation: 4.75, radius: 4.25,
      pupilRadius: 1.5, pupilTravel: 0.02, outlineWidth: 2.5,
      eyeColor: 0x123456, pupilColor: 0xabcdef, eyeOpacity: 0.6, pupilOpacity: 0.8 };
    const styled = fixture({ eyeStyle: { ...style } });
    try {
      const { scene, target, foods, background } = styled;
      // Direct eye metadata remains usable while unrelated body assets are pending.
      scene.reset(); styled.catalog[0].state = 'pending';
      const pending = styled.provider.resolve({ skin: 0 }, styled.snapshot);
      eq(pending.status, 'pending'); ok(pending.recipe.eyes);
      const mutable = { ...pending.recipe.eyes };
      scene.apply_frame_with_eye_geometry(bundle(syntheticSetup(), appearance([1, 4], 17)), false,
        request => { request.customBytes.fill(99); return mutable; });
      mutable.pupilTravel = 200; mutable.eyeColor = 0xffffff; mutable.radius = 200;
      scene.advance(44, false).free(); // Reset retained the fixture's 40-ms clock.
      eq(JSON.parse(scene.snapshot()).own.eyes.pupilX, 0.02, 'appearance style applies before the first fractional step');
      styled.catalog[0].state = 'ready';
      styled.render();
      eq([...styled.requests[0].customBytes], [1, 4], 'appearance request bytes are independently owned');
      const paint = () => target.context.trace.filter(v => v.op === 'fill');
      const fills = paint(); const row = scene.drawn_eyes(960, 540);
      eq(fills.map(v => v.color), ['rgb(18,52,86)', 'rgb(171,205,239)', 'rgb(18,52,86)', 'rgb(171,205,239)']);
      eq(fills.map(v => v.alpha), [0.6, 0.8, 0.6, 0.8]);
      const view = JSON.parse(scene.snapshot()); const m = view.own, z = view.camera.zoom;
      const expectedEye = [480 + ((9.25 * m.scale + Math.cos(-Math.PI / 2) * (4.75 * m.scale + 0.5)
        + m.correctedX) - view.camera.absoluteX) * z,
      270 + ((Math.sin(-Math.PI / 2) * (4.75 * m.scale + 0.5) + m.correctedY) - view.camera.absoluteY) * z,
      4.25 * m.scale * z, 0, Math.PI * 2];
      eq(fills[0].path[0], expectedEye, 'nondefault forward/separation/radius keep layout arithmetic');
      eq(fills[0].path[0].slice(0, 3), [row[3], row[4], row[11]]);
      eq(fills[1].path[0].slice(0, 3), [row[5], row[6], row[12]]);
      eq(row[12], 1.5 * m.scale * z);
      const outlines = target.context.trace.filter(v => v.op === 'stroke').slice(1);
      eq(outlines.map(v => [v.color, v.width, v.alpha]), [['#000000', 2.5 * z, 0.6], ['#000000', 2.5 * z, 0.6]]);
      for (const key of ['distance', 'separation', 'radius', 'pupilRadius', 'pupilTravel', 'outlineWidth',
        'eyeColor', 'pupilColor', 'eyeOpacity', 'pupilOpacity']) {
        const original = styled.metadata.eyes[key];
        checkAtomic(styled, () => { styled.metadata.eyes[key] = original + 0.01; });
        styled.metadata.eyes[key] = original;
      }
      target.context.trace = [];
      scene.render(target, ...foods, background, 1, false);
      eq(paint().map(v => [v.color, v.alpha, v.path]), fills.map(v => [v.color, v.alpha, v.path]),
        'basic renderer consumes the same retained typed style');
    } finally { styled.close(); }

    const defaultLegacy = fixture(), defaultExplicit = fixture({ eyeStyle: vanillaEyes() });
    try {
      for (const basic of [false, true]) {
        for (const f of [defaultLegacy, defaultExplicit]) {
          f.target.context.trace = [];
          if (basic) f.scene.render(f.target, ...f.foods, f.background, 1, false);
          else f.render();
        }
        const normalized = f => f.target.context.trace.map(call => call.source
          ? { ...call, source: call.source.name } : call);
        eq(normalized(defaultLegacy), normalized(defaultExplicit), 'default API preserves all recorded commands exactly');
        eq(defaultLegacy.state(), defaultExplicit.state());
      }
    } finally { defaultLegacy.close(); defaultExplicit.close(); }

    for (const key of ['distance', 'separation', 'radius', 'pupilRadius', 'pupilTravel', 'outlineWidth', 'eyeOpacity', 'pupilOpacity']) {
      const zero = { ...vanillaEyes(), [key]: -0 };
      const f = fixture({ eyeStyle: zero });
      try {
        f.render();
        checkAtomic(f, () => { f.metadata.eyes = { ...zero, [key]: 0 }; });
      } finally { f.close(); }
    }

    const retainedStyles = fixture();
    try {
      const f = retainedStyles;
      const styles = [0.02, 0.04, 0.06].map((pupilTravel, i) => ({ ...vanillaEyes(), pupilTravel, radius: 4 + i }));
      let count = 0;
      f.scene.reset();
      f.scene.apply_frame_with_eye_geometry(bundle(syntheticSetup(), appearance([1], 17), appearance([2], 29),
        [115, 0, 0, 0], appearance([3], 31)), false, () => styles[count++]);
      f.scene.advance(44, false).free();
      f.transform((snapshot, request) => ({ ...snapshot,
        recipe: { ...snapshot.recipe, eyes: styles[request.customBytes[0] - 1] } }));
      f.render();
      eq(f.requests.map(r => [r.own, [...r.customBytes]]), [[false, [2]], [false, [3]]]);
      eq(JSON.parse(f.scene.snapshot()).own.eyes.pupilX, 0, 'immediately removed own retains unadvanced pupil');
      eq(JSON.parse(f.scene.drawn_snakes()).map(r => r.snake.eyes.pupilX), [0.04, 0.06]);
      f.transform((snapshot, request) => ({ ...snapshot, recipe: { ...snapshot.recipe, eyes: styles[request.own ? 0 : 1] } }));
      checkAtomic(f);
    } finally { retainedStyles.close(); }

    const directValidation = fixture();
    try {
      let getters = 0;
      for (const [key, value] of Object.entries(vanillaEyes())) {
        for (const accessor of [false, true]) {
          const eyes = vanillaEyes(); delete eyes[key];
          if (accessor) Object.defineProperty(eyes, key, { get() { getters++; return value; } });
          else Object.setPrototypeOf(eyes, { [key]: value });
          directValidation.transform(s => ({ ...s, recipe: { ...s.recipe, eyes } }));
          checkAtomic(directValidation);
        }
      }
      eq(getters, 0);
    } finally { directValidation.close(); }

    const boundary = fixture();
    try {
      const { scene, target, foods, background } = boundary;
      const view = () => JSON.parse(scene.snapshot()).boundary;
      const renderers = [() => scene.render(target, ...foods, background, 1, false), boundary.render];
      const boundaryState = () => [view(), Array.from(scene.boundary_samples())];
      const arc = render => {
        target.context.trace = [];
        const before = boundaryState(); render();
        eq(boundaryState(), before, 'both renderers leave the ring untouched');
        const strokes = target.context.trace.filter(call => call.op === 'stroke');
        eq(strokes.length, 1, 'one setup boundary per draw');
        return strokes[0].path[0][2];
      };
      for (const render of renderers) eq(arc(render), 1000, 'unchanged fixture radius');
      scene.apply_frame(Uint8Array.of(122, 0, 1, 144), false); // Authored radius 400.
      const samples = scene.boundary_samples();
      for (const render of renderers) eq(arc(render), 1000, 'target packets cannot jump the drawn boundary');
      scene.advance(44, false).free();
      for (const render of renderers) eq(arc(render), 1000, 'fractional update cannot consume boundary');
      scene.advance(48, false).free();
      for (const render of renderers) eq(arc(render), 1000, 'first whole step displays the original radius');
      scene.advance(88, false).free();
      for (const render of renderers) eq(arc(render), samples[5], 'both paths draw the eased absolute radius');
      scene.set_connected(false);
      scene.advance(128, false).free();
      for (const render of renderers) eq(arc(render), samples[5], 'disconnected draws retain the paused display');
      for (const render of renderers) {
        const before = boundary.state(); const ring = scene.boundary_samples();
        target.context.failMethod = 'arc';
        rejects(render); eq(boundary.state(), before); eq(scene.boundary_samples(), ring);
        eq(target.context.stack.length, 0, 'Canvas failure balances the frame');
        target.context.failMethod = null;
      }
      scene.reset();
      const retained = scene.boundary_samples();
      for (const render of renderers) {
        target.context.trace = []; render();
        eq(target.context.trace.filter(call => call.op === 'stroke'), [], 'retained ring without Setup draws no boundary');
        eq(scene.boundary_samples(), retained);
      }
      scene.apply_frame(syntheticSetup(), false);
      for (const render of renderers) eq(arc(render), 1000, 'Setup replaces the retained display');
    } finally { boundary.close(); }
    const inherited = fixture();
    const priorValue = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    let getterCalls = 0;
    try {
      inherited.transform(snapshot => {
        const invalid = { ...snapshot };
        Object.defineProperty(invalid, 'schema', Object.assign(Object.create(null), {
          get() { getterCalls++; return 1; }, configurable: true,
        }));
        return invalid;
      });
      const failure = checkAtomic(inherited, () => {
        Object.defineProperty(Object.prototype, 'value', { value: 1, writable: true, configurable: true });
      });
      ok(String(failure).includes('metadata accessor at schema'));
      eq(getterCalls, 0, 'inherited descriptor values cannot admit accessor metadata');
    } finally {
      delete Object.prototype.value;
      if (priorValue) Object.defineProperty(Object.prototype, 'value', priorValue);
      inherited.close();
    }
    const f = fixture();
    try {
      const quality = f.quality.snapshot();
      f.render();
      eq(f.quality.snapshot(), quality, 'quality is borrowed and unchanged');
      eq(f.requests.map(r => [r.drawOrdinal, r.id, r.own, r.skin]), [[0, 0, true, 0], [1, 7, false, 1], [2, 8, false, 2]]);
      ok(f.requests.every(r => Object.getPrototypeOf(r) === Object.prototype && r.customBytes instanceof Uint8Array));
      ok(f.requests.every(r => Number.isFinite(r.x) && Number.isFinite(r.y)));
      eq(new Set(f.requests).size, 3);
      const images = bodyImages(f);
      ok(images.length > 100);
      eq(f.target.context.trace[0].op, 'reset');
      eq(f.target.context.stack.length, 0, 'frame restores its context scope');
      const trace = f.target.context.trace;
      const firstBody = trace.findIndex(v => v.op === 'image' && f.sources.includes(v.source));
      eq(trace.slice(0, firstBody).filter(v => v.op === 'image').length, 28, 'all food precedes all snake lanes');
      const own = JSON.parse(f.scene.snapshot()).own;
      const samples = f.scene.own_curve(1, false);
      const n = samples.length / 3;
      eq(images[0].source, f.sources[4], 'HQ starts with tail outline');
      const camera = JSON.parse(f.scene.snapshot()).camera;
      eq(images[0].transforms, [['setTransform', 1, 0, 0, 1, 0, 0], ['translate', 480, 270],
        ['translate', (samples[(n - 1) * 3] - camera.absoluteX) * camera.zoom,
          (samples[(n - 1) * 3 + 1] - camera.absoluteY) * camera.zoom]]);
      const opacity = (own.spawnProgress * (1 - own.deathProgress)) ** 2;
      eq(images[0].alpha, opacity);
      eq(images[0].blend, 'source-over');
      const ownCalls = 3 * n + 13;
      eq(trace.slice(firstBody).findIndex(v => v.op === 'fill') > ownCalls, true);
      const firstEye = trace.findIndex(v => v.op === 'fill');
      eq(trace.slice(firstBody, firstEye).filter(v => v.op === 'image').length, ownCalls,
        'complete ordered body passes precede eyes');
      eq(trace.slice(firstEye).filter(v => v.op === 'fill').length, 12);
      const sequence = trace.slice(firstEye).filter(v => v.op === 'image' || v.op === 'fill');
      eq(sequence.slice(0, 4).map(v => v.op), ['fill', 'fill', 'fill', 'fill']);
      eq(sequence[4].op, 'image', 'both eye/pupil pairs finish before next snake');
      const variants = images.filter(v => v.source === f.sources[0] || v.source === f.sources[1]);
      ok(variants.some(v => v.source === f.sources[0] && v.args.length === 4));
      ok(variants.some(v => v.source === f.sources[0] && v.args.length === 8 && v.args.slice(0, 4).join() === '0,0,32,32'));
      ok(variants.some(v => v.source === f.sources[1] && v.args.length === 8 && v.args.slice(0, 4).join() === '2,3,12,14'));
      ok(variants.some(v => v.source === f.sources[1] && v.args.length === 4));
      const firstBase = variants[0];
      eq(firstBase.transforms.at(-1), ['rotate', samples[(n - 1) * 3 + 2]]);
      eq(firstBase.args.slice(-4), [-camera.zoom * ((29 * own.scale) * 0.5),
        -camera.zoom * ((29 * own.scale) * 0.5), camera.zoom * 2 * ((29 * own.scale) * 0.5),
        camera.zoom * 2 * ((29 * own.scale) * 0.5)]);
      const invalid = images.filter(v => v.alphaWrites.at(-1).requested > 1);
      // This fixture's low spawn opacity may keep every tail request in range.
      for (const call of invalid) eq(call.alpha, call.alphaWrites[0].effective);
    } finally { f.close(); }

    const failures = [
      f => { f.metadata.status = 'pending'; },
      f => { f.metadata.status = 'unsupported'; },
      f => { f.metadata.unsupportedFeatures = ['synthetic-antenna']; },
      f => { f.metadata.attachment = { asset: 0, anchor: 'head', scale: 1, pivotX: 0, pivotY: 0, opacity: 1 }; },
      f => { f.metadata.eyes.distance = 7; },
      f => { f.metadata.eyes.angleSmoothing = 0.1; },
      f => { f.metadata.eyes.pupilTravel = 3; },
      f => { delete f.metadata.bodyStyle; },
      f => { f.catalog[0].source = f.target; },
      f => { f.catalog[0].state = 'pending'; },
      f => { f.sources[1].complete = false; },
      f => { f.background.complete = false; },
      f => { f.foods[0].width = 0; },
    ];
    for (const mutate of failures) { const f = fixture(); try { checkAtomic(f, () => mutate(f)); } finally { f.close(); } }
    const invalidSnapshots = [
      s => ({ ...s, schema: 2 }), s => ({ ...s, revision: NaN }), s => ({ ...s, revision: '' }),
      s => ({ ...s, recipe: { ...s.recipe, bodyStyle: { ...s.recipe.bodyStyle, swell: NaN } } }),
      s => ({ ...s, recipe: { ...s.recipe, supportedFeatures: ['body-palettes'] } }),
      s => ({ ...s, recipe: { ...s.recipe, palettes: [{ ...s.recipe.palettes[0], variants: [{
        ...s.recipe.palettes[0].variants[0], sourceMode: 'bad' }] }, s.recipe.palettes[1]] } }),
      s => ({ ...s, recipe: { ...s.recipe, palettes: [{ ...s.recipe.palettes[0], variants: [{
        ...s.recipe.palettes[0].variants[0], asset: { ...s.recipe.palettes[0].variants[0].asset, width: 33 } }] }, s.recipe.palettes[1]] } }),
      s => ({ ...s, recipe: { ...s.recipe, palettes: [{ ...s.recipe.palettes[0], variants: [{
        ...s.recipe.palettes[0].variants[0], asset: { ...s.recipe.palettes[0].variants[0].asset, kind: 'image' } }] }, s.recipe.palettes[1]] } }),
      s => ({ ...s, recipe: { ...s.recipe, palettes: [{ ...s.recipe.palettes[0], variants: [{
        ...s.recipe.palettes[0].variants[0], asset: { ...s.recipe.palettes[0].variants[0].asset, id: 4096 } }] }, s.recipe.palettes[1]] } }),
      s => ({ ...s, recipe: { ...s.recipe, palettes: [{ ...s.recipe.palettes[0], variants: [{
        ...s.recipe.palettes[0].variants[0], sourceMode: 'whole', sourceRect: [1, 0, 31, 32] }] }, s.recipe.palettes[1]] } }),
      s => ({ ...s, recipe: { ...s.recipe, palettes: [{ ...s.recipe.palettes[0], variants: [{
        ...s.recipe.palettes[0].variants[0], sourceMode: 'crop', sourceRect: [1, 0, 32, 32] }] }, s.recipe.palettes[1]] } }),
    ];
    for (const transform of invalidSnapshots) { const f = fixture(); try { f.transform(transform); checkAtomic(f); } finally { f.close(); } }
    for (const method of ['createPattern', 'translate', 'scale', 'arc', 'rotate', 'setTransform']) {
      const f = fixture(); try {
        const before = f.state(); f.target.context.failMethod = method;
        rejects(() => f.render()); eq(f.state(), before); eq(f.target.context.stack.length, 0);
      } finally { f.close(); }
    }
    const exception = fixture();
    try {
      const before = exception.state(); exception.target.context.failSource = exception.sources[0];
      rejects(() => exception.render()); eq(exception.state(), before); eq(exception.target.context.stack.length, 0);
      ok(bodyImages(exception).length > 0, 'Canvas exception may follow partial pixels/submission');
      exception.target.context.failSource = null; exception.render();
      ok(exception.state()[0] !== before[0]);
    } finally { exception.close(); }

    const duplicates = fixture();
    try {
      duplicates.scene.reset();
      duplicates.scene.apply_frame(bundle(syntheticSetup(), appearance([1, 4], 17), appearance([2, 8], 29)), false);
      duplicates.scene.advance(40, false).free();
      duplicates.render();
      eq(duplicates.requests.map(r => [r.id, r.own, r.skin, [...r.customBytes], r.cosmetic, r.attachmentId]),
        [[0, true, 0, [1, 4], 17, undefined], [0, false, 0, [2, 8], 29, undefined]]);
      duplicates.requests[0].customBytes.fill(255);
      duplicates.requests.length = 0; duplicates.render();
      eq([...duplicates.requests[0].customBytes], [1, 4], 'callback bytes cannot mutate retained appearance');
      duplicates.scene.apply_frame(bundle([115, 0, 0, 0], appearance([3], 31)), false);
      duplicates.requests.length = 0; duplicates.render();
      eq(duplicates.requests.map(r => [r.own, [...r.customBytes], r.cosmetic]), [[false, [2, 8], 29], [false, [3], 31]]);
    } finally { duplicates.close(); }

    for (const detailed of [false, true]) {
      const f = fixture({ eyes: false, detailed }); try {
        f.render(); eq(f.target.context.trace.filter(v => v.op === 'fill').length, 0, 'explicit no-eyes lane');
        ok(bodyImages(f).length > 0);
      } finally { f.close(); }
    }
    const heterogeneous = fixture();
    try {
      heterogeneous.transform((snapshot, request) => ({ ...snapshot, recipe: { ...snapshot.recipe,
        bodyStyle: { ...snapshot.recipe.bodyStyle, detailedSegments: request.drawOrdinal === 1 } } }));
      heterogeneous.render();
      const first = heterogeneous.target.context.trace.findIndex(v => v.op === 'fill');
      const second = heterogeneous.target.context.trace.findIndex((v, i) => i > first && v.op === 'image');
      const nextEye = heterogeneous.target.context.trace.findIndex((v, i) => i > second && v.op === 'fill');
      const secondImages = heterogeneous.target.context.trace.slice(second, nextEye).filter(v => v.op === 'image');
      const curve = heterogeneous.scene.own_curve(1, false);
      ok(secondImages.filter(v => v.source === heterogeneous.sources[4]).length < curve.length / 3);
      ok(secondImages.filter(v => v.source === heterogeneous.sources[0] || v.source === heterogeneous.sources[1]).length > curve.length / 3,
        'detailed sampling is denser while its full-effect flags use a per-snake cadence');
    } finally { heterogeneous.close(); }
    const low = fixture();
    try {
      low.quality.set_requested_mode(0); low.quality.begin_connection();
      const before = low.quality.snapshot(); low.render(); eq(low.quality.snapshot(), before);
      eq(bodyImages(low).some(v => v.source === low.sources[4]), false, 'applied LQ disables outline even with high preference history');
      eq(low.scene.own_curve(1.7, false).length > 0, true);
    } finally { low.close(); }
    const short = fixture();
    try {
      short.scene.reset(); short.scene.apply_frame(bundle(syntheticSetup(), appearance().slice(0, -22)), false);
      short.render(); eq(bodyImages(short).length, 0); eq(short.target.context.trace.filter(v => v.op === 'fill').length, 4);
      short.scene.apply_frame(syntheticStep(1), false); short.render(); ok(bodyImages(short).length > 0);
    } finally { short.close(); }
    const incoherent = fixture();
    try {
      incoherent.transform((snapshot, request) => ({ ...snapshot, revision: request.drawOrdinal })); checkAtomic(incoherent);
    } finally { incoherent.close(); }
    const culled = fixture();
    try {
      culled.scene.set_follows(false);
      culled.scene.set_camera_position(1000000, 1000000);
      culled.render(() => { throw new Error('culled recipe must not resolve'); });
      eq(bodyImages(culled).length, 0);
      eq(culled.target.context.trace.filter(v => v.op === 'fill').length, 0);
      eq(culled.requests.length, 0);
    } finally { culled.close(); }
    for (const callback of [() => { throw new Error('synthetic trusted callback'); }, () => Promise.resolve({})]) {
      const f = fixture(); try { checkAtomic(f, null, callback); } finally { f.close(); }
    }
    const aliases = fixture();
    try {
      aliases.transform(s => ({ ...s, recipe: { ...s.recipe, palettes: [{ ...s.recipe.palettes[0], variants: [
        s.recipe.palettes[0].variants[0], { ...s.recipe.palettes[0].variants[1],
          asset: { ...s.recipe.palettes[0].variants[1].asset, id: 0, source: aliases.sources[1], kind: 'image', width: 64, height: 64 },
          sourceRect: [0, 0, 64, 64] }], }, s.recipe.palettes[1]] } }));
      ok(String(checkAtomic(aliases)).includes('incoherent catalog entry'));
    } finally { aliases.close(); }
    const changed = fixture();
    try {
      checkAtomic(changed, null, request => {
        const snapshot = changed.resolve(request);
        if (request.drawOrdinal === 2) changed.sources[0].width = 31;
        return snapshot;
      });
    } finally { changed.close(); }

    const saturated = fixture();
    try {
      for (let i = 2; i <= 15; i++) saturated.scene.advance(i * 40, false).free();
      saturated.render();
      const invalid = bodyImages(saturated).filter(v => v.alphaWrites.at(-1).requested > 1);
      ok(invalid.length > 0, 'production tail shadows exercise ignored out-of-range alpha');
      for (const draw of invalid) {
        eq(draw.alpha, draw.alphaWrites[0].effective);
        ok(draw.alpha !== 1 || draw.alphaWrites[0].effective === 1);
      }
      saturated.snapshot.revision = 'synthetic-2';
      saturated.target.context.trace = []; saturated.requests.length = 0; saturated.render();
      eq(saturated.requests.length, 3, 'every draw resolves again without caching');
    } finally { saturated.close(); }
    for (const mode of [0, 1]) {
      const boost = fixture();
      try {
        boost.quality.set_requested_mode(mode); boost.quality.begin_connection();
        boost.scene.apply_frame(bundle([51, 255], [51, 0, 7, 255], [51, 0, 8, 255]), false);
        for (let i = 2; i <= 20; i++) boost.scene.advance(i * 40, false).free();
        boost.scene.apply_frame(Uint8Array.of(115, 0, 0, 1), false);
        boost.scene.advance(804, false).free();
        boost.metadata.bodyStyle.headFade = { palette: 1, length: 3.5 };
        boost.metadata.bodyStyle.tailFade = { palette: 0, length: 4.5 };
        boost.render();
        const images = bodyImages(boost);
        ok(images.some(v => v.source === boost.sources[2]));
        ok(images.some(v => v.source === boost.sources[3]), 'mixed runs use their own glow objects');
        ok(images.filter(v => v.source === boost.sources[2] || v.source === boost.sources[3]).every(v => v.blend === 'lighter'));
        ok(images.some(v => v.source === boost.sources[6] && v.blend === 'lighter'), 'death highlight completes before eyes');
        const trace = boost.target.context.trace;
        const firstEye = trace.findIndex(v => v.op === 'fill');
        const own = trace.slice(0, firstEye).filter(v => v.op === 'image' && boost.sources.includes(v.source));
        eq(own.at(-1).source, boost.sources[6], 'death is the last image pass for a dying snake');
        eq(trace[firstEye].blend, 'source-over', 'eye lane restores source-over after death');
        const pupilAlpha = trace.slice(firstEye).filter(v => v.op === 'fill')[3].alpha;
        const remoteStart = trace.findIndex((v, i) => i > firstEye && v.op === 'image');
        // The final two writes on each flattened image retain requested/effective
        // semantics, even though nested planner scopes are flattened for Canvas.
        eq(trace[remoteStart].alphaWrites.length, 2);
        const remoteGlow = trace[remoteStart];
        ok(remoteGlow.alphaWrites.every(v => Number.isFinite(v.effective)));
        ok(pupilAlpha < 1 && pupilAlpha > 0, 'dying eyes fade before the unconditional face-exit alpha reset');
        ok(trace.slice(firstEye, remoteStart).some(v => v.op === 'alpha' && v.requested === 1 && v.effective === 1),
          'every completed face restores root alpha one before the next body');
        const n = boost.scene.own_curve(mode === 0 ? 1.7 : 1, false).length / 3;
        const glowCalls = own.filter(v => v.source === boost.sources[2] || v.source === boost.sources[3]);
        eq(glowCalls.length, n * (mode === 0 ? 1 : 2), 'applied quality gates inner shimmer independently of outer boost');
      } finally { boost.close(); }
    }
    const transition = fixture();
    try {
      for (let i = 0; i < 2; i++) transition.quality.update_statistics(1001 * (i + 1), 0, true);
      const step = transition.scene.advance(48, false);
      try { transition.quality.advance(step, true); } finally { step.free(); }
      const q = JSON.parse(transition.quality.snapshot());
      ok(!q.highQuality && q.qualityBlend > 0 && q.qualityBlend < 1);
      const before = transition.quality.snapshot(); transition.render(); eq(transition.quality.snapshot(), before);
      ok(bodyImages(transition).some(v => v.source === transition.sources[4]), 'nonzero blend keeps quality passes during fallback');
    } finally { transition.close(); }
    const limits = fixture({ eyes: false, detailed: true });
    try {
      limits.scene.reset();
      const frames = denseScene({ snakes: 128, anchors: 512, foods: 0, spread: 100 });
      for (const frame of frames) limits.scene.apply_frame(frame, false);
      for (const frame of frames.slice(1)) limits.scene.apply_frame(frame, false);
      limits.scene.advance(40, false).free();
      // Dense curves plus overlapping overlays exceed the aggregate command
      // budget while every individual snake remains within its planner bound.
      limits.metadata.bodyStyle.headFade = { palette: 0, length: 65535 };
      limits.metadata.bodyStyle.tailFade = { palette: 1, length: 65535 };
      ok(String(checkAtomic(limits)).includes('CommandLimit'), 'aggregate image-command budget fails before reset');
    } finally { limits.close(); }
    return { assertions, synthetic: true, browser: false, reference: false, network: false };
  } finally {
    for (const [key, prior] of globals) {
      if (prior) Object.defineProperty(globalThis, key, prior); else delete globalThis[key];
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadWasm } = await import('./reference-context.mjs');
  console.log(JSON.stringify(bodyRenderSmoke(await loadWasm())));
}
