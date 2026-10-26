// Original deterministic synthetic protocol-19 fixtures. No captured/reference bytes.
import { syntheticSetup } from './synthetic-scene.mjs';

export const DENSE_SCENE_PROFILES = Object.freeze({
  baseline: Object.freeze({ snakes: 3, anchors: 16, foods: 64, spread: 1200 }),
  dense: Object.freeze({ snakes: 64, anchors: 128, foods: 8192, spread: 1200 }),
  stress: Object.freeze({ snakes: 128, anchors: 512, foods: 32768, spread: 1200 }),
});

const CENTER = 32550;
const SECTOR = 300;
const SPACING = 8;
const MAX_COMMAND = 8191;
const MAX_FRAME = 1 << 20;
const u16 = value => [value >>> 8 & 255, value & 255];
const u24 = value => [value >>> 16 & 255, value >>> 8 & 255, value & 255];
const absolute = value => u24(Math.round((CENTER + value) * 5));

function frames(commands) {
  const result = [];
  let pending = [], bytes = 0;
  function flush() {
    if (!pending.length) return;
    const frame = new Uint8Array(bytes);
    let at = 0;
    for (const command of pending) {
      frame.set(u16(command.length), at);
      frame.set(command, at + 2);
      at += command.length + 2;
    }
    result.push(frame);
    pending = [];
    bytes = 0;
  }
  for (const command of commands) {
    if (pending.length === 4096 || bytes + command.length + 2 > MAX_FRAME) flush();
    pending.push(command);
    bytes += command.length + 2;
  }
  flush();
  return result;
}

function* appearances(snakes, anchors, spread) {
  const columns = Math.ceil(Math.sqrt(snakes));
  const rows = Math.ceil(snakes / columns);
  const radius = Math.min(90, spread * 0.15);
  for (let id = 0; id < snakes; id++) {
    const cx = ((id % columns + 0.5) / columns * 2 - 1) * spread;
    const cy = ((Math.floor(id / columns) + 0.5) / rows * 2 - 1) * spread;
    // A compact winding curve keeps even long bodies near their grid centers.
    // Integer anchors are exact in both the absolute and half-unit delta forms.
    const point = index => {
      const t = id * 0.71 + index * 0.09;
      return [Math.round(cx + radius * Math.sin(t)),
        Math.round(cy + radius * Math.cos(t * 0.7))];
    };
    let [x, y] = point(0);
    const tail = [...absolute(x), ...absolute(y)];
    const deltas = [];
    for (let index = 1; index < anchors - 1; index++) {
      const [nx, ny] = point(index);
      deltas.push(127 + (nx - x) * 2, 127 + (ny - y) * 2);
      x = nx;
      y = ny;
    }
    // The final pair is a u16 direction, NOT another dx/dy pair. Cardinal
    // headings keep its eight-unit advance and the advertised head exact.
    const direction = id % 4;
    x += [SPACING, 0, -SPACING, 0][direction];
    y += [0, SPACING, 0, -SPACING][direction];
    const angle = u24(Math.round(direction / 4 * 16777215));
    const name = [...new TextEncoder().encode(`Dense synthetic ${id}`)];
    yield [115, ...u16(id), ...angle, 48, ...angle, ...u16(128), ...u24(0), id % 3,
      ...absolute(x), ...absolute(y), name.length, ...name, 0, 0,
      ...tail, ...deltas, ...u16(direction * 16384)];
  }
}

function* foodListings(foods, spread) {
  if (!foods) return;
  const columns = Math.ceil(Math.sqrt(foods));
  const rows = Math.ceil(foods / columns);
  // spread is a distribution scale: food occupies a centered square of
  // half-width 1.25 * spread. Even spread=100 has enough distinct wire cells
  // for 32768 foods (wire resolution is 300/256 world units).
  const low = Math.ceil((CENTER - spread * 1.25) * 256 / SECTOR);
  const high = Math.floor((CENTER + spread * 1.25) * 256 / SECTOR);
  const width = high - low + 1;
  const sectors = new Map();
  for (let index = 0; index < foods; index++) {
    const x = low + Math.floor((index % columns + 0.5) * width / columns);
    const y = low + Math.floor((Math.floor(index / columns) + 0.5) * width / rows);
    const sx = Math.floor(x / 256), sy = Math.floor(y / 256);
    const key = sx * 256 + sy;
    if (!sectors.has(key)) sectors.set(key, []);
    sectors.get(key).push(index % 3, x % 256, y % 256, 20 + index % 4 * 5);
  }
  const recordsPerCommand = Math.floor((MAX_COMMAND - 3) / 4);
  for (const [key, records] of sectors) {
    for (let at = 0; at < records.length; at += recordsPerCommand * 4) {
      yield [70, key >>> 8, key & 255, ...records.slice(at, at + recordsPerCommand * 4)];
    }
  }
}

/**
 * Return complete header-free frames: setup alone, appearances, then food lists.
 * Coordinates are centered by ClientState at 32550; snakes wind near a grid in
 * [-spread, spread], with radius <= min(90, 0.15*spread) and an eight-unit head.
 * Food uses distinct four-byte sector/offset keys in the square documented above.
 * Every call returns fresh bytes. There is no randomness, clock or network I/O.
 */
export function denseScene(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('scene options must be an object');
  }
  const { snakes = 64, anchors = 128, foods = 8192, spread = 1200 } = options;
  for (const key of Object.keys(options)) {
    if (!['snakes', 'anchors', 'foods', 'spread'].includes(key)) throw new TypeError(`unknown scene option: ${key}`);
  }
  for (const [name, value, low, high] of [
    ['snakes', snakes, 1, 128], ['anchors', anchors, 2, 512],
    ['foods', foods, 0, 32768],
  ]) {
    if (!Number.isInteger(value) || value < low || value > high) {
      throw new RangeError(`${name} must be an integer in ${low}..${high}`);
    }
  }
  if (!Number.isFinite(spread) || spread < 100 || spread > 10000) {
    throw new RangeError('spread must be finite and in 100..10000');
  }
  if (snakes * anchors > 65536) throw new RangeError('total anchors must not exceed 65536');
  // All option validation precedes any scene/packet allocation.
  const setup = syntheticSetup();
  setup[24] = SPACING;
  setup.set(u24(32000), 27);
  return [setup, ...frames(appearances(snakes, anchors, spread)), ...frames(foodListings(foods, spread))];
}
