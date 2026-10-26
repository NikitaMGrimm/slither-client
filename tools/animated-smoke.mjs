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
    short.apply_frame(syntheticStep(1), false);
    short.prepare_draw(960, 540);
    assert.equal(short.own_curve(1, false).length > 0, true, 'a second anchor enables sampling');
  } finally { short.free(); }

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
