import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSyntheticBodyResolver } from '../web/synthetic-body.mjs';

// Original synthetic DOM sources; no external artwork, browser or sockets.
class Canvas {
  width = 32; height = 32;
  getContext(kind) { assert.equal(kind, '2d'); return { beginPath() {}, arc() {}, fill() {} }; }
}
class Image {}
const realm = { HTMLCanvasElement: Canvas, HTMLImageElement: Image,
  document: { createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); } } };

test('synthetic body recipes preserve the three exact palette objects and explicit whole sources', () => {
  const palettes = [new Canvas(), new Canvas(), new Canvas()];
  const resolve = createSyntheticBodyResolver(palettes, realm);
  for (let skin = 0; skin < 3; skin++) {
    const result = resolve({ skin, customBytes: new Uint8Array(), cosmetic: 0, x: 0, y: 0 });
    assert.equal(result.status, 'ready');
    assert.equal(result.recipe.basePalette, skin);
    assert.deepEqual(result.recipe.runs, [{ palette: skin, count: 1 }]);
    for (let index = 0; index < 3; index++) {
      const palette = result.recipe.palettes[index];
      assert.equal(palette.variants[0].asset.source, palettes[index]);
      assert.equal(palette.boostGlow.asset.source, palettes[index]);
      assert.equal(palette.variants[0].sourceMode, 'whole');
    }
    assert.equal(result.recipe.effects.length, 3);
    assert.equal(result.recipe.attachment, null);
    assert.equal(result.recipe.eyes.kind, 'standard');
  }
});

test('synthetic recipes reject unseen appearances instead of approximating stock skins', () => {
  const palettes = [new Canvas(), new Canvas(), new Canvas()];
  const resolve = createSyntheticBodyResolver(palettes, realm);
  for (const request of [{ skin: 3 }, { skin: 255 }, { skin: 0, customBytes: Uint8Array.of(7) }, { skin: 1, cosmetic: 4 }]) {
    assert.equal(resolve(request).status, 'unsupported');
  }
  assert.throws(() => createSyntheticBodyResolver(palettes.slice(1), realm), /Three synthetic palettes/);
});
