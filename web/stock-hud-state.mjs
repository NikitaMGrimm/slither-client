// Authored bounded semantic HUD reducer. No scene capabilities or score arithmetic.
import { copyHudIngressReport, copyHudScoreView } from './stock-hud-contract.mjs';

const freeze = Object.freeze;
// Weak membership admits only our immutable snapshots without retaining a history
// or reflecting through arbitrary supplied state/prototype graphs.
const issued = new WeakSet();
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

function finiteRange(value, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) invalid();
}

function stateRequired(state) {
  if (!issued.has(state)) invalid();
}

function required(state, playing) {
  return state.dirty && playing && state.rank > 0 && state.population > 0;
}

function snapshot(state) {
  state.requestedOpacity = freeze({ ...state.requestedOpacity });
  if (state.current !== null) state.current = freeze({ ...state.current });
  if (state.final !== null) state.final = freeze({ ...state.final });
  freeze(state);
  issued.add(state);
  return state;
}

/** Initialize one scene's semantic history; identity is caller-owned local data. */
export function createHudState(sceneIdentity) {
  if (typeof sceneIdentity !== 'symbol') invalid();
  return snapshot({
    schema: 1, sceneIdentity, ownToken: null, rank: 0, population: 0,
    bestRank: 999999999, maxPopulation: 0, dirty: false, fade: -1,
    requestedOpacity: { readout: 0, header: 0, rows: 0, announcement: 0 },
    current: null, final: null,
  });
}

/** Eligibility only; never accesses a native score view. */
export function hudReadoutRequired(state, playing) {
  stateRequired(state);
  boolean(playing);
  return required(state, playing);
}

function bind(state, token) {
  if (state.ownToken !== null && state.ownToken !== token) invalid();
  state.ownToken = token;
}

function draw(state, view) {
  if (view === null || view.status !== 'ready') invalid();
  bind(state, view.own.token);
  state.current = {
    score: view.score, rank: state.rank, population: state.population, ownToken: view.own.token,
  };
  state.dirty = false;
}

function opacity(state) {
  state.requestedOpacity = {
    readout: state.fade, header: .85 * state.fade, rows: state.fade, announcement: state.fade,
  };
}

function packet(state, report) {
  for (const event of report.events) {
    switch (event.kind) {
      case 'setup':
        state.fade = -1;
        state.requestedOpacity = { readout: 0, header: 0, rows: 0, announcement: 0 };
        break;
      case 'setup-draw':
        if (required(state, true)) draw(state, event.view);
        break;
      case 'own-length-scheduled':
        bind(state, event.token);
        state.dirty = true;
        break;
      case 'leaderboard':
        state.rank = event.rank;
        state.population = event.population;
        state.bestRank = Math.min(state.bestRank, event.rank);
        state.maxPopulation = Math.max(state.maxPopulation, event.population);
        state.dirty = true;
        if (state.fade === -1 && !event.deathPending) state.fade = 0;
        break;
      case 'final-score':
        bind(state, event.view.own.token);
        state.final = {
          score: event.view.score, exclamation: event.view.score > 1000, ownToken: event.view.own.token,
        };
        break;
    }
  }
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
    finiteRange(input.delta, 5);
    input.lifecycle = record(input.lifecycle,
      ['schema', 'deathPending', 'returnActive', 'returnCompleted', 'returnFraction']);
    const life = input.lifecycle;
    if (life.schema !== 1) invalid();
    boolean(life.deathPending);
    boolean(life.returnActive);
    boolean(life.returnCompleted);
    finiteRange(life.returnFraction, 1);
    if (life.returnCompleted) {
      if (!life.returnActive || life.deathPending || life.returnFraction !== 0) invalid();
    } else if (life.returnActive && (!life.deathPending || life.returnFraction <= 0)) invalid();
    freeze(input.lifecycle);
  } else if (kind === 'draw') {
    boolean(input.playing);
    if (required(state, input.playing)) input.view = copyHudScoreView(input.view);
    else if (input.view !== null) invalid();
  }

  freeze(input);
  const next = { ...state };
  switch (kind) {
    case 'packet': packet(next, input.report); break;
    case 'draw':
      if (required(next, input.playing)) draw(next, input.view);
      break;
    case 'world-reset':
      next.ownToken = null;
      next.rank = next.population = next.maxPopulation = 0;
      next.bestRank = 999999999;
      break;
    case 'step': {
      const life = input.lifecycle;
      if (life.returnCompleted) {
        next.fade = -1;
        opacity(next);
      } else if (life.returnActive) {
        next.fade = life.returnFraction;
        opacity(next);
      } else if (!life.deathPending && next.fade !== -1 && next.fade !== 1) {
        next.fade = Math.min(1, next.fade + .01 * input.delta);
        opacity(next);
      }
      break;
    }
  }
  return snapshot(next);
}
