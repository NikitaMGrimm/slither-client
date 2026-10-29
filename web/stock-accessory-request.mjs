// Native effects only. Resource admission, phases, attempts and deadlines belong to Rust.
import { assertStockAccessoryLoadListeners } from './stock-accessory-load.mjs';
const owners = new WeakMap();

export function createStockAccessoryRequest({ native, clock, Request, resolveId, started, deadline }) {
  if (typeof Request !== 'function' || typeof resolveId !== 'function' || typeof native?.open !== 'function') {
    throw new TypeError('Selected accessory request capabilities required');
  }
  let policy, binding, remove, timer, disposed = false, busy = false, freed = false, failed = false, primary;
  function free() { if (!busy && !freed && policy) { freed = true; policy.free(); } }
  function stop() {
    let bad = false, error;
    for (const cleanup of [() => { if (timer !== undefined) { const value = timer; timer = undefined; clock.clearTimeout(value); } },
      () => { if (remove) { const value = remove; remove = undefined; value(); } }]) {
      try { cleanup(); } catch (value) { if (!bad) { bad = true; error = value; } }
    }
    if (bad) throw error;
  }
  function fail(error) {
    if (!failed) { failed = true; primary = error; }
    if (!freed) policy?.invalidate();
    try { stop(); } catch { /* Preserve the first native/event failure, including falsy values. */ }
  }
  function current() {
    if (failed) throw primary;
    if (disposed) throw new Error('Selected accessory request disposed');
    policy.check(policy.ticket(), clock.now());
    binding.assertCurrent();
    if (failed) throw primary;
  }
  function guarded(operation) {
    if (busy) { const error = new Error('Selected accessory request reentered'); fail(error); throw primary; }
    busy = true;
    try { current(); const result = operation(); if (failed) throw primary; if (disposed) throw new Error('Selected accessory request disposed'); return result; }
    catch (error) { fail(error); throw primary; }
    finally { busy = false; if (disposed) { try { free(); } catch (error) { fail(error); } } }
  }
  try {
    binding = native.open(resolveId);
    if (binding === undefined) return undefined;
    policy = new Request(started, deadline);
    const action = binding.prepare(policy, clock.now());
    const ticket = policy.ticket();
    if (action === 2) {
      guarded(() => binding.create());
      guarded(() => binding.publishImage());
      // The expected first load publishes cache data; the ready-only lease starts later.
      remove = binding.listen(() => {
        if (disposed || !policy.live(ticket)) return;
        try {
          guarded(() => {
            const values = binding.extents();
            policy.loaded(ticket, clock.now(), ...values);
            binding.publishLoaded();
            binding.assertCurrent();
          });
        } catch (error) { fail(error); }
      }, () => { if (!disposed && policy.live(ticket)) fail(new Error('Selected accessory image failed')); });
      guarded(() => {});
      timer = clock.setTimeout(() => {
        if (!disposed && policy.live(ticket)) fail(new Error('Selected accessory startup deadline'));
      }, policy.remaining(clock.now()));
      guarded(() => {});
      guarded(() => binding.request());
      guarded(() => {});
    }
  } catch (error) {
    fail(error);
    disposed = true;
    try { policy?.dispose(); } catch { /* Preserve setup primary. */ }
    try { free(); } catch { /* Preserve setup primary. */ }
    throw primary;
  }
  const owner = Object.freeze({
    assertCurrent() { guarded(() => {}); },
    dispose() {
      if (disposed) return;
      disposed = true;
      let bad = failed, error = primary;
      for (const cleanup of [() => policy.dispose(), stop, free]) {
        try { cleanup(); } catch (value) { if (!bad) { bad = true; error = value; } }
      }
      if (bad) throw error;
    },
  });
  owners.set(owner, { failed: () => failed, assertCurrent: owner.assertCurrent, handoff: source => guarded(() => {
    if (!binding.matches(source)) throw new Error('Selected accessory handoff source changed');
    binding.assertCurrent();
    policy.handoff(policy.ticket(), clock.now());
    stop();
  }) });
  return owner;
}

/** Only an issued owner can release producer guards after ready listeners exist. */
export function handoffStockAccessoryRequest(owner, source, lease) {
  if (owner === undefined) return;
  const handoff = owners.get(owner);
  if (!handoff) throw new TypeError('Issued selected accessory request owner required');
  assertStockAccessoryLoadListeners(lease, source);
  handoff.handoff(source);
}

export function assertStockAccessoryRequest(owner) {
  if (owner === undefined) return;
  const hooks = owners.get(owner);
  if (!hooks) throw new TypeError('Issued selected accessory request owner required');
  hooks.assertCurrent();
}

/** A native primary remains terminal even if it advertises a pending status. */
export function hasFailedStockAccessoryRequest(owner) {
  return owners.get(owner)?.failed() === true;
}
