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
