// One trusted load-once image lease, not a loader or arbitrary mutation observer.
// Fingerprints may contain URLs privately; none are returned or included in errors.
const issuedLeases = new WeakMap();

/** A producer may retire guards only for this source's live issued listeners. */
export function assertStockAccessoryLoadListeners(lease, source) {
  const active = issuedLeases.get(lease);
  if (!active || !active(source)) throw new TypeError('Issued live accessory load listeners required');
}

export function createStockAccessoryLoadLease(source, native) {
  for (const name of ['inspect', 'decode', 'then', 'listen', 'setTimeout', 'clearTimeout', 'now']) {
    if (typeof native?.[name] !== 'function') throw new TypeError('Accessory load capability unavailable');
  }
  let state = 'pending', initial, remove, timer, generation = {}, disposed = false, cleanupError, cleanupFailed = false;
  const started = native.now();
  const same = value => Array.isArray(value) && value.length === 5
    && value.every((part, index) => Object.is(part, initial[index]));
  const ready = value => typeof value[0] === 'string' && typeof value[1] === 'string'
    && value[2] === true && Number.isInteger(value[3]) && value[3] > 0 && value[3] <= 65535
    && Number.isInteger(value[4]) && value[4] > 0 && value[4] <= 65535;
  function stop() {
    const attempt = callback => { try { callback(); } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } } };
    if (timer !== undefined) { const value = timer; timer = undefined; attempt(() => native.clearTimeout(value)); }
    if (remove) { const value = remove; remove = undefined; attempt(value); }
  }
  function invalidate() {
    state = 'unsupported'; generation = null;
    stop();
  }
  try {
    initial = native.inspect(source);
    if (!Array.isArray(initial) || initial.length !== 5 || !ready(initial)) throw new TypeError('Accessory source not ready before decode');
    remove = native.listen(source, invalidate);
    if (!generation) throw new Error('Accessory load invalidated before decode');
    timer = native.setTimeout(invalidate, 5000);
    if (!generation) throw new Error('Accessory load deadline before decode');
    const ticket = generation;
    native.then(native.decode(source), () => {
      if (disposed || generation !== ticket) return;
      try {
        if (native.now() - started >= 5000 || !same(native.inspect(source))) { invalidate(); return; }
        state = 'ready';
        if (timer !== undefined) { const value = timer; timer = undefined; native.clearTimeout(value); }
      } catch { invalidate(); }
    }, () => { if (!disposed && generation === ticket) invalidate(); });
  } catch (error) {
    try { invalidate(); } catch { /* Preserve the primary setup failure. */ }
    throw error;
  }
  const lease = Object.freeze({
    read() {
      if (disposed) throw new Error('Accessory load lease disposed');
      if (state !== 'unsupported') {
        try { if (!same(native.inspect(source)) || (state === 'pending' && native.now() - started >= 5000)) invalidate(); }
        catch (error) { try { invalidate(); } catch { /* Preserve primary. */ } throw error; }
      }
      if (cleanupFailed) throw cleanupError;
      return Object.freeze({ state, ...(state === 'ready' ? { revision: 'trusted-accessory-load/1' } : {}) });
    },
    dispose() { if (disposed) return; disposed = true; state = 'unsupported'; generation = null; stop(); if (cleanupFailed) throw cleanupError; },
  });
  issuedLeases.set(lease, value => value === source && !disposed && state !== 'unsupported' && typeof remove === 'function');
  return lease;
}
