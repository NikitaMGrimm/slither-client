import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { syntheticScene } from '../web/synthetic-scene.mjs';

// Authored challenge and scene only. This is a packet fixture, not a simulator.
export function syntheticChallenge() {
  const source = 'var a="HELLO";a+="ABCDEFGHIJKLMNOPQRSTUV";for(var i=0;i<27;i++){idba[i]=a.charCodeAt(i);}';
  let key = 23; const encoded = [54];
  for (const byte of new TextEncoder().encode(source)) for (const nibble of [byte >> 4, byte & 15]) {
    encoded.push(97 + (nibble + key) % 26); key = (key + 17) % 26;
  }
  return Uint8Array.from(encoded);
}
const inputKinds = ['heading', 'turn', 'boostOn', 'boostOff', 'ping'];
export function createPeerReceipt() {
  return { kind: 'authored-synthetic', connections: 0, logins: 0, closed: 0, errors: [], inputs: [], deliveries: [] };
}

/** Pure socket-side fixture. Timed packets advance only when its caller advances. */
function prepareFixture(fixture) {
  const copy = bytes => {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 1024 * 1024) throw new TypeError('Bounded fixture packet required');
    return bytes.slice();
  };
  const rows = fixture?.packets ?? [{ at: 0, bytes: syntheticScene() }];
  if (!Array.isArray(rows) || !rows.length || rows.length > 256) throw new TypeError('Bounded fixture tape required');
  const tape = rows.map(({ at, bytes }, i) => {
    if (!Number.isInteger(at) || at < 0 || at > 30000 || (i && at < rows[i - 1].at)) throw new TypeError('Ordered bounded fixture tape required');
    return { at, bytes: copy(bytes) };
  });
  const named = new Map(Object.entries(fixture?.named ?? {}).map(([name, bytes]) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new TypeError('Safe packet name required');
    return [name, copy(bytes)];
  }));
  if (tape.length > 256 || named.size > 32) throw new TypeError('Bounded fixture tape required');
  return { tape, named };
}

export function createSyntheticSession({ send, close, receipt = createPeerReceipt(), fixture } = {}) {
  if (typeof send !== 'function' || typeof close !== 'function') throw new TypeError('Fixture transport required');
  const { tape, named } = prepareFixture(fixture);
  const connection = ++receipt.connections;
  let challenged = false, loggedIn = false, ended = false, at = 0, cursor = 0;
  const delivered = new Set();
  const retain = (target, value) => {
    if (target.length >= 4096) throw new Error('Synthetic fixture recording limit');
    target.push(value);
  };
  const flush = () => {
    while (!ended && loggedIn && cursor < tape.length && tape[cursor].at <= at) {
      const item = tape[cursor++];
      send(item.bytes.slice()); retain(receipt.deliveries, { connection, at: item.at, packet: cursor - 1 });
    }
  };
  return {
    receipt,
    receive(value) {
      if (ended) return;
      const bytes = new Uint8Array(value);
      if (!challenged && bytes.length === 2 && bytes[0] === 99 && bytes[1] === 0) {
        challenged = true; send(syntheticChallenge());
      } else if (challenged && !loggedIn && bytes[0] === 115) {
        if (bytes.length < 24 || bytes.subarray(2, 24).some(x => x !== 0)) {
          receipt.errors.push('Nonzero local fixture profile rejected'); close(); return;
        }
        loggedIn = true; receipt.logins++; flush();
      } else if (loggedIn) {
        const kind = bytes.length === 1 && bytes[0] < 251 ? 'heading'
          : bytes.length === 2 && bytes[0] === 252 && bytes[1] !== 0 && bytes[1] !== 128 ? 'turn'
            : bytes.length === 1 ? ({ 251: 'ping', 253: 'boostOn', 254: 'boostOff' })[bytes[0]] : undefined;
        if (!inputKinds.includes(kind)) { receipt.errors.push('Unsupported synthetic client input'); return; }
        retain(receipt.inputs, { connection, kind, bytes: [...bytes] });
        if (kind === 'ping') send(Uint8Array.of(112));
      }
    },
    advance(ms) {
      if (!Number.isInteger(ms) || ms < 0 || ms > 10000 || !Number.isSafeInteger(at + ms)) throw new TypeError('Bounded fixture advance required');
      if (!loggedIn || ended) return;
      at += ms; flush();
    },
    deliver(name) {
      if (!loggedIn || ended || !named.has(name) || delivered.has(name)) throw new Error('Unavailable one-use fixture packet');
      delivered.add(name); send(named.get(name).slice()); retain(receipt.deliveries, { connection, at, name });
    },
    end() { if (!ended) { ended = true; receipt.closed++; } },
  };
}

export async function syntheticPeer({ fixture } = {}) {
  // Fail fixture admission before creating any listening resource.
  prepareFixture(fixture);
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const receipt = createPeerReceipt(), sessions = new Map();
  server.on('connection', (socket, req) => {
    if (req.url !== '/slither' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(req.headers.origin ?? '')) return socket.close();
    const session = createSyntheticSession({ fixture, receipt, send: bytes => socket.send(bytes), close: () => socket.close() });
    sessions.set(socket, session);
    socket.on('close', () => { session.end(); sessions.delete(socket); });
    socket.on('message', bytes => {
      try { session.receive(bytes); }
      catch { receipt.errors.push('Owned synthetic fixture operation failed'); socket.close(); }
    });
    socket.on('error', () => receipt.errors.push('Owned synthetic peer transport error'));
  });
  return { port: server.address().port, receipt,
    advance(ms) { for (const session of sessions.values()) session.advance(ms); },
    deliver(name) {
      if (sessions.size !== 1) throw new Error('Exactly one fixture session required');
      sessions.values().next().value.deliver(name);
    },
    disconnect() { for (const socket of server.clients) socket.close(1000, 'Synthetic normal disconnect'); },
    close() { for (const socket of server.clients) socket.terminate(); return new Promise(resolve => server.close(resolve)); },
  };
}
