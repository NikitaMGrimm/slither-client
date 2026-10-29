// Actual runtime/provider graph; selected snapshots and generated ABI are authored doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

// The wrapper reexports the real module's identity predicate, retaining its WeakSet.
const wrapper = `
import {createStockSkinAdapter as createActual,isUnsupportedStockAccessoryFace} from './stock-skin-provider-real.mjs';
export {isUnsupportedStockAccessoryFace} from './stock-skin-provider-real.mjs';
export const testState={selected:true,begins:0,ends:0,resolves:0,hasPrimary:false};
export function createStockSkinAdapter(options){
  const read=options.readSnapshot;
  const adapter=createActual({...options,appearanceMode:'accessory',readSnapshot(){
    const raw=read(); if(!testState.selected)return raw;
    const source=raw.host.per_color_imgs[0].kmcs[0];
    return {...raw,ownAccessory:71,ownAccessorySelection:{id:71,
      geometry:{forward:5,imageScale:.25,pivotX:3,pivotY:7},source,width:source.width,height:source.height}};
  }});
  return Object.freeze({...adapter,beginOperation(){testState.begins++;return adapter.beginOperation();},
    resolveRecipe(request){testState.resolves++;if(testState.hasPrimary)throw testState.primary;
      try{return adapter.resolveRecipe(request);}catch(error){testState.onFailure?.(error);throw error;}},
    endOperation(){testState.ends++;const value=adapter.endOperation();if(testState.hasRelease)throw testState.release;return value;}});
}
`;

function scenario(body, { selected = true, skin = 26 } = {}) {
  // Only compose test code; production module bytes remain whole and unchanged.
  return new Function(`return async function({assert,createGraph}){
    const graph=createGraph({hudNative:true,ownedHudNative:true,ownedPlayNative:true,minimapNative:true});graph.hudWasm();
    const url='https://authored-package.invalid/game/stock-skin-provider.mjs';
    graph.sources.set('https://authored-package.invalid/game/stock-skin-provider-real.mjs',graph.sources.get(url));
    graph.sources.set(url,${JSON.stringify(wrapper)});
    graph.f.realm.localStorage.setItem('slither-client.menu.v1','1::${skin.toString(16).padStart(2, '0')}:');
    const {testState}=await graph.load('stock-skin-provider.mjs');
    testState.selected=${selected};
    const free=graph.wasm.api.AppearancePreview.prototype.free;
    graph.wasm.api.AppearancePreview.prototype.free=function(){free.call(this);if(testState.failCleanup)throw Error('secondary free');};
    const profile=graph.profileNative();
    const realm=graph.nativeBoundary(native=>Object.freeze({...native,liveProfile:profile.capabilities}));
    const {startGamePage}=await graph.load('runtime.mjs');
    const runtime=await startGamePage({realm,initialize(){},wasmApi:graph.wasm.api,hudReadout:true,ownedHudUi:true,
      ownedPlayUi:true,ownedMenuUi:true,ownedAppearancePreview:true});
    const root=graph.f.document.getElementById('slither-client-root'),panel=root.children[4],menu=panel.children[4];
    const holder=menu.children.at(-1),canvas=holder.children[0];
    const text=node=>graph.f.edit.hud.character(node.children[0]).data;
    const click=label=>{const node=menu.children.slice(3,-1).find(node=>text(node)===label);
      graph.f.edit.dispatch('click',{target:node,button:0,trusted:true});graph.f.flush();};
    ${body}
  }`)();
}

test('selected SingleImage hides old preview without disposal or retry and custom remains eligible', async () => {
  await runGameModuleTest(scenario(`
    graph.f.flush();assert.equal(graph.f.edit.hud.style(canvas.style).get('display'),'block');
    assert.equal(graph.previewCalls.find(row=>row[0]==='select')[1],26);
    const before=testState.resolves,random=graph.wasm.calls.filter(row=>row==='random').length;
    click('Next skin');
    assert.equal(graph.previewCalls.filter(row=>row[0]==='select').at(-1)[1],27);
    assert.equal(testState.resolves,before+1);assert.equal(testState.begins,testState.ends);
    assert.equal(runtime.diagnostics().disposed,false);assert.equal(runtime.diagnostics().captureHeld,false);
    assert.equal(graph.f.edit.hud.style(canvas.style).get('display'),'none');
    assert.equal(text(holder.children[1]),'Synthetic unavailable');
    const resolves=testState.resolves;graph.f.flush();assert.equal(testState.resolves,resolves,'no automatic retry');
    click('Build a skin');assert.equal(graph.f.edit.hud.style(canvas.style).get('display'),'block');
    assert.equal(runtime.diagnostics().disposed,false);assert.equal(runtime.diagnostics().captureHeld,false);
    assert.equal(graph.wasm.calls.filter(row=>row==='random').length,random);
    assert.equal(testState.begins,testState.ends);assert.equal(graph.f.sockets,0);runtime.dispose();
  `));
});

test('a separate no-selection stock owner still renders SingleImage with current-own context', async () => {
  await runGameModuleTest(scenario(`
    graph.f.flush();const last=graph.previewCalls.filter(row=>row[0]==='select').at(-1);
    assert.equal(last[1],27);assert.equal(last[2].length,0);
    assert.equal(graph.f.edit.hud.style(canvas.style).get('display'),'block');
    assert.equal(runtime.diagnostics().disposed,false);assert.equal(runtime.diagnostics().captureHeld,false);
    assert.equal(testState.begins,testState.ends);assert.equal(testState.resolves,1);runtime.dispose();
  `, { selected: false, skin: 27 }));
});

test('forged or unrelated resolver failures including falsy values remain terminal before secondary release errors', async () => {
  for (const value of ['undefined', 'null', 'false', '0', "''", "Object.assign(new TypeError('Selected stock accessory unsupported for this face family'),{status:'unsupported'})",
    "{get status(){throw Error('status getter must not run');}}" ]) {
    await runGameModuleTest(scenario(`
      graph.f.flush();const primary=${value};testState.hasPrimary=true;testState.primary=primary;
      testState.failCleanup=true;
      testState.hasRelease=true;testState.release=Error('secondary release');
      let failed=false;try{click('Next skin');}catch(error){failed=true;assert.equal(error,primary);}
      assert(failed);assert.equal(runtime.diagnostics().disposed,true);assert.equal(runtime.diagnostics().captureHeld,false);
      assert.equal(testState.begins,testState.ends);assert.equal(graph.f.sockets,0);runtime.dispose();
    `));
  }
});

test('converted unsupported does not hide release or post-resolve operation-check failures', async () => {
  await runGameModuleTest(scenario(`
    graph.f.flush();testState.hasRelease=true;testState.release=undefined;testState.failCleanup=true;
    let failed=false;try{click('Next skin');}catch(error){failed=true;assert.equal(error,undefined);}
    assert(failed);assert.equal(runtime.diagnostics().disposed,true);assert.equal(testState.begins,testState.ends);
    assert.equal(runtime.diagnostics().captureHeld,false);runtime.dispose();
  `));
  await runGameModuleTest(scenario(`
    graph.f.flush();let poison;
    testState.failCleanup=true;
    testState.onFailure=()=>{try{runtime.dispose();}catch(error){poison=error;}};
    testState.hasRelease=true;testState.release=Error('secondary release');
    let failed=false;try{click('Next skin');}catch(error){failed=true;assert.equal(error,poison);}
    assert(failed);assert(poison);assert.equal(runtime.diagnostics().disposed,true);
    assert.equal(runtime.diagnostics().captureHeld,false);assert.equal(testState.begins,testState.ends);runtime.dispose();
  `));
});
