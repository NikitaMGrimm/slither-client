// Authored test-only copied ABI double. Production requires initialized Rust.
export function projectMenuLoadingDouble(code, mounted) {
  const states = { loading: ['Loading client…', true, false],
    'waiting-assets': ['Preparing appearance sources…', true, false],
    'ready-not-connected': ['Ready.', false, false], connecting: ['Connecting.', true, false], connected: ['Connected.', false, false],
    disconnected: ['Not connected.', false, false], disposed: ['Not connected.', false, true],
    'host-unavailable': ['Play unavailable on this page.', false, true],
    'csp-or-module-unavailable': ['Play unavailable on this page.', false, true],
    'client-failed': ['Play failed. Reload to start again.', false, true] };
  if (!Object.hasOwn(states, code)) throw Error('Unknown menu loading observation');
  const [text, busy, terminal] = states[code], visible = terminal || !mounted;
  return Object.freeze({ visible, busy: visible && busy, text });
}
