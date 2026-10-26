// Browser transport for an explicitly selected local simulator only.
export function loopbackEndpoint(value) {
  const match = typeof value === 'string' && /^ws:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/slither$/.exec(value);
  if (!match) {
    throw new Error('Expected ws://127.0.0.1:<port>/slither');
  }
  if (Number(match[1]) > 65535) {
    throw new Error('Invalid loopback simulator port');
  }
  return value;
}

export function headingByte(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid heading');
  const angle = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(250, Math.floor(angle * 251 / (Math.PI * 2)));
}

/** Pointer coordinates in canvas pixels, transformed to the rendered world. */
export function sceneHeading({ x, y, width, height, camera, zoom, head }) {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error('Invalid input zoom');
  return headingByte(camera.x + (x - width / 2) / zoom - head.x,
    camera.y + (y - height / 2) / zoom - head.y);
}

/** A single connection, no discovery or retries; close/error removes its timer. */
export function connectLoopback({ url, wasm, scene, skin, onFrame, onStatus, Socket = WebSocket,
  schedule = setInterval, cancel = clearInterval }) {
  loopbackEndpoint(url);
  if (!Number.isInteger(skin) || skin < 0 || skin > 2) throw new Error('Invalid local skin');
  const login = wasm.encode_login(0, new Uint8Array(20), 'Local scene', skin, new Uint8Array());
  const socket = new Socket(url);
  socket.binaryType = 'arraybuffer';
  let timer;
  let stopped = false;
  let ready = false;
  let pingPending = false;
  let lastPing = 0;
  let ticks = 0;
  let heading = 0;
  let boost = false;
  let sentBoost;
  function stop(reason = 'Disconnected') {
    if (stopped) return;
    stopped = true; ready = false;
    if (timer !== undefined) cancel(timer);
    socket.close();
    onStatus(reason);
  }
  socket.onopen = () => {
    if (stopped) return;
    try {
      scene.reset();
      socket.send(Uint8Array.of(1));
      socket.send(login);
      onStatus('Connected to local simulator');
    } catch { stop('Local login failed'); }
  };
  timer = schedule(() => {
    if (stopped) return;
    ticks++;
    if ((!ready && ticks >= 50) || (pingPending && ticks - lastPing >= 50)) {
      stop('Local simulator timed out'); return;
    }
    if (!ready) return;
    try {
      if (socket.bufferedAmount > 4096) throw new Error('Local send queue full');
      socket.send(Uint8Array.of(heading));
      if (boost !== sentBoost) {
        socket.send(Uint8Array.of(boost ? 253 : 254)); sentBoost = boost;
      }
      if (!pingPending && ticks - lastPing >= 3) {
        socket.send(Uint8Array.of(251)); pingPending = true; lastPing = ticks;
      }
    } catch { stop('Local send failed'); }
  }, 100);
  socket.onmessage = event => {
    if (stopped) return;
    try {
      if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 1024 * 1024) throw new Error('Invalid frame');
      const bytes = new Uint8Array(event.data);
      // Decode every command first; Scene also validates and atomically applies.
      const commands = wasm.decode_frame(bytes, false);
      scene.apply_frame(bytes, false);
      const view = new DataView(commands.buffer, commands.byteOffset, commands.byteLength);
      for (let offset = 0; offset < commands.length;) {
        const length = view.getUint32(offset); offset += 4;
        if (commands[offset] === 112 && length === 1) pingPending = false;
        offset += length;
      }
      const hasOwn = JSON.parse(scene.snapshot()).ownHead !== null;
      const lifeEnded = ready && !hasOwn;
      ready = hasOwn;
      onFrame();
      if (lifeEnded) stop('Local life ended');
    } catch (error) { stop(`Local frame rejected: ${String(error)}`); }
  };
  socket.onerror = () => stop('Local connection failed');
  socket.onclose = () => stop('Disconnected');
  return {
    close: stop,
    setInput(nextHeading, nextBoost) {
      if (!Number.isInteger(nextHeading) || nextHeading < 0 || nextHeading > 250 || typeof nextBoost !== 'boolean') {
        throw new Error('Invalid local input');
      }
      heading = nextHeading; boost = nextBoost;
    },
  };
}
