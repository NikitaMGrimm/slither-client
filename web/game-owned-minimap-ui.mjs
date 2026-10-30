// Browser submission only: every pixel, position, label and opacity comes from Rust.
const html = 'http://www.w3.org/1999/xhtml';
const invalid = () => { throw new TypeError('Invalid owned minimap UI input'); };
const finite = value => { if (!Number.isFinite(value)) invalid(); };
const nonnegative = value => { finite(value); if (value < 0) invalid(); };
const opacity = finite;
const point = value => { if (!value) invalid(); finite(value.x); finite(value.y); };
const rgb = value => {
  if (!Array.isArray(value) || value.length !== 3
    || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) invalid();
};
const color = value => `rgb(${value.join(',')})`;
const pixels = value => `${value}px`;
const dimension = (value, maximum) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) invalid();
};

function validate(view) {
  if (!view || view.schema !== 1 || typeof view.enabled !== 'boolean'
    || typeof view.imageRevision !== 'bigint' || view.imageRevision < 0n) invalid();
  if (view.dimension !== null) dimension(view.dimension, 512);
  const length = (view.dimension ?? 0) ** 2 * 4;
  if (view.baseRgba === null || view.alternateRgba === null) {
    if (view.baseRgba !== null || view.alternateRgba !== null) invalid();
  } else for (const plane of [view.baseRgba, view.alternateRgba]) {
    if (!(plane instanceof Uint8Array) || plane.length !== length) invalid();
  }
  const w = view.widget;
  if (w === null) return;
  if (!w) invalid();
  dimension(w.side, 512 + 24);
  finite(w.right); finite(w.bottom); finite(w.zIndex); opacity(w.opacity);
  const b = w.background, m = w.marker, l = w.label;
  if (!b || !m || !l || !Array.isArray(w.images) || w.images.length !== 2) invalid();
  point(b.center); nonnegative(b.radius); rgb(b.fill); rgb(b.quadrantFill); rgb(b.stroke);
  nonnegative(b.strokeWidth); nonnegative(b.shadowBlur); point(b.shadowOffset);
  opacity(b.opacity); finite(b.zIndex);
  if (!Array.isArray(b.quadrantAngles) || b.quadrantAngles.length !== 2
    || !Array.isArray(b.diameters) || b.diameters.length !== 2) invalid();
  for (const angles of b.quadrantAngles) {
    if (!Array.isArray(angles) || angles.length !== 2) invalid();
    angles.forEach(finite);
  }
  for (const ends of b.diameters) {
    if (!Array.isArray(ends) || ends.length !== 2) invalid();
    ends.forEach(point);
  }
  for (const image of w.images) {
    if (!image || image.dimension !== view.dimension) invalid();
    finite(image.left); finite(image.top); opacity(image.opacity); finite(image.zIndex);
  }
  dimension(m.side, 512 + 24); point(m.center); nonnegative(m.radius);
  finite(m.left); finite(m.top); rgb(m.stroke); rgb(m.fill); nonnegative(m.strokeWidth);
  opacity(m.opacity); finite(m.zIndex);
  if (typeof l.text !== 'string' || typeof l.fontFamily !== 'string'
    || !['left', 'right', 'center', 'start', 'end'].includes(l.textAlign)
    || typeof l.overflowHidden !== 'boolean') invalid();
  for (const key of ['left', 'top']) finite(l[key]);
  for (const key of ['width', 'height', 'fontSize', 'shadowBlur']) nonnegative(l[key]);
  point(l.shadowOffset); rgb(l.fill); opacity(l.opacity);
}

/** Inert until mount. Revision caching describes these two drawing buffers only. */
export function createOwnedMinimapUi({ document, parent, dom, construct, canvas, isCurrentDocument }) {
  for (const name of ['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling',
    'isConnected', 'localName', 'namespaceURI', 'style', 'setText', 'setStyle']) {
    if (typeof dom?.[name] !== 'function') invalid();
  }
  for (const name of ['createElement', 'createTextNode', 'appendChild', 'removeChild']) {
    if (typeof construct?.[name] !== 'function') invalid();
  }
  for (const name of ['context', 'resize', 'set', 'call', 'upload']) {
    if (typeof canvas?.[name] !== 'function') invalid();
  }
  if (typeof isCurrentDocument !== 'function' || !document || !parent || document === parent) invalid();
  let attempted = false, mounted = false, disposed = false, revision, cachedDimension;
  let holder, background, base, alternate, marker, label, text;
  const entries = [];
  const current = () => {
    if (isCurrentDocument() !== true) throw new Error('Stale owned minimap document');
  };
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
    for (const [key, value] of Object.entries(values)) effect(dom.setStyle, entry.style, key, String(value));
  }
  const invoke = (entry, name, ...args) => effect(canvas.call, entry.context, name, ...args);
  const set = (entry, name, value) => effect(canvas.set, entry.context, name, value);
  const resize = (entry, side) => effect(canvas.resize, entry.node, side, side);
  function mount() {
    if (attempted || disposed) throw new Error('Owned minimap mount already consumed');
    attempted = true;
    parentCurrent();
    holder = fresh('div');
    [background, base, alternate, marker] = Array.from({ length: 4 }, () => fresh('canvas'));
    label = fresh('div'); text = fresh(null);
    append(label, text);
    for (const entry of [background, base, alternate, marker, label]) {
      append(holder, entry);
      style(entry, { position: 'absolute', 'pointer-events': 'none' });
    }
    style(holder, { position: 'fixed', display: 'none', 'pointer-events': 'none' });
    for (const entry of [background, base, alternate, marker]) {
      entry.context = effect(canvas.context, entry.node);
      resize(entry, 0);
    }
    inspect();
    construct.appendChild(parent, holder.node);
    holder.parent = parent; mounted = true;
    inspect();
    return holder.node;
  }
  function procedural(entry, side, draw) {
    resize(entry, side);
    invoke(entry, 'save');
    try {
      invoke(entry, 'setTransform', 1, 0, 0, 1, 0, 0);
      invoke(entry, 'clearRect', 0, 0, side, side);
      draw();
    } finally { invoke(entry, 'restore'); }
  }
  function render(view) {
    if (!mounted || disposed) throw new Error('Owned minimap is not mounted');
    inspect(); validate(view);
    if (view.baseRgba === null) {
      if (revision !== view.imageRevision || cachedDimension !== view.dimension) invalid();
    } else if (revision !== view.imageRevision || cachedDimension !== view.dimension) {
      revision = undefined;
      for (const [entry, rgba] of [[base, view.baseRgba], [alternate, view.alternateRgba]]) {
        resize(entry, view.dimension ?? 0);
        effect(canvas.upload, entry.context, view.dimension ?? 0, rgba);
      }
      cachedDimension = view.dimension; revision = view.imageRevision;
    }
    const w = view.widget;
    if (w === null || !view.enabled) { style(holder, { display: 'none' }); return; }
    style(holder, { display: 'block', width: pixels(w.side), height: pixels(w.side),
      right: pixels(w.right), bottom: pixels(w.bottom), 'z-index': w.zIndex, opacity: w.opacity });
    const b = w.background;
    style(background, { left: '0px', top: '0px', width: pixels(w.side), height: pixels(w.side),
      opacity: b.opacity, 'z-index': b.zIndex });
    procedural(background, w.side, () => {
      set(background, 'shadowColor', 'black'); set(background, 'shadowBlur', b.shadowBlur);
      set(background, 'shadowOffsetX', b.shadowOffset.x); set(background, 'shadowOffsetY', b.shadowOffset.y);
      set(background, 'fillStyle', color(b.fill));
      invoke(background, 'beginPath');
      invoke(background, 'arc', b.center.x, b.center.y, b.radius, 0, 2 * Math.PI);
      invoke(background, 'fill');
      set(background, 'shadowBlur', 0); set(background, 'shadowOffsetX', 0); set(background, 'shadowOffsetY', 0);
      set(background, 'fillStyle', color(b.quadrantFill));
      for (const [start, end] of b.quadrantAngles) {
        invoke(background, 'beginPath'); invoke(background, 'moveTo', b.center.x, b.center.y);
        invoke(background, 'arc', b.center.x, b.center.y, b.radius, start, end);
        invoke(background, 'closePath'); invoke(background, 'fill');
      }
      set(background, 'strokeStyle', color(b.stroke)); set(background, 'lineWidth', b.strokeWidth);
      invoke(background, 'beginPath');
      for (const [start, end] of b.diameters) {
        invoke(background, 'moveTo', start.x, start.y); invoke(background, 'lineTo', end.x, end.y);
      }
      invoke(background, 'stroke');
    });
    for (const [index, entry] of [base, alternate].entries()) {
      const image = w.images[index];
      style(entry, { left: pixels(image.left), top: pixels(image.top), width: pixels(image.dimension),
        height: pixels(image.dimension), opacity: image.opacity, 'z-index': image.zIndex });
    }
    const m = w.marker;
    style(marker, { left: pixels(m.left), top: pixels(m.top), width: pixels(m.side), height: pixels(m.side),
      opacity: m.opacity, 'z-index': m.zIndex });
    procedural(marker, m.side, () => {
      set(marker, 'strokeStyle', color(m.stroke)); set(marker, 'lineWidth', m.strokeWidth);
      set(marker, 'fillStyle', color(m.fill));
      invoke(marker, 'beginPath'); invoke(marker, 'arc', m.center.x, m.center.y, m.radius, 0, 2 * Math.PI);
      invoke(marker, 'stroke'); invoke(marker, 'fill');
    });
    const l = w.label;
    style(label, { left: pixels(l.left), top: pixels(l.top), width: pixels(l.width), height: pixels(l.height),
      'font-size': pixels(l.fontSize), 'font-family': l.fontFamily, 'text-align': l.textAlign,
      overflow: l.overflowHidden ? 'hidden' : 'visible', color: color(l.fill), opacity: l.opacity,
      'white-space': 'nowrap', 'text-shadow': `${pixels(l.shadowOffset.x)} ${pixels(l.shadowOffset.y)} ${pixels(l.shadowBlur)} black` });
    effect(dom.setText, text.node, l.text);
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
      mounted = false; revision = cachedDimension = undefined;
      entries.length = 0;
      holder = background = base = alternate = marker = label = text = undefined;
      document = parent = dom = construct = canvas = isCurrentDocument = undefined;
    }
  }
  return Object.freeze({ mount, render, dispose, imageRevision: () => revision });
}
