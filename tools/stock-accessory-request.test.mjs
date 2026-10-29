import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStockAccessoryRequest, handoffStockAccessoryRequest, assertStockAccessoryRequest} from '../web/stock-accessory-request.mjs';
import {TestSelectedAccessoryRequest} from './fixtures/accessory-request-double.mjs';
import {createStockAccessoryLoadLease} from '../web/stock-accessory-load.mjs';

function listeningLease(source) {
  return createStockAccessoryLoadLease(source,{inspect(){return ['synthetic','synthetic',true,20,12];},decode(){return {};},
    then(){},listen(){return ()=>{};},now(){return 0;},setTimeout(){return 1;},clearTimeout(){}});
}

// Authored inert native capability; no DOM, timer, URL request or source is created.
function fixture({slot=0,selection='0',fault,strictLifetime=false}={}) {
  const trace=[],source={}, clocks=new Map();let load,error,at=0,current=true,owner,policy;
  class Policy extends TestSelectedAccessoryRequest {constructor(...args){super(...args);policy=this;}}
  const postFreeCalls=[];
  if(strictLifetime)for(const name of Object.getOwnPropertyNames(TestSelectedAccessoryRequest.prototype)){
    if(name==='constructor')continue;
    const method=TestSelectedAccessoryRequest.prototype[name];
    Object.defineProperty(Policy.prototype,name,{value:function(...args){
      if(this.frees){postFreeCalls.push(name);throw new Error('policy used after free: '+name);}
      return Reflect.apply(method,this,args);
    }});
  }
  const binding={prepare(p,now){return p.prepare(selection,1,slot,'http://slither.io/s/a_zzz_000.png',1,0,0,now);},
    assertCurrent(){if(!current)throw new Error('binding changed');fault?.('check',owner);},
    create(){trace.push('create');fault?.('create',owner);},publishImage(){trace.push('image');},
    listen(ok,bad){trace.push('listen');load=ok;error=bad;return()=>{trace.push('remove');fault?.('remove',owner);};},
    request(){trace.push('src');fault?.('src',owner);},extents(){return [true,20,12,20,12];},
    publishLoaded(){trace.push('loaded');},matches(value){return source===value;}};
  const clock={now:()=>at,setTimeout(fn){trace.push('timer');clocks.set(1,fn);return 1;},clearTimeout(){trace.push('clear');clocks.clear();}};
  return {trace,source,clocks,binding,clock,postFreeCalls,get policy(){return policy;},
    start(){owner=createStockAccessoryRequest({native:{open(){return binding;}},clock,Request:Policy,resolveId(){return 0;},started:0,deadline:10000});return owner;},
    load:()=>load?.(),error:()=>error?.(),drift(){current=false;},at(value){at=value;},expire(){at=10000;clocks.get(1)?.();}};
}
test('one request consumes Rust effect then publication/listener/src and branded handoff',()=>{
  const f=fixture(),owner=f.start();assert.deepEqual(f.trace,['create','image','listen','timer','src']);
  f.load();assert.equal(f.policy.phase(),4);assert(f.trace.includes('loaded'));
  assert.throws(()=>handoffStockAccessoryRequest(owner,f.source,{}),/Issued live/);
  const wrong=listeningLease({});assert.throws(()=>handoffStockAccessoryRequest(owner,f.source,wrong),/Issued live/);wrong.dispose();
  const retired=listeningLease(f.source);retired.dispose();assert.throws(()=>handoffStockAccessoryRequest(owner,f.source,retired),/Issued live/);
  assert.equal(f.policy.phase(),4);assert.equal(f.clocks.size,1);
  const lease=listeningLease(f.source);
  handoffStockAccessoryRequest(owner,f.source,lease);assert.equal(f.policy.phase(),5);assert.equal(f.clocks.size,0);
  f.at(20000);owner.assertCurrent();owner.dispose();owner.dispose();lease.dispose();assert.equal(f.policy.frees,1);
  assert.throws(()=>handoffStockAccessoryRequest({},f.source),/Issued/);
});
test('none and existing source cause no native request effects',()=>{
  for(const options of [{selection:null},{selection:'-1'},{slot:1},{slot:2}]){
    const f=fixture(options),owner=f.start();assert.deepEqual(f.trace,[]);
    if(options.slot){const lease=listeningLease(f.source);handoffStockAccessoryRequest(owner,f.source,lease);lease.dispose();}
    owner.dispose();assert.equal(f.policy.frees,1);
  }
});
test('duplicate/error/deadline/drift permanently end a ticket; late settlement inert',()=>{
  for(const mutate of [f=>{f.load();f.load();},f=>f.error(),f=>f.expire(),f=>{f.drift();f.load();}]){
    const f=fixture(),owner=f.start();mutate(f);assert.throws(()=>owner.assertCurrent());
    assert.equal(f.policy.ticket(),0);f.load();assert.throws(()=>owner.dispose());assert.equal(f.policy.frees,1);
    f.load();f.error();assert.equal(f.trace.filter(x=>x==='src').length,1);assert.equal(f.clocks.size,0);
  }
});
test('exact falsy setup primary survives cleanup and frees policy',()=>{
  for(const primary of [undefined,null,false,0,'']){
    const f=fixture({fault(stage){if(stage==='src')throw primary;if(stage==='remove')throw Error('secondary');}});
    let caught=false;try{f.start();}catch(error){caught=true;assert.equal(error,primary);}assert(caught);
    assert.equal(f.policy.frees,1);f.load();assert.equal(f.clocks.size,0);
  }
});
test('normal observation reentry terminates rather than recursing or publishing',()=>{
  let reenter=false;
  const f=fixture({fault(stage,owner){if(reenter&&stage==='check'){reenter=false;owner.assertCurrent();}}}),owner=f.start();
  reenter=true;assert.throws(()=>owner.assertCurrent(),/reentered/);f.load();assert(!f.trace.includes('loaded'));
  assert.throws(()=>owner.dispose(),/reentered/);assert.equal(f.policy.frees,1);
});
test('disposal during an observation defers free until native callback unwinds',()=>{
  let active=false;
  const f=fixture({fault(stage,owner){if(active&&stage==='check'){active=false;owner.dispose();assert.equal(f.policy.frees,0);}}}),owner=f.start();
  active=true;assert.throws(()=>owner.assertCurrent(),/disposed/);assert.equal(f.policy.frees,1);f.load();
});
test('handoff release failure retains its exact primary and consumes cleanup once',()=>{
  for(const primary of [undefined,null,false]){
    const f=fixture({fault(stage){if(stage==='remove')throw primary;}}),owner=f.start();f.load();
    const lease=listeningLease(f.source);let caught=false;
    try{handoffStockAccessoryRequest(owner,f.source,lease);}catch(error){caught=true;assert.equal(error,primary);}assert(caught);
    try{owner.dispose();}catch(error){assert.equal(error,primary);}lease.dispose();
    assert.equal(f.policy.frees,1);assert.equal(f.trace.filter(value=>value==='remove').length,1);
  }
});

test('failed disposed request preserves exact primary without any post-free policy call',()=>{
  for(const primary of [undefined,null,false,0,'',Object.freeze({status:'pending'}),new Error('first')]){
    let active=false;
    const f=fixture({strictLifetime:true,fault(stage){if(active&&stage==='check')throw primary;}}),owner=f.start();
    const lease=listeningLease(f.source);
    const exact=operation=>{let caught=false;try{operation();}catch(error){caught=true;assert.equal(error,primary);}assert(caught);};
    active=true;exact(()=>owner.assertCurrent());exact(()=>owner.dispose());
    for(const observe of [()=>owner.assertCurrent(),()=>assertStockAccessoryRequest(owner),()=>handoffStockAccessoryRequest(owner,f.source,lease)])exact(observe);
    f.load();f.error();owner.dispose();lease.dispose();
    assert.deepEqual(f.postFreeCalls,[]);assert.equal(f.policy.frees,1);assert.equal(f.clocks.size,0);
    assert.equal(f.trace.filter(value=>value==='remove').length,1);
  }
});

test('normally disposed request stays terminal without any post-free policy call',()=>{
  const f=fixture({strictLifetime:true}),owner=f.start(),lease=listeningLease(f.source);
  owner.dispose();let primary;
  assert.throws(()=>owner.assertCurrent(),error=>{primary=error;return error.message==='Selected accessory request disposed';});
  for(const observe of [()=>assertStockAccessoryRequest(owner),()=>handoffStockAccessoryRequest(owner,f.source,lease)]){
    assert.throws(observe,error=>error===primary);
  }
  f.load();f.error();owner.dispose();lease.dispose();
  assert.deepEqual(f.postFreeCalls,[]);assert.equal(f.policy.frees,1);assert.equal(f.clocks.size,0);
  assert.equal(f.trace.filter(value=>value==='remove').length,1);
});
