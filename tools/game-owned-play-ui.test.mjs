// Authored synthetic native-operation doubles. No browser, generated Wasm, CSS or pixel acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createOwnedPlayUi } from '../extension/game-owned-play-ui.mjs';
import { createGateTestDom } from './game-gate-test-fixture.mjs';

const primaries = [undefined, null, false, 0, '', Symbol('synthetic primary'), new Error('synthetic primary')];
const domNames = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild',
  'nextSibling', 'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const constructNames = ['createElement', 'createTextNode', 'appendChild', 'removeChild'];
const controlNames = ['inputValue', 'inputMaxLength', 'inputAutocompleteOff', 'buttonType', 'buttonDisabled'];
const statusLabels = { ready: 'Ready.', 'empty-endpoint': 'Enter a server address.',
  'invalid-endpoint': 'Enter a valid server address.', 'invalid-nickname': 'Check the nickname.',
  preparing: 'Preparing connection.', connecting: 'Connecting.', connected: 'Connected.',
  'not-connected': 'Not connected.', unavailable: 'Play unavailable on this page.',
  failed: 'Play failed. Reload to start again.' };

function throwsExact(callback, primary) {
  let thrown = false;
  try { callback(); } catch (error) { thrown = true; assert.equal(error, primary); }
  assert.equal(thrown, true, 'throw presence, including undefined');
}

function fixture() {
  // Reuse unchanged baseline HUD brands and getters; controls/construction are local authored doubles.
  const native = createGateTestDom({ hud: true });
  const document = new native.Document(), parent = new native.hud.HTMLElement('main');
  const append = native.Node.prototype.appendChild, remove = native.Node.prototype.removeChild;
  Reflect.apply(append, document, [parent]);
  const styleGetter = Object.getOwnPropertyDescriptor(native.hud.HTMLElement.prototype, 'style').get;
  const textSetter = Object.getOwnPropertyDescriptor(native.hud.CharacterData.prototype, 'data').set;
  const styleSetter = native.hud.CSSStyleDeclaration.prototype.setProperty;
  const inputs = new WeakMap(), buttons = new WeakMap();
  class Input extends native.hud.HTMLElement {
    constructor() { super('input'); inputs.set(this, { value: '', maxLength: -1, autocomplete: '', type: 'text' }); }
  }
  class Button extends native.hud.HTMLElement {
    constructor() { super('button'); buttons.set(this, { type: 'submit', disabled: false }); }
  }
  const brand = (store, target) => {
    if (!store.has(target)) throw new TypeError('Synthetic Play control receiver');
    return store.get(target);
  };
  const calls = [], created = [];
  let hook = () => {}, fresh = true;
  const operation = (name, body) => function (...args) {
    const entry = { name, args };
    calls.push(entry); hook('before', entry);
    const result = body(...args); entry.result = result;
    hook('after', entry); return result;
  };
  const dom = {};
  for (const name of domNames) {
    if (name === 'setText') dom[name] = operation(name, (target, value) => Reflect.apply(textSetter, target, [value]));
    else if (name === 'setStyle') dom[name] = operation(name,
      (target, property, value) => Reflect.apply(styleSetter, target, [property, value]));
    else {
      const owner = name === 'style' ? native.hud.HTMLElement
        : ['localName', 'namespaceURI'].includes(name) ? native.Element : native.Node;
      const getter = Object.getOwnPropertyDescriptor(owner.prototype, name).get;
      dom[name] = operation(name, target => Reflect.apply(getter, target, []));
    }
  }
  const tripwires = node => {
    for (const key of ['nodeType', 'ownerDocument', 'isConnected', 'parentNode', 'firstChild',
      'nextSibling', 'localName', 'namespaceURI', 'style', 'data', 'value', 'type', 'maxLength',
      'autocomplete', 'disabled', 'then', 'innerHTML', 'outerHTML', 'querySelector', 'appendChild',
      'removeChild', 'setAttribute', 'focus', 'addEventListener', 'getBoundingClientRect']) {
      Object.defineProperty(node, key, {
        get() { throw new Error(`Forbidden late instance access: ${key}`); },
        set() { throw new Error(`Forbidden late instance write: ${key}`); },
      });
    }
    return node;
  };
  const construct = {
    createElement: operation('createElement', (receiver, tag) => {
      assert.equal(receiver, document, 'exact Document brand');
      assert.ok(['div', 'label', 'input', 'button'].includes(tag));
      const node = tag === 'input' ? new Input() : tag === 'button' ? new Button() : new native.hud.HTMLElement(tag);
      native.state(node).owner = document; created.push(node); return tripwires(node);
    }),
    createTextNode: operation('createTextNode', (receiver, value) => {
      assert.equal(receiver, document); assert.equal(typeof value, 'string');
      const node = new native.hud.CharacterData(value);
      native.state(node).owner = document; created.push(node); return tripwires(node);
    }),
    appendChild: operation('appendChild', (receiver, child) => Reflect.apply(append, receiver, [child])),
    removeChild: operation('removeChild', (receiver, child) => {
      assert.equal(native.state(child).parent, receiver); return Reflect.apply(remove, receiver, [child]);
    }),
  };
  const controls = {
    inputValue: operation('inputValue', receiver => brand(inputs, receiver).value),
    inputMaxLength: operation('inputMaxLength', (receiver, value) => {
      assert.ok(value === 24 || value === 128); brand(inputs, receiver).maxLength = value;
    }),
    inputAutocompleteOff: operation('inputAutocompleteOff', receiver => { brand(inputs, receiver).autocomplete = 'off'; }),
    buttonType: operation('buttonType', receiver => { brand(buttons, receiver).type = 'button'; }),
    buttonDisabled: operation('buttonDisabled', (receiver, value) => {
      assert.equal(typeof value, 'boolean'); brand(buttons, receiver).disabled = value;
    }),
  };
  const input = { document, parent, dom, construct, controls,
    isCurrentDocument: operation('current', () => fresh) };
  tripwires(document); tripwires(parent);
  return { input, native, document, parent, dom, construct, controls, calls, created,
    lease: () => createOwnedPlayUi(input), hook(value) { hook = value; }, current(value) { fresh = value; },
    text: node => native.hud.character(node).data,
    style: node => native.hud.style(Reflect.apply(styleGetter, node, [])),
    field: node => brand(inputs, node), button: node => brand(buttons, node),
    detach: node => Reflect.apply(remove, native.state(node).parent, [node]),
    reparent(node) {
      const other = new native.hud.HTMLElement('aside');
      Reflect.apply(append, document, [other]); Reflect.apply(append, other, [node]); return other;
    },
  };
}

test('actual import and exact factory are inert; disposed lease is permanently quiet', async () => {
  const source = await readFile(new URL('../extension/game-owned-play-ui.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\s*(?:[({*'"`]|[\w]+\s+from)/);
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, get() { throw new Error('global Document read'); } });
  try {
    const imported = await import('../extension/game-owned-play-ui.mjs?synthetic-inert-import');
    assert.deepEqual(Object.keys(imported), ['createOwnedPlayUi']);
    const f = fixture(), lease = imported.createOwnedPlayUi(f.input);
    assert.deepEqual(Object.keys(lease), ['mount', 'setStatus', 'lock', 'dispose']);
    assert.equal(Object.isFrozen(lease), true); assert.equal(f.calls.length, 0);
    lease.dispose(); lease.dispose(); lease.setStatus('ready'); lease.lock();
    assert.throws(lease.mount, /consumed/); assert.equal(f.calls.length, 0);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'document', prior);
    else delete globalThis.document;
  }
});

test('eleven fresh nodes, closed frozen result, exact tree and bounded original layout', () => {
  const f = fixture(), lease = f.lease(), nodes = lease.mount();
  assert.deepEqual(Object.keys(nodes), ['schema', 'document', 'mount', 'endpoint', 'endpointParent',
    'nickname', 'nicknameParent', 'button', 'buttonParent']);
  assert.equal(nodes.schema, 1); assert.equal(nodes.document, f.document); assert.equal(nodes.buttonParent, nodes.mount);
  assert.equal(Object.isFrozen(nodes), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(nodes))) assert.ok(Object.hasOwn(descriptor, 'value'));
  assert.equal(f.created.length, 11); assert.equal(new Set(f.created).size, 11);
  assert.equal(f.calls.filter(c => c.name === 'createElement').length, 7);
  assert.equal(f.calls.filter(c => c.name === 'createTextNode').length, 4);
  assert.equal(f.calls.filter(c => c.name === 'appendChild').length, 11);
  assert.deepEqual(f.parent.children, [nodes.mount]);
  const [endpointLabel, nicknameLabel, button, status] = nodes.mount.children;
  assert.equal(endpointLabel, nodes.endpointParent); assert.equal(nicknameLabel, nodes.nicknameParent);
  assert.equal(button, nodes.button);
  assert.deepEqual(endpointLabel.children.slice(1), [nodes.endpoint]);
  assert.deepEqual(nicknameLabel.children.slice(1), [nodes.nickname]);
  assert.equal(button.children.length, 1); assert.equal(status.children.length, 1);
  assert.deepEqual([endpointLabel.children[0], nicknameLabel.children[0], button.children[0], status.children[0]]
    .map(f.text), ['Server address', 'Nickname', 'Play', 'Ready.']);
  assert.deepEqual(f.field(nodes.endpoint), { value: '', maxLength: 128, autocomplete: 'off', type: 'text' });
  assert.deepEqual(f.field(nodes.nickname), { value: '', maxLength: 24, autocomplete: 'off', type: 'text' });
  assert.deepEqual(f.button(button), { type: 'button', disabled: false });
  assert.equal(f.calls.filter(c => c.name === 'inputValue').length, 2);
  assert.equal(f.calls.filter(c => c.name === 'inputMaxLength').length, 2);
  assert.equal(f.calls.filter(c => c.name === 'inputAutocompleteOff').length, 2);
  assert.deepEqual(Object.fromEntries(f.style(nodes.mount)), { position: 'absolute', left: '8px', top: '56px',
    width: '48ch', display: 'block', color: '#eee', 'font-family': 'monospace', 'font-size': '12px',
    'font-variant-numeric': 'tabular-nums', border: '0', 'border-radius': '0', background: 'none' });
  assert.equal(f.style(button).get('position'), 'static', 'override existing absolute root-button rule');
  assert.equal(f.style(status).get('width'), '48ch'); assert.equal(f.style(status).get('height'), '2em');
  for (const value of [nodes.mount, endpointLabel, nicknameLabel, nodes.endpoint, nodes.nickname, button, status]) {
    const style = f.style(value);
    assert.equal(style.get('display'), 'block');
    assert.equal([...style.values()].some(v => /gradient|animation|shadow/.test(v)), false);
  }
  assert.equal(f.style(f.parent).size, 0);
  assert.equal(f.calls.some(c => c.name === 'setText'), false);
  assert.ok(f.calls.every(c => [...domNames, ...constructNames, ...controlNames, 'current'].includes(c.name)));
  const before = f.calls.length; assert.throws(lease.mount, /consumed/); assert.equal(f.calls.length, before);
  lease.dispose(); assert.deepEqual(f.parent.children, []);
});

test('ten fixed statuses never format values, read fields, change focus, or unlock', () => {
  const f = fixture(), lease = f.lease(), nodes = lease.mount(), status = nodes.mount.children[3].children[0];
  f.field(nodes.endpoint).value = 'synthetic private endpoint'; f.field(nodes.nickname).value = 'private nickname';
  let before = f.calls.length;
  for (const [state, label] of Object.entries(statusLabels)) {
    assert.equal(lease.setStatus(state), undefined); assert.equal(f.text(status), label);
  }
  const updates = f.calls.slice(before);
  assert.equal(updates.filter(c => c.name === 'setText').length, 10);
  assert.equal(updates.some(c => controlNames.includes(c.name)), false);
  for (const value of [undefined, null, false, 0, {}, [], new String('ready'), 'then', 'toString', '__proto__', 'READY', '']) {
    before = f.calls.length; assert.throws(() => lease.setStatus(value), /Invalid/); assert.equal(f.calls.length, before);
  }
  lease.lock(); assert.equal(f.button(nodes.button).disabled, true);
  before = f.calls.length; lease.lock(); assert.equal(f.calls.length, before);
  for (const state of Object.keys(statusLabels)) lease.setStatus(state);
  assert.equal(f.button(nodes.button).disabled, true);
  assert.deepEqual(f.calls.filter(c => c.name === 'buttonDisabled').map(c => c.args[1]), [false, true]);
  assert.equal(f.field(nodes.endpoint).value, 'synthetic private endpoint');
  assert.equal(f.field(nodes.nickname).value, 'private nickname');
  lease.dispose();
});

test('lock consumes before disable effect and never retries on any thrown primitive or object', () => {
  for (const phase of ['before', 'after']) for (const primary of primaries) {
    const f = fixture(), lease = f.lease(), nodes = lease.mount();
    f.hook((at, entry) => {
      if (at === phase && entry.name === 'buttonDisabled' && entry.args[1] === true) throw primary;
    });
    throwsExact(lease.lock, primary);
    f.hook(() => {}); const before = f.calls.length; lease.lock(); assert.equal(f.calls.length, before);
    for (const state of Object.keys(statusLabels)) lease.setStatus(state);
    assert.equal(f.calls.filter(c => c.name === 'buttonDisabled' && c.args[1] === true).length, 1);
    assert.equal(f.button(nodes.button).disabled, phase === 'after');
    lease.dispose();
  }
});

test('all operation records are closed own-data, ordinary or null-prototype; raw callback kinds are bounded', () => {
  for (const group of ['input', 'dom', 'construct', 'controls']) {
    const fields = group === 'input' ? ['document', 'parent', 'dom', 'construct', 'controls', 'isCurrentDocument']
      : group === 'dom' ? domNames : group === 'construct' ? constructNames : controlNames;
    for (const mode of ['missing', 'extra', 'symbol', 'accessor', 'inherited', 'array', 'function', 'foreign']) {
      const f = fixture(), value = group === 'input' ? { ...f.input } : { ...f.input[group] };
      let replacement = value;
      if (mode === 'missing') delete value[fields[0]];
      if (mode === 'extra') value.extra = () => {};
      if (mode === 'symbol') value[Symbol('extra')] = () => {};
      if (mode === 'accessor') Object.defineProperty(value, fields[0], { get() { assert.fail('accessor invoked'); } });
      if (mode === 'inherited') replacement = Object.assign(Object.create({ [fields[0]]: value[fields[0]] }), value);
      if (mode === 'array') replacement = Object.assign([], value);
      if (mode === 'function') replacement = Object.assign(function () {}, value);
      if (mode === 'foreign') replacement = vm.runInNewContext('({})');
      if (group === 'input') assert.throws(() => createOwnedPlayUi(replacement), /Invalid/);
      else assert.throws(() => createOwnedPlayUi({ ...f.input, [group]: replacement }), /Invalid/);
      assert.equal(f.calls.length, 0);
    }
    const f = fixture();
    if (group === 'input') assert.ok(createOwnedPlayUi(Object.assign(Object.create(null), f.input)));
    else assert.ok(createOwnedPlayUi({ ...f.input, [group]: Object.assign(Object.create(null), f.input[group]) }));
    assert.equal(f.calls.length, 0);
  }
  const callbacks = [null, undefined, {}, async () => {}, function* () {}, async function* () {},
    (async () => {}).bind(null), (function* () {}).bind(null), (async function* () {}).bind(null)];
  const hiddenAsync = async () => {}; Object.setPrototypeOf(hiddenAsync, Function.prototype); callbacks.push(hiddenAsync);
  const long = () => {}; let prototype = Function.prototype;
  for (let i = 0; i < 65; i++) prototype = Object.create(prototype);
  Object.setPrototypeOf(long, prototype); callbacks.push(long);
  const repeated = new Proxy(() => {}, { getPrototypeOf() { return repeated; } }); callbacks.push(repeated);
  for (const group of ['dom', 'construct', 'controls', 'checker']) {
    const names = group === 'dom' ? domNames : group === 'construct' ? constructNames
      : group === 'controls' ? controlNames : ['isCurrentDocument'];
    for (const name of names) for (const callback of callbacks) {
      const f = fixture();
      const input = group === 'checker' ? { ...f.input, [name]: callback }
        : { ...f.input, [group]: { ...f.input[group], [name]: callback } };
      assert.throws(() => createOwnedPlayUi(input), /Invalid/); assert.equal(f.calls.length, 0);
    }
  }
});

test('constructor copies callbacks, retains no record aliases and accepts synchronous bound operations', () => {
  const f = fixture();
  for (const name of controlNames) f.controls[name] = f.controls[name].bind(null);
  const lease = f.lease();
  for (const value of [f.dom, f.construct, f.controls]) for (const name of Object.keys(value)) value[name] = () => assert.fail('late record');
  f.input.isCurrentDocument = () => assert.fail('late checker');
  const nodes = lease.mount(); lease.setStatus('connected'); lease.lock(); lease.dispose();
  assert.equal(f.native.state(nodes.mount).parent, null);
});

for (const group of ['dom', 'construct', 'controls', 'checker']) {
  test(`F1: natural foreign bound async/generator kinds are rejected in every ${group} slot without invocation`, () => {
    const effects = { invocations: 0 };
    const callbacks = vm.runInNewContext(`[
      (async function () { effects.invocations++; }).bind(null),
      (function* () { effects.invocations++; }).bind(null),
      (async function* () { effects.invocations++; }).bind(null),
    ]`, { effects });
    const names = group === 'dom' ? domNames : group === 'construct' ? constructNames
      : group === 'controls' ? controlNames : ['isCurrentDocument'];
    for (const name of names) for (const callback of callbacks) {
      // The natural callback reproduces admission; the apply-trapped proxy detects even a generator call.
      for (const candidate of [callback, new Proxy(callback, { apply() { assert.fail('callback invoked'); } })]) {
        const f = fixture();
        const input = group === 'checker' ? { ...f.input, [name]: candidate }
          : { ...f.input, [group]: { ...f.input[group], [name]: candidate } };
        assert.throws(() => createOwnedPlayUi(input), /Invalid/, `${group}.${name}: foreign callback kind`);
        assert.equal(f.calls.length, 0); assert.equal(effects.invocations, 0);
      }
    }
  });
}

test('F1: descriptor-only kind checks ignore accessors and admit ordinary foreign bound callbacks', () => {
  const effects = { tags: 0, invocations: 0 };
  const callbacks = vm.runInNewContext(`[
    (function () { effects.invocations++; }).bind(null),
    (async function () { effects.invocations++; }).bind(null),
    (function* () { effects.invocations++; }).bind(null),
    (async function* () { effects.invocations++; }).bind(null),
  ].map(callback => {
    const layer = Object.create(Object.getPrototypeOf(callback));
    Object.defineProperty(layer, Symbol.toStringTag, { get() { effects.tags++; throw new Error('tag accessor'); } });
    Object.setPrototypeOf(callback, layer);
    return callback;
  })`, { effects });
  for (const group of ['dom', 'construct', 'controls', 'checker']) {
    const names = group === 'dom' ? domNames : group === 'construct' ? constructNames
      : group === 'controls' ? controlNames : ['isCurrentDocument'];
    for (const name of names) for (const [index, callback] of callbacks.entries()) {
      const f = fixture();
      const input = group === 'checker' ? { ...f.input, [name]: callback }
        : { ...f.input, [group]: { ...f.input[group], [name]: callback } };
      if (index === 0) createOwnedPlayUi(input).dispose();
      else assert.throws(() => createOwnedPlayUi(input), /Invalid/);
      assert.equal(f.calls.length, 0);
      assert.deepEqual(effects, { tags: 0, invocations: 0 });
    }
  }
});

for (const method of ['setStatus', 'lock', 'dispose']) {
  test(`F2: ${method} refuses foreign-document effects after parent and mount adoption`, () => {
    const f = fixture(), lease = f.lease(), nodes = lease.mount();
    const destination = new f.native.Document();
    Reflect.apply(f.native.Node.prototype.appendChild, destination, [f.parent]);
    assert.equal(f.input.isCurrentDocument(), true, 'captured document checker remains current');
    assert.equal(f.native.state(f.parent).owner, destination);
    assert.equal(f.native.state(nodes.mount).owner, destination);
    assert.equal(f.native.state(nodes.mount).parent, f.parent);
    const before = f.calls.length;
    if (method === 'dispose') lease.dispose();
    else assert.throws(() => lease[method]('connected'), /Invalid|Stale/);
    assert.equal(f.calls.slice(before).some(c => ['setText', 'buttonDisabled', 'removeChild'].includes(c.name)), false);
    lease.dispose();
    // Returning to the original document cannot renew consumed stale cleanup.
    Reflect.apply(f.native.Node.prototype.appendChild, f.document, [f.parent]);
    const stopped = f.calls.length;
    lease.dispose(); lease.lock(); lease.setStatus('ready'); assert.equal(f.calls.length, stopped);
    assert.equal(f.native.state(nodes.mount).parent, f.parent, 'foreign mount remains untouched');
  });
}

test('F2: disconnected parent blocks effects and failed final-append adoption preserves its exact primary', () => {
  for (const method of ['setStatus', 'lock', 'dispose']) {
    const f = fixture(), lease = f.lease(), nodes = lease.mount();
    f.detach(f.parent); const before = f.calls.length;
    if (method === 'dispose') lease.dispose();
    else assert.throws(() => lease[method]('ready'), /Invalid/);
    assert.equal(f.calls.slice(before).some(c => ['setText', 'buttonDisabled', 'removeChild'].includes(c.name)), false);
    lease.dispose();
    Reflect.apply(f.native.Node.prototype.appendChild, f.document, [f.parent]);
    const stopped = f.calls.length; lease.dispose(); assert.equal(f.calls.length, stopped);
    assert.equal(f.native.state(nodes.mount).parent, f.parent);
  }
  for (const primary of primaries) {
    const f = fixture(), lease = f.lease(), destination = new f.native.Document();
    let active = true, ownedMount;
    f.hook((phase, entry) => {
      if (entry.name === 'removeChild' && active) assert.fail('cleanup under active guard');
      if (phase === 'after' && entry.name === 'appendChild' && entry.args[0] === f.parent) {
        ownedMount = entry.args[1];
        Reflect.apply(f.native.Node.prototype.appendChild, destination, [f.parent]);
        throw primary;
      }
    });
    throwsExact(lease.mount, primary); assert.equal(f.native.state(ownedMount).owner, destination);
    assert.equal(f.calls.some(c => c.name === 'removeChild'), false);
    active = false; f.hook(() => {}); lease.dispose();
    assert.equal(f.calls.some(c => c.name === 'removeChild'), false);
    assert.equal(f.native.state(ownedMount).parent, f.parent);
    Reflect.apply(f.native.Node.prototype.appendChild, f.document, [f.parent]);
    const stopped = f.calls.length; lease.dispose(); lease.lock(); lease.setStatus('ready');
    assert.equal(f.calls.length, stopped);
  }
});

test('native brands, exact document, connected HTML parent and fresh identities are required', () => {
  for (const mode of ['plain', 'proxy', 'prototype', 'foreign', 'detached', 'svg', 'text', 'document']) {
    const f = fixture(); let parent = f.parent;
    if (mode === 'plain') parent = {};
    if (mode === 'proxy') parent = new Proxy(parent, {});
    if (mode === 'prototype') parent = Object.create(f.native.hud.HTMLElement.prototype);
    if (mode === 'foreign') f.native.state(parent).owner = new f.native.Document();
    if (mode === 'detached') f.detach(parent);
    if (mode === 'svg') f.native.state(parent).namespace = 'http://www.w3.org/2000/svg';
    if (mode === 'text') parent = new f.native.hud.CharacterData('synthetic');
    if (mode === 'document') parent = f.document;
    assert.throws(() => createOwnedPlayUi({ ...f.input, parent }).mount());
    assert.equal(f.calls.some(c => c.name === 'appendChild'), false);
  }
  for (const mode of ['document', 'parent', 'duplicate', 'fake', 'tag', 'namespace', 'foreign', 'connected', 'nonempty', 'input-brand', 'button-brand']) {
    const f = fixture(), original = f.construct.createElement; let first;
    f.construct.createElement = (receiver, tag) => {
      if (mode === 'document') return f.document;
      if (mode === 'parent') return f.parent;
      if (mode === 'fake') return Object.create(f.native.hud.HTMLElement.prototype);
      if (mode === 'input-brand' && tag === 'input' || mode === 'button-brand' && tag === 'button') {
        const node = new f.native.hud.HTMLElement(tag); f.native.state(node).owner = f.document; return node;
      }
      const node = original(receiver, tag);
      if (mode === 'duplicate' && first) return first;
      if (mode === 'tag') f.native.state(node).tag = 'section';
      if (mode === 'namespace') f.native.state(node).namespace = 'http://www.w3.org/2000/svg';
      if (mode === 'foreign') f.native.state(node).owner = new f.native.Document();
      if (mode === 'connected') Reflect.apply(f.native.Node.prototype.appendChild, f.parent, [node]);
      if (mode === 'nonempty') Reflect.apply(f.native.Node.prototype.appendChild, node, [new f.native.hud.CharacterData('extra')]);
      first = node; return node;
    };
    const lease = f.lease(); assert.throws(lease.mount); lease.dispose();
    assert.equal(f.calls.some(c => c.name === 'appendChild' && c.args[0] === f.parent), false);
  }
});

test('initial values must be the primitive empty string; private status and style aliases are rejected', () => {
  for (const value of ['nonempty', false, 0, null, undefined, new String(''), { toString() { assert.fail('coercion'); } }]) {
    for (const target of [1, 2]) {
      const f = fixture(), original = f.controls.inputValue; let reads = 0;
      f.controls.inputValue = receiver => ++reads === target ? value : original(receiver);
      const lease = f.lease(); assert.throws(lease.mount, /Invalid/); lease.dispose();
      assert.equal(f.calls.some(c => c.name === 'appendChild' && c.args[0] === f.parent), false);
    }
  }
  for (const mode of ['text-alias', 'text-fake', 'text-element', 'style-null', 'style-node', 'style-shared', 'style-parent']) {
    const f = fixture();
    if (mode.startsWith('text')) {
      const original = f.construct.createTextNode; let first;
      f.construct.createTextNode = (receiver, value) => {
        if (mode === 'text-fake') return Object.create(f.native.hud.CharacterData.prototype);
        if (mode === 'text-element') return f.parent;
        const node = original(receiver, value); const result = first ?? node; first = node; return result;
      };
    } else {
      const original = f.dom.style; let shared, parentStyle;
      f.dom.style = receiver => {
        const value = original(receiver);
        if (receiver === f.parent) { parentStyle = value; return value; }
        if (mode === 'style-null') return null;
        if (mode === 'style-node') return receiver;
        if (mode === 'style-parent') return parentStyle;
        shared ??= value; return shared;
      };
    }
    const lease = f.lease(); assert.throws(lease.mount); lease.dispose();
    assert.equal(f.calls.some(c => c.name === 'appendChild' && c.args[0] === f.parent), false);
    assert.equal(f.style(f.parent).size, 0);
  }
});

test('every mount native/checker boundary before/after effect preserves exact primary with external cleanup', t => {
  const control = fixture(); control.lease().mount(); const tape = control.calls.map(c => c.name);
  for (const [index, name] of tape.entries()) for (const phase of ['before', 'after']) for (const primary of primaries) {
    const f = fixture(), lease = f.lease(); let position = -1, active = true;
    f.hook((at, entry) => {
      if (at === 'before') position++;
      if (index === position && phase === at) throw primary;
      if (entry.name === 'removeChild' && active) assert.fail('cleanup inside mount guard');
    });
    throwsExact(lease.mount, primary);
    assert.equal(f.calls.some(c => c.name === 'removeChild'), false, `${index} ${name} ${phase}`);
    const stopped = f.calls.length; assert.throws(lease.mount, /consumed/); assert.equal(f.calls.length, stopped);
    active = false; f.hook(() => {}); lease.dispose(); lease.dispose();
    assert.deepEqual(f.parent.children, [], `${index} ${name} ${phase}: external cleanup`);
    assert.ok(f.calls.filter(c => c.name === 'removeChild').length <= 1);
  }
  t.diagnostic(`${tape.length} calls; ${tape.length * 2 * primaries.length} exact-primary before/after cases`);
});

test('every status/lock boundary preserves exact primary and permits only post-guard disposal', t => {
  let cases = 0;
  for (const method of ['setStatus', 'lock']) {
    const control = fixture(), sample = control.lease(); sample.mount(); const start = control.calls.length;
    sample[method]('preparing'); const tape = control.calls.slice(start);
    for (const [index] of tape.entries()) for (const phase of ['before', 'after']) for (const primary of primaries) {
      const f = fixture(), lease = f.lease(); lease.mount(); let position = -1;
      f.hook((at, entry) => {
        if (at === 'before') position++;
        if (position === index && at === phase) throw primary;
        assert.notEqual(entry.name, 'removeChild');
      });
      throwsExact(() => lease[method]('preparing'), primary);
      f.hook(() => {}); lease.dispose(); assert.deepEqual(f.parent.children, []); cases++;
    }
  }
  t.diagnostic(`${cases} publication/lock boundary cases`);
});

test('false freshness and nonboolean results fail before further effects at every current check', () => {
  const control = fixture(); control.lease().mount();
  const checks = control.calls.filter(c => c.name === 'current').length;
  for (let check = 1; check <= checks; check++) {
    const f = fixture(), lease = f.lease(); let count = 0;
    f.hook((at, entry) => { if (at === 'before' && entry.name === 'current' && ++count === check) f.current(false); });
    assert.throws(lease.mount, /Stale/); assert.equal(f.calls.at(-1).name, 'current');
    const before = f.calls.length; lease.dispose();
    assert.ok(f.calls.slice(before).every(c => c.name === 'current'));
  }
  for (const result of [undefined, null, 0, 1, 'true', {}, Promise.resolve(true)]) {
    const f = fixture(); f.current(result); const lease = f.lease();
    assert.throws(lease.mount, /Invalid/); assert.deepEqual(f.calls.map(c => c.name), ['current']); lease.dispose();
  }
  for (const method of ['setStatus', 'lock']) {
    const f = fixture(), lease = f.lease(); lease.mount(); f.current(false); const before = f.calls.length;
    assert.throws(() => lease[method]('ready'), /Stale/);
    assert.deepEqual(f.calls.slice(before).map(c => c.name), ['current']); lease.dispose();
  }
});

test('failed final attachment remains owned; stale/reparented/detached mounts are never repaired', () => {
  for (const primary of primaries) {
    const f = fixture(), lease = f.lease();
    f.hook((at, entry) => {
      if (at === 'after' && entry.name === 'appendChild' && entry.args[0] === f.parent) throw primary;
    });
    throwsExact(lease.mount, primary); assert.equal(f.parent.children.length, 1);
    assert.equal(f.calls.some(c => c.name === 'removeChild'), false);
    f.hook(() => {}); lease.dispose(); assert.deepEqual(f.parent.children, []);
  }
  for (const mode of ['attached', 'stale', 'detached', 'reparented']) {
    const f = fixture(), lease = f.lease(), nodes = lease.mount();
    const unrelated = new f.native.hud.HTMLElement('section');
    Reflect.apply(f.native.Node.prototype.appendChild, f.parent, [unrelated]);
    let other;
    if (mode === 'stale') f.current(false);
    if (mode === 'detached') f.detach(nodes.mount);
    if (mode === 'reparented') other = f.reparent(nodes.mount);
    const before = f.calls.length; lease.dispose(); const stopped = f.calls.length;
    lease.dispose(); lease.setStatus('ready'); lease.lock(); assert.equal(f.calls.length, stopped);
    assert.equal(f.native.state(unrelated).parent, f.parent);
    assert.deepEqual(f.calls.slice(before).map(c => c.name), mode === 'stale' ? ['current']
      : ['current', 'isConnected', 'ownerDocument', 'isConnected', 'ownerDocument', 'isConnected',
        ...(mode === 'detached' ? [] : ['parentNode']), ...(mode === 'attached' ? ['removeChild'] : [])]);
    if (other) assert.deepEqual(other.children, [nodes.mount]);
  }
});

test('cleanup consumes finally at every thrown boundary; no retry, restore, or foreign removal', () => {
  const control = fixture(), sample = control.lease(); sample.mount(); const start = control.calls.length;
  sample.dispose(); const tape = control.calls.slice(start);
  for (const [index, { name }] of tape.entries()) for (const phase of ['before', 'after']) {
    for (const primary of primaries) {
      const f = fixture(), lease = f.lease(), nodes = lease.mount();
      let position = -1;
      f.hook(at => { if (at === 'before') position++; if (position === index && phase === at) throw primary; });
      throwsExact(lease.dispose, primary); const before = f.calls.length;
      lease.dispose(); lease.lock(); lease.setStatus('ready'); assert.throws(lease.mount, /consumed/);
      assert.equal(f.calls.length, before);
      assert.equal(f.native.state(nodes.mount).parent === null, name === 'removeChild' && phase === 'after');
    }
  }
  for (const effect of [false, true]) {
    const f = fixture(), original = f.construct.removeChild; let removals = 0;
    f.construct.removeChild = (receiver, child) => { removals++; if (effect) original(receiver, child); return false; };
    const lease = f.lease(), nodes = lease.mount(); lease.dispose(); lease.dispose();
    assert.equal(removals, 1); assert.equal(f.native.state(nodes.mount).parent, effect ? null : f.parent);
  }
});

test('all own operations reject reentry; caught reentry uses the labelled outer poison simulation', () => {
  for (const outer of ['mount', 'setStatus', 'lock', 'dispose']) {
    for (const nested of ['mount', 'setStatus', 'lock', 'dispose']) {
      const f = fixture(), lease = f.lease();
      if (outer !== 'mount') lease.mount();
      let injected = false;
      const refusal = new Error('synthetic outer runtime poison');
      f.hook((phase, entry) => {
        if (phase !== 'before' || injected) return;
        injected = true;
        assert.throws(() => lease[nested]('ready'), /active/);
        // This is the outer runtime's labelled forwarding guard, not proof of runtime composition.
        if (entry.name !== 'removeChild') throw refusal;
      });
      throwsExact(() => lease[outer]('ready'), refusal);
      f.hook(() => {}); lease.dispose(); lease.dispose();
      assert.equal(f.parent.children.length, outer === 'dispose' ? 1 : 0,
        'a throwing cleanup is consumed without a removal retry');
    }
  }
});

test('caught reentry at every mount boundary is poisoned externally without active cleanup', t => {
  const control = fixture(); control.lease().mount();
  const tape = control.calls;
  const refusal = new Error('synthetic retaining runtime guard refusal');
  for (const [index] of tape.entries()) for (const phase of ['before', 'after']) {
    const f = fixture(), lease = f.lease(); let position = -1, guard = true, poisoned = false;
    f.hook((at, entry) => {
      if (at === 'before') position++;
      if (position === index && phase === at) {
        try {
          try { lease.dispose(); } catch (error) {
            assert.match(error.message, /active/); poisoned = true; throw refusal;
          }
        } catch { /* Authored boundary catches the runtime refusal; outer forwarder retains it. */ }
        if (poisoned) throw refusal;
      }
      if (guard && entry.name === 'removeChild') assert.fail('native cleanup under active guard');
    });
    throwsExact(lease.mount, refusal);
    assert.equal(poisoned, true); assert.equal(f.calls.some(c => c.name === 'removeChild'), false);
    guard = false; f.hook(() => {}); lease.dispose(); assert.deepEqual(f.parent.children, []);
  }
  t.diagnostic(`${tape.length * 2} caught-reentry boundary cases; runtime forwarder is a labelled double`);
});

test('topology changes are rejected before publication and before final attachment', () => {
  for (const target of ['mount', 'button', 'status', 'statusText']) {
    const f = fixture(), lease = f.lease(), nodes = lease.mount();
    const status = nodes.mount.children[3], statusText = status.children[0];
    f.reparent({ mount: nodes.mount, button: nodes.button, status, statusText }[target]);
    const before = f.calls.length;
    assert.throws(() => lease.setStatus('ready'), /Invalid/); assert.throws(lease.lock, /Invalid/);
    assert.equal(f.calls.slice(before).some(c => c.name === 'setText' || c.name === 'buttonDisabled'), false);
    lease.dispose();
  }
  for (const mode of ['detach-parent', 'omit-append', 'reparent-final', 'child-shift']) {
    const f = fixture(), original = f.construct.appendChild; let changed = false;
    f.construct.appendChild = (receiver, child) => {
      if (mode === 'omit-append' && receiver === f.parent) return child;
      const result = original(receiver, child);
      if (mode === 'reparent-final' && receiver === f.parent) f.reparent(child);
      return result;
    };
    f.hook((phase, entry) => {
      if (changed || phase !== 'after' || entry.name !== 'setStyle') return;
      changed = true;
      if (mode === 'detach-parent') f.detach(f.parent);
      if (mode === 'child-shift') f.reparent(f.created[2]);
    });
    const lease = f.lease(); assert.throws(lease.mount, /Invalid/); lease.dispose();
  }
});
