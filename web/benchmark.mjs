import init, * as wasm from './pkg/slither_client.js';
import { denseScene, DENSE_SCENE_PROFILES } from './dense-scene.mjs';

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: samples.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] };
}

function yieldBrowser() {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(0);
  });
}

export async function syntheticAssets() {
  const sprites = ['#83d5b0', '#efbb62', '#76b9ed'].map(color => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d'); context.fillStyle = color;
    context.beginPath(); context.arc(16, 16, 16, 0, Math.PI * 2); context.fill(); return canvas;
  });
  const tile = document.createElement('canvas'); tile.width = 40; tile.height = 40;
  const context = tile.getContext('2d'); context.fillStyle = '#151e27'; context.fillRect(0, 0, 40, 40);
  context.fillStyle = '#263440'; context.fillRect(0, 0, 1, 1);
  const background = new Image(); background.src = tile.toDataURL(); await background.decode();
  return { sprites, background };
}

/** Main-thread submission and explicit pixel-readback costs are distinct metrics. */
export async function runBenchmark({ iterations = 10, rounds = 3, width = 1280, height = 720,
  profiles = DENSE_SCENE_PROFILES, onProgress = () => {} } = {}) {
  if (!Number.isInteger(iterations) || iterations < 5 || iterations > 200 || !Number.isInteger(rounds) || rounds < 1 || rounds > 5
    || !Number.isInteger(width) || width < 1 || width > 4096 || !Number.isInteger(height) || height < 1 || height > 4096) {
    throw new Error('Invalid bounded benchmark settings');
  }
  await init();
  const assets = await syntheticAssets();
  if (!profiles || typeof profiles !== 'object' || Object.keys(profiles).length < 1 || Object.keys(profiles).length > 3) {
    throw new Error('Expected one through three bounded profiles');
  }
  const driverFor = (scene, canvas) => ({
    draw: (x, y, zoom) => scene.render(canvas, ...assets.sprites, assets.background, x, y, zoom),
    complete: () => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height),
    dispose() {},
  });
  const results = [];
  const visible = document.querySelector('#benchmark');
  const jobs = [];
  const scenes = new Set();
  try {
    for (const [profile, options] of Object.entries(profiles)) {
      const scene = new wasm.Scene();
      scenes.add(scene);
      const frames = denseScene(options);
      const start = performance.now(); for (const frame of frames) scene.apply_frame(frame, false);
      const loadMs = performance.now() - start;
      const snapshot = JSON.parse(scene.snapshot());
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.style.width = '100%'; canvas.style.height = 'auto';
      const driver = driverFor(scene, canvas);
      const readbackCanvas = document.createElement('canvas'); readbackCanvas.width = width; readbackCanvas.height = height;
      const readback = driverFor(scene, readbackCanvas);
      jobs.push({ profile, renderer: 'canvas2d', scene, canvas, driver, readbackCanvas, readback, loadMs, snapshot, submission: [], completion: [], apply: [] });
    }
    // Rotate the order each round to expose warmup/order effects rather than
    // attributing one context's cache state to the scene's entity count.
    for (let round = 0; round < rounds; round++) {
      const offset = round % jobs.length;
      const order = [...jobs.slice(offset), ...jobs.slice(0, offset)];
      for (const job of order) {
        onProgress(`${job.profile} / ${job.renderer} / round ${round + 1}`);
        const previous = document.querySelector('canvas[data-active-benchmark]');
        if (previous) previous.replaceWith(job.canvas);
        else visible?.replaceWith(job.canvas);
        job.canvas.dataset.activeBenchmark = '';
        // Let the browser service input and canvas bookkeeping between batches.
        await yieldBrowser();
        for (let index = 0; index < 3; index++) { job.driver.draw(0, 0, 1); await yieldBrowser(); }
        for (let index = 0; index < iterations; index++) {
          const start = performance.now(); job.driver.draw(index % 2, 0, 1);
          job.submission.push(performance.now() - start);
          await yieldBrowser();
        }
        // Readback can alter Canvas2D acceleration heuristics. Keep that cost
        // separate and explicitly report the method; it is not a display FPS.
        for (let index = 0; index < 5; index++) {
          const start = performance.now(); job.readback.draw(index % 2, 0, 1); job.readback.complete();
          job.completion.push(performance.now() - start);
          await yieldBrowser();
        }
        const ping = Uint8Array.of(112);
        for (let index = 0; index < iterations; index++) {
          const start = performance.now(); job.scene.apply_frame(ping, false);
          job.apply.push(performance.now() - start);
        }
      }
    }
    for (const job of jobs) results.push({ profile: job.profile, renderer: job.renderer, state: job.snapshot,
      loadMs: job.loadMs, submission: summarize(job.submission), drawAndReadback: summarize(job.completion),
      atomicNoopFrame: summarize(job.apply) });
  } finally {
    for (const job of jobs) { job.driver.dispose(); job.readback.dispose(); }
    for (const scene of scenes) scene.free();
  }
  return { schema: 1, userAgent: navigator.userAgent, dimensions: { width, height, dpr: devicePixelRatio },
    iterations, rounds, results, limits: [
      'Entirely synthetic; received anchors with original stand-in sprites.',
      'Main-thread call timings and separately forced pixel readback, not GPU timer or presentation FPS.',
      'Submission canvases never undergo readback; draw-and-readback uses separate canvases. Browser acceleration and driver state still affect timings.',
      'No game sockets or external reference files.',
    ] };
}

window.slitherBenchmark = { run: runBenchmark };
const button = document.querySelector('#run');
if (button) button.onclick = async () => {
  button.disabled = true;
  const output = document.querySelector('#result');
  try {
    const report = await runBenchmark({ onProgress: text => { output.textContent = text; } });
    window.slitherBenchmarkReport = report; output.textContent = JSON.stringify(report, null, 2);
  } catch (error) { output.textContent = String(error); }
  finally { button.disabled = false; }
};
