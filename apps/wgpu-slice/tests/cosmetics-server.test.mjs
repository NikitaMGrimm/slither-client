// ORIGINAL SYNTHETIC external image placeholder; no official bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { get } from 'node:http';
import { createServer, readImage, IMAGE_LIMIT } from '../dev-server.mjs';
test('external cosmetics are served only when configured; paths and Host stay bounded', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-wgpu-cosmetics-'));
  const servers = [];
  try {
    await mkdir(path.join(root, 's')); await writeFile(path.join(root, 's/a_cap.png'), 'synthetic');
    const snippet = 'pkg/snippets/slither-client-0000000000000000/web/stock-hud-contract.mjs';
    await mkdir(path.dirname(path.join(root, snippet)), { recursive: true });
    await writeFile(path.join(root, snippet), 'export const synthetic = true;');
    for (const configured of [false, true]) {
      const server = createServer({ webDir: root, ...(configured ? { cosmeticsDir: root, accessory: 30 } : {}) }); servers.push(server);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      const config = await (await fetch(`${base}/config.json`)).json();
      assert.equal(config.cosmeticsBaseUrl, configured ? '/cosmetics/' : null);
      const image = await fetch(`${base}/cosmetics/s/a_cap.png`);
      assert.equal(image.status, configured ? 200 : 404);
      if (configured) assert.equal(await image.text(), 'synthetic');
      assert.equal((await fetch(`${base}/cosmetics/s/a%2Fcap.png`)).status, 400);
      const wrongHost = await new Promise((resolve, reject) => get(`${base}/cosmetics/s/a_cap.png`, { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
      assert.equal(wrongHost, 403);
      assert.equal((await fetch(`${base}/Cargo.toml`)).status, 404);
      assert.equal((await fetch(`${base}/${snippet}`)).status, 200);
    }
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await rm(root, { recursive: true, force: true });
  }
});

test('image reader caps allocation and reads at the limit plus one sentinel byte', async () => {
  let read = 0;
  await assert.rejects(readImage({ async read(buffer, offset, length) {
    assert.equal(buffer.length, IMAGE_LIMIT + 1);
    assert.ok(offset + length <= IMAGE_LIMIT + 1);
    const bytesRead = Math.min(length, 65536);
    read += bytesRead;
    return { bytesRead };
  } }), /Image budget/);
  assert.equal(read, IMAGE_LIMIT + 1);
});

test('oversized external images reject GET and HEAD through the bounded handle reader', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'synthetic-wgpu-large-image-'));
  const server = createServer({ cosmeticsDir: root });
  try {
    await mkdir(path.join(root, 's'));
    const file = await open(path.join(root, 's/a_cap.png'), 'w');
    try { await file.truncate(IMAGE_LIMIT * 2); } finally { await file.close(); }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/cosmetics/s/a_cap.png`, { method });
      assert.equal(response.status, 404);
      assert.equal(await response.text(), method === 'HEAD' ? '' : 'Unavailable');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
