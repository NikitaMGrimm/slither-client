import init, * as wasm from './pkg/slither_client.js';
import { syntheticScene, syntheticStep } from './synthetic-scene.mjs';
import { connectLoopback, sceneHeading } from './loopback-session.mjs';

const target = document.querySelector('#scene');
const status = document.querySelector('#status');
const counts = document.querySelector('#counts');
const control = id => document.querySelector(`#${id}`);
await init();
const scene = new wasm.Scene();
// Original generated stand-ins, used only by this explicitly synthetic demo.
const sprites = ['#83d5b0', '#efbb62', '#76b9ed'].map(color => {
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
  const context = canvas.getContext('2d');
  context.fillStyle = color; context.beginPath(); context.arc(16, 16, 16, 0, Math.PI * 2); context.fill();
  return canvas;
});
const tile = document.createElement('canvas'); tile.width = 40; tile.height = 40;
const context = tile.getContext('2d'); context.fillStyle = '#151e27'; context.fillRect(0, 0, 40, 40);
context.fillStyle = '#263440'; context.fillRect(0, 0, 1, 1);
const background = new Image(); background.src = tile.toDataURL(); await background.decode();
let connection;
let step = 0;
let heading = 0;
let boost = false;
let simulatorUrl;
let renders = 0;
let mode = 'synthetic';
let renderedCamera = { x: 0, y: 0 };
let pendingRender;
function scheduleRender() {
  if (pendingRender !== undefined) return;
  pendingRender = requestAnimationFrame(() => { pendingRender = undefined; render(); });
}
function render() {
  const view = JSON.parse(scene.snapshot());
  const camera = control('follow').checked && view.ownHead ? view.ownHead : { x: 0, y: 0 };
  renderedCamera = { x: camera.x, y: camera.y };
  scene.render(target, ...sprites, background, camera.x, camera.y, Number(control('zoom').value));
  counts.textContent = `Snakes ${String(view.snakes).padStart(3)}   Food ${String(view.foods).padStart(5)}   Frames ${String(view.frames).padStart(6)}   Ignored ${String(view.ignored).padStart(6)}`;
  window.slitherSceneReport = { ...view, wasmExecuted: true, renders: ++renders, mode, connected: Boolean(connection), camera: { x: camera.x, y: camera.y } };
}
function setStatus(text) { status.textContent = text; }
function disconnect() { connection?.close(); connection = undefined; control('disconnect').disabled = true; }
function reset() {
  disconnect(); scene.reset(); step = 0; mode = 'synthetic'; control('step').disabled = false;
  scene.apply_frame(syntheticScene(Number(control('skin').value)), false);
  setStatus('Deterministic synthetic scene'); render();
}
control('reset').onclick = reset;
control('step').onclick = () => {
  if (mode !== 'synthetic') return;
  scene.apply_frame(syntheticStep(++step), false); setStatus('Synthetic anchor advanced'); render();
};
control('skin').onchange = () => { if (!connection) reset(); };
control('zoom').onchange = render;
control('follow').onchange = render;
control('connect').onclick = () => {
  if (connection || !simulatorUrl) return;
  mode = 'local'; control('step').disabled = true;
  connection = connectLoopback({ url: simulatorUrl, wasm, scene, skin: Number(control('skin').value), onFrame: scheduleRender,
    onStatus(text) {
      setStatus(text);
      if (text !== 'Connected to local simulator') {
        connection = undefined; control('connect').disabled = false; control('disconnect').disabled = true;
        render();
      }
    } });
  control('connect').disabled = true; control('disconnect').disabled = false; target.focus();
};
control('disconnect').onclick = () => { disconnect(); control('connect').disabled = !simulatorUrl; render(); };
function input() { connection?.setInput(heading, boost); }
target.onpointermove = event => {
  const head = JSON.parse(scene.snapshot()).ownHead;
  if (!head) return;
  const bounds = target.getBoundingClientRect();
  heading = sceneHeading({ x: (event.clientX - bounds.left) * target.width / bounds.width,
    y: (event.clientY - bounds.top) * target.height / bounds.height, width: target.width,
    height: target.height, camera: renderedCamera, zoom: Number(control('zoom').value), head });
  input();
};
target.onkeydown = event => { if (event.code === 'Space') { event.preventDefault(); boost = true; input(); } };
target.onkeyup = event => { if (event.code === 'Space') { event.preventDefault(); boost = false; input(); } };
target.onblur = () => { boost = false; input(); };
window.addEventListener('pagehide', disconnect);
reset();
try {
  const config = await (await fetch('/scene/config.json')).json();
  simulatorUrl = config.simulatorUrl;
  control('connect').disabled = !simulatorUrl;
} catch { setStatus('Synthetic scene ready; local simulator configuration unavailable'); }
