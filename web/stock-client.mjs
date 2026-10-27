// Original controller seam for the parent extension's actual packet and draw path.
// Scene, quality, transport, scheduling and borrowed artwork remain caller-owned.
const freeze = Object.freeze;

function size(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 4096) throw new RangeError('Invalid stock backing size');
  return value;
}
function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`Finite ${label} required`);
  return value;
}
function flag(value) {
  if (typeof value !== 'boolean') throw new TypeError('Explicit boolean required');
  return value;
}
function synchronousCallback(value, name) {
  if (value === undefined) return;
  if (typeof value !== 'function' || ['[object AsyncFunction]', '[object GeneratorFunction]', '[object AsyncGeneratorFunction]']
    .includes(Object.prototype.toString.call(value))) throw new TypeError(`Synchronous ${name} callback required`);
}

export function createStockClient({ scene, quality, adapter, hostAssets, target, palettes, background, width, height }) {
  const requireMethod = (record, name) => {
    if (typeof record?.[name] !== 'function') throw new TypeError(`Stock capability required: ${name}`);
  };
  for (const name of ['apply_frame_and_render_standard_with_face_presentation_and_prey', 'render_standard_with_face_presentation_at_size', 'advance', 'set_gaze_heading']) requireMethod(scene, name);
  for (const name of ['advance', 'update_statistics']) requireMethod(quality, name);
  for (const name of ['beginOperation', 'resolveAppearance', 'resolveRecipe', 'resolveAntennaRandom', 'endOperation']) requireMethod(adapter, name);
  for (const name of ['resolveFood', 'resolvePrey']) requireMethod(hostAssets, name);
  if (!Array.isArray(palettes) || palettes.length !== 3) throw new TypeError('Three renderer context palettes required');
  const contextPalettes = [...palettes];
  let backingWidth = size(width);
  let backingHeight = size(height);
  let draws = 0;
  let drawsSinceStatistics = 0;
  let stopped = false;
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

  function diagnostics() { return freeze({ draws, drawsSinceStatistics, width: backingWidth, height: backingHeight, stopped }); }
  function run(callback, snapshot = false) {
    if (busy) throw new Error('Stock controller reentry');
    if (stopped) throw new Error('Stock controller stopped');
    busy = true;
    let began = false;
    let result, failure;
    let failed = false;
    try {
      if (snapshot) { operation = adapter.beginOperation(); began = true; }
      result = callback();
    } catch (error) {
      stopped = true;
      failed = true;
      failure = error;
    }
    try { if (began) adapter.endOperation(); }
    catch (error) {
      stopped = true;
      if (!failed) { failed = true; failure = error; }
    } finally { operation = null; busy = false; }
    if (failed) throw failure;
    return result;
  }
  function countDraws(count) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffffff) throw new RangeError('Invalid successful Setup draw count');
    draws += count;
    drawsSinceStatistics += count;
    if (!Number.isSafeInteger(draws) || drawsSinceStatistics > 0xffffffff) throw new RangeError('Stock draw counter exhausted');
  }
  function renderAt(w, h) {
    scene.render_standard_with_face_presentation_at_size(target, ...contextPalettes, background, w, h,
      resolveRecipe, resolveRandom, quality);
    countDraws(1);
  }
  function updateOptions(nowMs, options) {
    finite(nowMs, 'time');
    if (options === null || typeof options !== 'object') throw new TypeError('Update options required');
    const { lagging = false, playing = true, gazeHeading, onStep, control } = options;
    flag(lagging); flag(playing);
    if (gazeHeading !== undefined) finite(gazeHeading, 'gaze heading');
    synchronousCallback(onStep, 'onStep');
    synchronousCallback(control, 'control');
    if (control !== undefined) {
      requireMethod(scene, 'advance_with_control');
      if (gazeHeading !== undefined) throw new TypeError('Return gazeHeading from control actions');
    }
    return { lagging, playing, gazeHeading, onStep, control };
  }
  function advance(nowMs, { lagging, playing, gazeHeading, onStep, control }) {
    if (gazeHeading !== undefined) scene.set_gaze_heading(gazeHeading);
    const step = control === undefined ? scene.advance(nowMs, lagging)
      : scene.advance_with_control(nowMs, lagging, control);
    let observed;
    try {
      quality.advance(step, playing);
      if (onStep !== undefined) {
        const wholeSteps = step.whole_steps;
        const delta = step.delta;
        if (!Number.isInteger(wholeSteps) || wholeSteps < 0 || wholeSteps > 5
          || !Number.isFinite(delta) || delta < 0 || delta > 5) throw new RangeError('Invalid observed animation step');
        observed = freeze({ nowMs, wholeSteps, delta });
      }
    } finally { step.free(); }
    if (onStep !== undefined) {
      // Post-advance observation cannot move input/gaze ahead of this update.
      // Only copied numbers escape; the Wasm step has already been freed.
      const result = onStep(observed);
      if (result !== null && (typeof result === 'object' || typeof result === 'function')
        && typeof result.then === 'function') throw new TypeError('onStep callback must be synchronous');
    }
    if (quality.update_statistics(nowMs, drawsSinceStatistics, playing)) drawsSinceStatistics = 0;
  }
  return freeze({
    packet(bytes, elapsedHeader = false) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('Packet Uint8Array required');
      flag(elapsedHeader);
      return run(() => {
        const count = scene.apply_frame_and_render_standard_with_face_presentation_and_prey(bytes, elapsedHeader,
          resolveAppearance, resolveFood, resolvePrey, target, ...contextPalettes, background, backingWidth,
          backingHeight, resolveRecipe, resolveRandom, quality);
        countDraws(count);
        return count;
      }, true);
    },
    update(nowMs, options = {}) {
      const input = updateOptions(nowMs, options);
      return run(() => { advance(nowMs, input); return diagnostics(); });
    },
    frame(nowMs, options = {}) {
      const input = updateOptions(nowMs, options);
      return run(() => { advance(nowMs, input); renderAt(backingWidth, backingHeight); return diagnostics(); }, true);
    },
    resize(width, height) {
      const w = size(width), h = size(height);
      return run(() => { renderAt(w, h); backingWidth = w; backingHeight = h; return diagnostics(); }, true);
    },
    render() {
      return run(() => { renderAt(backingWidth, backingHeight); return diagnostics(); }, true);
    },
    diagnostics,
    dispose() {
      if (busy) throw new Error('Stock controller reentry');
      stopped = true;
    },
  });
}
