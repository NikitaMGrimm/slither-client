import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWeb } from './build-web.mjs';
import { createSceneServer } from './scene-server.mjs';

export function devArguments(args) {
  const [mode, ...options] = args;
  if (!['desktop', 'web'].includes(mode) || options.length && (options.length !== 2 || options[0] !== '--simulator' || !options[1])) {
    throw new Error('Usage: node tools/dev.mjs <desktop|web> [--simulator <executable>]');
  }
  return { mode, simulator: options[1] ?? process.env.SLITHER_SIM ?? 'slither-sim' };
}

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return [8766, 18884, 18885].includes(port) ? freePort() : port;
}

async function ready(port, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) throw new Error('Local simulator exited before listening');
    const connected = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port });
      const finish = ok => { socket.destroy(); resolve(ok); };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(250, () => finish(false));
    });
    if (connected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Local simulator did not listen within 10 seconds');
}

export async function develop({ mode, simulator }) {
  let executable;
  if (mode === 'web') buildWeb();
  else {
    const output = execFileSync('cargo', ['build', '--manifest-path', 'apps/wgpu-slice/Cargo.toml', '--locked',
      '--bin', 'slither-wgpu-desktop', '--message-format=json-render-diagnostics'],
    { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024 });
    executable = output.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line))
      .find(message => message.reason === 'compiler-artifact' && message.target.name === 'slither-wgpu-desktop' && message.executable)?.executable;
    if (!executable) throw new Error('Cargo did not report a desktop executable');
  }
  const port = await freePort();
  const children = new Set();
  let server;
  let stopping = false;
  const stop = () => {
    stopping = true;
    server?.closeAllConnections();
    server?.close();
    for (const child of children) child.kill();
  };
  const launch = (command, args, windowsHide = false) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide });
    children.add(child);
    child.once('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
    child.once('exit', code => {
      children.delete(child);
      if (!stopping) { process.exitCode = code ?? 1; stop(); }
    });
    return child;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const host = launch(simulator, ['host', '--bind', `127.0.0.1:${port}`], true);
    await ready(port, host);
    if (stopping) return;
    console.log(`Local simulator: ws://127.0.0.1:${port}/slither`);
    if (mode === 'desktop') {
      launch(executable, ['--endpoint', `ws://127.0.0.1:${port}/slither`]);
      console.log('Enter: Play. Escape: Stop. Close the window or press Ctrl+C to exit.');
    } else {
      server = createSceneServer({ simulatorPort: port });
      server.on('error', error => { console.error(error.message); process.exitCode = 1; stop(); });
      server.listen(0, '127.0.0.1', () => console.log(`Canvas client: http://127.0.0.1:${server.address().port}/ (Ctrl+C to stop)`));
    }
  } catch (error) {
    stop();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = devArguments(process.argv.slice(2));
    process.chdir(fileURLToPath(new URL('..', import.meta.url)));
    await develop(options);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
