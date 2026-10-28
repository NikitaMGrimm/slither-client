import { bundle, syntheticScene, syntheticSetup } from '../web/synthetic-scene.mjs';

// Authored synthetic packets and Canvas recorder observations through real Wasm.
// No original runtime, artwork, browser, raster oracle or network is used.
export function nicknameRenderSmoke(wasm, { fixture, appearance, vanillaEyes, eq, ok }) {
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
    else if (lane === 'default') f.scene.render_standard_with_face_presentation_at_size(
      f.target, ...f.foods, f.background, width, height, f.resolve, random, f.quality);
    else f.scene.render_standard_with_accessory_presentation_at_size(
      f.target, ...f.foods, f.background, width, height, f.resolve, random, f.quality);
    return names(f);
  };
  const checkName = (f, call, metric, opacity = 1) => {
    const camera = JSON.parse(f.scene.snapshot()).camera;
    eq(call.x, f.target.width / 2 + (metric.correctedX - camera.absoluteX) * camera.zoom);
    eq(call.y, f.target.height / 2 + (metric.correctedY - camera.absoluteY) * camera.zoom + 32 + 11 * metric.scale * camera.zoom);
    eq(call.alpha, 0.5 * opacity * metric.spawnProgress * (1 - metric.deathProgress));
    eq(call.font, '15px Arial, Helvetica Neue, Helvetica, sans-serif');
    eq([call.textAlign, call.textBaseline, call.fillStyle, call.blend], ['center', 'middle', '#eeeeee', 'source-over']);
    eq(call.transforms, [['setTransform', 1, 0, 0, 1, 0, 0]]);
  };
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
      const selected = lane === 'default' ? tagged : lane === 'accessory'
        ? () => ({ ...tagged(), accessory: null }) : face;
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
      eq(resize(960, 540).map(c => c.text), ['Synthetic own', 'Synthetic new'], 'unchanged-size resize draws once');
      eq(resize(801, 603).map(c => c.text), ['Synthetic own', 'Synthetic new'], 'changed-size resize draws once');
      const metric = JSON.parse(f.scene.drawn_snakes())[0].snake;
      checkName(f, names(f)[0], metric);
      for (let count = 5; count <= 200; count++) resize(801, 603);
      checkName(f, names(f)[0], metric);
      resize(801, 603);
      checkName(f, names(f)[0], metric, 0.996);
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
}
