import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** Actual scalar Rust/Wasm and actual gate/native-double composition; no requests. */
export function selectedAccessoryRequestSmoke(wasm) {
  assert.equal(typeof wasm.SelectedAccessoryRequest,'function');
  const resource='http://slither.io/s/a_zzz_000.png'; // Authored synthetic token, no catalog identity.
  const owner=new wasm.SelectedAccessoryRequest(0,10000);
  try {
    assert.equal(owner.prepare('0',1,0,resource,1,0,0,0),2);
    const ticket=owner.ticket();assert(owner.live(ticket));
    owner.loaded(ticket,1,true,20,12,20,12);assert.equal(owner.phase(),4);
    owner.handoff(ticket,2);owner.check(ticket,20000);assert.equal(owner.phase(),5);
    owner.dispose();assert.equal(owner.live(ticket),false);
  } finally { owner.free(); }
  for(const resource of ['https://slither.io/s/a_zzz_000.png','http://slither.io/s/a_zzz.png?q=1']) {
    const bad=new wasm.SelectedAccessoryRequest(0,10000);
    try { assert.throws(()=>bad.prepare('0',1,0,resource,1,0,0,0));assert.equal(bad.ticket(),0); }
    finally { bad.free(); }
  }
  const log=execFileSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=actual gate',
    fileURLToPath(new URL('./game-bootstrap.test.mjs',import.meta.url))],{
    encoding:'utf8',env:{...process.env,SLITHER_ACCESSORY_REQUEST_WASM:'1'},maxBuffer:4*1024*1024});
  return {scalar:'actual Rust/Wasm',native:'actual captured gate and effects; inert native doubles',
    composition:log.split(/\r?\n/).filter(line=>/^# (tests|pass|fail|skipped) /.test(line))};
}
