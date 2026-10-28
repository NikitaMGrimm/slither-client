// Authored native DOM/event/scheduler boundary doubles; no browser or Wasm acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';

const source = readFileSync(new URL('../extension/game-gate.js', import.meta.url), 'utf8');
const slot = Symbol.for('slither.client.gate.v1'), id = 'a'.repeat(32);
const names = ['inputValue', 'inputMaxLength', 'inputAutocompleteOff', 'buttonType', 'buttonDisabled'];
const descriptors = [['Input', 'value', 'get'], ['Input', 'maxLength', 'set'], ['Input', 'autocomplete', 'set'],
  ['Button', 'type', 'set'], ['Button', 'disabled', 'set']];
const primaries = [undefined, null, false, 0, '', Symbol('primary'), new Error('primary')];
const caught = operation => {
  let present = false, value;
  try { operation(); } catch (error) { present = true; value = error; }
  assert(present, 'expected thrown value'); return value;
};
function exact(record, keys) {
  assert(record, 'required captured owned Play capability');
  assert(Object.isFrozen(record)); assert.deepEqual(Reflect.ownKeys(record).sort(), [...keys].sort());
  for (const field of Object.values(Object.getOwnPropertyDescriptors(record))) assert(Object.hasOwn(field, 'value'));
}
function fixture({ ownedPlay = true, prepare, setup, scheduler } = {}) {
  const dom = createGateTestDom({ hud: true, ownedHud: true, ownedPlay }); prepare?.(dom);
  const calls = { scheduled: 0, clock: 0, random: 0, sockets: 0, reloads: 0 }, queued = [];
  class Storage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(key) ?? null; }
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
    drawImage() {} putImageData() {} fill() {} stroke() {} fillRect() {} strokeRect() {} clearRect() {} reset() {}
  }
  const document = new dom.Document(); document.readyState = 'loading';
  const sessionStorage = new Storage(), events = new EventTarget();
  const location = { href: 'https://slither.io/', reload() { calls.reloads++; } };
  sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1',
    id, url: location.href, expires: 26000 }));
  const schedule = () => { calls.scheduled++; return 1; };
  const realm = { document, location, sessionStorage, localStorage: new Storage(), Storage,
    HTMLCanvasElement: Canvas, CanvasRenderingContext2D: Context, URL,
    Date: { now: () => 1000 }, Math: { random() { calls.random++; return 0.5; } },
    performance: { now() { calls.clock++; return 0; } }, requestAnimationFrame: schedule, cancelAnimationFrame() {},
    setTimeout: schedule, clearTimeout() {}, setInterval: schedule, clearInterval() {},
    queueMicrotask(callback) { calls.scheduled++; if (scheduler) return scheduler(callback, queued); queued.push(callback); },
    WebSocket: function () { calls.sockets++; throw new Error('Synthetic socket sentinel'); },
    addEventListener: events.addEventListener.bind(events), postMessage() {} };
  const context = createContext(realm), evaluate = code => runInContext(code, context);
  evaluate('window = globalThis; top = globalThis;');
  const edit = attachGateTestRealm(dom, realm, document, evaluate('globalThis'));
  const f = { dom, edit, realm, document, context, evaluate, calls, queued };
  setup?.(f); new Script(source).runInContext(context);
  const gate = realm[slot], native = gate.claim(id);
  return { ...f, gate, native, cap: native.ownedPlayDom,
    flush() { for (const callback of queued.splice(0)) callback(); } };
}
function controls(f, onPlay = () => {}) {
  const construct = f.native.ownedHudDom.dom;
  const mount = construct.createElement(f.document, 'div');
  const endpointParent = construct.createElement(f.document, 'label'), nicknameParent = construct.createElement(f.document, 'label');
  const endpoint = construct.createElement(f.document, 'input'), nickname = construct.createElement(f.document, 'input');
  const button = construct.createElement(f.document, 'button');
  construct.appendChild(f.document, mount); construct.appendChild(mount, endpointParent); construct.appendChild(mount, nicknameParent);
  construct.appendChild(endpointParent, endpoint); construct.appendChild(nicknameParent, nickname); construct.appendChild(mount, button);
  const received = []; f.native.setInput(event => { received.push(event); });
  const nicknameRequest = Object.assign(Object.create(null), { schema: 1, element: nickname, parent: nicknameParent, inputPolicy: 'nickname-ascii-24' });
  const nicknameLease = f.native.registerNicknameEditField(nicknameRequest);
  const request = Object.assign(Object.create(null), { schema: 1, endpoint, endpointParent, button, buttonParent: mount, onPlay });
  return { mount, endpointParent, nicknameParent, endpoint, nickname, button, received, request, nicknameLease,
    bind() { const lease = f.cap.createControlsLease(request); lease.bind(); return lease; },
    click(properties = {}) { return f.edit.dispatch('click', { target: button, trusted: true, ...properties }); } };
}

test('all required descriptors produce the separate frozen five-operation group and preserve old HUD records', () => {
  const f = fixture();
  for (const [owner, name, kind] of descriptors) assert.equal(typeof Object.getOwnPropertyDescriptor(f.dom[owner].prototype, name)?.[kind], 'function');
  exact(f.native.hudDom.dom, ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling', 'isConnected',
    'localName', 'namespaceURI', 'style', 'setText', 'setStyle']);
  exact(f.native.ownedHudDom.dom, ['createElement', 'createTextNode', 'appendChild', 'removeChild']);
  exact(f.cap, ['schema', 'document', 'dom', 'createControlsLease']); exact(f.cap.dom, names);
  assert.equal(f.cap.document, f.document); assert.equal(f.cap.document, f.native.hudDom.document);
  assert.equal(f.cap.document, f.native.ownedHudDom.document); assert.throws(() => f.gate.claim(id));
});

test('registered endpoint defaults are admitted separately from the exact nickname lease', () => {
  const f = fixture(), h = controls(f);
  if (f.cap) h.bind();
  f.dom.state(f.document).active = h.endpoint;
  const event = f.edit.dispatch('keydown', { target: h.endpoint, key: 'a', code: 'KeyA' });
  assert.equal(event.defaultPrevented, false);
  assert.equal(h.received.length, 1); assert.equal(f.dom.inputValue(h.endpoint).gets, 0);
  assert.equal(f.dom.inputValue(h.nickname).gets, 0);
});

test('capture and inert preparation perform no native operations or scheduling; defaults retain prior inventories', () => {
  const plain = createGateTestDom(), hud = createGateTestDom({ hud: true, ownedHud: true });
  const ignored = createGateTestDom({ ownedPlay: true });
  assert.deepEqual(Reflect.ownKeys(plain), Reflect.ownKeys(ignored));
  assert.equal(Object.hasOwn(hud, 'Button'), false); assert.equal(Object.hasOwn(hud, 'ownedPlay'), false);
  const old = fixture({ ownedPlay: false }), f = fixture();
  assert.deepEqual(f.calls, old.calls); assert.deepEqual(f.dom.hud.trace, []); assert.deepEqual(f.dom.ownedPlay.trace, []);
  assert.equal(JSON.stringify(f.edit.listeners.map(({ type, options }) => [type, options])),
    JSON.stringify(old.edit.listeners.map(({ type, options }) => [type, options])));
  assert.deepEqual(Reflect.ownKeys(f.native).filter(key => key !== 'ownedPlayDom'), Reflect.ownKeys(old.native));
  const h = controls(f), before = { ...f.calls }; f.dom.hud.trace.length = f.dom.ownedPlay.trace.length = 0;
  const lease = f.cap.createControlsLease(h.request); exact(lease, ['bind', 'unregister']);
  assert.deepEqual(f.calls, before); assert.deepEqual(f.dom.hud.trace, []); assert.deepEqual(f.dom.ownedPlay.trace, []);
  lease.unregister(); lease.unregister(); assert.throws(() => lease.bind());
});

for (const [owner, property, kind] of descriptors) {
  test(`missing/accessor/wrong-kind OWN ${owner}.${property} omits only optional Play capture`, () => {
    for (const replacement of ['missing', 'data', 'accessor', 'wrong']) {
      let reads = 0;
      const f = fixture({ prepare(dom) {
        const target = dom[owner].prototype;
        if (replacement === 'missing') {
          const inherited = Object.create(Object.getPrototypeOf(target));
          Object.defineProperty(inherited, property, Object.getOwnPropertyDescriptor(target, property));
          Object.setPrototypeOf(target, inherited); delete target[property];
        } else {
          delete target[property];
          if (replacement === 'data') Object.defineProperty(target, property, { configurable: true, value() { reads++; } });
          else if (replacement === 'wrong') Object.defineProperty(target, property, { configurable: true, [kind]: undefined });
          else Object.defineProperty(target, property, { configurable: true, [kind === 'get' ? 'set' : 'get']() { reads++; } });
        }
      } });
      assert.equal(f.cap, undefined); assert.equal(reads, 0);
      assert.equal(Object.keys(f.native.hudDom.dom).length, 11); assert.equal(Object.keys(f.native.ownedHudDom.dom).length, 4);
      assert.equal(f.gate.metadata().code, 'held'); assert.equal(f.realm.setTimeout(() => assert.fail()), 0);
      assert.throws(() => new f.realm.WebSocket(), /held/);
    }
  });
}

test('five captured operations enforce closed arguments and native brands, preserving exact before/after faults', () => {
  const f = fixture(), h = controls(f), dom = f.cap.dom;
  const cases = [['inputValue', h.endpoint, undefined, () => f.dom.inputValue(h.endpoint).value],
    ['inputMaxLength', h.endpoint, 128, () => f.dom.inputValue(h.endpoint).maxLength],
    ['inputAutocompleteOff', h.endpoint, undefined, () => f.dom.inputValue(h.endpoint).autocomplete],
    ['buttonType', h.button, undefined, () => f.dom.ownedPlay.buttonState(h.button).type],
    ['buttonDisabled', h.button, true, () => f.dom.ownedPlay.buttonState(h.button).disabled]];
  for (const [name, receiver, argument] of cases) {
    for (const bad of [{}, Object.create(Object.getPrototypeOf(receiver)), new Proxy(receiver, {}), undefined, null, name.startsWith('input') ? h.button : h.endpoint]) {
      assert.throws(() => dom[name](bad, argument), TypeError, name);
    }
    for (const primary of primaries) for (const after of [false, true]) {
      f.dom.ownedPlay.controls.set(name, { [after ? 'afterFailure' : 'failure']: primary });
      assert.equal(caught(() => dom[name](receiver, argument)), primary);
    }
    f.dom.ownedPlay.controls.clear();
  }
  for (const value of [undefined, null, false, '24', 0, 25, 128n, {}, 24.5]) assert.throws(() => dom.inputMaxLength(h.endpoint, value));
  for (const value of [undefined, null, 0, 1, 'false', {}]) assert.throws(() => dom.buttonDisabled(h.button, value));
  f.dom.ownedPlay.trace.length = 0;
  assert.equal(dom.inputMaxLength(h.endpoint, 24), undefined); assert.equal(f.dom.inputValue(h.endpoint).maxLength, 24);
  dom.inputMaxLength(h.endpoint, 128); dom.inputAutocompleteOff(h.endpoint); dom.buttonType(h.button); dom.buttonDisabled(h.button, false);
  assert.equal(f.dom.inputValue(h.endpoint).autocomplete, 'off'); assert.equal(f.dom.ownedPlay.buttonState(h.button).type, 'button');
  assert.equal(f.dom.ownedPlay.buttonState(h.button).disabled, false);
  assert.deepEqual(f.dom.ownedPlay.trace.map(row => row[0]), ['inputMaxLength', 'inputMaxLength', 'inputAutocompleteOff', 'buttonType', 'buttonDisabled']);
});

test('captured operations ignore late owner/instance/intrinsic poison and preserve partial native effects', () => {
  const f = fixture(), h = controls(f), dom = f.cap.dom;
  const trip = () => assert.fail('late lookup');
  for (const [owner, name] of descriptors) {
    Object.defineProperty(f.dom[owner].prototype, name, { configurable: true, get: trip, set: trip });
    for (const receiver of [h.endpoint, h.button]) Object.defineProperty(receiver, name, { configurable: true, get: trip, set: trip });
  }
  f.evaluate('Reflect.apply = Object.getOwnPropertyDescriptor = Object.freeze = () => { throw new Error("late intrinsic"); };');
  dom.inputMaxLength(h.endpoint, 128); dom.inputAutocompleteOff(h.endpoint); dom.buttonType(h.button); dom.buttonDisabled(h.button, true);
  assert.equal(dom.inputValue(h.endpoint), '');
  assert.equal(f.dom.inputValue(h.endpoint).maxLength, 128); assert.equal(f.dom.ownedPlay.buttonState(h.button).disabled, true);
});

test('closed request/callback validation is inert and bounded, including bound async/generator callbacks', () => {
  const f = fixture(), h = controls(f);
  const access = { ...h.request }; Object.setPrototypeOf(access, null);
  Object.defineProperty(access, 'endpoint', { get() { assert.fail('accessor invoked'); } });
  const symbol = Object.assign(Object.create(null), h.request); symbol[Symbol()] = true;
  const extra = Object.assign(Object.create(null), h.request, { then() { assert.fail('then invoked'); } });
  for (const bad of [null, {}, [], Object.create(h.request), access, symbol, extra]) assert.throws(() => f.cap.createControlsLease(bad));
  for (const onPlay of [null, {}, async () => {}, function* () {}, async function* () {},
    (async () => {}).bind(null), (function* () {}).bind(null), (async function* () {}).bind(null)]) {
    assert.throws(() => f.cap.createControlsLease({ ...h.request, __proto__: null, onPlay }));
  }
  let calls = 0; const callback = () => { calls++; };
  let cursor = callback;
  for (let index = 0; index < 65; index++) { const next = Object.create(null); Object.setPrototypeOf(cursor, next); cursor = next; }
  assert.throws(() => f.cap.createControlsLease({ ...h.request, __proto__: null, onPlay: callback }));
  assert.equal(calls, 0);
});

test('binding is one-shot, requires router/current exact native topology and observes no values', () => {
  for (const mutate of [
    (f, h) => f.native.setInput(undefined), (f, h) => f.dom.state(h.endpoint).type = 'password',
    (f, h) => f.dom.state(h.button).tag = 'div', (f, h) => h.mount.removeChild(h.button),
    (f, h) => f.dom.state(h.endpoint).namespace = 'foreign', (f, h) => h.mount.appendChild(h.endpoint),
    (f, h) => h.request.endpoint = h.nickname, (f, h) => f.realm.location.href += '?stale',
  ]) {
    const f = fixture(), h = controls(f); mutate(f, h);
    const lease = f.cap.createControlsLease(h.request); assert.throws(() => lease.bind()); lease.unregister();
    assert.equal(f.dom.inputValue(h.endpoint).gets, 0); assert.equal(f.dom.inputValue(h.nickname).gets, 0);
  }
  const f = fixture(), h = controls(f), lease = h.bind();
  assert.throws(() => lease.bind()); assert.throws(() => h.bind()); lease.unregister(); lease.unregister();
  const next = h.bind(); lease.unregister();
  f.dom.state(f.document).active = h.endpoint;
  assert.equal(f.edit.dispatch('keydown', { target: h.endpoint, key: 'a' }).defaultPrevented, false);
  next.unregister(); assert.equal(f.edit.dispatch('keydown', { target: h.endpoint, key: 'a' }).defaultPrevented, true);
});

test('endpoint notifications stay local, raw records deliver once, and nickname correction stays exact', () => {
  const f = fixture(), h = controls(f); let routed = 0;
  f.native.setInput(event => { routed++; h.nicknameLease.handleInput(event); });
  // setInput consumes both registrations, so register current leases again.
  h.nicknameLease = f.native.registerNicknameEditField({ __proto__: null, schema: 1, element: h.nickname, parent: h.nicknameParent, inputPolicy: 'nickname-ascii-24' });
  h.bind(); f.dom.state(f.document).active = h.endpoint;
  for (const type of ['input', 'beforeinput', 'compositionstart', 'compositionend', 'paste', 'select', 'selectionchange']) {
    f.edit.dispatch(type, { target: type === 'selectionchange' ? f.document : h.endpoint, inputType: 'insertText' });
  }
  assert.equal(routed, 0); assert.equal(f.dom.inputValue(h.endpoint).gets, 0); assert.equal(f.dom.inputValue(h.nickname).gets, 0);
  for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove']) f.edit.dispatch(type, { target: h.endpoint, key: 'a' });
  assert.equal(routed, 5);
  f.dom.inputValue(h.nickname).value = 'a\u0000\u007f'; f.dom.state(f.document).active = h.nickname;
  f.edit.dispatch('input', { target: h.nickname }); assert.equal(routed, 6);
  assert.equal(f.dom.inputValue(h.nickname).value, 'a \u007f'); assert.equal(f.dom.inputValue(h.nickname).gets, 1);
  assert.equal(f.dom.inputValue(h.endpoint).gets, 0);
});

test('one gesture selects the actual member; forbidden keys/defaults remain denied', () => {
  const f = fixture(), h = controls(f); h.bind(); f.dom.state(f.document).active = h.endpoint;
  for (const key of ['Enter', 'Escape', 'F1']) assert.equal(f.edit.dispatch('keydown', { target: h.endpoint, key }).defaultPrevented, true);
  assert.equal(f.edit.dispatch('beforeinput', { target: h.endpoint, inputType: 'formatBold' }).defaultPrevented, true);
  assert.equal(f.edit.dispatch('beforeinput', { target: h.endpoint, inputType: 'insertText' }).defaultPrevented, false);
  assert.equal(f.edit.dispatch('mousedown', { target: h.endpoint, button: 0 }).defaultPrevented, false);
  assert.equal(f.edit.dispatch('mousemove', { target: h.mount, buttons: 1 }).defaultPrevented, false);
  assert.equal(f.edit.dispatch('mousedown', { target: h.nickname, button: 0 }).defaultPrevented, false);
  f.dom.state(f.document).active = h.nickname;
  assert.equal(f.edit.dispatch('mousemove', { target: h.mount, buttons: 1 }).defaultPrevented, false);
  f.edit.dispatch('mouseup', { target: h.mount, button: 0 });
  assert.equal(f.edit.dispatch('mousemove', { target: h.mount, buttons: 1 }).defaultPrevented, true);
});

test('current owned controls allow native Tab traversal and native button keys without scheduling a Play', () => {
  const f = fixture(); let plays = 0;
  const h = controls(f, () => { plays++; }), lease = h.bind();
  for (const target of [h.endpoint, h.nickname, h.button]) {
    f.dom.state(f.document).active = target;
    for (const type of ['keydown', 'keyup', 'keypress']) for (const shiftKey of [false, true]) {
      assert.equal(f.edit.dispatch(type, { target, key: 'Tab', code: 'Tab', shiftKey }).defaultPrevented, false);
    }
  }
  f.dom.state(f.document).active = h.button;
  for (const type of ['keydown', 'keyup', 'keypress']) for (const [key, code] of [['Enter', 'Enter'], [' ', 'Space'], ['Enter', 'NumpadEnter']]) {
    assert.equal(f.edit.dispatch(type, { target: h.button, key, code }).defaultPrevented, false);
  }
  f.flush(); assert.equal(plays, 0, 'only a subsequent native trusted click may request Play');
  h.click(); f.flush(); assert.equal(plays, 1);
  lease.unregister();
  assert.equal(f.edit.dispatch('keydown', { target: h.button, key: 'Enter' }).defaultPrevented, true);
});

test('owned keyboard defaults remain confined by focus, modifiers, availability and current topology', () => {
  for (const change of [
    (f, h) => { f.dom.state(f.document).active = h.endpoint; },
    (f, h) => { f.dom.state(h.button).disabled = true; },
    (f, h) => { f.dom.state(h.mount).inert = true; },
    (f, h) => { f.dom.state(h.button).visible = false; },
    (f, h) => { Reflect.apply(f.dom.Node.prototype.removeChild, h.mount, [h.button]); },
  ]) {
    const f = fixture(), h = controls(f); h.bind(); f.dom.state(f.document).active = h.button;
    change(f, h);
    assert.equal(f.edit.dispatch('keydown', { target: h.button, key: 'Enter' }).defaultPrevented, true);
    f.flush(); assert.equal(f.calls.sockets, 0);
  }
  const f = fixture(), h = controls(f); h.bind();
  for (const target of [h.endpoint, h.nickname, h.button]) {
    f.dom.state(f.document).active = target;
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      assert.equal(f.edit.dispatch('keydown', { target, key: 'Tab', ...modifiers }).defaultPrevented, true);
    }
    if (target !== h.button) assert.equal(f.edit.dispatch('keydown', { target, key: 'Enter' }).defaultPrevented, true);
  }
  f.dom.state(f.document).active = h.mount;
  assert.equal(f.edit.dispatch('keydown', { target: h.mount, key: 'Tab' }).defaultPrevented, true);
});

test('owned button keyboard defaults reject a non-synchronous router and post-router replacement', () => {
  for (const route of [() => Promise.resolve(), (f, h) => {
    Reflect.apply(f.dom.Node.prototype.removeChild, h.mount, [h.button]);
  }]) {
    const f = fixture(), h = controls(f);
    f.native.setInput(() => route(f, h)); h.bind(); f.dom.state(f.document).active = h.button;
    if (route.length === 0) assert.throws(() => f.edit.dispatch('keydown', { target: h.button, key: 'Enter' }), /undefined synchronously/);
    else assert.equal(f.edit.dispatch('keydown', { target: h.button, key: 'Enter' }).defaultPrevented, true);
    f.flush(); assert.equal(f.calls.scheduled, 0);
  }
});

test('unregistration during the final captured keyboard getter cannot retain native-default permission', () => {
  let hook = () => {};
  const f = fixture({ prepare(dom) {
    const original = Object.getOwnPropertyDescriptor(dom.Keyboard.prototype, 'key');
    Object.defineProperty(dom.Keyboard.prototype, 'key', { ...original, get() {
      hook(); return Reflect.apply(original.get, this, []);
    } });
  } });
  const h = controls(f), lease = h.bind(); f.dom.state(f.document).active = h.button;
  let reads = 0; hook = () => { if (++reads === 2) lease.unregister(); };
  assert.equal(f.edit.dispatch('keydown', { target: h.button, key: 'Tab' }).defaultPrevented, true);
  assert.equal(reads, 2); f.flush(); assert.equal(f.calls.scheduled, 0);
});

for (const [name, invalidate] of [
  ['detached', (f, h) => h.mount.removeChild(h.button)],
  ['disabled', (f, h) => { f.dom.state(h.button).disabled = true; }],
  ['unfocused', (f, h) => { f.dom.state(f.document).active = h.endpoint; }],
]) test(`final captured keyboard getter cannot allow the ${name} Play button default`, () => {
  let hook = () => {};
  const f = fixture({ prepare(dom) {
    const original = Object.getOwnPropertyDescriptor(dom.Keyboard.prototype, 'shiftKey');
    Object.defineProperty(dom.Keyboard.prototype, 'shiftKey', { ...original, get() {
      hook(); return Reflect.apply(original.get, this, []);
    } });
  } });
  const h = controls(f); h.bind(); f.dom.state(f.document).active = h.button;
  let reads = 0; hook = () => { if (++reads === 2) invalidate(f, h); };
  assert.equal(f.edit.dispatch('keydown', { target: h.button, key: 'Enter' }).defaultPrevented, true);
  assert.equal(reads, 2); f.flush(); assert.equal(f.calls.scheduled, 0);
});

test('final captured Tab getter cannot retain an unregistered nickname member', () => {
  let hook = () => {};
  const f = fixture({ prepare(dom) {
    const original = Object.getOwnPropertyDescriptor(dom.Keyboard.prototype, 'key');
    Object.defineProperty(dom.Keyboard.prototype, 'key', { ...original, get() {
      hook(); return Reflect.apply(original.get, this, []);
    } });
  } });
  const h = controls(f); h.bind(); f.dom.state(f.document).active = h.nickname;
  let reads = 0; hook = () => { if (++reads === 3) h.nicknameLease.unregister(); };
  assert.equal(f.edit.dispatch('keydown', { target: h.nickname, key: 'Tab' }).defaultPrevented, true);
  assert.equal(reads, 3); f.flush(); assert.equal(f.calls.scheduled, 0);
});

test('genuine exact primary click queues only after fence/routing unwind, once while pending', () => {
  let count = 0;
  const f = fixture({ scheduler(callback, queued) {
    assert.equal(h.received.length > 0, true); assert.equal(f.dom.eventData.get(h.received.at(-1)).prevented, true);
    queued.push(callback);
  } });
  const h = controls(f, function () { assert.equal(arguments.length, 0); count++; }); h.bind();
  h.click(); h.click(); assert.equal(count, 0); assert.equal(f.queued.length, 1);
  assert.deepEqual(f.dom.eventData.get(h.received[0]).trace, ['window-capture', 'stop', 'prevent']);
  f.flush(); assert.equal(count, 1); assert.equal(h.received.length, 2);
});

for (const [label, properties] of [
  ['untrusted', { trusted: false }], ['missing', { trustedDescriptor: 'missing' }], ['data', { trustedDescriptor: 'data' }],
  ['configurable', { trustedDescriptor: 'configurable' }], ['setter', { trustedDescriptor: 'setter' }],
  ['nonprimary', { button: 1 }], ['earlier cancellation', { prevented: true }],
]) test(`Play refuses ${label} event boundary`, () => {
  let count = 0; const f = fixture(), h = controls(f, () => { count++; }); h.bind();
  h.click(properties); f.flush(); assert.equal(count, 0); assert.equal(f.calls.scheduled, 0); assert.equal(h.received.length, 1);
});

test('wrong/descendant/disabled/inert/invisible targets cannot schedule Play', () => {
  for (const mutate of [
    (f, h) => ({ target: h.endpoint }), (f, h) => ({ target: h.mount }),
    (f, h) => { f.dom.state(h.button).disabled = true; },
    (f, h) => { f.dom.state(h.mount).inert = true; }, (f, h) => { f.dom.state(h.button).visible = false; },
    (f, h) => { h.mount.removeChild(h.button); },
  ]) {
    let count = 0; const f = fixture(), h = controls(f, () => { count++; }); h.bind();
    h.click(mutate(f, h)); f.flush(); assert.equal(count, 0); assert.equal(f.calls.scheduled, 0);
  }
});

test('ticket invalidation covers unregister, same-router setInput, pagehide, reload and stale document', () => {
  for (const invalidate of [
    (f, h, lease) => lease.unregister(), (f, h) => f.native.setInput(() => {}),
    f => f.edit.listeners.find(entry => entry.type === 'pagehide').handler(), f => f.native.ordinaryReload(),
    f => { f.realm.location.href += '?stale'; }, f => { f.realm.document = new f.dom.Document(); },
  ]) {
    let count = 0; const f = fixture(), h = controls(f, () => { count++; }), lease = h.bind();
    h.click(); assert.equal(f.queued.length, 1); invalidate(f, h, lease); f.flush(); assert.equal(count, 0);
  }
});

test('synchronous and throwing schedulers leave no live future ticket or callback', () => {
  for (const primary of primaries) for (const mode of ['before', 'after', 'sync', 'caught-sync']) {
    let count = 0;
    const f = fixture({ scheduler(callback, queued) {
      if (mode === 'before') throw primary;
      queued.push(callback);
      if (mode === 'after') throw primary;
      if (mode === 'sync') callback();
      if (mode === 'caught-sync') { try { callback(); } catch {} }
    } });
    const h = controls(f, () => { count++; }); h.bind();
    const error = caught(() => h.click());
    if (mode === 'before' || mode === 'after') assert.equal(error, primary);
    else assert.match(error.message, /Asynchronous/);
    f.flush(); assert.equal(count, 0);
  }
});

test('router/fence failures retain every falsy primary, revoke permissions and poison late tickets', () => {
  for (const primary of primaries) for (const boundary of ['router', 'stopFailure', 'preventFailure', 'afterPreventFailure', 'getTrustedFailure']) {
    let count = 0; const f = fixture(), h = controls(f, () => { count++; });
    if (boundary === 'router') f.native.setInput(() => { throw primary; });
    // setInput invalidates nickname too; controls do not need a nickname policy to route raw click.
    h.bind();
    const secondary = Symbol('secondary');
    const properties = boundary === 'router' ? { preventFailure: secondary } : { [boundary]: primary };
    assert.equal(caught(() => h.click(properties)), primary); f.flush(); assert.equal(count, 0);
    if (boundary === 'router') caught(() => h.click()); else h.click();
    f.flush(); assert.equal(count, 0);
  }
});

test('caught nested dispatch, caught bind reentry and unregister during bind cannot publish permission', () => {
  const f = fixture(), h = controls(f); let nested = false;
  f.native.setInput(() => { if (!nested) { nested = true; try { h.click(); } catch {} } });
  h.bind(); assert.match(caught(() => h.click()).message, /reentry/); f.flush(); assert.equal(f.calls.scheduled, 0);
  for (const mode of ['bind', 'unregister']) {
    const f = fixture(), h = controls(f), lease = f.cap.createControlsLease(h.request); let once = false;
    f.dom.hud.controls.set('parentNode', { hook() {
      if (once) return; once = true;
      if (mode === 'bind') { try { lease.bind(); } catch {} } else lease.unregister();
    } });
    assert.throws(() => lease.bind()); f.dom.hud.controls.clear();
    f.dom.state(f.document).active = h.endpoint;
    assert.equal(f.edit.dispatch('keydown', { target: h.endpoint, key: 'a' }).defaultPrevented, true);
  }
});

test('first caught reentry remains primary through router and native secondary failures', () => {
  for (const secondary of primaries) for (const place of ['router', 'prevent']) {
    const f = fixture(), h = controls(f); let first;
    const reenter = () => { try { h.click(); } catch (error) { first = error; } throw secondary; };
    if (place === 'router') f.native.setInput(reenter);
    h.bind();
    const primary = caught(() => h.click(place === 'prevent' ? { preventHook: reenter } : {}));
    assert(first); assert.equal(primary, first); assert.match(primary.message, /reentry/);
    f.flush(); assert.equal(f.calls.scheduled, 0);
  }
});

for (const [owner, property] of descriptors) test(`descriptor capture throws at ${owner}.${property} omit Play without effects or recapture`, () => {
  for (const primary of primaries) {
    const f = fixture({ setup(f) {
      Object.assign(f.realm, { captureOwner: f.dom[owner].prototype, captureProperty: property, captureFailure: primary });
      f.evaluate(`{
        const original = Object.getOwnPropertyDescriptor;
        let visits = 0;
        Object.getOwnPropertyDescriptor = (owner, name) => {
          if (owner === captureOwner && name === captureProperty
            && ++visits === (captureProperty === 'value' ? 2 : 1)) throw captureFailure;
          return original(owner, name);
        };
      }`);
    } });
    assert.equal(f.cap, undefined); assert.equal(f.gate.metadata().code, 'held');
    assert.equal(Object.keys(f.native.hudDom.dom).length, 11); assert.equal(Object.keys(f.native.ownedHudDom.dom).length, 4);
    assert.equal(typeof f.native.registerNicknameEditField, 'function');
    assert.deepEqual(f.dom.hud.trace, []); assert.deepEqual(f.dom.ownedPlay.trace, []);
    assert.deepEqual(f.calls, { scheduled: 0, clock: 0, random: 0, sockets: 0, reloads: 0 });
  }
});

test('endpoint notifications do not observe nickname native topology or either field value', () => {
  const f = fixture(), h = controls(f); h.bind(); f.dom.state(f.document).active = h.endpoint;
  f.dom.hud.controls.set('nodeType', { hook(receiver) { assert.notEqual(receiver, h.nickname); assert.notEqual(receiver, h.nicknameParent); } });
  for (const type of ['beforeinput', 'input', 'paste', 'compositionstart', 'select', 'selectionchange']) {
    f.edit.dispatch(type, { target: type === 'selectionchange' ? f.document : h.endpoint, inputType: 'insertText' });
  }
  assert.equal(h.received.length, 0); assert.equal(f.dom.inputValue(h.nickname).gets, 0); assert.equal(f.dom.inputValue(h.endpoint).gets, 0);
});

test('callback consumes the pending ticket before invocation, enforces undefined and allows idle unregistration', () => {
  let count = 0, lease;
  const f = fixture(), h = controls(f, () => { count++; lease.unregister(); f.native.setInput(undefined); });
  lease = h.bind(); h.click(); f.flush(); assert.equal(count, 1); h.click(); f.flush(); assert.equal(count, 1);
  for (const result of [null, false, 0, '', {}, Promise.resolve()]) {
    const f = fixture(), h = controls(f, () => result); h.bind(); h.click();
    assert.match(caught(() => f.flush()).message, /return undefined/);
  }
});

test('post-router and post-fence mutations deny scheduling while preserving raw delivery', () => {
  for (const boundary of ['router', 'fence']) for (const mutate of [
    (f, h) => f.native.setInput(() => {}), (f, h) => f.native.setInput(undefined),
    (f, h) => { f.realm.location.href += '?stale'; }, (f, h) => { f.realm.document = new f.dom.Document(); },
    (f, h) => { f.dom.state(h.button).disabled = true; }, (f, h) => { f.dom.state(h.mount).inert = true; },
    (f, h) => { f.dom.state(h.button).visible = false; }, (f, h) => { h.mount.removeChild(h.button); },
  ]) {
    let count = 0, routes = 0; const f = fixture(), h = controls(f, () => { count++; });
    if (boundary === 'router') f.native.setInput(() => { routes++; mutate(f, h); });
    h.bind();
    h.click(boundary === 'fence' ? { afterPreventHook: () => mutate(f, h) } : {});
    f.flush(); assert.equal(count, 0); assert.equal(f.calls.scheduled, 0);
    assert.equal(boundary === 'router' ? routes : h.received.length, 1);
  }
});

test('deferred checks revoke stale or failing tickets before callback and preserve exact primaries', () => {
  for (const primary of primaries) {
    let count = 0; const f = fixture(), h = controls(f, () => { count++; }); h.bind(); h.click();
    f.dom.hud.controls.set('parentNode', { failure: primary });
    assert.equal(caught(() => f.flush()), primary); assert.equal(count, 0);
    f.dom.hud.controls.clear(); f.flush(); h.click(); f.flush(); assert.equal(count, 0);
  }
  for (const mutate of [
    (f, h) => { f.dom.state(h.button).disabled = true; }, (f, h) => { f.dom.state(h.button).visible = false; },
    (f, h) => { f.dom.state(h.mount).inert = true; }, (f, h) => h.mount.removeChild(h.button),
  ]) {
    let count = 0; const f = fixture(), h = controls(f, () => { count++; }); h.bind(); h.click(); mutate(f, h);
    f.flush(); assert.equal(count, 0);
  }
});

test('every control setter preserves native before/after partial effects and failure presence', () => {
  for (const primary of primaries) for (const after of [false, true]) {
    for (const [name, argument, initial, expected, read] of [
      ['inputMaxLength', 128, 24, 128, (f, h) => f.dom.inputValue(h.endpoint).maxLength],
      ['inputAutocompleteOff', undefined, 'on', 'off', (f, h) => f.dom.inputValue(h.endpoint).autocomplete],
      ['buttonType', undefined, 'submit', 'button', (f, h) => f.dom.ownedPlay.buttonState(h.button).type],
      ['buttonDisabled', true, false, true, (f, h) => f.dom.ownedPlay.buttonState(h.button).disabled],
    ]) {
      const f = fixture(), h = controls(f), receiver = name.startsWith('input') ? h.endpoint : h.button;
      f.dom.inputValue(h.endpoint).maxLength = 24; f.dom.inputValue(h.endpoint).autocomplete = 'on';
      let hooks = 0, afterHooks = 0;
      f.dom.ownedPlay.controls.set(name, { hook() { hooks++; }, afterHook() { afterHooks++; }, [after ? 'afterFailure' : 'failure']: primary });
      assert.equal(caught(() => f.cap.dom[name](receiver, argument)), primary);
      assert.equal(read(f, h), after ? expected : initial); assert.equal(hooks, 1); assert.equal(afterHooks, after ? 1 : 0);
      assert.equal(f.dom.ownedPlay.trace.filter(row => row[0] === name).length, 1);
    }
  }
});

test('captured receiver failures still deliver original mouse/key records once after native eligibility failure', () => {
  for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'click']) for (const primary of primaries) {
    const f = fixture(), h = controls(f); h.bind();
    f.dom.hud.controls.set('ownerDocument', { failure: primary });
    assert.equal(caught(() => f.edit.dispatch(type, { target: h.endpoint, key: 'a' })), primary);
    assert.equal(h.received.length, 1); assert.equal(f.dom.inputValue(h.nickname).gets, 0);
    assert.equal(f.dom.inputValue(h.endpoint).gets, 0); assert.equal(f.calls.scheduled, 0);
  }
});

test('brand and exact event identity are required; no construction probe or prototype isTrusted fallback', () => {
  let count = 0; const f = fixture(), h = controls(f, () => { count++; }); h.bind();
  const sink = f.edit.listeners.find(entry => entry.type === 'click').handler;
  for (const event of [{ type: 'click', target: h.button, isTrusted: true }, Object.create(f.dom.Mouse.prototype), new Proxy(f.edit.make('click', { target: h.button, trusted: true }), {})]) {
    assert.throws(() => sink(event));
  }
  // Rebind after native receiver failures revoked the registration.
  h.bind(); const inherited = f.edit.make('click', { target: h.button, trusted: true, trustedDescriptor: 'missing' });
  Object.defineProperty(f.dom.Mouse.prototype, 'isTrusted', { configurable: true, get() { assert.fail('prototype fallback'); } });
  f.edit.deliver(inherited); f.flush(); assert.equal(count, 0);
  const inventory = [...f.edit.listeners];
  f.realm.Event = function () { assert.fail('construction probe'); };
  h.click(); f.flush(); assert.equal(count, 1); assert.deepEqual(f.edit.listeners, inventory);
});
