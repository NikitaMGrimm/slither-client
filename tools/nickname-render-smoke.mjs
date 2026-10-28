import { bundle, syntheticScene, syntheticSetup } from '../web/synthetic-scene.mjs';

// Authored synthetic packets and Canvas recorder observations through real Wasm.
// No original runtime, artwork, browser, raster oracle or network is used.
export function nicknameRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok, rejects }) {
  const names = f => f.target.context.trace.filter(call => call.op === 'text');
  const face = () => ({ eyes: vanillaEyes(), decoration: { kind: 'none' } });
  const tagged = () => ({ face: { kind: 'paired', eyes: vanillaEyes(), decoration: null }, antenna: null });
  const random = () => new Float64Array();
  const basicFace = () => ({ revision: 'synthetic-1', eyes: vanillaEyes(), decoration: null });
  const paint = f => f.target.context.trace.filter(c => ['image', 'fill', 'stroke', 'fillRect'].includes(c.op))
    .map(({ source, alphaWrites, ...call }) => ({ ...call, ...(source ? { source: source.name } : {}) }));
  const render = (f, lane, width = f.target.width, height = f.target.height) => {
    f.target.context.trace = [];
    if (lane === 'basic') f.scene.render(f.target, ...f.foods, f.background, 1, false);
    else if (lane === 'standard') f.render();
    else if (lane === 'antenna') f.scene.render_standard_with_antenna_at_size(
      f.target, ...f.foods, f.background, width, height, f.resolve, random, f.quality);
    else if (lane === 'default') f.scene.render_standard_with_face_presentation_at_size(
      f.target, ...f.foods, f.background, width, height, f.resolve, random, f.quality);
    else f.scene.render_standard_with_accessory_presentation_at_size(
      f.target, ...f.foods, f.background, width, height, f.resolve, random, f.quality);
    return names(f);
  };
  const checkName = (f, call, metric, opacity = 1, color = '#eeeeee') => {
    const camera = JSON.parse(f.scene.snapshot()).camera;
    eq(call.x, f.target.width / 2 + (metric.correctedX - camera.absoluteX) * camera.zoom);
    eq(call.y, f.target.height / 2 + (metric.correctedY - camera.absoluteY) * camera.zoom + 32 + 11 * metric.scale * camera.zoom);
    eq(call.alpha, 0.5 * opacity * metric.spawnProgress * (1 - metric.deathProgress));
    eq(call.font, '15px Arial, Helvetica Neue, Helvetica, sans-serif');
    eq([call.textAlign, call.textBaseline, call.fillStyle, call.blend], ['center', 'middle', color, 'source-over']);
    eq(call.transforms, [['setTransform', 1, 0, 0, 1, 0, 0]]);
  };
  // Authored synthetic bases and units: [132,182,255], [230,140,128] and [128,128,128].
  const setupTints = [{ baseRgb: [8, 99, 250], randomUnits: [0, 0.5, 1 - 2 ** -53] },
    { baseRgb: [200, 10, 0], randomUnits: [0.25, 0.75, 0.0625] }, { baseRgb: [0, 0, 0], randomUnits: [0, 0, 0] }];
  const renamed = (id, text) => {
    const raw = appearance(), bytes = Array.from(text, c => c.charCodeAt(0));
    const packet = Uint8Array.from([...raw.slice(0, 22), bytes.length, ...bytes, ...raw.slice(23 + raw[22])]);
    packet.set([id >>> 8 & 255, id & 255], 1);
    return packet;
  };

  for (const lane of ['basic', 'standard', 'default', 'accessory']) {
    const legacy = fixture(), f = fixture({ nicknames: true });
    try {
      render(legacy, lane);
      const calls = render(f, lane);
      eq(names(legacy).length, 0, 'legacy public rendering remains unchanged until selected');
      eq(calls.map(c => c.text), ['Synthetic 0', 'Synthetic 7', 'Synthetic 8']);
      const metrics = JSON.parse(f.scene.drawn_snakes()).map(row => row.snake);
      calls.forEach((call, i) => checkName(f, call, metrics[i]));
      eq(paint(f), paint(legacy), 'names preserve all body/food/eye/edge placements and paint state');
      eq(f.state(), legacy.state(), 'names do not change existing numeric diagnostics');
      const trace = f.target.context.trace, lastName = trace.lastIndexOf(calls.at(-1));
      const firstBody = trace.findIndex(c => c.op === 'image' && (lane === 'basic'
        ? f.foods.includes(c.source) && c.transforms.some(t => t[0] === 'setTransform' && t[5] === 480 && t[6] === 270)
        : f.sources.includes(c.source)));
      ok(firstBody > lastName, 'the complete name pass precedes every body');
      eq(f.target.context.stack.length, 0, 'name scope restores the caller transform and paint state');
    } finally { f.close(); legacy.close(); }
  }

  const f = fixture({ nicknames: true });
  try {
    for (let count = 1; count <= 200; count++) render(f, 'basic');
    const metrics = JSON.parse(f.scene.drawn_snakes()).map(row => row.snake);
    checkName(f, names(f)[0], metrics[0]);
    // Camera motion culls the names and pauses the fade without any update clock.
    f.scene.set_follows(false); f.scene.set_camera_position(40000, 40000);
    for (let count = 0; count < 5; count++) eq(render(f, 'basic').length, 0);
    f.scene.set_follows(true);
    render(f, 'basic').forEach((call, i) => checkName(f, call, metrics[i], i === 0 ? 0.996 : 1));
    f.scene.apply_frame(bundle([115, 0, 0, 1], renamed(0, 'Synthetic replacement')), false);
    f.scene.advance(80, false).free();
    const calls = render(f, 'standard'), rows = JSON.parse(f.scene.drawn_snakes());
    eq(calls.map(c => c.text), ['Synthetic 0', 'Synthetic 7', 'Synthetic 8', 'Synthetic replacement']);
    checkName(f, calls[0], rows[0].snake, 0.992);
    checkName(f, calls[3], rows[3].snake);
    eq(rows.map(row => row.own), [true, false, false, false], 'reused ID never inherits own fade');
  } finally { f.close(); }

  for (const lane of ['basic', 'standard', 'default', 'accessory']) {
    const f = fixture({ nicknames: true });
    try {
      f.scene.reset();
      const shape = lane === 'default' ? tagged : lane === 'accessory'
        ? () => ({ ...tagged(), accessory: null }) : face;
      let resolved = 0;
      // Synthetic tints in appearance order: own, old 7 and reused 7.
      const selected = () => ({ ...shape(), nicknameTint: setupTints[resolved++] });
      const unused = () => { throw Error('No synthetic food/prey/random callback expected'); };
      const args = [bundle(syntheticSetup(), renamed(0, 'Synthetic own'), renamed(7, 'Synthetic old'), syntheticSetup(),
        [115, 0, 7, 0], renamed(7, 'Synthetic new'), syntheticSetup()), false, selected, unused,
        f.target, ...f.foods, f.background, 960, 540];
      f.target.context.trace = [];
      if (lane === 'basic') args.push(false, basicFace, f.quality);
      else if (lane === 'standard') args.push(f.resolve, f.quality);
      else args.push(f.resolve, random, f.quality);
      const method = { basic: 'apply_frame_and_render_with_food', standard: 'apply_frame_and_render_standard',
        default: 'apply_frame_and_render_standard_with_face_presentation',
        accessory: 'apply_frame_and_render_standard_with_accessory_presentation' }[lane];
      eq(f.scene[method](...args), 3);
      eq(names(f).map(c => c.text), ['Synthetic own', 'Synthetic old', 'Synthetic own', 'Synthetic new'],
        'each Setup freezes its event-time appearance text');
      eq(names(f).map(c => c.fillStyle), ['#84b6ff', '#e68c80', '#84b6ff', '#808080'],
        'each Setup freezes its event-time appearance tint');
      eq(resolved, 3);
      ok(names(f).every(c => c.alpha === 0), 'initial zero-spawn names still submit');
      const quality = f.quality.snapshot();
      f.scene.advance(80, false).free();
      const resize = (width, height) => {
        f.target.context.trace = [];
        if (lane === 'basic') f.scene.render_with_food_at_size(f.target, ...f.foods, f.background,
          width, height, false, basicFace, f.quality);
        else if (lane === 'standard') f.scene.render_standard_at_size(f.target, ...f.foods, f.background,
          width, height, f.resolve, f.quality);
        else render(f, lane, width, height);
        return names(f);
      };
      eq(resize(960, 540).map(c => [c.text, c.fillStyle]), [['Synthetic own', '#84b6ff'], ['Synthetic new', '#808080']],
        'unchanged-size resize draws once with retained tints');
      eq(resize(801, 603).map(c => [c.text, c.fillStyle]), [['Synthetic own', '#84b6ff'], ['Synthetic new', '#808080']],
        'changed-size resize draws once with retained tints');
      const metric = JSON.parse(f.scene.drawn_snakes())[0].snake;
      checkName(f, names(f)[0], metric, 1, '#84b6ff');
      for (let count = 5; count <= 200; count++) resize(801, 603);
      checkName(f, names(f)[0], metric, 1, '#84b6ff');
      resize(801, 603);
      checkName(f, names(f)[0], metric, 0.996, '#84b6ff');
      eq(resolved, 3, 'draws and resizes never resolve appearance tint again');
      eq(f.quality.snapshot(), quality, 'Setup/resize names add no update or quality step');
      eq(f.target.context.stack.length, 0);
    } finally { f.close(); }
  }

  // Retained food/prey early and late passes must survive the temporary text scope.
  for (const lane of ['basic', 'standard']) {
    const legacy = fixture(), f = fixture({ nicknames: true });
    const populate = target => {
      target.scene.reset();
      const entry = source => ({ asset: { source, kind: 'canvas', status: 'ready', revision: 'nickname-entities-1',
        width: source.width, height: source.height }, width: source.width, height: source.height,
      halfWidth: source.width / 2, halfHeight: source.height / 2 });
      const images = label => Array.from({ length: 5 }, (_, i) => entry(new target.foods[0].constructor(`${label}-${i}`)));
      const food = request => { const sources = images('named-food'); return { randomPhaseUnit: 0, randomWobbleUnit: 0,
        palette: { color: request.palette, count: 1, bodies: [sources[0]], outlines: [sources[1]], glows: [sources[2]] } }; };
      const prey = request => { const sources = images('named-prey'); return { randomPhaseUnit: 0.25, randomRateUnit: 0.5,
        palette: { color: request.palette, bodies: sources.slice(0, 2), glows: sources.slice(2) } }; };
      const u24 = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
      target.scene.apply_frame_with_all_factories(bundle(syntheticSetup(), appearance(), [70, 108, 108, 0, 128, 128, 20],
        [121, 0, 31, 9, ...u24(32580 * 5), ...u24(32550 * 5), 20, 48, 0, 0, 0, 0, 0, 0, 3, 232]), false, face, food, prey);
      target.scene.advance(80, false).free();
      target.target.context.trace = [];
      if (lane === 'standard') target.render();
      else target.scene.render_with_food(target.target, ...target.foods, target.background, false, basicFace, target.quality);
    };
    try {
      populate(legacy); populate(f);
      eq(names(f).length, 1);
      eq(paint(f), paint(legacy), 'retained food/prey/body commands keep exact transforms, alpha and blend');
      const trace = f.target.context.trace, nameIndex = trace.indexOf(names(f)[0]);
      for (const family of ['named-food', 'named-prey']) {
        ok(trace.slice(0, nameIndex).some(c => c.source?.name.startsWith(family)), `${family} early pass precedes names`);
        ok(trace.slice(nameIndex + 1).some(c => c.source?.name.startsWith(family)), `${family} late pass follows names and bodies`);
      }
      eq(f.target.context.stack.length, 0);
    } finally { f.close(); legacy.close(); }
  }
  // Ordinary resolver families retain one tint per appearance for every matching renderer.
  const ordinary = [['apply_frame_with_appearance', () => ({ face: face(), antenna: null }), 'antenna'],
    ['apply_frame_with_face_presentation', tagged, 'default'],
    ['apply_frame_with_accessory_presentation', () => ({ ...tagged(), accessory: null }), 'accessory']];
  for (const [method, shape, lane] of ordinary) {
    const f = fixture({ nicknames: true });
    try {
      f.scene.reset();
      let resolved = 0;
      const tints = { 0: setupTints[0], 7: setupTints[1] };
      f.scene[method](syntheticScene(), false, request => {
        resolved++;
        return request.id in tints ? { ...shape(), nicknameTint: tints[request.id] } : shape();
      });
      eq(resolved, 3);
      f.scene.advance(40, false).free();
      const expected = [['Synthetic 0', '#84b6ff'], ['Synthetic 7', '#e68c80'], ['Synthetic 8', '#eeeeee']];
      for (let count = 0; count < 3; count++) {
        eq(render(f, lane).map(c => [c.text, c.fillStyle]), expected, `${method} retains tinted text color`);
      }
      eq(resolved, 3, 'rendering never resolves appearance tint again');
      // Invalid explicit tint metadata rejects the whole frame and keeps prior names.
      const before = f.state();
      const invalid = [null, 7, {}, { baseRgb: [1, 2, 3] }, { baseRgb: [1, 2], randomUnits: [0, 0, 0] },
        { baseRgb: [1, 2, 256], randomUnits: [0, 0, 0] }, { baseRgb: [1, 2, 3.5], randomUnits: [0, 0, 0] },
        { baseRgb: [1, 2, 3], randomUnits: [0, 0] }, { baseRgb: [1, 2, 3], randomUnits: [0, '0.5', 0] },
        { baseRgb: [1, 2, 3], randomUnits: [0, 1, 0] }, { baseRgb: [1, 2, 3], randomUnits: [-1e-300, 0, 0] },
        { baseRgb: [1, 2, 3], randomUnits: [0, 0, NaN] }, { baseRgb: [1, 2, 3], randomUnits: [0, 0, Infinity] }];
      for (const nicknameTint of invalid) {
        rejects(() => f.scene[method](bundle(renamed(9, 'Synthetic rejected')), false,
          () => ({ ...shape(), nicknameTint })));
        eq(f.state(), before, 'invalid tint rolls back every retained channel');
      }
      let getters = 0;
      const accessor = { baseRgb: [1, 2, 3] };
      Object.defineProperty(accessor, 'randomUnits', { enumerable: true, get() { getters++; return [0, 0, 0]; } });
      rejects(() => f.scene[method](bundle(renamed(9, 'Synthetic rejected')), false,
        () => ({ ...shape(), nicknameTint: accessor })), /accessor/);
      eq(getters, 0);
      eq(render(f, lane).map(c => [c.text, c.fillStyle]), expected, 'rejected frames leave retained names unchanged');
    } finally { f.close(); }
  }
}
