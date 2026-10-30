// ORIGINAL SYNTHETIC browser startup/decoder doubles; no artwork, browser or GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCosmetics } from '../web/cosmetics.mjs';

for (const failure of ['missing', 'corrupt']) {
  test(`${failure} image warns once and browser startup still reaches Play`, async () => {
    const paths = ['s/a_cap.png', 's/a_hardhat.png', 's/jmou3.png'];
    const attempts = [], warnings = []; let freed = 0, published, plays = 0;
    class Images {
      sources = new Map();
      static paths() { return paths; }
      add(path, bytes) {
        if (bytes[0] !== 1) throw new Error('Synthetic decoder rejected corrupt bytes');
        this.sources.set(path, bytes);
      }
      free() { freed++; }
    }
    const owner = {
      cosmetics(images) { published = images.sources; images.free(); },
      play() { plays++; },
    };
    await loadCosmetics({ owner, CosmeticImages: Images, baseUrl: 'http://127.0.0.1/cosmetics/',
      fetch: async url => {
        const path = url.pathname.slice('/cosmetics/'.length); attempts.push(path);
        if (path === 's/a_hardhat.png') {
          if (failure === 'missing') return new Response(null, { status: 404 });
          return new Response(Uint8Array.of(0));
        }
        return new Response(Uint8Array.of(1));
      }, warn: message => warnings.push(message) });
    owner.play();
    assert.equal(plays, 1);
    assert.deepEqual(attempts, paths);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /s\/a_hardhat\.png/);
    assert.deepEqual([...published.keys()], ['s/a_cap.png', 's/jmou3.png']);
    assert.equal(freed, 1);
  });
}
