import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// All DOM doubles and URLs in these tests are synthetic, not official captures.
function syntheticRealm() {
  class HTMLCanvasElement {
    width = 17;
    height = 23;
  }
  class HTMLImageElement {
    width = 31;
    height = 37;
    naturalWidth = 41;
    naturalHeight = 43;
    complete = true;
    currentSrc = 'https://synthetic.invalid/background.png';
    src = 'https://synthetic.invalid/fallback.png';
  }
  return {
    HTMLCanvasElement,
    HTMLImageElement,
    per_color_imgs: [{ kmcs: [new HTMLCanvasElement()] }],
    bg_hex: new HTMLImageElement(),
  };
}

test('import, borrowing, and description do not load, create, render, or export assets', async () => {
  const forbidden = ['fetch', 'WebSocket', 'Image', 'HTMLCanvasElement', 'HTMLImageElement', 'document', 'setTimeout', 'setInterval'];
  const original = new Map(forbidden.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const key of forbidden) {
      Object.defineProperty(globalThis, key, { configurable: true, get() { assert.fail(`unexpected global access: ${key}`); } });
    }
    const bridge = await import('../web/asset-bridge.mjs?synthetic-side-effect-check');
    assert.deepEqual(Object.keys(bridge).sort(), ['borrowReferenceAssets', 'describeBorrowedAssets']);
    const scope = syntheticRealm();
    for (const element of [scope.per_color_imgs[0].kmcs[0], scope.bg_hex]) {
      for (const key of ['getContext', 'getImageData', 'toDataURL', 'toBlob', 'decode', 'cloneNode']) {
        Object.defineProperty(element, key, { get() { assert.fail(`unexpected element access: ${key}`); } });
      }
    }
    const assets = bridge.borrowReferenceAssets(scope);
    assert.equal(assets.generated, scope.per_color_imgs[0].kmcs[0]);
    assert.equal(assets.downloaded, scope.bg_hex);
    assert.equal(bridge.describeBorrowedAssets(assets).downloaded.kind, 'image');
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

const { borrowReferenceAssets, describeBorrowedAssets } = await import('../web/asset-bridge.mjs');

test('three scene palettes borrow their exact existing source and reject other selections', () => {
  const scope = syntheticRealm();
  scope.per_color_imgs.push({ kmcs: [new scope.HTMLCanvasElement()] }, { kmcs: [new scope.HTMLCanvasElement()] });
  for (const palette of [0, 1, 2]) {
    const assets = borrowReferenceAssets(scope, palette);
    assert.equal(assets.generated, scope.per_color_imgs[palette].kmcs[0]);
    assert.equal(assets.downloaded, scope.bg_hex);
  }
  for (const palette of [-1, 3, 0.5, NaN, '1']) assert.throws(() => borrowReferenceAssets(scope, palette), /palettes/);
  delete scope.per_color_imgs[2].kmcs[0];
  assert.throws(() => borrowReferenceAssets(scope, 2), /per_color_imgs\[2\]/);
});

test('preserves exact element identity and leaves frozen source objects unchanged', () => {
  const scope = syntheticRealm();
  const generated = scope.per_color_imgs[0].kmcs[0];
  const downloaded = scope.bg_hex;
  for (const object of [generated, downloaded, scope.per_color_imgs[0].kmcs, scope.per_color_imgs[0], scope.per_color_imgs, scope]) {
    Object.freeze(object);
  }
  const before = [generated, downloaded, scope].map(Object.getOwnPropertyDescriptors);
  const assets = borrowReferenceAssets(scope);
  assert.equal(assets.generated, generated);
  assert.equal(assets.downloaded, downloaded);
  assert.deepEqual([generated, downloaded, scope].map(Object.getOwnPropertyDescriptors), before);
  const expected = {
    generated: { kind: 'canvas', width: 17, height: 23 },
    downloaded: { kind: 'image', width: 31, height: 37, naturalWidth: 41, naturalHeight: 43, sourceUrl: downloaded.currentSrc },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(describeBorrowedAssets(assets))), expected);
  const description = describeBorrowedAssets(assets);
  description.generated.width = 999;
  assert.deepEqual(describeBorrowedAssets(assets), expected);
});

test('rejects missing fixed table entries and unavailable constructors', () => {
  for (const mutate of [
    scope => { delete scope.per_color_imgs; },
    scope => { scope.per_color_imgs = null; },
    scope => { scope.per_color_imgs = []; },
    scope => { delete scope.per_color_imgs[0].kmcs; },
    scope => { scope.per_color_imgs[0].kmcs = []; },
    scope => { delete scope.bg_hex; },
  ]) {
    const scope = syntheticRealm();
    mutate(scope);
    assert.throws(() => borrowReferenceAssets(scope), /not ready: missing/);
  }
  const scope = syntheticRealm();
  scope.HTMLCanvasElement = {};
  assert.throws(() => borrowReferenceAssets(scope), /Unsupported.*constructors/);
  assert.throws(() => borrowReferenceAssets(null), /not ready: missing/);
});

test('rejects plain objects, swapped types, and elements from another realm', () => {
  for (const value of [{ width: 17, height: 23 }, syntheticRealm().per_color_imgs[0].kmcs[0], null]) {
    const scope = syntheticRealm();
    scope.per_color_imgs[0].kmcs[0] = value;
    assert.throws(() => borrowReferenceAssets(scope), /Unsupported.*not a canvas/);
  }
  const scope = syntheticRealm();
  for (const value of [{ complete: true, naturalWidth: 41, naturalHeight: 43 }, syntheticRealm().bg_hex, scope.per_color_imgs[0].kmcs[0]]) {
    scope.bg_hex = value;
    assert.throws(() => borrowReferenceAssets(scope), /Unsupported.*not an image/);
  }
});

test('rejects incomplete, empty, and invalid dimensions even when complete is true', () => {
  const scope = syntheticRealm();
  scope.bg_hex.complete = false;
  assert.throws(() => borrowReferenceAssets(scope), /not ready: bg_hex is not complete/);
  for (const field of ['width', 'height', 'naturalWidth', 'naturalHeight']) {
    for (const value of [0, -1, NaN, Infinity, '41']) {
      const candidate = syntheticRealm();
      candidate.bg_hex[field] = value;
      assert.throws(() => borrowReferenceAssets(candidate), /not ready: image/);
    }
  }
  for (const field of ['width', 'height']) {
    const candidate = syntheticRealm();
    candidate.per_color_imgs[0].kmcs[0][field] = 0;
    assert.throws(() => borrowReferenceAssets(candidate), /not ready: canvas/);
  }
});

test('uses the selected source URL, falling back only to the existing src string', () => {
  const scope = syntheticRealm();
  scope.bg_hex.currentSrc = '';
  assert.equal(describeBorrowedAssets(borrowReferenceAssets(scope)).downloaded.sourceUrl, scope.bg_hex.src);
  scope.bg_hex.src = '';
  assert.throws(() => borrowReferenceAssets(scope), /not ready: bg_hex source URL/);
});

test('reads DOM-style scalar accessors only from the supplied constructor prototype', () => {
  const scope = syntheticRealm();
  for (const [element, Constructor] of [
    [scope.per_color_imgs[0].kmcs[0], scope.HTMLCanvasElement],
    [scope.bg_hex, scope.HTMLImageElement],
  ]) {
    const intermediate = Object.create(Constructor.prototype);
    for (const [key, value] of Object.entries(element)) {
      delete element[key];
      Object.defineProperty(Constructor.prototype, key, { get() { return value; } });
      Object.defineProperty(intermediate, key, { get() { assert.fail('intermediate page getter invoked'); } });
    }
    Object.setPrototypeOf(element, intermediate);
  }
  const description = describeBorrowedAssets(borrowReferenceAssets(scope));
  assert.equal(description.generated.width, 17);
  assert.equal(description.downloaded.naturalHeight, 43);
});

test('does not invoke page accessors or traverse unrelated objects', () => {
  for (const path of ['table', 'entry', 'canvas', 'image']) {
    const scope = syntheticRealm();
    const [object, key] = {
      table: [scope, 'per_color_imgs'],
      entry: [scope.per_color_imgs[0], 'kmcs'],
      canvas: [scope.per_color_imgs[0].kmcs[0], 'width'],
      image: [scope.bg_hex, 'complete'],
    }[path];
    Object.defineProperty(object, key, { get() { assert.fail('page accessor invoked'); } });
    assert.throws(() => borrowReferenceAssets(scope), /Unsupported.*accessor/);
  }
  const scope = syntheticRealm();
  Object.defineProperty(scope, 'unrelated', { get() { assert.fail('unrelated field inspected'); } });
  const assets = borrowReferenceAssets(scope);
  Object.defineProperty(scope.bg_hex, 'src', { get() { assert.fail('description reread an element'); } });
  assert.equal(describeBorrowedAssets(assets).downloaded.kind, 'image');
  const arbitrary = { get generated() { assert.fail('arbitrary input inspected'); } };
  assert.throws(() => describeBorrowedAssets(arbitrary), /expected a bundle/);
});

test('source contains no imports, asset creation, pixel access, or network calls', async () => {
  const source = await readFile(new URL('../web/asset-bridge.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|fetch|WebSocket|XMLHttpRequest|createImage|createCanvas|createElement|getImageData|toDataURL|toBlob|eval)\s*(?:\(|\{)|\bnew\s+(?:Image|HTMLCanvasElement|HTMLImageElement)\b/);
});
