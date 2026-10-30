// Authored native-operation/realm doubles. No browser property, DOM or CSS acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';

const source = readFileSync(new URL('./fixtures/game-gate.js', import.meta.url), 'utf8');
const slot = Symbol.for('slither.client.gate.v1'), id = 'a'.repeat(32);
const primaries = [undefined, null, false, 0, '', Symbol('primary'), new Error('primary')];
const hudKeys = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling', 'isConnected',
  'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const caught = operation => {
  let present = false, value;
  try { operation(); } catch (error) { present = true; value = error; }
  assert(present, 'operation must throw'); return value;
};
function exact(record, keys) {
  assert(record, 'required captured leaderboard capability'); assert(Object.isFrozen(record));
  assert.deepEqual(Reflect.ownKeys(record).sort(), [...keys].sort());
  for (const field of Object.values(Object.getOwnPropertyDescriptors(record))) {
    assert(Object.hasOwn(field, 'value')); assert.equal(field.writable, false); assert.equal(field.configurable, false);
  }
}
function fixture({ hud = true, ownedHud = true, ownedPlay = false, leaderboard = true,
  claim = true, armed = true, late = false, prepare, setup, configurableGate = false } = {}) {
  const dom = createGateTestDom({ hud, ownedHud, ownedPlay, leaderboard }); prepare?.(dom);
  const calls = { scheduled: 0, clock: 0, random: 0, sockets: 0, paints: 0, storage: 0, reloads: 0 };
  class Storage {
    values = new Map();
    getItem(key) { calls.storage++; return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
  }
  const dimensions = new WeakMap();
  class Canvas {
    constructor() { dimensions.set(this, { width: 32, height: 32 }); }
    get width() { return dimensions.get(this).width; } set width(value) { dimensions.get(this).width = value; }
    get height() { return dimensions.get(this).height; } set height(value) { dimensions.get(this).height = value; }
  }
  class Context {
    get canvas() { return this.target; }
    drawImage() { calls.paints++; }
    putImageData() {} fill() {} stroke() {} fillRect() {} strokeRect() {} clearRect() {} reset() {}
  }
  const document = new dom.Document(); document.readyState = late ? 'complete' : 'loading';
  const sessionStorage = new Storage(), events = new EventTarget(), messages = [];
  const initialLocation = { href: 'https://slither.io/', reload() { calls.reloads++; } };
  if (armed) sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1',
    id, url: initialLocation.href, expires: 26000 }));
  const schedule = () => { calls.scheduled++; return 1; };
  const realm = { document, location: initialLocation, sessionStorage, localStorage: new Storage(), Storage,
    HTMLCanvasElement: Canvas, CanvasRenderingContext2D: Context, URL, Date: { now: () => 1000 },
    Math: { random() { calls.random++; return 0.5; } }, performance: { now() { calls.clock++; return 0; } },
    requestAnimationFrame: schedule, cancelAnimationFrame() {}, setTimeout: schedule, clearTimeout() {},
    setInterval: schedule, clearInterval() {}, queueMicrotask: schedule,
    WebSocket: function () { calls.sockets++; throw new Error('Synthetic socket sentinel'); },
    addEventListener: events.addEventListener.bind(events), postMessage: value => messages.push(value) };
  const context = createContext(realm), evaluate = code => runInContext(code, context);
  evaluate('window = globalThis; top = globalThis;');
  const actualRealm = evaluate('globalThis'), edit = attachGateTestRealm(dom, realm, document, actualRealm);
  const reads = [], windowControls = new Map();
  for (const [owner, name] of [[realm, 'top'], [realm, 'document'], [realm, 'location'], [initialLocation, 'href']]) {
    const field = Object.getOwnPropertyDescriptor(owner, name);
    Object.defineProperty(owner, name, { ...field, get() {
      reads.push(name); const control = windowControls.get(name);
      control?.hook?.(this);
      if (control && Object.hasOwn(control, 'failure')) throw control.failure;
      return Reflect.apply(field.get, this, []);
    } });
  }
  // Relax only this test's slot to exercise the existing defensive identity check.
  if (configurableGate) evaluate(`{
    const define = Object.defineProperty;
    Object.defineProperty = (owner, key, field) => define(owner, key,
      key === Symbol.for('slither.client.gate.v1') ? { ...field, configurable: true, writable: true } : field);
  }`);
  const f = { dom, realm, document, events, edit, context, evaluate, actualRealm, calls, messages, reads,
    windowControls, initialLocation };
  setup?.(f); new Script(source).runInContext(context);
  const gate = realm[slot], native = claim && gate?.claim ? gate.claim(id) : undefined;
  return { ...f, gate, native, cap: native?.leaderboardDom };
}
function element(f) { return f.native.ownedHudDom.dom.createElement(f.document, 'span'); }
function setter(f) { return f.cap.properties.setTranslate; }
function setCalls(f) { return f.dom.hud.trace.filter(([name]) => name === 'setTranslate'); }
function oldGroups(f, play = false) {
  exact(f.native.hudDom.dom, hudKeys);
  exact(f.native.ownedHudDom.dom, ['createElement', 'createTextNode', 'appendChild', 'removeChild']);
  if (play) exact(f.native.ownedPlayDom.dom, ['inputValue', 'inputMaxLength', 'inputAutocompleteOff', 'buttonType', 'buttonDisabled']);
}

test('actual IIFE exposes the exact frozen optional sibling and the same captured Document', () => {
  const f = fixture({ ownedPlay: true }); oldGroups(f, true);
  exact(f.cap, ['schema', 'document', 'properties']); exact(f.cap.properties, ['setTranslate']);
  assert.equal(f.cap.schema, 1); assert.equal(f.cap.document, f.document);
  assert.equal(f.cap.document, f.native.hudDom.document); assert.equal(f.cap.document, f.native.ownedHudDom.document);
  assert.equal(f.cap.document, f.native.ownedPlayDom.document); assert(Object.isFrozen(f.native));
  assert.equal(setter(f).length, 2); assert.equal(f.gate.metadata().code, 'held');
  assert.equal(Object.getPrototypeOf(setter(f)), f.evaluate('Function.prototype'));
  assert.throws(() => f.gate.claim(id), /claimed/); assert.throws(() => f.gate.claim('b'.repeat(32)), /claimed/);
});

test('fixture opt-in requires HUD plus construction and adds no exposed fixture keys', () => {
  for (const options of [{}, { leaderboard: true }, { hud: true, leaderboard: true },
    { ownedHud: true, leaderboard: true }]) {
    const base = createGateTestDom({ ...options, leaderboard: false }), dom = createGateTestDom(options);
    assert.deepEqual(Reflect.ownKeys(dom), Reflect.ownKeys(base));
    if (dom.hud) {
      assert.deepEqual(Reflect.ownKeys(dom.hud), Reflect.ownKeys(base.hud));
      assert.equal(Object.hasOwn(dom.hud.HTMLElement.prototype, 'translate'), false);
    }
  }
  const old = createGateTestDom({ hud: true, ownedHud: true });
  const dom = createGateTestDom({ hud: true, ownedHud: true, leaderboard: true });
  assert.deepEqual(Reflect.ownKeys(dom), Reflect.ownKeys(old));
  assert.deepEqual(Reflect.ownKeys(dom.hud), Reflect.ownKeys(old.hud));
  assert.equal(typeof Object.getOwnPropertyDescriptor(dom.hud.HTMLElement.prototype, 'translate').set, 'function');
  assert.equal(Object.hasOwn(fixture({ leaderboard: false }).native, 'leaderboardDom'), false);
});

test('fixture boolean property models truthy conversion; gate permits only primitive true/false', () => {
  const f = fixture(), node = element(f), setTranslate = setter(f);
  node.translate = 'no'; assert.equal(node.translate, true, 'synthetic native boolean truthy conversion');
  node.translate = ''; assert.equal(node.translate, false);
  for (const value of [true, false]) {
    f.dom.hud.trace.length = 0;
    assert.equal(setTranslate(node, value), undefined); assert.equal(f.dom.state(node).translate, value);
    assert.deepEqual(setCalls(f), [['setTranslate', node, value]]);
    assert.deepEqual(f.dom.hud.trace.map(([name]) => name),
      ['nodeType', 'namespaceURI', 'ownerDocument', 'setTranslate', 'nodeType', 'namespaceURI', 'ownerDocument']);
  }
  const trip = () => assert.fail('coercion or getter');
  for (const value of [undefined, null, 0, 1, '', 'no', 'false', NaN, 1n, Symbol('value'), new Boolean(false),
    { valueOf: trip, toString: trip }, new Proxy({}, { get: trip })]) {
    f.dom.hud.trace.length = 0; f.reads.length = 0;
    assert.match(String(caught(() => setTranslate(node, value))), /primitive boolean/);
    assert.deepEqual(f.dom.hud.trace, []); assert.deepEqual(f.reads, []);
  }
});

test('wrapper invokes the captured setter with exact receiver and ONE boolean and ignores native return', () => {
  const tape = []; let result;
  const f = fixture({ prepare(dom) {
    Object.defineProperty(dom.hud.HTMLElement.prototype, 'translate', { configurable: true,
      get() { assert.fail('translate getter'); }, set: function (...args) { tape.push([this, args]); return result; } });
  } });
  const node = element(f);
  assert.deepEqual(tape, [], 'capture never invokes setter');
  for (result of [undefined, null, false, 0, '', Symbol('native result'), {}]) for (const value of [true, false]) {
    tape.length = 0; assert.equal(setter(f).call({}, node, value, 'ignored'), undefined);
    assert.deepEqual(tape, [[node, [value]]]);
  }
});

test('native brands, namespace and exact owner reject plain, proxied, wrong-kind and foreign receivers', () => {
  const f = fixture(), node = element(f), other = createGateTestDom({ hud: true, ownedHud: true, leaderboard: true });
  const text = f.native.ownedHudDom.dom.createTextNode(f.document, 'text');
  const wrong = new f.dom.Element('div'); f.dom.state(wrong).owner = f.document;
  const foreign = f.native.ownedHudDom.dom.createElement(new f.dom.Document(), 'div');
  for (const bad of [undefined, null, false, 0, '', Symbol('receiver'), {}, Object.create(node),
    new Proxy(node, {}), f.document, text, wrong, foreign, new other.hud.HTMLElement('SPAN')]) {
    assert.throws(() => setter(f)(bad, true));
  }
  f.dom.state(node).namespace = 'http://www.w3.org/2000/svg';
  f.dom.hud.trace.length = 0; assert.throws(() => setter(f)(node, false)); assert.deepEqual(setCalls(f), []);
});

test('detached current-document nodes are allowed for preparation; adopted nodes cannot be written', () => {
  const f = fixture(), node = element(f), parent = element(f), c = f.native.ownedHudDom.dom;
  assert.equal(f.native.hudDom.dom.isConnected(node), false); setter(f)(node, false);
  c.appendChild(f.document, parent); c.appendChild(parent, node); setter(f)(node, true);
  c.removeChild(parent, node); setter(f)(node, false);
  const other = new f.dom.Document(); c.appendChild(other, parent); c.appendChild(parent, node);
  f.dom.hud.trace.length = 0; assert.throws(() => setter(f)(node, true)); assert.deepEqual(setCalls(f), []);
  assert.equal(f.dom.state(node).translate, false);
  c.removeChild(parent, node); assert.throws(() => setter(f)(node, true));
});

for (const replacement of ['missing', 'inherited', 'data', 'getter-only', 'empty']) {
  test(`unsupported OWN translate descriptor (${replacement}) omits only the sibling and never recaptures`, () => {
    let restore;
    const f = fixture({ ownedPlay: true, prepare(dom) {
      const target = dom.hud.HTMLElement.prototype, saved = Object.getOwnPropertyDescriptor(target, 'translate');
      delete target.translate;
      if (replacement === 'inherited') {
        const inherited = Object.create(Object.getPrototypeOf(target));
        Object.defineProperty(inherited, 'translate', saved); Object.setPrototypeOf(target, inherited);
      } else if (replacement === 'data') Object.defineProperty(target, 'translate', { configurable: true, value() { assert.fail('data call'); } });
      else if (replacement === 'getter-only') Object.defineProperty(target, 'translate', { configurable: true, get() { assert.fail('getter'); } });
      else if (replacement === 'empty') Object.defineProperty(target, 'translate', { configurable: true, set: undefined });
      restore = () => Object.defineProperty(target, 'translate', saved);
    } });
    assert.equal(Object.hasOwn(f.native, 'leaderboardDom'), false); oldGroups(f, true);
    restore(); assert.equal(Object.hasOwn(f.native, 'leaderboardDom'), false);
    assert.equal(f.native.hudDom.isCurrentDocument(), true); assert.equal(f.gate.metadata().code, 'held');
  });
}

test('capture descriptor/prototype failures preserve the independent legacy groups, including falsy throws', () => {
  for (const primary of primaries) for (const target of ['descriptor', 'prototype', 'source']) {
    const f = fixture({ ownedPlay: true, setup(f) {
      Object.assign(f.realm, { capturePrimary: primary, htmlOwner: f.dom.hud.HTMLElement.prototype });
      f.evaluate(`{
        const original = Object.getOwnPropertyDescriptor;
        Object.getOwnPropertyDescriptor = (owner, name) => {
          if (${target === 'descriptor' ? "owner === htmlOwner && name === 'translate'" : target === 'source'
            ? "owner === Function.prototype && name === 'toString'" : 'false'}) throw capturePrimary;
          return original(owner, name);
        };
      }`);
      if (target === 'prototype') {
        const original = f.dom.hud.HTMLElement; let reads = 0;
        f.realm.HTMLElement = { get prototype() { if (++reads === 2) throw primary; return original.prototype; } };
      }
    } });
    assert.equal(Object.hasOwn(f.native, 'leaderboardDom'), false);
    // The independent Play group also needs Function.toString. Do not claim it
    // survives a deliberate failure of that shared intrinsic.
    oldGroups(f, target !== 'source'); assert.equal(f.gate.metadata().code, 'held');
    assert.equal(f.realm.requestAnimationFrame(() => assert.fail('held callback')), 0);
    assert.throws(() => new f.realm.WebSocket(), /held/);
  }
});

test('data descriptors cannot inherit a substitute setter from Object.prototype', () => {
  const f = fixture({ ownedPlay: true, prepare(dom) {
    Object.defineProperty(dom.hud.HTMLElement.prototype, 'translate', { configurable: true, value: false });
  }, setup(f) {
    f.realm.translateOwner = f.dom.hud.HTMLElement.prototype;
    // Restrict descriptor pollution to this one synthetic result. Polluting the
    // VM's Object.prototype also corrupts Node's contextified Window descriptors.
    f.evaluate(`{
      const get = Object.getOwnPropertyDescriptor;
      Object.getOwnPropertyDescriptor = (owner, name) => owner === translateOwner && name === 'translate'
        ? Object.assign(Object.create({ set() { throw new Error('inherited setter'); } }),
          { value: false, writable: true, configurable: true }) : get(owner, name);
    }`);
  } });
  assert.equal(Object.hasOwn(f.native, 'leaderboardDom'), false); oldGroups(f, true);
});

test('nonfunction setter descriptor values omit the sibling without affecting old capture', () => {
  for (const value of [undefined, null, false, 0, '', 1, {}, Symbol('nonfunction')]) {
    const f = fixture({ ownedPlay: true, setup(f) {
      Object.assign(f.realm, { translateOwner: f.dom.hud.HTMLElement.prototype, descriptorSetter: value });
      f.evaluate(`{
        const get = Object.getOwnPropertyDescriptor;
        Object.getOwnPropertyDescriptor = (owner, name) => owner === translateOwner && name === 'translate'
          ? { set: descriptorSetter } : get(owner, name);
      }`);
    } });
    assert.equal(Object.hasOwn(f.native, 'leaderboardDom'), false); oldGroups(f, true);
  }
});

test('natural current/foreign asynchronous and generator setters, including bound kinds, are never admitted or called', () => {
  const foreign = createContext({});
  const expressions = ['async function () {}', 'function* () {}', 'async function* () {}',
    '(async function () {}).bind(null)', '(function* () {}).bind(null)', '(async function* () {}).bind(null)'];
  for (const context of [undefined, foreign]) for (const expression of expressions) {
    const operation = context ? runInContext(`(${expression})`, context) : new Script(`(${expression})`).runInThisContext();
    const f = fixture({ ownedPlay: true, prepare(dom) {
      Object.defineProperty(dom.hud.HTMLElement.prototype, 'translate', { configurable: true, set: operation });
    } });
    assert.equal(Object.hasOwn(f.native, 'leaderboardDom'), false); oldGroups(f, true);
  }
  let calls = 0;
  const sync = runInContext('(function (value) { recorder(this, value); })', createContext({ recorder(receiver, value) {
    calls++; assert.equal(value, false); assert(receiver);
  } }));
  const f = fixture({ prepare(dom) {
    Object.defineProperty(dom.hud.HTMLElement.prototype, 'translate', { configurable: true, set: sync });
  } });
  assert.equal(calls, 0); setter(f)(element(f), false); assert.equal(calls, 1);
});

test('tag getters, cycles and unbounded fresh function prototypes omit the group without invoking accessors', () => {
  for (const kind of ['getter', 'cycle', 'fresh']) {
    const operation = function () { assert.fail('setter called at capture'); };
    let candidate = operation;
    if (kind === 'getter') Object.defineProperty(operation, Symbol.toStringTag, { get() { assert.fail('tag getter'); } });
    if (kind === 'cycle') candidate = new Proxy(operation, { getPrototypeOf() { return candidate; } });
    if (kind === 'fresh') {
      const fresh = () => new Proxy({}, { getPrototypeOf: fresh });
      candidate = new Proxy(operation, { getPrototypeOf: fresh });
    }
    const f = fixture({ prepare(dom) {
      Object.defineProperty(dom.hud.HTMLElement.prototype, 'translate', { configurable: true, set: candidate });
    } });
    assert.equal(Object.hasOwn(f.native, 'leaderboardDom'), false); oldGroups(f);
  }
});

test('captured setter and native getters ignore late instance/prototype/realm/intrinsic replacements', () => {
  const f = fixture(), node = element(f), trip = () => assert.fail('late property lookup');
  Object.defineProperty(f.dom.hud.HTMLElement.prototype, 'translate', { configurable: true, get: trip, set: trip });
  Object.defineProperty(node, 'translate', { configurable: true, get: trip, set: trip });
  for (const [owner, name] of [[f.dom.Node.prototype, 'nodeType'], [f.dom.Node.prototype, 'ownerDocument'],
    [f.dom.Element.prototype, 'namespaceURI']]) Object.defineProperty(owner, name, { configurable: true, get: trip });
  for (const name of ['document', 'top', 'location']) Object.defineProperty(f.realm, name, { configurable: true, get: trip });
  Object.defineProperty(f.initialLocation, 'href', { configurable: true, get: trip });
  for (const name of ['Node', 'Element', 'HTMLElement', 'Document']) f.realm[name] = trip;
  f.evaluate("Reflect.apply = Object.getOwnPropertyDescriptor = Object.getPrototypeOf = Object.freeze = () => { throw new Error('late intrinsic'); };");
  Object.setPrototypeOf(node, null); setter(f)(node, false); assert.equal(f.dom.state(node).translate, false);
});

for (const invalidation of ['document', 'top', 'location', 'href', 'pagehide', 'slot']) {
  test(`stale ${invalidation} blocks setter before receiver observations`, () => {
    const f = fixture({ configurableGate: invalidation === 'slot' }), node = element(f);
    if (invalidation === 'document') f.realm.document = new f.dom.Document();
    if (invalidation === 'top') f.realm.top = {};
    if (invalidation === 'location') f.realm.location = { href: f.initialLocation.href };
    if (invalidation === 'href') f.initialLocation.href = 'https://slither.io/index.html';
    if (invalidation === 'pagehide') f.events.dispatchEvent(new Event('pagehide'));
    if (invalidation === 'slot') f.realm[slot] = {};
    f.dom.hud.trace.length = 0; assert.throws(() => setter(f)(node, true)); assert.deepEqual(f.dom.hud.trace, []);
  });
}

for (const name of ['nodeType', 'namespaceURI', 'ownerDocument']) {
  test(`freshness invalidation during ${name} prevents the native setter`, () => {
    const f = fixture(), node = element(f);
    f.dom.hud.controls.set(name, { hook() { f.initialLocation.href = 'https://slither.io/index.html'; } });
    f.dom.hud.trace.length = 0; assert.throws(() => setter(f)(node, true));
    assert.deepEqual(f.dom.hud.trace.map(([operation]) => operation),
      ['nodeType', 'namespaceURI', 'ownerDocument'].slice(0, ['nodeType', 'namespaceURI', 'ownerDocument'].indexOf(name) + 1));
    assert.equal(f.dom.state(node).translate, undefined);
  });
}

test('post-effect document/adoption failures preserve the completed mutation without further write or fallback', () => {
  for (const invalidation of ['document', 'adoption', 'namespace']) {
    const f = fixture(), node = element(f);
    f.dom.hud.controls.set('setTranslate', { afterHook() {
      if (invalidation === 'document') f.realm.document = new f.dom.Document();
      if (invalidation === 'adoption') f.dom.state(node).owner = new f.dom.Document();
      if (invalidation === 'namespace') f.dom.state(node).namespace = 'foreign';
    } });
    f.dom.hud.trace.length = 0; assert.throws(() => setter(f)(node, false));
    assert.equal(f.dom.state(node).translate, false); assert.equal(setCalls(f).length, 1);
    if (invalidation === 'document') assert.equal(f.dom.hud.trace.at(-1)[0], 'setTranslate');
  }
});

test('caught nested setter reentry poisons every active native observation/effect boundary', () => {
  for (const name of ['nodeType', 'namespaceURI', 'ownerDocument', 'setTranslate']) for (const after of [false, true]) {
    const f = fixture(), node = element(f); let nested;
    f.dom.hud.controls.set(name, { [after ? 'afterHook' : 'hook']() {
      nested = caught(() => setter(f)(node, true));
    } });
    const primary = caught(() => setter(f)(node, false)); assert.equal(primary, nested);
    assert.match(String(primary), /reentry/);
    assert.equal(setCalls(f).length, name === 'setTranslate' ? 1 : 0);
    assert.equal(f.dom.state(node).translate, name === 'setTranslate' ? false : undefined);
    f.dom.hud.controls.clear(); setter(f)(node, true); assert.equal(f.dom.state(node).translate, true);
  }
});

test('every exact before/after native failure survives and no subsequent native work is attempted', () => {
  for (const primary of primaries) for (const name of ['nodeType', 'namespaceURI', 'ownerDocument', 'setTranslate']) {
    for (const after of [false, true]) {
      const f = fixture(), node = element(f); f.dom.hud.trace.length = 0;
      f.dom.hud.controls.set(name, { [after ? 'afterFailure' : 'failure']: primary });
      assert.equal(caught(() => setter(f)(node, false)), primary);
      assert.equal(f.dom.hud.trace.at(-1)[0], name);
      assert.equal(f.dom.state(node).translate, name === 'setTranslate' && after ? false : undefined);
      f.dom.hud.controls.clear(); assert.equal(f.native.hudDom.isCurrentDocument(), true);
    }
  }
});

test('captured document-guard failures retain exact falsy primaries without any setter fallback', () => {
  for (const primary of primaries) for (const name of ['top', 'document', 'location', 'href']) {
    const f = fixture(), node = element(f); f.dom.hud.trace.length = 0;
    f.windowControls.set(name, { failure: primary });
    assert.equal(caught(() => setter(f)(node, true)), primary); assert.deepEqual(f.dom.hud.trace, []);
  }
});

test('caught document-guard reentry remains primary even when a later guard operation throws a falsy value', () => {
  for (const primary of primaries) {
    const f = fixture(), node = element(f); let nested;
    f.windowControls.set('top', { hook() { nested = caught(() => setter(f)(node, false)); } });
    f.windowControls.set('document', { failure: primary }); f.dom.hud.trace.length = 0;
    assert.equal(caught(() => setter(f)(node, true)), nested);
    assert.match(String(nested), /reentry/); assert.deepEqual(f.dom.hud.trace, []);
  }
});

test('fixture control hooks use shared trace and before/after first-presence failure semantics', () => {
  const f = fixture(), node = element(f), order = [];
  for (const primary of primaries) {
    f.dom.state(node).translate = true; f.dom.hud.trace.length = 0; order.length = 0;
    f.dom.hud.controls.set('setTranslate', { hook(receiver, value) {
      order.push('before'); assert.equal(receiver, node); assert.equal(value, false);
      assert.equal(f.dom.state(node).translate, true);
    }, failure: primary, afterHook() { assert.fail('after before-failure'); }, afterFailure: 'secondary' });
    assert.equal(caught(() => setter(f)(node, false)), primary);
    assert.deepEqual(order, ['before']); assert.equal(f.dom.state(node).translate, true);
    f.dom.hud.controls.set('setTranslate', { hook() { order.push('before'); }, afterHook(receiver, value) {
      order.push('after'); assert.equal(receiver, node); assert.equal(value, false);
      assert.equal(f.dom.state(node).translate, false);
    }, afterFailure: primary });
    assert.equal(caught(() => setter(f)(node, false)), primary);
    assert.deepEqual(order, ['before', 'before', 'after']); assert.equal(f.dom.state(node).translate, false);
  }
});

test('capture/claim add no native, window-getter, clock, scheduling, storage, message or event-routing effects', () => {
  const old = fixture({ leaderboard: false, ownedPlay: true }), f = fixture({ ownedPlay: true });
  assert.deepEqual(f.calls, old.calls); assert.deepEqual(f.reads, old.reads);
  assert.equal(JSON.stringify(f.messages), JSON.stringify(old.messages)); assert.deepEqual(f.dom.hud.trace, []);
  assert.deepEqual(Reflect.ownKeys(f.native).filter(key => key !== 'leaderboardDom'), Reflect.ownKeys(old.native));
  for (const key of ['listeners', 'documentListeners']) assert.equal(
    JSON.stringify(f.edit[key].map(({ type, options }) => [type, options])),
    JSON.stringify(old.edit[key].map(({ type, options }) => [type, options])));
  let routed = 0; f.native.setInput(() => { routed++; });
  const event = f.edit.dispatch('keydown', { key: 'a', target: f.document });
  assert.equal(routed, 1); assert.equal(event.defaultPrevented, true);
  assert.equal(f.calls.clock, 0); assert.equal(f.calls.random, 0); assert.equal(f.calls.sockets, 0);
});

test('HUD absence short-circuits setter lookup; unarmed/late/critical gates gain no activation', () => {
  let translateReads = 0;
  const absent = fixture({ prepare(dom) {
    delete dom.hud.HTMLElement.prototype.style;
  }, setup(f) {
    Object.assign(f.realm, { translateOwner: f.dom.hud.HTMLElement.prototype,
      sawTranslate() { translateReads++; } });
    f.evaluate(`{
      const get = Object.getOwnPropertyDescriptor;
      Object.getOwnPropertyDescriptor = (owner, name) => {
        if (owner === translateOwner && name === 'translate') sawTranslate();
        return get(owner, name);
      };
    }`);
  } });
  assert.equal(translateReads, 0);
  assert.equal(Object.hasOwn(absent.native, 'hudDom'), false); assert.equal(Object.hasOwn(absent.native, 'leaderboardDom'), false);
  assert.equal(fixture({ armed: false }).gate, undefined);
  const late = fixture({ late: true }); assert.equal(late.gate.metadata().code, 'gate-unavailable');
  assert.equal(Object.hasOwn(late.gate, 'claim'), false);
  const critical = fixture({ prepare(dom) { delete dom.FenceEvent.prototype.stopImmediatePropagation; } });
  assert.equal(critical.gate.metadata().code, 'gate-unavailable'); assert.equal(critical.native, undefined);
});
