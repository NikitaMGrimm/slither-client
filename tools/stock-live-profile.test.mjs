// Entirely authored synthetic declarations, buffers and capabilities. No source/archive/network I/O.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createStockLiveProfileAcquirer, parseClosedProfileDeclarations,
  verifyAndConsumeProfileBytes } from '../web/stock-live-profile.mjs';

const EXPECTED_URL = 'https://slither.io/s/game1107249518.js';
const PUBLIC_HASH_METADATA = '5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095';
const SIZE = 224092;
const freeze = Object.freeze;
const encode = text => new TextEncoder().encode(text);
const digestBytes = hex => Uint8Array.from(hex.match(/../g), pair => Number.parseInt(pair, 16));
const allZero = bytes => bytes.every(value => value === 0);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const realDigest = async (algorithm, bytes) => new Uint8Array(await webcrypto.subtle.digest(algorithm, bytes));
const code = expected => error => error instanceof Error && error.code === expected;
function fixture({ version = '17', password = Array.from({ length: 20 }, (_, i) => i).join(','),
  versionText, passwordText, prefix = 'synthetic data\n' } = {}) {
  const before = encode(prefix);
  const a = encode(versionText ?? `var syntheticVersion=${version};`);
  const b = encode(passwordText ?? `var syntheticBytes=[${password}];`);
  const source = new Uint8Array(before.length + a.length + b.length);
  source.set(before); source.set(a, before.length); source.set(b, before.length + a.length);
  const versionSpan = freeze({ start: before.length, end: before.length + a.length });
  const passwordSpan = freeze({ start: versionSpan.end, end: source.length });
  const spans = freeze({ version: versionSpan, password: passwordSpan });
  const pin = freeze({ expectedBytes: source.length,
    sha256: createHash('sha256').update(source).digest('hex'), ...spans });
  return { source, spans, pin };
}

function productionShapedSynthetic() {
  // Entirely synthetic padding/literals, NOT bytes from the pinned source. Factory
  // state tests use a labelled digest DOUBLE; real crypto rejects this fixed-pin body.
  const source = new Uint8Array(SIZE).fill(32);
  const a = encode('var v=17;'), b = encode(`var k=[${Array.from({ length: 20 }, (_, i) => i).join(',')}];`);
  assert.ok(a.length <= 23 && b.length <= 84);
  source.set(a, 181647); source.set(b, 181670);
  return source;
}

function harness(options = {}) {
  const payload = options.payload ?? productionShapedSynthetic();
  let now = options.start ?? 100;
  let current = true;
  let responseOverride = options.response ?? {};
  const trace = [], allocations = [], digests = [], emittedChunks = [];
  const timers = new Map();
  const started = { fetch: deferred(), read: deferred(), digest: deferred() };
  let fetchCalls = 0, readCalls = 0, digestCalls = 0, aborts = 0, cancels = 0, releases = 0;
  const reader = {};
  let chunks = options.chunks ?? [payload.slice()];
  const caps = {
    fetch(url, init) {
      fetchCalls++; trace.push(['fetch', url, init]); started.fetch.resolve();
      if (options.fetch) return options.fetch(url, init);
      return Promise.resolve({ syntheticResponse: true });
    },
    async digest(algorithm, bytes) {
      digestCalls++; trace.push(['digest', algorithm, bytes.length]); started.digest.resolve();
      assert.equal(algorithm, 'SHA-256');
      assert.deepEqual(bytes, payload);
      let result;
      if (options.digest) result = await options.digest(algorithm, bytes);
      else result = digestBytes(PUBLIC_HASH_METADATA); // Explicit fixed-pin digest double.
      if (result instanceof Uint8Array) digests.push(result);
      return result;
    },
    createAbort() { trace.push(['abort-controller']); return freeze({ signal: freeze({ syntheticSignal: true }), abort() { aborts++; } }); },
    setTimeout(callback, milliseconds) { trace.push(['timer', milliseconds]); timers.set(1, callback); return 1; },
    clearTimeout(id) { trace.push(['clear-timer', id]); timers.delete(id); },
    now: () => now,
    environment() {
      options.onEnvironment?.();
      return freeze({ origin: 'https://slither.io', topLevel: true, secureContext: true, ...options.environment });
    },
    responseInfo() { trace.push(['response']); return freeze({ status: 200, type: 'basic', url: EXPECTED_URL,
      redirected: false, body: {}, ...responseOverride }); },
    getReader() { trace.push(['reader']); return reader; },
    read(actual) {
      assert.equal(actual, reader); readCalls++; started.read.resolve();
      if (options.read) return options.read(readCalls);
      if (!chunks.length) return Promise.resolve({ done: true, value: undefined });
      const chunk = chunks.shift(); emittedChunks.push(chunk);
      return Promise.resolve({ done: false, value: chunk });
    },
    cancelReader(actual) { assert.equal(actual, reader); cancels++; return options.cancelReader ? options.cancelReader() : Promise.resolve(); },
    releaseReader(actual) { assert.equal(actual, reader); releases++; },
    bytes: freeze({
      allocate(length) { const value = new Uint8Array(length); allocations.push(value); trace.push(['allocate', length]); return value; },
      length(value) {
        // Authored capability double for captured authoritative native byte inspection.
        if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer) throw new Error('synthetic invalid byte type');
        return value.byteLength;
      },
      copy: (target, source, offset) => target.set(source, offset),
      clear(value) { options.beforeClear?.(); value.fill(0); trace.push(['wipe', value.length]); },
    }),
  };
  const acquirer = createStockLiveProfileAcquirer({ capabilities: freeze(caps),
    isCurrentDocument: () => options.isCurrentDocument ? options.isCurrentDocument() : current });
  return { acquirer, caps, payload, trace, allocations, digests, emittedChunks, timers, started,
    setNow(value) { now = value; }, setCurrent(value) { current = value; },
    setResponse(value) { responseOverride = value; }, setChunks(value) { chunks = value; },
    fireDeadline() { now = options.start === undefined ? 5100 : options.start + 5000; timers.get(1)?.(); },
    get counts() { return { fetchCalls, readCalls, digestCalls, aborts, cancels, releases }; },
    assertWiped() {
      for (const value of [...allocations, ...digests, ...emittedChunks]) {
        if (value instanceof Uint8Array) assert.equal(allZero(value), true);
      }
    },
  };
}

test('closed parser accepts authored decimal data/whitespace and preserves caller input', () => {
  const f = fixture({ prefix: 'µ synthetic\n', versionText: '\tvar $_v\r\n= 65535 ;\n',
    passwordText: `var $p = [ ${Array.from({ length: 20 }, (_, i) => i === 19 ? 255 : i).join(' ,\t')} ] ;` });
  const original = f.source.slice();
  const profile = parseClosedProfileDeclarations(f.source, f.spans);
  assert.equal(profile.clientVersion, 65535); assert.equal(profile.protocolVersion, 19);
  assert.deepEqual([...profile.password], Array.from({ length: 20 }, (_, i) => i === 19 ? 255 : i));
  assert.equal(Object.isFrozen(profile), true); assert.deepEqual(f.source, original);
  profile.password.fill(0);
  const zero = fixture({ version: '0', password: new Array(20).fill(0).join(',') });
  const parsed = parseClosedProfileDeclarations(zero.source, zero.spans);
  assert.equal(parsed.clientVersion, 0); assert.equal(allZero(parsed.password), true);
});

test('identifier bound is 64 ASCII bytes and spans/own data are bounded before parsing', () => {
  const f = fixture({ versionText: `var ${'a'.repeat(64)}=1;` });
  const good = parseClosedProfileDeclarations(f.source, f.spans); good.password.fill(0);
  const tooLong = fixture({ versionText: `var ${'a'.repeat(65)}=1;` });
  assert.throws(() => parseClosedProfileDeclarations(tooLong.source, tooLong.spans), code('bad-literal'));
  for (const spans of [{ ...f.spans }, freeze({ version: { ...f.spans.version }, password: f.spans.password }),
    freeze({ version: freeze({ start: -1, end: 2 }), password: f.spans.password }),
    freeze({ version: f.spans.version, password: freeze({ start: 0, end: 1 }) })]) {
    assert.throws(() => parseClosedProfileDeclarations(f.source, spans), code('bad-pin'));
  }
  const hostile = Object.defineProperty({}, 'version', { get() { assert.fail('getter invoked'); } });
  assert.throws(() => parseClosedProfileDeclarations(f.source, hostile), code('bad-pin'));
});

test('closed numeric and token grammar rejects expressions, signs, escapes and extra input', () => {
  for (const version of ['65536', '-1', '+1', '1.0', '1e2', '0x10', '0o10', '0b10', '01', '1_0', '123456',
    'NaN', 'Infinity', 'value', 'f()', '"17"']) {
    const f = fixture({ version });
    assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans), code('bad-literal'), version);
  }
  for (const byte of ['256', '-1', '+0', '1.5', '1e1', '0x10', '00', '1_0', '1234', 'n', 'f()', '"1"']) {
    const f = fixture({ password: [byte, ...new Array(19).fill(0)].join(',') });
    assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans), code('bad-literal'), byte);
  }
  for (const versionText of ['varv=17;', 'let v=17;', 'var v/*x*/=17;', 'var v=17', 'var v=17;extra;',
    'var \u00e9=17;', 'var \\u0076=17;', 'var v=17;\0', 'var v=17;\v']) {
    const f = fixture({ versionText });
    assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans), code('bad-literal'));
  }
  for (const password of [new Array(19).fill(0).join(','), new Array(21).fill(0).join(','),
    new Array(20).fill(0).join(',') + ',', '0,,0', '0;0', '...values']) {
    const f = fixture({ password });
    assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans), code('bad-literal'));
  }
});

test('pure verifier uses real Node WebCrypto on synthetic pin, clears source before use and all owned data after', async () => {
  const f = fixture(); let password, digest, calls = 0;
  const result = await verifyAndConsumeProfileBytes({ source: f.source, pin: f.pin,
    async digest(algorithm, input) { digest = await realDigest(algorithm, input); return digest; },
    consumeProfile(profile) {
      calls++; assert.equal(allZero(f.source), true); assert.equal(allZero(digest), true);
      assert.equal(profile.clientVersion, 17); assert.deepEqual([...profile.password], Array.from({ length: 20 }, (_, i) => i));
      password = profile.password;
    },
  });
  assert.equal(result, undefined); assert.equal(calls, 1); assert.equal(allZero(password), true);
});

test('full hash precedes invalid declarations and mismatched length; partial outputs never reach consumer', async () => {
  const f = fixture({ version: 'badLiteral' }); let calls = 0, hashes = 0;
  const wrongPin = freeze({ ...f.pin, sha256: '0'.repeat(64) });
  await assert.rejects(verifyAndConsumeProfileBytes({ source: f.source, pin: wrongPin,
    async digest(a, b) { hashes++; return realDigest(a, b); }, consumeProfile() { calls++; } }), code('hash-mismatch'));
  assert.equal(hashes, 1); assert.equal(calls, 0); assert.equal(allZero(f.source), true);
  const badLiteral = fixture({ password: new Array(19).fill(0).join(',') });
  await assert.rejects(verifyAndConsumeProfileBytes({ source: badLiteral.source, pin: badLiteral.pin,
    digest: realDigest, consumeProfile() { calls++; } }), code('bad-literal'));
  assert.equal(allZero(badLiteral.source), true); assert.equal(calls, 0);
  const badSize = fixture(); const copied = new Uint8Array(badSize.source.length + 1); copied.set(badSize.source);
  await assert.rejects(verifyAndConsumeProfileBytes({ source: copied, pin: badSize.pin,
    digest() { assert.fail('digest before length validation'); }, consumeProfile() { assert.fail('unexpected use'); } }), code('bad-size'));
  assert.equal(allZero(copied), true);
});

test('pure verifier rejects mutable/extra pins, digest failures and invalid digest output without leaks', async () => {
  for (const mutate of [pin => ({ ...pin }), pin => freeze({ ...pin, url: EXPECTED_URL }),
    pin => freeze({ ...pin, sha256: pin.sha256.toUpperCase() }), pin => freeze({ ...pin, expectedBytes: 224093 })]) {
    const f = fixture();
    await assert.rejects(verifyAndConsumeProfileBytes({ source: f.source, pin: mutate(f.pin), digest: realDigest,
      consumeProfile() { assert.fail('unexpected use'); } }), code('bad-pin'));
    assert.equal(allZero(f.source), true);
  }
  for (const output of [new Uint8Array(31).fill(7), new Uint8Array(33).fill(7)]) {
    const f = fixture();
    await assert.rejects(verifyAndConsumeProfileBytes({ source: f.source, pin: f.pin, digest: () => output,
      consumeProfile() { assert.fail('unexpected use'); } }), code('hash-mismatch'));
    assert.equal(allZero(output), true); assert.equal(allZero(f.source), true);
  }
  const f = fixture();
  await assert.rejects(verifyAndConsumeProfileBytes({ source: f.source, pin: f.pin,
    digest() { throw new Error('PRIVATE synthetic bytes must not be reported'); }, consumeProfile() {} }), error => {
    assert.equal(error.code, 'digest-failed'); assert.equal(Object.hasOwn(error, 'cause'), false);
    return !String(error).includes('PRIVATE');
  });
});

test('pure parser byte brand ignores own shadow getters and rejects shared/non-byte domains', () => {
  const f = fixture();
  Object.defineProperty(f.source, 'length', { get() { assert.fail('length getter invoked'); } });
  const p = parseClosedProfileDeclarations(f.source, f.spans); p.password.fill(0);
  for (const source of [new Uint16Array(100), new Uint8Array(new SharedArrayBuffer(100)), new Proxy(new Uint8Array(100), {})]) {
    assert.throws(() => parseClosedProfileDeclarations(source, f.spans), code('bad-size'));
  }
});

test('constructor is inert, production pin non-overridable, callbacks/caps are exact own-data functions', async () => {
  const h = harness(); assert.deepEqual(h.acquirer.status(), { state: 'idle', reasonCode: null });
  assert.equal(Object.isFrozen(h.acquirer.status()), true); assert.deepEqual(h.trace, []);
  await assert.rejects(h.acquirer.acquireForPlay(null), code('consumer-failed'));
  assert.deepEqual(h.trace, []); assert.equal(h.acquirer.status().state, 'idle');
  assert.throws(() => createStockLiveProfileAcquirer({ capabilities: h.caps, isCurrentDocument: () => true, pin: {} }), code('unavailable-native'));
  const getter = { ...h.caps }; Object.defineProperty(getter, 'fetch', { get() { assert.fail('getter invoked'); } });
  assert.throws(() => createStockLiveProfileAcquirer({ capabilities: getter, isCurrentDocument: () => true }), code('unavailable-native'));
  assert.throws(() => createStockLiveProfileAcquirer({ capabilities: { ...h.caps, digest: null }, isCurrentDocument: () => true }), code('unavailable-native'));
  h.acquirer.dispose(); h.acquirer.dispose(); assert.deepEqual(h.trace, []);
  await assert.rejects(h.acquirer.acquireForPlay(() => {}), code('already-used'));
});

test('fixed native request and synthetic reader success clear all data and expose only closed status', async () => {
  const h = harness(); let calls = 0, borrowed;
  assert.equal(await h.acquirer.acquireForPlay(profile => {
    calls++; borrowed = profile.password;
    assert.deepEqual(h.acquirer.status(), { state: 'consuming', reasonCode: null });
    assert.equal(allZero(h.allocations[0]), true, 'source must clear before use');
    assert.equal(allZero(h.digests[0]), true);
    assert.deepEqual([...profile.password], Array.from({ length: 20 }, (_, i) => i));
  }), undefined);
  assert.equal(calls, 1); assert.equal(allZero(borrowed), true); h.assertWiped();
  assert.deepEqual(h.acquirer.status(), { state: 'used', reasonCode: null });
  const [request] = h.trace.filter(event => event[0] === 'fetch');
  assert.equal(request[1], EXPECTED_URL);
  assert.deepEqual(request[2], { method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'error',
    cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: false, signal: { syntheticSignal: true } });
  assert.equal(h.timers.size, 0); assert.deepEqual(h.counts, { fetchCalls: 1, readCalls: 2, digestCalls: 1, aborts: 0, cancels: 0, releases: 1 });
  await assert.rejects(h.acquirer.acquireForPlay(() => {}), code('already-used'));
  assert.equal(h.counts.fetchCalls, 1);
});

test('unsupported origin/top-level/secure-context/current document rejects before any allocation or fetch', async () => {
  for (const environment of [{ origin: 'http://slither.io' }, { origin: 'https://www.slither.io' },
    { origin: 'https://slither.io/other' }, { topLevel: false }, { secureContext: false }]) {
    const h = harness({ environment });
    await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('unsupported-origin'));
    assert.equal(h.allocations.length, 0); assert.equal(h.counts.fetchCalls, 0);
  }
  const h = harness(); h.setCurrent(false);
  await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('stale-document'));
  assert.equal(h.allocations.length, 0); assert.equal(h.counts.fetchCalls, 0);
});

test('native response and fetch/CSP/redirect failures are closed, terminal and do not retry', async () => {
  for (const response of [{ status: 204 }, { status: 206 }, { status: 304 }, { type: 'opaque' },
    { type: 'opaqueredirect' }, { url: EXPECTED_URL + '?x=1' }, { redirected: true }, { body: null }]) {
    const h = harness({ response });
    await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('bad-response'));
    assert.equal(h.counts.fetchCalls, 1); assert.equal(h.counts.digestCalls, 0); h.assertWiped();
    await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('already-used'));
    assert.equal(h.counts.fetchCalls, 1);
  }
  const h = harness({ fetch() { throw new Error('CSP synthetic details PRIVATE'); } });
  await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), error => {
    assert.equal(error.code, 'request-failed'); return !String(error).includes('PRIVATE');
  });
  assert.equal(h.counts.aborts, 1); h.assertWiped(); assert.equal(h.timers.size, 0);
});

test('stream requires exact size and real EOF, rejects truncation/excess without growth or digest', async () => {
  for (const length of [0, SIZE - 1, SIZE + 1]) {
    const chunk = new Uint8Array(length).fill(9);
    const h = harness({ chunks: length === 0 ? [] : [chunk] });
    await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('bad-size'));
    assert.equal(h.allocations.filter(a => a.length === SIZE).length, 1);
    assert.equal(h.counts.digestCalls, 0); h.assertWiped(); assert.equal(allZero(chunk), true);
  }
  const extra = Uint8Array.of(99); const h = harness({ chunks: [productionShapedSynthetic(), extra] });
  await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('bad-size'));
  assert.equal(h.counts.readCalls, 2); assert.equal(h.counts.digestCalls, 0); h.assertWiped();
});

test('sequential chunks and empty chunks obey exact 1024-read budget including EOF', async () => {
  const valid = harness({ chunks: [...Array.from({ length: 1022 }, () => new Uint8Array()), productionShapedSynthetic()] });
  await valid.acquirer.acquireForPlay(() => {});
  assert.equal(valid.counts.readCalls, 1024); valid.assertWiped();
  const invalid = harness({ chunks: [...Array.from({ length: 1023 }, () => new Uint8Array()), productionShapedSynthetic()] });
  await assert.rejects(invalid.acquirer.acquireForPlay(() => assert.fail()), code('too-many-reads'));
  assert.equal(invalid.counts.readCalls, 1024); assert.equal(invalid.counts.digestCalls, 0); invalid.assertWiped();
  const payload = productionShapedSynthetic(); const chunked = harness({ payload,
    chunks: [payload.slice(0, 7), new Uint8Array(), payload.slice(7, 120000), payload.slice(120000)] });
  await chunked.acquirer.acquireForPlay(() => {}); assert.equal(chunked.counts.readCalls, 5); chunked.assertWiped();
});

test('actual WebCrypto rejects entirely synthetic factory body against fixed production hash', async () => {
  const h = harness({ digest: realDigest }); let calls = 0;
  await assert.rejects(h.acquirer.acquireForPlay(() => { calls++; }), code('hash-mismatch'));
  assert.equal(calls, 0); h.assertWiped(); assert.equal(h.acquirer.status().reasonCode, 'hash-mismatch');
});

test('hash mismatch is reported before malformed synthetic literals; no partial password/profile leakage', async () => {
  const payload = productionShapedSynthetic(); payload[181647] = 0;
  const h = harness({ payload, digest: () => new Uint8Array(32) });
  await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('hash-mismatch'));
  assert.equal(h.allocations.filter(a => a.length === 20).length, 0); h.assertWiped();
  const invalid = productionShapedSynthetic(); invalid[181670] = 0;
  const p = harness({ payload: invalid });
  await assert.rejects(p.acquirer.acquireForPlay(() => assert.fail()), code('bad-literal'));
  assert.equal(p.allocations.filter(a => a.length === 20).length, 1); p.assertWiped();
});

test('pending EOF keeps one read outstanding and no digest; deadline clears without waiting for read/cancel', async () => {
  const pending = deferred(); let h;
  h = harness({ read(n) { return n === 1 ? Promise.resolve({ done: false, value: h.payload.slice() }) : pending.promise; } });
  const operation = h.acquirer.acquireForPlay(() => assert.fail());
  await h.started.read.promise; await nextTurn();
  assert.equal(h.counts.readCalls, 2); assert.equal(h.counts.digestCalls, 0);
  assert.equal(h.trace.find(event => event[0] === 'timer')[1], 5000);
  h.fireDeadline(); await assert.rejects(operation, code('deadline'));
  assert.equal(h.counts.aborts, 1); assert.equal(h.counts.cancels, 1); assert.equal(h.timers.size, 0); h.assertWiped();
  pending.resolve({ done: true, value: undefined }); await nextTurn();
  assert.equal(h.counts.readCalls, 2); assert.equal(h.counts.digestCalls, 0);
});

test('deadline/dispose during pending fetch cancel generation and late response is cleanup-only', async () => {
  for (const cancel of ['deadline', 'dispose']) {
    const pending = deferred(); const h = harness({ fetch: () => pending.promise }); let calls = 0;
    const operation = h.acquirer.acquireForPlay(() => { calls++; });
    await h.started.fetch.promise;
    if (cancel === 'deadline') h.fireDeadline(); else h.acquirer.dispose();
    await assert.rejects(operation, code(cancel === 'deadline' ? 'deadline' : 'cancelled'));
    pending.resolve({ late: true }); await nextTurn();
    assert.equal(calls, 0); assert.equal(h.counts.readCalls, 0); assert.equal(h.counts.digestCalls, 0);
    assert.equal(h.counts.cancels, 1); assert.equal(h.counts.releases, 1); h.assertWiped();
    await assert.rejects(h.acquirer.acquireForPlay(() => {}), code('already-used'));
  }
});

test('late read chunk and late digest output are wiped after dispose, never consumed', async () => {
  const pendingRead = deferred(); const h = harness({ read: () => pendingRead.promise });
  const operation = h.acquirer.acquireForPlay(() => assert.fail()); await h.started.read.promise;
  h.acquirer.dispose(); await assert.rejects(operation, code('cancelled'));
  const lateChunk = new Uint8Array(10).fill(7); pendingRead.resolve({ done: false, value: lateChunk });
  await nextTurn(); assert.equal(allZero(lateChunk), true); h.assertWiped();
  const pendingHash = deferred(); const p = harness({ digest: () => pendingHash.promise });
  const hashing = p.acquirer.acquireForPlay(() => assert.fail()); await p.started.digest.promise;
  p.acquirer.dispose(); await assert.rejects(hashing, code('cancelled')); p.assertWiped();
  const lateHash = digestBytes(PUBLIC_HASH_METADATA); pendingHash.resolve(lateHash);
  await nextTurn(); assert.equal(allZero(lateHash), true); p.assertWiped();
});

test('elapsed deadline and monotonic/document checks defeat delayed timer delivery before extraction', async () => {
  for (const mode of ['deadline', 'backward', 'nonfinite', 'stale']) {
    let h;
    h = harness({ digest() {
      if (mode === 'deadline') h.setNow(5100);
      if (mode === 'backward') h.setNow(99);
      if (mode === 'nonfinite') h.setNow(NaN);
      if (mode === 'stale') h.setCurrent(false);
      return digestBytes(PUBLIC_HASH_METADATA);
    } });
    await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()),
      code(mode === 'deadline' ? 'deadline' : mode === 'stale' ? 'stale-document' : 'clock-invalid'));
    assert.equal(h.allocations.some(a => a.length === 20), false); h.assertWiped();
  }
  let h; h = harness({ digest() { h.setNow(5099); return digestBytes(PUBLIC_HASH_METADATA); } });
  await h.acquirer.acquireForPlay(() => {}); assert.equal(h.acquirer.status().state, 'used');
});

test('consumer throw/value/native Promise/thenable failure is private, wiped, non-retryable', async () => {
  for (const kind of ['throw', 'value', 'promise', 'thenable']) {
    const h = harness(); let borrowed;
    await assert.rejects(h.acquirer.acquireForPlay(profile => {
      borrowed = profile.password;
      if (kind === 'throw') throw new Error('PRIVATE fake profile must not leak');
      if (kind === 'value') return profile;
      if (kind === 'promise') return Promise.reject(new Error('PRIVATE asynchronous fake error'));
      return Object.defineProperty({}, 'then', { get() { assert.fail('thenable getter invoked'); } });
    }), error => error.code === 'consumer-failed' && !String(error).includes('PRIVATE') && !Object.hasOwn(error, 'cause'));
    assert.equal(allZero(borrowed), true); h.assertWiped();
    assert.deepEqual(h.acquirer.status(), { state: 'failed', reasonCode: 'consumer-failed' });
    await assert.rejects(h.acquirer.acquireForPlay(() => {}), code('already-used'));
    assert.equal(h.counts.fetchCalls, 1);
  }
  await nextTurn();
});

test('concurrent and consumer-reentrant acquire cannot start another fetch; dispose within consumer is terminal', async () => {
  const pending = deferred(); const h = harness({ fetch: () => pending.promise });
  const first = h.acquirer.acquireForPlay(() => {});
  await assert.rejects(h.acquirer.acquireForPlay(() => {}), code('already-used'));
  assert.equal(h.counts.fetchCalls, 1); pending.resolve({}); await first;
  const p = harness(); let rejected;
  await p.acquirer.acquireForPlay(() => { rejected = p.acquirer.acquireForPlay(() => assert.fail()); rejected.catch(() => {}); });
  await assert.rejects(rejected, code('already-used')); assert.equal(p.counts.fetchCalls, 1);
  const d = harness(); let password;
  await assert.rejects(d.acquirer.acquireForPlay(profile => {
    password = profile.password; d.acquirer.dispose(); assert.equal(allZero(password), true);
  }), code('cancelled'));
  assert.deepEqual(d.acquirer.status(), { state: 'disposed', reasonCode: 'cancelled' }); d.assertWiped();
});

test('reader errors and malformed read records fail without retained native errors or excess reads', async () => {
  for (const read of [() => Promise.reject(new Error('PRIVATE read detail')), () => ({ done: true, value: Uint8Array.of(1) }),
    () => ({ done: 'yes' }), () => ({ done: false }), () => ({ done: false, value: new Uint16Array(1) }),
    () => Object.defineProperty({}, 'done', { get() { assert.fail('read getter invoked'); } })]) {
    const h = harness({ read });
    await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), error => !String(error).includes('PRIVATE'));
    assert.equal(h.counts.readCalls, 1); assert.equal(h.counts.digestCalls, 0); h.assertWiped();
  }
});

test('cancellation from authored document check cannot construct later resources or fetch', async () => {
  let h;
  h = harness({ isCurrentDocument() { h.acquirer.dispose(); return true; } });
  await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('cancelled'));
  assert.equal(h.trace.some(event => event[0] === 'abort-controller'), false);
  assert.equal(h.allocations.length, 0); assert.equal(h.counts.fetchCalls, 0);
});

test('deadline budget includes initial environment validation and cannot restart before fetch', async () => {
  let h;
  h = harness({ onEnvironment() { h.setNow(5100); } });
  await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('deadline'));
  assert.equal(h.allocations.length, 0); assert.equal(h.counts.fetchCalls, 0);
});

test('pure verifier clears borrowed data for failing/async consumer without exposing original exceptions', async () => {
  for (const asyncResult of [false, true]) {
    const f = fixture(); let borrowed;
    await assert.rejects(verifyAndConsumeProfileBytes({ source: f.source, pin: f.pin, digest: realDigest,
      consumeProfile(profile) {
        borrowed = profile.password;
        if (asyncResult) return Promise.reject(new Error('PRIVATE synthetic asynchronous error'));
        throw new Error('PRIVATE synthetic synchronous error');
      } }), error => error.code === 'consumer-failed' && !String(error).includes('PRIVATE'));
    assert.equal(allZero(f.source), true); assert.equal(allZero(borrowed), true);
  }
  await nextTurn();
});

test('deadline does not await a pending cancel; late cancel rejection stays handled', async () => {
  const read = deferred(), cancel = deferred();
  const h = harness({ read: () => read.promise, cancelReader: () => cancel.promise });
  const operation = h.acquirer.acquireForPlay(() => assert.fail()); await h.started.read.promise;
  h.fireDeadline(); await assert.rejects(operation, code('deadline')); h.assertWiped();
  cancel.reject(new Error('PRIVATE late cancellation error')); read.reject(new Error('PRIVATE late read error'));
  await nextTurn(); assert.deepEqual(h.acquirer.status(), { state: 'failed', reasonCode: 'deadline' });
});

test('native byte cleanup failure blocks consumer and reports only cleanup-failed', async () => {
  let failed = false;
  const h = harness({ beforeClear() { if (!failed) { failed = true; throw new Error('PRIVATE native cleanup error'); } } });
  await assert.rejects(h.acquirer.acquireForPlay(() => assert.fail()), code('cleanup-failed'));
  assert.deepEqual(h.acquirer.status(), { state: 'failed', reasonCode: 'cleanup-failed' });
  h.assertWiped(); assert.equal(h.counts.fetchCalls, 1);
});
