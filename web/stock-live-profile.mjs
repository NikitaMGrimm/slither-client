// Authored inert data acquisition. No default/global fetch, execution or socket capability.
const freeze = Object.freeze;
const descriptors = Object.getOwnPropertyDescriptors;
const prototypeOf = Object.getPrototypeOf;
const isFrozen = Object.isFrozen;
const U8 = Uint8Array;
const typed = prototypeOf(U8.prototype);
const lengthGetter = Object.getOwnPropertyDescriptor(typed, 'length').get;
const bufferGetter = Object.getOwnPropertyDescriptor(typed, 'buffer').get;
const tagGetter = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag).get;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const setBytes = typed.set;
const fillBytes = typed.fill;
const then = Promise.prototype.then;
const nativeCall = Function.prototype.call;
const nativeBind = Function.prototype.bind;

const PIN = freeze({ expectedBytes: 224092,
  sha256: '5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095',
  version: freeze({ start: 181647, end: 181670 }),
  password: freeze({ start: 181670, end: 181754 }) });
const ORIGIN = 'https://slither.io';
const URL = 'https://slither.io/s/game1107249518.js';
const DEADLINE_MS = 5000;
const MAX_READS = 1024;

class ProfileFailure extends Error {
  constructor(code) { super(`Live profile: ${code}`); this.code = code; }
}
const failure = code => new ProfileFailure(code);
function data(value, required, optional = [], code = 'unavailable-native') {
  try {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(prototypeOf(value))) throw 0;
    const fields = descriptors(value);
    const result = {};
    for (const key of Reflect.ownKeys(fields)) {
      if (typeof key !== 'string' || ![...required, ...optional].includes(key)
        || !Object.hasOwn(fields[key], 'value')) throw 0;
      result[key] = fields[key].value;
    }
    for (const key of required) if (!Object.hasOwn(result, key)) throw 0;
    return result;
  } catch { throw failure(code); }
}
function functions(value, names) {
  const copied = data(value, names);
  for (const name of names) if (typeof copied[name] !== 'function') throw failure('unavailable-native');
  return copied;
}
const offlineBytes = freeze({
  allocate: size => new U8(size),
  length(value) {
    try {
      if (Reflect.apply(tagGetter, value, []) !== 'Uint8Array') throw 0;
      Reflect.apply(bufferLength, Reflect.apply(bufferGetter, value, []), []);
      return Reflect.apply(lengthGetter, value, []);
    } catch { throw failure('bad-size'); }
  },
  copy: (target, source, offset) => Reflect.apply(setBytes, target, [source, offset]),
  clear: value => Reflect.apply(fillBytes, value, [0]),
});
function drain(value) {
  // Brand-check a real Promise without reading an arbitrary thenable's getter.
  try { Reflect.apply(then, value, [() => {}, () => {}]); } catch { /* Not a native Promise. */ }
}
function bounds(value, size, limit) {
  const span = data(value, ['start', 'end'], [], 'bad-pin');
  if (!isFrozen(value) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
    || span.start < 0 || span.end <= span.start || span.end > size || span.end - span.start > limit) throw failure('bad-pin');
  return span;
}
function spans(value, size) {
  const parts = data(value, ['version', 'password'], [], 'bad-pin');
  if (!isFrozen(value)) throw failure('bad-pin');
  const version = bounds(parts.version, size, 128);
  const password = bounds(parts.password, size, 256);
  if (version.end > password.start) throw failure('bad-pin');
  return { version, password };
}
function checkedPin(value, size) {
  const pin = data(value, ['expectedBytes', 'sha256', 'version', 'password'], [], 'bad-pin');
  if (!isFrozen(value) || !Number.isSafeInteger(pin.expectedBytes) || pin.expectedBytes < 1
    || pin.expectedBytes > PIN.expectedBytes || typeof pin.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(pin.sha256)) throw failure('bad-pin');
  if (size !== pin.expectedBytes) throw failure('bad-size');
  return { ...pin, ...spans(freeze({ version: pin.version, password: pin.password }), size) };
}
function literalPolicy(Parser) {
  try {
    if (typeof Parser !== 'function') throw 0;
    const prototype = Object.getOwnPropertyDescriptor(Parser, 'prototype');
    if (!prototype || !Object.hasOwn(prototype, 'value')) throw 0;
    const methods = {};
    for (const name of ['write', 'parse_version', 'parse_password', 'password_byte', 'protocol_version', 'clear', 'free']) {
      const field = Object.getOwnPropertyDescriptor(prototype.value, name);
      if (!field || !Object.hasOwn(field, 'value') || typeof field.value !== 'function') throw 0;
      methods[name] = Reflect.apply(nativeBind, nativeCall, [field.value]);
    }
    return { create() { try { return new Parser(); } catch { throw failure('unavailable-native'); } }, methods };
  } catch { throw failure('unavailable-native'); }
}
function extract(source, parts, bytes, own, policy) {
  const parser = policy.create();
  const call = (name, first, second) => {
    // Scalar native arguments avoid extra authored JS arrays containing source bytes.
    try {
      const result = policy.methods[name](parser, first, second);
      if ((result !== null && typeof result === 'object') || typeof result === 'function') {
        drain(result); throw failure('bad-literal');
      }
      return result;
    }
    catch { throw failure('bad-literal'); }
  };
  try {
    const copy = (span, offset) => {
      for (let i = 0; i < span.end - span.start; i++) {
        if (call('write', offset + i, source[span.start + i]) !== true) throw failure('bad-literal');
      }
    };
    copy(parts.version, 0);
    const clientVersion = call('parse_version', parts.version.end - parts.version.start);
    if (clientVersion === -1) throw failure('bad-literal');
    if (!Number.isInteger(clientVersion) || clientVersion < 0 || clientVersion > 65535) throw failure('bad-literal');
    // Keep the captured native password allocation at its existing version-before-password boundary.
    const password = own(bytes.allocate(20));
    if (bytes.length(password) !== 20) throw failure('unavailable-native');
    copy(parts.password, 128);
    if (call('parse_password', parts.password.end - parts.password.start) !== true) throw failure('bad-literal');
    for (let i = 0; i < 20; i++) {
      const byte = call('password_byte', i);
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw failure('bad-literal');
      password[i] = byte;
    }
    const protocolVersion = call('protocol_version');
    if (protocolVersion !== 19) throw failure('bad-literal');
    return freeze({ clientVersion, password, protocolVersion });
  } finally {
    // Zero live Wasm storage before releasing it, even after partial writes or rejection.
    let cleared = true;
    for (const method of [policy.methods.clear, policy.methods.free]) {
      try {
        const result = method(parser);
        if (result !== undefined) { drain(result); cleared = false; }
      } catch { cleared = false; }
    }
    if (!cleared) throw failure('cleanup-failed');
  }
}
function ownership(bytes) {
  const buffers = new Set();
  return {
    own(value) { bytes.length(value); buffers.add(value); return value; },
    clear(value) {
      try { bytes.clear(value); buffers.delete(value); } catch { throw failure('cleanup-failed'); }
    },
    clearAll() {
      let ok = true;
      for (const value of buffers) { try { bytes.clear(value); } catch { ok = false; } }
      buffers.clear(); return ok;
    },
  };
}

/** Pure offline parser. Caller owns input and the returned password; no hash/fetch authority. */
export function parseClosedProfileDeclarations(source, frozenSpans, ProfileLiteralParser) {
  const owned = ownership(offlineBytes);
  try { return extract(source, spans(frozenSpans, offlineBytes.length(source)), offlineBytes, owned.own, literalPolicy(ProfileLiteralParser)); }
  catch (error) { owned.clearAll(); throw error instanceof ProfileFailure ? error : failure('bad-literal'); }
}

async function verified(source, pin, digest, bytes, owned, checkpoint, policy) {
  const metadata = checkedPin(pin, bytes.length(source));
  let result;
  try { result = await digest('SHA-256', source); } catch { throw failure('digest-failed'); }
  let hash;
  try { hash = owned.own(result); } catch { throw failure('digest-failed'); }
  checkpoint();
  if (bytes.length(hash) !== 32) throw failure('hash-mismatch');
  let mismatch = 0;
  for (let i = 0; i < 32; i++) mismatch |= hash[i] ^ Number.parseInt(metadata.sha256.slice(i * 2, i * 2 + 2), 16);
  if (mismatch) throw failure('hash-mismatch');
  owned.clear(hash);
  checkpoint();
  return extract(source, metadata, bytes, owned.own, policy);
}
function consume(consumer, profile) {
  let result;
  try { result = consumer(profile); } catch { throw failure('consumer-failed'); }
  if (result !== undefined) { drain(result); throw failure('consumer-failed'); }
}

/** Offline verification seam: ownership of synthetic source transfers and all owned bytes clear. */
export async function verifyAndConsumeProfileBytes(options) {
  const owned = ownership(offlineBytes);
  try {
    const args = data(options, ['source', 'pin', 'digest', 'consumeProfile', 'literalParser'], [], 'bad-pin');
    const source = owned.own(args.source);
    if (typeof args.digest !== 'function' || typeof args.consumeProfile !== 'function') throw failure('consumer-failed');
    const profile = await verified(source, args.pin, args.digest, offlineBytes, owned, () => {}, literalPolicy(args.literalParser));
    owned.clear(source);
    consume(args.consumeProfile, profile);
  } catch (error) { throw error instanceof ProfileFailure ? error : failure('bad-literal'); }
  finally { if (!owned.clearAll()) throw failure('cleanup-failed'); }
}

/** One explicit Play acquisition; all browser authority is privately captured by the gate. */
export function createStockLiveProfileAcquirer(options) {
  const args = data(options, ['capabilities', 'isCurrentDocument', 'literalParser']);
  const policy = literalPolicy(args.literalParser);
  if (typeof args.isCurrentDocument !== 'function') throw failure('unavailable-native');
  const currentDocument = args.isCurrentDocument;
  const raw = data(args.capabilities, ['fetch', 'digest', 'createAbort', 'setTimeout', 'clearTimeout', 'now',
    'environment', 'responseInfo', 'getReader', 'read', 'cancelReader', 'releaseReader', 'bytes']);
  const { bytes: suppliedBytes, ...operations } = raw;
  const caps = functions(operations, Object.keys(operations));
  const bytes = functions(suppliedBytes, ['allocate', 'length', 'copy', 'clear']);
  let state = 'idle', reasonCode = null, generation = 0, active;
  const status = () => freeze({ state, reasonCode });
  function environment() {
    let info;
    try { info = data(caps.environment(), ['origin', 'topLevel', 'secureContext']); }
    catch { throw failure('unsupported-origin'); }
    if (info.origin !== ORIGIN || info.topLevel !== true || info.secureContext !== true) throw failure('unsupported-origin');
  }
  function cleanup(op, abort) {
    if (op.timer !== undefined) {
      try { caps.clearTimeout(op.timer); } catch { /* Gate-owned native cleanup is best effort. */ }
      op.timer = undefined;
    }
    if (abort && op.controller) {
      try { op.controller.abort(); } catch { /* Do not leak a native error. */ }
    }
    op.controller = undefined;
    if (op.reader) {
      if (abort && !op.eof) { try { drain(caps.cancelReader(op.reader)); } catch { /* Best effort. */ } }
      try { caps.releaseReader(op.reader); } catch { /* Pending reads can reject on release. */ }
      op.reader = undefined;
    }
    op.source = undefined;
    return op.owned.clearAll();
  }
  function stop(op, code, nextState = 'failed') {
    if (active !== op || op.done) return;
    op.done = true; generation++; state = nextState; reasonCode = code;
    if (!cleanup(op, true)) reasonCode = 'cleanup-failed';
    op.reject(failure(reasonCode));
  }
  function check(op) {
    if (active !== op || op.done || generation !== op.generation) throw failure('cancelled');
    let now, current;
    try { now = caps.now(); current = currentDocument(); } catch { throw failure('stale-document'); }
    // The authored lifecycle check can dispose synchronously; do not create later resources.
    if (active !== op || op.done || generation !== op.generation) throw failure('cancelled');
    if (typeof now !== 'number' || !Number.isFinite(now) || now < op.previousNow) throw failure('clock-invalid');
    op.previousNow = now;
    if (now - op.start >= DEADLINE_MS) throw failure('deadline');
    if (current !== true) throw failure('stale-document');
    return now;
  }
  function lateResponse(response) {
    try {
      const info = data(caps.responseInfo(response), ['status', 'type', 'url', 'redirected', 'body']);
      if (info.body == null) return;
      const reader = caps.getReader(info.body);
      try { drain(caps.cancelReader(reader)); } finally { caps.releaseReader(reader); }
    } catch { /* Late resources are cleanup-only and cannot restart acquisition. */ }
  }
  async function run(op, consumer) {
    try {
      const request = freeze({ method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: false, signal: op.controller.signal });
      let response;
      try { response = await caps.fetch(URL, request); } catch { throw failure('request-failed'); }
      if (op.done) { lateResponse(response); return; }
      check(op);
      let info;
      try { info = data(caps.responseInfo(response), ['status', 'type', 'url', 'redirected', 'body']); }
      catch { throw failure('bad-response'); }
      if (info.status !== 200 || info.type !== 'basic' || info.url !== URL || info.redirected !== false || info.body == null) throw failure('bad-response');
      try { op.reader = caps.getReader(info.body); } catch { throw failure('bad-response'); }
      let count = 0, reads = 0;
      for (;;) {
        check(op);
        if (reads++ >= MAX_READS) throw failure('too-many-reads');
        let result;
        try { result = await caps.read(op.reader); } catch { throw failure('read-failed'); }
        const item = data(result, ['done'], ['value'], 'bad-response');
        let chunk;
        try { chunk = item.value === undefined ? undefined : op.owned.own(item.value); }
        catch { throw failure('bad-response'); }
        if (op.done) { op.owned.clearAll(); return; }
        check(op);
        if (typeof item.done !== 'boolean' || (item.done && chunk !== undefined)) throw failure('bad-response');
        if (item.done) { op.eof = true; break; }
        if (chunk === undefined) throw failure('bad-response');
        const length = bytes.length(chunk);
        if (!Number.isSafeInteger(length) || length < 0 || length > PIN.expectedBytes - count) throw failure('bad-size');
        bytes.copy(op.source, chunk, count); count += length;
        op.owned.clear(chunk);
      }
      if (count !== PIN.expectedBytes) throw failure('bad-size');
      const source = op.source;
      const profile = await verified(source, PIN, caps.digest, bytes, op.owned, () => check(op), policy);
      check(op); environment();
      op.owned.clear(source); op.source = undefined;
      check(op);
      state = 'consuming';
      consume(consumer, profile);
      check(op);
      if (!cleanup(op, false)) throw failure('cleanup-failed');
      op.done = true; state = 'used'; op.resolve();
    } catch (error) {
      if (op.done) { cleanup(op, true); return; }
      stop(op, error instanceof ProfileFailure ? error.code : 'request-failed');
    }
  }
  return freeze({
    status,
    acquireForPlay(consumer) {
      if (typeof consumer !== 'function') return Promise.reject(failure('consumer-failed'));
      if (state !== 'idle') return Promise.reject(failure('already-used'));
      let resolve, reject;
      const result = new Promise((yes, no) => { resolve = yes; reject = no; });
      const op = { resolve, reject, generation: ++generation, done: false, owned: ownership(bytes) };
      active = op; state = 'loading';
      try {
        op.start = caps.now(); op.previousNow = op.start;
        if (typeof op.start !== 'number' || !Number.isFinite(op.start)) throw failure('clock-invalid');
        environment();
        check(op);
        op.controller = data(caps.createAbort(), ['signal', 'abort']);
        if (typeof op.controller.abort !== 'function') throw failure('unavailable-native');
        const remaining = DEADLINE_MS - (check(op) - op.start);
        op.timer = caps.setTimeout(() => stop(op, 'deadline'), remaining);
        check(op);
        op.source = op.owned.own(bytes.allocate(PIN.expectedBytes));
        if (bytes.length(op.source) !== PIN.expectedBytes) throw failure('unavailable-native');
        check(op);
        drain(run(op, consumer));
      } catch (error) {
        if (op.done) cleanup(op, true);
        else stop(op, error instanceof ProfileFailure ? error.code : 'unavailable-native');
      }
      return result;
    },
    dispose() {
      if (state === 'disposed') return;
      if (active && !active.done) stop(active, 'cancelled', 'disposed');
      else { generation++; state = 'disposed'; reasonCode = 'cancelled'; }
    },
  });
}
