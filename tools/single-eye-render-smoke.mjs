import { bundle, syntheticScene, syntheticSetup } from '../web/synthetic-scene.mjs';

// Original synthetic geometry, crops and sources. This records real Wasm calls;
// it does not rasterize or use original artwork or observed runtime outputs.
export function singleEyeRenderSmoke(wasm, { fixture, appearance: appearancePacket, eq, ok, rejects }) {
  const geometry = () => ({ baseSize: 20, pupilSize: 8, pupilTravel: 3 });
  const appearance = () => ({ face: { kind: 'single-image', geometry: geometry() }, antenna: null });
  const random = () => { throw new Error('single-image-only scene must not request randomness'); };
  function make(travel = 3) {
    const f = fixture();
    const Canvas = f.faceSource.constructor;
    f.eyeBase = new Canvas('single-eye-base'); f.eyeBase.width = 40; f.eyeBase.height = 36;
    f.eyePupil = new Canvas('single-eye-pupil'); f.eyePupil.width = 24; f.eyePupil.height = 20;
    const base = f.catalog.length;
    f.catalog.push({ source: f.eyeBase, state: 'ready' }, { source: f.eyePupil, state: 'ready' });
    f.metadata.eyes = { kind: 'single-image', geometry: { ...geometry(), pupilTravel: travel },
      baseImage: { asset: base, sourceRect: [2, 3, 31, 27] }, pupilImage: { asset: base + 1 } };
    f.scene.reset();
    f.scene.apply_frame_with_face_presentation(syntheticScene(), false, () => ({
      face: { kind: 'single-image', geometry: { ...geometry(), pupilTravel: travel } }, antenna: null,
    }));
    f.scene.set_follows(false); f.scene.set_camera_position(32541.375, 32547.125); f.scene.set_zoom(0.7125);
    f.scene.set_gaze_heading(0.9); f.scene.advance(44, false).free();
    f.target.context.trace = [];
    f.basic = request => {
      const result = f.resolve(request);
      return { revision: result.revision, face: { kind: 'single-image', eyes: result.recipe.eyes }, antenna: null };
    };
    f.draw = (lane, atSize = false) => {
      const args = [f.target, ...f.foods, f.background];
      if (atSize) args.push(961, 541);
      if (lane === 'basic') args.push(false, f.basic, random, f.quality);
      else args.push(f.resolve, random, f.quality);
      f.scene[`render_${lane === 'standard' ? 'standard_' : ''}with_face_presentation${atSize ? '_at_size' : ''}`](...args);
    };
    return f;
  }
  const images = f => f.target.context.trace.filter(call => call.op === 'image'
    && (call.source === f.eyeBase || call.source === f.eyePupil));
  function exact(f) {
    const rows = JSON.parse(f.scene.drawn_snakes());
    const camera = JSON.parse(f.scene.snapshot()).camera;
    const calls = images(f);
    eq(calls.length, rows.length * 2, 'two images for each visible selected face');
    eq(f.target.context.trace.filter(call => call.op === 'arc').length, 0, 'no paired circles or outlines');
    for (let i = 0; i < rows.length; i++) {
      const m = rows[i].snake, g = geometry(), s = m.scale, z = camera.zoom, h = m.eyes.heading;
      const forward = 3 * s, c = Math.cos(h), t = Math.sin(h);
      const destinations = [
        [c * forward, t * forward, s * g.baseSize],
        [c * (forward + 0.15) + m.eyes.pupilX * s,
          t * (forward + 0.15) + m.eyes.pupilY * s, s * g.pupilSize],
      ].map(([x, y, size]) => [f.target.width / 2 + (((x + m.correctedX) - size / 2) - camera.absoluteX) * z,
        f.target.height / 2 + (((y + m.correctedY) - size / 2) - camera.absoluteY) * z, size * z, size * z]);
      const alpha = m.deathProgress === 0 ? 1 : Math.sqrt(1 - m.deathProgress);
      for (let j = 0; j < 2; j++) {
        const call = calls[2 * i + j];
        eq(call.source, j === 0 ? f.eyeBase : f.eyePupil, 'base precedes pupil');
        eq(call.args, [...(j === 0 ? [2, 3, 31, 27] : [0, 0, 24, 20]), ...destinations[j]], 'explicit crop overload and unfactored geometry');
        eq(call.transforms, [['setTransform', 1, 0, 0, 1, 0, 0]], 'image face uses identity screen coordinates');
        eq([call.alpha, call.blend], [alpha, 'source-over']);
      }
    }
    eq(f.target.context.stack.length, 0, 'complete frame scopes restore');
    return calls.map(call => ({ source: call.source.name, args: call.args, alpha: call.alpha, blend: call.blend }));
  }
  for (const lane of ['basic', 'standard']) {
    const f = make();
    try {
      f.draw(lane); exact(f);
      const before = f.state(), trace = f.target.context.trace.slice();
      rejects(() => f.render(), 'legacy standard rendering cannot silently replace required image eyes');
      eq(f.state(), before); eq(f.target.context.trace, trace);
      rejects(() => f.scene.eye_layouts(960, 540), 'paired-only diagnostics reject the active image family');
      eq(f.state(), before, 'diagnostics advance no clock');
      f.scene.apply_frame(Uint8Array.of(115, 0, 0, 1), false);
      f.scene.advance(84, false).free(); f.target.context.trace = [];
      f.draw(lane); exact(f);
      const dying = JSON.parse(f.scene.drawn_snakes()).find(row => row.snake.id === 0).snake;
      ok(dying.deathProgress > 0 && dying.deathProgress < 1, 'production death-alpha witness is nonsaturated');
      f.target.context.trace = []; f.draw(lane, true); exact(f);
      eq([f.target.width, f.target.height], [961, 541]);
      const stable = f.state(); const savedTrace = f.target.context.trace.slice();
      f.catalog[f.catalog.length - 1].state = 'pending';
      rejects(() => f.draw(lane), 'second image readiness is validated before reset');
      eq(f.state(), stable); eq(f.target.context.trace, savedTrace);
      f.catalog[f.catalog.length - 1].state = 'ready';
      f.metadata.eyes.geometry.pupilTravel = -0;
      rejects(() => f.draw(lane), 'draw geometry must match retained geometry bit for bit');
      eq(f.state(), stable); eq(f.target.context.trace, savedTrace);
      f.metadata.eyes.geometry = geometry();
      f.target.context.failSource = f.eyePupil;
      rejects(() => f.draw(lane), 'second native image failure rejects the disposable stage');
      eq(f.state(), stable); eq(f.target.context.stack.length, 0);
      f.target.context.failSource = null; f.target.context.trace = [];
      f.draw(lane); exact(f);
      const numeric = f.state();
      f.scene.prepare_draw_with_face_presentation(961, 541, 1, false, random);
      ok(f.scene.snapshot() !== '', 'numeric preparation is available without rasterization');
      ok(numeric.length > 0);
      rejects(() => f.scene.apply_frame_with_face_presentation(bundle(syntheticSetup(), [115, 0]), false, appearance));
    } finally { f.close(); }
  }
  const basic = make(), standard = make();
  try {
    basic.draw('basic'); standard.draw('standard');
    eq(exact(basic), exact(standard), 'both production lanes submit identical selected face geometry');
    eq(basic.scene.snapshot(), standard.scene.snapshot(), 'both lanes prepare the same model once');
  } finally { basic.close(); standard.close(); }
  for (const lane of ['basic', 'standard']) {
    const f = make(0);
    try {
      const state = f.state(), trace = f.target.context.trace.slice();
      f.metadata.eyes.geometry.pupilTravel = -0;
      rejects(() => f.draw(lane), 'positive and negative zero travel are distinct retained configurations');
      eq(f.state(), state); eq(f.target.context.trace, trace);
      f.metadata.eyes.geometry.pupilTravel = 0;
      f.draw(lane); exact(f);
    } finally { f.close(); }
  }
  for (const lane of ['basic', 'standard']) {
    const f = make();
    try {
      const unused = () => { throw new Error('empty factory fixture must not resolve entities'); };
      f.scene.reset();
      f.scene.apply_frame_with_face_presentation_and_all_factories(syntheticSetup(), false, appearance, unused, unused);
      f.scene.apply_frame_with_face_presentation(appearancePacket(), false, appearance);
      f.target.context.trace = [];
      const args = [bundle(syntheticSetup(), [115, 0, 0, 0], syntheticSetup()), false,
        appearance, unused, unused, f.target, ...f.foods, f.background, 960, 540];
      if (lane === 'basic') args.push(false, f.basic, random, f.quality);
      else args.push(f.resolve, random, f.quality);
      const count = f.scene[`apply_frame_and_render_${lane === 'standard' ? 'standard_' : ''}with_face_presentation_and_prey`](...args);
      eq(count, 2, 'ordered Setup draws keep their actual count');
      eq(images(f).length, 2, 'earlier plan retains both sources after later appearance removal');
      eq(f.target.context.stack.length, 0);
    } finally { f.close(); }
  }
}
