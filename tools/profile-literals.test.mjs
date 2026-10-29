// Authored boundary/lifetime tests with an explicitly labelled policy double.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { ProfileLiteralParserDouble } from './fixtures/profile-literals-double.mjs';
import { parseClosedProfileDeclarations, verifyAndConsumeProfileBytes,
  createStockLiveProfileAcquirer } from '../web/stock-live-profile.mjs';

const freeze = Object.freeze;
const zero = value => value.every(byte => byte === 0);
function fixture(version = '17', last = '19') {
  const a = new TextEncoder().encode(`var authoredVersion=${version};`);
  const b = new TextEncoder().encode(`var authoredBytes=[${[...Array.from({length: 19}, (_, i) => i), last].join(',')}];`);
  const source = new Uint8Array(a.length + b.length); source.set(a); source.set(b, a.length);
  const spans = freeze({version: freeze({start: 0, end: a.length}), password: freeze({start: a.length, end: source.length})});
  return {source, spans, pin: freeze({expectedBytes: source.length,
    sha256: createHash('sha256').update(source).digest('hex'), ...spans})};
}
function policy(overrides = {}, construct = () => {}) {
  class Parser extends ProfileLiteralParserDouble { constructor() { super(); construct(this); } }
  Object.defineProperties(Parser.prototype, Object.fromEntries(Object.entries(
    Object.getOwnPropertyDescriptors(ProfileLiteralParserDouble.prototype)).filter(([name]) => name !== 'constructor')));
  for (const [name, method] of Object.entries(overrides)) Object.defineProperty(Parser.prototype, name, {value: method, configurable: true});
  return Parser;
}
function wiped(owner) { assert.ok(zero(owner.input)); assert.ok(zero(owner.output)); assert.equal(owner.freed, true); }
const digest = (_algorithm, source) => new Uint8Array(createHash('sha256').update(source).digest());

test('required policy has no production grammar fallback and accessor capabilities stay uninvoked', () => {
  const f = fixture();
  assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans), error => error.code === 'unavailable-native');
  assert.throws(() => createStockLiveProfileAcquirer({capabilities: {}, isCurrentDocument: () => true}), error => error.code === 'unavailable-native');
  const Parser = policy();
  Object.defineProperty(Parser.prototype, 'clear', {get() { assert.fail('policy getter invoked'); }});
  assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans, Parser), error => error.code === 'unavailable-native');
});

test('scratch is clear then freed before copied profile returns; caller input is preserved', () => {
  const f = fixture(); const before = f.source.slice(); let owner;
  const trace = [];
  const Parser = policy({clear() { trace.push('clear'); ProfileLiteralParserDouble.prototype.clear.call(this); },
    free() { assert.ok(zero(this.input)); assert.ok(zero(this.output)); trace.push('free'); this.freed = true; }}, value => { owner = value; });
  const profile = parseClosedProfileDeclarations(f.source, f.spans, Parser);
  assert.deepEqual(trace, ['clear', 'free']); wiped(owner); assert.deepEqual(f.source, before);
  assert.equal(profile.clientVersion, 17); assert.equal(profile.protocolVersion, 19); profile.password.fill(0);
});

test('size/span/digest/hash rejection creates no Wasm scratch or partial output', async () => {
  for (const kind of ['size', 'span', 'digest', 'hash']) {
    const f = fixture('invalid'); let created = 0, consumed = false;
    const pin = kind === 'size' ? freeze({...f.pin, expectedBytes: f.source.length - 1})
      : kind === 'span' ? freeze({...f.pin, version: freeze({start: -1, end: 1})}) : f.pin;
    await assert.rejects(verifyAndConsumeProfileBytes({source: f.source, pin,
      literalParser: policy({}, () => { created++; }),
      digest: kind === 'digest' ? () => { throw new Error('PRIVATE synthetic marker'); }
        : kind === 'hash' ? () => new Uint8Array(32) : digest,
      consumeProfile() { consumed = true; }}), error => {
      assert.ok(!String(error).includes('PRIVATE')); assert.equal(Object.hasOwn(error, 'cause'), false);
      return error.code === ({size: 'bad-size', span: 'bad-pin', digest: 'digest-failed', hash: 'hash-mismatch'}[kind]);
    });
    assert.equal(created, 0); assert.equal(consumed, false); assert.ok(zero(f.source));
  }
});

test('partial Wasm writes, syntax/numeric failures and output-copy errors clear before free', () => {
  for (const method of ['write', 'parse_version', 'parse_password', 'password_byte', 'protocol_version']) {
    const f = fixture(); let owner, calls = 0;
    const Parser = policy({[method](...args) {
      const result = ProfileLiteralParserDouble.prototype[method].apply(this, args);
      if (++calls === (method === 'write' ? 5 : 1)) throw new Error('PRIVATE synthetic native fault');
      return result;
    }}, value => { owner = value; });
    assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans, Parser), error => error.code === 'bad-literal' && !String(error).includes('PRIVATE'));
    wiped(owner);
  }
  for (const [version, last] of [['01', '19'], ['17', '256'], ['17', '19,0']]) {
    const f = fixture(version, last); let owner;
    assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans, policy({}, value => { owner = value; })), error => error.code === 'bad-literal');
    wiped(owner);
  }
});

test('Wasm cleanup failures attempt both operations and prevent consumers without native error leakage', async () => {
  for (const method of ['clear', 'free']) {
    const f = fixture(); let owner, consumed = false;
    const Parser = policy({[method]() {
      ProfileLiteralParserDouble.prototype[method].call(this);
      throw new Error('PRIVATE synthetic cleanup fault');
    }}, value => { owner = value; });
    await assert.rejects(verifyAndConsumeProfileBytes({source: f.source, pin: f.pin, digest, literalParser: Parser,
      consumeProfile() { consumed = true; }}), error => error.code === 'cleanup-failed' && !String(error).includes('PRIVATE'));
    assert.equal(consumed, false); wiped(owner); assert.ok(zero(f.source));
  }
});

test('source/hash and scratch are zero before consumer, password after either consumer outcome', async () => {
  for (const throws of [false, true]) {
    const f = fixture(); let owner, password, hash;
    const operation = verifyAndConsumeProfileBytes({source: f.source, pin: f.pin,
      digest(...args) { return hash = digest(...args); }, literalParser: policy({}, value => { owner = value; }),
      consumeProfile(profile) {
        assert.ok(zero(f.source)); assert.ok(zero(hash)); wiped(owner); password = profile.password;
        assert.equal(password[19], 19);
        if (throws) throw new Error('PRIVATE synthetic consumer fault');
      }});
    if (throws) await assert.rejects(operation, error => error.code === 'consumer-failed'); else await operation;
    assert.ok(zero(password)); wiped(owner);
  }
});

test('non-scalar/asynchronous policy results are rejected and drained before delivery', async () => {
  for (const method of ['parse_version', 'clear', 'free']) {
    const f = fixture(); let owner;
    const Parser = policy({[method]() {
      ProfileLiteralParserDouble.prototype[method].call(this, f.spans.version.end);
      return Promise.reject(new Error('PRIVATE synthetic asynchronous policy fault'));
    }}, value => { owner = value; });
    await assert.rejects(verifyAndConsumeProfileBytes({source: f.source, pin: f.pin, digest, literalParser: Parser,
      consumeProfile() { assert.fail('consumer after unsupported policy result'); }}), error =>
      error.code === (method === 'parse_version' ? 'bad-literal' : 'cleanup-failed'));
    wiped(owner); assert.ok(zero(f.source));
  }
  await new Promise(resolve => setImmediate(resolve));
});
