// Authored differential schedules against retained project-owned pre-port policy.
// No external source, transport, scheduler, browser or server is used.
import assert from 'node:assert/strict';
import {createClientInput,desktopPointer} from '../web/client-input.mjs';
import {createClientInput as oracle,desktopPointer as oraclePointer} from './fixtures/client-input-oracle.mjs';

const own=(token,extra={})=>({token,wantedHeading:0,gazeHeading:0,dead:false,turnRate:.03,sizeTurnFactor:.5,speedTurnFactor:.8,...extra});
const pointer=(x,y,extra={})=>({clientX:400+x,clientY:300+y,viewportWidth:800,viewportHeight:600,follow:true,...extra});
export function desktopInputSmoke(wasm) {
  assert.equal(typeof wasm.DesktopInput,'function');let comparisons=0;
  const owners=[];let failed=false;
  try {
  const pair=(protocol=19)=>{
    const token={},a=oracle({protocolVersion:protocol}),b=createClientInput({protocolVersion:protocol,InputPolicy:wasm.DesktopInput});
    owners.push(b);
    for(const i of [a,b]){i.setConnected(true);i.setOwn(own(token));}return[a,b];
  };
  const equal=([a,b])=>{assert.deepEqual(b.snapshot(),a.snapshot());comparisons++;};
  const outcome=fn=>{try{return{thrown:false,value:fn()};}catch(value){return{thrown:true,value:value instanceof Error?{name:value.name,message:value.message}:value};}};
  const tick=(inputs,now,steps,callback,hook)=>{
    const results=inputs.map(input=>{
      const sends=[];const result=outcome(()=>input.tick({nowMs:now,wholeSteps:steps},bytes=>{
        sends.push([...bytes]);callback?.(input,bytes,sends.length-1);
      },hook?(context,emit)=>hook(input,context,emit):undefined));return{result,sends};
    });assert.deepEqual(results[1],results[0]);equal(inputs);return results[1];
  };
  for(const protocol of [2,4,5,19,255]) {
    const inputs=pair(protocol);
    for(let n=0;n<180;n++){
      for(const i of inputs){
        if(n%9===0)i.keyDown('ArrowLeft');if(n%11===0)i.keyDown('ArrowRight');
        if(n%7===0)i.keyUp('ArrowLeft');if(n%13===0)i.keyUp('ArrowRight');
        if(n%5===0)i.keyDown('Space');if(n%8===0)i.mouseUp();if(n%17===0)i.keyUp('Space');
        i.pointer(pointer((n*37%401)-200,(n*71%307)-153));
      }
      tick(inputs,n*17,n%6,undefined,(_i,c,emit)=>{if(c.nowMs%51===0)emit(Uint8Array.of(c.protocolVersion>=5?251:112));});
    }
  }
  const rawFailures=[undefined,null,false,0,-0,NaN,{},Symbol('authored failure'),new Error('authored failure')];
  for(const failure of rawFailures)for(let phase=0;phase<4;phase++){
    const inputs=pair();for(const i of inputs){i.keyDown('ArrowLeft');i.keyDown('Space');i.pointer(pointer(-100,0));}
    const actual=tick(inputs,251,5,(_i,_bytes,index)=>{if(index===phase)throw failure;},(_i,_c,emit)=>emit(Uint8Array.of(251)));
    assert.equal(actual.result.thrown,true);for(const i of inputs)i.keyUp('ArrowLeft');tick(inputs,252,0);
  }
  const token={};
  const mutations=[i=>i.setProtocolVersion(4),i=>i.setConnected(false),i=>i.setOwn(null),i=>i.reset(),
    i=>i.setOwn(own(token,{wantedHeading:Math.PI,gazeHeading:-0,dead:true})),
    i=>{i.keyUp('Space');i.pointer(pointer(0,-100));},
    i=>{assert.throws(()=>i.accumulateStep({wholeSteps:0}),/already active/);assert.throws(()=>i.tick({nowMs:0,wholeSteps:0},()=>{}),/already active/);}];
  for(const mutation of mutations)for(const phase of [0,1,2,3]){
    const inputs=pair();for(const i of inputs){i.keyDown('ArrowLeft');i.keyDown('Space');i.pointer(pointer(-100,0));}
    tick(inputs,251,3,(i,_b,n)=>{if(n===phase)mutation(i);},(_i,_c,emit)=>emit(Uint8Array.of(251)));
  }
  for(const mutation of mutations){
    const inputs=pair();for(const i of inputs){i.keyDown('ArrowLeft');i.keyDown('Space');i.pointer(pointer(-100,0));}
    tick(inputs,251,3,undefined,(i,_c,emit)=>{mutation(i);emit(Uint8Array.of(251));});
  }
  for(const token of [{},NaN,0,-0,1n,Symbol('identity')]){
    const inputs=pair();for(const i of inputs){i.setOwn(own(token));i.keyDown('Space');}tick(inputs,51,0);
    for(const i of inputs)i.setOwn(own(token,{gazeHeading:99,dead:true}));equal(inputs);
    for(const i of inputs){i.setOwn(null);i.setOwn(own(token,{gazeHeading:-0}));}equal(inputs);
  }
  for(const angle of [-0,0,-Math.PI,Math.PI*2,1e308,-1e308,Number.MIN_VALUE]){
    const inputs=pair();for(const i of inputs){i.setOwn(own(token,{wantedHeading:angle,gazeHeading:-0}));i.pointer(pointer(0,16));}
    tick(inputs,34,0);for(const i of inputs)i.pointer(pointer(-0,-0));tick(inputs,68,0);
  }
  for(const value of [pointer(20,-30),pointer(20,-30,{follow:false,head:{x:100,y:200},camera:{x:110,y:220},zoom:.5}),
    {clientX:9_007_199_254_740_992,clientY:0,viewportWidth:2,viewportHeight:2,follow:false,camera:{x:2,y:1},head:{x:0,y:0},zoom:1}]){
    assert.deepEqual(desktopPointer(value,wasm.DesktopInput),oraclePointer(value));comparisons++;
  }
  return{comparisons,evidence:'authored retained JS oracle vs selected ABI; caller labels real Wasm or explicit test double'};
  } catch(error){failed=true;throw error;}
  finally {
    let cleanupFailed=false,primary;
    for(const owner of owners){try{owner.dispose();}catch(error){if(!cleanupFailed){cleanupFailed=true;primary=error;}}}
    if(!failed&&cleanupFailed)throw primary;
  }
}
