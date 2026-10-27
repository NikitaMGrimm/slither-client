import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { activateGamePage, armDocument, gamePage } from '../extension/game-activation.mjs';
import { createStockHostSnapshot } from '../web/stock-host-snapshot.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockEntityAssets } from '../web/stock-food-provider.mjs';
import { desktopBackingSize } from '../web/desktop-layout.mjs';
import { createStockGameplay } from '../web/stock-gameplay.mjs';

// Original synthetic DOM/native API and Wasm doubles; no original code/artwork/socket.
const gateSource = readFileSync(new URL('../extension/game-gate.js', import.meta.url), 'utf8');
const bootstrapSource = readFileSync(new URL('../extension/game-bootstrap.mjs', import.meta.url), 'utf8');
const bootstrap = new Script(bootstrapSource.replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '') + '\nstartGamePage;');
const startGamePage = bootstrap.runInNewContext({ createStockHostSnapshot, createStockSkinAdapter,
  createStockClient, createStockEntityAssets, desktopBackingSize, createStockGameplay, init: async () => {}, wasm: {} });

// Documentation-range endpoint and labelled synthetic profile, never a real transport.
const playRequest = () => ({ endpoint: 'ws://192.0.2.1:1234/slither',
  profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 },
  nickname: 'Synthetic', skin: 24, customSkin: new Uint8Array() });
const setup = [97, ...new Array(24).fill(0)];
function connect(f, runtime) {
  runtime.play(playRequest()); f.frame(); f.socket.open(); f.socket.message([54, 1]); f.socket.message(setup); f.flush();
}

function fixture({ armed = true, late = false, sourcePending = false, href = 'https://slither.io/' } = {}) {
  const dimensions = new WeakMap(), images = new WeakMap();
  const log = [], messages = [], raf = new Map(), timers = new Map(), intervals = new Map(), microtasks = [], faults = {};
  const events = new EventTarget();
  let serial = 0, now = 0, reloads = 0, sockets = 0, original = 0, actualRealm;
  class Element extends EventTarget {
    constructor(tag) { super(); this.tagName = tag; this.children = []; this.id = ''; this.textContent = ''; }
    appendChild(value) { this.children.push(value); return value; }
    setAttribute() {}
  }
  class Canvas extends Element {
    constructor() { super('canvas'); dimensions.set(this, { width: 32, height: 32 }); }
    get width() { return dimensions.get(this).width; }
    set width(value) { dimensions.get(this).width = value; }
    get height() { return dimensions.get(this).height; }
    set height(value) { dimensions.get(this).height = value; }
    getContext() { return new Context(this); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; }
  }
  class Image {
    constructor() { images.set(this, { width: 40, height: 40, complete: true }); }
    get naturalWidth() { return images.get(this).width; }
    get naturalHeight() { return images.get(this).height; }
    get complete() { return images.get(this).complete; }
  }
  class Context {
    constructor(canvas) { this.target = canvas; }
    get canvas() { return this.target; }
    drawImage(...args) { log.push(['native-paint', this.target, args]); if (faults.paint) throw new Error('synthetic native paint failure'); }
    putImageData() {}
    fill() {}
    stroke() {}
    fillRect() {}
    strokeRect() {}
    clearRect() {}
    reset() {}
  }
  class Storage {
    constructor() { this.values = new Map(); }
    getItem(name) { return this.values.get(name) ?? null; }
    setItem(name, value) { this.values.set(name, value); }
    removeItem(name) { this.values.delete(name); }
  }
  const document = new Element('document');
  document.readyState = late ? 'complete' : 'loading';
  document.documentElement = new Element('html'); document.head = new Element('head'); document.body = new Element('body');
  document.documentElement.appendChild(document.head); document.documentElement.appendChild(document.body);
  document.createElement = name => name === 'canvas' ? new Canvas() : new Element(name);
  document.getElementById = id => {
    function find(element) { if (element.id === id) return element; for (const child of element.children) { const found = find(child); if (found) return found; } }
    return find(document.documentElement);
  };
  const sessionStorage = new Storage();
  if (armed) sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1',
    id: 'a'.repeat(32), url: href, expires: Date.now() + 25000 }));
  let socket;
  const realm = { document, location: { href, reload() { reloads++; } },
    sessionStorage, localStorage: new Storage(), Storage, HTMLCanvasElement: Canvas,
    HTMLImageElement: Image, CanvasRenderingContext2D: Context, URL, Uint8Array, Math,
    innerWidth: 960, innerHeight: 540, performance: { now: () => now },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    postMessage(data) { messages.push(data); const event = new Event('message'); Object.assign(event,
      { data, source: actualRealm, origin: new URL(href).origin }); events.dispatchEvent(event); },
    requestAnimationFrame(callback) { const id = ++serial; raf.set(id, callback); return id; },
    cancelAnimationFrame(id) { raf.delete(id); log.push(['cancel', id]); },
    setTimeout(callback) { const id = ++serial; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    queueMicrotask(callback) { microtasks.push(callback); },
    setInterval(callback, ms) { assert.equal(ms, 25); const id = ++serial; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    WebSocket: function () {
      sockets++; log.push(['socket']);
      socket = this; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; this.closes = 0;
      this.send = bytes => { log.push(['send', [...bytes]]); if (faults.send) throw faults.send; this.sent.push([...bytes]); };
      this.close = () => { this.readyState = 3; this.closes++; };
      this.open = () => { this.readyState = 1; this.onopen?.(); };
      this.message = (...commands) => this.onmessage?.({ data: Uint8Array.from(commands.length === 1 ? commands[0]
        : commands.flatMap((command, index) => index === 0 ? [0, command.length, ...command] : [command.length + 32, ...command])).buffer });
    },
  };
  const context = createContext(realm);
  runInContext('window = globalThis; top = globalThis;', context);
  actualRealm = runInContext('globalThis', context);
  const nativeRaf = realm.requestAnimationFrame;
  new Script(gateSource).runInContext(context);
  function canvas() { const value = new Canvas(); value.getContext('2d').fillRect(0, 0, 32, 32); return value; }
  function host() {
    Object.assign(realm, { render_mode: 2, is_mobile: false, team_mode: false, choosing_skin: false,
      building_skin: false, testing: false, playing: false, connecting: false, ws: null, nsr: false });
    realm.alcsc = Uint8Array.from({ length: 256 }, (_, index) => Number(index <= 35 || [37, 39, 41].includes(index)));
    realm.per_color_imgs = Array.from({ length: 42 }, (_, index) => {
      const entry = { klp: index !== 36, kmcs: Array.from({ length: index === 36 ? 60 : 7 }, canvas), kfmc: canvas(), ic: 2 };
      for (const keys of [['imgs', 'fws', 'fhs', 'fw2s', 'fh2s'], ['oimgs', 'ofws', 'ofhs', 'ofw2s', 'ofh2s'],
        ['gimgs', 'gfws', 'gfhs', 'gfw2s', 'gfh2s'], ['pr_imgs', 'pr_fws', 'pr_fhs', 'pr_fw2s', 'pr_fh2s']]) {
        entry[keys[0]] = [canvas(), canvas()];
        for (const [i, key] of keys.slice(1).entries()) entry[key] = [i < 2 ? 32 : 16, i < 2 ? 32 : 16];
      }
      return entry;
    });
    for (const name of ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'jsebi', 'jsepi']) {
      realm[name] = canvas();
      if (name === 'jsebi' || name === 'jsepi') {
        realm[name].width = realm[name].height = name === 'jsebi' ? 64 : 48;
        realm[name].getContext('2d').fillRect(0, 0, realm[name].width, realm[name].height);
      }
    }
    realm.sesti = new Image();
    for (const name of ['kwkbulb', 'pwdbulb', 'playbulb', 'leafbulb', 'swissbulb',
      'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest']) {
      realm[name] = new Canvas();
      if (!sourcePending) realm[name].getContext('2d').drawImage(name === 'sest' ? realm.sesti : canvas(), 0, 0);
    }
    realm.bg_hex = new Image();
    for (const name of ['oef', 'redraw', 'connect', 'setSkin', 'newSlither']) realm[name] = () => { original++; throw new Error(`Original ${name} invoked`); };
  }
  function complete() { document.readyState = 'interactive'; document.dispatchEvent(new Event('DOMContentLoaded')); }
  return { realm: actualRealm, context, document, messages, log, raf, timers, intervals, faults, host, canvas, complete,
    get gate() { return actualRealm[Symbol.for('slither.client.gate.v1')]; },
    get sockets() { return sockets; }, get original() { return original; }, get reloads() { return reloads; }, nativeRaf,
    get socket() { return socket; },
    flush() { for (let count = 0; microtasks.length; count++) { assert(count < 100); microtasks.shift()(); } },
    interval(at) { now = at; for (const callback of intervals.values()) callback(); },
    event(type, properties = {}) { const event = new Event(type, { cancelable: true }); Object.assign(event, properties); events.dispatchEvent(event); },
    frame(at = now + 8) { now = at; const [id, callback] = raf.entries().next().value; raf.delete(id); callback(at); },
    timer(at = now + 50) { now = at; const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); },
  };
}

function wasmDouble(f) {
  const calls = [], values = {};
  let sceneFrees = 0, qualityFrees = 0, stepFrees = 0;
  const request = { skin: 24, id: 1, cosmetic: 255, x: 0, y: 0, customBytes: new Uint8Array(), own: true, drawOrdinal: 0 };
  class AnimatedScene {
    constructor() { calls.push('scene'); this.connected = false; this.own = null; this.borrowed = false; }
    outside() { assert.equal(this.borrowed, false, 'no native reentry'); }
    control_view() { this.outside(); return { own: this.own, camera: { x: 100, y: 200 }, zoom: 1, follows: true, connected: this.connected }; }
    reset_lag() { this.outside(); calls.push('reset_lag'); }
    advance_with_control(now, lagging, callback) {
      this.outside(); const control = this.control_view(); this.borrowed = true;
      calls.push(['advance', now, lagging]);
      try {
        const actions = callback({ nowMs: now, wholeSteps: 1, delta: 1, control });
        calls.push(['actions', actions]);
        if (actions.resetWorld) { this.own = null; this.connected = false; }
        if (actions.connected !== undefined) this.connected = actions.connected;
        if (actions.gazeHeading !== undefined) calls.push(['gaze', actions.gazeHeading]);
        calls.push('motion');
      } finally { this.borrowed = false; }
      return { free() { stepFrees++; calls.push('step.free'); } };
    }
    set_gaze_heading(value) { calls.push(['gaze', value]); }
    advance(now, lagging) { calls.push(['advance', now, lagging]); return { free() { stepFrees++; } }; }
    set_connected(value) { this.outside(); this.connected = value; calls.push(['connected', value]); }
    free() { this.outside(); sceneFrees++; }
    apply_frame_and_render_standard_with_appearance_and_prey(...args) {
      calls.push('packet');
      const appearance = { ...request, skin: f.faults.skin ?? request.skin };
      values.face = args[2](appearance);
      values.food = args[3]({ rawColor: 0, palette: 0 });
      values.prey = args[4]({ rawColor: 0, palette: 0 });
      values.recipe = args[12](appearance);
      values.random = args[13]({ nodeCount: 8, randomPairCount: 7 });
      if (f.faults.packet) throw new Error('synthetic packet failure');
      return 2;
    }
    apply_frame_and_render_standard_with_face_presentation_and_prey(...args) {
      return this.apply_frame_and_render_standard_with_appearance_and_prey(...args);
    }
    render_standard_with_antenna_at_size(...args) {
      calls.push(['render', args[5], args[6]]);
      values.recipe = args[7](request);
      values.random = args[8]({ nodeCount: 8, randomPairCount: 7 });
      if (f.faults.render) throw new Error('synthetic render failure');
    }
    render_standard_with_face_presentation_at_size(...args) { return this.render_standard_with_antenna_at_size(...args); }
  }
  class DesktopQuality {
    constructor() { calls.push('quality'); }
    advance() { calls.push('quality.advance'); }
    update_statistics(time, count) { calls.push(['statistics', time, count]); return false; }
    begin_connection() { calls.push('quality.connection'); }
    free() { qualityFrees++; }
  }
  const api = { AnimatedScene, DesktopQuality,
    encode_login() { return Uint8Array.of(115, 1); }, solve_challenge() { return new Uint8Array(27); },
    setup_protocol_version() { return 19; },
    decode_frame(bytes) {
      const commands = [];
      if (bytes[0] >= 32) commands.push([...bytes]);
      else for (let i = 0; i < bytes.length;) {
        const prefix = bytes[i++]; const length = prefix < 32 ? prefix * 256 + bytes[i++] : prefix - 32;
        commands.push([...bytes.slice(i, i + length)]); i += length;
      }
      return Uint8Array.from(commands.flatMap(command => [0, 0, 0, command.length, ...command]));
    },
  };
  return { api, calls, values,
    counts: () => ({ sceneFrees, qualityFrees, stepFrees }) };
}

test('an unarmed/expired/wrong-host document leaves scheduling and sockets untouched', () => {
  const f = fixture({ armed: false });
  assert.equal(f.gate, undefined); assert.equal(f.realm.requestAnimationFrame, f.nativeRaf);
  assert.equal(f.messages.length, 0);
  for (const changes of [{ expires: 0 }, { url: 'https://example.invalid/' }, { schema: 2 }]) {
    const value = fixture({ armed: false });
    value.realm.sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1',
      id: 'a'.repeat(32), url: 'https://slither.io/', expires: Date.now() + 20000, ...changes }));
    new Script(gateSource).runInContext(value.context);
    assert.equal(value.gate, undefined);
    assert.equal(value.realm.requestAnimationFrame, value.nativeRaf);
  }
});

test('armed document holds original callbacks/socket, privately claims native scheduling once and consumes arm', () => {
  const f = fixture(); f.host();
  assert.equal(f.realm.sessionStorage.getItem('__slitherClientArmV1'), null);
  assert.equal(f.realm.requestAnimationFrame(f.realm.oef), 0);
  assert.equal(f.realm.setTimeout(f.realm.oef), 0);
  assert.equal(f.realm.setInterval('oef()'), 0);
  assert.throws(() => new f.realm.WebSocket('ws://example.invalid'), /held/);
  assert.equal(f.sockets, 0); assert.equal(f.original, 0);
  const id = f.gate.metadata().id;
  assert.throws(() => f.gate.claim('wrong'), /claimed/);
  const native = f.gate.claim(id);
  assert.equal(Object.hasOwn(native, 'liveProfile'), false);
  assert.equal('WebSocket' in native, false);
  let calls = 0; native.requestAnimationFrame(() => { calls++; }); f.frame();
  assert.equal(calls, 1); assert.equal(f.original, 0);
  assert.throws(() => f.gate.claim(id), /claimed/);
});

test('late gate refuses ownership without starting the new controller', async () => {
  const f = fixture({ late: true });
  assert.equal(f.gate.metadata().code, 'gate-unavailable');
  await assert.rejects(startGamePage({ realm: f.realm }), /Armed document-start gate/);
});

test('native paint observation distinguishes generated completion, blank download, successful final paint and reset', () => {
  const f = fixture({ sourcePending: true }); f.host();
  const native = f.gate.claim(f.gate.metadata().id);
  const body = f.realm.per_color_imgs[0].kmcs[0], bulb = f.realm.kwkbulb;
  assert.equal(native.generated(body), false); assert.equal(native.painted(bulb), false);
  f.complete(); assert.equal(native.generated(body), true); assert.equal(native.painted(bulb), false);
  const temporary = new f.realm.HTMLCanvasElement();
  temporary.getContext('2d').drawImage(f.realm.bg_hex, 0, 0);
  assert.equal(native.painted(bulb), false);
  bulb.getContext('2d').drawImage(temporary, 0, 0);
  assert.equal(native.painted(bulb), true);
  const stamp = native.stamp(bulb); bulb.width = bulb.width;
  assert(native.stamp(bulb) > stamp); assert.equal(native.painted(bulb), false);
  f.faults.paint = true;
  assert.throws(() => bulb.getContext('2d').drawImage(temporary, 0, 0), /native paint failure/);
  assert.equal(native.painted(bulb), false);
  body.getContext('2d').clearRect(0, 0, 1, 1);
  assert.equal(native.generated(body), false);
});

test('host snapshot preserves full source identities/metrics and revisions without host function calls', () => {
  const f = fixture(); f.host(); f.complete();
  const native = f.gate.claim(f.gate.metadata().id);
  const reader = createStockHostSnapshot({ realm: f.realm, observer: native, readAccessory: native.readAccessory });
  const first = reader.capture(), again = reader.capture();
  assert.equal(first.revision, again.revision);
  assert.equal(first.host.per_color_imgs[0].imgs[0], f.realm.per_color_imgs[0].imgs[0]);
  assert.equal(first.background, f.realm.bg_hex);
  assert(first.readiness.every(entry => entry.state === 'ready'));
  f.realm.per_color_imgs[0].fw2s[0] = -0;
  const changed = reader.capture(); assert(changed.revision > first.revision);
  const bodySource = first.host.per_color_imgs[0].imgs[0];
  const commitment = (capture, source) => capture.readiness.find(entry => entry.source === source);
  assert.equal(commitment(changed, bodySource).revision, commitment(first, bodySource).revision);
  assert(Object.is(changed.host.per_color_imgs[0].fw2s[0], -0));
  f.realm.per_color_imgs[0].fw2s[0] = 0;
  assert(reader.capture().revision > changed.revision);
  const other = f.realm.kwkbulb;
  const beforePaint = reader.capture();
  other.getContext('2d').drawImage(new f.realm.HTMLCanvasElement(), 0, 0);
  const afterPaint = reader.capture();
  assert.notEqual(commitment(afterPaint, other).revision, commitment(beforePaint, other).revision);
  assert.equal(commitment(afterPaint, bodySource).revision, commitment(beforePaint, bodySource).revision);
  f.realm.localStorage.setItem('cosmetic', '0');
  assert.throws(() => reader.capture(), /Static accessory/);
  assert.equal(f.original, 0); assert.equal(f.sockets, 0);
});

for (const operation of ['dimensions-only', 'clear', 'reset', 'failed-paint']) {
  test(`generated sources require successful painting after ${operation} before checkpoint`, () => {
    const f = fixture(); f.host();
    const source = operation === 'dimensions-only' ? new f.realm.HTMLCanvasElement() : f.canvas();
    f.realm.per_color_imgs[0].kmcs[0] = source;
    const native = f.gate.claim(f.gate.metadata().id);
    const before = native.stamp(source);
    if (operation === 'dimensions-only') { source.width = 32; source.height = 32; }
    else if (operation === 'failed-paint') {
      f.faults.paint = true;
      assert.throws(() => source.getContext('2d').drawImage(f.realm.bg_hex, 0, 0), /native paint failure/);
    } else source.getContext('2d')[operation === 'clear' ? 'clearRect' : 'reset'](0, 0, 32, 32);
    assert(native.stamp(source) > before);
    f.complete();
    const reader = createStockHostSnapshot({ realm: f.realm, observer: native, readAccessory: native.readAccessory });
    assert.equal(native.generated(source), false);
    assert.equal(reader.capture().readiness.find(entry => entry.source === source).state, 'pending');
    assert.equal(native.painted(source), false);
    assert.equal(f.original, 0); assert.equal(f.sockets, 0);
  });
}

test('successful repaint after invalidation commits generated readiness at the startup checkpoint only', () => {
  const f = fixture(); f.host(); const source = f.realm.per_color_imgs[0].kmcs[0];
  const native = f.gate.claim(f.gate.metadata().id);
  source.width = source.width;
  source.getContext('2d').fillRect(0, 0, 32, 32);
  assert.equal(native.generated(source), false);
  f.complete(); assert.equal(native.generated(source), true); assert.equal(native.painted(source), false);
  source.getContext('2d').clearRect(0, 0, 32, 32);
  source.getContext('2d').fillRect(0, 0, 32, 32);
  assert.equal(native.generated(source), false);
});

test('actual bootstrap binds actual stock skin/entity/controller paths, counts Setup/RAF/resize and releases capture', async () => {
  const f = fixture(); f.host(); f.complete(); const wasm = wasmDouble(f);
  const runtime = await startGamePage({ realm: f.realm, wasmApi: wasm.api });
  assert.equal(runtime.diagnostics().connected, false);
  assert.equal(f.messages.at(-1).code, 'ready-not-connected');
  assert.throws(() => runtime.play({}), /Missing/);
  assert.equal(f.sockets, 0);
  connect(f, runtime);
  assert.equal(runtime.diagnostics().draws, 3);
  assert.equal(runtime.diagnostics().captureHeld, false);
  assert.equal(wasm.calls.filter(value => value[0] === 'advance').length, 1);
  assert.equal(wasm.values.food.palette.bodies[0].asset.source, f.realm.per_color_imgs[0].imgs[0]);
  assert.equal(wasm.values.prey.palette.bodies[0].asset.source, f.realm.per_color_imgs[0].pr_imgs[0]);
  assert.match(wasm.values.food.palette.bodies[0].asset.revision, /^src\//);
  assert.match(wasm.values.prey.palette.bodies[0].asset.revision, /^src\//);
  assert.equal(wasm.values.recipe.recipe.palettes[0].variants[0].asset.source, f.realm.per_color_imgs[23].kmcs[0]);
  assert.equal(wasm.values.random.length, 14);
  assert.equal(runtime.diagnostics().connected, true);
  f.frame(16);
  assert.equal(runtime.diagnostics().draws, 4);
  assert.equal(wasm.calls.filter(value => value[0] === 'advance').length, 2);
  assert.equal(wasm.counts().stepFrees, 2);
  f.event('resize');
  assert.equal(runtime.diagnostics().draws, 5);
  assert.equal(wasm.calls.filter(value => value[0] === 'advance').length, 2);
  f.event('pagehide'); runtime.dispose();
  assert.equal(f.socket.closes, 1);
  assert.deepEqual(wasm.counts(), { sceneFrees: 1, qualityFrees: 1, stepFrees: 2 });
  assert.equal(f.raf.size, 0); assert.equal(f.original, 0); assert.equal(f.sockets, 1);
  f.socket.message([112]); f.flush(); assert.equal(runtime.diagnostics().draws, 5);
  assert.equal(f.intervals.size, 0);
});

test('single auto-entry exposes only a local module runtime promise and never implicitly Plays', async () => {
  const f = fixture(); f.host(); f.complete(); const wasm = wasmDouble(f);
  Object.assign(f.realm, { createStockHostSnapshot, createStockSkinAdapter, createStockClient,
    createStockEntityAssets, desktopBackingSize, createStockGameplay, init: async () => {}, wasm: wasm.api });
  const source = bootstrapSource.replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '');
  const module = new Script(`${source}\n({gamePageRuntime,startGamePage});`).runInContext(f.context);
  const runtime = await module.gamePageRuntime;
  assert.equal(typeof runtime.play, 'function'); assert.equal(typeof runtime.playWithLiveProfile, 'function');
  assert.equal(runtime.bindSession, undefined);
  assert.equal(f.sockets, 0); assert.equal(f.original, 0);
  assert.equal(f.realm.gamePageRuntime, undefined, 'capability is module-local');
  await assert.rejects(module.startGamePage(), /Armed document-start gate/);
  runtime.dispose();
  assert.equal(f.raf.size, 0); assert.equal(f.intervals.size, 0);
});

test('HTTP/www external-profile bootstrap remains usable when optional profile capture is absent', async () => {
  for (const href of ['http://slither.io/', 'https://www.slither.io/']) {
    const f=fixture({href});f.host();f.complete();const wasm=wasmDouble(f);
    const runtime=await startGamePage({realm:f.realm,wasmApi:wasm.api});
    assert.equal(runtime.diagnostics().connected,false);assert.equal(f.sockets,0);
    await assert.rejects(runtime.playWithLiveProfile({endpoint:'ws://192.0.2.1:1234/slither',
      nickname:'Synthetic',skin:24,customSkin:new Uint8Array()}),/unavailable/i);
    assert.equal(runtime.diagnostics().gameplay.session.phase,'ready');assert.equal(f.sockets,0);
    connect(f,runtime);
    assert.equal(runtime.diagnostics().connected,true);assert.equal(f.sockets,1);assert.equal(f.original,0);
    runtime.dispose();assert.equal(f.socket.closes,1);assert.equal(f.raf.size,0);
  }
});

test('missing/pending host capabilities stop before scene construction and remain explicit', async () => {
  const f = fixture({ sourcePending: true }); f.host(); f.complete(); const wasm = wasmDouble(f);
  const pending = startGamePage({ realm: f.realm, wasmApi: wasm.api });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.at(-1).code, 'waiting-assets');
  assert.equal(wasm.calls.length, 0);
  f.event('pagehide'); await pending;
  assert.equal(f.timers.size, 0); assert.equal(f.raf.size, 0);
});

test('blocked Wasm and packet/render failures stop once, with no original or synthetic fallback', async () => {
  const blocked = fixture(); blocked.host(); blocked.complete();
  await assert.rejects(startGamePage({ realm: blocked.realm, initialize: async () => { throw new Error('synthetic CSP denial'); } }), /CSP denial/);
  assert.equal(blocked.messages.at(-1).code, 'csp-or-module-unavailable');
  assert.equal(blocked.original, 0); assert.equal(blocked.sockets, 0);
  for (const which of ['packet', 'render']) {
    const f = fixture(); f.host(); f.complete(); const wasm = wasmDouble(f);
    const runtime = await startGamePage({ realm: f.realm, wasmApi: wasm.api });
    connect(f, runtime); f.faults[which] = true;
    if (which === 'packet') f.socket.message([112]); else f.frame();
    // Session rejection is terminal, but free/close waits beyond ingress callbacks.
    if (which === 'packet') assert.equal(wasm.counts().sceneFrees, 0);
    f.flush();
    assert.equal(runtime.diagnostics().disposed, true);
    assert.equal(runtime.diagnostics().captureHeld, false);
    assert.equal(wasm.counts().sceneFrees, 1); assert.equal(wasm.counts().qualityFrees, 1);
    assert.equal(f.socket.closes, 1); assert.equal(f.raf.size, 0); assert.equal(f.sockets, 1);
  }
});

function activationFixture() {
  const calls = [];
  let current = { id: 7, url: 'https://slither.io/' }, resultError, registered = [];
  const api = { tabs: {
    query: async () => [current], get: async () => current,
    reload: async id => { calls.push(['reload', id]); },
  }, scripting: {
    getRegisteredContentScripts: async () => registered,
    registerContentScripts: async values => { calls.push(['register', values]); registered = values; },
    executeScript: async value => { calls.push(['arm', value]); return [{ frameId: 0, error: resultError,
      result: { schema: 1, id: value.args[0].id, url: value.args[0].url } }]; },
  } };
  return { api, calls, options: { now: () => 100, random: bytes => bytes.fill(42) },
    set current(value) { current = value; }, set resultError(value) { resultError = value; } };
}

test('activation is explicit, exact-host/path, registers both document-start worlds before one arm/reload', async () => {
  for (const url of ['https://slither.io/', 'http://www.slither.io/index.html']) assert.equal(gamePage(url), url);
  for (const url of ['https://evil.slither.io/', 'https://slither.io.evil.invalid/', 'https://slither.io/a',
    'https://slither.io/?x=1', 'https://slither.io/#x', 'https://slither.io:99/', 'https://x@slither.io/']) assert.throws(() => gamePage(url));
  const f = activationFixture(); assert.equal(f.calls.length, 0);
  await activateGamePage(f.api, f.options);
  assert.deepEqual(f.calls.map(value => value[0]), ['register', 'arm', 'reload']);
  const records = f.calls[0][1];
  assert.deepEqual(records.map(value => value.world), ['MAIN', 'ISOLATED']);
  assert(records.every(value => value.runAt === 'document_start' && !value.allFrames && !value.persistAcrossSessions));
  assert.equal(f.calls[1][1].func, armDocument);
  assert.deepEqual(f.calls[1][1].target, { tabId: 7, frameIds: [0] });
});

test('activation rejects script result errors and navigation changes before reloading', async () => {
  const f = activationFixture(); f.resultError = 'synthetic permission error';
  await assert.rejects(activateGamePage(f.api, f.options), /Could not arm/);
  assert.equal(f.calls.some(value => value[0] === 'reload'), false);
  const race = activationFixture(); race.api.tabs.get = async () => ({ id: 7, url: 'https://example.invalid/' });
  await assert.rejects(activateGamePage(race.api, race.options), /navigated/);
  assert.equal(race.calls.some(value => value[0] === 'reload'), false);
});

test('actual isolated link loads exactly one fixed MAIN module and accepts bounded status only', () => {
  const f = fixture();
  f.realm.chrome = { runtime: { getURL: name => `chrome-extension://synthetic/${name}` } };
  // Isolated scheduling is independent of the MAIN hold.
  const context = createContext({ document: f.document, location: f.realm.location, URL,
    chrome: f.realm.chrome, window: f.realm, globalThis: { chrome: f.realm.chrome },
    setTimeout: () => 1, clearTimeout() {}, Set });
  new Script(readFileSync(new URL('../extension/game-link.js', import.meta.url), 'utf8')).runInContext(context);
  assert.equal(f.document.head.children.length, 1);
  const module = f.document.head.children[0];
  assert.equal(module.type, 'module');
  assert.equal(module.src, 'chrome-extension://synthetic/game/bootstrap.mjs');
  f.realm.postMessage({ type: 'slither-client-status', schema: 1, id: 'a'.repeat(32), code: 'held' });
  assert.equal(f.document.head.children.length, 1);
  f.realm.postMessage({ type: 'slither-client-status', schema: 1, id: 'a'.repeat(32), code: 'connected', command: 'fetch' });
  assert.equal(f.document.getElementById('slither-client-status').textContent, 'SlitherClient: held');
  module.dispatchEvent(new Event('error'));
  assert.equal(f.document.getElementById('slither-client-status').textContent, 'SlitherClient: csp-or-module-unavailable');
  assert.equal(f.sockets, 0);
});

test('deadline failure for blank host sources constructs no Wasm owner and offers ordinary reload', async () => {
  const f = fixture({ sourcePending: true }); f.host(); f.complete(); const wasm = wasmDouble(f);
  const pending = startGamePage({ realm: f.realm, wasmApi: wasm.api });
  await new Promise(resolve => setImmediate(resolve));
  f.timer(10001);
  await assert.rejects(pending, /Waiting for committed/);
  assert.equal(wasm.calls.length, 0);
  assert.equal(f.messages.at(-1).code, 'host-unavailable');
  assert.equal(f.raf.size, 0); assert.equal(f.timers.size, 0);
});

test('same-size source reset invalidates capture before the next owned update or draw', async () => {
  const f = fixture(); f.host(); f.complete(); const wasm = wasmDouble(f);
  const runtime = await startGamePage({ realm: f.realm, wasmApi: wasm.api });
  const body = f.realm.per_color_imgs[0].kmcs[0]; body.width = body.width;
  f.frame();
  assert.equal(runtime.diagnostics().disposed, true);
  assert.equal(wasm.calls.filter(value => value[0] === 'advance').length, 0);
  assert.equal(wasm.counts().sceneFrees, 1);
  assert.equal(runtime.diagnostics().captureHeld, false);
});

test('actual stock 27 packet projection borrows committed eye sources through the generalized controller', async () => {
  const f = fixture(); f.host(); f.complete(); const wasm = wasmDouble(f);
  f.faults.skin = 27;
  const runtime = await startGamePage({ realm: f.realm, wasmApi: wasm.api });
  connect(f, runtime);
  assert.equal(wasm.values.face.face.kind, 'single-image');
  assert.equal(wasm.values.recipe.recipe.eyes.baseImage.asset.source, f.realm.jsebi);
  assert.equal(wasm.values.recipe.recipe.eyes.pupilImage.asset.source, f.realm.jsepi);
  assert.deepEqual(wasm.values.recipe.recipe.eyes.baseImage.sourceRect, [0, 0, 64, 64]);
  runtime.dispose();
});

test('held input suppresses original listeners after one private owner claims dispatch', () => {
  const f = fixture(); const native = f.gate.claim(f.gate.metadata().id);
  let old = 0;
  f.realm.addEventListener('click', () => { old++; });
  native.setInput(() => {});
  f.event('click'); assert.equal(old, 0);
});

test('unrelated capture changes keep entity source revisions stable across actual packet operations', async () => {
  const f = fixture(); f.host(); f.complete(); const wasm = wasmDouble(f);
  const runtime = await startGamePage({ realm: f.realm, wasmApi: wasm.api });
  connect(f, runtime);
  const sourceRevision = wasm.values.food.palette.bodies[0].asset.revision;
  const transactionRevision = wasm.values.recipe.revision;
  f.realm.per_color_imgs[0].fws[1] = 33;
  f.socket.message([112]); f.flush();
  assert.equal(wasm.values.food.palette.bodies[0].asset.revision, sourceRevision);
  assert.notEqual(wasm.values.recipe.revision, transactionRevision);
  assert.equal(runtime.diagnostics().draws, 5);
  runtime.dispose();
});
