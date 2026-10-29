import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStockAccessoryLoadLease } from '../web/stock-accessory-load.mjs';

// Authored inert native capability double. No image/request/browser is created.
function fixture() {
  let at = 0, success, failure, event, timer, decodes = 0, removals = 0;
  const source = {}, state = ['private-authored-src', 'private-authored-current', true, 20, 12];
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
