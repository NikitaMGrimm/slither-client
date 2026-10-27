import { createSkinProvider } from './skin-provider.mjs';
import { normalCustomPalette, ownData, resolveStockSkin, stockInteger } from './stock-skin-rules.mjs';

// Original live-slot adapter. Host sources are borrowed, never loaded or painted.
const freeze = Object.freeze;
const arrayLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const bulbSlots = freeze(['acbulb', 'cdbulb', 'kwkbulb', 'pwdbulb', 'playbulb', 'leafbulb',
  'swissbulb', 'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest']);
const effectSlots = freeze(['komc', 'ksmc', 'kdmc']);
const eyeSlots = freeze(['jsebi', 'jsepi']);
const mouthShapes = freeze({ ecmc: freeze([48, 48]), jmou: freeze([79, 130]) });

function list(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError(`Incompatible ${label}`);
  return Array.from({ length }, (_, index) => ownData(value, String(index)));
}

function revision(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  return stockInteger(value, 0, Number.MAX_SAFE_INTEGER, 'revision');
}

function sourceShape(source, realm) {
  const canvas = source instanceof realm.HTMLCanvasElement;
  const Constructor = canvas ? realm.HTMLCanvasElement : realm.HTMLImageElement;
  function scalar(key) {
    const own = Object.getOwnPropertyDescriptor(source, key);
    if (own && !Object.hasOwn(own, 'value')) throw new TypeError(`Accessor unsupported: ${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, key);
    if (typeof descriptor?.get !== 'function') throw new TypeError(`Native source scalar unavailable: ${key}`);
    const native = Reflect.apply(descriptor.get, source, []);
    if (own && !Object.is(own.value, native)) throw new TypeError(`Shadowed native source scalar: ${key}`);
    return native;
  }
  const width = stockInteger(scalar(canvas ? 'width' : 'naturalWidth'), 0, 65535, 'source width');
  const height = stockInteger(scalar(canvas ? 'height' : 'naturalHeight'), 0, 65535, 'source height');
  const complete = canvas ? true : scalar('complete');
  if (typeof complete !== 'boolean') throw new TypeError('Native image readiness required');
  return freeze([width, height, complete]);
}

function capture(raw, realm) {
  const version = revision(ownData(raw, 'revision'));
  if (ownData(raw, 'normalGameplay') !== true) throw new TypeError('Ordinary desktop gameplay commitment required');
  if (ownData(raw, 'ownAccessory') !== -1) throw new TypeError('Static accessory unsupported');
  const host = ownData(raw, 'host');
  const nsr = ownData(host, 'nsr');
  if (typeof nsr !== 'boolean') throw new TypeError('Explicit nsr required');
  const mask = ownData(host, 'alcsc');
  if (!(mask instanceof Uint8Array) || Reflect.apply(arrayLength, mask, []) !== 256) throw new TypeError('Normal custom mask required');
  const copiedMask = new Uint8Array(mask);
  for (let i = 0; i < 256; i++) {
    if (copiedMask[i] !== Number(normalCustomPalette(i))) throw new TypeError('Unsupported custom palette policy');
  }
  const readiness = ownData(raw, 'readiness');
  if (!Array.isArray(readiness) || readiness.length > 4096) throw new TypeError('Bounded readiness commitments required');
  const commitments = new Map();
  function sourceObject(source) {
    if (!(source instanceof realm.HTMLCanvasElement) && !(source instanceof realm.HTMLImageElement)) {
      throw new TypeError('Expected existing source in the trusted realm');
    }
    return source;
  }
  for (let index = 0; index < readiness.length; index++) {
    const entry = ownData(readiness, String(index));
    const source = sourceObject(ownData(entry, 'source'));
    const state = ownData(entry, 'state');
    if (!['ready', 'pending', 'unsupported'].includes(state)) throw new TypeError('Invalid readiness commitment');
    const contentRevision = revision(ownData(entry, 'revision'));
    const prior = commitments.get(source);
    if (prior && (prior.state !== state || !Object.is(prior.revision, contentRevision))) throw new TypeError('Conflicting source readiness');
    commitments.set(source, freeze({ state, revision: contentRevision }));
  }
  const catalog = [];
  const shapes = [];
  const ids = new Map();
  function borrow(source) {
    if (source === undefined || source === null) {
      catalog.push(freeze({ source: null, state: 'pending' }));
      shapes.push(null);
      return catalog.length - 1;
    }
    sourceObject(source);
    if (ids.has(source)) return ids.get(source);
    const id = catalog.length;
    ids.set(source, id);
    // Uncommitted sources remain pending; a ready live use never borrows a
    // capture-wide revision as a substitute for its explicit content token.
    catalog.push(freeze({ source, ...(commitments.get(source) ?? { state: 'pending' }) }));
    shapes.push(sourceShape(source, realm));
    return id;
  }
  const palettes = list(ownData(host, 'per_color_imgs'), 42, 'palette table').map((entry, palette) => {
    const count = palette === 36 ? 60 : 7;
    if (ownData(entry, 'klp') !== (palette !== 36)) throw new TypeError('Incompatible variant policy');
    return freeze({ variants: freeze(list(ownData(entry, 'kmcs'), count, 'variant family').map(borrow)),
      glow: borrow(ownData(entry, 'kfmc')) });
  });
  const slots = {};
  for (const name of [...effectSlots, ...bulbSlots, ...eyeSlots, ...Object.keys(mouthShapes)]) {
    const source = ownData(host, name);
    slots[name] = borrow(source);
    const shape = mouthShapes[name];
    if (shape && source != null && (!(source instanceof realm.HTMLCanvasElement)
      || !shape.every((value, i) => value === shapes[slots[name]][i]))) {
      throw new TypeError(`Incompatible mouth canvas: ${name}`);
    }
  }
  return freeze({ revision: version, nsr, palettes: freeze(palettes), slots: freeze(slots),
    assetCatalog: freeze(catalog), shapes: freeze(shapes) });
}

function hostRecipe(rule, snapshot) {
  if (rule.unsupportedFeatures.length) return { status: 'unsupported' };
  const selected = new Map();
  const palettes = [];
  const referenced = new Set();
  function use(asset) { referenced.add(asset); return { asset }; }
  function palette(id, full) {
    if (!selected.has(id)) {
      selected.set(id, palettes.length);
      const family = snapshot.palettes[id];
      palettes.push({ variants: (full && !rule.custom ? family.variants : [family.variants[0]]).map(use),
        ...(full ? { boostGlow: use(family.glow) } : {}) });
    }
    return selected.get(id);
  }
  const basePalette = palette(rule.basePalette, true);
  const runs = rule.runs.map(run => ({ palette: palette(run.palette, true), count: run.count }));
  const fade = value => value === null ? null : { palette: palette(value.palette, false), length: value.length };
  const bodyStyle = { ...rule.bodyStyle, headFade: fade(rule.bodyStyle.headFade), tailFade: fade(rule.bodyStyle.tailFade) };
  const effects = ['outline', 'shadow', 'death-highlight'].map((kind, i) => ({ kind, ...use(snapshot.slots[effectSlots[i]]), opacity: 1 }));
  const decoration = rule.faceDecoration;
  const faceDecoration = decoration ? { kind: decoration.kind, geometry: decoration.geometry,
    image: use(snapshot.slots[decoration.source]) } : null;
  const chain = rule.antenna;
  const antenna = chain ? { kind: 'ordinary-chain', geometry: chain.geometry,
    image: { ...use(snapshot.slots[chain.source]), sourceMode: 'whole' } } : null;
  const eyes = rule.eyes.kind === 'mouth-face'
    ? { kind: 'mouth-face', geometry: rule.eyes.geometry,
      eyeMarks: { ...use(snapshot.slots[rule.eyes.eyeMarks.source]), sourceMode: 'whole' },
      mouth: { ...use(snapshot.slots[rule.eyes.mouth.source]), sourceMode: 'whole' } }
    : rule.eyes.kind === 'single-image'
    ? { kind: 'single-image', geometry: rule.eyes.geometry,
      baseImage: { ...use(snapshot.slots[rule.eyes.baseImage.source]), sourceRect: rule.eyes.baseImage.sourceRect },
      pupilImage: { ...use(snapshot.slots[rule.eyes.pupilImage.source]), sourceRect: rule.eyes.pupilImage.sourceRect } }
    : rule.eyes;
  const states = [...referenced].map(id => snapshot.assetCatalog[id].state);
  // The generic provider may infer an image's native readiness. Explicit host
  // commitments still gate this adapter, including committed canvas painting.
  const status = states.includes('unsupported') ? 'unsupported' : states.includes('pending') ? 'pending' : 'ready';
  if (status !== 'ready') return { status };
  return { status, basePalette, custom: rule.custom, runs, palettes,
    variantMode: rule.variantMode, variantPeriod: rule.variantPeriod, eyes,
    effects, bodyStyle, faceDecoration, antenna, attachment: null, unsupportedFeatures: [] };
}

/** Trusted main-world borrowing seam; see the private controller binding API. */
export function createStockSkinAdapter({ realm, readSnapshot, random }) {
  const constructors = freeze({ HTMLCanvasElement: ownData(realm, 'HTMLCanvasElement'),
    HTMLImageElement: ownData(realm, 'HTMLImageElement') });
  if (typeof constructors.HTMLCanvasElement !== 'function' || typeof constructors.HTMLImageElement !== 'function'
    || typeof readSnapshot !== 'function' || typeof random !== 'function') throw new TypeError('Trusted stock capabilities required');
  let active = null;
  let busy = false;
  let policy;
  // Numeric signatures retain no source objects between operations. Pixel/content
  // changes still require the trusted owner's explicit revision commitment.
  const identities = new WeakMap();
  let nextIdentity = 0;
  let previousSignature;
  let previousRevision;
  function signature(snapshot) {
    const sources = snapshot.assetCatalog.map(({ source, state, revision }, i) => {
      if (source !== null && !identities.has(source)) identities.set(source, ++nextIdentity);
      const token = typeof revision === 'number' && Object.is(revision, -0) ? ['negative-zero'] : revision;
      return [source === null ? 0 : identities.get(source), state, token, snapshot.shapes[i]];
    });
    const selection = snapshot.palettes.map(family => `${family.variants.join(',')}/${family.glow}`).join('|');
    return JSON.stringify([sources, selection, Object.values(snapshot.slots)]);
  }
  const provider = createSkinProvider({ trusted: true, realm: constructors,
    resolveHostRecipe: request => hostRecipe(resolveStockSkin(request, active.nsr), active),
    normalizeHostRecipe: value => value });

  function guarded(callback) {
    if (busy) throw new Error('Stock adapter reentry');
    busy = true;
    try { return callback(); } finally { busy = false; }
  }
  function current() {
    if (!active) throw new Error('Stock operation required');
    return active;
  }
  return freeze({
    beginOperation() {
      return guarded(() => {
        if (active) throw new Error('Stock operation already active');
        const snapshot = capture(readSnapshot(), constructors);
        if (policy !== undefined && policy !== snapshot.nsr) throw new Error('Appearance policy changed; reset with a new adapter');
        const fingerprint = signature(snapshot);
        if (previousSignature !== undefined && Object.is(previousRevision, snapshot.revision) && previousSignature !== fingerprint) {
          throw new Error('Source or readiness changed without a new revision');
        }
        policy = snapshot.nsr;
        previousSignature = fingerprint;
        previousRevision = snapshot.revision;
        active = snapshot;
        return freeze({ revision: snapshot.revision });
      });
    },
    resolveAppearance(request) {
      return guarded(() => {
        const snapshot = current();
        for (const coordinate of ['x', 'y']) {
          const value = ownData(request, coordinate);
          if (value !== undefined && !Number.isFinite(value)) throw new TypeError('Finite initial head required');
        }
        const rule = resolveStockSkin(request, snapshot.nsr);
        if (rule.unsupportedFeatures.length) throw new TypeError(`Unsupported stock appearance: ${rule.unsupportedFeatures.join(', ')}`);
        const face = ['single-image', 'mouth-face'].includes(rule.eyes.kind)
          ? freeze({ kind: rule.eyes.kind, geometry: rule.eyes.geometry })
          : freeze({ kind: 'paired', eyes: rule.eyes, decoration: rule.faceDecoration
            ? freeze({ kind: rule.faceDecoration.kind, geometry: rule.faceDecoration.geometry }) : freeze({ kind: 'none' }) });
        return freeze({ face,
        antenna: rule.antenna?.geometry ?? null });
      });
    },
    resolveRecipe(request) {
      return guarded(() => {
        const snapshot = current();
        for (let i = 0; i < snapshot.assetCatalog.length; i++) {
          const { source } = snapshot.assetCatalog[i];
          if (source === null) continue;
          const now = sourceShape(source, constructors);
          if (!now.every((value, k) => Object.is(value, snapshot.shapes[i][k]))) {
            throw new Error('Source dimensions/readiness changed during operation');
          }
        }
        return provider.resolve(request, snapshot);
      });
    },
    resolveAntennaRandom(request) {
      return guarded(() => {
        current();
        const nodes = ownData(request, 'nodeCount');
        if (![8, 9, 11].includes(nodes) || ownData(request, 'randomPairCount') !== nodes - 1) throw new TypeError('Invalid antenna random request');
        const tape = new Float64Array(2 * (nodes - 1));
        for (let i = 0; i < tape.length; i++) {
          const unit = random();
          if (!Number.isFinite(unit) || unit < 0 || unit >= 1) throw new RangeError('Invalid antenna random unit');
          tape[i] = unit;
        }
        return tape;
      });
    },
    endOperation() {
      return guarded(() => { current(); active = null; });
    },
  });
}
