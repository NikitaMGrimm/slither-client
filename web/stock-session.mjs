// Authored, caller-clocked session. Profiles and endpoint choices are external data.
import { unpackCommands } from './handshake-session.mjs';
import { copyHudIngressPlan, copyHudIngressReport } from './stock-hud-contract.mjs';

const freeze = Object.freeze;
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Invalid ${name}`);
  return value;
};
function record(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected data record');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || ![...required, ...optional].includes(key)
      || !Object.hasOwn(descriptors[key], 'value')) throw new TypeError('Unsupported record field');
    result[key] = descriptors[key].value;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) throw new TypeError(`Missing ${key}`);
  return result;
}
function integer(value, maximum, name) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`Invalid ${name}`);
  return value;
}
function copiedBytes(value, length, name) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`Invalid ${name}`);
  const size = Reflect.apply(byteLength, value, []);
  if (length !== undefined && size !== length) {
    throw new TypeError(`Invalid ${name}`);
  }
  const copy = new Uint8Array(size);
  Uint8Array.prototype.set.call(copy, value);
  return copy;
}

const nonSynchronousPrototypes = [async function () {}, function* () {}, async function* () {}].map(Object.getPrototypeOf);
function synchronousHudSink(callback, foreignKinds = false) {
  if (typeof callback !== 'function') throw new TypeError('Synchronous HUD sink required');
  const seen = new Set();
  let prototype = callback;
  for (let visits = 0; ; visits++) {
    // Proxy traps can supply a fresh identity forever; bound all visits as well as cycles.
    if (visits === 64) throw new TypeError('Synchronous HUD sink required');
    prototype = Object.getPrototypeOf(prototype);
    if (prototype === null) break;
    if (seen.has(prototype) || nonSynchronousPrototypes.includes(prototype)) throw new TypeError('Synchronous HUD sink required');
    if (foreignKinds) {
      const kind = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag);
      if (kind && Object.hasOwn(kind, 'value')
        && ['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(kind.value)) throw new TypeError('Synchronous HUD sink required');
    }
    seen.add(prototype);
  }
  const source = Function.prototype.toString.call(callback);
  if (/^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/.test(source)) throw new TypeError('Synchronous HUD sink required');
}

/** One selected literal-IP endpoint; discovery, redirects and probes are separate. */
export function stockEndpoint(input) {
  if (typeof input !== 'string') throw new TypeError('Endpoint string required');
  const match = /^(ws|wss):\/\/(\[[0-9a-fA-F:]+\]|[0-9.]+):([1-9][0-9]{0,4})\/slither$/.exec(input);
  if (!match || Number(match[3]) > 65535) throw new TypeError('Selected literal-IP endpoint required');
  const host = match[2];
  if (host[0] !== '[' && !/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(host)) {
    throw new TypeError('Invalid IPv4 endpoint');
  }
  if (host[0] !== '[' && host.split('.').some(part => Number(part) > 255)) throw new TypeError('Invalid IPv4 endpoint');
  // URL validates IPv6 syntax, after the exact grammar excludes credentials and routes.
  const url = new URL(input);
  return `${url.protocol}//${url.hostname}:${match[3]}/slither`;
}

/** No socket is constructed until an explicit Play and its native reset commit. */
export function createStockSession({ wasm, createSocket, now, maxBufferedBytes = 4096,
  SessionPolicy = wasm?.SessionPolicy }) {
  for (const name of ['encode_login', 'solve_challenge', 'decode_frame', 'setup_protocol_version']) {
    if (typeof wasm?.[name] !== 'function') throw new TypeError('Wasm capability required: ' + name);
  }
  if (typeof createSocket !== 'function' || typeof now !== 'function') throw new TypeError('Session capabilities required');
  integer(maxBufferedBytes, 1048576, 'send budget');
  if (typeof SessionPolicy !== 'function' || typeof SessionPolicy.prototype?.free !== 'function'
    || typeof SessionPolicy.valid_input !== 'function' || typeof SessionPolicy.protocol_allowed !== 'function' || typeof SessionPolicy.negotiation_packet !== 'function') throw new TypeError('Wasm SessionPolicy required');
  const free = SessionPolicy.prototype.free, validInput = SessionPolicy.valid_input;
  const protocolAllowed = SessionPolicy.protocol_allowed, negotiationPacket = SessionPolicy.negotiation_packet;
  let policy = new SessionPolicy();
  try {
  let sink, socket, launch, offeredActions, retired, opaquePingValue;
  let generation = 0, closedSocket = false, busy = false, notifying = false;
  let leases = 0, releaseRequested = false, disposing = false;
  const owner = () => { if (releaseRequested || !policy) throw new Error('Session disposed'); return policy; };
  const terminal = () => releaseRequested || !policy || policy.terminal();
  const outsideIngress = () => { if (busy || notifying) throw new Error('Session reentry'); owner(); };
  const time = () => finite(now(), 'clock');
  // Wasm UTF-8 string conversion replaces lone surrogates. Reasons are arbitrary
  // JS strings, so retain and copy their exact UTF-16 units at the object boundary.
  function copiedSnapshot(current) {
    const raw = current.snapshot();
    const value = { ...raw, lastPingMs: current.ping_external() ? opaquePingValue : raw.lastPingMs };
    if (value.reason === null) return freeze({ ...value });
    const pieces = [];
    for (let i = 0; i < value.reason.length; i += 8192) {
      pieces.push(String.fromCharCode(...value.reason.subarray(i, i + 8192)));
    }
    return freeze({ ...value, reason: pieces.join('') });
  }
  function release() {
    if (!releaseRequested || leases || !policy) return;
    const current = policy; policy = undefined;
    let failed = false, failure;
    try { retired = copiedSnapshot(current); } catch (error) { failed = true; failure = error; }
    try { Reflect.apply(free, current, []); } catch (error) { if (!failed) { failed = true; failure = error; } }
    opaquePingValue = undefined;
    if (failed) throw failure;
  }
  // Resource leases contain no policy decisions. They keep synchronous host
  // callbacks from releasing an owner that an enclosing operation still uses.
  function leased(callback) {
    owner(); leases++;
    let failed = false;
    try { return callback(); } catch (error) { failed = true; throw error; }
    finally { leases--; try { release(); } catch (error) { if (!failed) throw error; } }
  }
  function snapshot() { return policy ? copiedSnapshot(policy) : retired; }
  function publish() {
    notifying = true;
    try { sink?.state(snapshot()); } finally { notifying = false; }
  }
  function detach(onError) {
    if (!socket) return;
    for (const key of ['onopen', 'onmessage', 'onerror', 'onclose']) {
      try { socket[key] = null; } catch (error) { onError(error); }
    }
  }
  function stop(nextPhase, code, error, hasError = false) {
    if (terminal()) return;
    const retainFailure = secondary => { if (!hasError) { hasError = true; error = secondary; } };
    if (!owner().begin_stop(nextPhase === 'failed', Uint16Array.from({ length: code.length }, (_, index) => code.charCodeAt(index)))) return;
    launch?.login.fill(0); launch = undefined; generation++; detach(retainFailure);
    // A nested disposal can request release during detach. The terminal
    // transaction still owns its lease and must finish its already-admitted reset.
    policy.stop_actions();
    if (socket && !closedSocket) {
      closedSocket = true;
      try { if (socket.readyState !== 3) socket.close(); } catch (closeError) { retainFailure(closeError); }
    }
    try { publish(); } catch (notificationError) { retainFailure(notificationError); }
    if (hasError) {
      notifying = true;
      try { sink?.error(error); } catch { /* Original failure remains authoritative. */ }
      finally { notifying = false; }
    }
  }
  function fail(error, code = 'session-failed') { stop('failed', code, error, true); }
  function guarded(callback) {
    return leased(() => {
      if (busy) throw new Error('Session reentry');
      busy = true;
      try { return callback(); }
      catch (error) { fail(error); throw error; }
      finally { busy = false; }
    });
  }
  function send(bytes) {
    if (!socket || socket.readyState !== 1 || terminal()) throw new Error('Socket is not open');
    const buffered = socket.bufferedAmount;
    if (!Number.isFinite(buffered) || buffered < 0 || buffered > maxBufferedBytes) throw new Error('Stock send queue full');
    socket.send(bytes);
    if (terminal()) throw new Error('Session stopped during send');
  }
  function receive(data) {
    if (!(data instanceof ArrayBuffer) || data.byteLength > 1048576) throw new TypeError('Binary protocol frame required');
    const bytes = new Uint8Array(data);
    owner().receive_bytes(bytes.length);
    const commands = unpackCommands(wasm.decode_frame(bytes, false));
    if (owner().receive_header(commands.length, commands[0][0])) {
      const reply = copiedBytes(wasm.solve_challenge(commands[0].subarray(1)), 27, 'challenge reply');
      send(reply); send(launch.login.slice());
      launch.login.fill(0); launch = undefined;
      owner().challenged(); publish(); return;
    }
    for (const command of commands) {
      if (owner().command_requires_version(command[0], command.length)) {
        const version = wasm.setup_protocol_version(command);
        owner().admit_protocol(typeof version === 'number' ? version : NaN);
      }
    }
    const receivedMs = time();
    const schema = owner().schema();
    const pairs = Uint8Array.from(commands.flatMap(command => [command[0], command[1] ?? 0]));
    const copiedPlan = owner().prepare_controls(pairs, receivedMs);
    const plan = schema ? copyHudIngressPlan({ schema: copiedPlan.schema, commandCount: copiedPlan.commandCount,
      guards: Array.from(copiedPlan.guards, guard => ({ playing: guard.playing,
        closeRequested: guard.closeRequested, deathPending: guard.deathPending })),
      finalCaptureIndices: Array.from(copiedPlan.finalCaptureIndices) }) : null;
    const packetGeneration = generation;
    const applied = schema ? sink.packet(bytes, false, plan) : sink.packet(bytes, false);
    if (terminal() || generation !== packetGeneration) throw new Error('Session stopped during packet');
    let report;
    if (schema) {
      report = copyHudIngressReport(applied, commands.length);
      if (report.schema !== schema) throw new TypeError('Invalid HUD data');
      const kinds = { setup: 0, 'setup-draw': 1, leaderboard: 2, 'final-score': 3, 'own-length-scheduled': 4 };
      const events = Uint32Array.from(report.events.flatMap(event =>
        [event.commandIndex, kinds[event.kind], event.deathPending === true ? 1 : 0]));
      owner().match_report(events, report.setupDraws);
    } else if (applied !== undefined && (!Number.isInteger(applied) || applied < 0 || applied > 4096)) {
      throw new TypeError('Synchronous packet result required');
    }
    if (terminal() || generation !== packetGeneration) throw new Error('Session stopped during packet');
    owner().commit_controls();
    if (schema) {
      notifying = true;
      try { if (sink?.hud(report) !== undefined) throw new TypeError('Synchronous HUD notification required'); }
      finally { notifying = false; }
    }
    publish();
  }
  function construct() {
    const activeGeneration = ++generation;
    const active = () => generation === activeGeneration && !terminal();
    owner().begin_construct(time());
    socket = createSocket(launch.endpoint);
    if (!socket || typeof socket.send !== 'function' || typeof socket.close !== 'function') throw new TypeError('Invalid socket capability');
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (!active()) return;
      try { guarded(() => {
        owner().check_open();
        send(Reflect.apply(negotiationPacket, SessionPolicy, [0]));
        send(Reflect.apply(negotiationPacket, SessionPolicy, [1]));
        owner().opened(); publish();
      }); } catch (error) { fail(error); }
    };
    socket.onmessage = event => {
      if (!active()) return;
      try { guarded(() => receive(event.data)); } catch (error) { fail(error); }
    };
    socket.onerror = event => { if (active()) leased(() => fail(event instanceof Error ? event : new Error('Stock socket error'), 'socket-error')); };
    socket.onclose = () => { if (active()) leased(() => stop('disconnected', 'socket-closed')); };
  }
  function foldAfterStep(request, requireHud = false) {
    outsideIngress(); owner().check_step(requireHud);
    const admittedNow = finite(request?.nowMs, 'step time');
    const delta = finite(request?.delta, 'lagged step');
    const wholeSteps = integer(request?.wholeSteps, 5, 'whole steps');
    if (delta < 0 || delta > 5) throw new RangeError('Invalid lagged step');
    // The original boundary rereads time only while death is pending. Coercion
    // and caller getters finish before entering the Rust stage.
    const stepNow = owner().has_death() ? request.nowMs - 0 : admittedNow;
    const observed = owner().advance_step(stepNow, delta, wholeSteps);
    if (observed.close) stop('disconnected', 'life-returned');
    owner().finish_step(!!socket);
    return freeze({ actions: freeze({ ...owner().pending_actions().actions }), lifecycle: freeze({ ...observed.lifecycle }) });
  }
  function subscribeHud(value, schema) {
    owner().check_subscribe();
    if (!value || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new TypeError('Expected data record');
    const next = record(value, ['packet', 'hud', 'state', 'error']);
    for (const name of ['packet', 'hud', 'state', 'error']) if (typeof next[name] !== 'function') throw new TypeError('Synchronous subscriber required');
    synchronousHudSink(next.hud, schema === 2);
    owner().check_subscribe(); owner().subscribe(schema); sink = next;
    return () => { sink = undefined; };
  }
  const methods = {
    snapshot,
    subscribe(value) {
      owner().check_subscribe();
      const next = record(value, ['packet', 'state', 'error']);
      for (const name of ['packet', 'state', 'error']) if (typeof next[name] !== 'function') throw new TypeError('Synchronous subscriber required');
      owner().subscribe(0); sink = next;
      return () => { sink = undefined; };
    },
    subscribeWithHud(value) { return subscribeHud(value, 1); },
    subscribeWithLeaderboardRows(value) { return subscribeHud(value, 2); },
    play(value) {
      if (busy) throw new Error('Session reentry');
      owner().check_play(!!sink);
      const request = record(value, ['endpoint', 'profile', 'nickname', 'skin', 'customSkin']);
      const profile = record(request.profile, ['clientVersion', 'password', 'protocolVersion']);
      integer(profile.clientVersion, 65535, 'client version');
      if (typeof profile.protocolVersion !== 'number' || !Reflect.apply(protocolAllowed, SessionPolicy, [profile.protocolVersion])) throw new RangeError('Protocol 19 required');
      const password = copiedBytes(profile.password, 20, 'external profile');
      let endpoint, login;
      try {
        const custom = copiedBytes(request.customSkin, undefined, 'custom skin');
        if (custom.length > 255 || typeof request.nickname !== 'string' || !/^[\x20-\x7f]{0,24}$/.test(request.nickname)) throw new TypeError('Invalid login fields');
        integer(request.skin, 255, 'skin'); endpoint = stockEndpoint(request.endpoint);
        login = copiedBytes(wasm.encode_login(profile.clientVersion, password, request.nickname, request.skin, custom), undefined, 'encoded login');
      } finally { password.fill(0); }
      return guarded(() => { launch = { endpoint, login }; owner().begin_play(); publish(); });
    },
    beforeUpdate(nowMs) {
      outsideIngress(); finite(nowMs, 'update time');
      if (owner().handshake_timed_out(nowMs)) fail(new Error('Stock handshake timed out'), 'handshake-timeout');
      if (owner().ping_external()) {
        if (owner().lag_check_needed()) {
          const elapsed = nowMs - opaquePingValue;
          owner().observe_lag_elapsed(elapsed);
        }
      } else owner().observe_lag(nowMs);
      const value = snapshot(); return freeze({ lagging: value.lagging, connected: value.connected, playing: value.playing });
    },
    pendingActions() {
      outsideIngress(); const value = owner().pending_actions();
      offeredActions = freeze({ revision: value.revision, actions: freeze({ ...value.actions }) }); return offeredActions;
    },
    acknowledgeActions(value) {
      outsideIngress();
      if (value !== offeredActions || value.revision !== owner().pending_actions().revision) throw new Error('Stale action acknowledgement');
      owner().acknowledge(value.revision); offeredActions = undefined;
    },
    afterStep(request) { return foldAfterStep(request).actions; },
    afterStepWithHud(request) { return foldAfterStep(request, true); },
    commitControl() { outsideIngress(); if (owner().commit_control(!!socket)) guarded(construct); },
    betweenKeyboardAndBoost(context, emit) {
      outsideIngress(); finite(context?.nowMs, 'ping time');
      const protocol = context?.protocolVersion;
      if (typeof protocol !== 'number' || !Reflect.apply(protocolAllowed, SessionPolicy, [protocol]) || typeof emit !== 'function') throw new TypeError('Protocol 19 ping capability required');
      if (!owner().ping_available()) return;
      const observed = context.nowMs;
      let due;
      if (typeof observed === 'number' && !owner().ping_external()) {
        due = owner().ping_due(observed);
      } else {
        // Capture the right operand before either ToNumeric callback. Rust
        // retains the gate/threshold; only JS can preserve arbitrary value identity.
        const previous = owner().ping_external() ? opaquePingValue : owner().snapshot().lastPingMs;
        const elapsed = observed - previous;
        // BigInt subtraction is legal when both delayed operands are BigInt.
        // Project its result for the copied f64 ABI; every integer near the
        // Rust threshold is exact, and larger magnitudes keep their ordering.
        due = owner().ping_due_elapsed(typeof elapsed === 'bigint' ? Number(elapsed) : elapsed);
      }
      if (!due) return;
      const committed = context.nowMs;
      // The third read was an assignment, never a numeric admission/coercion.
      const numeric = typeof committed === 'number';
      opaquePingValue = numeric ? undefined : committed;
      const intent = numeric ? owner().commit_ping(committed) : owner().commit_opaque_ping();
      try { emit(intent); } catch (error) { fail(error); throw error; }
    },
    sendInput(value) {
      outsideIngress(); const bytes = copiedBytes(value, undefined, 'input packet');
      if (!Reflect.apply(validInput, SessionPolicy, [bytes])) throw new TypeError('Invalid compact input packet');
      if (!snapshot().connected) throw new Error('Session is not connected');
      try { send(bytes); } catch (error) { fail(error); throw error; }
    },
    uiTick(nowMs) { outsideIngress(); finite(nowMs, 'UI time'); owner().ui_tick(nowMs); return snapshot(); },
    close(code = 'closed') { outsideIngress(); if (typeof code !== 'string') throw new TypeError('Close reason required'); stop('disconnected', code); },
  };
  const result = { snapshot };
  for (const [name, method] of Object.entries(methods)) {
    if (name !== 'snapshot') result[name] = (...args) => leased(() => method(...args));
  }
  result.dispose = (code = 'disposed') => {
    if (disposing || releaseRequested || !policy) return;
    return leased(() => {
      outsideIngress();
      if (typeof code !== 'string') throw new TypeError('Close reason required');
      disposing = true;
      let failed = false, failure;
      try { methods.close(code); } catch (error) { failed = true; failure = error; }
      finally { releaseRequested = true; generation++; }
      if (failed) throw failure;
    });
  };
  return freeze(result);
  } catch (error) {
    const current = policy; policy = undefined;
    if (current) { try { Reflect.apply(free, current, []); } catch { /* Constructor failure remains primary, even undefined. */ } }
    throw error;
  }
}
