import init, * as wasm from './pkg/slither_client.js';
import { syntheticScene, syntheticStep } from './synthetic-scene.mjs';
import { connectLoopback, loopbackEndpoint, sceneHeading } from './loopback-session.mjs';
import { createSyntheticBodyResolver } from './synthetic-body.mjs';

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
  animated.reset(performance.now());
  quality.begin_skin_preview();
  animated.apply_frame(syntheticScene(Number(control('skin').value)), false);
  animated.set_follows(control('follow').checked);
  animated.set_zoom(Number(control('zoom').value));
  anchorStep = 0;
  mode = 'synthetic';
  lastReadout = -Infinity;
  renderedCamera = undefined;
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
      if (mode === 'synthetic') animated.render_standard(target, ...palettes, background, resolveSynthetic, quality);
      else animated.render(target, ...palettes, background, qualityView.qualityScale, false);
      drawsSinceStatistics++;
      renders++;
      const view = JSON.parse(animated.snapshot());
      renderedCamera = { x: view.camera.x, y: view.camera.y, zoom: view.camera.zoom };
      if (nowMs - lastReadout >= 100) {
        lastReadout = nowMs;
        const count = (value, width) => String(value).padStart(width);
        control('counts').textContent = `Snakes ${count(view.snakes, 3)}   Retained ${count(view.retainedSnakes, 3)}   Drawn ${count(view.drawnSnakes, 3)}\nFood ${count(view.foods, 5)}   Frames ${count(view.frames, 8)}   Ignored ${count(view.ignored, 8)}\nQuality ${qualityView.highQuality ? 'HQ' : 'LQ'}   Blend ${qualityView.qualityBlend.toFixed(4)}   Spacing ${qualityView.qualityScale.toFixed(5)}`;
        window.slitherAnimatedSceneReport = { ...view, quality: qualityView, wasmExecuted: true, renders, mode, connected: Boolean(connection) };
      }
      pendingFrame = requestAnimationFrame(frame);
    } catch (error) { fail(error); }
  }

  listen(control('reset'), 'click', reset);
  listen(control('step'), 'click', () => {
    if (mode !== 'synthetic') return;
    animated.apply_frame(syntheticStep(++anchorStep), false);
    setStatus('Synthetic anchor advanced');
    lastReadout = -Infinity;
  });
  listen(control('skin'), 'change', () => { if (!connection) reset(); });
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
      // The existing transport resets without a timestamp; adapt only that call.
      const scene = {
        reset: () => {
          animated.reset(performance.now());
          quality.begin_connection();
          animated.set_follows(control('follow').checked);
          animated.set_zoom(Number(control('zoom').value));
          renderedCamera = undefined;
        },
        apply_frame: animated.apply_frame.bind(animated),
        snapshot: animated.snapshot.bind(animated),
      };
      connection = connectLoopback({ url: simulatorUrl, wasm, scene, skin: Number(control('skin').value),
        // Packets apply immediately in the transport; only RAF advances/draws.
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
