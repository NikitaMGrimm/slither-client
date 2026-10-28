import { HudHistoryDouble } from './hud-history-double.mjs';
// Authored synthetic native-operation doubles. No browser, CSS or pixel acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createOwnedHudUi } from '../extension/game-owned-hud-ui.mjs';
import { createGateTestDom } from './game-gate-test-fixture.mjs';
import { bindStockHudDom } from '../web/stock-hud-dom.mjs';
import { projectHudView } from '../web/stock-hud-view.mjs';
import { createHudState, reduceHudState } from '../web/stock-hud-state.mjs';

const primaries = [undefined, null, false, 0, '', Symbol('synthetic primary'), new Error('synthetic primary')];
const domNames = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild',
  'nextSibling', 'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const html = 'http://www.w3.org/1999/xhtml';
function throwsExact(callback, primary) {
  let thrown = false;
  try { callback(); } catch (error) { thrown = true; assert.equal(error, primary); }
  assert.equal(thrown, true, 'throw presence, including undefined');
}

function fixture() {
  // Use the unchanged gate HUD getters/setters, with four local construction doubles.
  const native = createGateTestDom({ hud: true });
  const document = new native.Document();
  const parent = new native.hud.HTMLElement('main');
  const nativeAppend = native.Node.prototype.appendChild;
  const nativeRemove = native.Node.prototype.removeChild;
  Reflect.apply(nativeAppend, document, [parent]);
  const styleGetter = Object.getOwnPropertyDescriptor(native.hud.HTMLElement.prototype, 'style').get;
  const textSetter = Object.getOwnPropertyDescriptor(native.hud.CharacterData.prototype, 'data').set;
  const styleSetter = native.hud.CSSStyleDeclaration.prototype.setProperty;
  const calls = [], created = [];
  let hook = () => {};
  let fresh = true;
  const operation = (name, body) => function (...args) {
    const entry = { name, args };
    calls.push(entry);
    hook('before', entry);
    const result = body(...args);
    entry.result = result;
    hook('after', entry);
    return result;
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
  const brandDocument = receiver => {
    if (receiver !== document) throw new TypeError('Synthetic exact Document receiver');
  };
  const tripwires = node => {
    for (const key of ['nodeType', 'ownerDocument', 'isConnected', 'parentNode', 'firstChild',
      'nextSibling', 'localName', 'namespaceURI', 'style', 'data', 'then', 'innerHTML',
      'outerHTML', 'querySelector', 'appendChild', 'removeChild', 'setAttribute', 'focus',
      'getBoundingClientRect']) Object.defineProperty(node, key, {
      get() { throw new Error(`Forbidden late instance access: ${key}`); },
      set() { throw new Error(`Forbidden late instance write: ${key}`); },
    });
    return node;
  };
  const construct = {
    createElement: operation('createElement', (receiver, tag) => {
      brandDocument(receiver);
      assert.ok(['div', 'span', 'b'].includes(tag));
      const node = new native.hud.HTMLElement(tag);
      native.state(node).owner = document;
      created.push(node);
      return tripwires(node);
    }),
    createTextNode: operation('createTextNode', (receiver, value) => {
      brandDocument(receiver); assert.equal(typeof value, 'string');
      const node = new native.hud.CharacterData(value);
      native.state(node).owner = document;
      created.push(node);
      return tripwires(node);
    }),
    appendChild: operation('appendChild', (receiver, child) => {
      native.state(receiver); native.state(child);
      return Reflect.apply(nativeAppend, receiver, [child]);
    }),
    removeChild: operation('removeChild', (receiver, child) => {
      native.state(receiver); native.state(child);
      assert.equal(native.state(child).parent, receiver);
      return Reflect.apply(nativeRemove, receiver, [child]);
    }),
  };
  const input = { document, parent, dom, construct,
    isCurrentDocument: operation('current', () => fresh) };
  tripwires(document); tripwires(parent);
  return { input, native, document, parent, dom, construct, calls, created,
    lease: () => createOwnedHudUi(input),
    hook(value) { hook = value; }, current(value) { fresh = value; },
    text: node => native.hud.character(node).data,
    style: node => native.hud.style(Reflect.apply(styleGetter, node, [])),
    detach: node => Reflect.apply(nativeRemove, native.state(node).parent, [node]),
    reparent(node) {
      const other = new native.hud.HTMLElement('aside');
      Reflect.apply(nativeAppend, document, [other]);
      Reflect.apply(nativeAppend, other, [node]);
      return other;
    },
  };
}

const atoms = nodes => [nodes.readout.lengthLabel, nodes.readout.lengthValue,
  nodes.readout.rankLabel, nodes.readout.rankValue, nodes.readout.separator,
  nodes.readout.populationValue, nodes.final.label, nodes.final.value];
function bind(f, nodes) {
  const sceneIdentity = Symbol('synthetic scene');
  const binding = bindStockHudDom({ sceneIdentity, documentIdentity: Symbol('synthetic document'),
    scope: 'readout-and-final', dom: f.dom, nodes, isCurrentDocument: f.input.isCurrentDocument });
  return { binding, sceneIdentity, render: state => binding.render(projectHudView(state, binding.readiness())) };
}
const reduce = (state, change) => reduceHudState(state, state.sceneIdentity, change);
const packet = (state, events) => reduce(state, { kind: 'packet', report: {
  schema: 1, commandCount: 1, setupDraws: 0, events,
} });
const board = (rank = 1, population = 65535) => ({
  kind: 'leaderboard', commandIndex: 0, localRow: 1, rank, population, deathPending: false,
});
const scoreView = (score, token = 7n) => ({ schema: 1, enabled: true, tableMax: 3,
  own: { token, id: 0, logicalSegments: 2, fractionalMass: .5, scoreAdjustment: 1, scoreIndex: 3 },
  status: 'ready', score, error: null });
function displayed(state, score, rank = 1, population = 65535, token = 7n) {
  state = packet(state, [board(rank, population)]);
  return reduce(state, { kind: 'draw', playing: true, view: scoreView(score, token) });
}

test('actual import and constructor are inert; lease consumes mount once', async () => {
  const source = await readFile(new URL('../extension/game-owned-hud-ui.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\s*(?:[({*'"`]|[\w]+\s+from)/);
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, get() { throw new Error('global document'); } });
  try {
    const imported = await import('../extension/game-owned-hud-ui.mjs?synthetic-inert-import');
    assert.deepEqual(Object.keys(imported), ['createOwnedHudUi']);
    const f = fixture();
    const lease = imported.createOwnedHudUi(f.input);
    assert.equal(Object.isFrozen(lease), true);
    assert.deepEqual(Object.keys(lease), ['mount', 'dispose']);
    assert.equal(f.calls.length, 0);
    lease.dispose(); lease.dispose();
    assert.equal(f.calls.length, 0);
    assert.throws(lease.mount, /consumed/);
    assert.equal(f.calls.length, 0);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'document', prior);
    else delete globalThis.document;
  }
});

test('fresh 21-node tree, exact frozen wrappers and authored lower-left layout admit real renderer', () => {
  const f = fixture(), lease = f.lease(), nodes = lease.mount();
  assert.deepEqual(Object.keys(nodes), ['schema', 'document', 'mount', 'textPolicy', 'readout', 'final']);
  assert.deepEqual(Object.keys(nodes.readout), ['root', 'lengthLine', 'rankLine', 'lengthLabel',
    'lengthValue', 'rankLabel', 'rankValue', 'separator', 'populationValue']);
  assert.deepEqual(Object.keys(nodes.final), ['root', 'label', 'value']);
  assert.equal(nodes.document, f.document); assert.equal(nodes.textPolicy, 'authored'); assert.equal(nodes.schema, 1);
  assert.equal(f.created.length, 21); assert.equal(new Set(f.created).size, 21);
  assert.equal(f.created.includes(f.document) || f.created.includes(f.parent), false);
  assert.equal(f.calls.filter(c => c.name === 'createElement').length, 13);
  assert.equal(f.calls.filter(c => c.name === 'createTextNode').length, 8);
  assert.equal(f.calls.filter(c => c.name === 'appendChild').length, 21);
  assert.equal(f.calls.filter(c => c.name === 'appendChild' && c.args[0] === f.parent).length, 1);
  assert.deepEqual(f.parent.children, [nodes.mount]);
  assert.deepEqual(nodes.mount.children, [nodes.readout.root, nodes.final.root]);
  assert.deepEqual(nodes.readout.root.children, [nodes.readout.lengthLine, nodes.readout.rankLine]);
  assert.deepEqual(nodes.readout.lengthLine.children, [nodes.readout.lengthLabel.element, nodes.readout.lengthValue.element]);
  assert.deepEqual(nodes.readout.rankLine.children, [nodes.readout.rankLabel.element, nodes.readout.rankValue.element,
    nodes.readout.separator.element, nodes.readout.populationValue.element]);
  assert.deepEqual(nodes.final.root.children, [nodes.final.label.element, nodes.final.value.element]);
  for (const wrapper of [nodes, nodes.readout, nodes.final, ...atoms(nodes)]) {
    assert.equal(Object.isFrozen(wrapper), true);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(wrapper))) assert.ok(Object.hasOwn(descriptor, 'value'));
  }
  for (const atom of atoms(nodes)) {
    assert.deepEqual(Object.keys(atom), ['element', 'text']);
    assert.deepEqual(atom.element.children, [atom.text]);
  }
  for (const node of f.created) assert.equal(Object.isFrozen(node), false);
  assert.deepEqual(atoms(nodes).map(a => f.text(a.text)), ['Your length: ', '', 'Your rank: ', '', ' of ', '', 'Last length: ', '']);
  assert.deepEqual(Object.fromEntries(f.style(nodes.mount)), { position: 'absolute', left: '8px', bottom: '8px',
    width: '34ch', display: 'block', color: '#eee', 'font-family': 'monospace', 'font-size': '12px',
    'white-space': 'pre', 'pointer-events': 'none', border: '0', 'border-radius': '0', background: 'none' });
  for (const atom of [nodes.readout.lengthValue, nodes.readout.rankValue, nodes.readout.populationValue]) {
    const style = f.style(atom.element);
    assert.equal(style.get('display'), 'inline'); assert.equal(style.has('width'), false);
    assert.equal(style.has('text-align'), false, 'values follow labels without reserved column gaps');
    assert.equal(style.get('font-family'), 'inherit');
    assert.equal(style.get('font-variant-numeric'), 'tabular-nums');
  }
  assert.deepEqual(Object.fromEntries(f.style(nodes.final.value.element)), {
    display: 'inline-block', 'box-sizing': 'content-box', 'text-align': 'right',
    'font-family': 'monospace', 'font-variant-numeric': 'tabular-nums', width: '18ch', 'font-weight': 'bold',
  });
  assert.equal(f.style(nodes.readout.root).get('font-family'), 'Arial, sans-serif');
  assert.equal(f.style(nodes.final.root).has('font-family'), false, 'final presentation retains its existing family');
  assert.equal(f.style(nodes.readout.lengthValue.element).get('font-weight'), 'bold');
  assert.equal(f.style(nodes.final.value.element).get('font-weight'), 'bold');
  assert.equal(f.style(nodes.final.root).get('display'), 'block');
  assert.equal(f.style(nodes.mount).has('opacity'), false);
  assert.equal(f.style(nodes.final.root).has('opacity'), false);
  assert.equal(f.calls.some(c => c.name === 'setText'), false);
  assert.equal(f.style(f.parent).size, 0, 'borrowed parent has no style mutations');
  assert.ok(f.calls.every(c => [...domNames, 'current', 'createElement', 'createTextNode', 'appendChild'].includes(c.name)));
  assert.ok(f.calls.filter(c => c.name === 'setStyle').every(c => c.args[0] !== f.document && c.args[0] !== f.parent));
  assert.equal(bind(f, nodes).binding.readiness().state, 'ready');
  const count = f.calls.length;
  assert.throws(lease.mount, /consumed/); assert.equal(f.calls.length, count);
  lease.dispose(); lease.dispose(); assert.deepEqual(f.parent.children, []);
});

test('default stylesheet omits the empty owned final row until genuine final text exists', async () => {
  // Selector/tree/text contract only; this fixture does not execute a CSS engine.
  const css = await readFile(new URL('../extension/game-host.css', import.meta.url), 'utf8');
  assert.match(css, /#slither-client-root > div > div \+ div:has\(> span \+ b:empty\)\s*\{\s*display:\s*none\s*!important;\s*\}/);
  const f = fixture(), lease = f.lease(), nodes = lease.mount(), b = bind(f, nodes);
  assert.deepEqual(nodes.mount.children, [nodes.readout.root, nodes.final.root]);
  assert.deepEqual(nodes.final.root.children, [nodes.final.label.element, nodes.final.value.element]);
  assert.equal(f.text(nodes.final.value.text), '');
  let state = displayed(createHudState(b.sceneIdentity, HudHistoryDouble), 21, 65, 65);
  const current = b.render(state);
  assert.equal(current.readoutWritten, true); assert.equal(current.finalWritten, false);
  assert.equal(f.text(nodes.final.value.text), '', 'current history cannot expose an empty final row');
  for (const score of [0, -0, -1, 1001]) {
    state = packet(state, [{ kind: 'final-score', commandIndex: 0, view: scoreView(score) }]);
    assert.equal(b.render(state).finalWritten, true);
    assert.equal(f.text(nodes.final.value.text), String(score) + (score > 1000 ? '!' : ''));
    assert.notEqual(f.text(nodes.final.value.text), '', 'zero is a populated final score');
  }
  state = reduce(state, { kind: 'world-reset' });
  b.render(state);
  assert.equal(f.text(nodes.final.value.text), '1001!', 'retained final history remains populated');
  b.binding.dispose(); lease.dispose();
});

test('real histories publish safe integer domains, negative zero, ranks/populations and retained final suffix', () => {
  const f = fixture(), lease = f.lease(), nodes = lease.mount(), b = bind(f, nodes);
  let state = createHudState(b.sceneIdentity, HudHistoryDouble);
  let receipt = b.render(state);
  assert.equal(receipt.readiness, 'pending');
  assert.equal(receipt.readoutWritten, false); assert.equal(receipt.finalWritten, false);
  assert.deepEqual(atoms(nodes).map(a => f.text(a.text)), ['Your length: ', '', 'Your rank: ', '', ' of ', '', 'Last length: ', '']);
  for (const [index, score] of [-9007199254740991, -1, -0, 0, 4294967296, 9007199254740991].entries()) {
    const rank = index % 2 ? 65535 : 1, population = index % 2 ? 1 : 65535;
    state = displayed(state, score, rank, population);
    const view = projectHudView(state, b.binding.readiness());
    assert.equal(Object.is(view.current.value.score, score), true);
    receipt = b.binding.render(view);
    assert.equal(receipt.readoutWritten, true); assert.equal(receipt.finalWritten, false);
    assert.equal(f.text(nodes.readout.lengthValue.text), String(score));
    assert.equal(f.text(nodes.readout.rankValue.text), String(rank));
    assert.equal(f.text(nodes.readout.populationValue.text), String(population));
    assert.equal([nodes.readout.lengthLabel, nodes.readout.lengthValue].map(a => f.text(a.text)).join(''),
      `Your length: ${String(score)}`);
    assert.equal([nodes.readout.rankLabel, nodes.readout.rankValue, nodes.readout.separator, nodes.readout.populationValue]
      .map(a => f.text(a.text)).join(''), `Your rank: ${rank} of ${population}`);
    assert.equal(f.style(nodes.readout.root).get('font-family'), 'Arial, sans-serif');
    assert.equal(f.text(nodes.final.value.text), '');
    assert.equal(f.style(nodes.readout.lengthValue.element).get('display'), 'inline');
    assert.equal(f.style(nodes.readout.lengthValue.element).has('width'), false);
  }
  for (const score of [-9007199254740991, -0, 0, 1000, 1001, 9007199254740991]) {
    state = packet(state, [{ kind: 'final-score', commandIndex: 0, view: scoreView(score) }]);
    b.render(state);
    assert.equal(f.text(nodes.final.value.text), String(score) + (score > 1000 ? '!' : ''));
    assert.equal(f.style(nodes.final.value.element).get('width'), '18ch');
  }
  state = packet(state, [board(3, 4)]); // New header cannot replace stored displayed history.
  b.render(state); assert.equal(f.text(nodes.readout.rankValue.text), '65535');
  state = reduce(state, { kind: 'step', delta: 0, lifecycle: { schema: 1, deathPending: false,
    returnActive: true, returnCompleted: true, returnFraction: 0 } });
  b.render(state);
  assert.equal(f.style(nodes.readout.root).get('opacity'), '-1');
  assert.equal(f.style(nodes.final.root).get('display'), 'block');
  assert.equal(f.style(nodes.final.root).has('opacity'), false);
  state = reduce(state, { kind: 'world-reset' });
  state = displayed(state, 2, 1, 2, 8n);
  b.render(state);
  assert.equal(f.text(nodes.final.value.text), '9007199254740991!');
  assert.equal(state.final.ownToken, 7n); assert.equal(state.current.ownToken, 8n);
  assert.equal(f.text(nodes.final.label.text), 'Last length: ');
  assert.equal(f.style(nodes.readout.root).get('font-size'), '12px');
  assert.equal(f.style(nodes.readout.lengthLine).get('font-size'), '14px');
  assert.throws(() => b.binding.render({ ...projectHudView(state, b.binding.readiness()) }), /Invalid HUD view/);
  b.binding.dispose(); lease.dispose();
});

test('closed own-data records reject getters, inherited/foreign/symbol/extra/missing fields without native work', () => {
  for (const group of ['input', 'dom', 'construct']) {
    const f = fixture(), original = group === 'input' ? f.input : f.input[group];
    const key = Object.keys(original)[0];
    const variants = [Object.assign(Object.create({ inherited: true }), original),
      { ...original, extra: true }, { ...original, [Symbol('extra')]: true },
      Object.fromEntries(Object.entries(original).filter(([name]) => name !== key)),
      Object.defineProperty({ ...original }, key, { get() { throw new Error('record getter called'); } }),
      vm.runInNewContext('({})')];
    for (const value of variants) {
      const input = group === 'input' ? value : { ...f.input, [group]: value };
      assert.throws(() => createOwnedHudUi(input), /Invalid owned HUD/);
      assert.equal(f.calls.length, 0);
    }
    const nullRecord = Object.assign(Object.create(null), original);
    const lease = createOwnedHudUi(group === 'input' ? nullRecord : { ...f.input, [group]: nullRecord });
    lease.dispose(); assert.equal(f.calls.length, 0);
  }
  for (const callback of [null, {}, async function () {}, function* () {}, async function* () {}, async () => {}]) {
    for (const group of ['dom', 'construct', 'checker']) {
      const f = fixture();
      const input = group === 'checker' ? { ...f.input, isCurrentDocument: callback }
        : { ...f.input, [group]: { ...f.input[group], [Object.keys(f.input[group])[0]]: callback } };
      assert.throws(() => createOwnedHudUi(input), /Invalid owned HUD/); assert.equal(f.calls.length, 0);
    }
  }
});

test('constructor captures operations rather than reading mutated capability records later', () => {
  const f = fixture(), lease = f.lease();
  for (const group of [f.dom, f.construct]) for (const name of Object.keys(group)) {
    group[name] = () => { throw new Error('late capability replacement'); };
  }
  f.input.isCurrentDocument = () => { throw new Error('late checker'); };
  const nodes = lease.mount(); assert.equal(f.created.length, 21);
  lease.dispose(); assert.equal(f.native.state(nodes.mount).parent, null);
});

test('native brands, exact document, connected HTML parent and distinct fresh nodes are required', () => {
  for (const mode of ['plain', 'proxy', 'prototype', 'foreign', 'detached', 'svg', 'text', 'document']) {
    const f = fixture();
    let parent = f.parent;
    if (mode === 'plain') parent = {};
    if (mode === 'proxy') parent = new Proxy(parent, {});
    if (mode === 'prototype') parent = Object.create(f.native.hud.HTMLElement.prototype);
    if (mode === 'foreign') f.native.state(parent).owner = new f.native.Document();
    if (mode === 'detached') f.detach(parent);
    if (mode === 'svg') f.native.state(parent).namespace = 'http://www.w3.org/2000/svg';
    if (mode === 'text') parent = new f.native.hud.CharacterData('synthetic');
    if (mode === 'document') parent = f.document;
    assert.throws(() => createOwnedHudUi({ ...f.input, parent }).mount());
    assert.equal(f.calls.some(c => c.name === 'appendChild'), false);
  }
  for (const replacement of ['document', 'parent', 'duplicate', 'fake', 'wrong-tag', 'wrong-document', 'connected']) {
    const f = fixture(), original = f.construct.createElement;
    let first;
    f.construct.createElement = (receiver, tag) => {
      if (replacement === 'document') return f.document;
      if (replacement === 'parent') return f.parent;
      if (replacement === 'fake') return Object.create(f.native.hud.HTMLElement.prototype);
      const value = original(receiver, tag);
      if (replacement === 'duplicate' && first) return first;
      if (replacement === 'wrong-tag') f.native.state(value).tag = 'section';
      if (replacement === 'wrong-document') f.native.state(value).owner = new f.native.Document();
      if (replacement === 'connected') Reflect.apply(f.native.Node.prototype.appendChild, f.parent, [value]);
      first = value; return value;
    };
    const lease = f.lease(); assert.throws(lease.mount); lease.dispose();
    assert.equal(f.calls.some(c => c.name === 'appendChild' && c.args[0] === f.parent), false);
  }
});

test('every native boundary before/after effect preserves exact primary; no internal cleanup or retry', t => {
  const control = fixture(); control.lease().mount();
  const tape = control.calls.map(c => c.name);
  assert.equal(tape.filter(name => name === 'current').length, 3);
  for (const [index, name] of tape.entries()) for (const phase of ['before', 'after']) for (const primary of primaries) {
    const f = fixture(), lease = f.lease();
    let position = -1, guard = true, poisoned = false;
    f.hook((at, entry) => {
      if (at === 'before') position++;
      if (position === index && at === phase) { poisoned = true; throw primary; }
      if (entry.name === 'removeChild' && guard && poisoned) throw new Error('poisoned cleanup guard');
    });
    throwsExact(lease.mount, primary);
    assert.equal(f.calls.some(c => c.name === 'removeChild'), false, `${index} ${name} ${phase}: no internal cleanup`);
    const stopped = f.calls.length;
    assert.throws(lease.mount, /consumed/); assert.equal(f.calls.length, stopped);
    guard = false; f.hook(() => {});
    lease.dispose(); lease.dispose();
    assert.deepEqual(f.parent.children, [], `${index} ${name} ${phase}: external disposal`);
    assert.ok(f.calls.filter(c => c.name === 'removeChild').length <= 1);
  }
  t.diagnostic(`${tape.length} native/checker calls, ${tape.length * 2 * primaries.length} before/after exact-primary cases`);
});

test('each falsy/symbol/Error primary survives final append effect until external post-guard disposal', () => {
  for (const primary of primaries) {
    const f = fixture(), lease = f.lease(); let active = true;
    f.hook((phase, entry) => {
      if (entry.name === 'appendChild' && entry.args[0] === f.parent && phase === 'after') throw primary;
      if (entry.name === 'removeChild' && active) throw new Error('cleanup forbidden in active guard');
    });
    throwsExact(lease.mount, primary); assert.equal(f.parent.children.length, 1);
    assert.equal(f.calls.some(c => c.name === 'removeChild'), false);
    active = false; f.hook(() => {}); lease.dispose(); assert.deepEqual(f.parent.children, []);
  }
});

test('false freshness stops native work at every freshness boundary; invalid results latch failure', () => {
  for (const check of [1, 2, 3]) {
    const f = fixture(), lease = f.lease(); let count = 0;
    f.hook((phase, entry) => { if (phase === 'before' && entry.name === 'current' && ++count === check) f.current(false); });
    assert.throws(lease.mount, /Stale/);
    assert.equal(f.calls.at(-1).name, 'current');
    const before = f.calls.length; lease.dispose();
    assert.ok(f.calls.slice(before).every(c => c.name === 'current'));
    assert.throws(lease.mount, /consumed/);
  }
  for (const result of [undefined, null, 0, 1, 'true', {}, Promise.resolve(true)]) {
    const f = fixture(); f.current(result); const lease = f.lease();
    assert.throws(lease.mount, /Invalid/); assert.deepEqual(f.calls.map(c => c.name), ['current']);
    lease.dispose();
  }
});

test('disposal preserves unrelated nodes; detached/reparented/stale mounts are never repaired or searched', () => {
  for (const mode of ['attached', 'detached', 'reparented', 'stale']) {
    const f = fixture(), lease = f.lease(), nodes = lease.mount();
    const unrelated = new f.native.hud.HTMLElement('section');
    Reflect.apply(f.native.Node.prototype.appendChild, f.parent, [unrelated]);
    let other;
    if (mode === 'detached') f.detach(nodes.mount);
    if (mode === 'reparented') other = f.reparent(nodes.mount);
    if (mode === 'stale') f.current(false);
    const before = f.calls.length; lease.dispose(); const after = f.calls.length;
    lease.dispose(); assert.equal(f.calls.length, after);
    assert.equal(f.native.state(unrelated).parent, f.parent);
    const cleanup = f.calls.slice(before);
    assert.deepEqual(cleanup.map(c => c.name), mode === 'stale' ? ['current']
      : mode === 'attached' ? ['current', 'parentNode', 'removeChild'] : ['current', 'parentNode']);
    if (other) assert.deepEqual(other.children, [nodes.mount]);
    assert.throws(lease.mount, /consumed/);
  }
});

test('cleanup exceptions consume references and cannot be retried, including after native remove effect', () => {
  for (const name of ['current', 'parentNode', 'removeChild']) for (const phase of ['before', 'after']) {
    for (const primary of primaries) {
      const f = fixture(), lease = f.lease(), nodes = lease.mount();
      f.hook((at, entry) => { if (entry.name === name && at === phase) throw primary; });
      throwsExact(lease.dispose, primary);
      const before = f.calls.length; lease.dispose(); assert.equal(f.calls.length, before);
      assert.throws(lease.mount, /consumed/); assert.equal(f.calls.length, before);
      assert.equal(f.native.state(nodes.mount).parent === null, name === 'removeChild' && phase === 'after');
    }
  }
});

test('false remove result never triggers retry, restoration or a foreign removal', () => {
  for (const effect of [false, true]) {
    const f = fixture(), original = f.construct.removeChild;
    let removals = 0;
    f.construct.removeChild = (receiver, child) => {
      removals++;
      if (effect) original(receiver, child);
      return false;
    };
    const lease = f.lease(), nodes = lease.mount();
    assert.equal(lease.dispose(), undefined); lease.dispose();
    assert.equal(removals, 1);
    assert.equal(f.native.state(nodes.mount).parent, effect ? null : f.parent);
  }
});

test('parent connection is revalidated before final attachment; malformed native nodes/styles cannot mount', () => {
  const f = fixture(), lease = f.lease();
  let detached = false;
  f.hook((phase, entry) => {
    if (!detached && phase === 'after' && entry.name === 'setStyle') {
      detached = true; f.detach(f.parent);
    }
  });
  assert.throws(lease.mount, /Invalid/);
  assert.equal(f.calls.some(c => c.name === 'appendChild' && c.args[0] === f.parent), false);
  f.hook(() => {}); lease.dispose();
  for (const mode of ['text-alias', 'text-wrong-type', 'text-fake', 'style-null', 'style-alias', 'nonempty']) {
    const f = fixture();
    if (mode.startsWith('text')) {
      const original = f.construct.createTextNode; let first;
      f.construct.createTextNode = (receiver, value) => {
        const node = original(receiver, value);
        if (mode === 'text-fake') return Object.create(f.native.hud.CharacterData.prototype);
        if (mode === 'text-wrong-type') return f.parent;
        if (first) return first;
        first = node; return node;
      };
    } else if (mode.startsWith('style')) {
      const original = f.dom.style; let shared;
      f.dom.style = receiver => {
        const value = original(receiver);
        if (receiver === f.parent) return value;
        if (mode === 'style-null') return null;
        shared ??= value; return shared;
      };
    } else {
      const original = f.construct.createElement;
      f.construct.createElement = (receiver, tag) => {
        const node = original(receiver, tag);
        Reflect.apply(f.native.Node.prototype.appendChild, node, [new f.native.hud.CharacterData('extra')]);
        return node;
      };
    }
    const lease = f.lease(); assert.throws(lease.mount); lease.dispose();
    assert.equal(f.calls.some(c => c.name === 'appendChild' && c.args[0] === f.parent), false);
  }
});

test('caught construction reentry is externally poisoned, then post-guard cleanup remains usable', () => {
  const f = fixture(), lease = f.lease(), refusal = new Error('synthetic runtime reentry refusal');
  let guard = true, poisoned = false;
  f.hook((phase, entry) => {
    if (entry.name === 'appendChild' && entry.args[0] === f.parent && phase === 'after') {
      try { if (guard) { poisoned = true; throw refusal; } } catch { /* synthetic injected trap catches refusal */ }
      if (poisoned) throw refusal; // Labelled runtime operation forwarder's latched-primary check.
    }
    if (guard && entry.name === 'removeChild') throw new Error('active guard cleanup');
  });
  throwsExact(lease.mount, refusal); assert.equal(f.parent.children.length, 1);
  assert.equal(f.calls.some(c => c.name === 'removeChild'), false);
  guard = false; f.hook(() => {}); lease.dispose(); assert.deepEqual(f.parent.children, []);
});
