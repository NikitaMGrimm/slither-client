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
}
