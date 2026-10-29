// Thin owned-socket adapter. All phases, packets, geometry, clocks and score policy are Rust.
export function localHost({ owner, socket: construct, now, extent, readout }) {
  let wire, disposed = false, failed = false, failure, renderStopped = false;
  function detach() {
    const old = wire;
    wire = undefined; // Fence synchronous close callbacks before host effects.
    if (old) {
      old.socket.onopen = old.socket.onmessage = old.socket.onerror = old.socket.onclose = null;
      old.socket.close();
    }
  }
  function fail(error) {
    if (!failed) { failed = true; failure = error; }
    owner.fail();
  }
  function drain() {
    for (let count = 0; count < 64; count++) {
      const kind = owner.effect_kind();
      if (!kind) return;
      const id = owner.effect_id(); // BigInt; never convert full u64 to Number.
      const generation = owner.effect_generation();
      try {
        if (kind === 1) {
          if (wire) throw new Error('Socket already owned');
          const socket = construct(owner.effect_url());
          const lease = { socket, generation };
          wire = lease;
          socket.binaryType = 'arraybuffer';
          const active = () => !disposed && wire === lease;
          socket.onopen = () => { if (active()) call(() => owner.opened(generation)); };
          socket.onmessage = event => {
            if (!active()) return;
            call(() => {
              if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 1048576) throw new Error('Binary packet budget/type');
              owner.receive(generation, new Uint8Array(event.data), now());
            });
          };
          socket.onerror = () => { if (active()) call(() => { throw new Error('Local WebSocket failed'); }); };
          socket.onclose = () => {
            if (!active()) return;
            wire = undefined;
            socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
            call(() => owner.closed(generation));
          };
        } else if (kind === 2) {
          if (!wire || wire.generation !== generation || wire.socket.readyState !== 1 || wire.socket.bufferedAmount > 4096) throw new Error('Socket unavailable/full');
          wire.socket.send(owner.effect_bytes());
        } else if (kind === 3) detach();
        else throw new Error('Unknown host effect');
      } catch (error) {
        // Failure commits in Rust before close. Preserve even a thrown undefined separately.
        if (!failed) { failed = true; failure = error; }
        if (kind === 1) { try { detach(); } catch { /* Preserve constructor failure. */ } }
        owner.acknowledge(generation, id, false);
        continue;
      }
      owner.acknowledge(generation, id, true);
    }
    throw new Error('Host effect budget');
  }
  function update() { readout(owner.hud(), !renderStopped && owner.can_play(), failed, failure); }
  function flush() {
    if (renderStopped) { update(); return; }
    const [w, h, dpr] = extent();
    try { owner.flush(w, h, dpr); } catch (error) { renderStopped = true; throw error; }
    drain();
    update();
  }
  function call(action) {
    if (disposed) return;
    try { action(); drain(); flush(); }
    catch (error) { fail(error); try { drain(); } catch { /* Primary exact error retained. */ } update(); }
  }
  return {
    call,
    frame(time) { if (!renderStopped) call(() => { const [w, h, dpr] = extent(); try { owner.frame(time, w, h, dpr); } catch (error) { renderStopped = true; throw error; } }); },
    failure() { return { failed, failure }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { owner.stop(); drain(); } catch (error) { if (!failed) { failed = true; failure = error; } }
      try { detach(); } finally { owner.free(); }
    },
  };
}
