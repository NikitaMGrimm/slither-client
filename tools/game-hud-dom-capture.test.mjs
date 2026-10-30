// Authored synthetic native-operation/realm doubles; no native DOM or host source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';

const gateSource = readFileSync(new URL('./fixtures/game-gate.js', import.meta.url), 'utf8');
const slot = Symbol.for('slither.client.gate.v1'), id = 'a'.repeat(32);
const getterOwners = {
  Node: ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling', 'isConnected'],
  Element: ['localName', 'namespaceURI'], HTMLElement: ['style'],
};
const domKeys = [...Object.values(getterOwners).flat(), 'setText', 'setStyle'];
const primaries = [undefined, null, false, 0, '', { primary: 'exact identity' }];
const caught = operation => {
  let thrown = false, value;
  try { operation(); } catch (error) { thrown = true; value = error; }
  assert.equal(thrown, true, 'operation must throw'); return value;
};

function fixture({ hud = true, armed = true, late = false, claim = true, prepare, setup, configurableGate = false } = {}) {
  const dom = createGateTestDom({ hud }); prepare?.(dom);
  const calls = { scheduled: 0, clock: 0, random: 0, sockets: 0, storage: 0, paints: 0, reloads: 0 };
  class Storage {
    constructor() { this.values = new Map(); }
    getItem(key) { calls.storage++; return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
  }
  const dimensions = new WeakMap();
  class Canvas {
    constructor() { dimensions.set(this, { width: 32, height: 32 }); }
    get width() { return dimensions.get(this).width; }
    set width(value) { dimensions.get(this).width = value; }
    get height() { return dimensions.get(this).height; }
    set height(value) { dimensions.get(this).height = value; }
  }
  class Context {
    constructor(canvas) { this.target = canvas; }
    get canvas() { return this.target; }
    drawImage() { calls.paints++; }
    putImageData() {} fill() {} stroke() {} fillRect() {} strokeRect() {} clearRect() {} reset() {}
  }
  const document = new dom.Document(); document.readyState = late ? 'complete' : 'loading';
  const sessionStorage = new Storage(), events = new EventTarget(), messages = [];
  const initialLocation = { href: 'https://slither.io/', reload() { calls.reloads++; } };
  if (armed) sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1',
    id, url: initialLocation.href, expires: Date.now() + 25000 }));
  const schedule = () => { calls.scheduled++; return 1; };
  const realm = { document, location: initialLocation, sessionStorage, localStorage: new Storage(), Storage,
    HTMLCanvasElement: Canvas, CanvasRenderingContext2D: Context, URL,
    Math: { random() { calls.random++; return 0.5; } }, performance: { now() { calls.clock++; return 0; } },
    requestAnimationFrame: schedule, cancelAnimationFrame() {}, setTimeout: schedule, clearTimeout() {},
    setInterval: schedule, clearInterval() {}, queueMicrotask: schedule,
    WebSocket: function () { calls.sockets++; throw new Error('Synthetic socket sentinel'); },
    addEventListener: events.addEventListener.bind(events), postMessage: value => messages.push(value) };
  const context = createContext(realm), evaluate = source => runInContext(source, context);
  evaluate('window = globalThis; top = globalThis;');
  const actualRealm = evaluate('globalThis');
  const edit = attachGateTestRealm(dom, realm, document, actualRealm);
  const reads = [], windowControls = new Map();
  for (const [owner, name] of [[realm, 'top'], [realm, 'document'], [realm, 'location'], [initialLocation, 'href']]) {
    const original = Object.getOwnPropertyDescriptor(owner, name);
    Object.defineProperty(owner, name, { ...original, get() {
      reads.push(name); const control = windowControls.get(name);
      control?.hook?.(this);
      if (control && Object.hasOwn(control, 'failure')) throw control.failure;
      return Reflect.apply(original.get, this, []);
    } });
  }
  // The production slot is immutable. This one case relaxes only its descriptor
  // to exercise the defensive identity comparison through the actual IIFE.
  if (configurableGate) evaluate(`{
    const define = Object.defineProperty;
    Object.defineProperty = (owner, key, descriptor) => define(owner, key,
      key === Symbol.for('slither.client.gate.v1') ? { ...descriptor, configurable: true, writable: true } : descriptor);
  }`);
  const f = { dom, edit, realm, document, context, actualRealm, evaluate, initialLocation,
    calls, messages, reads, windowControls, events };
  setup?.(f);
  new Script(gateSource).runInContext(context);
  const gate = realm[slot];
  const native = claim && gate?.claim ? gate.claim(id) : undefined;
  return { ...f, gate, native, cap: native?.hudDom };
}

function frozenRecord(record, keys) {
  assert(record, 'required captured HUD capability');
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Reflect.ownKeys(record).sort(), [...keys].sort());
  for (const value of Object.values(Object.getOwnPropertyDescriptors(record))) {
    assert.equal(Object.hasOwn(value, 'value'), true);
    assert.equal(value.configurable, false); assert.equal(value.writable, false);
  }
}

function tree(f) {
  const parent = new f.dom.hud.HTMLElement('DIV'), element = new f.dom.hud.HTMLElement('SPAN');
  const text = new f.dom.hud.CharacterData('old'), sibling = new f.dom.hud.CharacterData('next');
  f.document.appendChild(parent); parent.appendChild(element); element.appendChild(text); element.appendChild(sibling);
  return { parent, element, text, sibling, style: f.cap.dom.style(element) };
}

test('actual IIFE publishes only the exact frozen optional group on the existing one-shot claim', () => {
  const f = fixture(); frozenRecord(f.cap, ['schema', 'document', 'dom', 'isCurrentDocument']);
  frozenRecord(f.cap.dom, domKeys);
  assert.equal(f.cap.schema, 1); assert.equal(f.cap.document, f.document);
  assert.equal(Object.isFrozen(f.native), true); assert.equal(Object.isFrozen(f.document), false);
  assert.equal(f.cap.isCurrentDocument(), true); assert.equal(f.gate.metadata().code, 'held');
  assert.throws(() => f.gate.claim(id), /claimed/);
  assert.throws(() => f.gate.claim('b'.repeat(32)), /claimed/);
});

test('native getters return actual topology, null endpoints, and exact receiver identities', () => {
  const f = fixture(), t = tree(f), d = f.cap.dom;
  for (const [name, receiver, expected] of [
    ['nodeType', f.document, 9], ['nodeType', t.element, 1], ['nodeType', t.text, 3],
    ['ownerDocument', t.text, f.document], ['ownerDocument', f.document, null],
    ['parentNode', t.text, t.element], ['parentNode', f.document, null],
    ['firstChild', t.element, t.text], ['firstChild', t.text, null],
    ['nextSibling', t.text, t.sibling], ['nextSibling', t.sibling, null],
    ['isConnected', t.text, true], ['localName', t.element, 'span'],
    ['namespaceURI', t.element, 'http://www.w3.org/1999/xhtml'], ['style', t.element, t.style],
  ]) {
    f.dom.hud.trace.length = 0;
    assert.equal(d[name](receiver), expected);
    assert.deepEqual(f.dom.hud.trace, [[name, receiver]]);
  }
  t.element.removeChild(t.text); assert.equal(d.isConnected(t.text), false);
  assert.equal(Object.isFrozen(t.element), false); assert.equal(Object.isFrozen(t.style), false);
});

test('setText and setStyle forward exact receiver and arguments without wrapper coercion', () => {
  const f = fixture(), t = tree(f), d = f.cap.dom;
  const value = { toString() { assert.fail('wrapper coercion'); } }, name = Symbol('name');
  for (const text of ['plain', '', '\u0000<&>', value]) {
    f.dom.hud.trace.length = 0;
    assert.equal(d.setText(t.text, text), undefined);
    assert.equal(f.dom.hud.character(t.text).data, text);
    assert.deepEqual(f.dom.hud.trace, [['setText', t.text, text]]);
  }
  f.dom.hud.trace.length = 0;
  assert.equal(d.setStyle(t.style, name, value), undefined);
  assert.equal(f.dom.hud.style(t.style).get(name), value);
  assert.deepEqual(f.dom.hud.trace, [['setStyle', t.style, name, value]]);
});

test('every DOM operation enforces its captured native receiver brand, including proxy rejection', () => {
  const f = fixture(), t = tree(f), d = f.cap.dom;
  for (const name of domKeys) {
    const receiver = name === 'setText' ? t.text : name === 'setStyle' ? t.style : t.element;
    for (const bad of [{}, Object.create(Object.getPrototypeOf(receiver)), new Proxy(receiver, {})]) {
      assert.throws(() => d[name](bad, 'name', 'value'), TypeError, name);
    }
  }
  assert.throws(() => d.style(new f.dom.Element('div')), TypeError);
  assert.throws(() => d.setText(t.element, 'x'), TypeError);
  assert.throws(() => d.setStyle(t.element, 'x', 'y'), TypeError);
});

const ownedOperations = [
  ...Object.entries(getterOwners).flatMap(([owner, names]) => names.map(name => [owner, name, 'get'])),
  ['CharacterData', 'data', 'set'], ['CSSStyleDeclaration', 'setProperty', 'value'],
  ['Window', 'document', 'get'], ['Window', 'top', 'get'], ['Window', 'location', 'get'], ['Location', 'href', 'get'],
];
function ownerOf(f, owner) {
  return owner === 'Window' ? f.realm : owner === 'Location' ? f.initialLocation : f.realm[owner].prototype;
}

for (const [owner, name, kind] of ownedOperations) {
  test(`missing OWN ${owner}.${name} ${kind} omits whole group despite inherited fallback`, () => {
    let restored;
    const f = fixture({ setup(f) {
      const target = ownerOf(f, owner), original = Object.getOwnPropertyDescriptor(target, name);
      restored = () => Object.defineProperty(target, name, original);
      const inherited = Object.create(Object.getPrototypeOf(target));
      Object.defineProperty(inherited, name, original); Object.setPrototypeOf(target, inherited);
      delete target[name];
    } });
    assert.equal(Object.hasOwn(f.native, 'hudDom'), false);
    assert.equal(f.gate.metadata().code, 'held'); assert.equal(typeof f.native.setInput, 'function');
    restored(); assert.equal(Object.hasOwn(f.native, 'hudDom'), false, 'no late recapture');
  });
}

for (const [owner, name, kind] of ownedOperations) {
  test(`wrong descriptor kind for ${owner}.${name} cannot enable the group`, () => {
    const f = fixture({ setup(f) {
      const target = ownerOf(f, owner);
      const value = owner === 'Window' || owner === 'Location' ? target[name] : undefined;
      delete target[name]; // Redefining an accessor alone otherwise retains its old setter.
      Object.defineProperty(target, name, kind === 'get' ? { configurable: true, writable: true, value }
        : { configurable: true, get() { assert.fail('method accessor evaluated'); } });
    } });
    assert.equal(Object.hasOwn(f.native, 'hudDom'), false); assert.equal(f.gate.metadata().code, 'held');
  });
}

test('capture exceptions omit only HUD while preserving critical holds and optional editing', () => {
  for (const primary of primaries) {
    const f = fixture({ setup(f) {
      Object.defineProperty(f.realm, 'HTMLElement', { configurable: true, get() { throw primary; } });
    } });
    assert.equal(Object.hasOwn(f.native, 'hudDom'), false); assert.equal(f.gate.metadata().code, 'held');
    assert.equal(f.realm.requestAnimationFrame(() => assert.fail()), 0);
    assert.throws(() => new f.realm.WebSocket(), /held/);
    registerEditing(f, false).unregister();
  }
});

function registerEditing(f, policy) {
  const parent = new f.dom.Element('div'), field = new f.dom.Input();
  f.document.appendChild(parent); parent.appendChild(field); f.dom.state(f.document).active = field;
  f.native.setInput(() => {});
  const record = f.evaluate('({schema:1,element:null,parent:null})'); record.element = field; record.parent = parent;
  if (policy) record.inputPolicy = 'nickname-ascii-24';
  return f.native.registerNicknameEditField(record);
}

test('HUD capture is independent of editing, nickname value, profile, router and source completion', () => {
  for (const unavailable of ['editing', 'nickname', 'both']) {
    const f = fixture({ prepare(dom) {
      if (unavailable !== 'nickname') delete dom.Element.prototype.checkVisibility;
      if (unavailable !== 'editing') delete dom.Input.prototype.value;
    } });
    frozenRecord(f.cap, ['schema', 'document', 'dom', 'isCurrentDocument']);
    assert.equal(Object.hasOwn(f.native, 'liveProfile'), false);
    assert.equal(f.native.completed(), false); assert.equal(f.cap.isCurrentDocument(), true);
    f.native.setInput(() => {}); assert.equal(f.cap.isCurrentDocument(), true);
    f.native.setInput(undefined); assert.equal(f.cap.isCurrentDocument(), true);
    const t = tree(f); f.cap.dom.setText(t.text, 'independent');
    if (unavailable === 'nickname') {
      registerEditing(f, false).unregister();
      assert.throws(() => registerEditing(f, true), /unavailable/);
    } else assert.throws(() => registerEditing(f, false), /unavailable/);
  }
  const f = fixture({ hud: false }); assert.equal(Object.hasOwn(f.native, 'hudDom'), false);
  registerEditing(f, true).unregister();
  assert.equal(Object.hasOwn(f.dom, 'hud'), false);
  assert.equal(Object.hasOwn(f.realm, 'HTMLElement'), false);
  assert.equal(Object.hasOwn(f.dom.Node.prototype, 'firstChild'), false);
});

test('HUD-only missing descriptor leaves editing and nickname policy operational', () => {
  const f = fixture({ setup(f) { delete f.realm.HTMLElement.prototype.style; } });
  assert.equal(Object.hasOwn(f.native, 'hudDom'), false);
  const lease = registerEditing(f, true); assert.equal(typeof lease.handleInput, 'function'); lease.unregister();
});

test('captured own descriptors and Reflect.apply survive all late native operation replacements', () => {
  const f = fixture(), t = tree(f), d = f.cap.dom;
  const trip = () => assert.fail('late native operation used');
  for (const [owner, names] of Object.entries(getterOwners)) for (const name of names) {
    Object.defineProperty(f.realm[owner].prototype, name, { configurable: true, get: trip });
    Object.defineProperty(t.element, name, { configurable: true, get: trip });
  }
  Object.defineProperty(f.realm.CharacterData.prototype, 'data', { configurable: true, set: trip });
  f.realm.CSSStyleDeclaration.prototype.setProperty = trip;
  Object.defineProperty(t.text, 'data', { set: trip }); t.style.setProperty = trip;
  for (const name of ['document', 'top', 'location']) Object.defineProperty(f.realm, name, { configurable: true, get: trip });
  Object.defineProperty(f.initialLocation, 'href', { configurable: true, get: trip });
  for (const name of ['Node', 'Element', 'HTMLElement', 'CharacterData', 'CSSStyleDeclaration']) f.realm[name] = trip;
  for (const receiver of [t.text, t.element, t.style]) Object.setPrototypeOf(receiver, null);
  f.evaluate("Reflect.apply = Object.getOwnPropertyDescriptor = Object.getPrototypeOf = Object.freeze = () => { throw new Error('late intrinsic'); };");
  assert.equal(d.nodeType(t.text), 3); assert.equal(d.ownerDocument(t.text), f.document);
  assert.equal(d.parentNode(t.text), t.element); assert.equal(d.firstChild(t.element), t.text);
  assert.equal(d.nextSibling(t.text), t.sibling); assert.equal(d.isConnected(t.text), true);
  assert.equal(d.localName(t.element), 'span'); assert.equal(d.namespaceURI(t.element), 'http://www.w3.org/1999/xhtml');
  assert.equal(d.style(t.element), t.style); d.setText(t.text, 'stable'); d.setStyle(t.style, 'opacity', '0');
  assert.equal(f.dom.hud.character(t.text).data, 'stable'); assert.equal(f.dom.hud.style(t.style).get('opacity'), '0');
  assert.equal(f.cap.isCurrentDocument(), true);
});

test('actual current-document predicate tracks document, top, location and href identity without latching', () => {
  const f = fixture(), cap = f.cap;
  for (const [owner, name, stale, initial] of [
    [f.realm, 'document', new f.dom.Document(), f.document], [f.realm, 'top', {}, f.actualRealm],
    [f.realm, 'location', { href: f.initialLocation.href }, f.initialLocation],
    [f.initialLocation, 'href', 'https://slither.io/index.html', 'https://slither.io/'],
  ]) {
    assert.equal(cap.isCurrentDocument(), true); owner[name] = stale;
    assert.equal(cap.isCurrentDocument(), false, name); owner[name] = initial;
    assert.equal(cap.isCurrentDocument(), true, `${name} restored`);
  }
  f.document.dispatchEvent(new Event('DOMContentLoaded')); assert.equal(cap.isCurrentDocument(), true);
  f.events.dispatchEvent(new Event('pagehide')); assert.equal(cap.isCurrentDocument(), false);
  f.events.dispatchEvent(new Event('DOMContentLoaded')); assert.equal(cap.isCurrentDocument(), false);
});

test('currentness retains the initially armed URL when href changes during optional capture', () => {
  const f = fixture({ setup(f) {
    let captures = 0;
    f.windowControls.set('document', { hook() {
      // Editing reads first. Change URL during the independent HUD document read,
      // before it could incorrectly snapshot a new href as the armed URL.
      if (++captures === 2) f.initialLocation.href = 'https://slither.io/index.html';
    } });
  } });
  assert.equal(f.gate.metadata().code, 'held');
  assert.equal(f.cap.isCurrentDocument(), false);
  f.initialLocation.href = 'https://slither.io/'; assert.equal(f.cap.isCurrentDocument(), true);
});

test('HUD and profile capability availability remain independent without invoking acquisition', () => {
  for (const missing of ['none', 'hud', 'profile', 'editing']) {
    const f = fixture({ setup(f) {
      const unavailable = () => assert.fail('optional preparation invoked a profile operation');
      Object.assign(f.realm, { isSecureContext: true, fetch: unavailable,
        crypto: { subtle: { digest: unavailable } }, AbortController, Response,
        ReadableStream, ReadableStreamDefaultReader });
      if (missing === 'hud') delete f.realm.HTMLElement.prototype.style;
      if (missing === 'profile') delete f.realm.crypto.subtle.digest;
      if (missing === 'editing') delete f.dom.Element.prototype.checkVisibility;
    } });
    assert.equal(f.gate.metadata().code, 'held');
    assert.equal(Object.hasOwn(f.native, 'hudDom'), missing !== 'hud');
    assert.equal(Object.hasOwn(f.native, 'liveProfile'), missing !== 'profile');
    assert.equal(f.calls.scheduled, 0); assert.equal(f.calls.clock, 0); assert.equal(f.calls.sockets, 0);
  }
});

test('the private group checks claim and gate identity but adds no claim side effect', () => {
  const f = fixture({ claim: false, configurableGate: true });
  assert.throws(() => f.gate.claim('b'.repeat(32)), /claimed/);
  const cap = f.gate.claim(id).hudDom; assert.equal(cap.isCurrentDocument(), true);
  const held = f.realm[slot]; f.realm[slot] = {};
  f.reads.length = 0; assert.equal(cap.isCurrentDocument(), false); assert.deepEqual(f.reads, []);
  f.realm[slot] = held; assert.equal(cap.isCurrentDocument(), true);
  assert.throws(() => f.gate.claim(id), /claimed/);
});

for (const name of domKeys) test(`captured ${name} propagates every exact falsy/native primary`, () => {
  const f = fixture(), t = tree(f), d = f.cap.dom;
  const receiver = name === 'setText' ? t.text : name === 'setStyle' ? t.style : t.element;
  for (const primary of primaries) {
    f.dom.hud.controls.set(name, { failure: primary });
    assert.equal(caught(() => d[name](receiver, 'name', 'value')), primary);
    assert.equal(f.cap.isCurrentDocument(), true, 'DOM failure has no gate side effect');
  }
});

for (const name of ['top', 'document', 'location', 'href']) test(`currentness ${name} preserves exact primaries`, () => {
  const f = fixture();
  for (const primary of primaries) {
    f.windowControls.set(name, { failure: primary });
    assert.equal(caught(() => f.cap.isCurrentDocument()), primary);
  }
  f.windowControls.delete(name); assert.equal(f.cap.isCurrentDocument(), true);
});

test('currentness reads only captured ownership getters and short-circuits stale/end states', () => {
  const f = fixture();
  f.reads.length = 0; assert.equal(f.cap.isCurrentDocument(), true);
  assert.deepEqual(f.reads, ['top', 'document', 'location', 'href']);
  f.realm.top = {}; f.reads.length = 0;
  assert.equal(f.cap.isCurrentDocument(), false); assert.deepEqual(f.reads, ['top']);
  f.events.dispatchEvent(new Event('pagehide')); f.reads.length = 0;
  assert.equal(f.cap.isCurrentDocument(), false); assert.deepEqual(f.reads, []);
});

test('capture/claim/currentness add zero routes, listeners, host values, source, clock, socket or DOM effects', () => {
  const legacy = fixture({ hud: false }), f = fixture();
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(f.calls, legacy.calls); assert.deepEqual(plain(f.messages), plain(legacy.messages));
  assert.deepEqual(plain(f.edit.listeners.map(({ type, options }) => [type, options])),
    plain(legacy.edit.listeners.map(({ type, options }) => [type, options])));
  assert.deepEqual(plain(f.edit.documentListeners.map(({ type, options }) => [type, options])),
    plain(legacy.edit.documentListeners.map(({ type, options }) => [type, options])));
  assert.deepEqual(f.dom.hud.trace, [], 'capturing operations never invokes them');
  const before = { ...f.calls }, messages = [...f.messages]; let routes = 0;
  f.native.setInput(() => { routes++; });
  for (const name of ['playing', 'connecting', 'oef', 'ws', 'per_color_imgs', 'alcsc', 'fetch']) {
    Object.defineProperty(f.realm, name, { get() { assert.fail(`host property read: ${name}`); } });
  }
  for (const name of ['metadata', 'completed', 'revision', 'stamp', 'painted', 'generated']) {
    assert.equal(typeof (name === 'metadata' ? f.gate : f.native)[name], 'function');
  }
  for (let index = 0; index < 3; index++) assert.equal(f.cap.isCurrentDocument(), true);
  assert.deepEqual(f.dom.hud.trace, []); assert.deepEqual(f.calls, before);
  assert.deepEqual(f.messages, messages); assert.equal(routes, 0);
  const event = f.edit.dispatch('keydown', { key: 'a', target: f.document });
  assert.equal(routes, 1); assert.equal(event.defaultPrevented, true);
  assert.equal(f.cap.isCurrentDocument(), true);
});

test('existing unarmed/late/critical-failure baselines do not gain a claim or activation', () => {
  assert.equal(fixture({ armed: false }).gate, undefined);
  const late = fixture({ late: true }); assert.equal(late.gate.metadata().code, 'gate-unavailable');
  assert.equal(Object.hasOwn(late.gate, 'claim'), false);
  const critical = fixture({ prepare(dom) { delete dom.FenceEvent.prototype.stopImmediatePropagation; } });
  assert.equal(critical.gate.metadata().code, 'gate-unavailable'); assert.equal(critical.native, undefined);
  assert.equal(critical.realm.requestAnimationFrame(() => assert.fail()), 0);
});
