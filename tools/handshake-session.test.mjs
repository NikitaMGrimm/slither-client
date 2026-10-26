import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { HandshakeSession, unpackCommands } from '../web/handshake-session.mjs';
import { probeNickname, reserveOfficialAttempt, validatedEndpoint } from './connection-budget.mjs';

const packed = commands => Uint8Array.from(commands.flatMap(command => [0, 0, 0, command.length, ...command]));
const fakeWasm = () => ({ encode_login: () => Uint8Array.of(115, 0), solve_challenge: () => new Uint8Array(27), decode_frame: bytes => bytes, setup_protocol_version: command => command[1] });
const profile = { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 };

test('synthetic handshake emits only negotiation, challenge reply, and login before setup', () => {
  const session = new HandshakeSession(fakeWasm(), profile, probeNickname);
  assert.deepEqual(session.start().map(bytes => [...bytes]), [[1], [99, 0]]);
  const reply = session.receive(packed([[54, 1]]));
  assert.equal(reply.outbound.length, 2); assert.equal(reply.complete, false);
  const setup = session.receive(packed([[97, 19], [115, 1]]));
  assert.equal(setup.complete, true); assert.equal(setup.protocolVersion, 19); assert.deepEqual(setup.outbound, []);
  assert.throws(() => session.receive(packed([[97, 19]])), /terminal/);
});

test('complete-frame validation and causal ordering precede any challenge callback', () => {
  let solved = 0;
  const session = new HandshakeSession(fakeWasm(), profile, probeNickname, { solve() { solved++; return new Uint8Array(27); } });
  assert.throws(() => session.receive(packed([[54, 1], [97, 19]])), /one challenge/);
  assert.equal(solved, 0); assert.equal(session.state, 'failed');
  assert.throws(() => unpackCommands(Uint8Array.from([...packed([[54, 1]]), 0, 0])), /Truncated/);
});

test('unexpected protocol and repeated challenges fail closed', () => {
  for (const next of [[97, 20], [54, 1]]) {
    const session = new HandshakeSession(fakeWasm(), profile, probeNickname);
    session.receive(packed([[54, 1]]));
    assert.throws(() => session.receive(packed([next])));
    assert.equal(session.state, 'failed');
  }
});

test('only one literal-IP endpoint without redirection inputs is accepted', () => {
  assert.equal(validatedEndpoint('ws://127.0.0.1:1234/slither'), 'ws://127.0.0.1:1234/slither');
  for (const url of ['ws://example.com/slither', 'ws://127.0.0.1/slither?next=elsewhere', 'ws://user@127.0.0.1/slither', 'https://127.0.0.1/slither', 'ws://127.0.0.1/other']) assert.throws(() => validatedEndpoint(url));
});

test('a durable outside-repo attempt reservation cannot be rearmed after failure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slither-client-attempt-'));
  try {
    const first = reserveOfficialAttempt(directory, 'ws://127.0.0.1:1234/slither');
    assert.equal(JSON.parse(fs.readFileSync(first.ledger)).attempts, 1);
    assert.throws(() => reserveOfficialAttempt(directory, 'ws://127.0.0.1:1234/slither'), /EEXIST/);
    first.persist({ success: false }, []);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('slither-client-attempt-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('evidence destinations are reserved before dialing and summary failure preserves wire records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slither-client-attempt-'));
  try {
    fs.writeFileSync(path.join(directory, 'official-result.json'), 'existing evidence');
    assert.throws(() => reserveOfficialAttempt(directory, 'ws://127.0.0.1:1234/slither'), /EEXIST/);
    assert.equal(fs.readFileSync(path.join(directory, 'official-result.json'), 'utf8'), 'existing evidence');
    assert(fs.existsSync(path.join(directory, 'official-attempt.json')));
    const second = fs.mkdtempSync(path.join(directory, 'synthetic-'));
    const reservation = reserveOfficialAttempt(second, 'ws://127.0.0.1:1234/slither');
    const circular = {}; circular.self = circular;
    assert.throws(() => reservation.persist(circular, [{ direction: 'in', bytes: 'synthetic' }]), /persist all/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(second, 'official-wire.jsonl'), 'utf8')).bytes, 'synthetic');
    assert.throws(() => reservation.persist({}, []), /already finalized/);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('slither-client-attempt-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('synthetic flush and close failures retain both errors and still persist the other file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slither-client-attempt-'));
  const originalClose = fs.closeSync;
  const originalFlush = fs.fsyncSync;
  try {
    const reservation = reserveOfficialAttempt(directory, 'ws://127.0.0.1:1234/slither');
    let closes = 0;
    let flushes = 0;
    fs.fsyncSync = handle => { if (++flushes === 1) throw new Error('synthetic flush failure'); originalFlush(handle); };
    fs.closeSync = handle => { originalClose(handle); if (++closes === 1) throw new Error('synthetic close failure'); };
    assert.throws(() => reservation.persist({ success: false }, []), error => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors.map(item => item.message), ['synthetic flush failure', 'synthetic close failure']);
      return true;
    });
    assert.equal(closes, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'official-result.json'), 'utf8')).success, false);
  } finally {
    fs.closeSync = originalClose;
    fs.fsyncSync = originalFlush;
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('slither-client-attempt-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
