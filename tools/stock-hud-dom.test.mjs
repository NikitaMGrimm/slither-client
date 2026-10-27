// Authored synthetic native-capability doubles; no DOM, CSS, browser or pixel acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as renderer from '../web/stock-hud-dom.mjs';
import { projectHudView } from '../web/stock-hud-view.mjs';
import { createHudState, reduceHudState } from '../web/stock-hud-state.mjs';

const { bindStockHudDom } = renderer;
const primaries = [undefined, null, false, 0, new Error('synthetic primary')];
const capabilityNames = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild',
  'nextSibling', 'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const scoreView = (score, token = 7n) => ({
  schema: 1, enabled: true, tableMax: 3,
  own: { token, id: 0, logicalSegments: 2, fractionalMass: .5, scoreAdjustment: 1, scoreIndex: 3 },
  status: 'ready', score, error: null,
});
const board = (rank = 7, population = 23) => ({
  kind: 'leaderboard', commandIndex: 0, localRow: 2, rank, population, deathPending: false,
});
const reduce = (state, change) => reduceHudState(state, state.sceneIdentity, change);
const packet = (state, events) => reduce(state, { kind: 'packet', report: {
  schema: 1, commandCount: 1, setupDraws: 0, events,
} });
function history(sceneIdentity, { current = 42, final = 1001, token = 7n } = {}) {
  let state = createHudState(sceneIdentity);
  if (current !== null) {
    state = packet(state, [board()]);
    state = reduce(state, { kind: 'draw', playing: true, view: scoreView(current, token) });
  }
  if (final !== null) state = packet(state, [{
    kind: 'final-score', commandIndex: 0, view: scoreView(final, token),
  }]);
  return state;
}
function step(state, lifecycle = {}) {
  return reduce(state, { kind: 'step', delta: 5, lifecycle: {
    schema: 1, deathPending: false, returnActive: false,
    returnCompleted: false, returnFraction: 1, ...lifecycle,
  } });
}
function throwsExact(callback, primary) {
  let caught = false;
  try { callback(); } catch (error) {
    caught = true;
    assert.equal(error, primary);
  }
  assert.equal(caught, true, 'must throw even when primary is undefined');
}

function fixture(scope = 'readout-and-final') {
  // WeakMap brands model captured getters' exact receivers; instance accessors are tripwires.
  const nodes = new WeakMap();
  const styles = new WeakMap();
  const calls = [];
  const writes = [];
  let hook = () => {};
  let currentHook = () => {};
  let current = true;
  let checks = 0;
  const brand = target => {
    if (!nodes.has(target)) throw new TypeError('Synthetic native Node receiver');
    return nodes.get(target);
  };
  class NativeNode {
    get nodeType() { return brand(this).type; }
    get ownerDocument() { return brand(this).document; }
    get parentNode() { return brand(this).parent; }
    get firstChild() { return brand(this).children[0] ?? null; }
    get nextSibling() {
      const { parent } = brand(this);
      if (parent === null) return null;
      const siblings = brand(parent).children;
      return siblings[siblings.indexOf(this) + 1] ?? null;
    }
    get isConnected() { return brand(this).connected; }
    get localName() {
      const data = brand(this);
      if (data.type !== 1) throw new TypeError('Synthetic native Element receiver');
      return data.name;
    }
    get namespaceURI() {
      const data = brand(this);
      if (data.type !== 1) throw new TypeError('Synthetic native Element receiver');
      return data.namespace;
    }
    get style() {
      const data = brand(this);
      if (data.type !== 1 || data.namespace !== 'http://www.w3.org/1999/xhtml') {
        throw new TypeError('Synthetic native HTMLElement receiver');
      }
      return data.style;
    }
    set data(value) {
      const data = brand(this);
      if (data.type !== 3) throw new TypeError('Synthetic native CharacterData receiver');
      assert.equal(typeof value, 'string');
      data.text = value;
    }
  }
  function nativeSetProperty(property, value) {
    if (!styles.has(this)) throw new TypeError('Synthetic native CSSStyleDeclaration receiver');
    assert.equal(typeof property, 'string');
    assert.equal(typeof value, 'string');
    styles.get(this).set(property, value);
  }
  const dom = {};
  for (const name of capabilityNames) {
    const descriptor = Object.getOwnPropertyDescriptor(NativeNode.prototype, name);
    if (name === 'setText') {
      const setter = Object.getOwnPropertyDescriptor(NativeNode.prototype, 'data').set;
      dom[name] = (target, value) => {
        calls.push([name, target, value]); hook(name, target, value);
        Reflect.apply(setter, target, [value]);
        writes.push([name, target, value]);
      };
    } else if (name === 'setStyle') {
      dom[name] = (target, property, value) => {
        calls.push([name, target, property, value]); hook(name, target, property, value);
        Reflect.apply(nativeSetProperty, target, [property, value]);
        writes.push([name, target, property, value]);
      };
    } else {
      const getter = descriptor.get;
      dom[name] = target => {
        calls.push([name, target]); hook(name, target);
        return Reflect.apply(getter, target, []);
      };
    }
  }
  const make = (type, name, document, text = '') => {
    const target = Object.create(null);
    const style = Object.create(null);
    styles.set(style, new Map());
    for (const key of ['style', 'ownerDocument', 'textContent', 'nodeType', 'then',
      'localName', 'firstChild', 'nextSibling', 'parentNode', 'isConnected']) {
      Object.defineProperty(target, key, { get() { throw new Error(`Instance ${key} access`); } });
    }
    nodes.set(target, { type, name, document, text, parent: null, children: [], connected: true,
      namespace: 'http://www.w3.org/1999/xhtml', style });
    return target;
  };
  const document = make(9, null, null);
  const element = name => make(1, name, document);
  const children = (parent, values) => {
    brand(parent).children = [...values];
    for (const value of values) brand(value).parent = parent;
  };
  const atom = (name, text) => {
    const value = { element: element(name), text: make(3, null, document, text) };
    children(value.element, [value.text]);
    return value;
  };
  const mount = element('section');
  children(document, [mount]);
  const readout = {
    root: element('div'), lengthLine: element('div'), rankLine: element('div'),
    lengthLabel: atom('span', 'AUTHORED LENGTH'), lengthValue: atom('b', 'keep-length'),
    rankLabel: atom('span', 'AUTHORED RANK'), rankValue: atom('span', 'keep-rank'),
    separator: atom('span', ' / authored / '), populationValue: atom('span', 'keep-population'),
  };
  children(readout.root, [readout.lengthLine, readout.rankLine]);
  children(readout.lengthLine, [readout.lengthLabel.element, readout.lengthValue.element]);
  children(readout.rankLine, [readout.rankLabel.element, readout.rankValue.element,
    readout.separator.element, readout.populationValue.element]);
  const final = { root: element('div'), label: atom('span', 'AUTHORED FINAL'), value: atom('b', 'keep-final') };
  children(final.root, [final.label.element, final.value.element]);
  children(mount, scope === 'readout' ? [readout.root] : [readout.root, final.root]);
  const input = {
    sceneIdentity: Symbol('synthetic scene'), documentIdentity: Symbol('synthetic document'), scope, dom,
    nodes: { schema: 1, document, mount, textPolicy: 'authored', readout, final: scope === 'readout' ? null : final },
    isCurrentDocument() { checks++; currentHook(); return current; },
  };
  return {
    input, readout, final, document, mount, dom, calls, writes, make, element, children,
    spoof: () => Object.create(NativeNode.prototype),
    data: brand, style: target => styles.get(brand(target).style), text: target => brand(target).text,
    setHook(value) { hook = value; }, setCurrentHook(value) { currentHook = value; },
    setCurrent(value) { current = value; }, get checks() { return checks; },
    bind() { return bindStockHudDom(input); },
    view(binding, state = history(input.sceneIdentity)) { return projectHudView(state, binding.readiness()); },
  };
}

const noWrites = result => {
  assert.equal(result.readoutWritten, false);
  assert.equal(result.finalWritten, false);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(Object.keys(result), ['schema', 'readiness', 'reason', 'readoutWritten', 'finalWritten']);
};
function unavailable(binding, reason) {
  const status = binding.readiness();
  assert.equal(status.state, 'unavailable');
  assert.equal(status.reason, reason);
  const result = binding.render(new Proxy({}, { get() { throw new Error('terminal view inspected'); } }));
  assert.equal(result.readiness, 'unavailable');
  assert.equal(result.reason, reason);
  noWrites(result);
}

test('exact frozen API; constructor only copies own data, never calls native capabilities', () => {
  assert.deepEqual(Object.keys(renderer), ['bindStockHudDom']);
  const f = fixture();
  const binding = f.bind();
  assert.equal(Object.isFrozen(binding), true);
  assert.deepEqual(Object.keys(binding), ['readiness', 'render', 'dispose']);
  assert.equal(f.checks, 0);
  assert.deepEqual(f.calls, []);
  const status = binding.readiness();
  assert.equal(Object.isFrozen(status), true);
  assert.deepEqual(Object.keys(status), ['schema', 'bindingIdentity', 'documentIdentity', 'sceneIdentity',
    'scope', 'state', 'reason']);
  assert.equal(status.state, 'ready');
  assert.equal(status.reason, null);
  assert.equal(status.sceneIdentity, f.input.sceneIdentity);
  assert.equal(status.documentIdentity, f.input.documentIdentity);
  assert.equal(binding.readiness().bindingIdentity, status.bindingIdentity);
  assert.notEqual(f.bind().readiness().bindingIdentity, status.bindingIdentity);
  assert.equal(f.writes.length, 0);
});

test('constructor closes every input record without accessors, then reads or coercion', () => {
  const locations = [
    f => [f.input, 'scope'], f => [f.input.dom, 'nodeType'],
    f => [f.input.nodes, 'schema'], f => [f.readout, 'root'],
    f => [f.readout.lengthValue, 'text'], f => [f.final, 'root'], f => [f.final.label, 'text'],
  ];
  for (const locate of locations) {
    for (const kind of ['extra', 'symbol', 'missing', 'accessor', 'prototype']) {
      const f = fixture();
      const [record, key] = locate(f);
      if (kind === 'extra') record.extra = true;
      if (kind === 'symbol') record[Symbol('extra')] = true;
      if (kind === 'missing') delete record[key];
      if (kind === 'accessor') Object.defineProperty(record, key, { get() { throw new Error('getter executed'); } });
      if (kind === 'prototype') Object.setPrototypeOf(record, { extra: true });
      assert.throws(() => f.bind(), TypeError);
      assert.equal(f.calls.length, 0);
      assert.equal(f.checks, 0);
    }
  }
  for (const bad of [null, undefined, [], Promise.resolve(), vm.runInNewContext('({})')]) {
    assert.throws(() => bindStockHudDom(bad), TypeError);
  }
  for (const mutate of [
    f => { f.input.sceneIdentity = {}; }, f => { f.input.documentIdentity = 'doc'; },
    f => { f.input.scope = 'all'; }, f => { f.input.nodes.schema = 2; },
    f => { f.input.nodes.textPolicy = 'default'; }, f => { f.input.nodes.mount = 3; },
    f => { f.readout.root = undefined; }, f => { f.input.nodes.final = []; },
    f => { f.input.dom.setText = null; }, f => { f.input.isCurrentDocument = false; },
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => f.bind(), TypeError);
  }
  const f = fixture('readout');
  f.input.nodes.final = f.final;
  assert.throws(() => f.bind(), TypeError);
  const neverThen = fixture();
  Object.defineProperty(neverThen.input, 'then', { get() { throw new Error('then read'); } });
  assert.throws(() => neverThen.bind(), TypeError);
  const copied = fixture();
  Object.setPrototypeOf(copied.input, null);
  Object.setPrototypeOf(copied.input.nodes, null);
  const binding = copied.bind();
  copied.input.isCurrentDocument = () => { throw new Error('replacement checker'); };
  copied.input.dom.nodeType = () => { throw new Error('replacement capability'); };
  copied.input.nodes.mount = null;
  copied.readout.lengthValue.text = null;
  assert.equal(binding.readiness().state, 'ready');
});

test('synchronous function validation is bounded to 64 prototype visits', () => {
  const callbacks = [async function () {}, function* () {}, async function* () {},
    (async () => {}).bind(null), (function* () {}).bind(null)];
  for (const callback of callbacks) {
    for (const key of ['isCurrentDocument', ...capabilityNames]) {
      const f = fixture();
      if (key === 'isCurrentDocument') f.input[key] = callback;
      else f.input.dom[key] = callback;
      assert.throws(() => f.bind(), TypeError);
      assert.equal(f.calls.length, 0);
    }
  }
  const disguised = async () => {};
  Object.setPrototypeOf(disguised, null);
  const f = fixture(); f.input.isCurrentDocument = disguised;
  assert.throws(() => f.bind(), TypeError);
  for (const cycle of [false, true]) {
    let visits = 0;
    const next = () => new Proxy({}, { getPrototypeOf() { visits++; return next(); } });
    let callback;
    callback = new Proxy(() => true, { getPrototypeOf() { visits++; return cycle ? callback : next(); } });
    const f = fixture(); f.input.isCurrentDocument = callback;
    assert.throws(() => f.bind(), TypeError);
    assert.ok(visits <= 64);
    if (!cycle) assert.equal(visits, 64);
  }
  const neverThen = fixture();
  for (const callback of [neverThen.input.isCurrentDocument, ...Object.values(neverThen.dom)]) {
    Object.defineProperty(callback, 'then', { get() { throw new Error('function then read'); } });
  }
  assert.equal(neverThen.bind().readiness().state, 'ready');
});

test('constructor reflection propagates exact primaries without invoking native capabilities', () => {
  for (const primary of primaries) {
    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
      const f = fixture();
      const input = new Proxy(f.input, { [trap]() { throw primary; } });
      throwsExact(() => bindStockHudDom(input), primary);
      assert.equal(f.calls.length, 0);
    }
    const f = fixture();
    f.input.isCurrentDocument = new Proxy(() => true, { getPrototypeOf() { throw primary; } });
    throwsExact(() => f.bind(), primary);
  }
});

test('both scopes and explicitly missing selected subtrees/nodes remain pending', () => {
  for (const scope of ['readout', 'readout-and-final']) {
    const f = fixture(scope); const binding = f.bind();
    assert.equal(binding.readiness().scope, scope);
    assert.equal(binding.readiness().state, 'ready');
    const view = f.view(binding);
    assert.equal(binding.render(view).finalWritten, scope === 'readout-and-final');
  }
  const missing = [
    f => { f.input.nodes.readout = null; }, f => { f.input.nodes.final = null; },
    f => { f.input.nodes.document = null; }, f => { f.input.nodes.mount = null; },
    f => { f.readout.root = null; }, f => { f.readout.lengthValue.text = null; },
    f => { f.final.value.element = null; },
  ];
  for (const mutate of missing) {
    const f = fixture(); mutate(f); const binding = f.bind();
    const status = binding.readiness();
    assert.equal(status.state, 'pending'); assert.equal(status.reason, 'nodes-pending');
    noWrites(binding.render(f.view(binding)));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.input.nodes.textPolicy = 'unselected'; const binding = f.bind();
  assert.equal(binding.readiness().reason, 'text-unselected');
  noWrites(binding.render(f.view(binding)));
  assert.equal(f.writes.length, 0);
});

test('false document freshness short circuits every native observation and write', () => {
  for (const scope of ['readout', 'readout-and-final']) {
    const f = fixture(scope); const binding = f.bind(); const view = f.view(binding);
    f.calls.length = 0; f.setCurrent(false);
    assert.equal(binding.readiness().reason, 'stale-document');
    const result = binding.render(view);
    assert.equal(result.readiness, 'unavailable'); assert.equal(result.reason, 'stale-document'); noWrites(result);
    assert.equal(f.calls.length, 0);
    f.setCurrent(true);
    assert.equal(binding.readiness().state, 'ready');
  }
});

test('nonboolean freshness fails without then inspection or coercion and releases binding', () => {
  const poison = { get then() { throw new Error('then read'); }, valueOf() { throw new Error('coercion'); } };
  for (const value of [undefined, null, 0, 1, 'yes', Promise.resolve(true), poison]) {
    const f = fixture(); const binding = f.bind(); f.setCurrent(value);
    assert.throws(() => binding.readiness(), TypeError);
    assert.equal(f.calls.length, 0);
    const checks = f.checks;
    unavailable(binding, 'binding-failed');
    assert.equal(f.checks, checks);
    assert.equal(binding.dispose(), undefined);
    unavailable(binding, 'disposed');
  }
});

test('native type/name/namespace/document/connection and all identity aliases are checked', () => {
  const mutations = [
    f => { f.data(f.document).type = 1; }, f => { f.data(f.mount).type = 3; },
    f => { f.data(f.mount).namespace = 'http://www.w3.org/2000/svg'; },
    f => { f.data(f.readout.root).type = 3; }, f => { f.data(f.readout.root).name = 'span'; },
    f => { f.data(f.readout.lengthValue.element).name = 'strong'; },
    f => { f.data(f.readout.rankValue.text).type = 1; },
    f => { f.data(f.final.value.element).namespace = null; },
    f => { f.data(f.final.root).document = f.element('div'); },
    f => { f.data(f.readout.lengthValue.text).document = null; },
    f => { f.data(f.mount).document = null; },
    f => { f.data(f.document).connected = false; }, f => { f.data(f.mount).connected = false; },
    f => { f.data(f.final.value.text).connected = false; },
    f => { f.input.nodes.mount = f.readout.root; },
    f => { f.readout.rankValue.text = f.readout.lengthValue.text; },
    f => { f.final.label.element = f.readout.lengthLabel.element; },
    f => { f.input.nodes.document = f.mount; },
    f => { f.data(f.final.value.element).style = f.data(f.readout.lengthValue.element).style; },
    f => { f.data(f.final.value.element).style = null; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f); const binding = f.bind();
    assert.equal(binding.readiness().reason, 'nodes-pending');
    noWrites(binding.render(f.view(binding)));
    assert.equal(f.writes.length, 0);
  }
});

test('every fixed direct edge/order/sole Text is validated without arbitrary traversal', () => {
  const parents = f => [f.readout.root, f.readout.lengthLine, f.readout.rankLine,
    ...['lengthLabel', 'lengthValue', 'rankLabel', 'rankValue', 'separator', 'populationValue']
      .map(key => f.readout[key].element), f.final.root, f.final.label.element, f.final.value.element];
  for (let index = 0; index < 12; index++) {
    for (const kind of ['extra', 'missing', 'moved', 'replacement', 'reverse']) {
      const f = fixture(); const parent = parents(f)[index];
      const original = [...f.data(parent).children];
      if (kind === 'extra') f.children(parent, [...original, f.element('div')]);
      if (kind === 'missing') f.children(parent, original.slice(1));
      if (kind === 'moved') f.data(original[0]).parent = f.mount;
      if (kind === 'replacement') f.children(parent, [f.element('div'), ...original.slice(1)]);
      if (kind === 'reverse') {
        if (original.length < 2) continue;
        f.children(parent, original.reverse());
      }
      const binding = f.bind();
      assert.equal(binding.readiness().reason, 'nodes-pending', `${index}/${kind}`);
      assert.equal(f.writes.length, 0);
    }
  }
  for (const role of ['readout', 'final']) {
    const f = fixture(); f.data(f[role].root).parent = f.document;
    assert.equal(f.bind().readiness().reason, 'nodes-pending');
  }
  const f = fixture();
  // Unselected mount neighbors are deliberately not traversed or styled.
  const neighbor = f.element('aside');
  f.children(f.mount, [neighbor, f.readout.root, f.final.root, f.element('footer')]);
  const binding = f.bind(); assert.equal(binding.readiness().state, 'ready');
  binding.render(f.view(binding));
  assert.equal(f.calls.some(([, target]) => target === neighbor), false);
  assert.ok(f.calls.length < 800, 'fixed selected observation bound');
});

test('native brand exceptions invalidate; inheriting prototypes or Proxy wrappers do not fake nodes', () => {
  for (const wrap of [(f, node) => new Proxy(node, {}), f => f.spoof()]) {
    const f = fixture(); f.readout.lengthValue.text = wrap(f, f.readout.lengthValue.text);
    f.data(f.readout.lengthValue.element).children = [f.readout.lengthValue.text];
    const binding = f.bind();
    assert.throws(() => binding.readiness(), TypeError);
    const count = f.calls.length; unavailable(binding, 'binding-failed');
    assert.equal(f.calls.length, count);
  }
});

test('only numeric Text and the exact selected local styles are written; labels stay unchanged', () => {
  const f = fixture(); const binding = f.bind();
  const labels = [f.readout.lengthLabel, f.readout.rankLabel, f.readout.separator, f.final.label];
  const labelText = labels.map(atom => f.text(atom.text));
  const view = f.view(binding, step(history(f.input.sceneIdentity)));
  const result = binding.render(view);
  assert.deepEqual(result, { schema: 1, readiness: 'ready', reason: null, readoutWritten: true, finalWritten: true });
  assert.deepEqual([f.text(f.readout.lengthValue.text), f.text(f.readout.rankValue.text),
    f.text(f.readout.populationValue.text), f.text(f.final.value.text)], ['42', '7', '23', '1001!']);
  assert.deepEqual(labels.map(atom => f.text(atom.text)), labelText);
  const style = (node, pairs) => assert.deepEqual([...f.style(node)], pairs);
  style(f.readout.root, [['opacity', '0.05'], ['font-size', '12px']]);
  style(f.readout.lengthLine, [['font-size', '14px']]);
  style(f.readout.rankLine, []);
  style(f.readout.lengthLabel.element, [['opacity', '.4']]);
  style(f.readout.lengthValue.element, [['font-weight', 'bold'], ['opacity', '.8']]);
  style(f.readout.rankLabel.element, [['opacity', '.3']]);
  style(f.readout.separator.element, [['opacity', '.3']]);
  style(f.readout.rankValue.element, [['opacity', '.35']]);
  style(f.readout.populationValue.element, [['opacity', '.35']]);
  style(f.final.root, []); style(f.final.label.element, [['opacity', '.45']]);
  style(f.final.value.element, [['font-weight', 'bold']]); style(f.mount, []);
  assert.equal(f.writes.length, 16);
  assert.equal(f.calls.some(([name]) => /textContent|data|computed/i.test(name)), false);
  assert.equal(f.writes.some(([, , property]) => ['display', 'visibility', 'width'].includes(property)), false);
});

test('history absence, null getter and excluded final never manufacture writes or zeroes', () => {
  for (const scope of ['readout', 'readout-and-final']) {
    for (const current of [null, 0]) for (const final of [null, 0]) {
      const f = fixture(scope); const binding = f.bind();
      const view = f.view(binding, history(f.input.sceneIdentity, { current, final }));
      const result = binding.render(view);
      assert.equal(result.readoutWritten, current !== null);
      assert.equal(result.finalWritten, scope === 'readout-and-final' && final !== null);
      assert.equal(result.readiness, view.readiness);
      assert.equal(result.reason, view.reason);
      if (current === null) {
        assert.equal(f.text(f.readout.lengthValue.text), 'keep-length');
        assert.equal(f.style(f.readout.root).size, 0);
      }
      if (scope === 'readout' || final === null) {
        assert.equal(f.text(f.final.value.text), 'keep-final');
        assert.equal(f.style(f.final.label.element).size, 0);
      }
    }
    const f = fixture(scope); const binding = f.bind();
    const result = binding.render(f.view(binding, null));
    assert.equal(result.reason, 'hud-disabled-or-disposed');
    noWrites(result); assert.equal(f.writes.length, 0);
  }
});

test('stored displayed/final history survives newer headers, reset and live own-token changes', () => {
  const f = fixture(); const binding = f.bind();
  let state = history(f.input.sceneIdentity, { current: -7, final: 4294967297 });
  state = packet(state, [board(9, 30)]);
  assert.equal(state.rank, 9); assert.equal(state.current.rank, 7);
  state = reduce(state, { kind: 'world-reset' });
  state = packet(state, [{ kind: 'own-length-scheduled', commandIndex: 0, token: 8n }]);
  state = step(state, { returnActive: true, returnCompleted: true, returnFraction: 0 });
  const view = f.view(binding, state);
  assert.equal(view.current.value.ownToken, 7n); assert.equal(state.ownToken, 8n);
  binding.render(view);
  assert.equal(f.text(f.readout.lengthValue.text), '-7');
  assert.equal(f.text(f.readout.rankValue.text), '7');
  assert.equal(f.text(f.readout.populationValue.text), '23');
  assert.equal(f.text(f.final.value.text), '4294967297!');
  assert.equal(f.style(f.readout.root).get('opacity'), '-1');
  assert.equal(f.style(f.final.root).size, 0);
  const old = view;
  binding.render(f.view(binding, history(f.input.sceneIdentity, { current: 999, final: -5 })));
  binding.render(old);
  assert.equal(f.text(f.readout.lengthValue.text), '-7');
  assert.equal(f.text(f.final.value.text), '4294967297!');
});

test('real view decimal boundaries, negative zero and captured final suffix reach setters unchanged', () => {
  for (const score of [-Number.MAX_SAFE_INTEGER, -0, 0, 1000, 1001, 4294967297, Number.MAX_SAFE_INTEGER]) {
    const f = fixture(); const binding = f.bind();
    const view = f.view(binding, history(f.input.sceneIdentity, { current: score, final: score }));
    binding.render(view);
    assert.equal(f.text(f.readout.lengthValue.text), String(score));
    assert.equal(f.text(f.final.value.text), String(score) + (score > 1000 ? '!' : ''));
    if (Object.is(score, -0)) assert.equal(Object.is(view.current.value.score, -0), true);
  }
});

test('genuine view/all identities/scope required before native access; invalid view keeps binding healthy', () => {
  const f = fixture(); const binding = f.bind(); const view = f.view(binding);
  const proxies = [new Proxy(view, { get() { throw new Error('view reflected'); } }),
    Object.freeze({ ...view }), null, undefined, Promise.resolve(view)];
  for (const value of proxies) {
    const count = f.calls.length; const checks = f.checks;
    assert.throws(() => binding.render(value), TypeError);
    assert.equal(f.calls.length, count); assert.equal(f.checks, checks);
    assert.equal(binding.readiness().state, 'ready');
  }
  for (const field of ['bindingIdentity', 'documentIdentity', 'sceneIdentity', 'scope']) {
    const observed = binding.readiness();
    const changed = { ...observed, [field]: field === 'scope' ? 'readout' : Symbol('other') };
    const state = history(changed.sceneIdentity);
    const wrong = projectHudView(state, changed);
    const count = f.calls.length;
    assert.throws(() => binding.render(wrong), TypeError);
    assert.equal(f.calls.length, count);
  }
  const otherBinding = f.bind();
  assert.throws(() => otherBinding.render(view), TypeError);
  assert.equal(f.writes.length, 0);
});

test('pending/unavailable issued views never upgrade when actual binding becomes ready', () => {
  const cases = [['pending', 'nodes-pending'], ['pending', 'text-unselected'],
    ['unavailable', 'stale-document'], ['unavailable', 'binding-not-selected'],
    ['unavailable', 'native-dom-unavailable'], ['unavailable', 'binding-failed'], ['unavailable', 'disposed']];
  for (const [state, reason] of cases) {
    const f = fixture(); const binding = f.bind();
    const observed = { ...binding.readiness(), state, reason };
    const view = projectHudView(history(f.input.sceneIdentity), observed);
    const result = binding.render(view);
    noWrites(result); assert.equal(result.readiness, state); assert.equal(result.reason, reason);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(); const binding = f.bind();
  f.data(f.final.value.text).connected = false;
  const old = f.view(binding);
  f.data(f.final.value.text).connected = true;
  noWrites(binding.render(old)); assert.equal(f.writes.length, 0);
  assert.equal(binding.render(f.view(binding)).readoutWritten, true);
});

test('stale-ready view is downgraded on detachment; all selected nodes preflight before any effect', () => {
  for (const mutate of [
    f => { f.data(f.final.value.text).connected = false; },
    f => { f.children(f.final.root, [f.final.value.element, f.final.label.element]); },
    f => { f.data(f.readout.root).parent = f.document; },
  ]) {
    const f = fixture(); const binding = f.bind(); const view = f.view(binding); mutate(f);
    const result = binding.render(view);
    noWrites(result); assert.equal(result.reason, 'nodes-pending'); assert.equal(f.writes.length, 0);
  }
  for (const when of ['checker', 'last-style']) {
    const f = fixture(); const binding = f.bind(); const view = f.view(binding);
    let checks = 0; let styleCalls = 0;
    if (when === 'checker') f.setCurrentHook(() => { if (++checks === 2) f.setCurrent(false); });
    else f.setHook(name => {
      if (name === 'style' && ++styleCalls === 26) f.data(f.final.value.text).connected = false;
    });
    const result = binding.render(view);
    noWrites(result); assert.equal(f.writes.length, 0);
    assert.equal(result.reason, when === 'checker' ? 'stale-document' : 'nodes-pending');
  }
});

test('freshness/native observation exceptions preserve every primary and terminalize once', () => {
  for (const primary of primaries) {
    for (const operation of ['readiness', 'render']) {
      for (const name of ['checker', ...capabilityNames.filter(name => !name.startsWith('set'))]) {
        const f = fixture(); const binding = f.bind(); const view = f.view(binding);
        if (name === 'checker') f.setCurrentHook(() => { throw primary; });
        else f.setHook(actual => { if (actual === name) throw primary; });
        throwsExact(() => binding[operation](view), primary);
        const count = f.calls.length; const checks = f.checks;
        unavailable(binding, 'binding-failed');
        assert.equal(f.calls.length, count); assert.equal(f.checks, checks);
        assert.equal(f.writes.length, 0);
      }
    }
  }
});

test('all operations reject reentry before nested validation/callback/native access', () => {
  for (const outer of ['readiness', 'render']) {
    for (const nested of ['readiness', 'render', 'dispose']) {
      for (const site of ['checker', 'nodeType', 'style', ...(outer === 'render' ? ['setText', 'setStyle'] : [])]) {
        const f = fixture(); const binding = f.bind(); const view = f.view(binding);
        let tried = false;
        const reenter = () => {
          if (tried) return;
          tried = true;
          const before = f.calls.length; const checks = f.checks;
          const poison = new Proxy({}, { get() { throw new Error('nested reflection'); } });
          assert.throws(() => binding[nested](poison), /HUD DOM reentry/);
          assert.equal(f.calls.length, before); assert.equal(f.checks, checks);
        };
        if (site === 'checker') f.setCurrentHook(reenter);
        else f.setHook(name => { if (name === site) reenter(); });
        binding[outer](view);
        assert.equal(tried, true, `${outer}/${nested}/${site}`);
        assert.equal(binding.readiness().state, 'ready');
      }
    }
  }
  const f = fixture(); const binding = f.bind(); const view = f.view(binding);
  f.setHook(name => { if (name === 'setText') binding.dispose(); });
  assert.throws(() => binding.render(view), /HUD DOM reentry/);
  unavailable(binding, 'binding-failed');
});

test('every first/later text/style setter failure stops exactly there with no receipt or rollback', () => {
  for (const primary of primaries) {
    for (let failAt = 0; failAt < 16; failAt++) {
      const f = fixture(); const binding = f.bind(); const view = f.view(binding);
      let attempted = 0;
      f.setHook(name => {
        if (name === 'setText' || name === 'setStyle') {
          if (attempted++ === failAt) throw primary;
        }
      });
      throwsExact(() => binding.render(view), primary);
      assert.equal(attempted, failAt + 1);
      assert.equal(f.writes.length, failAt);
      if (failAt > 0) assert.equal(f.text(f.readout.lengthValue.text), '42');
      else assert.equal(f.text(f.readout.lengthValue.text), 'keep-length');
      const count = f.calls.length;
      unavailable(binding, 'binding-failed');
      assert.equal(f.calls.length, count);
      assert.equal(binding.dispose(), undefined);
      unavailable(binding, 'disposed');
      assert.equal(f.calls.length, count);
      assert.equal(f.writes.length, failAt);
    }
  }
});

test('dispose is idempotent reference-only; failed/disposed operations never touch revoked capabilities', () => {
  const f = fixture();
  const capabilityProxy = Proxy.revocable(f.dom, {});
  const nodesProxy = Proxy.revocable(f.input.nodes, {});
  f.input.dom = capabilityProxy.proxy; f.input.nodes = nodesProxy.proxy;
  const binding = f.bind(); const oldView = f.view(binding);
  capabilityProxy.revoke(); nodesProxy.revoke();
  assert.equal(binding.readiness().state, 'ready', 'private copies survive record revocation');
  assert.equal(binding.dispose(), undefined);
  const count = f.calls.length; const checks = f.checks;
  f.setHook(() => { throw new Error('native access after dispose'); });
  f.setCurrentHook(() => { throw new Error('checker access after dispose'); });
  assert.equal(binding.dispose(), undefined);
  assert.equal(binding.dispose(), undefined);
  unavailable(binding, 'disposed'); noWrites(binding.render(oldView));
  assert.equal(f.calls.length, count); assert.equal(f.checks, checks); assert.equal(f.writes.length, 0);
});
