import { bundle, syntheticSetup } from '../web/synthetic-scene.mjs';

// Original synthetic geometry and packets. This checks the production Wasm
// Canvas ABI numerically; the recorder provides no pixels or browser oracle.
export function arenaEdgePoints({ center, angle, radius, camera, width, height }) {
  let k = radius;
  if (4000 / radius > 2 * Math.PI) k = 4000 / (2 * Math.PI);
  const point = (theta, r) => [width / 2 + ((center + Math.cos(theta) * r) - camera.absoluteX) * camera.zoom,
    height / 2 + ((center + Math.sin(theta) * r) - camera.absoluteY) * camera.zoom];
  const inner = [point(angle - 2000 / k, radius)];
  for (let j = -2000; j <= 2000; j += 100) inner.push(point(angle + j / k, radius));
  const outer = [];
  for (let j = 2000; j >= -2000; j -= 100) outer.push(point(angle + j / k, radius + 4000));
  return { fill: [...inner, ...outer], stroke: inner };
}

export function assertArenaEdge(f, { eq, ok }, frozen = null) {
  const snapshot = JSON.parse(f.scene.snapshot());
  const [center, angle, distance] = f.scene.arena_edge_view();
  const input = frozen ?? { center, angle, distance, radius: snapshot.protocol == null ? null : snapshot.boundary?.displayed,
    camera: snapshot.camera, width: f.target.width, height: f.target.height };
  const trace = f.target.context.trace;
  const paths = trace.filter(c => (c.op === 'fill' || c.op === 'stroke') && c.commands[0]?.op === 'moveTo');
  if (input.radius == null || !(Math.abs(input.radius - input.distance) < 4000)) {
    eq(paths, [], 'strict distance gate or absent Setup emits no edge path');
    return null;
  }
  eq(paths.length, 2, 'exactly two edge paint paths');
  const [fill, stroke] = paths, expected = arenaEdgePoints(input);
  eq([fill.op, stroke.op], ['fill', 'stroke'], 'closed band precedes open inner stroke');
  eq(fill.path, expected.fill, 'all 83 f64 screen pairs, including both radial joins');
  eq(stroke.path, expected.stroke, 'all 42 inner screen pairs, including duplicated first endpoint');
  eq(fill.commands.map(c => c.op), ['moveTo', ...Array(82).fill('lineTo'), 'closePath']);
  eq(stroke.commands.map(c => c.op), ['moveTo', ...Array(41).fill('lineTo')]);
  eq(fill.args, [], 'default nonzero fill winding');
  eq([fill.color, stroke.color, stroke.width], ['#300000', '#800000', 23 * input.camera.zoom]);
  for (const paint of paths) {
    eq([paint.alpha, paint.blend, paint.transforms], [0.8, 'source-over', [['setTransform', 1, 0, 0, 1, 0, 0]]],
      'screen geometry has its own identity/source-over/constant-alpha scope');
  }
  const fillIndex = trace.indexOf(fill), strokeIndex = trace.indexOf(stroke);
  const start = trace.findLastIndex((c, i) => i < fillIndex && c.op === 'save');
  const end = trace.findIndex((c, i) => i > strokeIndex && c.op === 'restore');
  ok(start >= 0 && end > strokeIndex, 'edge has a complete scoped save/restore');
  eq(trace[end].state, trace[start].state, 'edge restores alpha/blend/styles/width/transform');
  const commands = trace.slice(start, end + 1).filter(c => ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'arc'].includes(c.op));
  eq(commands.map(c => c.op), ['beginPath', 'moveTo', ...Array(82).fill('lineTo'), 'closePath', 'fill',
    'beginPath', 'moveTo', ...Array(41).fill('lineTo'), 'stroke'], 'exactly 130 vector operations, with no arc or chord');
  ok(trace.findLastIndex(c => c.op === 'image') < start, 'edge follows all body/food/prey image calls');
  eq(f.target.context.stack.length, 0, 'frame and edge scopes balance');
  eq(f.target.context.path, stroke.path, 'save/restore leaves the current open path intact');
  return { fill, stroke, input };
}

export function arenaEdgeRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok, rejects }) {
  const checks = { eq, ok };
  const setup = (center = 32550, radius = 1000) => {
    const bytes = syntheticSetup();
    bytes.set([center >>> 16 & 255, center >>> 8 & 255, center & 255], 1);
    bytes.set([radius >>> 16 & 255, radius >>> 8 & 255, radius & 255], bytes.length - 3);
    return bytes;
  };
  const face = () => ({ eyes: vanillaEyes(), decoration: { kind: 'none' } });
  const drawFace = () => ({ revision: 'synthetic-1', eyes: vanillaEyes(), decoration: null });
  for (const lane of ['basic', 'standard']) {
    const f = fixture(), twin = fixture();
    for (const g of [f, twin]) {
      g.scene.reset();
      g.scene.apply_frame_with_factories(bundle(setup(), appearance()), false, face,
        () => { throw new Error('edge-only fixture has no retained food'); });
    }
    const draw = (g = f, width = g.target.width, height = g.target.height) => lane === 'standard'
      ? g.scene.render_standard_at_size(g.target, ...g.foods, g.background, width, height, g.resolve, g.quality)
      : g.scene.render_with_food_at_size(g.target, ...g.foods, g.background, width, height, false, drawFace, g.quality);
    const paint = (g = f, width, height) => {
      g.target.context.trace = [];
      const updateState = () => {
        const own = JSON.parse(g.scene.snapshot()).own;
        return own && ['x', 'y', 'heading', 'spawnProgress', 'deathProgress', 'boostPhase',
          'headIndex', 'angleIndex', 'lengthIndex'].map(key => own[key]);
      };
      const priorUpdate = updateState();
      const before = [JSON.parse(g.scene.snapshot()).boundary, [...g.scene.boundary_samples()], g.quality.snapshot()];
      draw(g, width, height);
      eq(updateState(), priorUpdate, 'drawing advances no entity animation clock');
      eq([JSON.parse(g.scene.snapshot()).boundary, [...g.scene.boundary_samples()], g.quality.snapshot()], before,
        'explicit and at-size draws consume no boundary or quality step');
      return assertArenaEdge(g, checks);
    };
    const allState = (g = f) => [g.state(), g.scene.food_state(), g.scene.prey_state(), g.quality.snapshot()];
    const prepare = (g, x, y, zoom = 0.7125) => {
      g.scene.set_follows(false); g.scene.set_camera_position(x, y); g.scene.set_zoom(zoom);
    };
    try {
      eq([...f.scene.arena_edge_view()], [32550, 0, 0], 'Setup before first own draw retains initial +0 polar values');
      const copied = f.scene.arena_edge_view(); copied.fill(-1);
      eq([...f.scene.arena_edge_view()], [32550, 0, 0], 'polar diagnostics are copied');
      prepare(f, 32673.125, 32483.625);
      const first = paint(f, 701, 503);
      const camera = JSON.parse(f.scene.snapshot()).camera;
      const dx = camera.absoluteX - 32550, dy = camera.absoluteY - 32550;
      eq([...f.scene.arena_edge_view()], [32550, Math.atan2(dy, dx), Math.sqrt(dx * dx + dy * dy)]);
      ok(first.stroke.path.some(p => !Object.is(Math.fround(p[0]), p[0])), 'edge retains precision beyond Float32');
      const hq = first.stroke.path;
      f.quality.begin_skin_preview();
      prepare(f, 32673.125, 32483.625);
      eq(paint(f).stroke.path, hq, 'skin-preview quality initialization does not invent a chooser gate');
      f.quality.set_requested_mode(0); f.quality.begin_connection();
      prepare(f, 32673.125, 32483.625);
      eq(paint(f).stroke.path, hq, 'quality preference does not scale or omit the edge');
      f.quality.set_requested_mode(1); f.quality.begin_connection();
      for (let i = 1; i <= 2; i++) f.quality.update_statistics(1001 * i, 0, true);
      const step = f.scene.advance(44, false);
      try { f.quality.advance(step, true); } finally { step.free(); }
      const quality = JSON.parse(f.quality.snapshot());
      ok(!quality.highQuality && quality.qualityBlend > 0 && quality.qualityBlend < 1);
      prepare(f, 32673.125, 32483.625);
      eq(paint(f).stroke.path, hq, 'intermediate quality blend leaves the frozen edge unchanged');

      // Both strict endpoints and just-inside/outside cases use an exact axis distance.
      for (const distance of [4999.5, 5000, 5000.5, 1000, 0]) {
        prepare(f, 32550 + distance, 32550, 0.75);
        const result = paint();
        eq(Boolean(result), Math.abs(1000 - distance) < 4000, 'strict gate has no viewport or quality branch');
      }
      prepare(f, 32800, 32550, 0.75);
      const before = allState(); const prior = f.target.context.trace.slice();
      rejects(() => draw(f, 0, 503));
      eq(allState(), before); eq(f.target.context.trace, prior, 'invalid desired size rejects before reset');
      if (lane === 'standard') {
        const old = f.catalog[0].state; f.catalog[0].state = 'pending';
        rejects(() => draw()); eq(allState(), before); eq(f.target.context.trace, prior);
        f.catalog[0].state = old;
      }

      // A native exception after edge submission begins leaves numeric state uncommitted.
      for (const method of ['setTransform', 'globalCompositeOperation']) {
        paint();
        const eyeCount = f.target.context.trace.filter(c => c.op === 'fill' && c.commands[0]?.op === 'arc').length;
        eq(eyeCount, 4, 'one complete paired face precedes the late fault');
        let failed = false;
        const observed = [];
        const fault = new Error(`authored late edge ${method}`);
        f.target.context.beforeCanvasCall = (name, context) => {
          if (name === method) observed.push([context.stack.length, context.trace.filter(c => c.op === 'fill' && c.commands[0]?.op === 'arc').length]);
          if (!failed && name === method && context.stack.length === 2
            && context.trace.filter(c => c.op === 'fill' && c.commands[0]?.op === 'arc').length === eyeCount) { failed = true; throw fault; }
        };
        const saved = allState();
        f.target.context.trace = [];
        let caught;
        try { draw(); } catch (error) { caught = error; }
        ok(failed, `${lane}/${method} late fault; observed ${JSON.stringify(observed)}`);
        eq(caught, fault, 'late native exception identity is retained');
        eq(allState(), saved, 'late exception rolls back model, polar cache and source registries');
        eq(f.target.context.stack.length, 0, 'native failure restores edge and frame scopes');
        f.target.context.beforeCanvasCall = null;
        paint();
      }

      // Hostile caller state is reset, then the late vectors still use their own scope.
      const context = f.target.context;
      context.setTransform(2, 1, 3, 4, 55, -44); context.globalAlpha = 0.125;
      context.globalCompositeOperation = 'xor'; context.fillStyle = '#abcdef'; context.strokeStyle = '#fedcba'; context.lineWidth = 91;
      paint(); eq([context.alpha, context.blend], [1, 'source-over']);
      // Also contaminate the immediate late entry, after the frame reset, so
      // frame isolation cannot accidentally satisfy the edge's own scope test.
      const firstVector = context.trace.findIndex(c => c.op === 'moveTo');
      const edgeSave = context.trace.findLastIndex((c, i) => i < firstVector && c.op === 'save');
      const edgeSaveOrdinal = context.trace.slice(0, edgeSave + 1).filter(c => c.op === 'save').length;
      let saves = 0, injected = false;
      context.beforeCanvasCall = (method, ctx) => {
        if (method !== 'save' || ++saves !== edgeSaveOrdinal) return;
        injected = true;
        ctx.setTransform(2, 1, 3, 4, 55, -44); ctx.globalAlpha = 0.125;
        ctx.globalCompositeOperation = 'xor'; ctx.fillStyle = '#abcdef'; ctx.strokeStyle = '#fedcba'; ctx.lineWidth = 91;
      };
      try { paint(); ok(injected, 'hostile late-entry state is reached'); }
      finally { context.beforeCanvasCall = null; }
      eq([context.alpha, context.blend], [1, 'source-over'], 'outer frame restores after the edge restores hostile late-entry state');

      // Radius target changes do not replace the displayed radius or consume ring slots on draws.
      f.scene.apply_frame(Uint8Array.of(122, 0, 1, 144), false);
      eq(JSON.parse(f.scene.snapshot()).radius, 400);
      eq(paint().input.radius, 1000);
      f.scene.advance(48, false).free(); f.scene.advance(88, false).free();
      const displayed = JSON.parse(f.scene.snapshot()).boundary.displayed;
      ok(displayed !== 1000 && displayed !== 400);
      eq(paint().input.radius, displayed);
      f.scene.set_connected(false); f.scene.advance(128, false).free();
      eq(paint().input.radius, displayed, 'disconnection pauses radius consumption only');

      // Retained original own still refreshes polar state through death, expiry and reuse.
      f.scene.apply_frame(Uint8Array.of(115, 0, 0, 1), false);
      prepare(f, 32550, 33550); paint();
      ok(JSON.parse(f.scene.snapshot()).own.deathProgress >= 0);
      for (let time = 168; time <= 2008; time += 40) f.scene.advance(time, false).free();
      f.scene.apply_frame(appearance(), false); prepare(f, 31550, 32550); paint();
      eq(f.scene.arena_edge_view()[1], Math.PI, 'expired/reused own identity keeps the original polar gate');

      const cached = [...f.scene.arena_edge_view()];
      f.scene.reset(); eq([...f.scene.arena_edge_view()], cached, 'reset preserves polar cache');
      paint();
      f.scene.apply_frame(setup(32700, 900), false);
      prepare(f, 90000, -70000, 0.625);
      const stale = paint(f, 703, 505);
      eq([...f.scene.arena_edge_view()], [32700, cached[1], cached[2]], 'no-own draws retain stale angle/distance after center change');
      ok(stale.stroke.path.every(([x, y]) => x < 0 && y > 505), 'strict-gated edge may be entirely offscreen');

      // New no-own state starts at +0 regardless of camera; current projection remains live.
      twin.scene.reset(); twin.scene.apply_frame(setup(), false); prepare(twin, 100, 200, 0.5);
      paint(twin); eq([...twin.scene.arena_edge_view()], [32550, 0, 0]);
      twin.scene.apply_frame(setup(32550, 4000), false); eq(paint(twin), null, 'upper strict threshold excludes equality');
      for (const radius of [1, 400, 636, 637, 3999]) {
        twin.scene.apply_frame(setup(32550, radius), false); ok(paint(twin), 'positive small-radius fallback and threshold cases');
      }
      for (const [g, time] of [[f, 2008], [twin, 40]]) {
        const unchanged = g.scene.advance(time, false);
        try { eq([unchanged.delta, unchanged.whole_steps, unchanged.double_steps], [0, 0, 0],
          'draws and Setup/reset leave the shared update timestamp untouched'); } finally { unchanged.free(); }
      }
    } finally { f.target.context.beforeCanvasCall = null; f.close(); twin.close(); }
  }
}
