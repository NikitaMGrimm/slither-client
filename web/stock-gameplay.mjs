import { createStockSession, stockEndpoint } from './stock-session.mjs';
import { createClientInput } from './client-input.mjs';
import { createStockLiveProfileAcquirer } from './stock-live-profile.mjs';

function ownRecord(value, names) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('Gameplay own-data record required');
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  const record = {};
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== 'string' || !names.includes(key) || !Object.hasOwn(fields[key], 'value')) {
      throw new TypeError('Invalid gameplay record field');
    }
    record[key] = fields[key].value;
  }
  for (const key of names) if (!Object.hasOwn(record, key)) throw new TypeError(`Missing gameplay field: ${key}`);
  return record;
}

function profileError(code) {
  const error = new Error(`Live profile gameplay: ${code}`);
  error.code = code;
  return error;
}

const nonSynchronousPrototypes = [async function () {}, function* () {}, async function* () {}].map(Object.getPrototypeOf);
function synchronousHudCallback(callback) {
  if (typeof callback !== 'function') throw new TypeError('Synchronous onHudPacket callback required');
  const seen = new Set();
  let prototype = callback;
  for (let calls = 0; calls < 64; calls++) {
    prototype = Object.getPrototypeOf(prototype);
    if (prototype === null) break;
    // Bound even a Proxy returning a fresh prototype on every inspection.
    if (seen.has(prototype) || nonSynchronousPrototypes.includes(prototype)) {
      throw new TypeError('Synchronous onHudPacket callback required');
    }
    seen.add(prototype);
  }
  if (prototype !== null) throw new TypeError('Synchronous onHudPacket callback required');
  const source = Function.prototype.toString.call(callback);
  if (/^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/.test(source)) {
    throw new TypeError('Synchronous onHudPacket callback required');
  }
}

/** Trusted local composition; transports, native time and the scene remain caller-owned. */
export function createStockGameplay({ scene, quality, controller, wasm, createSocket, now,
  defer, setInterval, clearInterval, onStatus, onFatal, liveProfile, onHudPacket }) {
  for (const [record, names] of [[scene, ['control_view', 'set_connected', 'reset_lag']],
    [quality, ['begin_connection']], [controller, ['packet', 'frame']]]) {
    for (const name of names) if (typeof record?.[name] !== 'function') throw new TypeError(`Gameplay capability required: ${name}`);
  }
  for (const callback of [defer, setInterval, clearInterval, onStatus, onFatal]) {
    if (typeof callback !== 'function') throw new TypeError('Gameplay scheduling/notification capability required');
  }
  if (onHudPacket !== undefined) {
    synchronousHudCallback(onHudPacket);
    if (typeof controller.packetWithHud !== 'function') throw new TypeError('Gameplay capability required: packetWithHud');
  }
  const profileOptions = liveProfile === undefined ? undefined
    : ownRecord(liveProfile, ['capabilities', 'isCurrentDocument']);
  if (profileOptions && typeof profileOptions.isCurrentDocument !== 'function') throw new TypeError('Current-document checker required');
  const input = createClientInput({ protocolVersion: 19 });
  const session = createStockSession({ wasm, createSocket, now });
  let disposed = false, active = false, queued = false, dirty = true, hasFatal = false, fatal, uiTimer;
  let nativeConnected = false;
  let profilePhase = profileOptions ? 'idle' : 'unavailable';
  let profileIntent, checkingCurrent = false;
  const acquiring = () => profilePhase === 'acquiring';
  function current(intent) {
    if (disposed || hasFatal || profileIntent !== intent || intent.cancelled || checkingCurrent) return false;
    checkingCurrent = true;
    try {
      return profileOptions.isCurrentDocument() === true && !disposed && !hasFatal
        && profileIntent === intent && !intent.cancelled;
    } catch { return false; }
    finally { checkingCurrent = false; }
  }
  function clearRequest(intent) {
    if (!intent?.request) return;
    try { profileOptions.capabilities.bytes.clear(intent.request.customSkin); }
    finally { intent.request = undefined; }
  }
  function cancelProfile(intent) {
    intent.cancelled = true;
    // Attempt all owned cleanup without replacing the primary rejection, even undefined.
    for (const cleanup of [() => intent.acquirer?.dispose(),
      () => session.close('profile-cancelled'), () => clearRequest(intent)]) {
      try { cleanup(); } catch { /* The caller preserves its primary failure. */ }
    }
  }
  const schedule = () => {
    if (disposed || queued) return;
    queued = true;
    defer(() => { queued = false; if (!disposed) reconcile(); });
  };
  const latchError = error => { if (!hasFatal) { fatal = error; hasFatal = true; } dirty = true; schedule(); };
  const observer = {
    packet(bytes, elapsedHeader) {
      if (disposed || active) throw new Error('Gameplay packet reentry');
      active = true;
      try { return controller.packet(bytes, elapsedHeader); }
      catch (error) { latchError(error); throw error; }
      finally { active = false; }
    },
    // A notification can be inside session ingress OR a mutable Wasm control borrow.
    // Only captured microtasks may reconcile/free after BOTH stacks have unwound.
    state() { dirty = true; schedule(); },
    error: latchError,
  };
  const unsubscribe = onHudPacket === undefined ? session.subscribe(observer) : session.subscribeWithHud({
    ...observer,
    packet(bytes, elapsedHeader, plan) {
      return hudOperation(() => controller.packetWithHud(bytes, elapsedHeader, plan));
    },
    hud(report) {
      return hudOperation(() => {
        if (onHudPacket(report) !== undefined) throw new TypeError('Synchronous onHudPacket must return undefined');
      });
    },
  });
  function hudOperation(callback) {
    if (disposed || active) throw new Error('Gameplay HUD reentry');
    active = true;
    try { return callback(); }
    catch (error) {
      try { latchError(error); } catch { /* Scheduling cannot replace the primary failure. */ }
      throw error;
    } finally { active = false; }
  }
  function clearUiTimer() {
    if (uiTimer !== undefined) { clearInterval(uiTimer); uiTimer = undefined; }
  }
  function dispose() {
    if (disposed) return;
    if (active) throw new Error('Gameplay disposal reentry');
    disposed = true;
    profilePhase = 'disposed';
    const profileCleanupErrors = [];
    if (profileIntent) {
      profileIntent.cancelled = true;
      for (const cleanup of [() => profileIntent.acquirer?.dispose(), () => clearRequest(profileIntent)]) {
        try { cleanup(); } catch (error) { profileCleanupErrors.push(error); }
      }
    }
    clearUiTimer();
    unsubscribe();
    input.pagehide();
    session.close('host-disposed');
    if (profileCleanupErrors.length) throw profileCleanupErrors[0];
  }
  function reconcile() {
    if (disposed) return;
    if (acquiring()) return;
    if (active) { schedule(); return; }
    try {
      if (hasFatal) {
        const error = fatal;
        dispose();
        onFatal(error);
        return;
      }
      const state = session.snapshot();
      // Only resetLag is acknowledged here. A staged Play's resetWorld must still
      // pass the pre-motion transaction before commitControl can construct a socket.
      const pending = session.pendingActions();
      if (pending.actions.resetLag === true) {
        scene.reset_lag();
        session.acknowledgeActions(pending);
      }
      if (nativeConnected !== state.connected) {
        scene.set_connected(state.connected);
        nativeConnected = state.connected;
      }
      if (state.uiTimerNeeded && uiTimer === undefined) {
        uiTimer = setInterval(() => {
          if (disposed) return;
          try { session.uiTick(now()); dirty = true; reconcile(); }
          catch (error) { latchError(error); }
        }, 25);
      } else if (!state.uiTimerNeeded) clearUiTimer();
      if (dirty) {
        dirty = false;
        onStatus(state.phase === 'ready' ? 'ready-not-connected' : state.connected ? 'connected' : 'disconnected');
      }
    } catch (error) { latchError(error); }
  }
  function run(callback) {
    if (disposed || active || hasFatal || checkingCurrent) throw new Error('Gameplay stopped or reentrant');
    reconcile();
    if (disposed || hasFatal) throw new Error('Gameplay stopped');
    active = true;
    try { return callback(); }
    catch (error) { latchError(error); throw error; }
    finally { active = false; if (dirty) schedule(); }
  }
  function observeInput() {
    const view = scene.control_view();
    input.setConnected(session.snapshot().connected);
    input.setOwn(view.own);
    return view;
  }
  function pointerEvent(event, viewport, view) {
    return { clientX: event.clientX, clientY: event.clientY,
      viewportWidth: Math.ceil(viewport.width), viewportHeight: Math.ceil(viewport.height),
      follow: view.follows, camera: view.camera, head: view.own?.rawHead, zoom: view.zoom };
  }
  return Object.freeze({
    play(request) {
      if (disposed || active || hasFatal || checkingCurrent) throw new Error('Gameplay stopped or reentrant');
      if (acquiring()) throw profileError('acquiring');
      // Invalid profiles are correctable caller errors, with no connection/quality effects.
      session.play(request);
      try { quality.begin_connection(); } catch (error) { latchError(error); throw error; }
    },
    async playWithLiveProfile(request) {
      if (disposed || active || hasFatal || checkingCurrent) throw new Error('Gameplay stopped or reentrant');
      if (!profileOptions) throw profileError('unavailable');
      if (profilePhase !== 'idle' || session.snapshot().phase !== 'ready') throw profileError('already-attempted');
      const intent = { cancelled: false, started: false };
      profileIntent = intent; profilePhase = 'acquiring';
      try {
        const data = ownRecord(request, ['endpoint', 'nickname', 'skin', 'customSkin']);
        const endpoint = stockEndpoint(data.endpoint);
        if (typeof data.nickname !== 'string' || !Number.isInteger(data.skin)) throw new TypeError('Invalid gameplay login shape');
        const bytes = profileOptions.capabilities.bytes;
        const length = bytes.length(data.customSkin);
        // Bound the owned async intent copy to the wire's one-byte custom length.
        if (!Number.isInteger(length) || length < 0 || length > 255) throw new TypeError('Custom intent exceeds byte budget');
        const customSkin = bytes.allocate(length);
        intent.request = { endpoint, nickname: data.nickname, skin: data.skin, customSkin };
        bytes.copy(customSkin, data.customSkin, 0);
        if (!current(intent)) throw profileError('stale-intent');
        intent.started = true;
        intent.acquirer = createStockLiveProfileAcquirer({ capabilities: profileOptions.capabilities,
          isCurrentDocument: () => current(intent) });
        await intent.acquirer.acquireForPlay(profile => {
          if (!current(intent)) throw profileError('stale-intent');
          session.play({ ...intent.request, profile });
        });
        if (!current(intent)) throw profileError('stale-intent');
        quality.begin_connection();
        if (!current(intent)) throw profileError('stale-intent');
        clearRequest(intent);
        profilePhase = 'ready'; dirty = true; schedule();
      } catch (error) {
        if (!intent.started && !disposed) {
          try { clearRequest(intent); } catch { /* Preserve the original request failure. */ }
          profileIntent = undefined; profilePhase = 'idle';
        } else {
          cancelProfile(intent);
          if (!disposed) { profilePhase = 'failed'; latchError(error); }
        }
        throw error;
      }
    },
    frame(nowMs) {
      // RAF keeps running while the private consumer may have staged a login, but
      // neither native reset nor commit can run until acquisition has fully fulfilled.
      if (acquiring() && !disposed) return undefined;
      return run(() => {
        // Reconciliation notifications may start an intent after the entry check.
        if (acquiring()) return undefined;
        if (profilePhase === 'ready' && !current(profileIntent)) {
          cancelProfile(profileIntent); profilePhase = 'failed'; throw profileError('stale-intent');
        }
        const flags = session.beforeUpdate(nowMs);
        const result = controller.frame(nowMs, { lagging: flags.lagging, playing: flags.playing,
          readPlaying: () => session.snapshot().playing,
          control(request) {
            input.setConnected(session.snapshot().connected);
            input.setOwn(request.control.own);
            input.accumulateStep({ wholeSteps: request.wholeSteps });
            const actions = session.afterStep(request);
            if (actions.resetWorld) { input.reset(); return { ...actions }; }
            input.setConnected(session.snapshot().connected);
            const intent = input.tick({ nowMs: request.nowMs, wholeSteps: 0 },
              bytes => session.sendInput(bytes),
              (context, emit) => session.betweenKeyboardAndBoost(context, emit));
            return { ...actions, ...(intent.gazeHeading === null ? {} : { gazeHeading: intent.gazeHeading }) };
          },
        });
        if (profilePhase === 'ready' && !current(profileIntent)) {
          cancelProfile(profileIntent); profilePhase = 'failed'; throw profileError('stale-intent');
        }
        // Render, quality, step free AND held source release must all succeed first.
        session.commitControl();
        const state = session.snapshot();
        if (profilePhase === 'ready' && state.constructorAttempts > 0) {
          profilePhase = 'committed'; profileIntent = undefined;
        }
        nativeConnected = state.connected;
        return result;
      });
    },
    event(event, viewport) {
      return run(() => {
        const view = observeInput();
        if (event.type === 'pointermove' || event.type === 'mousemove') input.pointer(pointerEvent(event, viewport, view));
        else if (event.type === 'mousedown') input.mouseDown(pointerEvent(event, viewport, view));
        else if (event.type === 'mouseup') input.mouseUp();
        else if (event.type === 'keydown') input.keyDown(event.code);
        else if (event.type === 'keyup') input.keyUp(event.code);
        else if (event.type === 'blur') input.blur();
      });
    },
    diagnostics: () => Object.freeze({ disposed, active, profilePhase, session: session.snapshot(), input: input.snapshot() }),
    dispose,
  });
}
