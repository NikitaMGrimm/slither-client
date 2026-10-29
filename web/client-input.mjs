// Rust owns input state, arithmetic and packet attempts. JS owns scalar/record
// admission, arbitrary token identity and synchronous host callback boundaries.
function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`Invalid ${label}`);
  return value;
}

function nonnegative(value, label) {
  finite(value, label);
  if (value < 0) throw new RangeError(`Invalid ${label}`);
  return value;
}

function version(value) {
  if (!Number.isInteger(value) || value < 2 || value > 255) throw new RangeError('Invalid protocol version');
  return value;
}

function stepCount(value) {
  if (!Number.isInteger(value) || value < 0 || value > 5) throw new RangeError('Invalid whole steps');
  return value;
}


function pointerValues({ clientX, clientY, viewportWidth, viewportHeight, follow, camera, head, zoom }) {
  finite(clientX, 'pointer x'); finite(clientY, 'pointer y');
  finite(viewportWidth, 'viewport width'); finite(viewportHeight, 'viewport height');
  if (viewportWidth <= 0 || viewportHeight <= 0) throw new RangeError('Invalid viewport size');
  boolean(follow, 'follow preference');
  let cx = 0, cy = 0, hx = 0, hy = 0, scale = 0;
  if (!follow && head != null) {
    cx = finite(camera?.x, 'camera x'); cy = finite(camera?.y, 'camera y');
    hx = finite(head.x, 'head x'); hy = finite(head.y, 'head y'); scale = finite(zoom, 'zoom');
    if (scale <= 0) throw new RangeError('Invalid zoom');
  }
  return new Float64Array([clientX, clientY, viewportWidth, viewportHeight, Number(follow), Number(head != null), cx, cy, hx, hy, scale]);
}

/** Standalone CSS projection through an explicitly supplied Rust capability. */
export function desktopPointer(input, InputPolicy) {
  if (typeof InputPolicy?.project_pointer !== 'function') throw new TypeError('Rust desktop input capability required');
  return InputPolicy.project_pointer(pointerValues(input));
}

/** Each phase returns from Rust before invoking a callback; throws stay untouched. */
export function createClientInput({ protocolVersion = 19, InputPolicy } = {}) {
  version(protocolVersion);
  if (typeof InputPolicy !== 'function') throw new TypeError('Rust desktop input capability required');
  const free = InputPolicy.prototype?.free;
  if (typeof free !== 'function') throw new TypeError('Rust desktop input release capability required');
  let state = new InputPolicy(protocolVersion);
  let token;
  // This lease owns resource release only; Rust remains the tick/reentry owner.
  let tickLease = false, releaseRequested = false, retiredView;
  const copyView = view => ({ ...view, pointer: { ...view.pointer }, comparedPointer: { ...view.comparedPointer },
    own: view.own ? { ...view.own } : null });
  const live = () => {
    if (!state || releaseRequested) throw new Error('Input disposed');
    return state;
  };
  const release = () => {
    if (!state) return;
    const owned = state, identity = token;
    state = null; token = undefined;
    let failed = false, primary;
    try {
      const view = owned.snapshot();
      if (view.own) view.own = { token: identity, ...view.own };
      // A terminal copied observation preserves gameplay diagnostics after free;
      // it is never used for input updates or packet decisions.
      retiredView = view;
    } catch (error) { failed = true; primary = error; }
    try { Reflect.apply(free, owned, []); }
    catch (error) { if (!failed) { failed = true; primary = error; } }
    if (failed) throw primary;
  };
  const values = input => {
    if (state.has_own() && input.follow === false && input.head == null) throw new TypeError('Expected raw own head');
    return pointerValues(state.has_own() ? input : { ...input, head: null });
  };
  return {
    setProtocolVersion(value) { live().set_protocol_version(version(value)); },
    setConnected(value) { live().set_connected(boolean(value, 'connection state')); },
    setOwn(value) {
      live();
      if (value === null) { state.clear_own(); token = undefined; return; }
      if (!value || value.token == null) throw new TypeError('Invalid own appearance');
      const next = { token: value.token, wantedHeading: finite(value.wantedHeading, 'wanted heading'),
        gazeHeading: finite(value.gazeHeading, 'gaze heading'), dead: boolean(value.dead, 'death state'),
        turnRate: nonnegative(value.turnRate, 'turn rate'), sizeTurnFactor: nonnegative(value.sizeTurnFactor, 'size turn factor'),
        speedTurnFactor: nonnegative(value.speedTurnFactor, 'speed turn factor') };
      live().set_own(new Float64Array([next.wantedHeading, next.gazeHeading, Number(next.dead), next.turnRate, next.sizeTurnFactor, next.speedTurnFactor]), Object.is(token, next.token));
      token = next.token;
    },
    pointer(input) { live(); const copied = values(input); return live().pointer(copied); },
    keyDown(code) { live(); return typeof code === 'string' ? state.key_down(code) : false; },
    keyUp(code) { live(); return typeof code === 'string' ? state.key_up(code) : false; },
    mouseDown(input) { live(); if (state.has_own()) { const copied = values(input); live().mouse_down(copied); } },
    mouseUp() { live().mouse_up(); }, blur() { live().blur(); }, pagehide() { live().pagehide(); },
    reset() { live().reset(); token = undefined; },
    dispose() {
      if (releaseRequested) return;
      releaseRequested = true;
      let failed = false, primary;
      try { state.pagehide(); } catch (error) { failed = true; primary = error; }
      if (!tickLease) {
        try { release(); } catch (error) { if (!failed) { failed = true; primary = error; } }
      }
      if (failed) throw primary;
    },
    snapshot() {
      if (!state) { if (!retiredView) throw new Error('Input disposed'); return copyView(retiredView); }
      const result = state.snapshot(); if (result.own) result.own = { token, ...result.own }; return result;
    },
    accumulateStep({ wholeSteps }) { if (state) state.ensure_idle(); live().accumulate_step(stepCount(wholeSteps)); },
    tick({ nowMs, wholeSteps }, send, betweenKeyboardAndBoost) {
      if (!state) throw new Error('Input disposed');
      const owned = state;
      owned.enter_tick(); tickLease = true;
      let failed = false;
      try {
        live();
        finite(nowMs, 'timestamp'); stepCount(wholeSteps); state.validate_tick(nowMs, wholeSteps);
        if (typeof send !== 'function') throw new TypeError('Expected synchronous send capability');
        if (betweenKeyboardAndBoost !== undefined && typeof betweenKeyboardAndBoost !== 'function') throw new TypeError('Expected synchronous input phase hook');
        const intents = [];
        if (!state.is_connected()) return { gazeHeading: state.gaze() ?? null, intents };
        const emit = bytes => { live(); intents.push(bytes.slice()); send(bytes); live(); };
        const keyboard = state.keyboard_phase(nowMs, wholeSteps); if (keyboard.length) emit(keyboard);
        if (betweenKeyboardAndBoost !== undefined) betweenKeyboardAndBoost(Object.freeze({ nowMs, protocolVersion: state.protocol_version() }), emit);
        live();
        if (!state.has_own()) return { gazeHeading: null, intents };
        const boost = state.boost_phase(nowMs); if (boost.length) emit(boost);
        const heading = state.heading_phase(nowMs); if (heading.length) emit(heading);
        return { gazeHeading: state.required_gaze(), intents };
      } catch (error) { failed = true; throw error; }
      finally {
        let cleanupFailed = false, primary;
        try { owned.leave_tick(); } catch (error) { cleanupFailed = true; primary = error; }
        tickLease = false;
        if (releaseRequested) {
          try { release(); } catch (error) { if (!cleanupFailed) { cleanupFailed = true; primary = error; } }
        }
        if (!failed && cleanupFailed) throw primary;
      }
    },
  };
}
