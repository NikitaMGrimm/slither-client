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
  let loaded = false;
  let activation;
  let timer;
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
    if (event.source !== window || event.origin !== url.origin || data === null || typeof data !== 'object'
      || Object.keys(data).length !== 4 || data.type !== 'slither-client-status' || data.schema !== 1
      || !/^[a-f0-9]{32}$/.test(data.id) || !codes.has(data.code)) return;
    if (activation !== undefined && activation !== data.id) return;
    activation = data.id;
    if (data.code === 'held' && !loaded) {
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
  window.addEventListener('pagehide', () => { clearTimeout(timer); window.removeEventListener('message', receive); }, { once: true });
  // Both document-start worlds may start in either order; one native tick closes that race.
  window.postMessage({ type: 'slither-client-query', schema: 1 }, url.origin);
  setTimeout(() => window.postMessage({ type: 'slither-client-query', schema: 1 }, url.origin), 0);
  document.addEventListener('DOMContentLoaded', () => window.postMessage({ type: 'slither-client-query', schema: 1 }, url.origin), { once: true });
})();
