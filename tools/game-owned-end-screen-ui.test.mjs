// Authored native DOM doubles. These tests make no browser/pixel claim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedEndScreenUi } from '../extension/game-owned-end-screen-ui.mjs';
import { createGateTestDom } from './game-gate-test-fixture.mjs';

function fixture() {
  const native = createGateTestDom({ hud: true, ownedHud: true });
  const document = new native.Document(), parent = document.createElement('main'); document.appendChild(parent);
  let current = true;
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
    createTextNode: (doc, text) => doc.createTextNode(text), appendChild: (node, child) => node.appendChild(child),
    removeChild: (node, child) => node.removeChild(child) };
  const ui = createOwnedEndScreenUi({ document, parent, dom, construct, isCurrentDocument: () => current });
  return { document, parent, dom, construct, ui, current(value) { current = value; },
    style: node => native.hud.style(dom.style(node)), text: node => node.children[0].data };
}
const view = { schema: 1, visible: true, title: 'Victory', scoreText: 'Your final length was 1001!', statusText: 'Session ended.' };

test('end view is a passive bottom-center sibling and submits Rust text verbatim', () => {
  const f = fixture(), root = f.ui.mount();
  assert.deepEqual(f.parent.children, [root]); assert.equal(f.style(root).get('display'), 'none');
  assert.equal(f.style(root).get('bottom'), '12%'); assert.equal(f.style(root).get('pointer-events'), 'none');
  assert.equal(f.style(root).get('font-variant-numeric'), 'tabular-nums');
  for (const line of root.children) assert.equal(f.style(line).get('position'), 'static',
    'inline normal flow overrides the production host stylesheet absolute paragraph rule');
  f.ui.render({ ...view, title: '<b>Victory</b>' });
  assert.deepEqual(root.children.map(f.text), ['<b>Victory</b>', view.scoreText, view.statusText]);
  assert.equal(root.children[0].children.length, 1); assert.equal(f.style(root).get('display'), 'block');
  f.ui.render({ ...view, visible: false }); assert.equal(f.style(root).get('display'), 'none');
  assert.throws(f.ui.mount, /consumed/); f.ui.dispose(); f.ui.dispose(); assert.deepEqual(f.parent.children, []);
});

test('malformed projections reject before text or style writes', () => {
  const f = fixture(), root = f.ui.mount(); f.ui.render(view);
  for (const input of [null, { ...view, schema: 2 }, { ...view, visible: 1 }, { ...view, scoreText: 1001 }]) {
    assert.throws(() => f.ui.render(input), /Invalid/);
    assert.deepEqual(root.children.map(f.text), [view.title, view.scoreText, view.statusText]);
  }
  f.ui.dispose(); assert.throws(() => f.ui.render(view), /not mounted/);
});

test('stale or reparented owned nodes cannot be published or removed', () => {
  for (const change of [f => f.current(false), f => {
    const foreign = f.document.createElement('div'); f.parent.appendChild(foreign);
    foreign.appendChild(f.parent.children[0]);
  }]) {
    const f = fixture(), root = f.ui.mount(); change(f);
    assert.throws(() => f.ui.render(view)); f.ui.dispose(); f.ui.dispose();
    assert.equal(root.isConnected, true);
  }
});

test('changed child topology blocks publication and disposal still releases the exact owned holder', () => {
  const f = fixture(), root = f.ui.mount();
  root.children[1].appendChild(f.document.createTextNode('unexpected'));
  assert.throws(() => f.ui.render(view));
  f.ui.dispose(); assert.deepEqual(f.parent.children, []);
});

test('attach-then-throw construction retains cleanup authority without acknowledging mount', () => {
  const f = fixture(), append = f.construct.appendChild, primary = Error('Synthetic append guard failure');
  f.construct.appendChild = (parent, node) => {
    append(parent, node);
    if (parent === f.parent) throw primary;
  };
  assert.throws(f.ui.mount, error => error === primary);
  assert.equal(f.parent.children.length, 1);
  f.ui.dispose(); f.ui.dispose(); assert.deepEqual(f.parent.children, []);
});
