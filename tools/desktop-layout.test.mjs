import assert from 'node:assert/strict';
import { test } from 'node:test';
import { desktopBackingSize } from '../web/desktop-layout.mjs';
import { desktopBackingOracle } from './fixtures/desktop-layout-fixture.mjs';
import { readFile } from 'node:fs/promises';

test('desktop backing uses ceiled viewport dimensions and ordered aspect caps', () => {
  for (const [width, height, expected] of [
    [800, 600, { width: 1440, height: 1080 }],
    [799.25, 599.5, { width: 1440, height: 1080 }],
    [1920, 1080, { width: 1500, height: 845 }],
    [1080, 1920, { width: 845, height: 1500 }],
    [1, 1, { width: 1273, height: 1273 }],
    [0.01, 0.01, { width: 1273, height: 1273 }],
    [1e154, 1, { width: 1500, height: 1 }],
    [1, 1e154, { width: 1, height: 1500 }],
  ]) assert.deepEqual(desktopBackingSize(width, height, desktopBackingOracle), expected);
});

test('desktop backing rejects invalid viewport data before a target can be resized', () => {
  for (const value of [undefined, null, '800', NaN, Infinity, -Infinity, 0, -1, 1e200]) {
    assert.throws(() => desktopBackingSize(value, 600, desktopBackingOracle));
    assert.throws(() => desktopBackingSize(800, value, desktopBackingOracle));
  }
});

test('thin boundary forwards raw numeric inputs to an explicit projection and copies its result', async () => {
  const calls = [], output = { width: 777, height: 555 };
  const project = (...args) => { calls.push(args); return output; };
  const result = desktopBackingSize(.01, 799.25, project);
  assert.deepEqual(calls, [[.01, 799.25]]); assert.deepEqual(result, output); assert.notEqual(result, output);
  output.width = 12; assert.equal(result.width, 777);
  assert.throws(() => desktopBackingSize(800, 600), /Rust desktop/);
  assert.throws(() => desktopBackingSize('800', 600, project)); assert.equal(calls.length, 1);
  const source = await readFile(new URL('../web/desktop-layout.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.(?:ceil|sqrt|hypot)|1800|fixtures|desktopBackingOracle/);
});

test('copied ABI rejects accessors, missing/extra fields, promises and invalid dimensions', () => {
  let getters = 0;
  for (const result of [null, [], Promise.resolve({ width: 1, height: 1 }), {}, { width: 1 },
    { width: 1, height: 1, extra: true }, { width: 0, height: 1 }, { width: 1, height: 1501 },
    { width: 1.5, height: 1 }, { width: NaN, height: 1 },
    Object.defineProperty({ height: 1 }, 'width', { get() { getters++; return 1; } })]) {
    assert.throws(() => desktopBackingSize(800, 600, () => result));
  }
  assert.equal(getters, 0);
});
