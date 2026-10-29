// Serialized by scripting.executeScript. No outer closure survives injection.
export async function profileDelivery(receiverURL, operation, token, version, protocol, password) {
  try {
    if (globalThis !== globalThis.top || globalThis.location.href !== 'http://slither.com/io'
      || !/^chrome-extension:\/\/[a-p]{32}\/game\/profile-receiver\.mjs$/.test(receiverURL)) return false;
    const receiver = await import(receiverURL);
    if (globalThis !== globalThis.top || globalThis.location.href !== 'http://slither.com/io') return false;
    return operation === 'claim' ? receiver.claimPendingProfileBroker(token)
      : receiver.deliverPendingProfileBroker(operation, token, version, protocol, password);
  } catch { return false; }
  finally {
    // These are browser-created JSON arrays, never page callbacks or source bytes.
    if (password !== null && password !== undefined) for (let i = 0; i < password.length; i++) password[i] = 0;
    if (token !== null && token !== undefined) for (let i = 0; i < token.length; i++) token[i] = 0;
  }
}

// The isolated extension context supplies this key privately before real UI construction.
export async function profileBootstrap(bootstrapURL, authority) {
  try {
    if (globalThis !== globalThis.top || globalThis.location.href !== 'http://slither.com/io'
      || !/^chrome-extension:\/\/[a-p]{32}\/game\/bootstrap\.mjs$/.test(bootstrapURL)) return false;
    const bootstrap = await import(bootstrapURL);
    if (globalThis !== globalThis.top || globalThis.location.href !== 'http://slither.com/io') return false;
    await bootstrap.startGamePage({ profileAuthority: authority });
    return true;
  } catch { return false; }
  finally { if (authority !== null && authority !== undefined) for (let i = 0; i < authority.length; i++) authority[i] = 0; }
}
