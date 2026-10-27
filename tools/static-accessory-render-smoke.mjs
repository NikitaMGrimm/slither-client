import assert from 'node:assert/strict';
import { bundle, syntheticScene, syntheticSetup } from '../web/synthetic-scene.mjs';

// Authored synthetic packets/sources and a logical Canvas state recorder. This
// calls the real compiled Wasm ABI; it supplies no native-layout or pixel oracle.
export async function staticAccessoryRenderSmoke(wasm, options = {}) {
  const createSkinProvider = options.createSkinProvider ?? (await import('../web/skin-provider.mjs')).createSkinProvider;
  let assertions = 0, cases = 0;
  const eq = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
  const ok = (v, message) => { assertions++; assert(v, message); };
  const rejects = (fn, message) => { assertions++; assert.throws(fn, message); };
  class CanvasRenderingContext2D {
    trace = []; stack = []; alpha = 1; blend = 'source-over'; transforms = []; beforeCall = null;
    reset() { this.stack = []; this.alpha = 1; this.blend = 'source-over'; this.transforms = []; this.trace.push({ op: 'reset' }); }
    call(method, source) { this.beforeCall?.(method, this, source); }
    get globalAlpha() { return this.alpha; }
    set globalAlpha(value) { if (Number.isFinite(value) && value >= 0 && value <= 1) this.alpha = value;
      this.trace.push({ op: 'alpha', value, effective: this.alpha }); }
    get globalCompositeOperation() { return this.blend; }
    set globalCompositeOperation(value) { this.call('blend'); this.blend = value; this.trace.push({ op: 'blend', value }); }
    save() { this.call('save'); this.stack.push({ alpha: this.alpha, blend: this.blend, transforms: this.transforms.slice() }); this.trace.push({ op: 'save' }); }
    restore() { assert(this.stack.length, 'balanced Canvas save'); Object.assign(this, this.stack.pop()); this.trace.push({ op: 'restore' }); }
    setTransform(...args) { this.call('setTransform'); this.transforms = [['setTransform', ...args]]; this.trace.push({ op: 'setTransform', args }); }
    translate(...args) { this.call('translate'); this.transforms.push(['translate', ...args]); this.trace.push({ op: 'translate', args }); }
    rotate(...args) { this.call('rotate'); this.transforms.push(['rotate', ...args]); this.trace.push({ op: 'rotate', args }); }
    scale(...args) { this.call('scale'); this.transforms.push(['scale', ...args]); }
    createPattern(source, repetition) { this.call('createPattern'); return { source, repetition }; }
    beginPath() { this.call('beginPath'); }
    moveTo() { this.call('moveTo'); }
    lineTo() { this.call('lineTo'); }
    closePath() { this.call('closePath'); }
    arc(...args) { this.call('arc'); this.trace.push({ op: 'arc', args }); }
    fill() { this.call('fill'); this.trace.push({ op: 'fill', alpha: this.alpha }); }
    stroke() { this.call('stroke'); }
    fillRect() { this.call('fillRect'); }
    drawImage(source, ...args) { this.call('drawImage', source); this.trace.push({ op: 'image', source, args,
      alpha: this.alpha, blend: this.blend, transforms: this.transforms.slice(), depth: this.stack.length }); }
  }
  class HTMLCanvasElement {
    context = new CanvasRenderingContext2D(); _width = 40; height = 30;
    constructor(name) { this.name = name; this.context.canvas = this; }
    get width() { return this._width; }
    set width(value) { this._width = value; this.context.reset(); }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  }
  class HTMLImageElement { complete = true; naturalWidth = 40; naturalHeight = 30; constructor(name) { this.name = name; } }
  const realm = { HTMLCanvasElement, HTMLImageElement };
  const globals = new Map(Object.entries({ ...realm, CanvasRenderingContext2D }).map(([key, value]) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); return [key, old];
  }));
  const unused = () => { throw new Error('unexpected synthetic factory or RNG'); };
  const geometry = () => ({ forward: 5, imageScale: 0.25, pivotX: 3, pivotY: 7 });
  const eyes = () => ({ kind: 'standard', distance: 6, separation: 6, radius: 6, pupilRadius: 3.5,
    pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0, outlineColor: 0,
    eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 });
  const sideGeometry = () => ({ forward: 7, lateral: 3, lateralBias: 0.5, rotationOffset: 0.25,
    imageScale: 0.25, pivotX: 7, pivotY: 4, width: 17, height: 13 });
  const antennaGeometry = () => ({ kind: 'ordinary-chain', nodes: 8, outerColor: 0x176b39, innerColor: 0xe8a52b,
    innerOpacity: 0.375, repeatedInnerStrokes: true, rotateBulb: true,
    bulb: { offsetX: -7.25, offsetY: 3.125, width: 23, height: 17, scale: 0.625, opacity: 0.8125 } });
  const random = request => new Float64Array(request.randomPairCount * 2).fill(0.5);
  function packet(id = 0, heading = 0, points = 2, x = 32550, y = 32550) {
    const u16 = n => [n >>> 8 & 255, n & 255], u24 = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
    const a = Math.round(heading / (Math.PI * 2) * 16777215), px = u24(x * 5), py = u24(y * 5);
    return Uint8Array.from([115, ...u16(id), ...u24(a), 48, ...u24(a), ...u16(0), ...u24(0), 0,
      ...px, ...py, 0, 0, 255, ...(points ? [...u24((x - 8) * 5), ...py, ...Array.from({length: points - 2}, () => [127, 127]).flat(), ...u16(0)] : [])]);
  }
  function fixture({ family = 'paired', accessory = geometry(), side = false, antenna = false,
    packets = bundle(syntheticSetup(), packet()), spawn = false, factories = false, mixed = false, legacy = false, score = false } = {}) {
    const scene = new wasm.AnimatedScene(0), quality = new wasm.DesktopQuality(1, 0);
    if (score) scene.enable_score_tracking();
    const target = new HTMLCanvasElement('target'); target.width = 800; target.height = 600;
    const sprites = [0, 1, 2].map(i => new HTMLCanvasElement(`stand-in-${i}`));
    const background = new HTMLImageElement('background');
    const sources = ['body', 'accessory', 'side', 'marks', 'mouth', 'bulb'].map(name => new HTMLCanvasElement(name));
    const catalog = sources.map((source, id) => ({ source, state: 'ready', revision: `source-${id}` }));
    const snapshot = { revision: 'capture-1', assetCatalog: catalog };
    const use = id => ({ asset: id });
    const selectedFamily = request => mixed ? ['paired', 'mouth-face', 'single-image'][request.id % 3] : family;
    const selectedAccessory = request => selectedFamily(request) === 'single-image' && mixed ? null : accessory;
    const select = request => ({
      face: selectedFamily(request) === 'paired' ? { kind: 'paired', eyes: eyes(), decoration:
        side ? { kind: 'paired-side-images', geometry: sideGeometry() } : null }
        : { kind: selectedFamily(request), geometry: selectedFamily(request) === 'mouth-face'
          ? { pupilTravel: 1.375 } : { baseSize: 19, pupilSize: 7, pupilTravel: 2 } },
      antenna: antenna ? antennaGeometry() : null, accessory: selectedAccessory(request),
    });
    const metadata = request => {
      const kind = selectedFamily(request), g = selectedAccessory(request);
      return { status: 'ready', custom: false, basePalette: 0, runs: [{ palette: 0, count: 1 }],
        palettes: [{ variants: [use(0)], boostGlow: use(0) }], variantMode: 'first', variantPeriod: 1,
        eyes: kind === 'paired' ? eyes() : kind === 'mouth-face' ? { kind, geometry: { pupilTravel: 1.375 },
          eyeMarks: { ...use(3), sourceMode: 'whole' }, mouth: { ...use(4), sourceMode: 'whole' } }
          : { kind, geometry: { baseSize: 19, pupilSize: 7, pupilTravel: 2 }, baseImage: use(3), pupilImage: use(4) },
        effects: ['outline', 'shadow', 'death-highlight'].map(kind => ({ ...use(0), kind, opacity: 1 })),
        bodyStyle: { detailedSegments: false, swell: 0, rotateSegments: true, headFade: null, tailFade: null },
        faceDecoration: side && kind === 'paired' ? { kind: 'paired-side-images', geometry: sideGeometry(), image: use(2) } : null,
        antenna: antenna ? { kind: 'ordinary-chain', geometry: antennaGeometry(), image: { ...use(5), sourceMode: 'whole' } } : null,
        attachment: g ? { ...use(1), kind: 'static-head-image', anchor: 'head', forward: g.forward,
          scale: g.imageScale, pivotX: g.pivotX, pivotY: g.pivotY, opacity: 1, sourceMode: 'crop', sourceRect: [0, 0, 20, 12] } : null,
        unsupportedFeatures: [] };
    };
    let mutate = value => value, transform = value => value, requests = 0, activeRequest;
    const copy = value => Array.isArray(value) ? value.map(copy)
      : value && Object.getPrototypeOf(value) === Object.prototype ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, copy(v)])) : value;
    const provider = createSkinProvider({ trusted: true, realm, resolveHostRecipe: request => request,
      normalizeHostRecipe: () => mutate(metadata(activeRequest), activeRequest) });
    const resolve = request => { requests++; activeRequest = request; return transform(copy(provider.resolve(request, snapshot)), request); };
    const install = (bytes, callback = select, mode = factories ? 'all' : 'basic') => {
      const method = `apply_frame_with_${legacy ? 'face' : 'accessory'}_presentation${mode === 'all' ? '_and_all_factories' : mode === 'food' ? '_and_factories' : ''}`;
      const args = [bytes, false, callback]; if (mode !== 'basic') args.push(unused); if (mode === 'all') args.push(unused);
      scene[method](...args);
    };
    const render = (lane, { atSize = false, callback = resolve, old = false } = {}) => {
      const args = [target, ...sprites, background]; if (atSize) args.push(801, 601);
      if (lane === 'basic') args.push(false); args.push(callback, antenna ? random : unused, quality);
      scene[`render_${lane === 'standard' ? 'standard_' : ''}with_${old ? 'face' : 'accessory'}_presentation${atSize ? '_at_size' : ''}`](...args);
    };
    const setup = (lane, bytes, { prey = true, width = 800, height = 600, callback = resolve, hud = null } = {}) => {
      const args = [bytes, false, select, unused]; if (prey) args.push(unused);
      args.push(target, ...sprites, background, width, height); if (lane === 'basic') args.push(false);
      args.push(callback, antenna ? random : unused, quality); if (hud) args.push(hud);
      return scene[`apply_frame_and_render_${lane === 'standard' ? 'standard_' : ''}with_accessory_presentation${prey ? '_and_prey' : ''}${hud ? '_and_hud' : ''}`](...args);
    };
    const state = () => [scene.snapshot(), scene.face_state(), scene.drawn_snakes(), scene.food_state(), scene.prey_state(),
      [...scene.camera_samples()], [...scene.own_body_samples()], [...scene.own_body()], [...scene.length_samples()],
      [...scene.boundary_samples()], [...scene.arena_edge_view()]];
    try {
      install(packets);
      scene.set_follows(false); scene.set_camera_position(32540, 32530); scene.set_zoom(0.5);
      if (!spawn) scene.advance(40, false).free(); target.context.trace = [];
    } catch (e) { scene.free(); quality.free(); throw e; }
    return { scene, quality, target, sources, catalog, snapshot, sprites, background, select, install, render, setup, state,
      resolve, metadata, requests: () => requests, mutate: fn => { mutate = fn; }, transform: fn => { transform = fn; },
      close: () => { scene.free(); quality.free(); } };
  }
  const images = (f, role = 1) => f.target.context.trace.filter(c => c.op === 'image' && c.source === f.sources[role]);
  const scrub = f => f.target.context.trace.map(c => c.source ? { ...c, source: c.source.name } : c);
  const atomic = (f, operation, pattern) => {
    const before = f.state(), trace = f.target.context.trace.slice(), size = [f.target.width, f.target.height];
    rejects(operation, pattern); eq(f.state(), before, 'model rollback');
    eq(f.target.context.trace, trace, 'preflight before Canvas'); eq([f.target.width, f.target.height], size);
    eq(f.target.context.stack.length, 0); cases++;
  };
  function exact(f, g = geometry()) {
    const rows = JSON.parse(f.scene.drawn_snakes()), camera = JSON.parse(f.scene.snapshot()).camera;
    const selected = rows.filter(row => f.select({id: row.snake.id}).accessory !== null);
    const draws = images(f); eq(draws.length, selected.length);
    for (let i = 0; i < selected.length; i++) {
      const m = selected[i].snake, h = m.eyes.heading, z = camera.zoom, D = g.forward * m.scale, M = (m.scale * z) * g.imageScale;
      eq(draws[i].transforms, [['setTransform', 1, 0, 0, 1, 0, 0],
        ['translate', f.target.width / 2 + ((Math.cos(h) * D + m.correctedX) - camera.absoluteX) * z,
          f.target.height / 2 + ((Math.sin(h) * D + m.correctedY) - camera.absoluteY) * z], ['rotate', h]], 'W01/W02 ordered translation, captured heading and no gaze');
      eq(draws[i].args, [0, 0, 20, 12, (-M) * g.pivotX, (-M) * g.pivotY, M * 20, M * 12], 'W03/W06 explicit origin crop');
      const base = m.spawnProgress * (1 - m.deathProgress); eq(draws[i].alpha, base * base, 'W07 squared spawn/death');
      eq(draws[i].blend, 'source-over');
    }
    eq(f.target.context.stack.length, 0); cases++;
  }
  try {
    ok(typeof wasm.AnimatedScene.prototype.apply_frame_with_accessory_presentation === 'function', 'missing selected accessory ABI');
    for (const name of Object.getOwnPropertyNames(wasm.AnimatedScene.prototype).filter(name => name.includes('with_face_presentation'))) {
      const added = name.replace('with_face_presentation', 'with_accessory_presentation');
      ok(typeof wasm.AnimatedScene.prototype[added] === 'function', 'complete additive selected Wasm method family');
      eq(wasm.AnimatedScene.prototype[added].length, wasm.AnimatedScene.prototype[name].length, 'new method argument count mirrors legacy');
    }
    for (const lane of ['basic', 'standard']) {
      const rational = fixture({ packets: bundle(syntheticSetup(), packet(0, 0, 108, 100, 200)), spawn: true });
      try {
        rational.scene.set_camera_position(90, 180);
        // Existing draw preparation advances automatic zoom by .0002.
        rational.scene.set_zoom(0.4998); rational.render(lane);
        const d = images(rational)[0];
        eq(JSON.parse(rational.scene.snapshot()).own.scale, 2, 'W01 exact entity scale');
        eq(d.transforms, [['setTransform', 1, 0, 0, 1, 0, 0], ['translate', 410, 310], ['rotate', 0]], 'W01 hand-derived rational translation');
        eq(d.args, [0, 0, 20, 12, -0.75, -1.75, 5, 3], 'W01 hand-derived rational crop destination');
        eq(d.alpha, 0, 'W01 geometry with deliberately unadvanced spawn'); cases++;
      } finally { rational.close(); }
      for (const family of ['paired', 'mouth-face']) for (const antenna of [false, true]) {
        const f = fixture({ family, side: family === 'paired', antenna });
        try {
          f.render(lane); exact(f);
          const calls = f.target.context.trace, index = calls.indexOf(images(f)[0]);
          if (family === 'paired') {
            ok(calls.slice(0, index).filter(c => c.op === 'arc').length === 4, 'complete paired eyes before accessory');
            const sides = images(f, 2); eq(sides.length, 2); ok(calls.indexOf(sides[0]) > index); eq(sides.map(c => c.alpha), [1, 1]);
          } else {
            eq(calls.filter(c => c.op === 'arc').length, 0);
            const mouth = [...images(f, 3), ...images(f, 4)]; eq(mouth.length, 3);
            ok(mouth.every(c => calls.indexOf(c) > index)); eq(mouth.map(c => c.alpha), [1, 1, 1]);
          }
          if (antenna) ok(calls.indexOf(images(f, 5)[0]) < index, 'antenna stays before accessory');
          f.target.context.trace = []; f.render(lane, { atSize: true }); exact(f);
          f.target.context.trace = []; f.scene.apply_frame_with_accessory_presentation(Uint8Array.of(115, 0, 0, 1), false, f.select);
          f.scene.advance(80, false).free(); f.render(lane); exact(f);
          ok(images(f)[0].alpha > 0 && images(f)[0].alpha < 1, 'death alpha remains submitted');
        } finally { f.close(); }
      }
      const zero = fixture({ spawn: true });
      try { zero.render(lane); exact(zero); eq(images(zero)[0].alpha, 0, 'spawn zero still draws'); } finally { zero.close(); }
      const mixed = fixture({ mixed: true, packets: bundle(syntheticSetup(), packet(0), packet(1, 0.37), packet(2)) });
      try { mixed.render(lane); eq(images(mixed).length, 2); eq(images(mixed, 3).length, 3); } finally { mixed.close(); }
      const signed = fixture({ accessory: { ...geometry(), forward: -0, pivotX: -0, pivotY: 0 } });
      try {
        signed.render(lane); exact(signed, { ...geometry(), forward: -0, pivotX: -0, pivotY: 0 });
        ok(Object.is(images(signed)[0].args[4], 0)); ok(Object.is(images(signed)[0].args[5], -0));
        for (const key of ['forward', 'pivotX', 'pivotY']) {
          signed.transform(s => { s.recipe.attachment[key] = Object.is(s.recipe.attachment[key], -0) ? 0 : -0; return s; });
          atomic(signed, () => signed.render(lane), /differs from retained/);
        }
      } finally { signed.close(); }
      const gazeA = fixture(), gazeB = fixture();
      try {
        gazeA.scene.set_gaze_heading(1.2); gazeB.scene.set_gaze_heading(-1.7);
        gazeA.render(lane); gazeB.render(lane);
        eq(images(gazeA).map(c => ({ ...c, source: null })), images(gazeB).map(c => ({ ...c, source: null })), 'W02 gaze does not displace accessory');
      } finally { gazeA.close(); gazeB.close(); }
      // None preserves the full legacy Canvas command sequence and model output.
      for (const family of ['paired', 'single-image', 'mouth-face']) {
        const a = fixture({ family, accessory: null }), b = fixture({ family, accessory: null, legacy: true });
        try {
          a.render(lane);
          if (lane === 'basic') {
            b.render(lane, { old: true, callback: request => { const s = b.resolve(request), e = s.recipe.eyes;
              return { revision: s.revision, face: { kind: e.kind === 'standard' ? 'paired' : e.kind, eyes: e, decoration: null }, antenna: null }; } });
          } else b.render(lane, { old: true });
          eq(scrub(a), scrub(b), 'None retains exact old commands'); eq(a.state(), b.state()); cases++;
        } finally { a.close(); b.close(); }
      }
      const legacy = fixture({ antenna: true });
      try {
        let callbacks = 0;
        atomic(legacy, () => legacy.render(lane, { old: true, callback: () => { callbacks++; return null; } }), /accessory/i);
        eq(callbacks, 0, 'legacy rejects before resolver');
      } finally { legacy.close(); }
      const f = fixture({ side: true });
      try {
        for (const transform of [s => ({ ...s, status: 'pending', recipe: null }), s => ({ ...s, status: 'unsupported', recipe: null }),
          s => ({ ...s, recipe: null }), s => { s.recipe.attachment = null; s.recipe.supportedFeatures = s.recipe.supportedFeatures.filter(v => v !== 'head-attachment'); return s; },
          s => { delete s.recipe.attachment.kind; return s; }, s => { s.recipe.attachment.sourceMode = 'whole'; return s; },
          s => { s.recipe.attachment.sourceRect[0] = -0; return s; }, s => { s.recipe.attachment.sourceRect[1] = 1; return s; },
          s => { s.recipe.attachment.opacity = 0.5; return s; }, s => { s.recipe.supportedFeatures.pop(); return s; },
          s => { s.recipe.supportedFeatures.push('head-attachment'); return s; }, s => { s.recipe.supportedFeatures.push('unsupported'); return s; }]) {
          f.transform(transform); atomic(f, () => f.render(lane));
        }
        f.transform(s => s); f.catalog[1].state = 'pending'; atomic(f, () => f.render(lane)); f.catalog[1].state = 'ready';
        const source = f.catalog[1].source; f.catalog[1].source = f.target; atomic(f, () => f.render(lane), /aliases target/); f.catalog[1].source = source;
        for (const a of [0, -0]) {
          f.catalog[2].revision = a; f.catalog[1] = { ...f.catalog[2] };
          f.transform(s => { s.recipe.attachment.asset.revision = Object.is(a, -0) ? 0 : -0; return s; });
          atomic(f, () => f.render(lane), /incoherent/);
        }
      } finally { f.close(); }
      // Late source drift is detected after all callbacks but before target reset.
      for (const revision of [0, -0]) {
        const alias = fixture({ side: true });
        try {
          alias.catalog[2].revision = revision; alias.catalog[1] = { ...alias.catalog[2] };
          alias.render(lane);
          eq(images(alias, 2).length, 3, 'shared source still charges/submits accessory plus two sides');
          eq(images(alias).length, 0, 'no cloned replacement source');
          eq(images(alias, 2).map(c => c.args.length), [8, 4, 4], 'each shared use keeps its crop semantics'); cases++;
        } finally { alias.close(); }
      }
      const drift = fixture({ packets: bundle(syntheticSetup(), packet(0), packet(1)) });
      try {
        let count = 0;
        drift.transform(s => { if (++count === 2) drift.sources[1].width++; return s; });
        atomic(drift, () => drift.render(lane), /changed/);
      } finally { drift.close(); }
      // Saved local and frame scopes unwind, while already submitted pixels remain.
      for (const method of ['translate', 'rotate', 'drawImage']) {
        const f = fixture(), control = fixture();
        try {
          const marker = new Error(`synthetic accessory ${method}`), before = f.state(); let eyeFills = 0;
          f.target.context.beforeCall = (op, ctx, source) => {
            if (op === 'fill') eyeFills++;
            if ((method === 'drawImage' ? source === f.sources[1] : op === method && eyeFills === 4)) throw marker;
          };
          let thrown; try { f.render(lane); } catch (e) { thrown = e; }
          eq(thrown, marker); eq(f.state(), before); eq(f.target.context.stack.length, 0);
          ok(f.target.context.trace.some(c => c.op === 'reset'), 'partial target effects acknowledged');
          f.target.context.beforeCall = null; f.target.context.trace = []; control.target.context.trace = [];
          f.render(lane); control.render(lane); eq(f.state(), control.state()); eq(scrub(f), scrub(control)); cases++;
        } finally { f.close(); control.close(); }
      }
      // Ordered Setup removal retains earlier borrowed sources; each plan shares
      // quotas and preflight, and no later failure commits earlier native state.
      for (const prey of [false, true]) {
        const f = fixture({ factories: true });
        try {
          eq(f.setup(lane, bundle(syntheticSetup(), [115, 0, 0, 0], syntheticSetup()), { prey }), 2);
          eq(images(f).length, 1); eq(f.target.context.stack.length, 0); cases++;
        } finally { f.close(); }
      }
      const late = fixture({ factories: true });
      try {
        let count = 0; late.transform(s => { if (++count === 2) s.recipe.attachment.forward++; return s; });
        atomic(late, () => late.setup(lane, bundle(syntheticSetup(), syntheticSetup())), /differs from retained/);
        late.transform(s => s); const before = late.state(); let draws = 0;
        const marker = new Error('later Setup image');
        late.target.context.beforeCall = (op, ctx, source) => { if (source === late.sources[1] && ++draws === 2) throw marker; };
        let thrown; try { late.setup(lane, bundle(syntheticSetup(), syntheticSetup())); } catch (e) { thrown = e; }
        eq(thrown, marker); eq(late.state(), before); eq(late.target.context.stack.length, 0);
        eq(images(late).length, 1, 'earlier Setup partial pixels retained'); cases++;
      } finally { late.close(); }
      const shared = fixture({ factories: true });
      try {
        shared.scene.reset();
        const entry = () => ({ asset: { id: 1, revision: 'source-1', status: 'ready', kind: 'canvas',
          source: shared.sources[1], width: 40, height: 30 }, width: 40, height: 30, halfWidth: 20, halfHeight: 15 });
        const food = request => ({ randomPhaseUnit: 0.25, randomWobbleUnit: 0.5,
          palette: { color: request.palette, count: 1, bodies: [entry()], outlines: [entry()], glows: [entry()] } });
        const prey = request => ({ randomPhaseUnit: 0.25, randomRateUnit: 0.5,
          palette: { color: request.palette, bodies: [entry()], glows: [entry()] } });
        const u24 = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
        shared.scene.apply_frame_with_accessory_presentation_and_all_factories(bundle(syntheticSetup(), packet(),
          [70, 108, 108, 0, 128, 128, 20],
          [121, 0, 31, 9, ...u24(32580 * 5), ...u24(32550 * 5), 20, 48, ...u24(0), ...u24(0), 3, 232]), false,
          shared.select, food, prey);
        shared.scene.advance(80, false).free(); shared.target.context.trace = []; shared.render(lane);
        eq(shared.scene.food_state().foods.length, 1); eq(shared.scene.prey_state().preys.length, 1);
        ok(images(shared).filter(c => c.args.length === 8).length > 1, 'accessory image shares retained entity pool');
        shared.catalog[1].revision = 'conflicting-source';
        atomic(shared, () => shared.render(lane), /incoherent shared/); cases++;
      } finally { shared.close(); }
      const faceOnly = fixture();
      try {
        faceOnly.mutate(s => { delete s.bodyStyle; s.effects = []; return s; });
        if (lane === 'basic') { faceOnly.render(lane); exact(faceOnly); }
        else atomic(faceOnly, () => faceOnly.render(lane));
      } finally { faceOnly.close(); }
      for (const family of ['paired', 'mouth-face']) {
        const full = fixture({ family, side: family === 'paired', packets: bundle(syntheticSetup(), ...Array.from({ length: 512 }, () => packet())) });
        try {
          full.render(lane);
          eq(images(full).length + images(full, 2).length + images(full, 3).length + images(full, 4).length,
            family === 'paired' ? 1536 : 2048, 'actual per-draw face/accessory charges at 512 objects');
          eq(full.scene.face_state().snakes.length, 512); eq(full.target.context.stack.length, 0); cases++;
          atomic(full, () => full.install(packet(0)), /limit|capacity|retained/i);
        } finally { full.close(); }
      }
      const catalog = fixture({ factories: true, packets: bundle(syntheticSetup(), ...Array.from({ length: 65 }, () => packet())) });
      try { atomic(catalog, () => catalog.setup(lane, bundle(...Array.from({ length: lane === 'basic' ? 64 : 32 }, syntheticSetup)),
        { width: 64, height: 64 }), /catalog budget/); } finally { catalog.close(); }
      const empty = fixture({ factories: true, packets: syntheticSetup() });
      try {
        eq(empty.setup(lane, bundle(...Array.from({ length: 64 }, syntheticSetup)), { width: 1, height: 1 }), 64);
        atomic(empty, () => empty.setup(lane, bundle(...Array.from({ length: 65 }, syntheticSetup)), { width: 1, height: 1 }));
        atomic(empty, () => empty.setup(lane, bundle(syntheticSetup(), syntheticSetup()), { width: 8192, height: 8192 })); cases++;
      } finally { empty.close(); }
    }
    const pool = fixture({ factories: true, packets: bundle(syntheticSetup(), ...Array.from({ length: 512 }, () => packet())) });
    try {
      pool.transform(s => {
        s.recipe.attachment.asset.source = new pool.sources[1].constructor('independent-source');
        return s;
      });
      eq(pool.setup('basic', bundle(...Array.from({ length: 8 }, syntheticSetup)), { width: 64, height: 64 }), 8,
        'exact 4096 source handles and catalog entries admitted across Setup plans');
      eq(pool.target.context.trace.filter(c => c.op === 'image' && c.source.name === 'independent-source').length, 4096);
      pool.target.context.trace = [];
      atomic(pool, () => pool.setup('basic', bundle(...Array.from({ length: 9 }, syntheticSetup)), { width: 64, height: 64 }), /source budget exceeded/); cases++;
    } finally { pool.close(); }
    const hud = fixture({ factories: true, score: true });
    try {
      const plan = { schema: 1, commandCount: 2, guards: Array.from({ length: 2 }, () => ({
        playing: true, closeRequested: false, deathPending: false })), finalCaptureIndices: [] };
      const report = hud.setup('standard', bundle(syntheticSetup(), syntheticSetup()), { hud: plan });
      eq(report.setupDraws, 2); eq(images(hud).length, 2); ok(Object.isFrozen(report)); cases++;
    } finally { hud.close(); }
    const invalid = fixture();
    try {
      for (const key of ['forward', 'imageScale', 'pivotX', 'pivotY']) for (const value of [NaN, Infinity, '1', undefined]) {
        atomic(invalid, () => invalid.install(packet(), () => ({ ...invalid.select({ id: 0 }), accessory: { ...geometry(), [key]: value } })));
      }
      atomic(invalid, () => invalid.install(packet(), () => ({ ...invalid.select({ id: 0 }), accessory: undefined })));
      atomic(invalid, () => invalid.install(packet(), () => ({ face: { kind: 'single-image', geometry: { baseSize: 19, pupilSize: 7, pupilTravel: 2 } }, antenna: null, accessory: geometry() })));
      let requests = [];
      invalid.scene.reset();
      atomic(invalid, () => invalid.install(bundle(syntheticSetup(), packet(0), packet(1)), request => {
        requests.push(request);
        return { ...invalid.select(request), accessory: request.id === 1 ? { ...geometry(), forward: NaN } : geometry() };
      }));
      eq(requests.map(r => r.own), [true, false], 'staged own context before a later appearance failure');
      requests = [];
      invalid.scene.reset();
      invalid.install(bundle(syntheticSetup(), packet(0), packet(1)), request => { requests.push(request); return { ...invalid.select(request), accessory: request.own ? geometry() : null }; });
      eq(requests.map(r => r.own), [true, false]); ok(requests.every(r => r.customBytes instanceof Uint8Array));
      eq(Object.keys(requests[0]).sort(), ['cosmetic', 'customBytes', 'id', 'own', 'skin', 'x', 'y']);
      requests[0].customBytes.fill(42); eq(requests[1].customBytes.length, 0, 'appearance requests are independent copies');
      invalid.install(bundle([115, 0, 0, 1], packet(0)), request => { requests.push(request); return { ...invalid.select(request), accessory: request.own ? geometry() : null }; });
      eq(requests.at(-1).own, false, 'wire ID reuse does not inherit own');
      invalid.scene.reset(); invalid.install(bundle(syntheticSetup(), packet(0)), request => { requests.push(request); return invalid.select(request); });
      eq(requests.at(-1).own, true, 'reset restores own selection context');
      invalid.scene.prepare_draw_with_accessory_presentation(800, 600, 1, false, unused); cases++;
    } finally { invalid.close(); }
    const uses = fixture({ factories: true });
    try {
      uses.transform(s => { const usage = s.recipe.palettes[0].variants[0]; s.recipe.palettes = Array.from({ length: 256 }, () => ({ variants: Array(256).fill(usage), boostGlow: usage })); return s; });
      atomic(uses, () => uses.setup('standard', bundle(...Array.from({ length: 4 }, syntheticSetup)), { width: 64, height: 64 }), /asset-use budget/);
    } finally { uses.close(); }
  } finally {
    for (const [key, old] of globals) { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; }
  }
  console.log(`Synthetic static-accessory actual-Wasm smoke passed (${cases} cases, ${assertions} assertions); logical Canvas only.`);
  return { cases, assertions };
}
