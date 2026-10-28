import { chromium } from 'playwright';
import fs from 'node:fs/promises';

export async function installedChrome(audit, profile, fixture, bounded, browserType = chromium) {
  const context = await browserType.launchPersistentContext(profile.path, { channel: 'chrome', headless: false,
    viewport: { width: 1280, height: 800 }, serviceWorkers: 'block',
    proxy: { server: fixture.origin, bypass: '127.0.0.1' },
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-gpu', '--enable-unsafe-swiftshader'],
    args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check'], timeout: 30000 });
  try {
    const browser = context.browser();
    const cdp = await bounded(() => browser.newBrowserCDPSession(), 15000, 'Native CDP attachment');
    const { id } = await bounded(() => cdp.send('Extensions.loadUnpacked', { path: audit.root }), 15000, 'Extension installation');
    const listing = await bounded(() => cdp.send('Extensions.getExtensions'), 15000, 'Native extension inventory');
    const installed = listing.extensions.find(extension => extension.id === id && extension.enabled);
    if (!installed || await fs.realpath(installed.path) !== audit.root) throw new Error('CDP did not attest the installed package');
    const launcherUrl = 'chrome-extension://' + id + '/launcher.html', allowed = new URL(launcherUrl);
    const errors = [], blocked = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if ((url.protocol === allowed.protocol && url.host === allowed.host) || url.origin === fixture.origin || url.protocol === 'data:') return route.continue();
      blocked.push({ kind: 'page-http', scheme: url.protocol }); return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => { blocked.push({ kind: 'page-websocket' }); socket.close(); });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    return { id, launcherUrl, version: browser.version(), installation: { method: 'CDP Extensions.loadUnpacked', installed }, errors, blocked,
      async open(url) { const page = await context.newPage(); page.setDefaultTimeout(15000); await page.goto(url); return page; },
      async evaluate(page, fn, argument) { return page.evaluate(fn, argument); },
      async click(page, selector) { await page.locator(selector).click(); },
      async findPage(url) { return context.pages().find(page => page.url() === url) ?? null; },
      async screenshot(page, file) { await page.screenshot({ path: file }); },
      async close() { await context.close(); } };
  } catch (error) {
    try { await bounded(() => context.close(), 20000, 'Failed installation context close'); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], error.message, { cause: error }); }
    throw error;
  }
}
