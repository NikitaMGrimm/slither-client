export const gameOrigins = Object.freeze(['http://slither.io', 'https://slither.io',
  'http://www.slither.io', 'https://www.slither.io']);
export const armKey = '__slitherClientArmV1';
export const gateBuild = 'gamepage-v1';

export function gamePage(value) {
  const url = new URL(value);
  if (!gameOrigins.includes(url.origin) || !['/', '/index.html'].includes(url.pathname)
    || url.search || url.hash || url.username || url.password) throw new Error('Select the supported game home page');
  return url.href;
}

// executeScript serializes this function without its module scope.
export function armDocument(record) {
  const url = new URL(location.href);
  const origins = ['http://slither.io', 'https://slither.io', 'http://www.slither.io', 'https://www.slither.io'];
  if (window !== window.top || !origins.includes(url.origin) || !['/', '/index.html'].includes(url.pathname)
    || url.search || url.hash || url.username || url.password || record.url !== url.href
    || record.schema !== 1 || record.build !== 'gamepage-v1' || !/^[a-f0-9]{32}$/.test(record.id)
    || !Number.isSafeInteger(record.expires) || record.expires <= Date.now() || record.expires > Date.now() + 30000) {
    throw new Error('Game page changed or activation expired');
  }
  sessionStorage.setItem('__slitherClientArmV1', JSON.stringify(record));
  return { schema: 1, id: record.id, url: url.href };
}

/** User-click-only activation. Registers fixed files before arming one reload. */
export async function activateGamePage(api, { now = Date.now, random = bytes => crypto.getRandomValues(bytes) } = {}) {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  if (tabs.length !== 1 || !Number.isInteger(tabs[0].id)) throw new Error('One active game tab required');
  const tab = tabs[0];
  const url = gamePage(tab.url);
  const registration = [
    { id: 'slither-client-game-main-v1', matches: gameOrigins.map(origin => `${origin}/*`),
      js: ['game/gate.js'], runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: false },
    { id: 'slither-client-game-link-v1', matches: gameOrigins.map(origin => `${origin}/*`),
      js: ['game/link.js'], css: ['game/host.css'], runAt: 'document_start', world: 'ISOLATED', allFrames: false, persistAcrossSessions: false },
  ];
  const existing = await api.scripting.getRegisteredContentScripts({ ids: registration.map(entry => entry.id) });
  for (const entry of existing) {
    const expected = registration.find(value => value.id === entry.id);
    if (!expected || Object.entries(expected).some(([key, value]) => JSON.stringify(entry[key]) !== JSON.stringify(value))) {
      throw new Error('Existing game registration differs; reload the extension');
    }
  }
  const missing = registration.filter(entry => !existing.some(value => value.id === entry.id));
  if (missing.length) await api.scripting.registerContentScripts(missing);
  const bytes = new Uint8Array(16);
  random(bytes);
  const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const record = { schema: 1, build: gateBuild, id, url, expires: now() + 30000 };
  const results = await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'MAIN',
    func: armDocument, args: [record] });
  if (results.length !== 1 || results[0].frameId !== 0 || results[0].error
    || results[0].result?.schema !== 1 || results[0].result.id !== id || results[0].result.url !== url) {
    throw new Error('Could not arm the selected game document');
  }
  const current = await api.tabs.get(tab.id);
  if (current.url !== url) throw new Error('Game page navigated before reload');
  await api.tabs.reload(tab.id);
  return Object.freeze({ id, tabId: tab.id });
}
