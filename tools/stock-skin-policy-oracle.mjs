// TEST ONLY: authored pre-Rust-cutover policy oracle. Never shipped or used as a production fallback.
// Original authored selection rules from the private static presentation contract.
// Contains numeric interoperability facts only; no artwork, source or generators.
const freeze = Object.freeze;
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;

export function ownData(record, key) {
  if (record === null || typeof record !== 'object' || record instanceof Promise) throw new TypeError(`Expected record: ${key}`);
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`Accessor unsupported: ${key}`);
  return descriptor.value;
}

export function stockInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}

export function stockBytes(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('Expected Uint8Array');
  stockInteger(Reflect.apply(byteLength, value, []), 0, 255, 'custom byte length');
  return new Uint8Array(value);
}

// Adjacent runs retain the head origin and cycle seam; no expanded body allocation.
function runs(...pairs) {
  return pairs.map(([palette, count = 1]) => ({ palette, count }));
}

function builtin(skin) {
  switch (skin) {
    case 9: return [...Array.from({ length: 11 }, (_, i) => ({ palette: i % 2 ? 9 : 7, count: 1 })), { palette: 10, count: 9 }];
    case 10: return runs([9, 5], [1, 5], [7, 5]);
    case 11: return runs([11, 5], [7, 5], [12, 5]);
    case 12: return runs([7, 5], [9, 5], [13, 5]);
    case 13: return runs([14, 5], [9, 5], [7, 5]);
    case 14: return runs([9, 7], [7, 7]);
    case 15: return Array.from({ length: 9 }, (_, palette) => ({ palette, count: 1 }));
    case 16: return runs([15, 7], [4, 7]);
    case 17: return runs([9, 7], [16, 7]);
    case 18: return runs([7, 7], [9, 7]);
    case 19: return runs([9]);
    case 20: return runs([3, 5], [0, 5]);
    case 21: return runs([3, 7], [18, 6], [20], [19], [20], [19], [20], [19], [20], [18, 6]);
    case 22: return runs([5, 7], [9, 7], [13, 7]);
    case 23: return runs([16, 7], [18, 7], [7, 7]);
    case 24: return runs([23, 9], [18, 9]);
    case 25: return runs([21, 12], [22, 9]);
    case 26: return runs([24]);
    case 27: return runs([25]);
    case 28: return runs([18, 7], [25, 7], [7, 7]);
    case 29: return runs([11, 2], [4], [11, 4], [4], [11, 2]);
    case 30: return runs([10, 2], [19], [20], [10, 2], [20], [19]);
    case 31: return runs([10, 2]);
    case 32: return runs([20, 2]);
    case 33: return runs([12], [11, 2]);
    case 34: return runs([7, 2], [9], [13, 2], [9], [16, 2], [9], [12, 2], [9], [7, 2], [9], [16, 2], [9]);
    case 35: return runs([7, 2], [9, 2], [6, 2], [9, 2]);
    case 36: return runs([16, 2], [9, 2], [15, 2], [9, 2]);
    case 37: return runs([22]);
    case 38: return runs([18]);
    case 39: return runs([23]);
    case 40: return runs([26]);
    case 41: return runs([27]);
    case 42: return runs([2, 8], [3, 8], [5, 8], [7, 8]);
    case 43: return runs([28]);
    case 44: return runs([29]);
    case 45: return runs([7, 3], [9, 8], [7, 3]);
    case 46: return runs([7]);
    case 47: return runs([16, 3], [18, 9], [7, 8], [16, 4]);
    case 48: return runs([7]);
    case 49: return runs([23, 5], [9, 8], [23, 2]);
    case 50: return runs([18, 14], [16, 8], [7, 8]);
    case 51: return runs([7, 3], [9, 2], [16, 6], [9, 2]);
    case 52: return runs([7, 4], [18, 9], [7, 5]);
    case 53: case 54: case 55: case 56: case 57: case 58: return runs([skin - 23]);
    case 59: return runs([18]);
    case 60: return runs([36]);
    case 61: return runs([30, 6], [35, 6], [33, 6], [31, 6], [32, 6], [34, 6]);
    case 62: return runs([17, 5], [39, 5]);
    case 63: return runs([7, 3], [11, 3]);
    case 64: return runs([16, 2], [11, 2]);
    case 65: return runs([4, 4], [9, 4]);
    default: return runs([skin % 9]);
  }
}

export function normalCustomPalette(palette) {
  return palette >= 0 && palette <= 35 || palette === 37 || palette === 39 || palette === 41;
}

function customRuns(bytes) {
  const result = [];
  if (bytes.length < 10) return result;
  for (let offset = 8; offset + 1 < bytes.length; offset += 2) {
    const count = bytes[offset];
    const palette = bytes[offset + 1];
    if (!count || !normalCustomPalette(palette)) continue;
    const previous = result.at(-1);
    if (previous?.palette === palette) previous.count += count;
    else result.push({ palette, count });
  }
  return result;
}

function antenna(skin) {
  let values;
  // Geometry is independent of the borrowed source's backing dimensions.
  switch (skin) {
    case 24: values = [8, 0x00688c, 0x64c8e7, .35, true, false, 'acbulb', -10, -10, 20, 20, 1, .75]; break;
    case 25: values = [9, 0, 0x5630d7, 1, false, true, 'cdbulb', -5, -10, 20, 20, 1.6, 1]; break;
    case 37: values = [9, 0x301400, 0xff6813, .5, true, true, 'kwkbulb', -39, -63, 172, 113, .42, 1]; break;
    case 39: values = [9, 0x1d3245, 0x44d4ff, .43, true, true, 'pwdbulb', -36, -100, 190, 188, .25, 1]; break;
    case 42: values = [9, 0x002828, 0x80d0d0, .5, true, true, 'playbulb', -29, -74, 142, 149, .36, 1]; break;
    // Preserve the binary64 multiplication, negation, subtraction order.
    case 45: values = [9, 0xc02020, 0xff4040, .5, true, true, 'leafbulb', -(101 * .11) - 21, -81, 143, 161, .33, 1]; break;
    case 46: values = [9, 0xc02020, 0xff4040, .5, true, true, 'swissbulb', -(98 * .11) - 21, -70, 140, 140, .285, 1]; break;
    case 47: values = [9, 0x3030ff, 0x6060ff, .5, true, true, 'moldovabulb', -(120 * .11) - 21, -69, 162, 137, .33, 1]; break;
    case 48: values = [9, 0xc02020, 0xff4040, .75, true, true, 'vietnambulb', -(95 * .11) - 21, -71, 137, 142, .3, 1]; break;
    case 49: values = [11, 0x64accf, 0x84dcff, .7, true, true, 'argentinabulb', -(110 * .11) - 21, -76, 152, 152, .3, 1]; break;
    case 59: values = [11, 0x886818, 0xffe040, .55, true, true, 'movbulb', -41, -91, 142, 163, .3, 1]; break;
    case 62: values = [9, 0x402200, 0xffc20f, .5, true, true, 'bonkbulb', -29, -89, 173, 178, .25, 1]; break;
    default: return null;
  }
  const [nodes, outerColor, innerColor, innerOpacity, repeatedInnerStrokes, rotateBulb, source,
    offsetX, offsetY, width, height, scale, opacity] = values;
  return freeze({ source, geometry: freeze({ kind: 'ordinary-chain', nodes, outerColor, innerColor,
    innerOpacity, repeatedInnerStrokes, rotateBulb,
    bulb: freeze({ offsetX, offsetY, width, height, scale, opacity }) }) });
}

/** Normal desktop gameplay only. Wire cosmetics do not select local accessories. */
export function resolveStockSkin(request, nsr = false) {
  const skin = stockInteger(ownData(request, 'skin'), 0, 255, 'skin');
  const cosmetic = ownData(request, 'cosmetic');
  if (cosmetic !== undefined) stockInteger(cosmetic, 0, 255, 'cosmetic');
  const attachment = ownData(request, 'attachmentId');
  if (attachment !== undefined) stockInteger(attachment, 0, 65535, 'attachmentId');
  if (typeof nsr !== 'boolean') throw new TypeError('Explicit nsr policy required');
  const input = ownData(request, 'customBytes');
  const selected = customRuns(input === undefined ? new Uint8Array() : stockBytes(input));
  const custom = selected.length > 0;
  const sequence = custom ? selected : builtin(skin);
  let eyes = { kind: 'standard', distance: 6, separation: 6, radius: 6, pupilRadius: 3.5,
    pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0, outlineColor: 0,
    eyeOpacity: .75, pupilOpacity: 1, angleSmoothing: .12 };
  const chain = custom ? null : antenna(skin);
  let faceDecoration = null;
  const unsupportedFeatures = [];
  if (attachment !== undefined) unsupportedFeatures.push('static-accessory');
  if (!custom) {
    if (chain && skin !== 24) eyes.eyeOpacity = 1;
    switch (skin) {
      case 25: eyes.eyeColor = 0xff5609; break;
      case 27:
        eyes = { kind: 'single-image', geometry: freeze({ baseSize: 29, pupilSize: 14, pupilTravel: 4 }),
          baseImage: freeze({ source: 'jsebi', sourceRect: freeze([0, 0, 64, 64]) }),
          pupilImage: freeze({ source: 'jsepi', sourceRect: freeze([0, 0, 48, 48]) }) };
        break;
      case 40:
        eyes = { kind: 'mouth-face', geometry: freeze({ pupilTravel: 2.3 }),
          eyeMarks: freeze({ source: 'ecmc', sourceMode: 'whole' }),
          mouth: freeze({ source: 'jmou', sourceMode: 'whole' }) };
        break;
      case 41:
        Object.assign(eyes, { distance: 34, separation: 14, radius: 8, pupilRadius: 4.5,
          pupilTravel: 3, outlineWidth: 3, eyeOpacity: 1 });
        faceDecoration = freeze({ kind: 'paired-side-images', source: 'sest', geometry: freeze({
          forward: 13, lateral: 6, lateralBias: .5, rotationOffset: .4, imageScale: .25,
          pivotX: 28, pivotY: 44, width: 105, height: 88 }) });
        break;
      case 44: eyes.eyeColor = 0xd4d4d4; break;
      case 63: Object.assign(eyes, { eyeColor: 0, eyeOpacity: 1, pupilColor: 0xcccccc, pupilRadius: 2.5 }); break;
      case 64: Object.assign(eyes, { eyeColor: 0xffff80, eyeOpacity: 1 }); break;
    }
  }
  const dense = !custom && skin === 60;
  const basePalette = sequence[0].palette;
  return freeze({ skin, custom, basePalette, runs: freeze(sequence.map(freeze)), eyes: freeze(eyes),
    variantMode: custom ? 'first' : basePalette === 36 ? 'cycle' : 'ping-pong',
    variantPeriod: custom ? 1 : basePalette === 36 ? 60 : 7,
    bodyStyle: freeze({ detailedSegments: dense, swell: !custom && skin === 27 ? .06 : 0,
      rotateSegments: !nsr, headFade: dense ? freeze({ palette: 37, length: 30 }) : null,
      tailFade: dense ? freeze({ palette: 38, length: 30 }) : null }),
    faceDecoration, antenna: chain, unsupportedFeatures: freeze(unsupportedFeatures) });
}
