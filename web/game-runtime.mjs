import { createStockSkinAdapter, isUnsupportedStockAccessoryFace } from './stock-skin-provider.mjs';
import { createStockClient } from './stock-client.mjs';
import { createStockEntityAssets } from './stock-food-provider.mjs';
import { createStockHostSnapshot, isPendingStockCapture, assertStockHostCapture } from './stock-host-snapshot.mjs';
import { createStockAccessoryRequest, hasFailedStockAccessoryRequest } from './stock-accessory-request.mjs';
import { desktopBackingSize } from './desktop-layout.mjs';
import { createStockGameplay } from './stock-gameplay.mjs';
import { bindStockHudDom } from './stock-hud-dom.mjs';
import { projectHudView } from './stock-hud-view.mjs';
import { createOwnedHudUi } from './owned-hud-ui.mjs';
import { createOwnedPlayUi } from './owned-play-ui.mjs';
import { createOwnedAppearanceUi } from './owned-appearance-ui.mjs';
import { createAppearancePreview } from './appearance-preview.mjs';
import { createOwnedLoadingUi } from './game-owned-loading-ui.mjs';
import { createOwnedLeaderboardUi } from './owned-leaderboard-ui.mjs';
import { createOwnedMinimapUi } from './owned-minimap-ui.mjs';
import { createOwnedAnnouncementUi } from './owned-announcement-ui.mjs';
import { createOwnedEndScreenUi } from './owned-end-screen-ui.mjs';
import { projectLeaderboardView } from './stock-leaderboard-view.mjs';
import { stockEndpoint } from './stock-session.mjs';

// Gate-only notifications must not add gameplay control/source observations.
const editNotifications = new Set(['keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
  'copy', 'cut', 'paste', 'selectstart', 'select', 'selectionchange', 'dblclick', 'contextmenu',
  'focus', 'blur', 'focusin', 'focusout', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
  'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel', 'touchcancel',
  'dragstart', 'drag', 'dragenter', 'dragleave', 'dragover', 'drop', 'dragend']);

/** Local runtime factory. Importing this module performs no page ownership work. */
export async function startGamePage({ realm = globalThis, initialize, wasmApi, hudReadout = false, ownedHudUi = false, ownedPlayUi = false, ownedMenuUi = false, ownedAppearancePreview = false, ownedLoadingUi = false, ownedLeaderboardUi = false, ownedMinimapUi = false, ownedAnnouncementUi = false, ownedEndScreenUi = false, diagnosticUi = true, localHost } = {}) {
  if (typeof hudReadout !== 'boolean') throw new TypeError('Explicit hudReadout boolean required');
  if (typeof diagnosticUi !== 'boolean') throw new TypeError('Explicit diagnosticUi boolean required');
  if (typeof initialize !== 'function' || wasmApi === null || typeof wasmApi !== 'object') {
    throw new TypeError('Explicit initialize function and wasmApi object required');
  }
  if (typeof ownedHudUi !== 'boolean' || (ownedHudUi && !hudReadout)) {
    throw new TypeError('Explicit ownedHudUi boolean requires hudReadout');
  }
  if (typeof ownedPlayUi !== 'boolean' || (ownedPlayUi && (!hudReadout || !ownedHudUi))) {
    throw new TypeError('Explicit ownedPlayUi boolean requires hudReadout and ownedHudUi');
  }
  if (typeof ownedMenuUi !== 'boolean' || ownedMenuUi && !ownedPlayUi) throw new TypeError('Explicit ownedMenuUi requires ownedPlayUi');
  if (typeof ownedAppearancePreview !== 'boolean' || ownedAppearancePreview && !ownedMenuUi) throw new TypeError('Explicit ownedAppearancePreview requires ownedMenuUi');
  if (typeof ownedLoadingUi !== 'boolean' || ownedLoadingUi && (!ownedPlayUi || diagnosticUi)) throw new TypeError('Explicit ownedLoadingUi requires consumer ownedPlayUi');
  if (typeof ownedLeaderboardUi !== 'boolean' || (ownedLeaderboardUi && (!hudReadout || !ownedHudUi || !ownedPlayUi))) {
    throw new TypeError('Explicit ownedLeaderboardUi boolean requires hudReadout, ownedHudUi and ownedPlayUi');
  }
  if (typeof ownedAnnouncementUi !== 'boolean' || (ownedAnnouncementUi && (!hudReadout || !ownedHudUi))) {
    throw new TypeError('Explicit ownedAnnouncementUi boolean requires hudReadout and ownedHudUi');
  }
  if (typeof ownedMinimapUi !== 'boolean' || (ownedMinimapUi && (!hudReadout || !ownedHudUi))) {
    throw new TypeError('Explicit ownedMinimapUi boolean requires hudReadout and ownedHudUi');
  }
  if (typeof ownedEndScreenUi !== 'boolean' || (ownedEndScreenUi && (!hudReadout || !ownedHudUi))) {
    throw new TypeError('Explicit ownedEndScreenUi boolean requires hudReadout and ownedHudUi');
  }
  if (localHost !== undefined) {
    const href = realm.location?.href;
    const match = typeof href === 'string' && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})(?:[/?#]|$)/.exec(href);
    if (localHost === null || typeof localHost !== 'object' || realm.top !== realm || !match || Number(match[1]) > 65535) {
      throw new TypeError('Local host requires a literal top-level http://127.0.0.1:<port> document');
    }
  }
  const gate = localHost ? localHost.gate : realm[Symbol.for('slither.client.gate.v1')];
  if (!gate || gate.metadata().code !== 'held') throw new Error('Armed document-start gate required');
  const armed = gate.metadata(), document = realm.document, pageUrl = realm.location.href;
  const native = gate.claim(armed.id);
  let scene, quality, controller, gameplay, held, frame, waiting, wakeWaiting, reload, output;
  let disposed = false;
  let requestOwner, requestStartupFailed = false;
  let nickname, bindingOperation, handlingNickname, routing = 0;
  let hud, ownedUi, constructCapabilities, hudOperation, nativeOperation, sourceOperation, hudCapabilities, cleanupActive = false;
  let playUi, controlsLease, playCapabilities, playOperation, playNodes;
  let menuUi, menuCapabilities, MenuPolicy, menuMethods, menuActions = [];
  let PreviewPolicy, previewMethods, preparePreview;
  let loadingUi, projectMenuLoading, loadingInitialized = false, loadingHandoff = false;
  let leaderboardUi, leaderboardProperties, projector, Projector, projectScores, freeProjector;
  let minimapUi, minimapCanvas, readMinimapView;
  let announcementUi, readAnnouncementView;
  let endScreenUi, endScreenProjector, EndScreenProjector, projectEndScreen, freeEndScreen;
  let PlayPolicy, playPolicy, playPolicyMethods, playCapabilityObservation, playGeneration = 0;
  const documentIdentity = hudReadout ? Symbol('HUD document') : undefined;
  const ownKeys = Reflect.ownKeys, apply = Reflect.apply, prototype = Object.getPrototypeOf;
  const descriptor = Object.getOwnPropertyDescriptor, hasOwn = Object.hasOwn;
  const recordPrototype = Object.prototype, freeze = Object.freeze;
  function playFlag(name, ...args) {
    const value = apply(playPolicyMethods[name], playPolicy, args);
    checkHudOperation();
    if (typeof value !== 'boolean') throw new TypeError('Copied Rust Play boolean required');
    return value;
  }
  function synchronous(callback) {
    if (typeof callback !== 'function') return false;
    const asynchronous = [prototype(async function () {}), prototype(function* () {}), prototype(async function* () {})];
    const seen = new Set();
    let current = callback;
    for (let visits = 0; visits < 64; visits++) {
      current = prototype(current);
      if (current === null) break;
      if (seen.has(current) || asynchronous.includes(current)) return false;
      if (ownedPlayUi) {
        // Foreign bound functions retain their kind on a different realm's prototype.
        const kind = descriptor(current, Symbol.toStringTag);
        if (kind && hasOwn(kind, 'value')
          && ['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(kind.value)) return false;
      }
      seen.add(current);
    }
    if (current !== null) return false;
    return !/^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/
      .test(apply(Function.prototype.toString, callback, []));
  }
  function nicknameBusy() {
    const operation = bindingOperation ?? handlingNickname ?? hudOperation ?? nativeOperation ?? sourceOperation ?? playOperation;
    const error = new Error(playOperation ? 'Play owner operation active' : hudOperation || nativeOperation || sourceOperation ? 'HUD owner operation active' : 'Nickname owner operation active');
    if (operation) {
      // A caller trap may catch the error; publication must still fail afterward.
      if (!operation.failed) { operation.failed = true; operation.primary = error; }
      throw operation.primary;
    }
    throw error;
  }
  function guardNicknameOperation() {
    if (bindingOperation || handlingNickname || hudOperation || nativeOperation || sourceOperation || playOperation) nicknameBusy();
  }
  function checkHudOperation() {
    if (hudOperation?.failed) throw hudOperation.primary;
    if (playOperation?.failed) throw playOperation.primary;
    if (ownedPlayUi && nativeOperation?.failed) throw nativeOperation.primary;
  }
  function runPlay(callback) {
    hudIdle();
    const operation = { failed: false, primary: undefined };
    playOperation = operation;
    try {
      const result = callback();
      if (operation.failed) throw operation.primary;
      return result;
    } catch (error) { throw operation.failed ? operation.primary : error; }
    finally { playOperation = undefined; operation.primary = undefined; }
  }
  function copyRecord(value, fields) {
    if (value === null || typeof value !== 'object'
      || ![recordPrototype, null].includes(prototype(value))) throw new TypeError('Closed HUD owner record required');
    const keys = ownKeys(value);
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw new TypeError('Closed HUD owner record required');
    const copy = { __proto__: null };
    for (const name of keys) {
      const field = descriptor(value, name);
      if (!field || !hasOwn(field, 'value')) throw new TypeError('HUD owner data fields required');
      copy[name] = field.value;
    }
    return copy;
  }
  function runNative(callback) {
    guardNicknameOperation();
    const operation = { failed: false, primary: undefined };
    nativeOperation = operation;
    try {
      const result = callback();
      if (operation.failed) throw operation.primary;
      return result;
    } catch (error) { throw operation.failed ? operation.primary : error; }
    finally { nativeOperation = undefined; operation.primary = undefined; }
  }
  function hudIdle() {
    guardNicknameOperation();
    if (disposed) throw new Error('Client disposed');
    if (routing || held || cleanupActive) nicknameBusy();
  }
  function detachHud(value) {
    if (!value || hud !== value) return;
    hud = undefined;
    let release = value.dispose;
    value.readiness = value.render = value.dispose = undefined;
    try { apply(release, undefined, []); }
    finally { release = undefined; }
  }
  function renderHud(value, snapshot) {
    const ready = apply(value.readiness, undefined, []);
    checkHudOperation();
    const view = projectHudView(snapshot, ready);
    checkHudOperation();
    apply(value.render, undefined, [view]);
    checkHudOperation();
  }
  function publishHud(...snapshots) {
    if ((!hud && !leaderboardUi && !announcementUi && !endScreenUi && !(localHost && playUi)) || disposed || cleanupActive) return;
    // This is a post-operation seam, never a held-source or native callback.
    guardNicknameOperation();
    if (held) nicknameBusy();
    const operation = { failed: false, primary: undefined };
    hudOperation = operation;
    try {
      const snapshot = snapshots.length ? snapshots[0] : gameplay.hudSnapshot();
      if (hud) renderHud(hud, snapshot);
      if (leaderboardUi) {
        const ready = leaderboardUi.readiness();
        checkHudOperation();
        const view = projectLeaderboardView(gameplay.leaderboardSnapshot(), snapshot, ready);
        checkHudOperation();
        leaderboardUi.render(view);
        checkHudOperation();
      }
      if (announcementUi) {
        const view = apply(readAnnouncementView, scene, []);
        checkHudOperation();
        announcementUi.render(view);
        checkHudOperation();
      }
      if (minimapUi) {
        const view = apply(readMinimapView, scene, [0, 0, minimapUi.imageRevision()]);
        checkHudOperation();
        minimapUi.render(view);
        checkHudOperation();
      }
      if (endScreenUi) {
        const session = gameplay.diagnostics().session;
        const view = apply(projectEndScreen, endScreenProjector,
          [session.phase, session.playing, session.lifeEnded, Boolean(localHost), snapshot?.final?.score]);
        checkHudOperation();
        endScreenUi.render(view, session.playing);
        checkHudOperation();
      }
      if (localHost && playUi && playFlag('accepted')) {
        const session = gameplay.diagnostics().session;
        if (typeof session.phase !== 'string' || typeof session.playing !== 'boolean') throw new TypeError('Copied Play session observation required');
        if (playFlag('return_ready', session.phase, session.playing)) {
          playUi.unlock();
          checkHudOperation();
          if (apply(playPolicyMethods.complete_return, playPolicy, []) !== undefined) throw new TypeError('Synchronous Rust Play return required');
          checkHudOperation();
        }
      }
      if (playUi) {
        playUi.setPlaying(gameplay.diagnostics().session.playing);
        checkHudOperation();
      }
    }
    catch (error) { throw operation.failed ? operation.primary : error; }
    finally { hudOperation = undefined; operation.primary = undefined; }
  }
  function bindHudReadout(request) {
    hudIdle();
    if (hud) throw new Error('HUD readout already bound');
    const operation = { failed: false, primary: undefined };
    const candidate = { __proto__: null, readiness: undefined, render: undefined, dispose: undefined };
    let committed = false;
    try {
      hudOperation = operation;
      try {
        // Allocate the inert ticket before any reflection or publication.
        const ticket = freeze({ unbind() {
          if (hud !== candidate) return;
          hudIdle();
          const operation = { failed: false, primary: undefined };
          hudOperation = operation;
          try { detachHud(candidate); checkHudOperation(); }
          catch (error) { throw operation.failed ? operation.primary : error; }
          finally { hudOperation = undefined; operation.primary = undefined; }
        } });
        const record = copyRecord(request, ['schema', 'scope', 'nodes']);
        if (record.schema !== 1 || !['readout', 'readout-and-final'].includes(record.scope)) throw new TypeError('HUD owner schema/scope required');
        const nodes = copyRecord(record.nodes, ['schema', 'document', 'mount', 'textPolicy', 'readout', 'final']);
        if (nodes.document !== hudCapabilities.document) throw new TypeError('Captured HUD document required');
        checkHudOperation();
        const snapshot = gameplay.hudSnapshot();
        const binding = bindStockHudDom({ __proto__: null,
          sceneIdentity: snapshot.sceneIdentity, documentIdentity, scope: record.scope,
          dom: hudCapabilities.dom, nodes, isCurrentDocument: hudCapabilities.isCurrentDocument });
        candidate.readiness = binding.readiness;
        candidate.render = binding.render;
        candidate.dispose = binding.dispose;
        checkHudOperation();
        hud = candidate; committed = true;
        renderHud(candidate, snapshot);
        return ticket;
      } catch (error) {
        if (operation.failed) error = operation.primary;
        if (!committed) {
          let release = candidate.dispose;
          candidate.readiness = candidate.render = candidate.dispose = undefined;
          try { if (release) apply(release, undefined, []); } catch { /* Caller primary wins. */ }
          finally { release = undefined; }
        }
        throw error;
      } finally { request = undefined; hudOperation = undefined; operation.primary = undefined; }
    } catch (error) {
      if (committed) { try { fail(error); } catch { /* Publication primary wins. */ } }
      throw error;
    }
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
        if (!hudReadout) { detachNickname(candidate); return; }
        const operation = { failed: false, primary: undefined };
        bindingOperation = operation;
        try {
          detachNickname(candidate);
          if (operation.failed) throw operation.primary;
        } catch (error) { throw operation.failed ? operation.primary : error; }
        finally { bindingOperation = undefined; operation.primary = undefined; }
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
    cleanupActive = true;
    playGeneration++;
    playNodes = undefined;
    let failed = false, primary;
    const cleanup = callback => {
      try { callback(); } catch (error) {
        if (!failed) { failed = true; primary = error; }
        code = 'client-failed';
      }
    };
    cleanup(() => detachNickname(nickname));
    if (controlsLease !== undefined) {
      const lease = controlsLease; controlsLease = undefined;
      cleanup(() => apply(lease.unregister, undefined, []));
    }
    cleanup(() => detachHud(hud));
    if (announcementUi !== undefined) {
      const lease = announcementUi; announcementUi = undefined;
      cleanup(() => lease.dispose());
    }
    readAnnouncementView = undefined;
    if (endScreenUi !== undefined) {
      const lease = endScreenUi; endScreenUi = undefined;
      cleanup(() => lease.dispose());
    }
    const endOwner = endScreenProjector, endRelease = freeEndScreen;
    endScreenProjector = EndScreenProjector = projectEndScreen = freeEndScreen = undefined;
    if (endOwner !== undefined) cleanup(() => apply(endRelease, endOwner, []));
    if (minimapUi !== undefined) {
      const lease = minimapUi; minimapUi = undefined;
      cleanup(() => lease.dispose());
    }
    minimapCanvas = readMinimapView = undefined;
    if (leaderboardUi !== undefined) {
      const lease = leaderboardUi; leaderboardUi = undefined;
      cleanup(() => lease.dispose());
    }
    leaderboardProperties = undefined;
    if (playUi !== undefined) {
      if (menuUi !== undefined) {
        const lease = menuUi; menuUi = undefined;
        cleanup(() => lease.dispose());
      }
      menuActions = []; menuCapabilities = MenuPolicy = menuMethods = undefined;
      const lease = playUi; playUi = undefined;
      cleanup(() => lease.dispose());
    }
    if (ownedUi !== undefined) {
      const lease = ownedUi; ownedUi = undefined;
      cleanup(() => lease.dispose());
    }
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
    for (const action of [() => gameplay?.dispose(), () => controller?.dispose()]) cleanup(action);
    const owner = projector, release = freeProjector;
    projector = projectScores = freeProjector = Projector = undefined;
    if (owner !== undefined) cleanup(() => apply(release, owner, []));
    for (const action of [() => scene?.free(), () => quality?.free()]) cleanup(action);
    held = undefined;
    if (loadingUi !== undefined) {
      const lease = loadingUi; loadingUi = undefined;
      cleanup(() => lease.dispose());
    }
    cleanup(() => {
      // Local hosts have no isolated loader to publish a terminal fallback.
      if (displayStatus(true)) {
        output.textContent = ownedLoadingUi && loadingInitialized ? loadingProjection(code).text : statusText(code);
        checkHudOperation();
      }
    });
    cleanup(() => native.status(code));
    const playOwner = playPolicy, playRelease = playPolicyMethods?.free;
    playPolicy = PlayPolicy = playPolicyMethods = playCapabilityObservation = undefined;
    if (playOwner !== undefined) cleanup(() => apply(playRelease, playOwner, []));
    if (localHost) {
      const host = localHost; localHost = undefined;
      cleanup(() => host.dispose());
    }
    projectMenuLoading = undefined;
    cleanupActive = false;
    if (failed) throw primary;
  }
  const fail = error => {
    let code = 'client-failed', failed = false;
    try { if (error?.status === 'unsupported') code = 'host-unavailable'; } catch { failed = true; }
    try { dispose(code); } catch { failed = true; }
    if (failed) throw error;
  };
  // The selected composition admits raw capabilities before any DOM/listener/input effects.
  if (ownedLeaderboardUi || ownedMinimapUi || ownedAnnouncementUi || ownedEndScreenUi) captureHudCapabilities();
  listen(realm, 'pagehide', () => dispose());
  let root = realm.document.getElementById('slither-client-root');
  if (!root) { root = realm.document.createElement('section'); root.id = 'slither-client-root';
    (realm.document.body ?? realm.document.documentElement).appendChild(root); }
  output = realm.document.getElementById('slither-client-status');
  if (!output) { output = realm.document.createElement('p'); output.id = 'slither-client-status'; root.appendChild(output); }
  if (ownedLoadingUi) output.className = 'slither-client-loading';
  reload = realm.document.getElementById('slither-client-reload');
  if (!reload) { reload = realm.document.createElement('button'); reload.id = 'slither-client-reload';
    reload.textContent = 'Reload ordinary page'; root.appendChild(reload); }
  reload.hidden = !diagnosticUi;
  const target = realm.document.createElement('canvas'); target.tabIndex = 0; root.appendChild(target);
  function statusText(code) {
    if (!ownedPlayUi) return `SlitherClient: ${code}`;
    const labels = { __proto__: null, loading: 'Loading', 'waiting-assets': 'Loading',
      'ready-not-connected': 'Ready', connecting: 'Connecting', connected: 'Connected', disconnected: 'Not connected',
      'host-unavailable': 'Unavailable', 'csp-or-module-unavailable': 'Unavailable',
      'client-failed': 'Failed', disposed: 'Not connected' };
    return `SlitherClient: ${code === 'ready-not-connected' && !playFlag('available') ? 'Unavailable' : labels[code] ?? 'Unavailable'}`;
  }
  function displayStatus(visible) {
    if (diagnosticUi || !ownedPlayUi || !hudCapabilities || !output) return false;
    const { dom, isCurrentDocument } = hudCapabilities;
    const current = () => isCurrentDocument() && dom.ownerDocument(root) === document && dom.isConnected(root)
      && dom.ownerDocument(output) === document && dom.parentNode(output) === root && dom.isConnected(output);
    if (!current()) return false;
    const style = dom.style(output);
    if (!current()) return false;
    dom.setStyle(style, 'display', visible ? '' : 'none');
    return current();
  }
  function loadingProjection(code) {
    const value = apply(projectMenuLoading, undefined, [code, loadingHandoff]);
    checkHudOperation();
    const copy = copyRecord(value, ['visible', 'busy', 'text']);
    if (!Object.isFrozen(value) || typeof copy.visible !== 'boolean' || typeof copy.busy !== 'boolean'
      || typeof copy.text !== 'string' || copy.text.length > 128) throw new TypeError('Copied Rust loading view required');
    return copy;
  }
  const report = code => {
    if (!ownedPlayUi) { output.textContent = statusText(code); native.status(code); return; }
    if (loadingUi) {
      if (loadingInitialized) loadingUi.render(loadingProjection(code));
    } else output.textContent = statusText(code);
    checkHudOperation();
    if (playUi && !disposed) {
      const states = { __proto__: null, 'ready-not-connected': 'ready', connecting: 'connecting', connected: 'connected',
        disconnected: 'not-connected', 'host-unavailable': 'unavailable', 'client-failed': 'failed' };
      if (states[code]) playUi.setStatus(code === 'ready-not-connected' && !playFlag('available') ? 'unavailable' : states[code]);
      checkHudOperation();
    }
    native.status(code);
    checkHudOperation();
  };
  let projectDesktopSize;
  const size = () => {
    if (projectDesktopSize === undefined) {
      projectDesktopSize = descriptor(wasmApi, 'desktop_backing_size')?.value;
      if (!synchronous(projectDesktopSize)) throw new TypeError('Desktop layout Wasm capability required');
    }
    return desktopBackingSize(realm.innerWidth, realm.innerHeight, projectDesktopSize);
  };
  native.setInput(event => {
    if (hudReadout && (hudOperation || nativeOperation || sourceOperation || playOperation)) guardNicknameOperation();
    if (event.type === 'click' && event.target === reload) { native.ordinaryReload(); return; }
    guardNicknameOperation();
    routing++;
    try {
      if (nickname) {
        const value = nickname, operation = { failed: false, primary: undefined };
        handlingNickname = operation;
        try {
          apply(value.handleInput, undefined, [event]);
          if (menuUi && event.type === 'input' && event.target === playNodes.nickname) {
            menuUi.rememberNickname(playCapabilities.controls.inputValue(playNodes.nickname));
          }
          if (operation.failed) throw operation.primary;
        } catch (error) {
          if (operation.failed) error = operation.primary;
          // Keep native game owners alive until this gate delivery has unwound.
          try { detachNickname(value); } catch { /* Field cleanup cannot replace the input primary. */ }
          throw error;
        } finally { handlingNickname = undefined; operation.primary = undefined; }
      }
      if (editNotifications.has(event.type)) return;
      // Keep menu presses out of steering/boost; releases still clear existing held input.
      if (menuUi && menuActions.some(action => action.button === event.target)
        && !['keyup', 'mouseup', 'pointerup', 'blur'].includes(event.type)) return;
      if (disposed || !controller) return;
      if (event.type === 'resize') {
        try {
          const backing = size();
          if (hudReadout) {
            runNative(() => gameplay.resize(backing.width, backing.height));
            publishHud();
          } else controller.resize(backing.width, backing.height);
        } catch (error) { fail(error); }
        return;
      }
      try {
        const deliver = () => gameplay?.event(event, { width: realm.innerWidth, height: realm.innerHeight });
        if (hudReadout) runNative(deliver); else deliver();
      }
      catch (error) { fail(error); }
    } finally { routing--; }
  });
  function captureHudCapabilities() {
    if (hudReadout) {
      const group = copyRecord(descriptor(native, 'hudDom')?.value, ['schema', 'document', 'dom', 'isCurrentDocument']);
      const names = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling',
        'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
      const dom = copyRecord(group.dom, names);
      if (group.schema !== 1 || group.document !== document || !Object.isFrozen(descriptor(native, 'hudDom').value)
        || !Object.isFrozen(group.dom) || typeof group.isCurrentDocument !== 'function'
        || names.some(name => typeof dom[name] !== 'function')) throw new TypeError('Complete native HUD DOM group required');
      if (ownedHudUi && (!synchronous(group.isCurrentDocument) || names.some(name => !synchronous(dom[name])))) {
        throw new TypeError('Synchronous native HUD DOM group required');
      }
      const guarded = callback => (...args) => {
        checkHudOperation();
        const result = apply(callback, undefined, args);
        checkHudOperation();
        return result;
      };
      for (const name of names) dom[name] = guarded(dom[name]);
      hudCapabilities = { document: group.document, dom, isCurrentDocument: guarded(group.isCurrentDocument) };
      if (ownedHudUi) {
        const captured = descriptor(native, 'ownedHudDom')?.value;
        const construction = copyRecord(captured, ['schema', 'document', 'dom']);
        const names = ['createElement', 'createTextNode', 'appendChild', 'removeChild'];
        const construct = copyRecord(construction.dom, names);
        if (construction.schema !== 1 || construction.document !== group.document || !Object.isFrozen(captured)
          || !Object.isFrozen(construction.dom) || names.some(name => !synchronous(construct[name]))) {
          throw new TypeError('Complete native owned HUD DOM group required');
        }
        for (const name of names) construct[name] = guarded(construct[name]);
        constructCapabilities = freeze(construct);
      }
      if (ownedAppearancePreview) {
        const raw = descriptor(native, 'appearancePreviewDom')?.value;
        const group = copyRecord(raw, ['schema', 'document', 'prepare']);
        if (group.schema !== 1 || group.document !== document || !Object.isFrozen(raw) || !synchronous(group.prepare)) {
          throw new TypeError('Captured appearance preview Canvas required');
        }
        preparePreview = (...args) => {
          checkHudOperation();
          const frame = apply(group.prepare, undefined, args);
          let finish;
          try {
            const copied = copyRecord(frame, ['context', 'finish']); finish = copied.finish;
            if (!Object.isFrozen(frame) || !synchronous(finish)) throw new TypeError('Captured preview frame required');
            checkHudOperation();
            return freeze({ context: copied.context, finish() {
              const result = apply(finish, undefined, []); checkHudOperation(); return result;
            } });
          } catch (error) {
            try { if (typeof finish === 'function') apply(finish, undefined, []); } catch { /* Keep the first failure. */ }
            throw error;
          }
        };
        PreviewPolicy = descriptor(wasmApi, 'AppearancePreview')?.value;
        const base = typeof PreviewPolicy === 'function' && descriptor(PreviewPolicy, 'prototype')?.value;
        const names = ['select', 'revision', 'needs_draw', 'render', 'free'];
        if (!synchronous(PreviewPolicy) || names.some(name => !synchronous(base && descriptor(base, name)?.value))) {
          throw new TypeError('Captured Rust appearance preview required');
        }
        previewMethods = freeze(Object.fromEntries(names.map(name => [name, descriptor(base, name).value])));
      }
      if (ownedMinimapUi) {
        const captured = descriptor(native, 'minimapDom')?.value;
        const group = copyRecord(captured, ['schema', 'document', 'canvas']);
        const names = ['context', 'resize', 'set', 'call', 'upload'];
        const canvas = copyRecord(group.canvas, names);
        if (group.schema !== 1 || group.document !== document || !Object.isFrozen(captured)
          || !Object.isFrozen(group.canvas) || names.some(name => !synchronous(canvas[name]))) {
          throw new TypeError('Complete synchronous native minimap DOM group required');
        }
        for (const name of names) canvas[name] = guarded(canvas[name]);
        minimapCanvas = freeze(canvas);
        const scenePrototype = descriptor(wasmApi.AnimatedScene, 'prototype')?.value;
        for (const name of ['enable_minimap_tracking', 'minimap_view', 'observe_minimap_ui_fraction']) {
          const method = descriptor(scenePrototype, name)?.value;
          if (!synchronous(method)) throw new TypeError(`Minimap Wasm capability required: ${name}`);
          if (name === 'minimap_view') readMinimapView = method;
        }
      }
      if (ownedPlayUi) {
        if (ownedLoadingUi) {
          projectMenuLoading = descriptor(wasmApi, 'menu_loading_view')?.value;
          if (!synchronous(projectMenuLoading)) throw new TypeError('Captured Rust loading projection required');
        }
        const captured = descriptor(native, 'ownedPlayDom')?.value;
        if (captured === undefined) throw new TypeError('Complete native owned Play DOM group required');
        const group = copyRecord(captured, ['schema', 'document', 'dom', 'createControlsLease']);
        const names = ['inputValue', 'inputMaxLength', 'inputAutocompleteOff', 'buttonType', 'buttonDisabled'];
        const controls = copyRecord(group.dom, names);
        if (group.schema !== 1 || group.document !== document || !Object.isFrozen(captured)
          || !Object.isFrozen(group.dom) || !synchronous(group.createControlsLease)
          || names.some(name => !synchronous(controls[name]))) {
          throw new TypeError('Complete synchronous native owned Play DOM group required');
        }
        for (const name of names) controls[name] = guarded(controls[name]);
        playCapabilities = { controls: freeze(controls), createControlsLease: guarded(group.createControlsLease) };
        PlayPolicy = descriptor(wasmApi, 'PlayAdmission')?.value;
        const policyPrototype = typeof PlayPolicy === 'function' && descriptor(PlayPolicy, 'prototype')?.value;
        const policyNames = ['available', 'accepted', 'nickname_valid', 'accept', 'lock_unavailable', 'return_ready', 'complete_return', 'free'];
        if (!synchronous(PlayPolicy) || policyNames.some(name => !synchronous(policyPrototype && descriptor(policyPrototype, name)?.value))) {
          throw new TypeError('Captured Rust Play admission required');
        }
        playPolicyMethods = freeze(Object.fromEntries(policyNames.map(name => [name, descriptor(policyPrototype, name).value])));
        playCapabilityObservation = [Boolean(localHost), localHost ? false : native.liveProfile !== undefined];
        if (ownedMenuUi) {
          const raw = descriptor(native, 'menuPreferences')?.value;
          const group = copyRecord(raw, ['schema', 'document', 'read', 'write', 'setNickname']);
          if (group.schema !== 1 || group.document !== document || !Object.isFrozen(raw)
            || ['read', 'write', 'setNickname'].some(name => !synchronous(group[name]))) throw new TypeError('Captured menu preferences required');
          menuCapabilities = freeze(Object.fromEntries(['read', 'write', 'setNickname'].map(name => [name, guarded(group[name])])));
          MenuPolicy = descriptor(wasmApi, 'MenuPreferences')?.value;
          const methods = typeof MenuPolicy === 'function' && descriptor(MenuPolicy, 'prototype')?.value;
          if (!synchronous(MenuPolicy) || ['view', 'action', 'set_nickname', 'serialize', 'free']
            .some(name => !synchronous(methods && descriptor(methods, name)?.value))) throw new TypeError('Captured Rust menu policy required');
          menuMethods = freeze(Object.fromEntries(['view', 'action', 'set_nickname', 'serialize', 'free']
            .map(name => [name, descriptor(methods, name).value])));
        }
      }
      if (ownedEndScreenUi) {
        const constructor = descriptor(wasmApi, 'EndScreenProjector');
        const base = constructor && hasOwn(constructor, 'value') ? constructor.value : undefined;
        const shape = typeof base === 'function' ? descriptor(base, 'prototype') : undefined;
        const methods = shape && hasOwn(shape, 'value') ? shape.value : undefined;
        const project = methods && descriptor(methods, 'project'), release = methods && descriptor(methods, 'free');
        if (!synchronous(base) || !project || !hasOwn(project, 'value') || !synchronous(project.value)
          || !release || !hasOwn(release, 'value') || !synchronous(release.value)) {
          throw new TypeError('Synchronous own-data end-screen projector required');
        }
        EndScreenProjector = base; projectEndScreen = project.value; freeEndScreen = release.value;
      }
      if (ownedLeaderboardUi) {
        const captured = descriptor(native, 'leaderboardDom')?.value;
        const group = copyRecord(captured, ['schema', 'document', 'properties']);
        const properties = copyRecord(group.properties, ['setTranslate']);
        if (group.schema !== 1 || group.document !== document || !Object.isFrozen(captured)
          || !Object.isFrozen(group.properties) || !synchronous(properties.setTranslate)) {
          throw new TypeError('Complete synchronous native leaderboard DOM group required');
        }
        const constructor = descriptor(wasmApi, 'LeaderboardScoreProjector');
        const base = constructor && hasOwn(constructor, 'value') ? constructor.value : undefined;
        const shape = typeof base === 'function' ? descriptor(base, 'prototype') : undefined;
        const methods = shape && hasOwn(shape, 'value') && shape.value !== null && typeof shape.value === 'object'
          ? shape.value : undefined;
        const project = methods && descriptor(methods, 'project'), release = methods && descriptor(methods, 'free');
        if (!synchronous(base) || !project || !hasOwn(project, 'value') || !synchronous(project.value)
          || !release || !hasOwn(release, 'value') || !synchronous(release.value)) {
          throw new TypeError('Synchronous own-data leaderboard score projector required');
        }
        Projector = base; projectScores = project.value; freeProjector = release.value;
        leaderboardProperties = freeze({ setTranslate: guarded(properties.setTranslate) });
      }
    }
  }
  try {
    if (!ownedLeaderboardUi && !ownedMinimapUi && !ownedAnnouncementUi && !ownedEndScreenUi) captureHudCapabilities();
    if (ownedLoadingUi) runNative(() => {
      loadingUi = createOwnedLoadingUi({ document, parent: output, dom: hudCapabilities.dom,
        construct: constructCapabilities, isCurrentDocument: hudCapabilities.isCurrentDocument, branded: true });
      output.textContent = '';
      loadingUi.mount();
      // Static pre-Wasm fallback only; initialized projections always come from Rust.
      loadingUi.render({ visible: true, busy: true, text: 'Loading client…' });
    });
    report('loading');
    await initialize();
    if (disposed) return Object.freeze({ dispose });
    if (ownedLoadingUi) runNative(() => {
      loadingInitialized = true;
      loadingUi.render(loadingProjection('loading'));
    });
    if (ownedPlayUi) runNative(() => {
      playPolicy = new PlayPolicy(...playCapabilityObservation);
      playCapabilityObservation = undefined;
    });
    if (localHost) {
      if (!synchronous(localHost.bindSkinPolicy) || !synchronous(wasmApi.resolve_local_skin)) {
        throw new TypeError('Local Rust skin policy binding required');
      }
      runNative(() => localHost.bindSkinPolicy(wasmApi.resolve_local_skin));
    }
    if (ownedLeaderboardUi) runNative(() => { projector = new Projector(); });
    if (ownedEndScreenUi) runNative(() => { endScreenProjector = new EndScreenProjector(); });
    const started = native.now();
    let reader;
    let context;
    const pendingCaptures = new WeakSet();
    const captureReady = () => {
      if (localHost && !localHost.isCurrentDocument()) throw new Error('Current local game document required');
      if (!localHost && !reader) {
        // Keep the existing startup waiter; do not inspect/allocate a lazy entry
        // before the held host has finished constructing its cache.
        if (!native.completed()) {
          const error = new Error('Waiting for host asset construction'); error.status = 'pending'; throw error;
        }
        if (native.selectedAccessoryRequest) assertStockHostCapture(realm, native);
        try {
          requestOwner = !native.selectedAccessoryRequest ? undefined : createStockAccessoryRequest({
            native: native.selectedAccessoryRequest, clock: native, Request: wasmApi.SelectedAccessoryRequest,
            resolveId: wasmApi.stock_accessory_id, started, deadline: started + 10000 });
          if (!native.selectedAccessoryRequest || requestOwner) {
            if (requestOwner) listeners.push(() => requestOwner.dispose());
            reader = createStockHostSnapshot({ realm, observer: native, requestOwner,
              readAccessory: () => native.readAccessory(), resolveAccessoryId: wasmApi.stock_accessory_id,
              accessorySource: native.accessorySource });
            listeners.push(() => reader.dispose());
          }
        } catch (error) { requestStartupFailed = true; throw error; }
        if (!reader) {
          const error = new Error('Waiting for selected accessory entry'); error.status = 'pending'; throw error;
        }
      }
      const capture = localHost ? localHost.sources : reader.capture();
      if (context && (capture.background !== context.background
        || capture.backgroundImage !== context.backgroundImage
        || (capture.appearanceMode ?? 'face') !== context.appearanceMode
        || capture.palettes.some((source, index) => source !== context.palettes[index]))) {
        const error = new Error('Renderer context sources changed; reload required'); error.status = 'unsupported'; throw error;
      }
      if (!localHost && capture.readiness.some(entry => entry.state !== 'ready')) {
        const error = new Error('Waiting for committed host sources'); error.status = 'pending';
        pendingCaptures.add(error); throw error;
      }
      return capture;
    };
    let initial;
    while (!disposed) {
      try { initial = captureReady(); break; } catch (error) {
        if (requestStartupFailed || requestOwner && hasFailedStockAccessoryRequest(requestOwner)) throw error;
        if (error.status !== 'pending' || native.now() - started >= 10000) { error.status = 'unsupported'; throw error; }
        report('waiting-assets');
        await new Promise(resolve => { wakeWaiting = resolve; waiting = native.setTimeout(resolve, 50); });
        waiting = undefined;
        wakeWaiting = undefined;
      }
    }
    if (disposed) return Object.freeze({ dispose });
    const adapter = localHost ? localHost.sources.adapter : createStockSkinAdapter({ realm, random: native.random,
      resolveSkin: wasmApi.resolve_skin, validateCustomPaletteMask: wasmApi.stock_custom_palette_mask_valid,
      appearanceMode: initial.appearanceMode ?? 'face', resolveAccessoryForward: wasmApi.stock_accessory_forward, readSnapshot() {
      if (held) throw new Error('Stock capture already held');
      held = captureReady();
      return held;
    } });
    const wrapped = { ...adapter,
      beginOperation() {
        if (hudReadout) sourceOperation = { failed: false, primary: undefined };
        try {
          if (localHost) {
            if (held) throw new Error('Local capture already held');
            held = captureReady();
          }
          return adapter.beginOperation();
        }
        catch (error) {
          if (sourceOperation?.failed) error = sourceOperation.primary;
          sourceOperation = held = undefined; throw error;
        }
      },
      endOperation() {
        try {
          adapter.endOperation();
          reader?.assertAccessoryLoad();
          if (sourceOperation?.failed) throw sourceOperation.primary;
        } catch (error) { throw sourceOperation?.failed ? sourceOperation.primary : error; }
        finally { held = sourceOperation = undefined; }
      },
    };
    const hostAssets = localHost ? localHost.sources.hostAssets : createStockEntityAssets({ realm, random: native.random,
      snapshotForOperation(operation) {
        if (!held || !Object.is(held.revision, operation.revision)) throw new Error('Stock operation capture unavailable');
        return held;
      } });
    const startMs = native.now();
    context = { palettes: initial.palettes, background: initial.background,
      appearanceMode: initial.appearanceMode ?? 'face',
      backgroundImage: initial.backgroundImage };
    scene = new wasmApi.AnimatedScene(startMs);
    scene.enable_nicknames();
    if (ownedAnnouncementUi) {
      if (typeof scene.enable_announcement_tracking !== 'function' || typeof scene.announcement_view !== 'function') {
        throw new TypeError('Native announcement capabilities required');
      }
      readAnnouncementView = scene.announcement_view;
      scene.enable_announcement_tracking();
    }
    if (ownedMinimapUi) scene.enable_minimap_tracking();
    if (initial.backgroundImage !== undefined) scene.set_background_backdrop(initial.backgroundImage);
    if (hudReadout) scene.enable_score_tracking();
    quality = new wasmApi.DesktopQuality(1, startMs);
    const backing = size();
    controller = createStockClient({ StockControllerPolicy: wasmApi.StockControllerPolicy, scene, quality, adapter: wrapped, hostAssets, target,
      appearanceMode: context.appearanceMode,
      palettes: initial.palettes, background: initial.background, ...backing });
    initial = undefined;
    // The captured context objects cannot silently switch while the scene retains their uses.
    const isCurrentDocument = () => {
      try {
        if (localHost) return !disposed && localHost.isCurrentDocument();
        const current = gate.metadata();
        if (disposed || realm !== realm.top || realm.document !== document || realm.location.href !== pageUrl
          || realm[Symbol.for('slither.client.gate.v1')] !== gate || current.schema !== armed.schema || current.id !== armed.id) return false;
        captureReady();
        return true;
      } catch { return false; }
    };
    gameplay = createStockGameplay({ GameplayPolicy: wasmApi.GameplayPolicy, scene, quality, controller, wasm: wasmApi,
      createSocket: native.createSocket, now: native.now,
      defer: hudReadout ? callback => native.queueMicrotask(() => {
        if (disposed) return;
        try {
          const before = gameplay.hudSnapshot();
          const beforeRows = ownedLeaderboardUi ? gameplay.leaderboardSnapshot() : undefined;
          runNative(callback);
          const after = gameplay.hudSnapshot();
          const rowsChanged = ownedLeaderboardUi && gameplay.leaderboardSnapshot() !== beforeRows;
          if (after !== null && (after !== before || rowsChanged || localHost || ownedMinimapUi || ownedPlayUi || ownedAnnouncementUi || ownedEndScreenUi)) publishHud(after);
        } catch (error) { fail(error); }
      }) : native.queueMicrotask,
      setInterval: ownedMinimapUi ? (callback, milliseconds) => native.setInterval(() => {
        if (disposed) return;
        try { runNative(callback); publishHud(); } catch (error) { fail(error); }
      }, milliseconds) : native.setInterval,
      clearInterval: native.clearInterval,
      onStatus: hudReadout ? code => nativeOperation ? report(code) : runNative(() => report(code)) : report,
      onFatal: hudReadout ? error => {
        if (!nativeOperation) return fail(error);
        if (!nativeOperation.failed) { nativeOperation.failed = true; nativeOperation.primary = error; }
      } : fail,
      ...(hudReadout ? { hudReadout: true } : {}),
      ...(ownedMinimapUi ? { minimapTracking: true } : {}),
      ...(ownedAnnouncementUi ? { announcementTracking: true } : {}),
      ...(localHost ? { localSession: true } : {}),
      ...(ownedLeaderboardUi ? { leaderboardRows: true, leaderboardProjector: freeze({
        project(tableMax, counts, fractionalMasses) {
          if (disposed || cleanupActive) return;
          return runNative(() => apply(projectScores, projector, [tableMax, counts, fractionalMasses]));
        },
      }) } : {}),
      ...(localHost || native.liveProfile === undefined ? {} : { liveProfile: { capabilities: native.liveProfile, isCurrentDocument } }) });
    const tick = now => {
      frame = undefined;
      if (disposed) return;
      try {
        if (hudReadout) { runNative(() => gameplay.frame(now)); publishHud(); }
        else gameplay.frame(now);
        frame = native.requestAnimationFrame(tick); } catch (error) { fail(error); }
    };
    // Visible startup needs its local binder before ready; legacy allocation stays after RAF registration.
    const createRuntime = () => Object.freeze({
      diagnostics: () => Object.freeze({ ...controller.diagnostics(),
        connected: gameplay.diagnostics().session.connected, gameplay: gameplay.diagnostics(), disposed, captureHeld: Boolean(held) }),
      play(request) {
        guardNicknameOperation();
        if (disposed) throw new Error('Client disposed');
        if (hudReadout) return runNative(() => { captureReady(); return gameplay.play(request); });
        captureReady();
        return gameplay.play(request);
      },
      playWithLiveProfile(request) {
        guardNicknameOperation();
        return hudReadout ? runNative(() => gameplay.playWithLiveProfile(request)) : gameplay.playWithLiveProfile(request);
      },
      bindNicknameField,
      ...(hudReadout ? { bindHudReadout } : {}),
      dispose,
    });
    let runtime;
    if (ownedHudUi) {
      runtime = createRuntime();
      hudIdle();
      const operation = { failed: false, primary: undefined };
      let nodes;
      hudOperation = operation;
      try {
        ownedUi = createOwnedHudUi({ document: hudCapabilities.document, parent: root,
          dom: hudCapabilities.dom, construct: constructCapabilities,
          isCurrentDocument: hudCapabilities.isCurrentDocument });
        checkHudOperation();
        nodes = ownedUi.mount();
        checkHudOperation();
      } catch (error) { throw operation.failed ? operation.primary : error; }
      finally { hudOperation = undefined; operation.primary = undefined; }
      // Binding has its own idle protocol and takes the one genuine initial snapshot.
      runtime.bindHudReadout({ schema: 1, scope: 'readout-and-final', nodes });
    }
    if (ownedPlayUi) {
      const generation = playGeneration;
      const settle = state => {
        if (disposed || generation !== playGeneration) return;
        try { runPlay(() => playUi.setStatus(state)); }
        catch (error) { fail(error); }
      };
      const onPlay = () => {
        if (disposed || cleanupActive || generation !== playGeneration) return;
        let request, promise;
        try {
          runPlay(() => {
            if (playFlag('accepted')) return;
            let endpoint, nickname;
            try {
              endpoint = playCapabilities.controls.inputValue(playNodes.endpoint);
              nickname = playCapabilities.controls.inputValue(playNodes.nickname);
              if (endpoint === '') { playUi.setStatus('empty-endpoint'); return; }
              if (typeof endpoint !== 'string' || endpoint.length > 128) { playUi.setStatus('invalid-endpoint'); return; }
              try { endpoint = stockEndpoint(endpoint); }
              catch { playUi.setStatus('invalid-endpoint'); return; }
              if (localHost && endpoint !== localHost.endpoint) { playUi.setStatus('invalid-endpoint'); return; }
              if (typeof nickname !== 'string' || !playFlag('nickname_valid', nickname)) {
                playUi.setStatus('invalid-nickname'); return;
              }
              const selection = menuUi ? menuUi.selection(nickname) : { nickname, skin: 0, customSkin: new Uint8Array() };
              if (!playFlag('accept')) return;
              playUi.lock();
              playUi.setStatus('preparing');
              request = { endpoint, ...selection,
                ...(localHost ? { profile: localHost.profile } : {}) };
            } finally { endpoint = nickname = undefined; }
          });
          // The existing native/profile owner may run only after the Play guard unwinds.
          if (request !== undefined) {
            if (localHost) { runtime.play(request); settle('connecting'); }
            else {
              promise = runtime.playWithLiveProfile(request);
              promise.then(() => settle('connecting'), () => settle('failed')).catch(() => {});
            }
          }
        } catch (error) { fail(error); }
        finally { request = promise = undefined; }
      };
      runPlay(() => {
        playUi = createOwnedPlayUi({ document: hudCapabilities.document, parent: root,
          dom: hudCapabilities.dom, construct: constructCapabilities,
          controls: playCapabilities.controls, isCurrentDocument: hudCapabilities.isCurrentDocument,
          projectStartPage: wasmApi.start_page_view }, diagnosticUi, value => menuUi?.setDisabled(value), ownedLoadingUi);
        checkHudOperation();
        const mounted = playUi.mount();
        checkHudOperation();
        const nodes = copyRecord(mounted, ['schema', 'document', 'mount', 'endpoint', 'endpointParent',
          'nickname', 'nicknameParent', 'button', 'buttonParent']);
        if (nodes.schema !== 1 || nodes.document !== document || !Object.isFrozen(mounted)
          || nodes.buttonParent !== nodes.mount
          || new Set([document, root, nodes.mount, nodes.endpoint, nodes.endpointParent,
            nodes.nickname, nodes.nicknameParent, nodes.button]).size !== 8) {
          throw new TypeError('Exact owned Play nodes required');
        }
        for (const [node, parent] of [[nodes.mount, root], [nodes.endpointParent, nodes.mount],
          [nodes.nicknameParent, nodes.mount], [nodes.endpoint, nodes.endpointParent],
          [nodes.nickname, nodes.nicknameParent], [nodes.button, nodes.mount]]) {
          if (hudCapabilities.dom.parentNode(node) !== parent) throw new TypeError('Exact owned Play parents required');
        }
        checkHudOperation();
        playNodes = nodes;
        if (localHost) {
          localHost.presetEndpoint(nodes.endpoint);
          checkHudOperation();
        }
        if (ownedMenuUi) {
          const preview = ownedAppearancePreview ? createAppearancePreview({ document,
            dom: hudCapabilities.dom, construct: constructCapabilities, Policy: PreviewPolicy, methods: previewMethods,
            local: Boolean(localHost), worldTarget: target, prepare: preparePreview,
            isCurrentDocument: hudCapabilities.isCurrentDocument,
            isCurrentGeneration: () => !disposed && !cleanupActive && generation === playGeneration,
            check: checkHudOperation,
            defer(job) {
              native.queueMicrotask(() => {
                if (disposed || cleanupActive || generation !== playGeneration) return;
                try { hudIdle(); runNative(job); } catch (error) { fail(error); }
              });
            },
            withSources(callback) {
              let begun = false, failed = false, primary, result;
              try {
                let pending = false;
                try { wrapped.beginOperation(); begun = true; }
                catch (error) {
                  // Only our readiness rejection can become a Rust pending view.
                  // The failed begin has already cleared the capture; it has no matching end.
                  if (!pendingCaptures.has(error) && !isPendingStockCapture(error)) throw error;
                  pending = true;
                }
                checkHudOperation();
                result = callback(pending ? () => freeze({ __proto__: null, status: 'pending' }) : request => {
                  checkHudOperation();
                  let value;
                  try { value = adapter.resolveRecipe(request); }
                  catch (error) {
                    if (!isUnsupportedStockAccessoryFace(error)) throw error;
                    value = freeze({ __proto__: null, status: 'unsupported' });
                  }
                  checkHudOperation();
                  return value;
                });
                checkHudOperation();
              } catch (error) { failed = true; primary = error; }
              finally {
                if (begun) {
                  try { wrapped.endOperation(); checkHudOperation(); }
                  catch (error) { if (!failed) { failed = true; primary = error; } }
                }
              }
              if (failed) throw primary;
              return result;
            },
          }) : undefined;
          if (preview) listeners.push(() => preview.dispose());
          menuUi = createOwnedAppearanceUi({ document, parent: nodes.mount, nickname: nodes.nickname,
            dom: hudCapabilities.dom, construct: constructCapabilities, controls: playCapabilities.controls,
            capabilities: menuCapabilities, Policy: MenuPolicy, policyMethods: menuMethods, local: Boolean(localHost),
            isCurrentDocument: hudCapabilities.isCurrentDocument, preview });
          menuActions = menuUi.mount().map(action => freeze({ button: action.button, parent: action.parent,
            onPress() {
              if (disposed || cleanupActive || generation !== playGeneration) return;
              try {
                if (playFlag('accepted')) return;
                runPlay(() => action.onPress());
              } catch (error) { fail(error); }
            } }));
        }
      });
      runtime.bindNicknameField({ schema: 1, element: playNodes.nickname, parent: playNodes.nicknameParent });
      runPlay(() => {
        const raw = playCapabilities.createControlsLease({ schema: ownedMenuUi ? 2 : 1,
          endpoint: playNodes.endpoint, endpointParent: playNodes.endpointParent,
          button: playNodes.button, buttonParent: playNodes.buttonParent, onPlay,
          ...(ownedMenuUi ? { actions: menuActions } : {}) });
        // Retain cleanup authority before binding can publish native effects.
        controlsLease = copyRecord(raw, ['bind', 'unregister']);
        if (!Object.isFrozen(raw) || !synchronous(controlsLease.bind) || !synchronous(controlsLease.unregister)) {
          throw new TypeError('Frozen owned Play control lease required');
        }
        checkHudOperation();
        if (apply(controlsLease.bind, undefined, []) !== undefined) throw new TypeError('Synchronous owned Play binding required');
        checkHudOperation();
      });
      runPlay(() => { if (playFlag('lock_unavailable')) playUi.lock(); });
    }
    if (ownedLeaderboardUi) {
      hudIdle();
      const operation = { failed: false, primary: undefined };
      hudOperation = operation;
      try {
        const snapshot = gameplay.hudSnapshot();
        leaderboardUi = createOwnedLeaderboardUi({ sceneIdentity: snapshot.sceneIdentity, documentIdentity,
          document: hudCapabilities.document, parent: root, dom: hudCapabilities.dom,
          construct: constructCapabilities, properties: leaderboardProperties,
          isCurrentDocument: hudCapabilities.isCurrentDocument });
        checkHudOperation();
        leaderboardUi.mount();
        checkHudOperation();
      } catch (error) { throw operation.failed ? operation.primary : error; }
      finally { hudOperation = undefined; operation.primary = undefined; }
      publishHud();
    }
    if (ownedMinimapUi) {
      hudIdle();
      const operation = { failed: false, primary: undefined };
      hudOperation = operation;
      try {
        minimapUi = createOwnedMinimapUi({ document: hudCapabilities.document, parent: root,
          dom: hudCapabilities.dom, construct: constructCapabilities, canvas: minimapCanvas,
          isCurrentDocument: hudCapabilities.isCurrentDocument });
        minimapUi.mount();
        checkHudOperation();
      } catch (error) { throw operation.failed ? operation.primary : error; }
      finally { hudOperation = undefined; operation.primary = undefined; }
      publishHud();
    }
    if (ownedEndScreenUi) {
      hudIdle();
      const operation = { failed: false, primary: undefined };
      hudOperation = operation;
      try {
        endScreenUi = createOwnedEndScreenUi({ document: hudCapabilities.document, parent: root,
          menuParent: playNodes?.mount,
          dom: hudCapabilities.dom, construct: constructCapabilities,
          isCurrentDocument: hudCapabilities.isCurrentDocument });
        endScreenUi.mount();
        checkHudOperation();
      } catch (error) { throw operation.failed ? operation.primary : error; }
      finally { hudOperation = undefined; operation.primary = undefined; }
      // Minimap startup already published this initial snapshot; the end view
      // starts hidden and joins the next ordinary post-operation publication.
      if (!ownedMinimapUi) publishHud();
    }
    if (ownedAnnouncementUi) {
      hudIdle();
      const operation = { failed: false, primary: undefined };
      hudOperation = operation;
      try {
        announcementUi = createOwnedAnnouncementUi({ document: hudCapabilities.document, parent: root,
          dom: hudCapabilities.dom, construct: constructCapabilities,
          isCurrentDocument: hudCapabilities.isCurrentDocument });
        announcementUi.mount();
        checkHudOperation();
        // Keep the diagnostic status below the reserved 300 by 228 announcement box.
        const statusStyle = hudCapabilities.dom.style(output);
        checkHudOperation();
        hudCapabilities.dom.setStyle(statusStyle, 'top', '240px');
        checkHudOperation();
        const view = apply(readAnnouncementView, scene, []);
        checkHudOperation();
        announcementUi.render(view);
        checkHudOperation();
      } catch (error) { throw operation.failed ? operation.primary : error; }
      finally { hudOperation = undefined; operation.primary = undefined; }
    }
    // Retire the startup fallback only after every selected owner has mounted.
    loadingHandoff = true;
    if (ownedPlayUi) runPlay(() => { report('ready-not-connected'); displayStatus(false); });
    else report('ready-not-connected');
    frame = native.requestAnimationFrame(tick);
    return runtime ?? createRuntime();
  } catch (error) {
    let code = 'csp-or-module-unavailable';
    if (requestStartupFailed || requestOwner && hasFailedStockAccessoryRequest(requestOwner)) code = 'host-unavailable';
    else try { if (error?.status === 'unsupported') code = 'host-unavailable'; } catch { /* Classification is best effort. */ }
    try { dispose(code); } catch { /* Cleanup cannot replace the startup primary. */ }
    throw error;
  }
}
