// Authored ESM/native/ABI doubles. No browser, source acquisition or real Wasm.
import test from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('default bootstrap selects authored loading without changing its existing owner choices', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    const graph=createGraph({armed:false});
    graph.sources.set('https://authored-package.invalid/game/runtime.mjs', 'export async function startGamePage(options){return options;}');
    const bootstrap=await graph.load('bootstrap.mjs');
    const options=await bootstrap.startGamePage({realm:{location:{href:'https://authored.invalid/'}},initialize(){},wasmApi:{}});
    assert.equal(options.ownedLoadingUi,true); assert.equal(options.ownedMenuUi,true);
    assert.equal(options.ownedPlayUi,true); assert.equal(options.diagnosticUi,false);
  });
});

test('static startup survives delayed initialize and hands off only after all selected owners mount', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    let release;
    const projections=[];
    const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true,prepareWasm(api){
      const project=api.menu_loading_view;
      api.menu_loading_view=function(...args){projections.push(args);return project(...args);};
    }}); graph.hudWasm();
    const profile=graph.profileNative();
    const realm=graph.nativeBoundary(native=>Object.freeze({...native,liveProfile:profile.capabilities}));
    const {startGamePage}=await graph.load('runtime.mjs');
    const pending=startGamePage({realm,initialize:()=>new Promise(resolve=>{release=resolve;}),wasmApi:graph.wasm.api,
      hudReadout:true,ownedHudUi:true,ownedPlayUi:true,ownedLoadingUi:true,diagnosticUi:false});
    const root=graph.f.document.getElementById('slither-client-root'),status=root.children[0];
    const label=status.children[0],progress=label.children[1];
    assert.equal(graph.f.edit.hud.character(label.children[0]).data,'Loading client…');
    assert.equal(progress.localName,'progress');assert.equal(label.localName,'label');
    assert.deepEqual(projections,[],'pre-Wasm text is static and never invokes uninitialized Rust');
    assert.equal(graph.wasm.calls.length,0);assert.equal(graph.f.sockets,0);
    release(); const runtime=await pending;
    assert.equal(root.children.length,5,'no new root sibling shifts owned HUD/Play indices');
    assert.equal(projections[0][0],'loading');assert.equal(projections.at(-1)[0],'ready-not-connected');assert.equal(projections.at(-1)[1],true);
    assert.equal(graph.f.edit.hud.style(status.style).get('display'),'none');
    const panel=root.children[4],endpoint=panel.children[0].children[1],nickname=panel.children[1].children[1],button=panel.children[2];
    assert.equal(endpoint.localName,'input');assert.equal(nickname.localName,'input');assert.equal(button.localName,'button');
    const inlineLabel=panel.children[3].children[0],inlineProgress=inlineLabel.children[1];
    assert.equal(graph.f.edit.hud.style(inlineProgress.style).get('display'),'none');
    graph.f.edit.inputValue(endpoint).value='ws://192.0.2.1:1234/slither';
    graph.f.edit.dispatch('click',{target:button,button:0,trusted:true});graph.f.flush();
    assert.equal(profile.counts.fetch,1);assert.equal(graph.f.edit.hud.style(inlineProgress.style).get('display'),'inline-block');
    assert.equal(graph.f.edit.hud.character(inlineLabel.children[0]).data,'Preparing connection.');
    assert.equal(graph.f.edit.hud.style(status.style).get('display'),'none','busy indicator does not revive a duplicate logo surface');
    runtime.dispose();profile.respond();await profile.settle();graph.f.flush();
    assert.equal(root.children.length,3);assert.equal(status.children.length,0,'no indeterminate child remains after cleanup');
    assert.equal(graph.f.edit.hud.style(status.style).get('display'),'');assert.equal(status.textContent,'Not connected.');
    assert.equal(graph.f.sockets,0);assert.equal(graph.f.raf.size,0);
  });
});

test('loading projection is preflighted before initialize without reading accessors', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    for(const kind of ['missing','accessor','async']){
      const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true});
      let reads=0;
      if(kind==='accessor')Object.defineProperty(graph.wasm.api,'menu_loading_view',{get(){reads++;assert.fail('Projection getter read');}});
      else graph.wasm.api.menu_loading_view=kind==='async'?graph.run('(async function(){})'):undefined;
      const {startGamePage}=await graph.load('runtime.mjs');
      await assert.rejects(startGamePage({initialize(){assert.fail('Missing owner initialized');},wasmApi:graph.wasm.api,
        hudReadout:true,ownedHudUi:true,ownedPlayUi:true,ownedLoadingUi:true,diagnosticUi:false}),/Rust loading/);
      assert.equal(reads,0);assert.equal(graph.wasm.calls.length,0);assert.equal(graph.f.sockets,0);
    }
  });
});

test('failed final owner mount keeps startup visible, removes partial construction and preserves undefined', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    for(const mode of ['throw','reentry']){
      const projection=[],removed=[];
      const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true,prepareWasm(api){
        const project=api.menu_loading_view;
        api.menu_loading_view=function(...args){projection.push(args);return project(...args);};
      }}); graph.hudWasm();
      let attached,refusal;
      graph.f.edit.hud.controls.set('appendChild',{afterHook(parent,child){
        if(parent.id!=='slither-client-root'||parent.children.length!==6)return;
        attached=child;
        const status=parent.children[0];
        assert.equal(graph.f.edit.hud.style(status.style).get('display'),'block','handoff must not precede the last selected owner');
        if(mode==='throw')throw undefined;
        try{graph.f.edit.dispatch('resize');}catch(error){refusal=error;}
      }});
      graph.f.edit.hud.controls.set('removeChild',{hook(_parent,child){removed.push(child);}});
      const {startGamePage}=await graph.load('runtime.mjs');
      let thrown=false,primary;
      try{await startGamePage({initialize(){},wasmApi:graph.wasm.api,hudReadout:true,ownedHudUi:true,ownedPlayUi:true,
        ownedLoadingUi:true,ownedEndScreenUi:true,diagnosticUi:false});}catch(error){thrown=true;primary=error;}
      assert.equal(thrown,true);assert.equal(primary,mode==='throw'?undefined:refusal);assert.ok(attached);assert.ok(removed.includes(attached));
      assert.equal(projection.some(([code,mounted])=>code==='ready-not-connected'&&mounted),false);
      const root=graph.f.document.getElementById('slither-client-root');
      assert.equal(root.children.length,3);assert.equal(root.children[0].textContent,'Play unavailable on this page.');
      assert.equal(root.children[0].children.length,0);assert.equal(graph.f.raf.size,0);assert.equal(graph.f.sockets,0);
    }
  });
});

test('pagehide during initialization retires loading and late settlement does no projection or owner work', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    let release,calls=0;
    const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true,prepareWasm(api){
      const project=api.menu_loading_view;api.menu_loading_view=function(...args){calls++;return project(...args);};
    }});
    const {startGamePage}=await graph.load('runtime.mjs');
    const pending=startGamePage({initialize:()=>new Promise(resolve=>{release=resolve;}),wasmApi:graph.wasm.api,
      hudReadout:true,ownedHudUi:true,ownedPlayUi:true,ownedLoadingUi:true,diagnosticUi:false});
    graph.f.event('pagehide'); const status=graph.f.document.getElementById('slither-client-status');
    assert.equal(status.children.length,1,'stale pagehide document is not mutated; the lease releases its references');
    const writes=graph.f.edit.hud.trace.length;
    release();const runtime=await pending;
    assert.deepEqual(Object.keys(runtime),['dispose']);assert.equal(calls,0);assert.equal(graph.wasm.calls.length,0);
    assert.equal(graph.f.edit.hud.trace.length,writes);runtime.dispose();
  });
});

test('source waiting uses the same retained startup surface until a successful ready handoff', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true});graph.hudWasm();
    const palettes=graph.f.realm.per_color_imgs;graph.f.realm.per_color_imgs=undefined;
    const {startGamePage}=await graph.load('runtime.mjs');
    const pending=startGamePage({initialize(){},wasmApi:graph.wasm.api,hudReadout:true,ownedHudUi:true,
      ownedPlayUi:true,ownedLoadingUi:true,diagnosticUi:false});
    await new Promise(resolve=>setImmediate(resolve));
    const status=graph.f.document.getElementById('slither-client-status'),label=status.children[0];
    assert.equal(graph.f.edit.hud.character(label.children[0]).data,'Preparing appearance sources…');
    assert.equal(graph.f.edit.hud.style(status.style).get('display'),'block');
    assert.equal(graph.wasm.calls.length,0);assert.equal(graph.f.sockets,0);
    graph.f.realm.per_color_imgs=palettes;graph.f.timer(50);
    const runtime=await pending;
    assert.equal(status.children[0],label,'waiting reuses the owned status subtree');
    assert.equal(graph.f.edit.hud.style(status.style).get('display'),'none');runtime.dispose();
  });
});

test('initialization rejection preserves first-thrown values through loading cleanup failures', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    for(const primary of [undefined,null,false,0,'',Symbol('init'),new Error('init')]){
      const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true});
      graph.f.edit.hud.controls.set('removeChild',{afterFailure:new Error('secondary loading cleanup')});
      const {startGamePage}=await graph.load('runtime.mjs');
      let thrown=false,value;
      try{await startGamePage({initialize(){throw primary;},wasmApi:graph.wasm.api,hudReadout:true,
        ownedHudUi:true,ownedPlayUi:true,ownedLoadingUi:true,diagnosticUi:false});}catch(error){thrown=true;value=error;}
      assert.equal(thrown,true);assert.equal(value,primary);assert.equal(graph.wasm.calls.length,0);assert.equal(graph.f.sockets,0);
      const status=graph.f.document.getElementById('slither-client-status');
      assert.equal(status.children.length,0);assert.equal(graph.f.raf.size,0);
    }
  });
});

test('pre-runtime local failure has fixed fallback text and retains the exact original rejection', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    const graph=createGraph({armed:false}),failure={private:'configuration details'};
    graph.sources.set('https://authored-package.invalid/game/runtime.mjs','export function startGamePage(){throw Error("Runtime must not start");}');
    const {startGamePage}=await graph.load('bootstrap.mjs');
    const status={textContent:'Loading client…'},realm={location:{href:'http://127.0.0.1:18884/'},
      document:{getElementById(){return status;}},async fetch(){throw failure;}};
    await assert.rejects(startGamePage({realm,initialize(){},wasmApi:{}}),error=>error===failure);
    assert.equal(status.textContent,'Client unavailable. Reload this page.');
  });
});

test('loading-enabled menu still persists and sends its chosen nickname/skin/custom bytes on explicit Play', async()=>{
  await runGameModuleTest(async({assert,createGraph})=>{
    const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true});graph.hudWasm();
    const profile=graph.profileNative(),logins=[],encode=graph.wasm.api.encode_login;
    graph.wasm.api.encode_login=(version,password,nickname,skin,custom)=>{
      logins.push({nickname,skin,custom:[...custom]});return encode(version,password,nickname,skin,custom);
    };
    const realm=graph.nativeBoundary(native=>Object.freeze({...native,liveProfile:profile.capabilities}));
    const {startGamePage}=await graph.load('runtime.mjs');
    const runtime=await startGamePage({realm,initialize(){},wasmApi:graph.wasm.api,hudReadout:true,ownedHudUi:true,
      ownedPlayUi:true,ownedMenuUi:true,ownedLoadingUi:true,diagnosticUi:false});
    const panel=graph.f.document.getElementById('slither-client-root').children[4],menu=panel.children[4];
    const text=node=>graph.f.edit.hud.character(node.children[0]).data;
    const button=label=>menu.children.find(node=>node.children.length===1&&text(node)===label);
    const click=node=>{graph.f.edit.dispatch('click',{target:node,button:0,trusted:true});graph.f.flush();};
    click(button('Next skin'));click(button('Build a skin'));click(button('Next color'));click(button('Longer stripe'));
    assert.equal(profile.counts.fetch,0);assert.equal(graph.f.sockets,0);
    graph.f.edit.inputValue(panel.children[1].children[1]).value='Chosen';
    graph.f.edit.inputValue(panel.children[0].children[1]).value='ws://192.0.2.2:1234/slither';
    click(panel.children[2]);
    const saved=realm.localStorage.getItem('slither-client.menu.v1');
    profile.respond();await profile.settle();graph.f.flush();graph.f.frame();
    assert.deepEqual(logins,[{nickname:'Chosen',skin:1,custom:[0,0,0,0,0,0,0,0,2,1]}]);
    assert.equal(realm.localStorage.getItem('slither-client.menu.v1'),saved);
    runtime.dispose();profile.assertWiped();
  });
});

test('malformed Rust loading output and partial startup append fail closed before source/session work', async () => {
  await runGameModuleTest(async ({assert,createGraph}) => {
    for(const mode of ['partial','malformed']){
      const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true});
      let attached,initialized=0;
      if(mode==='partial')graph.f.edit.hud.controls.set('appendChild',{afterHook(parent,child){
        if(parent.id==='slither-client-status'){attached=child;throw undefined;}
      }});
      else graph.wasm.api.menu_loading_view=graph.run('(function(){return Object.freeze({visible:true,busy:1,text:"bad"});})');
      const {startGamePage}=await graph.load('runtime.mjs');
      let thrown=false,primary;
      try{await startGamePage({initialize(){initialized++;},wasmApi:graph.wasm.api,hudReadout:true,ownedHudUi:true,
        ownedPlayUi:true,ownedLoadingUi:true,diagnosticUi:false});}catch(error){thrown=true;primary=error;}
      assert.equal(thrown,true);if(mode==='partial'){assert.equal(primary,undefined);assert.ok(attached);}
      assert.equal(initialized,mode==='partial'?0:1);assert.equal(graph.wasm.calls.length,0);
      assert.equal(graph.f.document.getElementById('slither-client-status').children.length,0);
      assert.equal(graph.f.sockets,0);assert.equal(graph.f.raf.size,0);
    }
  });
});
