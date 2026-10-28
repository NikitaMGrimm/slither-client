import { chromium, firefox } from 'playwright';
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { freshOutput, syntheticServer, hash, json, fence, temporaryProfile, root, cleanupResources } from './browser-common.mjs';
import { installProbe } from './browser-probe.mjs';
import { startTrace } from './browser-trace.mjs';
import { observeWorldLayers } from './browser-layers.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' }, mode: { type: 'string', default: 'regression' },
  candidate: { type: 'boolean', default: false } } });
if (!['regression', 'performance'].includes(values.mode)) throw new Error('Unknown mode');
const output = await freshOutput(values.output);
const manifest = { kind: 'authored-synthetic', mode: values.mode, platform: process.platform,
  os: { release: os.release(), version: os.version() },
  arch: process.arch, playwright: createRequire(import.meta.url)('playwright/package.json').version,
  node: process.version, frames: 24, keyframes: [1, 12, 24], viewport: { width: 640, height: 480 },
  status: 'running', browsers: [], cleanup: [] };
let server;
try {
  // Always compose a current build; no stale-Wasm shortcut.
  execFileSync(process.execPath, ['tools/build-web.mjs'], { cwd: root, stdio: 'inherit' });
  manifest.wasmSha256 = hash(await readFile(path.join(root, 'dist/web/slither_client_bg.wasm')));
  server = await syntheticServer();
  const expected = values.mode === 'regression' && !values.candidate
    ? JSON.parse(await readFile(new URL('./browser-baselines.json', import.meta.url))) : null;
  for (const name of values.mode === 'performance' ? ['chrome'] : ['chromium', 'firefox']) {
    let browser, context, profile, trace, layers;
    const result = { name, screenshots: [], status: 'running' }; manifest.browsers.push(result);
    try {
      const headed = name === 'chrome';
      if (headed) {
        profile = await temporaryProfile();
        context = await chromium.launchPersistentContext(profile.path, { channel: 'chrome', headless: false,
          viewport: manifest.viewport, deviceScaleFactor: 1, serviceWorkers: 'block',
          ignoreDefaultArgs: ['--disable-gpu', '--enable-unsafe-swiftshader'],
          args: ['--enable-automation', '--no-first-run', '--no-default-browser-check'] });
        browser = context.browser();
      } else {
        browser = await ({ chromium, firefox })[name].launch({ headless: true });
        context = await browser.newContext({ viewport: manifest.viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
      }
      result.version = browser.version();
      const blocked = await fence(context, server.origin);
      await context.addInitScript(installProbe);
      const page = context.pages()[0] ?? await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      // Register after native capability capture, before fixture navigation.
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.goto(server.origin); await page.waitForFunction(() => globalThis.browserFixture?.ready);
      await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
      await page.bringToFront();
      const nativeBefore = await page.evaluate(() => browserProbe.now());
      await new Promise(resolve => setTimeout(resolve, 30));
      const nativeDelta = await page.evaluate(before => browserProbe.now() - before, nativeBefore);
      if (nativeDelta < 10) throw new Error('Native timing capture was replaced by fake clock');
      result.nativeClockDeltaDuringFrozenClock = nativeDelta;
      if (headed) trace = await startTrace(browser);
      if (headed) layers = await observeWorldLayers(context, page, '#world');
      if (trace) result.traceMetadata = trace.metadata;
      await page.evaluate(() => { browserProbe.transitions.length = 0; browserProbe.observe('before-arm'); browserFixture.arm(); });
      for (let frame = 1; frame <= manifest.frames; frame++) {
        if (frame === 3) await page.mouse.move(480, 180);
        if (frame === 7) await page.keyboard.down('Space');
        if (frame === 11) await page.keyboard.up('Space');
        await page.clock.runFor(16);
        await page.evaluate(() => browserProbe.observe('after-frame'));
        if (headed) await page.evaluate(() => browserProbe.present());
        if (layers && (frame === 1 || manifest.keyframes.includes(frame))) await layers.sample(`frame-${frame}`);
        if (manifest.keyframes.includes(frame)) {
          const file = path.join(output, `${name}-frame-${frame}.png`);
          const png = await page.locator('#world').screenshot({ path: file, animations: 'allow' });
          // Hash decoded Canvas pixels as well as the actual screenshot PNG.
          const pixels = await page.evaluate(() => {
            browserProbe.recording = false;
            const c = document.querySelector('#world');
            return [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data];
          });
          await page.evaluate(() => { browserProbe.recording = true; });
          result.screenshots.push({ frame, pngSha256: hash(png), rgbaSha256: hash(Buffer.from(pixels)), width: 640, height: 480 });
        }
      }
      const data = await page.evaluate(() => { browserProbe.recording = false; return {
        fixture: browserFixture.result(), commands: browserProbe.commands, timings: browserProbe.timings,
        observations: browserProbe.observations, transitions: browserProbe.transitions, dropped: browserProbe.dropped }; });
      await json(path.join(output, `${name}-canvas.json`), data.commands);
      await json(path.join(output, `${name}-telemetry.json`), { ...data, commands: undefined });
      result.commandSha256 = hash(JSON.stringify(data.commands)); result.commands = data.commands.length;
      result.frames = data.fixture.frame; result.packets = data.fixture.packets.length;
      result.nativeCallbackMs = data.timings.map(x => x.end - x.start);
      result.actualDpr = data.observations[0].dpr;
      result.foreground = [...data.observations, ...data.transitions].every(x => x.visibility === 'visible'
        && x.focus && x.width === 640 && x.height === 480 && x.dpr === result.actualDpr);
      if (layers) { result.worldLayers = await layers.stop(); layers = null; await json(path.join(output, 'chrome-layers.json'), result.worldLayers); }
      if (trace) { result.trace = await trace.stop(path.join(output, 'chrome-trace.json'), result.worldLayers); trace = null; }
      if (headed && (!result.trace.hasGpuRasterPresentation || result.trace.completion.dataLossOccurred)) throw new Error('GPU/raster/presentation trace evidence missing or truncated');
      if (errors.length || blocked.length || data.dropped || data.fixture.frame !== 24 || !data.fixture.wasmExecuted) throw new Error('Synthetic execution gate failed');
      if (headed && !result.foreground) throw new Error('Continuous foreground/dimensions gate failed');
      const baseline = { version: result.version, screenshots: result.screenshots, commandSha256: result.commandSha256, commands: result.commands };
      result.baseline = baseline;
      if (expected && JSON.stringify(expected[`${process.platform}-${process.arch}`]?.[name]) !== JSON.stringify(baseline)) throw new Error('Synthetic baseline mismatch; outputs retained, no expectation updated');
      result.status = 'passed';
    } catch (error) { result.status = 'failed'; result.error = error.message; }
    finally {
      if (layers) { try { result.partialLayers = await layers.stop(); } catch { result.layerStopFailed = true; } }
      if (trace) { try { result.partialTrace = await trace.stop(path.join(output, 'chrome-trace-partial.json')); } catch (e) { result.traceCleanupError = e.message; } }
      result.cleanupErrors = await cleanupResources([
        ['context', async () => { if (context) await context.close(); }],
        ['browser', async () => { if (browser) await browser.close(); }],
        ['profile', async () => { if (profile) await profile.remove(); }],
      ]);
      if (result.cleanupErrors.length) { result.status = 'failed'; result.error ??= 'Resource cleanup failed; inspect cleanupErrors'; }
      else manifest.cleanup.push(`${name}: browser/context closed${profile ? ', owned temporary profile removed' : ''}`);
    }
  }
  manifest.status = manifest.browsers.every(b => b.status === 'passed') ? 'passed' : 'failed';
  if (manifest.status === 'failed') { manifest.error = 'One or more browser jobs failed; inspect run.json'; process.exitCode = 1; }
  if (values.candidate && manifest.status === 'passed') await json(path.join(output, 'baseline-candidate.json'), {
    [`${process.platform}-${process.arch}`]: Object.fromEntries(manifest.browsers.map(b => [b.name, b.baseline])) });
} catch (error) { manifest.status = 'failed'; manifest.error = error.message; process.exitCode = 1; }
finally {
  const cleanupErrors = await cleanupResources([['server', async () => { if (server) await server.close(); }]]);
  if (cleanupErrors.length) { manifest.cleanupErrors = cleanupErrors; manifest.status = 'failed'; manifest.error ??= 'Loopback cleanup failed'; process.exitCode = 1; }
  else if (server) manifest.cleanup.push('owned loopback server closed');
  await json(path.join(output, 'run.json'), manifest);
}
console.log(JSON.stringify({ status: manifest.status, output, browsers: manifest.browsers.map(b => ({ name: b.name, version: b.version, status: b.status })), error: manifest.error }));
