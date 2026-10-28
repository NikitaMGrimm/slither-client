import { installedIdentity } from './browser-extension-policy.mjs';

export async function waitUntil(read, predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(label + ' deadline exceeded');
}

// Callable checks, independent of browser installation/launch. No replacement UI runner.
export async function checkInstalledPreview(driver, audit, fixture, output) {
  await driver.open(fixture.origin + '/');
  const launcher = await driver.open(driver.launcherUrl);
  const identity = installedIdentity(await driver.evaluate(launcher, () => {
    const api = window.browser ?? window.chrome;
    return { id: api.runtime.id, manifest: api.runtime.getManifest(), launcherUrl: api.runtime.getURL('launcher.html') };
  }), audit);
  if (identity.id !== driver.id || identity.launcherUrl !== driver.launcherUrl) throw new Error('Installed package/runtime identity differs');
  const rejection = await driver.evaluate(launcher, async local => {
    const api = window.browser ?? window.chrome;
    const { gamePage } = await import(api.runtime.getURL('game/activation.mjs'));
    let rejected = false;
    try { gamePage(local); } catch { rejected = true; }
    return { rejected, registrations: (await api.scripting.getRegisteredContentScripts()).length };
  }, fixture.origin + '/');
  if (!rejection.rejected || rejection.registrations !== 0) throw new Error('Installed policy probe changed the activation boundary');
  await driver.click(launcher, '#preview');
  const previewUrl = new URL('scene/animated.html', identity.launcherUrl).href;
  const preview = await waitUntil(() => driver.findPage(previewUrl), value => value !== null, 'Native preview tab');
  const result = await waitUntil(() => driver.evaluate(preview, () => {
    const canvas = document.querySelector('#scene');
    return { report: window.slitherAnimatedSceneReport ?? null, status: document.querySelector('#status')?.textContent,
      resetEnabled: document.querySelector('#reset')?.disabled === false,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      resources: performance.getEntriesByType('resource').map(entry => entry.name), url: location.href };
  }), value => value.report?.wasmExecuted === true && value.report.renders >= 2, 'Installed Wasm preview');
  if (result.url !== previewUrl || !result.resetEnabled || result.report.mode !== 'synthetic' || result.report.connected
    || result.report.retainedPreys < 3 || !result.canvas?.width || !result.canvas?.height
    || result.resources.some(url => !url.startsWith(new URL(previewUrl).protocol + '//' + new URL(previewUrl).host + '/') && !url.startsWith('data:'))) throw new Error('Installed synthetic preview controls/resources rejected');
  await driver.screenshot(preview, output + '/preview.png');
  return { identity, rejection: { ...rejection, scope: 'Packaged policy export in native installed context; not action-popup activation acceptance' },
    preview: result, activation: audit.policy.activation,
    limits: 'Installed unpacked/temporary MV3 preview only; no canonical-host MAIN/ISOLATED gate, host CSP, source readiness, default game, profile acquisition or server acceptance.' };
}
