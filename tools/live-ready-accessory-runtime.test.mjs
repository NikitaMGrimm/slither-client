import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

// Authored ESM composition: actual snapshot, adapter, controller and runtime;
// native realm/scene are the existing labelled doubles. No browser or sockets.
test('remote runtime propagates the captured mode to both adapter and controller', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const mode of ['face', 'accessory']) {
      const graph = createGraph(), origin = 'https://authored-package.invalid/game/';
      for (const name of ['stock-host-snapshot', 'stock-skin-provider']) {
        graph.sources.set(origin + name + '-actual.mjs', graph.sources.get(origin + name + '.mjs'));
      }
      graph.sources.set(origin + 'stock-host-snapshot.mjs', `
        import {createStockHostSnapshot as actual} from './stock-host-snapshot-actual.mjs';
        export {isPendingStockCapture} from './stock-host-snapshot-actual.mjs';
        export function createStockHostSnapshot(options) {
          const reader=actual(options);
          return {...reader,capture(){const snapshot=reader.capture();return ${mode === 'face' ? 'snapshot' : "{...snapshot,appearanceMode:'accessory'}"};}};
        }`);
      graph.sources.set(origin + 'stock-skin-provider.mjs', `
        import {createStockSkinAdapter as actual} from './stock-skin-provider-actual.mjs';
        export let selectedMode, selectedPolicy;
        export function createStockSkinAdapter(options){selectedMode=options.appearanceMode;selectedPolicy=[options.resolveSkin,options.validateCustomPaletteMask];return actual(options);}`);
      const prototype = graph.wasm.api.AnimatedScene.prototype;
      let accessoryDraws = 0;
      prototype.render_standard_with_accessory_presentation_at_size = function (...args) {
        accessoryDraws++;
        return Reflect.apply(prototype.render_standard_with_face_presentation_at_size, this, args);
      };
      prototype.apply_frame_and_render_standard_with_accessory_presentation_and_prey = function (...args) {
        return Reflect.apply(prototype.apply_frame_and_render_standard_with_face_presentation_and_prey, this, args);
      };
      const { startGamePage } = await graph.load('runtime.mjs');
      const runtime = await startGamePage({ realm: graph.f.realm, initialize() {}, wasmApi: graph.wasm.api });
      try {
        const binding = await graph.load('stock-skin-provider.mjs');
        assert.equal(binding.selectedMode, mode);
        assert.equal(binding.selectedPolicy[0], graph.wasm.api.resolve_skin);
        assert.equal(binding.selectedPolicy[1], graph.wasm.api.stock_custom_palette_mask_valid);
        graph.f.frame(16);
        assert.equal(accessoryDraws > 0, mode === 'accessory');
      } finally { runtime.dispose(); }
    }
  });
});
