import init, * as wasm from './pkg/slither_client.js';
import { createStockSkinAdapter } from './stock-skin-provider.mjs';
import { createStockClient } from './stock-client.mjs';
import { createStockEntityAssets } from './stock-food-provider.mjs';
import { createStockHostSnapshot } from './stock-host-snapshot.mjs';
import { desktopBackingSize } from './desktop-layout.mjs';
import { createStockGameplay } from './stock-gameplay.mjs';

// Gate-only notifications must not add gameplay control/source observations.
const editNotifications = new Set(['keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
  'copy', 'cut', 'paste', 'selectstart', 'select', 'selectionchange', 'dblclick', 'contextmenu',
  'focus', 'blur', 'focusin', 'focusout', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
  'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel', 'touchcancel',
  'dragstart', 'drag', 'dragenter', 'dragleave', 'dragover', 'drop', 'dragend']);

/** Actual MAIN entry. Session binding is local capability injection, never a page-message command. */
export async function startGamePage({ realm = globalThis, initialize = init, wasmApi = wasm } = {}) {
  const gate = realm[Symbol.for('slither.client.gate.v1')];
  if (!gate || gate.metadata().code !== 'held') throw new Error('Armed document-start gate required');
  const armed = gate.metadata(), document = realm.document, pageUrl = realm.location.href;
  const native = gate.claim(armed.id);
  let scene, quality, controller, gameplay, held, frame, waiting, wakeWaiting, reload;
  let disposed = false;
  const listeners = [];
  const listen = (object, type, handler) => {
    object.addEventListener(type, handler);
    listeners.push(() => object.removeEventListener(type, handler));
  };
  function dispose(code = 'disposed') {
    if (disposed) return;
    disposed = true;
    if (frame !== undefined) native.cancelAnimationFrame(frame);
    if (waiting !== undefined) native.clearTimeout(waiting);
    wakeWaiting?.();
    for (const remove of listeners.splice(0)) remove();
    native.setInput(event => { if (event.type === 'click' && event.target === reload) native.ordinaryReload(); });
    for (const cleanup of [() => gameplay?.dispose(), () => controller?.dispose(),
      () => scene?.free(), () => quality?.free()]) { try { cleanup(); } catch { code = 'client-failed'; } }
    held = undefined;
    native.status(code);
  }
  const fail = error => { dispose(error?.status === 'unsupported' ? 'host-unavailable' : 'client-failed'); };
  listen(realm, 'pagehide', () => dispose());
  let root = realm.document.getElementById('slither-client-root');
  if (!root) { root = realm.document.createElement('section'); root.id = 'slither-client-root';
    (realm.document.body ?? realm.document.documentElement).appendChild(root); }
  let output = realm.document.getElementById('slither-client-status');
  if (!output) { output = realm.document.createElement('p'); output.id = 'slither-client-status'; root.appendChild(output); }
  reload = realm.document.getElementById('slither-client-reload');
  if (!reload) { reload = realm.document.createElement('button'); reload.id = 'slither-client-reload';
    reload.textContent = 'Reload ordinary page'; root.appendChild(reload); }
  const target = realm.document.createElement('canvas'); target.tabIndex = 0; root.appendChild(target);
  const report = code => { output.textContent = `SlitherClient: ${code}`; native.status(code); };
  const size = () => desktopBackingSize(realm.innerWidth, realm.innerHeight);
  native.setInput(event => {
    if (event.type === 'click' && event.target === reload) { native.ordinaryReload(); return; }
    if (editNotifications.has(event.type)) return;
    if (disposed || !controller) return;
    if (event.type === 'resize') {
      try { const backing = size(); controller.resize(backing.width, backing.height); } catch (error) { fail(error); }
      return;
    }
    try { gameplay?.event(event, { width: realm.innerWidth, height: realm.innerHeight }); }
    catch (error) { fail(error); }
  });
  try {
    report('loading');
    await initialize();
    if (disposed) return Object.freeze({ dispose });
    const reader = createStockHostSnapshot({ realm, observer: native,
      readAccessory: () => native.readAccessory() });
    const started = native.now();
    let context;
    const captureReady = () => {
      const capture = reader.capture();
      if (context && (capture.background !== context.background
        || capture.palettes.some((source, index) => source !== context.palettes[index]))) {
        const error = new Error('Renderer context sources changed; reload required'); error.status = 'unsupported'; throw error;
      }
      if (capture.readiness.some(entry => entry.state !== 'ready')) {
        const error = new Error('Waiting for committed host sources'); error.status = 'pending'; throw error;
      }
      return capture;
    };
    let initial;
    while (!disposed) {
      try { initial = captureReady(); break; } catch (error) {
        if (error.status !== 'pending' || native.now() - started >= 10000) { error.status = 'unsupported'; throw error; }
        report('waiting-assets');
        await new Promise(resolve => { wakeWaiting = resolve; waiting = native.setTimeout(resolve, 50); });
        waiting = undefined;
        wakeWaiting = undefined;
      }
    }
    if (disposed) return Object.freeze({ dispose });
    const adapter = createStockSkinAdapter({ realm, random: native.random, readSnapshot() {
      if (held) throw new Error('Stock capture already held');
      held = captureReady();
      return held;
    } });
    const wrapped = { ...adapter,
      beginOperation() {
        try { return adapter.beginOperation(); } catch (error) { held = undefined; throw error; }
      },
      endOperation() { try { adapter.endOperation(); } finally { held = undefined; } },
    };
    const hostAssets = createStockEntityAssets({ realm, random: native.random,
      snapshotForOperation(operation) {
        if (!held || !Object.is(held.revision, operation.revision)) throw new Error('Stock operation capture unavailable');
        return held;
      } });
    const startMs = native.now();
    context = { palettes: initial.palettes, background: initial.background };
    scene = new wasmApi.AnimatedScene(startMs);
    quality = new wasmApi.DesktopQuality(1, startMs);
    const backing = size();
    controller = createStockClient({ scene, quality, adapter: wrapped, hostAssets, target,
      palettes: initial.palettes, background: initial.background, ...backing });
    initial = undefined;
    // The captured context objects cannot silently switch while the scene retains their uses.
    const isCurrentDocument = () => {
      try {
        const current = gate.metadata();
        if (disposed || realm !== realm.top || realm.document !== document || realm.location.href !== pageUrl
          || realm[Symbol.for('slither.client.gate.v1')] !== gate || current.schema !== armed.schema || current.id !== armed.id) return false;
        captureReady();
        return true;
      } catch { return false; }
    };
    gameplay = createStockGameplay({ scene, quality, controller, wasm: wasmApi,
      createSocket: native.createSocket, now: native.now, defer: native.queueMicrotask,
      setInterval: native.setInterval, clearInterval: native.clearInterval,
      onStatus: report, onFatal: fail,
      ...(native.liveProfile === undefined ? {} : { liveProfile: { capabilities: native.liveProfile, isCurrentDocument } }) });
    const tick = now => {
      frame = undefined;
      if (disposed) return;
      try { gameplay.frame(now);
        frame = native.requestAnimationFrame(tick); } catch (error) { fail(error); }
    };
    report('ready-not-connected');
    frame = native.requestAnimationFrame(tick);
    return Object.freeze({
      diagnostics: () => Object.freeze({ ...controller.diagnostics(),
        connected: gameplay.diagnostics().session.connected, gameplay: gameplay.diagnostics(), disposed, captureHeld: Boolean(held) }),
      // Local capability only. The auto-entry supplies no profile and never calls Play.
      play(request) {
        if (disposed) throw new Error('Client disposed');
        captureReady();
        return gameplay.play(request);
      },
      playWithLiveProfile(request) { return gameplay.playWithLiveProfile(request); },
      dispose,
    });
  } catch (error) {
    dispose(error?.status === 'unsupported' ? 'host-unavailable' : 'csp-or-module-unavailable');
    throw error;
  }
}

// Trusted MAIN modules can await the single auto-entry; importing must not claim
// the document again. This capability is never installed on the window/bridge.
export const gamePageRuntime = globalThis[Symbol.for('slither.client.gate.v1')] ? startGamePage() : undefined;
gamePageRuntime?.catch(() => {});
