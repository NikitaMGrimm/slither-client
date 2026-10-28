// Authored actual-runtime/DOM-capability doubles; no browser, pixels or network.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('consumer status stays visible during startup and yields to the mounted Play owner; diagnostics stays visible', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const diagnosticUi of [false, true]) {
      let release;
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const profile = graph.profileNative();
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
      const factory = await graph.load('runtime.mjs');
      const pending = factory.startGamePage({ realm, initialize: () => new Promise(resolve => { release = resolve; }),
        wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true, diagnosticUi });
      const output = graph.f.document.getElementById('slither-client-status');
      const display = () => graph.f.edit.hud.style(output.style).get('display');
      assert.equal(output.textContent, 'SlitherClient: Loading'); assert.notEqual(display(), 'none');
      release(); const runtime = await pending;
      assert.equal(output.textContent, 'SlitherClient: Ready');
      assert.equal(display() === 'none', !diagnosticUi);
      assert.equal(profile.counts.fetch, 0); assert.equal(graph.f.sockets, 0);
      runtime.dispose(); assert.notEqual(display(), 'none'); assert.equal(graph.f.raf.size, 0);
    }
  });
});

test('consumer startup failure retains visible outer feedback and the original rejection', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const primary of [new Error('Synthetic initialize failure'), undefined, false]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const factory = await graph.load('runtime.mjs');
      let rejected = false, value;
      try { await factory.startGamePage({ initialize() { throw primary; }, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, diagnosticUi: false }); }
      catch (error) { rejected = true; value = error; }
      assert(rejected); assert.equal(value, primary);
      const output = graph.f.document.getElementById('slither-client-status');
      assert.notEqual(graph.f.edit.hud.style(output.style).get('display'), 'none');
      assert.equal(output.textContent, 'SlitherClient: Unavailable');
      assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
    }
  });
});

test('diagnosticUi false keeps the outer fallback when no owned Play presentation replaces it', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
    const factory = await graph.load('runtime.mjs');
    const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, diagnosticUi: false });
    const output = graph.f.document.getElementById('slither-client-status');
    assert.notEqual(graph.f.edit.hud.style(output.style).get('display'), 'none');
    assert.equal(output.textContent, 'SlitherClient: ready-not-connected');
    runtime.dispose(); assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
  });
});

test('consumer late failure restores outer feedback after removing owners and preserves the primary through cleanup failure', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const secondaryFailure of [false, true]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, diagnosticUi: false });
      const output = graph.f.document.getElementById('slither-client-status');
      const primary = { synthetic: 'runtime primary' };
      graph.f.faults.control = () => { throw primary; };
      if (secondaryFailure) graph.f.faults.cleanup = stage => { if (stage === 'scene.free') throw Error('Secondary free'); };
      let threw = false, value;
      try { graph.f.frame(8); } catch (error) { threw = true; value = error; }
      assert.equal(threw, secondaryFailure); if (threw) assert.equal(value, primary);
      assert.equal(runtime.diagnostics().disposed, true);
      assert.notEqual(graph.f.edit.hud.style(output.style).get('display'), 'none');
      assert.equal(output.textContent, 'SlitherClient: Failed');
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
      assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0); runtime.dispose();
    }
  });
});

test('caught reentry during consumer-status hiding rejects startup and cleanup remains visible', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    let entered = false, refusal;
    graph.f.edit.hud.controls.set('setStyle', { hook(style, name, value) {
      const output = graph.f.document.getElementById('slither-client-status');
      if (entered || !output || style !== output.style || name !== 'display' || value !== 'none') return;
      entered = true; try { graph.f.edit.dispatch('resize'); } catch (error) { refusal = error; }
    } });
    const factory = await graph.load('runtime.mjs');
    await assert.rejects(factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, diagnosticUi: false }), error => error === refusal);
    assert(entered); assert(refusal);
    const output = graph.f.document.getElementById('slither-client-status');
    assert.notEqual(graph.f.edit.hud.style(output.style).get('display'), 'none');
    assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
    assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
  });
});

test('consumer cleanup skips a status node adopted out of its owned document', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    const factory = await graph.load('runtime.mjs');
    const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, diagnosticUi: false });
    const output = graph.f.document.getElementById('slither-client-status');
    const before = output.textContent, style = output.style;
    graph.f.edit.state(output).owner = {};
    runtime.dispose();
    assert.equal(output.textContent, before);
    assert.equal(graph.f.edit.hud.style(style).get('display'), 'none');
    assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
  });
});

test('consumer fallback restoration failure preserves falsy primaries and still attempts terminal status', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const primary of [undefined, false, new Error('Synthetic visibility cleanup failure')]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const statuses = [];
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, status(code) {
        statuses.push(code); if (code === 'client-failed') throw Error('Secondary terminal status'); return native.status(code);
      } }));
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, diagnosticUi: false });
      const output = graph.f.document.getElementById('slither-client-status'), style = output.style;
      graph.f.edit.hud.controls.set('setStyle', { hook(receiver, name, value) {
        if (receiver === style && name === 'display' && value === '') throw primary;
      } });
      let threw = false, value;
      try { runtime.dispose(); } catch (error) { threw = true; value = error; }
      assert(threw); assert.equal(value, primary); assert.equal(statuses.at(-1), 'client-failed');
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
      assert.equal(graph.f.raf.size, 0); runtime.dispose();
    }
  });
});
