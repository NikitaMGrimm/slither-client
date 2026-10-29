// TEST ONLY: the existing authored JS grammar, retained as an independent cutover oracle.
// No reference source, original assets, live values or acquisition authority.
const failure = code => Object.assign(new Error('Authored profile oracle: ' + code), { code });
const space = byte => byte === 32 || byte === 9 || byte === 10 || byte === 13;
const digit = byte => byte >= 48 && byte <= 57;
const initial = byte => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte === 95 || byte === 36;
function cursor(source, span) {
  let offset = span.start;
  const reject = () => { throw failure('bad-literal'); };
  function ws(required = false) {
    const before = offset;
    while (offset < span.end && space(source[offset])) offset++;
    if (required && before === offset) reject();
  }
  function token(text) {
    for (let i = 0; i < text.length; i++) {
      if (offset >= span.end || source[offset++] !== text.charCodeAt(i)) reject();
    }
  }
  function identifier() {
    if (offset >= span.end || !initial(source[offset])) reject();
    let count = 0;
    while (offset < span.end && (initial(source[offset]) || digit(source[offset]))) {
      if (++count > 64) reject();
      offset++;
    }
  }
  function decimal(maxDigits, maximum) {
    if (offset >= span.end || !digit(source[offset])) reject();
    const zero = source[offset] === 48;
    let count = 0, value = 0;
    while (offset < span.end && digit(source[offset])) {
      if (++count > maxDigits || (zero && count > 1)) reject();
      value = value * 10 + source[offset++] - 48;
      if (value > maximum) reject();
    }
    return value;
  }
  function begin() { ws(); token('var'); ws(true); identifier(); ws(); token('='); ws(); }
  function end() { ws(); token(';'); ws(); if (offset !== span.end) reject(); }
  return { ws, token, decimal, begin, end };
}

export function oracleClientVersion(source) {
  const parser = cursor(source, { start: 0, end: source.length });
  parser.begin(); const value = parser.decimal(5, 65535); parser.end(); return value;
}
export function oraclePassword(source, password) {
  const parser = cursor(source, { start: 0, end: source.length });
  parser.begin(); parser.token('['); parser.ws();
  for (let i = 0; i < 20; i++) {
    if (i) { parser.token(','); parser.ws(); }
    password[i] = parser.decimal(3, 255); parser.ws();
  }
  parser.token(']'); parser.end();
}
