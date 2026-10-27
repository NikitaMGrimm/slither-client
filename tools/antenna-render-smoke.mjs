import { bundle, syntheticSetup } from '../web/synthetic-scene.mjs';

// Original synthetic packets, geometry and random tapes. The independent JS
// arithmetic below checks the production Wasm ABI; the Canvas recorder supplies
// neither pixels nor evidence about a browser or an external client runtime.
const channels = ['x', 'y', 'velocityX', 'velocityY', 'accelerationX', 'accelerationY'];
const tau = Math.PI * 2;
const u16 = n => [n >>> 8 & 255, n & 255];
const u24 = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
const absolute = n => u24(Math.round(n * 5));
const geometry = (nodes = 8, rotateBulb = false) => ({
  kind: 'ordinary-chain', nodes, outerColor: 0x176b39, innerColor: 0xe8a52b,
  innerOpacity: 0.375, repeatedInnerStrokes: true, rotateBulb,
  bulb: { offsetX: -7.25, offsetY: 3.125, width: 23, height: 17, scale: 0.625, opacity: 0.8125 },
});
function spawn(id = 0, { x = 32550.2, y = 32550.6, heading = 0.271, points = 12, speed = 128 } = {}) {
  const angle = Math.round(heading / tau * 16777215);
  const out = [115, ...u16(id), ...u24(angle), 48, ...u24(angle), ...u16(speed), ...u24(0),
    0, ...absolute(x), ...absolute(y), 0, 0, 255];
  if (points) {
    out.push(...absolute(x - (points - 1) * 8), ...absolute(y));
    for (let j = 2; j < points; j++) out.push(143, 127);
    if (points >= 2) out.push(...u16(Math.round(heading / tau * 65536)));
  }
  return out;
}
const remove = (id, death = false) => [115, ...u16(id), Number(death)];
const setup = (center = 32550) => {
  const out = syntheticSetup(); out.set(u24(center), 1); out.set(u24(6000), out.length - 3); return out;
};
const units = request => Float64Array.from({ length: 2 * request.randomPairCount }, (_, i) =>
  ((i * 37 + request.drawOrdinal * 13 + Number(request.drawSerial % 97n) * 11) % 251 + 0.25) / 252);
let angles;
function angle(dx, dy) {
  for (const [bound, multiplier] of [[4, 32], [8, 16], [16, 8], [127, 1]]) {
    if (dx >= -bound && dx < bound && dy >= -bound && dy < bound) {
      angles ??= Float32Array.from({ length: 65536 }, (_, i) => Math.atan2((i >>> 8) - 128, (i & 255) - 128));
      return angles[((dy * multiplier + 128) << 8) | (dx * multiplier + 128)];
    }
  }
  return Math.atan2(dy, dx);
}
function step(previous, metrics, tape) {
  const s = structuredClone(previous), g = s.geometry, n = g.nodes, scale = metrics.scale;
  const c = Math.cos(metrics.heading), t = Math.sin(metrics.heading);
  const rootX = metrics.correctedX - c * 8 * scale, rootY = metrics.correctedY - t * 8 * scale;
  s.x[0] = rootX; s.y[0] = rootY;
  if (!s.shown) {
    s.shown = true;
    for (let j = 1; j < n; j++) { s.x[j] = rootX - c * j * 4 * scale; s.y[j] = rootY - t * j * 4 * scale; }
  }
  for (let j = 1; j < n; j++) {
    let qx = s.x[j - 1], qy = s.y[j - 1];
    qx += tape[(j - 1) * 2] * 2 - 1; qy += tape[(j - 1) * 2 + 1] * 2 - 1;
    let phi = angle(s.x[j] - qx, s.y[j] - qy);
    qx += Math.cos(phi) * 4 * scale; qy += Math.sin(phi) * 4 * scale;
    s.velocityX[j] += (qx - s.x[j]) * 0.1; s.velocityY[j] += (qy - s.y[j]) * 0.1;
    s.x[j] += s.velocityX[j]; s.y[j] += s.velocityY[j];
    s.velocityX[j] *= 0.88; s.velocityY[j] *= 0.88;
    const dx = s.x[j] - s.x[j - 1], dy = s.y[j] - s.y[j - 1];
    if (Math.sqrt(dx * dx + dy * dy) > 4 * scale) {
      phi = angle(dx, dy); s.x[j] = s.x[j - 1] + Math.cos(phi) * 4 * scale;
      s.y[j] = s.y[j - 1] + Math.sin(phi) * 4 * scale;
    }
  }
  if (g.rotateBulb) {
    let delta = Math.atan2(s.y[n - 1] - s.y[n - 2], s.x[n - 1] - s.x[n - 2]) - s.bulbRotation;
    if (delta < 0 || delta >= tau) delta %= tau;
    if (delta < -Math.PI) delta += tau; else if (delta > Math.PI) delta -= tau;
    s.bulbRotation = (s.bulbRotation + delta * 0.15) % tau;
  }
  return s;
}
function paths(s, camera) {
  const point = j => [(s.x[j] - camera.absoluteX) * camera.zoom, (s.y[j] - camera.absoluteY) * camera.zoom];
  const append = (path, p) => { const last = path.at(-1); if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= 1) path.push(p); };
  const outer = [point(s.x.length - 1)], inner = [point(s.x.length - 1)];
  for (let j = s.x.length - 2; j >= 1; j--) append(outer, point(j));
  append(outer, [((s.x[1] + s.x[0]) * 0.5 - camera.absoluteX) * camera.zoom,
    ((s.y[1] + s.y[0]) * 0.5 - camera.absoluteY) * camera.zoom]);
  for (let j = s.x.length - 2; j >= 0; j--) append(inner, point(j));
  return { outer, inner };
}

export function antennaRenderSmoke(wasm, { fixture, vanillaEyes, eq, ok, rejects }) {
  const face = () => ({ eyes: vanillaEyes(), decoration: { kind: 'none' } });
  const color = n => '#' + n.toString(16).padStart(6, '0');
  function make({ lane = 'standard', g = geometry(), commands = [spawn()], center = 32550, factories = false } = {}) {
    const f = fixture();
    const bulb = new f.foods[0].constructor('synthetic-asymmetric-bulb'); bulb.width = 47; bulb.height = 29;
    f.catalog.push({ source: bulb, state: 'ready' });
    if (g) f.metadata.antenna = { kind: 'ordinary-chain', geometry: g, image: { asset: 9, sourceMode: 'whole' } };
    f.scene.reset();
    const resolveAppearance = () => ({ face: face(), antenna: g });
    const noFactory = () => { throw new Error('unexpected synthetic entity'); };
    const apply = bytes => factories
      ? f.scene.apply_frame_with_appearance_and_all_factories(bytes, false, resolveAppearance, noFactory, noFactory)
      : f.scene.apply_frame_with_appearance(bytes, false, resolveAppearance);
    apply(bundle(setup(center), ...commands));
    f.scene.set_follows(false); f.scene.set_camera_position(center + 0.125, center + 0.375); f.scene.set_zoom(0.7125);
    const requests = [];
    let random = request => { const tape = units(request); requests.push({ request: structuredClone(request), tape: tape.slice() }); return tape; };
    const presentation = request => { const p = f.resolve(request); return { revision: p.revision,
      face: { eyes: p.recipe.eyes, decoration: p.recipe.faceDecoration ?? null }, antenna: p.recipe.antenna ?? null }; };
    const draw = ({ width, height, callback, rng = random } = {}) => {
      const size = width !== undefined;
      const args = [f.target, ...f.foods, f.background];
      if (size) args.push(width, height);
      if (lane === 'basic') args.push(false, callback ?? presentation, rng, f.quality);
      else args.push(callback ?? f.resolve, rng, f.quality);
      return f.scene[lane === 'basic' ? (size ? 'render_with_antenna_at_size' : 'render_with_antenna') :
        (size ? 'render_standard_with_antenna_at_size' : 'render_standard_with_antenna')](...args);
    };
    const ingress = (bytes, food = () => { throw new Error('unexpected synthetic food'); }, prey) => {
      const args = [bytes, false, resolveAppearance, food];
      if (prey) args.push(prey);
      args.push(f.target, ...f.foods, f.background, f.target.width, f.target.height);
      if (lane === 'basic') args.push(false, presentation, random, f.quality);
      else args.push(f.resolve, random, f.quality);
      return f.scene[lane === 'basic' ? (prey ? 'apply_frame_and_render_with_appearance_and_prey' : 'apply_frame_and_render_with_appearance') :
        (prey ? 'apply_frame_and_render_standard_with_appearance_and_prey' : 'apply_frame_and_render_standard_with_appearance')](...args);
    };
    const baseState = f.state;
    const state = () => [baseState(), f.scene.antenna_state(), f.scene.food_state(), f.scene.prey_state(), f.quality.snapshot()];
    const atomic = (call = draw, painted = false) => {
      const before = state(), trace = f.target.context.trace.slice(); let error;
      rejects(() => { try { call(); } catch (e) { error = e; throw e; } });
      eq(state(), before, 'antenna failure preserves complete model, source registries and quality');
      if (!painted) eq(f.target.context.trace, trace, 'antenna preflight fails before Canvas reset');
      eq(f.target.context.stack.length, 0, 'all Canvas scopes balance after failure');
      return error;
    };
    const clear = () => { f.target.context.trace = []; requests.length = 0; };
    clear();
    return Object.assign(f, { bulb, g, lane, apply, draw, ingress, state, atomic, clear, randomRequests: requests,
      presentation, resolveAppearance, setRandom: fn => { random = fn; } });
  }
  const antennaStrokes = f => f.target.context.trace.filter(c => c.op === 'stroke' &&
    [color(f.g.outerColor), color(f.g.innerColor)].includes(c.color));
  const bulbImages = f => f.target.context.trace.filter(c => c.op === 'image' && c.source === f.bulb);
  function checkedDraw(f, options) {
    const before = f.scene.antenna_state(); f.clear(); f.draw(options);
    const after = f.scene.antenna_state(), snapshot = JSON.parse(f.scene.snapshot());
    eq(after.drawSerial, before.drawSerial + 1n, 'one draw serial per actual render');
    const rows = JSON.parse(f.scene.drawn_snakes());
    const strokes = antennaStrokes(f), bulbs = bulbImages(f);
    let offset = 0;
    for (const [i, { request: r, tape }] of f.randomRequests.entries()) {
      const old = before.snakes.find(s => s.token === r.token), next = after.snakes.find(s => s.token === r.token);
      eq(Object.keys(r).sort(), ['token', 'id', 'own', 'drawOrdinal', 'nodeCount', 'randomPairCount', 'drawSerial'].sort());
      eq([typeof r.token, typeof r.drawSerial], ['bigint', 'bigint']);
      eq([r.id, r.own, r.nodeCount, r.randomPairCount, r.drawSerial],
        [old.id, old.own, old.antenna.geometry.nodes, old.antenna.geometry.nodes - 1, after.drawSerial]);
      eq(r.drawOrdinal, i, 'draw ordinal follows existing snake order');
      const m = rows[r.drawOrdinal].snake, expected = step(old.antenna, m, tape);
      eq(next.antenna, expected, 'all six Float32 channels, shown and f64 signed rotation match authored arithmetic exactly');
      const p = paths(expected, snapshot.camera), g = expected.geometry, z = snapshot.camera.zoom, mult = m.scale * z;
      let alpha = m.spawnProgress * (1 - m.deathProgress); alpha *= alpha;
      const widths = g.repeatedInnerStrokes ? [5, 4, 3, 2] : [5, 4];
      const group = strokes.slice(offset, offset + widths.length); offset += widths.length;
      eq(group.length, widths.length);
      for (const [j, stroke] of group.entries()) {
        const path = j ? p.inner : p.outer;
        eq(stroke.path, path, 'open decimated center-relative antenna path');
        eq(stroke.commands.map(c => c.op), ['moveTo', ...Array(path.length - 1).fill('lineTo')]);
        eq([stroke.width, stroke.alpha, stroke.blend, stroke.lineCap, stroke.lineJoin],
          [widths[j] * mult, j ? g.innerOpacity * alpha : alpha, 'source-over', 'round', 'round']);
        eq(stroke.transforms, [['setTransform', 1, 0, 0, 1, 0, 0], ['translate', f.target.width / 2, f.target.height / 2]]);
      }
      const b = g.bulb, image = bulbs[i], tip = p.inner[0], last = g.nodes - 1;
      const transform = [['setTransform', 1, 0, 0, 1, 0, 0], ['translate', f.target.width / 2, f.target.height / 2]];
      const destination = g.rotateBulb ? [b.offsetX * b.scale * mult, b.offsetY * b.scale * mult] :
        [(expected.x[last] - snapshot.camera.absoluteX + b.offsetX * b.scale * m.scale) * z,
          (expected.y[last] - snapshot.camera.absoluteY + b.offsetY * b.scale * m.scale) * z];
      if (g.rotateBulb) transform.push(['translate', ...tip], ['rotate', expected.bulbRotation]);
      eq(image?.source, f.bulb, 'exact borrowed original synthetic bulb object');
      eq(image.args, [...destination, b.width * b.scale * mult, b.height * b.scale * mult], 'five-argument whole-source bulb overload');
      eq([image.transforms, image.alpha, image.blend], [transform, alpha * b.opacity, 'source-over']);
      const trace = f.target.context.trace, bulbIndex = trace.indexOf(image);
      ok(trace.indexOf(group.at(-1)) < bulbIndex, 'all inner strokes precede the bulb');
      const nextBulb = trace.indexOf(bulbs[i + 1]);
      const eyes = trace.findIndex((c, k) => k > bulbIndex && c.op === 'fill' && c.commands[0]?.op === 'arc');
      ok(eyes > bulbIndex && (nextBulb < 0 || eyes < nextBulb), 'complete eyes follow antenna before next snake');
    }
    eq(strokes.length, offset); eq(bulbs.length, f.randomRequests.length);
    // Account for every vector paint, including the existing arena-edge band.
    const otherPaths = f.target.context.trace.filter(c => ['fill', 'stroke'].includes(c.op) &&
      c.commands?.[0]?.op === 'moveTo' && !strokes.includes(c));
    eq(otherPaths.map(c => [c.op, c.color]), [], '6000-radius interior fixture has no unclassified vector paints');
    eq(f.target.context.stack.length, 0);
    return { before, after, snapshot, strokes, bulbs };
  }

  // The recorder follows native Canvas: paths survive save/restore, while cap
  // and join are drawing state. Fault hooks are mutable and run on image calls.
  {
    const f = fixture();
    try {
      const c = f.target.context; c.beginPath(); c.moveTo(1, 2); c.save();
      c.lineCap = 'round'; c.lineJoin = 'round'; c.lineTo(3, 4); c.restore();
      eq([c.lineCap, c.lineJoin, c.path], ['butt', 'miter', [[1, 2], [3, 4]]]);
      let calls = 0; c.beforeCanvasCall = method => { if (method === 'drawImage') calls++; };
      c.drawImage(f.foods[0], 0, 0); eq(calls, 1); c.beforeCanvasCall = null;
    } finally { f.close(); }
  }
  for (const lane of ['standard', 'basic']) {
    // New non-size APIs must acquire a usable pattern before touching Canvas.
    // Legacy entry points deliberately keep their prior reset/fill ordering.
    for (const failure of ['throw', 'null']) {
      const f = make({ lane }), legacy = fixture();
      try {
        const context = f.target.context;
        context.globalAlpha = 0.375; context.fillStyle = '#314159'; context.strokeStyle = '#271828';
        context.lineWidth = 2.5; context.lineCap = 'square'; context.lineJoin = 'bevel';
        context.setTransform(2, 0, 0, 3, 5, 7); context.beginPath(); context.moveTo(11, 13); context.lineTo(17, 19);
        const canvasState = () => [context.savedState(), context.path.slice(), context.pathCommands.slice(), f.target.width, f.target.height];
        const before = canvasState(), trace = context.trace.slice(), acquisition = [];
        context.beforeCanvasCall = method => {
          if (method === 'createPattern') acquisition.push({ state: canvasState(), trace: context.trace.slice() });
        };
        if (failure === 'throw') context.failMethod = 'createPattern'; else context.nullPattern = true;
        f.atomic(() => f.draw());
        eq(acquisition, [{ state: before, trace }], lane + ': pattern acquisition precedes every target or context mutation');
        eq(canvasState(), before, lane + ': failed pattern preserves hostile caller drawing state, path and backing size');
        eq(context.trace, trace, lane + ': non-size antenna pattern failure has no reset, fill or submission');
        context.beforeCanvasCall = null; context.failMethod = null; context.nullPattern = false;
        checkedDraw(f);

        const old = legacy.target.context, oldBefore = legacy.state(), observed = [];
        old.trace = [];
        old.beforeCanvasCall = method => { if (method === 'createPattern') observed.push(old.trace.map(c => c.op)); };
        if (failure === 'throw') old.failMethod = 'createPattern'; else old.nullPattern = true;
        rejects(() => lane === 'standard' ? legacy.render() :
          legacy.scene.render(legacy.target, ...legacy.foods, legacy.background, 1, false));
        eq(legacy.state(), oldBefore, 'legacy pattern failure still preserves numeric model');
        eq(observed, [['reset', 'fillRect']], 'legacy no-antenna pattern acquisition still follows its one reset and background fill');
        eq(old.trace.map(c => c.op), ['reset', 'fillRect'], 'legacy no-antenna ordering remains exact on pattern failure');
        eq(old.stack.length, 0);
      } finally { f.close(); legacy.close(); }
    }
    for (const [nodes, rotate] of [[8, false], [9, true], [11, true]]) {
      const g = geometry(nodes, rotate); if (nodes === 9) g.repeatedInnerStrokes = false;
      const f = make({ lane, g });
      try {
        const initial = f.scene.antenna_state();
        eq(initial.appearanceEnabled, true); eq(initial.snakes.length, 1); eq(initial.snakes[0].antenna.shown, false);
        for (const key of channels) ok(initial.snakes[0].antenna[key] instanceof Float32Array && initial.snakes[0].antenna[key].length === nodes);
        const copied = f.scene.antenna_state(); copied.snakes[0].antenna.x[0] = 99; copied.snakes[0].antenna.geometry.bulb.width = 99;
        eq(f.scene.antenna_state(), initial, 'fresh channel/config diagnostics do not alias retained state');
        const first = checkedDraw(f);
        ok(first.strokes.every(c => c.alpha === 0) && first.bulbs[0].alpha === 0, 'fresh zero-alpha paths and image are still submitted');
        if (rotate) ok(first.after.snakes[0].antenna.bulbRotation < 0, 'initial backward oblique chain retains negative signed rotation remainder');
        const once = f.scene.antenna_state(), q = f.quality.snapshot();
        for (const now of [40, 40, 44, 80]) f.scene.advance(now, false).free();
        eq(f.scene.antenna_state(), once, 'updates consume no chain step, RNG or draw serial');
        eq(f.quality.snapshot(), q, 'render and antenna update do not advance external quality');
        f.scene.set_gaze_heading(2.9); f.scene.apply_frame(Uint8Array.of(101, 93), false); f.scene.advance(84, false).free();
        const second = checkedDraw(f, { width: 960, height: 540 });
        const m = second.snapshot.own;
        ok(m.heading !== m.eyes.heading, 'raw heading differs from face heading in the coupled witness');
        eq(second.after.snakes[0].antenna.x[0], Math.fround(m.correctedX - Math.cos(m.heading) * 8 * m.scale));
        checkedDraw(f); checkedDraw(f, { width: 960, height: 540 });
        f.quality.set_requested_mode(0); f.quality.begin_connection(); checkedDraw(f);
        f.quality.set_requested_mode(1); f.quality.begin_connection(); checkedDraw(f);
      } finally { f.close(); }
    }

    // Explicit null remains an additive mode, without enabling food or prey.
    {
      const f = make({ lane, g: null }), old = fixture();
      try {
        old.scene.reset(); old.scene.apply_frame(bundle(setup(), spawn()), false);
        old.scene.set_follows(false); old.scene.set_camera_position(32550.125, 32550.375); old.scene.set_zoom(0.7125);
        for (const now of [40, 44, 80]) {
          for (const g of [f, old]) { g.scene.advance(now, false).free(); g.target.context.trace = []; }
          let random = 0; f.draw({ rng: () => { random++; throw new Error('null antenna RNG'); } });
          if (lane === 'standard') old.render(); else old.scene.render(old.target, ...old.foods, old.background, 1, false);
          const normalized = g => g.target.context.trace.map(c => c.source ? { ...c, source: c.source.name } : c);
          eq(normalized(f), normalized(old), 'null antenna preserves all legacy Canvas commands exactly');
          eq(f.state(), [old.state(), f.scene.antenna_state(), old.scene.food_state(), old.scene.prey_state(), old.quality.snapshot()]);
          eq(random, 0); eq(f.scene.food_state().enabled, false); eq(f.scene.prey_state().enabled, false);
        }
      } finally { f.close(); old.close(); }
    }

    {
      const f = make({ lane });
      try {
        checkedDraw(f);
        for (const invalid of [() => [], () => new Float32Array(14), () => new Float64Array(13),
          () => new Float64Array(15), () => Promise.resolve(new Float64Array(14)), () => null,
          ...[-0.001, 1, NaN, Infinity, -Infinity].map(value => r => { const out = units(r); out[3] = value; return out; })]) {
          f.atomic(() => f.draw({ rng: invalid }));
        }
        f.atomic(() => f.draw({ rng: () => { throw new Error('synthetic RNG failure'); } }));
        let proxyReads = 0;
        const proxy = new Proxy(new Float64Array(14), { get(target, key) { proxyReads++; return Reflect.get(target, key); } });
        f.atomic(() => f.draw({ rng: () => proxy })); eq(proxyReads, 0, 'proxy random arrays reject before indexed reads');
        f.atomic(() => f.draw({ rng: () => new DataView(new ArrayBuffer(112)) }));
        for (const accessor of [false, true]) {
          let reads = 0;
          const oversized = new Float64Array(16).fill(0.25);
          Object.defineProperty(oversized, 'length', accessor ? { get() { reads++; return 14; } } : { value: 14 });
          f.atomic(() => f.draw({ rng: () => oversized }));
          eq(reads, 0, 'oversized intrinsic Float64 tape rejects without reading its shadow length getter');
          checkedDraw(f, { rng: request => {
            const tape = units(request);
            f.randomRequests.push({ request: structuredClone(request), tape: tape.slice() });
            Object.defineProperty(tape, 'length', accessor ? { get() { reads++; return 16; } } : { value: 16 });
            return tape;
          } });
          eq(reads, 0, 'exact intrinsic fourteen-unit Float64 tape accepts without reading its shadow length getter');
        }
        const spoof = Object.setPrototypeOf(new Uint8Array(14), Float64Array.prototype);
        f.atomic(() => f.draw({ rng: () => spoof }));
        // Complete received validation precedes even appearance resolution.
        let callbacks = 0;
        f.atomic(() => f.scene.apply_frame_with_appearance(bundle(spawn(1), [101]), false,
          () => { callbacks++; return f.resolveAppearance(); }));
        eq(callbacks, 0);
        f.atomic(() => f.scene.apply_frame(bundle(spawn(1)), false));
        f.atomic(() => f.scene.render(f.target, ...f.foods, f.background, 1, false));
        f.atomic(() => f.render());
        f.atomic(() => f.scene.prepare_draw(960, 540));
        // Old recipe ingestion also rejects a newly advertised antenna on an
        // otherwise disabled scene before target reset.
        const legacy = fixture();
        try {
          legacy.catalog.push({ source: f.bulb, state: 'ready' });
          legacy.metadata.antenna = { kind: 'ordinary-chain', geometry: geometry(), image: { asset: 9, sourceMode: 'whole' } };
          const trace = legacy.target.context.trace.slice(), state = legacy.state();
          rejects(legacy.render); eq(legacy.state(), state); eq(legacy.target.context.trace, trace);
        } finally { legacy.close(); }
        for (const key of ['nodes', 'outerColor', 'innerColor', 'innerOpacity', 'repeatedInnerStrokes', 'rotateBulb']) {
          const prior = f.g[key]; f.g[key] = typeof prior === 'boolean' ? !prior : prior + 1;
          f.atomic(); f.g[key] = prior;
        }
        for (const key of ['offsetX', 'offsetY', 'width', 'height', 'scale', 'opacity']) {
          const prior = f.g.bulb[key]; f.g.bulb[key] = prior + 0.01; f.atomic(); f.g.bulb[key] = prior;
        }
        const image = f.metadata.antenna.image;
        for (const change of [{ sourceMode: 'crop' }, { sourceMode: 'whole', sourceRect: [0, 0, 47, 29] }, { sourceMode: 'unknown' }]) {
          f.metadata.antenna.image = { asset: 9, ...change }; f.atomic();
        }
        f.metadata.antenna.image = image;
        f.catalog[9].state = 'pending'; f.atomic(); f.catalog[9].state = 'ready';
        f.g.postBulbStrokes = true; f.atomic(); delete f.g.postBulbStrokes;
        f.metadata.antenna.kind = 'unknown'; f.atomic(); f.metadata.antenna.kind = 'ordinary-chain';
        // The basic presentation projection deliberately has no body feature
        // list. Standard recipes must still reject unrepresented features.
        if (lane === 'standard') {
          f.metadata.unsupportedFeatures = ['unrepresented-antenna']; f.atomic(); f.metadata.unsupportedFeatures = [];
        }
        let reads = 0; const saved = Object.getOwnPropertyDescriptor(f.g, 'nodes');
        Object.defineProperty(f.g, 'nodes', { configurable: true, get() { reads++; return 8; } });
        f.atomic(); eq(reads, 0, 'draw geometry accessors are rejected without invocation');
        Object.defineProperty(f.g, 'nodes', saved);
        // Bypass the provider to exercise the production normalized parser too.
        for (const mutate of [a => ({ ...a, postBulbStrokes: true }),
          a => ({ ...a, kind: 'unknown' }),
          a => ({ ...a, image: { ...a.image, sourceMode: 'crop' } }),
          a => ({ ...a, geometry: { ...a.geometry, bulb: { ...a.geometry.bulb, offsetX: 0 } } })]) {
          f.transform(s => ({ ...s, recipe: { ...s.recipe, antenna: mutate(s.recipe.antenna) } })); f.atomic();
        }
        f.transform(s => s);
        f.g.postBulbStrokes = false; checkedDraw(f); delete f.g.postBulbStrokes;
        const source = f.catalog[9].source;
        f.catalog[9].source = f.target; f.atomic(); f.catalog[9].source = source;
        f.atomic(() => f.draw({ rng: r => { f.bulb.width++; return units(r); } })); f.bulb.width = 47;
        f.atomic(() => f.draw({ rng: r => { f.target._width++; return units(r); } })); f.target._width = 960;
        for (const fail of ['drawImage']) {
          let fired = false;
          f.target.context.beforeCanvasCall = (method, c) => {
            if (method === fail && !fired && antennaStrokes(f).length >= 4) { fired = true; throw new Error('late antenna ' + fail); }
          };
          f.clear(); f.atomic(() => f.draw(), true); ok(fired, 'late Canvas fault reached antenna submission');
          f.target.context.beforeCanvasCall = null; checkedDraw(f);
        }
        f.target.context.failSource = f.bulb; f.target.context.failSourceCount = 0;
        f.atomic(() => f.draw(), true); f.target.context.failSource = null; checkedDraw(f);
      } finally { f.close(); }
    }

    // Full appearance parsing, including accepted signed zeros, is independent
    // of source readiness. No legacy resolver may replace retained config.
    for (const path of [['innerOpacity'], ['bulb', 'offsetX'], ['bulb', 'offsetY'], ['bulb', 'opacity']]) {
      const g = geometry(); let at = g; for (const key of path.slice(0, -1)) at = at[key]; at[path.at(-1)] = -0;
      const f = make({ lane, g });
      try {
        checkedDraw(f); at[path.at(-1)] = 0; f.atomic();
      } finally { f.close(); }
    }
    {
      const f = make({ lane });
      try {
        const bad = [null, {}, { face: face() }, Promise.resolve({ face: face(), antenna: null }),
          { face: face(), antenna: { ...geometry(), nodes: 10 } },
          { face: face(), antenna: { ...geometry(), kind: 'unknown' } },
          { face: face(), antenna: { ...geometry(), postBulbStrokes: true } }];
        let reads = 0; const accessor = { face: face() };
        Object.defineProperty(accessor, 'antenna', { get() { reads++; return geometry(); } }); bad.push(accessor);
        for (const value of bad) f.atomic(() => f.scene.apply_frame_with_appearance(bundle(spawn(1)), false, () => value));
        eq(reads, 0, 'appearance accessors are never invoked');
        let legacy = 0;
        f.atomic(() => f.scene.apply_frame_with_face_geometry(bundle(spawn(1)), false, () => { legacy++; return face(); }));
        eq(legacy, 0, 'enabled appearances require full resolver before legacy callback');
        f.apply(bundle([101, 7]));
      } finally { f.close(); }
    }

    {
      const f = make({ lane, g: geometry(9, true) });
      try {
        checkedDraw(f);
        for (const method of ['translate', 'rotate', 'drawImage']) {
          let hit = false;
          f.clear(); f.target.context.beforeCanvasCall = (name, context) => {
            if (name === method && !hit && antennaStrokes(f).length === 4 &&
                (method !== 'translate' || context.stack.length >= 3)) {
              hit = true; throw new Error('synthetic rotated bulb ' + method);
            }
          };
          f.atomic(() => f.draw(), true); ok(hit, 'rotated bulb failure is reached');
          f.target.context.beforeCanvasCall = null; checkedDraw(f);
        }
      } finally { f.close(); }
    }

    // Inner rejection only clears shown; whole-snake culling retains it.
    {
      const f = make({ lane, commands: [spawn(0, { x: 2000.2, y: 1000.6, points: 64 })], center: 1000 });
      try {
        f.scene.set_camera_position(2000.125, 1000.375); checkedDraw(f);
        const shown = f.scene.antenna_state().snakes[0].antenna;
        f.scene.set_camera_position(20000, 1000); f.clear(); f.draw({ width: 200, height: 200 });
        eq(f.randomRequests.length, 0); eq(f.scene.antenna_state().snakes[0].antenna, shown, 'whole cull preserves every channel and shown');
        f.scene.set_camera_position(1500, 1000); f.clear(); f.draw({ width: 200, height: 200 });
        eq(f.randomRequests.length, 0); eq(f.scene.antenna_state().snakes[0].antenna, { ...shown, shown: false });
        eq(bulbImages(f), []); eq(antennaStrokes(f), []);
        f.scene.set_camera_position(2000.125, 1000.375); checkedDraw(f);
        ok(f.scene.antenna_state().snakes[0].antenna.shown, 're-entry straightens from unrounded root but preserves then evolves velocity');
        const s = f.scene.antenna_state(), snap = JSON.parse(f.scene.snapshot());
        const z = snap.camera.zoom, b = s.bounds;
        eq(b, { minX: snap.camera.absoluteX - (100 / z + 210), maxX: snap.camera.absoluteX + (100 / z + 210),
          minY: snap.camera.absoluteY - (100 / z + 210), maxY: snap.camera.absoluteY + (100 / z + 210) });
        f.apply(bundle(remove(0))); f.scene.set_camera_position(2100, 1100); f.clear(); f.draw();
        const retained = f.scene.antenna_state(), retainedCamera = JSON.parse(f.scene.snapshot()).camera;
        const ex = 100 / retainedCamera.zoom + 210;
        eq(retained.bounds, { minX: retainedCamera.absoluteX - ex, maxX: retainedCamera.absoluteX + ex,
          minY: retainedCamera.absoluteY - ex, maxY: retainedCamera.absoluteY + ex }, 'undrawn retained own refreshes bounds from this draw camera');
        eq(f.randomRequests.length, 0);
        const now = JSON.parse(f.scene.snapshot()).lastUpdateMs;
        f.scene.reset(); const reset = f.scene.antenna_state();
        eq([reset.appearanceEnabled, reset.drawSerial, reset.bounds, reset.snakes], [true, retained.drawSerial, retained.bounds, []]);
        f.scene.set_camera_position(9876, 5432); f.draw(); eq(f.scene.antenna_state().bounds, retained.bounds, 'no-own draw preserves retained bounds');
        if (now !== undefined) eq(JSON.parse(f.scene.snapshot()).lastUpdateMs, now);
      } finally { f.close(); }
    }
    for (const points of [0, 1]) {
      const f = make({ lane, commands: [spawn(0, { points })] });
      try { f.draw(); eq(f.randomRequests.length, 0); eq(bulbImages(f), []); eq(f.scene.antenna_state().snakes[0].antenna.shown, false); }
      finally { f.close(); }
    }
    {
      const f = make({ lane, commands: [spawn(0, { x: 2000.2, y: 1000.6, heading: 0, points: 64 })], center: 1000 });
      try {
        const m = JSON.parse(f.scene.snapshot()).own, root = m.correctedX - Math.cos(m.heading) * 8 * m.scale;
        const z = 0.64285 + 0.514285714 / Math.max((m.logicalSegments + 16) / 36, 1);
        f.scene.set_zoom(z);
        f.scene.set_camera_position(root - (100 / z + 210), 1000.6); f.clear(); f.draw({ width: 200, height: 200 });
        eq(f.randomRequests.length, 1, 'root exactly on the inclusive 210-world margin is eligible');
        eq(f.scene.antenna_state().bounds.maxX, root);
        f.scene.set_camera_position(root - (100 / z + 210) - 0.000001, 1000.6); f.clear(); f.draw();
        eq(f.randomRequests.length, 0, 'root just beyond inclusive bounds is rejected');
        eq(f.scene.antenna_state().snakes[0].antenna.shown, false);
        f.catalog[9].state = 'pending'; f.atomic(); f.catalog[9].state = 'ready';
        f.scene.set_camera_position(20000, 1000); f.clear(); f.draw();
        eq(f.randomRequests.length, 0, 'whole cull reaches no random callback');
      } finally { f.close(); }
    }
    {
      const f = make({ lane });
      try {
        const before = f.scene.antenna_state(), trace = f.target.context.trace.slice(); let calls = 0, tape;
        f.scene.prepare_draw_with_antenna(960, 540, 1, false, r => { calls++; tape = units(r); return tape; });
        const after = f.scene.antenna_state(), m = JSON.parse(f.scene.snapshot()).own;
        eq(calls, 1); eq(after.drawSerial, before.drawSerial + 1n);
        eq(after.snakes[0].antenna, step(before.snakes[0].antenna, m, tape));
        eq(f.target.context.trace, trace, 'numeric preparation paints no Canvas and consumes one chain step');
      } finally { f.close(); }
    }
    {
      const f = make({ lane, commands: [spawn(0), spawn(0), spawn(7)] });
      try {
        checkedDraw(f); const objects = f.scene.antenna_state().snakes;
        eq(objects.map(s => [s.id, s.own]), [[0, true], [0, false], [7, false]]);
        eq(new Set(objects.map(s => s.token)).size, 3);
        f.apply(bundle(remove(0, true), spawn(0))); checkedDraw(f);
        const dead = f.scene.antenna_state().snakes;
        eq(dead.map(s => s.token).slice(0, 3), objects.map(s => s.token));
        ok(dead[3].token !== objects[0].token, 'reused ID has independently initialized antenna');
        f.scene.set_connected(false);
        for (let now = 80; now <= 880; now += 40) f.scene.advance(now, false).free();
        const before = f.scene.antenna_state().snakes.find(s => s.token === objects[0].token)?.antenna;
        f.clear(); f.draw();
        const expired = f.scene.antenna_state().snakes.find(s => s.token === objects[0].token);
        ok(expired && !expired.drawn, 'expired retained own is no longer drawn');
        eq(expired.antenna, before, 'expired chain stops at draw expiry');
        ok(f.randomRequests.every(({ request }) => request.token !== objects[0].token));
      } finally { f.close(); }
    }

    // Setup draws are the same ordered draw operation, with no update and no
    // additional final draw. Eight modest chains reach every ingress cap.
    {
      const f = make({ lane, factories: true }), control = make({ lane, factories: true });
      try {
        const before = f.scene.antenna_state(), quality = f.quality.snapshot();
        f.clear(); eq(f.ingress(bundle(setup(), setup(), setup())), 3);
        for (let i = 0; i < 3; i++) { control.apply(bundle(setup())); control.draw(); }
        eq(f.scene.antenna_state(), control.scene.antenna_state());
        const actual = f.state(), expected = control.state();
        const actualSnapshot = JSON.parse(actual[0][0]), expectedSnapshot = JSON.parse(expected[0][0]);
        eq(expectedSnapshot.frames, actualSnapshot.frames + 2, 'three control packets add two more received frames than one bundled packet');
        expectedSnapshot.frames = actualSnapshot.frames; expected[0][0] = JSON.stringify(expectedSnapshot);
        eq(actual, expected, 'all remaining diagnostics match the same three ordered draws');
        eq(f.scene.antenna_state().drawSerial, before.drawSerial + 3n);
        eq(f.randomRequests.map(v => v.request.drawSerial), [1n, 2n, 3n]);
        eq(bulbImages(f).length, 3); eq(f.quality.snapshot(), quality);
        eq(f.target.context.trace.filter(c => c.op === 'reset').length, 3);
      } finally { f.close(); control.close(); }
    }
    for (const [nodes, repeated] of [[8, false], [11, true]]) {
      const g = geometry(nodes); g.repeatedInnerStrokes = repeated;
      const commands = Array.from({ length: 8 }, (_, i) => spawn(i, { x: 32540 + i, y: 32550, heading: 0 }));
      const f = make({ lane, g, commands, factories: true });
      const compact = f => {
        f.metadata.runs = [{ palette: 0, count: 1 }];
        f.metadata.palettes = [{ variants: [{ asset: 0 }], boostGlow: { asset: 0 } }];
        f.metadata.variantPeriod = 1;
        f.metadata.effects = f.metadata.effects.map(effect => ({ ...effect, asset: 0 }));
      };
      compact(f);
      try {
        f.setRandom(r => { const tape = new Float64Array(2 * r.randomPairCount).fill(0.5);
          f.randomRequests.push({ request: structuredClone(r), tape }); return tape; });
        f.clear(); eq(f.ingress(bundle(...Array.from({ length: 64 }, () => setup()))), 64);
        eq(f.randomRequests.length, 512); eq(bulbImages(f).length, 512);
        eq(antennaStrokes(f).length, repeated ? 2048 : 1024);
        const vertexCount = antennaStrokes(f).filter((_, i) => i % (repeated ? 4 : 2) < 2)
          .reduce((total, p) => total + p.path.length, 0);
        eq(vertexCount, 512 * nodes * 2, 'full-length paths reach the exact vertex accounting boundary');
        eq(f.randomRequests.reduce((n, v) => n + v.tape.length, 0), 512 * (nodes - 1) * 2);
      } finally { f.close(); }
      const failed = make({ lane, g: structuredClone(g), commands, factories: true });
      compact(failed);
      try {
        failed.setRandom(r => { const tape = new Float64Array(2 * r.randomPairCount).fill(0.5);
          failed.randomRequests.push({ request: structuredClone(r), tape }); return tape; });
        const error = failed.atomic(() => failed.ingress(bundle(...Array.from({ length: 63 }, () => setup()), spawn(8), setup())));
        eq(String(error), 'retained presentation capacity exceeded', '513th eligible chain exceeds one shared ingress antenna budget');
        eq(failed.randomRequests.length, nodes === 11 ? 512 : 513,
          'random-unit cap precedes RNG; later output-cap failure retains external RNG consumption');
        eq(failed.scene.antenna_state().snakes.length, 8, 'late Setup failure discards the newly staged ninth appearance');
        failed.clear(); failed.draw(); eq(failed.randomRequests.length, 8, 'successful retry starts with the unconsumed model');
      } finally { failed.close(); }
    }

    // Food, prey and bulbs share exact borrowed-source coherence, also across
    // earlier Setup plans whose appearances have since been removed.
    {
      const f = make({ lane, factories: true });
      const entry = (source, revision = 'synthetic-1') => ({ asset: { source, kind: 'canvas', status: 'ready', revision,
        width: source.width, height: source.height }, width: source.width, height: source.height,
        halfWidth: source.width / 2, halfHeight: source.height / 2 });
      const food = [70, 108, 108, 0, 128, 128, 20];
      const prey = [121, 0, 33, 0, ...absolute(32550), ...absolute(32550), 20, 48, ...u24(0), ...u24(0), ...u16(1000)];
      const factory = (request, revision) => ({ randomPhaseUnit: 0.25, randomWobbleUnit: 0.5,
        palette: { color: request.palette, count: 1, bodies: [entry(f.bulb, revision)],
          outlines: [entry(f.bulb, revision)], glows: [entry(f.bulb, revision)] } });
      const preyFactory = (request, revision) => ({ randomPhaseUnit: 0.25, randomRateUnit: 0.5,
        palette: { color: request.palette, bodies: [entry(f.bulb, revision)], glows: [entry(f.bulb, revision)] } });
      try {
        f.clear(); eq(f.ingress(bundle(food, prey, setup()), r => factory(r, 'synthetic-1'), r => preyFactory(r, 'synthetic-1')), 1);
        ok(f.scene.food_state().enabled && f.scene.prey_state().enabled);
        eq(f.scene.food_state().foods.length, 1); eq(f.scene.prey_state().preys.length, 1);
        const antenna = antennaStrokes(f), trace = f.target.context.trace;
        const first = trace.indexOf(antenna[0]), last = trace.indexOf(antenna.at(-1));
        ok(trace.slice(0, first).some(c => c.op === 'image' && c.source === f.bulb), 'shared-source early food/prey precede antenna');
        ok(trace.slice(last + 1).some(c => c.op === 'image' && c.source === f.bulb && c.blend === 'lighter'), 'shared-source late glows follow antenna');
        f.atomic(() => f.ingress(bundle(food, setup()), r => factory(r, 'conflicting-revision'), r => preyFactory(r, 'synthetic-1')));
        f.atomic(() => f.ingress(bundle(prey, setup()), r => factory(r, 'synthetic-1'), r => preyFactory(r, 'conflicting-revision')));
        f.snapshot.revision = 0;
        f.scene.reset(); f.apply(bundle(setup(), spawn()));
        f.atomic(() => f.ingress(bundle(food, setup()), r => factory(r, -0), r => preyFactory(r, 0)));
        f.snapshot.revision = 'synthetic-1';
        let revisions = 0;
        f.transform(s => ({ ...s, revision: revisions++ ? 'new-revision' : s.revision }));
        f.atomic(() => f.ingress(bundle(setup(), setup()), r => factory(r, 'synthetic-1'), r => preyFactory(r, 'synthetic-1')));
        f.transform(s => s);
        f.scene.reset();
        f.apply(bundle(setup(), spawn()));
        f.clear(); eq(f.ingress(bundle(setup(), remove(0), setup()), r => factory(r, 'synthetic-1'), r => preyFactory(r, 'synthetic-1')), 2);
        eq(bulbImages(f).length, 1, 'earlier Setup pins bulb identity after later removal');
        eq(f.scene.antenna_state().snakes[0].drawn, false);
      } finally { f.close(); }
    }
  }

  // Production standard-body death commands must be computed after applying
  // the antenna cursor effect. The basic lane is a stand-in and makes no claim
  // about source body/death arithmetic.
  for (const eligible of [true, false]) {
    const commands = [spawn(0, { x: eligible ? 100 : 259, y: eligible ? 100 : 0, heading: 0, points: eligible ? 12 : 33 })];
    if (eligible) commands.push(spawn(7, { x: 130, y: 130, heading: 0 }));
    const f = make({ center: 1, commands }), control = make({ center: 1, commands, g: null });
    try {
      for (const g of [f, control]) {
        const m = JSON.parse(g.scene.snapshot()).own;
        g.scene.set_zoom(0.64285 + 0.514285714 / Math.max((m.logicalSegments + 16) / 36, 1)); g.scene.set_camera_position(80, 0);
        g.apply(bundle(remove(0, true))); g.scene.advance(80, false).free(); g.clear(); g.draw();
      }
      const m = JSON.parse(f.scene.snapshot()).own;
      if (eligible) {
        const curve = f.scene.own_curve(1, false), x = curve.at(-3), y = curve.at(-2);
        const rootX = Math.fround(m.correctedX - Math.cos(m.heading) * 8 * m.scale);
        const rootY = Math.fround(m.correctedY - Math.sin(m.heading) * 8 * m.scale);
        const z = JSON.parse(f.scene.snapshot()).camera.zoom;
        for (const g of [f, control]) g.scene.set_camera_position(rootX - (x + 1.5) / z, rootY - y / z);
      } else {
        const z = JSON.parse(f.scene.snapshot()).camera.zoom;
        const rootX = m.correctedX - Math.cos(m.heading) * 8 * m.scale;
        for (const g of [f, control]) g.scene.set_camera_position(rootX - (100 / z + 210) - 1.5, 0);
      }
      for (const g of [f, control]) { g.clear(); g.draw({ width: eligible ? 960 : 200, height: eligible ? 540 : 200 }); }
      const trace = f.target.context.trace, deaths = trace.filter(c => c.op === 'image' && c.source === f.sources[6]);
      ok(deaths.length > 0, 'real Wasm production death suffix is represented');
      const first = deaths[0], snap = JSON.parse(f.scene.snapshot()), camera = snap.camera;
      const curve = f.scene.own_curve(1, false), samples = Array.from({ length: curve.length / 3 }, (_, i) => [...curve.slice(i * 3, i * 3 + 3)]);
      const translation = first.transforms.findLast(t => t[0] === 'translate').slice(1);
      const ordinal = samples.findIndex(p => Object.is((p[0] - camera.absoluteX) * camera.zoom, translation[0]) &&
        Object.is((p[1] - camera.absoluteY) * camera.zoom, translation[1]));
      ok(ordinal >= 0, 'first death image identifies an actual active Float32 sample');
      const p = samples[ordinal], inner = antennaStrokes(f).find(c => c.color === color(f.g.innerColor));
      const cursor = eligible ? inner?.path.at(-1) : [Math.cos(snap.own.heading), Math.sin(snap.own.heading)];
      ok(cursor, 'eligible death cursor is the actual final accepted inner-path vertex');
      const distance = (Math.abs(p[0] - cursor[0]) + Math.abs(p[1] - cursor[1])) / 6;
      ok(distance > 0 && distance < 1, 'first death distance witness is strictly non-saturated');
      const d = snap.own.deathProgress;
      const envelope = (0.15 + 0.15 * Math.abs(Math.sin(5 * Math.PI * d))) * Math.sin(Math.PI * d);
      eq(first.alphaWrites.at(-1).requested, distance * envelope * (0.6 + 0.4 * Math.cos(ordinal / 4 - 15 * d)),
        'production first death alpha uses antenna barrier cursor before planning');
      const old = control.target.context.trace.find(c => c.op === 'image' && c.source === control.sources[6]);
      ok(first.alpha !== old.alpha, 'legacy cursor would produce a different first death command');
      const eye = trace.findIndex(c => c.op === 'fill' && c.commands[0]?.op === 'arc');
      ok(trace.indexOf(deaths.at(-1)) < eye, 'death suffix precedes complete own eyes');
      if (eligible) {
        const bulb = bulbImages(f)[0], prefix = trace.slice(0, trace.indexOf(bulb));
        ok(prefix.some(c => c.op === 'image' && f.sources.includes(c.source)), 'body prefix precedes antenna');
        ok(trace.indexOf(bulb) < trace.indexOf(first), 'antenna precedes recomputed production death suffix');
      } else {
        eq(f.randomRequests.length, 0); eq(antennaStrokes(f), []);
      }
    } finally { f.close(); control.close(); }
  }
}
