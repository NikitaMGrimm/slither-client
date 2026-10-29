import { authoredSourceRecipesDouble } from './fixtures/authored-source-fixture.mjs';
import { readAuthoredSourceRecipes } from '../web/authored-source-recipes.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { loopbackEndpoint, sceneHeading } from '../web/loopback-session.mjs';
import { bundle, syntheticScene, syntheticSetup, syntheticStep } from '../web/synthetic-scene.mjs';
import { createSyntheticBodyResolver } from '../web/synthetic-body.mjs';
import { createSyntheticFoodResolver } from '../web/synthetic-food.mjs';
import { createSyntheticPreyResolver, syntheticPreyCommands } from '../web/synthetic-prey.mjs';
import { desktopBackingSize } from '../web/desktop-layout.mjs';
import { desktopBackingOracle } from './fixtures/desktop-layout-fixture.mjs';

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
    'connect', 'disconnect', 'quality', 'counts', 'status'].map(id => [id, new Element()]));
  elements.scene = new Canvas();
  elements.skin.value = '0';
  elements.zoom.value = '1.5';
  elements.follow.checked = true;
  elements.quality.value = '1';
  const window = new Element();
  Object.assign(window, { innerWidth: 960, innerHeight: 540 });
  const calls = [], sessions = [], frames = new Map(), cancelled = [], advances = [];
  const faults = {};
  const renderMethods = [], renderScales = [], resolvedRecipes = [];
  const qualityView = { requested: 1, highQuality: true, qualityBlend: 1, qualityScale: 1, lowFpsCounter: 0 };
  let qualityFrees = 0, qualityClock = 10;
  class DesktopQuality {
    constructor(requested, startMs) { qualityView.requested = requested; qualityClock = startMs; }
    begin_skin_preview() {
      calls.push(['quality.preview']);
      Object.assign(qualityView, { highQuality: true, qualityBlend: 1, qualityScale: 1 });
    }
    begin_connection() {
      calls.push(['quality.connection']);
      Object.assign(qualityView, qualityView.requested ? { highQuality: true, qualityBlend: 1, qualityScale: 1 }
        : { highQuality: false, qualityBlend: 0, qualityScale: 1.7 });
    }
    set_requested_mode(requested) { calls.push(['quality.requested', requested]); qualityView.requested = requested; }
    advance(step, playing) {
      calls.push(['quality.advance', playing]);
      assert.equal(step.freed, false, 'quality consumes the still-owned reusable step');
      if (faults.qualityAdvance) throw faults.qualityAdvance;
    }
    update_statistics(nowMs, draws, playing) {
      calls.push(['quality.statistics', nowMs, draws, playing]);
      if (faults.statistics) throw faults.statistics;
      if (nowMs - qualityClock <= 1000) return false;
      qualityClock = nowMs;
      return true;
    }
    snapshot() { calls.push(['quality.snapshot']); return JSON.stringify(qualityView); }
    free() { qualityFrees++; calls.push(['quality.free']); }
  }
  const view = { camera: { x: 0, y: 0, zoom: 1.5 }, ownHead: null,
    boundary: { connected: false },
    snakes: 3, retainedSnakes: 3, drawnSnakes: 3, foods: 28, frames: 1, ignored: 0 };
  let frameId = 0, sceneFrees = 0, stepFrees = 0, constructions = 0;
  const fetched = Promise.withResolvers();
  class AnimatedScene {
    constructor(nowMs) { constructions++; calls.push(['construct', nowMs]); }
    reset(...args) {
      assert.equal(sceneFrees, 0, 'reset requires a live owner');
      assert.equal(args.length, 0, 'page resets preserve the timeline without supplying a timestamp');
      calls.push(['reset']);
      view.boundary.connected = false;
      view.ownHead = null;
      delete view.own;
    }
    apply_frame(bytes, elapsed) {
      assert.equal(sceneFrees, 0, 'packets require a live owner');
      calls.push(['apply', [...bytes], elapsed]);
      if (bytes[0] === 97 || bytes[2] === 97) view.boundary.connected = true;
    }
    apply_frame_with_factories(bytes, elapsed, face, food) {
      assert.equal(face().eyes.kind, 'standard');
      assert.equal(face().decoration.kind, 'none');
      const factory = food({ palette: 9 });
      assert.equal(factory.palette.color, 9);
      assert.ok(factory.randomPhaseUnit >= 0 && factory.randomPhaseUnit < 1);
      assert.ok(factory.randomWobbleUnit >= 0 && factory.randomWobbleUnit < 1);
      this.apply_frame(bytes, elapsed);
    }
    apply_frame_with_all_factories(bytes, elapsed, face, food, prey) {
      const factory = prey({ palette: 0 });
      assert.equal(factory.palette.color, 0);
      assert.equal(factory.palette.bodies.length, 4);
      assert.equal(factory.palette.glows.length, 3);
      assert.ok(factory.randomPhaseUnit >= 0 && factory.randomPhaseUnit < 1);
      assert.ok(factory.randomRateUnit >= 0 && factory.randomRateUnit < 1);
      this.apply_frame_with_factories(bytes, elapsed, face, food);
    }
    apply_frame_and_render_standard_with_prey(bytes, elapsed, face, food, prey, target, p0, p1, p2,
      background, width, height, resolve, quality) {
      calls.push(['applyDraw', 'standard', width, height]);
      if (faults.apply) throw faults.apply;
      this.apply_frame_with_all_factories(bytes, elapsed, face, food, prey);
      // The page consumes the engine's count; packet semantics are tested by real Wasm.
      const count = faults.setupDraws ?? Number(bytes[0] === 97 || bytes[2] === 97);
      for (let i = 0; i < count; i++) this.render_standard_at_size(target, p0, p1, p2,
        background, width, height, resolve, quality);
      return count;
    }
    apply_frame_and_render_with_food_and_prey(bytes, elapsed, face, food, prey, target, p0, p1, p2,
      background, width, height, detailed, resolve, quality) {
      calls.push(['applyDraw', 'basic', width, height]);
      if (faults.apply) throw faults.apply;
      this.apply_frame_with_all_factories(bytes, elapsed, face, food, prey);
      const count = faults.setupDraws ?? Number(bytes[0] === 97 || bytes[2] === 97);
      for (let i = 0; i < count; i++) this.render_with_food_at_size(target, p0, p1, p2,
        background, width, height, detailed, resolve, quality);
      return count;
    }
    food_state() { return { foods: Array.from({ length: view.foods }), sourceCount: 0 }; }
    prey_state() { return { preys: [], sourceCount: 0 }; }
    set_connected(connected) {
      assert.equal(sceneFrees, 0, 'connection changes require a live owner');
      calls.push(['connected', connected]);
      view.boundary.connected = connected;
    }
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
      return { get freed() { return freed; }, free() {
        assert.equal(freed, false, 'each returned step is freed only once');
        freed = true;
        stepFrees++;
        calls.push(['step.free']);
      } };
    }
    render(target, p0, p1, p2, background, scale, detailed) {
      assert.equal(target, elements.scene);
      assert.equal(detailed, false);
      calls.push(['render']);
      if (faults.render) throw faults.render;
      renderMethods.push('basic');
      renderScales.push(scale);
    }
    render_with_food(target, p0, p1, p2, background, detailed, face, quality) {
      assert(quality instanceof DesktopQuality);
      assert.equal(face().decoration, null);
      this.render(target, p0, p1, p2, background, qualityView.qualityScale, detailed);
    }
    render_standard(target, p0, p1, p2, background, resolve, quality) {
      assert.equal(target, elements.scene);
      assert(quality instanceof DesktopQuality);
      const recipe = resolve({ skin: 0, customBytes: new Uint8Array(), cosmetic: 0, x: 0, y: 0 });
      assert.equal(recipe.status, 'ready');
      resolvedRecipes.push(recipe);
      calls.push(['render']);
      if (faults.render) throw faults.render;
      renderMethods.push('standard');
    }
    render_standard_at_size(target, p0, p1, p2, background, width, height, resolve, quality) {
      Object.assign(target, { width, height });
      this.render_standard(target, p0, p1, p2, background, resolve, quality);
    }
    render_with_food_at_size(target, p0, p1, p2, background, width, height, detailed, resolve, quality) {
      Object.assign(target, { width, height });
      this.render_with_food(target, p0, p1, p2, background, detailed, resolve, quality);
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
  class PageImage { decode() { return decode(); } }
  const ready = pageScript.runInNewContext({
    init: initialize, wasm: { authored_source_recipes: authoredSourceRecipesDouble, AnimatedScene, DesktopQuality, desktop_backing_size: desktopBackingOracle }, syntheticScene, syntheticStep,
    readAuthoredSourceRecipes, createSyntheticBodyResolver, createSyntheticFoodResolver, createSyntheticPreyResolver, syntheticPreyCommands, desktopBackingSize,
    loopbackEndpoint, sceneHeading, connectLoopback, window, AbortController,
    document: {
      querySelector(selector) {
        const element = elements[selector.slice(1)];
        assert.ok(element, `known synthetic control ${selector}`);
        return element;
      },
      createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); },
    },
    Image: PageImage, HTMLImageElement: PageImage, HTMLCanvasElement: Canvas,
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
    qualityView, renderMethods, renderScales, resolvedRecipes, qualityFrees: () => qualityFrees,
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
  assert.deepEqual(page.calls.filter(call => !call[0].startsWith('quality.')), [
    ['gaze', radians], ['advance', nowMs, false], ['step.free'], ['render'], ['snapshot'],
  ]);
  assert.deepEqual(page.calls.map(call => call[0]), ['gaze', 'advance', 'quality.advance', 'step.free',
    'quality.statistics', 'quality.snapshot', 'render', 'snapshot']);
  assert.equal(page.frames.size, 1);
}

test('RAF applies initial zero gaze before one advance, frees the step and renders once', async t => {
  const page = pageFixture(t);
  await page.ready;
  expectFrame(page, 10.125, 0);
  assert.equal(page.window.slitherAnimatedSceneReport.renders, 2);
  assert.equal(page.window.slitherAnimatedSceneReport.ownHead, null);
  expectFrame(page, 110.5, 0);
  assert.equal(page.window.slitherAnimatedSceneReport.renders, 3);
  assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 0, stepFrees: 2 });
});

test('initial Setup draws synchronously with view policy installed and no animation step', async t => {
  const page = pageFixture(t);
  await page.ready;
  assert.deepEqual(page.renderMethods, ['standard']);
  assert.deepEqual([page.elements.scene.width, page.elements.scene.height], [1500, 845]);
  const names = page.calls.map(call => call[0]);
  assert(names.indexOf('follow') < names.indexOf('applyDraw'));
  assert(names.indexOf('zoom') < names.indexOf('applyDraw'));
  assert.deepEqual(page.calls.filter(call => call[0] === 'applyDraw'), [['applyDraw', 'standard', 1500, 845]]);
  assert.equal(names.some(name => ['advance', 'quality.advance', 'quality.statistics', 'step.free'].includes(name)), false);
  assert.equal(page.frames.size, 1, 'Setup adds no extra RAF');
});

test('resize draws immediately even at unchanged size, without touching clock or quality', async t => {
  const page = pageFixture(t);
  await page.ready;
  page.calls.length = 0;
  page.window.emit('resize');
  assert.deepEqual(page.calls, [['render'], ['snapshot']]);
  assert.deepEqual([page.elements.scene.width, page.elements.scene.height], [1500, 845]);
  page.calls.length = 0;
  Object.assign(page.window, { innerWidth: 800, innerHeight: 600 });
  page.window.emit('resize');
  assert.deepEqual(page.calls, [['render'], ['snapshot']]);
  assert.deepEqual([page.elements.scene.width, page.elements.scene.height], [1440, 1080]);
  assert.equal(page.frames.size, 1);
  page.calls.length = 0;
  page.frame(1011);
  assert.deepEqual(page.calls.find(call => call[0] === 'quality.statistics'), ['quality.statistics', 1011, 3, true]);
  assert.equal(page.window.slitherAnimatedSceneReport.renders, 4);
});

test('all engine-reported Setup submissions count before the next local RAF', async t => {
  const page = pageFixture(t);
  await page.ready;
  const session = page.connect();
  page.calls.length = 0;
  page.faults.setupDraws = 3;
  assert.equal(session.options.scene.apply_frame(bundle(syntheticSetup(), syntheticSetup(), syntheticSetup()), false), 3);
  assert.deepEqual(page.calls.filter(call => call[0] === 'applyDraw'), [['applyDraw', 'basic', 1500, 845]]);
  assert.equal(page.calls.filter(call => call[0] === 'render').length, 3);
  assert.equal(page.calls.some(call => ['advance', 'quality.advance', 'quality.statistics', 'step.free'].includes(call[0])), false);
  page.calls.length = 0;
  page.frame(1011);
  assert.deepEqual(page.calls.find(call => call[0] === 'quality.statistics'), ['quality.statistics', 1011, 4, true]);
  assert.equal(page.window.slitherAnimatedSceneReport.renders, 5);
});

test('synthetic reset selects its renderer before applying Setup after local mode', async t => {
  const page = pageFixture(t);
  await page.ready;
  const session = page.connect();
  page.calls.length = 0;
  page.elements.reset.emit('click');
  assert.equal(session.closes, 1);
  assert.deepEqual(page.calls.filter(call => call[0] === 'applyDraw'), [['applyDraw', 'standard', 1500, 845]]);
  assert.equal(page.renderMethods.at(-1), 'standard');
  assert.equal(page.calls.some(call => call[0] === 'advance'), false);
});

test('invalid resize stops the preview before any Wasm draw or update', async t => {
  const page = pageFixture(t);
  await page.ready;
  page.calls.length = 0;
  page.window.innerWidth = 0;
  page.window.emit('resize');
  assert.deepEqual(page.calls.map(call => call[0]), ['connected', 'scene.free', 'quality.free']);
  assert.equal(page.frames.size, 0);
  assert.match(page.elements.status.textContent, /viewport/);
});

test('target-aware packet failure stops transport and preserves the thrown error', async t => {
  const page = pageFixture(t);
  await page.ready;
  const session = page.connect();
  const error = new Error('synthetic target-aware rejection');
  page.faults.apply = error;
  page.calls.length = 0;
  assert.throws(() => session.options.scene.apply_frame(syntheticSetup(), false), value => value === error);
  assert.deepEqual(page.calls.map(call => call[0]), ['applyDraw', 'connected', 'scene.free', 'quality.free']);
  assert.equal(session.closes, 1);
  assert.equal(page.frames.size, 0);
});

test('resets keep one owner and add only synthetic Setup draws without updates', async t => {
  const page = pageFixture(t);
  await page.ready;
  assert.deepEqual(page.calls.filter(call => call[0] === 'reset'), [['reset']]);
  page.frame(13);
  page.calls.length = 0;
  page.elements.skin.value = '1';
  page.elements.skin.emit('change');
  page.elements.reset.emit('click');
  page.connect();
  page.elements.disconnect.emit('click');
  page.connect();
  assert.deepEqual(page.calls.filter(call => call[0] === 'reset'), Array.from({ length: 4 }, () => ['reset']));
  assert.equal(page.calls.some(call => ['advance', 'step.free'].includes(call[0])), false);
  assert.equal(page.calls.filter(call => call[0] === 'render').length, 2);
  assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 0, stepFrees: 1 });
  page.window.emit('pagehide');
  page.window.emit('pagehide');
  assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 1, stepFrees: 1 });
  assert.equal(page.qualityFrees(), 1);
});

test('quality statistics receive raw successful draws at the strict interval before the next draw', async t => {
  const page = pageFixture(t);
  await page.ready;
  page.calls.length = 0;
  for (const nowMs of [1010, 1011, 2011, 2012]) page.frame(nowMs);
  assert.deepEqual(page.calls.filter(call => call[0] === 'quality.statistics'), [
    ['quality.statistics', 1010, 1, true], ['quality.statistics', 1011, 2, true],
    ['quality.statistics', 2011, 1, true], ['quality.statistics', 2012, 2, true],
  ]);
  assert.deepEqual(page.renderMethods, ['standard', 'standard', 'standard', 'standard', 'standard']);
  assert.equal(page.window.slitherAnimatedSceneReport.renders, 4, 'the throttled readout does not define the draw counter');
  assert.equal(page.resolvedRecipes[0].recipe.bodyStyle.rotateSegments, true);
});

test('preference is deferred until connection; preview reset preserves the statistics interval and count', async t => {
  const page = pageFixture(t);
  await page.ready;
  page.frame(20);
  page.calls.length = 0;
  page.elements.quality.value = '0';
  page.elements.quality.emit('change');
  assert.deepEqual(page.calls, [['quality.requested', 0]]);
  assert.equal(page.qualityView.highQuality, true);
  page.elements.reset.emit('click');
  assert.equal(page.qualityView.requested, 0);
  assert.equal(page.qualityView.highQuality, true);
  page.frame(1011);
  assert.deepEqual(page.calls.find(call => call[0] === 'quality.statistics'), ['quality.statistics', 1011, 3, true]);
  page.connect();
  assert.equal(page.qualityView.highQuality, false);
  page.calls.length = 0;
  page.frame(2012);
  assert.deepEqual(page.calls.find(call => call[0] === 'quality.statistics'), ['quality.statistics', 2012, 1, true]);
  assert.equal(page.renderMethods.at(-1), 'basic', 'local mode retains its existing renderer explicitly');
  assert.equal(page.renderScales.at(-1), 1.7);
  assert.equal(page.window.slitherAnimatedSceneReport.quality.requested, 0);
});

for (const fault of ['qualityAdvance', 'statistics']) {
  test(`${fault} failure frees the borrowed step and both owners without rendering`, async t => {
    const page = pageFixture(t);
    await page.ready;
    page.faults[fault] = new Error(`synthetic ${fault}`);
    page.frame(20);
    assert.deepEqual(page.renderMethods, ['standard'], 'only the earlier initial Setup rendered');
    assert.equal(page.frames.size, 0);
    assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 1, stepFrees: 1 });
    assert.equal(page.qualityFrees(), 1);
    assert.match(page.elements.status.textContent, new RegExp(fault));
  });
}

test('synthetic gaze uses fractional backing-pixel offsets, signed radians and center zero without own', async t => {
  const page = pageFixture(t);
  await page.ready;
  for (const [clientX, clientY, angle] of [
    [331.75, 124.25, Math.atan2(-73.9375, 192.96875)],
    [224.25, 165.5, Math.atan2(119.70833333333337, -142.96875)],
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
  const angle = Math.atan2(-73.9375, 192.96875);
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
  expectFrame(page, 20, Math.atan2(-73.9375, 192.96875));
  page.pointer(331.75, 124.25);
  assert.deepEqual(session.inputs, [[195, false]]);
  expectFrame(page, 28, Math.atan2(-73.9375, 192.96875));
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
  expectFrame(page, 28, Math.atan2(119.70833333333337, -142.96875));
  assert.equal(session.inputs.length, 1, 'retained own diagnostics do not enable steering');
  assert.equal(page.advances.at(-1).gaze, Math.atan2(119.70833333333337, -142.96875));
  session.options.onStatus('Local life ended');
  page.pointer(331.75, 124.25);
  expectFrame(page, 140, Math.atan2(-73.9375, 192.96875));
  assert.equal(page.advances.at(-1).gaze, Math.atan2(-73.9375, 192.96875));
  assert.equal(session.inputs.length, 1);
  assert.equal(page.window.slitherAnimatedSceneReport.connected, false);
  assert.equal(page.elements.disconnect.disabled, true);
});

test('latest pointer gaze reaches a new appearance and survives reset and manual disconnect', async t => {
  const page = pageFixture(t);
  await page.ready;
  page.pointer(224.25, 165.5);
  page.pointer(331.75, 124.25);
  const angle = Math.atan2(-73.9375, 192.96875);
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
  expectFrame(page, 44, Math.atan2(119.70833333333337, -142.96875));
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
  assert.deepEqual(page.calls, [['applyDraw', 'standard', 1500, 845], ['apply', [...syntheticStep(1)], false], ['zoom', 2], ['follow', false]]);
  page.elements.reset.emit('click');
  page.calls.length = 0;
  page.elements.step.emit('click');
  assert.deepEqual(page.calls, [['applyDraw', 'standard', 1500, 845], ['apply', [...syntheticStep(1)], false]]);
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
    assert.deepEqual(session.inputs.at(-1), [195, true]);
    release();
    assert.deepEqual(session.inputs.at(-1), [195, false]);
  }
  expectFrame(page, 28, Math.atan2(-73.9375, 192.96875));
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
  page.window.emit('resize');
  staleCallback(28);
  assert.deepEqual(page.calls, []);
  assert.deepEqual(session.inputs, []);
  assert.equal(page.frames.size, 0);
  assert.equal(session.closes, 1);
  assert.equal(page.qualityFrees(), 1);
  for (const id of ['reset', 'step', 'skin', 'zoom', 'follow', 'quality', 'connect', 'disconnect']) {
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
      ? ['gaze', 'connected', 'scene.free', 'quality.free'] : ['gaze', 'advance', 'quality.advance', 'step.free',
        'quality.statistics', 'quality.snapshot', 'render', 'connected', 'scene.free', 'quality.free']);
    assert.equal(page.frames.size, 0);
    assert.equal(session.closes, 1);
    assert.deepEqual(page.counts(), { constructions: 1, sceneFrees: 1, stepFrees: fault === 'render' ? 1 : 0 });
    assert.match(page.elements.status.textContent, new RegExp(`synthetic ${fault} failure`));
  });
}

test('only Setup activates the boundary gate through connecting, open, stop and reconnect', async t => {
  const page = pageFixture(t);
  await page.ready;
  assert.equal(page.view.boundary.connected, true, 'synthetic Setup activates the native gate');
  page.calls.length = 0;
  page.elements.connect.emit('click');
  const first = page.sessions.at(-1);
  assert.equal(page.view.boundary.connected, false, 'a connecting handle cannot retain the synthetic gate');
  assert.deepEqual(page.calls, [['connected', false]]);
  first.open();
  assert.equal(page.view.boundary.connected, false, 'open resets but does not activate the gate');
  first.options.scene.apply_frame(syntheticSetup(), false);
  assert.equal(page.view.boundary.connected, true);
  page.elements.disconnect.emit('click');
  assert.equal(page.view.boundary.connected, false);
  assert.equal(first.closes, 1);
  for (const status of ['Local connection failed', 'Local life ended', 'Local frame rejected: synthetic']) {
    const session = page.connect();
    assert.equal(page.view.boundary.connected, false);
    session.options.scene.apply_frame(syntheticSetup(), false);
    assert.equal(page.view.boundary.connected, true);
    page.calls.length = 0;
    session.options.onStatus(status);
    assert.deepEqual(page.calls, [['connected', false]], 'status changes no animation or packet clocks');
    assert.equal(page.view.boundary.connected, false);
    assert.equal(page.elements.connect.disabled, false);
  }
  page.elements.reset.emit('click');
  assert.equal(page.view.boundary.connected, true, 'synthetic reset reconnects via Setup');
  const session = page.connect();
  page.window.emit('pagehide');
  page.calls.length = 0;
  session.options.onStatus('Disconnected');
  session.options.onStatus('Connected to local simulator');
  assert.deepEqual(page.calls, [], 'late statuses never access a freed owner');
  assert.equal(page.frames.size, 0);
});

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
