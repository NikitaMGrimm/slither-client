// Authored DOM-operation doubles; no native browser or Wasm acceptance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOwnedAnnouncementUi } from '../web/game-owned-announcement-ui.mjs';
import { createGateTestDom } from './game-gate-test-fixture.mjs';

function fixture() {
  const native = createGateTestDom({ hud: true, ownedHud: true });
  const document = new native.Document(), parent = document.createElement('main'); document.appendChild(parent);
  let current = true, fail = false, writes = 0;
  const getter = (prototype, name) => {
    const get = Object.getOwnPropertyDescriptor(prototype, name).get;
    return value => Reflect.apply(get, value, []);
  };
  const dom = Object.fromEntries(['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling', 'isConnected']
    .map(name => [name, getter(native.Node.prototype, name)]));
  for (const name of ['localName', 'namespaceURI']) dom[name] = getter(native.Element.prototype, name);
  dom.style = getter(native.hud.HTMLElement.prototype, 'style');
  dom.setText = (node, text) => { if (fail) throw new Error('synthetic text failure'); node.data = text; writes++; };
  dom.setStyle = (style, name, value) => style.setProperty(name, value);
  const construct = { createElement: (doc, tag) => doc.createElement(tag), createTextNode: (doc, text) => doc.createTextNode(text),
    appendChild: (node, child) => node.appendChild(child), removeChild: (node, child) => node.removeChild(child) };
  const ui = createOwnedAnnouncementUi({ document, parent, dom, construct, isCurrentDocument: () => current });
  return { ui, parent, document, style: node => native.hud.style(dom.style(node)),
    writes: () => writes, current: value => { current = value; }, fail: value => { fail = value; } };
}
const view = () => ({ schema: 1, present: true, opacity: .6, left: 8, top: 4, width: 300, height: 228,
  lines: [{ text: '"<tag> &  text"', fontSize: 17, bold: true, italic: true, spaceAfter: 5 },
    { text: 'By name', fontSize: 13, bold: false, italic: false, spaceAfter: 0 },
    { text: 'Longest today: 10', fontSize: 13, bold: false, italic: false, spaceAfter: 0 }] });

test('passive announcement lease submits only Rust text, ordered lines, layout and raw opacity', () => {
  const f = fixture(); assert.equal(f.parent.children.length, 0);
  const holder = f.ui.mount(); assert.equal(f.style(holder).get('display'), 'none');
  f.ui.render(view());
  assert.equal(f.style(holder).get('opacity'), '0.6'); assert.equal(f.style(holder).get('left'), '8px');
  assert.equal(f.style(holder).get('white-space'), 'normal');
  assert.deepEqual(holder.children.map(node => node.children[0].data), view().lines.map(line => line.text));
  assert.equal(holder.children[0].children.length, 1);
  assert.equal(f.style(holder.children[0]).get('font-size'), '17px');
  assert.equal(f.style(holder.children[0]).get('font-style'), 'italic');
  assert.equal(f.style(holder.children[0]).get('margin-bottom'), '5px');
  assert.equal(f.writes(), 3); f.ui.render({ ...view(), opacity: .5 });
  assert.equal(f.writes(), 3, 'fade-only publication retains existing Text nodes without rewriting content');
  f.ui.render({ ...view(), opacity: -1, lines: view().lines.slice(0, 1) });
  assert.equal(f.style(holder).get('opacity'), '-1'); assert.equal(f.style(holder.children[1]).get('display'), 'none');
  f.ui.dispose(); f.ui.dispose(); assert.equal(f.parent.children.length, 0);
});

test('invalid plans fail before writes; replaced topology and stale documents fail closed', () => {
  const f = fixture(), holder = f.ui.mount();
  assert.throws(() => f.ui.render({ ...view(), lines: [view().lines[0], { text: null }] }));
  assert.equal(f.style(holder).get('display'), 'none');
  holder.children[0].appendChild(f.document.createTextNode('intruder'));
  assert.throws(() => f.ui.render(view())); f.ui.dispose();
  const stale = fixture(); stale.ui.mount(); stale.current(false);
  assert.throws(() => stale.ui.render(view()), /Stale/); stale.ui.dispose();
  assert.equal(stale.parent.children.length, 1, 'no writes/removal in a stale document');
});

test('submission failures propagate and explicit disposal removes the owned mount', () => {
  const f = fixture(); f.ui.mount(); f.fail(true);
  assert.throws(() => f.ui.render(view()), /synthetic text failure/);
  f.ui.dispose(); assert.equal(f.parent.children.length, 0);
});
