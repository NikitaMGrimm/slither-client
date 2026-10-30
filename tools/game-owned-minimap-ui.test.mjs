// Authored DOM/Canvas and issued Rust-view doubles. No real Wasm or browser pixels.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedMinimapUi } from '../web/game-owned-minimap-ui.mjs';
import { createGateTestDom, issuedMinimapViewDouble } from './game-gate-test-fixture.mjs';

function fixture() {
  const native = createGateTestDom({ hud: true, ownedHud: true, minimap: true });
  const document = new native.Document(), parent = document.createElement('main'); document.appendChild(parent);
  let current = true, uploadFailure = false;
  const getter = (prototype, name) => {
    const get = Object.getOwnPropertyDescriptor(prototype, name).get;
    return value => Reflect.apply(get, value, []);
  };
  const dom = Object.fromEntries(['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling', 'isConnected']
    .map(name => [name, getter(native.Node.prototype, name)]));
  for (const name of ['localName', 'namespaceURI']) dom[name] = getter(native.Element.prototype, name);
  dom.style = getter(native.hud.HTMLElement.prototype, 'style');
  dom.setText = (node, text) => { node.data = text; };
  dom.setStyle = (style, name, value) => style.setProperty(name, value);
  const construct = { createElement: (doc, tag) => doc.createElement(tag),
    createTextNode: (doc, text) => doc.createTextNode(text),
    appendChild: (node, child) => node.appendChild(child), removeChild: (node, child) => node.removeChild(child) };
  const canvas = { context: node => node.getContext('2d'), resize(node, width, height) { node.width = width; node.height = height; },
    set(context, name, value) { context[name] = value; }, call(context, name, ...args) { context[name](...args); },
    upload(context, side, rgba) {
      if (uploadFailure) throw new Error('Synthetic upload failure');
      if (side) context.putImageData(new native.minimap.ImageData(new Uint8ClampedArray(rgba), side, side), 0, 0);
    } };
  const ui = createOwnedMinimapUi({ document, parent, dom, construct, canvas, isCurrentDocument: () => current });
  return { native, document, parent, ui, trace: native.minimap.trace,
    style: node => native.hud.style(dom.style(node)),
    current(value) { current = value; }, failUpload(value) { uploadFailure = value; } };
}
const uploads = f => f.trace.filter(call => call[0] === 'putImageData');

test('inert lease mounts one hidden fixed holder and ordered passive layers', () => {
  const f = fixture();
  assert.equal(f.ui.imageRevision(), undefined); assert.deepEqual(f.trace, []);
  const root = f.ui.mount();
  assert.deepEqual(f.parent.children, [root]);
  assert.deepEqual(root.children.map(node => node.localName), ['canvas', 'canvas', 'canvas', 'canvas', 'div']);
  assert.equal(f.style(root).get('position'), 'fixed'); assert.equal(f.style(root).get('display'), 'none');
  for (const node of [root, ...root.children]) assert.equal(f.style(node).get('pointer-events'), 'none');
  assert.throws(f.ui.mount, /consumed/);
  f.ui.dispose(); f.ui.dispose(); assert.deepEqual(f.parent.children, []);
});

test('Rust plans submit independent local opacity, geometry, quadrants, diameters, marker and plain label', () => {
  const f = fixture(), root = f.ui.mount(), view = issuedMinimapViewDouble();
  view.widget.label.text = '<b>server</b>';
  f.ui.render(view);
  const [background, base, alternate, marker, label] = root.children;
  assert.equal(f.style(root).get('opacity'), '0.25');
  assert.equal(f.style(background).get('opacity'), '0.4');
  assert.equal(f.style(base).get('opacity'), '0.3');
  assert.equal(f.style(alternate).get('z-index'), f.style(marker).get('z-index'));
  assert.equal(f.style(marker).get('left'), '3.2px'); assert.equal(f.style(marker).get('top'), '5.6px');
  assert.equal(f.style(label).get('font-size'), '14px'); assert.equal(f.style(label).get('overflow'), 'hidden');
  assert.equal(f.style(label).get('text-shadow'), '1px 2px 3px black');
  assert.equal(label.children[0].data, '<b>server</b>'); assert.equal(label.children.length, 1);
  const backgroundContext = f.native.minimap.canvas(background).context;
  const backgroundCalls = f.trace.filter(call => call[1] === backgroundContext);
  assert.deepEqual(backgroundCalls.filter(call => call[0] === 'arc').map(call => call.slice(2)), [
    [13, 13, 1, 0, 2 * Math.PI], [13, 13, 1, 0, Math.PI / 2], [13, 13, 1, Math.PI, Math.PI * 1.5],
  ]);
  assert.deepEqual(backgroundCalls.filter(call => call[0] === 'lineTo').map(call => call.slice(2)), [[14, 13], [13, 14]]);
  assert(backgroundCalls.some(call => call[0] === 'set' && call[2] === 'shadowColor' && call[3] === 'black'));
  const markerContext = f.native.minimap.canvas(marker).context;
  assert.deepEqual(f.trace.filter(call => call[1] === markerContext && ['stroke', 'fill'].includes(call[0]))
    .map(call => call[0]), ['stroke', 'fill']);
  assert.equal(uploads(f).length, 2); assert.notEqual(uploads(f)[0][2].data.buffer, view.baseRgba.buffer);
  f.ui.dispose();
});

test('known native revisions reuse image buffers while all numeric styles update', () => {
  const f = fixture(), root = f.ui.mount(), view = issuedMinimapViewDouble(); f.ui.render(view);
  const resizeCount = () => f.trace.filter(call => call[0] === 'resize' && root.children.slice(1, 3).includes(call[1])).length;
  const before = resizeCount();
  view.widget.right = 31.25; view.widget.bottom = 8; view.widget.opacity = 0.6;
  view.widget.images[1].opacity = 0.55; view.widget.marker.left = -10.4; view.widget.label.text = 'server 42';
  f.ui.render({ ...view, baseRgba: null, alternateRgba: null });
  assert.equal(uploads(f).length, 2); assert.equal(resizeCount(), before); assert.equal(f.ui.imageRevision(), 1n);
  assert.equal(f.style(root).get('right'), '31.25px'); assert.equal(f.style(root).get('bottom'), '8px');
  assert.equal(f.style(root.children[2]).get('opacity'), '0.55');
  assert.equal(f.style(root.children[3]).get('left'), '-10.4px');
  assert.equal(root.children[4].children[0].data, 'server 42'); f.ui.dispose();
});

test('changed dimensions resize both image buffers, including zero and the wire maximum', () => {
  const f = fixture(), root = f.ui.mount();
  for (const [dimension, revision] of [[2, 1n], [3, 2n], [0, 3n], [512, 4n]]) {
    const before = f.trace.filter(call => call[0] === 'ImageData').length;
    f.ui.render(issuedMinimapViewDouble(dimension, revision));
    for (const image of root.children.slice(1, 3)) {
      assert.equal(image.width, dimension); assert.equal(image.height, dimension);
      assert.equal(f.style(image).get('width'), `${dimension}px`);
    }
    assert.equal(f.trace.filter(call => call[0] === 'ImageData').length - before, dimension ? 2 : 0);
    assert.equal(root.children[0].width, dimension + 24); assert.equal(f.ui.imageRevision(), revision);
  }
  f.ui.dispose();
});

test('a null Rust widget hides without retaining game state or inventing layout', () => {
  const f = fixture(), root = f.ui.mount();
  f.ui.render({ schema: 1, enabled: true, imageRevision: 0n, dimension: null,
    baseRgba: new Uint8Array(), alternateRgba: new Uint8Array(), widget: null });
  assert.equal(f.style(root).get('display'), 'none');
  f.ui.render(issuedMinimapViewDouble()); assert.equal(f.style(root).get('display'), 'block');
  f.ui.render({ ...issuedMinimapViewDouble(2, 2n), widget: null });
  assert.equal(f.style(root).get('display'), 'none'); assert.equal(f.ui.imageRevision(), 2n);
  f.ui.dispose();
});

test('bad plane sizes, nonfinite geometry and unmatched revisions fail before drawing', () => {
  const f = fixture(); f.ui.mount();
  for (const change of [view => { view.baseRgba = new Uint8Array(3); },
    view => { view.widget.marker.left = NaN; }, view => { view.dimension = 513; },
    view => { view.widget.background.radius = -1; },
    view => { view.baseRgba = view.alternateRgba = null; }]) {
    const view = issuedMinimapViewDouble(); change(view);
    const before = f.trace.length; assert.throws(() => f.ui.render(view), /Invalid/); assert.equal(f.trace.length, before);
  }
  f.ui.render(issuedMinimapViewDouble()); f.failUpload(true);
  assert.throws(() => f.ui.render(issuedMinimapViewDouble(3, 2n)), /upload failure/);
  assert.equal(f.ui.imageRevision(), undefined, 'failed uploads cannot acknowledge a revision'); f.ui.dispose();
});

test('stale or adopted owned nodes stop writes and cleanup leaves foreign nodes alone', () => {
  for (const kind of ['stale', 'adopted-holder', 'adopted-image']) {
    const f = fixture(), root = f.ui.mount(), foreign = new f.native.Document();
    if (kind === 'stale') f.current(false);
    else foreign.appendChild(kind === 'adopted-holder' ? root : root.children[1]);
    const before = f.trace.length;
    assert.throws(() => f.ui.render(issuedMinimapViewDouble()), /Stale|Invalid/);
    assert.equal(f.trace.length, before);
    f.ui.dispose(); f.ui.dispose();
    if (kind === 'adopted-holder') assert.equal(foreign.children[0], root);
    if (kind === 'adopted-image') assert.equal(foreign.children.length, 1);
  }
});

test('cleanup removes only its holder, preserving siblings and a reparented holder', () => {
  const f = fixture(), sibling = f.document.createElement('aside'); f.parent.appendChild(sibling);
  f.ui.mount(); f.ui.dispose(); assert.deepEqual(f.parent.children, [sibling]);
  const g = fixture(), root = g.ui.mount(), other = g.document.createElement('aside');
  g.document.appendChild(other); other.appendChild(root);
  g.ui.dispose(); assert.deepEqual(other.children, [root]); assert.throws(() => g.ui.render(issuedMinimapViewDouble()), /not mounted/);
});
