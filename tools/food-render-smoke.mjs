import { bundle, syntheticSetup } from '../web/synthetic-scene.mjs';

// Authored full packet -> retained animation -> native Wasm render submissions.
// The shared Canvas recorder has no pixels and opens no connection.
export function foodRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok, rejects }) {
  const spawn = [70, 108, 108, 9, 128, 128, 25, 18, 128, 128, 30];
  const face = () => ({ eyes: vanillaEyes(), decoration: { kind: 'none' } });
  for (const path of ['standard', 'basic']) {
    const f = fixture();
    const created = [];
    let now = 40;
    const entry = source => ({ asset: { source, kind: 'canvas', status: 'ready', revision: 'food-1',
      width: source.width, height: source.height }, width: source.width, height: source.height,
    halfWidth: source.width / 2, halfHeight: source.height / 2 });
    const factory = request => {
      const index = created.length;
      const images = ['body', 'outline', 'glow'].map(kind => {
        const source = new f.foods[0].constructor(`food-${index}-${kind}`);
        source.width = 33; source.height = 25;
        return source;
      });
      created.push({ request, images });
      return { randomPhaseUnit: 0.25, randomWobbleUnit: 0.5,
        palette: { color: request.palette, count: 1, bodies: [entry(images[0])],
          outlines: [entry(images[1])], glows: [entry(images[2])] } };
    };
    const apply = bytes => f.scene.apply_frame_with_factories(bytes, false, face, factory);
    const render = callback => path === 'standard' ? f.render(callback) : f.scene.render_with_food(
      f.target, ...f.foods, f.background, false,
      callback ?? (() => ({ revision: 'synthetic-1', eyes: vanillaEyes(), decoration: null })), f.quality);
    const state = () => [f.state(), f.scene.food_state()];
    const foodImages = () => f.target.context.trace.filter(v => v.op === 'image' && created.some(c => c.images.includes(v.source)));
    const draw = () => { f.target.context.trace = []; render(); return foodImages(); };
    const tick = delta => f.scene.advance(now += delta, false).free();
    try {
      f.scene.reset();
      apply(bundle(syntheticSetup(), appearance(), spawn));
      let food = f.scene.food_state();
      eq(food.enabled, true); eq(food.receivedCount, 1); eq(food.foods.length, 2);
      eq(food.sourceCount, 6);
      eq(created.map(c => c.request.rawColor), [9, 18]);
      eq(created.map(c => c.request.palette), [9, 0]);
      eq(created.map(c => c.request.rapid), [true, true]);
      eq(typeof food.ownToken, 'bigint'); eq(typeof food.foods[0].instance, 'bigint');
      eq(typeof food.foods[0].sources[0].handle, 'bigint');
      eq(food.foods.map(v => v.scale), [0.00001, 0.00001]);
      food.foods[0].renderX = -1; food.foods[0].sources[0].width = -1;
      eq(f.scene.food_state().foods[0].renderX, 32550, 'copied diagnostics cannot inject food state');
      const creationZoom = f.scene.food_state().foods[0].creationZoom;
      const qBefore = f.quality.snapshot();
      let calls = draw();
      eq(f.quality.snapshot(), qBefore, 'render only borrows applied quality');
      eq(calls.length, 14);
      const [first, second] = created;
      eq(calls.map(v => v.source), [second.images[1], first.images[1],
        second.images[0], second.images[0], first.images[0], first.images[0],
        second.images[2], second.images[2], second.images[2], second.images[2],
        first.images[2], first.images[2], first.images[2], first.images[2]]);
      eq(calls.map(v => v.blend), ['source-over', 'source-over', ...Array(12).fill('lighter')]);
      ok(calls.every(v => v.args.length === 8), 'initial tiny scale uses the explicit nine-argument overload');
      const trace = f.target.context.trace;
      const indices = trace.flatMap((v, i) => calls.includes(v) ? [i] : []);
      const bodySources = path === 'standard' ? f.sources : f.foods;
      ok(trace.slice(indices[5] + 1, indices[6]).some(v => v.op === 'image' && bodySources.includes(v.source)),
        'all early food precedes snake bodies');
      eq(trace.slice(indices[6]).filter(v => v.op === 'fill').length, 0, 'late food follows all eyes');
      eq(f.target.context.stack.length, 0);
      f.scene.advance(now, false).free();
      eq(f.scene.food_state().foods.map(v => v.scale), [0, 0], 'zero-delta update applies the true initial scale');
      tick(8);
      const beforeSetup = f.scene.food_state();
      apply(syntheticSetup());
      eq(f.scene.food_state(), beforeSetup, 'Setup preserves the full retained food state');
      f.scene.set_zoom(1.3);
      calls = draw();
      eq(f.scene.food_state().foods[0].creationZoom, creationZoom);
      const inner = calls[6];
      const retained = f.scene.food_state().foods[1];
      const view = JSON.parse(f.scene.snapshot()).camera;
      const shiftedX = (retained.renderX - view.absoluteX) * (1 + 0.06 * retained.scale) * view.zoom + f.target.width / 2;
      eq(inner.args[4], shiftedX - 16.5 * retained.scale, 'glow shift, projection and pivot preserve operation order');
      f.quality.set_requested_mode(0); f.quality.begin_connection();
      calls = draw(); eq(calls.length, 4); eq(calls.map(v => v.blend), ['source-over', 'source-over', 'lighter', 'lighter']);
      f.quality.set_requested_mode(1); f.quality.begin_connection();
      f.quality.update_statistics(1001, 0, true); f.quality.update_statistics(2002, 0, true);
      const step = f.scene.advance(now += 8, false);
      try { f.quality.advance(step, true); } finally { step.free(); }
      const transition = JSON.parse(f.quality.snapshot());
      ok(!transition.highQuality && transition.qualityBlend > 0 && transition.qualityBlend < 1);
      eq(draw().length, 14, 'positive blend retains all food passes during LQ fallback');
      for (let i = 0; i < 12; i++) tick(40);
      calls = draw();
      eq(f.scene.food_state().foods.map(v => v.scale), [1, 1]);
      ok(calls.every(v => v.args.length === 2), 'full scale uses the three-argument whole-source overload');
      const fullView = JSON.parse(f.scene.snapshot()).camera;
      const fullFood = f.scene.food_state().foods[1];
      eq(calls[0].args[0], f.target.width / 2 + fullView.zoom * (fullFood.renderX - fullView.absoluteX) - 16.5,
        'whole-source destination subtracts the retained odd half width');

      const beforeFailure = state();
      f.target.context.failSource = first.images[2];
      rejects(() => render());
      eq(state(), beforeFailure, 'late food Canvas failure preserves client and registry');
      eq(f.target.context.stack.length, 0);
      f.target.context.failSource = null;
      draw();
      const beforeMutation = state(), priorTrace = f.target.context.trace.slice();
      const originalWidth = first.images[0].width;
      first.images[0].width = originalWidth + 1;
      rejects(() => render());
      eq(state(), beforeMutation); eq(f.target.context.trace, priorTrace, 'invalid retained source rejects before target reset');
      first.images[0].width = originalWidth;

      apply(bundle([99, 108, 108, 128, 128]));
      eq(f.scene.food_state().foods.length, 1); eq(f.scene.food_state().sourceCount, 3);
      const originalOwn = f.scene.food_state().ownToken;
      apply(bundle([60, 108, 108, 128, 128, 0, 0], [115, 0, 0, 0], appearance()));
      food = f.scene.food_state();
      eq(food.foods[0].eaten, true); eq(food.foods[0].eater, originalOwn, 'explicit eater ID zero captures the original object');
      tick(8); eq(f.scene.food_state().foods[0].eater, originalOwn, 'ID reuse does not retarget food');
      for (let i = 0; i < 9; i++) tick(40);
      eq(f.scene.food_state().foods.length, 0); eq(f.scene.food_state().sourceCount, 0, 'expiry releases selected JS sources');
      const stable = state();
      let seen = 0;
      rejects(() => f.scene.apply_frame_with_factories(bundle(spawn), false, face, request => {
        const value = factory(request);
        if (++seen === 2) value.randomWobbleUnit = 1;
        return value;
      }));
      eq(seen, 2); eq(state(), stable, 'late factory failure rolls back caches, foods and source ownership');
      const lastSerial = beforeSetup.foods[1].instance;
      f.scene.reset(); apply(bundle(syntheticSetup(), appearance(), spawn));
      ok(f.scene.food_state().foods[0].instance > lastSerial, 'reset never reuses food identities');
      if (path === 'basic') {
        const before = state(), prior = f.target.context.trace.slice();
        rejects(() => f.scene.render(f.target, ...f.foods, f.background, 1, false));
        eq(state(), before); eq(f.target.context.trace, prior, 'legacy basic API cannot silently select food quality');
      }
    } finally { f.close(); }
  }
}
