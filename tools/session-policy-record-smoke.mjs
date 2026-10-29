// Authored copied-record regressions; caller labels actual Wasm or test-only ABI.
import assert from 'node:assert/strict';
import {createStockSession} from '../web/stock-session.mjs';
const request=()=>({endpoint:'ws://192.0.2.9:1234/slither',profile:{clientVersion:7,password:new Uint8Array(20),protocolVersion:19},nickname:'Authored copy',skin:0,customSkin:new Uint8Array()});
export function sessionPolicyRecordSmoke(wasm){let cases=0;
 for(const mode of ['nonwritable','setter']){
  const prior=Object.getOwnPropertyDescriptor(Object.prototype,'resetWorld');
  let setterCalls=0,constructs=0,world=1,failure,failed=false,session,policy,actions,pending;
  try{
   session=createStockSession({wasm,now:()=>1000,createSocket(){constructs++;assert.equal(world,0,'native reset must precede construction');return{readyState:0,bufferedAmount:0,send(){assert.fail('No open in copy regression');},close(){this.readyState=3;}};}});
   session.subscribe({packet(){},state(){},error(error){throw error;}});
   policy=new wasm.SessionPolicy();
   Object.defineProperty(Object.prototype,'resetWorld',mode==='nonwritable'
    ?{value:false,writable:false,configurable:true}
    :{configurable:true,get(){return false;},set(){setterCalls++;throw undefined;}});
   policy.begin_play();pending=policy.pending_actions();
   assert.equal(Object.hasOwn(pending.actions,'resetWorld'),true);assert.equal(pending.actions.resetWorld,true);
   const own=Object.getOwnPropertyDescriptor(pending.actions,'resetWorld');assert.equal(own.enumerable,true);assert.equal(Object.hasOwn(own,'value'),true);
   session.play(request());assert.equal(constructs,0);
   actions=session.afterStep({nowMs:1000,delta:1,wholeSteps:1});assert.equal(Object.hasOwn(actions,'resetWorld'),true);assert.equal(actions.resetWorld,true);
   assert.equal(Object.getPrototypeOf(actions),Object.prototype,'public output remains an ordinary copied record');assert.equal(Object.isFrozen(actions),true);
   if(actions.resetWorld===true)world=0;session.commitControl();assert.equal(constructs,1);
  }catch(error){failed=true;failure=error;}
  finally{
   if(prior)Object.defineProperty(Object.prototype,'resetWorld',prior);else delete Object.prototype.resetWorld;
   try{session?.dispose();}catch(error){if(!failed){failed=true;failure=error;}}
   try{policy?.free();}catch(error){if(!failed){failed=true;failure=error;}}
  }
  if(failed)throw failure;assert.equal(setterCalls,0);assert.equal(actions.resetWorld,true);assert.equal(pending.actions.resetWorld,true);cases++;
 }
 return{cases,evidence:'Copied reset intent survives inherited nonwritable data/setter with zero inherited calls; native reset is delivered before construct; no browser/network'};
}
