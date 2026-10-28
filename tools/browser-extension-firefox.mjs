import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { within } from './browser-common.mjs';

async function stopOwnedDriver(child) {
  if (!Number.isInteger(child.pid) || child.pid <= 0) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve));
  if (process.platform === 'win32') {
    // The still-running child handle pins this PID; /T includes only its owned Firefox tree.
    await new Promise((resolve, reject) => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, error => {
      if (error && child.exitCode === null && child.signalCode === null) reject(error); else resolve();
    }));
  } else child.kill();
  let timer;
  try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned driver exit deadline')), 5000); })]); }
  finally { clearTimeout(timer); }
}

export async function webdriverRequest(origin, method, route, body) {
  const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || data.value?.error) throw new Error('WebDriver ' + (data.value?.error ?? response.status));
  return data.value;
}

export async function installedFirefox(audit, profile, fixture, { geckodriver, firefoxBinary }) {
  if (!geckodriver || !firefoxBinary || !path.isAbsolute(geckodriver) || !path.isAbsolute(firefoxBinary)) throw new Error('Explicit absolute geckodriver and installed Firefox executable required');
  await fs.access(geckodriver); await fs.access(firefoxBinary);
  const child = spawn(geckodriver, ['--host', '127.0.0.1', '--port', '0', '--profile-root', profile.path, '--allow-system-access'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', session, origin;
  let launchTimer;
  try {
    origin = await new Promise((resolve, reject) => {
      launchTimer = setTimeout(() => reject(new Error('geckodriver listener deadline')), 15000);
      const read = bytes => {
        log = (log + bytes.toString()).slice(-65536);
        const match = /Listening on 127\.0\.0\.1:(\d+)/.exec(log);
        if (match) resolve('http://127.0.0.1:' + match[1]);
      };
      child.stdout.on('data', read); child.stderr.on('data', read);
      child.once('error', reject); child.once('exit', code => reject(new Error('Owned geckodriver exited ' + code)));
    });
    clearTimeout(launchTimer);
    const proxy = new URL(fixture.origin);
    const created = await webdriverRequest(origin, 'POST', '/session', { capabilities: { alwaysMatch: {
      browserName: 'firefox', acceptInsecureCerts: false,
      'moz:firefoxOptions': { binary: firefoxBinary, prefs: { 'browser.shell.checkDefaultBrowser': false,
        'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': Number(proxy.port),
        'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': Number(proxy.port), 'network.proxy.no_proxies_on': '127.0.0.1',
        'network.dns.disablePrefetch': true, 'network.prefetch-next': false } } } } });
    session = created.sessionId;
    const ownedProfile = await fs.realpath(created.capabilities['moz:profile']);
    if (!within(await fs.realpath(profile.path), ownedProfile)) throw new Error('Firefox profile escaped owned root');
    const command = (method, route, body) => webdriverRequest(origin, method, '/session/' + session + route, body);
    const id = await command('POST', '/moz/addon/install', { path: audit.root, temporary: true });
    await command('POST', '/moz/context', { context: 'chrome' });
    const launcherUrl = await command('POST', '/execute/sync', { script: 'return WebExtensionPolicy.getByID(arguments[0]).getURL("launcher.html");', args: [id] });
    await command('POST', '/moz/context', { context: 'content' });
    const select = handle => command('POST', '/window', { handle });
    return { id, launcherUrl, version: created.capabilities.browserVersion,
      installation: { method: 'Firefox temporary addon API', id, ownedProfile, geckodriverVersion: created.capabilities['moz:geckodriverVersion'], systemAccessForUrlLookup: true }, errors: [], blocked: [],
      async open(url) { const { handle } = await command('POST', '/window/new', { type: 'tab' }); await select(handle); await command('POST', '/url', { url }); return handle; },
      async evaluate(handle, fn, argument) { await select(handle); return command('POST', '/execute/async', {
        script: 'const done=arguments[arguments.length-1];Promise.resolve((' + fn.toString() + ')(arguments[0])).then(v=>done({ok:true,value:v}),e=>done({ok:false,error:String(e)}));', args: [argument ?? null] }).then(result => { if (!result.ok) throw new Error(result.error); return result.value; }); },
      async click(handle, selector) { await select(handle); const element = await command('POST', '/element', { using: 'css selector', value: selector }); await command('POST', '/element/' + element['element-6066-11e4-a52e-4f735466cecf'] + '/click', {}); },
      async findPage(url) { for (const handle of await command('GET', '/window/handles')) { await select(handle); if (await command('GET', '/url') === url) return handle; } return null; },
      async screenshot(handle, file) { await select(handle); await fs.writeFile(file, Buffer.from(await command('GET', '/screenshot'), 'base64'), { flag: 'wx' }); },
      async close() { try { await command('DELETE', ''); } finally { await stopOwnedDriver(child); } } };
  } catch (error) {
    if (session && origin) { try { await webdriverRequest(origin, 'DELETE', '/session/' + session); } catch { /* Preserve setup error; caller records cleanup outcome. */ } }
    await stopOwnedDriver(child); throw error;
  } finally { clearTimeout(launchTimer); }
}
