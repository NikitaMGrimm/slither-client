// Entirely authored synthetic packet tape and artwork; no reference inputs.
import init, * as wasm from '/pkg/slither_client.js';
import { syntheticScene, syntheticStep } from '/web/synthetic-scene.mjs';
import { createSyntheticBodyResolver } from '/web/synthetic-body.mjs';
import { createSyntheticFoodResolver } from '/web/synthetic-food.mjs';
import { createSyntheticPreyResolver, syntheticPreyCommands } from '/web/synthetic-prey.mjs';

await init();
const canvas = document.querySelector('#world');
const palettes = ['#83d5b0', '#efbb62', '#76b9ed'].map(color => {
  const source = document.createElement('canvas');
  source.width = source.height = 32;
  const c = source.getContext('2d');
  c.fillStyle = color; c.beginPath(); c.arc(16, 16, 16, 0, Math.PI * 2); c.fill();
  return source;
});
const background = new Image();
background.src = palettes[0].toDataURL();
await background.decode();
const body = createSyntheticBodyResolver(palettes, globalThis);
let seed = 0x51eed;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const food = createSyntheticFoodResolver(globalThis, random);
const prey = createSyntheticPreyResolver(globalThis, random);
const face = () => ({ eyes: { kind: 'standard', distance: 6, separation: 6, radius: 6,
  pupilRadius: 3.5, pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff,
  pupilColor: 0, outlineColor: 0, eyeOpacity: 0.75, pupilOpacity: 1,
  angleSmoothing: 0.12 }, decoration: { kind: 'none' } });
let scene, quality, frame = 0, heading = 0, boosting = false, start;
const packets = [{ frame: 0, bytes: [...syntheticScene(0, syntheticPreyCommands())] },
  ...[4, 8, 12, 16, 20].map((frame, i) => ({ frame, bytes: [...syntheticStep(i + 1)] }))];
const input = [];
addEventListener('pointermove', e => { heading = Math.atan2(e.clientY - 240, e.clientX - 320); input.push(['pointer', frame, e.clientX, e.clientY]); });
addEventListener('keydown', e => { if (e.code === 'Space') { boosting = true; input.push(['boost', frame, true]); } });
addEventListener('keyup', e => { if (e.code === 'Space') { boosting = false; input.push(['boost', frame, false]); } });
function ingress(bytes) {
  scene.apply_frame_and_render_standard_with_prey(Uint8Array.from(bytes), false, face, food, prey,
    canvas, ...palettes, background, 640, 480, body, quality);
}
function tick(now) {
  const began = browserProbe.now();
  browserProbe.frame = ++frame;
  for (const packet of packets) if (packet.frame === frame) ingress(packet.bytes);
  scene.set_gaze_heading(heading);
  const step = scene.advance(now - start, false);
  try { quality.advance(step, true); } finally { step.free(); }
  scene.render_standard_at_size(canvas, ...palettes, background, 640, 480, body, quality);
  browserProbe.timings.push({ frame, start: began, end: browserProbe.now(), boosting });
  requestAnimationFrame(tick);
}
globalThis.browserFixture = {
  ready: true,
  arm() {
    if (scene) throw new Error('Fixture is single use');
    scene = new wasm.AnimatedScene(0); quality = new wasm.DesktopQuality(1, 0);
    quality.begin_skin_preview(); start = performance.now();
    browserProbe.recording = true; ingress(packets[0].bytes); requestAnimationFrame(tick);
  },
  result() { return { frame, packets, input, snapshot: JSON.parse(scene.snapshot()), wasmExecuted: true }; },
};
