// Authored ordinary-mode row history. Numeric projection belongs to the caller.
import { copyHudIngressReport } from './stock-hud-contract.mjs';

const freeze = Object.freeze;
const states = new WeakMap();
const plans = new WeakMap();
const colors = ['#c080ff', '#9099ff', '#80d0d0', '#80ff80', '#eeee70',
  '#ffa060', '#ff9090', '#ff4040', '#e030e0'];
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

function issue(value) {
  freeze(value);
  states.set(value, { open: true, busy: false, poisoned: false });
  return value;
}

function transition(state, operation) {
  const owner = states.get(state);
  if (!owner || !owner.open) invalid();
  if (owner.busy) {
    owner.poisoned = true;
    invalid();
  }
  owner.busy = true;
  owner.poisoned = false;
  try {
    const result = operation();
    if (owner.poisoned) invalid();
    return result;
  } finally {
    owner.busy = false;
  }
}

/** Start an independent scene history; no default score-table parameter. */
export function createLeaderboardState(sceneIdentity) {
  if (typeof sceneIdentity !== 'symbol') invalid();
  return issue({ schema: 1, sceneIdentity, tableMax: null, setupSeen: false,
    revision: 0n, board: null });
}

/** Admit genuine history without reflection or a transition, including old snapshots. */
export function requireLeaderboardState(value) {
  if (!states.has(value)) invalid();
  return value;
}

/** Validate the entire existing schema2 report before exposing numeric requests. */
export function prepareLeaderboardPacket(state, report) {
  return transition(state, () => {
    const copied = copyHudIngressReport(report, data(report, 'commandCount'));
    if (copied.schema !== 2) invalid();
    let tableMax = state.tableMax;
    let setupSeen = state.setupSeen;
    let boardIndex = 0;
    const requests = [], companions = [];
    for (const event of copied.events) {
      if (event.kind === 'setup') {
        tableMax = event.tableMax;
        setupSeen = true;
      } else if (event.kind === 'leaderboard') {
        if (tableMax === null) invalid();
        const board = copied.leaderboardRows[boardIndex++];
        requests.push(freeze({ commandIndex: event.commandIndex, tableMax,
          counts: freeze(board.rows.map(row => row.count)),
          fractionalMasses: freeze(board.rows.map(row => row.fractionalMass)) }));
        companions.push({ header: event, rows: board.rows });
      }
    }
    const plan = freeze({ schema: 1, sceneIdentity: state.sceneIdentity, requests: freeze(requests) });
    plans.set(plan, { state, tableMax, setupSeen, companions });
    return plan;
  });
}

function nickname(value) {
  if (typeof value !== 'string' || value.length > 24) invalid();
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 0x20 || unit > 0x7f) invalid();
  }
  return value;
}

function remoteName(bytes) {
  let digits = 0;
  for (const unit of bytes) {
    if ((unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122)) digits = 0;
    else if (unit >= 48 && unit <= 57 && ++digits >= 7) return '';
  }
  return String.fromCharCode(...bytes);
}

function text(value) {
  // Safe Text-node policy: byte units, fragment newline/NUL handling and NBSP.
  return value.replace(/\r\n?/g, '\n').replace(/\0/g, '').replace(/ /g, '\u00a0');
}

/** Complete one issued plan once, with copied native results and admitted nickname. */
export function completeLeaderboardPacket(state, plan, scores, ownNickname) {
  return transition(state, () => {
    const companion = plans.get(plan);
    if (!companion || companion.state !== state) invalid();
    // No retry can reuse an operation's raw companion, even after failed conversion.
    plans.delete(plan);
    const localName = nickname(ownNickname);
    const copied = array(scores, plan.requests.length, (values, index) => {
      const request = plan.requests[index];
      const result = array(values, request.counts.length, (score, ordinal) => {
        const outside = request.counts[ordinal] > request.tableMax + 2048;
        if (typeof score !== 'number'
          || (outside ? !Number.isNaN(score) : !Number.isSafeInteger(score))) invalid();
        return score;
      });
      if (result.length !== request.counts.length) invalid();
      return result;
    });
    if (copied.length !== plan.requests.length) invalid();
    let board = state.board;
    let revision = state.revision;
    for (let index = 0; index < companion.companions.length; index++) {
      const raw = companion.companions[index];
      const rows = raw.rows.map((row, ordinal) => {
        const own = row.ordinal === raw.header.localRow;
        const score = copied[index][ordinal];
        return freeze({ ordinal: row.ordinal, numberText: `#${row.ordinal}`,
          score, scoreText: Number.prototype.toString.call(score, 10),
          nameText: text(own ? localName : remoteName(row.name)),
          cssColor: colors[row.paletteIndex], own,
          opacityRequest: own ? 1 : .7 * (.3 + .7 * (1 - row.ordinal / 10)) });
      });
      board = freeze({ rows: freeze(rows) });
      revision++;
    }
    if (states.get(state).poisoned) invalid();
    const next = issue({ ...state, tableMax: companion.tableMax,
      setupSeen: companion.setupSeen, revision, board });
    states.get(state).open = false;
    return next;
  });
}

/** Retain displayed board and setup/table history while invalidating old plans. */
export function resetLeaderboardWorld(state) {
  return transition(state, () => {
    const next = issue({ ...state });
    states.get(state).open = false;
    return next;
  });
}
