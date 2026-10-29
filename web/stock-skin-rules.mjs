// Borrowed-host own-data and typed-byte ABI admission only; numeric skin policy is Rust-owned.
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

/** Copy the request before passing bytes/scalars into the trusted Rust resolver. */
export function readStockSkinRequest(request) {
  const skin = stockInteger(ownData(request, 'skin'), 0, 255, 'skin');
  const cosmetic = ownData(request, 'cosmetic');
  if (cosmetic !== undefined) stockInteger(cosmetic, 0, 255, 'cosmetic');
  const attachmentId = ownData(request, 'attachmentId');
  if (attachmentId !== undefined) stockInteger(attachmentId, 0, 65535, 'attachmentId');
  const input = ownData(request, 'customBytes');
  return freeze({ skin, cosmetic, attachmentId,
    customBytes: input === undefined ? new Uint8Array() : stockBytes(input) });
}
