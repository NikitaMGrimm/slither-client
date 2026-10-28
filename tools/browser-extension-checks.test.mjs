import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { extensionPolicy, installedIdentity } from './browser-extension-policy.mjs';
import { checkInstalledPreview } from './browser-extension-checks.mjs';
import { bounded } from './browser-extension-run.mjs';
import { webdriverRequest } from './browser-extension-firefox.mjs';
import { extensionFixture } from './browser-extension-fixture.mjs';
import { installedChrome } from './browser-extension-chrome.mjs';

const manifest = JSON.parse(await fs.readFile(new URL('../extension/manifest.chrome.json', import.meta.url)));
test('package policy retains exact activation origin/permissions/CSP boundaries', () => {
  const policy = extensionPolicy(manifest);
  assert.match(policy.activation, /^BLOCKED_OFFLINE:/);
  for (const mutate of [value => value.permissions.push('tabs'), value => { value.host_permissions = ['<all_urls>']; },
    value => value.web_accessible_resources[0].matches.push('http://127.0.0.1/*'),
    value => { value.content_security_policy.extension_pages += '; connect-src http://127.0.0.1'; },
    value => { value.background = { service_worker: 'synthetic.js' }; }]) {
    const changed = structuredClone(manifest); mutate(changed); assert.throws(() => extensionPolicy(changed));
  }
});
test('native extension identity must come from an extension origin with unchanged policy', () => {
  const audit = { policy: extensionPolicy(manifest) };
  const native = { id: 'authored-id', manifest, launcherUrl: 'chrome-extension://authored-id/launcher.html' };
  assert.equal(installedIdentity(native, audit).id, native.id);
  assert.throws(() => installedIdentity({ ...native, launcherUrl: 'http://127.0.0.1/launcher.html' }, audit));
  assert.throws(() => installedIdentity({ ...native, manifest: { ...manifest, manifest_version: 2 } }, audit));
});
function authoredDriver({ wasm = true, external = false, registrations = 0 } = {}) {
  const url = 'chrome-extension://authored-id/launcher.html'; const calls = [];
  return { id: 'authored-id', launcherUrl: url, calls,
    async open(value) { calls.push(['open', value]); return value; },
    async evaluate(_page, fn) {
      const text = fn.toString();
      if (text.includes('getManifest')) return { id: 'authored-id', manifest, launcherUrl: url };
      if (text.includes('getRegisteredContentScripts')) return { rejected: true, registrations };
      return { report: { wasmExecuted: wasm, renders: 2, mode: 'synthetic', connected: false, retainedPreys: 3 }, resetEnabled: true,
        canvas: { width: 960, height: 540 }, resources: [external ? 'https://authored.invalid/forbidden' : 'chrome-extension://authored-id/scene/pkg/slither_client_bg.wasm'], url: 'chrome-extension://authored-id/scene/animated.html' };
    },
    async click(_page, selector) { calls.push(['click', selector]); },
    async findPage(value) { return value; },
    async screenshot(_page, file) { calls.push(['screenshot', file]); } };
}
test('callable installed checks distinguish preview from blocked game activation', async () => {
  const driver = authoredDriver();
  const result = await checkInstalledPreview(driver, { policy: extensionPolicy(manifest) }, { origin: 'http://127.0.0.1:1234' }, '/authored-output');
  assert.match(result.activation, /BLOCKED_OFFLINE/); assert.match(result.limits, /no canonical-host/);
  assert.deepEqual(driver.calls.map(row => row[0]), ['open', 'open', 'click', 'screenshot']);
});
test('installed checks reject registration changes and external preview resources without screenshot acceptance', async () => {
  for (const options of [{ registrations: 1 }, { external: true }]) {
    const driver = authoredDriver(options);
    await assert.rejects(checkInstalledPreview(driver, { policy: extensionPolicy(manifest) }, { origin: 'http://127.0.0.1:1234' }, '/authored-output'));
    assert.equal(driver.calls.some(row => row[0] === 'screenshot'), false);
  }
});
test('operation deadline rejects a stalled owned operation', async () => {
  await assert.rejects(bounded(() => new Promise(() => {}), 5, 'Authored stalled operation'), /deadline/);
});
test('Firefox transport preserves explicit temporary-addon parameters and rejects native errors', async () => {
  const original = globalThis.fetch; const calls = [];
  try {
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, async json() { return { value: 'authored-addon-id' }; } }; };
    assert.equal(await webdriverRequest('http://127.0.0.1:4321', 'POST', '/session/authored/moz/addon/install', { path: '/authored-package', temporary: true }), 'authored-addon-id');
    assert.deepEqual(JSON.parse(calls[0].options.body), { path: '/authored-package', temporary: true });
    globalThis.fetch = async () => ({ ok: true, async json() { return { value: { error: 'unsupported operation' } }; } });
    await assert.rejects(webdriverRequest('http://127.0.0.1:4321', 'GET', '/authored'), /unsupported operation/);
  } finally { globalThis.fetch = original; }
});
test('authored local fixture rejects nonlocal hosts and proxy requests without forwarding', async () => {
  const fixture = await extensionFixture();
  try {
    const local = await fetch(fixture.origin); assert.equal(local.status, 200); assert.match(await local.text(), /Local synthetic page/);
    const denied = await fetch(fixture.origin + '/forbidden'); assert.equal(denied.status, 403);
    assert.equal(fixture.denied.length, 1);
  } finally { await fixture.close(); }
});
test('unsupported native Chrome installation closes its owned context without fallback', async () => {
  let closed = 0; const calls = [];
  const context = { browser() { return { async newBrowserCDPSession() { return { async send(method) { calls.push(method); throw new Error('Authored unsupported native installation'); } }; } }; }, async close() { closed++; } };
  const browserType = { async launchPersistentContext(profile, options) {
    assert.equal(profile, '/authored-temp-profile'); assert.equal(options.channel, 'chrome');
    assert.ok(options.args.includes('--enable-unsafe-extension-debugging'));
    assert.equal(options.args.some(value => value.startsWith('--load-extension')), false);
    return context;
  } };
  await assert.rejects(installedChrome({ root: '/authored-package' }, { path: '/authored-temp-profile' }, { origin: 'http://127.0.0.1:1234' }, bounded, browserType), /unsupported native installation/);
  assert.deepEqual(calls, ['Extensions.loadUnpacked']); assert.equal(closed, 1);
});
test('stalled native Chrome attachment preserves deadlines and primary failure', async () => {
  for (const cleanupFails of [false, true]) {
    let closed = 0, primary;
    const labels = [];
    const context = { browser() { return { newBrowserCDPSession() { return new Promise(() => {}); } }; },
      async close() { closed++; if (cleanupFails) throw new Error('Authored cleanup failure'); } };
    const browserType = { async launchPersistentContext() { return context; } };
    const shortDeadline = async (operation, ms, label) => {
      labels.push([label, ms]);
      try { return await bounded(operation, label === 'Native CDP attachment' ? 5 : ms, label); }
      catch (error) { if (label === 'Native CDP attachment') primary = error; throw error; }
    };
    await assert.rejects(installedChrome({ root: '/authored-package' }, { path: '/authored-temp-profile' },
      { origin: 'http://127.0.0.1:1234' }, shortDeadline, browserType), error => {
      assert.match(primary.message, /Native CDP attachment deadline exceeded/);
      if (cleanupFails) {
        assert.equal(error.cause, primary); assert.equal(error.errors[0], primary);
        assert.match(error.errors[1].message, /Authored cleanup failure/);
      } else assert.equal(error, primary);
      assert.equal(error.message, primary.message); return true;
    });
    assert.equal(closed, 1);
    assert.deepEqual(labels, [['Native CDP attachment', 15000], ['Failed installation context close', 20000]]);
  }
});
