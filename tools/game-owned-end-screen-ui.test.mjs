// Authored native DOM doubles. These tests make no browser/pixel claim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedEndScreenUi } from '../extension/game-owned-end-screen-ui.mjs';
import { createGateTestDom } from './game-gate-test-fixture.mjs';

function fixture(withMenu = false) {
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
  const menuParent = withMenu ? document.createElement('div') : undefined;
  if (menuParent) {
    parent.appendChild(menuParent);
    // Synthetic menu controls and preview retain their own normal-flow slots.
    menuParent.appendChild(document.createElement('button'));
    menuParent.appendChild(document.createElement('canvas'));
  }
  const ui = createOwnedEndScreenUi({ document, parent, menuParent, dom, construct, isCurrentDocument: () => current });
  return { document, parent, menuParent, dom, construct, ui, current(value) { current = value; },
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

test('returned result follows menu controls and preview in the same scroll flow', () => {
  const f = fixture(true), root = f.ui.mount(), existing = [...f.menuParent.children];
  f.ui.render(view, true);
  assert.equal(root.parentNode, f.parent, 'death-delay result remains independent of the hidden menu');
  assert.equal(f.style(root).get('position'), 'fixed');
  f.ui.render(view, false);
  assert.equal(root.parentNode, f.menuParent);
  assert.deepEqual(f.menuParent.children, [...existing, root]);
  assert.equal(f.style(root).get('position'), 'static', 'result occupies space instead of covering the preview');
  assert.equal(f.style(root).get('transform'), 'none');
  assert.equal(f.style(root).get('width'), '100%');
  assert.equal(f.style(root).get('max-width'), '100%');
  assert.equal(f.style(root).get('box-sizing'), 'border-box');
  assert.equal(f.style(root).get('overflow-wrap'), 'anywhere');
  assert.equal(f.style(root).get('pointer-events'), 'none');
  assert.deepEqual(root.children.map(f.text), [view.title, view.scoreText, view.statusText]);
  const append = f.construct.appendChild;
  f.construct.appendChild = () => assert.fail('Repeated publication must not reattach the result');
  f.ui.render({ ...view, title: 'Game over', scoreText: 'Your final length was 165',
    statusText: 'Select Play to play again.' }, false);
  f.construct.appendChild = append;
  f.ui.render({ ...view, visible: false }, true);
  assert.equal(root.parentNode, f.parent);
  assert.equal(f.style(root).get('position'), 'fixed');
  assert.equal(f.style(root).get('width'), 'auto');
  assert.equal(f.style(root).get('display'), 'none');
  f.ui.dispose(); f.ui.dispose(); assert.deepEqual(f.menuParent.children, existing);
});

test('menu placement requires a primitive playing observation before any effect', () => {
  const f = fixture(true), root = f.ui.mount(); f.ui.render(view, true);
  for (const playing of [null, 0, '', {}, new Boolean(false)]) {
    assert.throws(() => f.ui.render({ ...view, title: 'must not publish' }, playing), /Invalid/);
    assert.equal(root.parentNode, f.parent);
    assert.equal(f.text(root.children[0]), view.title);
  }
  f.ui.dispose();
});

test('stale or adopted menu parent rejects before moving or publishing the result', () => {
  for (const change of [f => f.current(false), f => {
    const other = f.document.createElement('aside'); f.parent.appendChild(other); other.appendChild(f.menuParent);
  }]) {
    const f = fixture(true), root = f.ui.mount(); f.ui.render(view, true); change(f);
    assert.throws(() => f.ui.render({ ...view, title: 'must not publish' }, false));
    assert.equal(root.parentNode, f.parent); assert.equal(f.text(root.children[0]), view.title);
    f.ui.dispose(); f.ui.dispose();
  }
});

test('placement attach-then-throw preserves every exact primary and cleanup of either known parent', () => {
  for (const primary of [undefined, null, false, 0, Error('Synthetic placement failure')]) {
    for (const afterEffect of [false, true]) {
      const f = fixture(true), root = f.ui.mount(), append = f.construct.appendChild;
      f.construct.appendChild = (parent, node) => {
        if (afterEffect) append(parent, node);
        throw primary;
      };
      let threw = false;
      try { f.ui.render(view, false); } catch (error) { threw = true; assert.equal(error, primary); }
      assert.equal(threw, true);
      assert.equal(root.parentNode, afterEffect ? f.menuParent : f.parent);
      f.ui.dispose(); f.ui.dispose(); assert.equal(root.parentNode, null);
    }
  }
});

test('result reparented to an unowned sibling is never removed during cleanup', () => {
  const f = fixture(true), root = f.ui.mount(); f.ui.render(view, false);
  const foreign = f.document.createElement('aside'); f.parent.appendChild(foreign); foreign.appendChild(root);
  assert.throws(() => f.ui.render(view, true));
  f.ui.dispose(); assert.equal(root.parentNode, foreign);
});
