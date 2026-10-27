// Authored synthetic Document/Node operation doubles; no native/browser acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';

const gateSource = readFileSync(new URL('../extension/game-gate.js', import.meta.url), 'utf8');
const slot = Symbol.for('slither.client.gate.v1'), id = 'a'.repeat(32);
const operations = [['Document', 'createElement'], ['Document', 'createTextNode'],
  ['Node', 'appendChild'], ['Node', 'removeChild']];
const constructionKeys = operations.map(([, name]) => name);
const hudKeys = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling', 'isConnected',
  'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const primaries = [undefined, null, false, 0, '', Symbol('primary'), new Error('primary')];
const caught = operation => {
  let thrown = false, value;
  try { operation(); } catch (error) { thrown = true; value = error; }
  assert.equal(thrown, true, 'operation must throw'); return value;
};

function fixture({ hud = true, ownedHud = true, claim = true, armed = true, late = false, prepare, setup } = {}) {
  const dom = createGateTestDom({ hud, ownedHud }); prepare?.(dom);
  const calls = { scheduled: 0, clock: 0, random: 0, sockets: 0, storage: 0, paints: 0, reloads: 0, date: 0 };
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
    HTMLCanvasElement: Canvas, CanvasRenderingContext2D: Context, URL,
    Date: { now() { calls.date++; return 1000; } },
    Math: { random() { calls.random++; return 0.5; } }, performance: { now() { calls.clock++; return 0; } },
    requestAnimationFrame: schedule, cancelAnimationFrame() {}, setTimeout: schedule, clearTimeout() {},
    setInterval: schedule, clearInterval() {}, queueMicrotask: schedule,
    WebSocket: function () { calls.sockets++; throw new Error('Synthetic socket sentinel'); },
    addEventListener: events.addEventListener.bind(events), postMessage: value => messages.push(value) };
  const context = createContext(realm), evaluate = source => runInContext(source, context);
  evaluate('window = globalThis; top = globalThis;');
  const actualRealm = evaluate('globalThis');
  const edit = attachGateTestRealm(dom, realm, document, actualRealm);
  const reads = [];
  for (const [owner, name] of [[realm, 'top'], [realm, 'document'], [realm, 'location'], [initialLocation, 'href']]) {
    const original = Object.getOwnPropertyDescriptor(owner, name);
    Object.defineProperty(owner, name, { ...original, get() {
      reads.push(name); return Reflect.apply(original.get, this, []);
    } });
  }
  const f = { dom, edit, realm, document, context, actualRealm, evaluate, initialLocation, calls, messages, reads, events };
  setup?.(f);
  new Script(gateSource).runInContext(context);
  const gate = realm[slot], native = claim && gate?.claim ? gate.claim(id) : undefined;
  return { ...f, gate, native, cap: native?.ownedHudDom };
}

function frozenRecord(record, keys) {
  assert(record, 'required captured owned HUD construction capability');
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Reflect.ownKeys(record).sort(), [...keys].sort());
  for (const value of Object.values(Object.getOwnPropertyDescriptors(record))) {
    assert.equal(Object.hasOwn(value, 'value'), true);
    assert.equal(value.configurable, false); assert.equal(value.writable, false);
  }
}

test('complete opted-in descriptors publish the exact frozen sibling on the SAME one-shot claim', () => {
  const f = fixture();
  for (const [owner, name] of operations) {
    assert.equal(typeof Object.getOwnPropertyDescriptor(f.dom[owner].prototype, name)?.value, 'function',
      'baseline supplies every required OWN data-function descriptor');
  }
  frozenRecord(f.native.hudDom, ['schema', 'document', 'dom', 'isCurrentDocument']);
  frozenRecord(f.native.hudDom.dom, hudKeys);
  frozenRecord(f.cap, ['schema', 'document', 'dom']); frozenRecord(f.cap.dom, constructionKeys);
  assert.equal(f.cap.schema, 1); assert.equal(f.cap.document, f.document);
  assert.equal(f.cap.document, f.native.hudDom.document);
  assert.equal(Object.isFrozen(f.native), true); assert.equal(Object.isFrozen(f.document), false);
  assert.throws(() => f.gate.claim(id), /claimed/); assert.throws(() => f.gate.claim('b'.repeat(32)), /claimed/);
});

test('fixture construction is opted in without changing default or old HUD-only shapes/operations', () => {
  const plain = createGateTestDom(), ignored = createGateTestDom({ ownedHud: true });
  assert.deepEqual(Reflect.ownKeys(ignored), Reflect.ownKeys(plain));
  assert.deepEqual(Reflect.ownKeys(ignored.Node.prototype), Reflect.ownKeys(plain.Node.prototype));
  const old = createGateTestDom({ hud: true }), owned = createGateTestDom({ hud: true, ownedHud: true });
  assert.deepEqual(Reflect.ownKeys(owned), Reflect.ownKeys(old));
  assert.deepEqual(Reflect.ownKeys(owned.hud), Reflect.ownKeys(old.hud));
  for (const dom of [plain, ignored, old]) for (const name of ['createElement', 'createTextNode']) {
    assert.equal(Object.hasOwn(dom.Document.prototype, name), false);
  }
  const document = new old.Document(), element = new old.hud.HTMLElement('DIV');
  assert.equal(document.appendChild(element), element); assert.equal(document.removeChild(element), element);
  assert.deepEqual(old.hud.trace, [], 'old append/remove stay uninstrumented');
  assert.equal(Object.hasOwn(fixture({ ownedHud: false }).native, 'ownedHudDom'), false);
  assert.equal(Object.hasOwn(fixture({ hud: false }).native, 'ownedHudDom'), false);
});

test('captured operations create branded detached nodes, attach/adopt and remove exact child identities', () => {
  const f = fixture(), d = f.cap.dom, old = f.native.hudDom.dom;
  const parent = d.createElement(f.document, 'div'), child = d.createTextNode(f.document, 'text');
  assert.deepEqual(f.dom.hud.trace, [['createElement', f.document, 'div'], ['createTextNode', f.document, 'text']]);
  assert.equal(old.nodeType(parent), 1); assert.equal(old.localName(parent), 'div');
  assert.equal(old.nodeType(child), 3); assert.equal(f.dom.hud.character(child).data, 'text');
  for (const node of [parent, child]) {
    assert.equal(old.ownerDocument(node), f.document); assert.equal(old.parentNode(node), null);
    assert.equal(old.isConnected(node), false); assert.equal(Object.isFrozen(node), false);
  }
  f.dom.hud.trace.length = 0;
  assert.equal(d.appendChild(parent, child), child); assert.equal(d.appendChild(f.document, parent), parent);
  assert.deepEqual(f.dom.hud.trace, [['appendChild', parent, child], ['appendChild', f.document, parent]]);
  assert.equal(old.parentNode(child), parent); assert.equal(old.isConnected(child), true);
  const other = new f.dom.Document(), foreign = d.createElement(other, 'span');
  assert.equal(old.ownerDocument(foreign), other, 'same-fixture genuine other document is a native receiver');
  assert.equal(d.appendChild(foreign, parent), parent);
  assert.equal(old.ownerDocument(parent), other); assert.equal(old.ownerDocument(child), other);
  assert.equal(old.isConnected(child), false);
  assert.equal(d.removeChild(foreign, parent), parent); assert.equal(old.parentNode(parent), null);
  assert.equal(old.ownerDocument(child), other, 'remove retains adopted document');
  assert.throws(() => d.removeChild(foreign, parent), /not at parent/);
});

test('each wrapper forwards exact caller receiver and ONE supplied argument, with no coercion or options', () => {
  const tape = []; let result;
  const f = fixture({ prepare(dom) {
    for (const [owner, name] of operations) Object.defineProperty(dom[owner].prototype, name, {
      configurable: true, writable: true, value: function (...args) { tape.push([name, this, args]); return result; },
    });
  } });
  const argument = { toString() { assert.fail('wrapper coercion'); }, valueOf() { assert.fail('wrapper coercion'); } };
  const proxy = new Proxy({}, { get() { assert.fail('receiver inspection'); } });
  for (const name of constructionKeys) {
    assert.equal(f.cap.dom[name].length, 2);
    for (const receiver of [undefined, null, false, 0, '', Symbol('receiver'), argument, proxy]) {
      for (const value of [argument, undefined, null, false, 0, '', Symbol('argument')]) {
        for (result of [undefined, null, false, 0, '', Symbol('result'), argument]) {
          tape.length = 0;
          assert.equal(f.cap.dom[name](receiver, value, { forbidden: 'options' }), result);
          assert.equal(tape.length, 1); assert.equal(tape[0][0], name); assert.equal(tape[0][1], receiver);
          assert.equal(tape[0][2].length, 1); assert.equal(tape[0][2][0], value);
        }
      }
    }
    tape.length = 0; f.cap.dom[name](); assert.deepEqual(tape[0], [name, undefined, [undefined]]);
  }
});

test('branded doubles reject plain/prototype-derived/proxy/wrong-kind and other-fixture receivers/children', () => {
  const f = fixture(), d = f.cap.dom, other = createGateTestDom({ hud: true, ownedHud: true });
  const parent = d.createElement(f.document, 'div'), child = d.createTextNode(f.document, 'text');
  const foreignDocument = new other.Document(), foreignNode = new other.hud.HTMLElement('DIV');
  for (const name of constructionKeys) {
    const receiver = name.startsWith('create') ? f.document : parent;
    const argument = name === 'createElement' ? 'div' : name === 'createTextNode' ? 'text' : child;
    for (const bad of [undefined, null, false, 0, '', {}, Object.create(Object.getPrototypeOf(receiver)),
      new Proxy(receiver, {}), name.startsWith('create') ? parent : foreignNode, foreignDocument]) {
      assert.throws(() => d[name](bad, argument), TypeError, name);
    }
  }
  for (const name of ['appendChild', 'removeChild']) for (const bad of [{}, Object.create(child),
    new Proxy(child, {}), foreignNode, foreignDocument, undefined, null]) {
    assert.throws(() => d[name](parent, bad), TypeError, `${name} child`);
  }
});

for (const [owner, name] of operations) {
  test(`missing OWN ${owner}.${name} omits the sibling despite inherited replacement and never recaptures`, () => {
    let restore, inheritedCalls = 0;
    const f = fixture({ prepare(dom) {
      const target = dom[owner].prototype, original = Object.getOwnPropertyDescriptor(target, name);
      const inherited = Object.create(Object.getPrototypeOf(target));
      Object.defineProperty(inherited, name, { configurable: true, value() { inheritedCalls++; } });
      Object.setPrototypeOf(target, inherited); delete target[name];
      restore = () => Object.defineProperty(target, name, original);
    } });
    assert.equal(Object.hasOwn(f.native, 'ownedHudDom'), false); assert.equal(inheritedCalls, 0);
    frozenRecord(f.native.hudDom.dom, hudKeys); assert.equal(f.native.hudDom.isCurrentDocument(), true);
    assert.equal(f.gate.metadata().code, 'held'); restore();
    assert.equal(Object.hasOwn(f.native, 'ownedHudDom'), false); assert.equal(inheritedCalls, 0);
  });

  test(`accessor/wrong-kind ${owner}.${name} omits the entire sibling without invoking getters`, () => {
    for (const value of [undefined, null, false, 0, '', 7, {}, Symbol('nonfunction')]) {
      const f = fixture({ prepare(dom) {
        Object.defineProperty(dom[owner].prototype, name, { configurable: true, writable: true, value });
      } });
      assert.equal(Object.hasOwn(f.native, 'ownedHudDom'), false); frozenRecord(f.native.hudDom.dom, hudKeys);
    }
    for (const kind of ['get', 'set', 'both']) {
      const f = fixture({ prepare(dom) {
        delete dom[owner].prototype[name];
        const descriptor = { configurable: true };
        if (kind !== 'set') descriptor.get = () => assert.fail('method accessor invoked');
        if (kind !== 'get') descriptor.set = () => assert.fail('method setter invoked');
        Object.defineProperty(dom[owner].prototype, name, descriptor);
      } });
      assert.equal(Object.hasOwn(f.native, 'ownedHudDom'), false); frozenRecord(f.native.hudDom.dom, hudKeys);
    }
  });

  test(`every exact falsy descriptor-capture throw at ${owner}.${name} omits ONLY the new sibling`, () => {
    for (const primary of primaries) {
      const f = fixture({ setup(f) {
        Object.assign(f.realm, { captureOwner: f.dom[owner].prototype, captureName: name, captureFailure: primary });
        f.evaluate(`{
          const original = Object.getOwnPropertyDescriptor;
          Object.getOwnPropertyDescriptor = (owner, name) => {
            if (owner === captureOwner && name === captureName) throw captureFailure;
            return original(owner, name);
          };
        }`);
      } });
      assert.equal(Object.hasOwn(f.native, 'ownedHudDom'), false); frozenRecord(f.native.hudDom.dom, hudKeys);
      assert.equal(f.gate.metadata().code, 'held'); assert.equal(typeof f.native.registerNicknameEditField, 'function');
      assert.equal(f.realm.requestAnimationFrame(() => assert.fail('held callback')), 0);
      assert.throws(() => new f.realm.WebSocket(), /held/);
    }
  });
}

test('HUD absence short-circuits construction capture and never repairs either optional group', () => {
  let documentPrototypeReads = 0;
  const f = fixture({ setup(f) {
    delete f.dom.hud.HTMLElement.prototype.style;
    const original = f.dom.Document;
    f.realm.Document = { get prototype() { documentPrototypeReads++; return original.prototype; } };
  } });
  assert.equal(Object.hasOwn(f.native, 'hudDom'), false); assert.equal(Object.hasOwn(f.native, 'ownedHudDom'), false);
  assert.equal(documentPrototypeReads, 1, 'only the pre-existing editing activeElement capture reads it');
  assert.equal(f.gate.metadata().code, 'held');
});

test('throwing Document/Node prototype access omits sibling without disabling independent renderer capture', () => {
  for (const owner of ['Document', 'Node']) for (const primary of primaries) {
    let reads = 0;
    const f = fixture({ setup(f) {
      const original = f.dom[owner];
      f.realm[owner] = { get prototype() {
        // Editing reads first; HUD reads Node second; construction reads last.
        if (++reads === (owner === 'Node' ? 3 : 2)) throw primary;
        return original.prototype;
      } };
    } });
    assert.equal(Object.hasOwn(f.native, 'ownedHudDom'), false); frozenRecord(f.native.hudDom.dom, hudKeys);
    assert.equal(f.gate.metadata().code, 'held');
  }
});

test('captured prototype methods ignore late instance/prototype/constructor and intrinsic replacements', () => {
  const f = fixture(), d = f.cap.dom;
  const parent = d.createElement(f.document, 'div'), child = d.createTextNode(f.document, 'before');
  const trip = () => assert.fail('late native lookup');
  for (const [owner, name] of operations) {
    Object.defineProperty(f.dom[owner].prototype, name, { configurable: true, get: trip });
    for (const receiver of [f.document, parent, child]) Object.defineProperty(receiver, name, { configurable: true, get: trip });
  }
  for (const name of ['document', 'top', 'location']) Object.defineProperty(f.realm, name, { configurable: true, get: trip });
  for (const name of ['Document', 'Node', 'Element', 'HTMLElement', 'CharacterData']) f.realm[name] = trip;
  f.evaluate("Reflect.apply = Object.getOwnPropertyDescriptor = Object.getPrototypeOf = Object.freeze = () => { throw new Error('late intrinsic'); };");
  for (const node of [f.document, parent, child]) Object.setPrototypeOf(node, null);
  f.dom.hud.trace.length = 0;
  const next = d.createElement(f.document, 'span'), text = d.createTextNode(f.document, 'after');
  assert.equal(d.appendChild(parent, child), child); assert.equal(d.removeChild(parent, child), child);
  assert.equal(d.appendChild(next, text), text);
  assert.deepEqual(f.dom.hud.trace, [['createElement', f.document, 'span'], ['createTextNode', f.document, 'after'],
    ['appendChild', parent, child], ['removeChild', parent, child], ['appendChild', next, text]]);
  assert.equal(f.dom.hud.character(text).data, 'after');
  assert.equal(f.native.hudDom.dom.ownerDocument(text), f.document);
});

for (const name of constructionKeys) test(`${name} invocation preserves every exact thrown primary and gate state`, () => {
  const f = fixture(), d = f.cap.dom;
  const parent = d.createElement(f.document, 'div'), child = d.createTextNode(f.document, 'text');
  const receiver = name.startsWith('create') ? f.document : parent;
  const argument = name === 'createElement' ? 'div' : name === 'createTextNode' ? 'text' : child;
  for (const primary of primaries) {
    f.dom.hud.controls.set(name, { failure: primary }); f.dom.hud.trace.length = 0;
    assert.equal(caught(() => d[name](receiver, argument)), primary);
    assert.deepEqual(f.dom.hud.trace, [[name, receiver, argument]]);
    assert.equal(f.native.hudDom.isCurrentDocument(), true); assert.equal(f.gate.metadata().code, 'held');
  }
});

test('fixture after-effect hooks/falsy throws preserve completed mutations for outer cleanup tests', () => {
  const f = fixture(), d = f.cap.dom;
  for (const primary of primaries) for (const name of constructionKeys) {
    f.dom.hud.controls.clear();
    const parent = d.createElement(f.document, 'div'), child = d.createTextNode(f.document, 'text');
    if (name === 'removeChild') d.appendChild(parent, child);
    const receiver = name.startsWith('create') ? f.document : parent;
    const argument = name === 'createElement' ? 'span' : name === 'createTextNode' ? 'after' : child;
    let after = 0;
    f.dom.hud.controls.set(name, { afterHook(...args) {
      after++; assert.deepEqual(args, [receiver, argument]);
      if (name === 'appendChild') assert.equal(f.dom.state(child).parent, parent);
      if (name === 'removeChild') assert.equal(f.dom.state(child).parent, null);
    }, afterFailure: primary });
    assert.equal(caught(() => d[name](receiver, argument)), primary); assert.equal(after, 1);
  }
});

function registerEditing(f) {
  const parent = new f.dom.Element('div'), field = new f.dom.Input();
  // Directly arrange a labelled synthetic tree even when testing a missing append descriptor.
  f.document.children.push(parent); f.dom.state(parent).parent = f.document; f.dom.state(parent).owner = f.document;
  parent.children.push(field); f.dom.state(field).parent = parent; f.dom.state(field).owner = f.document;
  f.dom.state(f.document).active = field; f.native.setInput(() => {});
  const request = f.evaluate("({schema:1,element:null,parent:null,inputPolicy:'nickname-ascii-24'})");
  request.element = field; request.parent = parent;
  const lease = f.native.registerNicknameEditField(request);
  assert.equal(typeof lease.handleInput, 'function'); lease.unregister();
}

function profileSupport(f) {
  const unavailable = () => assert.fail('profile operation invoked');
  Object.assign(f.realm, { isSecureContext: true, fetch: unavailable,
    crypto: { subtle: { digest: unavailable } }, AbortController, Response, ReadableStream, ReadableStreamDefaultReader });
}

test('each missing construction descriptor preserves old renderer/editing/nickname/profile and critical holds', () => {
  for (const [owner, name] of operations) {
    const f = fixture({ prepare(dom) { delete dom[owner].prototype[name]; }, setup: profileSupport });
    assert.equal(Object.hasOwn(f.native, 'ownedHudDom'), false); frozenRecord(f.native.hudDom.dom, hudKeys);
    assert.equal(Object.hasOwn(f.native, 'liveProfile'), true); registerEditing(f);
    const text = new f.dom.hud.CharacterData('old'); f.native.hudDom.dom.setText(text, 'working');
    assert.equal(f.dom.hud.character(text).data, 'working');
    assert.equal(f.realm.setTimeout(() => assert.fail('held callback')), 0);
    assert.throws(() => new f.realm.WebSocket(), /held/);
    assert.equal(f.calls.clock, 0); assert.equal(f.calls.random, 0); assert.equal(f.calls.sockets, 0);
  }
});

test('construction availability is independent of editing/nickname/profile/router/source completion', () => {
  for (const missing of ['editing', 'nickname', 'profile', 'none']) {
    const f = fixture({ prepare(dom) {
      if (missing === 'editing') delete dom.Element.prototype.checkVisibility;
      if (missing === 'nickname') delete dom.Input.prototype.value;
    }, setup(f) {
      profileSupport(f); if (missing === 'profile') delete f.realm.crypto.subtle.digest;
    } });
    frozenRecord(f.cap.dom, constructionKeys); frozenRecord(f.native.hudDom.dom, hudKeys);
    assert.equal(Object.hasOwn(f.native, 'liveProfile'), missing !== 'profile');
    assert.equal(f.native.completed(), false); assert.equal(f.native.hudDom.isCurrentDocument(), true);
    f.native.setInput(() => {}); f.native.setInput(undefined);
    assert.equal(f.native.hudDom.isCurrentDocument(), true); assert.deepEqual(f.dom.hud.trace, []);
  }
});

test('new sibling capture and same claim add no document getter/DOM/source/clock/scheduling/listener/router effects', () => {
  const legacy = fixture({ ownedHud: false, claim: false }), f = fixture({ claim: false });
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(f.calls, legacy.calls); assert.deepEqual(f.reads, legacy.reads);
  assert.deepEqual(plain(f.messages), plain(legacy.messages)); assert.deepEqual(f.dom.hud.trace, []);
  for (const list of ['listeners', 'documentListeners']) assert.deepEqual(
    plain(f.edit[list].map(({ type, options }) => [type, options])),
    plain(legacy.edit[list].map(({ type, options }) => [type, options])));
  const before = { ...f.calls }, reads = [...f.reads], messages = [...f.messages];
  for (const name of ['playing', 'connecting', 'oef', 'ws', 'per_color_imgs', 'alcsc', 'fetch']) {
    Object.defineProperty(f.realm, name, { get() { assert.fail(`host/source read ${name}`); } });
  }
  assert.throws(() => f.gate.claim('b'.repeat(32)), /claimed/);
  const native = f.gate.claim(id), oldNative = legacy.gate.claim(id);
  assert.deepEqual(Reflect.ownKeys(native).filter(key => key !== 'ownedHudDom'), Reflect.ownKeys(oldNative));
  frozenRecord(native.ownedHudDom.dom, constructionKeys);
  assert.equal(native.ownedHudDom.document, native.hudDom.document);
  assert.deepEqual(f.calls, before); assert.deepEqual(f.reads, reads); assert.deepEqual(f.messages, messages);
  assert.deepEqual(f.dom.hud.trace, []); assert.throws(() => f.gate.claim(id), /claimed/);
  let routes = 0; native.setInput(() => { routes++; });
  assert.deepEqual(f.calls, before); assert.deepEqual(f.dom.hud.trace, []); assert.equal(routes, 0);
  const event = f.edit.dispatch('keydown', { key: 'a', target: f.document });
  assert.equal(routes, 1); assert.equal(event.defaultPrevented, true);
});

test('unarmed, late and critical-failure gates gain no claim or activation from the new group', () => {
  assert.equal(fixture({ armed: false }).gate, undefined);
  const late = fixture({ late: true }); assert.equal(late.gate.metadata().code, 'gate-unavailable');
  assert.equal(Object.hasOwn(late.gate, 'claim'), false);
  const critical = fixture({ prepare(dom) { delete dom.FenceEvent.prototype.stopImmediatePropagation; } });
  assert.equal(critical.gate.metadata().code, 'gate-unavailable'); assert.equal(critical.native, undefined);
  assert.equal(critical.realm.requestAnimationFrame(() => assert.fail('held callback')), 0);
});
