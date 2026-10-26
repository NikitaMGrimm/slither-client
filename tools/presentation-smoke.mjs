import assert from 'node:assert/strict';

// Original synthetic numerical cases; no reference files, sockets, or local host.
export function presentationSmoke(wasm) {
  const clock = new wasm.AnimationClock(1000);
  const head = new wasm.HeadPredictor(0, 0, 0, 0, 0, 4, 42, 0);
  let now = 1000;
  function advance(milliseconds, alive = true) {
    now += milliseconds;
    const step = clock.advance(now, false, false);
    try { head.advance(step, 0.033, 1, 1, alive); return { delta: step.delta, whole: step.whole_steps, double: step.double_steps }; }
    finally { step.free(); }
  }
  try {
    assert.deepEqual(advance(3), { delta: 0.375, whole: 0, double: 0 });
    assert.deepEqual(advance(5), { delta: 0.625, whole: 1, double: 2 });
    assert.equal(JSON.parse(head.snapshot()).x, 1, '125 world units/sec over 8 ms');
    head.correct_head(26, -3, 0.25);
    let view = JSON.parse(head.snapshot());
    assert.equal(view.x + view.offsetX, 1);
    assert.equal(view.y + view.offsetY, 0);
    assert.equal(view.headPending, 53);
    const before = head.snapshot();
    assert.throws(() => head.correct_head(1e308, 0, 0));
    assert.equal(head.snapshot(), before, 'invalid correction is atomic');
    advance(0, false);
    assert.equal(JSON.parse(head.snapshot()).headPending, 53);
    head.correct_heading(Math.PI); head.set_target(Math.PI, 0, 0);
    assert.equal(JSON.parse(head.snapshot()).angleOffset, 0);
    advance(8, false);
    view = JSON.parse(head.snapshot());
    assert.equal(view.headIndex, 1); assert.equal(view.headPending, 52);
    assert.equal(view.angleOffset, Math.fround(-Math.PI));
    assert.equal(head.head_samples()[0], 0, 'consumed slot cleared');
    for (let index = 1; index < 53; index++) advance(8, false);
    view = JSON.parse(head.snapshot());
    assert.equal(view.headPending, 0); assert.equal(view.anglePending, -1);
    advance(8, false); assert.equal(JSON.parse(head.snapshot()).headPending, -1);
    const step = clock.advance(now + 8, false, false);
    const stable = head.snapshot();
    try { assert.throws(() => head.advance(step, Number.MAX_VALUE, 2, 1, true)); }
    finally { step.free(); }
    assert.equal(head.snapshot(), stable);
    assert.throws(() => new wasm.HeadPredictor(0, 0, 0, 0, 9, 0, 42, 0));
    for (const direction of [256, -254, 0.5, NaN, Infinity]) {
      assert.throws(() => new wasm.HeadPredictor(0, 0, 0, 0, direction, 0, 42, 0));
      assert.throws(() => head.set_target(1, direction, 2));
      assert.equal(head.snapshot(), stable, 'invalid direction cannot narrow into a valid turn');
    }
    assert.throws(() => new wasm.AnimationClock(NaN));
  } finally { head.free(); clock.free(); }

  const preciseClock = new wasm.AnimationClock(0);
  const preciseHead = new wasm.HeadPredictor(0, 0, 0, 0, 0, 1 / 18, 1, 0);
  const preciseStep = preciseClock.advance(8, true, false);
  try {
    preciseHead.advance(preciseStep, 0, 1, 1, true);
    assert.equal(JSON.parse(preciseHead.snapshot()).x, (1 / 18) * 0.85 / 4,
      'retain decoded speed and the multiplication/division order exactly');
  } finally { preciseStep.free(); preciseHead.free(); preciseClock.free(); }

  const anchored = new wasm.HeadPredictor(0, 0, 0, 0, 0, 0, 10, 1.5);
  try {
    anchored.reanchor(42, -3, 2.5);
    const view = JSON.parse(anchored.snapshot());
    assert.equal(view.fraction, 0.25); assert.equal(view.fractionOffset, 0.25);
    assert.equal(view.offsetX, -42); assert.equal(view.offsetY, 3);
    assert.equal(view.headPending, 53);
    const stable = anchored.snapshot();
    assert.throws(() => anchored.reanchor(Number.MAX_VALUE, 0, 0));
    assert.equal(anchored.snapshot(), stable);
  } finally { anchored.free(); }

  const geometryClock = new wasm.AnimationClock(0);
  const length = new wasm.LengthSmoother(12);
  const camera = new wasm.CameraSmoother();
  try {
    length.set_length(12, 0.5);
    assert.equal(JSON.parse(length.snapshot()).offset, -0.5);
    assert.equal(JSON.parse(length.snapshot()).displayed, 11.4);
    const zero = geometryClock.advance(0, false, false);
    try { length.advance(zero, true); }
    finally { zero.free(); }
    assert.equal(JSON.parse(length.snapshot()).pending, 53);
    const lengthBefore = length.snapshot();
    const samplesBefore = length.samples();
    for (const count of [-1, 0.5, 4294967296, NaN, Infinity]) {
      assert.throws(() => new wasm.LengthSmoother(count));
      assert.throws(() => length.set_length(count, 0));
      assert.equal(length.snapshot(), lengthBefore);
      assert.deepEqual(length.samples(), samplesBefore);
    }
    for (let index = 1; index <= 53; index++) {
      const step = geometryClock.advance(index * 8, false, false);
      try { length.advance(step, true); }
      finally { step.free(); }
    }
    assert.equal(JSON.parse(length.snapshot()).pending, 0);
    const cleanup = geometryClock.advance(53 * 8, false, false);
    try { length.advance(cleanup, true); }
    finally { cleanup.free(); }
    assert.equal(JSON.parse(length.snapshot()).pending, -1, 'live zero-step cleanup');
    assert.equal(JSON.parse(length.snapshot()).displayed, 11.9);
    camera.inject(8, -4);
    assert.equal(JSON.parse(camera.snapshot()).offsetX, 0, 'injection waits for draw');
    camera.draw();
    assert.deepEqual(JSON.parse(camera.snapshot()), { offsetX: -8, offsetY: 4, index: 1, pending: 61 });
    assert.equal(camera.samples()[0], 0);
    const copy = camera.samples(); copy[1] = 12345;
    assert.equal(camera.samples()[1] === 12345, false, 'sample arrays are copied');
    const stableCamera = camera.snapshot();
    const stableSamples = camera.samples();
    assert.throws(() => camera.inject(NaN, 0));
    assert.equal(camera.snapshot(), stableCamera);
    assert.deepEqual(camera.samples(), stableSamples);
    assert.equal(camera.weights().length, 62);
    assert.equal(length.weights().length, 53);
    assert.equal(camera.weights()[1] === Math.fround(camera.weights()[1]), false);
    // This index exposed a host-vs-libm rounding difference in the Wasm build.
    let cameraWeight = 0.5 * (1 - Math.cos(Math.PI * (61 - 55) / 61));
    cameraWeight += (0.5 * (1 - Math.cos(Math.PI * cameraWeight)) - cameraWeight) * 0.5;
    assert.equal(camera.weights()[55], cameraWeight, 'use the current host Math cosine');
    for (let index = 1; index < 62; index++) camera.draw();
    assert.equal(JSON.parse(camera.snapshot()).pending, 0);
    const exhausted = camera.snapshot(); camera.draw();
    assert.equal(camera.snapshot(), exhausted, 'camera has no entity cleanup sentinel');
  } finally { camera.free(); length.free(); geometryClock.free(); }

  const boundaryClock = new wasm.AnimationClock(0);
  const boundary = new wasm.BoundarySmoother(1200);
  let boundaryNow = 0;
  function advanceBoundary(elapsed, connected = true) {
    const step = boundaryClock.advance(boundaryNow += elapsed, false, false);
    try { boundary.advance(step, connected); }
    finally { step.free(); }
  }
  try {
    assert.equal(boundary.weights().length, 56);
    assert.equal(boundary.weights()[0], 0);
    assert.equal(boundary.weights()[55], 1);
    for (let index = 0; index < 56; index++) {
      assert.equal(boundary.weights()[index], 0.5 * (1 - Math.cos(Math.PI * index / 55)),
        'boundary weights use host Math cosine without Float32 storage');
    }
    boundary.set_target(800);
    const before = boundary.snapshot(), samples = boundary.samples();
    samples[0] = 1;
    assert.equal(boundary.samples()[0], 1200, 'boundary samples are copied');
    advanceBoundary(4); advanceBoundary(0); advanceBoundary(4, false);
    assert.equal(boundary.snapshot(), before);
    advanceBoundary(8);
    assert.deepEqual(JSON.parse(boundary.snapshot()), { displayed: 1200, target: 800, index: 1, pending: 55 });
    boundary.apply_setup(1600);
    assert.deepEqual(JSON.parse(boundary.snapshot()), { displayed: 1600, target: 1600, index: 1, pending: 55 });
    assert.deepEqual(boundary.samples(), new Float64Array(56).fill(1600));
    boundary.set_target(400);
    for (let index = 0; index < 13; index++) advanceBoundary(40);
    assert.deepEqual(JSON.parse(boundary.snapshot()), { displayed: 400, target: 400, index: 1, pending: -1 });
    const stable = boundary.snapshot(), stableSamples = boundary.samples();
    for (const radius of [NaN, Infinity, -Infinity, 0, -0, -1]) {
      assert.throws(() => new wasm.BoundarySmoother(radius));
      assert.throws(() => boundary.set_target(radius));
      assert.throws(() => boundary.apply_setup(radius));
      assert.equal(boundary.snapshot(), stable);
      assert.deepEqual(boundary.samples(), stableSamples);
    }
  } finally { boundary.free(); boundaryClock.free(); }
}
