import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { test } from 'node:test';
import { devArguments, develop, freePort } from './dev.mjs';

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

test('desktop launcher hides only the simulator and cleans up both owned processes', async t => {
  const signals = ['SIGINT', 'SIGTERM'];
  const before = new Map(signals.map(signal => [signal, new Set(process.listeners(signal))]));
  const calls = [];
  t.after(() => {
    for (const signal of signals) for (const listener of process.listeners(signal)) {
      if (!before.get(signal).has(listener)) process.removeListener(signal, listener);
    }
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(childProcess, 'execFileSync', () => JSON.stringify({
    reason: 'compiler-artifact', target: { name: 'slither-wgpu-desktop' }, executable: 'synthetic-desktop.exe',
  }));
  t.mock.method(childProcess, 'spawn', (command, args, options) => {
    const child = Object.assign(new EventEmitter(), { pid: calls.length + 1, exitCode: null, signalCode: null,
      kills: 0, kill() { this.kills++; this.exitCode = 0; this.emit('exit', 0); } });
    calls.push({ command, args, options, child });
    return child;
  });
  t.mock.method(net, 'connect', () => {
    const socket = Object.assign(new EventEmitter(), { destroy() {}, setTimeout() {} });
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  });
  syncBuiltinESMExports();
  await develop({ mode: 'desktop', simulator: 'synthetic-simulator.exe' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'synthetic-simulator.exe');
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[1].command, 'synthetic-desktop.exe');
  assert.equal(calls[1].options.windowsHide, false);
  const stop = process.listeners('SIGINT').find(listener => !before.get('SIGINT').has(listener));
  assert.equal(typeof stop, 'function');
  stop();
  assert.deepEqual(calls.map(call => call.child.kills), [1, 1]);
});
