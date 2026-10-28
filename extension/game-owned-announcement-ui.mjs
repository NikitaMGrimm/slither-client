// Passive DOM submission. Rust supplies all announcement text, order and fade.
const invalid = () => { throw new TypeError('Invalid owned announcement UI input'); };
const html = 'http://www.w3.org/1999/xhtml';

function validate(view) {
  if (!view || view.schema !== 1 || typeof view.present !== 'boolean'
    || !Number.isFinite(view.opacity) || !Array.isArray(view.lines) || view.lines.length > 3) invalid();
  for (const key of ['left', 'top', 'width', 'height']) {
    if (!Number.isInteger(view[key]) || view[key] < 0 || view[key] > 65535) invalid();
  }
  for (const line of view.lines) {
    if (!line || typeof line.text !== 'string' || typeof line.bold !== 'boolean' || typeof line.italic !== 'boolean'
      || !Number.isInteger(line.fontSize) || line.fontSize < 0 || line.fontSize > 255
      || !Number.isInteger(line.spaceAfter) || line.spaceAfter < 0 || line.spaceAfter > 255) invalid();
  }
  if (view.present !== (view.lines.length > 0)) invalid();
}

/** Inert, owned native-node lease; no timers, packet parsing or text policy. */
export function createOwnedAnnouncementUi({ document, parent, dom, construct, isCurrentDocument }) {
  for (const name of ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling',
    'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle']) {
    if (typeof dom?.[name] !== 'function') invalid();
  }
  for (const name of ['createElement', 'createTextNode', 'appendChild', 'removeChild']) {
    if (typeof construct?.[name] !== 'function') invalid();
  }
  if (!document || !parent || document === parent || typeof isCurrentDocument !== 'function') invalid();
  let attempted = false, mounted = false, disposed = false, holder;
  const entries = [], lines = [], texts = [], textValues = [];
  function current() {
    if (isCurrentDocument() !== true) throw new Error('Stale owned announcement document');
    if (dom.nodeType(document) !== 9 || !dom.isConnected(document)
      || dom.nodeType(parent) !== 1 || dom.ownerDocument(parent) !== document
      || dom.namespaceURI(parent) !== html || !dom.isConnected(parent)) invalid();
  }
  function owner(entry) {
    current();
    if (dom.nodeType(entry.node) !== entry.type || dom.ownerDocument(entry.node) !== document
      || (entry.type === 1 && (dom.namespaceURI(entry.node) !== html || dom.localName(entry.node) !== 'div'
        || dom.style(entry.node) !== entry.style))) invalid();
  }
  function inspect() {
    current();
    for (const entry of entries) {
      owner(entry);
      if (dom.parentNode(entry.node) !== entry.parent
        || dom.firstChild(entry.node) !== (entry.children[0] ?? null)
        || (entry !== holder && dom.nextSibling(entry.node) !== entry.next)
        || dom.isConnected(entry.node) !== mounted) invalid();
    }
    current();
  }
  function effect(fn, ...args) { inspect(); const result = fn(...args); inspect(); return result; }
  function fresh(type) {
    current();
    const node = type === 1 ? construct.createElement(document, 'div') : construct.createTextNode(document, '');
    if (node === parent || node === document || entries.some(entry => entry.node === node)) invalid();
    const entry = { node, type, style: type === 1 ? dom.style(node) : null, parent: null, children: [], next: null };
    owner(entry);
    if (dom.parentNode(node) !== null || dom.firstChild(node) !== null
      || dom.nextSibling(node) !== null || dom.isConnected(node) !== false
      || (entry.style && entries.some(other => other.style === entry.style))) invalid();
    entries.push(entry); return entry;
  }
  function append(target, child) {
    inspect(); construct.appendChild(target.node, child.node);
    const previous = target.children.at(-1);
    if (previous) entries.find(entry => entry.node === previous).next = child.node;
    target.children.push(child.node); child.parent = target.node; inspect();
  }
  function style(entry, values) {
    for (const [key, value] of Object.entries(values)) effect(dom.setStyle, entry.style, key, String(value));
  }
  function mount() {
    if (attempted || disposed) throw new Error('Owned announcement mount already consumed');
    attempted = true; current(); holder = fresh(1);
    for (let index = 0; index < 3; index++) {
      const line = fresh(1), text = fresh(3); lines.push(line); texts.push(text);
      append(line, text); append(holder, line);
      style(line, { display: 'none', margin: '0px', 'pointer-events': 'none' });
    }
    style(holder, { position: 'fixed', display: 'none', 'pointer-events': 'none', color: '#ffffff',
      'font-family': 'Arial, sans-serif', 'white-space': 'normal', overflow: 'hidden', 'z-index': 7 });
    inspect(); construct.appendChild(parent, holder.node); holder.parent = parent; mounted = true; inspect();
    return holder.node;
  }
  function render(view) {
    if (!mounted || disposed) throw new Error('Owned announcement is not mounted');
    inspect(); validate(view);
    style(holder, { display: view.present ? 'block' : 'none', opacity: view.opacity,
      left: `${view.left}px`, top: `${view.top}px`, width: `${view.width}px`, height: `${view.height}px` });
    for (let index = 0; index < 3; index++) {
      const line = view.lines[index];
      style(lines[index], { display: line ? 'block' : 'none' });
      if (line) {
        style(lines[index], { 'font-size': `${line.fontSize}px`, 'font-weight': line.bold ? 'bold' : 'normal',
          'font-style': line.italic ? 'italic' : 'normal', 'margin-bottom': `${line.spaceAfter}px` });
        if (textValues[index] !== line.text) {
          effect(dom.setText, texts[index].node, line.text);
          textValues[index] = line.text;
        }
      }
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      if (holder && isCurrentDocument() === true && dom.ownerDocument(holder.node) === document
        && dom.ownerDocument(parent) === document && dom.parentNode(holder.node) === parent) {
        construct.removeChild(parent, holder.node);
      }
    } finally {
      mounted = false; entries.length = lines.length = texts.length = textValues.length = 0;
      holder = document = parent = dom = construct = isCurrentDocument = undefined;
    }
  }
  return Object.freeze({ mount, render, dispose });
}
