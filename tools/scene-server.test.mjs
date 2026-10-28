import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createSceneServer, sceneArguments } from './scene-server.mjs';

test('scene CLI accepts only bounded literal ports', () => {
  assert.deepEqual(sceneArguments([]), { port: 18884, simulatorPort: undefined });
  assert.deepEqual(sceneArguments(['--port', '0', '--simulator-port', '8766']), { port: 0, simulatorPort: 8766 });
  for (const args of [['--port'], ['--port', '65536'], ['--port', '-1'], ['--simulator-port', '0'],
    ['--simulator-port', '8766/path'], ['--port', '80', '--port', '81'], ['--host', 'example.invalid']]) {
    assert.throws(() => sceneArguments(args));
  }
  assert.throws(() => createSceneServer({ simulatorPort: '8766; connect-src *' }));
});

async function running(t, options) {
  const server = createSceneServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return (resource, { host = `127.0.0.1:${server.address().port}`, method = 'GET' } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: resource, method,
      headers: { Host: host }, agent: false }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', data => { text += data; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject); req.end();
  });
}

test('scene server is local, allowlisted and requires no reference or socket', async t => {
  const request = await running(t);
  const page = await request('/');
  assert.equal(page.status, 200); assert.match(page.text, /\/game\/bootstrap.mjs/);
  assert.equal(JSON.parse((await request('/scene/config.json')).text).simulatorUrl, null);
  const policy = page.headers['content-security-policy'];
  assert.match(policy, /connect-src 'self';/); assert.doesNotMatch(policy, /ws:|'unsafe-inline'|'unsafe-eval'/);
  for (const resource of ['/anchors', '/game/bootstrap.mjs', '/game/runtime.mjs', '/game/host.css',
    '/game/local-game-host.mjs', '/game/client-asset-map.mjs', '/game/stock-accessory-selection.mjs', '/game/owned-minimap-ui.mjs', '/game/stock-gameplay.mjs', '/game/stock-leaderboard-state.mjs',
    '/animated', '/scene/animated.mjs', '/scene/desktop-layout.mjs', '/scene/synthetic-body.mjs', '/scene/synthetic-food.mjs', '/scene/synthetic-prey.mjs', '/scene/skin-provider.mjs', '/benchmark', '/scene/benchmark.mjs', '/scene/dense-scene.mjs', '/scene/scene.css', '/scene/scene.mjs', '/scene/synthetic-scene.mjs', '/scene/loopback-session.mjs']) {
    assert.equal((await request(resource)).status, 200);
  }
  for (const resource of ['/Cargo.toml', '/web/scene.html', '/reference/', '/scene/unknown.mjs']) assert.equal((await request(resource)).status, 404);
  for (const resource of ['/../Cargo.toml', '/%2e%2e/Cargo.toml', '//foreign', '/scene\\scene.mjs']) assert.equal((await request(resource)).status, 400);
  for (const host of ['localhost', 'example.invalid', '127.0.0.1:1']) assert.equal((await request('/', { host })).status, 403);
  assert.equal((await request('/', { method: 'POST' })).status, 405);
  assert.equal((await request('/', { method: 'HEAD' })).text, '');
});

test('simulator configuration only permits its exact literal loopback port', async t => {
  const request = await running(t, { simulatorPort: 8766 });
  const result = await request('/scene/config.json');
  assert.deepEqual(JSON.parse(result.text), { simulatorUrl: 'ws://127.0.0.1:8766/slither' });
  assert.match(result.headers['content-security-policy'], /connect-src 'self' ws:\/\/127\.0\.0\.1:8766\/slither;/);
});
