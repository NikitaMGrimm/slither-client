import { activateGamePage } from './game/activation.mjs';

const api = globalThis.browser ?? globalThis.chrome;
const buttons = ['activate', 'preview'].map(id => document.getElementById(id));
function bind(id, action) {
  document.getElementById(id).addEventListener('click', async () => {
    for (const button of buttons) button.disabled = true;
    try { await action(); window.close(); }
    catch (error) {
      document.getElementById('status').textContent = `SlitherClient: ${String(error)}`;
      for (const button of buttons) button.disabled = false;
    }
  });
}
bind('activate', () => activateGamePage(api));
bind('preview', () => api.tabs.create({ url: api.runtime.getURL('scene/animated.html') }));
