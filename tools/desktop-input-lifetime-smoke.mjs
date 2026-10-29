// Authored ownership controls. Caller explicitly supplies a real or test-only ABI.
import assert from 'node:assert/strict';
import {createClientInput} from '../web/client-input.mjs';
import {createStockGameplay} from '../web/stock-gameplay.mjs';

const own={token:1n,wantedHeading:0,gazeHeading:0,dead:false,turnRate:.03,sizeTurnFactor:.5,speedTurnFactor:.8};
const capture=fn=>{try{return{thrown:false,value:fn()};}catch(value){return{thrown:true,value};}};
function tracked(Base,{freeFailure,throwOnFree=false}={}) {
  const counts={created:0,freed:0,left:0};
  class Tracked extends Base {
    constructor(...args){super(...args);counts.created++;}
    leave_tick(){assert.equal(counts.freed,0,'leave must precede free');counts.left++;return super.leave_tick();}
    free(){counts.freed++;super.free();if(throwOnFree)throw freeFailure;}
  }
  return{Policy:Tracked,counts};
}
function gameplay(Policy,{fault,late=false}={}){
  const errors=[],wasm={DesktopInput:Policy,encode_login(){return new Uint8Array();},solve_challenge(){},decode_frame(){},setup_protocol_version(){}};
  if(fault&&!late)Object.defineProperty(wasm,'encode_login',{get:()=>{throw fault.value;}});
  const args={wasm,scene:{control_view(){},set_connected(){},reset_lag(){}},quality:{begin_connection(){}},controller:{packet(){},frame(){}},
    createSocket(){assert.fail('No construction socket');},now:()=>0,defer(){},setInterval(){},clearInterval(){},onStatus(){},onFatal:e=>errors.push(e)};
  if(late){args.hudReadout=true;args.scene.score_view=()=>{};args.controller.packetWithHud=()=>{};
    Object.defineProperty(wasm,'HudHistory',{get:()=>{throw fault.value;}});}
  return{owner:createStockGameplay(args),errors};
}

export function desktopInputLifetimeSmoke(wasm){
  let cases=0;
  {
    const{Policy,counts}=tracked(wasm.DesktopInput),input=createClientInput({InputPolicy:Policy});
    input.setConnected(true);input.setOwn(own);input.keyDown('Space');input.pagehide();
    assert.equal(counts.freed,0);assert.equal(input.snapshot().connected,false);assert.equal(input.snapshot().own.token,1n);
    input.setConnected(true);input.reset();assert.equal(counts.freed,0);input.dispose();input.dispose();assert.equal(counts.freed,1);
    const view=input.snapshot();view.pointer.x=99;assert.equal(input.snapshot().pointer.x,0);assert.throws(()=>input.keyDown('Space'),/disposed/);cases++;
  }
  for(const where of ['send','hook'])for(const primary of [undefined,{},false])for(const freeThrows of [false,true]){
    const{Policy,counts}=tracked(wasm.DesktopInput,{throwOnFree:freeThrows,freeFailure:'secondary free'});
    const input=createClientInput({InputPolicy:Policy});input.setConnected(true);input.setOwn(own);input.keyDown('ArrowLeft');input.keyDown('Space');
    const dispose=()=>{
      input.dispose();input.dispose();assert.equal(counts.freed,0);
      assert.throws(()=>input.tick({nowMs:0,wholeSteps:0},()=>{}),/already active/);
      assert.throws(()=>input.accumulateStep({wholeSteps:0}),/already active/);
      throw primary;
    };
    const result=capture(()=>input.tick({nowMs:251,wholeSteps:3},()=>{if(where==='send')dispose();},()=>{if(where==='hook')dispose();}));
    assert.equal(result.thrown,true);assert.ok(Object.is(result.value,primary));assert.equal(counts.left,1);assert.equal(counts.freed,1);
    input.dispose();assert.equal(counts.freed,1);assert.equal(input.snapshot().connected,false);cases++;
  }
  for(const where of ['send','hook']){
    const{Policy,counts}=tracked(wasm.DesktopInput),input=createClientInput({InputPolicy:Policy});
    input.setConnected(true);input.setOwn(own);input.keyDown('ArrowLeft');input.keyDown('Space');const sent=[];
    const result=capture(()=>input.tick({nowMs:251,wholeSteps:3},bytes=>{sent.push([...bytes]);if(where==='send')input.dispose();},()=>{if(where==='hook')input.dispose();}));
    assert.equal(result.thrown,true);assert.match(result.value.message,/Input disposed/);assert.equal(sent.length,1);assert.equal(counts.freed,1);assert.equal(counts.left,1);cases++;
  }
  for(const primary of [undefined,{},false])for(const late of [false,true]){
    const{Policy,counts}=tracked(wasm.DesktopInput,{throwOnFree:true,freeFailure:'secondary free'});
    const result=capture(()=>gameplay(Policy,{fault:{value:primary},late}));
    assert.equal(result.thrown,true);assert.ok(Object.is(result.value,primary));assert.equal(counts.created,1);assert.equal(counts.freed,1);cases++;
  }
  {
    const{Policy,counts}=tracked(wasm.DesktopInput),h=gameplay(Policy);h.owner.dispose();h.owner.dispose();
    assert.equal(counts.freed,1);assert.equal(h.owner.diagnostics().disposed,true);assert.equal(h.owner.diagnostics().input.connected,false);cases++;
  }
  {
    const{Policy,counts}=tracked(wasm.DesktopInput,{throwOnFree:true,freeFailure:undefined}),h=gameplay(Policy);
    const result=capture(()=>h.owner.dispose());assert.equal(result.thrown,true);assert.equal(result.value,undefined);
    assert.deepEqual(h.errors,[undefined]);h.owner.dispose();assert.equal(counts.freed,1);cases++;
  }
  // A record getter can request teardown before copied argument admission ends.
  {
    const{Policy,counts}=tracked(wasm.DesktopInput),input=createClientInput({InputPolicy:Policy});input.setOwn(own);
    assert.throws(()=>input.pointer({get clientX(){input.dispose();return 400;},clientY:300,viewportWidth:800,viewportHeight:600,follow:true}),/Input disposed/);
    assert.equal(counts.freed,1);cases++;
  }
  return{cases,evidence:'Explicit ABI ownership, primary throws and construction cleanup; no GC reliance or browser'};
}
