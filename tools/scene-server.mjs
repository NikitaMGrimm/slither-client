import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const routes = new Map([
  ['/', ['web/game.html', 'text/html; charset=utf-8']],
  ['/anchors', ['web/scene.html', 'text/html; charset=utf-8']],
  ['/animated', ['web/animated.html', 'text/html; charset=utf-8']],
  ['/benchmark', ['web/benchmark.html', 'text/html; charset=utf-8']],
  ['/scene/scene.css', ['web/scene.css', 'text/css; charset=utf-8']],
  ...['scene', 'authored-source-recipes', 'animated', 'desktop-layout', 'synthetic-scene', 'synthetic-body', 'synthetic-food', 'synthetic-prey', 'skin-provider', 'loopback-session', 'dense-scene', 'benchmark'].map(name => [`/scene/${name}.mjs`, [`web/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/scene/pkg/slither_client.js', ['dist/web/slither_client.js', 'text/javascript; charset=utf-8']],
  ['/scene/pkg/slither_client_bg.wasm', ['dist/web/slither_client_bg.wasm', 'application/wasm']],
  ['/game/host.css', ['extension/game-host.css', 'text/css; charset=utf-8']],
  ['/assets/logo.svg', ['assets/logo.svg', 'image/svg+xml']],
  ...[['bootstrap', 'game-bootstrap'], ['runtime', 'game-runtime'],
    ['owned-hud-ui', 'game-owned-hud-ui'], ['owned-play-ui', 'game-owned-play-ui'],
    ['owned-appearance-ui', 'game-owned-appearance-ui'],
    ['owned-announcement-ui', 'game-owned-announcement-ui'],
    ['start-page-layout', 'start-page-layout'],
    ['owned-leaderboard-ui', 'game-owned-leaderboard-ui'], ['owned-minimap-ui', 'game-owned-minimap-ui'],
    ['owned-end-screen-ui', 'game-owned-end-screen-ui']]
    .map(([route, name]) => [`/game/${route}.mjs`, [`extension/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ...['stock-client', 'stock-skin-provider', 'stock-skin-rules', 'stock-accessory-selection', 'stock-cached-accessory', 'stock-accessory-load', 'stock-host-snapshot',
    'stock-food-provider', 'stock-prey-provider', 'stock-asset-sources', 'skin-provider',
    'desktop-layout', 'client-input', 'stock-gameplay', 'stock-session', 'stock-hud-contract',
    'stock-hud-state', 'stock-hud-view', 'stock-hud-dom', 'handshake-session', 'stock-live-profile',
    'stock-leaderboard-state', 'stock-leaderboard-view', 'local-game-host', 'client-asset-map', 'authored-source-recipes',
    'synthetic-body', 'synthetic-food', 'synthetic-prey', 'loopback-session']
    .map(name => [`/game/${name}.mjs`, [`web/${name}.mjs`, 'text/javascript; charset=utf-8']]),
  ['/game/pkg/slither_client.js', ['dist/web/slither_client.js', 'text/javascript; charset=utf-8']],
  ['/game/pkg/slither_client_bg.wasm', ['dist/web/slither_client_bg.wasm', 'application/wasm']],
]);

function portNumber(value, allowZero = false) {
  if (!/^(0|[1-9][0-9]{0,4})$/.test(String(value)) || Number(value) > 65535 || (!allowZero && Number(value) === 0)) {
    throw new Error('Invalid loopback port');
  }
  return Number(value);
}

export function sceneArguments(args) {
  const result = { port: 18884, simulatorPort: undefined };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--port', '--simulator-port'].includes(flag) || seen.has(flag) || args[index + 1] === undefined) {
      throw new Error('Usage: node tools/scene-server.mjs [--port <0..65535>] [--simulator-port <1..65535>]');
    }
    seen.add(flag);
    result[flag === '--port' ? 'port' : 'simulatorPort'] = portNumber(args[index + 1], flag === '--port');
  }
  return result;
}

/** An unbound, exact-route server; requests require its literal loopback Host. */
export function createSceneServer({ simulatorPort, root = projectRoot } = {}) {
  const simulatorUrl = simulatorPort === undefined ? null : `ws://127.0.0.1:${portNumber(simulatorPort)}/slither`;
  const csp = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'${simulatorUrl ? ` ${simulatorUrl}` : ''}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    const send = (status, type, bytes) => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    };
    const address = server.address();
    if (!address || address.address !== '127.0.0.1' || request.headers.host !== `127.0.0.1:${address.port}`) {
      send(403, 'text/plain', 'Loopback host required'); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD'); send(405, 'text/plain', 'Method not allowed'); return;
    }
    const resource = (request.url ?? '').split('?')[0];
    if (!resource.startsWith('/') || resource.startsWith('//') || /[%\\:#\u0000-\u0020]/.test(resource)
      || resource.split('/').some(part => part === '.' || part === '..')) {
      send(400, 'text/plain', 'Invalid resource path'); return;
    }
    if (resource === '/scene/config.json') {
      send(200, 'application/json', JSON.stringify({ simulatorUrl })); return;
    }
    const snippet = /^\/(?:scene|game)\/pkg\/(snippets\/slither-client-[a-f0-9]{16}\/web\/stock-hud-contract\.mjs)$/.exec(resource);
    const route = routes.get(resource) ?? (snippet
      ? [`dist/web/${snippet[1]}`, 'text/javascript; charset=utf-8'] : undefined);
    if (!route) { send(404, 'text/plain', 'Resource not found'); return; }
    try {
      const canonicalRoot = await realpath(root);
      const file = await realpath(path.join(canonicalRoot, route[0]));
      const relative = path.relative(canonicalRoot, file);
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Escaped root');
      send(200, route[1], await readFile(file));
    } catch { send(503, 'text/plain', 'Scene resource unavailable'); }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { port, simulatorPort } = sceneArguments(process.argv.slice(2));
    const server = createSceneServer({ simulatorPort });
    server.on('error', () => { console.error('Scene server could not bind loopback'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Scene: http://127.0.0.1:${server.address().port}/`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
