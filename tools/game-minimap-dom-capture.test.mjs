// Actual gate capture + builder, with authored Canvas and issued Rust-view doubles.
// No browser, real Wasm, network or raster comparison is exercised.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createGateTestDom, attachGateTestRealm, issuedMinimapViewDouble } from './game-gate-test-fixture.mjs';
import { createOwnedMinimapUi } from '../extension/game-owned-minimap-ui.mjs';

const source = readFileSync(new URL('../extension/game-gate.js', import.meta.url), 'utf8');
function fixture(prepare) {
  const dom = createGateTestDom({ hud: true, ownedHud: true, minimap: true });
  const document = new dom.Document(); document.readyState = 'loading';
  class Storage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
  }
  const sessionStorage = new Storage(), events = new EventTarget(), id = 'a'.repeat(32);
  const realm = { document, location: { href: 'https://slither.io/', reload() {} }, sessionStorage,
    localStorage: new Storage(), Storage, URL, Date: { now: () => 1000 }, Math,
    performance: { now: () => 0 },
    addEventListener: events.addEventListener.bind(events), postMessage() {},
    WebSocket: function () { throw new Error('No sockets in minimap capture test'); } };
  for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'queueMicrotask']) realm[name] = () => 0;
  sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1',
    id, url: realm.location.href, expires: 26000 }));
  const context = createContext(realm);
  runInContext('window = globalThis; top = globalThis', context);
  attachGateTestRealm(dom, realm, document, runInContext('globalThis', context));
  prepare?.(realm, dom);
  runInContext(source, context);
  const gate = realm[Symbol.for('slither.client.gate.v1')], native = gate.claim(id);
  const construct = native.ownedHudDom.dom;
  const parent = construct.createElement(document, 'main'); construct.appendChild(document, parent);
  return { realm, dom, document, native, parent, construct, cap: native.minimapDom };
}

test('gate publishes the optional exact minimap capability without creating a context', () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.cap), ['schema', 'document', 'canvas']);
  assert.deepEqual(Object.keys(f.cap.canvas), ['context', 'resize', 'set', 'call', 'upload']);
  assert.equal(f.cap.document, f.document); assert.equal(f.cap.schema, 1);
  assert(Object.isFrozen(f.cap)); assert(Object.isFrozen(f.cap.canvas));
  assert.deepEqual(f.dom.minimap.trace, []);
  const missing = fixture(realm => { delete realm.ImageData; });
  assert.equal(missing.cap, undefined); assert(missing.native.hudDom); assert(missing.native.ownedHudDom);
  const missingMethod = fixture((realm, dom) => { delete dom.minimap.Context.prototype.save; });
  assert.equal(missingMethod.cap, undefined); assert(missingMethod.native.hudDom);
  const missingSetter = fixture((realm, dom) => {
    Object.defineProperty(dom.minimap.Context.prototype, 'shadowBlur', { configurable: true, set: undefined });
  });
  assert.equal(missingSetter.cap, undefined); assert(missingSetter.native.hudDom);
});

test('gate and builder use captured methods, setters, dimensions, context and ImageData', () => {
  const f = fixture(), { Canvas, Context } = f.dom.minimap;
  const fail = () => { throw new Error('Mutable Canvas prototype used'); };
  for (const name of ['save', 'restore', 'setTransform', 'clearRect', 'beginPath', 'arc',
    'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'putImageData']) Context.prototype[name] = fail;
  for (const name of ['fillStyle', 'strokeStyle', 'lineWidth', 'shadowColor', 'shadowBlur',
    'shadowOffsetX', 'shadowOffsetY']) Object.defineProperty(Context.prototype, name, { configurable: true, set: fail });
  for (const name of ['width', 'height']) Object.defineProperty(Canvas.prototype, name, { configurable: true, set: fail });
  Object.defineProperty(Context.prototype, 'canvas', { configurable: true, get: fail });
  Canvas.prototype.getContext = fail; f.realm.ImageData = fail; f.realm.Uint8ClampedArray = fail;
  const ui = createOwnedMinimapUi({ document: f.document, parent: f.parent, dom: f.native.hudDom.dom,
    construct: f.construct, canvas: f.cap.canvas, isCurrentDocument: f.native.hudDom.isCurrentDocument });
  const root = ui.mount(), view = issuedMinimapViewDouble(); ui.render(view);
  assert.equal(ui.imageRevision(), 1n);
  const uploads = f.dom.minimap.trace.filter(call => call[0] === 'putImageData');
  assert.equal(uploads.length, 2);
  assert.deepEqual(uploads[0][2].data, new Uint8ClampedArray(view.baseRgba));
  assert.deepEqual(uploads[1][2].data, new Uint8ClampedArray(view.alternateRgba));
  assert.deepEqual([uploads[0][2].width, uploads[0][2].height], [2, 2]);
  view.baseRgba.fill(99);
  assert.equal(uploads[0][2].data[0], 0, 'ImageData owns a pixel copy');
  ui.render({ ...view, baseRgba: null, alternateRgba: null });
  assert.equal(f.dom.minimap.trace.filter(call => call[0] === 'putImageData').length, 2);
  assert.equal(root.children.length, 5);
  ui.dispose(); ui.dispose(); assert.deepEqual(f.parent.children, []);
});

test('captured minimap tables are closed and reject unissued or foreign receivers', () => {
  const f = fixture(), cap = f.cap.canvas;
  const canvas = f.construct.createElement(f.document, 'canvas'), context = cap.context(canvas);
  cap.resize(canvas, 536, 536); cap.set(context, 'fillStyle', 'white'); cap.call(context, 'fill');
  assert.throws(() => cap.call(context, 'drawImage'), /Unsupported/);
  assert.throws(() => cap.call(context, 'putImageData'), /Unsupported/);
  assert.throws(() => cap.call(context, 'constructor'), /Unsupported/);
  assert.throws(() => cap.set(context, 'globalAlpha', 0.5), /Unsupported/);
  assert.throws(() => cap.set(context, '__proto__', {}), /Unsupported/);
  assert.throws(() => cap.call(new f.dom.minimap.Context(canvas), 'fill'), /Issued/);
  assert.throws(() => cap.resize(canvas, 537, 0), /dimension/);
  assert.throws(() => cap.upload(context, 513, new Uint8Array()), /dimension/);
  assert.throws(() => cap.upload(context, 2, new Uint8Array(15)), /RGBA/);
  const before = f.dom.minimap.trace.length;
  cap.upload(context, 0, new Uint8Array());
  assert.equal(f.dom.minimap.trace.length, before, 'zero map constructs no ImageData');
  new f.dom.Document().appendChild(canvas);
  assert.throws(() => cap.call(context, 'fill'), /HTML minimap/);
  assert.throws(() => cap.resize(canvas, 2, 2), /HTML minimap/);
});

test('captured minimap operations stop on document freshness loss', () => {
  const f = fixture(), canvas = f.construct.createElement(f.document, 'canvas');
  const context = f.cap.canvas.context(canvas), count = f.dom.minimap.trace.length;
  f.realm.location.href = 'https://slither.io/index.html';
  for (const operation of [() => f.cap.canvas.context(canvas), () => f.cap.canvas.resize(canvas, 2, 2),
    () => f.cap.canvas.set(context, 'fillStyle', 'red'), () => f.cap.canvas.call(context, 'fill'),
    () => f.cap.canvas.upload(context, 0, new Uint8Array())]) assert.throws(operation, /Current minimap/);
  assert.equal(f.dom.minimap.trace.length, count);
});
