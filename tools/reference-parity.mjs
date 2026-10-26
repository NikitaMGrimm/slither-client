import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { createReferenceOracle, loadWasm, referenceHash } from './reference-context.mjs';

// These programs are generated test inputs, never captured server programs.
export function syntheticChallenge(literal) {
  if (literal.length !== 27) throw new Error('Synthetic fixture requires 27 characters');
  const tokens = ['var', ' a', ' = ', JSON.stringify(literal.slice(0, 5)), '; a', ' += ', JSON.stringify(literal.slice(5)), '; ', 'for', ' (', 'var', ' i = 0; i < 27; i++', ') { ', 'idba', '[i] = a.', 'charCodeAt', '(i); }'];
  const source = tokens.join('');
  let key = 23;
  const encoded = [];
  for (const byte of Buffer.from(source, 'ascii')) {
    for (const nibble of [byte >> 4, byte & 15]) {
      encoded.push(97 + (nibble + key) % 26);
      key = (key + 17) % 26;
    }
  }
  return Uint8Array.from(encoded);
}

export async function compareReference(root) {
  const wasm = await loadWasm();
  const oracle = await createReferenceOracle(root);
  const cases = [
    ['', 0, []], ['(Bot) Bottington', 0, []], ['SYNTHETICabcdefghijklmn', 8, []],
    ['Synthetic Skin', 26, [1, 2, 3, 4]],
  ];
  for (const [nickname, skin, custom] of cases) {
    const expected = oracle.login(nickname, skin, custom);
    const actual = wasm.encode_login(oracle.profile.clientVersion, oracle.profile.password, nickname, skin, Uint8Array.from(custom));
    assert.deepEqual(actual, expected);
  }
  for (const literal of ['ABCDEFGHIJKLMNOPQRSTUVWXYZa', '!'.repeat(27), 'SYNTHETIC-test-data-012345678'.slice(0, 27)]) {
    oracle.compareChallenge(syntheticChallenge(literal), wasm);
  }
  return { referenceSha256: referenceHash, loginCases: cases.length, syntheticChallengeCases: 3, loginBytesIdentical: true, challengeRepliesIdentical: true, networkConnections: 0 };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/reference-parity.mjs')) {
  const { values } = parseArgs({ options: { 'reference-root': { type: 'string' } } });
  if (!values['reference-root']) throw new Error('--reference-root is required; reference material must stay external');
  console.log(JSON.stringify(await compareReference(values['reference-root']), null, 2));
}
