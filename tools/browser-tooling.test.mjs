import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { root, freshOutput, within, syntheticServer, temporaryProfile, json, fence } from './browser-common.mjs';
import { summarizeTrace } from './browser-trace.mjs';
import { syntheticPeer } from './browser-session-fixture.mjs';
import { WebSocket } from 'ws';
import { once } from 'node:events';

// Authored synthetic infrastructure checks. No browser process or external source.
test('output directories are create-only and must stay outside the checkout', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'browser-tooling-test-'));
  try {
    await assert.rejects(freshOutput());
    await assert.rejects(freshOutput(path.join(root, 'browser-output-forbidden')), /outside/);
    const output = await freshOutput(path.join(temp, 'run'));
    await writeFile(path.join(output, 'sentinel'), 'preserved');
    await assert.rejects(freshOutput(output), { code: 'EEXIST' });
    assert.equal(await readFile(path.join(output, 'sentinel'), 'utf8'), 'preserved');
    await json(path.join(output, 'receipt.json'), { saved: true });
    await assert.rejects(json(path.join(output, 'receipt.json'), {}), { code: 'EEXIST' });
    assert.equal(within(root, path.resolve(root, '..', 'elsewhere')), false);
    assert.equal(within(root, path.join(root, 'tools')), true);
  } finally {
    const actual = await realpath(temp);
    assert.ok(within(await realpath(os.tmpdir()), actual));
    assert.match(path.basename(actual), /^browser-tooling-test-/);
    await rm(actual, { recursive: true });
  }
});

test('owned temporary profile cleanup is confined and removes only its profile', async () => {
  const profile = await temporaryProfile();
  await writeFile(path.join(profile.path, 'synthetic.txt'), 'synthetic');
  await profile.remove();
  await assert.rejects(readFile(path.join(profile.path, 'synthetic.txt')), { code: 'ENOENT' });
});

test('loopback server admits exact authored routes and rejects host/path/method drift', async () => {
  const app = await syntheticServer();
  try {
    const response = await fetch(app.origin);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Authored synthetic/);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    for (const resource of ['/anything', '/fixture.mjs?extra', '/web/stock-session.mjs', '/pkg/source.map']) {
      assert.equal((await fetch(app.origin + resource)).status, 404);
    }
    assert.equal((await fetch(app.origin, { method: 'POST' })).status, 405);
    const rejected = await new Promise((resolve, reject) => {
      const req = http.get(app.origin, { headers: { Host: 'localhost' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
    });
    assert.equal(rejected, 403);
  } finally { await app.close(); }
  await assert.rejects(fetch(app.origin));
});

test('GPU trace verification uses real event categories, raster work and presentation evidence', () => {
  const noGpu = summarizeTrace([{ name: 'GPU mentioned in a label', cat: 'test', pid: 1, tid: 2 }]);
  assert.equal(noGpu.hasGpuRasterPresentation, false);
  const actual = summarizeTrace([
    { ph: 'M', name: 'thread_name', pid: 7, tid: 9, args: { name: 'CrGpuMain' } },
    { ph: 'M', name: 'process_name', pid: 7, tid: 9, args: { name: 'GPU Process' } },
    { name: 'RasterTask', cat: 'gpu,cc', pid: 7, tid: 9 },
    { name: 'SkiaRenderer::SwapBuffers', cat: 'viz', pid: 7, tid: 9 },
  ]);
  assert.equal(actual.hasGpuRasterPresentation, true);
  assert.equal(actual.gpuEvents, 1); assert.equal(actual.rasterEvents, 1);
  assert.deepEqual(actual.relevantTracks, [{ id: '7:9', thread: 'CrGpuMain', process: 'GPU Process' }]);
});

test('page capability fence admits only selected local HTTP and selected /slither socket', async () => {
  let httpRoute, socketRoute;
  const context = { async route(_pattern, fn) { httpRoute = fn; }, async routeWebSocket(_pattern, fn) { socketRoute = fn; } };
  const blocked = await fence(context, 'http://127.0.0.1:12345', { socketOrigin: 'ws://127.0.0.1:12346' });
  for (const [url, accepted] of [['http://127.0.0.1:12345/fixture.mjs', true], ['https://example.test/', false], ['http://user@127.0.0.1:12345/', false]]) {
    let outcome;
    await httpRoute({ request: () => ({ url: () => url }), continue: () => { outcome = true; }, abort: () => { outcome = false; } });
    assert.equal(outcome, accepted);
  }
  for (const [url, accepted] of [['ws://127.0.0.1:12346/slither', true], ['ws://127.0.0.1:12346/other', false], ['ws://example.test/slither', false]]) {
    let outcome;
    socketRoute({ url: () => url, connectToServer: () => { outcome = true; }, close: () => { outcome = false; } });
    assert.equal(outcome, accepted);
  }
  assert.equal(blocked.length, 4);
});

test('synthetic local peer performs authored challenge/scene ingress and rejects a nonzero profile', async () => {
  const peer = await syntheticPeer();
  const socket = new WebSocket(`ws://127.0.0.1:${peer.port}/slither`, { origin: 'http://127.0.0.1:12345' });
  try {
    await once(socket, 'open');
    const challenge = once(socket, 'message'); socket.send(Uint8Array.of(99, 0));
    assert.equal((await challenge)[0][0], 54);
    const scene = once(socket, 'message'); socket.send(Uint8Array.from([115, 30, ...new Array(22).fill(0)]));
    assert.ok((await scene)[0].length > 100); assert.equal(peer.receipt.logins, 1);
    const second = new WebSocket(`ws://127.0.0.1:${peer.port}/slither`, { origin: 'http://127.0.0.1:12345' });
    await once(second, 'open');
    const next = once(second, 'message'); second.send(Uint8Array.of(99, 0)); await next;
    const closed = once(second, 'close'); second.send(Uint8Array.from([115, 30, 1, ...new Array(21).fill(0)])); await closed;
    assert.equal(peer.receipt.logins, 1); assert.deepEqual(peer.receipt.errors, ['Nonzero local fixture profile rejected']);
  } finally { socket.terminate(); await peer.close(); }
});
