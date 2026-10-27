import init, * as wasm from './pkg/slither_client.js';
import { startGamePage as startRuntime } from './runtime.mjs';

/** Explicit package entry supplies the authored visible HUD to the existing owner. */
export async function startOwnedHudGamePage({ realm = globalThis, initialize = init, wasmApi = wasm } = {}) {
  return startRuntime({ realm, initialize, wasmApi, hudReadout: true, ownedHudUi: true });
}

export const gamePageRuntime = globalThis[Symbol.for('slither.client.gate.v1')] ? startOwnedHudGamePage() : undefined;

gamePageRuntime?.catch(() => {});
