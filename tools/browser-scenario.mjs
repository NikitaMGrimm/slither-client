import { chromium, firefox } from 'playwright';
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { root, freshOutput, json, fence, hash, cleanupResources, readConfinedFile } from './browser-common.mjs';
import { syntheticPeer } from './browser-session-fixture.mjs';
import { installProbe } from './browser-probe.mjs';

// Declarative feature checks share one server, packet fixture and Playwright owner.
const { values: v } = parseArgs({ options: { scenario: { type: 'string' }, output: { type: 'string' },
  repo: { type: 'string', default: root }, browser: { type: 'string', default: 'chromium' } } });
if (!v.scenario || !['chromium', 'firefox'].includes(v.browser)) throw new Error('--scenario JSON and --browser chromium|firefox required');
const scenario = JSON.parse(await readFile(v.scenario));
if (scenario.kind !== 'authored-synthetic' || !Array.isArray(scenario.steps) || scenario.steps.length > 100
  || !Number.isInteger(scenario.viewport?.width) || !Number.isInteger(scenario.viewport?.height)
  || scenario.viewport.width < 320 || scenario.viewport.width > 3840 || scenario.viewport.height < 240 || scenario.viewport.height > 2160) throw new Error('Invalid authored scenario');
const repo = path.resolve(v.repo), output = await freshOutput(v.output, [repo]);
const result = { kind: 'authored-synthetic', scenarioSha256: hash(await readFile(v.scenario)),
  status: 'running', browser: v.browser, checkpoints: [], actions: [], cleanup: [] };
let peer, server, browser, context, page;
try {
  execFileSync(process.execPath, ['tools/build-web.mjs'], { cwd: repo, stdio: 'inherit' });
  result.wasmSha256 = hash(await readFile(path.join(repo, 'dist/web/slither_client_bg.wasm')));
  const { createSceneServer } = await import(pathToFileURL(path.join(repo, 'tools/scene-server.mjs')));
  peer = await syntheticPeer();
  server = createSceneServer({ root: repo, simulatorPort: peer.port });
  // The repository's original vector is an owned static resource, never reference artwork.
  const handlers = server.listeners('request'); server.removeAllListeners('request');
  server.on('request', async (req, res) => {
    if (req.url !== '/assets/logo.svg') { for (const handler of handlers) handler(req, res); return; }
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(403); res.end(); return; }
    try { const bytes = await readConfinedFile(repo, 'assets/logo.svg'); res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); }
    catch { res.writeHead(503); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await ({ chromium, firefox })[v.browser].launch({ headless: true });
  context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const blocked = await fence(context, origin, { socketOrigin: `ws://127.0.0.1:${peer.port}` });
  await context.addInitScript(installProbe); page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto(origin); await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.evaluate(() => { browserProbe.recording = true; });
  function locator(step) {
    if (step.role) return page.getByRole(step.role, { name: step.name, exact: true });
    if (step.label) return page.getByLabel(step.label, { exact: true });
    if (step.selector) return page.locator(step.selector);
    throw new Error('A role/name, label or selector is required');
  }
  async function advance(ms) {
    if (!Number.isInteger(ms) || ms < 0 || ms > 10000) throw new Error('Invalid bounded advance');
    await page.clock.runFor(ms);
    // Allow native socket ingress between deterministic game-clock advances.
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  for (const [index, step] of scenario.steps.entries()) {
    result.lastStep = index; result.actions.push(step.op);
    if (step.op === 'press') await page.keyboard.press(step.key);
    else if (step.op === 'fill') await locator(step).fill(step.value, { force: true });
    else if (step.op === 'click') await locator(step).click({ force: true });
    else if (step.op === 'advance') await advance(step.ms);
    else if (step.op === 'disconnect') peer.disconnect();
    else if (step.op === 'assert') {
      const target = locator(step);
      let passed = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        passed = step.state === 'hidden' ? !(await target.isVisible())
          : step.state === 'enabled' ? await target.isEnabled()
            : step.state === 'focused' ? await target.evaluate(e => e === document.activeElement)
              : step.state === 'visible' ? await target.isVisible() : false;
        if (passed) break; await advance(16);
      }
      if (!passed) throw new Error(`Scenario assertion failed at step ${index}`);
    } else if (step.op === 'screenshot') {
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(step.name) || result.checkpoints.some(x => x.name === step.name)) throw new Error('Unique safe screenshot name required');
      const png = await page.screenshot({ path: path.join(output, step.name + '.png'), animations: 'allow' });
      result.checkpoints.push({ name: step.name, sha256: hash(png), viewport: scenario.viewport });
    } else throw new Error('Unsupported scenario operation');
  }
  const data = await page.evaluate(() => { browserProbe.recording = false; return { commands: browserProbe.commands,
    observations: browserProbe.observations, dropped: browserProbe.dropped }; });
  await json(path.join(output, 'canvas.json'), data.commands);
  result.peer = peer.receipt; result.version = browser.version(); result.commands = data.commands.length;
  result.blockedRequests = blocked; result.pageErrors = errors;
  if (blocked.length || errors.length || peer.receipt.errors.length || data.dropped
    || (scenario.expectedLogins !== undefined && scenario.expectedLogins !== peer.receipt.logins)) throw new Error('Scenario execution gate failed');
  result.status = 'passed';
} catch (e) { result.status = 'failed'; result.error = e.message; process.exitCode = 1;
  if (page) { try { await page.screenshot({ path: path.join(output, 'failure.png') }); } catch {} }
} finally {
  result.cleanupErrors = await cleanupResources([
    ['context', async () => { if (context) await context.close(); }],
    ['browser', async () => { if (browser) await browser.close(); }],
    ['peer', async () => { if (peer) await peer.close(); }],
    ['server', async () => { if (server) { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } }],
  ]);
  if (result.cleanupErrors.length) { result.status = 'failed'; result.error ??= 'Resource cleanup failed; inspect cleanupErrors'; process.exitCode = 1; }
  else result.cleanup.push('owned browser/context/HTTP/WebSocket fixtures closed');
  await json(path.join(output, 'scenario.json'), result);
}
console.log(JSON.stringify({ status: result.status, output, version: result.version, error: result.error }));
