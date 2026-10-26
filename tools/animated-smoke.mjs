import assert from 'node:assert/strict';
import { bundle, syntheticScene, syntheticSetup, syntheticStep } from '../web/synthetic-scene.mjs';

// Original synthetic packet/update/draw cases; no reference or server connection.
export function animatedSmoke(wasm) {
  function ownAppearance() {
    const packed = wasm.decode_frame(syntheticScene(), false);
    const bytes = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    let offset = 4 + bytes.getUint32(0);
    const length = bytes.getUint32(offset); offset += 4;
    return packed.slice(offset, offset + length);
  }
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
    scene.reset(16);
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
