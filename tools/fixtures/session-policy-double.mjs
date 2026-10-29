// TEST ONLY explicit ABI oracle. No production module imports this policy.
import {stageControls,matchHudReport} from './session-policy-oracle.mjs';
const fail=message=>{throw new Error(message);};
export class TestSessionPolicy {
  constructor(){Object.assign(this,{phase:'ready',connected:false,playing:false,lifeEnded:false,lagging:false,pingPending:false,lastPingMs:0,pingExternal:false,closeRequested:false,reason:null,constructorAttempts:0,startedMs:undefined,launch:false,launchCommitted:false,subscribed:false,hudSchema:0,actions:{},actionRevision:0,stepRevision:undefined,deathMs:null,returnFraction:0,uiPhase:'idle',previousUiMs:0,handshakeFrames:0,handshakeBytes:0});}
  free(){if(this.freed)fail('Test session released twice');this.freed=true;}
  snapshot(){const{phase,connected,playing,lifeEnded,lagging,pingPending,lastPingMs,closeRequested,returnFraction,reason,constructorAttempts}=this;return{phase,connected,playing,lifeEnded,lagging,pingPending,lastPingMs,closeRequested,returnFraction,uiTimerNeeded:this.uiPhase==='in',reason,constructorAttempts};}
  terminal(){return this.phase==='failed'||this.phase==='disconnected';}
  schema(){return this.hudSchema;}
  check_subscribe(){if(this.subscribed||this.phase!=='ready')fail('One subscriber required before Play');}
  subscribe(schema){this.subscribed=true;this.hudSchema=schema;}
  check_play(sink){if(!sink||this.phase!=='ready')fail('One manual Play per session');}
  reset_actions(){this.actions={...this.actions,resetWorld:true,connected:false};this.actionRevision++;}
  begin_play(){this.launch=true;this.phase='opening';this.reset_actions();}
  begin_stop(failed,reason){if(this.terminal())return false;this.phase=failed?'failed':'disconnected';this.reason=Uint16Array.from(reason);this.connected=this.playing=this.lagging=this.pingPending=this.closeRequested=false;this.uiPhase='idle';this.launch=false;return true;}
  stop_actions(){this.reset_actions();}
  begin_construct(now){this.startedMs=now;this.constructorAttempts++;}
  check_open(){if(this.phase!=='opening')fail('Unexpected socket open');}
  static negotiation_packet(index){return index===0?Uint8Array.of(1):Uint8Array.of(99,0);}
  opened(){this.phase='challenge';}
  receive_bytes(size){if(!this.connected){this.handshakeFrames++;this.handshakeBytes+=size;if(this.handshakeFrames>16||this.handshakeBytes>1048576)fail('Handshake receive budget exceeded');}}
  receive_header(count,first){if(this.phase==='challenge'){if(count!==1||first!==54)fail('Expected one challenge command');return true;}if(!this.connected&&this.phase!=='setup')fail('Unexpected protocol frame');if(this.phase==='setup'&&first!==97)fail('Expected Setup after login');return false;}
  command_requires_version(opcode,length){if(opcode===54)fail('Repeated challenge');if(opcode===112&&length!==1)fail('Invalid pong');if(opcode===118&&length!==2)fail('Invalid life control');return opcode===97;}
  admit_protocol(version){if(version!==19)fail('Unsupported protocol');}
  challenged(){this.launch=false;this.phase='setup';}
  prepare_controls(pairs,now){const commands=Array.from({length:pairs.length/2},(_,i)=>[pairs[2*i],pairs[2*i+1]]);const initial={};for(const key of ['phase','connected','playing','lifeEnded','lagging','pingPending','closeRequested','deathMs','previousUiMs','uiPhase','actions','actionRevision'])initial[key]=this[key];this.staged={...stageControls(commands,now,initial,this.hudSchema),commands};return this.staged.plan;}
  match_report(values,setups){const names=['setup','setup-draw','leaderboard','final-score','own-length-scheduled'];const events=Array.from({length:values.length/3},(_,i)=>({commandIndex:values[i*3],kind:names[values[i*3+1]],deathPending:!!values[i*3+2]}));matchHudReport({events,setupDraws:setups},this.staged.commands,this.staged.plan);}
  commit_controls(){if(this.terminal())fail('Session stopped during packet');if(!this.staged)fail('No prepared controls');Object.assign(this,this.staged.next);this.staged=undefined;}
  handshake_timed_out(now){return !this.terminal()&&this.startedMs!==undefined&&!this.connected&&now-this.startedMs>3333;}
  lag_check_needed(){return !this.terminal()&&!this.lagging&&this.pingPending;}
  observe_lag_elapsed(elapsed){if(elapsed>750)this.lagging=true;}
  observe_lag(now){if(this.lag_check_needed()&&!this.pingExternal)this.observe_lag_elapsed(now-this.lastPingMs);}
  pending_actions(){return{revision:this.actionRevision,actions:{...this.actions}};}
  acknowledge(revision){if(revision!==this.actionRevision)fail('Stale action acknowledgement');if(!Object.hasOwn(this.actions,'resetLag'))fail('No lag reset to acknowledge');delete this.actions.resetLag;this.actionRevision++;}
  check_step(hud){if(hud&&!this.hudSchema)fail('HUD subscription required');if(this.stepRevision!==undefined)fail('Previous control step is not committed');}
  has_death(){return this.deathMs!==null;}
  death_time(){return this.deathMs;}
  static death_elapsed(now,death){return now-death;}
  advance_step(now,delta){return this.advance_step_elapsed(this.has_death(),TestSessionPolicy.death_elapsed(now,this.deathMs),delta);}
  advance_step_elapsed(present,elapsed,delta){let returnActive=false,returnCompleted=false;if(present&&elapsed>1600){if(this.uiPhase==='idle')this.uiPhase='out';if(this.uiPhase==='out'){returnActive=true;this.returnFraction-=0.004*delta;if(this.returnFraction<=0){returnCompleted=true;this.returnFraction=0;this.deathMs=null;this.playing=false;this.uiPhase='idle';}}}return{close:this.closeRequested&&this.deathMs===null&&!this.terminal(),lifecycle:{schema:1,deathPending:this.deathMs!==null,returnActive,returnCompleted,returnFraction:this.returnFraction}};}
  finish_step(hasSocket){this.stepRevision=this.actionRevision;if(this.launch&&!hasSocket&&Object.hasOwn(this.actions,'resetWorld'))this.launchCommitted=true;}
  commit_control(hasSocket){if(this.stepRevision===undefined)return false;if(this.stepRevision===this.actionRevision){this.actions={};this.actionRevision++;}this.stepRevision=undefined;if(this.launchCommitted&&this.launch&&!hasSocket&&!this.terminal()){this.launchCommitted=false;return true;}return false;}
  ping_available(){return this.connected&&!this.pingPending;}
  ping_external(){return this.pingExternal;}
  ping_due_elapsed(elapsed){return !(elapsed<=250);}
  ping_due(now){return this.ping_due_elapsed(now-this.lastPingMs);}
  commit_opaque_ping(){this.lastPingMs=NaN;this.pingExternal=true;this.pingPending=true;return Uint8Array.of(251);}
  commit_ping(now){this.lastPingMs=now;this.pingExternal=false;this.pingPending=true;return Uint8Array.of(251);}
  static protocol_allowed(version){return version===19;}
  static valid_input(bytes){return(bytes.length===1&&bytes[0]<=254&&bytes[0]!==252)||(bytes.length===2&&bytes[0]===252&&bytes[1]!==0&&bytes[1]!==128);}
  ui_tick(now){if(this.uiPhase!=='in'||this.terminal())return;const units=(now-this.previousUiMs)/25;this.previousUiMs=now;this.returnFraction+=0.05*units;if(this.returnFraction>=1){this.returnFraction=1;this.uiPhase='idle';}}
}
