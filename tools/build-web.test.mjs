import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { buildWeb } from './build-web.mjs';

// Original synthetic Cargo messages; no external builds or reference inputs.
const defaultWasm = path.resolve('target/wasm32-unknown-unknown/release/slither_client.wasm');
const customWasm = path.resolve('synthetic custom target/wasm32-unknown-unknown/release/slither_client.wasm');
const artifact = (changes = {}) => ({
  reason: 'compiler-artifact',
  manifest_path: path.resolve('Cargo.toml'),
  target: { name: 'slither_client', kind: ['rlib', 'cdylib'], crate_types: ['rlib', 'cdylib'] },
  filenames: [customWasm.replace(/\.wasm$/, '.rlib'), customWasm],
  fresh: false,
  ...changes,
});
const cargoOutput = messages => [...messages, { reason: 'build-finished', success: true }].map(message => typeof message === 'string' ? message : JSON.stringify(message)).join('\r\n') + '\r\n';

function commands(t, messages, { version = 'wasm-bindgen 0.2.129\n', cargoError, bindgenError } = {}) {
  const calls = [];
  const madeDirectories = [];
  const logs = [];
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === '--version') return version;
    if (command === 'cargo') {
      if (cargoError) throw cargoError;
      return cargoOutput(messages);
    }
    if (bindgenError) throw bindgenError;
  });
  syncBuiltinESMExports();
  t.mock.method(fs, 'mkdirSync', (...args) => madeDirectories.push(args));
  t.mock.method(console, 'log', message => logs.push(message));
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { calls, madeDirectories, logs };
}

test('bindgen uses the reported custom target artifact, never the stale default path', t => {
  const { calls, madeDirectories, logs } = commands(t, [
    { reason: 'build-script-executed', out_dir: 'synthetic build output' },
    artifact({ manifest_path: path.resolve('synthetic-dependency/Cargo.toml'), filenames: [defaultWasm] }),
    artifact(),
  ]);
  buildWeb();
  assert.equal(calls.length, 3);
  assert.equal(calls[1].command, 'cargo');
  assert.deepEqual(calls[1].args, ['build', '--release', '--locked', '--lib', '--target', 'wasm32-unknown-unknown', '--message-format=json-render-diagnostics']);
  assert.deepEqual(calls[1].options.stdio, ['inherit', 'pipe', 'inherit']);
  assert.equal(calls[2].command, calls[0].command);
  assert.deepEqual(calls[2].args, [customWasm, '--target', 'web', '--out-dir', 'dist/web', '--out-name', 'slither_client', '--no-typescript']);
  assert(!calls[2].args.includes(defaultWasm));
  assert.deepEqual(madeDirectories, [['dist/web', { recursive: true }]]);
  assert.equal(logs.length, 1);
});

test('a default target artifact confirmed up-to-date by this Cargo invocation is accepted', t => {
  const { calls } = commands(t, [artifact({ filenames: [defaultWasm], fresh: true })]);
  buildWeb();
  assert.equal(calls[2].args[0], defaultWasm);
});

test('non-JSON procedural macro output remains visible without hiding artifact messages', t => {
  const { calls, logs } = commands(t, ['synthetic macro diagnostic', '', artifact()]);
  buildWeb();
  assert.equal(calls[2].args[0], customWasm);
  assert.equal(logs[0], 'synthetic macro diagnostic');
  assert.match(logs[1], /^Built authored Rust\/Wasm browser bindings/);
});

for (const [name, messages, count] of [
  ['missing artifact', [], 0],
  ['library without Wasm', [artifact({ filenames: ['synthetic.rlib'] })], 0],
  ['wrong package', [artifact({ manifest_path: path.resolve('synthetic-other/Cargo.toml') })], 0],
  ['wrong target name', [artifact({ target: { name: 'synthetic_other', crate_types: ['cdylib'] } })], 0],
  ['wrong crate type', [artifact({ target: { name: 'slither_client', crate_types: ['bin'] } })], 0],
  ['multiple Wasm filenames', [artifact({ filenames: [customWasm, defaultWasm] })], 2],
  ['multiple matching artifacts', [artifact(), artifact({ filenames: [defaultWasm] })], 2],
]) {
  test(`rejects ${name} without binding a default fallback`, t => {
    const { calls, madeDirectories, logs } = commands(t, messages);
    assert.throws(() => buildWeb(), new RegExp(`Expected exactly one .* artifact from Cargo; received ${count}`));
    assert.equal(calls.length, 2);
    assert.deepEqual(madeDirectories, []);
    assert.deepEqual(logs, []);
  });
}

test('Cargo failure prevents bindgen and output creation even if an artifact was emitted', t => {
  const failure = Object.assign(new Error('synthetic Cargo build failure'), { status: 101, stdout: cargoOutput([artifact()]) });
  const { calls, madeDirectories, logs } = commands(t, [], { cargoError: failure });
  assert.throws(() => buildWeb(), error => error === failure);
  assert.equal(calls.length, 2);
  assert.deepEqual(madeDirectories, []);
  assert.deepEqual(logs, []);
});

test('CLI version mismatch prevents Cargo, bindgen and output creation', t => {
  const { calls, madeDirectories, logs } = commands(t, [], { version: 'wasm-bindgen 0.2.128\n' });
  assert.throws(() => buildWeb(), /Expected wasm-bindgen 0\.2\.129; received wasm-bindgen 0\.2\.128/);
  assert.equal(calls.length, 1);
  assert.deepEqual(madeDirectories, []);
  assert.deepEqual(logs, []);
});

test('bindgen failure propagates without reporting success', t => {
  const failure = new Error('synthetic bindgen failure');
  const { calls, logs } = commands(t, [artifact()], { bindgenError: failure });
  assert.throws(() => buildWeb(), error => error === failure);
  assert.equal(calls.length, 3);
  assert.deepEqual(logs, []);
});
