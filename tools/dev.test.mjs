import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { devArguments, freePort } from './dev.mjs';

test('developer command accepts a simulator path without shell interpretation', () => {
  assert.deepEqual(devArguments(['web', '--simulator', 'some path/sim.exe']), { mode: 'web', simulator: 'some path/sim.exe' });
  assert.equal(devArguments(['desktop']).mode, 'desktop');
  for (const args of [[], ['other'], ['web', '--simulator'], ['web', '--port', '80'], ['desktop', '--simulator', '']]) {
    assert.throws(() => devArguments(args), /Usage/);
  }
});

test('developer port is loopback-bindable and avoids owner ports', async () => {
  const port = await freePort();
  assert(![8766, 18884, 18885].includes(port));
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
});
