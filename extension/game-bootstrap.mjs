import init, * as wasm from './pkg/slither_client.js';
import { startGamePage as startRuntime } from './runtime.mjs';
import { createLocalGameHost } from './local-game-host.mjs';

/** One package entry supplies the authored HUD, Play controls and leaderboard. */
export async function startGamePage({ realm = globalThis, initialize = init, wasmApi = wasm, localHost } = {}) {
  if (localHost === undefined && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}(?:[/?#]|$)/.test(realm.location?.href ?? '')) {
    const response = await realm.fetch('/scene/config.json');
    if (!response.ok) throw new Error('Local simulator configuration unavailable');
    const config = await response.json();
    if (!config.simulatorUrl) throw new Error('Start the scene server with --simulator-port <port>');
    localHost = await createLocalGameHost({ realm, endpoint: config.simulatorUrl });
  }
  return startRuntime({ realm, initialize, wasmApi, hudReadout: true,
    ownedHudUi: true, ownedPlayUi: true, ownedLeaderboardUi: true, ...(localHost ? { localHost } : {}) });
}

// Trusted MAIN modules share the default entry's single local startup promise.
export const gamePageRuntime = globalThis[Symbol.for('slither.client.gate.v1')]
  || /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}(?:[/?#]|$)/.test(globalThis.location?.href ?? '')
  ? startGamePage() : undefined;

gamePageRuntime?.catch(() => {});
