// Authored synthetic structural reports only; no wire decoder, Wasm or network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import * as contract from '../web/stock-hud-contract.mjs';

const { copyHudIngressPlan, copyHudIngressReport } = contract;
const row = (ordinal = 1, name = [0, 65, 255]) => ({ ordinal, count: 65535,
  fractionalMass: 8388608 / 16777215, rawColor: 255, paletteIndex: 3, name });
const header = commandIndex => ({ commandIndex, kind: 'leaderboard', localRow: 255,
  rank: 0, population: 65535, deathPending: true });
const report = () => ({ schema: 2, commandCount: 4, setupDraws: 0,
  events: [header(0), header(2), header(3)], leaderboardRows: [
    { commandIndex: 0, rows: [row()] },
    { commandIndex: 2, rows: [] },
    { commandIndex: 3, rows: [row(), row(2, [])] },
  ] });
function frozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  for (const child of Object.values(value)) frozen(child);
}
function invalid(value) {
  assert.throws(() => copyHudIngressReport(value, value.commandCount),
    { name: 'TypeError', message: 'Invalid HUD data' });
}

test('exact versioned shapes, unchanged exports, raw scalar bits, repeated/empty boards and independent frozen copies', () => {
  assert.deepEqual(Object.keys(contract).sort(), ['copyHudIngressPlan', 'copyHudIngressReport', 'copyHudScoreView']);
  const input = report(), output = copyHudIngressReport(input, 4);
  assert.deepEqual(output, input); frozen(output);
  assert.notEqual(output.leaderboardRows, input.leaderboardRows);
  assert.notEqual(output.leaderboardRows[0].rows[0].name, output.leaderboardRows[2].rows[0].name);
  const expected = output.leaderboardRows[0].rows[0].fractionalMass;
  input.leaderboardRows[0].rows[0].name[0] = 99;
  input.leaderboardRows[0].rows[0].count = 0;
  input.leaderboardRows[0].rows[0].fractionalMass = 0;
  assert.equal(output.leaderboardRows[0].rows[0].name[0], 0);
  assert.equal(output.leaderboardRows[0].rows[0].count, 65535);
  assert(Object.is(output.leaderboardRows[0].rows[0].fractionalMass, expected));
  const { leaderboardRows, ...legacy } = report(); void leaderboardRows;
  legacy.schema = 1;
  const old = copyHudIngressReport(legacy, 4);
  assert.deepEqual(Object.keys(old), ['schema', 'commandCount', 'setupDraws', 'events']);
  assert(!Object.hasOwn(old, 'leaderboardRows')); frozen(old);
  invalid({ ...legacy, leaderboardRows: [] });
  invalid({ ...report(), schema: 3 });
  const missing = report(); delete missing.leaderboardRows; invalid(missing);
});

test('same exact plan fields admit only schemas one and two', () => {
  for (const schema of [1, 2]) {
    const p = { schema, commandCount: 1, guards: [{ playing: true, closeRequested: true, deathPending: true }], finalCaptureIndices: [] };
    assert.deepEqual(copyHudIngressPlan(p), p); frozen(copyHudIngressPlan(p));
    assert.throws(() => copyHudIngressPlan({ ...p, leaderboardRows: [] }), TypeError);
  }
  for (const schema of [0, 3, '2', 2n, NaN]) assert.throws(() => copyHudIngressPlan({ schema,
    commandCount: 1, guards: [{ playing: true, closeRequested: false, deathPending: false }], finalCaptureIndices: [] }), TypeError);
});

test('row values remain native-authoritative, with all byte values, no ten-row/body cap and no text or score', () => {
  const value = report();
  value.leaderboardRows[0].rows = Array.from({ length: 4097 }, (_, i) => row(i + 1, []));
  const rows = value.leaderboardRows[0].rows;
  rows[0].name = Array.from({ length: 255 }, (_, i) => i);
  rows[1].name = [255];
  rows[0].fractionalMass = 0; rows[1].fractionalMass = 1;
  rows[2].fractionalMass = -0; rows[2].count = 0;
  for (let color = 0; color < 256; color++) {
    rows[color].rawColor = color; rows[color].paletteIndex = color % 9;
  }
  const output = copyHudIngressReport(value, 4).leaderboardRows[0].rows;
  assert.equal(output.length, 4097);
  assert.deepEqual(output[0].name, rows[0].name); assert.deepEqual(output[1].name, [255]);
  assert.equal(output[0].fractionalMass, 0); assert.equal(output[1].fractionalMass, 1);
  assert(Object.is(output[2].fractionalMass, -0));
  assert.deepEqual(Object.keys(output[0]), ['ordinal', 'count', 'fractionalMass', 'rawColor', 'paletteIndex', 'name']);
});

const badRows = [
  ['ordinal zero', r => { r.ordinal = 0; }], ['ordinal mismatch', r => { r.ordinal = 2; }],
  ['ordinal bigint', r => { r.ordinal = 1n; }], ['count negative', r => { r.count = -1; }],
  ['count overflow', r => { r.count = 65536; }], ['count fraction', r => { r.count = 1.5; }],
  ['mass NaN', r => { r.fractionalMass = NaN; }], ['mass infinite', r => { r.fractionalMass = Infinity; }],
  ['mass negative', r => { r.fractionalMass = -Number.MIN_VALUE; }], ['mass above one', r => { r.fractionalMass = 1.0000000000000002; }],
  ['mass string', r => { r.fractionalMass = '0'; }], ['color overflow', r => { r.rawColor = 256; }],
  ['color negative', r => { r.rawColor = -1; }], ['color fraction', r => { r.rawColor = 1.5; }],
  ['palette mismatch', r => { r.paletteIndex = 4; }], ['palette string', r => { r.paletteIndex = '3'; }],
  ['name String', r => { r.name = 'A'; }], ['name view', r => { r.name = new Uint8Array([65]); }],
  ['name oversized', r => { r.name = new Array(256).fill(0); }], ['name hole', r => { r.name = Array(1); }],
  ['name negative', r => { r.name = [-1]; }], ['name overflow', r => { r.name = [256]; }],
  ['name fractional', r => { r.name = [0.5]; }], ['name string byte', r => { r.name = ['65']; }],
  ['name bigint byte', r => { r.name = [65n]; }], ['name NaN', r => { r.name = [NaN]; }],
  ['name foreign', r => { r.name = vm.runInNewContext('[65]'); }],
  ['name subclass', r => { r.name = new (class extends Array {})(65); }],
  ['name extra', r => { r.name.extra = true; }], ['name symbol', r => { r.name[Symbol()] = true; }],
  ['row extra', r => { r.score = 10; }], ['row symbol', r => { r[Symbol()] = 1; }],
  ['row inherited', r => { Object.setPrototypeOf(r, { inherited: 1 }); }],
];
for (const [label, mutate] of badRows) test(`schema2 rejects ${label}`, () => {
  const value = report(); mutate(value.leaderboardRows[0].rows[0]); invalid(value);
});

test('every and only leaderboard event has one ordered board, including empty and repeated boards', () => {
  const mutations = [
    v => { v.leaderboardRows.pop(); }, v => { v.leaderboardRows.push({ commandIndex: 1, rows: [] }); },
    v => { v.leaderboardRows.reverse(); }, v => { v.leaderboardRows[1].commandIndex = 0; },
    v => { v.leaderboardRows[1].commandIndex = 1; }, v => { v.leaderboardRows[0].commandIndex = '0'; },
    v => { v.events.shift(); }, v => { v.leaderboardRows[0].extra = true; },
    v => { v.leaderboardRows[0][Symbol()] = true; }, v => { v.leaderboardRows.extra = true; },
    v => { delete v.leaderboardRows[0]; }, v => { delete v.leaderboardRows[0].rows[0]; },
    v => { v.leaderboardRows[0].rows.extra = true; },
    v => { v.leaderboardRows[0].rows = vm.runInNewContext('[]'); },
    v => { v.leaderboardRows = vm.runInNewContext('[]'); },
    v => { Object.setPrototypeOf(v.leaderboardRows[0], {}); },
  ];
  for (const mutate of mutations) { const value = report(); mutate(value); invalid(value); }
  const empty = { schema: 2, commandCount: 1, setupDraws: 0, events: [], leaderboardRows: [] };
  assert.deepEqual(copyHudIngressReport(empty, 1), empty);
  const nulls = report();
  for (const b of nulls.leaderboardRows) {
    Object.setPrototypeOf(b, null);
    for (const r of b.rows) Object.setPrototypeOf(r, null);
  }
  Object.setPrototypeOf(nulls, null);
  frozen(copyHudIngressReport(nulls, 4));
});

test('own-data schema/sidecar/row/name descriptors never evaluate accessors', () => {
  let reads = 0;
  const getter = { configurable: true, get() { reads++; assert.fail('accessor'); } };
  for (const modify of [
    v => Object.defineProperty(v, 'schema', getter),
    v => Object.defineProperty(v, 'leaderboardRows', getter),
    v => Object.defineProperty(v.leaderboardRows, '0', getter),
    v => Object.defineProperty(v.leaderboardRows[0], 'rows', getter),
    v => Object.defineProperty(v.leaderboardRows[0].rows, '0', getter),
    ...['ordinal', 'count', 'fractionalMass', 'rawColor', 'paletteIndex', 'name'].map(key =>
      v => Object.defineProperty(v.leaderboardRows[0].rows[0], key, getter)),
    v => Object.defineProperty(v.leaderboardRows[0].rows[0].name, '0', getter),
  ]) { const value = report(); modify(value); invalid(value); }
  assert.equal(reads, 0);
});

test('hostile lengths reject before array keys or element traps', () => {
  let visits = 0;
  const hostile = size => new Proxy(Array(size), {
    ownKeys() { visits++; throw new Error('length must fail first'); },
    getOwnPropertyDescriptor(target, key) { if (key !== 'length') visits++; return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  for (const mutate of [
    v => { v.leaderboardRows = hostile(5); },
    v => { v.leaderboardRows[0].rows = hostile(149796); },
    v => { v.leaderboardRows[0].rows[0].name = hostile(256); },
  ]) { const value = report(); mutate(value); invalid(value); }
  assert.equal(visits, 0);
});

test('all board row lengths are charged before any row-array enumeration or row visitation', () => {
  let visits = 0;
  const rows = size => new Proxy(Array(size), { ownKeys() { visits++; throw new Error('no row keys'); },
    getOwnPropertyDescriptor(target, key) { if (key !== 'length') { visits++; throw new Error('no rows'); } return Reflect.getOwnPropertyDescriptor(target, key); } });
  const value = { schema: 2, commandCount: 2, setupDraws: 0, events: [header(0), header(1)],
    leaderboardRows: [{ commandIndex: 0, rows: rows(149795) }, { commandIndex: 1, rows: rows(1) }] };
  invalid(value); assert.equal(visits, 0);
  // Two six-byte headers alone push the legal maximum row count over the byte budget.
  value.leaderboardRows[1].rows = rows(0);
  invalid(value); assert.equal(visits, 0);
});

test('aggregate names across boards reject before any name-array enumeration/byte read', () => {
  let visits = 0;
  const name = new Proxy(new Array(255).fill(0), { ownKeys() { visits++; throw new Error('no names yet'); },
    getOwnPropertyDescriptor(target, key) { if (key !== 'length') { visits++; throw new Error('no bytes yet'); } return Reflect.getOwnPropertyDescriptor(target, key); } });
  const value = { schema: 2, commandCount: 2, setupDraws: 0, events: [header(0), header(1)], leaderboardRows: [
    { commandIndex: 0, rows: Array.from({ length: 2000 }, (_, i) => row(i + 1, name)) },
    { commandIndex: 1, rows: Array.from({ length: 2003 }, (_, i) => row(i + 1, name)) },
  ] };
  invalid(value); assert.equal(visits, 0);
});

test('exact maximum represented byte budget accepts across boards, next byte rejects', () => {
  const names = new Array(255).fill(255);
  const value = { schema: 2, commandCount: 2, setupDraws: 0, events: [header(0), header(1)], leaderboardRows: [
    { commandIndex: 0, rows: Array.from({ length: 2000 }, (_, i) => row(i + 1, names)) },
    { commandIndex: 1, rows: Array.from({ length: 2003 }, (_, i) => row(i + 1, i === 2002 ? new Array(33).fill(0) : names)) },
  ] };
  const bytes = v => v.leaderboardRows.reduce((sum, b) => sum + 6 + b.rows.reduce((sum, r) => sum + 7 + r.name.length, 0), 0);
  assert.equal(bytes(value), 1048576);
  const output = copyHudIngressReport(value, 2); assert.equal(bytes(output), 1048576); frozen(output);
  value.leaderboardRows[1].rows.at(-1).name.push(0); invalid(value);
});

test('maximum legal 149795 rows is accepted without truncation at the exact byte cap', () => {
  const value = { schema: 2, commandCount: 1, setupDraws: 0, events: [header(0)], leaderboardRows: [
    { commandIndex: 0, rows: Array.from({ length: 149795 }, (_, i) => row(i + 1, i === 149794 ? [0, 1, 2, 3, 4] : [])) },
  ] };
  const output = copyHudIngressReport(value, 1);
  assert.equal(output.leaderboardRows[0].rows.length, 149795);
  assert.equal(output.leaderboardRows[0].rows.at(-1).ordinal, 149795);
  assert.deepEqual(output.leaderboardRows[0].rows.at(-1).name, [0, 1, 2, 3, 4]);
});

test('schema must remain selected across descriptor reflection; snapshots survive later mutation', () => {
  let reads = 0;
  const changing = new Proxy(report(), { getOwnPropertyDescriptor(target, key) {
    const d = Reflect.getOwnPropertyDescriptor(target, key);
    return key === 'schema' && ++reads > 1 ? { ...d, value: 1 } : d;
  } });
  invalid(changing);
  const value = report(), first = value.leaderboardRows[0].rows[0], last = value.leaderboardRows[2].rows[1];
  first.name = new Proxy([65], { ownKeys(target) {
    last.count = -1; last.name = new Array(1000000);
    return Reflect.ownKeys(target);
  } });
  const output = copyHudIngressReport(value, 4);
  assert.equal(output.leaderboardRows[2].rows[1].count, 65535);
  assert.deepEqual(output.leaderboardRows[2].rows[1].name, []);
});

test('reflection throws preserve every primary including undefined, without normalization', () => {
  for (const primary of [undefined, null, false, 0, Symbol('primary'), { primary: true }]) {
    const value = report();
    value.leaderboardRows[0].rows[0].name = new Proxy([65], { ownKeys() { throw primary; } });
    let failed = false;
    try { copyHudIngressReport(value, 4); } catch (error) { failed = true; assert.equal(error, primary); }
    assert(failed);
  }
});
