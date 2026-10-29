// Serialized by scripting.executeScript. No outer closure survives injection.
export async function profileDelivery(receiverURL, operation, token, version, protocol, password) {
  'use strict';
  try {
    if (globalThis !== globalThis.top || globalThis.location.href !== 'http://slither.com/io'
      || !/^chrome-extension:\/\/[a-p]{32}\/game\/profile-receiver\.mjs$/.test(receiverURL)) return false;
    let fixed;
    try { fixed = !delete window.__slitherClientGateNativesV1; } catch { fixed = true; }
    const natives = fixed ? window.__slitherClientGateNativesV1 : undefined;
    const field = typeof natives === 'object' && natives !== null ? natives.descriptor(window, natives.slot) : undefined;
    if (!field || !natives.own(field, 'value') || field.configurable !== false || field.writable !== false) return false;
    return field.value.deliverExtensionProfile(operation, token, version, protocol, password);
  } catch { return false; }
  finally {
    if (password !== null && password !== undefined) for (let i = 0; i < password.length; i++) password[i] = 0;
    if (token !== null && token !== undefined) for (let i = 0; i < token.length; i++) token[i] = 0;
  }
}
