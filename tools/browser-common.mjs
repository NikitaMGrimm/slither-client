import http from 'node:http';
import { readFile, realpath, mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { once } from 'node:events';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const within = (base, file) => {
  const r = path.relative(base, file);
  return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
};
export async function readConfinedFile(base, relative) {
  const file = await realpath(path.resolve(base, relative));
  if (!within(await realpath(base), file)) throw new Error('Escaped root');
  return readFile(file);
}
export async function freshOutput(selected, otherRoots = []) {
  if (!selected) throw new Error('An explicit fresh --output directory is required');
  const target = path.resolve(selected);
  // Resolve the existing parent, rejecting symlink aliases into the checkout.
  const parent = await realpath(path.dirname(target));
  const canonical = path.join(parent, path.basename(target));
  for (const base of [root, ...otherRoots]) {
    if (within(await realpath(base), canonical)) throw new Error('Outputs must be outside the checkout and selected input roots');
  }
  await mkdir(canonical); // EEXIST deliberately preserves old and failed runs.
  return canonical;
}
export const json = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
export async function cleanupResources(steps) {
  const errors = [];
  for (const [name, run] of steps) {
    try { await run(); } catch (error) { errors.push({ name, error: error?.name ?? 'ThrownValue' }); }
  }
  return errors;
}
export async function syntheticServer() {
  const routes = new Map([
    ['/', ['tools/browser-fixture.html', 'text/html']],
    ['/fixture.mjs', ['tools/browser-fixture.mjs', 'text/javascript']],
    ...['synthetic-scene', 'synthetic-body', 'synthetic-food', 'synthetic-prey', 'skin-provider']
      .map(x => [`/web/${x}.mjs`, [`web/${x}.mjs`, 'text/javascript']]),
    ['/pkg/slither_client.js', ['dist/web/slither_client.js', 'text/javascript']],
    ['/pkg/slither_client_bg.wasm', ['dist/web/slither_client_bg.wasm', 'application/wasm']],
  ]);
  const server = http.createServer(async (req, res) => {
    const send = (status, type, bytes) => { res.writeHead(status, { 'Content-Type': type }); res.end(bytes); };
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; worker-src 'none'");
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) return send(403, 'text/plain', 'Literal loopback required');
    if (req.method !== 'GET') return send(405, 'text/plain', 'GET required');
    const snippet = /^\/pkg\/(snippets\/slither-client-[a-f0-9]{16}\/web\/stock-hud-contract\.mjs)$/.exec(req.url);
    const entry = routes.get(req.url) ?? (snippet ? [`dist/web/${snippet[1]}`, 'text/javascript'] : null);
    if (!entry) return send(404, 'text/plain', 'No route');
    try {
      send(200, entry[1], await readConfinedFile(root, entry[0]));
    } catch { send(503, 'text/plain', 'Resource unavailable'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(e => e ? reject(e) : resolve()); }) };
}
export async function temporaryProfile() {
  const prefix = path.join(await realpath(os.tmpdir()), 'slither-browser-');
  const profile = await mkdtemp(prefix);
  return { path: profile, async remove() {
    const actual = await realpath(profile);
    if (actual !== profile || !actual.startsWith(prefix) || !within(await realpath(os.tmpdir()), actual)) throw new Error('Profile cleanup confinement failed');
    await rm(actual, { recursive: true });
  } };
}
export async function fence(context, origin, { sockets = false, socketOrigin } = {}) {
  const blocked = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.username && !url.password) return route.continue();
    blocked.push({ kind: 'http', scheme: url.protocol }); return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (((sockets && url.origin === origin.replace('http:', 'ws:')) || (socketOrigin && url.origin === socketOrigin))
      && url.pathname === '/slither' && !url.username && !url.password) socket.connectToServer();
    else { blocked.push({ kind: 'socket', scheme: url.protocol }); socket.close(); }
  });
  return blocked;
}
