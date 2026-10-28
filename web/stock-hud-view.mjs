// Authored pure HUD projection. Binding readiness is a trusted observation only.
import { hudReadoutRequired, hudSemanticValues } from './stock-hud-state.mjs';

const freeze = Object.freeze;
const issued = new WeakSet();
const bindingFields = ['schema', 'bindingIdentity', 'documentIdentity', 'sceneIdentity',
  'scope', 'state', 'reason'];
const pendingReasons = ['nodes-pending', 'text-unselected'];
const unavailableReasons = ['stale-document', 'binding-not-selected',
  'native-dom-unavailable', 'binding-failed', 'disposed'];
const invalid = () => { throw new TypeError('Invalid HUD view input'); };

/** @typedef {'readout' | 'readout-and-final'} HudScope */
/** @typedef {'unavailable' | 'pending' | 'ready'} Availability */
/** @typedef {null | 'nodes-pending' | 'text-unselected' | 'stale-document' |
 * 'binding-not-selected' | 'native-dom-unavailable' | 'binding-failed' |
 * 'disposed'} BindingReason */
/** @typedef {Readonly<{schema: 1, bindingIdentity: symbol, documentIdentity: symbol,
 * sceneIdentity: symbol, scope: HudScope, state: Availability,
 * reason: BindingReason}>} HudBindingReadiness */
/** @typedef {BindingReason | 'hud-disabled-or-disposed' | 'no-displayed-current' |
 * 'no-captured-final' | 'scope-excluded'} ViewReason */
/** @template T
 * @typedef {Readonly<{data: 'unavailable' | 'ready', readiness: Availability,
 * reason: ViewReason, value: T | null}>} Role */
/** @typedef {Readonly<{score: number, scoreText: string, rank: number,
 * rankText: string, population: number, populationText: string,
 * ownToken: bigint}>} CurrentValue */
/** @typedef {Readonly<{score: number, scoreText: string, exclamation: boolean,
 * suffix: '' | '!', ownToken: bigint}>} FinalValue */
/** @typedef {Readonly<{schema: 1, bindingIdentity: symbol, documentIdentity: symbol,
 * sceneIdentity: symbol, scope: HudScope,
 * binding: Readonly<{state: Availability, reason: BindingReason}>,
 * readiness: Availability, reason: ViewReason, fade: number | null,
 * requestedOpacity: Readonly<{readout: number, header: number, rows: number,
 * announcement: number}> | null, current: Role<CurrentValue>,
 * final: Role<FinalValue>}>} HudView */

function copyBinding(value) {
  if (value === null || typeof value !== 'object') invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== bindingFields.length) invalid();
  const copy = {};
  for (const key of keys) {
    if (typeof key !== 'string' || !bindingFields.includes(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    copy[key] = descriptor.value;
  }
  if (copy.schema !== 1 || typeof copy.bindingIdentity !== 'symbol'
    || typeof copy.documentIdentity !== 'symbol' || typeof copy.sceneIdentity !== 'symbol'
    || (copy.scope !== 'readout' && copy.scope !== 'readout-and-final')) invalid();
  if (copy.state === 'ready') {
    if (copy.reason !== null) invalid();
  } else if (copy.state === 'pending') {
    if (!pendingReasons.includes(copy.reason)) invalid();
  } else if (copy.state === 'unavailable') {
    if (!unavailableReasons.includes(copy.reason)) invalid();
  } else invalid();
  return copy;
}

function role(value, binding, disabled, absentReason) {
  if (disabled) return freeze({ data: 'unavailable', readiness: 'unavailable',
    reason: 'hud-disabled-or-disposed', value: null });
  if (binding.state !== 'ready') return freeze({ data: value === null ? 'unavailable' : 'ready',
    readiness: binding.state, reason: binding.reason, value });
  return freeze({ data: value === null ? 'unavailable' : 'ready',
    readiness: value === null ? 'pending' : 'ready',
    reason: value === null ? absentReason : null, value });
}

/** Project genuine reducer history and a closed binding observation into copied data.
 * @param {object | null} snapshot Issued by this module graph's stock-hud-state.
 * @param {HudBindingReadiness} binding
 * @returns {HudView}
 */
export function projectHudView(snapshot, binding) {
  const observed = copyBinding(binding);
  const disabled = snapshot === null;
  if (!disabled) {
    // Membership rejects wrappers/clones before touching their fields.
    hudReadoutRequired(snapshot, false);
    if (snapshot.sceneIdentity !== observed.sceneIdentity) invalid();
  }
  const includesFinal = observed.scope === 'readout-and-final';
  const values = disabled ? { current: null, final: null } : hudSemanticValues(snapshot, includesFinal);
  const currentValue = values.current;
  const finalValue = values.final;
  const current = role(currentValue, observed, disabled, 'no-displayed-current');
  const final = includesFinal ? role(finalValue, observed, disabled, 'no-captured-final')
    : freeze({ data: 'unavailable', readiness: 'unavailable', reason: 'scope-excluded', value: null });
  let readiness;
  let reason;
  if (observed.state === 'unavailable') {
    readiness = observed.state;
    reason = observed.reason;
  } else if (disabled) {
    readiness = 'unavailable';
    reason = 'hud-disabled-or-disposed';
  } else if (observed.state === 'pending') {
    readiness = observed.state;
    reason = observed.reason;
  } else if (current.value === null) {
    readiness = 'pending';
    reason = 'no-displayed-current';
  } else if (includesFinal && final.value === null) {
    readiness = 'pending';
    reason = 'no-captured-final';
  } else {
    readiness = 'ready';
    reason = null;
  }
  const view = freeze({ schema: 1, bindingIdentity: observed.bindingIdentity,
    documentIdentity: observed.documentIdentity, sceneIdentity: observed.sceneIdentity,
    scope: observed.scope, binding: freeze({ state: observed.state, reason: observed.reason }),
    readiness, reason, fade: disabled ? null : snapshot.fade,
    requestedOpacity: disabled ? null : freeze({ ...snapshot.requestedOpacity }), current, final });
  issued.add(view);
  return view;
}

/** Admit only this module's issued frozen views; never inspect arbitrary fields.
 * @param {unknown} value
 * @returns {HudView}
 */
export function requireHudView(value) {
  if (!issued.has(value)) invalid();
  return value;
}
