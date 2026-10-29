// Authored runtime/DOM/capability requirements. Normal Node uses an explicit ABI double.
import test from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('selected Play requires captured own-data synchronous Rust methods before initialization', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const name of ['PlayAdmission', 'available', 'accepted', 'nickname_valid', 'accept', 'lock_unavailable', 'return_ready', 'complete_return', 'free']) {
      for (const kind of ['missing', 'accessor', 'async']) {
        const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true });
        let reads = 0;
        const target = name === 'PlayAdmission' ? graph.wasm.api : graph.wasm.api.PlayAdmission.prototype;
        const original = Object.getOwnPropertyDescriptor(target, name);
        if (kind === 'accessor') Object.defineProperty(target, name, { configurable: true, get() { reads++; assert.fail('Policy accessor invoked'); } });
        else Object.defineProperty(target, name, { configurable: true, value: kind === 'missing' ? undefined : graph.run('(async function(){})') });
        const { startGamePage } = await graph.load('runtime.mjs');
        try {
          await assert.rejects(startGamePage({ initialize() { assert.fail('Initialized without a complete Play owner'); },
            wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true }), /Rust Play/);
          assert.equal(reads, 0); assert.equal(graph.f.sockets, 0); assert.equal(graph.wasm.calls.length, 0);
        } finally {
          // In the optional real-Wasm phase each graph shares the imported generated prototype.
          // Restore this test mutation before constructing the next graph.
          if (name !== 'PlayAdmission') Object.defineProperty(target, name, original);
        }
      }
    }
  });
});

test('Rust acceptance precedes lock/status and captured methods survive late replacement', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const calls = [], owners = [];
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true,
      prepareWasm(api, run) {
        const Base = api.PlayAdmission;
        api.PlayAdmission = run('(capture => class PlayAdmission { constructor(...args) { return capture(...args); } })')((...args) => {
          const owner = new Base(...args); owners.push(owner); return owner;
        });
        Object.defineProperties(api.PlayAdmission.prototype, Object.getOwnPropertyDescriptors(Base.prototype));
        const accept = Base.prototype.accept;
        Object.defineProperty(api.PlayAdmission.prototype, 'accept', { value() {
          const accepted = Reflect.apply(accept, this, []); calls.push(['accept', accepted]); return accepted;
        } });
        const free = Base.prototype.free;
        Object.defineProperty(api.PlayAdmission.prototype, 'free', { value() {
          calls.push(['free', this.accepted()]); return Reflect.apply(free, this, []);
        } });
      } });
    graph.hudWasm();
    const profile = graph.profileNative();
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
    const owner = owners[0];
    const panel = graph.f.document.getElementById('slither-client-root').children.at(-1), button = panel.children[2];
    graph.f.edit.inputValue(panel.children[0].children[1]).value = 'ws://192.0.2.1:1234/slither';
    graph.f.edit.inputValue(panel.children[1].children[1]).value = ' \u007f ';
    for (const name of ['accept', 'accepted', 'available', 'nickname_valid']) {
      Object.defineProperty(graph.wasm.api.PlayAdmission.prototype, name, { value() { assert.fail('Late policy method lookup'); }, configurable: true });
    }
    graph.f.edit.ownedPlay.controls.set('buttonDisabled', { hook(node, disabled) {
      if (node === button && disabled) { assert.equal(owner.accepted(), true); calls.push(['lock']); }
    } });
    graph.f.edit.hud.controls.set('setText', { hook(node, text) {
      if (text === 'Preparing connection.') { assert.equal(owner.accepted(), true); assert.equal(profile.counts.fetch, 0); calls.push(['preparing']); }
    } });
    const click = () => { graph.f.edit.dispatch('click', { target: button, button: 0, trusted: true }); graph.f.flush(); };
    click(); click();
    assert.deepEqual(calls, [['accept', true], ['lock'], ['preparing']]);
    assert.equal(profile.counts.fetch, 1); assert.equal(graph.f.sockets, 0);
    profile.reject(undefined); await profile.settle(); graph.f.flush();
    assert.deepEqual(calls.at(-1), ['free', true], 'terminal failure releases an owner with its attempt still consumed');
    click(); assert.equal(profile.counts.fetch, 1);
    runtime.dispose(); profile.respond(); await profile.settle(); graph.f.flush();
    assert.equal(graph.f.sockets, 0);
  });
});

test('local unlock commits Rust return only after native success, including falsy failures and caught reentry', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const failure of ['none', 'undefined', 'reentry']) {
      const owners = [], commits = [];
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true,
        prepareWasm(api, run) {
          api.resolve_local_skin = run('(function(){})');
          const Base = api.PlayAdmission;
          api.PlayAdmission = run('(capture => class { constructor(...args) { return capture(...args); } })')((...args) => {
            const owner = new Base(...args); owners.push(owner); return owner;
          });
          Object.defineProperties(api.PlayAdmission.prototype, Object.getOwnPropertyDescriptors(Base.prototype));
          const complete = Base.prototype.complete_return;
          Object.defineProperty(api.PlayAdmission.prototype, 'complete_return', { value() {
            commits.push('return'); return Reflect.apply(complete, this, []);
          } });
        } });
      graph.hudWasm();
      graph.sources.set('https://authored-package.invalid/game/stock-gameplay.mjs', `
        import { createHudState } from './stock-hud-state.mjs';
        export let seam;
        export function createStockGameplay(options) {
          const hud = createHudState(Symbol('Authored return seam'), options.wasm.HudHistory);
          let phase = 'ready', playing = false;
          seam = { requests: [], returned() { phase='disconnected'; playing=false; options.onStatus('disconnected'); options.defer(()=>{}); } };
          return { hudSnapshot:()=>hud, diagnostics:()=>({session:{phase,playing}}),
            play(request) { seam.requests.push(request); phase='opening'; }, frame(){}, event(){}, dispose(){} };
        }`);
      const realm = { ...graph.f.realm, location: { href: 'http://127.0.0.1:18884/' } }; realm.top = realm;
      const gate = graph.f.gate, metadata = gate.metadata(), endpoint = 'ws://127.0.0.1:19400/slither';
      const localHost = { endpoint, profile: {}, bindSkinPolicy() {}, isCurrentDocument:()=>true, dispose(){},
        presetEndpoint(node) { graph.f.edit.inputValue(node).value=endpoint; },
        gate: { metadata:()=>metadata, claim:()=>gate.claim(metadata.id) },
        sources: { palettes:[graph.f.canvas(),graph.f.canvas(),graph.f.canvas()], background:new graph.f.realm.HTMLImageElement(),
          adapter:{beginOperation(){},endOperation(){},resolveAppearance(){},resolveRecipe(){},resolveAntennaRandom(){}},
          hostAssets:{resolveFood(){},resolvePrey(){}} } };
      const { startGamePage } = await graph.load('runtime.mjs');
      const runtime = await startGamePage({ realm, localHost, initialize(){}, wasmApi:graph.wasm.api,
        hudReadout:true, ownedHudUi:true, ownedPlayUi:true });
      const panel = graph.f.document.getElementById('slither-client-root').children.at(-1), button=panel.children[2];
      const click=()=>{graph.f.edit.dispatch('click',{target:button,button:0,trusted:true});graph.f.flush();};
      const seam=(await graph.load('stock-gameplay.mjs')).seam, owner=owners[0];
      click(); assert.equal(owner.accepted(),true); assert.equal(seam.requests.length,1);
      let caught=0;
      graph.f.edit.ownedPlay.controls.set('buttonDisabled', { hook(node, disabled) {
        if (node===button && disabled===false) {
          assert.equal(owner.accepted(),true); assert.equal(commits.length,0);
          if (failure==='undefined') throw undefined;
          if (failure==='reentry') { try { runtime.dispose(); } catch { caught++; } }
        }
      } });
      seam.returned(); graph.f.flush();
      if (failure==='none') {
        assert.deepEqual(commits,['return']); assert.equal(owner.accepted(),false);
        assert.equal(seam.requests.length,1,'return has no implicit launch');
        click(); assert.equal(seam.requests.length,2); assert.equal(owner.accepted(),true);
      } else {
        assert.deepEqual(commits,[]); assert.equal(runtime.diagnostics().disposed,true);
        assert.equal(caught,failure==='reentry'?1:0); assert.equal(seam.requests.length,1);
      }
      runtime.dispose();
    }
  });
});

test('Play owner is released once after native cleanup, preserving an earlier undefined throw', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    let frees = 0;
    const graph = createGraph({ hudNative:true, ownedHudNative:true, ownedPlayNative:true,
      prepareWasm(api, run) {
        const Base = api.PlayAdmission;
        api.PlayAdmission = run('(Base => class { constructor(...args) { return new Base(...args); } })')(Base);
        Object.defineProperties(api.PlayAdmission.prototype, Object.getOwnPropertyDescriptors(Base.prototype));
        const release = Base.prototype.free;
        Object.defineProperty(api.PlayAdmission.prototype, 'free', { value() {
          frees++; Reflect.apply(release, this, []); throw Error('Secondary synthetic owner-release failure');
        } });
      } });
    graph.hudWasm();
    const { startGamePage } = await graph.load('runtime.mjs');
    const runtime = await startGamePage({ initialize(){}, wasmApi:graph.wasm.api,
      hudReadout:true, ownedHudUi:true, ownedPlayUi:true });
    graph.f.edit.hud.controls.set('removeChild',{afterFailure:undefined});
    let thrown=false, primary;
    try { runtime.dispose(); } catch (error) { thrown=true; primary=error; }
    assert.equal(thrown,true); assert.equal(primary,undefined); assert.equal(frees,1);
    runtime.dispose(); assert.equal(frees,1); assert.equal(graph.f.raf.size,0); assert.equal(graph.f.sockets,0);
  });
});
