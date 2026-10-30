// Original owned leaderboard. Native work starts only after the owner retains this lease.
import { requireLeaderboardView } from './stock-leaderboard-view.mjs';

const freeze = Object.freeze;
const apply = Reflect.apply;
const functionSource = Function.prototype.call.bind(Function.prototype.toString);
const asynchronous = [async function () {}, function* () {}, async function* () {}]
  .map(Object.getPrototypeOf);
const domFields = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild',
  'nextSibling', 'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const constructFields = ['createElement', 'createTextNode', 'appendChild', 'removeChild'];
const html = 'http://www.w3.org/1999/xhtml';
const maxRows = 10;
const invalid = () => { throw new TypeError('Invalid owned leaderboard UI input'); };

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
    if (seen.has(prototype) || asynchronous.includes(prototype)
      || Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)) invalid();
    seen.add(prototype);
  }
  if (prototype !== null || /^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/
    .test(functionSource(callback))) invalid();
}

/** Inert lease: failed mount/render never performs cleanup inside the owner's guard. */
export function createOwnedLeaderboardUi(input) {
  let options = record(input, ['sceneIdentity', 'documentIdentity', 'document', 'parent',
    'dom', 'construct', 'properties', 'isCurrentDocument']);
  input = undefined;
  const { sceneIdentity, documentIdentity } = options;
  if (typeof sceneIdentity !== 'symbol' || typeof documentIdentity !== 'symbol') invalid();
  let document = options.document, parent = options.parent;
  if (document === null || typeof document !== 'object' || parent === null
    || typeof parent !== 'object' || document === parent) invalid();
  let dom = record(options.dom, domFields);
  let construct = record(options.construct, constructFields);
  let properties = record(options.properties, ['setTranslate']);
  let checker = options.isCurrentDocument;
  for (const callback of [...Object.values(dom), ...Object.values(construct),
    properties.setTranslate, checker]) synchronous(callback);
  options = undefined;
  const bindingIdentity = Symbol('Owned leaderboard binding');
  let attempted = false, mounted = false, attached = false, disposed = false, busy = false;
  let terminal = null, failed = false, primary;
  let entries = new Map(), identities = new WeakSet([document, parent]), styles = new WeakSet();
  let root, heading, headingText, columns, rowRoots = [[], [], []], revision;
  let parentAnchor, parentStyle;

  const observation = (state, reason) => freeze({ schema: 1, bindingIdentity,
    documentIdentity, sceneIdentity, state, reason });
  const receipt = (readiness, reason, rowsWritten = false) =>
    freeze({ schema: 1, readiness, reason, rowsWritten });
  function remember(error) {
    if (!failed) { failed = true; primary = error; }
    if (terminal === null) terminal = 'binding-failed';
    return primary;
  }
  function check() { if (failed) throw primary; }
  function enter() {
    if (busy) throw remember(new Error('Owned leaderboard reentry'));
    busy = true;
    failed = false;
    primary = undefined;
  }
  function current() {
    check();
    let result;
    try { result = apply(checker, undefined, []); } catch (error) { throw remember(error); }
    check();
    if (typeof result !== 'boolean') invalid();
    if (!result) {
      terminal = 'stale-document';
      throw new Error('Stale owned leaderboard document');
    }
  }
  // Even observations are native boundaries: no getter runs after freshness or reentry fails.
  function boundary(callback, args) {
    current();
    let result;
    try { result = apply(callback, undefined, args); } catch (error) { throw remember(error); }
    check();
    current();
    return result;
  }
  const get = (name, value) => boundary(dom[name], [value]);
  function base() {
    if (get('nodeType', document) !== 9 || get('isConnected', document) !== true
      || get('nodeType', parent) !== 1 || get('ownerDocument', parent) !== document
      || get('isConnected', parent) !== true || get('namespaceURI', parent) !== html
      || typeof get('localName', parent) !== 'string') invalid();
    const anchor = get('parentNode', parent), style = get('style', parent);
    if (style === null || typeof style !== 'object') invalid();
    if (parentStyle === undefined) {
      parentAnchor = anchor;
      parentStyle = style;
      styles.add(style);
    } else if (anchor !== parentAnchor || style !== parentStyle) invalid();
    if (root) verify(root);
  }
  function connected(entry) {
    let cursor = entry;
    while (cursor.parent !== null && cursor.parent !== parent) cursor = entries.get(cursor.parent);
    return cursor.parent === parent && attached;
  }
  function verify(entry) {
    const node = entry.node;
    if (get('nodeType', node) !== entry.type || get('ownerDocument', node) !== document
      || get('parentNode', node) !== entry.parent
      || get('isConnected', node) !== connected(entry)
      || get('firstChild', node) !== entry.first) invalid();
    if (entry !== root && get('nextSibling', node) !== entry.next) invalid();
    if (entry.type === 1 && (get('namespaceURI', node) !== html
      || get('localName', node) !== entry.tag)) invalid();
    if (entry.style !== null && get('style', node) !== entry.style) invalid();
  }
  function inspect() { base(); for (const entry of entries.values()) verify(entry); }
  function fresh(tag, text) {
    base();
    const type = tag === null ? 3 : 1;
    const node = boundary(tag === null ? construct.createTextNode : construct.createElement,
      [document, tag === null ? text : tag]);
    if (node === null || typeof node !== 'object' || identities.has(node) || styles.has(node)) invalid();
    const entry = { node, type, tag, parent: null, first: null, last: null, next: null, style: null };
    verify(entry);
    base();
    identities.add(node);
    entries.set(node, entry);
    return entry;
  }
  function effect(targets, callback, args, update = () => {}) {
    base();
    for (const entry of targets) verify(entry);
    boundary(callback, args);
    update();
    base();
    for (const entry of targets) verify(entry);
  }
  function append(target, child) {
    const previous = target.last === null ? null : entries.get(target.last);
    if (child.parent !== null) invalid();
    effect([target, ...(previous ? [previous] : []), child], construct.appendChild,
      [target.node, child.node], () => {
        if (previous) previous.next = child.node;
        else target.first = child.node;
        target.last = child.node;
        child.parent = target.node;
      });
  }
  function style(entry, property, value) {
    if (entry.style === null) {
      base(); verify(entry);
      const value = get('style', entry.node);
      if (value === null || typeof value !== 'object' || identities.has(value) || styles.has(value)) invalid();
      entry.style = value;
      styles.add(value);
      base(); verify(entry);
    }
    effect([entry], dom.setStyle, [entry.style, property, value]);
  }
  function layout(entry, values) {
    for (const [property, value] of values) style(entry, property, value);
  }
  function mount() {
    if (busy) throw remember(new Error('Owned leaderboard reentry'));
    if (attempted || disposed) throw new Error('Owned leaderboard mount already consumed');
    enter(); attempted = true;
    try {
      base();
      root = fresh('div');
      heading = fresh('div');
      headingText = fresh(null, 'Leaderboard');
      columns = [fresh('div'), fresh('div'), fresh('div')];
      append(heading, headingText);
      for (const entry of [heading, ...columns]) append(root, entry);
      layout(root, [['position', 'static'], ['display', 'block'], ['transform', 'none'],
        ['pointer-events', 'none']]);
      const font = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
      layout(heading, [['position', 'fixed'], ['top', '4px'], ['right', '4px'],
        ['width', '285px'], ['height', '28px'], ['display', 'none'], ['color', '#ffffff'],
        ['font-family', font], ['font-size', '21px'], ['font-weight', 'bold'],
        ['text-align', 'center'], ['cursor', 'default'], ['z-index', '7']]);
      for (const [index, entry] of columns.entries()) {
        layout(entry, [['position', 'fixed'], ['top', '32px'], ['height', '800px'],
          ['overflow', 'hidden'], ['font-family', font], ['font-size', '12px'],
          ['font-weight', 'normal'], ['line-height', '150%'], ['cursor', 'default'],
          ['display', 'none'], ['color', '#ffffff'], ['z-index', String(7 + index)],
          ['right', ['4px', '64px', '260px'][index]], ['width', ['50px', '180px', '30px'][index]],
          ['text-align', ['center', 'left', 'right'][index]]]);
        if (index !== 1) style(entry, 'font-variant-numeric', 'tabular-nums');
      }
      style(columns[1], 'white-space', 'nowrap');
      effect([columns[1]], properties.setTranslate, [columns[1].node, true]);
      inspect();
      boundary(construct.appendChild, [parent, root.node]);
      root.parent = parent;
      attached = true;
      inspect();
      mounted = true;
      return observation('ready', null);
    } catch (error) { throw remember(error); }
    finally { busy = false; }
  }
  function readiness() {
    enter();
    try {
      if (terminal !== null) return observation('unavailable', terminal);
      if (!mounted) return observation('pending', 'nodes-pending');
      inspect();
      return observation('ready', null);
    } catch (error) {
      if (terminal === 'stale-document' && !failed) return observation('unavailable', terminal);
      throw remember(error);
    } finally { busy = false; }
  }
  function prepareRows(rows) {
    const prepared = [[], [], []];
    for (const row of rows) for (let column = 0; column < 3; column++) {
      const span = fresh('span');
      const text = fresh(null, [row.scoreText, row.nameText, row.numberText][column]);
      const br = fresh('br');
      append(span, text);
      style(span, 'color', row.cssColor);
      style(span, 'opacity', String(row.opacityRequest));
      style(span, 'font-weight', column === 1 && row.own ? 'bold' : 'normal');
      prepared[column].push(span, br);
    }
    return prepared;
  }
  function replaceRows(prepared) {
    for (let column = 0; column < 3; column++) {
      const target = columns[column];
      for (const entry of rowRoots[column]) {
        effect([target, entry], construct.removeChild, [target.node, entry.node], () => {
          target.first = entry.next;
          if (target.last === entry.node) target.last = null;
          entry.parent = entry.next = null;
        });
        if (entry.first !== null) entries.delete(entry.first);
        entries.delete(entry.node);
      }
      for (const entry of prepared[column]) append(target, entry);
    }
    rowRoots = prepared;
  }
  function render(value) {
    enter();
    try {
      if (terminal !== null) return receipt('unavailable', terminal);
      const view = requireLeaderboardView(value);
      if (view.bindingIdentity !== bindingIdentity || view.documentIdentity !== documentIdentity
        || view.sceneIdentity !== sceneIdentity) invalid();
      // This bound precedes all row enumeration, allocation and native observations.
      if (!Array.isArray(view.rows) || view.rows.length > maxRows) invalid();
      if (!mounted) return receipt('pending', 'nodes-pending');
      inspect();
      if (view.binding.state !== 'ready' || view.readiness === 'unavailable')
        return receipt(view.readiness, view.reason);
      const rebuild = view.boardPresent && view.revision !== revision;
      if (rebuild) {
        const prepared = prepareRows(view.rows);
        inspect();
        replaceRows(prepared);
      }
      if (view.setupSeen) for (const entry of [heading, ...columns]) style(entry, 'display', 'inline');
      style(heading, 'opacity', String(view.requestedOpacity.heading));
      for (const entry of columns) style(entry, 'opacity', String(view.requestedOpacity.rows));
      inspect();
      if (rebuild) revision = view.revision;
      return receipt(view.readiness, view.reason, rebuild);
    } catch (error) {
      if (terminal === 'stale-document' && !failed) return receipt('unavailable', terminal);
      throw remember(error);
    } finally { busy = false; }
  }
  function dispose() {
    if (busy) throw remember(new Error('Owned leaderboard reentry'));
    if (disposed) return;
    enter(); disposed = true;
    try {
      if (root) {
        // Descendants may be damaged after failure. Cleanup needs only the original ownership edge.
        if (baseForDisposal() && get('parentNode', root.node) === parent) {
          if (!baseForDisposal()) return;
          if (get('parentNode', root.node) !== parent) invalid();
          boundary(construct.removeChild, [parent, root.node]);
        }
      }
    } catch (error) {
      if (terminal !== 'stale-document' || failed) throw remember(error);
    } finally {
      terminal = 'disposed';
      entries = identities = styles = root = heading = headingText = columns = rowRoots = undefined;
      document = parent = parentAnchor = parentStyle = dom = construct = properties = checker = undefined;
      mounted = attached = false;
      primary = undefined;
      failed = false;
      busy = false;
    }
  }
  function baseForDisposal() {
    return !(get('nodeType', document) !== 9 || get('isConnected', document) !== true
      || get('nodeType', parent) !== 1 || get('ownerDocument', parent) !== document
      || get('isConnected', parent) !== true || get('namespaceURI', parent) !== html
      || get('parentNode', parent) !== parentAnchor || get('style', parent) !== parentStyle
      || get('nodeType', root.node) !== 1 || get('ownerDocument', root.node) !== document
      || get('namespaceURI', root.node) !== html || get('localName', root.node) !== 'div');
  }
  return freeze({ mount, readiness, render, dispose });
}
