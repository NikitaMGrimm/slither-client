import fs from 'node:fs/promises';
import path from 'node:path';
import { buildExtension } from './build-extension.mjs';
import { root, hash, within } from './browser-common.mjs';
import { gamePage, gameOrigins } from '../extension/game-activation.mjs';

export function extensionPolicy(manifest) {
  const matches = gameOrigins.map(origin => origin + '/*');
  if (manifest.manifest_version !== 3 || manifest.action?.default_popup !== 'launcher.html'
    || JSON.stringify(manifest.permissions) !== JSON.stringify(['activeTab', 'scripting'])
    || manifest.host_permissions || manifest.optional_host_permissions || manifest.content_scripts
    || manifest.background || manifest.externally_connectable
    || manifest.web_accessible_resources?.length !== 1
    || JSON.stringify(manifest.web_accessible_resources[0].matches) !== JSON.stringify(matches)) {
    throw new Error('Unchanged, closed MV3 package policy required');
  }
  const csp = manifest.content_security_policy?.extension_pages;
  if (typeof csp !== 'string' || !csp.includes("connect-src 'self'")
    || !csp.includes("script-src 'self' 'wasm-unsafe-eval'")
    || /https?:|wss?:|\*|'unsafe-inline'|'unsafe-eval'/.test(csp)) throw new Error('Closed packaged extension CSP required');
  let rejected = false;
  try { gamePage('http://127.0.0.1:12345/'); } catch { rejected = true; }
  if (!rejected) throw new Error('Loopback activation must remain rejected');
  return { manifestVersion: 3, permissions: [...manifest.permissions], matches, csp,
    activation: 'BLOCKED_OFFLINE: canonical host, gate and web-accessible-resource restrictions are unchanged',
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
  return { root: actual, browser, policy: extensionPolicy(manifest), files,
    inventorySha256: hash(Buffer.from(JSON.stringify(files))),
    wasmSha256: hash(await fs.readFile(path.join(actual, 'scene/pkg/slither_client_bg.wasm'))) };
}

export function installedIdentity(native, audit) {
  if (!native?.id || native.manifest?.manifest_version !== 3 || native.manifest.name !== 'SlitherClient'
    || !native.launcherUrl?.endsWith('/launcher.html') || !/^(?:chrome|moz)-extension:\/\//.test(native.launcherUrl)
    || JSON.stringify(native.manifest.permissions) !== JSON.stringify(audit.policy.permissions)
    || JSON.stringify(native.manifest.web_accessible_resources?.[0]?.matches) !== JSON.stringify(audit.policy.matches)
    || native.manifest.content_security_policy?.extension_pages !== audit.policy.csp) throw new Error('Native installed extension identity/policy rejected');
  return { id: native.id, manifestVersion: 3, launcherUrl: native.launcherUrl, manifestSha256: hash(Buffer.from(JSON.stringify(native.manifest))) };
}
