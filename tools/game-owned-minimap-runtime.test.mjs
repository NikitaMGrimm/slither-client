// Actual default entry/gate/builders/gameplay; generated Wasm and issued map views are labelled doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('default minimap publishes Rust views, reuses image buffers and stays outside world draw accounting', async () => {
  await runGameModuleTest(async ({ assert, createGraph, issuedMinimapViewDouble }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true,
      leaderboardNative: true, minimapNative: true,
      prepareWasm(api, run) {
        api.LeaderboardScoreProjector = run('(class { project() { throw Error("No board projection expected"); } free() {} })');
      } });
    graph.hudWasm();
    const entry = await graph.load('bootstrap.mjs'), runtime = await entry.gamePageRuntime;
    const root = graph.f.document.getElementById('slither-client-root'), holder = root.children.at(-1);
    const style = node => graph.f.edit.hud.style(node.style);
    const uploads = () => graph.f.edit.minimap.trace.filter(call => call[0] === 'putImageData');
    const frame = now => {
      const [id, callback] = graph.f.raf.entries().next().value;
      graph.f.raf.delete(id); callback(now);
    };
    assert.equal(style(holder).get('display'), 'none');
    assert.equal(graph.minimap.enabled, 1); assert.equal(graph.minimap.reads.length, 1);
    assert.equal(graph.f.intervals.size, 0); assert.equal(graph.f.raf.size, 1);
    graph.minimap.view = issuedMinimapViewDouble(2, 1n);
    frame(16);
    assert.equal(style(holder).get('display'), 'block');
    assert.equal(uploads().length, 2); assert.equal(runtime.diagnostics().draws, 1);
    assert.equal(graph.minimap.reads.at(-1).revision, 0n);
    graph.minimap.view.widget.marker.left = 8.5;
    graph.minimap.view.widget.opacity = -0.25;
    frame(32);
    assert.equal(graph.minimap.reads.at(-1).revision, 1n);
    assert.equal(uploads().length, 2, 'numeric-only views do not upload pixels');
    assert.equal(style(holder.children[3]).get('left'), '8.5px');
    assert.equal(style(holder).get('opacity'), '-0.25', 'requested opacity reaches the browser style boundary');
    assert.equal(runtime.diagnostics().draws, 2);
    graph.minimap.view = issuedMinimapViewDouble(3, 2n);
    frame(48);
    assert.equal(uploads().length, 4);
    assert.equal(holder.children[1].width, 3); assert.equal(holder.children[2].height, 3);
    graph.minimap.view = { ...graph.minimap.view, widget: null };
    frame(64);
    assert.equal(style(holder).get('display'), 'none');
    assert.equal(graph.f.intervals.size, 0); assert.equal(graph.f.raf.size, 1);
    runtime.dispose(); runtime.dispose();
    assert.equal(root.children.length, 3); assert.equal(graph.f.raf.size, 0);
  });
});

test('selected minimap requires captured Canvas capabilities before initialization or UI construction', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true });
    const before = graph.f.edit.hud.trace.length;
    const factory = await graph.load('runtime.mjs');
    await assert.rejects(factory.startGamePage({ initialize() { assert.fail('Initialization must follow admission'); },
      wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedMinimapUi: true }), /HUD owner record|minimap DOM/);
    assert.equal(graph.f.edit.hud.trace.length, before); assert.equal(graph.wasm.calls.length, 0);
    assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
  });
});
