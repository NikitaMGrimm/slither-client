import assert from 'node:assert/strict';
import { loadWasm } from './reference-context.mjs';
import { syntheticChallenge } from './reference-parity.mjs';
import { HandshakeSession } from '../web/handshake-session.mjs';
import { bundle, syntheticScene, syntheticSetup, syntheticStep } from '../web/synthetic-scene.mjs';
import { denseScene, DENSE_SCENE_PROFILES } from '../web/dense-scene.mjs';
import { presentationSmoke } from './presentation-smoke.mjs';
import { animatedSmoke } from './animated-smoke.mjs';
import { qualitySmoke } from './quality-smoke.mjs';

// Entirely synthetic ABI integration; no reference files or network are used.
const wasm = await loadWasm();
const profile = { clientVersion: 1, password: Uint8Array.from({ length: 20 }, (_, index) => index), protocolVersion: 19 };
const session = new HandshakeSession(wasm, profile, 'Synthetic');
const challenge = Uint8Array.from([54, ...syntheticChallenge('A'.repeat(27))]);
const reply = session.receive(challenge);
assert.equal(reply.outbound.length, 2);
assert.equal(reply.outbound[0].length, 27);
assert.equal(reply.outbound[1][0], 115);
const setup = new Uint8Array(30); setup[0] = 97; setup[23] = 19;
const accepted = session.receive(setup);
assert.equal(accepted.complete, true); assert.equal(accepted.protocolVersion, 19);
assert.throws(() => wasm.solve_challenge(Uint8Array.of(0, 1)));
assert.throws(() => wasm.encode_login(1, new Uint8Array(19), 'Synthetic', 0, new Uint8Array()));
console.log('Synthetic Wasm ABI handshake passed; no reference files or sockets used.');

const scene = new wasm.Scene();
scene.apply_frame(syntheticScene(), false);
const first = JSON.parse(scene.snapshot());
assert.equal(first.snakes, 3); assert.equal(first.foods, 28); assert.equal(first.ownId, 0);
assert.equal(first.protocol, 19); assert.deepEqual(first.ownHead, { x: 0, y: 0, skin: 0 });
scene.apply_frame(syntheticStep(1), false);
assert.equal(JSON.parse(scene.snapshot()).ownHead.x, 8);
const before = scene.snapshot();
assert.throws(() => scene.apply_frame(bundle(syntheticStep(2), [70, 108, 108, 0]), false));
assert.equal(scene.snapshot(), before, 'malformed command must roll back earlier anchors and counters');
for (let length = 0; length < 25; length++) {
  assert.throws(() => scene.apply_frame(syntheticSetup().slice(0, length), false));
  assert.equal(scene.snapshot(), before);
}
scene.apply_frame(bundle([115, 0, 0, 1], [119, 108, 108]), false);
const removed = JSON.parse(scene.snapshot());
assert.equal(removed.snakes, 2); assert.equal(removed.foods, 0); assert.equal(removed.ownHead, null);
scene.reset(); assert.equal(JSON.parse(scene.snapshot()).protocol, null);
scene.free();
console.log('Synthetic Wasm scene ABI transitions and atomic rejection passed.');

for (const [name, profile] of Object.entries(DENSE_SCENE_PROFILES)) {
  const dense = new wasm.Scene();
  try {
    for (const frame of denseScene(profile)) dense.apply_frame(frame, false);
    const view = JSON.parse(dense.snapshot());
    assert.equal(view.snakes, profile.snakes, `${name} snakes`);
    assert.equal(view.foods, profile.foods, `${name} foods`);
    assert.equal(view.ignored, 0, `${name} supported commands`);
  } finally { dense.free(); }
}
console.log('Synthetic dense fixture presets passed the real Wasm ABI.');
presentationSmoke(wasm);
console.log('Synthetic presentation clock, prediction and correction Wasm ABI passed.');
animatedSmoke(wasm);
console.log('Synthetic coupled animation, curve and lifecycle Wasm ABI passed.');
qualitySmoke(wasm);
console.log('Synthetic desktop quality preference, timing and rejection Wasm ABI passed.');
