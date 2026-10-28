import { createStockSession, stockEndpoint } from './stock-session.mjs';
import { createClientInput } from './client-input.mjs';
import { createStockLiveProfileAcquirer } from './stock-live-profile.mjs';
import { createHudState, hudReadoutRequired, reduceHudState } from './stock-hud-state.mjs';
import { createLeaderboardState, prepareLeaderboardPacket, completeLeaderboardPacket,
  resetLeaderboardWorld } from './stock-leaderboard-state.mjs';

const typedArrayLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float64Array.prototype), 'length').get;
const typedArrayValues = Float64Array.prototype.values;

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
function synchronousHudCallback(callback, name = 'onHudPacket', foreignKinds = false) {
  const invalid = () => { throw new TypeError(`Synchronous ${name} callback required`); };
  if (typeof callback !== 'function') invalid();
  const seen = new Set();
  let prototype = callback;
  for (let calls = 0; calls < 64; calls++) {
    prototype = Object.getPrototypeOf(prototype);
    if (prototype === null) break;
    // Bound even a Proxy returning a fresh prototype on every inspection.
    if (seen.has(prototype) || nonSynchronousPrototypes.includes(prototype)) {
      invalid();
    }
    if (foreignKinds) {
      const kind = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag);
      if (kind && Object.hasOwn(kind, 'value')
        && ['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(kind.value)) invalid();
    }
    seen.add(prototype);
  }
  if (prototype !== null) invalid();
  const source = Function.prototype.toString.call(callback);
  if (/^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/.test(source)) {
    invalid();
  }
}

/** Trusted local composition; transports, native time and the scene remain caller-owned. */
export function createStockGameplay({ scene, quality, controller, wasm, createSocket, now,
  defer, setInterval, clearInterval, onStatus, onFatal, liveProfile, onHudPacket, hudReadout = false,
  leaderboardRows = false, leaderboardProjector, localSession = false, minimapTracking = false, announcementTracking = false }) {
  if (typeof hudReadout !== 'boolean') throw new TypeError('Explicit hudReadout boolean required');
  if (typeof leaderboardRows !== 'boolean') throw new TypeError('Explicit leaderboardRows boolean required');
  if (typeof localSession !== 'boolean') throw new TypeError('Explicit localSession boolean required');
  if (typeof announcementTracking !== 'boolean' || (announcementTracking && !hudReadout)) {
    throw new TypeError('Explicit announcementTracking boolean requires hudReadout');
  }
  if (typeof minimapTracking !== 'boolean' || (minimapTracking && !hudReadout)) {
    throw new TypeError('Explicit minimapTracking boolean requires hudReadout');
  }
  const observeMinimapFraction = minimapTracking
    ? scene?.observe_minimap_ui_fraction?.bind(scene) : undefined;
  if (minimapTracking && typeof observeMinimapFraction !== 'function') {
    throw new TypeError('Gameplay capability required: observe_minimap_ui_fraction');
  }
  let project;
  if (leaderboardRows) {
    if (!hudReadout) throw new TypeError('leaderboardRows requires hudReadout');
    ({ project } = ownRecord(leaderboardProjector, ['project']));
    synchronousHudCallback(project, 'leaderboardProjector.project', true);
  }
  for (const [record, names] of [[scene, ['control_view', 'set_connected', 'reset_lag']],
    [quality, ['begin_connection']], [controller, ['packet', 'frame']]]) {
    for (const name of names) if (typeof record?.[name] !== 'function') throw new TypeError(`Gameplay capability required: ${name}`);
  }
  for (const callback of [defer, setInterval, clearInterval, onStatus, onFatal]) {
    if (typeof callback !== 'function') throw new TypeError('Gameplay scheduling/notification capability required');
  }
  if (onHudPacket !== undefined) {
    synchronousHudCallback(onHudPacket, 'onHudPacket', leaderboardRows);
  }
  if (hudReadout || onHudPacket !== undefined) {
    if (typeof controller.packetWithHud !== 'function') throw new TypeError('Gameplay capability required: packetWithHud');
  }
  if (hudReadout && typeof scene.score_view !== 'function') throw new TypeError('Gameplay capability required: score_view');
  const profileOptions = liveProfile === undefined ? undefined
    : ownRecord(liveProfile, ['capabilities', 'isCurrentDocument']);
  if (profileOptions && typeof profileOptions.isCurrentDocument !== 'function') throw new TypeError('Current-document checker required');
  const input = createClientInput({ protocolVersion: 19 });
  let session = createStockSession({ wasm, createSocket, now });
  let disposed = false, active = false, queued = false, dirty = true, hasFatal = false, fatal, uiTimer;
  let fatalNotified = false;
  let reconciling = false;
  let nativeConnected = false;
  const hudIdentity = hudReadout ? Symbol('gameplay scene') : null;
  let hudState = hudReadout ? createHudState(hudIdentity) : null;
  let pendingHudState = null;
  let leaderboardState = leaderboardRows ? createLeaderboardState(hudIdentity) : null;
  let pendingLeaderboardState = null, leaderboardCompanion = null, ownNickname = '';
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
  const retainError = error => {
    if (!hasFatal) { fatal = error; hasFatal = true; }
    pendingHudState = null;
    pendingLeaderboardState = leaderboardCompanion = null;
    dirty = true;
  };
  const latchError = error => {
    retainError(error);
    try { schedule(); } catch { /* Scheduling cannot replace the retained primary. */ }
  };
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
  const hudObserver = {
    ...observer,
    packet(bytes, elapsedHeader, plan) {
      return hudOperation(() => {
        leaderboardCompanion = null;
        const report = controller.packetWithHud(bytes, elapsedHeader, plan);
        if (leaderboardRows && hasFatal) throw fatal;
        if (leaderboardRows) {
          // Native conversion and held-source release have both returned. Admit the
          // complete report before calling the caller-owned numeric projector.
          const state = pendingLeaderboardState ?? leaderboardState;
          const prepared = prepareLeaderboardPacket(state, report);
          const scores = [];
          for (const request of prepared.requests) {
            const result = Reflect.apply(project, leaderboardProjector, [request.tableMax,
              Float64Array.from(request.counts), Float64Array.from(request.fractionalMasses)]);
            if (hasFatal) throw fatal;
            if (!(result instanceof Float64Array)) throw new TypeError('Leaderboard Float64Array scores required');
            // Brand/detachment checks avoid caller iterators and length getters.
            Reflect.apply(typedArrayValues, result, []);
            const length = Reflect.apply(typedArrayLength, result, []);
            if (length !== request.counts.length) throw new TypeError('Leaderboard score count mismatch');
            const copied = [];
            for (let index = 0; index < length; index++) copied.push(result[index]);
            scores.push(copied);
          }
          leaderboardCompanion = { state, prepared, scores };
        }
        return report;
      });
    },
    hud(report) {
      return hudOperation(() => {
        const companion = leaderboardCompanion;
        leaderboardCompanion = null;
        if (leaderboardRows && companion === null) throw new Error('Missing leaderboard packet companion');
        const candidate = hudReadout
          ? reduceHudState(pendingHudState ?? hudState, hudIdentity, { kind: 'packet', report }) : null;
        const rowCandidate = leaderboardRows ? completeLeaderboardPacket(companion.state,
          companion.prepared, companion.scores, ownNickname) : null;
        if (onHudPacket !== undefined && onHudPacket(report) !== undefined) {
          throw new TypeError('Synchronous onHudPacket must return undefined');
        }
        if (hudReadout && !hasFatal && !disposed) {
          pendingHudState = candidate;
          pendingLeaderboardState = rowCandidate;
        }
      });
    },
  };
  function subscribeSession() {
    if (!hudReadout && onHudPacket === undefined) return session.subscribe(observer);
    return (leaderboardRows ? session.subscribeWithLeaderboardRows : session.subscribeWithHud)(hudObserver);
  }
  let unsubscribe = subscribeSession();
  function hudOperation(callback) {
    if (hasFatal) throw fatal;
    if (disposed || active) throw rejectedOperation('Gameplay HUD reentry');
    active = true;
    try {
      const result = callback();
      if ((leaderboardRows || localSession) && hasFatal) throw fatal;
      return result;
    } catch (error) {
      try { latchError(error); } catch { /* Scheduling cannot replace the primary failure. */ }
      throw error;
    } finally { active = false; }
  }
  function rejectedOperation(message) {
    const error = new Error(message);
    // Preserve legacy callback behavior; selected publication must not succeed
    // when a projector/observer catches its own attempted owner reentry.
    if ((leaderboardRows || localSession) && (active || reconciling || checkingCurrent)) latchError(error);
    return error;
  }
  function clearUiTimer() {
    if (uiTimer !== undefined) {
      const timer = uiTimer;
      uiTimer = undefined;
      clearInterval(timer);
    }
  }
  function dispose() {
    if (disposed) return;
    if (active) throw rejectedOperation('Gameplay disposal reentry');
    disposed = true;
    hudState = pendingHudState = null;
    leaderboardState = pendingLeaderboardState = leaderboardCompanion = null;
    ownNickname = '';
    profilePhase = 'disposed';
    let cleanupFailed = false;
    const cleanup = callback => {
      try { callback(); }
      catch (error) { cleanupFailed = true; retainError(error); }
    };
    if (profileIntent) {
      profileIntent.cancelled = true;
      cleanup(() => profileIntent.acquirer?.dispose());
      cleanup(() => clearRequest(profileIntent));
    }
    cleanup(clearUiTimer);
    cleanup(unsubscribe);
    cleanup(() => input.pagehide());
    cleanup(() => session.close('host-disposed'));
    if (hasFatal && !fatalNotified) {
      fatalNotified = true;
      try { onFatal(fatal); } catch { /* Notification cannot replace its primary. */ }
    }
    if (cleanupFailed) throw fatal;
  }
  function reconcile() {
    if (disposed) return;
    if (acquiring()) return;
    if (active) { schedule(); return; }
    reconciling = true;
    try {
      if (hasFatal) {
        dispose();
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
        const timerSession = session;
        uiTimer = setInterval(() => {
          if (disposed || session !== timerSession) return;
          try {
            const observed = timerSession.uiTick(now());
            observeMinimapFraction?.(observed.returnFraction);
            dirty = true; reconcile();
          }
          catch (error) { latchError(error); }
        }, 25);
      } else if (!state.uiTimerNeeded) clearUiTimer();
      if (dirty) {
        dirty = false;
        onStatus(state.phase === 'ready' ? 'ready-not-connected' : state.connected ? 'connected' : 'disconnected');
      }
      // Ingress and source release have unwound; all reconciliation must succeed.
      if (!hasFatal && !disposed && pendingHudState !== null) {
        hudState = pendingHudState;
        leaderboardState = pendingLeaderboardState;
        pendingHudState = null;
        pendingLeaderboardState = null;
      }
    } catch (error) { latchError(error); }
    finally { reconciling = false; }
  }
  function run(callback) {
    // A nested draw cannot bypass an unfinished packet reconciliation barrier.
    if (disposed || active || hasFatal || checkingCurrent || (hudReadout && reconciling)) {
      throw rejectedOperation('Gameplay stopped or reentrant');
    }
    reconcile();
    if (disposed || hasFatal) throw new Error('Gameplay stopped');
    active = true;
    try {
      const result = callback();
      if ((leaderboardRows || localSession) && hasFatal) throw fatal;
      return result;
    } catch (error) { latchError(error); throw error; }
    finally {
      active = false;
      if (dirty) {
        try { schedule(); }
        catch (error) { retainError(error); throw fatal; }
      }
    }
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
  function drawHud(candidate) {
    if (hasFatal) throw fatal;
    if (disposed) throw new Error('Gameplay stopped');
    const playing = session.snapshot().playing;
    const view = hudReadoutRequired(candidate, playing) ? scene.score_view() : null;
    const next = reduceHudState(candidate, hudIdentity, { kind: 'draw', playing, view });
    if (hasFatal) throw fatal;
    return next;
  }
  function checkProfile() {
    if (profilePhase === 'ready' && !current(profileIntent)) {
      cancelProfile(profileIntent); profilePhase = 'failed'; throw profileError('stale-intent');
    }
  }
  function admitPlay(request) {
    if (!leaderboardRows && !localSession) { session.play(request); return; }
    active = true;
    try {
      const admitted = leaderboardRows ? ownRecord(request, ['endpoint', 'profile', 'nickname', 'skin', 'customSkin']) : request;
      const status = localSession ? session.snapshot() : null;
      if (localSession && (status.phase === 'disconnected'
        || (status.phase === 'victory' && status.playing === false))) {
        try {
          clearUiTimer();
          session.close('local-session-replaced');
          unsubscribe();
          leaderboardCompanion = null;
          if (hasFatal) throw fatal;
          session = createStockSession({ wasm, createSocket, now });
          unsubscribe = subscribeSession();
        } catch (error) { latchError(error); throw error; }
      }
      session.play(admitted);
      if (hasFatal) throw fatal;
      // Retain the admitted copy, never reread a caller's mutable login field.
      if (leaderboardRows) ownNickname = admitted.nickname;
    } finally { active = false; }
  }
  function draw(method, args) {
    if (acquiring() && !disposed) return undefined;
    return run(() => {
      if (acquiring()) return undefined;
      checkProfile();
      const operation = controller[method];
      if (typeof operation !== 'function') throw new TypeError(`Gameplay capability required: ${method}`);
      const result = Reflect.apply(operation, controller, args);
      checkProfile();
      const candidate = hudReadout ? drawHud(hudState) : null;
      if (hudReadout && !hasFatal && !disposed) hudState = candidate;
      return result;
    });
  }
  return Object.freeze({
    play(request) {
      if (disposed || active || hasFatal || checkingCurrent || (localSession && reconciling)) {
        throw rejectedOperation('Gameplay stopped or reentrant');
      }
      if (acquiring()) throw profileError('acquiring');
      // Invalid profiles are correctable caller errors, with no connection/quality effects.
      admitPlay(request);
      try { quality.begin_connection(); } catch (error) { latchError(error); throw error; }
    },
    async playWithLiveProfile(request) {
      if (disposed || active || hasFatal || checkingCurrent) throw rejectedOperation('Gameplay stopped or reentrant');
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
          admitPlay({ ...intent.request, profile });
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
        checkProfile();
        let candidate = hudState;
        let rowCandidate = leaderboardState;
        const flags = session.beforeUpdate(nowMs);
        const result = controller.frame(nowMs, { lagging: flags.lagging, playing: flags.playing,
          readPlaying: () => session.snapshot().playing,
          control(request) {
            input.setConnected(session.snapshot().connected);
            input.setOwn(request.control.own);
            input.accumulateStep({ wholeSteps: request.wholeSteps });
            let actions;
            if (hudReadout) {
              const observed = session.afterStepWithHud(request);
              actions = observed.actions;
              if (announcementTracking) actions = { ...actions, announcementLifecycle: observed.lifecycle };
              if (minimapTracking && observed.lifecycle.returnActive) {
                actions = { ...actions, minimapUiFraction: observed.lifecycle.returnFraction };
              }
              candidate = reduceHudState(candidate, hudIdentity,
                { kind: 'step', delta: request.delta, lifecycle: observed.lifecycle });
              if (actions.resetWorld) {
                candidate = reduceHudState(candidate, hudIdentity, { kind: 'world-reset' });
                if (leaderboardRows) rowCandidate = resetLeaderboardWorld(rowCandidate);
              }
            } else actions = session.afterStep(request);
            if (actions.resetWorld) { input.reset(); return { ...actions }; }
            input.setConnected(session.snapshot().connected);
            const intent = input.tick({ nowMs: request.nowMs, wholeSteps: 0 },
              bytes => session.sendInput(bytes),
              (context, emit) => session.betweenKeyboardAndBoost(context, emit));
            return { ...actions, ...(intent.gazeHeading === null ? {} : { gazeHeading: intent.gazeHeading }) };
          },
        });
        checkProfile();
        if (hudReadout) candidate = drawHud(candidate);
        // Render, quality, step free AND held source release must all succeed first.
        session.commitControl();
        const state = session.snapshot();
        if (profilePhase === 'ready' && state.constructorAttempts > 0) {
          profilePhase = 'committed'; profileIntent = undefined;
        }
        nativeConnected = state.connected;
        if (hudReadout && !hasFatal && !disposed) {
          hudState = candidate;
          leaderboardState = rowCandidate;
        }
        return result;
      });
    },
    render() { return draw('render', []); },
    resize(width, height) { return draw('resize', [width, height]); },
    hudSnapshot: () => hudState,
    leaderboardSnapshot: () => leaderboardState,
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
