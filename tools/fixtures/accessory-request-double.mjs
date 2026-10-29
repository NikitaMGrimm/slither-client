// Explicit synthetic scalar ABI double, never shipped or a production fallback.
export class TestSelectedAccessoryRequest {
  constructor(start, deadline) { this.at=start;this.deadline=deadline;this.p=0;this.g=1;this.frees=0; }
  ticket(){return this.g;}
  live(ticket){return !!ticket&&ticket===this.g&&this.p<6;}
  phase(){return this.p;}
  invalidate(){this.p=6;this.g=0;}
  dispose(){this.p=7;this.g=0;}
  free(){this.frees++;}
  check(ticket,now){if(!this.live(ticket)||!Number.isFinite(now)||now<this.at||![1,5].includes(this.p)&&now>=this.deadline){this.invalidate();throw Error('request policy rejected');}this.at=now;}
  remaining(now){this.check(this.g,now);return this.deadline-now;}
  prepare(raw,count,slot,url,scale,px,py,now){
    this.check(this.g,now);
    if(this.p!==0){this.invalidate();throw Error('repeated request');}
    if(raw===null||raw===undefined||raw==='-1'){this.p=1;return 0;}
    if(typeof raw!=='string'||String(Number(raw))!==raw||Number(raw)<0||Number(raw)>=count
      ||!/^http:\/\/slither\.io\/s\/a_[a-z0-9_]{3,11}\.png$/.test(url)||slot>2||!Number.isFinite(scale)||scale<=0||scale>256
      ||![px,py].every(v=>Number.isFinite(v)&&Math.abs(v)<=65535)){this.invalidate();throw Error('request input rejected');}
    this.p=slot===0?3:2;return slot===0?2:1;
  }
  loaded(ticket,now,complete,w,h,nw,nh){this.check(ticket,now);if(this.p!==3||!complete||![w,h,nw,nh].every(v=>Number.isInteger(v)&&v>0&&v<=65535)||w!==nw||h!==nh){this.invalidate();throw Error('load rejected');}this.p=4;}
  handoff(ticket,now){this.check(ticket,now);if(![2,4].includes(this.p)){this.invalidate();throw Error('handoff rejected');}this.p=5;}
}
