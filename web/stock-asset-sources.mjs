import { ownData, stockInteger } from './stock-skin-rules.mjs';

const freeze = Object.freeze;

function revision(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  return stockInteger(value, 0, Number.MAX_SAFE_INTEGER, 'entity revision');
}

function unavailable(status) {
  const error = new Error(`Stock entity assets ${status}`);
  error.name = 'StockEntityAssetError';
  error.status = status;
  throw error;
}

function array(value, min, max, label) {
  if (!Array.isArray(value)) throw new TypeError(`Expected ${label} array`);
  stockInteger(ownData(value, 'length'), min, max, `${label} length`);
  return value;
}

function metric(value, half) {
  if (!Number.isFinite(value) || (half ? value < 0 : value <= 0)) throw new RangeError('Invalid declared entity metric');
  return value;
}

/** Shared synchronous borrower; no capture or DOM registry survives a resolve. */
export function createStockSourceAccess({ realm, snapshotForOperation, random }) {
  const Canvas = ownData(realm, 'HTMLCanvasElement');
  const Image = ownData(realm, 'HTMLImageElement');
  if (typeof Canvas !== 'function' || typeof Image !== 'function'
    || typeof snapshotForOperation !== 'function' || typeof random !== 'function') {
    throw new TypeError('Trusted entity source capabilities required');
  }
  function getter(Constructor, key) {
    const read = Object.getOwnPropertyDescriptor(Constructor.prototype, key)?.get;
    if (typeof read !== 'function') throw new TypeError(`Native entity scalar unavailable: ${key}`);
    return read;
  }
  const getters = freeze({ canvas: freeze([getter(Canvas, 'width'), getter(Canvas, 'height')]),
    image: freeze([getter(Image, 'naturalWidth'), getter(Image, 'naturalHeight'), getter(Image, 'complete')]) });
  function shape(source) {
    const kind = source instanceof Canvas ? 'canvas' : source instanceof Image ? 'image' : null;
    if (kind === null) throw new TypeError('Existing entity source in the trusted realm required');
    const keys = kind === 'canvas' ? ['width', 'height'] : ['naturalWidth', 'naturalHeight', 'complete'];
    const values = keys.map((key, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new TypeError(`Accessor unsupported: ${key}`);
      const native = Reflect.apply(getters[kind][index], source, []);
      if (descriptor && !Object.is(descriptor.value, native)) throw new TypeError(`Shadowed native entity scalar: ${key}`);
      return native;
    });
    const width = stockInteger(values[0], 0, 65535, 'intrinsic entity width');
    const height = stockInteger(values[1], 0, 65535, 'intrinsic entity height');
    const complete = kind === 'canvas' ? true : values[2];
    if (typeof complete !== 'boolean') throw new TypeError('Native entity image completeness required');
    if (!complete || width === 0 || height === 0) unavailable('pending');
    return freeze({ kind, width, height });
  }
  function readiness(raw) {
    const entries = array(ownData(raw, 'readiness'), 0, 4096, 'entity readiness');
    const states = new Map();
    for (let index = 0; index < entries.length; index++) {
      const entry = ownData(entries, String(index));
      const source = ownData(entry, 'source');
      if (!(source instanceof Canvas) && !(source instanceof Image)) throw new TypeError('Invalid readiness source');
      const state = ownData(entry, 'state');
      if (!['ready', 'pending', 'unsupported'].includes(state)) throw new TypeError('Invalid entity readiness state');
      const version = revision(ownData(entry, 'revision'));
      const prior = states.get(source);
      if (prior && (prior.state !== state || !Object.is(prior.revision, version))) {
        throw new TypeError('Conflicting entity source readiness or revision');
      }
      states.set(source, freeze({ state, revision: version }));
    }
    return states;
  }
  let busy = false;
  return function withSnapshot(operation, build) {
    if (busy) throw new Error('Stock entity adapter reentry');
    busy = true;
    try {
      const version = revision(ownData(operation, 'revision'));
      const raw = snapshotForOperation(operation);
      if (!Object.is(revision(ownData(operation, 'revision')), version)
        || !Object.is(revision(ownData(raw, 'revision')), version)) throw new TypeError('Entity operation revision mismatch');
      if (ownData(raw, 'normalGameplay') !== true || ownData(raw, 'ownAccessory') !== -1) {
        throw new TypeError('Ordinary desktop entity capture required');
      }
      const palettes = array(ownData(ownData(raw, 'host'), 'per_color_imgs'), 42, 42, 'stock palette');
      const states = readiness(raw);
      const assets = new Map();
      function borrow(source) {
        if (source === null || source === undefined) unavailable('pending');
        if (!(source instanceof Canvas) && !(source instanceof Image)) throw new TypeError('Invalid entity source');
        const commitment = states.get(source);
        if (commitment?.state !== 'ready') unavailable(commitment?.state ?? 'pending');
        const current = shape(source);
        const prior = assets.get(source);
        if (prior) {
          if (prior.kind !== current.kind || prior.width !== current.width || prior.height !== current.height) {
            throw new TypeError('Incoherent aliased entity dimensions');
          }
          return prior;
        }
        // Catalog churn must not relabel raster objects retained by existing entities.
        const asset = freeze({ source, ...current, status: 'ready', revision: commitment.revision });
        assets.set(source, asset);
        return asset;
      }
      const result = build(freeze({
        palette(color) { return ownData(palettes, String(color)); },
        count(record, key) {
          return ownData(array(ownData(record, key), 1, 4096, key), 'length');
        },
        family(record, slots, count) {
          const arrays = slots.map(key => array(ownData(record, key), count, 0xffff_ffff, key));
          return freeze(Array.from({ length: count }, (_, index) => {
            const [source, width, height, halfWidth, halfHeight] = arrays.map(values => ownData(values, String(index)));
            return freeze({ asset: borrow(source), width: metric(width, false), height: metric(height, false),
              halfWidth: metric(halfWidth, true), halfHeight: metric(halfHeight, true) });
          }));
        },
      }));
      const unit = () => {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Invalid entity random unit');
        return value;
      };
      const units = [unit(), unit()];
      if (!Object.is(revision(ownData(operation, 'revision')), version)
        || !Object.is(revision(ownData(raw, 'revision')), version)) throw new TypeError('Entity revision changed during factory');
      const finalStates = readiness(raw);
      for (const [source, asset] of assets) {
        const commitment = finalStates.get(source);
        if (commitment?.state !== 'ready') unavailable(commitment?.state ?? 'pending');
        if (!Object.is(commitment.revision, asset.revision)) throw new TypeError('Entity source revision changed during factory');
        const current = shape(source);
        if (current.kind !== asset.kind || current.width !== asset.width || current.height !== asset.height) {
          throw new TypeError('Entity dimensions changed during factory');
        }
      }
      return freeze({ palette: result, units: freeze(units) });
    } finally {
      busy = false;
    }
  };
}

export function entityPalette(request, food) {
  const raw = stockInteger(ownData(request, 'rawColor'), 0, 255, 'raw entity color');
  const color = food && raw <= 9 ? raw : raw % 9;
  if (ownData(request, 'palette') !== color) throw new TypeError('Entity request palette mismatch');
  return color;
}
