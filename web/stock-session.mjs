// Authored, caller-clocked session. Profiles and endpoint choices are external data.
import { unpackCommands } from './handshake-session.mjs';

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
export function createStockSession({ wasm, createSocket, now, maxBufferedBytes = 4096 }) {
  for (const name of ['encode_login', 'solve_challenge', 'decode_frame', 'setup_protocol_version']) {
    if (typeof wasm?.[name] !== 'function') throw new TypeError(`Wasm capability required: ${name}`);
  }
  if (typeof createSocket !== 'function' || typeof now !== 'function') throw new TypeError('Session capabilities required');
  integer(maxBufferedBytes, 1048576, 'send budget');
  let sink;
  let subscribed = false;
  let phase = 'ready';
  let connected = false;
  let playing = false;
  let lifeEnded = false;
  let lagging = false;
  let pingPending = false;
  let lastPingMs = 0;
  let closeRequested = false;
  let reason = null;
  let socket;
  let generation = 0;
  let constructorAttempts = 0;
  let closedSocket = false;
  let startedMs;
  let launch;
  let launchCommitted = false;
  let busy = false;
  let notifying = false;
  let actions = {};
  let actionRevision = 0;
  let offeredActions;
  let stepRevision;
  let deathMs = null;
  let returnFraction = 0;
  let uiPhase = 'idle';
  let previousUiMs = 0;
  let handshakeFrames = 0;
  let handshakeBytes = 0;
  const terminal = () => phase === 'failed' || phase === 'disconnected';
  const outsideIngress = () => { if (busy || notifying) throw new Error('Session reentry'); };
  const time = () => finite(now(), 'clock');
  function snapshot() {
    return freeze({ phase, connected, playing, lifeEnded, lagging, pingPending,
      lastPingMs, closeRequested, returnFraction, uiTimerNeeded: uiPhase === 'in',
      reason, constructorAttempts });
  }
  function publish() {
    notifying = true;
    try { sink?.state(snapshot()); } finally { notifying = false; }
  }
  function requestActions(next) { actions = { ...actions, ...next }; actionRevision++; }
  function detach() {
    if (!socket) return;
    socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
  }
  function stop(nextPhase, code, error) {
    if (terminal()) return;
    phase = nextPhase; reason = code; connected = false; playing = false;
    lagging = false; pingPending = false; closeRequested = false; uiPhase = 'idle';
    launch?.login.fill(0); launch = undefined; generation++; detach();
    requestActions({ resetWorld: true, connected: false });
    if (socket && !closedSocket && socket.readyState !== 3) {
      closedSocket = true;
      try { socket.close(); } catch (closeError) { error ??= closeError; }
    }
    // Notifications may run inside a native control callback: they must not reenter the scene.
    try { publish(); } catch (notificationError) { error ??= notificationError; }
    if (error) {
      notifying = true;
      try { sink?.error(error); } catch { /* Original failure remains authoritative. */ }
      finally { notifying = false; }
    }
  }
  function fail(error, code = 'session-failed') { stop('failed', code, error); }
  function guarded(callback) {
    if (busy) throw new Error('Session reentry');
    busy = true;
    try { return callback(); }
    catch (error) { fail(error); throw error; }
    finally { busy = false; }
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
    if (!connected) {
      handshakeFrames++; handshakeBytes += bytes.length;
      if (handshakeFrames > 16 || handshakeBytes > 1048576) throw new Error('Handshake receive budget exceeded');
    }
    const commands = unpackCommands(wasm.decode_frame(bytes, false));
    if (phase === 'challenge') {
      if (commands.length !== 1 || commands[0][0] !== 54) throw new Error('Expected one challenge command');
      const reply = copiedBytes(wasm.solve_challenge(commands[0].subarray(1)), 27, 'challenge reply');
      send(reply); send(launch.login.slice());
      launch.login.fill(0); launch = undefined;
      phase = 'setup'; publish(); return;
    }
    if (!connected && phase !== 'setup') throw new Error('Unexpected protocol frame');
    if (phase === 'setup' && commands[0][0] !== 97) throw new Error('Expected Setup after login');
    // Controls are deliberately canonical; Rust additionally validates the entire world transaction.
    for (const command of commands) {
      if (command[0] === 54) throw new Error('Repeated challenge');
      if (command[0] === 97 && wasm.setup_protocol_version(command) !== 19) throw new Error('Unsupported protocol');
      if (command[0] === 112 && command.length !== 1) throw new Error('Invalid pong');
      if (command[0] === 118 && command.length !== 2) throw new Error('Invalid life control');
    }
    const receivedMs = time();
    const applied = sink.packet(bytes, false);
    if (terminal()) throw new Error('Session stopped during packet');
    if (applied !== undefined && (!Number.isInteger(applied) || applied < 0 || applied > 4096)) {
      throw new TypeError('Synchronous packet result required');
    }
    // No session control changes precede successful complete Rust world validation/application.
    for (const command of commands) {
      if (command[0] === 97) {
        connected = true; playing = true; phase = 'playing';
        previousUiMs = receivedMs; uiPhase = 'in';
      } else if (command[0] === 112) {
        pingPending = false; lagging = false;
      } else if (command[0] === 118) {
        if (command[1] === 2) {
          closeRequested = true;
        } else {
          deathMs = receivedMs; lifeEnded = true; lagging = false;
          requestActions({ resetLag: true });
          if (playing && !closeRequested) {
            if (command[1] === 1) phase = 'victory';
            else { closeRequested = true; phase = 'dead'; }
          }
        }
      }
    }
    publish();
  }
  function construct() {
    const activeGeneration = ++generation;
    const active = () => generation === activeGeneration && !terminal();
    startedMs = time();
    constructorAttempts++;
    socket = createSocket(launch.endpoint);
    if (!socket || typeof socket.send !== 'function' || typeof socket.close !== 'function') throw new TypeError('Invalid socket capability');
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (!active()) return;
      try {
        guarded(() => {
          if (phase !== 'opening') throw new Error('Unexpected socket open');
          send(Uint8Array.of(1)); send(Uint8Array.of(99, 0));
          phase = 'challenge'; publish();
        });
      } catch (error) { fail(error); }
    };
    socket.onmessage = event => {
      if (!active()) return;
      try { guarded(() => receive(event.data)); } catch (error) { fail(error); }
    };
    socket.onerror = event => { if (active()) fail(event instanceof Error ? event : new Error('Stock socket error'), 'socket-error'); };
    socket.onclose = () => { if (active()) stop('disconnected', 'socket-closed'); };
  }
  return freeze({
    snapshot,
    subscribe(value) {
      if (subscribed || phase !== 'ready') throw new Error('One subscriber required before Play');
      const next = record(value, ['packet', 'state', 'error']);
      for (const name of ['packet', 'state', 'error']) if (typeof next[name] !== 'function') throw new TypeError('Synchronous subscriber required');
      subscribed = true; sink = next;
      return () => { sink = undefined; };
    },
    play(value) {
      if (busy) throw new Error('Session reentry');
      if (!sink || phase !== 'ready') throw new Error('One manual Play per session');
      // Invalid requests leave readiness intact and construct nothing.
      const request = record(value, ['endpoint', 'profile', 'nickname', 'skin', 'customSkin']);
      const profile = record(request.profile, ['clientVersion', 'password', 'protocolVersion']);
      integer(profile.clientVersion, 65535, 'client version');
      if (profile.protocolVersion !== 19) throw new RangeError('Protocol 19 required');
      const password = copiedBytes(profile.password, 20, 'external profile');
      const custom = copiedBytes(request.customSkin, undefined, 'custom skin');
      if (custom.length > 255 || typeof request.nickname !== 'string' || !/^[ -~]{0,24}$/.test(request.nickname)) throw new TypeError('Invalid login fields');
      integer(request.skin, 255, 'skin');
      const endpoint = stockEndpoint(request.endpoint);
      let login;
      try { login = copiedBytes(wasm.encode_login(profile.clientVersion, password, request.nickname, request.skin, custom), undefined, 'encoded login'); }
      finally { password.fill(0); }
      return guarded(() => {
        launch = { endpoint, login }; phase = 'opening';
        requestActions({ resetWorld: true, connected: false }); publish();
      });
    },
    beforeUpdate(nowMs) {
      outsideIngress();
      finite(nowMs, 'update time');
      if (!terminal() && startedMs !== undefined && !connected && nowMs - startedMs > 3333) {
        fail(new Error('Stock handshake timed out'), 'handshake-timeout');
      }
      if (!terminal() && !lagging && pingPending && nowMs - lastPingMs > 750) lagging = true;
      return freeze({ lagging, connected, playing });
    },
    pendingActions() {
      outsideIngress();
      offeredActions = freeze({ revision: actionRevision, actions: freeze({ ...actions }) });
      return offeredActions;
    },
    acknowledgeActions(value) {
      outsideIngress();
      if (value !== offeredActions || value.revision !== actionRevision) throw new Error('Stale action acknowledgement');
      if (!Object.hasOwn(actions, 'resetLag')) throw new Error('No lag reset to acknowledge');
      const { resetLag: consumed, ...remaining } = actions;
      void consumed;
      actions = remaining; actionRevision++; offeredActions = undefined;
    },
    afterStep(request) {
      outsideIngress();
      if (stepRevision !== undefined) throw new Error('Previous control step is not committed');
      finite(request?.nowMs, 'step time');
      const delta = finite(request?.delta, 'lagged step');
      integer(request?.wholeSteps, 5, 'whole steps');
      if (delta < 0 || delta > 5) throw new RangeError('Invalid lagged step');
      if (deathMs !== null && request.nowMs - deathMs > 1600) {
        if (uiPhase === 'idle') uiPhase = 'out';
        if (uiPhase === 'out') {
          returnFraction -= 0.004 * delta;
          if (returnFraction <= 0) {
            returnFraction = 0; deathMs = null; playing = false; uiPhase = 'idle';
          }
        }
      }
      if (closeRequested && deathMs === null && !terminal()) stop('disconnected', 'life-returned');
      stepRevision = actionRevision;
      if (launch && !socket && Object.hasOwn(actions, 'resetWorld')) launchCommitted = true;
      return freeze({ ...actions });
    },
    commitControl() {
      outsideIngress();
      if (stepRevision === undefined) return;
      if (stepRevision === actionRevision) { actions = {}; actionRevision++; }
      stepRevision = undefined;
      if (launchCommitted && launch && !socket && !terminal()) {
        launchCommitted = false;
        guarded(construct);
      }
    },
    betweenKeyboardAndBoost(context, emit) {
      outsideIngress();
      finite(context?.nowMs, 'ping time');
      if (context?.protocolVersion !== 19 || typeof emit !== 'function') throw new TypeError('Protocol 19 ping capability required');
      if (!connected || pingPending || context.nowMs - lastPingMs <= 250) return;
      lastPingMs = context.nowMs; pingPending = true;
      try { emit(Uint8Array.of(251)); } catch (error) { fail(error); throw error; }
    },
    sendInput(value) {
      outsideIngress();
      const bytes = copiedBytes(value, undefined, 'input packet');
      const valid = (bytes.length === 1 && bytes[0] <= 254)
        || (bytes.length === 2 && bytes[0] === 252 && bytes[1] !== 0 && bytes[1] !== 128);
      if (!valid || (bytes.length === 1 && bytes[0] === 252)) throw new TypeError('Invalid compact input packet');
      if (!connected) throw new Error('Session is not connected');
      try { send(bytes); } catch (error) { fail(error); throw error; }
    },
    uiTick(nowMs) {
      outsideIngress();
      finite(nowMs, 'UI time');
      if (uiPhase !== 'in' || terminal()) return snapshot();
      const units = (nowMs - previousUiMs) / 25;
      previousUiMs = nowMs;
      returnFraction += 0.05 * units;
      if (returnFraction >= 1) { returnFraction = 1; uiPhase = 'idle'; }
      return snapshot();
    },
    close(code = 'closed') {
      outsideIngress();
      if (typeof code !== 'string') throw new TypeError('Close reason required');
      stop('disconnected', code);
    },
  });
}
