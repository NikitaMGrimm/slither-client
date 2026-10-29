// Authored inert differential/lifetime requirements. Real ABI is exercised only
// when a caller explicitly supplies freshly compiled gameplay and other owners.
import assert from 'node:assert/strict';
import {createStockGameplay as adapter} from '../web/stock-gameplay.mjs';
import {createStockGameplay as oracle} from './fixtures/stock-gameplay-oracle.mjs';
import {createGameplayComposition} from './fixtures/gameplay-composition-fixture.mjs';
import {profileEnvironment} from './fixtures/gameplay-profile-fixture.mjs';
const capture=callback=>{try{return{thrown:false,value:callback()};}catch(value){return{thrown:true,value};}};
const awaited=async callback=>{try{return{thrown:false,value:await callback()};}catch(value){return{thrown:true,value};}};
function normalize(value){
  if(typeof value==='symbol')return '<issued scene symbol>';
  if(value instanceof Error)return{kind:value.constructor.name,message:value.message,code:value.code};
  if(ArrayBuffer.isView(value))return[...value];
  if(Array.isArray(value))return value.map(normalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalize(v)]));
  return value;
}
function observe(f){const h=f.h;return normalize({trace:h.trace,errors:h.errors,diagnostics:h.gameplay.diagnostics(),
  hud:h.gameplay.hudSnapshot(),rows:h.gameplay.leaderboardSnapshot(),draws:h.controller.diagnostics(),
  projections:h.projections,sockets:h.sockets.map(s=>({closes:s.closes,sent:s.sent})),timers:h.intervals.size});}
function compareOutcome(a,b){assert.equal(b.thrown,a.thrown);assert.deepEqual(normalize(b.value),normalize(a.value));if(a.thrown&&!(a.value instanceof Error))assert.equal(b.value,a.value);}
export async function gameplayPolicySmoke(wasm,{create=adapter}={}){
  let sequences=0;
  async function run(configure,action){
    const a=createGameplayComposition(oracle,wasm,configure?.()),b=createGameplayComposition(create,wasm,configure?.());
    const expected=await awaited(()=>action(a)),actual=await awaited(()=>action(b));
    compareOutcome(expected,actual);assert.deepEqual(observe(b),observe(a));
    for(const f of[a,b]){capture(()=>f.h.gameplay.dispose());f.h.controller.dispose();}
    sequences++;
  }
  await run(()=>({}),({h,board,row})=>{
    h.start();const hud=h.gameplay.hudSnapshot(),rows=h.gameplay.leaderboardSnapshot();
    h.sockets[0].message([97,3],board([row()]));h.sockets[0].message(board([row(3)]));
    assert.equal(h.gameplay.hudSnapshot(),hud);assert.equal(h.gameplay.leaderboardSnapshot(),rows);
    h.flush();assert.notEqual(h.gameplay.hudSnapshot(),hud);assert.notEqual(h.gameplay.leaderboardSnapshot(),rows);
    return h.gameplay.frame(16);
  });
  for(const at of ['project','release','hud','connected','status'])for(const primary of[undefined,false,{authored:'packet '+at}]){
    await run(()=>({}),({h,board,row})=>{h.start();const a=h.gameplay.hudSnapshot(),b=h.gameplay.leaderboardSnapshot();
      h.faults[at]=primary;h.faults.close={secondary:true};h.sockets[0].message([97,3],board([row()]));
      assert.equal(h.gameplay.hudSnapshot(),a);assert.equal(h.gameplay.leaderboardSnapshot(),b);h.flush();return h.errors;
    });
  }
  for(const at of ['render','quality','free-step','statistics','release'])for(const primary of[undefined,null,{authored:'frame '+at}]){
    await run(()=>({}),({h,board})=>{h.start();h.sockets[0].message([97,3],board());h.flush();
      const old=h.gameplay.hudSnapshot();h.faults[at]=primary;const result=capture(()=>h.gameplay.frame(16));
      assert(result.thrown);assert.equal(h.gameplay.hudSnapshot(),old);h.flush();return result;
    });
  }
  for(const at of ['project','hud'])await run(()=>({}),({h,board,row})=>{h.start();h.faults[at+'Effect']=()=>{
    assert(capture(()=>h.gameplay.frame(16)).thrown);assert(capture(()=>h.gameplay.dispose()).thrown);
  };h.sockets[0].message([97,3],board([row()]));h.flush();assert.equal(h.gameplay.hudSnapshot(),null);assert.equal(h.gameplay.leaderboardSnapshot(),null);});
  await run(()=>({}),({h})=>{h.start();const primary={commit:true};h.faults.construct=primary;return h.gameplay.render();});
  for(const primary of[undefined,{construct:true}])await run(()=>({}),({h,login})=>{
    h.gameplay.play(login());const old=h.gameplay.hudSnapshot();h.faults.construct=primary;const result=capture(()=>h.gameplay.frame(8));
    assert(result.thrown);assert.equal(h.gameplay.hudSnapshot(),old);h.flush();assert.equal(h.sockets.length,0);return result;
  });
  await run(()=>({configure(options,{routed}){const object={authoredResult:true};routed.render=function(){assert.equal(this,routed);return object;};routed.resize=function(){return object;};options.resultIdentity=object;}}),({h})=>{
    assert.equal(h.gameplay.render(),h.options.resultIdentity);assert.equal(h.gameplay.resize(123,456),h.options.resultIdentity);return h.gameplay.diagnostics();
  });
  for(const raw of[-0,-0.25,NaN,Infinity,-Infinity,1n,Symbol('css'),{valueOf(){throw undefined;}}])await run(()=>({}),({h})=>{
    const order=[];const event={get type(){order.push('type');return'pointermove';},get clientX(){order.push('x');return 1;},get clientY(){order.push('y');return 2;}};
    const viewport={get width(){order.push('width');return typeof raw==='object'?raw:{valueOf(){order.push('width-number');return raw;}};},get height(){order.push('height');return{valueOf(){order.push('height-number');return 540;}};}};
    const result=capture(()=>h.gameplay.event(event,viewport));return{order,result};
  });
  for(const nickname of['',String.fromCharCode(0xd800),String.fromCharCode(0xdc00),'A\ud83d\ude00B','x'.repeat(24)])await run(()=>({}),({h,login})=>{
    const request={...login(),nickname};h.gameplay.play(request);request.nickname='mutated';h.gameplay.frame(8);h.flush();
    return h.faults.encodedNickname;
  });
  // Acquirer capabilities are authored in-memory doubles, never real HTTP.
  for(const site of['success','preflight','quality','stale-before-commit','dispose'])await run(()=>{
    let valid=true;const env=profileEnvironment({current:()=>valid});return{configure(options,{faults,routed}){options.liveProfile=env.liveProfile;
      if(site==='quality')options.quality.begin_connection=()=>{throw undefined;};
      if(site==='stale-before-commit'){const call=routed.frame;routed.frame=(...args)=>{const result=call(...args);valid=false;return result;};}
    }};
  },async({h,login})=>{
    const{profile,...request}=login();if(site==='preflight')request.customSkin=new Uint8Array(256);
    const pending=h.gameplay.playWithLiveProfile(request);if(site==='dispose')h.gameplay.dispose();
    const result=await awaited(()=>pending);
    if(site==='success'||site==='stale-before-commit'){
      assert.equal(result.thrown,false);assert.equal(h.gameplay.diagnostics().profilePhase,'ready');
      assert.equal(h.sockets.length,0);const frame=capture(()=>h.gameplay.frame(8));
      assert.equal(frame.thrown,site==='stale-before-commit');h.flush();
      assert.equal(h.sockets.length,site==='success'?1:0);return{result,frame};
    }
    assert(result.thrown);
    h.flush();return result;
  });
  // The same-frame native control retains strict return lifecycle and explicit renewal.
  for(const variant of[0,1,2])await run(()=>({configure(options){options.localSession=true;}}),({h,board,login})=>{
    h.start();h.sockets[0].message([97,3],board());h.flush();h.sockets[0].message([118,variant]);h.flush();
    h.tick(500);h.faults.delta=5;for(let i=0;i<52;i++){capture(()=>h.gameplay.frame(2201+i*8));h.flush();}
    const result=capture(()=>h.gameplay.play(login()));h.flush();if(!result.thrown){h.gameplay.frame(3000);h.flush();}return result;
  });
  return Object.freeze({sequences,scope:'Caller-supplied owners with authored scene/clock/socket/acquirer/Canvas doubles; no browser/HTTP'});
}

export function gameplayPolicyNumericSmoke(wasm){
  let cases=0;const P=wasm.GameplayPolicy;
  for(const value of[-0,-.1,-.99,-1.5,0,1.01,NaN,Infinity,-Infinity]){assert(Object.is(P.css_ceil(value),Math.ceil(value)));cases++;}
  const p=new P(true,true,true,true,true,true);
  try{for(const units of[[0,0xd800,0xdc00,0xd83d,0xde00,0xffff],Array.from({length:300},(_,i)=>(i*521)&65535)]){
    p.set_nickname(Uint16Array.from(units));assert.deepEqual([...p.nickname()],units);cases++;
  }p.begin_dispose();assert.equal(p.nickname().length,0);cases++;assert(p.snapshot() instanceof Float64Array);}
  finally{p.free();}
  return{cases};
}

/** New capability resolution follows all existing preflight and owner construction. */
export function gameplayPolicyAdmissionSmoke(wasm){
  let cases=0;
  function setup(primary,late=false){
    const order=[];let reads=0;
    class Input extends wasm.DesktopInput{constructor(...args){super(...args);order.push('input-new');}free(){order.push('input-free');super.free();}}
    class Session extends wasm.SessionPolicy{constructor(...args){super(...args);order.push('session-new');}free(){order.push('session-free');super.free();}}
    class Policy extends wasm.GameplayPolicy{constructor(...args){super(...args);order.push('gameplay-new');}free(){order.push('gameplay-free');super.free();}}
    const args={scene:{control_view(){},set_connected(){},reset_lag(){},score_view(){}},quality:{begin_connection(){}},controller:{packet(){},packetWithHud(){},frame(){}},
      wasm:{DesktopInput:Input,SessionPolicy:Session,encode_login(){return Uint8Array.of(115);},decode_frame(){},solve_challenge(){},setup_protocol_version(){}},
      createSocket(){assert.fail('No socket from admission');},now:()=>0,defer(){},setInterval(){},clearInterval(){},onStatus(){},onFatal(){}};
    Object.defineProperty(args.wasm,'GameplayPolicy',{get(){reads++;if(!late)throw primary;return Policy;}});
    if(late){args.hudReadout=true;Object.defineProperty(args.wasm,'HudHistory',{get(){throw primary;}});}
    return{args,order,Policy,get reads(){return reads;}};
  }
  for(const primary of[undefined,{authored:'capability failure'}]){
    const f=setup(primary);f.args.hudReadout=1;assert(capture(()=>adapter(f.args)).thrown);assert.equal(f.reads,0);assert.deepEqual(f.order,[]);cases++;
    f.args.hudReadout=false;const result=capture(()=>adapter(f.args));assert(result.thrown);assert.equal(result.value,primary);assert.equal(f.reads,1);
    assert.deepEqual(f.order,['input-new','session-new','session-free','input-free']);cases++;
    const late=setup(primary,true),failure=capture(()=>adapter(late.args));assert(failure.thrown);assert.equal(failure.value,primary);
    assert.deepEqual(late.order,['input-new','session-new','gameplay-new','session-free','input-free','gameplay-free']);cases++;
  }
  {
    const f=setup(undefined);f.args.hudReadout=1;let reads=0;
    Object.defineProperty(f.args,'GameplayPolicy',{get(){reads++;throw undefined;}});
    assert(capture(()=>adapter(f.args)).thrown);assert.equal(reads,0);assert.equal(f.reads,0);cases++;
  }
  {
    const f=setup(undefined);f.args.GameplayPolicy=f.Policy;const owner=adapter(f.args);assert.equal(f.reads,0);owner.dispose();
    assert.deepEqual(f.order,['input-new','session-new','gameplay-new','session-free','input-free','gameplay-free']);owner.dispose();assert(owner.diagnostics().disposed);cases++;
  }
  return{cases};
}

export async function gameplayPolicyLifetimeSmoke(wasm){
  let cases=0;
  function tracked(hooks={}){const count={new:0,free:0};class P extends wasm.GameplayPolicy{
    constructor(...args){super(...args);count.new++;hooks.constructed?.();}
    snapshot(){hooks.snapshot?.();return super.snapshot();}
    free(){count.free++;super.free();hooks.free?.();}
  }
  for(const name of Object.getOwnPropertyNames(wasm.GameplayPolicy.prototype)){
    if(['constructor','free','snapshot'].includes(name))continue;
    const method=Object.getOwnPropertyDescriptor(wasm.GameplayPolicy.prototype,name)?.value;
    if(typeof method==='function')Object.defineProperty(P.prototype,name,{value:function(...args){assert.equal(count.free,0,'No owner call after free: '+name);return Reflect.apply(method,this,args);}});
  }
  return{P,count};}
  for(const primary of[undefined,{construction:true}]){
    const{P,count}=tracked({free(){throw new Error('secondary free');}});const f=capture(()=>createGameplayComposition(adapter,{...wasm,GameplayPolicy:P},{configure(options){Object.defineProperty(options.wasm,'HudHistory',{get(){throw primary;}});}}));
    assert(f.thrown);assert.equal(f.value,primary);assert.equal(count.new,1);assert.equal(count.free,1);cases++;
  }
  for(const primary of[undefined,{cleanup:true}]){
    const{P,count}=tracked({free(){throw new Error('secondary free');}}),{h}=createGameplayComposition(adapter,{...wasm,GameplayPolicy:P});h.start();h.sockets[0].message([97,3]);h.flush();h.faults['clear-timer']=primary;
    const result=capture(()=>h.gameplay.dispose());assert(result.thrown);assert.equal(result.value,primary);assert.equal(count.free,1);h.gameplay.dispose();assert.equal(count.free,1);assert(h.gameplay.diagnostics().disposed);h.controller.dispose();cases++;
  }
  for(const primary of[undefined,{snapshot:true}]){
    let retiring=false;const{P,count}=tracked({snapshot(){if(retiring)throw primary;},free(){throw new Error('secondary free');}}),{h}=createGameplayComposition(adapter,{...wasm,GameplayPolicy:P});
    retiring=true;const result=capture(()=>h.gameplay.dispose());assert(result.thrown);assert.equal(result.value,primary);assert.equal(count.free,1);h.gameplay.dispose();assert.equal(count.free,1);h.controller.dispose();cases++;
  }
  {
    const{P,count}=tracked(),{h}=createGameplayComposition(adapter,{...wasm,GameplayPolicy:P});h.start();h.sockets[0].message([97,3]);h.flush();h.faults.renderEffect=()=>{
      assert(capture(()=>h.gameplay.dispose()).thrown);assert.equal(count.free,0);throw undefined;
    };const r=capture(()=>h.gameplay.frame(16));assert(r.thrown);assert.equal(r.value,undefined);assert.equal(count.free,0);h.flush();assert.equal(count.free,1);h.gameplay.dispose();h.controller.dispose();cases++;
  }
  {
    const{P,count}=tracked(),env=profileEnvironment(),{h,login}=createGameplayComposition(adapter,{...wasm,GameplayPolicy:P},{configure(options){options.liveProfile=env.liveProfile;}});
    const{profile,...request}=login();const task=h.gameplay.playWithLiveProfile(request);h.gameplay.dispose();assert.equal(count.free,0,'async capability lease remains until its cancelled continuation unwinds');
    await awaited(()=>task);assert.equal(count.free,1);h.gameplay.dispose();h.controller.dispose();cases++;
  }
  for(const poison of[false,true]){
    const values=[];class P extends wasm.GameplayPolicy{set_nickname(units){values.push([...units]);super.set_nickname(units);}}
    const{h,login}=createGameplayComposition(adapter,{...wasm,GameplayPolicy:P});const request=login(),old=request.nickname;
    h.faults.encodeEffect=()=>{request.nickname='caller changed';if(poison)assert(capture(()=>h.gameplay.dispose()).thrown);};
    const result=capture(()=>h.gameplay.play(request));
    assert.equal(result.thrown,poison);
    assert.deepEqual(values,poison?[]:[Array.from(old,letter=>letter.charCodeAt(0))]);
    h.flush();h.gameplay.dispose();h.controller.dispose();cases++;
  }
  {
    const secondary={authored:'free after retained undefined'};
    const{P,count}=tracked({free(){throw secondary;}}),{h,board}=createGameplayComposition(adapter,{...wasm,GameplayPolicy:P});
    h.start();h.faults.hud=undefined;h.sockets[0].message([97,3],board());
    assert.doesNotThrow(()=>h.flush(),'secondary owner release cannot escape deferred first-fatal cleanup');
    assert.deepEqual(h.errors,[undefined]);assert.equal(count.free,1);h.gameplay.dispose();h.controller.dispose();cases++;
  }
  return{cases,scope:'Once-only explicit/deferred release; exact first errors; host doubles'};
}
