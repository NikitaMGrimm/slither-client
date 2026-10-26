import assert from 'node:assert/strict';
import { test } from 'node:test';
import { denseScene, DENSE_SCENE_PROFILES } from '../web/dense-scene.mjs';

// Original synthetic packet inspection; normal tests need no Wasm build or sockets.
const u16 = (bytes, at) => bytes[at] * 256 + bytes[at + 1];
const u24 = (bytes, at) => bytes[at] * 65536 + u16(bytes, at + 1);
const coordinate = (bytes, at) => u24(bytes, at) / 5 - 32550;

function commands(frame) {
  assert.ok(frame instanceof Uint8Array);
  assert.ok(frame.length > 0 && frame.length <= 1 << 20);
  if (frame[0] >= 32) return [frame];
  const result = [];
  let at = 0;
  while (at < frame.length) {
    const prefix = frame[at++];
    let length;
    if (prefix < 32) {
      assert.ok(at < frame.length, 'complete two-byte command length');
      length = prefix * 256 + frame[at++];
    } else {
      length = prefix - 32;
    }
    assert.ok(length > 0 && length <= 8191);
    assert.ok(at + length <= frame.length, 'complete command payload');
    assert.ok(frame[at] >= 32);
    result.push(frame.subarray(at, at + length));
    at += length;
  }
  assert.equal(at, frame.length);
  assert.ok(result.length <= 4096);
  return result;
}

function inspect(scene, { snakes, anchors, foods, spread }) {
  const setup = commands(scene[0]);
  assert.equal(setup.length, 1);
  assert.equal(setup[0][0], 97);
  assert.equal(u24(setup[0], 1), 32550);
  assert.equal(u16(setup[0], 6), 300);
  assert.equal(u16(setup[0], 8), 217);
  assert.equal(setup[0][23], 19);
  assert.equal(setup[0][24], 8);
  assert.equal(u24(setup[0], 27), 32000);
  const ids = new Set(), foodKeys = new Set(), sectors = new Map();
  let totalAnchors = 0, foodPhase = false;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const frame of scene.slice(1)) {
    for (const packet of commands(frame)) {
      if (packet[0] === 115) {
        assert.equal(foodPhase, false, 'appearances precede all food');
        const id = u16(packet, 1);
        assert.equal(id, ids.size, 'IDs are consecutive starting at zero');
        ids.add(id);
        assert.ok(ids.size <= 256);
        const nameEnd = 23 + packet[22];
        const name = packet.subarray(23, nameEnd);
        assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(name), `Dense synthetic ${id}`);
        assert.ok(name.every(byte => byte >= 32 && byte <= 126));
        assert.equal(packet[nameEnd], 0, 'no custom skin');
        assert.equal(packet[nameEnd + 1], 0, 'no cosmetic');
        const start = nameEnd + 2;
        assert.equal((packet.length - start - 6) % 2, 0);
        const count = 1 + (packet.length - start - 6) / 2;
        assert.equal(count, anchors);
        assert.ok(count <= 4096);
        totalAnchors += count;
        assert.ok(totalAnchors <= 65536);
        let x = coordinate(packet, start), y = coordinate(packet, start + 3);
        const extent = spread + Math.min(90, spread * 0.15) + 9;
        const inBounds = () => {
          assert.ok(Math.abs(x) <= extent && Math.abs(y) <= extent);
          assert.ok(Math.hypot(x, y) < 32000);
        };
        inBounds();
        for (let at = start + 6; at < packet.length - 2; at += 2) {
          x += (packet[at] - 127) / 2;
          y += (packet[at + 1] - 127) / 2;
          inBounds();
        }
        const direction = u16(packet, packet.length - 2);
        assert.equal(direction, id % 4 * 16384);
        const angle = direction * Math.PI * 2 / 65536;
        x += Math.cos(angle) * 8;
        y += Math.sin(angle) * 8;
        inBounds();
        assert.ok(Math.abs(x - coordinate(packet, 16)) < 1e-9, 'last pair advances to advertised head x');
        assert.ok(Math.abs(y - coordinate(packet, 19)) < 1e-9, 'last pair advances to advertised head y');
        assert.ok(Math.abs(u24(packet, 3) / 16777215 * Math.PI * 2 - angle) < 1e-6);
        assert.equal(u24(packet, 3), u24(packet, 7));
      } else {
        foodPhase = true;
        assert.equal(packet[0], 70, 'only sector food listings follow appearances');
        assert.ok(packet.length >= 7 && packet.length <= 8191);
        assert.equal((packet.length - 3) % 4, 0);
        const sectorKey = u16(packet, 1);
        sectors.set(sectorKey, (sectors.get(sectorKey) ?? 0) + 1);
        for (let at = 3; at < packet.length; at += 4) {
          assert.ok(packet[at] < 3);
          assert.ok([20, 25, 30, 35].includes(packet[at + 3]));
          const key = packet[1] * 16777216 + packet[2] * 65536 + u16(packet, at + 1);
          assert.equal(foodKeys.has(key), false, 'full four-byte food keys must be unique');
          foodKeys.add(key);
          assert.ok(foodKeys.size <= 65536);
          const x = (packet[1] + packet[at + 1] / 256) * 300 - 32550;
          const y = (packet[2] + packet[at + 2] / 256) * 300 - 32550;
          assert.ok(Math.abs(x) <= spread * 1.25 && Math.abs(y) <= spread * 1.25);
          assert.ok(Math.hypot(x, y) < 32000);
          minX = Math.min(x, minX); maxX = Math.max(x, maxX);
          minY = Math.min(y, minY); maxY = Math.max(y, maxY);
        }
      }
    }
  }
  assert.equal(ids.size, snakes);
  assert.equal(totalAnchors, snakes * anchors);
  assert.equal(foodKeys.size, foods);
  if (foods >= 64) {
    assert.ok(maxX - minX > spread * 2 && maxY - minY > spread * 2, 'food spans both centered axes');
  }
  return { sectors, totalAnchors, foods: foodKeys.size };
}

test('three frozen presets have the requested known retained counts', () => {
  assert.deepEqual(DENSE_SCENE_PROFILES, {
    baseline: { snakes: 3, anchors: 16, foods: 64, spread: 1200 },
    dense: { snakes: 64, anchors: 128, foods: 8192, spread: 1200 },
    stress: { snakes: 128, anchors: 512, foods: 32768, spread: 1200 },
  });
  assert.ok(Object.isFrozen(DENSE_SCENE_PROFILES));
  for (const profile of Object.values(DENSE_SCENE_PROFILES)) {
    assert.ok(Object.isFrozen(profile));
    inspect(denseScene(profile), profile);
  }
});

test('default is dense; all presets are deterministic and return independent bytes', () => {
  assert.deepEqual(denseScene(), denseScene(DENSE_SCENE_PROFILES.dense));
  for (const profile of Object.values(DENSE_SCENE_PROFILES)) {
    const first = denseScene(profile), second = denseScene(profile);
    assert.deepEqual(first, second);
    for (let index = 0; index < first.length; index++) {
      assert.notEqual(first[index].buffer, second[index].buffer);
    }
    first[0].fill(0);
    assert.equal(second[0][0], 97);
    assert.equal(commands(first[1])[0][0], 115);
  }
});

test('minimum anchors, zero food and fractional spread form a complete scene', () => {
  const profile = { snakes: 1, anchors: 2, foods: 0, spread: 100.5 };
  const scene = denseScene(profile);
  assert.equal(scene.length, 2);
  inspect(scene, profile);
});

test('tight stress scene splits full sector listings without replacing or repeating food', () => {
  const profile = { ...DENSE_SCENE_PROFILES.stress, spread: 100 };
  const scene = denseScene(profile);
  const { sectors, totalAnchors, foods } = inspect(scene, profile);
  assert.equal(totalAnchors, 65536);
  assert.equal(foods, 32768);
  assert.ok([...sectors.values()].some(count => count > 1), 'large sectors require multiple listings');
  assert.ok(scene.flatMap(commands).some(packet => packet[0] === 70 && packet.length === 8191));
});

test('wide stress scene splits at 4096 commands and retains the same bounded workload', () => {
  const profile = { ...DENSE_SCENE_PROFILES.stress, spread: 10000 };
  const scene = denseScene(profile);
  inspect(scene, profile);
  const foodFrames = scene.filter(frame => commands(frame)[0][0] === 70);
  assert.ok(foodFrames.length > 1);
  assert.equal(commands(foodFrames[0]).length, 4096);
});

test('reject malformed options and every numeric boundary before building a scene', () => {
  for (const input of [null, [], true, false, 0, 'dense', () => {}]) {
    assert.throws(() => denseScene(input), TypeError);
  }
  assert.throws(() => denseScene({ snake: 64 }), /unknown scene option/);
  for (const [key, low, high] of [['snakes', 1, 128], ['anchors', 2, 512], ['foods', 0, 32768]]) {
    for (const value of [low - 1, high + 1, 1.5, NaN, Infinity, -Infinity, null, '2', true, 2n, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => denseScene({ [key]: value }), RangeError, `${key}=${String(value)}`);
    }
  }
  for (const spread of [99.99, 10000.01, NaN, Infinity, -Infinity, null, '1200', true, 1200n]) {
    assert.throws(() => denseScene({ spread }), RangeError);
  }
});
