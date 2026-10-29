import init, * as wasm from './pkg/slither_client.js';
import { startGamePage as startRuntime } from './runtime.mjs';
import { captureLocalGameDocument, createLocalGameHost } from './local-game-host.mjs';
import { loopbackEndpoint } from './loopback-session.mjs';
import { readAuthoredSourceRecipes } from './authored-source-recipes.mjs';

/** One package entry supplies the authored HUD, Play controls, leaderboard and minimap. */
export async function startGamePage({ realm = globalThis, initialize = init, wasmApi = wasm, localHost, profileAuthority, profileGate } = {}) {
  let initializeRuntime = initialize;
  if (localHost === undefined && /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}(?:[/?#]|$)/.test(realm.location?.href ?? '')) {
    let documentFence;
    try {
      documentFence = captureLocalGameDocument(realm);
      const response = await realm.fetch('/scene/config.json');
      if (!response.ok) throw new Error('Local simulator configuration unavailable');
      const config = await response.json();
      const field = config !== null && typeof config === 'object' ? Object.getOwnPropertyDescriptor(config, 'simulatorUrl') : undefined;
      if (!field || !Object.hasOwn(field, 'value') || !field.value) throw new Error('Start the scene server with --simulator-port <port>');
      documentFence.assertCurrent();
      const endpoint = loopbackEndpoint(field.value);
      // Numeric artwork requires Wasm first. Share one promise, including failure;
      // runtime still binds the skin policy at its existing post-initialize stage.
      let initialized;
      try { initialized = Promise.resolve(initialize()); } catch (error) { initialized = Promise.reject(error); }
      initializeRuntime = () => initialized;
      await initialized;
      documentFence.assertCurrent();
      const sourceRecipes = readAuthoredSourceRecipes(wasmApi);
      documentFence.assertCurrent();
      localHost = await createLocalGameHost({ realm, endpoint, sourceRecipes });
    } catch (error) {
      try {
        if (documentFence?.isCurrent()) {
          const status = documentFence.document.getElementById('slither-client-status');
          if (status && documentFence.isCurrent()) status.textContent = 'Client unavailable. Reload this page.';
        }
      } catch { /* A status write must not replace the startup failure. */ }
      throw error;
    }
  }
  return startRuntime({ realm, initialize: initializeRuntime, wasmApi, hudReadout: true, diagnosticUi: false,
    ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, ownedAppearancePreview: true, ownedLoadingUi: true, ownedLeaderboardUi: true, ownedMinimapUi: true, ownedAnnouncementUi: true, ownedEndScreenUi: true,
    ...(localHost ? { localHost } : {}), ...(profileAuthority ? { profileAuthority, profileGate } : {}) });
}

// Trusted MAIN modules share the default entry's single local startup promise.
const requiresPrivateBootstrap = globalThis[Symbol.for('slither.client.gate.v1')]?.requiresProfileBootstrap?.() === true;
export const gamePageRuntime = !requiresPrivateBootstrap && (globalThis[Symbol.for('slither.client.gate.v1')]
  || /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}(?:[/?#]|$)/.test(globalThis.location?.href ?? '')
  ) ? startGamePage() : undefined;

gamePageRuntime?.catch(() => {});
