import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';
import { createPrototypeServer, loadReference } from './prototype-server.mjs';

// Every HTML, client, image, and DOM fixture here is synthetic, never an official capture.
const client = Buffer.from('// SYNTHETIC client fixture; no official implementation\n');
const image = Buffer.from('SYNTHETIC image placeholder; deliberately not image bytes');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const scriptPath = fileURLToPath(new URL('./prototype-server.mjs', import.meta.url));

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'slither-prototype-synthetic-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(base)), path.resolve(os.tmpdir()));
    assert(path.basename(base).startsWith('slither-prototype-synthetic-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  const root = path.join(base, 'external');
  const project = path.join(base, 'project');
  for (const directory of ['raw', 'site/s', 'site/s2']) await fs.mkdir(path.join(root, directory), { recursive: true });
  for (const directory of ['web', 'dist/web']) await fs.mkdir(path.join(project, directory), { recursive: true });
  await fs.writeFile(path.join(root, 'raw/game1107249518.js'), client);
  await fs.writeFile(path.join(root, 'site/index.html'), `<!doctype html><html><head>
    <script src="/config.js"></script><script src="/bootstrap.js"></script>
    <script async src="https://synthetic.invalid/tracker.js"></script>
    <script>/* SYNTHETIC inline helper */ window.syntheticHelper = true;</script>
    </head><body><img src="/s/synthetic.png"><script src='/client.js'></script>
    <script src="/s/library.js"></script><script src="/connection.js"></script></body></html>`);
  const manifest = { schema: 1, files: { 's/synthetic.png': { bytes: image.length, sha256: digest(image) } } };
  await fs.writeFile(path.join(root, 'site/assets-manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(root, 'site/s/synthetic.png'), image);
  await fs.writeFile(path.join(root, 'site/s/unlisted.png'), 'SYNTHETIC unlisted');
  for (const name of ['prototype.mjs', 'synthetic-scene.mjs', 'asset-bridge.mjs', 'network-fence.js', 'prototype.css']) {
    await fs.writeFile(path.join(project, 'web', name), `/* SYNTHETIC ${name} */`);
  }
  for (const name of ['slither_client.js', 'slither_client_bg.wasm']) {
    await fs.writeFile(path.join(project, 'dist/web', name), `SYNTHETIC ${name}`);
  }
  const options = { projectRoot: project, expectedSourceHash: digest(client) };
  return { base, root, project, manifest, options };
}

async function running(t, data) {
  const server = createPrototypeServer(await loadReference(data.root, data.options));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(server.listening, false);
  });
  const port = server.address().port;
  function request(resource, { method = 'GET', host = `127.0.0.1:${port}` } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: resource, method, headers: { Host: host }, agent: false }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks), text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
  }
  return { server, request };
}

test('CLI requires an explicit root, rejects unknown/hash options and invalid ports without listening', () => {
  for (const args of [[], ['--port', '0'], ['--reference-root', 'synthetic', '--expected-source-hash', digest(client)], ['--reference-root', 'synthetic', '--port', '-1']]) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /http:\/\//);
    assert.doesNotMatch(result.stderr, /[A-Z]:\\|at .*\.mjs:/);
  }
});

test('loader requires an external canonical root and pinned source hash', async t => {
  const data = await fixture(t);
  await assert.rejects(loadReference(undefined), /required/);
  await assert.rejects(loadReference(data.project, data.options), /separate/);
  await assert.rejects(loadReference(data.base, data.options), /separate/);
  await assert.rejects(loadReference(data.root, { projectRoot: data.project }), /hash mismatch/);
  const reference = await loadReference(data.root, data.options);
  assert.equal(reference.root, await fs.realpath(data.root));
  assert.deepEqual(reference.client, client);
});

test('transforms HTML, serves exact routes and applies restrictive CSP', async t => {
  const { request } = await running(t, await fixture(t));
  const response = await request('/reference/');
  assert.equal(response.status, 200);
  const scripts = [...response.text.matchAll(/<script\b[^>]*>/g)].map(match => match[0]);
  assert.equal(scripts[0], '<script src="/prototype/network-fence.js">');
  assert.match(response.text, /SYNTHETIC inline helper/);
  assert.match(response.text, /src="\/reference\/client.js"/);
  assert.match(response.text, /type="module" src="\/prototype\/prototype.mjs"/);
  assert.match(response.text, /href="\/prototype\/prototype.css"/);
  assert.doesNotMatch(response.text, /config\.js|bootstrap\.js|connection\.js|tracker\.js|library\.js/);
  for (const directive of ["default-src 'none'", "connect-src 'self'", "frame-src 'none'", "worker-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert(response.headers['content-security-policy'].includes(directive));
  }
  assert.equal((await request('/reference/client.js')).text, client.toString());
  for (const resource of ['/s/synthetic.png', '/reference/assets/s/synthetic.png']) {
    const result = await request(resource);
    assert.equal(result.status, 200);
    assert.deepEqual(result.bytes, image);
    assert.equal(result.headers['content-type'], 'image/png');
  }
  for (const resource of ['/prototype/prototype.mjs', '/prototype/asset-bridge.mjs', '/prototype/network-fence.js', '/prototype/prototype.css', '/prototype/pkg/slither_client.js', '/prototype/pkg/slither_client_bg.wasm']) {
    assert.equal((await request(resource)).status, 200, resource);
  }
  assert.equal((await request('/prototype/pkg/slither_client_bg.wasm')).headers['content-type'], 'application/wasm');
  const empty = await request('/reference/empty-directory');
  assert.equal(empty.status, 200);
  assert.equal(empty.text, '');
  assert.equal((await request('/reference/', { method: 'HEAD' })).text, '');
});

test('rejects foreign hosts, writes, unlisted files and raw traversal without leaking paths', async t => {
  const data = await fixture(t);
  const { request } = await running(t, data);
  for (const host of ['localhost', 'synthetic.invalid', '127.0.0.1:1', '127.0.0.1']) {
    assert.equal((await request('/reference/', { host })).status, 403);
  }
  assert.equal((await request('/reference/', { method: 'POST' })).status, 405);
  for (const resource of ['/', '/reference', '/s/', '/s/unlisted.png', '/reference/assets/s/unlisted.png', '/site/index.html', '/raw/game1107249518.js', '/prototype/pkg/anything.js']) {
    assert.equal((await request(resource)).status, 404, resource);
  }
  for (const resource of ['/../raw/game1107249518.js', '/s/./synthetic.png', '/%2e%2e/raw/file', '/s%2fsynthetic.png', '/s%5csynthetic.png', '/s/%252e%252e/file', '/C:/Windows/file', '//server/share', '/s\\synthetic.png']) {
    const response = await request(resource);
    assert.equal(response.status, 400, resource);
    assert(!response.text.includes(data.base));
  }
});

test('checks image integrity before serving and never exposes new files', async t => {
  const data = await fixture(t);
  const { request } = await running(t, data);
  await fs.writeFile(path.join(data.root, 'site/s/synthetic.png'), Buffer.alloc(image.length, 65));
  const response = await request('/s/synthetic.png');
  assert.equal(response.status, 503);
  assert.equal(response.text, 'Reference asset integrity check failed');
  await fs.writeFile(path.join(data.root, 'site/s/new.png'), image);
  assert.equal((await request('/s/new.png')).status, 404);
});

test('rejects manifest path escapes and root/file junction escapes', async t => {
  const data = await fixture(t);
  const manifestFile = path.join(data.root, 'site/assets-manifest.json');
  await fs.writeFile(manifestFile, JSON.stringify({ schema: 1, files: { '../escaped.png': { bytes: image.length, sha256: digest(image) } } }));
  await assert.rejects(loadReference(data.root, data.options), /asset entry/);
  await fs.writeFile(manifestFile, JSON.stringify(data.manifest));
  const outside = path.join(data.base, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'synthetic.png'), image);
  await fs.rename(path.join(data.root, 'site/s'), path.join(data.root, 'site/original-s'));
  await fs.symlink(outside, path.join(data.root, 'site/s'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(loadReference(data.root, data.options), /outside/);
  const alias = path.join(data.base, 'project-alias');
  await fs.symlink(data.project, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(loadReference(alias, data.options), /separate/);
});

test('rechecks asset and own-file junction boundaries on every request', async t => {
  const data = await fixture(t);
  const { request } = await running(t, data);
  const outside = path.join(data.base, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'synthetic.png'), image);
  await fs.writeFile(path.join(outside, 'prototype.mjs'), 'SYNTHETIC private file');
  for (const directory of [path.join(data.root, 'site/s'), path.join(data.project, 'web')]) {
    await fs.rename(directory, `${directory}-preserved`);
    await fs.symlink(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  }
  for (const resource of ['/s/synthetic.png', '/prototype/prototype.mjs']) {
    const response = await request(resource);
    assert.equal(response.status, 503);
    assert.equal(response.text, 'Reference resource unavailable');
    assert(!response.text.includes(data.base));
  }
});

async function syntheticFence() {
  const observed = { nativeSockets: 0, frames: 0, intervals: 0, timeouts: 0, opens: [] };
  class HTMLImageElement {
    get src() { return this.syntheticSource ?? ''; }
    set src(value) { this.syntheticSource = value; }
  }
  class XMLHttpRequest {
    open(...args) { observed.opens.push(args); return 'SYNTHETIC native open result'; }
  }
  const scope = {
    URL, DOMException, HTMLImageElement, XMLHttpRequest,
    location: { href: 'http://127.0.0.1:18882/reference/', origin: 'http://127.0.0.1:18882' },
    WebSocket: function () { observed.nativeSockets += 1; },
    requestAnimationFrame() { observed.frames += 1; },
    setInterval() { observed.intervals += 1; },
    setTimeout() { observed.timeouts += 1; return 17; },
  };
  scope.window = scope;
  const originalTimeout = scope.setTimeout;
  const source = await fs.readFile(new URL('../web/network-fence.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, scope, { timeout: 1000 });
  return { scope, observed, originalTimeout };
}

test('fence never delegates sockets and suppresses reference scheduling while retaining setTimeout', async () => {
  const { scope, observed, originalTimeout } = await syntheticFence();
  for (const resource of ['ws://synthetic.invalid/socket', 'wss://synthetic.invalid/socket']) {
    assert.throws(() => new scope.WebSocket(resource), { name: 'SecurityError' });
  }
  assert.equal(scope.slitherPrototypeFence.blockedSocketCount, 2);
  assert.equal(scope.slitherPrototypeFence.blockedSockets.length, 2);
  assert.equal(observed.nativeSockets, 0);
  assert.equal(scope.requestAnimationFrame(() => assert.fail('frame callback')), 0);
  assert.equal(scope.setInterval(() => assert.fail('interval callback'), 1), 0);
  assert.equal(observed.frames, 0);
  assert.equal(observed.intervals, 0);
  assert.equal(scope.setTimeout, originalTimeout);
  assert.equal(scope.setTimeout(() => {}, 1), 17);
  assert.equal(observed.timeouts, 1);
  assert.doesNotThrow(() => JSON.stringify(scope.slitherPrototypeFence));
  assert(Object.values(scope.slitherPrototypeFence).every(value => typeof value !== 'function'));
  assert.throws(() => Object.defineProperty(scope, 'WebSocket', { value: function () {} }), TypeError);
});

test('fence rewrites only fixed official image paths and directory XHR URLs', async () => {
  const { scope, observed } = await syntheticFence();
  const element = new scope.HTMLImageElement();
  for (const resource of ['https://slither.io/s/synthetic.png', 'http://www.slither.io/s2/synthetic.jpg?x=1', '//slither.io/s/synthetic.png']) {
    element.src = resource;
    assert.match(element.src, /^\/reference\/assets\/s2?\//);
  }
  for (const resource of ['/s/synthetic.png', 'data:image/png,SYNTHETIC', 'https://synthetic.invalid/s/synthetic.png', 'https://slither.io/other/synthetic.png']) {
    element.src = resource;
    assert.equal(element.src, resource);
  }
  const xhr = new scope.XMLHttpRequest();
  for (const resource of ['http://slither.io/i123.txt', 'https://www.slither.io/i9.txt?x=1', '/i42.txt']) {
    assert.equal(xhr.open('GET', resource, true, 'synthetic-user'), 'SYNTHETIC native open result');
    assert.deepEqual(observed.opens.at(-1), ['GET', '/reference/empty-directory', true, 'synthetic-user']);
  }
  for (const resource of ['/prototype/pkg/slither_client_bg.wasm', 'https://synthetic.invalid/i9.txt', 'https://slither.io/other.txt']) {
    xhr.open('GET', resource);
    assert.equal(observed.opens.at(-1)[1], resource);
  }
  assert.equal(scope.slitherPrototypeFence.rewrittenImages, 3);
  assert.equal(scope.slitherPrototypeFence.rewrittenDirectories, 3);
});
