import { createStockSession } from './stock-session.mjs';
import { createClientInput } from './client-input.mjs';

/** Trusted local composition; transports, native time and the scene remain caller-owned. */
export function createStockGameplay({ scene, quality, controller, wasm, createSocket, now,
  defer, setInterval, clearInterval, onStatus, onFatal }) {
  for (const [record, names] of [[scene, ['control_view', 'set_connected', 'reset_lag']],
    [quality, ['begin_connection']], [controller, ['packet', 'frame']]]) {
    for (const name of names) if (typeof record?.[name] !== 'function') throw new TypeError(`Gameplay capability required: ${name}`);
  }
  for (const callback of [defer, setInterval, clearInterval, onStatus, onFatal]) {
    if (typeof callback !== 'function') throw new TypeError('Gameplay scheduling/notification capability required');
  }
  const input = createClientInput({ protocolVersion: 19 });
  const session = createStockSession({ wasm, createSocket, now });
  let disposed = false, active = false, queued = false, dirty = true, hasFatal = false, fatal, uiTimer;
  let nativeConnected = false;
  const schedule = () => {
    if (disposed || queued) return;
    queued = true;
    defer(() => { queued = false; if (!disposed) reconcile(); });
  };
  const latchError = error => { if (!hasFatal) { fatal = error; hasFatal = true; } dirty = true; schedule(); };
  const unsubscribe = session.subscribe({
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
  });
  function clearUiTimer() {
    if (uiTimer !== undefined) { clearInterval(uiTimer); uiTimer = undefined; }
  }
  function dispose() {
    if (disposed) return;
    if (active) throw new Error('Gameplay disposal reentry');
    disposed = true;
    clearUiTimer();
    unsubscribe();
    input.pagehide();
    session.close('host-disposed');
  }
  function reconcile() {
    if (disposed) return;
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
    if (disposed || active || hasFatal) throw new Error('Gameplay stopped or reentrant');
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
      if (disposed || active || hasFatal) throw new Error('Gameplay stopped or reentrant');
      // Invalid profiles are correctable caller errors, with no connection/quality effects.
      session.play(request);
      try { quality.begin_connection(); } catch (error) { latchError(error); throw error; }
    },
    frame(nowMs) {
      return run(() => {
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
        // Render, quality, step free AND held source release must all succeed first.
        session.commitControl();
        nativeConnected = session.snapshot().connected;
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
    diagnostics: () => Object.freeze({ disposed, active, session: session.snapshot(), input: input.snapshot() }),
    dispose,
  });
}
