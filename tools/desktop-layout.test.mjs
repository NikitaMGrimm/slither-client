import assert from 'node:assert/strict';
import { test } from 'node:test';
import { desktopBackingSize } from '../web/desktop-layout.mjs';

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
  ]) assert.deepEqual(desktopBackingSize(width, height), expected);
});

test('desktop backing rejects invalid viewport data before a target can be resized', () => {
  for (const value of [undefined, null, '800', NaN, Infinity, -Infinity, 0, -1, 1e200]) {
    assert.throws(() => desktopBackingSize(value, 600));
    assert.throws(() => desktopBackingSize(800, value));
  }
});
