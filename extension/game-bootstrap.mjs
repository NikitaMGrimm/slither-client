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
  let nickname, bindingOperation, handlingNickname, routing = 0;
  const ownKeys = Reflect.ownKeys, apply = Reflect.apply, prototype = Object.getPrototypeOf;
  const descriptor = Object.getOwnPropertyDescriptor, hasOwn = Object.hasOwn;
  const recordPrototype = Object.prototype, freeze = Object.freeze;
  function nicknameBusy() {
    const operation = bindingOperation ?? handlingNickname;
    const error = new Error('Nickname owner operation active');
    if (operation) {
      // A caller trap may catch the error; publication must still fail afterward.
      if (!operation.failed) { operation.failed = true; operation.primary = error; }
      throw operation.primary;
    }
    throw error;
  }
  function guardNicknameOperation() {
    if (bindingOperation || handlingNickname) nicknameBusy();
  }
  function detachNickname(value) {
    if (!value || nickname !== value) return;
    nickname = undefined;
    let unregister = value.unregister;
    value.unregister = value.handleInput = undefined;
    try { apply(unregister, undefined, []); }
    finally { unregister = undefined; }
  }
  function bindNicknameField(request) {
    guardNicknameOperation();
    if (disposed) throw new Error('Client disposed');
    if (nickname) throw new Error('Nickname field already bound');
    if (routing || held) nicknameBusy();
    const operation = { failed: false, primary: undefined };
    bindingOperation = operation;
    const candidate = { __proto__: null, unregister: undefined, handleInput: undefined };
    let record, lease;
    try {
      const ticket = freeze({ unbind() {
        if (nickname !== candidate) return;
        guardNicknameOperation();
        if (routing || held) nicknameBusy();
        detachNickname(candidate);
      } });
      if (request === null || typeof request !== 'object'
        || ![recordPrototype, null].includes(prototype(request))) throw new TypeError('Closed nickname owner record required');
      const keys = ownKeys(request);
      if (keys.length !== 3 || !['schema', 'element', 'parent'].every(name => keys.includes(name))) {
        throw new TypeError('Closed nickname owner record required');
      }
      record = { __proto__: null, schema: undefined, element: undefined, parent: undefined, inputPolicy: 'nickname-ascii-24' };
      for (const name of keys) {
        const field = descriptor(request, name);
        if (!field || !hasOwn(field, 'value')) throw new TypeError('Nickname owner data fields required');
        record[name] = field.value;
      }
      if (record.schema !== 1) throw new TypeError('Nickname owner schema required');
      if (operation.failed) throw operation.primary;
      lease = native.registerNicknameEditField(record);
      candidate.unregister = descriptor(lease, 'unregister')?.value;
      candidate.handleInput = descriptor(lease, 'handleInput')?.value;
      if (typeof candidate.unregister !== 'function' || typeof candidate.handleInput !== 'function') {
        throw new TypeError('Nickname gate lease required');
      }
      if (operation.failed) throw operation.primary;
      if (disposed || nickname) throw new Error('Nickname owner changed during registration');
      nickname = candidate;
      return ticket;
    } catch (error) {
      if (operation.failed) error = operation.primary;
      let unregister = candidate.unregister;
      candidate.unregister = candidate.handleInput = undefined;
      try { if (unregister) apply(unregister, undefined, []); } catch { /* Registration primary remains authoritative. */ }
      finally { unregister = undefined; }
      throw error;
    } finally {
      record = lease = request = undefined;
      bindingOperation = undefined; operation.primary = undefined;
    }
  }
  const listeners = [];
  const listen = (object, type, handler) => {
    object.addEventListener(type, handler);
    listeners.push(() => object.removeEventListener(type, handler));
  };
  function dispose(code = 'disposed') {
    if (disposed) return;
    guardNicknameOperation();
    disposed = true;
    let failed = false, primary;
    const cleanup = callback => {
      try { callback(); } catch (error) {
        if (!failed) { failed = true; primary = error; }
        code = 'client-failed';
      }
    };
    cleanup(() => detachNickname(nickname));
    if (frame !== undefined) {
      const current = frame; frame = undefined;
      cleanup(() => native.cancelAnimationFrame(current));
    }
    if (waiting !== undefined) {
      const current = waiting; waiting = undefined;
      cleanup(() => native.clearTimeout(current));
    }
    const wake = wakeWaiting; wakeWaiting = undefined;
    cleanup(() => wake?.());
    for (const remove of listeners.splice(0)) cleanup(remove);
    cleanup(() => native.setInput(event => { if (event.type === 'click' && event.target === reload) native.ordinaryReload(); }));
    for (const action of [() => gameplay?.dispose(), () => controller?.dispose(),
      () => scene?.free(), () => quality?.free()]) cleanup(action);
    held = undefined;
    cleanup(() => native.status(code));
    if (failed) throw primary;
  }
  const fail = error => {
    let code = 'client-failed', failed = false;
    try { if (error?.status === 'unsupported') code = 'host-unavailable'; } catch { failed = true; }
    try { dispose(code); } catch { failed = true; }
    if (failed) throw error;
  };
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
    guardNicknameOperation();
    routing++;
    try {
      if (nickname) {
        const value = nickname, operation = { failed: false, primary: undefined };
        handlingNickname = operation;
        try {
          apply(value.handleInput, undefined, [event]);
          if (operation.failed) throw operation.primary;
        } catch (error) {
          if (operation.failed) error = operation.primary;
          // Keep native game owners alive until this gate delivery has unwound.
          try { detachNickname(value); } catch { /* Field cleanup cannot replace the input primary. */ }
          throw error;
        } finally { handlingNickname = undefined; operation.primary = undefined; }
      }
      if (editNotifications.has(event.type)) return;
      if (disposed || !controller) return;
      if (event.type === 'resize') {
        try { const backing = size(); controller.resize(backing.width, backing.height); } catch (error) { fail(error); }
        return;
      }
      try { gameplay?.event(event, { width: realm.innerWidth, height: realm.innerHeight }); }
      catch (error) { fail(error); }
    } finally { routing--; }
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
        guardNicknameOperation();
        if (disposed) throw new Error('Client disposed');
        captureReady();
        return gameplay.play(request);
      },
      playWithLiveProfile(request) { guardNicknameOperation(); return gameplay.playWithLiveProfile(request); },
      bindNicknameField,
      dispose,
    });
  } catch (error) {
    let code = 'csp-or-module-unavailable';
    try { if (error?.status === 'unsupported') code = 'host-unavailable'; } catch { /* Classification is best effort. */ }
    try { dispose(code); } catch { /* Cleanup cannot replace the startup primary. */ }
    throw error;
  }
}

// Trusted MAIN modules can await the single auto-entry; importing must not claim
// the document again. This capability is never installed on the window/bridge.
export const gamePageRuntime = globalThis[Symbol.for('slither.client.gate.v1')] ? startGamePage() : undefined;
gamePageRuntime?.catch(() => {});
