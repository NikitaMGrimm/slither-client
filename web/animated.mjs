import init, * as wasm from './pkg/slither_client.js';
import { syntheticScene, syntheticStep } from './synthetic-scene.mjs';
import { connectLoopback, loopbackEndpoint, sceneHeading } from './loopback-session.mjs';
import { createSyntheticBodyResolver } from './synthetic-body.mjs';
import { createSyntheticFoodResolver } from './synthetic-food.mjs';
import { createSyntheticPreyResolver, syntheticPreyCommands } from './synthetic-prey.mjs';
import { desktopBackingSize } from './desktop-layout.mjs';

const control = id => document.querySelector(`#${id}`);
const target = control('scene');
const lifecycle = new AbortController();
const listen = (element, type, handler) => element.addEventListener(type, handler, { signal: lifecycle.signal });
let animated;
let quality;
let connection;
let pendingFrame;
let disposed = false;
let simulatorUrl;
let mode = 'synthetic';
let anchorStep = 0;
let heading = 0;
let gazeHeading = 0;
let boost = false;
let renders = 0;
let drawsSinceStatistics = 0;
let lastReadout = -Infinity;
let renderedCamera;
let applyFrame;
let foodRandomState;
let preyRandomState;

function setStatus(text) { control('status').textContent = text; }
function updateControls() {
  const ready = Boolean(animated) && !disposed;
  for (const id of ['reset', 'zoom', 'follow', 'quality']) control(id).disabled = !ready;
  control('step').disabled = !ready || mode !== 'synthetic';
  control('skin').disabled = !ready || Boolean(connection);
  control('connect').disabled = !ready || Boolean(connection) || !simulatorUrl;
  control('disconnect').disabled = !ready || !connection;
}
function disconnect() {
  const previous = connection;
  connection = undefined;
  boost = false;
  heading = 0;
  animated?.set_connected(false);
  previous?.close();
  updateControls();
}
function teardown() {
  if (disposed) return;
  disposed = true;
  lifecycle.abort();
  if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
  pendingFrame = undefined;
  disconnect();
  animated?.free();
  animated = undefined;
  quality?.free();
  quality = undefined;
}
function fail(error) {
  teardown();
  setStatus(`Animated preview stopped: ${String(error)}`);
}
listen(window, 'pagehide', teardown);

function reset() {
  disconnect();
  mode = 'synthetic';
  animated.reset();
  quality.begin_skin_preview();
  foodRandomState = 0x5eed1;
  preyRandomState = 0x7a3e1;
  animated.set_follows(control('follow').checked);
  animated.set_zoom(Number(control('zoom').value));
  anchorStep = 0;
  lastReadout = -Infinity;
  renderedCamera = undefined;
  applyFrame(syntheticScene(Number(control('skin').value), syntheticPreyCommands()), false);
  updateControls();
  setStatus('Synthetic geometry preview');
}
function input() { connection?.setInput(heading, boost); }
function releaseBoost() { boost = false; input(); }

async function start() {
  await init();
  if (disposed) return;
  // Original generated stand-ins; no external artwork or reference inputs.
  const palettes = ['#83d5b0', '#efbb62', '#76b9ed'].map(color => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.beginPath(); context.arc(16, 16, 16, 0, Math.PI * 2); context.fill();
    return canvas;
  });
  const tile = document.createElement('canvas');
  tile.width = 40; tile.height = 40;
  const context = tile.getContext('2d');
  context.fillStyle = '#151e27'; context.fillRect(0, 0, 40, 40);
  context.fillStyle = '#263440'; context.fillRect(0, 0, 1, 1);
  const background = new Image();
  background.src = tile.toDataURL();
  await background.decode();
  if (disposed) return;
  const startMs = performance.now();
  animated = new wasm.AnimatedScene(startMs);
  quality = new wasm.DesktopQuality(Number(control('quality').value), startMs);
  const resolveSynthetic = createSyntheticBodyResolver(palettes, globalThis);
  const face = {
    eyes: { kind: 'standard', distance: 6, separation: 6, radius: 6, pupilRadius: 3.5,
      pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0,
      outlineColor: 0, eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 },
    decoration: { kind: 'none' },
  };
  const resolveFace = () => ({ revision: 'synthetic-face-1', eyes: face.eyes, decoration: null });
  const resolveFood = createSyntheticFoodResolver(globalThis, () => {
    // A repeatable caller-owned tape supplies two independent units per creation.
    foodRandomState = (Math.imul(foodRandomState, 1664525) + 1013904223) >>> 0;
    return foodRandomState / 4294967296;
  });
  const resolvePrey = createSyntheticPreyResolver(globalThis, () => {
    preyRandomState = (Math.imul(preyRandomState, 1664525) + 1013904223) >>> 0;
    return preyRandomState / 4294967296;
  });
  const desiredSize = () => desktopBackingSize(window.innerWidth, window.innerHeight);
  function recordDraws(count) {
    renders += count;
    drawsSinceStatistics += count;
    if (count === 0) return;
    const view = JSON.parse(animated.snapshot());
    renderedCamera = { x: view.camera.x, y: view.camera.y, zoom: view.camera.zoom };
    return view;
  }
  function renderScene() {
    const { width, height } = desiredSize();
    if (mode === 'synthetic') animated.render_standard_at_size(target, ...palettes, background,
      width, height, resolveSynthetic, quality);
    else animated.render_with_food_at_size(target, ...palettes, background,
      width, height, false, resolveFace, quality);
    return recordDraws(1);
  }
  applyFrame = (bytes, header) => {
    const { width, height } = desiredSize();
    const count = mode === 'synthetic'
      ? animated.apply_frame_and_render_standard_with_prey(bytes, header, () => face, resolveFood, resolvePrey,
        target, ...palettes, background, width, height, resolveSynthetic, quality)
      : animated.apply_frame_and_render_with_food_and_prey(bytes, header, () => face, resolveFood, resolvePrey,
        target, ...palettes, background, width, height, false, resolveFace, quality);
    if (count !== 0) {
      recordDraws(count);
      lastReadout = -Infinity;
    }
    return count;
  };

  function frame(nowMs) {
    pendingFrame = undefined;
    if (disposed) return;
    try {
      // Rust advances all presentation state and owns timestamp clamping.
      animated.set_gaze_heading(gazeHeading);
      const step = animated.advance(nowMs, false);
      try { quality.advance(step, true); } finally { step.free(); }
      // Each RAF is an active preview update. Observe prior successful draws;
      // a statistics transition affects interpolation on the following update.
      if (quality.update_statistics(nowMs, drawsSinceStatistics, true)) drawsSinceStatistics = 0;
      const qualityView = JSON.parse(quality.snapshot());
      const view = renderScene();
      if (nowMs - lastReadout >= 100) {
        lastReadout = nowMs;
        const count = (value, width) => String(value).padStart(width);
        const food = animated.food_state();
        const prey = animated.prey_state();
        control('counts').textContent = `Snakes ${count(view.snakes, 3)}   Retained ${count(view.retainedSnakes, 3)}   Drawn ${count(view.drawnSnakes, 3)}\nFood ${count(food.foods.length, 5)}   Prey ${count(prey.preys.length, 4)}   Frames ${count(view.frames, 8)}   Ignored ${count(view.ignored, 8)}\nQuality ${qualityView.highQuality ? 'HQ' : 'LQ'}   Blend ${qualityView.qualityBlend.toFixed(4)}   Spacing ${qualityView.qualityScale.toFixed(5)}`;
        window.slitherAnimatedSceneReport = { ...view, retainedFoods: food.foods.length,
          foodSources: food.sourceCount, retainedPreys: prey.preys.length, preySources: prey.sourceCount,
          quality: qualityView, wasmExecuted: true, renders, mode, connected: Boolean(connection) };
      }
      pendingFrame = requestAnimationFrame(frame);
    } catch (error) { fail(error); }
  }

  listen(window, 'resize', () => {
    try { renderScene(); lastReadout = -Infinity; } catch (error) { fail(error); }
  });
  listen(control('reset'), 'click', () => { try { reset(); } catch (error) { fail(error); } });
  listen(control('step'), 'click', () => {
    if (mode !== 'synthetic') return;
    try {
      applyFrame(syntheticStep(++anchorStep), false);
      setStatus('Synthetic anchor advanced');
      lastReadout = -Infinity;
    } catch (error) { fail(error); }
  });
  listen(control('skin'), 'change', () => {
    if (!connection) { try { reset(); } catch (error) { fail(error); } }
  });
  listen(control('zoom'), 'change', () => animated.set_zoom(Number(control('zoom').value)));
  listen(control('follow'), 'change', () => animated.set_follows(control('follow').checked));
  listen(control('quality'), 'change', () => quality.set_requested_mode(Number(control('quality').value)));
  listen(control('connect'), 'click', () => {
    if (connection || !simulatorUrl) return;
    mode = 'local';
    heading = 0;
    boost = false;
    try {
      animated.set_connected(false);
      const scene = {
        reset: () => {
          animated.reset();
          foodRandomState = 0x5eed1;
          preyRandomState = 0x7a3e1;
          quality.begin_connection();
          animated.set_follows(control('follow').checked);
          animated.set_zoom(Number(control('zoom').value));
          renderedCamera = undefined;
        },
        apply_frame: (bytes, header) => {
          try { return applyFrame(bytes, header); } catch (error) { fail(error); throw error; }
        },
        snapshot: animated.snapshot.bind(animated),
      };
      connection = connectLoopback({ url: simulatorUrl, wasm, scene, skin: Number(control('skin').value),
        // Packets deliver ordered Setup draws; RAF alone advances animation.
        onFrame() {},
        onStatus(text) {
          if (disposed) return;
          setStatus(text);
          if (text !== 'Connected to local simulator') {
            animated.set_connected(false);
            connection = undefined;
            boost = false;
            updateControls();
          }
        },
      });
      setStatus('Connecting to local simulator…');
      target.focus();
    } catch (error) { setStatus(`Local connection failed: ${String(error)}`); }
    updateControls();
  });
  listen(control('disconnect'), 'click', disconnect);
  listen(target, 'pointerdown', () => target.focus());
  listen(target, 'pointermove', event => {
    const bounds = target.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = (event.clientX - bounds.left) * target.width / bounds.width;
    const y = (event.clientY - bounds.top) * target.height / bounds.height;
    // Visual gaze follows the canvas center independently of transport steering.
    gazeHeading = Math.atan2(y - target.height / 2, x - target.width / 2);
    if (!connection || !renderedCamera) return;
    const head = JSON.parse(animated.snapshot()).ownHead;
    if (!head) return;
    heading = sceneHeading({ x, y,
      width: target.width, height: target.height, camera: renderedCamera, zoom: renderedCamera.zoom, head });
    input();
  });
  listen(target, 'keydown', event => {
    if (event.code === 'Space') { event.preventDefault(); boost = true; input(); }
  });
  listen(target, 'keyup', event => {
    if (event.code === 'Space') { event.preventDefault(); releaseBoost(); }
  });
  listen(target, 'blur', releaseBoost);
  listen(window, 'blur', releaseBoost);
  reset();
  pendingFrame = requestAnimationFrame(frame);
  try {
    const response = await fetch('/scene/config.json', { signal: lifecycle.signal });
    if (!response.ok) throw new Error('Local configuration unavailable');
    const config = await response.json();
    if (disposed) return;
    simulatorUrl = config.simulatorUrl == null ? undefined : loopbackEndpoint(config.simulatorUrl);
    updateControls();
  } catch {
    if (!disposed) setStatus('Synthetic geometry preview; local simulator configuration unavailable');
  }
}

start().catch(fail);
