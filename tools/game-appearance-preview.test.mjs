// Actual passive lease and gate capture; explicit DOM/Canvas/Wasm doubles only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';
import { createAppearancePreviewDouble } from './appearance-preview-double.mjs';
import { createAppearancePreview } from '../extension/game-appearance-preview.mjs';

const source = readFileSync(new URL('../extension/game-gate.js', import.meta.url), 'utf8');
function fixture(before) {
  const dom = createGateTestDom({ hud: true, ownedHud: true, ownedPlay: true, minimap: true });
  const document = new dom.Document(); document.readyState = 'loading';
  class Storage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
    removeItem(key) { this.values.delete(key); }
  }
  const events = new EventTarget(), id = 'a'.repeat(32);
  const realm = { document, location: { href: 'https://slither.io/', reload() {} }, sessionStorage: new Storage(),
    localStorage: new Storage(), Storage, URL, Date: { now: () => 1000 }, Math, performance: { now: () => 0 },
    addEventListener: events.addEventListener.bind(events), postMessage() {},
    WebSocket() { throw new Error('No sockets in preview tests'); } };
  for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'queueMicrotask']) realm[name] = () => 0;
  realm.sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1', id,
    url: realm.location.href, expires: 26000 }));
  const context = createContext(realm); runInContext('window = globalThis; top = globalThis', context);
  attachGateTestRealm(dom, realm, document, runInContext('globalThis', context)); before?.(realm, dom);
  runInContext(source, context);
  const native = realm[Symbol.for('slither.client.gate.v1')].claim(id), construct = native.ownedHudDom.dom;
  const parent = construct.createElement(document, 'div'); construct.appendChild(document, parent);
  const world = construct.createElement(document, 'canvas'); construct.appendChild(parent, world);
  const menu = construct.createElement(document, 'div'); construct.appendChild(parent, menu);
  const calls = [], jobs = [], Policy = createAppearancePreviewDouble(calls);
  const methods = Object.freeze(Object.fromEntries(['select', 'revision', 'needs_draw', 'render', 'free'].map(name => [name, Policy.prototype[name]])));
  const control = { current: true, held: false, status: 'ready' };
  const options = { document, dom: native.hudDom.dom, construct, Policy, methods, local: true, worldTarget: world,
    prepare: native.appearancePreviewDom?.prepare, defer: job => jobs.push(job), check() {},
    isCurrentDocument: native.hudDom.isCurrentDocument, isCurrentGeneration: () => control.current,
    withSources(callback) {
      calls.push(['begin']); control.held = true;
      try { return callback(request => { calls.push(['recipe', request]); return { status: control.status }; }); }
      finally { control.held = false; calls.push(['end']); }
    } };
  return { dom, realm, document, native, construct, parent, world, menu, calls, jobs, options, control };
}

test('captured Canvas frame uses original operations and restores exactly once', () => {
  const f = fixture(), cap = f.native.appearancePreviewDom, { Canvas, Context, trace } = f.dom.minimap;
  assert.deepEqual(Object.keys(cap), ['schema', 'document', 'prepare']); assert(Object.isFrozen(cap));
  assert.deepEqual(trace, [], 'capture creates no context or source');
  const canvas = f.construct.createElement(f.document, 'canvas'); f.construct.appendChild(f.menu, canvas);
  const fail = () => { throw new Error('Mutable Canvas operation'); };
  Canvas.prototype.getContext = fail; Context.prototype.save = fail; Context.prototype.restore = fail;
  for (const name of ['width', 'height']) Object.defineProperty(Canvas.prototype, name, { configurable: true, set: fail });
  Object.defineProperty(Context.prototype, 'canvas', { configurable: true, get: fail });
  const frame = cap.prepare(canvas, 320, 128); assert(Object.isFrozen(frame));
  frame.finish(); assert.throws(() => frame.finish(), /consumed/);
  assert.equal(trace.filter(entry => entry[0] === 'save').length, 1);
  assert.equal(trace.filter(entry => entry[0] === 'restore').length, 1);
  assert.throws(() => cap.prepare(canvas, 1025, 128), /dimensions/);
  f.realm.location.href += '?stale'; assert.throws(() => cap.prepare(canvas, 320, 128), /Current/);
  assert.equal(fixture((realm, dom) => { delete dom.minimap.Context.prototype.save; }).native.appearancePreviewDom, undefined);
});

test('queued preview coalesces native revisions, retains source identity and publishes only after release', () => {
  const f = fixture();
  const dom = { ...f.options.dom, setText(node, value) { assert.equal(f.control.held, false); f.options.dom.setText(node, value); } };
  const lease = createAppearancePreview({ ...f.options, dom }); const holder = lease.mount(f.menu);
  const custom = new Uint8Array([1, 2]); lease.select(0, custom); custom[0] = 99; lease.select(1, new Uint8Array());
  assert.equal(f.calls.filter(entry => entry[0] === 'recipe').length, 0);
  f.jobs.shift()(); assert.equal(f.calls.filter(entry => entry[0] === 'begin').length, 0, 'stale selection opens no lease');
  f.jobs.shift()();
  const rendered = f.calls.find(entry => entry[0] === 'render');
  assert.equal(rendered[2], holder.children[0]); assert.equal(rendered[3], f.world);
  assert.deepEqual(f.calls.find(entry => entry[0] === 'select').slice(1), [0, [1, 2]]);
  assert.deepEqual(f.calls.filter(entry => ['begin', 'recipe', 'end'].includes(entry[0])).map(entry => entry[0]), ['begin', 'recipe', 'end']);
  lease.select(1, new Uint8Array()); f.jobs.shift()();
  assert.equal(f.calls.filter(entry => entry[0] === 'begin').length, 1, 'drawn revision opens no source lease');
  f.control.status = 'pending'; lease.select(2, new Uint8Array()); f.jobs.shift()();
  assert.equal(f.dom.hud.style(f.options.dom.style(holder.children[0])).get('display'), 'none');
  lease.select(0, new Uint8Array()); lease.dispose(); f.jobs.shift()(); lease.dispose();
  assert.deepEqual(f.menu.children, []); assert.equal(f.calls.filter(entry => entry[0] === 'free').length, 1);
});

test('generation and exact topology checks stop queued source reads', () => {
  for (const mode of ['generation', 'topology', 'document']) {
    const f = fixture(), lease = createAppearancePreview(f.options), holder = lease.mount(f.menu);
    lease.select(0, new Uint8Array());
    if (mode === 'generation') f.control.current = false;
    if (mode === 'document') f.realm.location.href += '?stale';
    if (mode === 'topology') f.construct.removeChild(holder, holder.children[0]);
    if (mode === 'generation') f.jobs.shift()(); else assert.throws(() => f.jobs.shift()(), /Current|ownership/);
    assert.equal(f.calls.filter(entry => entry[0] === 'begin').length, 0); lease.dispose();
    assert.equal(f.calls.filter(entry => entry[0] === 'free').length, 1);
  }
});

test('attach then throw retains cleanup authority and first undefined removal failure', () => {
  const f = fixture(), append = f.options.construct.appendChild, remove = f.options.construct.removeChild;
  const construct = { ...f.options.construct, appendChild(parent, value) {
    append(parent, value); if (parent === f.menu) throw undefined;
  }, removeChild(parent, value) { remove(parent, value); throw undefined; } };
  let frees = 0;
  const methods = { ...f.options.methods, free() { frees++; throw new Error('secondary free'); } };
  const lease = createAppearancePreview({ ...f.options, construct, methods });
  let thrown = false;
  try { lease.mount(f.menu); } catch (error) { thrown = true; assert.equal(error, undefined); }
  assert(thrown); assert.equal(f.menu.children.length, 1);
  thrown = false;
  try { lease.dispose(); } catch (error) { thrown = true; assert.equal(error, undefined); }
  assert(thrown); assert.equal(f.menu.children.length, 0); assert.equal(frees, 1); lease.dispose();
});

test('reentrant teardown defers Wasm free until render and source retention unwind, preserving undefined', () => {
  const f = fixture(); let lease, rendering = false, held = false;
  const methods = { ...f.options.methods, render() {
    rendering = true; lease.dispose(); assert.equal(f.calls.filter(entry => entry[0] === 'free').length, 0);
    rendering = false; throw undefined;
  }, free() { assert.equal(rendering, false); assert.equal(held, false); f.calls.push(['free']); throw new Error('secondary cleanup'); } };
  lease = createAppearancePreview({ ...f.options, methods, withSources(callback) {
    held = true; try { return callback(() => ({})); } finally { held = false; }
  } });
  lease.mount(f.menu); lease.select(0, new Uint8Array());
  let thrown = false;
  try { f.jobs.shift()(); } catch (error) { thrown = true; assert.equal(error, undefined); }
  assert(thrown); assert.equal(f.calls.filter(entry => entry[0] === 'free').length, 1); assert.deepEqual(f.menu.children, []);
});

test('local preview lease carries represented ID65 and owned custom bytes without remapping', () => {
  const f=fixture(), lease=createAppearancePreview(f.options);lease.mount(f.menu);
  try{
    for(const skin of[9,10,15,29,65]){
      const bytes=new Uint8Array();lease.select(skin,bytes);f.jobs.shift()();
      const request=f.calls.filter(row=>row[0]==='recipe').at(-1)[1];
      assert.equal(request.skin,skin);assert.equal(request.own,false);assert.equal(request.cosmetic,0);
    }
    const custom=Uint8Array.of(0,0,0,0,0,0,0,0,2,0,3,1,4,2);
    lease.select(65,custom);custom.fill(0);f.jobs.shift()();
    const request=f.calls.filter(row=>row[0]==='recipe').at(-1)[1];
    assert.equal(request.skin,65);assert.deepEqual([...request.customBytes],[0,0,0,0,0,0,0,0,2,0,3,1,4,2]);
  }finally{lease.dispose();}
});
