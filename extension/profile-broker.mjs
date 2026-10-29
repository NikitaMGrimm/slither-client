import { profileDelivery } from './profile-transport.mjs';

/** Fixed-purpose background owner; only browser sender metadata selects a document. */
export function createProfileBroker({ api, native, initialize, Parser, createAcquirer, installGate, bootstrap }) {
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
    if (!key || !message || Object.keys(message).length !== 4 || message.schema !== 1
      || !/^[a-f0-9]{32}$/.test(message.activationId)
      || !Array.isArray(message.authority) || message.authority.length !== 16
      || !message.authority.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      || !['slither-client-profile-bootstrap', 'slither-client-profile-wake', 'slither-client-profile-cancel'].includes(message.type)) {
      if (Array.isArray(message?.authority)) message.authority.fill(0);
      return false;
    }
    if (message.type === 'slither-client-profile-cancel') { message.authority.fill(0); active.get(key)?.cancel(); return false; }
    if (active.has(key)) { message.authority.fill(0); return false; }
    // This private runtime-message field originates in the isolated extension
    // closure, never in the public wake hint. MAIN cannot select or read it.
    const token = Uint8Array.from(message.authority), serialized = [];
    message.authority.fill(0);
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
      if (message.type === 'slither-client-profile-bootstrap') {
        const gateKey = Array.from(token); serialized.push(gateKey);
        const gateResult = await api.scripting.executeScript({
          target: { tabId: sender.tab.id, documentIds: [sender.documentId] }, world: 'MAIN',
          func: installGate, args: [gateKey],
        });
        if (cancelled || gateResult.length !== 1 || gateResult[0].frameId !== 0 || gateResult[0].documentId !== sender.documentId
          || gateResult[0].error || gateResult[0].result !== true) return false;
        const copy = Array.from(token); serialized.push(copy);
        const result = await api.scripting.executeScript({
          target: { tabId: sender.tab.id, documentIds: [sender.documentId] }, world: 'MAIN',
          func: bootstrap, args: [api.runtime.getURL('game/bootstrap.mjs'), copy],
        });
        return !cancelled && result.length === 1 && result[0].frameId === 0 && result[0].documentId === sender.documentId
          && !result[0].error && result[0].result === true;
      }
      timer = native.setTimeout(op.cancel, 5000);
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
      if (message.type !== 'slither-client-profile-bootstrap') void inject('fail');
      if (delivery) await delivery.catch(() => {});
      token.fill(0);
      for (const copy of serialized) copy.fill(0);
      active.delete(key);
    }
  };
}
