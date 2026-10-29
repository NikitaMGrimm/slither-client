// Copied Rust source-plan ABI and Canvas binding only. No numeric artwork fallback.
const freeze = Object.freeze;
const descriptor = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty;

function put(target, key, value) {
  const field = Object.create(null);
  field.value = value; field.enumerable = true;
  define(target, key, field);
}

function own(value, key) {
  if (value === null || typeof value !== 'object') throw new TypeError('Authored source record required');
  const field = descriptor(value, key);
  if (!field || !Object.hasOwn(field, 'value')) throw new TypeError(`Own-data authored source field required: ${key}`);
  return field.value;
}
function record(fields) {
  const value = Object.create(null);
  for (const [key, entry] of fields) put(value, key, entry);
  return freeze(value);
}
function array(values) {
  const result = [];
  for (let index = 0; index < values.length; index++) put(result, String(index), values[index]);
  return freeze(result);
}
function list(value, limit, copy) {
  if (!Array.isArray(value)) throw new TypeError('Authored source array required');
  const length = own(value, 'length');
  if (!Number.isSafeInteger(length) || length < 0 || length > limit) throw new TypeError('Bounded authored source array required');
  const result = new Array(length);
  for (let index = 0; index < length; index++) put(result, String(index), copy(own(value, String(index))));
  return freeze(result);
}
function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Finite authored source operand required');
  return value;
}
function integer(value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new TypeError('Bounded authored source integer required');
  return value;
}
function color(value) {
  if (typeof value !== 'string' || !value.length || value.length > 128) throw new TypeError('Authored source color required');
  return value;
}
function tuple(value, length, copy) {
  const result = list(value, length, copy);
  if (result.length !== length) throw new TypeError('Authored source tuple required');
  return result;
}
function copier() {
  let sources = 0, commands = 0;
  function command(raw) {
    if (++commands > 8192) throw new TypeError('Authored paint budget exceeded');
    const kind = own(raw, '0');
    if (typeof kind !== 'string') throw new TypeError('Authored paint operation name required');
    let result;
    if (kind === 'radialGradient') {
      const input = tuple(raw, 3, value => value);
      result = array([kind, tuple(input[1], 6, number), list(input[2], 16, stop => {
        const input = tuple(stop, 2, value => value);
        return array([number(input[0]), color(input[1])]);
      })]);
    } else {
      const arity = { fillStyle: 1, globalAlpha: 1, beginPath: 0, arc: 5,
        moveTo: 2, lineTo: 2, closePath: 0, fill: 0, fillRect: 4 };
      if (!Object.hasOwn(arity, kind)) throw new TypeError('Unsupported authored paint operation');
      const input = tuple(raw, arity[kind] + 1, value => value);
      const values = new Array(input.length);
      put(values, '0', kind);
      for (let index = 1; index < input.length; index++) put(values, String(index), kind === 'fillStyle' ? color(input[index]) : number(input[index]));
      result = freeze(values);
    }
    return result;
  }
  function canvas(raw) {
    if (++sources > 512) throw new TypeError('Authored source budget exceeded');
    const width = integer(own(raw, 'width'), 4096), height = integer(own(raw, 'height'), 4096);
    if (!width || !height) throw new TypeError('Positive authored source dimensions required');
    return record([
      ['width', width], ['height', height],
      ['halfWidth', number(own(raw, 'halfWidth'))], ['halfHeight', number(own(raw, 'halfHeight'))],
      ['commands', list(own(raw, 'commands'), 8192, command)],
    ]);
  }
  const canvases = raw => list(raw, 64, canvas);
  const entities = raw => list(raw, 64, palette => record([
    ['color', integer(own(palette, 'color'), 255)], ['count', integer(own(palette, 'count'), 64)],
    ['bodies', canvases(own(palette, 'bodies'))], ['outlines', canvases(own(palette, 'outlines'))],
    ['glows', canvases(own(palette, 'glows'))],
  ]));
  return { canvas, canvases, entities };
}

/** Admit a caller-owned copied plan before creating any source objects. */
export function copyAuthoredSourceRecipes(raw) {
  if (own(raw, 'schema') !== 1) throw new TypeError('Authored source schema required');
  const copy = copier();
  const body = own(raw, 'bodySources'), effects = own(body, 'effects');
  return record([
    ['schema', 1],
    ['paletteRgb', list(own(raw, 'paletteRgb'), 64, rgb => tuple(rgb, 3, value => integer(value, 255)))],
    ['palettes', copy.canvases(own(raw, 'palettes'))], ['tile', copy.canvas(own(raw, 'tile'))],
    ['backdrop', copy.canvas(own(raw, 'backdrop'))],
    ['bodySources', record([
      ['palettes', list(own(body, 'palettes'), 64, palette => record([
        ['variants', copy.canvases(own(palette, 'variants'))], ['boostGlow', copy.canvas(own(palette, 'boostGlow'))],
      ]))],
      ['effects', record(['outline', 'shadow', 'deathHighlight'].map(key => [key, copy.canvas(own(effects, key))]))],
    ])],
    ['food', copy.entities(own(raw, 'food'))], ['prey', copy.entities(own(raw, 'prey'))],
  ]);
}

/** Capture the required generated export without invoking an export getter. */
export function readAuthoredSourceRecipes(wasmApi) {
  const resolve = own(wasmApi, 'authored_source_recipes');
  if (typeof resolve !== 'function') throw new TypeError('Authored source recipe Wasm capability required');
  return copyAuthoredSourceRecipes(resolve());
}

/** Admit the independent entity-family plan at its browser factory boundary. */
export function copyEntitySourcePalettes(raw) {
  return copier().entities(raw);
}

/** Allocate and paint one native Canvas from already copied operands. */
export function paintAuthoredCanvas(realm, recipe) {
  const source = realm.document.createElement('canvas');
  source.width = recipe.width; source.height = recipe.height;
  const context = source.getContext('2d');
  for (const command of recipe.commands) {
    const [kind, ...args] = command;
    switch (kind) {
      case 'fillStyle': context.fillStyle = args[0]; break;
      case 'globalAlpha': context.globalAlpha = args[0]; break;
      case 'radialGradient': {
        const gradient = context.createRadialGradient(...args[0]);
        for (const [offset, color] of args[1]) gradient.addColorStop(offset, color);
        context.fillStyle = gradient;
        break;
      }
      case 'beginPath': context.beginPath(); break;
      case 'arc': context.arc(...args); break;
      case 'moveTo': context.moveTo(...args); break;
      case 'lineTo': context.lineTo(...args); break;
      case 'closePath': context.closePath(); break;
      case 'fill': context.fill(); break;
      case 'fillRect': context.fillRect(...args); break;
      default: throw new TypeError('Unsupported copied authored paint operation');
    }
  }
  return source;
}
