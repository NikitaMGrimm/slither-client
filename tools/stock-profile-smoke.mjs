// Authored synthetic profile/Play composition. No captured source, actual fetch,
// original profile values, disk-backed fetch fixture or real socket is used.
import assert from 'node:assert/strict';
import { Path2D } from './pattern-path-fixture.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStockGameplay } from '../web/stock-gameplay.mjs';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { unpackCommands } from '../web/handshake-session.mjs';
import { bundle, syntheticScene, syntheticSetup } from '../web/synthetic-scene.mjs';

const freeze = Object.freeze;
const SOURCE_BYTES = 224092;
const PUBLIC_DIGEST_METADATA = '5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095';
const PROFILE_URL = 'https://slither.io/s/game1107249518.js';
const endpoint = 'ws://192.0.2.29:1234/slither';
const password = () => Uint8Array.from({ length: 20 }, (_, i) => i + 3);
const request = () => ({ endpoint, nickname: 'Authored profile smoke', skin: 0,
  customSkin: Uint8Array.of(3, 8, 1, 42) });
const allZero = value => value.every(byte => byte === 0);
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
function sourceFixture() {
  // Padding, identifiers and decimal values are wholly authored. Only public
  // size/offset metadata is shared with the immutable production acquisition pin.
  const source = new Uint8Array(SOURCE_BYTES).fill(32);
  source.set(new TextEncoder().encode('var v=29;'), 181647);
  source.set(new TextEncoder().encode(`var p=[${[...password()].join(',')}];`), 181670);
  return source;
}
function challengeFixture() {
  // Closed-grammar challenge authored independently of any server capture.
  const source = 'var a="AAAAA";a+="AAAAAAAAAAAAAAAAAAAAAA";for(var i=0;i<27;i++){idba[i]=a.charCodeAt(i);}';
  let key = 23;
  const encoded = [];
  for (const byte of Buffer.from(source, 'ascii')) {
    for (const nibble of [byte >> 4, byte & 15]) {
      encoded.push(97 + (nibble + key) % 26);
      key = (key + 17) % 26;
    }
  }
  return Uint8Array.from(encoded);
}

let running = false;

function reportAdditionalFailures(message, failures) {
  try { console.error(message, failures); }
  catch { /* Reporting must not replace an existing thrown value. */ }
}

/** Actual Wasm + actual gameplay/acquirer/controller, entirely synthetic inputs. */
export async function stockProfileSmoke(wasm) {
  if (running) throw new Error('Profile smoke already active');
  for (const name of ['AnimatedScene', 'DesktopQuality', 'encode_login', 'solve_challenge',
    'decode_frame', 'setup_protocol_version']) {
    if (typeof wasm?.[name] !== 'function') throw new TypeError(`Real Wasm capability required: ${name}`);
  }
  if (typeof wasm.AnimatedScene.prototype.advance_with_control !== 'function') {
    throw new TypeError('Real native pre-motion control ABI required');
  }
  running = true;
  let assertions = 0, attemptedNetwork = 0, primaryFailed = false;
  const cases = [], owners = [], globals = new Map();
  const eq = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
  const ok = (value, message) => { assertions++; assert.ok(value, message); };
  const throws = (callback, match) => { assertions++; assert.throws(callback, match); };
  const rejects = async (promise, match) => { assertions++; await assert.rejects(promise, match); };
  function install(name, value) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  // Canvas command double, not native Canvas or raster/pixel evidence.
  class CanvasRenderingContext2D {
    stack = []; alpha = 1; blend = 'source-over'; draws = 0; fault = false;
    reset() { this.stack = []; this.alpha = 1; this.blend = 'source-over'; }
    get globalAlpha() { return this.alpha; }
    set globalAlpha(value) { if (Number.isFinite(value) && value >= 0 && value <= 1) this.alpha = value; }
    get globalCompositeOperation() { return this.blend; }
    set globalCompositeOperation(value) { this.blend = value; }
    save() { this.stack.push([this.alpha, this.blend]); }
    restore() { const value = this.stack.pop(); assert.ok(value); [this.alpha, this.blend] = value; }
    setTransform() {} translate() {} scale() {} rotate() {}
    createPattern(source, repetition) {
      if (this.fault) throw new Error('Authored Canvas pattern preflight fault');
      return { source, repetition };
    }
    fillRect() { this.submit(); }
    beginPath() {} arc() {} moveTo() {} lineTo() {} closePath() {}
    fill() { this.submit(); } stroke() { this.submit(); }
    submit() { this.draws++; }
    drawImage(source, ...args) {
      assert.ok(source instanceof HTMLCanvasElement || source instanceof HTMLImageElement);
      assert.ok([2, 4, 8].includes(args.length) && args.every(Number.isFinite));
      this.submit();
    }
  }
  class HTMLCanvasElement {
    #width; #height;
    context = new CanvasRenderingContext2D();
    constructor(width = 48, height = 48) { this.#width = width; this.#height = height; this.context.canvas = this; }
    get width() { return this.#width; }
    set width(value) { this.#width = value; this.context.reset(); }
    get height() { return this.#height; }
    set height(value) { this.#height = value; this.context.reset(); }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  }
  class HTMLImageElement {
    get naturalWidth() { return 48; }
    get naturalHeight() { return 48; }
    get complete() { return true; }
  }
  const realm = { HTMLCanvasElement, HTMLImageElement, CanvasRenderingContext2D, Path2D };
  const setup = syntheticSetup();
  let appearance, challenge;

  function harness(options = {}) {
    const scene = new wasm.AnimatedScene(0);
    let quality, client, gameplay, owner;
    // Register the owner before later setup can throw, so partial construction is freed.
    const queue = [], intervals = new Map(), timers = new Map(), sockets = [], errors = [];
    const allocations = [], chunks = [], digests = [], steps = [], trace = [], controls = [];
    const fetchGate = deferred(), digestGate = deferred(), digestStarted = deferred();
    const reader = freeze({ authoredReader: true }), response = freeze({ authoredResponse: true });
    const body = freeze({ authoredBody: true }), signal = freeze({ authoredSignal: true });
    let now = 0, serial = 0, held = false, captures = 0, releases = 0, frameCalls = 0;
    let qualityBegins = 0, fetchCalls = 0, readCalls = 0, digestCalls = 0, readerReleases = 0;
    let current = true, stageProbes = 0, passwordClears = 0, aborts = 0;
    let invalidControl = false, staleAfterController = false, cleanupFailed = false, freed = false, probeFailure;
    function drain() {
      let count = 0;
      while (queue.length) { ok(++count <= 100, 'Bounded authored defer queue'); queue.shift()(); }
    }
    function stagedProbe() {
      if (!gameplay || gameplay.diagnostics().profilePhase !== 'acquiring'
        || gameplay.diagnostics().session.phase !== 'opening') return;
      try {
        const beforeFrames = frameCalls;
        eq(gameplay.frame(now), undefined, 'Post-consumer frame remains locked outside native borrow');
        drain();
        eq(frameCalls, beforeFrames, 'No controller, native step or commit during staged acquisition');
        eq(sockets.length, 0);
        // After await, gameplay may initialize quality while its final freshness
        // checks still hold the frame lock. Before acquisition cleanup it may not.
        const cleaned = passwordClears > 0 && readerReleases > 0
          && allocations.filter(value => value.length === 20).every(allZero);
        if (cleaned) ok(qualityBegins <= 1); else eq(qualityBegins, 0);
        ok(allocations.filter(value => value.length === SOURCE_BYTES).every(allZero), 'Source wiped before staging');
        ok(digests.every(allZero), 'Digest wiped before staging');
        stageProbes++;
      } catch (error) {
        // Product code intentionally sanitizes native/checker errors and treats
        // reader release as best effort. Retain our oracle failure independently.
        probeFailure ??= error;
        throw error;
      }
    }
    const caps = freeze({
      fetch(url, init) {
        fetchCalls++;
        eq(url, PROFILE_URL);
        eq(init, { method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'error',
          cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: false, signal });
        trace.push('synthetic-fetch');
        return options.holdFetch ? fetchGate.promise : Promise.resolve(response);
      },
      digest(algorithm, source) {
        digestCalls++;
        eq(algorithm, 'SHA-256'); eq(source, sourceFixture());
        // LABELLED DIGEST DOUBLE: metadata equality only. These authored source
        // bytes do not hash to the immutable production pin; no crypto claim.
        const digest = Uint8Array.from(PUBLIC_DIGEST_METADATA.match(/../g), byte => Number.parseInt(byte, 16));
        digests.push(digest); digestStarted.resolve();
        return options.holdDigest ? digestGate.promise : Promise.resolve(digest);
      },
      createAbort: () => freeze({ signal, abort() { aborts++; } }),
      setTimeout(callback, milliseconds) { eq(milliseconds, 5000); const id = ++serial; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
      now: () => now,
      environment: () => freeze({ origin: 'https://slither.io', topLevel: true, secureContext: true }),
      responseInfo(actual) { eq(actual, response); return freeze({ status: 200, type: 'basic', url: PROFILE_URL, redirected: false, body }); },
      getReader(actual) { eq(actual, body); return reader; },
      read(actual) {
        eq(actual, reader); readCalls++;
        if (readCalls > 1) return Promise.resolve({ done: true, value: undefined });
        const chunk = sourceFixture(); chunks.push(chunk); return Promise.resolve({ done: false, value: chunk });
      },
      cancelReader(actual) { eq(actual, reader); return Promise.resolve(); },
      releaseReader(actual) { eq(actual, reader); readerReleases++; stagedProbe(); },
      bytes: freeze({
        allocate(length) { const value = new Uint8Array(length); allocations.push(value); return value; },
        length(value) {
          if (!(value instanceof Uint8Array) || !(value.buffer instanceof ArrayBuffer)) throw new TypeError('Authored ordinary byte capability');
          return value.byteLength;
        },
        copy: (target, source, offset) => target.set(source, offset),
        clear(value) {
          if (value.length === 20) {
            passwordClears++; stagedProbe();
            if (options.cleanupFailure && !cleanupFailed) {
              // Report a cleanup fault after wiping so this deliberate fault
              // fixture itself retains no borrowed password bytes.
              value.fill(0); cleanupFailed = true; throw new Error('Authored one-shot wipe failure');
            }
          }
          value.fill(0);
        },
      }),
    });
    owner = {
      scene, sockets, timers, intervals, allocations, chunks, digests, steps, trace, controls, errors,
      waitForDigest(pending) {
        return Promise.race([digestStarted.promise, pending.then(() => {
          throw new Error('Acquisition completed before the planned digest checkpoint');
        })]);
      },
      get gameplay() { return gameplay; }, get client() { return client; },
      get quality() { return quality; },
      get counts() { return { frameCalls, qualityBegins, fetchCalls, readCalls, digestCalls,
        readerReleases, captures, releases, stageProbes, passwordClears, aborts }; },
      get current() { return current; },
      setCurrent(value) { current = value; },
      drain,
      at(value) { now = value; },
      frame(value) { now = value; const result = gameplay.frame(value); drain(); return result; },
      event(event) { gameplay.event(event, { width: 960, height: 540 }); },
      begin(value = request()) { const promise = gameplay.playWithLiveProfile(value); promise.catch(() => {}); return promise; },
      releaseFetch() { fetchGate.resolve(response); },
      releaseDigest() { digestGate.resolve(digests.at(-1)); },
      invalidControl() { invalidControl = true; },
      failCanvasPreflight() { target.context.fault = true; },
      staleAfterController() { staleAfterController = true; },
      assertCleared() {
        if (probeFailure) throw probeFailure;
        for (const bytes of [...allocations, ...chunks, ...digests]) ok(allZero(bytes), 'All transferred/owned synthetic bytes cleared');
        eq(timers.size, 0); eq(held, false); eq(captures, releases);
        ok(steps.every(step => step.freed), 'Every actual returned owned step freed');
      },
      dispose() {
        if (freed) return;
        freed = true;
        const failures = [];
        if (probeFailure) failures.push(probeFailure);
        for (const cleanup of [() => gameplay?.dispose(), () => client?.dispose(), () => scene.free(), () => quality?.free()]) {
          try { cleanup(); } catch (error) { failures.push(error); }
        }
        queue.length = 0;
        eq(intervals.size, 0); eq(timers.size, 0);
        ok(steps.every(step => step.freed)); eq(held, false); eq(captures, releases);
        for (const socket of sockets) { eq(socket.readyState, 3); eq(socket.closes, 1); }
        if (failures.length) throw new AggregateError(failures, 'Profile smoke owner cleanup failed');
      },
    };
    owners.push(owner);
    quality = new wasm.DesktopQuality(1, 0);
    const target = new HTMLCanvasElement(960, 540), source = new HTMLCanvasElement();
    const image = new HTMLImageElement();
    const host = { nsr: false,
      alcsc: Uint8Array.from({ length: 256 }, (_, i) => Number(i <= 35 || [37, 39, 41].includes(i))),
      per_color_imgs: Array.from({ length: 42 }, (_, i) => ({ klp: i !== 36,
        kmcs: Array(i === 36 ? 60 : 7).fill(source), kfmc: source })) };
    for (const slot of ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'kwkbulb', 'pwdbulb',
      'playbulb', 'leafbulb', 'swissbulb', 'moldovabulb', 'vietnambulb', 'argentinabulb',
      'movbulb', 'bonkbulb', 'sest', 'jsebi', 'jsepi']) host[slot] = source;
    const raw = { revision: 1, normalGameplay: true, ownAccessory: -1, host,
      readiness: [{ source, state: 'ready', revision: 'authored-flat-source' }] };
    const actualAdapter = createStockSkinAdapter({ resolveSkin: wasm.resolve_skin, validateCustomPaletteMask: wasm.stock_custom_palette_mask_valid, realm, random: () => 0.25, readSnapshot() {
      eq(held, false); held = true; captures++; return raw;
    } });
    const adapter = {
      beginOperation: () => actualAdapter.beginOperation(),
      endOperation() { try { return actualAdapter.endOperation(); } finally { held = false; releases++; trace.push('release-source'); } },
      resolveAppearance: value => actualAdapter.resolveAppearance(value),
      resolveRecipe: value => actualAdapter.resolveRecipe(value),
      resolveAntennaRandom: value => actualAdapter.resolveAntennaRandom(value),
    };
    const actualAdvance = scene.advance_with_control.bind(scene);
    scene.advance_with_control = (time, lagging, callback) => {
      const step = actualAdvance(time, lagging, value => {
        // Never call another method on this borrowed scene inside its callback.
        const actions = callback(value);
        controls.push(freeze({ nowMs: value.nowMs, delta: value.delta, wholeSteps: value.wholeSteps,
          accumulated: value.accumulated, doubledAccumulated: value.doubledAccumulated,
          actions: freeze({ ...actions }) }));
        return invalidControl ? { ...actions, gazeHeading: NaN } : actions;
      });
      const record = { freed: false }; steps.push(record);
      const free = step.free.bind(step);
      step.free = () => { eq(record.freed, false); free(); record.freed = true; trace.push('free-step'); };
      return step;
    };
    const beginQuality = quality.begin_connection.bind(quality);
    quality.begin_connection = () => { qualityBegins++; return beginQuality(); };
    client = createStockClient({ scene, quality, adapter,
      hostAssets: { resolveFood() { assert.fail('No authored food command in this fixture'); },
        resolvePrey() { assert.fail('No authored prey command in this fixture'); } },
      target, palettes: [source, source, source], background: image, width: 960, height: 540 });
    const controller = { packet: (...args) => client.packet(...args), frame(...args) {
      frameCalls++;
      const result = client.frame(...args);
      if (staleAfterController) current = false;
      return result;
    } };
    if (options.seed !== false) scene.apply_frame(bundle(setup, appearance), false);
    gameplay = createStockGameplay({ scene, quality, controller, wasm, now: () => now,
      defer: callback => queue.push(callback),
      setInterval(callback, period) { eq(period, 25); const id = ++serial; intervals.set(id, callback); return id; },
      clearInterval: id => intervals.delete(id), onStatus() {}, onFatal: error => errors.push(error),
      createSocket(selected) {
        eq(selected, endpoint); eq(gameplay.diagnostics().profilePhase, options.unavailable ? 'unavailable' : 'ready');
        eq(held, false, 'Socket follows controller source release');
        eq(steps.at(-1)?.freed, true, 'Socket follows owned native step free');
        eq(scene.control_view().own, null, 'Same-clock initial reset committed before constructor');
        eq(controls.at(-1)?.actions, { resetWorld: true, connected: false });
        owner.assertCleared();
        const socket = { readyState: 0, bufferedAmount: 0, sent: [], closes: 0,
          send(bytes) { this.sent.push(Uint8Array.from(bytes)); },
          close() { this.closes++; this.readyState = 3; },
          open() { this.readyState = 1; this.onopen?.(); },
          receive(bytes) { this.onmessage?.({ data: Uint8Array.from(bytes).buffer }); } };
        sockets.push(socket); trace.push('construct-fake-socket'); return socket;
      },
      liveProfile: options.unavailable ? undefined : { capabilities: caps, isCurrentDocument() {
        // These are acquisition checkpoints outside a scene borrow. Deliberate
        // gameplay frame reentry cannot reach native control while locked.
        if (gameplay?.diagnostics().profilePhase === 'acquiring'
          && gameplay.diagnostics().session.phase === 'opening') {
          stagedProbe();
          if (options.staleAfterStage) current = false;
          if (options.disposeAfterStage) gameplay.dispose();
        }
        return current;
      } },
    });
    return owner;
  }

  async function accepted(h) {
    eq(await h.begin(), undefined); h.drain();
    eq(h.gameplay.diagnostics().profilePhase, 'ready'); eq(h.counts.qualityBegins, 1);
    eq(h.sockets.length, 0, 'Acquisition success itself constructs no socket');
    h.assertCleared();
  }
  function handshake(h, loginRequest = request()) {
    h.frame(8);
    eq(h.sockets.length, 1); const socket = h.sockets[0];
    eq(socket.binaryType, 'arraybuffer'); socket.open(); h.drain();
    eq(socket.sent, [Uint8Array.of(1), Uint8Array.of(99, 0)]);
    socket.receive(Uint8Array.from([54, ...challenge])); h.drain();
    eq(socket.sent[2], Uint8Array.from({ length: 27 }, (_, i) => 65 + (3 + i * 4) % 26));
    const expected = Uint8Array.from([115, 30, 0, 29, ...password(), loginRequest.skin,
      loginRequest.nickname.length, ...Buffer.from(loginRequest.nickname, 'ascii'), 0, 255, ...loginRequest.customSkin]);
    eq(socket.sent[3], expected, 'Actual Rust login uses authored staged profile and copied request');
    socket.receive(bundle(setup, appearance)); h.drain();
    eq(h.gameplay.diagnostics().session.connected, true); eq(h.scene.control_view().connected, true);
    ok(h.scene.control_view().own); eq(JSON.parse(h.scene.snapshot()).snakes, 1);
    eq(h.errors.length, 0); return socket;
  }

  try {
    for (const [name, value] of Object.entries(realm)) install(name, value);
    for (const name of ['fetch', 'WebSocket']) install(name, function forbiddenNetwork() {
      attemptedNetwork++; throw new Error('Actual network forbidden in synthetic profile smoke');
    });
    appearance = unpackCommands(wasm.decode_frame(syntheticScene(), false)).find(command => command[0] === 115);
    ok(appearance); challenge = challengeFixture(); eq(wasm.setup_protocol_version(setup), 19);
    eq(wasm.solve_challenge(challenge), Uint8Array.from({ length: 27 }, (_, i) => 65 + (3 + i * 4) % 26));

    for (const nickname of [null, '\u007f'.repeat(24)]) {
      const h = harness({ holdFetch: true, holdDigest: true });
      eq(h.counts.fetchCalls, 0); eq(h.allocations.length, 0); eq(h.timers.size, 0);
      // A prior fractional native step must survive the eventual Play reset.
      h.frame(3); const prior = h.controls.at(-1); eq(prior.accumulated, 0.375);
      h.event({ type: 'keydown', code: 'ArrowLeft' }); h.event({ type: 'keydown', code: 'Space' });
      const original = request();
      if (nickname !== null) original.nickname = nickname;
      const expectedRequest = { ...original, customSkin: original.customSkin.slice() };
      const pending = h.begin(original);
      original.nickname = 'Changed'; original.skin = 27; original.customSkin.fill(255);
      const world = h.scene.snapshot(), quality = h.quality.snapshot(), frames = h.counts.frameCalls;
      eq(h.frame(4), undefined); eq(h.scene.snapshot(), world); eq(h.quality.snapshot(), quality);
      h.event({ type: 'keyup', code: 'ArrowLeft' }); h.event({ type: 'keyup', code: 'Space' });
      h.event({ type: 'pointermove', clientX: 480, clientY: 100 });
      eq(h.gameplay.diagnostics().input.leftHeld, false); eq(h.gameplay.diagnostics().input.boostKeyHeld, false);
      eq(h.gameplay.diagnostics().input.pointer, { x: 0, y: -170 });
      await rejects(h.begin(), /attempt|acquir|already/i);
      throws(() => h.gameplay.play({ ...request(), profile: { clientVersion: 29, password: password(), protocolVersion: 19 } }), /acquir/i);
      h.releaseFetch(); await h.waitForDigest(pending);
      eq(h.frame(5), undefined); eq(h.counts.frameCalls, frames); eq(h.sockets.length, 0);
      h.releaseDigest(); eq(await pending, undefined); h.drain();
      ok(h.counts.stageProbes >= 2, 'Post-stage checker and cleanup both probe locked frames');
      eq(h.counts.fetchCalls, 1); eq(h.counts.readCalls, 2); eq(h.counts.digestCalls, 1);
      eq(h.counts.readerReleases, 1); eq(h.counts.qualityBegins, 1);
      const socket = handshake(h, expectedRequest);
      eq(h.controls.at(-1).wholeSteps, 1); eq(h.controls.at(-1).accumulated, 1);
      eq(h.controls.at(-1).doubledAccumulated, 2, 'Reset uses existing native clock, no hidden step');
      const sends = socket.sent.length;
      h.frame(64);
      eq(h.scene.control_view().own.gazeHeading, -Math.PI / 2);
      eq(h.gameplay.diagnostics().input.leftSteps, 0);
      ok(socket.sent.slice(sends).every(bytes => bytes[0] !== 252 && bytes[0] !== 253), 'No stale turn/boost after released keys');
      ok(socket.sent.slice(sends).some(bytes => bytes.length === 1 && bytes[0] === 188), 'Latest wait-time pointer is sent');
      await rejects(h.begin(), /attempt|already/i); eq(h.counts.fetchCalls, 1);
      h.dispose(); h.assertCleared();
      cases.push(nickname === null
        ? 'actual-acquirer-staged-login-real-Rust-clock-reset-controller-handshake-Setup-and-latest-input'
        : 'actual-acquirer-DEL24-login-real-Rust-stage-handshake-and-copied-intent');
    }
    for (const failure of ['staleAfterStage', 'disposeAfterStage', 'cleanupFailure']) {
      const h = harness({ [failure]: true });
      const expectedCode = { staleAfterStage: 'stale-document', disposeAfterStage: 'cancelled', cleanupFailure: 'cleanup-failed' }[failure];
      await rejects(h.begin(), error => error.code === expectedCode);
      ok(h.counts.stageProbes > 0); eq(h.sockets.length, 0); eq(h.counts.frameCalls, 0);
      ok(['disconnected', 'failed'].includes(h.gameplay.diagnostics().session.phase), 'Launch closed before failure unlock');
      h.drain(); throws(() => h.frame(8), /stop|reentran/i);
      await rejects(h.begin(), /stop|attempt|already|reentran/i);
      eq(h.counts.fetchCalls, 1); h.dispose(); h.assertCleared();
      cases.push(`post-stage-${failure}-cancels-launch-before-unlock`);
    }
    {
      const h = harness({ holdDigest: true }); const pending = h.begin(); await h.waitForDigest(pending);
      h.gameplay.dispose(); await rejects(pending, /cancel|stale/i);
      eq(h.sockets.length, 0); h.releaseDigest();
      // Drain the known promise continuation, with no polling or real timer.
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      h.assertCleared(); h.dispose();
      cases.push('pending-dispose-late-digest-is-cleanup-only');
    }
    for (const fault of ['invalidControl', 'failCanvasPreflight', 'staleAfterController']) {
      const h = harness(); await accepted(h);
      const before = h.scene.snapshot(); h[fault]();
      throws(() => h.frame(8), /finite|invalid|Canvas|stale/i);
      eq(h.sockets.length, 0, 'Failed native/controller operation cannot commit staged socket');
      if (fault === 'invalidControl') eq(h.scene.snapshot(), before, 'Invalid native control action rolls back scene/clock');
      eq(h.counts.captures, h.counts.releases); ok(h.steps.every(step => step.freed));
      h.drain(); throws(() => h.frame(16), /stop|reentran/i); eq(h.sockets.length, 0);
      h.dispose(); h.assertCleared(); cases.push(`${fault}-blocks-socket-commit`);
    }
    {
      const h = harness();
      await rejects(h.begin({ ...request(), endpoint: 'wss://example.invalid/slither' }), /endpoint|literal/i);
      await rejects(h.begin({ ...request(), profile: {} }), /field|record/i);
      eq(h.counts.fetchCalls, 0); eq(h.counts.qualityBegins, 0); eq(h.sockets.length, 0);
      await accepted(h); h.dispose(); h.assertCleared();
      cases.push('invalid-request-is-correctable-before-acquisition');
    }
    {
      const h = harness({ unavailable: true });
      await rejects(h.begin(), /unavailable/i); eq(h.counts.fetchCalls, 0); eq(h.allocations.length, 0);
      h.gameplay.play({ ...request(), profile: { clientVersion: 29, password: password(), protocolVersion: 19 } });
      handshake(h); h.dispose();
      cases.push('absent-optional-acquirer-preserves-explicit-external-profile-route');
    }
    eq(attemptedNetwork, 0);
    return freeze({ assertions, cases: freeze(cases), socketDoubles: owners.reduce((sum, h) => sum + h.sockets.length, 0),
      networkConnections: 0, digest: 'labelled synthetic fixed-pin digest double',
      evidence: 'authored Node/real-Wasm composition; no acquisition, browser pixels or server acceptance' });
  } catch (error) { primaryFailed = true; throw error; }
  finally {
    const failures = [];
    for (const owner of owners) { try { owner.dispose(); } catch (error) { failures.push(error); } }
    for (const [name, descriptor] of globals) {
      try { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
      catch (error) { failures.push(error); }
    }
    running = false;
    if (failures.length) {
      if (primaryFailed) reportAdditionalFailures('Additional profile smoke cleanup failures:', failures);
      else throw new AggregateError(failures, 'Profile smoke cleanup failed');
    }
  }
}

const fingerprint = file => {
  const bytes = fs.readFileSync(file);
  return freeze({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
};
async function cli(args) {
  if (args.length !== 2 || args.some(file => !path.isAbsolute(file))) {
    throw new Error('Supply exactly two explicit absolute generated JS and Wasm paths; no implicit build/dist');
  }
  const files = args.map(file => fs.realpathSync(file));
  const before = files.map(fingerprint);
  console.log(JSON.stringify({ event: 'stock-profile-smoke-before', artifacts: before }));
  let result, failure, failed = false;
  try {
    const wasm = await import(pathToFileURL(files[0]).href);
    wasm.initSync({ module: fs.readFileSync(files[1]) });
    result = await stockProfileSmoke(wasm);
  } catch (error) { failed = true; failure = error; }
  let after, fingerprintFailure, fingerprintFailed = false;
  const postFailures = [];
  try {
    after = files.map(fingerprint);
    assert.deepEqual(after, before, 'Supplied generated artifacts changed during profile smoke');
  } catch (error) { fingerprintFailed = true; fingerprintFailure = error; postFailures.push(error); }
  try {
    console.log(JSON.stringify({ event: 'stock-profile-smoke-after', artifacts: after ?? null,
      unchanged: after !== undefined && !fingerprintFailed, result, failed,
      failure: failed ? String(failure?.stack ?? failure) : null, fingerprintFailed,
      fingerprintFailure: fingerprintFailed ? String(fingerprintFailure?.stack ?? fingerprintFailure) : null }));
  } catch (error) { postFailures.push(error); }
  if (failed) {
    if (postFailures.length) reportAdditionalFailures('Additional profile smoke post-run failures:', postFailures);
    throw failure;
  }
  if (postFailures.length === 1) throw postFailures[0];
  if (postFailures.length) throw new AggregateError(postFailures, 'Profile smoke post-run failed');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli(process.argv.slice(2));
