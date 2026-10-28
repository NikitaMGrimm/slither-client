import { createHudHistoryDouble } from './hud-history-double.mjs';
// Original authored native-receiver/propagation tests, not native DOM acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, after } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';
import { createClientInput } from '../web/client-input.mjs';
import { createStockHostSnapshot } from '../web/stock-host-snapshot.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockEntityAssets } from '../web/stock-food-provider.mjs';
import { desktopBackingSize } from '../web/desktop-layout.mjs';
import { createStockGameplay } from '../web/stock-gameplay.mjs';

const networkGlobals = ['fetch', 'WebSocket'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
let networkCalls = 0;
for (const [name] of networkGlobals) Object.defineProperty(globalThis, name, { configurable: true, writable: true,
  value() { networkCalls++; throw new Error('Real network forbidden in authored nickname tests'); } });
after(() => {
  for (const [name, descriptor] of networkGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
  assert.equal(networkCalls, 0);
});

const gateSource = readFileSync(new URL('../extension/game-gate.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('./game-bootstrap.test.mjs', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function fixture('), source.indexOf("\ntest('an unarmed"));
const makeFixture = new Script(`(function(gateSource,Script,createContext,runInContext,assert,createGateTestDom,attachGateTestRealm,createHudHistoryDouble){
  ${functions}\nreturn {fixture,wasmDouble};})`).runInThisContext();
const { fixture: fixtureFactory, wasmDouble } = makeFixture(gateSource, Script, createContext, runInContext, assert,
  createGateTestDom, attachGateTestRealm, createHudHistoryDouble);

function harness({ prepare, contextSetup, ...options } = {}) {
  const fixture = prepare || contextSetup ? makeFixture(gateSource, Script, realm => {
    const context = createContext(realm); contextSetup?.(context); return context;
  }, runInContext, assert, () => { const dom = createGateTestDom(); prepare?.(dom); return dom; }, attachGateTestRealm, createHudHistoryDouble).fixture : fixtureFactory;
  const f = fixture(options), native = f.gate.claim(f.gate.metadata().id);
  const parent = f.document.createElement('div'), field = f.document.createElement('input');
  f.document.body.appendChild(parent); parent.appendChild(field);
  f.edit.state(f.document).active = field;
  let lease, route = event => lease?.handleInput?.(event);
  const router = event => route(event);
  native.setInput(router);
  const record = (policy = true) => {
    const value = runInContext('({schema:1,element:null,parent:null})', f.context);
    value.element = field; value.parent = parent;
    if (policy) value.inputPolicy = 'nickname-ascii-24';
    return value;
  };
  const register = (policy = true) => { lease = native.registerNicknameEditField(record(policy)); return lease; };
  return { f, native, field, parent, record, register, router,
    get value() { return f.edit.inputValue(field); },
    get lease() { return lease; }, route(next) { route = next; },
    input(properties = {}) { return f.edit.dispatch('input', { target: field, ...properties }); } };
}

function caught(operation) {
  let present = false, value;
  try { operation(); } catch (error) { present = true; value = error; }
  assert(present, 'expected a thrown value'); return value;
}

test('selected four-field policy adds only the frozen lease-bound input method', () => {
  const h = harness(), lease = h.register();
  assert.equal(Object.isFrozen(lease), true);
  assert.deepEqual(Object.keys(lease), ['unregister', 'handleInput']);
  assert.equal(typeof lease.handleInput, 'function');
  assert.equal(lease.unregister(), undefined);
  assert.deepEqual(Object.keys(h.register(false)), ['unregister']);
});

test('missing either or both own native value captures disables only the explicit policy', () => {
  for (const remove of ['get', 'set', 'both', 'descriptor']) {
    const h = harness({ prepare(dom) {
      const owner = dom.Input.prototype, value = Object.getOwnPropertyDescriptor(owner, 'value');
      if (remove === 'descriptor') {
        delete owner.value;
        Object.defineProperty(dom.Element.prototype, 'value', { get() { assert.fail('alternate value owner used'); }, set() { assert.fail(); } });
      }
      else Object.defineProperty(owner, 'value', { configurable: true,
        get: remove === 'get' || remove === 'both' ? undefined : value.get,
        set: remove === 'set' || remove === 'both' ? undefined : value.set });
    } });
    assert.throws(() => h.register(), /policy unavailable/);
    Object.defineProperty(h.f.edit.Input.prototype, 'value', { configurable: true, get() { return ''; }, set() {} });
    assert.throws(() => h.register(), /policy unavailable/, 'late capture cannot recover policy');
    const old = h.register(false);
    assert.deepEqual(Object.keys(old), ['unregister']);
    assert.equal(h.f.edit.dispatch('keydown', { target: h.field, key: 'a', code: 'KeyA' }).defaultPrevented, false);
    assert.equal(h.value.gets, 0); assert.equal(h.value.sets, 0);
  }
});

test('policy grammar is closed own-data current-realm and never probes getters, then or coercion', () => {
  const h = harness(); let touches = 0;
  const trip = () => { touches++; throw new Error('unselected caller capability'); };
  const records = [null, [], Promise.resolve(), Object.create(h.record()), { ...h.record() }];
  for (const policy of [undefined, null, '', 'nickname-ascii-23', 1, false,
    { toString: trip, valueOf: trip, [Symbol.toPrimitive]: trip }, new String('nickname-ascii-24')]) {
    const record = h.record(); record.inputPolicy = policy; records.push(record);
  }
  for (const name of ['schema', 'element', 'parent', 'inputPolicy']) {
    const record = h.record(); Object.defineProperty(record, name, { get: trip }); records.push(record);
  }
  const symbol = h.record(); symbol[Symbol()] = 1; records.push(symbol);
  for (const name of ['then', 'extra']) {
    const record = h.record(); Object.defineProperty(record, name, { get: trip }); records.push(record);
  }
  const thenable = runInContext('({schema:1,element:null,parent:null,then:null})', h.f.context);
  Object.defineProperty(thenable, 'then', { get: trip }); records.push(thenable);
  for (const record of records) assert.throws(() => h.native.registerNicknameEditField(record));
  assert.equal(touches, 0); assert.equal(h.value.gets, 0); assert.equal(h.value.sets, 0);
  const record = h.record(); Object.setPrototypeOf(record, null);
  const lease = h.native.registerNicknameEditField(record);
  assert.equal(typeof lease.handleInput, 'function'); lease.unregister();
  h.register();
});

test('native value receiver is exact and registration does not inspect or sanitize existing value', () => {
  const h = harness(); h.value.value = '\u00e9'.repeat(30);
  const nativeValue = Object.getOwnPropertyDescriptor(h.f.edit.Input.prototype, 'value');
  for (const receiver of [h.f.edit.Input.prototype, Object.create(h.f.edit.Input.prototype), new Proxy(h.field, {})]) {
    assert.throws(() => Reflect.apply(nativeValue.get, receiver, []), /receiver/);
    assert.throws(() => Reflect.apply(nativeValue.set, receiver, ['x']), /receiver/);
  }
  h.register(); assert.equal(h.value.gets, 0); assert.equal(h.value.sets, 0);
  assert.equal(h.value.value, '\u00e9'.repeat(30));
  assert.equal(Object.hasOwn(h.native, 'getValue'), false); assert.equal(Object.hasOwn(h.native, 'setValue'), false);
});

test('exact authored code-unit and prefix witnesses write only when correction differs', () => {
  const examples = [
    ['', '', 0], ['  a  Z!?09  ', '  a  Z!?09  ', 0], ['1234567', '1234567', 0],
    ['\x1f \x7f\x80', '  \x7f ', 1], ['\0\t\n\r', '    ', 1], ['\u00e9\u0100\uffff', '   ', 1],
    ['a\ud83d\ude00b', 'a  b', 1], ['\ud800x\udfff', ' x ', 1],
    ['A'.repeat(24), 'A'.repeat(24), 0], ['B'.repeat(25), 'B'.repeat(24), 1],
    ['a'.repeat(23) + '\ud83d\ude00', 'a'.repeat(23) + ' ', 1],
    ['a'.repeat(22) + '\ud83d\ude00z', 'a'.repeat(22) + '  ', 1],
    ['a'.repeat(24) + '\u00e9'.repeat(100000), 'a'.repeat(24), 1],
  ];
  for (const [original, expected, writes] of examples) {
    const h = harness(); h.register(); h.value.value = original;
    const event = h.input();
    assert.equal(event.defaultPrevented, true, 'input remains CANCEL notification');
    assert.equal(h.value.value, expected); assert.equal(h.value.gets, 1); assert.equal(h.value.sets, writes);
    assert.deepEqual(h.value.trace, writes ? [['get', h.field], ['set', h.field, expected]] : [['get', h.field]]);
    h.input(); assert.equal(h.value.gets, 2); assert.equal(h.value.sets, writes, 'no redundant second write');
  }
});

test('every admitted unit 32..127 is conserved at each length 0..24 including literal DEL', () => {
  const h = harness(); h.register();
  for (let unit = 32; unit <= 127; unit++) for (let length = 0; length <= 24; length++) {
    const value = String.fromCharCode(unit).repeat(length); h.value.value = value;
    const before = h.value.gets; h.input();
    assert.equal(h.value.value, value); assert.equal(h.value.gets, before + 1); assert.equal(h.value.sets, 0);
  }
});

test('processing visits at most 24 units through captured ordinary string intrinsics', () => {
  const h = harness({ contextSetup(context) {
    runInContext(`unitCalls=0; charCalls=0;
      { const code=String.prototype.charCodeAt, char=String.prototype.charAt;
        String.prototype.charCodeAt=function(i){unitCalls++;return Reflect.apply(code,this,[i]);};
        String.prototype.charAt=function(i){charCalls++;return Reflect.apply(char,this,[i]);}; }`, context);
  } });
  h.register(); h.value.value = 'a'.repeat(1000000);
  runInContext(`String.prototype.charCodeAt=String.prototype.charAt=function(){throw new Error('late string operation');};`, h.f.context);
  h.input(); assert.equal(h.value.value, 'a'.repeat(24));
  assert.equal(runInContext('unitCalls', h.f.context), 24); assert.equal(runInContext('charCalls', h.f.context), 24);
});

test('captured getter/setter ignore late instance, prototype, Reflect and selection operations', () => {
  const h = harness(); let touches = 0;
  const trip = () => { touches++; throw new Error('late field capability'); };
  for (const name of ['value', 'selectionStart', 'selectionEnd', 'selectionDirection', 'maxLength', 'style']) {
    Object.defineProperty(h.field, name, { get: trip, set: trip });
  }
  for (const name of ['focus', 'blur', 'select', 'setSelectionRange', 'setRangeText', 'dispatchEvent']) h.field[name] = trip;
  Object.defineProperty(h.f.edit.Input.prototype, 'value', { configurable: true, get: trip, set: trip });
  h.register();
  h.value.value = '\u00e9';
  runInContext(`Reflect.apply=()=>{throw new Error('late apply');};
    String.prototype.charCodeAt=String.prototype.charAt=()=>{throw new Error('late string');};`, h.f.context);
  const event = h.f.edit.make('input', { target: h.field });
  for (const name of ['type', 'target', 'defaultPrevented', 'inputType', 'isComposing', 'data']) {
    Object.defineProperty(event, name, { get: trip });
  }
  h.f.edit.deliver(event); assert.equal(h.value.value, ' '); assert.equal(h.value.gets, 1); assert.equal(h.value.sets, 1);
  assert.equal(touches, 0);
});

test('native getter requires primitive string and never coerces incompatible values', () => {
  let touches = 0;
  const object = { toString() { touches++; }, valueOf() { touches++; }, get then() { touches++; } };
  for (const original of [undefined, null, false, 0, object, new String('x'), Symbol('x')]) {
    const h = harness(); const old = h.register(); h.value.value = original;
    assert.match(String(caught(() => h.input())), /Native nickname string required/);
    assert.equal(h.value.gets, 1); assert.equal(h.value.sets, 0);
    assert.equal(old.handleInput(object), undefined);
  }
  assert.equal(touches, 0);
});

test('only the exact active delivered event is admitted; stale calls inspect nothing and cannot revoke newer lease', () => {
  for (const when of ['before', 'wrong', 'after', 'deferred']) {
    const h = harness(), old = h.register(); let saved, deferred;
    const malicious = new Proxy({}, { get() { assert.fail('argument inspected'); }, getPrototypeOf() { assert.fail(); } });
    if (when === 'before') assert.match(String(caught(() => old.handleInput(malicious))), /delivery required/);
    else {
      h.route(event => {
        saved = event;
        if (when === 'wrong') old.handleInput(malicious);
        else { old.handleInput(event); deferred = () => old.handleInput(event); }
      });
      if (when === 'wrong') assert.match(String(caught(() => h.input())), /delivery required/);
      else { h.input(); assert.match(String(caught(when === 'after' ? () => old.handleInput(saved) : deferred)), /delivery required/); }
    }
    const reads = h.value.gets, writes = h.value.sets;
    const next = h.register();
    assert.equal(old.handleInput(malicious), undefined); assert.equal(old.unregister(), undefined);
    assert.equal(h.value.gets, reads); assert.equal(h.value.sets, writes);
    h.route(event => next.handleInput(event)); h.input(); assert.equal(h.value.gets, reads + 1);
  }
});

test('duplicate input handling rejects before a second read or write within one delivery', () => {
  const h = harness(), old = h.register(); h.value.value = '\u00e9';
  h.route(event => { old.handleInput(event); old.handleInput(event); });
  assert.match(String(caught(() => h.input())), /already handled/);
  assert.equal(h.value.gets, 1); assert.equal(h.value.sets, 1);
  assert.equal(old.handleInput({}), undefined);
  const next = h.register(); h.route(event => next.handleInput(event)); h.input();
  assert.equal(h.value.gets, 2); assert.equal(h.value.sets, 1);
});

test('separate deliveries may reuse the same synthetic event object without retained history', () => {
  const h = harness(); h.register(); const event = h.f.edit.make('input', { target: h.field });
  h.value.value = '\u00e9'; h.f.edit.deliver(event); h.value.value = '\t'; h.f.edit.deliver(event);
  assert.equal(h.value.gets, 2); assert.equal(h.value.sets, 2); assert.equal(h.value.value, ' ');
});

test('nested refused dispatch never overwrites the outer router delivery cell', () => {
  for (const inside of ['router', 'get', 'set']) {
    const h = harness(); const lease = h.register(); let routes = 0, nested;
    const dispatch = () => { nested = h.input(); };
    if (inside === 'get') h.value.getHook = dispatch;
    if (inside === 'set') h.value.setHook = dispatch;
    h.route(event => { routes++; if (inside === 'router') dispatch(); lease.handleInput(event); });
    h.value.value = '\u00e9'; h.input();
    assert.equal(routes, 1); assert.equal(nested.defaultPrevented, true);
    assert.equal(h.value.gets, 1); assert.equal(h.value.sets, 1); assert.equal(h.value.value, ' ');
    h.value.getHook = h.value.setHook = undefined;
    h.input(); assert.equal(routes, 2); assert.equal(h.value.gets, 2);
  }
});

test('nested native fence cannot claim the outer event while its own dispatch is refused', () => {
  let hook;
  const h = harness({ prepare(dom) {
    const stop = dom.FenceEvent.prototype.stopImmediatePropagation;
    dom.FenceEvent.prototype.stopImmediatePropagation = function () { Reflect.apply(stop, this, []); hook?.(this); };
  } });
  const lease = h.register(); let outer;
  h.route(event => {
    outer = event;
    hook = nested => { if (nested !== outer) lease.handleInput(outer); };
    h.input(); lease.handleInput(event);
  });
  assert.match(String(caught(() => h.input())), /delivery required/);
  assert.equal(h.value.gets, 0); assert.equal(h.value.sets, 0);
});

test('private handling guard and returned method do not consult late inherited properties', () => {
  const h = harness();
  runInContext(`Object.defineProperty(Object.prototype,'operation',{configurable:true,get(){throw new Error('late operation getter');},set(){throw new Error('late operation setter');}});
    Object.defineProperty(Object.prototype,'handleInput',{configurable:true,set(){throw new Error('late handleInput setter');}});`, h.f.context);
  h.register(); h.value.value = '\u00e9'; h.input();
  assert.equal(h.value.gets, 1); assert.equal(h.value.sets, 1); assert.equal(h.value.value, ' ');
});

test('direct get/set reentry is terminal even when native hook catches it and throws another value', () => {
  for (const phase of ['get', 'set']) for (const suppress of [false, true]) {
    const h = harness(), lease = h.register(); let delivered, first;
    h.route(event => { delivered = event; lease.handleInput(event); });
    h.value[`${phase}Hook`] = () => {
      first = caught(() => lease.handleInput(delivered));
      if (!suppress) throw 0;
    };
    h.value.value = '\u00e9'; assert.equal(caught(() => h.input()), first);
    assert.match(String(first), /reentry/); assert.equal(h.value.gets, 1);
    assert.equal(h.value.sets, phase === 'set' ? 1 : 0);
    h.value.getHook = h.value.setHook = undefined;
    assert.equal(lease.handleInput(delivered), undefined);
    h.register(); h.route(event => h.lease.handleInput(event)); h.input();
    assert.equal(h.value.gets, 2, 'handling guard clears after failure');
  }
});

test('same lease structural and document ownership is required before native value access', () => {
  const changes = [
    h => h.parent.removeChild(h.field),
    h => h.f.document.body.appendChild(h.field),
    h => { h.f.edit.state(h.field).type = 'password'; },
    h => { h.f.edit.state(h.field).owner = new h.f.edit.Document(); },
    h => { h.f.edit.state(h.parent).namespace = 'urn:synthetic'; },
    h => { h.f.realm.document = new h.f.edit.Document(); },
    h => { h.f.realm.top = {}; },
    h => { h.f.realm.location = { href: 'https://slither.io/' }; },
    h => { h.f.realm.location.href = 'https://slither.io/index.html'; },
  ];
  for (const change of changes) {
    const h = harness(), old = h.register();
    h.route(event => { change(h); old.handleInput(event); });
    assert.match(String(caught(() => h.input())), /delivery required/);
    assert.equal(h.value.gets, 0); assert.equal(h.value.sets, 0);
    assert.equal(old.handleInput(new Proxy({}, { get() { assert.fail(); } })), undefined);
  }
});

test('getter invalidation withholds the setter; setter invalidation has no rollback, retry or reread', () => {
  for (const phase of ['get', 'set', 'afterSet']) for (const change of [
    h => h.lease.unregister(), h => h.native.setInput(h.router),
    h => { h.f.realm.location.href = 'https://slither.io/index.html'; },
    h => h.parent.removeChild(h.field), h => { h.f.edit.state(h.field).type = 'password'; },
  ]) {
    const h = harness(); h.register(); h.value.value = '\u00e9'; h.value[`${phase}Hook`] = () => change(h);
    assert.match(String(caught(() => h.input())), /delivery required/);
    assert.equal(h.value.gets, 1); assert.equal(h.value.sets, phase === 'get' ? 0 : 1);
    assert.equal(h.value.value, phase === 'afterSet' || phase === 'set' ? ' ' : '\u00e9');
  }
});

test('structural check side effect cannot invalidate the URL immediately before a corrective setter', () => {
  let hook;
  const h = harness({ prepare(dom) {
    const parent = Object.getOwnPropertyDescriptor(dom.Node.prototype, 'parentNode');
    Object.defineProperty(dom.Node.prototype, 'parentNode', { configurable: true, get() {
      const result = Reflect.apply(parent.get, this, []); hook?.(); return result;
    } });
  } });
  h.register(); h.value.value = '\u00e9';
  h.value.getHook = () => { hook = () => { h.f.realm.location.href = 'https://slither.io/index.html'; }; };
  assert.match(String(caught(() => h.input())), /delivery required/);
  assert.equal(h.value.gets, 1); assert.equal(h.value.sets, 0);
});

test('all native getter/setter primaries survive secondary prevent failure by exact identity', () => {
  for (const phase of ['get', 'set', 'afterSet']) for (const primary of [undefined, null, false, 0, { failure: 'identity' }]) {
    const h = harness(), old = h.register(); h.value.value = '\u00e9';
    if (phase === 'afterSet') h.value.afterSetHook = () => { throw primary; };
    else h.value[`${phase}Failure`] = primary;
    const event = h.f.edit.make('input', { target: h.field, preventFailure: new Error('secondary prevent') });
    assert.equal(caught(() => h.f.edit.deliver(event)), primary);
    assert.equal(h.value.gets, 1); assert.equal(h.value.sets, phase === 'get' ? 0 : 1);
    assert.equal(h.value.value, phase === 'afterSet' ? ' ' : '\u00e9', 'failed setter does not claim rollback or retry');
    assert.equal(old.handleInput(event), undefined);
    delete h.value.getFailure; delete h.value.setFailure; h.value.afterSetHook = undefined;
    h.register(); h.input(); assert.equal(h.value.value, ' ');
  }
});

test('all currentness primaries survive secondary final fence failure', () => {
  for (const phase of ['get', 'afterSet']) for (const primary of [undefined, null, false, 0, { failure: 'currentness identity' }]) {
    let fail = false;
    const h = harness({ prepare(dom) {
      const original = Object.getOwnPropertyDescriptor(dom.Node.prototype, 'isConnected');
      Object.defineProperty(dom.Node.prototype, 'isConnected', { configurable: true, get() {
        if (fail) throw primary; return Reflect.apply(original.get, this, []);
      } });
    } });
    h.register(); h.value.value = '\u00e9'; h.value[`${phase}Hook`] = () => { fail = true; };
    const event = h.f.edit.make('input', { target: h.field, preventFailure: 'secondary' });
    assert.equal(caught(() => h.f.edit.deliver(event)), primary);
    assert.equal(h.value.gets, 1); assert.equal(h.value.sets, phase === 'get' ? 0 : 1);
    fail = false; h.value.getHook = h.value.afterSetHook = undefined; h.register(); h.input(); assert.equal(h.value.value, ' ');
  }
});

test('native Event and stop failures occur before router/value work and preserve falsy primaries', () => {
  for (const primary of [undefined, null, false, 0, { failure: 'fence identity' }]) for (const name of ['type', 'target', 'defaultPrevented', 'stop']) {
    const h = harness(); h.register(); let routed = 0; h.route(() => { routed++; });
    const properties = { target: h.field, preventFailure: 'secondary prevent', stopFailure: 'secondary stop' };
    if (name === 'stop') properties.stopFailure = primary;
    else properties.getterFailure = { name, value: primary };
    const event = h.f.edit.make('input', properties);
    assert.equal(caught(() => h.f.edit.deliver(event)), primary);
    assert.equal(routed, 0); assert.equal(h.value.gets, 0); assert.equal(h.value.sets, 0);
    assert.equal(h.f.edit.eventData.get(event).stopped, false, 'failed fence attempt is not isolation proof');
  }
});

test('temporary default denial does not block correction of composing noncancelable postmutation input', () => {
  for (const change of [
    h => { h.f.edit.state(h.field).readOnly = true; }, h => { h.f.edit.state(h.parent).disabled = true; },
    h => { h.f.edit.state(h.parent).inert = true; }, h => { h.f.edit.state(h.parent).visible = false; },
    h => { h.f.edit.state(h.f.document).active = h.parent; },
  ]) {
    const h = harness(); h.register(); change(h); h.value.value = '\u00e9';
    const event = h.f.edit.make('input', { target: h.field, cancelable: false,
      isComposing: true, inputType: 'insertCompositionText', data: '\u00e9' });
    for (const name of ['inputType', 'isComposing', 'data', 'keyCode', 'which']) {
      Object.defineProperty(event, name, { get() { assert.fail('unselected Event payload read'); } });
    }
    h.f.edit.deliver(event); assert.equal(event.defaultPrevented, false, 'cancellation cannot undo mutation');
    assert.equal(h.value.value, ' '); assert.equal(h.value.gets, 1); assert.equal(h.value.sets, 1);
    assert.deepEqual(h.f.edit.eventData.get(event).trace, ['window-capture', 'stop', 'prevent']);
  }
});

test('noninput routed notifications and original raw keys never touch value or alter input accounting', () => {
  const h = harness(); h.register(); h.value.value = '\u00e9';
  const input = createClientInput(), control = createClientInput();
  const own = { token: 1, wantedHeading: 0, gazeHeading: 0, dead: false, turnRate: .1, sizeTurnFactor: 1, speedTurnFactor: 1 };
  for (const value of [input, control]) { value.setConnected(true); value.setOwn(own); value.accumulateStep({ wholeSteps: 2 }); }
  const before = input.snapshot(); let routes = 0;
  h.route(event => {
    routes++; h.lease.handleInput(event);
    const type = h.f.edit.eventData.get(event).type;
    if (type === 'keydown') input.keyDown(event.code);
    if (type === 'keyup') input.keyUp(event.code);
  });
  const notifications = ['keypress', 'beforeinput', 'compositionstart', 'compositionupdate', 'compositionend',
    'copy', 'cut', 'paste', 'selectstart', 'select', 'selectionchange', 'dblclick', 'contextmenu',
    'focus', 'blur', 'focusin', 'focusout', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
    'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel', 'touchcancel',
    'dragstart', 'drag', 'dragenter', 'dragleave', 'dragover', 'drop', 'dragend'];
  for (const type of notifications) h.f.edit.dispatch(type, { target: type === 'selectionchange' ? h.f.document : h.field,
    key: 'a', code: 'KeyA', inputType: 'insertText' });
  assert.equal(routes, notifications.length); assert.deepEqual(input.snapshot(), before);
  for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Space']) {
    for (const properties of [{}, { ctrlKey: true }, { altKey: true }, { isComposing: true }, { shiftKey: true }]) {
      h.f.edit.dispatch('keydown', { target: h.field, key: code === 'Space' ? ' ' : code, code, ...properties });
      control.keyDown(code); assert.deepEqual(input.snapshot(), control.snapshot());
      h.f.edit.state(h.parent).visible = false;
      h.f.edit.dispatch('keyup', { target: h.parent, key: code, code });
      control.keyUp(code); assert.deepEqual(input.snapshot(), control.snapshot());
      h.f.edit.state(h.parent).visible = true;
    }
  }
  h.f.edit.dispatch('keydown', { target: h.field, key: 'ArrowLeft', code: 'KeyA', keyCode: 37, which: 37 });
  assert.deepEqual(input.snapshot(), control.snapshot(), 'no keyCode/which normalization');
  h.f.edit.dispatch('input', { target: h.parent }); assert.equal(h.value.gets, 0);
  assert.equal(h.value.sets, 0); assert.equal(h.value.value, '\u00e9');
  const sends = [], baselineSends = [];
  input.tick({ nowMs: 100, wholeSteps: 1 }, bytes => sends.push([...bytes]));
  control.tick({ nowMs: 100, wholeSteps: 1 }, bytes => baselineSends.push([...bytes]));
  assert.deepEqual(input.snapshot(), control.snapshot()); assert.deepEqual(sends, baselineSends);
  assert.equal(h.f.sockets, 0); assert.equal(h.f.original, 0);
});

test('unregister, setInput, pagehide and reload share lifetime with no synthetic releases or late value work', () => {
  for (const cleanup of [h => h.lease.unregister(), h => h.native.setInput(h.router),
    h => h.native.setInput(undefined), h => h.f.event('pagehide'), h => h.native.ordinaryReload()]) {
    const h = harness(), old = h.register(); h.value.value = '\u00e9'; cleanup(h);
    const malicious = new Proxy({}, { get() { assert.fail('stale argument inspection'); } });
    assert.equal(old.handleInput(malicious), undefined); assert.equal(old.unregister(), undefined);
    assert.equal(h.value.gets, 0); assert.equal(h.value.sets, 0); assert.equal(h.f.sockets, 0);
    assert.equal(h.f.log.filter(row => row[0] === 'send').length, 0);
  }
});

test('actual bootstrap/gameplay router can call the selected lease before its filter with no added observations', async () => {
  const bootstrapSource = readFileSync(new URL('../extension/game-runtime.mjs', import.meta.url), 'utf8');
  const makeBootstrap = new Script(`(function(init,wasm,createStockHostSnapshot,createStockSkinAdapter,
    createStockClient,createStockEntityAssets,desktopBackingSize,createStockGameplay){
    ${bootstrapSource.replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '')}\nreturn (options = {}) => startGamePage({initialize:init,wasmApi:wasm,...options});})`).runInThisContext();
  const startGamePage = makeBootstrap(async () => {}, {}, createStockHostSnapshot, createStockSkinAdapter,
    createStockClient, createStockEntityAssets, desktopBackingSize, createStockGameplay);
  const f = fixtureFactory(); f.host(); f.complete(); const wasm = wasmDouble(f);
  const slot = Symbol.for('slither.client.gate.v1'); let native, lease;
  const facade = { ...f.realm, top: null, document: f.document, location: f.realm.location }; facade.top = facade;
  // Test-only composition around the single existing router; product startup stays unbound.
  facade[slot] = Object.freeze({ metadata: f.gate.metadata, claim(id) {
    native = f.gate.claim(id);
    return Object.freeze({ ...native, setInput(handler) {
      native.setInput(handler && (event => { lease?.handleInput(event); return handler(event); }));
    } });
  } });
  const runtime = await startGamePage({ realm: facade, wasmApi: wasm.api });
  const parent = f.document.createElement('div'), field = f.document.createElement('input');
  f.document.body.appendChild(parent); parent.appendChild(field); f.edit.state(f.document).active = field;
  const request = runInContext('({schema:1,element:null,parent:null,inputPolicy:"nickname-ascii-24"})', f.context);
  request.element = field; request.parent = parent; lease = native.registerNicknameEditField(request);
  const observe = () => ({ controls: wasm.controlReads(), calls: [...wasm.calls], input: runtime.diagnostics().gameplay.input,
    raf: [...f.raf.keys()], timers: [...f.timers.keys()], intervals: [...f.intervals.keys()], log: [...f.log], messages: [...f.messages] });
  const before = observe(), value = f.edit.inputValue(field); value.value = '\u00e9';
  f.edit.dispatch('input', { target: field });
  assert.equal(value.value, ' '); assert.equal(value.gets, 1); assert.equal(value.sets, 1);
  for (const type of ['beforeinput', 'compositionstart', 'compositionupdate', 'compositionend', 'copy', 'cut', 'paste', 'selectionchange']) {
    f.edit.dispatch(type, { target: type === 'selectionchange' ? f.document : field, inputType: 'insertCompositionText' });
  }
  assert.deepEqual(observe(), before); assert.equal(value.gets, 1); assert.equal(value.sets, 1);
  const primary = { failure: 'native value getter' }; value.getFailure = primary;
  assert.equal(caught(() => f.edit.dispatch('input', { target: field })), primary, 'error precedes bootstrap filter/catch');
  assert.deepEqual(observe(), before); assert.equal(f.sockets, 0); assert.equal(f.original, 0);
  lease.unregister(); lease = undefined; runtime.dispose();
});
