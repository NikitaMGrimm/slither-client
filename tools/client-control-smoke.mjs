import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { syntheticScene } from '../web/synthetic-scene.mjs';

// Authored synthetic real-Wasm checks. No browser, reference runtime or sockets.
// Import clientControlSmoke(wasm), or explicitly supply web-bindgen JS and Wasm
// paths: node tools/client-control-smoke.mjs /absolute/module.js /absolute/module_bg.wasm
export function clientControlSmoke(wasm) {
  const scene = new wasm.AnimatedScene(0);
  const legacy = new wasm.AnimatedScene(0);
  const clock = new wasm.AnimationClock(0);
  let cases = 0;
  let primaryFailed = false;
  const state = () => ({ snapshot: scene.snapshot(), control: scene.control_view(),
    food: scene.food_state(), prey: scene.prey_state() });
  const freeStep = step => { try { return [step.delta, step.unlagged_delta, step.whole_steps,
    step.double_steps, step.lag_multiplier, step.accumulated, step.doubled_accumulated]; }
  finally { step.free(); } };
  try {
    scene.apply_frame(syntheticScene(), false);
    legacy.apply_frame(syntheticScene(), false);
    for (const [now, lagging] of [[0, false], [0, true], [7, true], [51, true],
      [51, false], [49, false], [60, false]]) {
      const before = scene.control_view();
      let called = 0;
      const expected = freeStep(clock.advance(now, lagging, false));
      const actual = freeStep(scene.advance_with_control(now, lagging, request => {
        called++;
        assert.equal(request.nowMs, now);
        assert.deepEqual(request.control, before);
        assert.deepEqual([request.delta, request.unlaggedDelta, request.wholeSteps,
          request.doubleSteps, request.lagMultiplier, request.accumulated,
          request.doubledAccumulated], expected);
        // Copied observations cannot inject movement or alter the retained clock.
        request.control.own.rawHead.x = -123;
        request.wholeSteps = 999;
        return {};
      }));
      assert.equal(called, 1);
      assert.deepEqual(actual, expected);
      assert.deepEqual(freeStep(legacy.advance(now, lagging)), expected);
      assert.equal(scene.snapshot(), legacy.snapshot());
      assert.deepEqual(scene.food_state(), legacy.food_state());
      assert.deepEqual(scene.prey_state(), legacy.prey_state());
      cases++;
    }
    const bad = [undefined, null, 1, false, 'x', [], Promise.resolve({}),
      new Date(0), new Map(), new Number(1), new Uint8Array(),
      runInNewContext('Promise.resolve({})'), { unexpected: true },
      { [Symbol('unknown')]: 1 }, { resetWorld: undefined }, { resetLag: 1 },
      { connected: null }, { gazeHeading: NaN },
      { resetWorld: true, connected: false, gazeHeading: Infinity }];
    for (const value of bad) {
      const before = state();
      assert.throws(() => scene.advance_with_control(68, true, () => value));
      assert.deepEqual(state(), before);
      cases++;
    }
    let getterCalls = 0;
    for (const name of ['gazeHeading', 'resetWorld', 'resetLag', 'connected']) {
      const action = Object.defineProperty({}, name, {
        get() { getterCalls++; return true; }, enumerable: true,
      });
      const before = state();
      assert.throws(() => scene.advance_with_control(68, false, () => action));
      assert.equal(getterCalls, 0);
      assert.deepEqual(state(), before);
      cases++;
    }
    const sentinel = { callbackFailure: true };
    const before = state();
    let attempts = 0;
    assert.throws(() => scene.advance_with_control(68, false, () => {
      attempts++;
      throw sentinel;
    }), error => error === sentinel);
    assert.equal(attempts, 1);
    assert.deepEqual(state(), before);
    cases++;

    for (const trap of ['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor']) {
      const action = new Proxy({ resetWorld: true }, { [trap]() { throw sentinel; } });
      const beforeTrap = state();
      assert.throws(() => scene.advance_with_control(68, false, () => action),
        error => error === sentinel);
      assert.deepEqual(state(), beforeTrap); // Also proves the borrow was released.
      cases++;
    }
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    assert.throws(() => scene.advance_with_control(68, false, () => revoked.proxy));
    assert.deepEqual(state(), before);
    cases++;

    freeStep(scene.advance_with_control(68, false, () => {
      // The callback contract forbids scene reentry. In wasm-bindgen 0.2.129,
      // deliberately violating it rejects but can prevent later explicit free.
      return Object.assign(Object.create(null), { gazeHeading: Math.PI / 2 });
    }));
    assert.equal(scene.control_view().own.gazeHeading, Math.PI / 2);
    assert.ok(JSON.parse(scene.snapshot()).own.eyes.pupilY > 0);
    cases++;

    const token = scene.control_view().own.token;
    assert.equal(typeof token, 'bigint');
    let computed;
    const resetStep = freeStep(scene.advance_with_control(76, true, request => {
      computed = request;
      return { gazeHeading: null, resetWorld: true, resetLag: true, connected: false };
    }));
    assert.equal(resetStep[0], computed.delta);
    assert.equal(resetStep[4], computed.lagMultiplier);
    assert.equal(scene.control_view().own, null);
    assert.equal(scene.control_view().connected, false);
    assert.equal(scene.food_state().sourceCount, 0);
    assert.equal(scene.prey_state().sourceCount, 0);
    const next = freeStep(scene.advance(76, false));
    assert.equal(next[0], 0);
    assert.equal(next[4], 1);
    assert.equal(next[5], computed.accumulated);
    assert.equal(next[6], computed.doubledAccumulated);
    scene.apply_frame(syntheticScene(), false);
    assert.ok(scene.control_view().own.token > token);
    cases++;

    freeStep(scene.advance(84, true));
    const priorReset = state();
    scene.reset_lag();
    assert.deepEqual(state(), priorReset);
    assert.equal(freeStep(scene.advance(84, false))[4], 1);
    cases++;
    return { cases };
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const owner of [clock, legacy, scene]) {
      try { owner.free(); } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      if (primaryFailed) console.error('Additional control smoke cleanup failures:', cleanupErrors);
      else throw new AggregateError(cleanupErrors, 'Control smoke cleanup failed');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Supply explicit generated JS and Wasm paths');
  const wasm = await import(pathToFileURL(path.resolve(process.argv[2])).href);
  wasm.initSync({ module: fs.readFileSync(process.argv[3]) });
  console.log(`Synthetic client control Wasm smoke passed: ${clientControlSmoke(wasm).cases} cases.`);
}
