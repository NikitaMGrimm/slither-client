// This action popup owns no client session; the new extension tab owns its lifetime.
(async () => {
  try {
    const api = globalThis.browser ?? globalThis.chrome;
    await api.tabs.create({ url: api.runtime.getURL('scene/animated.html') });
    window.close();
  } catch (error) {
    document.getElementById('status').textContent = `Could not open authored preview: ${String(error)}`;
  }
})();
