// Authored copied-data and identity shell for the Rust-owned semantic HUD history.
import { copyHudIngressReport, copyHudScoreView } from './stock-hud-contract.mjs';

const freeze = Object.freeze;
// Weak membership associates copied snapshots with immutable Rust handles without
// retaining old snapshots or reflecting through supplied state/prototype graphs.
const issued = new WeakMap();
const invalid = () => { throw new TypeError('Invalid HUD state change'); };
const changeFields = {
  packet: ['kind', 'report'],
  step: ['kind', 'delta', 'lifecycle'],
  'world-reset': ['kind'],
  draw: ['kind', 'playing', 'view'],
};

function data(value, key) {
  if (value === null || typeof value !== 'object') invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
  return descriptor.value;
}

function record(value, fields) {
  if (value === null || typeof value !== 'object') invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) invalid();
  const copy = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !fields.includes(key)) invalid();
    copy[key] = data(value, key);
  }
  return copy;
}

function boolean(value) {
  if (typeof value !== 'boolean') invalid();
}

function stateRequired(state) {
  if (!issued.has(state)) invalid();
}

function snapshot(history, sceneIdentity, methods) {
  const copied = Reflect.apply(methods.snapshot, history, []);
  const state = freeze({ schema: 1, sceneIdentity, ...copied });
  issued.set(state, { history, methods });
  return state;
}

/** Initialize one scene's Rust history; capture the generated ABI once. */
export function createHudState(sceneIdentity, HudHistory) {
  if (typeof sceneIdentity !== 'symbol' || typeof HudHistory !== 'function') invalid();
  const methods = {};
  for (const name of ['snapshot', 'reduce', 'required', 'values', 'free']) {
    const descriptor = Object.getOwnPropertyDescriptor(HudHistory.prototype, name);
    if (!descriptor || typeof descriptor.value !== 'function') invalid();
    methods[name] = descriptor.value;
  }
  freeze(methods);
  const history = new HudHistory();
  try { return snapshot(history, sceneIdentity, methods); }
  catch (error) {
    try { Reflect.apply(methods.free, history, []); } catch { /* Preserve the copy failure. */ }
    throw error;
  }
}

/** Eligibility only; never accesses a native score view. */
export function hudReadoutRequired(state, playing) {
  stateRequired(state);
  boolean(playing);
  const { history, methods } = issued.get(state);
  return Reflect.apply(methods.required, history, [playing]);
}

/** Copy Rust-formatted values for the binding/readiness projection. */
export function hudSemanticValues(state, includesFinal) {
  stateRequired(state);
  boolean(includesFinal);
  const { history, methods } = issued.get(state);
  return Reflect.apply(methods.values, history, [includesFinal]);
}

/** Return a complete frozen candidate or throw; never mutates the input. */
export function reduceHudState(state, sceneIdentity, change) {
  stateRequired(state);
  if (typeof sceneIdentity !== 'symbol' || sceneIdentity !== state.sceneIdentity) invalid();
  const kind = data(change, 'kind');
  if (typeof kind !== 'string' || !Object.hasOwn(changeFields, kind)) invalid();
  const input = record(change, changeFields[kind]);
  if (input.kind !== kind) invalid();
  // Validate/copy every supplied field before folding even an unpublished prefix.
  if (kind === 'packet') {
    input.report = copyHudIngressReport(input.report, data(input.report, 'commandCount'));
  } else if (kind === 'step') {
    input.lifecycle = record(input.lifecycle,
      ['schema', 'deathPending', 'returnActive', 'returnCompleted', 'returnFraction']);
    if (input.lifecycle.schema !== 1) invalid();
    for (const name of ['deathPending', 'returnActive', 'returnCompleted']) boolean(input.lifecycle[name]);
    if (typeof input.delta !== 'number' || typeof input.lifecycle.returnFraction !== 'number') invalid();
    freeze(input.lifecycle);
  } else if (kind === 'draw') {
    boolean(input.playing);
    if (hudReadoutRequired(state, input.playing)) input.view = copyHudScoreView(input.view);
    else if (input.view !== null) invalid();
  }

  freeze(input);
  const { history, methods } = issued.get(state);
  const next = Reflect.apply(methods.reduce, history, [input]);
  try { return snapshot(next, sceneIdentity, methods); }
  catch (error) {
    try { Reflect.apply(methods.free, next, []); } catch { /* Preserve the copy failure. */ }
    throw error;
  }
}
