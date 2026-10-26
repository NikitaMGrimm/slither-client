import assert from 'node:assert/strict';
import { bundle, syntheticScene, syntheticSetup, syntheticStep } from '../web/synthetic-scene.mjs';

// Original synthetic packet/update/draw cases; no reference or server connection.
export function animatedSmoke(wasm) {
  function ownAppearance(custom = [], cosmetic = 0, skin = 0) {
    const packed = wasm.decode_frame(syntheticScene(), false);
    const bytes = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    let offset = 4 + bytes.getUint32(0);
    const length = bytes.getUint32(offset); offset += 4;
    const raw = Array.from(packed.slice(offset, offset + length));
    raw[15] = skin;
    raw.splice(23 + raw[22], 2, custom.length, ...custom, cosmetic);
    return Uint8Array.from(raw);
  }
  const target = value => [122, value >>> 16 & 255, value >>> 8 & 255, value & 255];
  const setup = value => {
    const bytes = syntheticSetup(); bytes.set(target(value).slice(1), bytes.length - 3); return bytes;
  };
  const clockStep = (scene, now, lagging = false) => {
    const step = scene.advance(now, lagging);
    try {
      return Object.fromEntries(['delta', 'unlagged_delta', 'whole_steps', 'double_steps',
        'lag_multiplier', 'accumulated', 'doubled_accumulated'].map(key => [key, step[key]]));
    } finally { step.free(); }
  };
  const standardEyes = () => ({ kind: 'standard', distance: 6, separation: 6, radius: 6,
    pupilRadius: 3.5, pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0,
    outlineColor: 0, eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 });
  const coupledEyes = new wasm.AnimatedScene(0);
  const pairedFace = new wasm.AnimatedScene(0);
  try {
    const geometry = { forward: 11.375, lateral: 3.125, lateralBias: 0.375, rotationOffset: 0.287,
      imageScale: 0.3125, pivotX: -0, pivotY: -7.5, width: 47, height: 31 };
    const face = { eyes: { ...standardEyes(), pupilTravel: 0.02 },
      decoration: { kind: 'paired-side-images', geometry } };
    let count = 0;
    const short = ownAppearance().slice(0, -22);
    pairedFace.apply_frame_with_face_geometry(bundle(syntheticSetup(), short, [115, 0, 0, 0],
      ownAppearance(), syntheticSetup(), short), false, request => {
      assert.equal(Object.getPrototypeOf(request), Object.prototype); count++; return face;
    });
    assert.equal(count, 3, 'face callback resolves each appearance once, including removal and bundled setup');
    face.eyes.pupilTravel = 200; geometry.forward = 400;
    pairedFace.advance(4, false).free();
    assert.equal(JSON.parse(pairedFace.snapshot()).own.eyes.pupilX, 0.02);
    const before = [pairedFace.snapshot(), pairedFace.drawn_snakes(), pairedFace.camera_samples()];
    const valid = { eyes: standardEyes(), decoration: { kind: 'none' } };
    for (const key of ['eyes', 'decoration']) {
      for (const accessor of [true, false]) {
        const value = { ...valid }; delete value[key];
        if (accessor) Object.defineProperty(value, key, { get() { throw new Error('getter must not run'); } });
        else Object.setPrototypeOf(value, { [key]: valid[key] });
        assert.throws(() => pairedFace.apply_frame_with_face_geometry(bundle(ownAppearance()), false, () => value));
        assert.deepEqual([pairedFace.snapshot(), pairedFace.drawn_snakes(), pairedFace.camera_samples()], before);
      }
    }
    const promised = Object.assign(Promise.resolve(), valid);
    assert.throws(() => pairedFace.apply_frame_with_face_geometry(bundle(ownAppearance()), false, () => promised));
  } finally { pairedFace.free(); }
  try {
    const requests = [];
    const metadata = [0.02, 0.04].map(pupilTravel => ({ ...standardEyes(), pupilTravel }));
    coupledEyes.apply_frame_with_eye_geometry(bundle(syntheticSetup(),
      ownAppearance([1, 4], 29, 17), ownAppearance([2, 8], 31, 23)), false, request => {
      assert.equal(Object.getPrototypeOf(request), Object.prototype);
      assert.equal(request.customBytes instanceof Uint8Array, true);
      requests.push(request);
      return metadata[requests.length - 1];
    });
    assert.deepEqual(requests.map(r => ({ ...r, customBytes: [...r.customBytes] })), [
      { skin: 17, id: 0, cosmetic: 29, x: 32550, y: 32550, customBytes: [1, 4] },
      { skin: 23, id: 0, cosmetic: 31, x: 32550, y: 32550, customBytes: [2, 8] },
    ]);
    assert.notEqual(requests[0], requests[1]);
    assert.notEqual(requests[0].customBytes, requests[1].customBytes);
    requests[0].customBytes.fill(99);
    metadata[0].pupilTravel = 100;
    metadata[1].pupilTravel = 200;
    coupledEyes.advance(4, false).free();
    assert.deepEqual(JSON.parse(coupledEyes.drawn_snakes()).map(r => r.snake.eyes.pupilX), [0.02, 0.04]);
    coupledEyes.apply_frame_with_eye_geometry(bundle([115, 0, 0, 1], ownAppearance()), false,
      () => ({ ...standardEyes(), pupilTravel: 0.06 }));
    coupledEyes.advance(8, false).free();
    assert.deepEqual(JSON.parse(coupledEyes.drawn_snakes()).map(r => r.snake.eyes.pupilX), [0.02, 0.04, 0.06]);
    assert.equal(JSON.parse(coupledEyes.snapshot()).own.alive, false);
    coupledEyes.reset();
    let count = 0;
    const short = ownAppearance().slice(0, -22);
    coupledEyes.apply_frame_with_eye_geometry(bundle(syntheticSetup(), short,
      [115, 0, 0, 0], ownAppearance(), syntheticSetup(), short), false, () => {
      count++; return standardEyes();
    });
    assert.equal(count, 3, 'resolve short, immediately removed and mid-frame-reset appearances');
  } finally { coupledEyes.free(); }

  const validation = new wasm.AnimatedScene(0);
  try {
    validation.apply_frame(syntheticScene(), false);
    validation.advance(4, false).free(); validation.prepare_draw(960, 540);
    const state = () => [validation.snapshot(), validation.drawn_snakes(),
      validation.camera_samples(), validation.own_body_samples(), validation.drawn_eyes(960, 540)];
    const before = state();
    const two = bundle(ownAppearance(), ownAppearance());
    for (const thrown of [new Error('synthetic eye resolver'), { marker: 23 }, Symbol('eyes'), null, undefined]) {
      let calls = 0, caught = false;
      try {
        validation.apply_frame_with_eye_geometry(two, false, () => {
          if (++calls === 2) throw thrown;
          return { ...standardEyes(), pupilTravel: 0.02 };
        });
      } catch (e) { caught = true; assert.equal(e, thrown, 'callback exception identity'); }
      assert.equal(caught, true); assert.equal(calls, 2); assert.deepEqual(state(), before);
    }
    let calls = 0;
    for (const frame of [bundle(ownAppearance(), [114, 0]),
      Uint8Array.from([...two, 0, 9, 115])]) {
      assert.throws(() => validation.apply_frame_with_eye_geometry(frame, false, () => {
        calls++; return standardEyes();
      }));
      assert.equal(calls, 0); assert.deepEqual(state(), before);
    }
    const numericSetup = syntheticSetup(); numericSetup[10] = 0;
    let numericCalls = 0;
    assert.throws(() => validation.apply_frame_with_eye_geometry(
      bundle(ownAppearance(), numericSetup, ownAppearance()), false, () => {
        numericCalls++; return standardEyes();
      }));
    assert.equal(numericCalls, 2, 'later presentation failure cannot undo resolver side effects');
    assert.deepEqual(state(), before);
    const bad = [null, undefined, Promise.resolve(standardEyes()),
      Object.assign(Promise.resolve(), standardEyes()), { kind: 'none' },
      { ...standardEyes(), kind: 'special' }, { ...standardEyes(), angleSmoothing: 0.1 },
      { ...standardEyes(), outlineColor: 1 }];
    let getters = 0;
    for (const [key, value] of Object.entries(standardEyes())) {
      const missing = standardEyes(); delete missing[key]; bad.push(missing);
      const inherited = Object.assign(Object.create({ [key]: value }), missing); bad.push(inherited);
      const accessor = standardEyes();
      Object.defineProperty(accessor, key, { get() { getters++; return value; } }); bad.push(accessor);
      if (key !== 'kind') {
        for (const invalid of [NaN, Infinity, -1, String(value), null, true]) {
          bad.push({ ...standardEyes(), [key]: invalid });
        }
      }
    }
    for (const key of ['distance', 'separation', 'radius', 'pupilRadius', 'pupilTravel', 'outlineWidth']) {
      bad.push({ ...standardEyes(), [key]: 4096.01 });
    }
    for (const key of ['eyeColor', 'pupilColor', 'outlineColor']) {
      bad.push({ ...standardEyes(), [key]: 0.5 }, { ...standardEyes(), [key]: 0x1000000 });
    }
    for (const key of ['eyeOpacity', 'pupilOpacity', 'angleSmoothing']) bad.push({ ...standardEyes(), [key]: 1.01 });
    for (const metadata of bad) {
      let count = 0;
      assert.throws(() => validation.apply_frame_with_eye_geometry(two, false, () =>
        ++count === 1 ? standardEyes() : metadata));
      assert.equal(count, 2); assert.deepEqual(state(), before);
    }
    assert.equal(getters, 0, 'metadata accessors must never execute');
    for (const callback of [null, {}, 12]) {
      assert.throws(() => validation.apply_frame_with_eye_geometry(ownAppearance(), false, callback));
      assert.deepEqual(state(), before);
    }
  } finally { validation.free(); }

  const legacy = new wasm.AnimatedScene(0), explicit = new wasm.AnimatedScene(0);
  try {
    for (const [now, frame] of [[4, syntheticScene()], [12, syntheticStep(1)],
      [52, bundle([115, 0, 0, 1], ownAppearance())]]) {
      legacy.apply_frame(frame, false);
      explicit.apply_frame_with_eye_geometry(frame, false, standardEyes);
      for (const scene of [legacy, explicit]) { scene.advance(now, false).free(); scene.prepare_draw(960, 540); }
      assert.equal(legacy.snapshot(), explicit.snapshot());
      assert.equal(legacy.drawn_snakes(), explicit.drawn_snakes());
      assert.deepEqual(legacy.drawn_eyes(960, 540), explicit.drawn_eyes(960, 540));
      assert.deepEqual(legacy.own_curve(1, false), explicit.own_curve(1, false));
    }
  } finally { legacy.free(); explicit.free(); }
  const bounds = new wasm.AnimatedScene(0);
  try {
    const maximum = { ...standardEyes(), distance: 4096, separation: 4096, radius: 4096,
      pupilRadius: 4096, pupilTravel: 4096, outlineWidth: 4096 };
    bounds.apply_frame_with_eye_geometry(bundle(syntheticSetup(), ownAppearance()), false, () => maximum);
    bounds.advance(4, false).free();
    assert.equal(JSON.parse(bounds.snapshot()).own.eyes.pupilX, 1 / 12);
  } finally { bounds.free(); }
  assert.equal(wasm.AnimatedScene.prototype.reset.length, 0, 'generated reset API is parameterless');
  const phase = new wasm.AnimatedScene(1000);
  try {
    phase.apply_frame(bundle(setup(1200), ownAppearance(), target(600)), false);
    assert.equal(clockStep(phase, 1003).accumulated, 0.375);
    const ring = phase.boundary_samples();
    phase.reset();
    const cleared = JSON.parse(phase.snapshot());
    assert.equal(cleared.protocol, null);
    assert.equal(cleared.retainedSnakes, 0);
    assert.equal(cleared.own, null);
    assert.equal(cleared.boundary.connected, false);
    assert.deepEqual(phase.boundary_samples(), ring, 'reset consumes no retained radius samples');
    phase.apply_frame(bundle(setup(1300), target(700)), false);
    assert.deepEqual(clockStep(phase, 1008), { delta: 0.625, unlagged_delta: 0.625,
      whole_steps: 1, double_steps: 2, lag_multiplier: 1, accumulated: 1, doubled_accumulated: 2 });
    assert.deepEqual(JSON.parse(phase.snapshot()).boundary,
      { displayed: 1300, target: 700, index: 1, pending: 55, connected: true });
    assert.equal(phase.boundary_samples()[0], 700);
    phase.reset(); phase.reset();
    phase.apply_frame(setup(1400), false);
    assert.deepEqual(phase.boundary_samples(), new Float64Array(56).fill(1400));
    assert.deepEqual(clockStep(phase, 1008), { delta: 0, unlagged_delta: 0,
      whole_steps: 0, double_steps: 0, lag_multiplier: 1, accumulated: 1, doubled_accumulated: 2 });
    assert.equal(JSON.parse(phase.snapshot()).boundary.pending, 55);
  } finally { phase.free(); }
  for (const [updates, nextMs, elapsed] of [
    [[1003], 1024, 2.625], [[1003, 999], 1003, 0.5], [[1003, 2000], 3000, 5],
  ]) {
    const scene = new wasm.AnimatedScene(1000);
    try {
      scene.apply_frame(bundle(setup(1200), target(600)), false);
      let before;
      for (const now of updates) before = clockStep(scene, now, true);
      assert(before.lag_multiplier < 1);
      const ring = scene.boundary_samples();
      scene.reset();
      const next = clockStep(scene, nextMs);
      assert.equal(next.lag_multiplier, 1, 'reset immediately restores full speed');
      assert.equal(next.delta, elapsed, 'elapsed time since the last update survives reset');
      assert.equal(next.accumulated, before.accumulated + elapsed);
      assert.equal(next.doubled_accumulated, before.doubled_accumulated + elapsed * 2);
      assert.deepEqual(scene.boundary_samples(), ring, 'disconnected updates retain boundary samples');
    } finally { scene.free(); }
  }
  const radius = new wasm.AnimatedScene(0);
  try {
    const view = () => JSON.parse(radius.snapshot());
    const tick = (now, lagging = false) => {
      const step = radius.advance(now, lagging);
      try { return step.whole_steps; } finally { step.free(); }
    };
    const state = () => [radius.snapshot(), Array.from(radius.boundary_samples()),
      Array.from(radius.own_body_samples()), Array.from(radius.camera_samples())];
    assert.equal(view().boundary, null);
    assert.equal(radius.boundary_samples().length, 0);
    radius.apply_frame(bundle(setup(1000), target(400)), false);
    assert.deepEqual(view().boundary, { displayed: 1000, target: 400, index: 0, pending: 56, connected: true });
    assert.equal(view().radius, 400, 'received radius remains the target diagnostic');
    assert(radius.boundary_samples() instanceof Float64Array);
    const scheduled = radius.boundary_samples();
    const copy = radius.boundary_samples(); copy.fill(0);
    assert.deepEqual(radius.boundary_samples(), scheduled, 'boundary buffers are copied');
    assert.equal(tick(4), 0);
    assert.deepEqual(radius.boundary_samples(), scheduled);
    assert.equal(tick(8), 1);
    assert.equal(view().boundary.displayed, 1000, 'the first sample retains the setup radius');
    assert.equal(tick(48), 5);
    assert.equal(view().boundary.displayed, scheduled[5]);
    assert.equal(view().boundary.index, 6, 'one shared clock advances the ring exactly once');
    assert.equal(view().boundary.pending, 50);
    radius.apply_frame(Uint8Array.from(target(400)), false);
    assert(radius.boundary_samples()[28] < scheduled[28], 'equal targets still blend pending samples');
    const savedRing = radius.boundary_samples();
    radius.apply_frame(bundle(target(800), target(300)), false);
    assert.equal(view().boundary.target, 300);
    assert.equal(view().boundary.pending, 56);
    assert.notDeepEqual(radius.boundary_samples(), savedRing);
    const beforeDraw = [view().boundary, radius.boundary_samples()];
    radius.prepare_draw(960, 540); radius.prepare_draw_with_style(960, 540, 1.3, true);
    assert.deepEqual([view().boundary, radius.boundary_samples()], beforeDraw);
    radius.set_connected(false);
    const paused = [view().boundary, radius.boundary_samples()];
    tick(88); tick(92);
    assert.deepEqual([view().boundary, radius.boundary_samples()], paused);
    radius.set_connected(true);
    assert.equal(tick(96), 1, 'reconnection consumes no disconnected backlog');
    assert.equal(view().boundary.displayed, paused[1][6]);
    assert.equal(view().boundary.index, 7);
    const retained = radius.boundary_samples();
    const retainedView = view().boundary;
    radius.reset();
    assert.deepEqual(view().boundary, { ...retainedView, connected: false });
    assert.deepEqual(radius.boundary_samples(), retained);
    tick(140);
    assert.deepEqual(radius.boundary_samples(), retained);
    radius.apply_frame(bundle(setup(900), target(600), setup(700), target(500)), false);
    assert.deepEqual(view().boundary, { displayed: 700, target: 500, index: 7, pending: 56, connected: true });
    assert.equal(radius.boundary_samples()[7], 700, 'midframe Setup fills absolute samples at the retained cursor');
    assert.equal(view().radius, 500);
    radius.set_connected(false);
    const stable = state();
    const bad = setup(800); bad[10] = 0;
    for (const bytes of [bundle(target(200), setup(600), [114, 0]),
      bundle(target(200), setup(600), target(300), bad, ownAppearance())]) {
      assert.throws(() => radius.apply_frame(bytes, false));
      assert.deepEqual(state(), stable, 'late received/numeric errors roll back setup, gate and ring together');
    }
    for (const operation of [() => radius.advance(NaN, false),
      () => radius.prepare_draw_with_style(960, 540, NaN, true)]) {
      assert.throws(operation); assert.deepEqual(state(), stable);
    }
    radius.set_connected(true);
    const samples = radius.boundary_samples();
    const steps = tick(148, true);
    assert.equal(steps, 0, 'lag adjustment belongs to the existing shared clock');
    assert.deepEqual(radius.boundary_samples(), samples);
    assert.equal(tick(156, true), 1);
    assert.equal(view().boundary.index, 8);
  } finally { radius.free(); }
  const follow = new wasm.AnimatedScene(0);
  try {
    follow.set_follows(false);
    let now = 0;
    for (const reset of [false, true]) {
      if (reset) {
        follow.reset();
        assert.equal(JSON.parse(follow.snapshot()).camera.follows, false);
      }
      follow.apply_frame(syntheticScene(), false);
      assert.equal(JSON.parse(follow.snapshot()).camera.follows, false);
      follow.prepare_draw(800, 600);
      assert.equal(JSON.parse(follow.snapshot()).camera.x, 0,
        'setup/reset keep the fixed newest-body-anchor camera when following is off');
      follow.advance(now += 8, false).free();
      follow.prepare_draw(800, 600);
      const fixed = JSON.parse(follow.snapshot());
      assert.equal(fixed.camera.x, 0);
      assert.notEqual(fixed.ownHead.x, fixed.camera.x, 'the head advances while the camera stays fixed');
    }
    follow.set_follows(true);
    follow.apply_frame(syntheticScene(), false);
    follow.prepare_draw(800, 600);
    const view = JSON.parse(follow.snapshot());
    assert.equal(view.camera.follows, true);
    assert.equal(view.camera.x, view.ownHead.x);
  } finally { follow.free(); }

  const scene = new wasm.AnimatedScene(0);
  const view = () => JSON.parse(scene.snapshot());
  function advance(now) {
    const step = scene.advance(now, false);
    try { return step.whole_steps; }
    finally { step.free(); }
  }
  try {
    assert.throws(() => new wasm.AnimatedScene(NaN));
    scene.apply_frame(syntheticScene(), false);
    assert.equal(view().ownId, 0);
    assert.equal(view().drawnSnakes, 3);
    assert.equal(view().own.visible, false);
    assert.equal(view().own.visualSpeed, 0);
    assert.equal(advance(8), 1);
    assert.equal(view().own.x, 32550 + (128 / 1000) / 4);
    scene.prepare_draw(960, 540);
    assert.equal(view().own.visible, true);
    const samples = scene.own_curve(1, false);
    assert.equal(samples instanceof Float32Array, true);
    assert.equal(samples.length % 3, 0);
    assert.equal(samples.length > 6, true);
    const body = scene.own_body();
    assert.equal(body.length, 12 * 14);
    const saved = scene.own_body_samples();
    const copy = scene.own_body_samples(); copy.fill(123);
    assert.deepEqual(scene.own_body_samples(), saved, 'diagnostic buffers are copied');
    const stable = scene.snapshot();
    const camera = scene.camera_samples();
    assert.throws(() => scene.apply_frame(bundle(syntheticStep(1), [114, 0]), false));
    assert.equal(scene.snapshot(), stable, 'late supported failure rolls back received and animated state');
    assert.deepEqual(scene.own_body_samples(), saved);
    assert.deepEqual(scene.camera_samples(), camera);
    for (const bad of [0, -1, 0.5, NaN, Infinity, 4294968256]) {
      assert.throws(() => scene.prepare_draw(bad, 540));
      assert.equal(scene.snapshot(), stable, 'validate JS dimensions before narrowing');
    }
    assert.throws(() => scene.advance(NaN, false));
    assert.equal(scene.snapshot(), stable);
    assert.throws(() => scene.own_curve(NaN, false));
    assert.equal(scene.snapshot(), stable);
    const team = Uint8Array.from([...syntheticSetup(), 2, 0]);
    assert.throws(() => scene.apply_frame(team, false));
    assert.equal(scene.snapshot(), stable, 'team ordering is explicitly unsupported');
    scene.apply_frame(syntheticStep(1), false);
    assert.equal(view().own.headPending, 53);
    assert.equal(view().camera.pending, 62);
    const headPending = view().own.headPending;
    scene.prepare_draw(960, 540);
    assert.equal(view().camera.pending, 61);
    assert.equal(view().own.headPending, headPending, 'draws do not consume head samples');
    advance(16);
    assert.equal(view().own.headPending, 52);
    assert.equal(view().camera.pending, 61, 'updates do not consume camera samples');
    scene.reset();
    scene.apply_frame(syntheticScene(), false);
    const resetState = scene.snapshot();
    assert.throws(() => scene.apply_frame(new Uint8Array(), false));
    assert.equal(scene.snapshot(), resetState);
    assert.equal(view().drawnSnakes, 3);
  } finally { scene.free(); }

  const eyes = new wasm.AnimatedScene(0);
  try {
    const view = () => JSON.parse(eyes.snapshot());
    eyes.apply_frame(syntheticScene(), false);
    eyes.set_gaze_heading(Math.PI / 2);
    const wanted = view().own.wantedHeading;
    const step = eyes.advance(4, false);
    try { assert.equal(step.whole_steps, 0); }
    finally { step.free(); }
    assert.equal(view().own.eyes.pupilX, Math.cos(Math.PI / 2) * 2.3);
    assert.equal(view().own.eyes.pupilY, 0.5 / 6);
    assert.equal(view().own.wantedHeading, wanted, 'visual gaze is separate from steering');
    eyes.prepare_draw_with_style(960, 540, 1.3, true);
    assert.equal(view().own.eyes.targetHeading, eyes.own_curve_info(1.3, true)[2]);
    assert.equal(view().own.eyes.heading, view().own.heading, 'entry captures raw heading before target feedback');
    const before = eyes.snapshot();
    const layouts = eyes.drawn_eyes(960, 540);
    assert.equal(layouts instanceof Float64Array, true);
    assert.equal(layouts.length, 3 * 16);
    assert.deepEqual(Array.from(layouts.slice(0, 3)), [0, 0, 1]);
    assert.equal(layouts[14], 0.75, 'eye alpha has no spawn multiplier');
    assert.equal(layouts[15], 1);
    const copied = eyes.drawn_eyes(960, 540); copied.fill(123);
    assert.deepEqual(eyes.drawn_eyes(960, 540), layouts);
    const drawn = JSON.parse(eyes.drawn_snakes());
    assert.deepEqual(drawn.map(row => [row.drawOrdinal, row.own, row.snake.id]), [[0, true, 0], [1, false, 7], [2, false, 8]]);
    assert.equal(eyes.snapshot(), before, 'numeric diagnostics cannot commit another eye target or draw');
    for (const bad of [NaN, Infinity, -Infinity]) {
      assert.throws(() => eyes.set_gaze_heading(bad));
      assert.equal(eyes.snapshot(), before);
    }
    for (const bad of [0, -1, NaN, Infinity]) {
      assert.throws(() => eyes.prepare_draw_with_style(960, 540, bad, true));
      assert.equal(eyes.snapshot(), before);
    }
    for (const bad of [0, -1, 0.5, NaN, Infinity, 4294968256]) {
      assert.throws(() => eyes.drawn_eyes(bad, 540));
      assert.equal(eyes.snapshot(), before);
    }
    eyes.apply_frame(bundle([69, 128], [69, 0, 7, 128]), false);
    assert.equal(view().own.eyes.gazeHeading, Math.PI / 2);
    assert.equal(JSON.parse(eyes.drawn_snakes())[1].snake.eyes.gazeHeading, Math.PI);
    eyes.apply_frame(Uint8Array.of(115, 0, 0, 1), false);
    const face = view().own.eyes.heading;
    eyes.set_gaze_heading(-Math.PI / 2);
    eyes.advance(8, false).free();
    assert.equal(view().own.eyes.heading, face, 'dead face remains captured');
    assert.equal(view().own.eyes.pupilY, 0, 'pupils still move during death fade');
    assert.equal(eyes.drawn_eyes(960, 540)[14], 0.75 * Math.sqrt(1 - view().own.deathProgress));
    for (let i = 1; i <= 12; i++) eyes.advance(8 + i * 40, false).free();
    assert.equal(view().own.expired, true);
    assert.equal(eyes.drawn_eyes(960, 540).length, 2 * 16);
    assert.equal(JSON.parse(eyes.drawn_snakes()).some(row => row.own), false);
  } finally { eyes.free(); }

  const duplicate = new wasm.AnimatedScene(0);
  try {
    duplicate.apply_frame(syntheticScene(), false);
    // Reuse the fixture's own appearance without its setup or other commands.
    duplicate.apply_frame(ownAppearance(), false);
    assert.equal(JSON.parse(duplicate.snapshot()).drawnSnakes, 4);
    duplicate.apply_frame(bundle([115, 0, 0, 0], [115, 0, 0, 0]), false);
    assert.equal(JSON.parse(duplicate.snapshot()).drawnSnakes, 2, 'both own duplicates leave the draw collection');
    assert.equal(JSON.parse(duplicate.snapshot()).ownHead, null);
    assert.equal(JSON.parse(duplicate.snapshot()).own !== null, true);
  } finally { duplicate.free(); }

  const short = new wasm.AnimatedScene(0);
  try {
    // Keep the first absolute anchor; omit ten relative pairs and final direction.
    const oneAnchor = ownAppearance().slice(0, -22);
    short.apply_frame(bundle(syntheticSetup(), oneAnchor), false);
    short.prepare_draw(960, 540);
    assert.equal(JSON.parse(short.snapshot()).own.physicalPoints, 1);
    assert.equal(JSON.parse(short.snapshot()).own.visible, true);
    assert.equal(JSON.parse(short.snapshot()).own.eyes.targetHeading, Math.fround(Math.PI) + Math.PI,
      'one-anchor eyes retain the finite head-lead tangent instead of the unrelated raw heading');
    assert.equal(short.own_curve(1, false).length, 0);
    assert.equal(short.own_curve_vertices(1, false).length, 0);
    assert.equal(short.own_curve_info(1, false).length, 0);
    assert.equal(short.drawn_eyes(960, 540).length, 16, 'a one-anchor appearance still has standard eyes');
    short.apply_frame(syntheticStep(1), false);
    short.prepare_draw(960, 540);
    assert.equal(short.own_curve(1, false).length > 0, true, 'a second anchor enables sampling');
  } finally { short.free(); }

  const drained = new wasm.AnimatedScene(0);
  try {
    // Authored stationary two-anchor appearance; front equals the separate head.
    const u24 = value => [value >>> 16 & 255, value >>> 8 & 255, value & 255];
    const spawn = Uint8Array.from([115, 0, 0, ...u24(0), 48, ...u24(0), 0, 0, ...u24(0), 0,
      ...u24(32550 * 5), ...u24(32550 * 5), 0, 0, 255,
      ...u24((32550 - 42) * 5), ...u24(32550 * 5), 0, 0]);
    drained.apply_frame(bundle(syntheticSetup(), spawn, [114, 0, 0], [114, 0, 0]), false);
    for (let i = 1; i <= 12; i++) drained.advance(i * 40, false).free();
    drained.prepare_draw_with_style(960, 540, 1, false);
    assert.equal(JSON.parse(drained.snapshot()).own.displayedLength, -0.6);
    assert.deepEqual(Array.from(drained.own_curve(1, false)), [32550, 32550, 0]);
    assert.equal(drained.own_curve_vertices(1, false).length, 6);
    assert.equal(drained.own_curve_info(1, false)[2], 0);
    assert.equal(drained.drawn_eyes(960, 540).length, 16);
  } finally { drained.free(); }

  for (const flag of [0, 1]) {
    for (const bundled of [false, true]) {
      const reused = new wasm.AnimatedScene(0);
      try {
        reused.apply_frame(syntheticScene(), false);
        const removal = [115, 0, 0, flag];
        if (bundled) reused.apply_frame(bundle(removal, ownAppearance()), false);
        else {
          reused.apply_frame(Uint8Array.from(removal), false);
          assert.equal(JSON.parse(reused.snapshot()).ownHead, null);
          reused.apply_frame(ownAppearance(), false);
        }
        const view = JSON.parse(reused.snapshot());
        assert.equal(view.snakes, 3, 'replacement reuses received lookup');
        assert.equal(view.ownHead, null, 'wire ID reuse cannot restore input to removed own');
        assert.notEqual(view.own, null, 'retained diagnostics remain available');
      } finally { reused.free(); }
    }
  }

  const removed = new wasm.AnimatedScene(0);
  try {
    removed.apply_frame(syntheticScene(), false);
    removed.prepare_draw(960, 540);
    assert.equal(removed.own_curve(1, false).length > 0, true);
    removed.apply_frame(Uint8Array.of(115, 0, 0, 0), false);
    for (let draw = 0; draw < 2; draw++) {
      assert.equal(removed.own_curve(1, false).length, 0, 'undrawn own has no active curve');
      assert.equal(removed.own_curve_vertices(1, false).length, 0);
      assert.equal(removed.own_curve_info(1, false).length, 0);
      assert.notEqual(JSON.parse(removed.snapshot()).own, null, 'raw diagnostics stay retained');
      removed.prepare_draw(960, 540);
    }
  } finally { removed.free(); }
}
