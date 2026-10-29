// TEST ONLY independently executable ABI model; never imported by production.
// Numeric rules retain the project-owned controller oracle, not a Wasm fallback.
export class TestStockControllerPolicy {
  static validate_size(v) { if (!Number.isSafeInteger(v) || v <= 0 || v > 4096) throw new RangeError('Invalid stock backing size'); return v; }
  static validate_time(v) { if (!Number.isFinite(v)) throw new TypeError('Finite time required'); }
  static validate_gaze(v) { if (!Number.isFinite(v)) throw new TypeError('Finite gaze heading required'); }
  constructor(w,h) { this.view={draws:0,drawsSinceStatistics:0,width:TestStockControllerPolicy.validate_size(w),height:TestStockControllerPolicy.validate_size(h),stopped:false};this.phase=0;this.resize=null; }
  live() { if(this.freed)throw new Error('Test controller use after free'); }
  snapshot() { this.live();const v=this.view;return Float64Array.of(v.draws,v.drawsSinceStatistics,v.width,v.height,Number(v.stopped)); }
  free() { this.live();this.freed=true; }
  stage() { this.live();return this.phase; }
  uses_control() { this.live();return this.control; }
  playing() { this.live();return this.currentPlaying; }
  target_width() { this.live();return this.resize?.[0]??this.view.width; }
  target_height() { this.live();return this.resize?.[1]??this.view.height; }
  statistics_count() { this.live();return this.view.drawsSinceStatistics; }
  is_stopped() { this.live();return this.view.stopped; }
  expect(p) { this.live();if(this.view.stopped)throw new Error('Stock controller stopped');if(this.phase!==p)throw new Error('Invalid stock controller stage'); }
  begin_packet() { this.expect(0);this.phase=11; }
  begin_draw(resize,w,h) { this.expect(0);if(resize){TestStockControllerPolicy.validate_size(w);TestStockControllerPolicy.validate_size(h);}this.resize=resize?[w,h]:null;this.phase=9; }
  begin_update(frame,gaze,control,read,observe,playing) { this.expect(0);Object.assign(this,{frame,control,read,observe,currentPlaying:playing,resize:null});this.phase=gaze?1:2; }
  gaze_done() { this.expect(1);this.phase=2; }
  advance_done() { this.expect(2);this.phase=this.read?3:4; }
  playing_observed(v) { this.expect(3);this.currentPlaying=v;this.phase=4; }
  quality_done() { this.expect(4);this.phase=this.observe?5:6; }
  step_observed(whole,delta) { this.expect(5);if(!Number.isInteger(whole)||whole<0||whole>5||!Number.isFinite(delta)||delta<0||delta>5)throw new RangeError('Invalid observed animation step');this.phase=6; }
  step_freed() { this.expect(6);this.phase=this.observe?7:8; }
  observer_done() { this.expect(7);this.phase=8; }
  statistics_result(v) { this.expect(8);if(v)this.view.drawsSinceStatistics=0;this.phase=this.frame?9:10; }
  charge(n) { if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)throw new RangeError('Invalid successful Setup draw count');this.view.draws+=n;this.view.drawsSinceStatistics+=n;if(!Number.isSafeInteger(this.view.draws)||this.view.drawsSinceStatistics>0xffffffff)throw new RangeError('Stock draw counter exhausted'); }
  packet_succeeded(n) { this.expect(11);this.charge(n);this.phase=10; }
  draw_succeeded() { this.expect(9);this.charge(1);if(this.resize)[this.view.width,this.view.height]=this.resize;this.phase=10; }
  finish() { this.expect(10);this.phase=0; }
  stop() { this.live();this.view.stopped=true;this.phase=0; }
}
