// ORIGINAL SYNTHETIC external image placeholder; no official bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { get } from 'node:http';
import { createServer } from '../dev-server.mjs';
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
