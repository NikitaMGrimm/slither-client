// Authored native-operation doubles; no native browser, renderer or generated Wasm.
import test from 'node:test';
import {runGameModuleTest} from './game-module-test-fixture.mjs';

test('passive native progress is implicitly labelled, indeterminate and consumes no control/scheduler capability', async()=>{
  await runGameModuleTest(async({assert,createGraph})=>{
    const graph=createGraph({hudNative:true,ownedHudNative:true}),f=graph.f;
    const metadata=f.gate.metadata(),native=f.gate.claim(metadata.id);
    const parent=f.document.createElement('div');f.document.body.appendChild(parent);
    const {createOwnedLoadingUi}=await graph.load('game-owned-loading-ui.mjs');
    const lease=createOwnedLoadingUi({document:f.document,parent,dom:native.hudDom.dom,
      construct:native.ownedHudDom.dom,isCurrentDocument:native.hudDom.isCurrentDocument});
    const label=lease.mount(),progress=label.children[1],text=label.children[0];
    assert.equal(label.localName,'label');assert.equal(progress.localName,'progress');
    for(const name of ['value','max','setAttribute','innerHTML','textContent','appendChild']){
      Object.defineProperty(progress,name,{get(){assert.fail('Uncaptured progress read');},set(){assert.fail('Uncaptured progress write');}});
    }
    lease.render(graph.run('({visible:true,busy:true,text:"Loading client…"})'));
    assert.equal(f.edit.hud.character(text).data,'Loading client…');
    assert.equal(f.edit.hud.style(progress.style).get('display'),'inline-block');
    lease.render(graph.run('({visible:true,busy:false,text:"Client unavailable."})'));
    assert.equal(f.edit.hud.style(progress.style).get('display'),'none');
    assert.equal(f.edit.hud.character(text).data,'Client unavailable.');
    assert.equal(f.raf.size,0);assert.equal(f.timers.size,0);assert.equal(f.sockets,0);
    lease.dispose();lease.dispose();assert.equal(parent.children.length,0);
    assert.throws(()=>lease.mount(),/consumed/);
  });
});

test('partial attachment is removed once and stale/adopted topology is never repaired or removed elsewhere',async()=>{
  await runGameModuleTest(async({assert,createGraph})=>{
    for(const mode of ['partial','reparent','text-tail']){
      const graph=createGraph({hudNative:true,ownedHudNative:true}),f=graph.f;
      const native=f.gate.claim(f.gate.metadata().id),parent=f.document.createElement('div'),other=f.document.createElement('aside');
      f.document.body.appendChild(parent);f.document.body.appendChild(other);
      const {createOwnedLoadingUi}=await graph.load('game-owned-loading-ui.mjs');
      const construct=Object.assign(Object.create(null),native.ownedHudDom.dom),append=construct.appendChild;
      if(mode==='partial')construct.appendChild=function(receiver,child){
        const result=append(receiver,child);if(receiver===parent)throw undefined;return result;
      };
      const lease=createOwnedLoadingUi({document:f.document,parent,dom:native.hudDom.dom,construct,isCurrentDocument:native.hudDom.isCurrentDocument});
      if(mode==='partial'){
        let thrown=false,value;try{lease.mount();}catch(error){thrown=true;value=error;}
        assert.equal(thrown,true);assert.equal(value,undefined);assert.equal(parent.children.length,1);
        lease.dispose();assert.equal(parent.children.length,0);
      }else{
        const label=lease.mount();
        if(mode==='reparent')other.appendChild(label);
        else append(label,native.ownedHudDom.dom.createTextNode(f.document,'foreign'));
        assert.throws(()=>lease.render(graph.run('({visible:true,busy:true,text:"Should not publish"})')));
        if(mode==='reparent'){lease.dispose();assert.equal(other.children[0],label);}
        else{lease.dispose();assert.equal(parent.children.length,0);}
      }
    }
  });
});
