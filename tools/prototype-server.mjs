import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const sourceHash = '5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095';
const csp = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const ownRoutes = new Map([
  ['/prototype/prototype.mjs', ['web/prototype.mjs', 'text/javascript; charset=utf-8']],
  ['/prototype/synthetic-scene.mjs', ['web/synthetic-scene.mjs', 'text/javascript; charset=utf-8']],
  ['/prototype/asset-bridge.mjs', ['web/asset-bridge.mjs', 'text/javascript; charset=utf-8']],
  ['/prototype/network-fence.js', ['web/network-fence.js', 'text/javascript; charset=utf-8']],
  ['/prototype/prototype.css', ['web/prototype.css', 'text/css; charset=utf-8']],
  ['/prototype/pkg/slither_client.js', ['dist/web/slither_client.js', 'text/javascript; charset=utf-8']],
  ['/prototype/pkg/slither_client_bg.wasm', ['dist/web/slither_client_bg.wasm', 'application/wasm']],
]);

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function containedFile(root, name) {
  const resolved = await realpath(path.join(root, name));
  if (!within(root, resolved) || !(await stat(resolved)).isFile()) {
    throw new Error('Reference resource is outside its permitted root or is not a file');
  }
  return resolved;
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runtimeHtml(html) {
  if (!/<head\b[^>]*>/i.test(html) || !/<\/body\s*>/i.test(html)) {
    throw new Error('Reference HTML requires head and body elements');
  }
  // The external snapshot is trusted HTML. Keep its inline helpers, but only the
  // fixed pinned client script may survive as an external script resource.
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attributes) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    if (!src) return whole;
    return (src[1] ?? src[2] ?? src[3]) === '/client.js'
      ? '<script src="/reference/client.js"></script>' : '';
  });
  html = html.replace(/<head\b[^>]*>/i, '$&\n<script src="/prototype/network-fence.js"></script>');
  return html.replace(/<\/body\s*>/i,
    '<link rel="stylesheet" href="/prototype/prototype.css">\n<script type="module" src="/prototype/prototype.mjs"></script>\n$&');
}

/** Read an external snapshot without starting a server. Hash override is for synthetic tests only. */
export async function loadReference(referenceRoot, { projectRoot = projectDirectory, expectedSourceHash = sourceHash } = {}) {
  if (typeof referenceRoot !== 'string' || referenceRoot.length === 0) {
    throw new Error('--reference-root is required');
  }
  const root = await realpath(referenceRoot);
  projectRoot = await realpath(projectRoot);
  if (!(await stat(root)).isDirectory() || within(projectRoot, root) || within(root, projectRoot)) {
    throw new Error('Reference root must be separate from the project');
  }
  const client = await readFile(await containedFile(root, 'raw/game1107249518.js'));
  if (hash(client) !== expectedSourceHash) throw new Error('Reference client hash mismatch');
  const html = runtimeHtml(await readFile(await containedFile(root, 'site/index.html'), 'utf8'));
  const manifest = JSON.parse(await readFile(await containedFile(root, 'site/assets-manifest.json'), 'utf8'));
  if (manifest.schema !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Unsupported reference asset manifest');
  }
  const assets = new Map();
  for (const [name, entry] of Object.entries(manifest.files)) {
    if (!/^(?:s|s2)\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(?:png|jpg|jpeg|gif|webp)$/.test(name)
      || !entry || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
      throw new Error('Unsupported reference asset entry');
    }
    await containedFile(root, `site/${name}`);
    const asset = { name, sha256: entry.sha256, bytes: entry.bytes };
    assets.set(`/${name}`, asset);
    assets.set(`/reference/assets/${name}`, asset);
  }
  return { root, projectRoot, client, html, assets };
}

/** Construct an unbound HTTP server; callers must bind only to 127.0.0.1. */
export function createPrototypeServer(reference) {
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    function send(status, type, bytes) {
      response.writeHead(status, { 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    }
    const reject = (status, message) => send(status, 'text/plain; charset=utf-8', message);
    const address = server.address();
    if (!address || address.address !== '127.0.0.1' || request.headers.host !== `127.0.0.1:${address.port}`) {
      reject(403, 'Loopback host required');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      reject(405, 'Method not allowed');
      return;
    }
    const pathname = (request.url ?? '').split('?')[0];
    if (!pathname.startsWith('/') || pathname.startsWith('//') || /[%\\:#\u0000-\u0020]/.test(pathname)
      || pathname.split('/').some(part => part === '.' || part === '..')) {
      reject(400, 'Invalid resource path');
      return;
    }
    try {
      if (pathname === '/reference/') {
        send(200, 'text/html; charset=utf-8', reference.html);
      } else if (pathname === '/reference/client.js') {
        send(200, 'text/javascript; charset=utf-8', reference.client);
      } else if (pathname === '/reference/empty-directory') {
        send(200, 'text/plain; charset=utf-8', '');
      } else if (ownRoutes.has(pathname)) {
        const [name, type] = ownRoutes.get(pathname);
        send(200, type, await readFile(await containedFile(reference.projectRoot, name)));
      } else if (reference.assets.has(pathname)) {
        const asset = reference.assets.get(pathname);
        const bytes = await readFile(await containedFile(reference.root, `site/${asset.name}`));
        if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256) {
          reject(503, 'Reference asset integrity check failed');
          return;
        }
        const extension = path.extname(asset.name).slice(1);
        send(200, `image/${extension === 'jpg' ? 'jpeg' : extension}`, bytes);
      } else {
        reject(404, 'Resource not found');
      }
    } catch {
      reject(503, 'Reference resource unavailable');
    }
  });
  return server;
}

function argumentsForCli(args) {
  let referenceRoot;
  let port = 18882;
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--reference-root', '--port'].includes(flag) || seen.has(flag) || !value || value.startsWith('--')) {
      throw new Error('Usage: node tools/prototype-server.mjs --reference-root <external-directory> [--port <0..65535>]');
    }
    seen.add(flag);
    if (flag === '--reference-root') referenceRoot = value;
    else {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('Invalid loopback port');
      port = Number(value);
    }
  }
  if (!referenceRoot) throw new Error('--reference-root is required');
  return { referenceRoot, port };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { referenceRoot, port } = argumentsForCli(process.argv.slice(2));
    const server = createPrototypeServer(await loadReference(referenceRoot));
    server.on('error', () => {
      console.error('Prototype server could not bind loopback');
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Prototype reference: http://127.0.0.1:${server.address().port}/reference/`);
    });
  } catch (error) {
    console.error(error.code ? 'Reference snapshot unavailable' : error.message);
    process.exitCode = 1;
  }
}
