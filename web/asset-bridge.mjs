// Original authored bridge. Only the fixed reference interface names are borrowed.
const descriptions = new WeakMap();

function ownValue(object, key, label) {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function')) {
    throw new Error(`Reference assets not ready: missing ${label}`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) throw new Error(`Reference assets not ready: missing ${label}`);
  if (!Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`Unsupported reference assets: accessor at ${label}`);
  }
  return descriptor.value;
}

function dimension(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Reference assets not ready: ${label} must be positive`);
  }
  return value;
}

function scalar(element, Constructor, key) {
  const own = Object.getOwnPropertyDescriptor(element, key);
  if (own) {
    if (Object.hasOwn(own, 'value')) return own.value;
    throw new TypeError(`Unsupported reference assets: accessor at ${key}`);
  }
  // Read only the supplied realm's DOM scalar accessor, bypassing intermediate
  // page prototypes. The scope and its DOM constructors must be trusted.
  const prototype = ownValue(Constructor, 'prototype', 'DOM prototype');
  const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
  if (descriptor && typeof descriptor.get === 'function') {
    return Reflect.apply(descriptor.get, element, []);
  }
  throw new TypeError(`Unsupported reference assets: DOM scalar unavailable at ${key}`);
}

/** Borrow existing elements from a trusted page realm without loading or rendering. */
export function borrowReferenceAssets(scope = globalThis, palette = 0) {
  if (!Number.isInteger(palette) || palette < 0 || palette > 2) {
    throw new RangeError('Supported scene palettes are 0, 1, and 2');
  }
  const Canvas = ownValue(scope, 'HTMLCanvasElement', 'HTMLCanvasElement');
  const Image = ownValue(scope, 'HTMLImageElement', 'HTMLImageElement');
  if (typeof Canvas !== 'function' || typeof Image !== 'function') {
    throw new TypeError('Unsupported reference assets: DOM constructors unavailable');
  }
  const table = ownValue(scope, 'per_color_imgs', 'per_color_imgs');
  const label = `per_color_imgs[${palette}]`;
  const color = ownValue(table, String(palette), label);
  const canvases = ownValue(color, 'kmcs', `${label}.kmcs`);
  const generated = ownValue(canvases, '0', `${label}.kmcs[0]`);
  const downloaded = ownValue(scope, 'bg_hex', 'bg_hex');
  if (!(generated instanceof Canvas)) {
    throw new TypeError(`Unsupported reference assets: ${label}.kmcs[0] is not a canvas in the supplied realm`);
  }
  if (!(downloaded instanceof Image)) {
    throw new TypeError('Unsupported reference assets: bg_hex is not an image in the supplied realm');
  }
  const generatedDescription = {
    kind: 'canvas',
    width: dimension(scalar(generated, Canvas, 'width'), 'canvas width'),
    height: dimension(scalar(generated, Canvas, 'height'), 'canvas height'),
  };
  if (scalar(downloaded, Image, 'complete') !== true) {
    throw new Error('Reference assets not ready: bg_hex is not complete');
  }
  const downloadedDescription = {
    kind: 'image',
    width: dimension(scalar(downloaded, Image, 'width'), 'image width'),
    height: dimension(scalar(downloaded, Image, 'height'), 'image height'),
    naturalWidth: dimension(scalar(downloaded, Image, 'naturalWidth'), 'image naturalWidth'),
    naturalHeight: dimension(scalar(downloaded, Image, 'naturalHeight'), 'image naturalHeight'),
  };
  const sourceUrl = scalar(downloaded, Image, 'currentSrc') || scalar(downloaded, Image, 'src');
  if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) {
    throw new Error('Reference assets not ready: bg_hex source URL unavailable');
  }
  downloadedDescription.sourceUrl = sourceUrl;
  const assets = Object.freeze({ generated, downloaded });
  descriptions.set(assets, { generated: generatedDescription, downloaded: downloadedDescription });
  return assets;
}

/** Return a fresh metadata snapshot from borrowing; never inspect arbitrary inputs. */
export function describeBorrowedAssets(assets) {
  const description = descriptions.get(assets);
  if (!description) throw new TypeError('Unsupported reference assets: expected a bundle returned by borrowReferenceAssets');
  return {
    generated: { ...description.generated },
    downloaded: { ...description.downloaded },
  };
}
