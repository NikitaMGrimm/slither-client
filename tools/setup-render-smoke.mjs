import { bundle, syntheticSetup, syntheticStep } from '../web/synthetic-scene.mjs';
import { denseScene } from '../web/dense-scene.mjs';
import { arenaEdgePoints } from './arena-edge-render-smoke.mjs';

// Original synthetic packets and native-call doubles through the actual Wasm ABI.
// No reference/runtime inputs, raster-pixel oracle, browser, network or clocks.
export function setupRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok, rejects }) {
  const setup = (center = 32550, radius = 1000) => {
    const bytes = syntheticSetup();
    bytes.set([center >>> 16 & 255, center >>> 8 & 255, center & 255], 1);
    bytes.set([radius >>> 16 & 255, radius >>> 8 & 255, radius & 255], bytes.length - 3);
    return bytes;
  };
  const x = [70, 108, 108, 9, 128, 128, 25];
  const y = [70, 108, 108, 18, 129, 128, 30];
  const removeX = [99, 108, 108, 128, 128];
  const normalized = trace => trace.map(command => command.source
    ? { ...command, source: command.source.name } : command);
  const clears = f => f.target.context.trace.filter(v => v.op === 'reset').length;
  const face = () => ({ eyes: vanillaEyes(), decoration: { kind: 'none' } });
  const drawFace = () => ({ revision: 'synthetic-1', eyes: vanillaEyes(), decoration: null });
  function harness(path, { faceStyle = null } = {}) {
    const f = fixture({ faceStyle });
    f.scene.reset();
    const created = [], order = [];
    const entry = (source, revision = 'food-setup-1') => ({
      asset: { source, kind: 'canvas', status: 'ready', revision,
        width: source.width, height: source.height },
      width: source.width, height: source.height,
      halfWidth: source.width / 2, halfHeight: source.height / 2,
    });
    const factory = request => {
      const images = ['body', 'outline', 'glow'].map(kind => {
        const image = new f.foods[0].constructor(`setup-food-${created.length}-${kind}`);
        image.width = 33; image.height = 25;
        return image;
      });
      created.push({ request, images }); order.push(`food:${request.rawColor}`);
      return { randomPhaseUnit: 0.25, randomWobbleUnit: 0.5,
        palette: { color: request.palette, count: 1, bodies: [entry(images[0])],
          outlines: [entry(images[1])], glows: [entry(images[2])] } };
    };
    const resolveAppearance = request => { order.push('appearance'); return faceStyle ?? face(request); };
    const resolve = request => {
      order.push('draw');
      if (path === 'standard') return f.resolve(request);
      if (!faceStyle) return drawFace(request);
      const value = f.resolve(request);
      return { revision: value.revision, eyes: value.recipe.eyes, decoration: value.recipe.faceDecoration };
    };
    const apply = (bytes, { width = f.target.width, height = f.target.height,
      appearance: resolveA = resolveAppearance, food = factory, draw = resolve } = {}) => path === 'standard'
      ? f.scene.apply_frame_and_render_standard(bytes, false, resolveA, food,
        f.target, ...f.foods, f.background, width, height, draw, f.quality)
      : f.scene.apply_frame_and_render_with_food(bytes, false, resolveA, food,
        f.target, ...f.foods, f.background, width, height, false, draw, f.quality);
    const resize = (width = f.target.width, height = f.target.height, draw = resolve) => path === 'standard'
      ? f.scene.render_standard_at_size(f.target, ...f.foods, f.background, width, height, draw, f.quality)
      : f.scene.render_with_food_at_size(f.target, ...f.foods, f.background, width, height, false, draw, f.quality);
    const legacyApply = bytes => f.scene.apply_frame_with_factories(bytes, false, resolveAppearance, factory);
    const state = () => [f.state(), f.scene.food_state(), f.quality.snapshot(),
      Array.from(f.scene.head_samples()), Array.from(f.scene.angle_samples()),
      Array.from(f.scene.drawn_eyes(960, 540))];
    const atomic = (run, message) => {
      const before = state(), trace = f.target.context.trace.slice();
      let failure;
      rejects(() => { try { run(); } catch (error) { failure = error; throw error; } });
      eq(state(), before, message);
      eq(f.target.context.trace, trace, 'preflight failure precedes every renderer reset/fill');
      eq(f.target.context.stack.length, 0);
      return failure;
    };
    const start = () => { legacyApply(bundle(setup(), appearance(), x)); resize(); f.target.context.trace = []; order.length = 0; };
    return { ...f, path, entry, created, factory, order, resolve, apply, resize, legacyApply, state, atomic, start };
  }

  function observeCanvas(f) {
    const calls = { getContext: 0, createPattern: 0, reset: 0, fillRect: 0, fill: 0, stroke: 0, drawImage: 0 };
    const assignments = [];
    const width = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f.target), 'width');
    let height = f.target.height;
    Object.defineProperties(f.target, {
      width: { configurable: true, get() { return width.get.call(this); }, set(value) {
        assignments.push(['width', value]); width.set.call(this, value);
      } },
      height: { configurable: true, get() { return height; }, set(value) {
        assignments.push(['height', value]); height = value; this.context.reset();
      } },
    });
    const getContext = f.target.getContext;
    f.target.getContext = function(...args) { calls.getContext++; return getContext.apply(this, args); };
    for (const method of Object.keys(calls).filter(method => method !== 'getContext')) {
      const original = f.target.context[method];
      f.target.context[method] = function(...args) { calls[method]++; return original.apply(this, args); };
    }
    return { calls, assignments, snapshot: () => ({ calls: { ...calls }, assignments: assignments.map(row => [...row]),
      size: [f.target.width, f.target.height] }) };
  }

  // A visible one-anchor face has no curve/body images, even at a 1x1 viewport.
  const shortFace = () => {
    const bytes = appearance().slice(0, -22);
    bytes.set(bytes.slice(16, 22), bytes.length - 6);
    return bytes;
  };
  const setups = count => Array.from({ length: count }, (_, index) => setup(32550, 1000 + index));

  for (const path of ['basic', 'standard']) {
    const f = harness(path), control = harness(path);
    try {
      const q = f.quality.snapshot();
      eq(f.apply(bundle(setup(), appearance(), x, syntheticStep(1), setup(32551, 1200), y,
        removeX, [115, 0, 0, 0], appearance(), setup(32552, 1400))), 3);
      const expectedEdges = [];
      const captureEdge = radius => {
        const snapshot = JSON.parse(control.scene.snapshot());
        const [center, angle, distance] = control.scene.arena_edge_view();
        eq(snapshot.boundary.displayed, radius, 'control retains this Setup radius');
        ok(Math.abs(radius - distance) < 4000);
        const points = arenaEdgePoints({ center, angle, radius, camera: snapshot.camera, width: 960, height: 540 });
        expectedEdges.push(points.fill, points.stroke);
      };
      control.legacyApply(setup()); control.resize();
      captureEdge(1000);
      control.legacyApply(bundle(appearance(), x, syntheticStep(1), setup(32551, 1200))); control.resize();
      captureEdge(1200);
      control.legacyApply(bundle(y, removeX, [115, 0, 0, 0], appearance(), setup(32552, 1400))); control.resize();
      captureEdge(1400);
      eq(f.target.context.trace.filter(v => (v.op === 'fill' || v.op === 'stroke') && v.commands[0]?.op === 'moveTo').map(v => v.path),
        expectedEdges, 'ordered Setup plans retain exact event-time center/radius/polar/camera screen coordinates');
      eq(f.order, ['appearance', 'food:9', 'draw', 'food:18', 'appearance', 'draw'], 'callbacks occupy event positions');
      eq(normalized(f.target.context.trace), normalized(control.target.context.trace),
        'each Setup freezes its own camera, center, boundary, bodies, eyes and food');
      const actualState = f.state(), controlState = control.state();
      const actualSnapshot = JSON.parse(actualState[0][0]), controlSnapshot = JSON.parse(controlState[0][0]);
      eq([actualSnapshot.frames, controlSnapshot.frames], [1, 3], 'ingress frame counters retain their distinct schedules');
      delete actualSnapshot.frames; delete controlSnapshot.frames;
      eq(actualSnapshot, controlSnapshot);
      eq(actualState[0].slice(1), controlState[0].slice(1));
      eq(actualState.slice(1), controlState.slice(1), 'bundled staged draws equal explicit ordered control state');
      eq(f.quality.snapshot(), q, 'Setup never advances applied quality or statistics');
      eq(clears(f), 3, 'empty initial Setup and both later Setups each submit once');
      eq(f.target.context.trace.filter(v => v.op === 'stroke' && v.commands[0]?.op === 'moveTo').map(v => v.path.length), [42, 42, 42],
        'each ordered Setup freezes a complete inner edge, including its event-time radius');
      const resets = f.target.context.trace.flatMap((v, i) => v.op === 'reset' ? [i] : []);
      const earlierFood = f.created[0].images;
      ok(f.target.context.trace.slice(resets[1], resets[2]).some(v => earlierFood.includes(v.source)),
        'sources removed later stay alive for an earlier frozen plan');
      ok(!f.target.context.trace.slice(resets[2]).some(v => earlierFood.includes(v.source)));
      eq(f.scene.food_state().sourceCount, 3, 'GC occurs after all draws and keeps only final food sources');
      eq(f.created.map(v => v.request.zoom), control.created.map(v => v.request.zoom), 'food factories see post-Setup draw zoom');
      ok(f.created[1].request.zoom !== f.created[0].request.zoom);
      f.target.context.trace = [];
      eq(f.apply(bundle(y)), 0, 'factory packet without Setup submits no frame');
      eq(f.target.context.trace, []);
      const before = f.state();
      const dimensions = [];
      const prototypeWidth = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f.target), 'width');
      let actualHeight = f.target.height;
      Object.defineProperties(f.target, {
        width: { configurable: true, get() { return prototypeWidth.get.call(this); },
          set(value) { dimensions.push(['width', value]); prototypeWidth.set.call(this, value); } },
        height: { configurable: true, get() { return actualHeight; }, set(value) {
          dimensions.push(['height', value]); actualHeight = value; this.context.reset(); } },
      });
      let seenEntry;
      f.resize(701, 503, request => { seenEntry = [f.target.width, f.target.height]; return f.resolve(request); });
      eq(seenEntry, [960, 540], 'callbacks observe entry dimensions until all preflight passes');
      eq(dimensions, [['width', 701], ['height', 503]], 'changed layout assigns both sizes');
      eq([f.target.width, f.target.height], [701, 503]);
      dimensions.length = 0;
      f.resize(701, 503);
      eq(dimensions, [['width', 701]], 'unchanged size still isolates hostile Canvas state once');
      eq(f.quality.snapshot(), before[2]);
      eq(f.target.context.stack.length, 0);
    } finally { f.close(); control.close(); }

    for (const bad of [0, -0, 0.5, -1, 4097, Infinity, NaN]) {
      const f = harness(path);
      try {
        let calls = 0;
        f.atomic(() => f.apply(bundle(setup(), appearance()), { width: bad,
          appearance: () => { calls++; return face(); } }), 'invalid desired size rolls back');
        eq(calls, 0);
      } finally { f.close(); }
    }

    for (const failure of ['packet', 'appearance', 'food', 'draw', 'metadata', 'readiness', 'alias', 'background', 'pattern', 'context']) {
      const f = harness(path);
      try {
        f.start();
        let calls = 0;
        const sentinel = { synthetic: failure };
        const beforeDimensions = [f.target.width, f.target.height];
        const options = { width: 777, height: 555 };
        let packet = bundle(setup(), appearance(), y, setup(), setup());
        if (failure === 'packet') packet = bundle(setup(), appearance(), [103, 0]);
        if (failure === 'appearance') options.appearance = () => { throw sentinel; };
        if (failure === 'food') options.food = () => { throw sentinel; };
        if (failure === 'alias') options.food = request => {
          const value = f.factory(request), entry = f.entry(f.target);
          value.palette.bodies = [entry]; value.palette.outlines = [entry]; value.palette.glows = [entry];
          return value;
        };
        options.draw = request => {
          calls++;
          if (failure === 'draw' && calls === 3) throw sentinel;
          if (failure === 'readiness' && calls === 3) f.created[0].images[0].width++;
          if (failure === 'metadata' && calls === 3) return Promise.resolve({});
          return f.resolve(request);
        };
        if (failure === 'background') f.background.complete = false;
        if (failure === 'pattern') f.target.context.failMethod = 'createPattern';
        if (failure === 'context') f.target.getContext = () => null;
        const caught = f.atomic(() => f.apply(packet, options), `${failure} rolls back all planned draws`);
        if (failure === 'alias') ok(String(caught).includes('aliases target'), 'actual native source alias rejection');
        if (['appearance', 'food', 'draw'].includes(failure)) eq(caught, sentinel, 'callback exception identity survives Wasm');
        if (failure === 'packet') eq(calls, 0, 'whole packet validation precedes all draw callbacks');
        eq([f.target.width, f.target.height], beforeDimensions, 'failed desired resize is deferred');
      } finally { f.close(); }
    }

    for (const axis of ['width', 'height']) {
      const f = harness(path);
      try {
        f.start(); const before = f.state(); let calls = 0;
        rejects(() => f.apply(bundle(setup(), setup()), { width: 700, height: 500, draw: request => {
          if (++calls === 2) f.target[axis]++;
          return f.resolve(request);
        } }));
        eq(f.state(), before, 'callback target mutation rolls back model/source registry');
        eq(clears(f), axis === 'width' ? 1 : 0, 'only the callback itself mutates the target');
      } finally { f.close(); }
    }

    for (const occurrence of [2, 3]) {
      const f = harness(path);
      try {
        f.start(); let calls = 0;
        const sentinel = { synthetic: `Setup ${occurrence} resolver` };
        eq(f.atomic(() => f.apply(bundle(setup(), setup(), setup()), { draw: request => {
          if (++calls === occurrence) throw sentinel;
          return f.resolve(request);
        } }), `Setup ${occurrence} failure preserves earlier plans without clearing`), sentinel);
        eq(calls, occurrence);
        f.atomic(() => f.resize(701, 503, () => Promise.resolve({})), 'size-aware explicit render preflight is atomic');
      } finally { f.close(); }
    }

    const late = harness(path);
    try {
      late.start(); const before = late.state();
      const fault = { synthetic: 'late Canvas fault' };
      late.target.context.beforeCanvasCall = (method, context) => {
        if (method === 'setTransform' && context.stack.length === 2
          && context.trace.filter(c => c.op === 'fill' && c.commands[0]?.op === 'arc').length === 8
          && context.trace.filter(c => c.op === 'fill' && c.commands[0]?.op === 'moveTo').length === 1) throw fault;
      };
      let caught;
      rejects(() => { try { late.apply(bundle(setup(32550, 1200), y, setup(32550, 1300))); }
        catch (error) { caught = error; throw error; } });
      eq(caught, fault);
      eq(late.state(), before, 'late native fault rolls back model, source tokens and GC');
      eq(clears(late), 2, 'native failure can leave earlier draws and a later clear visible');
      eq(late.target.context.stack.length, 0);
      late.target.context.beforeCanvasCall = null;
      late.target.context.trace = [];
      eq(late.apply(bundle(setup(32550, 1200), y, setup(32550, 1300))), 2, 'a separate explicit retry can succeed');
      eq(late.scene.food_state().sourceCount, 6);
    } finally { late.close(); }

    // Recipe aliases share one pool across all plans, including signed-zero revisions.
    const geometry = { forward: 10.5, lateral: 5.75, lateralBias: 0.5,
      rotationOffset: 0.25, imageScale: 0.5, pivotX: 8.25, pivotY: 11.5, width: 41, height: 27 };
    const faceStyle = { eyes: vanillaEyes(), decoration: { kind: 'paired-side-images', geometry } };
    for (const zero of [0, -0]) {
      for (const conflict of [false, true]) {
        const f = harness(path, { faceStyle });
        try {
          f.start(); let calls = 0;
          const callback = request => {
            f.snapshot.revision = ++calls === 2 && conflict ? (Object.is(zero, 0) ? -0 : 0) : zero;
            return f.resolve(request);
          };
          if (conflict) {
            const failure = f.atomic(() => f.apply(bundle(setup(), setup()), { draw: callback }),
              'signed-zero body/face conflict across plans rolls back');
            ok(String(failure).includes('incoherent aliased source'), 'Object.is preserves revision sign across plans');
          } else {
            eq(f.apply(bundle(setup(), setup()), { draw: callback }), 2);
            eq(clears(f), 2, 'matching signed-zero recipe aliases submit both plans');
          }
          eq(calls, 2);
        } finally { f.close(); }
      }

      // Pin food selected by plan one before a later factory observes the object.
      for (const conflict of [false, true]) {
        const f = harness(path);
        try {
          const source = new f.foods[0].constructor('shared-food-only');
          const factory = revision => request => {
            const entry = f.entry(source, revision);
            return { randomPhaseUnit: 0.25, randomWobbleUnit: 0.5,
              palette: { color: request.palette, count: 1, bodies: [entry], outlines: [entry], glows: [entry] } };
          };
          f.scene.apply_frame_with_factories(bundle(setup(), appearance(), x), false, face, factory(zero));
          const revision = conflict ? (Object.is(zero, 0) ? -0 : 0) : zero;
          if (conflict) {
            const failure = f.atomic(() => f.apply(bundle(setup(), y, setup()), { food: factory(revision) }),
              'later factory cannot revise food used by an earlier plan');
            ok(String(failure).includes('incoherent aliased food revision'));
            // Historical revisions remain accepted by the targetless API and old explicit draw.
            f.scene.apply_frame_with_factories(bundle(y), false, face, factory(revision));
            if (path === 'standard') f.render();
            else f.scene.render_with_food(f.target, ...f.foods, f.background, false, drawFace, f.quality);
          } else {
            eq(f.apply(bundle(setup(), y, setup()), { food: factory(revision) }), 2);
            eq(f.scene.food_state().sourceCount, 1);
          }
        } finally { f.close(); }
      }

      // Revisions also agree across the food and body/paired-face pools.
      for (const conflict of [false, true]) {
        const f = harness(path, { faceStyle });
        try {
          const source = path === 'standard' ? f.sources[0] : f.faceSource;
          const entry = f.entry(source, zero);
          f.scene.apply_frame_with_factories(bundle(setup(), appearance(), x), false, () => faceStyle, request => ({
            randomPhaseUnit: 0.25, randomWobbleUnit: 0.5,
            palette: { color: request.palette, count: 1, bodies: [entry], outlines: [entry], glows: [entry] },
          }));
          f.snapshot.revision = conflict ? (Object.is(zero, 0) ? -0 : 0) : zero;
          if (conflict) {
            const failure = f.atomic(() => f.apply(bundle(setup(), setup())), 'cross-pool signed-zero conflicts roll back');
            ok(String(failure).includes('incoherent shared body/face and food'));
          } else eq(f.apply(bundle(setup(), setup())), 2);
        } finally { f.close(); }
      }
    }

    // The entire ingress shares sample/image/catalog ceilings rather than resetting
    // them for each Setup. These are bounded original stress inputs, not timings.
    const bounded = harness(path);
    try {
      // Low quality and one catalog entry keep standard commands below twice
      // the sample count and catalog observations below 32*64. Basic uses one
      // image per sample. Thus neither can mask the 262144-sample ceiling.
      bounded.quality.set_requested_mode(0); bounded.quality.begin_connection();
      bounded.metadata.palettes = [{ variants: [{ asset: 0 }], boostGlow: { asset: 0 } }];
      bounded.metadata.runs = [{ palette: 0, count: 1 }]; bounded.metadata.variantPeriod = 1;
      bounded.metadata.effects = bounded.metadata.effects.map(effect => ({ ...effect, asset: 0 }));
      const frames = denseScene({ snakes: 32, anchors: 512, foods: 0, spread: 100 });
      for (const frame of frames) bounded.legacyApply(frame);
      bounded.resize(); bounded.target.context.trace = [];
      const perSnakeSamples = bounded.scene.own_curve(1.7, false).length / 3;
      ok(perSnakeSamples * 32 * 64 > 262144, 'sample fixture can exhaust its own budget within 64 draws');
      eq(JSON.parse(bounded.scene.drawn_snakes()).filter(row => row.snake.visible).length, 32);
      const failure = bounded.atomic(() => bounded.apply(bundle(...setups(64))),
        'aggregate repeated-Setup capacity exhaustion precedes all Canvas writes');
      eq(failure, 'retained presentation capacity exceeded', 'limited native sampler rejects the aggregate sample excess');
    } finally { bounded.close(); }

    const images = harness(path);
    try {
      const source = new images.foods[0].constructor('bounded-shared-food');
      const entry = images.entry(source);
      const factory = request => ({ randomPhaseUnit: 0.25, randomWobbleUnit: 0.5,
        palette: { color: request.palette, count: 1, bodies: [entry], outlines: [entry], glows: [entry] } });
      for (const frame of denseScene({ snakes: 1, anchors: 16, foods: 4096, spread: 100 })) {
        images.scene.apply_frame_with_factories(frame, false, face, factory);
      }
      images.resize(); images.target.context.trace = [];
      const failure = images.atomic(() => images.apply(bundle(...Array.from({ length: 20 }, () => setup()))),
        'food and body images share one budget across all Setup plans');
      eq(failure, 'food paint planning failed: CommandLimit');
    } finally { images.close(); }

    if (path === 'standard') {
      const catalog = harness(path);
      try {
        // Twenty-four face-only recipes observe eight distinct catalog IDs
        // each. The 513th recipe crosses 4096 entries during Setup 22, with
        // zero curve samples/body images and far below the area/draw ceilings.
        catalog.legacyApply(bundle(setup(), ...Array.from({ length: 24 }, shortFace)));
        catalog.resize(); catalog.target.context.trace = []; catalog.requests.length = 0;
        const failure = catalog.atomic(() => catalog.apply(bundle(...setups(32))),
          'body catalog observations share one pool across all Setup plans');
        eq(failure, 'frame catalog budget exceeded');
        eq(catalog.requests.length, 513, 'catalog capacity is reached before the new draw ceiling');
      } finally { catalog.close(); }
    }

    for (const { size, accepted, error } of [
      { size: 1, accepted: 64, error: 'Setup draw count budget exceeded' },
      { size: 4096, accepted: 4, error: 'Setup background pixel budget exceeded' },
    ]) {
      const count = harness(path);
      try {
        const observed = observeCanvas(count);
        eq([count.target.width, count.target.height], [960, 540], 'entry size differs from charged desired size');
        eq(count.apply(bundle(...setups(accepted)), { width: size, height: size }), accepted);
        eq(observed.calls, { getContext: accepted, createPattern: accepted, reset: accepted + 1,
          fillRect: accepted * 2, fill: accepted, stroke: accepted, drawImage: 0 });
        eq(observed.assignments, [['width', size], ['height', size],
          ...Array.from({ length: accepted - 1 }, () => ['width', size])],
        'first changed-size draw assigns both sizes, then every draw isolates once');
        const camera = JSON.parse(count.scene.snapshot()).camera;
        eq(count.target.context.trace.filter(row => row.op === 'stroke').map(row => row.path),
          Array.from({ length: accepted }, (_, index) => arenaEdgePoints({ center: 32550, angle: 0,
            radius: 1000 + index, camera, width: size, height: size }).stroke),
          'every accepted empty Setup submits exact screen vectors in event order');
        eq(count.order, [], 'empty scenes invoke no artificial draw callbacks');
        const beforeNoSetup = observed.snapshot(), quality = count.quality.snapshot();
        eq(count.apply(bundle([112]), { width: size, height: size, draw: () => { throw new Error('no Setup resolver'); } }), 0);
        eq(observed.snapshot(), beforeNoSetup, 'no-Setup ingress does no preflight, assignment or paint');
        eq(count.quality.snapshot(), quality);
        eq(count.apply(bundle(...setups(accepted)), { width: size, height: size }), accepted,
          'a separate ingress starts with a fresh draw and desired-area budget');
        eq(observed.calls.getContext, accepted * 2);
        eq(observed.calls.createPattern, accepted * 2);
        const beforeExplicit = observed.snapshot();
        count.resize(4096, 4096);
        eq(observed.calls.getContext, beforeExplicit.calls.getContext + 1,
          'a maximum-size explicit render is accepted independently of ingress budgets');
        eq(observed.calls.createPattern, beforeExplicit.calls.createPattern + 1);
        eq([count.target.width, count.target.height], [4096, 4096]);
      } finally { count.close(); }

      const excess = harness(path);
      try {
        const observed = observeCanvas(excess), before = observed.snapshot();
        excess.target.context.trace.push({ op: 'sentinel', marker: Symbol('pre-existing trace') });
        eq(excess.atomic(() => excess.apply(bundle(...setups(accepted + 1)), { width: size, height: size }),
          'empty-world excess rolls back model/source/quality and entry target'), error);
        eq(observed.snapshot(), before, 'over-limit ingress never acquires context/pattern, assigns size or paints');
        eq(excess.order, []);
      } finally { excess.close(); }

      const callbacks = harness(path);
      try {
        callbacks.legacyApply(bundle(setup(), shortFace(), x));
        const observed = observeCanvas(callbacks), before = observed.snapshot();
        callbacks.target.context.trace.push({ op: 'sentinel', marker: Symbol('callback preclear trace') });
        const sideEffects = [], sentinel = { forbidden: 'draw resolver beyond ingress budget' };
        eq(callbacks.atomic(() => callbacks.apply(bundle(y, ...setups(accepted + 1)), {
          width: size, height: size, draw: request => {
            if (sideEffects.length === accepted) throw sentinel;
            sideEffects.push(sideEffects.length + 1);
            return callbacks.resolve(request);
          },
        }), 'earlier callbacks survive externally while complete model/source state rolls back'), error);
        eq(sideEffects, Array.from({ length: accepted }, (_, index) => index + 1),
          'budget rejects before the 65th/fifth draw callback and never replays earlier callbacks');
        eq(callbacks.created.length, 2, 'the earlier food factory side effect is retained outside rollback');
        eq(callbacks.scene.food_state().sourceCount, 3, 'new staged food sources are discarded with the rejected ingress');
        eq(observed.snapshot(), before, 'earlier planning callbacks still cause no native preflight or renderer mutation');
        eq(callbacks.apply(setup(), { width: size, height: size }), 1, 'a separate call after rejection receives a fresh budget');
      } finally { callbacks.close(); }
    }

    const protocol = harness(path);
    try {
      const observed = observeCanvas(protocol), before = observed.snapshot();
      let callbacks = 0;
      const forbidden = () => { callbacks++; throw new Error('structurally invalid ingress callback'); };
      eq(protocol.atomic(() => protocol.apply(bundle(appearance(), x, ...setups(4095)), {
        appearance: forbidden, food: forbidden, draw: forbidden,
      }), '4097-command framing rejection precedes every callback and renderer action'), 'frame exceeds 4096 commands');
      eq(callbacks, 0);
      eq(observed.snapshot(), before);
    } finally { protocol.close(); }

    // Initial empty worlds still preflight assets even though there are no recipes.
    const empty = harness(path);
    try {
      empty.background.complete = false;
      empty.atomic(() => empty.apply(setup()), 'initial background failure preserves an empty world');
      eq(empty.order, []);
    } finally { empty.close(); }

    // A later pattern acquisition cannot clear an earlier successfully planned draw.
    const pattern = harness(path);
    try {
      pattern.start(); let calls = 0;
      const create = pattern.target.context.createPattern;
      const sentinel = { synthetic: 'second pattern preflight' };
      pattern.target.context.createPattern = function(...args) {
        if (++calls === 2) throw sentinel;
        return create.apply(this, args);
      };
      eq(pattern.atomic(() => pattern.apply(bundle(setup(), setup())), 'all patterns preflight before first reset'), sentinel);
      eq(calls, 2);
    } finally { pattern.close(); }
  }
}
