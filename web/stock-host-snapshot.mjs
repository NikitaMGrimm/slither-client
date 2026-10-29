import { createStockCachedAccessory } from './stock-cached-accessory.mjs';

const freeze = Object.freeze;
const typedLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const downloaded = ['kwkbulb', 'pwdbulb', 'playbulb', 'leafbulb', 'swissbulb',
  'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest', 'jmou'];
const slots = ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'jsebi', 'jsepi', 'ecmc', ...downloaded];
const mouthShapes = { ecmc: [48, 48], jmou: [79, 130] };
const families = [
  ['imgs', 'fws', 'fhs', 'fw2s', 'fh2s'], ['oimgs', 'ofws', 'ofhs', 'ofw2s', 'ofh2s'],
  ['gimgs', 'gfws', 'gfhs', 'gfw2s', 'gfh2s'], ['pr_imgs', 'pr_fws', 'pr_fhs', 'pr_fw2s', 'pr_fh2s'],
];

function fail(message, status = 'unsupported') {
  const error = new Error(message);
  error.name = 'StockHostError'; error.status = status;
  throw error;
}
function field(record, key) {
  if (record === null || typeof record !== 'object') fail(`Host record unavailable: ${key}`, 'pending');
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) fail(`Host accessor unsupported: ${key}`);
  return descriptor.value;
}
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) fail(`Invalid host ${label}`);
  return value;
}
function list(value, length, label) {
  if (!Array.isArray(value) || value.length < length || value.length > 4096) fail(`Host array unavailable: ${label}`, 'pending');
  return Array.from({ length }, (_, index) => field(value, String(index)));
}

/** Capture live sources only. No host function, generator, pixel read or artwork load occurs. */
export function createStockHostSnapshot({ realm, observer, readAccessory, resolveAccessoryId, accessorySource }) {
  if (typeof readAccessory !== 'function') throw new TypeError('Native accessory reader required');
  for (const name of ['completed', 'generated', 'painted', 'stamp']) {
    if (typeof observer?.[name] !== 'function') throw new TypeError(`Readiness observer required: ${name}`);
  }
  const Canvas = realm.HTMLCanvasElement, Image = realm.HTMLImageElement;
  const identities = new WeakMap();
  const accessory = createStockCachedAccessory({ realm, readAccessory,
    resolveId: resolveAccessoryId, native: accessorySource });
  let nextIdentity = 0, revision = 0, previous;
  function scalar(source, Constructor, key) {
    const descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, key);
    if (typeof descriptor?.get !== 'function') fail(`Native source getter unavailable: ${key}`);
    const value = Reflect.apply(descriptor.get, source, []);
    const shadow = Object.getOwnPropertyDescriptor(source, key);
    if (shadow && (!Object.hasOwn(shadow, 'value') || !Object.is(shadow.value, value))) fail(`Source shadow unsupported: ${key}`);
    return value;
  }
  return freeze({
    dispose: () => accessory.dispose(),
    assertAccessoryLoad: () => accessory.assertCurrent(),
    capture() {
      if (!observer.completed()) fail('Waiting for host asset construction', 'pending');
      if (field(realm, 'render_mode') !== 2 || field(realm, 'is_mobile') !== false
        || field(realm, 'team_mode') !== false || field(realm, 'choosing_skin') !== false
        || field(realm, 'building_skin') !== false || field(realm, 'testing') !== false) fail('Unsupported host gameplay mode');
      if (field(realm, 'playing') !== false || field(realm, 'connecting') !== false || field(realm, 'ws') != null) {
        fail('Original game session is not quiescent');
      }
      const selected = accessory.capture();
      const host = { nsr: field(realm, 'nsr') };
      if (typeof host.nsr !== 'boolean') fail('Host rotation policy unavailable');
      const mask = field(realm, 'alcsc');
      if (!(mask instanceof Uint8Array) || Reflect.apply(typedLength, mask, []) !== 256) fail('Host custom policy unavailable');
      host.alcsc = new Uint8Array(mask);
      const readiness = [], signature = [host.nsr, Array.from(host.alcsc)];
      const states = new Map();
      function source(value, download = false, imageOnly = false, shape = null) {
        if (value === undefined || value === null) fail('Host source not created', 'pending');
        const canvas = value instanceof Canvas;
        if ((!canvas && !(value instanceof Image)) || (imageOnly && canvas)) fail('Host source realm/type mismatch');
        const Constructor = canvas ? Canvas : Image;
        const width = scalar(value, Constructor, canvas ? 'width' : 'naturalWidth');
        const height = scalar(value, Constructor, canvas ? 'height' : 'naturalHeight');
        const complete = canvas ? true : scalar(value, Image, 'complete');
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0
          || width > 65535 || height > 65535 || typeof complete !== 'boolean') fail('Host intrinsic dimensions invalid');
        if (shape && (!canvas || width !== shape[0] || height !== shape[1])) fail('Incompatible mouth canvas');
        const ready = width > 0 && height > 0 && complete
          && (!canvas || (download ? observer.painted(value) : observer.generated(value)));
        const state = ready ? 'ready' : 'pending';
        if (!identities.has(value)) identities.set(value, ++nextIdentity);
        const stamp = observer.stamp(value);
        const sourceRevision = value === selected?.commitment.source ? selected.commitment.revision
          : `src/${identities.get(value)}/${stamp}/${width}/${height}/${Number(complete)}/${state}`;
        signature.push([identities.get(value), width, height, complete, state, stamp]);
        if (states.has(value) && states.get(value) !== state) fail('Conflicting host source commitments');
        if (!states.has(value)) { states.set(value, state); readiness.push(freeze({ source: value, state, revision: sourceRevision })); }
        if (readiness.length > 4096) fail('Host source budget exceeded');
        return value;
      }
      const paletteInput = field(realm, 'per_color_imgs');
      if (!Array.isArray(paletteInput) || paletteInput.length !== 42) fail('Host palette construction incomplete', 'pending');
      host.per_color_imgs = freeze(list(paletteInput, 42, 'palettes').map((record, index) => {
        const variants = index === 36 ? 60 : 7;
        const entry = { klp: field(record, 'klp'),
          kmcs: freeze(list(field(record, 'kmcs'), variants, 'body variants').map(value => source(value))),
          kfmc: source(field(record, 'kfmc')) };
        if (field(record, 'kmcs').length !== variants || entry.klp !== (index !== 36)) fail('Unsupported host variant policy');
        if (index <= 9) {
          entry.ic = count(field(record, 'ic'), 'food count');
          signature.push(entry.ic);
          for (const [images, ...metrics] of families) {
            if (images === 'pr_imgs' && index === 9) continue;
            const amount = images === 'pr_imgs' ? count(field(record, images)?.length, 'prey count') : entry.ic;
            // Prey glows may have an independent count, beyond food's selectable prefix.
            const length = images === 'gimgs' && index <= 8 ? count(field(record, images)?.length, 'glow count') : amount;
            if (length < amount) fail('Host food glow prefix unavailable');
            entry[images] = freeze(list(field(record, images), length, images).map(value => source(value)));
            for (const metric of metrics) {
              entry[metric] = freeze(list(field(record, metric), length, metric).map(value => {
                if (!Number.isFinite(value)) fail(`Invalid declared metric: ${metric}`);
                signature.push(Object.is(value, -0) ? '-0' : value);
                return value;
              }));
            }
          }
        }
        return freeze(entry);
      }));
      for (const name of slots) host[name] = source(field(realm, name), downloaded.includes(name), false, mouthShapes[name]);
      const background = source(field(realm, 'bg_hex'), false, true);
      if (selected) {
        source(selected.commitment.source);
        const record = selected.ownCachedAccessorySelection;
        signature.push([record.id, record.width, record.height, selected.commitment.revision,
          ...Object.values(record.geometry).map(value => Object.is(value, -0) ? '-0' : value)]);
      }
      const encoded = JSON.stringify(signature);
      if (encoded !== previous) { previous = encoded; revision++; }
      return freeze({ revision, normalGameplay: true, ownAccessory: selected?.ownAccessory ?? -1,
        ...(selected ? { appearanceMode: 'accessory', ownCachedAccessorySelection: selected.ownCachedAccessorySelection } : {}), host: freeze(host),
        readiness: freeze(readiness), background,
        palettes: freeze(host.per_color_imgs.slice(0, 3).map(entry => {
          if (!(entry.kmcs[0] instanceof Canvas)) fail('Canvas renderer context required');
          return entry.kmcs[0];
        })),
      });
    },
  });
}
