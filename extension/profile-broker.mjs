import { profileDelivery } from './profile-transport.mjs';

/** Fixed-purpose background owner; only browser sender metadata selects a document. */
export function createProfileBroker({ api, native, initialize, Parser, createAcquirer }) {
  const active = new Map();
  const receiverURL = api.runtime.getURL('game/profile-receiver.mjs');
  const keyOf = sender => {
    if (sender?.id !== api.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)
      || sender.url !== 'http://slither.com/io' || sender.origin !== 'http://slither.com'
      || typeof sender.documentId !== 'string' || !sender.documentId) return;
    return `${sender.tab.id}:${sender.documentId}`;
  };
  return async function receive(message, sender) {
    const key = keyOf(sender);
    if (!key || !message || Object.keys(message).length !== 3 || message.schema !== 1
      || !/^[a-f0-9]{32}$/.test(message.activationId)
      || !['slither-client-profile-wake', 'slither-client-profile-cancel'].includes(message.type)) return false;
    if (message.type === 'slither-client-profile-cancel') { active.get(key)?.cancel(); return false; }
    if (active.has(key)) return false;
    const token = new Uint8Array(16), serialized = [];
    let acquirer, cancelled = false, delivery, timer, cancelWait;
    const cancellation = new Promise(resolve => { cancelWait = resolve; });
    const op = { cancel() {
      cancelled = true;
      try { acquirer?.dispose(); } catch { /* Cancellation cannot retain serialized credentials. */ }
      cancelWait();
    } };
    active.set(key, op);
    const now = native.now;
    const start = now();
    let previous = start, deadline = start + 5000;
    const current = () => {
      const time = now();
      const valid = !cancelled && Number.isFinite(time) && time >= previous && time < deadline;
      previous = time;
      return valid;
    };
    const bounded = promise => Promise.race([promise, cancellation.then(() => { throw new Error('Profile broker cancelled'); })]);
    const inject = async (operation, version, protocol, password) => {
      const copy = Array.from(token); serialized.push(copy);
      try {
        const result = await bounded(api.scripting.executeScript({
          target: { tabId: sender.tab.id, documentIds: [sender.documentId] }, world: 'MAIN',
          func: profileDelivery, args: [receiverURL, operation, copy, version ?? null, protocol ?? null, password ?? null],
        }));
        if (result.length !== 1 || result[0].frameId !== 0 || result[0].documentId !== sender.documentId || result[0].error) return false;
        return result[0].result;
      } catch { return false; }
      finally { copy.fill(0); }
    };
    try {
      timer = native.setTimeout(op.cancel, 5000);
      native.random(token);
      if (!current()) return false;
      const claim = await inject('claim');
      if (!current() || claim?.accepted !== true || !Number.isFinite(claim.remainingMs)
        || claim.remainingMs <= 0 || claim.remainingMs > 5000) return false;
      // Subtract the whole probe round trip, conservatively, without mixing realm clocks.
      deadline = Math.min(deadline, start + claim.remainingMs);
      native.clearTimeout(timer);
      timer = native.setTimeout(op.cancel, Math.max(0, deadline - now()));
      await bounded(initialize());
      if (!current()) return false;
      acquirer = createAcquirer({ capabilities: native.capabilities,
        literalParser: Parser, isCurrentDocument: current, remainingMs: deadline - now() });
      await acquirer.acquireForPlay(profile => {
        if (!current()) throw new Error('Profile broker expired');
        const password = Array.from(profile.password); serialized.push(password);
        // Keep the consumer synchronous. Shared acquirer clears source/digest/scratch
        // before this call, and clears its borrowed password as this call returns.
        delivery = inject('deliver', profile.clientVersion, profile.protocolVersion, password)
          .finally(() => password.fill(0));
      });
      if (!delivery || await delivery !== true || !current()) return false;
      // All parsed password copies have cleared before MAIN releases its acquiring fence.
      return await inject('finish') === true;
    } catch { return false; }
    finally {
      op.cancel();
      try { if (timer !== undefined) native.clearTimeout(timer); } catch { /* Still clear owned copies. */ }
      // A consumed MAIN claim remains terminal even if this worker restarts.
      // Cleanup notification is best effort and never extends the attempt deadline.
      void inject('fail');
      if (delivery) await delivery.catch(() => {});
      token.fill(0);
      for (const copy of serialized) copy.fill(0);
      active.delete(key);
    }
  };
}
