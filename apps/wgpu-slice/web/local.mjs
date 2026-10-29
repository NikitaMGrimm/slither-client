import init, { LocalGameplay } from './pkg/slither_wgpu_slice.js';
import { localHost } from './local-host.mjs';
const canvas = document.getElementById('game');
const status = document.getElementById('status');
const play = document.getElementById('play');
const stop = document.getElementById('stop');
const endpoint = document.getElementById('endpoint');
const nickname = document.getElementById('nickname');
const skin = document.getElementById('skin');
let host, owner, raf, disposed = false;
const abort = new AbortController();
const listen = (node, type, fn) => node.addEventListener(type, fn, { signal: abort.signal });
const editable = e => e.target instanceof HTMLInputElement;
function extent() {
  const dpr = devicePixelRatio;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return [w, h, dpr];
}
function dispose() {
  if (disposed) return;
  disposed = true; cancelAnimationFrame(raf); abort.abort();
  host?.dispose(); host = undefined;
}
addEventListener('pagehide', dispose, { once: true });
try {
  if (!navigator.gpu) throw new Error('WebGPU unavailable; no fallback');
  await init();
  if (!disposed) {
    owner = await LocalGameplay.create(canvas, performance.now());
    if (disposed) owner.free();
    else {
      const adapter = owner.adapter();
      host = localHost({ owner, socket: url => new WebSocket(url), now: () => performance.now(), extent,
        readout(text, canPlay, failed, error) {
          status.textContent = `${text}\n${adapter}${failed ? `\nHOST ERROR ${String(error)}` : ''}`;
          play.disabled = !canPlay;
        } });
      const start = () => host.call(() => {
        // DOM conversion only; Rust validates ID/endpoint/nickname before any socket exists.
        const id = Number(skin.value);
        if (!Number.isInteger(id) || id < 0 || id > 65) throw new Error('Skin must be 0..65');
        owner.play(endpoint.value, nickname.value, id);
      });
      listen(play, 'click', start);
      listen(stop, 'click', () => host.call(() => owner.stop()));
      listen(window, 'keydown', e => {
        if (editable(e)) return;
        if (e.code === 'Enter' && !e.repeat) { if (owner.can_play()) start(); }
        else if (e.code === 'Escape') host.call(() => owner.stop());
        else host.call(() => { if (owner.key(e.code, true)) e.preventDefault(); });
      });
      listen(window, 'keyup', e => host.call(() => { if (owner.key(e.code, false) && !editable(e)) e.preventDefault(); }));
      listen(window, 'blur', () => host.call(() => owner.blur()));
      listen(document, 'visibilitychange', () => { if (document.hidden) host.call(() => owner.blur()); });
      function pointer(e, down) {
        host.call(() => { const r = canvas.getBoundingClientRect(); if (r.width && r.height) owner.pointer(e.clientX - r.left, e.clientY - r.top, r.width, r.height, down); });
      }
      listen(canvas, 'pointermove', e => pointer(e, false));
      listen(canvas, 'pointerdown', e => { if (e.button === 0) { pointer(e, true); e.preventDefault(); } });
      listen(window, 'pointerup', () => host.call(() => owner.mouse_up()));
      listen(window, 'pointercancel', () => host.call(() => owner.mouse_up()));
      function draw(time) { if (!disposed) { host.frame(time); raf = requestAnimationFrame(draw); } }
      raf = requestAnimationFrame(draw);
    }
  }
} catch (error) { status.textContent = `Local GPU unavailable: ${String(error)}`; dispose(); }
