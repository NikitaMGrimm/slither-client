// Actual runtime/menu/provider graph with explicit generated-ABI/Canvas doubles.
// These checks prove glue ordering and cleanup, not Wasm rendering or pixels.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('pending stock capture hides the preview without retiring runtime or retrying before another edit', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const mode of ['readiness', 'construction', 'missing']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, minimapNative: true }); graph.hudWasm();
      let pending = false, prepares = 0, reads = 0, random = 0, runtime;
      const profile = graph.profileNative();
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities,
        completed() { return !(pending && mode === 'construction') && native.completed(); },
        generated(source) { reads++; return !(pending && mode === 'readiness') && native.generated(source); },
        random() { random++; return 0.5; },
        appearancePreviewDom: Object.freeze({ __proto__: null, ...native.appearancePreviewDom,
          prepare(...args) { prepares++; return native.appearancePreviewDom.prepare(...args); } }) }));
      const { startGamePage } = await graph.load('runtime.mjs');
      runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, ownedAppearancePreview: true });
      const menu = graph.f.document.getElementById('slither-client-root').children.at(-1).children[4];
      const holder = menu.children.at(-1), canvas = holder.children[0], line = holder.children[1];
      const text = node => graph.f.edit.hud.character(node.children[0]).data;
      const next = menu.children.slice(3, -1).find(node => text(node) === 'Next skin');
      const click = () => { graph.f.edit.dispatch('click', { target: next, button: 0, trusted: true }); graph.f.flush(); };
      graph.f.flush(); assert.equal(prepares, 1); assert.equal(graph.f.edit.hud.style(canvas.style).get('display'), 'block');
      const priorRandom = random, priorTimers = graph.f.timers.size;
      const variants = realm.per_color_imgs[0].kmcs, source = variants[0];
      pending = true; if (mode === 'missing') variants[0] = undefined; click();
      assert.equal(runtime.diagnostics().disposed, false); assert.equal(runtime.diagnostics().captureHeld, false);
      assert.equal(prepares, 1); assert.equal(graph.f.edit.hud.style(canvas.style).get('display'), 'none');
      assert.equal(text(line), 'Synthetic unavailable'); assert.equal(graph.previewCalls.filter(row => row[0] === 'free').length, 0);
      const priorReads = reads, renders = graph.previewCalls.filter(row => row[0] === 'render').length;
      pending = false; variants[0] = source; graph.f.flush();
      assert.equal(reads, priorReads); assert.equal(graph.previewCalls.filter(row => row[0] === 'render').length, renders);
      assert.equal(graph.f.timers.size, priorTimers); assert.equal(prepares, 1);
      click(); assert.equal(prepares, 2); assert.equal(graph.f.edit.hud.style(canvas.style).get('display'), 'block');
      assert.equal(text(line), ''); assert.equal(random, priorRandom); assert.equal(profile.counts.fetch, 0); assert.equal(graph.f.sockets, 0);
      runtime.dispose(); assert.equal(graph.previewCalls.filter(row => row[0] === 'free').length, 1);
    }
  });
});

test('unrelated begin and render failures cannot impersonate a pending capture', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const seam of ['begin', 'render']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, minimapNative: true }); graph.hudWasm();
      let armed = false, statusReads = 0;
      const primary = Object.defineProperty({}, 'status', { get() { statusReads++; return 'pending'; } });
      const free = graph.wasm.api.AppearancePreview.prototype.free;
      graph.wasm.api.AppearancePreview.prototype.free = function () { free.call(this); throw new Error('Secondary free failure'); };
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native,
        generated(source) { if (armed && seam === 'begin') throw primary; return native.generated(source); },
        appearancePreviewDom: Object.freeze({ __proto__: null, ...native.appearancePreviewDom,
          prepare(...args) { if (armed && seam === 'render') throw primary; return native.appearancePreviewDom.prepare(...args); } }) }));
      const { startGamePage } = await graph.load('runtime.mjs');
      const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true, ownedAppearancePreview: true });
      armed = true;
      assert.throws(() => graph.f.flush(), error => error === primary);
      assert.equal(statusReads, 1, 'only the existing terminal classifier observes status'); assert.equal(runtime.diagnostics().disposed, true);
      assert.equal(runtime.diagnostics().captureHeld, false); assert.equal(graph.previewCalls.filter(row => row[0] === 'free').length, 1);
      assert.equal(graph.f.sockets, 0); runtime.dispose();
    }
  });
});

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

test('local pattern controls restore reload preview and explicit Play retain full IDs without implicit connection', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    async function launch(saved){
      const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true,minimapNative:true});graph.hudWasm();
      if(saved!==undefined)graph.f.realm.localStorage.setItem('slither-client.menu.v1',saved);
      // Routing-only ABI capability DOUBLE; numeric pattern rendering is verified separately.
      graph.wasm.api.resolve_local_skin=function(){throw Error('No numeric resolver execution in this routing-only test');};
      const logins=[],recipes=[],encode=graph.wasm.api.encode_login;
      graph.wasm.api.encode_login=(version,password,nickname,skin,custom)=>{logins.push({nickname,skin,custom:[...custom]});return encode(version,password,nickname,skin,custom);};
      const realm={...graph.f.realm,location:{href:'http://127.0.0.1:18884/'}};realm.top=realm;
      const gate=graph.f.gate,metadata=gate.metadata(),endpoint='ws://127.0.0.1:19400/slither';
      const localHost={endpoint,profile:{clientVersion:1,password:new Uint8Array(20),protocolVersion:19},
        bindSkinPolicy(){},isCurrentDocument:()=>true,dispose(){},
        presetEndpoint(node){graph.f.edit.inputValue(node).value=endpoint;},
        gate:{metadata:()=>metadata,claim:()=>gate.claim(metadata.id)},
        sources:{palettes:[graph.f.canvas(),graph.f.canvas(),graph.f.canvas()],background:new graph.f.realm.HTMLImageElement(),
          adapter:{beginOperation(){return{};},endOperation(){},resolveAppearance(){},resolveAntennaRandom(){},
            resolveRecipe(request){recipes.push({skin:request.skin,custom:[...request.customBytes],own:request.own});return{status:'ready'};}},
          hostAssets:{resolveFood(){},resolvePrey(){}}}};
      const {startGamePage}=await graph.load('runtime.mjs');
      const runtime=await startGamePage({realm,localHost,initialize(){},wasmApi:graph.wasm.api,hudReadout:true,
        ownedHudUi:true,ownedPlayUi:true,ownedMenuUi:true,ownedAppearancePreview:true});
      const panel=graph.f.document.getElementById('slither-client-root').children.at(-1),menu=panel.children[4];
      const text=node=>graph.f.edit.hud.character(node.children[0]).data;
      const click=label=>{const button=menu.children.slice(3,-1).find(node=>text(node)===label);assert.ok(button,label);
        graph.f.edit.dispatch('click',{target:button,button:0,trusted:true});graph.f.flush();};
      graph.f.flush();
      return{graph,runtime,logins,recipes,panel,menu,text,click};
    }
    for(const seed of[undefined,'1:5361766564:41:','1:5361766564:09:','1:5361766564:0a:','1:5361766564:0f:','1:5361766564:1d:',
      '1:5361766564:00:','1:5361766564:01:','1:5361766564:02:',
      '1:5361766564:19:','1:5361766564:2c:','1:5361766564:3f:','1:5361766564:40:']){
      const f=await launch(seed);
      try{
        let id=seed?Number.parseInt(seed.split(':')[2],16):0;
        assert.equal(f.recipes.at(-1).skin,id);assert.equal(f.recipes.at(-1).own,false);
        if(seed)assert.equal(f.graph.f.realm.localStorage.getItem('slither-client.menu.v1'),seed);
        if(id===0){f.click('Previous skin');id=65;assert.equal(f.recipes.at(-1).skin,65);
          f.click('Next skin');id=0;assert.equal(f.recipes.at(-1).skin,0);}
        const finalSkin = [25,44,63,64].includes(id) ? id : 65;
        for(const chosen of[9,10,15,29,65,finalSkin]){
          while(id!==chosen){f.click('Next skin');id=(id+1)%66;}
          assert.equal(f.recipes.at(-1).skin,chosen);assert.equal(f.text(f.menu.children[1]),`Skin ${chosen+1} of 66`);
          assert.equal(f.graph.f.sockets,0);assert.deepEqual(f.logins,[]);
        }
        f.click('Build a skin');f.click('Next color');f.click('Longer stripe');f.click('Add stripe');
        const expected=[0,0,0,0,0,0,0,0,2,1,1,1];assert.deepEqual(f.recipes.at(-1),{skin:finalSkin,custom:expected,own:false});
        const saved=f.graph.f.realm.localStorage.getItem('slither-client.menu.v1');
        assert.equal(saved.split(':')[2],finalSkin.toString(16).padStart(2,'0'));assert.equal(f.graph.f.sockets,0);assert.deepEqual(f.logins,[]);
        const reload=await launch(saved);
        try{
          assert.deepEqual(reload.recipes.at(-1),{skin:finalSkin,custom:expected,own:false});
          assert.equal(reload.graph.f.sockets,0);assert.deepEqual(reload.logins,[]);
          reload.graph.f.edit.dispatch('click',{target:reload.panel.children[2],button:0,trusted:true});reload.graph.f.flush();
          assert.deepEqual(reload.logins,[{nickname:seed?'Saved':'',skin:finalSkin,custom:expected}]);
          assert.equal(reload.graph.f.sockets,0,'the existing native frame commit still precedes construction');
          reload.graph.f.frame(8);reload.graph.f.flush();assert.equal(reload.graph.f.sockets,1);
          assert.equal(reload.logins.length,1);reload.runtime.dispose();reload.graph.f.flush();assert.equal(reload.graph.f.sockets,1,'no reconnect');
        }finally{reload.runtime.dispose();}
      }finally{f.runtime.dispose();}
    }
  });
});
