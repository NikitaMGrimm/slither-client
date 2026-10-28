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
export async function syntheticPeer() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const receipt = { kind: 'authored-synthetic', connections: 0, logins: 0, errors: [] };
  server.on('connection', (socket, req) => {
    if (req.url !== '/slither' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(req.headers.origin ?? '')) return socket.close();
    receipt.connections++;
    let challenged = false, loggedIn = false;
    socket.on('message', bytes => {
      if (!challenged && bytes.length === 2 && bytes[0] === 99 && bytes[1] === 0) {
        challenged = true; socket.send(syntheticChallenge());
      } else if (challenged && !loggedIn && bytes[0] === 115) {
        // Local host uses zero credentials; reject any other profile without logging bytes.
        if (bytes.length < 24 || bytes.subarray(2, 24).some(x => x !== 0)) {
          receipt.errors.push('Nonzero local fixture profile rejected'); socket.close(); return;
        }
        loggedIn = true; receipt.logins++; socket.send(syntheticScene());
      } else if (loggedIn && bytes.length === 1 && bytes[0] === 251) socket.send(Uint8Array.of(112));
    });
    socket.on('error', () => receipt.errors.push('Owned synthetic peer transport error'));
  });
  return { port: server.address().port, receipt,
    disconnect() { for (const socket of server.clients) socket.close(1000, 'Synthetic normal disconnect'); },
    close() { for (const socket of server.clients) socket.terminate(); return new Promise(resolve => server.close(resolve)); },
  };
}
