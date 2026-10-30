// Project-authored differential session scenarios; no source archive, socket or network.
import assert from 'node:assert/strict';
import {createStockSession as createCurrent} from '../web/stock-session.mjs';
import {createStockSession as createRetained} from './fixtures/stock-session-oracle.mjs';
import {syntheticSetup} from '../web/synthetic-scene.mjs';
import {syntheticChallenge} from './synthetic-challenge.mjs';
import {unpackCommands} from '../web/handshake-session.mjs';
const challenge=Uint8Array.of(54,...syntheticChallenge('ABCDEFGHIJKLMNOPQRSTUVWXYZA'));
const wire=commands=>Uint8Array.from(commands.length===1?commands[0]:commands.flatMap((c,i)=>i===0?[c.length>>8,c.length&255,...c]:[c.length+32,...c]));
const request=()=>({endpoint:'ws://192.0.2.9:1234/slither',profile:{clientVersion:7,password:new Uint8Array(20).fill(3),protocolVersion:19},nickname:'Authored session',skin:2,customSkin:new Uint8Array()});
const normalized=value=>value instanceof Error?{name:value.name,message:value.message}:value;
const caught=callback=>{try{return{thrown:false,value:callback()};}catch(value){return{thrown:true,value:normalized(value)};}};
const score=()=>({schema:1,enabled:true,tableMax:17,own:{token:1n,id:0,logicalSegments:4,fractionalMass:.25,scoreAdjustment:3,scoreIndex:7},status:'ready',score:17,error:null});
function report(commands,plan){const events=[];let setupDraws=0;commands.forEach((c,commandIndex)=>{if(c[0]===97){setupDraws++;events.push({commandIndex,kind:'setup',tableMax:17},{commandIndex,kind:'setup-draw',view:{...score(),own:null,status:'no-own',score:null}});}else if(c[0]===108&&plan.guards[commandIndex].playing){events.push({commandIndex,kind:'leaderboard',localRow:1,rank:17,population:33,deathPending:plan.guards[commandIndex].deathPending});}else if(plan.finalCaptureIndices.includes(commandIndex)){events.push({commandIndex,kind:'final-score',view:score()});}});return{schema:plan.schema,commandCount:commands.length,setupDraws,events,...(plan.schema===2?{leaderboardRows:events.filter(e=>e.kind==='leaderboard').map(e=>({commandIndex:e.commandIndex,rows:[]}))}:{})};}
/** Explicit protocol ABI double for ordinary Node tests, never selected by product. */
export function sessionProtocolDouble(){return{encode_login:()=>Uint8Array.of(115,1,2),solve_challenge:()=>new Uint8Array(27).fill(65),setup_protocol_version:c=>c[23],decode_frame(bytes){const commands=[];if(bytes[0]>=32)commands.push([...bytes]);else for(let i=0;i<bytes.length;){const prefix=bytes[i++],length=prefix<32?prefix*256+bytes[i++]:prefix-32;commands.push([...bytes.slice(i,i+length)]);i+=length;}return Uint8Array.from(commands.flatMap(c=>[0,0,c.length>>8,c.length&255,...c]));}};}
function harness(create,wasm,mode){const hooks={},trace=[],sockets=[],errors=[];let clock=1000;const session=create({wasm,now:()=>clock,createSocket(endpoint){trace.push(['construct',endpoint]);const socket={readyState:0,bufferedAmount:0,sent:[],closes:0,send(bytes){trace.push(['send',[...bytes],session.snapshot()]);hooks.send?.();this.sent.push([...bytes]);},close(){trace.push(['close',session.snapshot()]);this.closes++;this.readyState=3;hooks.close?.();}};sockets.push(socket);return socket;}});const sink={packet(bytes,elapsed,plan){trace.push(['packet',[...bytes],elapsed,plan??null,session.snapshot()]);hooks.packet?.();return mode?report(unpackCommands(wasm.decode_frame(bytes,false)),plan):undefined;},state(value){trace.push(['state',value]);hooks.state?.();},error(value){errors.push(value);trace.push(['error',normalized(value)]);hooks.error?.();},...(mode?{hud(value){trace.push(['hud',value,session.snapshot()]);hooks.hud?.();}}:{})};(mode===2?session.subscribeWithLeaderboardRows:mode?session.subscribeWithHud:session.subscribe)(sink);return{session,hooks,trace,sockets,errors,setTime:v=>{clock=v;},open(){sockets[0].readyState=1;sockets[0].onopen?.();},message(...commands){sockets[0].onmessage?.({data:wire(commands).buffer});},step(now=1000,delta=1,wholeSteps=1){const request={nowMs:now,delta,wholeSteps};return mode?session.afterStepWithHud(request):session.afterStep(request);},stepRequest(request){return mode?session.afterStepWithHud(request):session.afterStep(request);},inspect(){return{snapshot:session.snapshot(),actions:session.pendingActions(),trace,sockets:sockets.map(s=>({readyState:s.readyState,sent:s.sent,closes:s.closes,binaryType:s.binaryType}))};}};}
/** Cross-language comparison of complete session effects and callback observations. */
export function sessionPolicySmoke(wasm){let comparisons=0,cases=0;const owners=[];const compare=(a,b)=>{assert.deepEqual(a,b);comparisons++;};
function pair(mode){const old=harness(createRetained,wasm,mode),current=harness(createCurrent,wasm,mode);owners.push(old,current);const each=callback=>{const expected=caught(()=>callback(old)),actual=caught(()=>callback(current));compare(actual,expected);compare(current.inspect(),old.inspect());return actual;};const call=(method,...args)=>each(h=>h.session[method](...args));const tick=(...args)=>{each(h=>h.step(...args));call('commitControl');};const connect=()=>{call('play',request());each(h=>h.step());call('commitControl');each(h=>h.open());each(h=>h.message(challenge));each(h=>h.message(syntheticSetup()));};return{old,current,each,call,tick,connect};}
try{
 for(const mode of [0,1,2])for(const death of [0,1,2,255]){const p=pair(mode);p.connect();p.call('uiTick',1500);p.each(h=>{let reads=0;h.session.betweenKeyboardAndBoost({get nowMs(){return[1250,1251,1300][reads++];},protocolVersion:19},bytes=>h.session.sendInput(bytes));assert.equal(reads,3);});p.call('beforeUpdate',2050);p.call('beforeUpdate',2050.1);p.each(h=>h.message([112]));p.each(h=>h.message([118,death]));p.tick(2600,5,5);for(let i=0;i<52;i++)p.tick(2601+i*25,5,5);p.call('close','authored-close\u0000\ud800A\udc00');cases++;}
 for(const mode of [0,1,2]){const p=pair(mode);p.connect();p.each(h=>h.message([118,1],[108,1,0,17,0,33],[118,1],syntheticSetup(),[112],[118,0]));p.call('uiTick',1500);p.each(h=>h.session.acknowledgeActions(h.session.pendingActions()));p.tick(2601,0,0);p.call('close');cases++;}
 for(const point of ['send','packet','state'])for(const primary of [undefined,false,{authored:'primary'}]){const p=pair(0);p.connect();p.each(h=>{h.hooks[point]=()=>{throw primary;};});if(point==='send')p.call('sendInput',Uint8Array.of(1));else p.each(h=>h.message([112]));for(const h of [p.old,p.current])if(h.errors.length)assert.equal(h.errors.at(-1),primary);cases++;}
 {const p=pair(0);p.call('play',request());p.tick();p.call('beforeUpdate',4333);p.call('beforeUpdate',4333.1);cases++;}
 for(const point of ['send','packet']){const p=pair(0);p.connect();p.each(h=>{h.hooks[point]=()=>h.sockets[0].onclose?.();});if(point==='send')p.call('sendInput',Uint8Array.of(1));else p.each(h=>h.message([118,1]));cases++;}

 // The third getter read is an opaque assignment. Coercion happens only when a
 // later arithmetic boundary actually needs that retained value.
 for(const raw of ['1300',{valueOf(){throw undefined;}}]){
  const p=pair(0);p.connect();let emits=0;
  p.each(h=>{let reads=0;const result=caught(()=>h.session.betweenKeyboardAndBoost({get nowMs(){return ++reads<3?1300:raw;},protocolVersion:19},bytes=>{emits++;assert.deepEqual([...bytes],[251]);assert.equal(h.session.snapshot().lastPingMs,raw);assert.equal(h.session.snapshot().pingPending,true);h.trace.push(['opaque-ping-emit',h.session.snapshot()]);}));assert.equal(result.thrown,false);assert.equal(reads,3);assert.equal(h.session.snapshot().lastPingMs,raw);});
  assert.equal(emits,2);p.call('beforeUpdate',2050);p.call('beforeUpdate',2050.1);
  p.each(h=>{assert.equal(h.session.snapshot().lastPingMs,raw);h.message([112]);});
  p.call('beforeUpdate',3000);
  p.each(h=>{let reads=0;const result=caught(()=>h.session.betweenKeyboardAndBoost({get nowMs(){reads++;return 1600;},protocolVersion:19},()=>{}));if(typeof raw==='object'){assert(result.thrown);assert.equal(result.value,undefined);assert.equal(reads,2);}else assert.equal(result.thrown,false);});cases++;
 }
 {
  const p=pair(0),raw={valueOf(){assert.fail('emit must not coerce its committed clock');}};p.connect();
  p.each(h=>{let reads=0,emits=0;const result=caught(()=>h.session.betweenKeyboardAndBoost({get nowMs(){return ++reads<3?1300:raw;},protocolVersion:19},bytes=>{emits++;assert.deepEqual([...bytes],[251]);assert.equal(h.session.snapshot().lastPingMs,raw);assert.equal(h.session.snapshot().pingPending,true);throw undefined;}));assert(result.thrown);assert.equal(result.value,undefined);assert.equal(emits,1);assert.equal(h.errors.at(-1),undefined);assert.equal(h.session.snapshot().lastPingMs,raw);assert.equal(h.session.snapshot().phase,'failed');});cases++;
 }
 {
  const p=pair(0);let active,coercions=0;const raw={valueOf(){coercions++;active.session.close('coercion-close');return 1000;}};p.connect();
  p.each(h=>{let reads=0;h.session.betweenKeyboardAndBoost({get nowMs(){return ++reads<3?1300:raw;},protocolVersion:19},()=>{});assert.equal(coercions,0);});
  p.each(h=>{active=h;const result=h.session.beforeUpdate(2000);assert.equal(result.lagging,true);assert.equal(h.session.snapshot().phase,'disconnected');assert.equal(h.session.snapshot().lastPingMs,raw);});assert.equal(coercions,2);cases++;
 }

 for(const raw of [undefined,null,Symbol('opaque clock'),1n,10n**400n]){
  const p=pair(0);p.connect();
  p.each(h=>{let reads=0;h.session.betweenKeyboardAndBoost({get nowMs(){return ++reads<3?1300:raw;},protocolVersion:19},()=>{});assert.equal(reads,3);assert.equal(h.session.snapshot().lastPingMs,raw);assert.equal(h.session.snapshot().pingPending,true);});
  p.call('beforeUpdate',2051);p.each(h=>h.message([112]));
  if(typeof raw==='bigint'){
   for(const delta of [250n,251n])p.each(h=>{let reads=0,emits=0;h.session.betweenKeyboardAndBoost({get nowMs(){return ++reads===1?1600:reads===2?Object(raw+delta):2000;},protocolVersion:19},()=>{emits++;});assert.equal(emits,delta===250n?0:1);assert.equal(reads,delta===250n?2:3);});
  }
  cases++;
 }

 // Initial death presence precedes the second getter; its right operand is
 // captured after that getter and before either arithmetic coercion callback.
 for(const mode of [0,1,2])for(const site of ['getter','coercion','coercion-setup','getter-throw','coercion-throw']){
  const p=pair(mode);p.connect();p.call('uiTick',1500);p.each(h=>h.message([118,1]));
  p.each(h=>{let reads=0;const order=[];const mutate=()=>{h.setTime(3000);h.message([118,1]);};
   const marker={valueOf(){order.push('coercion');mutate();if(site==='coercion-setup')h.message(syntheticSetup());if(site==='coercion-throw')throw undefined;return 2601;}};
   const result=caught(()=>h.stepRequest({get nowMs(){order.push(++reads===1?'admit-now':'second-getter');if(reads===1)return 2601;if(site==='getter'||site==='getter-throw'){mutate();if(site==='getter-throw')throw undefined;return 2601;}return marker;},delta:5,wholeSteps:5}));
   assert.equal(reads,2);assert.deepEqual(order,site.startsWith('coercion')?['admit-now','second-getter','coercion']:['admit-now','second-getter']);
   if(site.endsWith('throw')){assert(result.thrown);assert.equal(result.value,undefined);}else{assert.equal(result.thrown,false);const lifecycle=mode?result.value.lifecycle:null;if(lifecycle){assert.equal(lifecycle.returnActive,site==='coercion');assert.equal(lifecycle.returnFraction,site==='coercion'?.98:1);assert.equal(lifecycle.deathPending,true);}assert.equal((mode?result.value.actions:result.value).resetLag,true);}
  });cases++;
 }
 for(const mode of [0,1,2]){
  const p=pair(mode);p.connect();p.call('uiTick',1500);p.each(h=>h.message([118,1]));for(let i=0;i<52;i++)p.tick(2601+i*25,5,5);
  p.each(h=>{h.setTime(1000);h.message([118,1]);let reads=0;const result=h.stepRequest({get nowMs(){if(++reads===1)return 2601;h.step(3000,0,0);h.session.commitControl();return 2601;},delta:5,wholeSteps:5});assert.equal(reads,2);if(mode){assert.equal(result.lifecycle.returnActive,true);assert.equal(result.lifecycle.returnCompleted,true);assert.equal(result.lifecycle.returnFraction,0);assert.equal(result.lifecycle.deathPending,false);}});cases++;
 }
 return{comparisons,cases,evidence:'Full retained project-authored JS session vs explicitly selected SessionPolicy; caller labels actual Wasm or test-only ABI; no browser/network'};
}finally{for(const h of owners){h.hooks.send=h.hooks.packet=h.hooks.state=h.hooks.close=h.hooks.error=undefined;if(h.session.dispose)h.session.dispose();else h.session.close();}}}
