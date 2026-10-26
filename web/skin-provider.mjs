// Original authored metadata contract. Host callbacks and the supplied realm are trusted.
const freeze = Object.freeze;
const typedArrayLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;

function field(object, key) {
  if (object === null || typeof object !== 'object') throw new TypeError(`Expected record at ${key}`);
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`Accessor unsupported at ${key}`);
  return descriptor.value;
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}

function number(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}

function choice(value, choices, label) {
  if (!choices.includes(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function list(value, min, max, label) {
  if (!Array.isArray(value)) throw new TypeError(`Expected array at ${label}`);
  integer(value.length, min, max, `${label} length`);
  return Array.from({ length: value.length }, (_, i) => field(value, String(i)));
}

function flag(value, label) {
  return choice(value, [true, false], label);
}

function revision(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  return integer(value, 0, Number.MAX_SAFE_INTEGER, 'revision');
}

function requestSnapshot(request) {
  const skin = integer(field(request, 'skin'), 0, 255, 'skin');
  const custom = field(request, 'customBytes');
  let customBytes;
  if (custom !== undefined) {
    if (!(custom instanceof Uint8Array)) throw new TypeError('customBytes must be a Uint8Array');
    integer(Reflect.apply(typedArrayLength, custom, []), 0, 255, 'customBytes length');
    // The host capability receives a copy, never the caller's mutable payload.
    customBytes = new Uint8Array(custom);
  }
  const x = field(request, 'x');
  const y = field(request, 'y');
  if (x !== undefined) number(x, -Number.MAX_VALUE, Number.MAX_VALUE, 'x');
  if (y !== undefined) number(y, -Number.MAX_VALUE, Number.MAX_VALUE, 'y');
  const attachmentId = field(request, 'attachmentId');
  if (attachmentId !== undefined) integer(attachmentId, 0, 65535, 'attachmentId');
  return freeze({ skin, customBytes, x, y, attachmentId });
}

function scalar(element, Constructor, key) {
  const own = Object.getOwnPropertyDescriptor(element, key);
  if (own) {
    if (!Object.hasOwn(own, 'value')) throw new TypeError(`Accessor unsupported at ${key}`);
    return own.value;
  }
  // Bypass intermediate page prototypes; only the trusted DOM prototype is read.
  const descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, key);
  if (typeof descriptor?.get !== 'function') throw new TypeError(`DOM scalar unavailable at ${key}`);
  return Reflect.apply(descriptor.get, element, []);
}

/**
 * Construct a synchronous trusted-host provider. See docs/skin-provider.md for
 * the typed input/output contract. This validates metadata, not callback safety.
 */
export function createSkinProvider({ trusted, realm, resolveHostRecipe, normalizeHostRecipe }) {
  if (trusted !== true) throw new TypeError('Explicit trusted: true is required');
  const Canvas = field(realm, 'HTMLCanvasElement');
  const Image = field(realm, 'HTMLImageElement');
  if (typeof Canvas !== 'function' || typeof Image !== 'function') throw new TypeError('Trusted DOM constructors required');
  if (typeof resolveHostRecipe !== 'function' || typeof normalizeHostRecipe !== 'function') {
    throw new TypeError('Trusted synchronous recipe callbacks required');
  }

  return freeze({
    resolve(request, snapshot) {
      const input = requestSnapshot(request);
      const version = revision(field(snapshot, 'revision'));
      const catalog = list(field(snapshot, 'assetCatalog'), 0, 4096, 'assetCatalog').map(entry => freeze({
        source: field(entry, 'source'),
        state: choice(field(entry, 'state'), ['ready', 'pending', 'unsupported'], 'asset state'),
      }));
      // The adapter owns host-shape mapping. No host member names or recipes live here.
      const raw = resolveHostRecipe(input);
      const normalized = normalizeHostRecipe(raw, input);
      const hostStatus = choice(field(normalized, 'status'), ['ready', 'pending', 'unsupported'], 'recipe status');
      if (hostStatus !== 'ready') return freeze({ schema: 1, revision: version, status: hostStatus, recipe: null });

      const borrowed = new Map();
      function borrow(id) {
        integer(id, 0, catalog.length - 1, 'asset index');
        if (borrowed.has(id)) return borrowed.get(id);
        const { source, state } = catalog[id];
        let kind = null;
        let width = 0;
        let height = 0;
        let status = state;
        if (source === null) {
          if (status === 'ready') status = 'pending';
        } else {
          let Constructor;
          if (source instanceof Canvas) { kind = 'canvas'; Constructor = Canvas; }
          else if (source instanceof Image) { kind = 'image'; Constructor = Image; }
          else throw new TypeError('Asset must be an existing canvas/image in the trusted realm, or null');
          width = integer(scalar(source, Constructor, kind === 'canvas' ? 'width' : 'naturalWidth'), 0, 65535, 'asset width');
          height = integer(scalar(source, Constructor, kind === 'canvas' ? 'height' : 'naturalHeight'), 0, 65535, 'asset height');
          const complete = kind === 'image' ? flag(scalar(source, Image, 'complete'), 'image complete') : true;
          if (status !== 'unsupported') {
            if (!width || !height || !complete) status = 'pending';
            // Images have native readiness; canvases require the adapter's explicit ready state.
            else if (kind === 'image') status = 'ready';
          }
        }
        const asset = freeze({ id, source, kind, width, height, status });
        borrowed.set(id, asset);
        return asset;
      }

      function assetUse(value) {
        const asset = borrow(field(value, 'asset'));
        const rect = field(value, 'sourceRect');
        let sourceRect = null;
        if (rect !== undefined) {
          const values = list(rect, 4, 4, 'sourceRect');
          const [x, y, width, height] = values.map((v, i) => number(v, i < 2 ? 0 : Number.MIN_VALUE, 65535, 'sourceRect'));
          if (asset.width && asset.height) {
            if (x + width > asset.width || y + height > asset.height) throw new RangeError('sourceRect exceeds actual asset dimensions');
            sourceRect = freeze([x, y, width, height]);
          }
        } else if (asset.width && asset.height) sourceRect = freeze([0, 0, asset.width, asset.height]);
        return freeze({ asset, sourceRect });
      }

      const palettes = freeze(list(field(normalized, 'palettes'), 1, 256, 'palettes').map(value => {
        const variants = freeze(list(field(value, 'variants'), 1, 256, 'variants').map(assetUse));
        const glow = field(value, 'boostGlow');
        return freeze({ variants, ...(glow === undefined ? {} : { boostGlow: assetUse(glow) }) });
      }));
      const basePalette = integer(field(normalized, 'basePalette'), 0, palettes.length - 1, 'basePalette');
      const variantMode = choice(field(normalized, 'variantMode'), ['first', 'cycle', 'ping-pong'], 'variantMode');
      const variantPeriod = integer(field(normalized, 'variantPeriod'), 1, 256, 'variantPeriod');
      const custom = flag(field(normalized, 'custom'), 'custom');
      if (custom && variantMode !== 'first') throw new TypeError('Custom recipes require first variant mode');
      const usedPalettes = new Set([basePalette]);
      let total = 0;
      const runs = freeze(list(field(normalized, 'runs'), 1, 256, 'runs').map(value => {
        const palette = integer(field(value, 'palette'), 0, palettes.length - 1, 'run palette');
        const count = integer(field(value, 'count'), 1, 65535, 'run count');
        total += count;
        integer(total, 1, 65535, 'total run count');
        usedPalettes.add(palette);
        return freeze({ palette, count });
      }));
      for (const index of usedPalettes) {
        if (palettes[index].variants.length < variantPeriod) throw new RangeError('Palette lacks the declared variant period');
      }

      const eyeInput = field(normalized, 'eyes');
      const eyeKind = choice(field(eyeInput, 'kind'), ['standard', 'none'], 'eyes kind');
      const eyes = { kind: eyeKind };
      if (eyeKind === 'standard') {
        for (const key of ['distance', 'separation', 'radius', 'pupilRadius', 'pupilTravel', 'outlineWidth']) {
          eyes[key] = number(field(eyeInput, key), 0, 4096, key);
        }
        for (const key of ['eyeColor', 'pupilColor', 'outlineColor']) eyes[key] = integer(field(eyeInput, key), 0, 0xffffff, key);
        for (const key of ['eyeOpacity', 'pupilOpacity', 'angleSmoothing']) eyes[key] = number(field(eyeInput, key), 0, 1, key);
      }

      const effectKinds = new Set();
      const effects = freeze(list(field(normalized, 'effects'), 0, 4, 'effects').map(value => {
        const kind = choice(field(value, 'kind'), ['boost-glow', 'outline', 'shadow', 'death-highlight'], 'effect kind');
        if (effectKinds.has(kind)) throw new TypeError('Duplicate effect kind');
        effectKinds.add(kind);
        return freeze({ kind, ...assetUse(value), opacity: number(field(value, 'opacity'), 0, 1, 'effect opacity') });
      }));
      const styleInput = field(normalized, 'bodyStyle');
      let bodyStyle = null;
      if (styleInput !== undefined && styleInput !== null) {
        function fade(value, label) {
          if (value === null) return null;
          const palette = integer(field(value, 'palette'), 0, palettes.length - 1, `${label} palette`);
          return freeze({ palette, length: number(field(value, 'length'), Number.MIN_VALUE, 65535, `${label} length`) });
        }
        bodyStyle = freeze({
          detailedSegments: flag(field(styleInput, 'detailedSegments'), 'detailedSegments'),
          swell: number(field(styleInput, 'swell'), -4096, 4096, 'swell'),
          rotateSegments: flag(field(styleInput, 'rotateSegments'), 'rotateSegments'),
          headFade: fade(field(styleInput, 'headFade'), 'headFade'),
          tailFade: fade(field(styleInput, 'tailFade'), 'tailFade'),
        });
        for (const index of usedPalettes) {
          if (!palettes[index].boostGlow) throw new TypeError('Standard body style requires boostGlow for every base/run palette');
        }
        for (const kind of ['outline', 'shadow', 'death-highlight']) {
          const effect = effects.find(value => value.kind === kind);
          if (!effect || effect.opacity !== 1) throw new TypeError(`Standard body style requires ${kind} with opacity 1`);
        }
      }
      const attachmentInput = field(normalized, 'attachment');
      let attachment = null;
      if (attachmentInput !== undefined && attachmentInput !== null) {
        attachment = freeze({
          ...assetUse(attachmentInput),
          anchor: choice(field(attachmentInput, 'anchor'), ['head'], 'attachment anchor'),
          scale: number(field(attachmentInput, 'scale'), Number.MIN_VALUE, 256, 'attachment scale'),
          pivotX: number(field(attachmentInput, 'pivotX'), -65535, 65535, 'attachment pivotX'),
          pivotY: number(field(attachmentInput, 'pivotY'), -65535, 65535, 'attachment pivotY'),
          opacity: number(field(attachmentInput, 'opacity'), 0, 1, 'attachment opacity'),
        });
      }
      const unsupportedFeatures = freeze(list(field(normalized, 'unsupportedFeatures'), 0, 256, 'unsupportedFeatures').map(tag => {
        if (typeof tag !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(tag)) throw new TypeError('Invalid unsupported feature tag');
        return tag;
      }));
      const supportedFeatures = freeze(['body-palettes', ...(eyeKind === 'standard' ? ['standard-eyes'] : []), ...effectKinds,
        ...(attachment ? ['head-attachment'] : []), ...(bodyStyle ? ['standard-body-style'] : [])]);
      const recipe = freeze({ basePalette, custom, runs, palettes, variantMode, variantPeriod, eyes: freeze(eyes), effects,
        attachment, supportedFeatures, unsupportedFeatures, ...(bodyStyle ? { bodyStyle } : {}) });
      const statuses = [...borrowed.values()].map(asset => asset.status);
      const status = unsupportedFeatures.length || statuses.includes('unsupported') ? 'unsupported'
        : statuses.includes('pending') ? 'pending' : 'ready';
      return freeze({ schema: 1, revision: version, status, recipe });
    },
  });
}
