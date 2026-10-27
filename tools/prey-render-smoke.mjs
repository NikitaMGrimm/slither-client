import { bundle, syntheticSetup } from '../web/synthetic-scene.mjs';

// Authored packet/update/draw integration using the production Wasm and shared
// Canvas recorder. No reference runtime, artwork, sockets or raster oracle.
export function preyRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok, rejects }) {
  const u16 = n => [n >>> 8 & 255, n & 255];
  const u24 = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const spawn = (id, x = 30, raw = 9) => [121, ...u16(id), raw,
    ...u24((32550 + x) * 5), ...u24(32550 * 5), 20, 48,
    ...u24(0), ...u24(0), ...u16(1000)];
  const remove = id => [121, ...u16(id)];
  const capture = (id, eater) => [...remove(id), ...u16(eater)];
  const face = () => ({ eyes: vanillaEyes(), decoration: { kind: 'none' } });
  const drawFace = () => ({ revision: 'synthetic-1', eyes: vanillaEyes(), decoration: null });
  const foodPacket = [70, 108, 108, 0, 128, 128, 20];
  const entry = (source, revision = 'prey-1') => ({
    asset: { source, kind: 'canvas', status: 'ready', revision, width: source.width, height: source.height },
    width: source.width + 0.25, height: source.height + 0.5,
    halfWidth: source.width / 2 - 0.25, halfHeight: source.height / 2 + 0.75,
  });
  for (const lane of ['standard', 'basic']) {
    const f = fixture();
    const created = [], foods = [];
    const canvas = name => new f.foods[0].constructor(name);
    const preyFactory = request => {
      const images = ['body0', 'body1', 'glow0', 'glow1', 'glow2'].map((label, i) => {
        const source = canvas('prey-' + created.length + '-' + label);
        source.width = 25 + i * 8; source.height = 21 + i * 6; return source;
      });
      created.push({ request, images });
      return { randomPhaseUnit: 0.25, randomRateUnit: 0.5,
        palette: { color: request.palette, bodies: images.slice(0, 2).map(s => entry(s)),
          glows: images.slice(2).map(s => entry(s)) } };
    };
    const foodFactory = request => {
      const images = ['body', 'outline', 'glow'].map(label => canvas('food-' + foods.length + '-' + label));
      foods.push({ request, images });
      return { randomPhaseUnit: 0, randomWobbleUnit: 0, palette: { color: request.palette, count: 1,
        bodies: [entry(images[0], 'food-1')], outlines: [entry(images[1], 'food-1')],
        glows: [entry(images[2], 'food-1')] } };
    };
    const apply = bytes => f.scene.apply_frame_with_all_factories(bytes, false, face, foodFactory, preyFactory);
    const render = () => lane === 'standard' ? f.render() :
      f.scene.render_with_food(f.target, ...f.foods, f.background, false, drawFace, f.quality);
    const allState = () => [f.state(), f.scene.food_state(), f.scene.prey_state(), f.quality.snapshot()];
    const preyImages = () => f.target.context.trace.filter(c => c.op === 'image' &&
      created.some(p => p.images.includes(c.source)));
    const draw = () => { f.target.context.trace = []; render(); return preyImages(); };
    const ingress = (bytes, resolver = preyFactory) => lane === 'standard' ?
      f.scene.apply_frame_and_render_standard_with_prey(bytes, false, face, foodFactory, resolver,
        f.target, ...f.foods, f.background, 960, 540, f.resolve, f.quality) :
      f.scene.apply_frame_and_render_with_food_and_prey(bytes, false, face, foodFactory, resolver,
        f.target, ...f.foods, f.background, 960, 540, false, drawFace, f.quality);
    let now = 40;
    try {
      f.scene.reset();
      apply(bundle(syntheticSetup(), appearance(), foodPacket, spawn(31), spawn(32, -20, 18)));
      let state = f.scene.prey_state();
      eq(state.enabled, true); eq(state.preys.length, 2); eq(state.sourceCount, 4);
      eq(state.preys.map(p => p.familyCounts), [[2, 3], [2, 3]]);
      eq(state.preys.map(p => p.palette), [0, 0]);
      eq(created.map(p => p.request.rawColor), [9, 18]);
      eq(created.map(p => p.request.direction), [0, 0]);
      eq(created.map(p => p.request.speedPer32ms), [1, 1]);
      eq(state.preys.map(p => p.indices), [[1, 2], [1, 2]]);
      eq(state.preys.map(p => p.glowPhase), [16, 16]);
      eq(state.preys.map(p => p.glowRate), [0.5 + 0.5 * 0.15 + 0.1 * 4,
        0.5 + 0.5 * 0.15 + 0.1 * 4]);
      ok(state.preys.every(p => typeof p.instance === 'bigint' && p.samples.length === 2 &&
        p.samples.every(a => a instanceof Float32Array && a.length === 53) && p.weights.length === 53));
      const pristine = f.scene.prey_state();
      pristine.preys[0].samples[0][0] = 123; pristine.preys[0].weights[0] = 99;
      eq(f.scene.prey_state(), state, 'prey diagnostics and typed arrays are copied');
      const beforeDraw = f.scene.prey_state();
      let calls = draw();
      eq(calls.length, 12, lane + ': two prey submit every zero-alpha call');
      eq(f.scene.prey_state(), beforeDraw, 'draw does not consume prey state or corrections');
      eq(calls.map(c => c.source), [
        created[1].images[1], created[1].images[1], created[0].images[1], created[0].images[1],
        ...Array(4).fill(created[1].images[4]), ...Array(4).fill(created[0].images[4]),
      ]);
      ok(calls.every(c => c.blend === 'lighter'));
      const trace = f.target.context.trace;
      const index = source => trace.findIndex(c => c.op === 'image' && c.source === source);
      const last = source => trace.findLastIndex(c => c.op === 'image' && c.source === source);
      const bodySources = lane === 'standard' ? f.sources : f.foods;
      const snakeIndex = trace.findIndex(c => c.op === 'image' && bodySources.includes(c.source));
      ok(index(foods[0].images[0]) < index(created[1].images[1]));
      ok(last(created[0].images[1]) < snakeIndex);
      ok(trace.findLastIndex(c => c.op === 'fill') < index(foods[0].images[2]));
      ok(last(foods[0].images[2]) < index(created[1].images[4]),
        'food early < prey early < snakes/eyes < food late < prey late');
      eq(f.target.context.stack.length, 0);

      f.scene.advance(now, false).free();
      eq(f.scene.prey_state().preys.map(p => p.scale), [0, 0]);
      f.quality.set_requested_mode(0); f.quality.begin_connection();
      eq(draw().length, 12, 'prey calls survive LQ/blend-zero food suppression');
      f.quality.set_requested_mode(1); f.quality.begin_connection();
      while (now < 1280) f.scene.advance(now += 40, false).free();
      state = f.scene.prey_state();
      eq(state.preys.map(p => p.scale), [1, 1]);
      calls = draw();
      eq(calls.slice(0, 4).map(c => c.args.length), [2, 2, 2, 2]);
      eq(calls.slice(4).map(c => c.args.length), [2, 2, 8, 8, 2, 2, 8, 8],
        'full body/inner use whole-source overload; outer always uses nine arguments');
      const beforeReset = allState(), beforeTrace = f.target.context.trace.slice();
      rejects(() => f.scene.render(f.target, ...f.foods, f.background, 1, false));
      eq(allState(), beforeReset); eq(f.target.context.trace, beforeTrace);
      const beforeFailure = allState();
      f.target.context.failSource = created[1].images[4];
      rejects(render);
      eq(allState(), beforeFailure, 'late prey Canvas failure rolls back model and registries');
      eq(f.target.context.stack.length, 0);
      f.target.context.failSource = null; draw();

      const priorCalls = created.length;
      apply(bundle(capture(32, 0)));
      state = f.scene.prey_state();
      eq(state.preys[1].eater, f.scene.food_state().ownToken);
      f.scene.advance(now, false).free(); eq(f.scene.prey_state().preys[1].scale, 1);
      f.scene.apply_frame(bundle([106, ...u16(32), ...u16(10851), ...u16(10850)]), false);
      eq(f.scene.prey_state().preys[1].x, 32554);
      eq(f.scene.prey_state().preys[1].pending, 53);
      eq(created.length, priorCalls, 'motion/capture/update/draw do not request entropy');
      state = f.scene.prey_state();
      f.scene.set_connected(false); f.scene.advance(now += 8, false).free();
      ok(f.scene.prey_state().preys[1].progress > state.preys[1].progress,
        'connection gate does not freeze prey flight');

      let callbacks = 0;
      const unchanged = allState(), painted = f.target.context.trace.slice();
      rejects(() => f.scene.apply_frame_with_all_factories(
        bundle(spawn(41), [106, 0, 41]), false, face, foodFactory,
        request => { callbacks++; return preyFactory(request); }));
      eq(callbacks, 0); eq(allState(), unchanged); eq(f.target.context.trace, painted);

      f.scene.reset(); created.length = 0; foods.length = 0; f.target.context.trace = [];
      eq(ingress(bundle(syntheticSetup(), appearance(), spawn(51), syntheticSetup(),
        remove(51), syntheticSetup())), 3);
      eq(preyImages().length, 6, 'earlier Setup plan pins removed prey sources until submission ends');
      eq(f.scene.prey_state().preys.length, 0); eq(f.scene.prey_state().sourceCount, 0);

      f.scene.reset(); created.length = 0; f.target.context.trace = [];
      const prior = allState(), priorPaint = f.target.context.trace.slice();
      rejects(() => ingress(bundle(syntheticSetup(), spawn(61), syntheticSetup()), request => {
        const result = preyFactory(request);
        result.palette.bodies[0] = entry(f.target);
        result.palette.bodies[1] = entry(f.target); return result;
      }));
      eq(allState(), prior); eq(f.target.context.trace, priorPaint, 'target alias rejects before every planned clear');

      for (const [foodRevision, preyRevision] of [[0, -0], [-0, 0]]) {
        f.scene.reset(); f.target.context.trace = [];
        const shared = canvas('shared-signed-zero'), old = allState();
        rejects(() => f.scene.apply_frame_with_all_factories(
          bundle(syntheticSetup(), foodPacket, spawn(71)), false, face,
          request => ({ randomPhaseUnit: 0, randomWobbleUnit: 0, palette: {
            color: request.palette, count: 1, bodies: [entry(shared, foodRevision)],
            outlines: [entry(shared, foodRevision)], glows: [entry(shared, foodRevision)] } }),
          request => ({ randomPhaseUnit: 0, randomRateUnit: 0, palette: {
            color: request.palette, bodies: [entry(shared, preyRevision)], glows: [entry(shared, preyRevision)] } })));
        eq(allState(), old); eq(f.target.context.trace, []);
      }

      const sharedCatalog = canvas('combined-catalog-alias');
      const catalogEntry = entry(sharedCatalog, 'combined-1');
      const family = Array(4096).fill(catalogEntry);
      let foodCalls = 0, preyCalls = 0;
      const largeFood = request => {
        foodCalls++;
        return { randomPhaseUnit: 0, randomWobbleUnit: 0, palette: {
          color: request.palette, count: 4096, bodies: family, outlines: family, glows: family } };
      };
      const largePrey = request => {
        preyCalls++;
        return { randomPhaseUnit: 0, randomRateUnit: 0, palette: {
          color: request.palette, bodies: family, glows: family } };
      };
      const largeIngress = bytes => lane === 'standard' ?
        f.scene.apply_frame_and_render_standard_with_prey(bytes, false, face, largeFood, largePrey,
          f.target, ...f.foods, f.background, 960, 540, f.resolve, f.quality) :
        f.scene.apply_frame_and_render_with_food_and_prey(bytes, false, face, largeFood, largePrey,
          f.target, ...f.foods, f.background, 960, 540, false, drawFace, f.quality);
      f.scene.reset(); f.target.context.trace = [];
      eq(largeIngress(bundle(syntheticSetup(), ...Array(20).fill(foodPacket), spawn(91), spawn(92))), 1,
        '20*12288 + 2*8192 aliased entries accept the exact shared catalog ceiling');
      eq([foodCalls, preyCalls], [20, 2]);
      eq(f.scene.food_state().sourceCount, 1); eq(f.scene.prey_state().sourceCount, 1);
      f.scene.reset(); f.target.context.trace = []; foodCalls = 0; preyCalls = 0;
      const beforeCatalog = allState();
      rejects(() => largeIngress(bundle(syntheticSetup(), ...Array(21).fill(foodPacket), spawn(93))),
        /catalog budget exceeded/);
      eq([foodCalls, preyCalls], [21, 1]);
      eq(allState(), beforeCatalog);
      eq(f.target.context.trace, [], 'combined catalog rejection precedes the first Setup clear');

      if (lane === 'standard') {
        f.scene.reset(); f.snapshot.revision = 0;
        f.scene.apply_frame_with_all_factories(bundle(syntheticSetup(), appearance(), spawn(81)), false,
          face, foodFactory, request => ({ randomPhaseUnit: 0, randomRateUnit: 0, palette: {
            color: request.palette, bodies: [entry(f.sources[0], -0)], glows: [entry(f.sources[0], -0)] } }));
        const old = allState(); f.target.context.trace = [];
        rejects(render); eq(allState(), old); eq(f.target.context.trace, [],
          'body/prey revision conflict rejects before Canvas reset');
      }
    } finally { f.close(); }
  }
}
