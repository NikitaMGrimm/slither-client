// Labelled synthetic ABI double for native-operation tests; real Rust is tested by start-page-smoke.
export function projectStartPageDouble(status, locked, playing) {
  const labels = { ready: 'Ready.', 'empty-endpoint': 'Enter a server address.',
    'invalid-endpoint': 'Enter a valid server address.', 'invalid-nickname': 'Check the nickname.',
    preparing: 'Preparing connection.', connecting: 'Connecting.', connected: 'Connected.',
    'not-connected': 'Not connected.', unavailable: 'Play unavailable on this page.',
    failed: 'Play failed. Reload to start again.' };
  if (!Object.hasOwn(labels, status)) throw new TypeError('Invalid start page status');
  const busy = status === 'preparing' || status === 'connecting';
  return Object.freeze({ visible: !playing, busy: busy && !playing,
    disabled: locked || playing || busy || status === 'unavailable' || status === 'failed',
    status: labels[status], button: busy ? 'Connecting…' : 'Play' });
}
