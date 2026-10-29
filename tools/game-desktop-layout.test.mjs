// Actual module graph with explicit generated-ABI/native doubles, not browser evidence.
import test from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('default runtime consumes captured Rust dimensions and forwards fractional viewport reads unchanged', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const seen = [];
    const graph = createGraph({ prepareWasm(api) {
      api.desktop_backing_size = (width, height) => { seen.push([width, height]); return { width: 777, height: 555 }; };
    } });
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ initialize() {}, wasmApi: graph.wasm.api });
    assert.deepEqual(seen, [[960, 540]]);
    assert.equal(runtime.diagnostics().width, 777); assert.equal(runtime.diagnostics().height, 555);
    graph.f.realm.innerWidth = 799.25; graph.f.realm.innerHeight = .01;
    graph.wasm.api.desktop_backing_size = () => { throw Error('late mutable export'); };
    graph.f.edit.dispatch('resize');
    assert.deepEqual(seen.at(-1), [799.25, .01]);
    assert.equal(runtime.diagnostics().width, 777); assert.equal(runtime.diagnostics().height, 555);
    assert.equal(graph.f.sockets, 0); runtime.dispose();
  });
});

test('runtime rejects absent, accessor, asynchronous and malformed layout ABI without a JS fallback', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const mode of ['missing', 'accessor', 'async', 'bad-result']) {
      let getter = 0;
      const graph = createGraph({ prepareWasm(api) {
        if (mode === 'missing') delete api.desktop_backing_size;
        if (mode === 'accessor') Object.defineProperty(api, 'desktop_backing_size', { get() { getter++; throw Error('late getter'); } });
        if (mode === 'async') api.desktop_backing_size = async () => ({ width: 1, height: 1 });
        if (mode === 'bad-result') api.desktop_backing_size = () => ({ width: 0, height: 1 });
      } });
      const { startGamePage } = await graph.load('runtime.mjs');
      await assert.rejects(startGamePage({ initialize() {}, wasmApi: graph.wasm.api }), /Desktop (?:layout Wasm capability|size data fields)/);
      assert.equal(getter, 0); assert.equal(graph.f.sockets, 0); assert.equal(graph.f.raf.size, 0);
    }
  });
});
