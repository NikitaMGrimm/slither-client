import init, * as wasm from './pkg/slither_client.js';
import { startGamePage as startRuntime } from './runtime.mjs';

/** Default entry preserves legacy startup and explicit dependency overrides. */
export async function startGamePage({ realm = globalThis, initialize = init, wasmApi = wasm, hudReadout = false } = {}) {
  return startRuntime({ realm, initialize, wasmApi, hudReadout, ownedHudUi: false });
}

// Trusted MAIN modules share the selected entry's single local startup promise.
export const gamePageRuntime = globalThis[Symbol.for('slither.client.gate.v1')] ? startGamePage() : undefined;

gamePageRuntime?.catch(() => {});
