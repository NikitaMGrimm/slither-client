// Authored ESM/native-operation and generated-ABI doubles, not native browser evidence.
import test from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('owned native menu edits copied selection and persists without implicit Play; admitted request locks it', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    const profile = graph.profileNative(), login = [];
    const encode = graph.wasm.api.encode_login;
    graph.wasm.api.encode_login = (version, password, nickname, skin, customSkin) => {
      login.push({ nickname, skin, custom: [...customSkin] }); return encode(version, password, nickname, skin, customSkin);
    };
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, diagnosticUi: false });
    const panel = graph.f.document.getElementById('slither-client-root').children.at(-1);
    const menu = panel.children[4], nickname = panel.children[1].children[1], endpoint = panel.children[0].children[1];
    const text = node => graph.f.edit.hud.character(node.children[0]).data;
    const button = label => menu.children.find(node => node.children.length === 1 && text(node) === label);
    const click = (node, trusted = true) => { graph.f.edit.dispatch('click', { target: node, button: 0, trusted }); graph.f.flush(); };
    assert.equal(text(menu.children[1]), 'Skin 1 of 66');
    const reads = graph.wasm.controlReads();
    click(button('Next skin'), false); assert.equal(text(menu.children[1]), 'Skin 1 of 66');
    click(button('Next skin')); assert.equal(text(menu.children[1]), 'Skin 2 of 66');
    click(button('Build a skin')); click(button('Next color')); click(button('Longer stripe')); click(button('Add stripe'));
    assert.equal(text(menu.children[1]), 'Custom skin');
    graph.f.edit.inputValue(nickname).value = 'Saved\u0080Name';
    graph.f.edit.dispatch('input', { target: nickname });
    assert.equal(graph.f.edit.inputValue(nickname).value, 'Saved Name');
    const saved = graph.f.realm.localStorage.getItem('slither-client.menu.v1');
    assert.match(saved, /^1:/); assert.equal(profile.counts.fetch, 0); assert.equal(graph.f.sockets, 0);
    assert.equal(graph.wasm.controlReads(), reads, 'menu clicks do not become gameplay observations');
    graph.f.edit.inputValue(endpoint).value = 'ws://192.0.2.3:1234/slither';
    click(panel.children[2]); assert.equal(profile.counts.fetch, 1);
    assert.ok(menu.children.slice(3).every(node => graph.f.edit.ownedPlay.buttonState(node).disabled));
    const lockedSaved = graph.f.realm.localStorage.getItem('slither-client.menu.v1');
    click(button('Next skin')); assert.equal(graph.f.realm.localStorage.getItem('slither-client.menu.v1'), lockedSaved);
    profile.respond(); await profile.settle(); graph.f.flush(); graph.f.frame();
    assert.deepEqual(login, [{ nickname: 'Saved Name', skin: 1, custom: [0, 0, 0, 0, 0, 0, 0, 0, 2, 1, 1, 1] }]);
    runtime.dispose(); profile.assertWiped();
  });
});

test('reload restoration populates nickname/appearance only, never endpoint, profile or a session', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const saved of ['1:52656c6f6164:18:00000000000000000225', 'invalid', 'x'.repeat(601), 'read-error']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      graph.f.realm.localStorage.setItem('slither-client.menu.v1', saved);
      if (saved === 'read-error') {
        const map = graph.f.realm.localStorage.values;
        map.get = key => { if (key === 'slither-client.menu.v1') throw Error('synthetic storage permission'); return Map.prototype.get.call(map, key); };
      }
      const { startGamePage } = await graph.load('runtime.mjs');
      const runtime = await startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true });
      const panel = graph.f.document.getElementById('slither-client-root').children.at(-1);
      assert.equal(graph.f.edit.inputValue(panel.children[0].children[1]).value, '');
      assert.equal(graph.f.edit.inputValue(panel.children[1].children[1]).value, saved.startsWith('1:') ? 'Reload' : '');
      assert.equal(graph.f.sockets, 0); assert.equal(runtime.diagnostics().gameplay.profilePhase, 'unavailable');
      assert.equal(Map.prototype.get.call(graph.f.realm.localStorage.values, 'slither-client.menu.v1'), saved, 'startup never rewrites preferences');
      runtime.dispose();
    }
  });
});

test('menu uses captured storage methods, bounds reads, and tolerates unavailable writes', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    const profile = graph.profileNative();
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true });
    const panel = graph.f.document.getElementById('slither-client-root').children.at(-1), menu = panel.children[4];
    const next = menu.children[4];
    graph.f.realm.Storage.prototype.setItem = () => { throw Error('late mutable method'); };
    graph.f.edit.dispatch('click', { target: next, button: 0, trusted: true }); graph.f.flush();
    assert.match(graph.f.realm.localStorage.values.get('slither-client.menu.v1'), /^1::01:/);
    graph.f.realm.localStorage.values.set = () => { throw Error('synthetic quota'); };
    graph.f.edit.dispatch('click', { target: next, button: 0, trusted: true }); graph.f.flush();
    assert.equal(graph.f.edit.hud.character(menu.children[1].children[0]).data, 'Skin 3 of 66');
    assert.equal(profile.counts.fetch, 0); assert.equal(graph.f.sockets, 0);
    graph.f.edit.inputValue(panel.children[0].children[1]).value = 'ws://192.0.2.3:1234/slither';
    graph.f.edit.dispatch('click', { target: panel.children[2], button: 0, trusted: true }); graph.f.flush();
    assert.equal(profile.counts.fetch, 1, 'quota failure cannot block an otherwise admitted Play');
    runtime.dispose();
  });
});

test('menu press suppression preserves held Space and pointer release cleanup', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    const profile = graph.profileNative();
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true });
    const root = graph.f.document.getElementById('slither-client-root'), next = root.children.at(-1).children[4].children[4];
    const snapshot = () => runtime.diagnostics().gameplay.input;
    graph.f.edit.dispatch('keydown', { target: root, key: ' ', code: 'Space' });
    assert.equal(snapshot().boostKeyHeld, true);
    graph.f.edit.dispatch('keyup', { target: next, key: ' ', code: 'Space' });
    assert.equal(snapshot().boostKeyHeld, false);
    graph.f.edit.dispatch('keydown', { target: next, key: ' ', code: 'Space' });
    assert.equal(snapshot().boostKeyHeld, false, 'menu activation cannot re-press game boost');
    graph.f.edit.dispatch('keydown', { target: root, key: 'ArrowLeft', code: 'ArrowLeft' });
    assert.equal(snapshot().leftHeld, true);
    graph.f.edit.dispatch('keyup', { target: next, key: 'ArrowLeft', code: 'ArrowLeft' });
    assert.equal(snapshot().leftHeld, false);
    const before = graph.wasm.controlReads();
    graph.f.edit.dispatch('mousedown', { target: next, button: 0 });
    assert.equal(graph.wasm.controlReads(), before);
    graph.f.edit.dispatch('mouseup', { target: next, button: 0 });
    assert.equal(graph.wasm.controlReads(), before + 1, 'pointer release still reaches the existing input owner');
    runtime.dispose();
  });
});

test('caught menu render and storage callback reentry poisons the operation before Play or persistence', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const seam of ['render', 'storage']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const profile = graph.profileNative();
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
      const { startGamePage } = await graph.load('runtime.mjs');
      const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true });
      const next = graph.f.document.getElementById('slither-client-root').children.at(-1).children[4].children[4];
      let rejected = 0;
      const reenter = () => { try { runtime.dispose(); } catch { rejected++; } };
      if (seam === 'render') graph.f.edit.ownedPlay.controls.set('buttonDisabled', { hook: reenter });
      else graph.f.realm.localStorage.values.set = () => { reenter(); throw Error('synthetic quota'); };
      graph.f.edit.dispatch('click', { target: next, button: 0, trusted: true }); graph.f.flush();
      assert.ok(rejected > 0); assert.equal(runtime.diagnostics().disposed, true);
      assert.equal(graph.f.realm.localStorage.getItem('slither-client.menu.v1'), null);
      assert.equal(profile.counts.fetch, 0); assert.equal(graph.f.sockets, 0); runtime.dispose();
    }
  });
});

test('stale menu topology cancels queued actions and native keyboard defaults remain bounded', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    const profile = graph.profileNative();
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true });
    const panel = graph.f.document.getElementById('slither-client-root').children.at(-1), menu = panel.children[4], next = menu.children[4];
    graph.f.edit.state(graph.f.document).active = next;
    for (const [key, code] of [[' ', 'Space'], ['Enter', 'Enter'], ['Tab', 'Tab']]) {
      const event = graph.f.edit.dispatch('keydown', { target: next, key, code });
      assert.equal(graph.f.edit.eventData.get(event).prevented, false);
    }
    const modified = graph.f.edit.dispatch('keydown', { target: next, key: ' ', code: 'Space', ctrlKey: true });
    assert.equal(graph.f.edit.eventData.get(modified).prevented, true);
    graph.f.edit.dispatch('click', { target: next, button: 0, trusted: true });
    graph.f.edit.Node.prototype.removeChild.call(menu, next); graph.f.flush();
    assert.equal(graph.f.realm.localStorage.getItem('slither-client.menu.v1'), null);
    assert.equal(profile.counts.fetch, 0); assert.equal(graph.f.sockets, 0); runtime.dispose();
  });
});

test('menu disposal attempts Rust release without replacing a prior native failure, including undefined', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    let frees = 0;
    graph.wasm.api.MenuPreferences.prototype.free = function () { frees++; throw Error('secondary synthetic Rust release failure'); };
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true });
    graph.f.edit.hud.controls.set('removeChild', { afterFailure: undefined });
    let present = false, primary;
    try { runtime.dispose(); } catch (error) { present = true; primary = error; }
    assert.equal(present, true); assert.equal(primary, undefined); assert.equal(frees, 1);
    assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.f.raf.size, 0);
    runtime.dispose(); assert.equal(frees, 1);
  });
});
// Explicit tools-only MenuPreferences ABI double; not native Rust execution.
import assert from 'node:assert/strict';
import {createMenuPreferencesDouble} from './menu-preferences-double.mjs';

test('local pattern menu exposes all represented IDs and keeps custom restore atomic', () => {
  const Policy=createMenuPreferencesDouble(), p=new Policy(true,'');
  p.action('previous-skin');assert.equal(p.view().skin,65,'0 wraps to represented boundary65');
  p.action('next-skin');assert.equal(p.view().skin,0,'65 wraps to0');
  for(let id=0;id<66;id++){
    assert.equal(p.view().skin,id);assert.equal(p.view().title,`Skin ${id+1} of 66`);
    const saved=p.serialize(), restored=new Policy(true,saved);
    assert.equal(restored.view().skin,id);assert.equal(restored.serialize(),saved);restored.free();p.action('next-skin');
  }
  assert.equal(p.view().skin,0);
  for(const id of[0,1,2,9,10,15,29,65]){
    const saved=`1:5361766564:${id.toString(16).padStart(2,'0')}:`;
    const restored=new Policy(true,saved);assert.equal(restored.view().skin,id);assert.equal(restored.view().nickname,'Saved');
    assert.equal(restored.serialize(),saved);restored.free();
  }
  const bytes=Uint8Array.of(0,0,0,0,0,0,0,0,2,0,3,1,4,2);p.select(65,bytes);bytes[8]=0;
  assert.equal(p.view().customSkin[8],2);const copy=p.view().customSkin;copy[9]=2;assert.equal(p.view().customSkin[9],0);
  const prior=p.serialize();
  for(const [skin,custom]of[[66,new Uint8Array()],[255,new Uint8Array()],[65,Uint8Array.of(0,0,0,0,0,0,0,0,1,3)],
    [65,Uint8Array.of(0,0,0,0,0,0,0,0,0,0)]]){assert.throws(()=>p.select(skin,custom));assert.equal(p.serialize(),prior);}
  for(const saved of['1:5361766564:42:','1:5361766564:ff:','1:5361766564:41:00000000000000000103',
    '1:5361766564:41:00000000000000000000','2:5361766564:41:']){
    const restored=new Policy(true,saved);assert.equal(restored.serialize(),'1::00:');restored.free();
  }
  const stock=new Policy(false,'1:5361766564:41:00000000000000000103');
  assert.equal(stock.view().skin,65);assert.equal(stock.view().customSkin[9],3);stock.free();p.free();
});
