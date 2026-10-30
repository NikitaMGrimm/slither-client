// Optional startup resources. Each path is attempted once; failures leave Play available.
export async function loadCosmetics({ owner, CosmeticImages, baseUrl, accessory = -1, signal,
  fetch: request = globalThis.fetch, warn = message => console.warn(message) }) {
  let images = new CosmeticImages();
  try {
    for (const path of CosmeticImages.paths()) {
      try {
        const response = await request(new URL(path, baseUrl), { credentials: 'omit', redirect: 'error', signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 4 * 1024 * 1024) throw new Error('Image budget');
            chunks.push(value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        images.add(path, bytes);
      } catch (error) {
        if (signal?.aborted) return;
        warn(`Cosmetic ${path} unavailable: ${String(error)}`);
      }
    }
    const ready = images; images = undefined;
    owner.cosmetics(ready, accessory);
  } finally { images?.free(); }
}
