import http from 'node:http';
import { once } from 'node:events';

// A static authored noncanonical page and a deny-only proxy. No upstream socket exists.
export async function extensionFixture() {
  const denied = [];
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const local = request.headers.host === '127.0.0.1:' + server.address().port;
    if (!local || request.method !== 'GET' || request.url !== '/') {
      denied.push({ method: request.method, kind: 'http' }); response.writeHead(403); response.end(); return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'" });
    response.end('<!doctype html><meta charset="utf-8"><title>Authored extension boundary</title><p>Local synthetic page. Game activation is unavailable on this origin.</p>');
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('connect', (_request, socket) => { denied.push({ method: 'CONNECT', kind: 'proxy' }); socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { origin: 'http://127.0.0.1:' + server.address().port, denied,
    async close() { for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
