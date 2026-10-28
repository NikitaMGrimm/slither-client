// Authored synthetic regression for the actual browser-scenario.mjs entry point.
// Node 24: node --experimental-vm-modules <this-file> --repo <checkout>
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
const runnerFile = path.join(repo, 'tools/browser-scenario.mjs');
const source = await fs.readFile(runnerFile, 'utf8');
const common = await import(pathToFileURL(path.join(repo, 'tools/browser-common.mjs')));
const temp = await fs.realpath(os.tmpdir());
const scratch = await fs.mkdtemp(path.join(temp, 'pr67-scenario-evidence-test-'));
try {
  for (const variant of ['early-step-throw', 'completed-control']) {
    const failing = variant === 'early-step-throw';
    const output = path.join(scratch, variant);
    const selectedRepo = path.join(scratch, 'repo-' + variant); await fs.mkdir(selectedRepo);
    const scenarioPath = path.join(scratch, variant + '.json');
    await fs.writeFile(scenarioPath, JSON.stringify({ kind: 'authored-synthetic',
      viewport: { width: 640, height: 480 }, expectedLogins: 1,
      steps: [{ op: 'press', key: 'Enter' }],
    }), { flag: 'wx' });
    const cleanup = [], buildCalls = [], logs = [];
    let httpRoute, httpOutcome;
    const peerReceipt = { kind: 'authored-synthetic', connections: 1, logins: 1, errors: [] };
    const peer = { port: 12346, receipt: peerReceipt,
      disconnect() {}, async close() { cleanup.push('peer'); } };
    const page = new EventEmitter();
    page.clock = { async install() {}, async pauseAt() {}, async runFor() {} };
    page.goto = async () => {
      if (!failing) return;
      // Call the real fence callback in memory; no request or socket is created.
      await httpRoute({
        request: () => ({ url: () => 'https://authored.invalid/blocked' }),
        continue: () => { httpOutcome = 'continued'; },
        abort: () => { httpOutcome = 'aborted'; },
      });
      page.emit('pageerror', new Error('Authored page failure before first step'));
      peerReceipt.errors.push('Authored peer diagnostic before first step');
    };
    page.evaluate = async fn => String(fn).includes('commands:')
      ? { commands: [], observations: [], dropped: 0 } : undefined;
    page.keyboard = { async press(key) {
      assert.equal(key, 'Enter');
      if (failing) throw new Error('Authored early step failure');
    } };
    page.screenshot = async ({ path: file }) => {
      await fs.writeFile(file, 'AUTHORED SCREENSHOT PLACEHOLDER; NO PIXELS', { flag: 'wx' });
    };
    const context = {
      async route(_pattern, fn) { httpRoute = fn; }, async routeWebSocket() {},
      async addInitScript() {}, async newPage() { return page; },
      async close() { cleanup.push('context'); },
    };
    const browser = { version: () => 'Authored mocked browser',
      async newContext() { return context; }, async close() { cleanup.push('browser'); } };
    const server = new EventEmitter();
    server.listen = () => { queueMicrotask(() => server.emit('listening')); };
    server.address = () => ({ port: 12345 });
    server.closeAllConnections = () => {};
    server.close = callback => { cleanup.push('server'); callback(); };
    const testProcess = { execPath: 'authored-inert-node' };
    const ctx = vm.createContext({ process: testProcess, console: { log: text => logs.push(text) },
      URL, Buffer, setTimeout, clearTimeout });
    async function synthetic(namespace) {
      const keys = Object.keys(namespace);
      const module = new vm.SyntheticModule(keys, function () {
        for (const key of keys) this.setExport(key, namespace[key]);
      }, { context: ctx });
      await module.link(() => { throw new Error('Unexpected synthetic import'); });
      await module.evaluate(); return module;
    }
    const mocks = new Map([
      ['playwright', { chromium: { async launch() { return browser; } },
        firefox: { async launch() { return browser; } } }],
      ['node:util', { parseArgs: () => ({ values: {
        scenario: scenarioPath, output, repo: selectedRepo, browser: 'chromium',
      } }) }],
      ['node:child_process', { execFileSync(command, args, options) {
        assert.equal(command, 'authored-inert-node');
        assert.deepEqual(Array.from(args), ['tools/build-web.mjs']);
        assert.equal(options.cwd, selectedRepo); buildCalls.push('mocked-build-only');
      } }],
      ['node:fs/promises', { ...fs, async readFile(file, ...args) {
        // Inert authored bytes supply a build identity; no Wasm file is read or executed.
        if (file === path.join(selectedRepo, 'dist/web/slither_client_bg.wasm')) return Buffer.from('AUTHORED WASM PLACEHOLDER');
        return fs.readFile(file, ...args);
      } }],
      ['./browser-common.mjs', common],
      ['./browser-session-fixture.mjs', { syntheticPeer: async () => peer }],
      ['./browser-probe.mjs', { installProbe() {} }],
    ]);
    const serverModule = await synthetic({ createSceneServer: options => {
      assert.equal(options.root, selectedRepo); assert.equal(options.simulatorPort, peer.port); return server;
    } });
    const module = new vm.SourceTextModule(source, { context: ctx, identifier: pathToFileURL(runnerFile).href,
      importModuleDynamically: async specifier => {
        assert.equal(specifier, pathToFileURL(path.join(selectedRepo, 'tools/scene-server.mjs')).href);
        return serverModule;
      },
    });
    await module.link(async specifier => {
      assert.ok(mocks.has(specifier) || specifier.startsWith('node:'), 'Unexpected import: ' + specifier);
      return synthetic(mocks.has(specifier) ? mocks.get(specifier) : await import(specifier));
    });
    await module.evaluate();
    const result = JSON.parse(await fs.readFile(path.join(output, 'scenario.json'), 'utf8'));
    assert.equal(result.status, failing ? 'failed' : 'passed');
    assert.equal(testProcess.exitCode ?? 0, failing ? 1 : 0);
    assert.equal(result.lastStep, 0); assert.deepEqual(result.actions, ['press']);
    assert.deepEqual(cleanup, ['context', 'browser', 'peer', 'server']);
    assert.deepEqual(result.cleanupErrors, []); assert.equal(logs.length, 1);
    assert.deepEqual(buildCalls, ['mocked-build-only']);
    const expectedRetention = true;
    for (const field of ['blockedRequests', 'pageErrors', 'peer']) {
      assert.equal(Object.hasOwn(result, field), expectedRetention, variant + ': retained ' + field);
    }
    if (expectedRetention) {
      assert.deepEqual(result.blockedRequests, failing ? [{ kind: 'http', scheme: 'https:' }] : []);
      assert.deepEqual(result.pageErrors, failing ? ['Authored page failure before first step'] : []);
      assert.deepEqual(result.peer, peerReceipt);
    }
    if (failing) {
      assert.equal(result.error, 'Authored early step failure'); assert.equal(httpOutcome, 'aborted');
      await fs.access(path.join(output, 'failure.png'));
    }
    console.log(JSON.stringify({ variant, status: result.status, diagnosticsRetained: expectedRetention,
      exitCode: testProcess.exitCode ?? 0, cleanup, retainedReceipt: true }));
  }
} finally {
  const actual = await fs.realpath(scratch);
  assert.equal(path.dirname(actual), temp); assert.match(path.basename(actual), /^pr67-scenario-evidence-test-/);
  await fs.rm(actual, { recursive: true });
}
