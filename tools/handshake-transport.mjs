import { maximumProbeMs } from './connection-budget.mjs';

/** One constructor, with a deadline covering processing, sends, and teardown. */
export async function runHandshakeTransport({
  endpoint, session, createSocket, started,
  now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout,
}) {
  const records = [];
  let constructorAttempts = 0;
  let incomingBytes = 0;
  let challengeCompared = false;
  const remaining = () => maximumProbeMs - (now() - started);
  const result = await new Promise(resolve => {
    let socket;
    let finalResult;
    let forceTimer;
    let settled = false;
    const deadline = schedule(() => finish({ success: false, reason: 'Overall deadline reached' }, true), Math.max(0, remaining()));
    function settle() {
      if (settled) return;
      settled = true;
      cancel(deadline); cancel(forceTimer);
      resolve(finalResult);
    }
    function forceClose() {
      if (remaining() <= 0) finalResult = { success: false, reason: 'Overall deadline reached' };
      try { socket?.terminate(); }
      finally { settle(); }
    }
    function finish(value, force = false) {
      if (settled) return;
      // Success includes teardown; expiry can override a pending successful close.
      if (remaining() <= 0) value = { success: false, reason: 'Overall deadline reached' };
      if (!finalResult || !value.success) finalResult = value;
      if (!socket) { settle(); return; }
      if (force || remaining() <= 0 || socket.readyState === 0) { forceClose(); return; }
      if (socket.readyState === 3) { settle(); return; }
      if (!forceTimer) forceTimer = schedule(forceClose, Math.max(0, Math.min(100, remaining())));
      if (socket.readyState === 1) socket.close(1000, 'Bounded handshake probe finished');
    }
    function active() {
      if (remaining() <= 0) { finish({ success: false, reason: 'Overall deadline reached' }, true); return false; }
      return !finalResult && !settled;
    }
    function fail(error) { finish({ success: false, reason: String(error) }, true); }
    function send(bytes) {
      if (!active()) return false;
      socket.send(bytes);
      records.push({ direction: 'out', elapsedMs: now() - started, bytes: Buffer.from(bytes).toString('hex') });
      return active();
    }
    try {
      if (!active()) return;
      constructorAttempts++;
      socket = createSocket(endpoint, {
        origin: 'http://slither.io', followRedirects: false, maxRedirects: 0,
        handshakeTimeout: Math.max(1, remaining()), maxPayload: 1048576, perMessageDeflate: false,
      });
    } catch (error) { fail(error); return; }
    socket.on('open', () => {
      if (!active()) return;
      try { for (const bytes of session.start()) if (!send(bytes)) break; }
      catch (error) { fail(error); }
    });
    socket.on('message', (data, binary) => {
      if (!active()) return;
      try {
        if (!binary) throw new Error('Expected a binary protocol frame');
        incomingBytes += data.length;
        if (incomingBytes > 1048576) throw new Error('Handshake byte budget exceeded');
        records.push({ direction: 'in', elapsedMs: now() - started, bytes: data.toString('hex') });
        const previous = session.state;
        const next = session.receive(Uint8Array.from(data));
        if (!active()) return;
        if (previous === 'challenge') challengeCompared = true;
        for (const bytes of next.outbound) if (!send(bytes)) return;
        if (next.complete && active()) finish({ success: true, protocolVersion: next.protocolVersion });
      } catch (error) { fail(error); }
    });
    socket.on('error', fail);
    socket.on('close', code => {
      if (settled) return;
      if (remaining() <= 0) finalResult = { success: false, reason: 'Overall deadline reached' };
      finalResult ??= { success: false, reason: `Connection closed before setup (${code})` };
      settle();
    });
  });
  return { ...result, constructorAttempts, incomingBytes, challengeCompared, records };
}
