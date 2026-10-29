// TEST ONLY gameplay ABI model; production has no JS semantic fallback.
export class TestGameplayPolicy {
  constructor(hud,rows,local,minimap,announcements,profile){Object.assign(this,{hud,rows,local,minimap,announcements,dead:false,failed:false,notified:false,changed:true,connected:false,pending:false,companion:false,phase:profile?1:0,started:false,units:new Uint16Array(),frame:0,control:0});}
  frame_score_required(){return this.hud&&this.frame===2;}frame_commit_allowed(){return this.frame===3;}frame_publication_allowed(){return this.frame===4&&this.publication_allowed();}
  input_allowed(){return this.control===4;}history_reset(reset){return this.hud&&reset;}
  free(){if(this.freed)throw new Error('Test gameplay double free');this.freed=true;}
  snapshot(){return Float64Array.of(Number(this.dead),Number(this.failed),Number(this.changed),this.phase,Number(this.connected),Number(this.pending),Number(this.companion),Number(this.started));}
  disposed(){return this.dead;}fatal(){return this.failed;}dirty(){return this.changed;}profile(){return this.phase;}acquiring(){return this.phase===2;}
  poison_reentry(active,reconciling,checking){return(this.rows||this.local)&&(active||reconciling||checking);}
  packet_rejected(active){return this.dead||active;}
  run_rejected(active,checking,reconciling){return this.dead||active||this.failed||checking||(this.hud&&reconciling);}
  play_rejected(active,checking,reconciling){return this.dead||active||this.failed||checking||(this.local&&reconciling);}
  live_rejected(active,checking){return this.dead||active||this.failed||checking;}
  post_callback_fatal(){return(this.rows||this.local)&&this.failed;}
  current_allowed(){return!this.dead&&!this.failed;}
  mark_dirty(){this.changed=true;}may_schedule(queued){return!this.dead&&!queued;}
  retain_error(){const first=!this.failed;this.failed=true;this.pending=this.companion=false;this.changed=true;return first;}
  reconcile_entry(active){return this.dead||this.acquiring()?0:active?1:this.failed?2:3;}
  needs_connected(captured){return this.connected!==captured;}connected_done(captured){this.connected=captured;}
  static timer_action(needed,present){return needed&&!present?1:!needed?2:0;}
  take_status(){if(!this.changed)return false;this.changed=false;return true;}
  static status(phase,connected){return phase==='ready'?1:connected?2:['opening','challenge','setup'].includes(phase)?4:3;}
  packet_base(){return Number(this.pending);}clear_companion(){this.companion=false;}stage_companion(){this.companion=true;}
  take_companion(){const present=this.companion;this.companion=false;return!this.rows||present;}
  stage_packet(){if(!this.publication_allowed())return false;this.pending=true;return true;}
  publish_pending(){if(this.failed||this.dead||!this.pending)return false;this.pending=false;return true;}
  publication_allowed(){return this.hud&&!this.failed&&!this.dead;}
  begin_frame(){this.frame=1;this.control=0;}frame_stage(){return this.frame;}
  begin_control(){this.control=1;}debt_done(){this.control=2;}lifecycle_done(reset){this.control=reset?3:4;}reset_input(){return this.control===3;}control_done(){this.control=5;}
  include_announcements(){return this.announcements;}include_minimap(returning){return this.minimap&&returning;}
  controller_done(){this.frame=2;}score_done(){this.frame=3;}
  commit_profile(attempted){if(this.phase===3&&attempted){this.phase=4;return true;}return false;}
  frame_commit_done(connected){this.connected=connected;this.frame=4;}finish_frame(){this.frame=0;}
  profile_needs_current(){return this.phase===3;}profile_available(){return this.phase!==0;}profile_idle(){return this.phase===1;}
  begin_profile(){this.phase=2;this.started=false;}profile_started(){this.started=true;}profile_retry_allowed(){return!this.started&&!this.dead;}
  profile_retry(){this.phase=1;}profile_ready(){this.phase=3;this.changed=true;}profile_failed(){this.phase=5;}
  replace_local(disconnected,returned){return this.local&&(disconnected||returned);}
  set_nickname(units){this.units=Uint16Array.from(units);}nickname(){return Uint16Array.from(this.units);}
  begin_dispose(){this.dead=true;this.phase=6;this.pending=this.companion=false;this.units=new Uint16Array();}
  claim_fatal_notification(){if(this.failed&&!this.notified){this.notified=true;return true;}return false;}
  static css_ceil(value){return Math.ceil(value);}
}
