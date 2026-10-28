import assert from 'node:assert/strict';
import { Path2D, recordPatternPath } from './pattern-path-fixture.mjs';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle, syntheticScene, syntheticSetup } from '../web/synthetic-scene.mjs';
import { denseScene } from '../web/dense-scene.mjs';

// Original synthetic asymmetric sources and own-data normalized metadata. The
// actual built Wasm runs against a Canvas command/state recorder, not a raster
// oracle or a browser. No provider, original artwork, reference or socket is used.
export function mouthFaceRenderSmoke(wasm) {
  let assertions = 0, cases = 0;
  const eq = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
  const ok = (value, message) => { assertions++; assert(value, message); };
  const rejects = (fn, pattern) => { assertions++; assert.throws(fn, pattern); };
  class CanvasRenderingContext2D {
    trace = []; stack = []; alpha = 1; blend = 'source-over'; transforms = [];
    failSource = null; failAt = 1; failCount = 0; beforeCall = null;
    reset() { this.stack = []; this.alpha = 1; this.blend = 'source-over'; this.transforms = []; this.trace.push({ op: 'reset' }); }
    get globalAlpha() { return this.alpha; }
    set globalAlpha(value) {
      if (Number.isFinite(value) && value >= 0 && value <= 1) this.alpha = value;
      this.trace.push({ op: 'alpha', value, effective: this.alpha });
    }
    get globalCompositeOperation() { return this.blend; }
    set globalCompositeOperation(value) { this.call('blend'); this.blend = value; this.trace.push({ op: 'blend', value }); }
    call(method) { this.beforeCall?.(method, this); }
    save() {
      this.stack.push({ alpha: this.alpha, blend: this.blend, transforms: this.transforms.slice() });
      this.trace.push({ op: 'save' });
    }
    restore() {
      assert(this.stack.length, 'restore has a matching save');
      Object.assign(this, this.stack.pop()); this.trace.push({ op: 'restore' });
    }
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
    fill(path) { this.call('fill'); if (recordPatternPath(this, path)) return; this.trace.push({ op: 'fill', alpha: this.alpha }); }
    stroke() { this.call('stroke'); }
    fillRect() { this.call('fillRect'); }
    drawImage(source, ...args) {
      this.call('drawImage');
      if (source === this.failSource && ++this.failCount === this.failAt) throw new Error('synthetic mouth image failure');
      this.trace.push({ op: 'image', source, args, alpha: this.alpha, blend: this.blend,
        transforms: this.transforms.slice(), depth: this.stack.length });
    }
  }
  class HTMLCanvasElement {
    context = new CanvasRenderingContext2D(); _width = 32; height = 32;
    constructor(name = 'synthetic-canvas') { this.name = name; this.context.canvas = this; }
    get width() { return this._width; }
    set width(value) { this._width = value; this.context.reset(); }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  }
  class HTMLImageElement {
    complete = true; naturalWidth = 37; naturalHeight = 53;
    constructor(name = 'synthetic-image') { this.name = name; }
  }
  const globals = new Map(Object.entries({ CanvasRenderingContext2D, HTMLCanvasElement, HTMLImageElement, Path2D }).map(([key, value]) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return [key, old];
  }));
  const travel = 1.375;
  const numeric = (pupilTravel = travel) => ({ face: { kind: 'mouth-face', geometry: { pupilTravel } }, antenna: null });
  const paired = () => ({ kind: 'standard', distance: 6, separation: 6, radius: 6,
    pupilRadius: 3.5, pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0,
    outlineColor: 0, eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 });
  const unused = () => { throw new Error('unexpected synthetic factory or random callback'); };
  function appearancePacket(id = 0) {
    const packed = wasm.decode_frame(syntheticScene(), false);
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    let offset = 4 + view.getUint32(0);
    const size = view.getUint32(offset); offset += 4;
    const raw = packed.slice(offset, offset + size);
    raw[1] = id >>> 8; raw[2] = id & 255;
    return raw;
  }
  const shortAppearance = id => {
    const raw = appearancePacket(id);
    // This authored packet has an empty custom field and no body suffix here.
    return raw.slice(0, 25 + raw[22]);
  };
  function fixture({ pupilTravel = travel, mixed = false, spawn = false, packets = syntheticScene(), factories = false } = {}) {
    const scene = new wasm.AnimatedScene(0), quality = new wasm.DesktopQuality(1, 0);
    const target = new HTMLCanvasElement('target'); target.width = 960; target.height = 540;
    const sprites = [0, 1, 2].map(i => new HTMLCanvasElement(`stand-in-${i}`));
    const background = new HTMLImageElement('background');
    const marks = new HTMLCanvasElement('asymmetric-numbered-marks'); marks.width = 41; marks.height = 23;
    const mouth = new HTMLCanvasElement('asymmetric-numbered-mouth'); mouth.width = 67; mouth.height = 109;
    const body = new HTMLCanvasElement('body'); body.width = 29; body.height = 35;
    const single = new HTMLImageElement('single-eye');
    const sources = [marks, mouth, body, single];
    const assets = sources.map((source, id) => ({ id, revision: `synthetic-content-${id}`, status: 'ready',
      kind: source instanceof HTMLImageElement ? 'image' : 'canvas', source,
      width: source.width ?? source.naturalWidth, height: source.height ?? source.naturalHeight }));
    const use = id => ({ asset: { ...assets[id] }, sourceMode: 'whole', sourceRect: [0, 0, assets[id].width, assets[id].height] });
    const eyes = () => ({ kind: 'mouth-face', geometry: { pupilTravel }, eyeMarks: use(0), mouth: use(1) });
    const select = request => !mixed || request.id === 7 ? numeric(pupilTravel)
      : request.id === 0 ? { face: { kind: 'single-image', geometry: { baseSize: 19, pupilSize: 7, pupilTravel: 2 } }, antenna: null }
        : { face: { kind: 'paired', eyes: paired(), decoration: null }, antenna: null };
    let modify = value => value, requests = 0;
    const recipe = request => {
      requests++;
      const kind = select(request).face.kind;
      const selected = kind === 'mouth-face' ? eyes() : kind === 'single-image'
        ? { kind, geometry: select(request).face.geometry, baseImage: use(3), pupilImage: use(3) } : paired();
      return modify({ schema: 1, status: 'ready', revision: 'synthetic-capture', recipe: {
        custom: false, basePalette: 0, palettes: [{ variants: [use(2)], boostGlow: use(2) }],
        runs: [{ palette: 0, count: 1 }], variantMode: 'first', variantPeriod: 1,
        effects: ['outline', 'shadow', 'death-highlight'].map(kind => ({ ...use(2), kind, opacity: 1 })),
        eyes: selected, faceDecoration: null, antenna: null, attachment: null,
        bodyStyle: { detailedSegments: false, swell: 0, rotateSegments: true, headFade: null, tailFade: null },
        supportedFeatures: ['body-palettes', 'outline', 'shadow', 'death-highlight', 'standard-body-style',
          kind === 'mouth-face' ? 'mouth-face' : kind === 'single-image' ? 'single-image-eye' : 'standard-eyes'], unsupportedFeatures: [],
      } }, request);
    };
    const basic = request => {
      const result = recipe(request), eyes = result.recipe.eyes;
      return { revision: result.revision, face: { kind: eyes.kind === 'standard' ? 'paired' : eyes.kind,
        eyes, decoration: result.recipe.faceDecoration }, antenna: result.recipe.antenna };
    };
    const render = (lane, { atSize = false, callback = lane === 'basic' ? basic : recipe } = {}) => {
      const args = [target, ...sprites, background];
      if (atSize) args.push(961, 541);
      if (lane === 'basic') args.push(false);
      args.push(callback, unused, quality);
      scene[`render_${lane === 'standard' ? 'standard_' : ''}with_face_presentation${atSize ? '_at_size' : ''}`](...args);
    };
    const setup = (lane, bytes, { prey = true, width = 960, height = 540, callback = lane === 'basic' ? basic : recipe } = {}) => {
      const args = [bytes, false, select, unused];
      if (prey) args.push(unused);
      args.push(target, ...sprites, background, width, height);
      if (lane === 'basic') args.push(false);
      args.push(callback, unused, quality);
      return scene[`apply_frame_and_render_${lane === 'standard' ? 'standard_' : ''}with_face_presentation${prey ? '_and_prey' : ''}`](...args);
    };
    if (factories) scene.apply_frame_with_face_presentation_and_all_factories(packets, false, select, unused, unused);
    else scene.apply_frame_with_face_presentation(packets, false, select);
    scene.set_follows(false); scene.set_camera_position(32541.375, 32547.125); scene.set_zoom(0.7125);
    scene.set_gaze_heading(0.9);
    if (!spawn) scene.advance(44, false).free();
    target.context.trace = [];
    const state = () => [scene.snapshot(), scene.face_state(), scene.drawn_snakes(), scene.food_state(), scene.prey_state(),
      [...scene.camera_samples()], [...scene.own_body_samples()], [...scene.own_body()], [...scene.length_samples()],
      [...scene.boundary_samples()], [...scene.arena_edge_view()]];
    return { scene, quality, target, sprites, background, marks, mouth, body, single, assets, use, eyes, select, recipe, basic,
      render, setup, state, modify: fn => { modify = fn; }, requests: () => requests,
      close: () => { scene.free(); quality.free(); } };
  }
  const images = f => f.target.context.trace.filter(c => c.op === 'image' && c.args.length === 4
    && (c.source === f.marks || c.source === f.mouth));
  const scrub = f => f.target.context.trace.map(c => c.source ? { ...c, source: c.source.name } : c);
  const expected = (m, camera, width, height) => {
    const s = m.scale, z = camera.zoom, h = m.eyes.heading, rx = m.eyes.pupilX, ry = m.eyes.pupilY;
    return [h - Math.PI / 2, h + Math.PI / 2, null].map(side => {
      let x, y, destination;
      if (side !== null) {
        const forward = -3 * s, lateral = 7 * s, multiplier = (s * z) * 0.25;
        x = (Math.cos(h) * (forward + 0.5) + rx * s) + Math.cos(side) * lateral;
        y = (Math.sin(h) * (forward + 0.5) + ry * s) + Math.sin(side) * lateral;
        destination = [-24 * multiplier, -24 * multiplier, 48 * multiplier, 48 * multiplier];
      } else {
        const forward = 5 * s, multiplier = (s * z) * 0.16;
        x = Math.cos(h) * (forward + 0.5) + rx * s;
        y = Math.sin(h) * (forward + 0.5) + ry * s;
        destination = [-40 * multiplier, -65 * multiplier, 79 * multiplier, 130 * multiplier];
      }
      return { transforms: [['setTransform', 1, 0, 0, 1, 0, 0],
        ['translate', width / 2 + ((x + m.correctedX) - camera.absoluteX) * z,
          height / 2 + ((y + m.correctedY) - camera.absoluteY) * z], ['rotate', h]], args: destination };
    });
  };
  function exact(f, { mixed = false } = {}) {
    const rows = JSON.parse(f.scene.drawn_snakes()).filter(r => !mixed || r.snake.id === 7);
    const camera = JSON.parse(f.scene.snapshot()).camera, calls = images(f);
    eq(calls.length, rows.length * 3, 'three actual whole-source commands per visible mouth face');
    if (!mixed) eq(f.target.context.trace.filter(c => c.op === 'arc').length, 0, 'mouth family suppresses ordinary circles');
    for (let i = 0; i < rows.length; i++) {
      const layouts = expected(rows[i].snake, camera, f.target.width, f.target.height);
      for (let j = 0; j < 3; j++) {
        const call = calls[3 * i + j];
        eq(call.source, j === 2 ? f.mouth : f.marks, 'negative mark, same positive mark, then mouth');
        eq(call.args, layouts[j].args, 'whole-source five-argument overload with fixed destination');
        eq(call.transforms, layouts[j].transforms, 'separate ordered screen translation and raw heading rotation');
        eq([call.alpha, call.blend], [1, 'source-over'], 'face inherits modeled root alpha independently of body');
        const index = f.target.context.trace.indexOf(call);
        eq(f.target.context.trace.slice(index - 3, index).map(c => c.op), ['save', 'translate', 'rotate']);
        eq(f.target.context.trace[index + 1].op, 'restore', 'each image has its own restored scope');
      }
      const end = f.target.context.trace.indexOf(calls[3 * i + 2]);
      eq(f.target.context.trace[end + 2], { op: 'alpha', value: 1, effective: 1 }, 'common face completion resets root alpha unconditionally');
    }
    eq(f.target.context.stack.length, 0, 'all Canvas scopes unwind');
    return calls.map(c => ({ source: c.source.name, args: c.args, transforms: c.transforms, alpha: c.alpha, blend: c.blend }));
  }
  function atomic(f, action, pattern) {
    const before = f.state(), trace = f.target.context.trace.slice();
    rejects(action, pattern); eq(f.state(), before, 'failed preflight preserves complete model diagnostics');
    eq(f.target.context.trace, trace, 'failed preflight precedes destructive target reset');
    eq(f.target.context.stack.length, 0);
  }
  try {
    for (const lane of ['basic', 'standard']) {
      const f = fixture();
      try {
        f.render(lane); exact(f); cases++;
        const own = JSON.parse(f.scene.snapshot()).own;
        ok(own.scale !== 1 && own.eyes.pupilX !== 0 && own.eyes.pupilY !== 0, 'nonunit scale and oblique evolved world-axis gaze');
        const face = f.scene.face_state(); eq(face.snakes[0].face, { kind: 'mouth-face', geometry: { pupilTravel: travel } });
        const before = f.state(); f.scene.face_state(); eq(f.state(), before, 'observation is read only');
        f.target.context.trace = []; f.render(lane, { atSize: true }); exact(f);
        eq([f.target.width, f.target.height], [961, 541]);
        const pupils = f.scene.face_state().snakes.map(s => [s.pupilX, s.pupilY]);
        f.target.context.trace = []; f.render(lane); exact(f);
        eq(f.scene.face_state().snakes.map(s => [s.pupilX, s.pupilY]), pupils, 'draw and resize add no pupil update');
        for (const id of [0, 1]) {
          const asset = f.assets[id];
          for (const status of ['pending', 'unsupported']) {
            asset.status = status; atomic(f, () => f.render(lane), /not ready/);
          }
          asset.status = 'ready'; const source = asset.source;
          asset.source = f.target; atomic(f, () => f.render(lane), /aliases target/); asset.source = source;
          asset.source = null; atomic(f, () => f.render(lane), /not a canvas/); asset.source = source;
          const unloaded = new HTMLImageElement('unloaded'); unloaded.complete = false;
          Object.assign(asset, { source: unloaded, kind: 'image', width: 37, height: 53 });
          atomic(f, () => f.render(lane), /not ready/);
          Object.assign(asset, { source, kind: 'canvas', width: source.width, height: source.height });
        }
        const change = mutate => { f.modify(s => { mutate(s.recipe); return s; }); atomic(f, () => f.render(lane)); f.modify(s => s); };
        change(r => { delete r.eyes.mouth; });
        change(r => { r.eyes.eyeMarks.sourceMode = 'crop'; });
        change(r => { r.eyes.mouth.sourceRect[2]--; });
        change(r => { r.eyes.geometry.pupilTravel += 0.125; });
        change(r => { r.faceDecoration = { kind: 'paired-side-images' }; });
        change(r => { r.eyes.kind = 'single-image'; });
        for (const key of ['kind', 'geometry', 'eyeMarks', 'mouth']) change(r => {
          Object.defineProperty(r.eyes, key, { get() { throw new Error('metadata accessor invoked'); } });
        });
        if (lane === 'standard') {
          change(r => { r.supportedFeatures = r.supportedFeatures.filter(v => v !== 'mouth-face'); });
          for (const feature of ['standard-eyes', 'single-image-eye', 'paired-side-images', 'mouth-face', 'unknown-face']) {
            change(r => { r.supportedFeatures.push(feature); });
          }
          change(r => { r.unsupportedFeatures = ['unsupported-required']; });
          f.modify(s => ({ ...s, status: 'pending' })); atomic(f, () => f.render(lane)); f.modify(s => s);
        }
        // A later callback mutates an already-borrowed source, after the last
        // role for that earlier source has resolved; validation must recheck it.
        let count = 0;
        f.modify(s => { if (++count === 3) f.marks.height++; return s; });
        atomic(f, () => f.render(lane), /changed|ready/); f.marks.height--; f.modify(s => s);
        count = 0;
        f.modify(s => { if (++count === 2) s.recipe.eyes.mouth.asset.revision = 'conflicting-content'; return s; });
        atomic(f, () => f.render(lane), /incoherent aliased/); f.modify(s => s);
        // Both source roles can share the native source pool with body assets.
        f.assets[0] = { ...f.assets[2], id: 0 };
        f.target.context.trace = []; f.render(lane);
        ok(f.target.context.trace.some(c => c.op === 'image' && c.source === f.body && c.args.length === 4));
        f.assets[0] = { id: 0, revision: 'synthetic-content-0', status: 'ready', kind: 'canvas', source: f.marks, width: 41, height: 23 };
        // Legacy APIs reject selected mouth faces before style/random callbacks.
        let callbackCount = 0; const forbidden = () => { callbackCount++; throw new Error('legacy callback consumed'); };
        atomic(f, () => f.scene.render_standard(f.target, ...f.sprites, f.background, forbidden, f.quality));
        atomic(f, () => f.scene.render_standard_with_antenna(f.target, ...f.sprites, f.background, forbidden, forbidden, f.quality));
        atomic(f, () => f.scene.render(f.target, ...f.sprites, f.background, 1, false));
        eq(callbackCount, 0); atomic(f, () => f.scene.drawn_eyes(961, 541), /paired faces/);
        cases++;
      } finally { f.close(); }
    }
    const basic = fixture(), standard = fixture();
    try {
      basic.render('basic'); standard.render('standard');
      eq(exact(basic), exact(standard), 'both production lanes submit identical faces from one prepared stage');
      eq(basic.state(), standard.state()); cases++;
    } finally { basic.close(); standard.close(); }
    for (const lane of ['basic', 'standard']) {
      const f = fixture({ spawn: true });
      try {
        f.render(lane); exact(f); eq(JSON.parse(f.scene.snapshot()).own.spawnProgress, 0);
        ok(f.target.context.trace.some(c => c.op === 'image' && c.source !== f.marks && c.source !== f.mouth && c.alpha === 0), 'zero-spawn body does not suppress face');
        f.scene.advance(44, false).free();
        f.scene.apply_frame(Uint8Array.of(115, 0, 0, 1), false); f.scene.advance(84, false).free();
        f.target.context.trace = []; f.render(lane); exact(f);
        const m = JSON.parse(f.scene.drawn_snakes()).find(r => r.snake.id === 0).snake;
        ok(m.deathProgress > 0 && m.deathProgress < 1 && m.spawnProgress < 1, 'nonsaturated death/spawn alpha witness');
        const faceStart = f.target.context.trace.indexOf(images(f)[0]);
        ok(f.target.context.trace.slice(0, faceStart).some(c => c.op === 'image' && c.alpha > 0 && c.alpha < 1), 'body/death suffix precedes opaque mouth face');
        f.quality.set_requested_mode(0); f.quality.begin_connection();
        f.target.context.trace = []; f.render(lane); exact(f); cases++;
      } finally { f.close(); }
      const mixed = fixture({ mixed: true });
      try {
        mixed.render(lane); exact(mixed, { mixed: true });
        const calls = mixed.target.context.trace, mouthEnd = calls.indexOf(images(mixed).at(-1));
        ok(calls.some(c => c.op === 'image' && c.source === mixed.single && c.args.length === 8), 'preceding single-image semantics preserved');
        ok(calls.slice(mouthEnd + 1).some(c => c.op === 'arc'), 'following paired eye semantics preserved');
        cases++;
      } finally { mixed.close(); }
      for (const initial of [0, -0]) {
        const f = fixture({ pupilTravel: initial });
        try {
          eq(Object.is(f.scene.face_state().snakes[0].face.geometry.pupilTravel, initial), true, 'numeric installation retains travel sign');
          f.modify(s => { s.recipe.eyes.geometry.pupilTravel = Object.is(initial, -0) ? 0 : -0; return s; });
          atomic(f, () => f.render(lane), /differs from retained/); f.modify(s => s);
          f.render(lane); exact(f); cases++;
        } finally { f.close(); }
      }
      // A failed second or third image can leave pixels but cannot commit the
      // disposable model or leak either the local or outer Canvas scope.
      for (const [role, at] of [['marks', 2], ['mouth', 1]]) {
        const failed = fixture(), control = fixture();
        try {
          const before = failed.state(), ctx = failed.target.context;
          ctx.failSource = failed[role]; ctx.failAt = at;
          rejects(() => failed.render(lane), /synthetic mouth image failure/);
          eq(failed.state(), before); eq(ctx.stack.length, 0);
          eq(images(failed).length, role === 'marks' ? 1 : 2, 'partial external Canvas work is retained');
          ctx.failSource = null; ctx.trace = []; control.target.context.trace = [];
          failed.render(lane); control.render(lane);
          eq(failed.state(), control.state()); eq(scrub(failed), scrub(control)); exact(failed); cases++;
        } finally { failed.close(); control.close(); }
      }
      for (const method of ['translate', 'rotate']) {
        const f = fixture();
        try {
          const before = f.state(), ctx = f.target.context;
          ctx.beforeCall = op => { if (op === method && images(f).length === 1) throw new Error(`synthetic ${method}`); };
          rejects(() => f.render(lane), new RegExp(`synthetic ${method}`));
          eq(f.state(), before); eq(ctx.stack.length, 0); cases++;
        } finally { f.close(); }
      }
      const f2 = fixture();
      try {
        f2.scene.reset();
        f2.scene.apply_frame_with_face_presentation_and_all_factories(syntheticSetup(), false, () => numeric(), unused, unused);
        f2.scene.apply_frame_with_face_presentation(appearancePacket(), false, () => numeric());
        f2.target.context.trace = [];
        eq(f2.setup(lane, bundle(syntheticSetup(), [115, 0, 0, 0], syntheticSetup())), 2, 'both ordered Setup draws submit');
        eq(images(f2).length, 3, 'earlier Setup retains both borrowed roles after later removal');
        eq(f2.target.context.stack.length, 0);
        eq(f2.scene.face_state().snakes.filter(s => s.drawn).length, 0);
        f2.scene.reset();
        f2.scene.apply_frame_with_face_presentation_and_factories(syntheticSetup(), false, () => numeric(), unused);
        f2.scene.apply_frame_with_face_presentation(appearancePacket(), false, () => numeric());
        f2.target.context.trace = [];
        eq(f2.setup(lane, bundle(syntheticSetup(), syntheticSetup()), { prey: false }), 2);
        eq(images(f2).length, 6, 'food-only factory variant preserves mouth on each Setup'); cases++;
      } finally { f2.close(); }
      const shared = fixture();
      try {
        shared.scene.reset();
        let foodCalls = 0, preyCalls = 0;
        const entry = id => ({ asset: { ...shared.assets[id] }, width: shared.assets[id].width,
          height: shared.assets[id].height, halfWidth: shared.assets[id].width / 2, halfHeight: shared.assets[id].height / 2 });
        const food = request => {
          foodCalls++;
          return { randomPhaseUnit: 0.25, randomWobbleUnit: 0.5, palette: { color: request.palette,
            count: 1, bodies: [entry(0)], outlines: [entry(0)], glows: [entry(0)] } };
        };
        const prey = request => {
          preyCalls++;
          return { randomPhaseUnit: 0.25, randomRateUnit: 0.5,
            palette: { color: request.palette, bodies: [entry(1)], glows: [entry(1)] } };
        };
        const u24 = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
        const preySpawn = [121, 0, 31, 9, ...u24(32580 * 5), ...u24(32550 * 5), 20, 48, ...u24(0), ...u24(0), 3, 232];
        shared.scene.apply_frame_with_face_presentation_and_all_factories(bundle(syntheticSetup(), appearancePacket(),
          [70, 108, 108, 0, 128, 128, 20], preySpawn), false, () => numeric(), food, prey);
        eq([foodCalls, preyCalls], [1, 1], 'generic factories create actual retained food and prey beside mouth faces');
        shared.target.context.trace = []; shared.render(lane); exact(shared);
        eq(shared.scene.food_state().foods.length, 1); eq(shared.scene.prey_state().preys.length, 1);
        ok(shared.target.context.trace.some(c => c.op === 'image' && c.args.length === 8 && c.source === shared.marks), 'marks are shared with retained food');
        ok(shared.target.context.trace.some(c => c.op === 'image' && c.args.length === 8 && c.source === shared.mouth), 'mouth is shared with retained prey');
        for (const id of [0, 1]) {
          const revision = shared.assets[id].revision;
          shared.assets[id].revision = 'conflicting-shared-content';
          atomic(shared, () => shared.render(lane), /incoherent shared/);
          shared.assets[id].revision = revision;
        }
        cases++;
      } finally { shared.close(); }
    }
    // Numeric install is source-independent, bounded, own-data and atomic.
    const f = fixture();
    try {
      for (const value of [-1, 4096.001, Infinity, NaN, undefined, '1']) {
        atomic(f, () => f.scene.apply_frame_with_face_presentation(appearancePacket(), false, () => ({
          face: { kind: 'mouth-face', geometry: { pupilTravel: value } }, antenna: null,
        })));
      }
      for (const key of ['face', 'geometry', 'pupilTravel']) {
        const value = numeric();
        const record = key === 'face' ? value : key === 'geometry' ? value.face : value.face.geometry;
        Object.defineProperty(record, key, { get() { throw new Error('numeric getter invoked'); } });
        atomic(f, () => f.scene.apply_frame_with_face_presentation(appearancePacket(), false, () => value), /metadata accessor/);
      }
      atomic(f, () => f.scene.apply_frame_with_face_presentation(appearancePacket(), false, () => ({ ...numeric(), face: { ...numeric().face, decoration: {} } })), /paired decoration/);
      atomic(f, () => f.scene.apply_frame_with_face_presentation(bundle(appearancePacket(), [115, 0]), false, () => numeric()));
      f.assets[0].status = f.assets[1].status = 'pending';
      f.scene.apply_frame_with_face_presentation(appearancePacket(), false, () => numeric(4096));
      eq(f.scene.face_state().snakes.at(-1).face.geometry.pupilTravel, 4096, 'numeric upper endpoint installs without ready sources'); cases++;
    } finally { f.close(); }
    // Full catalog charge is cumulative across Setup plans, with one shared
    // source handle and two distinct roles. No per-plan reset grants new quota.
    for (const lane of ['basic', 'standard']) {
      const f = fixture({ factories: true, packets: bundle(syntheticSetup(), ...Array.from({ length: 65 }, (_, i) => appearancePacket(i))) });
      try {
        const count = lane === 'basic' ? 32 : 22;
        const bytes = bundle(...Array.from({ length: count }, syntheticSetup));
        atomic(f, () => f.setup(lane, bytes, { width: 64, height: 64 }), /catalog budget exceeded/);
        cases++;
      } finally { f.close(); }
    }
    const manyUses = fixture({ factories: true, packets: bundle(syntheticSetup(), appearancePacket()) });
    try {
      manyUses.modify(s => {
        const usage = manyUses.use(2);
        s.recipe.palettes = Array.from({ length: 256 }, () => ({ variants: Array(256).fill(usage), boostGlow: usage }));
        return s;
      });
      // A single plan charges 65,798 uses. Four plans exceed the same ingress
      // pool's 262,144-use cap without exhausting catalog or layout budgets.
      atomic(manyUses, () => manyUses.setup('standard', bundle(...Array.from({ length: 4 }, syntheticSetup)), { width: 64, height: 64 }), /asset-use budget exceeded/);
      cases++;
    } finally { manyUses.close(); }
    for (const lane of ['basic', 'standard']) {
      const full = fixture({ packets: bundle(syntheticSetup(), ...Array.from({ length: 512 }, () => appearancePacket(0))) });
      try {
        full.render(lane);
        eq(full.scene.face_state().snakes.length, 512, 'retained-object cap supports 512 independent appearances');
        eq(images(full).length, 1536, '512 three-image faces exceed the former two-image/1024 assumption');
        eq(full.target.context.stack.length, 0);
        atomic(full, () => full.scene.apply_frame_with_face_presentation(shortAppearance(0), false, () => numeric()), /limit|capacity|retained/i);
        cases++;
      } finally { full.close(); }
      const bounded = fixture();
      try {
        bounded.scene.set_camera_position(2 ** 53, -(2 ** 53));
        atomic(bounded, () => bounded.render(lane), /invalid scene camera or zoom/);
        // The native layout tests own 2^53 head-addition/cancellation arithmetic;
        // the production Canvas APIs deliberately reject a view at this size.
        cases++;
      } finally { bounded.close(); }
    }
    const dense = fixture({ factories: true, packets: syntheticSetup() });
    try {
      const frames = denseScene({ snakes: 64, anchors: 512, foods: 0, spread: 100 });
      for (const frame of frames.slice(1)) dense.scene.apply_frame_with_face_presentation(frame, false, () => numeric());
      for (const frame of frames.slice(1)) dense.scene.apply_frame_with_face_presentation(frame, false, () => numeric());
      dense.scene.advance(84, false).free();
      dense.modify(s => {
        s.recipe.bodyStyle.detailedSegments = true;
        s.recipe.bodyStyle.headFade = { palette: 0, length: 65535 };
        s.recipe.bodyStyle.tailFade = { palette: 0, length: 65535 };
        return s;
      });
      const before = dense.requests();
      atomic(dense, () => dense.setup('standard', bundle(syntheticSetup(), syntheticSetup())), /CommandLimit|image budget exceeded/);
      eq(dense.requests() - before, 256, 'first 128-snake plan fits; cumulative image quota fails in the second plan');
      cases++;
    } finally { dense.close(); }
    console.log(`Synthetic mouth-face real-Wasm recorder passed: ${assertions} assertions across ${cases} cases; no browser, pixels, external assets or network.`);
    return { assertions, cases };
  } finally {
    for (const [key, old] of globals) {
      if (old) Object.defineProperty(globalThis, key, old);
      else delete globalThis[key];
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const wasm = await import(new URL('../dist/web/slither_client.js', import.meta.url));
  wasm.initSync({ module: fs.readFileSync(fileURLToPath(new URL('../dist/web/slither_client_bg.wasm', import.meta.url))) });
  mouthFaceRenderSmoke(wasm);
}
