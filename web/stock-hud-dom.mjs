// Authored passive fixed-node HUD renderer. Attachment and visibility are owner policy.
import { requireHudView } from './stock-hud-view.mjs';

const freeze = Object.freeze;
const apply = Reflect.apply;
const decimal = Function.prototype.call.bind(Number.prototype.toString);
const functionSource = Function.prototype.call.bind(Function.prototype.toString);
const asynchronous = [async function () {}, function* () {}, async function* () {}]
  .map(Object.getPrototypeOf);
const capabilityFields = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild',
  'nextSibling', 'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const readoutFields = ['root', 'lengthLine', 'rankLine', 'lengthLabel', 'lengthValue',
  'rankLabel', 'rankValue', 'separator', 'populationValue'];
const invalid = () => { throw new TypeError('Invalid HUD DOM input'); };

function record(value, fields) {
  if (value === null || typeof value !== 'object') invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) invalid();
  const copy = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !fields.includes(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}

function synchronous(callback) {
  if (typeof callback !== 'function') invalid();
  const seen = new Set();
  let prototype = callback;
  for (let visits = 0; visits < 64; visits++) {
    prototype = Object.getPrototypeOf(prototype);
    if (prototype === null) break;
    if (seen.has(prototype) || asynchronous.includes(prototype)) invalid();
    seen.add(prototype);
  }
  if (prototype !== null || /^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/
    .test(functionSource(callback))) invalid();
}

function node(value) {
  // Null is an explicitly missing fixed node; no provider is consulted later.
  if (value !== null && typeof value !== 'object') invalid();
  return value;
}

function copyNodes(value, scope) {
  const input = record(value, ['schema', 'document', 'mount', 'textPolicy', 'readout', 'final']);
  if (input.schema !== 1 || !['unselected', 'authored'].includes(input.textPolicy)) invalid();
  if (scope === 'readout' && input.final !== null) invalid();
  const entries = [];
  const add = (value, type, name, parent = null) => {
    const index = entries.length;
    entries.push({ node: node(value), type, name, parent, children: null });
    return index;
  };
  const document = add(input.document, 9, null);
  const mount = add(input.mount, 1, null);
  const element = (value, name, parent) => add(value, 1, name, parent);
  const atom = (value, name, parent) => {
    const input = record(value, ['element', 'text']);
    const index = element(input.element, name, parent);
    entries[index].children = [add(input.text, 3, null, index)];
    return index;
  };
  let readout = null;
  let final = null;
  if (input.readout !== null) {
    const source = record(input.readout, readoutFields);
    const root = element(source.root, 'div', mount);
    const lengthLine = element(source.lengthLine, 'div', root);
    const rankLine = element(source.rankLine, 'div', root);
    const lengthLabel = atom(source.lengthLabel, 'span', lengthLine);
    const lengthValue = atom(source.lengthValue, 'b', lengthLine);
    const rankLabel = atom(source.rankLabel, 'span', rankLine);
    const rankValue = atom(source.rankValue, 'span', rankLine);
    const separator = atom(source.separator, 'span', rankLine);
    const populationValue = atom(source.populationValue, 'span', rankLine);
    entries[root].children = [lengthLine, rankLine];
    entries[lengthLine].children = [lengthLabel, lengthValue];
    entries[rankLine].children = [rankLabel, rankValue, separator, populationValue];
    readout = { root, lengthLine, lengthLabel, lengthValue, rankLabel,
      rankValue, separator, populationValue };
  }
  if (input.final !== null) {
    const source = record(input.final, ['root', 'label', 'value']);
    const root = element(source.root, 'div', mount);
    const label = atom(source.label, 'span', root);
    const value = atom(source.value, 'b', root);
    entries[root].children = [label, value];
    final = { root, label, value };
  }
  return { entries, document, mount, textPolicy: input.textPolicy, readout, final };
}

const receipt = (readiness, reason, readoutWritten = false, finalWritten = false) =>
  freeze({ schema: 1, readiness, reason, readoutWritten, finalWritten });

/** Bind supplied authored nodes without observing or mutating native DOM at construction. */
export function bindStockHudDom(input) {
  let options = record(input,
    ['sceneIdentity', 'documentIdentity', 'scope', 'dom', 'nodes', 'isCurrentDocument']);
  input = undefined;
  const { sceneIdentity, documentIdentity, scope } = options;
  if (typeof sceneIdentity !== 'symbol' || typeof documentIdentity !== 'symbol'
    || (scope !== 'readout' && scope !== 'readout-and-final')) invalid();
  let dom = record(options.dom, capabilityFields);
  for (const name of capabilityFields) synchronous(dom[name]);
  let checker = options.isCurrentDocument;
  synchronous(checker);
  let tree = copyNodes(options.nodes, scope);
  options = undefined;
  const bindingIdentity = Symbol('HUD DOM binding');
  let terminal = null;
  let busy = false;

  function release(reason) {
    terminal = reason;
    dom = tree = checker = undefined;
  }

  function enter() {
    if (busy) throw new Error('HUD DOM reentry');
    busy = true;
  }

  function observation(state, reason, styles = null) {
    return { state, reason, styles };
  }

  function inspect(rechecking) {
    const current = apply(checker, undefined, []);
    if (typeof current !== 'boolean') invalid();
    if (!current) return observation('unavailable', 'stale-document');
    if (tree.textPolicy === 'unselected') return observation('pending', 'text-unselected');
    const { entries, document, mount } = tree;
    const pending = () => observation('pending', 'nodes-pending');
    if (tree.readout === null || (scope === 'readout-and-final' && tree.final === null)
      || entries.some(entry => entry.node === null)) return pending();
    if (new Set(entries.map(entry => entry.node)).size !== entries.length) return pending();
    const call = (name, target) => apply(dom[name], undefined, [target]);
    const acquireStyles = () => entries.map(entry => entry.type === 1 ? call('style', entry.node) : null);
    // On commit preflight, reacquire styles before the last topology observations.
    let styles = rechecking ? acquireStyles() : null;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (call('nodeType', entry.node) !== entry.type
        || call('isConnected', entry.node) !== true) return pending();
      if (index !== document && call('ownerDocument', entry.node) !== entries[document].node) return pending();
      if (entry.type === 1) {
        if (call('namespaceURI', entry.node) !== 'http://www.w3.org/1999/xhtml') return pending();
        const name = call('localName', entry.node);
        if (typeof name !== 'string' || (index !== mount && name !== entry.name)) return pending();
      }
      if (entry.parent !== null
        && call('parentNode', entry.node) !== entries[entry.parent].node) return pending();
      if (entry.children !== null) {
        if (call('firstChild', entry.node) !== entries[entry.children[0]].node) return pending();
        for (let child = 0; child < entry.children.length; child++) {
          const expected = child + 1 === entry.children.length ? null
            : entries[entry.children[child + 1]].node;
          if (call('nextSibling', entries[entry.children[child]].node) !== expected) return pending();
        }
      }
    }
    // Initial style acquisition follows complete selected-tree validation.
    if (styles === null) styles = acquireStyles();
    const unique = new Set();
    for (let index = 0; index < entries.length; index++) {
      if (entries[index].type !== 1) continue;
      const style = styles[index];
      if (style === null || typeof style !== 'object' || unique.has(style)) return pending();
      unique.add(style);
    }
    return observation('ready', null, styles);
  }

  function observe(rechecking = false) {
    try {
      return inspect(rechecking);
    } catch (primary) {
      release('binding-failed');
      throw primary;
    }
  }

  function readiness() {
    enter();
    try {
      const result = terminal === null ? observe() : observation('unavailable', terminal);
      return freeze({ schema: 1, bindingIdentity, documentIdentity, sceneIdentity,
        scope, state: result.state, reason: result.reason });
    } finally {
      busy = false;
    }
  }

  function render(value) {
    enter();
    try {
      if (terminal !== null) return receipt('unavailable', terminal);
      const view = requireHudView(value);
      if (view.bindingIdentity !== bindingIdentity || view.documentIdentity !== documentIdentity
        || view.sceneIdentity !== sceneIdentity || view.scope !== scope) invalid();
      const before = observe();
      const downgraded = result => {
        if (result.state === 'unavailable') return receipt(result.state, result.reason);
        if (view.readiness === 'unavailable') return receipt(view.readiness, view.reason);
        return result.state === 'pending' ? receipt(result.state, result.reason)
          : receipt(view.readiness, view.reason);
      };
      if (before.state !== 'ready') return downgraded(before);
      const readoutWritten = view.current.readiness === 'ready';
      const finalWritten = scope === 'readout-and-final' && view.final.readiness === 'ready';
      if (!readoutWritten && !finalWritten) return downgraded(before);
      const plan = [];
      const text = (index, value) => plan.push(['setText',
        tree.entries[tree.entries[index].children[0]].node, value]);
      const style = (index, property, value) => plan.push(['setStyle', before.styles[index], property, value]);
      if (readoutWritten) {
        const role = tree.readout;
        text(role.lengthValue, view.current.value.scoreText);
        text(role.rankValue, view.current.value.rankText);
        text(role.populationValue, view.current.value.populationText);
        style(role.root, 'opacity', decimal(view.requestedOpacity.readout, 10));
        style(role.root, 'font-size', '12px');
        style(role.lengthLine, 'font-size', '14px');
        style(role.lengthLabel, 'opacity', '.4');
        style(role.lengthValue, 'font-weight', 'bold');
        style(role.lengthValue, 'opacity', '.8');
        style(role.rankLabel, 'opacity', '.3');
        style(role.separator, 'opacity', '.3');
        style(role.rankValue, 'opacity', '.35');
        style(role.populationValue, 'opacity', '.35');
      }
      if (finalWritten) {
        const role = tree.final;
        text(role.value, view.final.value.scoreText + view.final.value.suffix);
        style(role.label, 'opacity', '.45');
        style(role.value, 'font-weight', 'bold');
      }
      const after = observe(true);
      if (after.state !== 'ready') return downgraded(after);
      if (before.styles.some((style, index) => style !== after.styles[index])) {
        return downgraded(observation('pending', 'nodes-pending'));
      }
      try {
        for (const [name, ...arguments_] of plan) apply(dom[name], undefined, arguments_);
      } catch (primary) {
        // Earlier setters may have committed. Releasing references cannot invoke owner cleanup.
        release('binding-failed');
        throw primary;
      }
      return receipt(view.readiness, view.reason, readoutWritten, finalWritten);
    } finally {
      busy = false;
    }
  }

  function dispose() {
    enter();
    try {
      if (terminal !== 'disposed') release('disposed');
    } finally {
      busy = false;
    }
  }

  return freeze({ readiness, render, dispose });
}
