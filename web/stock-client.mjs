// Native capability/resource shell for the browser-free stock controller owner.
import { copyHudIngressPlan, copyHudIngressReport } from './stock-hud-contract.mjs';

const freeze = Object.freeze;
const typedLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float64Array.prototype), 'length').get;
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
function flag(value) {
  if (typeof value !== 'boolean') throw new TypeError('Explicit boolean required');
  return value;
}
function synchronousCallback(value, name) {
  if (value === undefined) return;
  if (typeof value !== 'function' || ['[object AsyncFunction]', '[object GeneratorFunction]', '[object AsyncGeneratorFunction]']
    .includes(Object.prototype.toString.call(value))) throw new TypeError(`Synchronous ${name} callback required`);
}
function capture(object, name) {
  for (let p = object; p !== null; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, name);
    if (d) { if (typeof d.value !== 'function') break; return d.value; }
  }
  throw new TypeError(`StockControllerPolicy capability required: ${name}`);
}
function copiedSnapshot(value) {
  if (!(value instanceof Float64Array) || Reflect.apply(typedLength, value, []) !== 5) {
    throw new TypeError('Invalid controller snapshot');
  }
  // Public object creation and any host-side failure occur after the Rust borrow.
  const fields = {};
  for (const [index, key] of ['draws', 'drawsSinceStatistics', 'width', 'height', 'stopped'].entries()) {
    Object.defineProperty(fields, key, { value: index === 4 ? value[index] !== 0 : value[index], enumerable: true });
  }
  return freeze(fields);
}

export function createStockClient({ scene, quality, adapter, hostAssets, target, palettes, background, width, height,
  appearanceMode = 'face', StockControllerPolicy }) {
  if (appearanceMode !== 'face' && appearanceMode !== 'accessory') throw new TypeError('Invalid stock appearance mode');
  const packetMethod = `apply_frame_and_render_standard_with_${appearanceMode}_presentation_and_prey`;
  const renderMethod = `render_standard_with_${appearanceMode}_presentation_at_size`;
  const hudMethod = `${packetMethod}_and_hud`;
  const requireMethod = (record, name) => {
    if (typeof record?.[name] !== 'function') throw new TypeError(`Stock capability required: ${name}`);
  };
  for (const name of [packetMethod, renderMethod, 'advance', 'set_gaze_heading']) requireMethod(scene, name);
  for (const name of ['advance', 'update_statistics']) requireMethod(quality, name);
  for (const name of ['beginOperation', 'resolveAppearance', 'resolveRecipe', 'resolveAntennaRandom', 'endOperation']) requireMethod(adapter, name);
  for (const name of ['resolveFood', 'resolvePrey']) requireMethod(hostAssets, name);
  if (!Array.isArray(palettes) || palettes.length !== 3) throw new TypeError('Three renderer context palettes required');
  const contextPalettes = [...palettes];
  if (typeof StockControllerPolicy !== 'function') throw new TypeError('StockControllerPolicy capability required');
  const methods = {}, statics = {};
  for (const name of ['snapshot', 'stage', 'uses_control', 'playing', 'target_width', 'target_height',
    'statistics_count', 'is_stopped', 'begin_packet', 'begin_draw', 'begin_update', 'gaze_done',
    'advance_done', 'playing_observed', 'quality_done', 'step_observed', 'step_freed', 'observer_done',
    'statistics_result', 'packet_succeeded', 'draw_succeeded', 'finish', 'stop', 'free']) {
    methods[name] = capture(StockControllerPolicy.prototype, name);
  }
  for (const name of ['validate_size', 'validate_time', 'validate_gaze']) statics[name] = capture(StockControllerPolicy, name);
  function size(value) {
    if (typeof value !== 'number') throw new RangeError('Invalid stock backing size');
    return Reflect.apply(statics.validate_size, StockControllerPolicy, [value]);
  }
  function finite(value, label) {
    if (typeof value !== 'number') throw new TypeError(`Finite ${label} required`);
    Reflect.apply(label === 'time' ? statics.validate_time : statics.validate_gaze, StockControllerPolicy, [value]);
    return value;
  }
  const w = size(width), h = size(height);
  let state = new StockControllerPolicy(w, h), retired;
  let releaseRequested = false;
  const invoke = (name, args = []) => Reflect.apply(methods[name], state, args);
  try {
  let busy = false;
  let operation = null;
  function withinOperation(callback) {
    if (!busy || operation === null) throw new Error('Stock callback outside operation');
    return callback();
  }
  const resolveAppearance = request => withinOperation(() => adapter.resolveAppearance(request));
  const resolveRecipe = request => withinOperation(() => adapter.resolveRecipe(request));
  const resolveRandom = request => withinOperation(() => adapter.resolveAntennaRandom(request));
  const resolveFood = request => withinOperation(() => hostAssets.resolveFood(request, operation));
  const resolvePrey = request => withinOperation(() => hostAssets.resolvePrey(request, operation));
  function diagnostics() {
    if (state) return copiedSnapshot(invoke('snapshot'));
    if (!retired) throw new Error('Stock controller disposed');
    return copiedSnapshot(retired);
  }
  function run(begin, callback, snapshot = false, preflight) {
    if (busy) throw new Error('Stock controller reentry');
    if (releaseRequested || invoke('is_stopped')) throw new Error('Stock controller stopped');
    busy = true;
    let began = false, failed = false;
    let result, failure;
    try {
      begin();
      if (preflight !== undefined) preflight();
      if (snapshot) { operation = adapter.beginOperation(); began = true; }
      result = callback();
      invoke('finish');
    } catch (error) {
      invoke('stop');
      failed = true; failure = error;
    }
    try { if (began) adapter.endOperation(); }
    catch (error) {
      invoke('stop');
      if (!failed) { failed = true; failure = error; }
    } finally { operation = null; busy = false; }
    if (failed) throw failure;
    return result;
  }
  function renderAt() {
    scene[renderMethod](target, ...contextPalettes, background, invoke('target_width'), invoke('target_height'),
      resolveRecipe, resolveRandom, quality);
    invoke('draw_succeeded');
  }
  function updateOptions(nowMs, options) {
    finite(nowMs, 'time');
    if (options === null || typeof options !== 'object') throw new TypeError('Update options required');
    const { lagging = false, playing = true, gazeHeading, onStep, control, readPlaying } = options;
    flag(lagging); flag(playing);
    if (gazeHeading !== undefined) finite(gazeHeading, 'gaze heading');
    synchronousCallback(onStep, 'onStep');
    synchronousCallback(control, 'control');
    synchronousCallback(readPlaying, 'readPlaying');
    if (readPlaying !== undefined && control === undefined) throw new TypeError('readPlaying requires control');
    if (control !== undefined) {
      requireMethod(scene, 'advance_with_control');
      if (gazeHeading !== undefined) throw new TypeError('Return gazeHeading from control actions');
    }
    return { lagging, playing, gazeHeading, onStep, control, readPlaying };
  }
  function advance(nowMs, { lagging, gazeHeading, onStep, control, readPlaying }) {
    if (invoke('stage') === 1) { scene.set_gaze_heading(gazeHeading); invoke('gaze_done'); }
    const step = invoke('uses_control') ? scene.advance_with_control(nowMs, lagging, control)
      : scene.advance(nowMs, lagging);
    let observed;
    try {
      invoke('advance_done');
      if (invoke('stage') === 3) invoke('playing_observed', [flag(readPlaying())]);
      quality.advance(step, invoke('playing'));
      invoke('quality_done');
      if (invoke('stage') === 5) {
        const wholeSteps = step.whole_steps;
        const delta = step.delta;
        if (typeof wholeSteps !== 'number' || typeof delta !== 'number') throw new RangeError('Invalid observed animation step');
        invoke('step_observed', [wholeSteps, delta]);
        observed = freeze({ nowMs, wholeSteps, delta });
      }
    } finally { step.free(); }
    invoke('step_freed');
    if (invoke('stage') === 7) {
      // The ordinary finally above intentionally lets a throwing free replace body errors.
      const result = onStep(observed);
      if (result !== null && (typeof result === 'object' || typeof result === 'function')
        && typeof result.then === 'function') throw new TypeError('onStep callback must be synchronous');
      invoke('observer_done');
    }
    const consumed = quality.update_statistics(nowMs, invoke('statistics_count'), invoke('playing'));
    invoke('statistics_result', [!!consumed]);
  }
  const beginUpdate = (frame, input) => invoke('begin_update', [frame, input.gazeHeading !== undefined,
    input.control !== undefined, input.readPlaying !== undefined, input.onStep !== undefined, input.playing]);
  diagnostics();
  return freeze({
    packetWithHud(bytes, elapsedHeader, plan) {
      let copiedPlan, apply;
      return run(() => invoke('begin_packet'), () => {
        const nativeReport = Reflect.apply(apply, scene, [bytes, elapsedHeader,
          resolveAppearance, resolveFood, resolvePrey, target, ...contextPalettes, background, invoke('target_width'),
          invoke('target_height'), resolveRecipe, resolveRandom, quality, copiedPlan]);
        const report = copyHudIngressReport(nativeReport, copiedPlan.commandCount);
        if (report.schema !== copiedPlan.schema) throw new TypeError('Invalid HUD data');
        invoke('packet_succeeded', [report.setupDraws]);
        return report;
      }, true, () => {
        if (!(bytes instanceof Uint8Array)) throw new TypeError('Packet Uint8Array required');
        Reflect.apply(byteLength, bytes, []);
        flag(elapsedHeader);
        copiedPlan = copyHudIngressPlan(plan);
        apply = scene[hudMethod];
        if (typeof apply !== 'function') throw new TypeError(`Stock capability required: ${hudMethod}`);
      });
    },
    packet(bytes, elapsedHeader = false) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Packet Uint8Array required');
      flag(elapsedHeader);
      return run(() => invoke('begin_packet'), () => {
        const count = scene[packetMethod](bytes, elapsedHeader,
          resolveAppearance, resolveFood, resolvePrey, target, ...contextPalettes, background, invoke('target_width'),
          invoke('target_height'), resolveRecipe, resolveRandom, quality);
        if (typeof count !== 'number') throw new RangeError('Invalid successful Setup draw count');
        invoke('packet_succeeded', [count]);
        return count;
      }, true);
    },
    update(nowMs, options = {}) {
      const input = updateOptions(nowMs, options);
      return run(() => beginUpdate(false, input), () => { advance(nowMs, input); return diagnostics(); });
    },
    frame(nowMs, options = {}) {
      const input = updateOptions(nowMs, options);
      return run(() => beginUpdate(true, input), () => { advance(nowMs, input); renderAt(); return diagnostics(); }, true);
    },
    resize(width, height) {
      const w = size(width), h = size(height);
      return run(() => invoke('begin_draw', [true, w, h]), () => { renderAt(); return diagnostics(); }, true);
    },
    render() {
      return run(() => invoke('begin_draw', [false, 0, 0]), () => { renderAt(); return diagnostics(); }, true);
    },
    diagnostics,
    dispose() {
      if (busy) throw new Error('Stock controller reentry');
      if (releaseRequested) return;
      releaseRequested = true;
      let failed = false, primary;
      try { invoke('stop'); retired = invoke('snapshot'); copiedSnapshot(retired); }
      catch (error) { failed = true; primary = error; }
      const owner = state; state = null;
      try { Reflect.apply(methods.free, owner, []); }
      catch (error) { if (!failed) { failed = true; primary = error; } }
      if (failed) throw primary;
    },
  });
  } catch (error) {
    const owner = state; state = null;
    if (owner) { try { Reflect.apply(methods.free, owner, []); } catch { /* Preserve construction failure, even undefined. */ } }
    throw error;
  }
}
