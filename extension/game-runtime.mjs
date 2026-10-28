import { createStockSkinAdapter } from './stock-skin-provider.mjs';
import { createStockClient } from './stock-client.mjs';
import { createStockEntityAssets } from './stock-food-provider.mjs';
import { createStockHostSnapshot } from './stock-host-snapshot.mjs';
import { desktopBackingSize } from './desktop-layout.mjs';
import { createStockGameplay } from './stock-gameplay.mjs';
import { bindStockHudDom } from './stock-hud-dom.mjs';
import { projectHudView } from './stock-hud-view.mjs';
import { createOwnedHudUi } from './owned-hud-ui.mjs';
import { createOwnedPlayUi } from './owned-play-ui.mjs';
import { createOwnedLeaderboardUi } from './owned-leaderboard-ui.mjs';
import { projectLeaderboardView } from './stock-leaderboard-view.mjs';
import { stockEndpoint } from './stock-session.mjs';

// Gate-only notifications must not add gameplay control/source observations.
const editNotifications = new Set(['keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
  'copy', 'cut', 'paste', 'selectstart', 'select', 'selectionchange', 'dblclick', 'contextmenu',
  'focus', 'blur', 'focusin', 'focusout', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
  'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel', 'touchcancel',
  'dragstart', 'drag', 'dragenter', 'dragleave', 'dragover', 'drop', 'dragend']);

/** Local runtime factory. Importing this module performs no page ownership work. */
export async function startGamePage({ realm = globalThis, initialize, wasmApi, hudReadout = false, ownedHudUi = false, ownedPlayUi = false, ownedLeaderboardUi = false, localHost } = {}) {
  if (typeof hudReadout !== 'boolean') throw new TypeError('Explicit hudReadout boolean required');
  if (typeof initialize !== 'function' || wasmApi === null || typeof wasmApi !== 'object') {
    throw new TypeError('Explicit initialize function and wasmApi object required');
  }
  if (typeof ownedHudUi !== 'boolean' || (ownedHudUi && !hudReadout)) {
    throw new TypeError('Explicit ownedHudUi boolean requires hudReadout');
  }
  if (typeof ownedPlayUi !== 'boolean' || (ownedPlayUi && (!hudReadout || !ownedHudUi))) {
    throw new TypeError('Explicit ownedPlayUi boolean requires hudReadout and ownedHudUi');
  }
  if (typeof ownedLeaderboardUi !== 'boolean' || (ownedLeaderboardUi && (!hudReadout || !ownedHudUi || !ownedPlayUi))) {
    throw new TypeError('Explicit ownedLeaderboardUi boolean requires hudReadout, ownedHudUi and ownedPlayUi');
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
  let scene, quality, controller, gameplay, held, frame, waiting, wakeWaiting, reload;
  let disposed = false;
  let nickname, bindingOperation, handlingNickname, routing = 0;
  let hud, ownedUi, constructCapabilities, hudOperation, nativeOperation, sourceOperation, hudCapabilities, cleanupActive = false;
  let playUi, controlsLease, playCapabilities, playOperation, playNodes;
  let leaderboardUi, leaderboardProperties, projector, Projector, projectScores, freeProjector;
  let playAccepted = false, playAvailable = false, playGeneration = 0;
  const documentIdentity = hudReadout ? Symbol('HUD document') : undefined;
  const ownKeys = Reflect.ownKeys, apply = Reflect.apply, prototype = Object.getPrototypeOf;
  const descriptor = Object.getOwnPropertyDescriptor, hasOwn = Object.hasOwn;
  const recordPrototype = Object.prototype, freeze = Object.freeze;
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
    if ((!hud && !leaderboardUi && !(localHost && playUi)) || disposed || cleanupActive) return;
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
      if (localHost && playUi && playAccepted) {
        const session = gameplay.diagnostics().session;
        if (session.phase === 'disconnected' || session.phase === 'victory' && session.playing === false) {
          playUi.unlock();
          checkHudOperation();
          playAccepted = false;
        }
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
    if (leaderboardUi !== undefined) {
      const lease = leaderboardUi; leaderboardUi = undefined;
      cleanup(() => lease.dispose());
    }
    leaderboardProperties = undefined;
    if (playUi !== undefined) {
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
    cleanup(() => native.status(code));
    if (localHost) {
      const host = localHost; localHost = undefined;
      cleanup(() => host.dispose());
    }
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
  if (ownedLeaderboardUi) captureHudCapabilities();
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
  const report = code => {
    if (!ownedPlayUi) { output.textContent = `SlitherClient: ${code}`; native.status(code); return; }
    const labels = { __proto__: null, loading: 'Loading', 'waiting-assets': 'Loading',
      'ready-not-connected': 'Ready', connected: 'Connected', disconnected: 'Not connected',
      'host-unavailable': 'Unavailable', 'csp-or-module-unavailable': 'Unavailable',
      'client-failed': 'Failed', disposed: 'Not connected' };
    output.textContent = `SlitherClient: ${code === 'ready-not-connected' && !playAvailable ? 'Unavailable' : labels[code] ?? 'Unavailable'}`;
    checkHudOperation();
    if (playUi && !disposed) {
      const states = { __proto__: null, 'ready-not-connected': 'ready', connected: 'connected',
        disconnected: 'not-connected', 'host-unavailable': 'unavailable', 'client-failed': 'failed' };
      if (states[code]) playUi.setStatus(code === 'ready-not-connected' && !playAvailable ? 'unavailable' : states[code]);
      checkHudOperation();
    }
    native.status(code);
    checkHudOperation();
  };
  const size = () => desktopBackingSize(realm.innerWidth, realm.innerHeight);
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
      if (ownedPlayUi) {
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
        playAvailable = Boolean(localHost) || native.liveProfile !== undefined;
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
    if (!ownedLeaderboardUi) captureHudCapabilities();
    report('loading');
    await initialize();
    if (disposed) return Object.freeze({ dispose });
    if (ownedLeaderboardUi) runNative(() => { projector = new Projector(); });
    const reader = localHost ? undefined : createStockHostSnapshot({ realm, observer: native,
      readAccessory: () => native.readAccessory() });
    const started = native.now();
    let context;
    const captureReady = () => {
      if (localHost && !localHost.isCurrentDocument()) throw new Error('Current local game document required');
      const capture = localHost ? localHost.sources : reader.capture();
      if (context && (capture.background !== context.background
        || capture.backgroundImage !== context.backgroundImage
        || capture.palettes.some((source, index) => source !== context.palettes[index]))) {
        const error = new Error('Renderer context sources changed; reload required'); error.status = 'unsupported'; throw error;
      }
      if (!localHost && capture.readiness.some(entry => entry.state !== 'ready')) {
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
    const adapter = localHost ? localHost.sources.adapter : createStockSkinAdapter({ realm, random: native.random, readSnapshot() {
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
      backgroundImage: initial.backgroundImage };
    scene = new wasmApi.AnimatedScene(startMs);
    if (initial.backgroundImage !== undefined) scene.set_background_backdrop(initial.backgroundImage);
    if (hudReadout) scene.enable_score_tracking();
    quality = new wasmApi.DesktopQuality(1, startMs);
    const backing = size();
    controller = createStockClient({ scene, quality, adapter: wrapped, hostAssets, target,
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
    gameplay = createStockGameplay({ scene, quality, controller, wasm: wasmApi,
      createSocket: native.createSocket, now: native.now,
      defer: hudReadout ? callback => native.queueMicrotask(() => {
        if (disposed) return;
        try {
          const before = gameplay.hudSnapshot();
          const beforeRows = ownedLeaderboardUi ? gameplay.leaderboardSnapshot() : undefined;
          runNative(callback);
          const after = gameplay.hudSnapshot();
          const rowsChanged = ownedLeaderboardUi && gameplay.leaderboardSnapshot() !== beforeRows;
          if (after !== null && (after !== before || rowsChanged || localHost)) publishHud(after);
        } catch (error) { fail(error); }
      }) : native.queueMicrotask,
      setInterval: native.setInterval, clearInterval: native.clearInterval,
      onStatus: hudReadout ? code => nativeOperation ? report(code) : runNative(() => report(code)) : report,
      onFatal: hudReadout ? error => {
        if (!nativeOperation) return fail(error);
        if (!nativeOperation.failed) { nativeOperation.failed = true; nativeOperation.primary = error; }
      } : fail,
      ...(hudReadout ? { hudReadout: true } : {}),
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
            if (playAccepted) return;
            let endpoint, nickname;
            try {
              endpoint = playCapabilities.controls.inputValue(playNodes.endpoint);
              nickname = playCapabilities.controls.inputValue(playNodes.nickname);
              if (endpoint === '') { playUi.setStatus('empty-endpoint'); return; }
              if (typeof endpoint !== 'string' || endpoint.length > 128) { playUi.setStatus('invalid-endpoint'); return; }
              try { endpoint = stockEndpoint(endpoint); }
              catch { playUi.setStatus('invalid-endpoint'); return; }
              if (localHost && endpoint !== localHost.endpoint) { playUi.setStatus('invalid-endpoint'); return; }
              if (typeof nickname !== 'string' || nickname.length > 24 || /[^\x20-\x7f]/.test(nickname)) {
                playUi.setStatus('invalid-nickname'); return;
              }
              playAccepted = true;
              playUi.lock();
              playUi.setStatus('preparing');
              request = { endpoint, nickname, skin: 0, customSkin: new Uint8Array(),
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
          controls: playCapabilities.controls, isCurrentDocument: hudCapabilities.isCurrentDocument });
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
      });
      runtime.bindNicknameField({ schema: 1, element: playNodes.nickname, parent: playNodes.nicknameParent });
      runPlay(() => {
        const raw = playCapabilities.createControlsLease({ schema: 1,
          endpoint: playNodes.endpoint, endpointParent: playNodes.endpointParent,
          button: playNodes.button, buttonParent: playNodes.buttonParent, onPlay });
        // Retain cleanup authority before binding can publish native effects.
        controlsLease = copyRecord(raw, ['bind', 'unregister']);
        if (!Object.isFrozen(raw) || !synchronous(controlsLease.bind) || !synchronous(controlsLease.unregister)) {
          throw new TypeError('Frozen owned Play control lease required');
        }
        checkHudOperation();
        if (apply(controlsLease.bind, undefined, []) !== undefined) throw new TypeError('Synchronous owned Play binding required');
        checkHudOperation();
      });
      if (!playAvailable) runPlay(() => { playAccepted = true; playUi.lock(); });
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
    if (ownedPlayUi) runPlay(() => report('ready-not-connected'));
    else report('ready-not-connected');
    frame = native.requestAnimationFrame(tick);
    return runtime ?? createRuntime();
  } catch (error) {
    let code = 'csp-or-module-unavailable';
    try { if (error?.status === 'unsupported') code = 'host-unavailable'; } catch { /* Classification is best effort. */ }
    try { dispose(code); } catch { /* Cleanup cannot replace the startup primary. */ }
    throw error;
  }
}
