import init, * as wasm from './pkg/slither_client.js';
import { startGamePage as startRuntime } from './runtime.mjs';

/** Explicit package entry supplies the owned Play panel on the same runtime claim. */
export async function startOwnedPlayGamePage({ realm = globalThis, initialize = init, wasmApi = wasm } = {}) {
  return startRuntime({ realm, initialize, wasmApi, hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
}

export const gamePageRuntime = globalThis[Symbol.for('slither.client.gate.v1')] ? startOwnedPlayGamePage() : undefined;

gamePageRuntime?.catch(() => {});
