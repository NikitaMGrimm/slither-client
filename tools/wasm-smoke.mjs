import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadWasm } from './reference-context.mjs';
import { syntheticChallenge } from './reference-parity.mjs';
import { HandshakeSession } from '../web/handshake-session.mjs';
import { bundle, syntheticScene, syntheticSetup, syntheticStep } from '../web/synthetic-scene.mjs';
import { denseScene, DENSE_SCENE_PROFILES } from '../web/dense-scene.mjs';
import { presentationSmoke } from './presentation-smoke.mjs';
import { animatedSmoke } from './animated-smoke.mjs';
import { qualitySmoke } from './quality-smoke.mjs';
import { bodyRenderSmoke } from './body-render-smoke.mjs';
import { mouthFaceRenderSmoke } from './mouth-face-render-smoke.mjs';
import { staticAccessoryRenderSmoke } from './static-accessory-render-smoke.mjs';
import { clientControlSmoke } from './client-control-smoke.mjs';
import { stockRenderSmoke } from './stock-render-smoke.mjs';
import { stockSessionSmoke } from './stock-session-smoke.mjs';
import { stockProfileSmoke } from './stock-profile-smoke.mjs';
import { stockScoreSmoke } from './stock-score-smoke.mjs';
import { stockHudSmoke } from './stock-hud-smoke.mjs';
import { leaderboardScoreSmoke } from './leaderboard-score-smoke.mjs';
import { minimapRenderSmoke } from './minimap-render-smoke.mjs';
import { skinPolicySmoke } from './skin-policy-smoke.mjs';
import { startPageSmoke } from './start-page-smoke.mjs';
import { endScreenSmoke } from './end-screen-smoke.mjs';
import { menuPreferencesSmoke } from './menu-preferences-smoke.mjs';
import { desktopLayoutSmoke } from './desktop-layout-smoke.mjs';
import { playAdmissionSmoke } from './play-admission-smoke.mjs';
import { desktopInputSmoke } from './desktop-input-smoke.mjs';
import { desktopInputLifetimeSmoke } from './desktop-input-lifetime-smoke.mjs';

// Entirely synthetic ABI integration; no reference files or network are used.
const wasm = await loadWasm();
desktopLayoutSmoke(wasm);
menuPreferencesSmoke(wasm);
playAdmissionSmoke(wasm);
const playAdmissionResult = execFileSync(process.execPath,
  ['--test', '--test-reporter=tap', ...['game-play-admission', 'game-owned-play-runtime', 'game-menu-preferences',
    'game-owned-leaderboard-runtime'].map(name => fileURLToPath(new URL(`./${name}.test.mjs`, import.meta.url)))],
  { encoding: 'utf8', env: { ...process.env, SLITHER_PLAY_ADMISSION_WASM: '1' }, maxBuffer: 4 * 1024 * 1024 });
console.log('Synthetic runtime Play requirements with real Rust admission passed:',
  playAdmissionResult.split(/\r?\n/).filter(line => /^# (tests|pass|fail|skipped) /.test(line)).join(', '));
console.log('Synthetic real-Wasm desktop input equivalence passed:', desktopInputSmoke(wasm));
console.log('Synthetic real-Wasm desktop input release passed:', desktopInputLifetimeSmoke(wasm));
const inputRequirements = execFileSync(process.execPath,
  ['--test', '--test-reporter=tap', fileURLToPath(new URL('./client-input.test.mjs', import.meta.url))],
  { encoding: 'utf8', env: { ...process.env, SLITHER_INPUT_WASM: '1' }, maxBuffer: 4 * 1024 * 1024 });
console.log('Synthetic real-Wasm desktop input requirements passed:',
  inputRequirements.split(/\r?\n/).filter(line => /^# (tests|pass|fail|skipped) /.test(line)).join(', '));
// Replay existing authored reducer/view/DOM requirements against real Rust history.
const hudHistoryTests = ['stock-hud-state', 'stock-hud-view', 'stock-hud-dom',
  'stock-leaderboard-state', 'stock-leaderboard-view', 'stock-gameplay-leaderboard', 'game-owned-hud-ui'];
const hudHistoryResult = execFileSync(process.execPath,
  ['--test', '--test-reporter=tap', ...hudHistoryTests.map(name => fileURLToPath(new URL(`./${name}.test.mjs`, import.meta.url)))],
  { encoding: 'utf8', env: { ...process.env, SLITHER_HUD_HISTORY_WASM: '1', SLITHER_LEADERBOARD_HISTORY_WASM: '1' }, maxBuffer: 4 * 1024 * 1024 });
console.log('Synthetic real-Wasm HUD/leaderboard history requirements passed:',
  hudHistoryResult.split(/\r?\n/).filter(line => /^# (tests|pass|fail|skipped) /.test(line)).join(', '));
console.log('Synthetic start-page view ABI passed:', startPageSmoke(wasm));
endScreenSmoke(wasm);
console.log('Synthetic Rust skin policy ABI passed:', skinPolicySmoke(wasm));
leaderboardScoreSmoke(wasm);
console.log('Synthetic native minimap view ABI passed:', minimapRenderSmoke(wasm));
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
assert.deepEqual(wasm.decode_frame(Uint8Array.of(112), false),
  Uint8Array.of(0, 0, 0, 1, 112), 'packed pong uses a big-endian u32 command length');
assert.throws(() => wasm.solve_challenge(Uint8Array.of(0, 1)));
assert.throws(() => wasm.encode_login(1, new Uint8Array(19), 'Synthetic', 0, new Uint8Array()));
const delNickname = '\u007f'.repeat(24), delCustom = Uint8Array.of(3, 1);
assert.deepEqual(wasm.encode_login(1, profile.password, delNickname, 255, delCustom),
  Uint8Array.from([115, 30, 0, 1, ...profile.password, 255, 24,
    ...new Array(24).fill(127), 0, 255, ...delCustom]), 'Real Rust ABI preserves every DEL nickname byte');
for (const nickname of ['\u001f', '\u0080', delNickname + '\u007f']) {
  assert.throws(() => wasm.encode_login(1, profile.password, nickname, 0, new Uint8Array()));
}
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

// Received-only food projection and compact-cache reset through the real ABI.
const foodScene = new wasm.Scene();
try {
  foodScene.apply_frame(syntheticSetup(), false);
  foodScene.apply_frame(bundle([102, 1, 2, 3, 4, 255, 5], [60, 6, 7, 8, 9, 0, 0]), false);
  const foodBefore = foodScene.snapshot();
  assert.throws(() => foodScene.apply_frame(bundle(
    [102, 9, 8, 7, 6, 18, 5], [60, 5, 4, 3, 2, 255, 255], [70, 1, 2, 0]), false));
  assert.equal(foodScene.snapshot(), foodBefore, 'late food failure preserves received state and counters');
  foodScene.apply_frame(Uint8Array.of(98, 10, 11, 5), false);
  assert.equal(JSON.parse(foodScene.snapshot()).foods, 2);
  // Original zero-body own appearance; no external packet or reference is used.
  const own = Uint8Array.from([115, 0, 0, 0, 0, 0, 48, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 2, 123, 192, 2, 123, 192, 0, 0, 0]);
  foodScene.apply_frame(own, false);
  const afterOwn = foodScene.snapshot();
  for (const compact of [[102, 3, 4, 5], [98, 3, 4, 255, 5], [99, 8, 9], [67, 8, 9], [60, 8, 9, 0, 0]]) {
    assert.throws(() => foodScene.apply_frame(Uint8Array.from(compact), false));
    assert.equal(foodScene.snapshot(), afterOwn, 'first own invalidates both compact sector streams');
  }
  foodScene.apply_frame(bundle(
    [70, 1, 2, 9, 3, 4, 10, 18, 3, 4, 15], [70, 1, 2], [87, 1, 2]), false);
  assert.equal(JSON.parse(foodScene.snapshot()).foods, 2, 'duplicates replace the received projection; empty F is additive');
  foodScene.apply_frame(bundle([99, 1, 2, 3, 4], [67, 3, 4]), false);
  assert.equal(JSON.parse(foodScene.snapshot()).foods, 1, 'received consumption is immediate even for duplicate spawns');
  foodScene.apply_frame(Uint8Array.of(119, 1, 2), false);
  assert.equal(JSON.parse(foodScene.snapshot()).foods, 0);
} finally { foodScene.free(); }
console.log('Synthetic received-food compact-cache and lossy-projection Wasm ABI passed.');

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
console.log('Synthetic borrowed standard-body Canvas ABI passed:', bodyRenderSmoke(wasm));
console.log('Synthetic complete mouth-face Canvas ABI passed:', mouthFaceRenderSmoke(wasm));
console.log('Synthetic static accessory Canvas ABI passed:', await staticAccessoryRenderSmoke(wasm));
console.log('Synthetic pre-motion control ABI passed:', clientControlSmoke(wasm));
console.log('Synthetic live-source stock adapter ABI passed:', stockRenderSmoke(wasm));
console.log('Synthetic caller-owned stock session ABI passed:', stockSessionSmoke(wasm));
console.log('Synthetic explicit profile/Play composition ABI passed:', await stockProfileSmoke(wasm));
console.log('Synthetic retained-own score-state ABI passed:', stockScoreSmoke(wasm));
console.log('Synthetic command-indexed HUD ABI passed:', stockHudSmoke(wasm));
