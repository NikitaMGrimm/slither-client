import fs from 'node:fs/promises';
import path from 'node:path';
import { buildExtension } from './build-extension.mjs';
import { root, hash, within } from './browser-common.mjs';
import { gamePage, gameOrigins } from '../extension/game-activation.mjs';

export function extensionPolicy(manifest, browser) {
  if (!['chrome', 'firefox'].includes(browser)) throw new Error('Select chrome or firefox');
  const matches = gameOrigins.map(origin => origin + '/*');
  const hostPermissions = browser === 'chrome' ? ['https://slither.io/*'] : [];
  const background = browser === 'chrome' ? { service_worker: 'game/profile-worker.mjs', type: 'module' } : null;
  const validBackground = browser === 'chrome'
    ? manifest?.background?.service_worker === background.service_worker
      && manifest.background.type === background.type && Object.keys(manifest.background).length === 2
    : manifest?.background === undefined;
  if (manifest?.manifest_version !== 3 || manifest.action?.default_popup !== 'launcher.html'
    || JSON.stringify(manifest.permissions) !== JSON.stringify(['activeTab', 'scripting'])
    || JSON.stringify(manifest.host_permissions) !== JSON.stringify(browser === 'chrome' ? hostPermissions : undefined)
    || manifest.optional_permissions || manifest.optional_host_permissions || manifest.content_scripts
    || !validBackground || manifest.externally_connectable
    || manifest.web_accessible_resources?.length !== 1
    || JSON.stringify(manifest.web_accessible_resources[0].matches) !== JSON.stringify(matches)) {
    throw new Error('Unchanged, closed MV3 package policy required');
  }
  const csp = manifest.content_security_policy?.extension_pages;
  const expectedCsp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; "
    + "connect-src 'self'" + (browser === 'chrome' ? ' https://slither.io' : '')
    + "; object-src 'none'; base-uri 'none'; form-action 'none'";
  if (csp !== expectedCsp) throw new Error('Closed packaged extension CSP required');
  let rejected = false;
  try { gamePage('http://127.0.0.1:12345/'); } catch { rejected = true; }
  if (!rejected) throw new Error('Loopback activation must remain rejected');
  return { browser, manifestVersion: 3, permissions: [...manifest.permissions], hostPermissions, background, matches, csp,
    activation: 'BLOCKED_OFFLINE: supported game-host and explicit-activation restrictions remain enforced',
    preview: 'Installed extension-origin authored preview; no game-page activation or local-peer connection' };
}

export async function auditExtension(packageDirectory, browser) {
  if (!['chrome', 'firefox'].includes(browser)) throw new Error('Select chrome or firefox');
  const selected = path.resolve(packageDirectory), actual = await fs.realpath(selected);
  if (selected !== actual || path.basename(actual) !== browser
    || !within(await fs.realpath(path.join(root, 'dist/extension')), actual)) throw new Error('Select this checkout’s unchanged built browser package');
  // Existing output is compared byte-for-byte, never rewritten by buildExtension.
  const parent = path.dirname(actual);
  const expected = buildExtension({ projectRoot: root, outputDir: parent });
  const prefix = browser + '/';
  const files = expected.files.filter(entry => entry.path.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path.slice(prefix.length) }));
  const manifest = JSON.parse(await fs.readFile(path.join(actual, 'manifest.json')));
  return { root: actual, browser, policy: extensionPolicy(manifest, browser), files,
    inventorySha256: hash(Buffer.from(JSON.stringify(files))),
    wasmSha256: hash(await fs.readFile(path.join(actual, 'scene/pkg/slither_client_bg.wasm'))) };
}

export function installedIdentity(native, audit) {
  const policy = extensionPolicy(native?.manifest, audit?.policy?.browser);
  const scheme = policy.browser === 'chrome' ? 'chrome-extension://' : 'moz-extension://';
  if (!native?.id || native.manifest?.manifest_version !== 3 || native.manifest.name !== 'SlitherClient'
    || !native.launcherUrl?.endsWith('/launcher.html') || !native.launcherUrl.startsWith(scheme)
    || JSON.stringify(native.manifest.permissions) !== JSON.stringify(audit.policy.permissions)
    || JSON.stringify(policy.hostPermissions) !== JSON.stringify(audit.policy.hostPermissions)
    || JSON.stringify(policy.background) !== JSON.stringify(audit.policy.background)
    || JSON.stringify(native.manifest.web_accessible_resources?.[0]?.matches) !== JSON.stringify(audit.policy.matches)
    || native.manifest.content_security_policy?.extension_pages !== audit.policy.csp) throw new Error('Native installed extension identity/policy rejected');
  return { id: native.id, manifestVersion: 3, launcherUrl: native.launcherUrl, manifestSha256: hash(Buffer.from(JSON.stringify(native.manifest))) };
}
