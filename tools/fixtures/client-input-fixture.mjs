// Explicit TEST ONLY ABI double. Never packaged or imported by production.
import { createClientInput as createAdapter, desktopPointer as projectAdapter } from '../../web/client-input.mjs';
import { createClientInput as createOracle, desktopPointer } from './client-input-oracle.mjs';

const pointer = a => ({ clientX:a[0],clientY:a[1],viewportWidth:a[2],viewportHeight:a[3],follow:a[4]===1,
  head:a[5]===1?{x:a[8],y:a[9]}:null,camera:{x:a[6],y:a[7]},zoom:a[10] });
export class TestDesktopInput {
  constructor(protocolVersion) { this.input=createOracle({protocolVersion,_staged:true}); }
  free() { if(this.freed)throw new Error('Test input released twice');this.freed=true; }
  static project_pointer(a) { return desktopPointer(pointer(a)); }
  pointer(a) { return this.input.pointer(pointer(a)); }
  protocol_version() { return this.input.snapshot().protocolVersion; }
  is_connected() { return this.input.snapshot().connected; }
  has_own() { return this.input.snapshot().own!==null; }
  gaze() { return this.input.snapshot().own?.gazeHeading; }
  required_gaze() { return this.input.required_gaze(); }
  set_protocol_version(v) { this.input.setProtocolVersion(v); }
  set_connected(v) { this.input.setConnected(v); }
  set_own(a,same) { this.input.setOwn({token:same&&this.has_own()?this.input.snapshot().own.token:{},
    wantedHeading:a[0],gazeHeading:a[1],dead:a[2]===1,turnRate:a[3],sizeTurnFactor:a[4],speedTurnFactor:a[5]}); }
  clear_own() { this.input.setOwn(null); }
  key_down(v) { return this.input.keyDown(v); }
  key_up(v) { return this.input.keyUp(v); }
  mouse_down(a) { this.input.mouseDown(pointer(a)); }
  mouse_up() { this.input.mouseUp(); }
  blur() { this.input.blur(); }
  pagehide() { this.input.pagehide(); }
  reset() { this.input.reset(); }
  ensure_idle() { this.input.ensure_idle(); }
  enter_tick() { this.input.enter_tick(); }
  leave_tick() { this.input.leave_tick(); }
  validate_tick(...args) { this.input.validate_tick(...args); }
  accumulate_step(v) { this.input.accumulateStep({wholeSteps:v}); }
  keyboard_phase(...args) { return this.input.keyboard_phase(...args); }
  boost_phase(...args) { return this.input.boost_phase(...args); }
  heading_phase(...args) { return this.input.heading_phase(...args); }
  snapshot() { const s=this.input.snapshot();if(s.own)delete s.own.token;return s; }
}
const SelectedPolicy = process.env.SLITHER_INPUT_WASM === '1'
  ? (await (await import('../reference-context.mjs')).loadWasm()).DesktopInput : TestDesktopInput;
const owners=[];
export const createClientInput = options => {const owner=createAdapter({...options,InputPolicy:SelectedPolicy});owners.push(owner);return owner;};
export function releaseTestInputs(){for(const owner of owners.splice(0))owner.dispose();}
export const projectPointer = input => projectAdapter(input,SelectedPolicy);
export {projectPointer as desktopPointer};
