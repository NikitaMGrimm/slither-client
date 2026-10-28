// Authored synthetic regression for the actual browser-reference.mjs entry point.
// Run with Node 24: node --experimental-vm-modules <this-file> --repo <checkout>
// No browser, build, server, network, credentials, artwork, or private inputs.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  repo: { type: 'string', default: process.cwd() },
} });
assert.equal(typeof vm.SourceTextModule, 'function', 'Run with --experimental-vm-modules');
const repo = await fs.realpath(values.repo);
const runnerFile = path.join(repo, 'tools/browser-reference.mjs');
const source = await fs.readFile(runnerFile, 'utf8');
const common = await import(pathToFileURL(path.join(repo, 'tools/browser-common.mjs')));
const temp = await fs.realpath(os.tmpdir());
const scratch = await fs.mkdtemp(path.join(temp, 'pr67-reference-gate-test-'));
try {
  const adapterPath = path.join(scratch, 'authored-adapter.mjs');
  const scenarioPath = path.join(scratch, 'authored-scenario.json');
  await fs.writeFile(adapterPath, '// Authored inert test adapter identity.\n', { flag: 'wx' });
  await fs.writeFile(scenarioPath, '{"kind":"authored-synthetic-test"}\n', { flag: 'wx' });
  for (const variant of ['missing-events', 'dropped-events', 'valid-trace']) {
    const output = path.join(scratch, variant);
    const inputRoot = path.join(scratch, 'inputs-' + variant);
    await fs.mkdir(inputRoot);
    const observation = { width: 640, height: 480, dpr: 1, focus: true, visibility: 'visible' };
    const cleanup = [];
    const page = {
      setDefaultTimeout() {}, on() {}, async goto() {}, async bringToFront() {},
      async evaluate(fn) {
        const text = String(fn);
        if (text.includes("observe('before-arm')")) return observation;
        if (text.includes('commands.splice')) return [];
        if (text.includes('callDiagnostics:')) return {
          observations: [observation], transitions: [], dropped: 0, callDiagnostics: {},
        };
        if (text.includes('hooksReady:')) return { kind: 'authored-mock-status' };
        // All other callbacks perform setters or native presentation waits.
      },
    };
    const browser = { version: () => 'Authored mocked browser', async close() { cleanup.push('browser'); } };
    const context = {
      browser: () => browser, pages: () => [page],
      async addInitScript() {}, async route() {}, async routeWebSocket() {},
      async close() { cleanup.push('context'); },
    };
    const server = new EventEmitter();
    // Emit only an in-memory event: no listening socket is created.
    server.listen = () => { queueMicrotask(() => server.emit('listening')); };
    server.address = () => ({ port: 12345 });
    const adapter = {
      server, pagePath: '/', canvasSelector: '#world', frames: 1, keyframes: [],
      viewport: { width: 640, height: 480, dpr: 1 },
      async ready() {}, async arm() {},
      async step() { return { frame: 1, done: true, failed: false }; },
      async verify() { return { accepted: true }; },
      async close() { cleanup.push('adapter'); },
    };
    const traceResult = {
      hasGpuRasterPresentation: variant !== 'missing-events',
      completion: { dataLossOccurred: variant === 'dropped-events' },
    };
    const testProcess = {};
    const logs = [];
    const ctx = vm.createContext({
      process: testProcess, console: { log: text => logs.push(text) }, URL, Buffer, setTimeout, clearTimeout,
    });
    async function synthetic(namespace) {
      const keys = Object.keys(namespace);
      const module = new vm.SyntheticModule(keys, function () {
        for (const key of keys) this.setExport(key, namespace[key]);
      }, { context: ctx });
      await module.link(() => { throw new Error('Unexpected synthetic import'); });
      await module.evaluate();
      return module;
    }
    const mocks = new Map([
      ['playwright', { chromium: { async launchPersistentContext() { return context; } } }],
      ['node:util', { parseArgs: () => ({ values: {
        mode: 'capture-original', adapter: adapterPath, 'reference-root': inputRoot,
        pack: inputRoot, scenario: scenarioPath, output, 'exact-frame': false, 'metadata-only': false,
      } }) }],
      ['./browser-common.mjs', {
        ...common,
        temporaryProfile: async () => ({ path: 'inert-profile-test', async remove() { cleanup.push('profile'); } }),
      }],
      ['./browser-probe.mjs', { installProbe() {} }],
      ['./browser-trace.mjs', { startTrace: async () => ({
        metadata: { kind: 'authored-mock-trace' },
        async stop(file) {
          await fs.writeFile(file, JSON.stringify({ kind: 'authored-mock-trace', traceEvents: [] }), { flag: 'wx' });
          return traceResult;
        },
      }) }],
      ['./browser-layers.mjs', { observeWorldLayers: async () => ({ async sample() {}, async stop() { return {}; } }) }],
    ]);
    const plugin = await synthetic({ createAdapter: async () => adapter });
    const module = new vm.SourceTextModule(source, {
      context: ctx, identifier: pathToFileURL(runnerFile).href,
      importModuleDynamically: async specifier => {
        assert.equal(specifier, pathToFileURL(adapterPath).href);
        return plugin;
      },
    });
    await module.link(async specifier => {
      assert.ok(mocks.has(specifier) || specifier.startsWith('node:'), 'Unexpected import: ' + specifier);
      return synthetic(mocks.has(specifier) ? mocks.get(specifier) : await import(specifier));
    });
    await module.evaluate();
    const receipt = JSON.parse(await fs.readFile(path.join(output, 'capture.json'), 'utf8'));
    const valid = variant === 'valid-trace';
    const expected = valid ? 'passed' : 'failed';
    assert.equal(receipt.gpuTraceVerified, valid);
    assert.equal(receipt.status, expected, variant + ': actual runner acceptance');
    assert.equal(testProcess.exitCode ?? 0, expected === 'passed' ? 0 : 1);
    assert.deepEqual(cleanup, ['context', 'browser', 'profile', 'adapter']);
    assert.deepEqual(receipt.cleanupErrors, []);
    assert.equal(logs.length, 1);
    // Actual runner persistence and catch/finally stay active, including failures.
    for (const name of ['private-canvas.jsonl', 'private-steps.json', 'private-foreground.json', 'private-chrome-trace.json']) {
      await fs.access(path.join(output, name));
    }
    if (expected === 'failed') {
      const error = JSON.parse(await fs.readFile(path.join(output, 'private-error.json'), 'utf8'));
      assert.equal(error.message, 'Private capture gates rejected');
    }
    console.log(JSON.stringify({ variant, status: receipt.status, gpuTraceVerified: receipt.gpuTraceVerified,
      exitCode: testProcess.exitCode ?? 0, cleanup, retainedReceipt: true }));
  }
} finally {
  const actual = await fs.realpath(scratch);
  assert.equal(path.dirname(actual), temp);
  assert.match(path.basename(actual), /^pr67-reference-gate-test-/);
  await fs.rm(actual, { recursive: true });
}
