// Passive native indeterminate progress. No admission, source reads, clocks or timers.
import { startPageLayout } from './start-page-layout.mjs';
const apply = Reflect.apply;
const domNames = ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling',
  'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle'];
const constructNames = ['createElement', 'createTextNode', 'appendChild', 'removeChild'];
const invalid = () => { throw new TypeError('Invalid passive loading UI'); };
function record(value, names) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== names.length) invalid();
  const copy = {};
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (!field || !Object.hasOwn(field, 'value')) invalid();
    copy[name] = field.value;
  }
  return copy;
}

/** Retain before mount. The parent is existing startup status or Play status. */
export function createOwnedLoadingUi({ document, parent, dom, construct, isCurrentDocument, branded = false }) {
  dom = record(dom, domNames); construct = record(construct, constructNames);
  if (typeof branded !== 'boolean' || typeof isCurrentDocument !== 'function'
    || [...Object.values(dom), ...Object.values(construct)].some(fn => typeof fn !== 'function')) invalid();
  let label, text, progress, attempted = false, mounted = false, disposed = false, active = false;
  const call = (name, ...args) => apply(dom[name], undefined, args);
  const current = () => {
    if (isCurrentDocument() !== true || call('nodeType', document) !== 9 || !call('isConnected', document)
      || call('nodeType', parent) !== 1 || call('ownerDocument', parent) !== document
      || !call('isConnected', parent) || call('namespaceURI', parent) !== 'http://www.w3.org/1999/xhtml') {
      throw new Error('Current loading document required');
    }
    if (mounted) {
      for (const [node, owner] of [[label, parent], [text, label], [progress, label]]) {
        if (call('ownerDocument', node) !== document || call('parentNode', node) !== owner || !call('isConnected', node)) invalid();
      }
      if (call('firstChild', label) !== text || call('nextSibling', text) !== progress || call('nextSibling', progress) !== null) invalid();
    }
  };
  const idle = () => { if (active) throw new Error('Loading UI operation active'); };
  const layout = (node, entries) => {
    const style = call('style', node);
    if (!style || typeof style !== 'object') invalid();
    for (const [key, value] of entries) call('setStyle', style, key, value);
  };
  function mount() {
    idle(); if (attempted || disposed) throw new Error('Loading mount consumed');
    attempted = active = true;
    try {
      current();
      const identities = new Set([document, parent]);
      const fresh = (tag, content) => {
        const node = tag ? apply(construct.createElement, undefined, [document, tag])
          : apply(construct.createTextNode, undefined, [document, content]);
        if (!node || typeof node !== 'object' || identities.has(node)
          || call('nodeType', node) !== (tag ? 1 : 3) || call('ownerDocument', node) !== document
          || call('parentNode', node) !== null || call('isConnected', node)
          || call('firstChild', node) !== null || call('nextSibling', node) !== null
          || tag && (call('localName', node) !== tag || call('namespaceURI', node) !== 'http://www.w3.org/1999/xhtml')) invalid();
        identities.add(node); return node;
      };
      label = fresh('label'); text = fresh(null, ''); progress = fresh('progress');
      // No value attribute: native progress is indeterminate and implicitly named by its label.
      apply(construct.appendChild, undefined, [label, text]);
      apply(construct.appendChild, undefined, [label, progress]);
      layout(label, startPageLayout.loadingLabel);
      layout(progress, startPageLayout.loadingProgress);
      if (branded) layout(parent, startPageLayout.loadingSurface);
      current();
      apply(construct.appendChild, undefined, [parent, label]);
      mounted = true; current(); return label;
    } finally { active = false; }
  }
  function render(value) {
    idle(); if (disposed) return;
    const view = record(value, ['visible', 'busy', 'text']);
    if (typeof view.visible !== 'boolean' || typeof view.busy !== 'boolean'
      || typeof view.text !== 'string' || view.text.length > 128) invalid();
    active = true;
    try {
      if (!mounted) throw new Error('Loading UI not mounted');
      current(); call('setText', text, view.text);
      layout(progress, [['display', view.busy ? 'inline-block' : 'none']]);
      layout(label, [['display', view.visible ? 'block' : 'none']]);
      if (branded) layout(parent, [['display', view.visible ? 'block' : 'none']]);
      current();
    } finally { active = false; }
  }
  function dispose() {
    idle(); if (disposed) return; disposed = active = true;
    try {
      if (label && isCurrentDocument() === true && call('ownerDocument', parent) === document
        && call('isConnected', parent) && call('parentNode', label) === parent) {
        apply(construct.removeChild, undefined, [parent, label]);
      }
    } finally {
      label = text = progress = document = parent = dom = construct = isCurrentDocument = undefined;
      active = false;
    }
  }
  return Object.freeze({ mount, render, current, dispose });
}
