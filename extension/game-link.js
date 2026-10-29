// Isolated-world loader: fixed package URL, typed status only, no host commands.
(() => {
  'use strict';
  if (window !== window.top) return;
  const url = new URL(location.href);
  const home = url.origin === 'http://slither.com' ? url.pathname === '/io'
    : ['http://slither.io', 'https://slither.io', 'http://www.slither.io', 'https://www.slither.io'].includes(url.origin)
      && ['/', '/index.html'].includes(url.pathname);
  if (!home || url.search || url.hash || url.username || url.password) return;
  const api = globalThis.browser ?? globalThis.chrome;
  const privateProfile = url.href === 'http://slither.com/io'
    && api.runtime.getManifest?.().background?.service_worker === 'game/profile-worker.mjs';
  let authority;
  let profileReady = false, pendingWake = false, ended = false;
  const pendingKeys = new Set();
  function privateRequest(type) {
    if (!authority) return Promise.resolve(false);
    const copy = Array.from(authority); pendingKeys.add(copy);
    try {
      return api.runtime.sendMessage({ type, schema: 1, activationId: activation, authority: copy })
        .finally(() => { copy.fill(0); pendingKeys.delete(copy); });
    } catch { copy.fill(0); pendingKeys.delete(copy); return Promise.resolve(false); }
  }
  let loaded = false;
  let activation;
  let timer;
  function failPrivate() {
    profileReady = false; pendingWake = false;
    if (authority) { authority.fill(0); authority = undefined; }
    for (const key of pendingKeys) key.fill(0);
    pendingKeys.clear();
    if (!ended) show('csp-or-module-unavailable', true);
  }
  function startPrivate() {
    loaded = true;
    authority = new Uint8Array(16);
    crypto.getRandomValues(authority);
    void privateRequest('slither-client-profile-bootstrap').then(ok => {
      if (ended) return;
      if (ok === true && authority) {
        profileReady = true;
        if (pendingWake) { pendingWake = false; void privateRequest('slither-client-profile-wake').catch(() => {}); }
      } else failPrivate();
    }, failPrivate);
    timer = setTimeout(() => show('csp-or-module-unavailable', true), 15000);
  }
  function show(code, reveal = false) {
    let output = document.getElementById('slither-client-status');
    if (!output) {
      const root = document.createElement('section'); root.id = 'slither-client-root';
      output = document.createElement('p'); output.id = 'slither-client-status'; output.setAttribute('role', 'status');
      output.className = 'slither-client-loading';
      root.appendChild(output);
      (document.body ?? document.documentElement)?.appendChild(root);
    }
    if (output) {
      if (reveal) output.style.setProperty('display', '');
      // A runtime-owned passive label/progress lease must survive typed status notifications.
      if (reveal || output.firstChild?.localName !== 'label') {
        const fallback = { 'host-unavailable': 'Play unavailable on this page.',
          'csp-or-module-unavailable': 'Play unavailable on this page.', 'gate-unavailable': 'Play unavailable on this page.',
          'client-failed': 'Play failed. Reload to start again.', disposed: 'Not connected.' };
        // Static isolated fallback must work even when the MAIN Wasm module cannot load.
        output.textContent = ['held', 'loading', 'waiting-assets'].includes(code) ? 'Loading client…'
          : fallback[code] ?? `SlitherClient: ${code}`;
      }
    }
    const root = document.getElementById('slither-client-root');
    if (root && !document.getElementById('slither-client-reload')) {
      const reload = document.createElement('button'); reload.id = 'slither-client-reload';
      reload.hidden = true;
      reload.textContent = 'Reload ordinary page';
      reload.addEventListener('click', () => { sessionStorage.removeItem('__slitherClientArmV1'); location.reload(); });
      root.appendChild(reload);
    }
  }
  const codes = new Set(['held', 'loading', 'waiting-assets', 'ready-not-connected', 'connected',
    'disconnected', 'host-unavailable', 'csp-or-module-unavailable', 'client-failed', 'gate-unavailable', 'disposed']);
  function receive(event) {
    const data = event.data;
    if (event.source === window && event.origin === url.origin && url.href === 'http://slither.com/io'
      && activation !== undefined && data && Object.keys(data).length === 3 && data.schema === 1
      && data.activationId === activation && ['slither-client-profile-wake', 'slither-client-profile-cancel'].includes(data.type)
      && privateProfile) {
      // Only the isolated closure adds authority to the private extension channel.
      if (data.type === 'slither-client-profile-wake' && !profileReady) pendingWake = true;
      else void privateRequest(data.type).catch(() => {});
      return;
    }
    if (event.source !== window || event.origin !== url.origin || data === null || typeof data !== 'object'
      || Object.keys(data).length !== 4 || data.type !== 'slither-client-status' || data.schema !== 1
      || !/^[a-f0-9]{32}$/.test(data.id) || !codes.has(data.code)) return;
    if (activation !== undefined && activation !== data.id) return;
    activation = data.id;
    if (data.code === 'held' && !loaded) {
      // Chrome HTTP-com starts only from its own document-start arm read below. A later,
      // possibly page-forged, status never starts key-bearing work.
      if (privateProfile) return;
      const parent = document.head ?? document.documentElement;
      if (!parent) return;
      loaded = true;
      try {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = api.runtime.getURL('game/bootstrap.mjs');
        script.addEventListener('error', () => { clearTimeout(timer); show('csp-or-module-unavailable', true); }, { once: true });
        parent.appendChild(script);
        timer = setTimeout(() => show('csp-or-module-unavailable', true), 15000);
      } catch { show('csp-or-module-unavailable', true); return; }
    }
    if (data.code !== 'held' && data.code !== 'loading' && data.code !== 'waiting-assets') clearTimeout(timer);
    if (loaded || data.code === 'gate-unavailable') show(data.code);
  }
  window.addEventListener('message', receive);
  window.addEventListener('pagehide', () => {
    ended = true;
    profileReady = false; pendingWake = false;
    if (authority) {
      void privateRequest('slither-client-profile-cancel').catch(() => {});
      authority.fill(0); authority = undefined;
      for (const key of pendingKeys) key.fill(0);
      pendingKeys.clear();
    }
    clearTimeout(timer); window.removeEventListener('message', receive);
  }, { once: true });
  // The private gate is installed by browser scripting before MAIN bootstrap;
  // this public record carries only activation metadata, never the key. Accept only
  // arms for which the document-start gate occupies its native capture record.
  if (privateProfile) try {
    const text = sessionStorage.getItem('__slitherClientArmV1');
    const arm = text !== null && text.length <= 512 ? JSON.parse(text) : null;
    if (arm?.schema === 1 && arm.build === 'gamepage-v1' && arm.profileBroker === true && arm.url === url.href
      && /^[a-f0-9]{32}$/.test(arm.id) && Number.isSafeInteger(arm.expires)
      && arm.expires > Date.now() && arm.expires <= Date.now() + 30000) {
      activation = arm.id; startPrivate();
    }
  } catch { /* No valid activation leaves the ordinary page untouched. */ }
  // Both document-start worlds may start in either order; one native tick closes that race.
  window.postMessage({ type: 'slither-client-query', schema: 1 }, url.origin);
  setTimeout(() => window.postMessage({ type: 'slither-client-query', schema: 1 }, url.origin), 0);
  document.addEventListener('DOMContentLoaded', () => window.postMessage({ type: 'slither-client-query', schema: 1 }, url.origin), { once: true });
})();
