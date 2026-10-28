// Passive DOM submission. Rust owns outcome, lifecycle, labels and score text.
const html = 'http://www.w3.org/1999/xhtml';
const invalid = () => { throw new TypeError('Invalid owned end-screen UI input'); };

export function createOwnedEndScreenUi({ document, parent, dom, construct, isCurrentDocument }) {
  for (const name of ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling',
    'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle']) {
    if (typeof dom?.[name] !== 'function') invalid();
  }
  for (const name of ['createElement', 'createTextNode', 'appendChild', 'removeChild']) {
    if (typeof construct?.[name] !== 'function') invalid();
  }
  if (!document || !parent || parent === document || typeof isCurrentDocument !== 'function') invalid();
  let attempted = false, mounted = false, disposed = false, holder;
  const entries = [], texts = [];
  function current() {
    if (isCurrentDocument() !== true) throw new Error('Stale owned end-screen document');
  }
  function owner(node, type, tag) {
    current();
    if (dom.nodeType(node) !== type || dom.ownerDocument(node) !== document
      || (type === 1 && (dom.namespaceURI(node) !== html || dom.localName(node) !== tag))) invalid();
    current();
  }
  function parentCurrent() {
    current();
    if (dom.nodeType(document) !== 9 || dom.isConnected(document) !== true
      || dom.nodeType(parent) !== 1 || dom.ownerDocument(parent) !== document
      || dom.namespaceURI(parent) !== html || dom.isConnected(parent) !== true) invalid();
    current();
  }
  function inspect() {
    parentCurrent();
    for (const entry of entries) {
      owner(entry.node, entry.type, entry.tag);
      if (dom.parentNode(entry.node) !== entry.parent
        || dom.firstChild(entry.node) !== (entry.children[0] ?? null)
        || (entry !== holder && dom.nextSibling(entry.node) !== entry.next)
        || dom.isConnected(entry.node) !== mounted
        || (entry.style && dom.style(entry.node) !== entry.style)) invalid();
      // Check the entire child chain, including unexpected trailing children.
      for (let index = 0; index < entry.children.length; index++) {
        if (dom.nextSibling(entry.children[index]) !== (entry.children[index + 1] ?? null)) invalid();
      }
    }
    current();
  }
  function effect(callback, ...args) {
    inspect();
    const result = callback(...args);
    inspect();
    return result;
  }
  function fresh(tag) {
    parentCurrent();
    const node = tag === null ? construct.createTextNode(document, '') : construct.createElement(document, tag);
    const type = tag === null ? 3 : 1;
    owner(node, type, tag);
    if (node === parent || node === document || entries.some(entry => entry.node === node)
      || dom.parentNode(node) !== null || dom.firstChild(node) !== null
      || dom.nextSibling(node) !== null || dom.isConnected(node) !== false) invalid();
    const style = type === 1 ? dom.style(node) : null;
    if (type === 1 && (!style || entries.some(entry => entry.style === style))) invalid();
    const entry = { node, type, tag, style, parent: null, children: [], next: null };
    entries.push(entry);
    return entry;
  }
  function append(target, child) {
    inspect();
    construct.appendChild(target.node, child.node);
    const previous = target.children.at(-1);
    if (previous) entries.find(entry => entry.node === previous).next = child.node;
    target.children.push(child.node); child.parent = target.node;
    inspect();
  }
  function style(entry, values) {
    for (const [key, value] of Object.entries(values)) effect(dom.setStyle, entry.style, key, value);
  }
  function mount() {
    if (attempted || disposed) throw new Error('Owned end-screen mount already consumed');
    attempted = true;
    holder = fresh('section');
    for (const tag of ['h2', 'p', 'p']) {
      const line = fresh(tag), text = fresh(null);
      append(line, text); append(holder, line); texts.push(text);
      style(line, { position: 'static', margin: '4px 0', 'font-size': tag === 'h2' ? '24px' : '16px' });
    }
    style(holder, { position: 'fixed', left: '50%', bottom: '12%', transform: 'translateX(-50%)',
      display: 'none', 'pointer-events': 'none', 'z-index': '2147483646', 'text-align': 'center',
      color: '#eeeeee', background: '#102022', border: '1px solid #8ba398', padding: '12px 20px',
      'max-width': 'calc(100vw - 48px)', 'box-sizing': 'border-box',
      'font-family': 'Arial, sans-serif', 'font-variant-numeric': 'tabular-nums' });
    inspect();
    construct.appendChild(parent, holder.node);
    holder.parent = parent; mounted = true;
    inspect();
    return holder.node;
  }
  function render(view) {
    if (!mounted || disposed) throw new Error('Owned end-screen is not mounted');
    inspect();
    if (!view || view.schema !== 1 || typeof view.visible !== 'boolean'
      || ['title', 'scoreText', 'statusText'].some(key => typeof view[key] !== 'string')) invalid();
    for (const [index, key] of ['title', 'scoreText', 'statusText'].entries()) {
      effect(dom.setText, texts[index].node, view[key]);
    }
    style(holder, { display: view.visible ? 'block' : 'none' });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      // Append can attach and then throw under the runtime guard. Retain cleanup
      // authority by node identity, even before mounted is acknowledged.
      if (holder && isCurrentDocument() === true && dom.ownerDocument(holder.node) === document
        && dom.ownerDocument(parent) === document && dom.parentNode(holder.node) === parent) {
        construct.removeChild(parent, holder.node);
      }
    } finally {
      mounted = false;
      entries.length = texts.length = 0;
      holder = document = parent = dom = construct = isCurrentDocument = undefined;
    }
  }
  return Object.freeze({ mount, render, dispose });
}
