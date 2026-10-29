import assert from 'node:assert/strict';
import { desktopBackingSize } from '../web/desktop-layout.mjs';
import { desktopBackingOracle } from './fixtures/desktop-layout-fixture.mjs';

/** Real Wasm versus the authored pre-migration oracle; no browser or viewport reads. */
export function desktopLayoutSmoke(wasm) {
  const values = [Number.MIN_VALUE, 1e-300, .01, .999, 1, 1.001, 599.5, 799.25, 800,
    994, 995, 1000, 1273, 1499.99, 1500, 1500.01, 1800, 1920, 4096, 1e12,
    1e100, 1e153, 9e153, 1e154, Math.sqrt(Number.MAX_VALUE), 1e200, Number.MAX_VALUE];
  const pairs = values.flatMap(width => values.map(height => [width, height]));
  let random = 0x45212;
  const unit = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
  for (let index = 0; index < 512; index++) pairs.push([2 ** (unit() * 2100 - 1070), 2 ** (unit() * 2100 - 1070)]);
  for (const value of [undefined, null, '800', false, {}, NaN, Infinity, -Infinity, -0, 0, -1]) pairs.push([value, 600], [800, value]);
  for (const [width, height] of pairs) {
    let expected, failure;
    try { expected = desktopBackingOracle(width, height); } catch (error) { failure = error; }
    if (failure) {
      assert.throws(() => desktopBackingSize(width, height, wasm.desktop_backing_size), error => error instanceof Error && error.message === failure.message);
    } else assert.deepEqual(desktopBackingSize(width, height, wasm.desktop_backing_size), expected);
  }
  const first = wasm.desktop_backing_size(799.25, 599.5), second = wasm.desktop_backing_size(799.25, 599.5);
  assert.equal(Object.isFrozen(first), true); assert.notEqual(first, second);
  assert.deepEqual(first, { width: 1440, height: 1080 });
  assert.deepEqual(Reflect.ownKeys(first), ['width', 'height']);
  for (const field of Object.values(Object.getOwnPropertyDescriptors(first))) assert.ok(Object.hasOwn(field, 'value'));
  console.log(`Synthetic real-Wasm desktop layout exactly matched ${pairs.length} authored oracle cases; fresh copied records passed.`);
}
