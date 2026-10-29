import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStockAccessoryLoadLease } from '../web/stock-accessory-load.mjs';
import { createStockCachedAccessory } from '../web/stock-cached-accessory.mjs';

// Authored inert native capability double. No image/request/browser is created.
function fixture(source = {}) {
  let at = 0, success, failure, event, timer, decodes = 0, removals = 0;
  const state = ['private-authored-src', 'private-authored-current', true, 20, 12];
  const native = { inspect(value) { assert.equal(value, source); return state.slice(); },
    decode(value) { assert.equal(value, source); decodes++; return {}; },
    then(_promise, ok, fail) { success = ok; failure = fail; },
    listen(value, fn) { assert.equal(value, source); event = fn; return () => { removals++; event = undefined; }; },
    setTimeout(fn, ms) { assert.equal(ms, 5000); timer = fn; return 1; },
    clearTimeout(id) { assert.equal(id, 1); timer = undefined; }, now: () => at };
  return { source, state, native, ready: () => success(), reject: () => failure(), reload: () => event?.(),
    expire() { at = 5000; timer?.(); }, counts: () => ({ decodes, removals, timer: !!timer }) };
}

test('trusted load lease is pending until decode and same-sized reload event permanently invalidates it', () => {
  const f = fixture(), lease = createStockAccessoryLoadLease(f.source, f.native);
  assert.deepEqual(lease.read(), { state: 'pending' });
  f.ready(); assert.equal(lease.read().state, 'ready');
  assert.equal(typeof lease.read().revision, 'string');
  // A same-URL reassignment BEFORE its event is outside this trusted contract.
  // There is deliberately no test claiming pre-event mutation protection.
  f.reload(); assert.deepEqual(lease.read(), { state: 'unsupported' });
  f.ready(); assert.equal(lease.read().state, 'unsupported');
  lease.dispose(); lease.dispose(); assert.deepEqual(f.counts(), { decodes: 1, removals: 1, timer: false });
});

test('fingerprint/readiness drift, rejection, deadline and disposal cannot resurrect a load lease', () => {
  for (const mutation of [f => { f.state[0] = 'changed-private-src'; }, f => { f.state[2] = false; },
    f => { f.state[3]++; }, f => f.reject(), f => f.expire(), f => f.reload()]) {
    const f = fixture(), lease = createStockAccessoryLoadLease(f.source, f.native);
    mutation(f); f.ready(); assert.equal(lease.read().state, 'unsupported'); lease.dispose();
    assert.equal(f.counts().removals, 1); assert.equal(f.counts().timer, false);
  }
  const f = fixture(), lease = createStockAccessoryLoadLease(f.source, f.native);
  lease.dispose(); f.ready(); assert.throws(() => lease.read(), /disposed/);
  assert.equal(f.counts().removals, 1);
});

test('commit-before-ready rejects before decode/listener resources', () => {
  for (const index of [2, 3, 4]) {
    const f = fixture(); f.state[index] = index === 2 ? false : 0;
    assert.throws(() => createStockAccessoryLoadLease(f.source, f.native), /not ready/);
    assert.deepEqual(f.counts(), { decodes: 0, removals: 0, timer: false });
  }
});

test('early invalidation skips decode and cleanup attempts preserve the first thrown value', () => {
  const f = fixture();
  f.native.listen = (_source, invalidate) => { invalidate(); return () => {}; };
  assert.throws(() => createStockAccessoryLoadLease(f.source, f.native), /invalidated/);
  assert.equal(f.counts().decodes, 0);
  const g = fixture(); let removed = 0;
  g.native.listen = () => () => { removed++; throw new Error('secondary cleanup'); };
  g.native.clearTimeout = () => { throw undefined; };
  const lease = createStockAccessoryLoadLease(g.source, g.native);
  let caught = false;
  try { lease.dispose(); } catch (error) { caught = true; assert.equal(error, undefined); }
  assert(caught); assert.equal(removed, 1); g.ready();
  assert.throws(() => lease.read(), /disposed/);
});

function cachedFixture() {
  class Image {
    constructor(ready = true) { this.ready = ready; }
    get complete() { return this.ready; }
    get naturalWidth() { return 20; }
    get naturalHeight() { return 12; }
  }
  const f = fixture(new Image());
  const entry = { loaded: true, img: f.source, ww: 20, hh: 12, sc: 1, px: 0.5, py: 0.5 };
  const realm = { HTMLImageElement: Image, HTMLCanvasElement: class {}, a_ct: 1, a_imgs: [entry] };
  const owner = createStockCachedAccessory({ realm, readAccessory: () => '0', resolveId: () => 0, native: f.native });
  return { ...f, entry, owner, Image };
}

test('observed cached extent drift permanently rejects both pending and ready selected bindings', () => {
  for (const key of ['ww', 'hh']) for (const ready of [false, true]) {
    const f = cachedFixture();
    assert.throws(() => f.owner.capture(), { status: 'pending' });
    if (ready) { f.ready(); assert.equal(f.owner.capture().commitment.state, 'ready'); }
    const original = f.entry[key]; f.entry[key] = 0;
    assert.throws(() => f.owner.capture(), { status: 'unsupported' });
    assert.deepEqual(f.counts(), { decodes: 1, removals: 1, timer: false });
    f.entry[key] = original; f.ready();
    assert.throws(() => f.owner.capture(), { status: 'unsupported' });
    f.owner.dispose(); assert.equal(f.counts().removals, 1);
  }
});

test('unready image replacement cannot hide a changed selected binding behind pending admission', () => {
  const f = cachedFixture();
  assert.throws(() => f.owner.capture(), { status: 'pending' });
  f.entry.img = new f.Image(false);
  assert.throws(() => f.owner.capture(), { status: 'unsupported' });
  f.entry.img = f.source; f.ready();
  assert.throws(() => f.owner.capture(), { status: 'unsupported' });
  f.owner.dispose(); assert.deepEqual(f.counts(), { decodes: 1, removals: 1, timer: false });
});

test('initial zero cached extents remain pending without acquiring a load lease', () => {
  for (const key of ['ww', 'hh']) {
    const f = cachedFixture(), original = f.entry[key]; f.entry[key] = 0;
    assert.throws(() => f.owner.capture(), { status: 'pending' });
    assert.deepEqual(f.counts(), { decodes: 0, removals: 0, timer: false });
    f.entry[key] = original;
    assert.throws(() => f.owner.capture(), { status: 'pending' });
    f.ready(); assert.equal(f.owner.capture().commitment.state, 'ready');
    f.owner.dispose(); assert.deepEqual(f.counts(), { decodes: 1, removals: 1, timer: false });
  }
});
