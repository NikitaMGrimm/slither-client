// Authored copied-data, capability and issued-identity shell for Rust board history.
import { copyHudIngressReport } from './stock-hud-contract.mjs';

const freeze = Object.freeze;
const states = new WeakMap();
const plans = new WeakMap();
const invalid = () => { throw new TypeError('Invalid leaderboard state change'); };

function data(value, key) {
  if (value === null || typeof value !== 'object') invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
  return descriptor.value;
}

function array(value, maximum, copyElement) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const size = data(value, 'length');
  // Bound before enumerating keys or allocating/visiting elements.
  if (!Number.isInteger(size) || size < 0 || size > maximum) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== size + 1) invalid();
  for (const key of keys) {
    if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)
      || Number(key) >= size)) invalid();
  }
  const copy = [];
  for (let index = 0; index < size; index++) copy.push(copyElement(data(value, String(index)), index));
  return freeze(copy);
}

function invoke(owner, name, args = []) {
  return Reflect.apply(owner.methods[name], owner.history, args);
}

function issue(history, sceneIdentity, methods) {
  const value = freeze({ schema: 1, sceneIdentity, ...Reflect.apply(methods.snapshot, history, []) });
  states.set(value, { history, methods, busy: false, poisoned: false });
  return value;
}

function transition(state, operation) {
  const owner = states.get(state);
  if (!owner) invalid();
  if (owner.busy) { owner.poisoned = true; invalid(); }
  owner.busy = true;
  owner.poisoned = false;
  try {
    if (!invoke(owner, 'is_open')) invalid();
    const result = operation(owner);
    if (owner.poisoned) invalid();
    return result;
  } finally { owner.busy = false; }
}

function release(history, methods) {
  try { Reflect.apply(methods.free, history, []); } catch { /* Preserve the primary failure. */ }
}

/** Start an independent Rust history and capture its generated ABI once. */
export function createLeaderboardState(sceneIdentity, LeaderboardHistory) {
  if (typeof sceneIdentity !== 'symbol' || typeof LeaderboardHistory !== 'function') invalid();
  const methods = {};
  for (const name of ['is_open', 'prepare', 'requests', 'begin_plan', 'admit_name', 'admit_score',
    'complete', 'discard_plan', 'reset', 'commit', 'snapshot', 'projection', 'free']) {
    const descriptor = Object.getOwnPropertyDescriptor(LeaderboardHistory.prototype, name);
    if (!descriptor || typeof descriptor.value !== 'function') invalid();
    methods[name] = descriptor.value;
  }
  freeze(methods);
  const history = new LeaderboardHistory();
  try { return issue(history, sceneIdentity, methods); }
  catch (error) { release(history, methods); throw error; }
}

/** Admit genuine history without reflection, including closed historical snapshots. */
export function requireLeaderboardState(value) {
  if (!states.has(value)) invalid();
  return value;
}

/** Admit the complete schema2 report before exposing Rust-owned numeric requests. */
export function prepareLeaderboardPacket(state, report) {
  return transition(state, owner => {
    const copied = copyHudIngressReport(report, data(report, 'commandCount'));
    if (copied.schema !== 2 || owner.poisoned) invalid();
    const native = invoke(owner, 'prepare', [copied]);
    try {
      const requests = invoke(owner, 'requests', [native]);
      if (owner.poisoned) invalid();
      const plan = freeze({ schema: 1, sceneIdentity: state.sceneIdentity, requests });
      plans.set(plan, { state, native });
      return plan;
    } catch (error) {
      try { invoke(owner, 'discard_plan', [native]); } catch { /* Preserve conversion failure. */ }
      throw error;
    }
  });
}

/** Complete an issued plan once; convert and check reentry before native commit. */
export function completeLeaderboardPacket(state, plan, scores, ownNickname) {
  return transition(state, owner => {
    const companion = plans.get(plan);
    if (!companion || companion.state !== state) invalid();
    plans.delete(plan);
    let planLive = true, candidate;
    const discard = () => {
      if (planLive) { planLive = false; invoke(owner, 'discard_plan', [companion.native]); }
    };
    try {
      invoke(owner, 'begin_plan', [companion.native]);
      // Native name admission precedes all score-array reflection, as before.
      invoke(owner, 'admit_name', [ownNickname]);
      const copied = array(scores, plan.requests.length, (values, index) => {
        const request = plan.requests[index];
        const result = array(values, request.counts.length, (score, ordinal) => {
          if (typeof score !== 'number') invalid();
          invoke(owner, 'admit_score', [companion.native, index, ordinal, score]);
          return score;
        });
        if (result.length !== request.counts.length) invalid();
        return result;
      });
      if (copied.length !== plan.requests.length || owner.poisoned) invalid();
      candidate = invoke(owner, 'complete', [companion.native, copied, ownNickname]);
      const next = issue(candidate, state.sceneIdentity, owner.methods);
      discard();
      if (owner.poisoned) invalid();
      Reflect.apply(owner.methods.commit, candidate, []);
      candidate = undefined;
      return next;
    } catch (error) {
      if (candidate !== undefined) release(candidate, owner.methods);
      throw error;
    } finally {
      try { discard(); } catch { /* Preserve the operation's primary failure. */ }
    }
  });
}

/** Retain the Rust-owned board and Setup history while invalidating old plans. */
export function resetLeaderboardWorld(state) {
  return transition(state, owner => {
    const candidate = invoke(owner, 'reset');
    try {
      const next = issue(candidate, state.sceneIdentity, owner.methods);
      if (owner.poisoned) invalid();
      Reflect.apply(owner.methods.commit, candidate, []);
      return next;
    } catch (error) { release(candidate, owner.methods); throw error; }
  });
}

/** Copy Rust-selected rows and semantic output; binding readiness stays in JS. */
export function leaderboardSemanticView(state, headingOpacity, rowOpacity) {
  requireLeaderboardState(state);
  if (typeof headingOpacity !== 'number' || typeof rowOpacity !== 'number') invalid();
  return invoke(states.get(state), 'projection', [headingOpacity, rowOpacity]);
}
