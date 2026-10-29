import { createStockSession, stockEndpoint } from './stock-session.mjs';
import { createClientInput } from './client-input.mjs';
import { createStockLiveProfileAcquirer } from './stock-live-profile.mjs';
import { createHudState, hudReadoutRequired, reduceHudState } from './stock-hud-state.mjs';
import { createLeaderboardState, prepareLeaderboardPacket, completeLeaderboardPacket,
  resetLeaderboardWorld } from './stock-leaderboard-state.mjs';

const POLICY_METHOD_NAMES = [
  'snapshot', 'set_nickname', 'nickname', 'disposed', 'fatal',
  'profile', 'acquiring', 'poison_reentry', 'packet_rejected', 'run_rejected',
  'play_rejected', 'live_rejected', 'post_callback_fatal', 'current_allowed', 'mark_dirty',
  'dirty', 'may_schedule', 'retain_error', 'reconcile_entry', 'needs_connected',
  'connected_done', 'take_status', 'packet_base', 'clear_companion', 'stage_companion',
  'take_companion', 'stage_packet', 'publish_pending', 'publication_allowed', 'begin_frame',
  'frame_stage', 'begin_control', 'debt_done', 'lifecycle_done', 'reset_input',
  'control_done', 'include_announcements', 'include_minimap', 'controller_done', 'score_done',
  'commit_profile', 'frame_commit_done', 'finish_frame', 'profile_needs_current', 'profile_available',
  'profile_idle', 'begin_profile', 'profile_started', 'profile_retry_allowed', 'profile_retry',
  'profile_ready', 'profile_failed', 'replace_local', 'begin_dispose', 'claim_fatal_notification',
  'frame_score_required', 'frame_commit_allowed', 'frame_publication_allowed', 'input_allowed', 'history_reset',
  'free',
];
const PROFILE_LABELS = ['unavailable','idle','acquiring','ready','committed','failed','disposed'];
const STATUS_LABELS = ['', 'ready-not-connected', 'connected', 'disconnected'];
const stringCodeUnit = String.prototype.charCodeAt;
const stringFromCodeUnit = String.fromCharCode;

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
export function createStockGameplay(options) {
  const { scene, quality, controller, wasm, createSocket, now,
  defer, setInterval, clearInterval, onStatus, onFatal, liveProfile, onHudPacket, hudReadout = false,
  leaderboardRows = false, leaderboardProjector, localSession = false, minimapTracking = false, announcementTracking = false } = options;
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
  const input = createClientInput({ protocolVersion: 19, InputPolicy: wasm.DesktopInput });
  let session, gameplayOwner, policyMethods, policyStatics;
  let policyLeases = 0, releaseRequested = false, retiredPolicy;
  try {
  session = createStockSession({ wasm, createSocket, now, SessionPolicy: wasm.SessionPolicy });
  const injectedPolicy = options.GameplayPolicy;
  const Policy = injectedPolicy === undefined ? wasm.GameplayPolicy : injectedPolicy;
  if (typeof Policy !== 'function') throw new TypeError('GameplayPolicy capability required');
  function capture(object, name) {
    for (let p = object; p !== null; p = Object.getPrototypeOf(p)) {
      const field = Object.getOwnPropertyDescriptor(p, name);
      if (field) { if (typeof field.value !== 'function') break; return field.value; }
    }
    throw new TypeError('GameplayPolicy capability required: ' + name);
  }
  policyMethods = {};
  for (const name of POLICY_METHOD_NAMES) policyMethods[name] = capture(Policy.prototype, name);
  policyStatics = { css_ceil: capture(Policy, 'css_ceil'), timer_action: capture(Policy, 'timer_action'), status: capture(Policy, 'status') };
  gameplayOwner = new Policy(hudReadout, leaderboardRows, localSession, minimapTracking, announcementTracking, !!profileOptions);
  let active = false, queued = false, fatal, uiTimer;
  let reconciling = false;
  function policy(name, args = []) {
    if (gameplayOwner) return Reflect.apply(policyMethods[name], gameplayOwner, args);
    if (!retiredPolicy) throw new Error('Gameplay policy disposed');
    // Retired observations never evolve state or invoke a released Wasm owner.
    switch (name) {
      case 'disposed': return retiredPolicy[0] !== 0;
      case 'fatal': return retiredPolicy[1] !== 0;
      case 'dirty': return retiredPolicy[2] !== 0;
      case 'profile': return retiredPolicy[3];
      case 'acquiring': return retiredPolicy[3] === 2;
      case 'current_allowed': return false;
      case 'packet_rejected': case 'run_rejected': case 'play_rejected': case 'live_rejected': return true;
      case 'poison_reentry': case 'may_schedule': return false;
      case 'reconcile_entry': return 0;
      default: throw new Error('Gameplay policy disposed');
    }
  }
  function releasePolicy() {
    if (!releaseRequested || policyLeases !== 0 || !gameplayOwner) return;
    const owner = gameplayOwner;
    let failed = false, primary;
    try { retiredPolicy = Reflect.apply(policyMethods.snapshot, owner, []); }
    catch (error) { failed = true; primary = error; }
    gameplayOwner = null;
    try { Reflect.apply(policyMethods.free, owner, []); }
    catch (error) { if (!failed) { failed = true; primary = error; } }
    if (failed) throw primary;
  }
  function lease(callback) {
    policyLeases++;
    let failed = false;
    try { return callback(); }
    catch (error) { failed = true; throw error; }
    finally { policyLeases--; try { releasePolicy(); } catch (error) { if (!failed) throw error; } }
  }
  const profileLabel = () => PROFILE_LABELS[policy('profile')];
  const hudIdentity = hudReadout ? Symbol('gameplay scene') : null;
  // Opaque issued-object storage only. Rust selects presence, base and publication.
  const pairs = [{ hud: hudReadout ? createHudState(hudIdentity, wasm.HudHistory) : null,
    rows: leaderboardRows ? createLeaderboardState(hudIdentity, wasm.LeaderboardHistory) : null }, null];
  let leaderboardCompanion = null;
  const selectedPair = () => pairs[policy('packet_base')];
  function nickname() {
    const units = policy('nickname'); let value = '';
    for (let i = 0; i < units.length; i++) value += stringFromCodeUnit(units[i]);
    return value;
  }
  function retainNickname(value) {
    const units = new Uint16Array(value.length);
    for (let i = 0; i < value.length; i++) units[i] = Reflect.apply(stringCodeUnit, value, [i]);
    policy('set_nickname', [units]);
  }
  let profileIntent, checkingCurrent = false;
  const acquiring = () => policy('acquiring');
  function current(intent) {
    if (!policy('current_allowed') || profileIntent !== intent || intent.cancelled || checkingCurrent) return false;
    checkingCurrent = true;
    try {
      return profileOptions.isCurrentDocument() === true && policy('current_allowed')
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
    if (!policy('may_schedule', [queued])) return;
    queued = true;
    defer(() => lease(() => { queued = false; if (!releaseRequested && !policy('disposed')) reconcile(); }));
  };
  const retainError = error => {
    if (policy('retain_error')) fatal = error;
    pairs[1] = null;
    leaderboardCompanion = null;
  };
  const latchError = error => {
    retainError(error);
    try { schedule(); } catch { /* Scheduling cannot replace the retained primary. */ }
  };
  const observer = {
    packet(bytes, elapsedHeader) { return lease(() => {
      if (policy('packet_rejected', [active])) throw new Error('Gameplay packet reentry');
      active = true;
      try { return controller.packet(bytes, elapsedHeader); }
      catch (error) { latchError(error); throw error; }
      finally { active = false; }
    }); },
    // A notification can be inside session ingress OR a mutable Wasm control borrow.
    // Only captured microtasks may reconcile/free after BOTH stacks have unwound.
    state() { if (!gameplayOwner) return; return lease(() => { policy('mark_dirty'); schedule(); }); },
    error: error => { if (gameplayOwner) return lease(() => latchError(error)); },
  };
  const hudObserver = {
    ...observer,
    packet(bytes, elapsedHeader, plan) {
      return hudOperation(() => {
        leaderboardCompanion = null; policy('clear_companion');
        const report = controller.packetWithHud(bytes, elapsedHeader, plan);
        if (leaderboardRows && policy('fatal')) throw fatal;
        if (leaderboardRows) {
          // Native conversion and held-source release have both returned. Admit the
          // complete report before calling the caller-owned numeric projector.
          const state = selectedPair().rows;
          const prepared = prepareLeaderboardPacket(state, report);
          const scores = [];
          for (const request of prepared.requests) {
            const result = Reflect.apply(project, leaderboardProjector, [request.tableMax,
              Float64Array.from(request.counts), Float64Array.from(request.fractionalMasses)]);
            if (policy('fatal')) throw fatal;
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
          policy('stage_companion');
        }
        return report;
      });
    },
    hud(report) {
      return hudOperation(() => {
        const companion = leaderboardCompanion;
        leaderboardCompanion = null;
        if (!policy('take_companion')) throw new Error('Missing leaderboard packet companion');
        const candidate = hudReadout
          ? reduceHudState(selectedPair().hud, hudIdentity, { kind: 'packet', report }) : null;
        const rowCandidate = leaderboardRows ? completeLeaderboardPacket(companion.state,
          companion.prepared, companion.scores, nickname()) : null;
        if (onHudPacket !== undefined && onHudPacket(report) !== undefined) {
          throw new TypeError('Synchronous onHudPacket must return undefined');
        }
        if (policy('stage_packet')) pairs[1] = { hud: candidate, rows: rowCandidate };
      });
    },
  };
  function subscribeSession() {
    if (!hudReadout && onHudPacket === undefined) return session.subscribe(observer);
    return (leaderboardRows ? session.subscribeWithLeaderboardRows : session.subscribeWithHud)(hudObserver);
  }
  let unsubscribe = subscribeSession();
  function hudOperation(callback) { return lease(() => hudOperationBody(callback)); }
  function hudOperationBody(callback) {
    if (policy('fatal')) throw fatal;
    if (policy('packet_rejected', [active])) throw rejectedOperation('Gameplay HUD reentry');
    active = true;
    try {
      const result = callback();
      if (policy('post_callback_fatal')) throw fatal;
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
    if (policy('poison_reentry', [active, reconciling, checkingCurrent])) latchError(error);
    return error;
  }
  function clearUiTimer() {
    if (uiTimer !== undefined) {
      const timer = uiTimer;
      uiTimer = undefined;
      clearInterval(timer);
    }
  }
  function dispose() { if (releaseRequested) return; return lease(disposeBody); }
  function disposeBody() {
    if (policy('disposed')) return;
    if (active) throw rejectedOperation('Gameplay disposal reentry');
    policy('begin_dispose');
    pairs[0] = { hud: null, rows: null }; pairs[1] = null;
    leaderboardCompanion = null;
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
    cleanup(() => session.dispose('host-disposed'));
    cleanup(() => input.dispose());
    if (policy('claim_fatal_notification')) {
      try { onFatal(fatal); } catch { /* Notification cannot replace its primary. */ }
    }
    releaseRequested = true;
    if (cleanupFailed) throw fatal;
  }
  function reconcile() { return lease(reconcileBody); }
  function reconcileBody() {
    const entry = policy('reconcile_entry', [active]);
    if (entry === 0) return;
    if (entry === 1) { schedule(); return; }
    reconciling = true;
    try {
      if (policy('fatal')) {
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
      if (policy('needs_connected', [state.connected])) {
        scene.set_connected(state.connected);
        policy('connected_done', [state.connected]);
      }
      if (Reflect.apply(policyStatics.timer_action, Policy, [state.uiTimerNeeded, uiTimer !== undefined]) === 1) {
        const timerSession = session;
        uiTimer = setInterval(() => lease(() => {
          if (releaseRequested || policy('disposed') || session !== timerSession) return;
          try {
            const observed = timerSession.uiTick(now());
            observeMinimapFraction?.(observed.returnFraction);
            policy('mark_dirty'); reconcile();
          }
          catch (error) { latchError(error); }
        }), 25);
      } else if (Reflect.apply(policyStatics.timer_action, Policy, [state.uiTimerNeeded, uiTimer !== undefined]) === 2) clearUiTimer();
      if (policy('take_status')) {
        const ready = state.phase === 'ready';
        const status = Reflect.apply(policyStatics.status, Policy, [ready, ready ? false : state.connected]);
        onStatus(STATUS_LABELS[status]);
      }
      // Ingress and source release have unwound; all reconciliation must succeed.
      if (policy('publish_pending')) { pairs[0] = pairs[1]; pairs[1] = null; }
    } catch (error) { latchError(error); }
    finally { reconciling = false; }
  }
  function run(callback) {
    // A nested draw cannot bypass an unfinished packet reconciliation barrier.
    if (policy('run_rejected', [active, checkingCurrent, reconciling])) {
      throw rejectedOperation('Gameplay stopped or reentrant');
    }
    reconcile();
    if (policy('disposed') || policy('fatal')) throw new Error('Gameplay stopped');
    active = true;
    try {
      const result = callback();
      if (policy('post_callback_fatal')) throw fatal;
      return result;
    } catch (error) { latchError(error); throw error; }
    finally {
      active = false;
      if (policy('dirty')) {
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
      viewportWidth: Reflect.apply(policyStatics.css_ceil, Policy, [+viewport.width]), viewportHeight: Reflect.apply(policyStatics.css_ceil, Policy, [+viewport.height]),
      follow: view.follows, camera: view.camera, head: view.own?.rawHead, zoom: view.zoom };
  }
  function drawHud(candidate) {
    if (policy('fatal')) throw fatal;
    if (policy('disposed')) throw new Error('Gameplay stopped');
    const playing = session.snapshot().playing;
    const view = hudReadoutRequired(candidate, playing) ? scene.score_view() : null;
    const next = reduceHudState(candidate, hudIdentity, { kind: 'draw', playing, view });
    if (policy('fatal')) throw fatal;
    return next;
  }
  function checkProfile() {
    if (policy('profile_needs_current') && !current(profileIntent)) {
      cancelProfile(profileIntent); policy('profile_failed'); throw profileError('stale-intent');
    }
  }
  function admitPlay(request) {
    if (!leaderboardRows && !localSession) { session.play(request); return; }
    active = true;
    try {
      const admitted = leaderboardRows ? ownRecord(request, ['endpoint', 'profile', 'nickname', 'skin', 'customSkin']) : request;
      const status = localSession ? session.snapshot() : null;
      if (policy('replace_local', [localSession && status.phase === 'disconnected',
        localSession && status.phase === 'victory' && status.playing === false])) {
        try {
          clearUiTimer();
          session.dispose('local-session-replaced');
          unsubscribe();
          leaderboardCompanion = null; policy('clear_companion');
          if (policy('fatal')) throw fatal;
          session = createStockSession({ wasm, createSocket, now, SessionPolicy: wasm.SessionPolicy });
          unsubscribe = subscribeSession();
        } catch (error) { latchError(error); throw error; }
      }
      session.play(admitted);
      if (policy('fatal')) throw fatal;
      // Retain the admitted copy, never reread a caller's mutable login field.
      if (leaderboardRows) retainNickname(admitted.nickname);
    } finally { active = false; }
  }
  function draw(method, args) {
    if (acquiring() && !policy('disposed')) return undefined;
    return run(() => {
      if (acquiring()) return undefined;
      checkProfile();
      const operation = controller[method];
      if (typeof operation !== 'function') throw new TypeError(`Gameplay capability required: ${method}`);
      const result = Reflect.apply(operation, controller, args);
      checkProfile();
      const candidate = hudReadout ? drawHud(pairs[0].hud) : null;
      if (policy('publication_allowed')) pairs[0] = { hud: candidate, rows: pairs[0].rows };
      return result;
    });
  }
  const api = {
    play(request) {
      if (policy('play_rejected', [active, checkingCurrent, reconciling])) {
        throw rejectedOperation('Gameplay stopped or reentrant');
      }
      if (acquiring()) throw profileError('acquiring');
      // Invalid profiles are correctable caller errors, with no connection/quality effects.
      admitPlay(request);
      try { quality.begin_connection(); } catch (error) { latchError(error); throw error; }
    },
    async playWithLiveProfile(request) {
      policyLeases++;
      let asyncFailed = false;
      try {
      if (policy('live_rejected', [active, checkingCurrent])) throw rejectedOperation('Gameplay stopped or reentrant');
      if (!policy('profile_available')) throw profileError('unavailable');
      if (!policy('profile_idle') || session.snapshot().phase !== 'ready') throw profileError('already-attempted');
      const intent = { cancelled: false };
      profileIntent = intent; policy('begin_profile');
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
        policy('profile_started');
        intent.acquirer = createStockLiveProfileAcquirer({ capabilities: profileOptions.capabilities,
          literalParser: wasm.ProfileLiteralParser,
          isCurrentDocument: () => current(intent) });
        await intent.acquirer.acquireForPlay(profile => {
          if (!current(intent)) throw profileError('stale-intent');
          admitPlay({ ...intent.request, profile });
        });
        if (!current(intent)) throw profileError('stale-intent');
        quality.begin_connection();
        if (!current(intent)) throw profileError('stale-intent');
        clearRequest(intent);
        policy('profile_ready'); schedule();
      } catch (error) {
        if (policy('profile_retry_allowed')) {
          try { clearRequest(intent); } catch { /* Preserve the original request failure. */ }
          profileIntent = undefined; policy('profile_retry');
        } else {
          cancelProfile(intent);
          if (!policy('disposed')) { policy('profile_failed'); latchError(error); }
        }
        throw error;
      }
      } catch (error) { asyncFailed = true; throw error; }
      finally {
        policyLeases--;
        try { releasePolicy(); } catch (error) { if (!asyncFailed) throw error; }
      }
    },
    frame(nowMs) {
      // RAF keeps running while the private consumer may have staged a login, but
      // neither native reset nor commit can run until acquisition has fully fulfilled.
      if (acquiring() && !policy('disposed')) return undefined;
      return run(() => {
        // Reconciliation notifications may start an intent after the entry check.
        if (acquiring()) return undefined;
        checkProfile();
        let candidate = pairs[0].hud;
        let rowCandidate = pairs[0].rows;
        policy('begin_frame');
        const flags = session.beforeUpdate(nowMs);
        const result = controller.frame(nowMs, { lagging: flags.lagging, playing: flags.playing,
          readPlaying: () => session.snapshot().playing,
          control(request) {
            policy('begin_control');
            input.setConnected(session.snapshot().connected);
            input.setOwn(request.control.own);
            input.accumulateStep({ wholeSteps: request.wholeSteps });
            policy('debt_done');
            let actions;
            if (hudReadout) {
              const observed = session.afterStepWithHud(request);
              actions = observed.actions;
              if (policy('include_announcements')) actions = { ...actions, announcementLifecycle: observed.lifecycle };
              if (policy('include_minimap', [minimapTracking && observed.lifecycle.returnActive])) {
                actions = { ...actions, minimapUiFraction: observed.lifecycle.returnFraction };
              }
              candidate = reduceHudState(candidate, hudIdentity,
                { kind: 'step', delta: request.delta, lifecycle: observed.lifecycle });
              if (policy('history_reset', [!!actions.resetWorld])) {
                candidate = reduceHudState(candidate, hudIdentity, { kind: 'world-reset' });
                if (leaderboardRows) rowCandidate = resetLeaderboardWorld(rowCandidate);
              }
            } else actions = session.afterStep(request);
            policy('lifecycle_done', [!!actions.resetWorld]);
            if (policy('reset_input')) { input.reset(); policy('control_done'); return { ...actions }; }
            if (!policy('input_allowed')) throw new Error('Gameplay input stage');
            input.setConnected(session.snapshot().connected);
            const intent = input.tick({ nowMs: request.nowMs, wholeSteps: 0 },
              bytes => session.sendInput(bytes),
              (context, emit) => session.betweenKeyboardAndBoost(context, emit));
            policy('control_done');
            return { ...actions, ...(intent.gazeHeading === null ? {} : { gazeHeading: intent.gazeHeading }) };
          },
        });
        checkProfile();
        policy('controller_done');
        if (policy('frame_score_required')) candidate = drawHud(candidate);
        policy('score_done');
        // Render, quality, step free AND held source release must all succeed first.
        if (policy('frame_commit_allowed')) session.commitControl();
        const state = session.snapshot();
        if (policy('profile_needs_current') && policy('commit_profile', [state.constructorAttempts > 0])) profileIntent = undefined;
        policy('frame_commit_done', [state.connected]);
        if (policy('frame_publication_allowed')) pairs[0] = { hud: candidate, rows: rowCandidate };
        policy('finish_frame');
        return result;
      });
    },
    render() { return draw('render', []); },
    resize(width, height) { return draw('resize', [width, height]); },
    hudSnapshot: () => pairs[0].hud,
    leaderboardSnapshot: () => pairs[0].rows,
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
    diagnostics: () => Object.freeze({ disposed: policy('disposed'), active, profilePhase: profileLabel(), session: session.snapshot(), input: input.snapshot() }),
    dispose,
  };
  const result = {};
  for (const [name, callback] of Object.entries(api)) {
    Object.defineProperty(result, name, { enumerable: true, value: (...args) =>
      name === 'playWithLiveProfile' ? Reflect.apply(callback, api, args)
        : lease(() => Reflect.apply(callback, api, args)) });
  }
  // Subscription, queued and timer callbacks also carry resource leases.
  return Object.freeze(result);
  } catch (error) {
    try { session?.dispose(); } catch { /* Preserve the exact construction failure. */ }
    try { input.dispose(); } catch { /* Construction failure remains primary, even undefined. */ }
    releaseRequested = true;
    if (gameplayOwner) {
      const owner = gameplayOwner;
      try { Reflect.apply(policyMethods.begin_dispose, owner, []); retiredPolicy = Reflect.apply(policyMethods.snapshot, owner, []); }
      catch { /* Retiring a partial owner cannot replace the construction primary. */ }
      gameplayOwner = null;
      try { Reflect.apply(policyMethods.free, owner, []); } catch { /* New owner cleanup cannot replace construction primary. */ }
    }
    throw error;
  }
}
