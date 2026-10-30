// Literal loopback endpoint shared by the local Canvas host and bootstrap.
export function loopbackEndpoint(value) {
  const match = typeof value === 'string' && /^ws:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/slither$/.exec(value);
  if (!match) {
    throw new Error('Expected ws://127.0.0.1:<port>/slither');
  }
  if (Number(match[1]) > 65535) {
    throw new Error('Invalid loopback simulator port');
  }
  return value;
}
