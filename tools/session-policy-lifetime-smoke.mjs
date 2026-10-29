// Authored lifetime regressions. Caller explicitly supplies actual Rust or a labelled ABI double.
import assert from 'node:assert/strict';
import {createStockSession} from '../web/stock-session.mjs';
import {createStockGameplay} from '../web/stock-gameplay.mjs';
const capture=callback=>{try{return{thrown:false,value:callback()};}catch(value){return{thrown:true,value};}};
const request=()=>({endpoint:'ws://192.0.2.1:1234/slither',profile:{clientVersion:1,password:new Uint8Array(20),protocolVersion:19},nickname:'Authored',skin:0,customSkin:new Uint8Array()});
function tracked(Base,{freeFailure,failFree=false}={}){const counts={created:0,freed:0};class Tracked extends Base{constructor(...a){super(...a);counts.created++;}free(){counts.freed++;super.free();if(failFree)throw freeFailure;}}return{Policy:Tracked,counts};}
function capabilities(Policy){return{SessionPolicy:Policy,encode_login(){return Uint8Array.of(115);},solve_challenge(){return new Uint8Array(27);},decode_frame(bytes){return Uint8Array.from([0,0,0,bytes.length,...bytes]);},setup_protocol_version(){return 19;}};}
function harness(Policy){const hooks={},errors=[],states=[];let socket;const session=createStockSession({wasm:capabilities(Policy),now:()=>1000,createSocket(){return socket={readyState:0,bufferedAmount:0,sent:[],close(){this.readyState=3;hooks.close?.();},send(bytes){hooks.send?.(bytes);this.sent.push([...bytes]);}};}});session.subscribe({packet(){hooks.packet?.();},state(value){states.push(value);hooks.state?.();},error(value){errors.push(value);hooks.error?.();}});const connect=()=>{session.play(request());session.afterStep({nowMs:1000,delta:1,wholeSteps:1});session.commitControl();socket.readyState=1;socket.onopen();socket.onmessage({data:Uint8Array.of(54,65).buffer});socket.onmessage({data:Uint8Array.of(97).buffer});};return{session,hooks,errors,states,connect,get socket(){return socket;}};}
function gameplay(wasm,{late,primary}={}){const args={wasm,scene:{control_view(){},set_connected(){},reset_lag(){}},quality:{begin_connection(){}},controller:{packet(){},frame(){}},createSocket(){assert.fail('No gameplay socket');},now:()=>0,defer(){},setInterval(){},clearInterval(){},onStatus(){},onFatal(){}};if(late){args.hudReadout=true;args.scene.score_view=()=>{};args.controller.packetWithHud=()=>{};Object.defineProperty(wasm,'HudHistory',{get(){throw primary;}});}return createStockGameplay(args);}
export function sessionPolicyLifetimeSmoke(wasm){let cases=0;
 {
  const{Policy,counts}=tracked(wasm.SessionPolicy),h=harness(Policy);h.connect();const stale=h.socket.onmessage;h.session.close();assert.equal(counts.freed,0,'close retains observable Rust owner');h.session.afterStep({nowMs:1000,delta:0,wholeSteps:0});h.session.commitControl();h.session.dispose();h.session.dispose();assert.equal(counts.freed,1);assert.equal(h.session.snapshot().phase,'disconnected');assert(Object.isFrozen(h.session.snapshot()));assert.throws(()=>h.session.pendingActions(),/disposed/);stale({data:new ArrayBuffer(0)});assert.equal(counts.freed,1);cases++;
 }
 for(const primary of [undefined,false,{authored:'send primary'}]){
  const{Policy,counts}=tracked(wasm.SessionPolicy,{failFree:true,freeFailure:{secondary:true}}),h=harness(Policy);h.connect();h.hooks.send=()=>{h.session.dispose();assert.equal(counts.freed,0,'active send lease defers free');throw primary;};const result=capture(()=>h.session.sendInput(Uint8Array.of(1)));assert(result.thrown);assert.equal(result.value,primary);assert.equal(counts.freed,1);h.session.dispose();assert.equal(counts.freed,1);cases++;
 }
 for(const point of ['packet','state']){
  const{Policy,counts}=tracked(wasm.SessionPolicy),h=harness(Policy);h.connect();h.hooks[point]=()=>{assert.throws(()=>h.session.dispose(),/reentry/);assert.equal(counts.freed,0);};h.socket.onmessage({data:Uint8Array.of(112).buffer});assert.equal(h.session.snapshot().phase,'playing');h.hooks[point]=undefined;h.session.dispose();assert.equal(counts.freed,1);cases++;
 }
 {
  const{Policy,counts}=tracked(wasm.SessionPolicy),h=harness(Policy);h.connect();const seen=[];Object.defineProperty(h.socket,'onopen',{configurable:true,set(){h.session.dispose();seen.push(h.session.pendingActions);throw undefined;}});h.session.close();assert.equal(counts.freed,1);assert.equal(h.errors.length,1);assert.equal(h.errors[0],undefined);assert.equal(h.session.snapshot().phase,'disconnected');assert.equal(seen.length,1);cases++;
 }
 for(const primary of [undefined,false,{authored:'construction primary'}]){
  const session=tracked(wasm.SessionPolicy,{failFree:true,freeFailure:{secondary:true}}),input=tracked(wasm.DesktopInput);const result=capture(()=>gameplay({...capabilities(session.Policy),DesktopInput:input.Policy},{late:true,primary}));assert(result.thrown);assert.equal(result.value,primary);assert.equal(session.counts.freed,1);assert.equal(input.counts.freed,1);cases++;
 }
 {
  const input=tracked(wasm.DesktopInput);class Broken extends wasm.SessionPolicy{constructor(){throw undefined;}}const result=capture(()=>gameplay({...capabilities(Broken),DesktopInput:input.Policy}));assert(result.thrown);assert.equal(result.value,undefined);assert.equal(input.counts.freed,1);cases++;
 }
 {
  const session=tracked(wasm.SessionPolicy),input=tracked(wasm.DesktopInput),owner=gameplay({...capabilities(session.Policy),DesktopInput:input.Policy});owner.dispose();owner.dispose();assert.equal(session.counts.freed,1);assert.equal(input.counts.freed,1);assert.equal(owner.diagnostics().session.phase,'disconnected');cases++;
 }
 {
  const session=tracked(wasm.SessionPolicy,{failFree:true,freeFailure:undefined}),input=tracked(wasm.DesktopInput),owner=gameplay({...capabilities(session.Policy),DesktopInput:input.Policy});const result=capture(()=>owner.dispose());assert(result.thrown);assert.equal(result.value,undefined);assert.equal(session.counts.freed,1);assert.equal(input.counts.freed,1);owner.dispose();cases++;
 }
 {
  const{Policy,counts}=tracked(wasm.SessionPolicy,{failFree:true,freeFailure:{secondary:true}});
  const entries=Object.entries;
  Object.entries=value=>{if(typeof value?.commitControl==='function')throw undefined;return entries(value);};
  let result;
  try{result=capture(()=>harness(Policy));}finally{Object.entries=entries;}
  assert(result.thrown);assert.equal(result.value,undefined);assert.equal(counts.created,1);assert.equal(counts.freed,1);cases++;
 }
 for(const invalid of [null,false,17,{},Symbol('invalid reason')]){
  const{Policy,counts}=tracked(wasm.SessionPolicy),h=harness(Policy);h.connect();let closes=0;h.hooks.close=()=>{closes++;};
  const before=h.session.snapshot(),socket=h.socket;
  const result=capture(()=>h.session.dispose(invalid));assert(result.thrown);assert(result.value instanceof TypeError);
  assert.equal(counts.freed,0,'invalid caller reason must not release the live owner');assert.deepEqual(h.session.snapshot(),before);
  for(const key of ['onopen','onmessage','onerror','onclose'])assert.equal(typeof socket[key],'function');
  h.session.sendInput(Uint8Array.of(1));assert.deepEqual(socket.sent.at(-1),[1]);assert.equal(closes,0);
  h.session.dispose('valid-after-caller-error');h.session.dispose();assert.equal(counts.freed,1);assert.equal(closes,1);
  for(const key of ['onopen','onmessage','onerror','onclose'])assert.equal(socket[key],null);cases++;
 }
 return{cases,evidence:'Explicit policy ownership, resource leases and exact primary errors; caller labels real Wasm versus test-only ABI; no browser/GC claim'};
}
