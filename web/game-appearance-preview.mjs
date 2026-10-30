// Passive menu Canvas lease. Rust owns selection, geometry and the copied view.
const apply = Reflect.apply;
const freeze = Object.freeze;

export function createAppearancePreview({ document, dom, construct, Policy, methods, local,
  worldTarget, prepare, defer, withSources, isCurrentDocument, isCurrentGeneration, check }) {
  let owner, parent, holder, canvas, line, text, attempted = false, disposed = false, finalized = false, active = 0;
  function current() {
    if (disposed || !isCurrentGeneration() || !isCurrentDocument()) throw new Error('Current appearance preview required');
    if (holder) {
      for (const [node, expected] of [[holder, parent], [canvas, holder], [line, holder], [text, line]]) {
        if (!node || dom.ownerDocument(node) !== document || !dom.isConnected(node)
          || dom.parentNode(node) !== expected) throw new Error('Exact appearance preview ownership required');
      }
      if (dom.firstChild(holder) !== canvas || dom.nextSibling(canvas) !== line || dom.nextSibling(line) !== null
        || dom.firstChild(line) !== text || dom.nextSibling(text) !== null || dom.firstChild(canvas) !== null) {
        throw new Error('Exact appearance preview topology required');
      }
    }
    check();
  }
  function finalize() {
    if (finalized || !disposed || active) return;
    finalized = true;
    let failed = false, primary;
    try {
      if (holder && isCurrentDocument() && dom.ownerDocument(holder) === document && dom.parentNode(holder) === parent) {
        construct.removeChild(parent, holder);
      }
    } catch (error) { failed = true; primary = error; }
    try { if (owner) apply(methods.free, owner, []); }
    catch (error) { if (!failed) { failed = true; primary = error; } }
    finally { owner = parent = holder = canvas = line = text = undefined; }
    if (failed) throw primary;
  }
  // Reentrant teardown invalidates jobs immediately, but never frees borrowed Wasm.
  function operation(callback) {
    active++;
    let result, failed = false, primary;
    try { result = callback(); }
    catch (error) { failed = true; primary = error; }
    finally {
      active--;
      try { finalize(); } catch (error) { if (!failed) { failed = true; primary = error; } }
    }
    if (failed) throw primary;
    return result;
  }
  const invoke = (name, ...args) => {
    const result = apply(methods[name], owner, args); check(); return result;
  };
  const style = (node, name, value) => { dom.setStyle(dom.style(node), name, value); current(); };
  function mount(value) {
    return operation(() => {
      if (attempted || disposed) throw new Error('Appearance preview mount consumed');
      attempted = true; parent = value; current();
      owner = new Policy(local); current();
      const used = new Set([document, parent, worldTarget]);
      const fresh = (tag, content) => {
        const node = tag ? construct.createElement(document, tag) : construct.createTextNode(document, content);
        current();
        if (!node || used.has(node) || dom.ownerDocument(node) !== document || dom.parentNode(node) !== null
          || dom.isConnected(node) || dom.firstChild(node) !== null || dom.nextSibling(node) !== null
          || dom.nodeType(node) !== (tag ? 1 : 3)
          || tag && (dom.localName(node) !== tag || dom.namespaceURI(node) !== 'http://www.w3.org/1999/xhtml')) {
          throw new TypeError('Fresh appearance preview node required');
        }
        used.add(node); return node;
      };
      // Retain the eventual attached node before append can attach then throw.
      const root = fresh('div'); canvas = fresh('canvas'); line = fresh('div'); text = fresh(null, '');
      construct.appendChild(line, text); construct.appendChild(root, canvas); construct.appendChild(root, line);
      for (const node of [root, canvas, line]) {
        dom.setStyle(dom.style(node), 'position', 'static');
        dom.setStyle(dom.style(node), 'margin', '0');
      }
      dom.setStyle(dom.style(canvas), 'display', 'none');
      dom.setStyle(dom.style(canvas), 'max-width', '100%');
      current(); holder = root; construct.appendChild(parent, holder); current();
      return holder;
    });
  }
  function select(skin, custom) {
    return operation(() => {
      current();
      const ticket = invoke('select', skin, new Uint8Array(custom)); current();
      // The captured scheduler runs this only after the caller's Play guard unwinds.
      defer(() => operation(() => {
        if (disposed || !isCurrentGeneration()) return;
        current();
        if (invoke('revision') !== ticket || !invoke('needs_draw', ticket)) return;
        const value = withSources(resolve => invoke('render', ticket, canvas, worldTarget, resolve, prepare));
        // Source retention ends before DOM publication, including pending output.
        current();
        if (invoke('revision') !== ticket) return;
        const fields = ['schema', 'revision', 'changed', 'width', 'height', 'visible', 'statusText'];
        if (!value || !Object.isFrozen(value) || Reflect.ownKeys(value).length !== fields.length
          || fields.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, 'value'))) {
          throw new TypeError('Copied Rust appearance preview required');
        }
        if (value.schema !== 1 || value.revision !== ticket || typeof value.changed !== 'boolean'
          || typeof value.visible !== 'boolean' || typeof value.statusText !== 'string'
          || !Number.isInteger(value.width) || value.width <= 0 || value.width > 1024
          || !Number.isInteger(value.height) || value.height <= 0 || value.height > 1024) {
          throw new TypeError('Bounded Rust appearance preview required');
        }
        dom.setText(text, value.statusText); current();
        style(canvas, 'width', `${value.width}px`); style(canvas, 'height', 'auto');
        style(canvas, 'display', value.visible ? 'block' : 'none');
      }));
      current();
    });
  }
  function dispose() { disposed = true; finalize(); }
  return freeze({ mount, current, select, dispose });
}
