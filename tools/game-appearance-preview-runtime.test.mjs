// Actual runtime/menu/provider graph with explicit generated-ABI/Canvas doubles.
// These checks prove glue ordering and cleanup, not Wasm rendering or pixels.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('restore and appearance edits notify after persistence and render in queued isolated leases without Play', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, minimapNative: true }); graph.hudWasm();
    const profile = graph.profileNative(); let runtime, prepares = 0, random = 0;
    graph.f.realm.localStorage.setItem('slither-client.menu.v1', '1:5361766564:18:');
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities,
      random() { random++; return 0.5; }, appearancePreviewDom: Object.freeze({ __proto__: null, ...native.appearancePreviewDom,
        prepare(...args) {
          prepares++; assert.equal(runtime.diagnostics().captureHeld, true);
          assert.match(graph.f.realm.localStorage.getItem('slither-client.menu.v1'), /^1:/);
          return native.appearancePreviewDom.prepare(...args);
        } }) }));
    const { startGamePage } = await graph.load('runtime.mjs');
    runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, ownedAppearancePreview: true });
    const panel = graph.f.document.getElementById('slither-client-root').children.at(-1), menu = panel.children[4];
    const holder = menu.children.at(-1), canvas = holder.children[0], world = graph.f.document.getElementById('slither-client-root').children[2];
    assert.notEqual(canvas, world); assert.equal(prepares, 0); assert.equal(graph.previewCalls.filter(row => row[0] === 'render').length, 0);
    assert.equal(graph.previewCalls.find(row => row[0] === 'select')[1], 24, 'restored selection enters Rust without a source read');
    const baselineRandom = random; graph.f.flush(); assert.equal(prepares, 1);
    const text = node => graph.f.edit.hud.character(node.children[0]).data;
    const button = label => menu.children.slice(3, -1).find(node => text(node) === label);
    const click = label => { graph.f.edit.dispatch('click', { target: button(label), button: 0, trusted: true }); graph.f.flush(); };
    click('Next skin'); click('Build a skin'); click('Next color'); click('Longer stripe'); click('Add stripe');
    assert.equal(prepares, 6); assert.equal(random, baselineRandom, 'recipe preview consumes no appearance random units');
    assert.equal(graph.previewCalls.filter(row => row[0] === 'render').at(-1)[2], canvas);
    assert.match(graph.f.realm.localStorage.getItem('slither-client.menu.v1'), /^1:5361766564:19:/);
    assert.equal(runtime.diagnostics().captureHeld, false); assert.equal(profile.counts.fetch, 0); assert.equal(graph.f.sockets, 0);
    const selected = graph.previewCalls.filter(row => row[0] === 'select').length;
    graph.f.edit.inputValue(panel.children[1].children[1]).value = 'Other';
    graph.f.edit.dispatch('input', { target: panel.children[1].children[1] }); graph.f.flush();
    assert.equal(graph.previewCalls.filter(row => row[0] === 'select').length, selected, 'nickname edit does not select or redraw');
    runtime.dispose(); graph.f.flush(); assert.equal(graph.previewCalls.filter(row => row[0] === 'free').length, 1);
  });
});

test('preview refuses missing native or Wasm capabilities before initialization; opt-out menu stays unchanged', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const seam of ['native', 'wasm']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, minimapNative: true }); graph.hudWasm();
      let initialized = 0;
      const realm = graph.nativeBoundary(native => {
        const copied = { ...native }; if (seam === 'native') delete copied.appearancePreviewDom; return Object.freeze(copied);
      });
      if (seam === 'wasm') delete graph.wasm.api.AppearancePreview.prototype.needs_draw;
      const { startGamePage } = await graph.load('runtime.mjs');
      await assert.rejects(startGamePage({ realm, initialize() { initialized++; }, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, ownedAppearancePreview: true }));
      assert.equal(initialized, 0); assert.equal(graph.f.sockets, 0);
    }
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true });
    const menu = graph.f.document.getElementById('slither-client-root').children.at(-1).children[4];
    assert.equal(menu.children.length, 14); assert.deepEqual(graph.previewCalls, []); runtime.dispose();
  });
});

test('caught render reentry poisons publication, restores Canvas and frees preview after source release', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, minimapNative: true }); graph.hudWasm();
    let runtime, rejected = 0;
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native,
      appearancePreviewDom: Object.freeze({ __proto__: null, ...native.appearancePreviewDom, prepare(...args) {
        const frame = native.appearancePreviewDom.prepare(...args);
        try { runtime.dispose(); } catch { rejected++; }
        return frame;
      } }) }));
    const originalFree = graph.wasm.api.AppearancePreview.prototype.free;
    graph.wasm.api.AppearancePreview.prototype.free = function () {
      assert.equal(runtime.diagnostics().captureHeld, false); return originalFree.call(this);
    };
    const { startGamePage } = await graph.load('runtime.mjs');
    runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, ownedAppearancePreview: true });
    graph.f.flush(); assert.equal(rejected, 1); assert.equal(runtime.diagnostics().disposed, true);
    assert.equal(graph.previewCalls.filter(row => row[0] === 'free').length, 1);
    const trace = graph.f.edit.minimap.trace;
    assert.equal(trace.filter(row => row[0] === 'save').length, trace.filter(row => row[0] === 'restore').length);
    assert.equal(graph.f.sockets, 0); runtime.dispose();
  });
});

test('queued preview after disposal reads no source and mount failure still frees native owner', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const mode of ['disposed', 'mount-failure']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, minimapNative: true }); graph.hudWasm();
      const { startGamePage } = await graph.load('runtime.mjs');
      if (mode === 'mount-failure') graph.f.edit.hud.controls.set('appendChild', { afterHook(parent, value) {
        if (value.children?.length === 2 && value.children[0].localName === 'canvas') throw undefined;
      } });
      let runtime, thrown = false;
      try { runtime = await startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, ownedAppearancePreview: true }); }
      catch (error) { thrown = true; assert.equal(error, undefined); }
      if (mode === 'mount-failure') assert(thrown); else runtime.dispose();
      graph.f.flush(); assert.equal(graph.previewCalls.filter(row => row[0] === 'render').length, 0);
      assert.equal(graph.previewCalls.filter(row => row[0] === 'free').length, 1); assert.equal(graph.f.sockets, 0);
    }
  });
});

test('queued undefined render failure remains authoritative over later native free failure', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, minimapNative: true }); graph.hudWasm();
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native,
      appearancePreviewDom: Object.freeze({ __proto__: null, schema: 1, document: native.hudDom.document,
        prepare() { throw undefined; } }) }));
    let freed = 0;
    graph.wasm.api.AppearancePreview.prototype.free = function () { freed++; throw new Error('Secondary synthetic free failure'); };
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, ownedAppearancePreview: true });
    let thrown = false;
    try { graph.f.flush(); } catch (error) { thrown = true; assert.equal(error, undefined); }
    assert(thrown); assert.equal(freed, 1); assert.equal(runtime.diagnostics().disposed, true);
    assert.equal(runtime.diagnostics().captureHeld, false); assert.equal(graph.f.sockets, 0); runtime.dispose();
  });
});
