import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { loopbackEndpoint, sceneHeading } from '../web/loopback-session.mjs';
import { syntheticScene, syntheticStep } from '../web/synthetic-scene.mjs';

// Original synthetic page/Wasm doubles. No generated bindings, browser or sockets.
// Execute the authored page body with its imports supplied in the isolated realm.
const source = readFileSync(new URL('../web/animated.mjs', import.meta.url), 'utf8');
const pageScript = new Script(`'use strict';\n${source.replace(/^import .+;\r?$/gm, '')}`,
  { filename: 'web/animated.mjs' });

class Element extends EventTarget {
  disabled = true;
  value = '';
  checked = false;
  textContent = '';
  focused = 0;
  focus() { this.focused++; }
  emit(type, properties = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), properties);
    this.dispatchEvent(event);
    return event;
  }
}

class Canvas extends Element {
  width = 960;
  height = 540;
  bounds = { left: 30, top: 50, width: 480, height: 180 };
  getBoundingClientRect() { return this.bounds; }
  getContext() { return { beginPath() {}, arc() {}, fill() {}, fillRect() {} }; }
  toDataURL() { return 'data:,'; }
}

function pageFixture(t, { initialize = async () => {}, decode = async () => {},
  config = Promise.resolve({ simulatorUrl: 'ws://127.0.0.1:8766/slither' }) } = {}) {
  const elements = Object.fromEntries(['reset', 'step', 'skin', 'zoom', 'follow',
    'connect', 'disconnect', 'counts', 'status'].map(id => [id, new Element()]));
  elements.scene = new Canvas();
  elements.skin.value = '0';
  elements.zoom.value = '1.5';
  elements.follow.checked = true;
  const window = new Element();
  const calls = [], sessions = [], frames = new Map(), cancelled = [], advances = [];
  const faults = {};
  const view = { camera: { x: 0, y: 0, zoom: 1.5 }, ownHead: null,
    snakes: 3, retainedSnakes: 3, drawnSnakes: 3, foods: 28, frames: 1, ignored: 0 };
  let frameId = 0, sceneFrees = 0, stepFrees = 0, constructions = 0;
  const fetched = Promise.withResolvers();
  class AnimatedScene {
    constructor(nowMs) { constructions++; calls.push(['construct', nowMs]); }
    reset(nowMs) {
      calls.push(['reset', nowMs]);
      view.ownHead = null;
      delete view.own;
    }
    apply_frame(bytes, elapsed) { calls.push(['apply', [...bytes], elapsed]); }
    set_follows(follows) { calls.push(['follow', follows]); }
    set_zoom(zoom) { calls.push(['zoom', zoom]); }
    set_gaze_heading(radians) {
      calls.push(['gaze', radians]);
      assert.ok(Number.isFinite(radians));
      if (faults.gaze) throw faults.gaze;
      if (view.own?.eyes) view.own.eyes.gazeHeading = radians;
    }
    advance(nowMs, lagging) {
      calls.push(['advance', nowMs, lagging]);
      advances.push({ nowMs, gaze: view.own?.eyes?.gazeHeading });
      let freed = false;
      return { free() {
        assert.equal(freed, false, 'each returned step is freed only once');
        freed = true;
        stepFrees++;
        calls.push(['step.free']);
      } };
    }
    render(target) {
      assert.equal(target, elements.scene);
      calls.push(['render']);
      if (faults.render) throw faults.render;
    }
    snapshot() { calls.push(['snapshot']); return JSON.stringify(view); }
    free() { sceneFrees++; calls.push(['scene.free']); }
  }
  function connectLoopback(options) {
    const session = {
      options, inputs: [], closes: 0,
      open() { options.scene.reset(); options.onStatus('Connected to local simulator'); },
      close() {
        if (this.closes) return;
        this.closes++;
        options.onStatus('Disconnected');
      },
      setInput(heading, boost) {
        assert.ok(Number.isInteger(heading) && heading >= 0 && heading <= 250);
        assert.equal(typeof boost, 'boolean');
        this.inputs.push([heading, boost]);
      },
    };
    sessions.push(session);
    return session;
  }
  const ready = pageScript.runInNewContext({
    init: initialize, wasm: { AnimatedScene }, syntheticScene, syntheticStep,
    loopbackEndpoint, sceneHeading, connectLoopback, window, AbortController,
    document: {
      querySelector(selector) {
        const element = elements[selector.slice(1)];
        assert.ok(element, `known synthetic control ${selector}`);
        return element;
      },
      createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); },
    },
    Image: class { decode() { return decode(); } },
    performance: { now: () => 10 },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { cancelled.push(id); frames.delete(id); },
    async fetch(url, { signal }) {
      assert.equal(url, '/scene/config.json');
      fetched.resolve(signal);
      return { ok: true, json: () => config };
    },
  });
  t.after(() => window.emit('pagehide'));
  return {
    ready, elements, window, calls, sessions, frames, cancelled, advances, faults, view,
    fetched: fetched.promise,
    counts: () => ({ constructions, sceneFrees, stepFrees }),
    pointer: (clientX, clientY) => elements.scene.emit('pointermove', { clientX, clientY }),
    frame(nowMs) {
      assert.equal(frames.size, 1, 'exactly one callback is pending');
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(nowMs);
    },
    connect() {
      assert.equal(elements.connect.disabled, false);
      elements.connect.emit('click');
      const session = sessions.at(-1);
      session.open();
      return session;
    },
  };
}

function expectFrame(page, nowMs, radians) {
  page.calls.length = 0;
  page.frame(nowMs);
  assert.deepEqual(page.calls, [
    ['gaze', radians], ['advance', nowMs, false], ['step.free'], ['render'], ['snapshot'],
  ]);
  assert.equal(page.frames.size, 1);
}

test('RAF applies initial zero gaze before one advance, frees the step and renders once', async t => {
  const page = pageFixture(t);
  await page.ready;
  expectFrame(page, 10.125, 0);
  assert.equal(page.window.slitherAnimatedSceneReport.renders, 1);
  assert.equal(page.window.slitherAnimatedSceneReport.ownHead, null);
  expectFrame(page, 110.5, 0);
  assert.equal(page.window.slitherAnimatedSceneReport.renders, 2);
  assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 0, stepFrees: 2 });
});

test('synthetic gaze uses fractional backing-pixel offsets, signed radians and center zero without own', async t => {
  const page = pageFixture(t);
  await page.ready;
  for (const [clientX, clientY, angle] of [
    [331.75, 124.25, Math.atan2(-47.25, 123.5)],
    [224.25, 165.5, Math.atan2(76.5, -91.5)],
    [270, 140, 0],
  ]) {
    page.calls.length = 0;
    page.pointer(clientX, clientY);
    assert.deepEqual(page.calls, [], 'pointer input neither snapshots nor advances the disconnected scene');
    expectFrame(page, 20 + page.advances.length * 8, angle);
  }
  assert.equal(page.sessions.length, 0);
});

test('zero CSS width or height preserves the previous finite gaze', async t => {
  const page = pageFixture(t);
  await page.ready;
  page.pointer(331.75, 124.25);
  const angle = Math.atan2(-47.25, 123.5);
  for (const bounds of [{ width: 0, height: 180 }, { width: 480, height: 0 }]) {
    Object.assign(page.elements.scene.bounds, bounds);
    page.pointer(50, 60);
    expectFrame(page, 20 + page.advances.length * 8, angle);
  }
});

test('connected steering remains quantized relative to the rendered camera and active head', async t => {
  const page = pageFixture(t);
  await page.ready;
  const session = page.connect();
  page.view.camera = { x: 20, y: -10, zoom: 2 };
  page.view.ownHead = { x: 100, y: 40 };
  page.pointer(331.75, 124.25);
  assert.deepEqual(session.inputs, [], 'steering waits for the first rendered camera');
  expectFrame(page, 20, Math.atan2(-47.25, 123.5));
  page.pointer(331.75, 124.25);
  assert.deepEqual(session.inputs, [[178, false]]);
  expectFrame(page, 28, Math.atan2(-47.25, 123.5));
  page.pointer(270, 140);
  assert.deepEqual(session.inputs.at(-1), [147, false], 'center gaze still steers toward the world point');
  expectFrame(page, 36, 0);
});

test('retained own eyes receive gaze during death and after disconnection without steering', async t => {
  const page = pageFixture(t);
  await page.ready;
  const session = page.connect();
  page.view.ownHead = { x: 0, y: 0 };
  page.view.own = { eyes: { heading: 0, targetHeading: 0, turn: 0, gazeHeading: 0, pupilX: 0, pupilY: 0 } };
  expectFrame(page, 20, 0);
  page.pointer(331.75, 124.25);
  assert.equal(session.inputs.length, 1);
  page.view.ownHead = null;
  page.pointer(224.25, 165.5);
  expectFrame(page, 28, Math.atan2(76.5, -91.5));
  assert.equal(session.inputs.length, 1, 'retained own diagnostics do not enable steering');
  assert.equal(page.advances.at(-1).gaze, Math.atan2(76.5, -91.5));
  session.options.onStatus('Local life ended');
  page.pointer(331.75, 124.25);
  expectFrame(page, 140, Math.atan2(-47.25, 123.5));
  assert.equal(page.advances.at(-1).gaze, Math.atan2(-47.25, 123.5));
  assert.equal(session.inputs.length, 1);
  assert.equal(page.window.slitherAnimatedSceneReport.connected, false);
  assert.equal(page.elements.disconnect.disabled, true);
});

test('latest pointer gaze reaches a new appearance and survives reset and manual disconnect', async t => {
  const page = pageFixture(t);
  await page.ready;
  page.pointer(224.25, 165.5);
  page.pointer(331.75, 124.25);
  const angle = Math.atan2(-47.25, 123.5);
  expectFrame(page, 20, angle);
  assert.equal(page.advances.at(-1).gaze, undefined, 'no own object yet');
  page.view.own = { eyes: { gazeHeading: 0 } };
  expectFrame(page, 28, angle);
  assert.equal(page.advances.at(-1).gaze, angle, 'new appearance gets current gaze before advancing');
  const session = page.connect();
  page.elements.disconnect.emit('click');
  assert.equal(session.closes, 1);
  page.elements.reset.emit('click');
  assert.equal(page.elements.step.disabled, false);
  page.view.own = { eyes: { gazeHeading: 0 } };
  expectFrame(page, 36, angle);
  assert.equal(page.advances.at(-1).gaze, angle);
  page.pointer(224.25, 165.5);
  expectFrame(page, 44, Math.atan2(76.5, -91.5));
});

test('anchor and view controls do not add animation advances or renders', async t => {
  const page = pageFixture(t);
  await page.ready;
  page.calls.length = 0;
  page.elements.step.emit('click');
  page.elements.zoom.value = '2';
  page.elements.zoom.emit('change');
  page.elements.follow.checked = false;
  page.elements.follow.emit('change');
  assert.deepEqual(page.calls, [['apply', [...syntheticStep(1)], false], ['zoom', 2], ['follow', false]]);
  page.elements.reset.emit('click');
  page.calls.length = 0;
  page.elements.step.emit('click');
  assert.deepEqual(page.calls, [['apply', [...syntheticStep(1)], false]]);
  expectFrame(page, 20, 0);
});

test('canvas blur, window blur and Space keyup still release boost with the retained steering byte', async t => {
  const page = pageFixture(t);
  await page.ready;
  const session = page.connect();
  page.view.camera = { x: 20, y: -10, zoom: 2 };
  page.view.ownHead = { x: 100, y: 40 };
  page.frame(20);
  page.pointer(331.75, 124.25);
  for (const release of [
    () => page.elements.scene.emit('blur'),
    () => page.window.emit('blur'),
    () => assert.equal(page.elements.scene.emit('keyup', { code: 'Space' }).defaultPrevented, true),
  ]) {
    assert.equal(page.elements.scene.emit('keydown', { code: 'Space' }).defaultPrevented, true);
    assert.deepEqual(session.inputs.at(-1), [178, true]);
    release();
    assert.deepEqual(session.inputs.at(-1), [178, false]);
  }
  expectFrame(page, 28, Math.atan2(-47.25, 123.5));
});

test('pagehide aborts listeners and config, cancels RAF, closes transport and frees once', async t => {
  const page = pageFixture(t);
  await page.ready;
  const session = page.connect();
  page.frame(20);
  const [id, staleCallback] = page.frames.entries().next().value;
  const signal = await page.fetched;
  page.window.emit('pagehide');
  assert.equal(signal.aborted, true);
  assert.deepEqual(page.cancelled, [id]);
  assert.equal(page.frames.size, 0);
  assert.equal(session.closes, 1);
  assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 1, stepFrees: 1 });
  page.calls.length = 0;
  page.window.emit('pagehide');
  page.pointer(331.75, 124.25);
  page.elements.reset.emit('click');
  page.elements.step.emit('click');
  page.elements.scene.emit('keydown', { code: 'Space' });
  page.window.emit('blur');
  staleCallback(28);
  assert.deepEqual(page.calls, []);
  assert.deepEqual(session.inputs, []);
  assert.equal(page.frames.size, 0);
  assert.equal(session.closes, 1);
  for (const id of ['reset', 'step', 'skin', 'zoom', 'follow', 'connect', 'disconnect']) {
    assert.equal(page.elements[id].disabled, true);
  }
});

for (const fault of ['gaze', 'render']) {
  test(`${fault} failure stops RAF and frees the scene and any returned step`, async t => {
    const page = pageFixture(t);
    await page.ready;
    const session = page.connect();
    page.faults[fault] = new Error(`synthetic ${fault} failure`);
    page.calls.length = 0;
    page.frame(20);
    assert.deepEqual(page.calls.map(call => call[0]), fault === 'gaze'
      ? ['gaze', 'scene.free'] : ['gaze', 'advance', 'step.free', 'render', 'scene.free']);
    assert.equal(page.frames.size, 0);
    assert.equal(session.closes, 1);
    assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 1, stepFrees: fault === 'render' ? 1 : 0 });
    assert.match(page.elements.status.textContent, new RegExp(`synthetic ${fault} failure`));
  });
}

test('pagehide while Wasm initialization is pending prevents later scene construction', async t => {
  const initialization = Promise.withResolvers();
  const page = pageFixture(t, { initialize: () => initialization.promise });
  page.window.emit('pagehide');
  initialization.resolve();
  await page.ready;
  assert.deepEqual(page.counts(), { constructions: 0, sceneFrees: 0, stepFrees: 0 });
  assert.equal(page.frames.size, 0);
});

test('pagehide while background decoding is pending prevents later scene construction', async t => {
  const decoding = Promise.withResolvers(), started = Promise.withResolvers();
  const page = pageFixture(t, { decode: () => { started.resolve(); return decoding.promise; } });
  await started.promise;
  page.window.emit('pagehide');
  decoding.resolve();
  await page.ready;
  assert.deepEqual(page.counts(), { constructions: 0, sceneFrees: 0, stepFrees: 0 });
  assert.equal(page.frames.size, 0);
});

test('late config after pagehide cannot re-enable controls or restart animation', async t => {
  const config = Promise.withResolvers();
  const page = pageFixture(t, { config: config.promise });
  const signal = await page.fetched;
  page.window.emit('pagehide');
  config.resolve({ simulatorUrl: 'ws://127.0.0.1:8766/slither' });
  await page.ready;
  assert.equal(signal.aborted, true);
  assert.equal(page.elements.connect.disabled, true);
  assert.equal(page.frames.size, 0);
  assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 1, stepFrees: 0 });
});
