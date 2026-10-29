// Platform glue only. No game socket, extension, Canvas fallback or JS geometry/clock model.
import init, { GameplaySlice } from './pkg/slither_wgpu_slice.js';
const canvas = document.getElementById('game');
const status = document.getElementById('status');
let owner;
let raf;
let disposed = false;
function stop(error) {
  disposed = true;
  cancelAnimationFrame(raf);
  owner?.free();
  owner = undefined;
  if (error !== undefined) status.textContent = `GPU slice stopped: ${String(error)}`;
}
addEventListener('pagehide', () => stop(), { once: true });
addEventListener('visibilitychange', () => { if (document.hidden) owner?.pause(); });
try {
  if (!navigator.gpu) throw new Error('WebGPU unavailable; no fallback selected');
  await init();
  if (!disposed) {
    owner = await GameplaySlice.create(canvas);
    if (disposed) { owner.free(); owner = undefined; }
    else {
      const adapter = owner.adapter();
      function draw(now) {
        try {
          const dpr = devicePixelRatio;
          const width = Math.round(canvas.clientWidth * dpr);
          const height = Math.round(canvas.clientHeight * dpr);
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          owner.frame(now, width, height, dpr);
          status.textContent = `Synthetic tick ${String(owner.tick()).padStart(3, '0')}/600 | ${adapter}`;
          if (!disposed) raf = requestAnimationFrame(draw);
        } catch (error) { stop(error); }
      }
      raf = requestAnimationFrame(draw);
    }
  }
} catch (error) { stop(error); }
