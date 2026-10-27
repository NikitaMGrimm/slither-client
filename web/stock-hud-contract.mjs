// Authored closed HUD data boundary. No packet decoding or score computation.
const freeze = Object.freeze;
const invalid = () => { throw new TypeError('Invalid HUD data'); };
function integer(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalid();
  return value;
}
function boolean(value) {
  if (typeof value !== 'boolean') invalid();
  return value;
}
function token(value) {
  if (typeof value !== 'bigint' || value < 1n || value > 18446744073709551615n) invalid();
  return value;
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
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    copy[key] = descriptor.value;
  }
  return copy;
}
function array(value, minimum, maximum, copyElement) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value')) invalid();
  const size = integer(length.value, minimum, maximum);
  // Check the bound before enumerating keys, visiting elements or allocating copies.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== size + 1) invalid();
  for (const key of keys) {
    if (key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)
      || Number(key) >= size)) invalid();
  }
  const copy = [];
  for (let index = 0; index < size; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    copy.push(copyElement(descriptor.value));
  }
  return freeze(copy);
}

/** Copy the closed plan; actual command/opcode matching belongs to the ingress owner. */
export function copyHudIngressPlan(value) {
  const plan = record(value, ['schema', 'commandCount', 'guards', 'finalCaptureIndices']);
  if (plan.schema !== 1) invalid();
  integer(plan.commandCount, 1, 4096);
  plan.guards = array(plan.guards, plan.commandCount, plan.commandCount, value => {
    const guard = record(value, ['playing', 'closeRequested', 'deathPending']);
    for (const key of ['playing', 'closeRequested', 'deathPending']) boolean(guard[key]);
    return freeze(guard);
  });
  let previous = -1;
  plan.finalCaptureIndices = array(plan.finalCaptureIndices, 0, plan.commandCount, value => {
    integer(value, 0, plan.commandCount - 1);
    if (value <= previous) invalid();
    previous = value;
    return value;
  });
  return freeze(plan);
}

function scoreView(value, readyRequired = false) {
  const view = record(value, ['schema', 'enabled', 'tableMax', 'own', 'status', 'score', 'error']);
  if (view.schema !== 1 || view.enabled !== true) invalid();
  if (view.tableMax !== null) integer(view.tableMax, 1, 65535);
  if (view.own !== null) {
    const own = record(view.own, ['token', 'id', 'logicalSegments', 'fractionalMass', 'scoreAdjustment', 'scoreIndex']);
    token(own.token);
    integer(own.id, 0, 65535);
    integer(own.logicalSegments, 0, 4096);
    if (typeof own.fractionalMass !== 'number' || !Number.isFinite(own.fractionalMass)
      || own.fractionalMass < 0 || own.fractionalMass > 1) invalid();
    integer(own.scoreAdjustment, 0, 255);
    if (own.scoreIndex !== own.logicalSegments + own.scoreAdjustment) invalid();
    view.own = freeze(own);
  }
  if (readyRequired && view.status !== 'ready') invalid();
  if (view.status === 'ready') {
    if (view.tableMax === null || view.own === null || view.error !== null
      || view.own.scoreIndex > view.tableMax + 2048 || !Number.isInteger(view.score)) invalid();
  } else {
    if (view.score !== null) invalid();
    switch (view.status) {
      case 'no-tables':
        if (view.tableMax !== null || view.error !== null) invalid();
        break;
      case 'no-own':
        if (view.tableMax === null || view.own !== null || view.error !== null) invalid();
        break;
      case 'unsupported':
        if (view.tableMax === null || view.own === null || view.error !== 'index-out-of-range'
          || view.own.scoreIndex <= view.tableMax + 2048) invalid();
        break;
      default: invalid();
    }
  }
  return freeze(view);
}

const eventFields = {
  setup: ['commandIndex', 'kind', 'tableMax'],
  'setup-draw': ['commandIndex', 'kind', 'view'],
  'own-length-scheduled': ['commandIndex', 'kind', 'token'],
  leaderboard: ['commandIndex', 'kind', 'localRow', 'rank', 'population', 'deathPending'],
  'final-score': ['commandIndex', 'kind', 'view'],
};
function event(value, commandCount) {
  // Inspect kind as data before choosing the exact variant; never evaluate an accessor.
  if (value === null || typeof value !== 'object') invalid();
  const kind = Object.getOwnPropertyDescriptor(value, 'kind');
  if (!kind || !Object.hasOwn(kind, 'value') || typeof kind.value !== 'string'
    || !Object.hasOwn(eventFields, kind.value)) invalid();
  const copy = record(value, eventFields[kind.value]);
  if (copy.kind !== kind.value) invalid();
  integer(copy.commandIndex, 0, commandCount - 1);
  switch (copy.kind) {
    case 'setup': integer(copy.tableMax, 1, 65535); break;
    case 'setup-draw': copy.view = scoreView(copy.view); break;
    case 'own-length-scheduled': token(copy.token); break;
    case 'leaderboard':
      integer(copy.localRow, 0, 255); integer(copy.rank, 0, 65535); integer(copy.population, 0, 65535);
      boolean(copy.deathPending);
      break;
    case 'final-score': copy.view = scoreView(copy.view, true); break;
  }
  return freeze(copy);
}

/** Copy structural report data only; no native table/header/own-target inference. */
export function copyHudIngressReport(value, commandCount) {
  integer(commandCount, 1, 4096);
  const report = record(value, ['schema', 'commandCount', 'setupDraws', 'events']);
  if (report.schema !== 1 || report.commandCount !== commandCount) invalid();
  integer(report.setupDraws, 0, commandCount);
  report.events = array(report.events, 0, 2 * commandCount, value => event(value, commandCount));
  let previous = -1;
  let setups = 0;
  for (let index = 0; index < report.events.length; index++) {
    const current = report.events[index];
    if (current.commandIndex <= previous || current.kind === 'setup-draw') invalid();
    previous = current.commandIndex;
    if (current.kind === 'setup') {
      const draw = report.events[++index];
      if (!draw || draw.kind !== 'setup-draw' || draw.commandIndex !== current.commandIndex
        || draw.view.tableMax !== current.tableMax) invalid();
      setups++;
    }
  }
  if (setups !== report.setupDraws) invalid();
  return freeze(report);
}
