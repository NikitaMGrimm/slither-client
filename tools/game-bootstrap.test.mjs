import { authoredSourceRecipesDouble } from './fixtures/authored-source-fixture.mjs';
import { stockSkinPolicyDouble, stockSkinWasmDouble } from './stock-skin-policy-double.mjs';
import { TestDesktopInput } from './fixtures/client-input-fixture.mjs';
import { createLeaderboardHistoryDouble } from './leaderboard-history-double.mjs';
import { createHudHistoryDouble } from './hud-history-double.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, after } from 'node:test';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';
import { Script, createContext, runInContext } from 'node:vm';
import { activateGamePage, armDocument, gamePage } from '../extension/game-activation.mjs';
import { createStockHostSnapshot } from '../web/stock-host-snapshot.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockEntityAssets } from '../web/stock-food-provider.mjs';
import { desktopBackingSize } from '../web/desktop-layout.mjs';
import { desktopBackingOracle } from './fixtures/desktop-layout-fixture.mjs';
import { createStockGameplay } from '../web/stock-gameplay.mjs';
import { bindStockHudDom } from '../web/stock-hud-dom.mjs';
import { projectHudView } from '../web/stock-hud-view.mjs';

const networkGlobals = ['fetch', 'WebSocket'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
let networkAttempts = 0;
for (const [name] of networkGlobals) Object.defineProperty(globalThis, name, { configurable: true, writable: true,
  value() { networkAttempts++; throw new Error('Real network forbidden in authored bootstrap tests'); } });
after(() => {
  for (const [name, descriptor] of networkGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
  assert.equal(networkAttempts, 0);
});

// Original synthetic DOM/native API and Wasm doubles; no original code/artwork/socket.
const gateSource = readFileSync(new URL('../extension/game-gate.js', import.meta.url), 'utf8');
const bootstrapSource = readFileSync(new URL('../extension/game-runtime.mjs', import.meta.url), 'utf8');
const bootstrap = new Script('(() => {\n' + bootstrapSource.replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '') + '\nreturn (options = {}) => startGamePage({ initialize: init, wasmApi: wasm, ...options });\n})();');
const startGamePage = bootstrap.runInNewContext({ createStockHostSnapshot, createStockSkinAdapter,
  createStockClient, createStockEntityAssets, desktopBackingSize, createStockGameplay, bindStockHudDom, projectHudView,
  init: async () => {}, wasm: {} });

// Documentation-range endpoint and labelled synthetic profile, never a real transport.
const playRequest = () => ({ endpoint: 'ws://192.0.2.1:1234/slither',
  profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 },
  nickname: 'Synthetic', skin: 24, customSkin: new Uint8Array() });
const setup = [97, ...new Array(24).fill(0)];
function connect(f, runtime) {
  runtime.play(playRequest()); f.frame(); f.socket.open(); f.socket.message([54, 1]); f.socket.message(setup); f.flush();
}

function fixture({ armed = true, late = false, sourcePending = false, href = 'https://slither.io/',
  missingEdit = false, missingFence = false, missingNative, hudNative = false, accessoryNative = false } = {}) {
  const dimensions = new WeakMap(), images = new WeakMap();
  const log = [], messages = [], raf = new Map(), timers = new Map(), intervals = new Map(), microtasks = [], faults = {};
  const events = new EventTarget();
  let serial = 0, now = 0, reloads = 0, sockets = 0, original = 0, actualRealm;
  const dom = createGateTestDom({ hud: hudNative });
  const { Element } = dom;
  class Canvas extends Element {
    constructor() { super('canvas'); dimensions.set(this, { width: 32, height: 32 }); }
    get width() { return dimensions.get(this).width; }
    set width(value) { dimensions.get(this).width = value; }
    get height() { return dimensions.get(this).height; }
    set height(value) { dimensions.get(this).height = value; }
    getContext() { return new Context(this); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; }
  }
  class Image extends EventTarget {
    constructor() { super(); images.set(this, { width: 40, height: 40, complete: true, src: 'authored-image', currentSrc: 'authored-image' }); }
    get naturalWidth() { return images.get(this).width; }
    get naturalHeight() { return images.get(this).height; }
    get complete() { return images.get(this).complete; }
    get src() { return images.get(this).src; }
    get currentSrc() { return images.get(this).currentSrc; }
    decode() { return images.get(this).decode ?? Promise.resolve(); }
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
  const SceneCanvas = dom.minimap?.Canvas ?? Canvas;
  const SceneContext = dom.minimap?.Context ?? Context;
  if (dom.minimap) SceneCanvas.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540 });
  const makeCanvas = () => { const value = new SceneCanvas(); value.width = 32; value.height = 32; return value; };
  class Storage {
    constructor() { this.values = new Map(); }
    getItem(name) { return this.values.get(name) ?? null; }
    setItem(name, value) { this.values.set(name, value); }
    removeItem(name) { this.values.delete(name); }
  }
  const document = new dom.Document();
  document.readyState = late ? 'complete' : 'loading';
  document.documentElement = new Element('html'); document.head = new Element('head'); document.body = new Element('body');
  document.appendChild(document.documentElement);
  document.documentElement.appendChild(document.head); document.documentElement.appendChild(document.body);
  document.createElement = name => name === 'canvas' ? makeCanvas() : name === 'input' ? new dom.Input() : new Element(name);
  document.getElementById = id => {
    function find(element) { if (element.id === id) return element; for (const child of element.children) { const found = find(child); if (found) return found; } }
    return find(document.documentElement);
  };
  const sessionStorage = new Storage();
  if (armed) sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1',
    id: 'a'.repeat(32), url: href, expires: Date.now() + 25000 }));
  let socket;
  const realm = { document, location: { href, reload() { reloads++; } },
    sessionStorage, localStorage: new Storage(), Storage, HTMLCanvasElement: SceneCanvas,
    HTMLImageElement: Image, CanvasRenderingContext2D: SceneContext, URL, Uint8Array, Math,
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
  const edit = attachGateTestRealm(dom, realm, document, actualRealm);
  if (accessoryNative) { realm.EventTarget = EventTarget; realm.Promise = Promise; }
  if (missingEdit) delete dom.Element.prototype.checkVisibility;
  if (missingFence) delete dom.FenceEvent.prototype.stopImmediatePropagation;
  if (missingNative) {
    const [owner, name] = missingNative;
    const target = owner === 'Window' ? realm : owner === 'Location' ? realm.location : realm[owner].prototype;
    const captured = Object.getOwnPropertyDescriptor(target, name);
    // Keep early legacy property reads usable while removing the selected getter.
    if (captured.get) Object.defineProperty(target, name, { configurable: true, writable: true,
      value: owner === 'Window' || owner === 'Location' ? target[name] : undefined });
    else delete target[name];
  }
  const nativeRaf = realm.requestAnimationFrame;
  new Script(gateSource).runInContext(context);
  function canvas() { const value = makeCanvas(); value.getContext('2d').fillRect(0, 0, 32, 32); return value; }
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
    for (const name of ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'jsebi', 'jsepi', 'ecmc']) {
      realm[name] = canvas();
      if (name === 'jsebi' || name === 'jsepi' || name === 'ecmc') {
        realm[name].width = realm[name].height = name === 'jsebi' ? 64 : 48;
        realm[name].getContext('2d').fillRect(0, 0, realm[name].width, realm[name].height);
      }
    }
    realm.sesti = new Image();
    for (const name of ['kwkbulb', 'pwdbulb', 'playbulb', 'leafbulb', 'swissbulb',
      'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest', 'jmou']) {
      realm[name] = makeCanvas();
      if (name === 'jmou') { realm[name].width = 79; realm[name].height = 130; }
      if (!sourcePending) realm[name].getContext('2d').drawImage(name === 'sest' ? realm.sesti : canvas(), 0, 0);
    }
    realm.bg_hex = new Image();
    for (const name of ['oef', 'redraw', 'connect', 'setSkin', 'newSlither']) realm[name] = () => { original++; throw new Error(`Original ${name} invoked`); };
  }
  function complete() { document.readyState = 'interactive'; document.dispatchEvent(new Event('DOMContentLoaded')); }
  return { realm: actualRealm, context, document, edit, messages, log, raf, timers, intervals, faults, host, canvas, complete,
    imageState: source => images.get(source),
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
  let sceneFrees = 0, qualityFrees = 0, stepFrees = 0, controlReads = 0;
  const request = { skin: 24, id: 1, cosmetic: 255, x: 0, y: 0, customBytes: new Uint8Array(), own: true, drawOrdinal: 0 };
  class AnimatedScene {
    constructor() { calls.push('scene'); this.connected = false; this.own = null; this.borrowed = false; }
    enable_nicknames() { this.outside(); calls.push('enable-nicknames'); }
    outside() { assert.equal(this.borrowed, false, 'no native reentry'); }
    control_view() { this.outside(); controlReads++; f.faults.control?.(); return { own: this.own, camera: { x: 100, y: 200 }, zoom: 1, follows: true, connected: this.connected }; }
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
    free() { this.outside(); sceneFrees++; f.faults.cleanup?.('scene.free'); }
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
      f.faults.renderOperation?.();
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
    free() { qualityFrees++; f.faults.cleanup?.('quality.free'); }
  }
  const api = { authored_source_recipes: authoredSourceRecipesDouble, ...stockSkinWasmDouble, DesktopInput: TestDesktopInput, AnimatedScene, DesktopQuality, HudHistory: createHudHistoryDouble(), LeaderboardHistory: createLeaderboardHistoryDouble(),
    desktop_backing_size: desktopBackingOracle,
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
    counts: () => ({ sceneFrees, qualityFrees, stepFrees }), controlReads: () => controlReads };
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

test('local nickname owner exposes only an opt-in frozen unbind ticket', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start();
  assert.equal(typeof runtime.bindNicknameField, 'function');
  assert.equal(h.registrations.length, 0);
  const ticket = runtime.bindNicknameField(h.request());
  assert.equal(Object.isFrozen(ticket), true); assert.deepEqual(Object.keys(ticket), ['unbind']);
  assert.equal(typeof Object.getOwnPropertyDescriptor(ticket, 'unbind').value, 'function');
  assert.equal(h.registrations.length, 1);
  assert.deepEqual(Object.keys(h.registrations[0]).sort(), ['schema', 'element', 'parent', 'inputPolicy'].sort());
  assert.equal(h.registrations[0].inputPolicy, 'nickname-ascii-24');
  assert.equal(h.registrations[0].element, h.field); assert.equal(h.registrations[0].parent, h.parent);
  assert.equal(h.value().gets, 0); assert.equal(h.value().sets, 0);
  const unbind = ticket.unbind; assert.equal(unbind.call({}), undefined); assert.equal(unbind(), undefined);
  assert.equal(h.ownerTrace.filter(stage => stage === 'unregister').length, 1);
  assert.equal(h.f.sockets, 0); assert.equal(h.wasm.controlReads(), 0);
  runtime.dispose();
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

test('mouth canvas paint commitment survives completed loading and invalidates on later mutation', () => {
  const f = fixture({ sourcePending: true }); f.host();
  const native = f.gate.claim(f.gate.metadata().id), mouth = f.realm.jmou;
  f.complete();
  assert.equal(native.generated(f.realm.ecmc), true);
  assert.equal(native.painted(mouth), false, 'dimensions alone cannot complete a downloaded canvas');
  const context = mouth.getContext('2d');
  context.fillRect(0, 0, 1, 1);
  assert.equal(native.painted(mouth), false, 'an arbitrary successful paint is not the final image commitment');
  const source = f.canvas();
  context.drawImage(source, 0, 0);
  assert.equal(native.painted(mouth), true);
  const firstStamp = native.stamp(mouth);
  context.drawImage(source, 0, 0);
  assert(native.stamp(mouth) > firstStamp, 'same-size repaint revises content');
  context.clearRect(0, 0, 1, 1);
  assert.equal(native.painted(mouth), false);
  f.faults.paint = true;
  assert.throws(() => context.drawImage(source, 0, 0), /native paint failure/);
  assert.equal(native.painted(mouth), false);
  f.faults.paint = false;
  context.drawImage(source, 0, 0);
  assert.equal(native.painted(mouth), true);
  mouth.width = mouth.width;
  assert.equal(native.painted(mouth), false);
  assert.equal(f.original, 0); assert.equal(f.sockets, 0);
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
  assert.throws(() => reader.capture(), error => error.status === 'unsupported');
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

// Default auto-entry ownership is exercised by the actual ESM graph in game-entry.test.mjs.

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
  assert.equal(f.document.getElementById('slither-client-reload').hidden, true);
  assert.equal(module.type, 'module');
  assert.equal(module.src, 'chrome-extension://synthetic/game/bootstrap.mjs');
  f.realm.postMessage({ type: 'slither-client-status', schema: 1, id: 'a'.repeat(32), code: 'held' });
  assert.equal(f.document.head.children.length, 1);
  f.realm.postMessage({ type: 'slither-client-status', schema: 1, id: 'a'.repeat(32), code: 'connected', command: 'fetch' });
  assert.equal(f.document.getElementById('slither-client-status').textContent, 'SlitherClient: held');
  const output = f.document.getElementById('slither-client-status'), writes = [];
  // The isolated loader's plain DOM double has no native CSS class.
  output.style = { setProperty(name, value) { writes.push([name, value]); } };
  f.realm.postMessage({ type: 'slither-client-status', schema: 1, id: 'a'.repeat(32), code: 'connected' });
  assert.equal(output.textContent, 'SlitherClient: connected');
  assert.deepEqual(writes, [], 'healthy loader notifications preserve the runtime-owned hidden status');
  module.dispatchEvent(new Event('error'));
  assert.deepEqual(writes, [['display', '']], 'module failure reveals the outer fallback');
  assert.equal(f.document.getElementById('slither-client-status').textContent, 'SlitherClient: csp-or-module-unavailable');
  assert.equal(f.document.getElementById('slither-client-reload').hidden, true);
  assert.equal(f.sockets, 0);
});

test('isolated module deadline reveals an existing hidden fallback without loading a second module', () => {
  const f = fixture(), timers = new Map(); let serial = 0;
  f.realm.chrome = { runtime: { getURL: name => `chrome-extension://synthetic/${name}` } };
  const context = createContext({ document: f.document, location: f.realm.location, URL,
    chrome: f.realm.chrome, window: f.realm, globalThis: { chrome: f.realm.chrome },
    setTimeout(callback, delay) { timers.set(++serial, { callback, delay }); return serial; },
    clearTimeout(id) { timers.delete(id); }, Set });
  new Script(readFileSync(new URL('../extension/game-link.js', import.meta.url), 'utf8')).runInContext(context);
  const output = f.document.getElementById('slither-client-status'), writes = [];
  output.style = { setProperty(name, value) { writes.push([name, value]); } };
  const deadline = [...timers.values()].find(timer => timer.delay === 15000);
  assert(deadline); deadline.callback();
  assert.equal(output.textContent, 'SlitherClient: csp-or-module-unavailable');
  assert.deepEqual(writes, [['display', '']]);
  assert.equal(f.document.head.children.length, 1); assert.equal(f.sockets, 0);
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

test('actual gate/bootstrap/gameplay/input retain all raw original events and filter only new notifications', async () => {
  const f = fixture(); f.host(); f.complete(); const wasm = wasmDouble(f);
  // Observe the existing single claim, retaining the exact private native record.
  // startGamePage itself claims once; no product constructor or installation hook.
  const gateSlot = Symbol.for('slither.client.gate.v1');
  const claim = f.gate.claim;
  // Access to the claimed record is deliberately only via a local facade.
  let native;
  const facade = { ...f.realm, top: null, document: f.document, location: f.realm.location };
  facade.top = facade;
  facade[gateSlot] = Object.freeze({ metadata: f.gate.metadata, claim(id) { native = claim(id); return native; } });
  const runtime = await startGamePage({ realm: facade, wasmApi: wasm.api });
  const parent = f.document.createElement('div'), field = f.document.createElement('input');
  f.document.body.appendChild(parent); parent.appendChild(field); f.edit.state(f.document).active = field;
  const record = runInContext('({schema:1,element:null,parent:null})', f.context);
  record.element = field; record.parent = parent;
  const lease = native.registerNicknameEditField(record);
  const input = () => runtime.diagnostics().gameplay.input;
  for (const [code, key, flag] of [['ArrowLeft', 'ArrowLeft', 'leftHeld'], ['ArrowRight', 'ArrowRight', 'rightHeld'],
    ['ArrowUp', 'ArrowUp', 'boostKeyHeld'], ['Space', ' ', 'boostKeyHeld']]) {
    for (const options of [{}, { ctrlKey: true }, { isComposing: true }]) {
      const before = wasm.controlReads();
      const event = f.edit.dispatch('keydown', { target: field, code, key, ...options });
      assert.equal(event.defaultPrevented, code === 'Space' && options.ctrlKey === true,
        `${code}/${JSON.stringify(options)}`); assert.equal(input()[flag], true);
      assert.equal(wasm.controlReads(), before + 1);
      f.edit.state(parent).visible = false; f.edit.state(f.document).active = parent;
      f.edit.dispatch('keyup', { target: parent, code, key, ...options });
      assert.equal(input()[flag], false); assert.equal(wasm.controlReads(), before + 2);
      f.edit.state(parent).visible = true; f.edit.state(f.document).active = field;
    }
  }
  const added = ['keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
    'copy', 'cut', 'paste', 'selectstart', 'select', 'selectionchange', 'dblclick', 'contextmenu',
    'focus', 'blur', 'focusin', 'focusout', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
    'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel', 'touchcancel',
    'dragstart', 'drag', 'dragenter', 'dragleave', 'dragover', 'drop', 'dragend'];
  const before = { controls: wasm.controlReads(), calls: [...wasm.calls], input: input(),
    raf: [...f.raf.keys()], timers: [...f.timers.keys()], intervals: [...f.intervals.keys()] };
  for (const type of added) f.edit.dispatch(type, { target: type === 'selectionchange' ? f.document : field, key: 'a', inputType: 'insertText' });
  assert.deepEqual({ controls: wasm.controlReads(), calls: wasm.calls, input: input(),
    raf: [...f.raf.keys()], timers: [...f.timers.keys()], intervals: [...f.intervals.keys()] }, before);
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove',
    'touchstart', 'touchend', 'touchmove', 'click', 'wheel']) {
    const controls = wasm.controlReads();
    f.edit.dispatch(type, { target: field, clientX: 400, clientY: 200, buttons: 1 });
    assert.equal(wasm.controlReads(), controls + 1, type);
  }
  f.edit.dispatch('keydown', { target: field, key: 'ArrowLeft', code: 'ArrowLeft' });
  lease.unregister(); f.edit.dispatch('keyup', { target: parent, key: 'ArrowLeft', code: 'ArrowLeft' });
  assert.equal(input().leftHeld, false);
  assert.equal(f.original, 0); assert.equal(f.sockets, 0); runtime.dispose();
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

// Local synthetic capability facade; actual gate, controller and gameplay factories stay in use.
function cleanupHarness(options) {
  const f = fixture(options); f.host(); f.complete(); const wasm = wasmDouble(f);
  const trace = [], failures = new Map();
  let runtime, router, pagehide, reenter, inspect;
  const act = (stage, callback = () => {}) => {
    trace.push(stage);
    reenter?.(stage);
    inspect?.(stage);
    if (failures.has(stage)) throw failures.get(stage);
    return callback();
  };
  f.faults.cleanup = stage => act(stage);
  const realm = { ...f.realm, document: f.document, location: f.realm.location };
  realm.top = realm;
  realm.addEventListener = (type, handler) => {
    if (type === 'pagehide') pagehide = handler;
    f.realm.addEventListener(type, handler);
  };
  realm.removeEventListener = (type, handler) => act('removeListener', () => f.realm.removeEventListener(type, handler));
  realm[Symbol.for('slither.client.gate.v1')] = Object.freeze({ metadata: f.gate.metadata, claim(id) {
    const native = f.gate.claim(id);
    return Object.freeze({ ...native,
      cancelAnimationFrame: id => act('cancel', () => native.cancelAnimationFrame(id)),
      clearTimeout: id => act('clearTimer', () => native.clearTimeout(id)),
      clearInterval: id => act('gameplay.clearInterval', () => native.clearInterval(id)),
      setInput(handler) { return act('setInput', () => { router = handler; native.setInput(handler); }); },
      status: code => act(`status:${code}`, () => native.status(code)),
    });
  } });
  return { f, wasm, realm, trace, failures,
    async start(initialize = async () => {}) {
      runtime = await startGamePage({ realm, wasmApi: wasm.api, initialize });
      return runtime;
    },
    resetTrace() { trace.length = 0; },
    pagehide: () => pagehide(), route: event => router(event),
    reenter(callback) { reenter = callback; }, inspect(callback) { inspect = callback; },
  };
}

function caught(callback) {
  try { callback(); return { thrown: false }; }
  catch (error) { return { thrown: true, error }; }
}

// Test-only facade over the same actual gate claim and bootstrap router. No product injector.
function nicknameOwnerHarness(options) {
  const h = cleanupHarness(options), slot = Symbol.for('slither.client.gate.v1');
  const gate = h.realm[slot], registrations = [], ownerTrace = [], hooks = {};
  const parent = h.f.document.createElement('div'), field = h.f.document.createElement('input');
  h.f.document.body.appendChild(parent); parent.appendChild(field); h.f.edit.state(h.f.document).active = field;
  h.realm[slot] = Object.freeze({ metadata: gate.metadata, claim(id) {
    const native = gate.claim(id);
    return Object.freeze({ ...native, registerNicknameEditField(request) {
      ownerTrace.push('register'); hooks.beforeRegister?.(request); registrations.push(request);
      const lease = native.registerNicknameEditField(request);
      hooks.afterRegister?.(lease);
      return Object.freeze({ unregister() {
        ownerTrace.push('unregister'); hooks.unregister?.(); return lease.unregister();
      }, handleInput(event) {
        ownerTrace.push('handle'); hooks.handle?.(event); return lease.handleInput(event);
      } });
    } });
  } });
  return { ...h, parent, field, registrations, ownerTrace, hooks,
    request: () => ({ __proto__: null, schema: 1, element: field, parent }),
    value: () => h.f.edit.inputValue(field),
    input: properties => h.f.edit.dispatch('input', { target: field, ...properties }),
  };
}

async function rejected(callback) {
  try { await callback(); return { thrown: false }; }
  catch (error) { return { thrown: true, error }; }
}

const cleanupStages = ['cancel', 'removeListener', 'setInput', 'gameplay.clearInterval', 'scene.free', 'quality.free'];
const cleanupPrimaries = [undefined, null, false, 0, -0, Object.freeze({ synthetic: true })];

for (const stage of [...cleanupStages, 'status:disposed']) {
  test(`cleanup exhausts current owners once after ${stage} failure`, async () => {
    const h = cleanupHarness(), runtime = await h.start(); connect(h.f, runtime); h.resetTrace();
    const primary = Object.freeze({ stage }); h.failures.set(stage, primary);
    // Scene freeing occurs after the actual controller has been stopped.
    h.inspect(current => { if (current === 'scene.free') assert.equal(runtime.diagnostics().stopped, true); });
    h.reenter(() => { assert.equal(runtime.diagnostics().disposed, true); assert.equal(runtime.dispose(), undefined); });
    const result = caught(() => runtime.dispose());
    assert.equal(result.thrown, true); assert.equal(result.error, primary);
    assert.deepEqual(h.trace, [...cleanupStages, stage === 'status:disposed' ? stage : 'status:client-failed']);
    assert.equal(runtime.diagnostics().disposed, true); assert.equal(runtime.diagnostics().captureHeld, false);
    assert.equal(runtime.diagnostics().stopped, true);
    assert.equal(h.f.socket.closes, 1);
    assert.deepEqual(h.wasm.counts(), { sceneFrees: 1, qualityFrees: 1, stepFrees: 1 });
    const before = [...h.trace]; assert.equal(runtime.dispose(), undefined); assert.deepEqual(h.trace, before);
    const calls = [...h.wasm.calls], controls = h.wasm.controlReads();
    if (h.f.raf.size) h.f.frame();
    h.f.flush(); assert.deepEqual(h.wasm.calls, calls); assert.equal(h.wasm.controlReads(), controls);
    assert.equal(h.f.sockets, 1); assert.equal(h.f.original, 0);
  });
}

for (const [index, primary] of cleanupPrimaries.entries()) {
  test(`cleanup preserves first primary by presence ${index} through later cleanup/status failures`, async () => {
    const h = cleanupHarness(), runtime = await h.start(); connect(h.f, runtime); h.resetTrace();
    for (const stage of cleanupStages) h.failures.set(stage, stage === 'cancel' ? primary : new Error(`Secondary ${stage}`));
    h.failures.set('status:client-failed', new Error('Secondary status'));
    const result = caught(() => runtime.dispose());
    assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    assert.deepEqual(h.trace, [...cleanupStages, 'status:client-failed']);
    const before = [...h.trace]; assert.equal(runtime.dispose(), undefined); assert.deepEqual(h.trace, before);
    assert.equal(runtime.diagnostics().disposed, true); assert.equal(runtime.diagnostics().captureHeld, false);
    assert.equal(h.f.sockets, 1); assert.equal(h.f.original, 0);
  });
}

test('healthy cleanup preserves runtime shape, diagnostics, routes and ordinary reload', async () => {
  const h = cleanupHarness(), runtime = await h.start();
  assert.deepEqual(Object.keys(runtime), ['diagnostics', 'play', 'playWithLiveProfile', 'bindNicknameField', 'dispose']);
  assert.equal(h.f.sockets, 0); assert.equal(h.f.original, 0);
  h.route({ type: 'keydown', code: 'ArrowLeft' });
  assert.equal(runtime.diagnostics().gameplay.input.leftHeld, true);
  h.route({ type: 'keyup', code: 'ArrowLeft' });
  assert.equal(runtime.diagnostics().gameplay.input.leftHeld, false);
  assert.equal(h.wasm.controlReads(), 2);
  const before = runtime.diagnostics(), calls = [...h.wasm.calls]; h.resetTrace();
  assert.equal(runtime.dispose(), undefined);
  assert.deepEqual(h.trace, ['cancel', 'removeListener', 'setInput', 'scene.free', 'quality.free', 'status:disposed']);
  const after = runtime.diagnostics();
  assert.equal(after.draws, before.draws); assert.equal(after.width, before.width); assert.equal(after.height, before.height);
  assert.equal(after.disposed, true); assert.equal(after.stopped, true); assert.equal(after.captureHeld, false);
  assert.equal(after.gameplay.disposed, true); assert.equal(after.connected, false);
  assert.deepEqual(h.wasm.calls, calls); assert.equal(h.wasm.controlReads(), 2);
  assert.equal(h.f.raf.size, 0); assert.equal(h.f.timers.size, 0); assert.equal(h.f.intervals.size, 0);
  h.route({ type: 'keydown', code: 'ArrowRight' }); assert.equal(h.wasm.controlReads(), 2);
  h.route({ type: 'click', target: h.f.document.getElementById('slither-client-reload') });
  assert.equal(h.f.reloads, 1); assert.equal(h.f.sockets, 0); assert.equal(h.f.original, 0);
});

test('waiting cleanup wakes startup despite timer/remover/input/status failures and never retries consumed cells', async () => {
  const h = cleanupHarness({ sourcePending: true }), pending = h.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.f.messages.at(-1).code, 'waiting-assets'); assert.equal(h.f.timers.size, 1);
  h.resetTrace();
  for (const stage of ['clearTimer', 'removeListener', 'setInput', 'status:client-failed']) h.failures.set(stage, undefined);
  h.reenter(() => assert.equal(h.pagehide(), undefined));
  const result = caught(h.pagehide);
  assert.equal(result.thrown, true); assert.equal(result.error, undefined);
  assert.deepEqual(h.trace, ['clearTimer', 'removeListener', 'setInput', 'status:client-failed']);
  const runtime = await pending;
  assert.deepEqual(Object.keys(runtime), ['dispose']); assert.equal(runtime.dispose(), undefined);
  const before = [...h.trace]; h.f.timer(); await Promise.resolve();
  assert.deepEqual(h.trace, before); assert.deepEqual(h.wasm.calls, []);
  assert.equal(h.f.sockets, 0); assert.equal(h.f.original, 0);
});

for (const [index, primary] of [...cleanupPrimaries, new Error('Synthetic initialization primary'),
  Object.freeze({ status: 'unsupported' }), Object.freeze({ get status() { throw new Error('Synthetic status getter'); } })].entries()) {
  test(`startup preserves exact primary ${index} after best-effort classification and failed cleanup`, async () => {
    const h = cleanupHarness();
    const result = await rejected(() => h.start(async () => {
      h.resetTrace();
      for (const stage of ['removeListener', 'setInput', 'status:client-failed']) h.failures.set(stage, new Error(`Secondary ${stage}`));
      throw primary;
    }));
    assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    assert.deepEqual(h.trace, ['removeListener', 'setInput', 'status:client-failed']);
    assert.deepEqual(h.wasm.calls, []); assert.equal(h.f.sockets, 0); assert.equal(h.f.original, 0);
    assert.equal(h.pagehide(), undefined);
  });
}

test('startup keeps unsupported mapping and original identity when terminal status alone fails', async () => {
  for (const primary of [new Error('Synthetic startup primary'), Object.freeze({ status: 'unsupported' })]) {
    const h = cleanupHarness();
    const status = primary.status === 'unsupported' ? 'host-unavailable' : 'csp-or-module-unavailable';
    h.failures.set(`status:${status}`, new Error('Synthetic terminal status failure'));
    const result = await rejected(() => h.start(async () => { h.resetTrace(); throw primary; }));
    assert.equal(result.thrown, true); assert.equal(result.error, primary);
    assert.deepEqual(h.trace, ['removeListener', 'setInput', `status:${status}`]);
  }
});

test('startup primary after owner construction survives every later owner/status failure', async () => {
  for (const primary of cleanupPrimaries) {
    const h = cleanupHarness();
    h.failures.set('status:ready-not-connected', primary);
    h.failures.set('scene.free', new Error('Secondary scene free'));
    h.failures.set('quality.free', new Error('Secondary quality free'));
    h.failures.set('status:client-failed', new Error('Secondary terminal status'));
    const result = await rejected(() => h.start());
    assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    assert.deepEqual(h.trace, ['setInput', 'status:loading', 'status:ready-not-connected',
      'removeListener', 'setInput', 'scene.free', 'quality.free', 'status:client-failed']);
    assert.deepEqual(h.wasm.counts(), { sceneFrees: 1, qualityFrees: 1, stepFrees: 0 });
    assert.equal(h.f.raf.size, 0); assert.equal(h.f.sockets, 0); assert.equal(h.f.original, 0);
  }
});

test('runtime fail remains quiet on clean disposal and preserves original primary through secondary failures', async () => {
  for (const [index, primary] of [...cleanupPrimaries, Object.freeze({ status: 'unsupported' }),
    Object.freeze({ get status() { throw new Error('Synthetic runtime status getter'); } })].entries()) {
    for (const secondary of [undefined, 'scene.free', 'status:client-failed']) {
      const h = cleanupHarness(), runtime = await h.start(); h.resetTrace();
      h.f.faults.control = () => { throw primary; };
      const status = index === 6 ? 'host-unavailable' : 'client-failed';
      if (secondary) h.failures.set(secondary === 'status:client-failed' ? `status:${status}` : secondary,
        new Error(`Secondary ${secondary}`));
      const result = caught(() => h.route({ type: 'keydown', code: 'ArrowLeft' }));
      assert.equal(result.thrown, secondary !== undefined || index === 7);
      if (result.thrown) assert(Object.is(result.error, primary));
      const code = secondary === 'scene.free' ? 'client-failed' : status;
      assert.deepEqual(h.trace, ['status:ready-not-connected', 'cancel', 'removeListener', 'setInput',
        'scene.free', 'quality.free', `status:${code}`]);
      assert.equal(runtime.diagnostics().disposed, true); assert.equal(runtime.diagnostics().stopped, true);
      assert.equal(runtime.diagnostics().captureHeld, false);
      assert.equal(runtime.dispose(), undefined); assert.equal(h.f.sockets, 0); assert.equal(h.f.original, 0);
    }
  }
});

test('nickname owner rejects closed-grammar violations without getters, then, coercion or registration', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(); let touched = 0;
  const trip = () => { touched++; throw new Error('caller property touched'); };
  const requests = [null, [], Promise.resolve(), {}, Object.create(h.request()), { ...h.request() }];
  for (const name of ['schema', 'element', 'parent']) {
    const request = h.request(); Object.defineProperty(request, name, { get: trip }); requests.push(request);
    const missing = h.request(); delete missing[name]; requests.push(missing);
  }
  for (const name of ['then', 'inputPolicy', 'extra']) {
    const request = h.request(); Object.defineProperty(request, name, { get: trip }); requests.push(request);
  }
  const symbol = h.request(); symbol[Symbol()] = 1; requests.push(symbol);
  for (const schema of [undefined, null, false, 0, '1', { toString: trip }]) requests.push({ ...h.request(), __proto__: null, schema });
  for (const request of requests) assert.equal(caught(() => runtime.bindNicknameField(request)).thrown, true);
  assert.equal(touched, 0); assert.equal(h.registrations.length, 0);
  const ticket = runtime.bindNicknameField(h.request()); ticket.unbind(); runtime.dispose();
});

test('nickname owner accepts its actual current realm record through the unbound factory', async () => {
  const f = fixture(); f.host(); f.complete(); const wasm = wasmDouble(f);
  Object.assign(f.realm, { createStockHostSnapshot, createStockSkinAdapter, createStockClient,
    createStockEntityAssets, desktopBackingSize, createStockGameplay, init: async () => {}, wasm: wasm.api });
  f.realm.startRuntime = bootstrap.runInContext(f.context);
  const runtime = await f.realm.startRuntime({ realm: f.realm, wasmApi: wasm.api });
  const parent = f.document.createElement('div'), field = f.document.createElement('input');
  f.document.body.appendChild(parent); parent.appendChild(field); f.edit.state(f.document).active = field;
  const request = runInContext('({schema:1,element:null,parent:null})', f.context); request.element = field; request.parent = parent;
  const value = f.edit.inputValue(field); value.value = '\u00e9';
  f.edit.dispatch('input', { target: field }); assert.equal(value.gets, 0);
  const ticket = runtime.bindNicknameField(request); assert.equal(value.gets, 0);
  f.edit.dispatch('input', { target: field }); assert.equal(value.value, ' '); assert.equal(value.gets, 1);
  ticket.unbind(); runtime.dispose();
});

test('nickname owner reflection primaries retain exact presence and clear the transaction', async () => {
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) for (const primary of cleanupPrimaries) {
    const h = nicknameOwnerHarness(), runtime = await h.start();
    const request = new Proxy(h.request(), { [trap]() { throw primary; } });
    const result = caught(() => runtime.bindNicknameField(request));
    assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    assert.equal(h.registrations.length, 0); assert.equal(runtime.diagnostics().disposed, false);
    runtime.bindNicknameField(h.request()).unbind(); runtime.dispose();
  }
});

test('caught reflection reentry cannot publish or cause play, disposal, router or native effects', async () => {
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) for (const action of ['bind', 'play', 'livePlay', 'dispose', 'router']) {
    const h = nicknameOwnerHarness(), runtime = await h.start(); let first, entered = false;
    const before = { calls: [...h.wasm.calls], controls: h.wasm.controlReads(), trace: [...h.trace], messages: [...h.f.messages], raf: [...h.f.raf.keys()] };
    const actions = { bind: () => runtime.bindNicknameField(h.request()), play: () => runtime.play(playRequest()),
      livePlay: () => runtime.playWithLiveProfile(playRequest()), dispose: () => runtime.dispose(),
      router: () => h.route({ type: 'keydown', code: 'ArrowLeft' }) };
    const proxy = new Proxy(h.request(), { [trap](...args) {
      if (!entered) { entered = true; first = caught(actions[action]); assert.equal(first.thrown, true); }
      return Reflect[trap](...args);
    } });
    const result = caught(() => runtime.bindNicknameField(proxy));
    assert.equal(result.thrown, true); assert.equal(result.error, first.error);
    assert.equal(h.registrations.length, 0); assert.equal(h.f.sockets, 0);
    assert.deepEqual({ calls: h.wasm.calls, controls: h.wasm.controlReads(), trace: h.trace, messages: h.f.messages, raf: [...h.f.raf.keys()] }, before);
    runtime.bindNicknameField(h.request()).unbind(); runtime.dispose();
  }
});

test('registration failure or caught late violation never publishes and cleans only the acquired lease', async () => {
  for (const late of [false, true]) for (const primary of cleanupPrimaries) {
    const h = nicknameOwnerHarness(), runtime = await h.start(); let expected = primary;
    if (late) h.hooks.afterRegister = () => { expected = caught(() => runtime.dispose()).error; };
    else h.hooks.beforeRegister = () => { throw primary; };
    h.hooks.unregister = () => { throw primary; };
    const result = caught(() => runtime.bindNicknameField(h.request()));
    assert.equal(result.thrown, true); assert(Object.is(result.error, expected));
    assert.equal(h.ownerTrace.filter(stage => stage === 'unregister').length, late ? 1 : 0);
    assert.equal(runtime.diagnostics().disposed, false); assert.equal(h.value().gets, 0);
    h.hooks.beforeRegister = h.hooks.afterRegister = h.hooks.unregister = undefined;
    // A throwing unregister cannot certify gate revocation; permanent disposal revokes its router.
    if (!late) runtime.bindNicknameField(h.request()).unbind();
    runtime.dispose();
  }
});

test('late registration violation unregisters once, drops candidate and permits a later explicit bind', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(); let first;
  h.hooks.afterRegister = () => { first = caught(() => h.route({ type: 'input' })).error; };
  assert.equal(caught(() => runtime.bindNicknameField(h.request())).error, first);
  assert.deepEqual(h.ownerTrace, ['register', 'unregister']);
  h.hooks.afterRegister = undefined;
  const ticket = runtime.bindNicknameField(h.request()); ticket.unbind(); runtime.dispose();
});

test('authoritative native registration rejection leaves owner unbound without value work', async () => {
  for (const change of [h => { h.f.edit.state(h.field).type = 'password'; }, h => h.parent.removeChild(h.field),
    h => { h.f.edit.state(h.field).owner = new h.f.edit.Document(); }]) {
    const h = nicknameOwnerHarness(), runtime = await h.start(); change(h);
    assert.equal(caught(() => runtime.bindNicknameField(h.request())).thrown, true);
    assert.equal(h.value().gets, 0); assert.equal(h.value().sets, 0); assert.equal(runtime.diagnostics().disposed, false);
    h.f.edit.state(h.field).type = 'text'; h.parent.appendChild(h.field);
    runtime.bindNicknameField(h.request()).unbind(); runtime.dispose();
  }
});

test('explicit unbind is idempotent and old tickets are inert before newer owner operations', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(); const old = runtime.bindNicknameField(h.request());
  assert.equal(caught(() => runtime.bindNicknameField(new Proxy({}, { getPrototypeOf() { assert.fail('occupied request reflected'); } }))).thrown, true);
  const before = runtime.diagnostics(), calls = [...h.wasm.calls], controls = h.wasm.controlReads();
  old.unbind(); assert.equal(runtime.diagnostics().disposed, false);
  assert.deepEqual(runtime.diagnostics(), before); assert.deepEqual(h.wasm.calls, calls); assert.equal(h.wasm.controlReads(), controls);
  h.hooks.afterRegister = () => { assert.equal(old.unbind(), undefined); };
  const next = runtime.bindNicknameField(h.request()); old.unbind();
  h.value().value = '\u00e9'; h.input(); assert.equal(h.value().value, ' ');
  assert.equal(h.ownerTrace.filter(stage => stage === 'unregister').length, 1);
  next.unbind(); runtime.dispose(); assert.equal(next.unbind(), undefined);
  assert.equal(caught(() => runtime.bindNicknameField(h.request())).thrown, true);
});

test('failed explicit unregister drops owner references once without certifying gate revocation', async () => {
  for (const primary of cleanupPrimaries) {
    const h = nicknameOwnerHarness(), runtime = await h.start(), ticket = runtime.bindNicknameField(h.request());
    h.hooks.unregister = () => { throw primary; };
    const result = caught(ticket.unbind); assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    const before = [...h.ownerTrace]; assert.equal(ticket.unbind(), undefined); assert.deepEqual(h.ownerTrace, before);
    h.hooks.unregister = undefined;
    const next = caught(() => runtime.bindNicknameField(h.request()));
    assert.equal(next.thrown, true); assert.match(String(next.error), /already registered/,
      'owner slot is gone but throwing mock did not revoke the actual gate permission');
    assert.equal(h.value().gets, 0); assert.equal(h.value().sets, 0); runtime.dispose();
  }
});

test('opaque gate-only revocation retains occupied slot until explicit unbind', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(), ticket = runtime.bindNicknameField(h.request());
  h.f.edit.state(h.field).type = 'password';
  h.f.edit.dispatch('keydown', { target: h.field, key: 'ArrowLeft', code: 'ArrowLeft' });
  assert.equal(runtime.diagnostics().gameplay.input.leftHeld, true);
  h.f.edit.state(h.field).type = 'text';
  assert.equal(caught(() => runtime.bindNicknameField(h.request())).thrown, true);
  h.f.edit.dispatch('keyup', { target: h.parent, code: 'ArrowLeft', key: 'ArrowLeft' });
  assert.equal(runtime.diagnostics().gameplay.input.leftHeld, false);
  ticket.unbind(); runtime.bindNicknameField(h.request()).unbind(); runtime.dispose();
});

test('actual nickname router corrects once before filter without extra gameplay or native observations', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(); runtime.bindNicknameField(h.request());
  const observe = () => ({ diagnostic: runtime.diagnostics(), controls: h.wasm.controlReads(), calls: [...h.wasm.calls],
    log: [...h.f.log], messages: [...h.f.messages], raf: [...h.f.raf.keys()], timers: [...h.f.timers.keys()], intervals: [...h.f.intervals.keys()] });
  const before = observe(); h.value().value = '\u00e9'; const event = h.input();
  assert.equal(h.value().value, ' '); assert.equal(h.value().gets, 1); assert.equal(h.value().sets, 1);
  assert.equal(event.defaultPrevented, true); assert.deepEqual(observe(), before);
  assert.deepEqual(h.f.edit.eventData.get(event).trace, ['window-capture', 'stop', 'prevent']);
  const handles = h.ownerTrace.filter(stage => stage === 'handle').length;
  for (const type of ['beforeinput', 'compositionstart', 'compositionupdate', 'compositionend', 'copy', 'cut', 'paste', 'select', 'selectionchange']) {
    h.f.edit.dispatch(type, { target: type === 'selectionchange' ? h.f.document : h.field, inputType: 'insertCompositionText' });
  }
  assert.equal(h.ownerTrace.filter(stage => stage === 'handle').length, handles + 9);
  assert.equal(h.value().gets, 1); assert.equal(h.value().sets, 1); assert.deepEqual(observe(), before);
  runtime.dispose();
});

test('nickname owner preserves original raw delivery and exact baseline input state through editing changes', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(), reference = cleanupHarness(), baseline = await reference.start();
  const ticket = runtime.bindNicknameField(h.request());
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space']) for (const extra of [{}, { ctrlKey: true }, { isComposing: true }, { altKey: true }]) {
    const properties = { key: code === 'Space' ? ' ' : code, code, ...extra };
    h.f.edit.dispatch('keydown', { target: h.field, ...properties }); reference.route({ type: 'keydown', ...properties });
    assert.deepEqual(runtime.diagnostics().gameplay.input, baseline.diagnostics().gameplay.input);
    h.f.edit.state(h.field).readOnly = true; h.f.edit.state(h.parent).visible = false;
    h.f.edit.dispatch('keyup', { target: h.parent, ...properties }); reference.route({ type: 'keyup', ...properties });
    assert.deepEqual(runtime.diagnostics().gameplay.input, baseline.diagnostics().gameplay.input);
    h.f.edit.state(h.field).readOnly = false; h.f.edit.state(h.parent).visible = true;
  }
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'touchstart', 'touchend', 'touchmove', 'click', 'wheel']) {
    const properties = { type, clientX: 400, clientY: 200, buttons: 1 };
    h.f.edit.dispatch(type, { target: h.field, ...properties }); reference.route(properties);
    assert.deepEqual(runtime.diagnostics().gameplay.input, baseline.diagnostics().gameplay.input);
  }
  assert.equal(h.wasm.controlReads(), reference.wasm.controlReads()); assert.deepEqual(h.wasm.calls, reference.wasm.calls);
  assert.equal(h.value().gets, 0); assert.equal(h.value().sets, 0);
  ticket.unbind(); runtime.dispose(); baseline.dispose();
});

test('handler primaries detach field only and survive unregister failure without active native cleanup', async () => {
  for (const primary of cleanupPrimaries) for (const unregisterFails of [false, true]) {
    const h = nicknameOwnerHarness(), runtime = await h.start(); const ticket = runtime.bindNicknameField(h.request());
    const before = { counts: h.wasm.counts(), messages: [...h.f.messages], trace: [...h.trace], raf: [...h.f.raf.keys()], timers: [...h.f.timers.keys()] };
    h.value().getFailure = primary; h.hooks.unregister = () => {
      if (unregisterFails) {
        assert.equal(caught(() => runtime.dispose()).thrown, true, 'cleanup cannot dispose the active owner');
        throw new Error('secondary unregister');
      }
    };
    const result = caught(() => h.input()); assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    assert.equal(runtime.diagnostics().disposed, false); assert.equal(h.ownerTrace.filter(stage => stage === 'unregister').length, 1);
    assert.deepEqual({ counts: h.wasm.counts(), messages: h.f.messages, trace: h.trace, raf: [...h.f.raf.keys()], timers: [...h.f.timers.keys()] }, before);
    assert.equal(ticket.unbind(), undefined); delete h.value().getFailure; h.hooks.unregister = undefined;
    // Actual gate revoked on the getter failure before owner cleanup, even if mock unregister failed.
    runtime.bindNicknameField(h.request()).unbind(); runtime.dispose();
  }
});

test('handler critical section rejects caught owner operations and remains field-only on failure', async () => {
  for (const action of ['bind', 'play', 'livePlay', 'dispose', 'unbind', 'router']) {
    const h = nicknameOwnerHarness(), runtime = await h.start(), ticket = runtime.bindNicknameField(h.request()); let first;
    const actions = { bind: () => runtime.bindNicknameField(h.request()), play: () => runtime.play(playRequest()),
      livePlay: () => runtime.playWithLiveProfile(playRequest()), dispose: () => runtime.dispose(), unbind: () => ticket.unbind(),
      router: () => h.route({ type: 'keyup', code: 'ArrowLeft' }) };
    h.value().getHook = () => { first = caught(actions[action]); assert.equal(first.thrown, true); };
    const result = caught(() => h.input()); assert.equal(result.thrown, true); assert.equal(result.error, first.error);
    assert.equal(runtime.diagnostics().disposed, false); assert.equal(h.wasm.counts().sceneFrees, 0); assert.equal(h.wasm.counts().qualityFrees, 0);
    assert.equal(h.value().sets, 0); h.value().getHook = undefined;
    runtime.bindNicknameField(h.request()).unbind(); runtime.dispose();
  }
});

test('caught owner violation is reported after the native handler completes, without promising value rollback', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(); runtime.bindNicknameField(h.request()); let first;
  h.value().value = '\u00e9';
  h.value().getHook = () => { first = caught(() => runtime.dispose()).error; };
  const result = caught(() => h.input()); assert.equal(result.thrown, true); assert.equal(result.error, first);
  assert.equal(h.value().gets, 1); assert.equal(h.value().sets, 1); assert.equal(h.value().value, ' ');
  assert.equal(runtime.diagnostics().disposed, false); assert.equal(h.wasm.counts().sceneFrees, 0);
  h.value().getHook = undefined; runtime.dispose();
});

test('bind and active unbind reject known router and held-capture paths without blocking gameplay failure cleanup', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(), ticket = runtime.bindNicknameField(h.request());
  let sawRouter = false;
  h.f.faults.control = () => {
    sawRouter = true; assert.equal(caught(ticket.unbind).thrown, true);
    assert.equal(caught(() => runtime.bindNicknameField(h.request())).thrown, true);
  };
  h.f.edit.dispatch('keydown', { target: h.field, code: 'ArrowLeft', key: 'ArrowLeft' }); assert.equal(sawRouter, true);
  ticket.unbind(); let sawHeld = 0;
  h.f.faults.control = undefined;
  h.f.faults.renderOperation = () => {
    assert.equal(runtime.diagnostics().captureHeld, true); sawHeld++;
    assert.equal(caught(() => runtime.bindNicknameField(h.request())).thrown, true);
  };
  h.f.frame(); assert.equal(sawHeld, 1);
  const active = runtime.bindNicknameField(h.request());
  h.f.faults.renderOperation = () => {
    assert.equal(runtime.diagnostics().captureHeld, true); sawHeld++;
    assert.equal(caught(active.unbind).thrown, true);
  };
  h.f.frame(); assert.equal(sawHeld, 2); h.f.faults.renderOperation = undefined;
  const primary = { failure: 'gameplay' }; h.f.faults.control = () => { throw primary; };
  h.f.edit.dispatch('keydown', { target: h.field, code: 'ArrowLeft', key: 'ArrowLeft' });
  assert.equal(runtime.diagnostics().disposed, true); assert.equal(h.wasm.counts().sceneFrees, 1);
  assert.equal(h.wasm.counts().qualityFrees, 1);
});

test('permanent idle disposal detaches first and preserves PR48 cleanup order and falsy failures', async () => {
  for (const primary of cleanupPrimaries) {
    const h = nicknameOwnerHarness(), runtime = await h.start(), ticket = runtime.bindNicknameField(h.request());
    connect(h.f, runtime); h.resetTrace(); const order = [];
    h.hooks.unregister = () => { order.push('unregister'); assert.equal(ticket.unbind(), undefined); throw primary; };
    h.inspect(stage => { order.push(stage); assert.equal(ticket.unbind(), undefined); });
    h.failures.set('cancel', new Error('secondary cancel')); h.failures.set('status:client-failed', new Error('secondary status'));
    const result = caught(() => runtime.dispose()); assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    assert.deepEqual(order, ['unregister', ...cleanupStages, 'status:client-failed']);
    assert.equal(h.wasm.counts().sceneFrees, 1); assert.equal(h.wasm.counts().qualityFrees, 1);
    assert.equal(runtime.dispose(), undefined); assert.equal(ticket.unbind(), undefined);
  }
});

test('ordinary reload wins before handle and pre-router gate failures remain outside owner observation', async () => {
  const h = nicknameOwnerHarness(), runtime = await h.start(); const ticket = runtime.bindNicknameField(h.request());
  const primary = { failure: 'stop before router' };
  const event = h.f.edit.make('input', { target: h.field, stopFailure: primary });
  assert.equal(caught(() => h.f.edit.deliver(event)).error, primary);
  assert.equal(h.ownerTrace.filter(stage => stage === 'handle').length, 0);
  assert.equal(h.ownerTrace.filter(stage => stage === 'unregister').length, 0);
  assert.equal(caught(() => runtime.bindNicknameField(h.request())).thrown, true);
  h.hooks.handle = () => assert.fail('reload must precede nickname handling');
  h.route({ type: 'click', target: h.f.document.getElementById('slither-client-reload') });
  assert.equal(h.f.reloads, 1); assert.equal(runtime.diagnostics().disposed, false);
  ticket.unbind(); runtime.dispose();
});

// Authored local HUD capability group; no late product gate dependency or native DOM execution.
function hudOwnerHarness({ group = true } = {}) {
  const h = nicknameOwnerHarness(), slot = Symbol.for('slither.client.gate.v1'), gate = h.realm[slot];
  const data = new WeakMap(), styles = new WeakMap(), domCalls = [], writes = [], hooks = {};
  let current = true, runtime, checks = 0, scoreReads = 0, tracking = 0, commands = [];
  let actualGameplay, gameplayOptions, snapshotReads = 0;
  const make = (type, name = null, text = '') => {
    const node = Object.create(null), style = Object.create(null); styles.set(style, new Map());
    data.set(node, { type, name, text, style, parent: null, children: [], connected: true });
    for (const key of ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling',
      'isConnected', 'localName', 'namespaceURI', 'style', 'textContent', 'then']) {
      Object.defineProperty(node, key, { get() { assert.fail(`Late HUD node access: ${key}`); } });
    }
    return node;
  };
  // The supplied document is the bootstrap's captured exact document, never a lookalike.
  data.set(h.f.document, { type: 9, parent: null, children: [], connected: true });
  const children = (parent, values) => {
    data.get(parent).children = [...values];
    for (const node of values) data.get(node).parent = parent;
  };
  const atom = (name, text) => {
    const value = { element: make(1, name), text: make(3, null, text) };
    children(value.element, [value.text]); return value;
  };
  const mount = make(1, 'section'); children(h.f.document, [mount]);
  const readout = { root: make(1, 'div'), lengthLine: make(1, 'div'), rankLine: make(1, 'div'),
    lengthLabel: atom('span', 'AUTHORED LENGTH'), lengthValue: atom('b', 'keep-length'),
    rankLabel: atom('span', 'AUTHORED RANK'), rankValue: atom('span', 'keep-rank'),
    separator: atom('span', 'AUTHORED /'), populationValue: atom('span', 'keep-population') };
  const final = { root: make(1, 'div'), label: atom('span', 'AUTHORED FINAL'), value: atom('b', 'keep-final') };
  children(readout.root, [readout.lengthLine, readout.rankLine]);
  children(readout.lengthLine, [readout.lengthLabel.element, readout.lengthValue.element]);
  children(readout.rankLine, [readout.rankLabel.element, readout.rankValue.element,
    readout.separator.element, readout.populationValue.element]);
  children(final.root, [final.label.element, final.value.element]); children(mount, [readout.root, final.root]);
  const dom = Object.create(null);
  const observe = (name, node, ...args) => {
    domCalls.push([name, node, ...args]); hooks.dom?.(name, node, ...args);
    assert(data.has(node), 'synthetic captured native Node brand'); return data.get(node);
  };
  for (const name of ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling',
    'isConnected', 'localName', 'namespaceURI', 'style']) dom[name] = node => {
    const value = observe(name, node);
    if (name === 'nodeType') return value.type;
    if (name === 'ownerDocument') return node === h.f.document ? null : h.f.document;
    if (name === 'parentNode') return value.parent;
    if (name === 'firstChild') return value.children[0] ?? null;
    if (name === 'nextSibling') {
      const siblings = value.parent === null ? [] : data.get(value.parent).children;
      return siblings[siblings.indexOf(node) + 1] ?? null;
    }
    if (name === 'isConnected') return value.connected;
    if (name === 'localName') return value.name;
    if (name === 'namespaceURI') return 'http://www.w3.org/1999/xhtml';
    return value.style;
  };
  dom.setText = (node, value) => {
    observe('setText', node, value); data.get(node).text = value; writes.push(['text', node, value]);
  };
  dom.setStyle = (style, name, value) => {
    domCalls.push(['setStyle', style, name, value]); hooks.dom?.('setStyle', style, name, value);
    assert(styles.has(style)); styles.get(style).set(name, value); writes.push(['style', style, name, value]);
  };
  const hudDom = Object.freeze({ __proto__: null, schema: 1, document: h.f.document, dom: Object.freeze(dom),
    isCurrentDocument() { checks++; hooks.current?.(); return current; } });
  h.realm[slot] = Object.freeze({ metadata: gate.metadata, claim(id) {
    const native = gate.claim(id); hooks.native?.(native);
    return Object.freeze({ ...native, ...(group ? { hudDom: group === true ? hudDom
      : typeof group === 'function' ? group(hudDom) : group } : {}) });
  } });
  const BaseScene = h.wasm.api.AnimatedScene;
  const score = { value: -0, token: 7n };
  const scoreView = () => ({ schema: 1, enabled: true, tableMax: 17,
    own: { token: score.token, id: 7, logicalSegments: 4, fractionalMass: .5, scoreAdjustment: 3, scoreIndex: 7 },
    status: 'ready', score: score.value, error: null });
  h.wasm.api.AnimatedScene = class extends BaseScene {
    enable_score_tracking() { this.outside(); tracking++; h.wasm.calls.push('enable-score'); hooks.enable?.(); }
    advance_with_control(now, lagging, callback) {
      return super.advance_with_control(now, lagging, request => {
        hooks.step?.(request); return callback(request);
      });
    }
    score_view() {
      this.outside(); assert.equal(runtime?.diagnostics().captureHeld ?? false, false);
      scoreReads++; hooks.score?.(); return scoreView();
    }
    apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud(...args) {
      this.outside(); this.borrowed = true; h.wasm.calls.push('hud-packet');
      try {
        hooks.packet?.();
        super.apply_frame_and_render_standard_with_appearance_and_prey(...args);
        const events = []; let setupDraws = 0;
        for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
          const command = commands[commandIndex], plan = args[15];
          if (command[0] === 97) {
            setupDraws++; events.push({ commandIndex, kind: 'setup', tableMax: 17 },
              { commandIndex, kind: 'setup-draw', view: scoreView() });
          } else if (command[0] === 108 && plan.guards[commandIndex].playing) {
            events.push({ commandIndex, kind: 'leaderboard', localRow: 2, rank: command[1] ?? 7,
              population: command[2] ?? 23, deathPending: plan.guards[commandIndex].deathPending });
          } else if (plan.finalCaptureIndices.includes(commandIndex)) {
            events.push({ commandIndex, kind: 'final-score', view: scoreView() });
          } else if ([115, 104].includes(command[0])) events.push({ commandIndex, kind: 'own-length-scheduled', token: score.token });
        }
        const result = { schema: 1, commandCount: commands.length, setupDraws, events };
        hooks.report?.(result); return result;
      } finally { this.borrowed = false; }
    }
  };
  const decode = h.wasm.api.decode_frame;
  h.wasm.api.decode_frame = bytes => {
    const decoded = decode(bytes); commands = [];
    for (let i = 0; i < decoded.length;) {
      const length = decoded[i] * 16777216 + decoded[i + 1] * 65536 + decoded[i + 2] * 256 + decoded[i + 3];
      i += 4; commands.push([...decoded.slice(i, i + length)]); i += length;
    }
    return decoded;
  };
  const nodes = (scope = 'readout-and-final') => ({ __proto__: null, schema: 1, document: h.f.document, mount,
    textPolicy: 'authored', readout, final: scope === 'readout' ? null : final });
  const ownerContext = createContext({ createStockHostSnapshot, createStockSkinAdapter,
    createStockClient, createStockEntityAssets, desktopBackingSize, init: async () => {}, wasm: {},
    createStockGameplay(options) {
      gameplayOptions = options; hooks.gameplayOptions?.(options);
      actualGameplay = createStockGameplay(options);
      return Object.freeze({ ...actualGameplay, hudSnapshot() {
        snapshotReads++; hooks.snapshot?.(); return actualGameplay.hudSnapshot();
      } });
    },
    bindStockHudDom(options) {
      const binding = bindStockHudDom(options);
      hooks.constructed?.();
      return Object.freeze({ ...binding, dispose() { hooks.detach?.(); return binding.dispose(); } });
    },
    projectHudView(snapshot, ready) {
      const view = projectHudView(snapshot, ready); hooks.view?.(view); return view;
    },
  });
  const startHud = bootstrap.runInContext(ownerContext);
  return { ...h, hudHooks: hooks, hudDom, domCalls, writes, data, score, readout, final, mount, nodes,
    request: (scope = 'readout-and-final') => ({ __proto__: null, schema: 1, scope, nodes: nodes(scope) }),
    nicknameRequest: h.request,
    async start(options = {}) {
      runtime = await startHud({ realm: h.realm, wasmApi: h.wasm.api, hudReadout: true, ...options }); return runtime;
    },
    text: node => data.get(node).text, style: node => styles.get(data.get(node).style),
    current(value) { current = value; }, get checks() { return checks; }, get scoreReads() { return scoreReads; },
    get tracking() { return tracking; }, get snapshotReads() { return snapshotReads; },
    get gameplay() { return actualGameplay; }, get gameplayOptions() { return gameplayOptions; },
    ownerRecord: () => runInContext('({schema:1,scope:"readout-and-final",nodes:null})', ownerContext),
  };
}

test('explicit HUD opt-in enables tracking once and exposes only a frozen local bind ticket', async () => {
  const h = hudOwnerHarness(), runtime = await h.start();
  assert.equal(typeof runtime.bindHudReadout, 'function');
  assert.deepEqual(Object.keys(runtime), ['diagnostics', 'play', 'playWithLiveProfile', 'bindNicknameField', 'bindHudReadout', 'dispose']);
  assert.equal(h.tracking, 1); assert.equal(h.scoreReads, 0); assert.equal(h.checks, 0);
  const ticket = runtime.bindHudReadout(h.request());
  assert(Object.isFrozen(ticket)); assert.deepEqual(Object.keys(ticket), ['unbind']);
  assert.equal(h.writes.length, 0, 'missing semantic histories never become numeric zero');
  ticket.unbind(); runtime.dispose();
});

test('explicit HUD opt-in requires the optional native group while default startup stays legacy', async () => {
  const h = hudOwnerHarness({ group: false });
  await assert.rejects(h.start(), /HUD/);
  assert.equal(h.tracking, 0); assert.equal(h.f.sockets, 0);
  const legacy = hudOwnerHarness({ group: false }), runtime = await legacy.start({ hudReadout: false });
  assert.deepEqual(Object.keys(runtime), ['diagnostics', 'play', 'playWithLiveProfile', 'bindNicknameField', 'dispose']);
  assert.equal(legacy.tracking, 0); assert.equal(legacy.checks, 0); runtime.dispose();
});

test('HUD boolean rejects before gate access, claim, initialization and coercion', async () => {
  for (const value of [null, 0, '', {}, [], Promise.resolve(), new Boolean(true)]) {
    let observations = 0;
    const realm = new Proxy({}, { get() { observations++; throw new Error('gate access'); } });
    const result = await rejected(() => startGamePage({ realm, hudReadout: value,
      initialize() { observations++; } }));
    assert.equal(result.thrown, true); assert.match(result.error.message, /boolean/); assert.equal(observations, 0);
  }
});

test('default and explicit false keep exact scheduler, runtime keys and zero HUD observations', async () => {
  for (const options of [{ hudReadout: undefined }, { hudReadout: false }]) {
    const h = hudOwnerHarness(); let nativeQueue;
    h.hudHooks.native = native => { nativeQueue = native.queueMicrotask; };
    h.hudHooks.enable = () => assert.fail('default tracking');
    h.hudHooks.score = () => assert.fail('default score');
    h.hudHooks.snapshot = () => assert.fail('default HUD getter');
    h.hudHooks.current = () => assert.fail('default HUD document');
    const runtime = await h.start(options);
    assert.equal(h.gameplayOptions.defer, nativeQueue); assert(!Object.hasOwn(h.gameplayOptions, 'hudReadout'));
    assert.deepEqual(Object.keys(runtime), ['diagnostics', 'play', 'playWithLiveProfile', 'bindNicknameField', 'dispose']);
    h.f.frame(); h.route({ type: 'resize' }); h.f.flush();
    assert.equal(h.domCalls.length, 0); assert.equal(h.snapshotReads, 0); assert.equal(h.tracking, 0);
    assert.equal(runtime.diagnostics().draws, 2); runtime.dispose();
  }
});

test('true startup validates complete frozen own-data HUD group without invoking captured operations', async () => {
  const groups = [valid => Object.freeze({ __proto__: null, ...valid, schema: 2 }),
    valid => Object.freeze({ __proto__: null, ...valid, document: {} }),
    valid => Object.freeze({ __proto__: null, ...valid, dom: Object.freeze({ __proto__: null }) }),
    valid => Object.freeze({ __proto__: null, ...valid, isCurrentDocument: null }),
    valid => ({ __proto__: null, ...valid }),
    valid => Object.freeze({ __proto__: null, ...valid, dom: { __proto__: null, ...valid.dom } }),
    valid => Object.freeze({ __proto__: null, ...valid, extra: true }), valid => Object.freeze(Object.create(valid)),
    valid => Object.freeze(Object.defineProperty({ __proto__: null, ...valid }, 'dom', { get() { assert.fail('group getter'); } }))];
  for (const group of groups) {
    const h = hudOwnerHarness({ group }); let initialized = 0;
    const result = await rejected(() => h.start({ initialize() { initialized++; } }));
    assert.equal(result.thrown, true); assert.match(result.error.message, /HUD/);
    assert.equal(initialized, 0); assert.equal(h.tracking, 0); assert.equal(h.f.raf.size, 0);
    assert.deepEqual(h.wasm.counts(), { sceneFrees: 0, qualityFrees: 0, stepFrees: 0 });
  }
});

test('true startup preserves exact score-enable primaries and dispose-only startup shape', async () => {
  for (const primary of cleanupPrimaries) {
    const h = hudOwnerHarness(); h.hudHooks.enable = () => { throw primary; };
    h.failures.set('scene.free', new Error('secondary')); h.failures.set('status:csp-or-module-unavailable', false);
    const result = await rejected(() => h.start());
    assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    assert.deepEqual(h.wasm.calls, ['scene', 'enable-nicknames', 'enable-score']);
    assert.deepEqual(h.wasm.counts(), { sceneFrees: 1, qualityFrees: 0, stepFrees: 0 });
  }
  const h = hudOwnerHarness();
  const runtime = await h.start({ initialize() { h.pagehide(); } });
  assert.deepEqual(Object.keys(runtime), ['dispose']); assert.equal(h.tracking, 0);
});

test('HUD owner admits exactly three current-realm own data fields and never reads then or coerces', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(); let getters = 0;
  const base = h.request();
  const bad = [null, [], Promise.resolve(), Object.create(base), { ...base },
    { __proto__: null, ...base, extra: 1 }, { __proto__: null, ...base, [Symbol('extra')]: 1 },
    { __proto__: null, ...base, schema: '1' }, { __proto__: null, ...base, scope: { toString() { getters++; } } },
    Object.defineProperty(h.request(), 'nodes', { get() { getters++; } }),
    { __proto__: null, ...base, nodes: { __proto__: null, ...h.nodes(), document: {} } },
    { __proto__: null, ...base, nodes: { __proto__: null, ...h.nodes(), extra: true } },
    { __proto__: null, ...base, nodes: { __proto__: null, ...h.nodes(), textPolicy: 'fallback' } }];
  for (const request of bad) assert.throws(() => runtime.bindHudReadout(request));
  assert.equal(getters, 0); assert.equal(h.checks, 0); assert.equal(h.writes.length, 0);
  const request = h.request(); Object.freeze(request);
  Object.defineProperty(h.readout.root, 'toString', { value() { assert.fail('node coercion'); } });
  const ticket = runtime.bindHudReadout(request); ticket.unbind();
  assert.equal(runtime.diagnostics().disposed, false); runtime.dispose();
});

test('HUD binding copies exact nodes and readonly identities, renders only genuine committed per-role history', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(), views = [];
  h.hudHooks.view = view => { views.push(view); assert(Object.isFrozen(view)); };
  const request = h.request(), ticket = runtime.bindHudReadout(request);
  const first = views.at(-1);
  assert.equal(first.current.value, null); assert.equal(first.final.value, null); assert.equal(first.readiness, 'pending');
  assert.equal(first.sceneIdentity, h.gameplay.hudSnapshot().sceneIdentity);
  assert.equal(typeof first.documentIdentity, 'symbol');
  const originalValue = h.readout.lengthValue.text;
  request.nodes.readout = null; request.nodes.document = {}; request.scope = 'readout';
  connect(h.f, runtime); h.f.socket.message([108, 7, 23]); h.f.flush();
  assert.equal(h.text(originalValue), 'keep-length', 'header alone is not displayed current history');
  h.f.frame();
  assert.equal(h.text(originalValue), '0'); assert.equal(h.text(h.readout.rankValue.text), '7');
  assert.equal(h.text(h.final.value.text), 'keep-final');
  assert(Object.is(views.at(-1).current.value.score, -0)); assert.equal(views.at(-1).final.reason, 'no-captured-final');
  assert.equal(views.at(-1).bindingIdentity, first.bindingIdentity);
  assert.equal(views.at(-1).documentIdentity, first.documentIdentity);
  assert.equal(views.at(-1).sceneIdentity, first.sceneIdentity);
  const displayed = h.gameplay.hudSnapshot().current;
  h.f.socket.message([108, 3, 40]); h.f.flush();
  assert.deepEqual(h.gameplay.hudSnapshot().current, displayed);
  assert.equal(h.text(h.readout.rankValue.text), '7', 'new header does not replace displayed history');
  h.score.value = 1001; h.f.socket.message([118, 1]); h.f.flush();
  assert.equal(h.text(h.final.value.text), '1001!'); assert.equal(h.text(originalValue), '0');
  assert.equal(h.style(h.final.root).has('opacity'), false);
  assert.equal(h.text(h.readout.lengthLabel.text), 'AUTHORED LENGTH');
  assert.equal(h.text(h.final.label.text), 'AUTHORED FINAL');
  const calls = h.domCalls.length, writes = h.writes.length;
  ticket.unbind(); ticket.unbind();
  assert.equal(h.domCalls.length, calls); assert.equal(h.writes.length, writes, 'dispose releases references without DOM effects');
  const next = runtime.bindHudReadout(h.request());
  assert.notEqual(views.at(-1).bindingIdentity, first.bindingIdentity);
  assert.equal(h.text(h.final.value.text), '1001!', 'later binding reuses genuine history without score read');
  ticket.unbind(); assert.throws(() => runtime.bindHudReadout(h.request()), /already bound/);
  next.unbind(); runtime.dispose();
});

test('frame and resize publish after release with one draw, one committed getter, before RAF reschedule', async () => {
  const h = hudOwnerHarness(), runtime = await h.start();
  runtime.bindHudReadout(h.request('readout')); connect(h.f, runtime); h.f.socket.message([108, 7, 23]); h.f.flush();
  let checks = 0, expectedRaf;
  h.hudHooks.current = () => {
    checks++; assert.equal(runtime.diagnostics().captureHeld, false); assert.equal(h.f.raf.size, expectedRaf);
  };
  const draws = runtime.diagnostics().draws, reads = h.snapshotReads, control = h.wasm.controlReads();
  expectedRaf = 0; h.f.frame();
  assert(checks > 0); assert.equal(runtime.diagnostics().draws, draws + 1); assert.equal(h.snapshotReads, reads + 1);
  assert.equal(h.wasm.controlReads(), control + 1); assert.equal(h.f.raf.size, 1);
  expectedRaf = 1;
  h.score.value = -41; h.f.socket.message([104]); h.f.flush();
  const resizeDraws = runtime.diagnostics().draws, resizeReads = h.snapshotReads;
  const steps = h.wasm.calls.filter(call => Array.isArray(call) && call[0] === 'advance').length;
  h.route({ type: 'resize' });
  assert.equal(runtime.diagnostics().draws, resizeDraws + 1); assert.equal(h.snapshotReads, resizeReads + 1);
  assert.equal(h.wasm.calls.filter(call => Array.isArray(call) && call[0] === 'advance').length, steps);
  assert.equal(h.text(h.readout.lengthValue.text), '-41'); runtime.dispose();
});

test('existing deferred reconciliation publishes only changed nonnull identity with two getters and one callback', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(); runtime.bindHudReadout(h.request());
  connect(h.f, runtime); let callbacks = 0;
  let reads = h.snapshotReads, checks = h.checks;
  h.gameplayOptions.defer(() => { callbacks++; }); h.f.flush();
  assert.equal(callbacks, 1); assert.equal(h.snapshotReads - reads, 2); assert.equal(h.checks, checks);
  reads = h.snapshotReads;
  h.f.socket.message([108, 7, 23]);
  assert.equal(h.snapshotReads, reads); assert.equal(h.checks, checks, 'no ingress/native publication');
  h.f.flush();
  assert.equal(h.snapshotReads - reads, 2); assert(h.checks > checks);
  const state = h.gameplay.hudSnapshot(), writes = h.writes.length;
  assert(state !== null);
  h.failures.set('status:connected', new Error('caught reconciliation failure'));
  h.f.socket.message([108, 3, 29]);
  const before = h.checks; h.f.flush();
  assert.equal(h.checks, before); assert.equal(h.writes.length, writes, 'old nonnull state is never republished');
  assert.equal(runtime.diagnostics().disposed, true);
});

test('HUD publication performs no source/control/score/status reads and passive notifications do not publish', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(); connect(h.f, runtime);
  h.f.socket.message([108, 7, 23]); h.f.flush(); h.f.frame();
  const scores = h.scoreReads, controls = h.wasm.controlReads();
  const original = Object.getOwnPropertyDescriptor(h.realm, 'per_color_imgs');
  Object.defineProperty(h.realm, 'per_color_imgs', { configurable: true, get() { assert.fail('source recapture'); } });
  h.hudHooks.score = () => assert.fail('score read during bind');
  const trace = [...h.trace], ticket = runtime.bindHudReadout(h.request());
  assert.equal(h.scoreReads, scores); assert.equal(h.wasm.controlReads(), controls); assert.deepEqual(h.trace, trace);
  Object.defineProperty(h.realm, 'per_color_imgs', original); delete h.hudHooks.score;
  const checks = h.checks;
  for (const type of ['input', 'compositionstart', 'focus', 'selectionchange', 'beforeinput']) h.route({ type });
  assert.equal(h.checks, checks); assert.equal(h.wasm.controlReads(), controls);
  ticket.unbind(); h.f.frame(); assert.equal(h.checks, checks); runtime.dispose();
});

test('stale and pending HUD groups perform no DOM effects and occupied slots require explicit unbind', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(); connect(h.f, runtime);
  h.f.socket.message([108, 7, 23]); h.f.flush(); h.f.frame(); h.current(false);
  const calls = h.domCalls.length, ticket = runtime.bindHudReadout(h.request());
  assert.equal(h.domCalls.length, calls); assert.equal(h.writes.length, 0);
  assert.throws(() => runtime.bindHudReadout(h.request()), /already bound/);
  h.f.frame(); assert.equal(h.domCalls.length, calls); ticket.unbind();
  h.current(true);
  const pending = h.request(); pending.nodes.textPolicy = 'unselected';
  const old = runtime.bindHudReadout(pending); assert.equal(h.writes.length, 0); old.unbind();
  const next = runtime.bindHudReadout(h.request()); const writes = h.writes.length; assert(writes > 0);
  h.hudHooks.current = () => { old.unbind(); };
  h.f.frame(); assert.equal(runtime.diagnostics().disposed, false); assert(h.writes.length > writes);
  next.unbind(); runtime.dispose();
});

test('HUD request and deep node reflection preserve every falsy primary and release local candidates only', async () => {
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) for (const primary of cleanupPrimaries) {
    const h = hudOwnerHarness(), runtime = await h.start();
    const result = caught(() => runtime.bindHudReadout(new Proxy(h.request(), { [trap]() { throw primary; } })));
    assert.equal(result.thrown, true); assert(Object.is(result.error, primary));
    assert.equal(h.checks, 0); assert.equal(h.wasm.counts().sceneFrees, 0);
    const deep = h.request(); deep.nodes.readout = new Proxy(h.readout, { [trap]() { throw primary; } });
    const nested = caught(() => runtime.bindHudReadout(deep));
    assert.equal(nested.thrown, true); assert(Object.is(nested.error, primary));
    assert.equal(h.checks, 0); assert.equal(h.writes.length, 0); assert.equal(runtime.diagnostics().disposed, false);
    runtime.bindHudReadout(h.request()).unbind(); runtime.dispose();
  }
});

test('caught HUD bind reflection cross-owner violations remain sticky without native effects', async () => {
  for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
    for (const action of ['hud-bind', 'nickname-bind', 'nickname-unbind', 'play', 'live-play', 'dispose', 'router']) {
      const h = hudOwnerHarness(), runtime = await h.start(), nickname = runtime.bindNicknameField(h.nicknameRequest());
      let first, entered = false;
      const actions = { 'hud-bind': () => runtime.bindHudReadout(h.request()),
        'nickname-bind': () => runtime.bindNicknameField(h.nicknameRequest()), 'nickname-unbind': nickname.unbind,
        play: () => runtime.play(playRequest()), 'live-play': () => runtime.playWithLiveProfile(playRequest()),
        dispose: runtime.dispose, router: () => h.route({ type: 'keydown', code: 'ArrowLeft' }) };
      const before = { calls: [...h.wasm.calls], controls: h.wasm.controlReads(), trace: [...h.trace] };
      const request = new Proxy(h.request(), { [trap](...args) {
        if (!entered) { entered = true; first = caught(actions[action]); assert(first.thrown); }
        return Reflect[trap](...args);
      } });
      const result = caught(() => runtime.bindHudReadout(request));
      assert(result.thrown); assert.equal(result.error, first.error); assert.equal(h.checks, 0); assert.equal(h.writes.length, 0);
      assert.deepEqual({ calls: h.wasm.calls, controls: h.wasm.controlReads(), trace: h.trace }, before);
      assert.equal(h.wasm.counts().sceneFrees, 0); assert.equal(runtime.diagnostics().disposed, false);
      runtime.bindHudReadout(h.request()).unbind(); nickname.unbind(); runtime.dispose();
    }
  }
});

test('nickname registration, delivery and explicit detach fence HUD reentry without freeing native owners', async () => {
  for (const stage of ['afterRegister', 'handle', 'unregister']) {
    const h = hudOwnerHarness(), runtime = await h.start(); let first;
    h.hooks[stage] = () => { first = caught(() => runtime.bindHudReadout(h.request())); assert(first.thrown); };
    if (stage === 'afterRegister') {
      const result = caught(() => runtime.bindNicknameField(h.nicknameRequest()));
      assert(result.thrown); assert.equal(result.error, first.error);
      assert.equal(h.ownerTrace.filter(item => item === 'unregister').length, 1);
    } else {
      const nickname = runtime.bindNicknameField(h.nicknameRequest());
      const result = caught(stage === 'handle' ? () => h.input() : nickname.unbind);
      assert(result.thrown); assert.equal(result.error, first.error);
      assert.equal(h.ownerTrace.filter(item => item === 'unregister').length, 1);
      nickname.unbind();
    }
    assert.equal(h.checks, 0); assert.equal(h.wasm.counts().sceneFrees, 0); assert.equal(runtime.diagnostics().disposed, false);
    h.hooks[stage] = undefined; runtime.bindHudReadout(h.request()).unbind(); runtime.dispose();
  }
  const h = hudOwnerHarness(), runtime = await h.start(), hud = runtime.bindHudReadout(h.request());
  const nickname = runtime.bindNicknameField(h.nicknameRequest()); let first;
  h.hooks.handle = () => { first = caught(hud.unbind); };
  const result = caught(() => h.input()); assert(result.thrown); assert.equal(result.error, first.error);
  assert.throws(() => runtime.bindHudReadout(h.request()), /already bound/);
  assert.equal(runtime.diagnostics().disposed, false); h.hooks.handle = undefined;
  hud.unbind(); nickname.unbind(); runtime.dispose();
});

test('explicit HUD unbind clears slot and method references before dispose and rejects caught cleanup reentry', async () => {
  for (const action of ['bind', 'nickname', 'play', 'dispose', 'router']) {
    const h = hudOwnerHarness(), runtime = await h.start(), ticket = runtime.bindHudReadout(h.request()); let first, calls = 0;
    const actions = { bind: () => runtime.bindHudReadout(h.request()), nickname: () => runtime.bindNicknameField(h.nicknameRequest()),
      play: () => runtime.play(playRequest()), dispose: runtime.dispose, router: () => h.route({ type: 'resize' }) };
    h.hudHooks.detach = () => {
      calls++; assert.equal(ticket.unbind(), undefined); first = caught(actions[action]); assert(first.thrown);
    };
    const result = caught(ticket.unbind); assert(result.thrown); assert.equal(result.error, first.error);
    assert.equal(calls, 1); assert.equal(ticket.unbind(), undefined); assert.equal(calls, 1);
    assert.equal(runtime.diagnostics().disposed, false); assert.equal(h.wasm.counts().sceneFrees, 0);
    h.hudHooks.detach = undefined; runtime.bindHudReadout(h.request()).unbind(); runtime.dispose();
  }
});

test('publication rejects caught owner/router/native reentry and cleans up only after source/native stacks return', async () => {
  for (const stage of ['current', 'nodeType', 'setText']) {
    for (const action of ['hud-bind', 'hud-unbind', 'nickname-bind', 'nickname-unbind', 'play', 'live-play', 'dispose', 'router', 'reload']) {
      const h = hudOwnerHarness(), runtime = await h.start(), hud = runtime.bindHudReadout(h.request());
      const nickname = runtime.bindNicknameField(h.nicknameRequest()); connect(h.f, runtime);
      h.f.socket.message([108, 7, 23]); h.f.flush(); h.f.frame();
      let first, entered = false;
      const actions = { 'hud-bind': () => runtime.bindHudReadout(h.request()), 'hud-unbind': hud.unbind,
        'nickname-bind': () => runtime.bindNicknameField(h.nicknameRequest()), 'nickname-unbind': nickname.unbind,
        play: () => runtime.play(playRequest()), 'live-play': () => runtime.playWithLiveProfile(playRequest()), dispose: runtime.dispose,
        router: () => h.route({ type: 'keydown', code: 'ArrowLeft' }),
        reload: () => h.route({ type: 'click', target: h.f.document.getElementById('slither-client-reload') }) };
      const reenter = () => {
        if (entered) return; entered = true; first = caught(actions[action]); assert(first.thrown);
        assert.equal(h.wasm.counts().sceneFrees, 0); assert.equal(runtime.diagnostics().captureHeld, false);
      };
      if (stage === 'current') h.hudHooks.current = reenter;
      else h.hudHooks.dom = name => { if (name === stage) reenter(); };
      h.failures.set('quality.free', new Error('secondary cleanup'));
      h.inspect(current => { if (current === 'scene.free') assert.equal(runtime.diagnostics().captureHeld, false); });
      const result = caught(() => h.f.frame());
      assert(entered, `${stage}/${action}`); assert(result.thrown); assert.equal(result.error, first.error);
      assert.equal(runtime.diagnostics().disposed, true); assert.equal(h.wasm.counts().sceneFrees, 1);
      assert.equal(h.wasm.counts().qualityFrees, 1); assert.equal(h.f.reloads, 0);
      assert.equal(hud.unbind(), undefined); assert.equal(nickname.unbind(), undefined);
    }
  }
});

test('held packet/native controller operations reject caught bind/unbind/disposal reentry until release', async () => {
  for (const stage of ['packet', 'render', 'control']) for (const action of ['hud-bind', 'hud-unbind', 'nickname-bind', 'nickname-unbind', 'dispose']) {
    const h = hudOwnerHarness(), runtime = await h.start(), hud = runtime.bindHudReadout(h.request());
    const nickname = runtime.bindNicknameField(h.nicknameRequest()); connect(h.f, runtime);
    let first, entered = false;
    const actions = { 'hud-bind': () => runtime.bindHudReadout(h.request()), 'hud-unbind': hud.unbind,
      'nickname-bind': () => runtime.bindNicknameField(h.nicknameRequest()), 'nickname-unbind': nickname.unbind, dispose: runtime.dispose };
    const reenter = () => {
      if (entered) return; entered = true; first = caught(actions[action]); assert(first.thrown);
      assert.equal(h.wasm.counts().sceneFrees, 0);
      if (stage !== 'control') assert.equal(runtime.diagnostics().captureHeld, true);
    };
    if (stage === 'packet') h.hudHooks.packet = reenter;
    else h.f.faults[stage === 'render' ? 'renderOperation' : 'control'] = reenter;
    if (stage === 'packet') { h.f.socket.message([104]); assert.equal(h.wasm.counts().sceneFrees, 0); h.f.flush(); }
    else h.f.frame();
    assert(entered); assert.equal(runtime.diagnostics().disposed, true); assert.equal(runtime.diagnostics().captureHeld, false);
    assert.equal(h.wasm.counts().sceneFrees, 1); assert.equal(h.wasm.counts().qualityFrees, 1);
    assert.equal(hud.unbind(), undefined); assert.equal(nickname.unbind(), undefined);
  }
});

test('late HUD publication failure preserves exact primaries after partial writes and exhausts nickname-first cleanup', async () => {
  for (const seam of ['bind', 'frame', 'defer']) for (const primary of cleanupPrimaries) {
    const h = hudOwnerHarness(), runtime = await h.start(); connect(h.f, runtime);
    h.f.socket.message([108, 7, 23]); h.f.flush(); h.f.frame();
    let hud;
    if (seam !== 'bind') hud = runtime.bindHudReadout(h.request());
    const nickname = runtime.bindNicknameField(h.nicknameRequest()), order = [];
    h.resetTrace(); let setters = 0;
    h.hudHooks.dom = name => { if (name === 'setText' && ++setters === 2) throw primary; };
    h.hooks.unregister = () => { order.push('nickname'); throw new Error('secondary nickname'); };
    h.hudHooks.detach = () => { order.push('hud'); assert.equal(hud?.unbind(), undefined); };
    h.inspect(stage => {
      order.push(stage);
      if (stage === 'scene.free') { assert.equal(runtime.diagnostics().captureHeld, false); assert.equal(runtime.diagnostics().stopped, true); }
    });
    for (const stage of ['cancel', 'scene.free', 'quality.free', 'status:client-failed']) h.failures.set(stage, new Error(`secondary ${stage}`));
    const before = h.writes.length;
    let result;
    if (seam === 'bind') result = caught(() => runtime.bindHudReadout(h.request()));
    else if (seam === 'frame') result = caught(() => h.f.frame());
    else { h.f.socket.message([108, 3, 29]); result = caught(() => h.f.flush()); }
    assert(result.thrown); assert(Object.is(result.error, primary)); assert.equal(h.writes.length, before + 1);
    assert.deepEqual(order, [...(seam === 'defer' ? ['status:connected'] : []), 'nickname', 'hud',
      ...(seam === 'frame' ? cleanupStages.filter(stage => stage !== 'cancel') : cleanupStages), 'status:client-failed']);
    assert.equal(runtime.diagnostics().disposed, true); assert.equal(h.wasm.counts().sceneFrees, 1); assert.equal(h.wasm.counts().qualityFrees, 1);
    const after = h.writes.length; nickname.unbind(); hud?.unbind(); runtime.dispose(); h.f.flush(); assert.equal(h.writes.length, after);
  }
});

test('throwing existing deferred callback runs once, takes no after snapshot and preserves its primary through fail', async () => {
  for (const primary of cleanupPrimaries) {
    const h = hudOwnerHarness(), runtime = await h.start(); runtime.bindHudReadout(h.request());
    let callbacks = 0; const reads = h.snapshotReads, calls = h.domCalls.length;
    h.failures.set('quality.free', new Error('secondary'));
    h.gameplayOptions.defer(() => { callbacks++; throw primary; });
    const result = caught(() => h.f.flush()); assert(result.thrown); assert(Object.is(result.error, primary));
    assert.equal(callbacks, 1); assert.equal(h.snapshotReads - reads, 1); assert.equal(h.domCalls.length, calls);
    assert.equal(runtime.diagnostics().disposed, true); assert.equal(h.wasm.counts().sceneFrees, 1);
  }
});

test('genuine lifecycle completion publishes raw minus-one requests while final and displayed histories persist', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(), views = []; h.hudHooks.view = view => views.push(view);
  const ticket = runtime.bindHudReadout(h.request()); connect(h.f, runtime); h.f.socket.message([108, 7, 23]); h.f.flush(); h.f.frame();
  h.f.interval(600); h.score.value = -41; h.f.socket.message([118, 1]); h.f.flush();
  h.hudHooks.step = request => { request.delta = 5; };
  for (let count = 0; h.gameplay.hudSnapshot().fade !== -1 && count < 55; count++) h.f.frame(2300 + count * 8);
  assert.equal(h.gameplay.hudSnapshot().fade, -1); assert.equal(views.at(-1).requestedOpacity.readout, -1);
  assert.equal(views.at(-1).requestedOpacity.header, -.85); assert.equal(h.style(h.readout.root).get('opacity'), '-1');
  assert.equal(h.style(h.final.root).has('opacity'), false); assert.equal(h.text(h.final.value.text), '-41');
  assert.equal(h.text(h.readout.lengthValue.text), '0');
  const history = h.gameplay.hudSnapshot(), reads = h.scoreReads;
  ticket.unbind(); runtime.bindHudReadout(h.request());
  assert.deepEqual(h.gameplay.hudSnapshot().current, history.current); assert.deepEqual(h.gameplay.hudSnapshot().final, history.final);
  assert.equal(h.scoreReads, reads); assert.equal(h.text(h.final.value.text), '-41'); runtime.dispose();
});

test('HUD owner accepts its ordinary current realm request and freezes only the ticket', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(), request = h.ownerRecord(); request.nodes = h.nodes();
  const ticket = runtime.bindHudReadout(request);
  assert(Object.isFrozen(runtime)); assert(Object.isFrozen(ticket)); assert(!Object.isFrozen(request));
  assert(!Object.isFrozen(h.mount)); assert.equal(ticket.unbind.call({}), undefined); runtime.dispose();
});

test('each missing or accessor HUD capture fails selected startup without calling it or initializing', async () => {
  const names = Object.keys(hudOwnerHarness().hudDom.dom);
  for (const name of names) for (const getter of [false, true]) {
    const h = hudOwnerHarness({ group(valid) {
      const dom = { __proto__: null, ...valid.dom };
      if (getter) Object.defineProperty(dom, name, { get() { assert.fail('capability getter'); } });
      else delete dom[name];
      return Object.freeze({ __proto__: null, ...valid, dom: Object.freeze(dom) });
    } });
    let initialized = false;
    const result = await rejected(() => h.start({ initialize() { initialized = true; } }));
    assert(result.thrown); assert.match(result.error.message, /HUD/); assert.equal(initialized, false);
    assert.equal(h.tracking, 0); assert.equal(h.domCalls.length, 0);
  }
});

test('only existing final history renders while current is pending; scope exclusion and wide scores stay exact', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(), views = []; h.hudHooks.view = view => views.push(view);
  connect(h.f, runtime); h.score.value = 4294967305; h.f.socket.message([118, 1]); h.f.flush();
  const ticket = runtime.bindHudReadout(h.request());
  assert.equal(views.at(-1).readiness, 'pending'); assert.equal(views.at(-1).current.value, null);
  assert.equal(views.at(-1).final.readiness, 'ready'); assert.equal(h.text(h.final.value.text), '4294967305!');
  assert.equal(h.text(h.readout.lengthValue.text), 'keep-length'); ticket.unbind();
  const writes = h.writes.length; runtime.bindHudReadout(h.request('readout'));
  assert.equal(views.at(-1).final.reason, 'scope-excluded'); assert.equal(h.writes.length, writes); runtime.dispose();
});

test('native HUD freshness nonbooleans reject without then inspection or DOM observations', async () => {
  for (const value of [undefined, null, 0, 1, Promise.resolve(), Object.defineProperty({}, 'then', {
    get() { assert.fail('freshness then inspection'); } })]) {
    const h = hudOwnerHarness(), runtime = await h.start(); h.current(value);
    const result = caught(() => runtime.bindHudReadout(h.request()));
    assert(result.thrown); assert.equal(h.domCalls.length, 0); assert.equal(h.writes.length, 0);
    assert.equal(runtime.diagnostics().disposed, true); assert.equal(h.wasm.counts().sceneFrees, 1);
  }
});

test('HUD disposal exhausts cleanup after HUD release failure and retains earlier nickname failure by presence', async () => {
  for (const primary of cleanupPrimaries) for (const first of ['nickname', 'hud']) {
    const h = hudOwnerHarness(), runtime = await h.start(), hud = runtime.bindHudReadout(h.request());
    const nickname = runtime.bindNicknameField(h.nicknameRequest()); connect(h.f, runtime); h.resetTrace(); const order = [];
    h.hooks.unregister = () => {
      order.push('nickname'); assert.equal(nickname.unbind(), undefined);
      if (first === 'nickname') throw primary;
    };
    h.hudHooks.detach = () => {
      order.push('hud'); assert.equal(hud.unbind(), undefined);
      throw first === 'hud' ? primary : new Error('secondary HUD');
    };
    h.inspect(stage => {
      order.push(stage); assert.equal(hud.unbind(), undefined); assert.equal(nickname.unbind(), undefined);
      assert.equal(runtime.dispose(), undefined);
      assert(caught(() => runtime.bindHudReadout(h.request())).thrown);
      assert(caught(() => runtime.bindNicknameField(h.nicknameRequest())).thrown);
    });
    h.failures.set('cancel', new Error('secondary cancel')); h.failures.set('status:client-failed', new Error('secondary status'));
    const result = caught(runtime.dispose); assert(result.thrown); assert(Object.is(result.error, primary));
    assert.deepEqual(order, ['nickname', 'hud', ...cleanupStages, 'status:client-failed']);
    assert.equal(h.wasm.counts().sceneFrees, 1); assert.equal(h.wasm.counts().qualityFrees, 1);
    const before = [...order]; runtime.dispose(); hud.unbind(); nickname.unbind(); assert.deepEqual(order, before);
  }
});

test('caught final construction reentry disposes the unpublished HUD binding without active native cleanup', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(); let first, detaches = 0;
  h.hudHooks.constructed = () => { first = caught(() => runtime.bindNicknameField(h.nicknameRequest())); assert(first.thrown); };
  h.hudHooks.detach = () => { detaches++; };
  const result = caught(() => runtime.bindHudReadout(h.request())); assert(result.thrown); assert.equal(result.error, first.error);
  assert.equal(detaches, 1); assert.equal(h.domCalls.length, 0); assert.equal(h.wasm.counts().sceneFrees, 0);
  assert.equal(runtime.diagnostics().disposed, false); delete h.hudHooks.constructed;
  runtime.bindHudReadout(h.request()).unbind(); runtime.dispose();
});

test('selected startup requires scene score enable and score observation before exposing the runtime', async () => {
  for (const name of ['enable_score_tracking', 'score_view']) {
    const h = hudOwnerHarness(); delete h.wasm.api.AnimatedScene.prototype[name];
    const result = await rejected(() => h.start()); assert(result.thrown);
    assert.equal(h.wasm.counts().sceneFrees, 1); assert.equal(h.f.raf.size, 0); assert.equal(h.f.sockets, 0);
    assert.equal(h.tracking, name === 'enable_score_tracking' ? 0 : 1);
  }
});

test('caught HUD reentry during existing UI reconciliation status is deferred to cleanup without publication', async () => {
  const h = hudOwnerHarness(), runtime = await h.start(), hud = runtime.bindHudReadout(h.request()); connect(h.f, runtime);
  let first, entered = false; const calls = h.domCalls.length;
  h.reenter(stage => {
    if (stage !== 'status:connected' || entered) return;
    entered = true; first = caught(hud.unbind); assert(first.thrown); assert.equal(h.wasm.counts().sceneFrees, 0);
  });
  h.f.interval(25); assert(entered); assert.equal(h.domCalls.length, calls);
  assert.equal(runtime.diagnostics().disposed, false); h.f.flush();
  assert.equal(runtime.diagnostics().disposed, true); assert.equal(h.wasm.counts().sceneFrees, 1);
  assert.equal(h.domCalls.length, calls); hud.unbind();
});

// Isolated owner composition with the actual gate and authored native-operation doubles.
// Full unchanged ESM graph coverage is in game-entry.test.mjs.
test('actual captured native HUD group composes with explicit bootstrap in the same document realm',
  async () => {
    const f = fixture({ hudNative: true }); f.host(); f.complete();
    const nativeDom = f.edit.hud, wasm = wasmDouble(f), BaseScene = wasm.api.AnimatedScene;
    let enabled = 0, opcode, reads = 0;
    const scoreView = () => ({ schema: 1, enabled: true, tableMax: 17,
      own: { token: 7n, id: 7, logicalSegments: 4, fractionalMass: .5, scoreAdjustment: 3, scoreIndex: 7 },
      status: 'ready', score: -0, error: null });
    wasm.api.AnimatedScene = class extends BaseScene {
      enable_score_tracking() { enabled++; }
      score_view() { this.outside(); reads++; return scoreView(); }
      apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud(...args) {
        this.outside(); this.borrowed = true;
        try {
          super.apply_frame_and_render_standard_with_appearance_and_prey(...args);
          const events = opcode === 97 ? [{ commandIndex: 0, kind: 'setup', tableMax: 17 },
            { commandIndex: 0, kind: 'setup-draw', view: scoreView() }]
            : opcode === 108 ? [{ commandIndex: 0, kind: 'leaderboard', localRow: 2, rank: 7, population: 23,
              deathPending: args[15].guards[0].deathPending }] : [];
          return { schema: 1, commandCount: 1, setupDraws: opcode === 97 ? 1 : 0, events };
        } finally { this.borrowed = false; }
      }
    };
    const decode = wasm.api.decode_frame;
    wasm.api.decode_frame = bytes => { opcode = bytes[0]; return decode(bytes); };
    Object.assign(f.context, { createStockHostSnapshot, createStockSkinAdapter, createStockClient, createStockEntityAssets,
      desktopBackingSize, createStockGameplay, bindStockHudDom, projectHudView, init: async () => {}, wasm: {} });
    // Keep the actual initializer in the gate's current realm; this explicitly selected path does not auto-enter.
    const explicit = bootstrap.runInContext(f.context);
    const runtime = await explicit({ wasmApi: wasm.api, hudReadout: true });
    assert.equal(enabled, 1); assert.equal(f.sockets, 0);
    const element = name => new nativeDom.HTMLElement(name);
    const atom = (name, text) => {
      const value = { element: element(name), text: new nativeDom.CharacterData(text) };
      value.element.appendChild(value.text); return value;
    };
    const mount = element('section'); f.document.body.appendChild(mount);
    const readout = { root: element('div'), lengthLine: element('div'), rankLine: element('div'),
      lengthLabel: atom('span', 'AUTHORED LENGTH'), lengthValue: atom('b', 'keep-length'),
      rankLabel: atom('span', 'AUTHORED RANK'), rankValue: atom('span', 'keep-rank'),
      separator: atom('span', 'AUTHORED /'), populationValue: atom('span', 'keep-population') };
    mount.appendChild(readout.root); readout.root.appendChild(readout.lengthLine); readout.root.appendChild(readout.rankLine);
    for (const name of ['lengthLabel', 'lengthValue']) readout.lengthLine.appendChild(readout[name].element);
    for (const name of ['rankLabel', 'rankValue', 'separator', 'populationValue']) readout.rankLine.appendChild(readout[name].element);
    const request = { __proto__: null, schema: 1, scope: 'readout', nodes: { __proto__: null, schema: 1,
      document: f.document, mount, textPolicy: 'authored', readout, final: null } };
    const ticket = runtime.bindHudReadout(request); assert.equal(reads, 0);
    assert(nativeDom.trace.some(([name]) => name === 'nodeType'));
    connect(f, runtime); f.socket.message([108, 7, 23]); f.flush(); f.frame();
    assert.equal(nativeDom.character(readout.lengthValue.text).data, '0');
    assert.equal(nativeDom.character(readout.rankValue.text).data, '7');
    assert.equal(nativeDom.character(readout.populationValue.text).data, '23');
    assert.equal(nativeDom.character(readout.lengthLabel.text).data, 'AUTHORED LENGTH');
    const styles = nativeDom.style(Object.getOwnPropertyDescriptor(nativeDom.HTMLElement.prototype, 'style').get.call(readout.root));
    assert.equal(styles.get('font-size'), '12px');
    const nativeCalls = nativeDom.trace.length; f.realm.location.href = 'https://slither.io/#synthetic-stale';
    f.frame(); assert.equal(nativeDom.trace.length, nativeCalls, 'captured freshness blocks every later DOM operation');
    assert.throws(() => runtime.bindHudReadout(request), /already bound/);
    ticket.unbind(); runtime.dispose(); assert.equal(wasm.counts().sceneFrees, 1);
    assert.equal(wasm.counts().qualityFrees, 1); assert.equal(f.original, 0);
  });

// Actual gate-to-snapshot-to-adapter/controller composition; inert native/scene
// doubles only. The ABI policy double below is separate from native Rust tests.
test('ready cached accessory composes native load commitment with appearance-forward and controller mode', async () => {
  const f = fixture({ accessoryNative: true }); f.host(); f.complete();
  const native = f.gate.claim(f.gate.metadata().id);
  assert(native.accessorySource);
  const source = new f.realm.HTMLImageElement();
  let resolve; f.imageState(source).decode = new Promise(done => { resolve = done; });
  f.realm.a_ct = 1;
  f.realm.a_imgs = [{ loaded: true, img: source, ww: 40, hh: 40, sc: .25, px: 3, py: 7 }];
  f.realm.localStorage.setItem('cosmetic', '0');
  const reader = createStockHostSnapshot({ realm: f.realm, observer: native,
    readAccessory: native.readAccessory, accessorySource: native.accessorySource,
    resolveAccessoryId(raw, count) { assert.equal(raw, '0'); assert.equal(count, 1); return 0; } });
  assert.throws(() => reader.capture(), error => error.status === 'pending');
  resolve(); await Promise.resolve();
  const snapshot = reader.capture();
  assert.equal(snapshot.appearanceMode, 'accessory');
  assert.equal(snapshot.ownAccessory, 0);
  assert.equal(snapshot.ownCachedAccessorySelection.source, source);
  assert.equal('forward' in snapshot.ownCachedAccessorySelection.geometry, false);
  const revision = snapshot.readiness.find(entry => entry.source === source).revision;
  assert(revision.startsWith('trusted-accessory-load/'));
  let held, rendered = 0;
  const adapter = createStockSkinAdapter({ ...stockSkinPolicyDouble, realm: f.realm, appearanceMode: 'accessory',
    readSnapshot() { held = reader.capture(); return held; }, random: () => .25,
    resolveAccessoryForward(skin) { return skin === 41 ? 34 : 6; } });
  const request = { skin: 41, own: true, id: 7, cosmetic: 255, customBytes: new Uint8Array() };
  const scene = { advance() { return { free() {} }; }, set_gaze_heading() {},
    apply_frame_and_render_standard_with_accessory_presentation_and_prey(...args) {
      assert.equal(args[2](request).accessory.forward, 34);
      const recipe = args[12](request).recipe;
      assert.equal(recipe.attachment.forward, 34);
      assert.equal(recipe.attachment.asset.source, source);
      assert.equal(recipe.attachment.asset.revision, revision);
      assert.equal(args[2]({ ...request, own: false }).accessory, null);
      assert.equal(args[2]({ ...request, skin: 40 }).accessory.forward, 6);
      assert.throws(() => args[2]({ ...request, skin: 27 }), /face/);
      const custom = Uint8Array.of(0,0,0,0,0,0,0,0,2,1);
      assert.equal(args[2]({ ...request, skin: 27, customBytes: custom }).accessory.forward, 6);
      return 1;
    },
    render_standard_with_accessory_presentation_at_size(...args) {
      assert.equal(args[7](request).recipe.attachment.asset.source, source); rendered++;
    },
  };
  const client = createStockClient({ scene, adapter, appearanceMode: snapshot.appearanceMode,
    quality: { advance() {}, update_statistics() { return false; } },
    hostAssets: { resolveFood() {}, resolvePrey() {} }, target: f.canvas(),
    palettes: snapshot.palettes, background: snapshot.background, width: 960, height: 540 });
  assert.equal(client.packet(Uint8Array.of(0)), 1); client.frame(16); assert.equal(rendered, 1);
  assert(held);
  source.dispatchEvent(new Event('load'));
  assert.throws(() => reader.capture(), error => error.status === 'unsupported');
  assert.throws(() => client.frame(32), error => error.status === 'unsupported');
  reader.dispose(); client.dispose();
  assert.equal(f.timers.size, 0);
});

test('cached selected entry rejects incomplete, replaced or drifting sources without a fallback', async () => {
  for (const mode of ['incomplete', 'extent', 'replacement', 'geometry', 'entry']) {
    const f = fixture({ accessoryNative: true }); f.host(); f.complete();
    const native = f.gate.claim(f.gate.metadata().id), source = new f.realm.HTMLImageElement();
    f.realm.a_ct = 1; f.realm.a_imgs = [{ loaded: true, img: source, ww: 40, hh: 40, sc: .25, px: 3, py: 7 }];
    f.realm.localStorage.setItem('cosmetic', '0');
    const reader = createStockHostSnapshot({ realm:f.realm, observer:native, readAccessory:native.readAccessory,
      accessorySource:native.accessorySource, resolveAccessoryId:()=>0 });
    assert.throws(()=>reader.capture(), error=>error.status==='pending'); await Promise.resolve(); reader.capture();
    if(mode==='incomplete') f.imageState(source).complete=false;
    if(mode==='extent') f.imageState(source).width=41;
    if(mode==='replacement') f.realm.a_imgs[0].img=new f.realm.HTMLImageElement();
    if(mode==='geometry') f.realm.a_imgs[0].px=4;
    if(mode==='entry') f.realm.a_imgs[0]={...f.realm.a_imgs[0]};
    assert.throws(()=>reader.capture(), error=>error.status==='unsupported');
    reader.dispose(); assert.equal(f.timers.size,0);
  }
});
