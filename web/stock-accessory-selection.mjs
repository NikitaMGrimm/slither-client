import { ownData, stockInteger } from './stock-skin-rules.mjs';

const freeze = Object.freeze;
const geometryKeys = freeze(['forward', 'imageScale', 'pivotX', 'pivotY']);

function unavailable(status, message) {
  const error = new TypeError(`Stock accessory ${status}: ${message}`);
  error.name = 'StockAccessorySelectionError';
  error.status = status;
  throw error;
}

function closed(value, keys) {
  if (value === null || typeof value !== 'object' || value instanceof Promise
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError('Closed own-data accessory record required');
  }
  for (const key of keys) ownData(value, key);
}

/** Check native readiness again before publishing held numeric/source metadata. */
export function assertStockAccessorySource(selection, realm) {
  if (selection === null) return;
  const { source, width, height } = selection;
  if (source == null) unavailable('pending', 'selected source missing');
  const canvas = source instanceof realm.HTMLCanvasElement;
  const Constructor = canvas ? realm.HTMLCanvasElement : realm.HTMLImageElement;
  if (!(source instanceof Constructor)) unavailable('unsupported', 'trusted selected image/canvas required');
  function scalar(key) {
    const own = Object.getOwnPropertyDescriptor(source, key);
    const get = Object.getOwnPropertyDescriptor(Constructor.prototype, key)?.get;
    if ((own && !Object.hasOwn(own, 'value')) || typeof get !== 'function') {
      unavailable('unsupported', `Native accessory scalar required: ${key}`);
    }
    const value = Reflect.apply(get, source, []);
    if (own && !Object.is(own.value, value)) unavailable('unsupported', `Shadowed native accessory scalar: ${key}`);
    return value;
  }
  const nativeWidth = scalar(canvas ? 'width' : 'naturalWidth');
  const nativeHeight = scalar(canvas ? 'height' : 'naturalHeight');
  const complete = canvas ? true : scalar('complete');
  if (typeof complete !== 'boolean' || !Number.isSafeInteger(nativeWidth) || !Number.isSafeInteger(nativeHeight)
    || nativeWidth < 0 || nativeWidth > 65535 || nativeHeight < 0 || nativeHeight > 65535) {
    unavailable('unsupported', 'invalid native selected source dimensions/readiness');
  }
  if (!complete || !nativeWidth || !nativeHeight || !width || !height) unavailable('pending', 'selected source incomplete');
  if (nativeWidth !== width || nativeHeight !== height) unavailable('unsupported', 'selected cached extent differs from native source');
}

/** One explicit selected source, never a cosmetic/catalog lookup or a loader. */
export function readStockAccessorySelection(raw, realm, commitments) {
  try {
    const id = ownData(raw, 'ownAccessory');
    const input = ownData(raw, 'ownAccessorySelection');
    if (id === -1) {
      if (input != null) unavailable('unsupported', 'selection requires its explicit ownAccessory ID');
      return null;
    }
    stockInteger(id, 0, 65535, 'own accessory ID');
    if (input == null) unavailable('pending', 'selected record missing');
    closed(input, ['id', 'geometry', 'source', 'width', 'height']);
    if (!Object.is(ownData(input, 'id'), id)) unavailable('unsupported', 'selected ID mismatch');
    const numeric = ownData(input, 'geometry');
    closed(numeric, geometryKeys);
    const geometry = {};
    for (const key of geometryKeys) {
      const value = ownData(numeric, key);
      const min = key === 'imageScale' ? Number.MIN_VALUE : key === 'forward' ? 0 : -65535;
      const max = key === 'imageScale' ? 256 : key === 'forward' ? 4096 : 65535;
      if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid accessory ${key}`);
      geometry[key] = value;
    }
    const source = ownData(input, 'source');
    const width = stockInteger(ownData(input, 'width'), 0, 65535, 'accessory width');
    const height = stockInteger(ownData(input, 'height'), 0, 65535, 'accessory height');
    const selection = { id, geometry: freeze(geometry), source, width, height };
    assertStockAccessorySource(selection, realm);
    const commitment = commitments.get(source);
    if (commitment?.state !== 'ready') unavailable(commitment?.state ?? 'pending', 'selected source commitment required');
    return freeze({ ...selection, revision: commitment.revision });
  } catch (error) {
    if (error?.name === 'StockAccessorySelectionError') throw error;
    unavailable('unsupported', error.message);
  }
}

/** Content may be revised; selection and its numeric/source binding may not. */
export function sameStockAccessorySelection(left, right) {
  if (left === null || right === null) return left === right;
  return ['id', 'source', 'width', 'height'].every(key => Object.is(left[key], right[key]))
    && geometryKeys.every(key => Object.is(left.geometry[key], right.geometry[key]));
}
