// Local development only. External cosmetic bytes are never copied into web-dist.
import http from 'node:http';
import path from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const app = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg' };
export function createServer({ webDir = path.join(app, 'web-dist'), cosmeticsDir, accessory = -1, simulatorPort } = {}) {
  if (!Number.isInteger(accessory) || accessory < -1 || accessory > 31) throw new Error('Accessory must be -1 or 0..31');
  if (simulatorPort !== undefined && (!Number.isInteger(simulatorPort) || simulatorPort < 1 || simulatorPort > 65535)) throw new Error('Invalid simulator port');
  const server = http.createServer(async (req, res) => {
    const send = (status, type, bytes) => { res.writeHead(status, { 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : bytes); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'${simulatorPort ? ` ws://127.0.0.1:${simulatorPort}` : ''}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if (req.headers.host !== `127.0.0.1:${server.address()?.port}`) { send(403, 'text/plain', 'Loopback host required'); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { send(405, 'text/plain', 'GET or HEAD required'); return; }
    const resource = (req.url ?? '').split('?')[0];
    if (!/^\/[a-zA-Z0-9_./-]*$/.test(resource) || resource.split('/').some(p => p === '..' || p === '.') || resource.startsWith('//')) { send(400, 'text/plain', 'Invalid path'); return; }
    if (resource === '/config.json') {
      send(200, 'application/json', JSON.stringify({ cosmeticsBaseUrl: cosmeticsDir ? '/cosmetics/' : null, accessory, simulatorUrl: simulatorPort ? `ws://127.0.0.1:${simulatorPort}/slither` : null })); return;
    }
    const cosmetic = resource.startsWith('/cosmetics/');
    const relative = cosmetic ? resource.slice('/cosmetics/'.length) : resource === '/' ? 'index.html' : resource.slice(1);
    if (cosmetic && (!cosmeticsDir || !/^s2?\/[a-z0-9_]+\.(png|jpg)$/.test(relative))) { send(404, 'text/plain', 'Unavailable'); return; }
    if (!cosmetic && !/^(index\.html|diagnostic\.html|entry\.mjs|local\.mjs|local-host\.mjs|pkg\/slither_wgpu_slice(?:_bg\.wasm|\.js)|pkg\/snippets\/slither-client-[a-f0-9]{16}\/web\/stock-hud-contract\.mjs)$/.test(relative)) { send(404, 'text/plain', 'Unavailable'); return; }
    try {
      const root = await realpath(cosmetic ? cosmeticsDir : webDir);
      const file = await realpath(path.join(root, relative));
      const escaped = path.relative(root, file);
      if (escaped === '..' || escaped.startsWith(`..${path.sep}`) || path.isAbsolute(escaped)) throw new Error('Escaped root');
      const bytes = await readFile(file);
      if (cosmetic && bytes.length > 4 * 1024 * 1024) throw new Error('Image budget');
      send(200, types[path.extname(file)] ?? 'application/octet-stream', bytes);
    } catch { send(404, 'text/plain', 'Unavailable'); }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {}; let port = 0;
    const flags = { '--web-dir': 'webDir', '--cosmetics-dir': 'cosmeticsDir', '--accessory': 'accessory', '--simulator-port': 'simulatorPort' };
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) {
      if (args[i + 1] === undefined) throw new Error('Flag value required');
      if (args[i] === '--port') port = Number(args[i + 1]);
      else if (flags[args[i]]) options[flags[args[i]]] = ['--accessory', '--simulator-port'].includes(args[i]) ? Number(args[i + 1]) : args[i + 1];
      else throw new Error(`Unknown flag ${args[i]}`);
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const server = createServer(options);
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`wgpu: http://127.0.0.1:${server.address().port}/`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
