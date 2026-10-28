import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { freshOutput, json, cleanupResources, temporaryProfile, hash } from './browser-common.mjs';
import { auditExtension } from './browser-extension-policy.mjs';
import { extensionFixture } from './browser-extension-fixture.mjs';
import { checkInstalledPreview } from './browser-extension-checks.mjs';

export async function bounded(operation, milliseconds, label) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' deadline exceeded')), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

export async function runExtension(options) {
  const audit = await auditExtension(options.package, options.browser);
  const output = await freshOutput(options.output, [audit.root]);
  const receipt = { kind: 'authored-installed-extension', browser: options.browser, status: 'running', package: audit,
    installed: false, originalExecution: false, canonicalHostNavigation: false,
    mode: options.run ? 'installed-preview' : 'browser-free-package-audit', nodeVersion: process.version, cleanupErrors: [] };
  receipt.driverSourceHashes = await Promise.all(['browser-extension-run.mjs', 'browser-extension-policy.mjs', 'browser-extension-fixture.mjs',
    'browser-extension-checks.mjs', 'browser-extension-chrome.mjs', 'browser-extension-firefox.mjs', 'browser-common.mjs', 'build-extension.mjs', 'repository-policy.mjs', '../extension/game-activation.mjs']
    .map(async file => ({ file, sha256: hash(await fs.readFile(new URL(file, import.meta.url))) })));
  let fixture, profile, driver;
  try {
    if (!options.run) { receipt.status = 'audit-passed'; return { output, receipt }; }
    if (options.browser === 'firefox' && (!options.geckodriver || !options.firefoxBinary)) throw new Error('Firefox requires explicit geckodriver and installed Firefox executable paths');
    fixture = await extensionFixture(); profile = await temporaryProfile(); receipt.ownedProfile = profile.path;
    const backend = options.browser === 'chrome' ? await import('./browser-extension-chrome.mjs') : await import('./browser-extension-firefox.mjs');
    driver = options.browser === 'chrome' ? await backend.installedChrome(audit, profile, fixture, bounded)
      : await backend.installedFirefox(audit, profile, fixture, options);
    receipt.installed = true; receipt.version = driver.version; receipt.installation = driver.installation;
    receipt.observation = await bounded(() => checkInstalledPreview(driver, audit, fixture, output), 90000, 'Installed preview');
    if (driver.errors.length || driver.blocked.length) throw new Error('Installed page errors or external resource attempts');
    if ((await auditExtension(options.package, options.browser)).inventorySha256 !== audit.inventorySha256) throw new Error('Installed package bytes changed');
    receipt.status = 'installed-preview-passed';
  } catch (error) { receipt.status = 'failed'; receipt.error = { name: error.name, message: error.message }; }
  finally {
    receipt.cleanupErrors = await cleanupResources([
      ['installed browser', async () => { if (driver) await bounded(() => driver.close(), 20000, 'Browser close'); }],
      ['deny-only fixture/proxy', async () => { if (fixture) await bounded(() => fixture.close(), 15000, 'Fixture close'); }],
      ['owned profile', async () => { if (profile) await profile.remove(); }],
    ]);
    receipt.pageErrors = driver?.errors ?? []; receipt.blockedPageRequests = driver?.blocked ?? [];
    receipt.deniedProxyRequests = fixture?.denied ?? [];
    receipt.profileRemoved = profile ? !(await fs.stat(profile.path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) : null;
    if (receipt.cleanupErrors.length) receipt.status = 'failed';
    await json(path.join(output, 'extension.json'), receipt);
  }
  return { output, receipt };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { browser: { type: 'string' }, package: { type: 'string' }, output: { type: 'string' },
      'run-installed-preview': { type: 'boolean', default: false }, geckodriver: { type: 'string' }, 'firefox-binary': { type: 'string' } } });
    const result = await runExtension({ ...values, run: values['run-installed-preview'], firefoxBinary: values['firefox-binary'] });
    console.log(JSON.stringify({ status: result.receipt.status, output: result.output, installed: result.receipt.installed, activation: result.receipt.package.policy.activation }));
    if (result.receipt.status === 'failed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
