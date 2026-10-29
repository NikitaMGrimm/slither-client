// MAIN module-private destination. Only an owned Play may issue a pending lease.
let destination;
const failure = () => new Error('Extension profile unavailable');

export function createExtensionProfileReceiver(native, isCurrentDocument, bootstrapAuthority) {
  if (destination || globalThis[Symbol.for('slither.client.gate.v1')]?.verifyExtensionProfile?.(native) !== true) throw failure();
  const { freeze, octets } = native;
  if (!octets(bootstrapAuthority, 16)) throw failure();
  // Authority is bound during private bootstrap, never installed by public claim.
  const authority = native.bytes.allocate(16);
  for (let i = 0; i < 16; i++) authority[i] = bootstrapAuthority[i];
  let authorityLive = true;
  const authenticated = token => {
    if (!authorityLive || !octets(token, 16)) return false;
    let mismatch = 0;
    for (let i = 0; i < 16; i++) mismatch |= token[i] ^ authority[i];
    return mismatch === 0;
  };
  const clearAuthority = () => { if (authorityLive) { authorityLive = false; native.bytes.clear(authority); } };
  let state = 'idle', active;
  const fresh = op => {
    const now = native.now();
    const current = isCurrentDocument();
    if (active !== op || op.done || current !== true || !Number.isFinite(now)
      || now < op.previous || now - op.start >= 5000) throw failure();
    op.previous = now;
    return 5000 - (now - op.start);
  };
  function finish(op, success) {
    if (op.done) return;
    op.done = true; state = success ? 'used' : 'failed';
    let cleaned = true;
    try { if (op.timer !== undefined) native.clearTimeout(op.timer); } catch { cleaned = false; }
    try { clearAuthority(); } catch { cleaned = false; }
    op.consumer = undefined;
    if (success && cleaned) op.resolve(); else { state = 'failed'; op.reject(failure()); }
  }
  const acquirer = freeze({
    status: () => freeze({ state }),
    acquireForPlay(consumer) {
      if (state !== 'idle' || typeof consumer !== 'function') return Promise.reject(failure());
      state = 'loading';
      return new Promise((resolve, reject) => {
        const op = { __proto__: null, resolve, reject, consumer, done: false, claimed: false, delivered: false,
          timer: undefined, start: undefined, previous: undefined };
        active = op;
        try {
          native.authorize();
          op.start = op.previous = native.now();
          fresh(op);
          op.timer = native.setTimeout(() => {
            try { finish(op, false); } finally { native.cancel(); }
          }, 5000);
          fresh(op); native.wake(); fresh(op);
        } catch { finish(op, false); }
      });
    },
    dispose() {
      if (active && !active.done) {
        try { finish(active, false); } finally { native.cancel(); }
      }
      clearAuthority();
      state = 'disposed';
    },
  });
  destination = {
    claim(token) {
      const op = active;
      if (!op || op.claimed || !authenticated(token)) return { accepted: false };
      try {
        const remainingMs = fresh(op);
        op.claimed = true;
        return { accepted: true, remainingMs };
      } catch { finish(op, false); return { accepted: false }; }
    },
    accept(operation, token, version, protocol, values) {
      const op = active;
      let password;
      // An unauthenticated public call cannot claim, cancel or finish the intent.
      if (!authenticated(token)) return false;
      try {
        if (!op || !op.claimed) throw failure();
        fresh(op);
        if (operation === 'fail') { finish(op, false); return true; }
        if (operation === 'finish') {
          if (!op.delivered) throw failure();
          finish(op, true); return true;
        }
        if (operation !== 'deliver' || op.delivered || !octets(values, 20)
          || typeof version !== 'number' || (version >>> 0) !== version || version > 65535 || protocol !== 19) throw failure();
        // Commit before the synchronous consumer can reenter the destination.
        op.delivered = true;
        password = native.bytes.allocate(20);
        for (let i = 0; i < 20; i++) password[i] = values[i];
        const result = op.consumer(freeze({ clientVersion: version, protocolVersion: protocol, password }));
        if (result !== undefined) throw failure();
        fresh(op);
        return true;
      } catch {
        if (op && !op.done) finish(op, false);
        return false;
      } finally {
        if (password) native.bytes.clear(password);
      }
    },
  };
  return freeze({ acquirer, bytes: native.bytes, isCurrentDocument });
}

// Browser-privileged injected code imports these; no owner/profile is installed on window.
export const claimPendingProfileBroker = token => destination?.claim(token) ?? { accepted: false };
export const deliverPendingProfileBroker = (operation, token, version, protocol, password) =>
  destination?.accept(operation, token, version, protocol, password) ?? false;
