// Manual private capture/compare entry. External adapters remain caller-owned code.
import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { readFile, writeFile, appendFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { once } from 'node:events';
import { root, freshOutput, hash, json, temporaryProfile, fence, within } from './browser-common.mjs';
import { installProbe } from './browser-probe.mjs';
import { startTrace } from './browser-trace.mjs';
import { observeWorldLayers } from './browser-layers.mjs';

const { values: v } = parseArgs({ options: Object.fromEntries([
  'mode', 'adapter', 'reference-root', 'pack', 'scenario', 'output', 'reference',
].map(x => [x, { type: 'string' }]).concat([['exact-frame', { type: 'boolean', default: false }], ['metadata-only', { type: 'boolean', default: false }]])) });
if (!['capture-original', 'compare-ours'].includes(v.mode)) throw new Error('Use --mode capture-original|compare-ours');
for (const flag of ['adapter', 'reference-root', 'pack', 'scenario']) {
  if (!v[flag] || !path.isAbsolute(v[flag]) || within(root, path.resolve(v[flag]))) throw new Error(`External absolute --${flag} required`);
  v[flag] = await realpath(v[flag]);
  if (within(root, v[flag])) throw new Error(`External --${flag} symlink target required`);
}
if (v.mode === 'compare-ours' && !v.reference) throw new Error('--reference saved external capture required');
if (v.mode === 'capture-original' && v['exact-frame']) throw new Error('Exact JS probe is an ours-only separate diagnostic');
if (v['metadata-only'] && v['exact-frame']) throw new Error('Layer metadata diagnostic does not execute the exact-frame probe');
const output = await freshOutput(v.output, [v['reference-root'], v.pack, ...(v.reference ? [v.reference] : [])]);
const role = v.mode === 'capture-original' ? 'original' : 'ours';
const receipt = { mode: v.mode, role, status: 'running', output, cleanup: [],
  metadataOnly: v['metadata-only'],
  scenarioSha256: hash(await readFile(v.scenario)), adapterSha256: hash(await readFile(v.adapter)),
  limits: 'Private offline replay only. Native callback timings include instrumentation; they are not GPU completion. Saved reference is never executed by compare-ours.' };
let adapter, browser, context, profile, trace, reference, page, layers;
const privateErrors = [], failedResources = [];
try {
  if (role === 'ours') {
    reference = JSON.parse(await readFile(path.join(v.reference, 'capture.json')));
    if (reference.role !== 'original' || reference.status !== 'passed' || reference.scenarioSha256 !== receipt.scenarioSha256) throw new Error('Saved reference identity rejected');
  }
  const plugin = await import(pathToFileURL(v.adapter));
  receipt.stage = 'adapter-setup';
  adapter = await plugin.createAdapter({ role, referenceRoot: v['reference-root'], pack: v.pack,
    scenario: v.scenario, output, repo: root, exactFrame: v['exact-frame'] });
  if (!adapter?.server || typeof adapter.arm !== 'function' || typeof adapter.step !== 'function'
    || typeof adapter.verify !== 'function' || typeof adapter.close !== 'function'
    || !Number.isInteger(adapter.frames) || adapter.frames < 1 || adapter.frames > 600
    || !Array.isArray(adapter.keyframes) || !adapter.viewport || !adapter.pagePath?.startsWith('/')) throw new Error('External adapter contract rejected');
  adapter.server.listen(0, '127.0.0.1'); await once(adapter.server, 'listening');
  const origin = `http://127.0.0.1:${adapter.server.address().port}`;
  profile = await temporaryProfile();
  context = await chromium.launchPersistentContext(profile.path, { channel: 'chrome', headless: false,
    viewport: { width: adapter.viewport.width, height: adapter.viewport.height },
    deviceScaleFactor: adapter.viewport.dpr, serviceWorkers: 'block',
    ignoreDefaultArgs: ['--disable-gpu', '--enable-unsafe-swiftshader'], args: ['--enable-automation', '--no-first-run', '--no-default-browser-check'] });
  browser = context.browser(); receipt.version = browser.version();
  const blocked = await fence(context, origin, { sockets: true });
  await context.addInitScript(installProbe);
  page = context.pages()[0] ?? await context.newPage();
  page.setDefaultTimeout(15000);
  // Adapter errors are deliberately not printed: private runtime strings may contain source data.
  let pageErrors = 0; page.on('pageerror', error => { pageErrors++; privateErrors.push(error.message); });
  page.on('response', response => { if (response.status() >= 400) failedResources.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  receipt.stage = 'page-startup';
  await page.goto(origin + adapter.pagePath); await adapter.ready(page); await page.bringToFront();
  receipt.beforeArm = await page.evaluate(() => { browserProbe.transitions.length = 0; return browserProbe.observe('before-arm'); });
  if (!receipt.beforeArm.focus || receipt.beforeArm.visibility !== 'visible'
    || receipt.beforeArm.width !== adapter.viewport.width || receipt.beforeArm.height !== adapter.viewport.height) throw new Error('Before-arm foreground/dimensions rejected');
  if (reference && !reference.beforeArm) throw new Error('Reference metadata missing');
  if (reference && ['width', 'height', 'dpr'].some(k => reference.beforeArm[k] !== receipt.beforeArm[k])) throw new Error('Actual reference/ours viewport or DPR differs');
  trace = await startTrace(browser); receipt.traceMetadata = trace.metadata;
  layers = await observeWorldLayers(context, page, adapter.canvasSelector);
  await page.evaluate(({ selector, recording }) => {
    browserProbe.selectWorld(document.querySelector(selector)); browserProbe.phase = 'play'; browserProbe.recording = recording;
  }, { selector: adapter.canvasSelector, recording: !v['metadata-only'] });
  receipt.stage = 'arm'; await adapter.arm(page);
  const rows = [], screenshots = [], commandHash = createHash('sha256');
  let commandCount = 0;
  const logFile = path.join(output, 'private-canvas.jsonl');
  if (!v['metadata-only']) await writeFile(logFile, '', { flag: 'wx' });
  async function drain() {
    if (v['metadata-only']) return;
    const commands = await page.evaluate(() => browserProbe.commands.splice(0));
    commandCount += commands.length;
    const text = commands.map(x => JSON.stringify(x) + '\n').join('');
    commandHash.update(text); await appendFile(logFile, text);
  }
  for (let frame = 1; frame <= adapter.frames; frame++) {
    receipt.stage = 'replay'; receipt.lastFrame = frame;
    await page.evaluate(frame => { browserProbe.frame = frame; }, frame);
    const row = await adapter.step(page, { frame }); rows.push(row);
    await page.evaluate(() => browserProbe.present());
    if (frame === 1 || adapter.keyframes.includes(frame)) await layers.sample(`batch-${frame}`);
    if (adapter.keyframes.includes(frame) && !v['metadata-only']) {
      await page.evaluate(() => { browserProbe.phase = 'driver'; });
      const png = await page.locator(adapter.canvasSelector).screenshot({ path: path.join(output, `${role}-frame-${frame}.png`), animations: 'allow' });
      screenshots.push({ frame, sha256: hash(png) });
      await page.evaluate(() => { browserProbe.phase = 'play'; });
    }
    await drain();
    if (row.failed) throw new Error('Private replay step rejected');
  }
  // Exactly one optional probe, in page memory, after a fully gated source capture.
  receipt.stage = 'verification'; receipt.adapterVerification = await adapter.verify(rows);
  if (v['exact-frame']) {
    if (receipt.adapterVerification.accepted !== true || typeof adapter.exact !== 'function') throw new Error('Exact probe preconditions rejected');
    receipt.exact = await adapter.exact(page);
    await page.evaluate(() => browserProbe.present());
  }
  await drain();
  await page.evaluate(() => { browserProbe.phase = 'after'; });
  const data = await page.evaluate(() => { browserProbe.recording = false; return {
    observations: browserProbe.observations,
    transitions: browserProbe.transitions, dropped: browserProbe.dropped, callDiagnostics: browserProbe.callDiagnostics }; });
  await json(path.join(output, 'private-steps.json'), v['metadata-only'] ? rows.map(row => {
    const report = row.reports?.[role];
    return { frame: row.frame, done: row.done, failed: row.failed, stats: report?.stats,
      nativeCallbackMs: report?.counterFrame?.nativeCallbackMs,
      worldCanvas: report?.counterFrame?.entities?.worldCanvas,
      sourceCanvasMutationCount: report?.counterFrame?.sourceCanvasWrites?.mutatedDrawnSources?.length,
      viewport: report?.viewport, foreground: report?.foreground };
  }) : rows);
  await json(path.join(output, 'private-foreground.json'), { observations: data.observations, transitions: data.transitions });
  receipt.commands = commandCount; receipt.screenshots = screenshots;
  receipt.callDiagnostics = data.callDiagnostics;
  if (role === 'ours') receipt.wasmSha256 = hash(await readFile(path.join(root, 'dist/web/slither_client_bg.wasm')));
  receipt.canvasSha256 = commandHash.digest('hex');
  receipt.foreground = [...data.observations, ...data.transitions].every(x => x.visibility === 'visible' && x.focus
    && ['width', 'height', 'dpr'].every(k => x[k] === receipt.beforeArm[k]));
  receipt.worldLayers = await layers.stop(); layers = null;
  await json(path.join(output, 'private-layers.json'), receipt.worldLayers);
  receipt.trace = await trace.stop(path.join(output, 'private-chrome-trace.json'), receipt.worldLayers); trace = null;
  receipt.gpuTraceVerified = receipt.trace.hasGpuRasterPresentation && !receipt.trace.completion.dataLossOccurred;
  receipt.blockedRequests = blocked.length; receipt.pageErrors = pageErrors;
  if (data.dropped || pageErrors || blocked.length || !receipt.foreground || receipt.adapterVerification.accepted !== true) throw new Error('Private capture gates rejected');
  if (reference) receipt.comparison = { reference: path.resolve(v.reference), metadataOnly: v['metadata-only'],
    screenshots: screenshots.map(s => ({ frame: s.frame, exactPngMatch: reference.screenshots.find(r => r.frame === s.frame)?.sha256 === s.sha256 })),
    canvasLogHashEqual: reference.canvasSha256 === receipt.canvasSha256,
    limit: 'Ordered logs and PNG hashes are retained. Hash inequality identifies a difference, without an automatic visual-parity claim. Native object IDs are page-local.' };
  receipt.status = 'passed';
} catch (error) {
  if (page) {
    try { await json(path.join(output, 'private-status.json'), await page.evaluate(() => ({
      hooksReady: Boolean(globalThis.comparisonHooks), sceneReady: Boolean(globalThis.liveScene),
      stats: globalThis.comparisonStats ?? null,
      resources: performance.getEntriesByType('resource').map(x => ({ name: new URL(x.name).pathname, duration: x.duration })),
      status: document.querySelector('#slither-client-status')?.textContent,
      armDisabled: document.querySelector('#comparison-start')?.disabled,
    }))); } catch { /* The private page may already have closed. */ }
  }
  await json(path.join(output, 'private-error.json'), { name: error.name, message: error.message, privateErrors, failedResources });
  receipt.status = 'failed'; receipt.error = 'Private capture failed; inspect only the retained private files and adapter locally.';
  process.exitCode = 1;
} finally {
  if (layers) { try { receipt.partialLayers = await layers.stop(); } catch { receipt.layerStopFailed = true; } }
  if (trace) { try { receipt.partialTrace = await trace.stop(path.join(output, 'private-chrome-trace-partial.json')); } catch { receipt.traceStopFailed = true; } }
  try { if (context) await context.close(); } finally { if (browser) await browser.close(); }
  if (profile) { await profile.remove(); receipt.cleanup.push('owned temporary profile removed; browser/context closed'); }
  if (adapter) { await adapter.close(); receipt.cleanup.push('owned adapter server and peers closed'); }
  await json(path.join(output, 'capture.json'), receipt);
}
// Safe metadata only; never relay private exceptions, logs, pixels or program values.
console.log(JSON.stringify({ status: receipt.status, role, output, version: receipt.version, frames: adapter?.frames, commands: receipt.commands }));
