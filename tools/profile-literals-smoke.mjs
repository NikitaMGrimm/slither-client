// Authored closed-literal corpus and real-Wasm ownership checks; no downloaded inputs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { oracleClientVersion, oraclePassword } from './fixtures/profile-literals-oracle.mjs';
import { parseClosedProfileDeclarations, verifyAndConsumeProfileBytes } from '../web/stock-live-profile.mjs';

const encode = value => new TextEncoder().encode(value);
const freeze = Object.freeze;
function fixture(version, password) {
  const a = typeof version === 'string' ? encode(version) : version;
  const b = typeof password === 'string' ? encode(password) : password;
  const source = new Uint8Array(a.length + b.length); source.set(a); source.set(b, a.length);
  const spans = freeze({ version: freeze({start: 0, end: a.length}), password: freeze({start: a.length, end: source.length}) });
  return {source, spans, a, b};
}

/** Check the authored oracle, exact grammar and live Wasm storage without a browser. */
export async function profileLiteralsSmoke(wasm) {
  assert.equal(typeof wasm.ProfileLiteralParser, 'function', 'Real profile literal ABI required');
  const goodVersion = 'var authoredVersion=17;';
  const goodPassword = `var authoredPassword=[${Array.from({length: 20}, (_, i) => i).join(',')}];`;
  const pairs = [[goodVersion, goodPassword], ['\tvar $_9\r\n= 65535 ;\n', goodPassword],
    ['var v=0;', 'var p=[' + new Array(20).fill('255').join(' ,\t') + '];']];
  for (const value of ['65536', '-1', '+1', '1.0', '1e2', '0x10', '0o10', '0b10', '01', '1_0', '123456', 'NaN', 'Infinity', 'x', 'f()', '"17"']) pairs.push([`var v=${value};`, goodPassword]);
  for (const value of ['varv=17;', 'let v=17;', 'var v/*x*/=17;', 'var v=17', 'var v=17;extra;', 'var é=17;', 'var \\u0076=17;', 'var v=17;\0', 'var v=17;\v', `var ${'a'.repeat(64)}=1;`, `var ${'a'.repeat(65)}=1;`]) pairs.push([value, goodPassword]);
  for (const value of ['256', '-1', '+0', '1.5', '1e1', '0x10', '00', '1_0', '1234', 'n', 'f()', '"1"']) {
    for (const index of [0, 19]) {
      const values = new Array(20).fill('0'); values[index] = value;
      pairs.push([goodVersion, 'var p=[' + values.join(',') + '];']);
    }
  }
  for (const count of [0, 1, 19, 21]) pairs.push([goodVersion, 'var p=[' + new Array(count).fill('0').join(',') + '];']);
  for (const suffix of [',', '/*x*/', ',...more', '\0']) pairs.push([goodVersion, 'var p=[' + new Array(20).fill('0').join(',') + suffix + '];']);
  for (let byte = 0; byte <= 255; byte++) {
    const before = encode('var'), after = encode(' v=17;');
    pairs.push([Uint8Array.from([...before, byte, ...after]), goodPassword]);
    pairs.push([goodVersion, Uint8Array.from([...encode(goodPassword), byte])]);
  }
  pairs.push([goodVersion.padEnd(128), goodPassword.padEnd(256)]);
  let exactCases = 0;
  for (const [version, password] of pairs) {
    const f = fixture(version, password), before = f.source.slice();
    let expected, failed = false;
    const output = new Uint8Array(20);
    try { expected = {clientVersion: oracleClientVersion(f.a), password: output, protocolVersion: 19}; oraclePassword(f.b, output); }
    catch { failed = true; }
    if (failed) assert.throws(() => parseClosedProfileDeclarations(f.source, f.spans, wasm.ProfileLiteralParser), error => error.code === 'bad-literal');
    else {
      const result = parseClosedProfileDeclarations(f.source, f.spans, wasm.ProfileLiteralParser);
      assert.deepEqual(result, expected); result.password.fill(0);
    }
    output.fill(0); assert.deepEqual(f.source, before); exactCases++;
  }

  // Only test-owned synthetic scratch is inspected. No production memory/readback API is added.
  const memory = wasm.initSync({}).memory;
  const owner = new wasm.ProfileLiteralParser();
  let explicitlyCleared = false;
  try {
    const pointer = owner.__wbg_ptr;
    assert.ok(Number.isInteger(pointer) && pointer > 0);
    for (let i = 0; i < 384; i++) assert.equal(owner.write(i, 211), true);
    const view = () => new Uint8Array(memory.buffer, pointer, 416);
    const inputOffset = view().findIndex((_, start, bytes) => start + 384 <= bytes.length && bytes.subarray(start, start + 384).every(b => b === 211));
    assert.ok(inputOffset >= 0, 'Find only the owned fixed input array in the synthetic allocation');
    owner.clear();
    assert.ok(view().subarray(inputOffset, inputOffset + 384).every(b => b === 0));
    const secret = encode('var p=[' + new Array(20).fill('231').join(',') + '];');
    for (let i = 0; i < secret.length; i++) owner.write(128 + i, secret[i]);
    assert.equal(owner.parse_password(secret.length), true);
    const outputOffset = view().findIndex((_, start, bytes) => start + 20 <= bytes.length && bytes.subarray(start, start + 20).every(b => b === 231));
    assert.ok(outputOffset >= 0, 'Find synthetic output only before clearing the live allocation');
    owner.clear(); explicitlyCleared = true;
    assert.ok(view().subarray(outputOffset, outputOffset + 20).every(b => b === 0));
    assert.ok(view().subarray(inputOffset, inputOffset + 384).every(b => b === 0));
    assert.equal(owner.password_byte(0), -1);
  } finally {
    try { if (!explicitlyCleared) owner.clear(); }
    finally { owner.free(); }
  }

  for (const kind of ['success', 'literal', 'consumer', 'digest']) {
    const f = fixture(kind === 'literal' ? 'var v=01;' : goodVersion, goodPassword);
    const pin = freeze({expectedBytes: f.source.length, sha256: createHash('sha256').update(f.source).digest('hex'), ...f.spans});
    let password, hash, called = false;
    const operation = verifyAndConsumeProfileBytes({source: f.source, pin, literalParser: wasm.ProfileLiteralParser,
      digest(_algorithm, source) {
        if (kind === 'digest') throw new Error('Authored private digest marker');
        return hash = new Uint8Array(createHash('sha256').update(source).digest());
      },
      consumeProfile(profile) {
        called = true; password = profile.password;
        assert.ok(f.source.every(b => b === 0)); assert.ok(hash.every(b => b === 0));
        if (kind === 'consumer') throw new Error('Authored private consumer marker');
      }});
    if (kind === 'success') await operation;
    else await assert.rejects(operation, error => error.code === ({literal: 'bad-literal', consumer: 'consumer-failed', digest: 'digest-failed'}[kind]) && !String(error).includes('marker'));
    assert.equal(called, ['success', 'consumer'].includes(kind));
    assert.ok(f.source.every(b => b === 0)); if (hash) assert.ok(hash.every(b => b === 0));
    if (password) assert.ok(password.every(b => b === 0));
  }
  return { exactOracleCases: exactCases, ownedInputBytes: 384, ownedOutputBytes: 20,
    liveWasmClearBeforeFree: true, verifiedCleanupCases: 4, synthetic: true, browser: false, acquisition: false };
}
