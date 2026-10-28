// Authored copied view; no DOM, native, scene or clock capabilities.
import { requireLeaderboardState } from './stock-leaderboard-state.mjs';
import { hudReadoutRequired } from './stock-hud-state.mjs';

const freeze = Object.freeze;
const issued = new WeakSet();
let active = false, poisoned = false;
const invalid = () => { throw new TypeError('Invalid leaderboard view input'); };
const fields = ['schema', 'bindingIdentity', 'documentIdentity', 'sceneIdentity', 'state', 'reason'];
const pendingReasons = ['nodes-pending', 'text-unselected'];
const unavailableReasons = ['stale-document', 'binding-not-selected',
  'native-dom-unavailable', 'binding-failed', 'disposed'];

function binding(value) {
  if (value === null || typeof value !== 'object') invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) invalid();
  const copy = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !fields.includes(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    copy[key] = descriptor.value;
  }
  if (copy.schema !== 1 || typeof copy.bindingIdentity !== 'symbol'
    || typeof copy.documentIdentity !== 'symbol' || typeof copy.sceneIdentity !== 'symbol') invalid();
  if (copy.state === 'ready') {
    if (copy.reason !== null) invalid();
  } else if (copy.state === 'pending') {
    if (!pendingReasons.includes(copy.reason)) invalid();
  } else if (copy.state === 'unavailable') {
    if (!unavailableReasons.includes(copy.reason)) invalid();
  } else invalid();
  return copy;
}

/** Copy genuine same-scene row/HUD history and a closed binding observation. */
function project(state, hudSnapshot, observation) {
  // Membership precedes any arbitrary binding reflection.
  const disabled = state === null;
  if (disabled) {
    if (hudSnapshot !== null) invalid();
  } else {
    requireLeaderboardState(state);
    hudReadoutRequired(hudSnapshot, false);
    if (state.sceneIdentity !== hudSnapshot.sceneIdentity) invalid();
  }
  const observed = binding(observation);
  if (!disabled && state.sceneIdentity !== observed.sceneIdentity) invalid();
  const boardPresent = !disabled && state.board !== null;
  let readiness, reason;
  if (observed.state === 'unavailable') {
    readiness = observed.state;
    reason = observed.reason;
  } else if (disabled) {
    readiness = 'unavailable';
    reason = 'leaderboard-disabled-or-disposed';
  } else if (observed.state === 'pending') {
    readiness = observed.state;
    reason = observed.reason;
  } else if (!boardPresent) {
    readiness = 'pending';
    reason = 'no-board';
  } else {
    readiness = 'ready';
    reason = null;
  }
  // The HUD shows the top ten; larger valid wire boards stay in packet history.
  const rows = freeze(boardPresent ? state.board.rows.slice(0, 10).map(row => freeze({ ...row })) : []);
  const view = freeze({ schema: 1, bindingIdentity: observed.bindingIdentity,
    documentIdentity: observed.documentIdentity, sceneIdentity: observed.sceneIdentity,
    revision: disabled ? null : state.revision,
    binding: freeze({ state: observed.state, reason: observed.reason }), readiness, reason,
    setupSeen: !disabled && state.setupSeen, boardPresent,
    requestedOpacity: disabled ? null : freeze({ heading: hudSnapshot.requestedOpacity.header,
      rows: hudSnapshot.requestedOpacity.rows }), rows });
  issued.add(view);
  return view;
}

export function projectLeaderboardView(state, hudSnapshot, observation) {
  if (active) {
    poisoned = true;
    invalid();
  }
  active = true;
  poisoned = false;
  try {
    const result = project(state, hudSnapshot, observation);
    if (poisoned) invalid();
    return result;
  } finally {
    active = false;
  }
}

/** Only this module graph's issued copied views grant admission. */
export function requireLeaderboardView(value) {
  if (!issued.has(value)) invalid();
  return value;
}
