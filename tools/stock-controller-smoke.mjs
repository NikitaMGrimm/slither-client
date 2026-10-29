// Authored controller differential/lifetime requirements. Real ABI only when
// the caller explicitly supplies the freshly compiled StockControllerPolicy.
import assert from 'node:assert/strict';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockClient as oracle } from './fixtures/stock-client-oracle.mjs';

function capture(callback) { try { return { threw: false, value: callback() }; } catch (value) { return { threw: true, value }; } }
function fixture(create, Policy) {
  const trace = [], hooks = {};
  let owner, playing = true, setupDraws = 2;
  const scene = {
    advance() { trace.push('advance'); hooks.advance?.(); return step(); },
    advance_with_control(_now, _lag, control) { trace.push('advance-control'); control({}); playing = false; return step(); },
    set_gaze_heading(v) { trace.push(['gaze', v]); },
    apply_frame_and_render_standard_with_face_presentation_and_prey() { trace.push('packet'); return setupDraws; },
    apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud() {
      trace.push('packet-hud'); return { schema: 1, commandCount: 1, setupDraws: 0, events: [] };
    },
    render_standard_with_face_presentation_at_size(_target,_a,_b,_c,_background,w,h) {
      trace.push(['render',w,h]); hooks.render?.();
    },
  };
  function step() {
    return {
      get whole_steps() { trace.push('whole'); return hooks.whole ? hooks.whole() : 0; },
      get delta() { trace.push('delta'); return -0; },
      free() { trace.push('free'); hooks.free?.(); },
    };
  }
  const quality = {
    advance(_step, value) { trace.push(['quality', value]); hooks.quality?.(); },
    update_statistics(now, count, value) { trace.push(['statistics',now,count,value]); return hooks.statistics?.(); },
  };
  const adapter = {
    beginOperation() { trace.push('begin'); hooks.begin?.(); return {}; },
    endOperation() { trace.push(['end',owner.diagnostics()]); hooks.end?.(); },
    resolveAppearance() {}, resolveRecipe() {}, resolveAntennaRandom() {},
  };
  const options = { StockControllerPolicy: Policy, scene, quality, adapter,
    hostAssets:{resolveFood(){},resolvePrey(){}},target:{},palettes:[{},{},{}],background:{},width:960,height:540 };
  owner = create(options);
  return { owner, trace, hooks, options, scene, quality, get playing(){return playing;}, set count(v){setupDraws=v;} };
}

function compare(Policy, configure, act, create = createStockClient) {
  const a=fixture(oracle), b=fixture(create,Policy);
  for(const f of [a,b])configure(f);
  const first=capture(()=>act(a)), second=capture(()=>act(b));
  assert.equal(second.threw,first.threw);
  if(first.threw) {
    if(first.value instanceof Error) { assert.equal(second.value?.constructor,first.value.constructor); assert.equal(second.value.message,first.value.message); }
    else assert.equal(second.value,first.value);
  } else assert.deepEqual(second.value,first.value);
  assert.deepEqual(b.trace,a.trace);assert.deepEqual(b.owner.diagnostics(),a.owner.diagnostics());
  assert(Object.isFrozen(b.owner.diagnostics()));assert.equal(Object.getPrototypeOf(b.owner.diagnostics()),Object.prototype);
  a.owner.dispose();b.owner.dispose();
}

export function stockControllerSmoke(wasm, { create = createStockClient } = {}) {
  const Policy=wasm.StockControllerPolicy;
  assert.equal(typeof Policy,'function');let sequences=0;
  const run=(configure,act)=>{compare(Policy,configure,act,create);sequences++;};
  run(()=>{},f=>{f.owner.packet(Uint8Array.of(1));return f.owner.frame(8,{gazeHeading:-0});});
  for(const truthy of [undefined,false,0,NaN,'',null,true,1,'used',{},()=>{}]) run(f=>{f.hooks.statistics=()=>truthy;},f=>{f.owner.packet(Uint8Array.of(1));return f.owner.frame(1001);});
  run(f=>{f.hooks.statistics=()=>true;},f=>{
    f.owner.packet(Uint8Array.of(1));return f.owner.frame(1001,{control(){f.trace.push('control');},readPlaying(){f.trace.push('read-playing');return f.playing;},
      onStep(value){assert(Object.is(value.delta,-0));f.trace.push('observer');}});
  });
  const primary={authored:'primary'},secondary={authored:'secondary'};
  for(const value of [undefined,null,false,0,primary])for(const at of ['advance','quality','free','render','statistics','end','whole']) {
    run(f=>{f.hooks[at]=()=>{throw value;};},f=>f.owner.frame(9,{onStep(){}}));
  }
  for(const body of [undefined,primary])for(const free of [undefined,secondary])run(f=>{
    f.hooks.quality=()=>{throw body;};f.hooks.free=()=>{throw free;};f.hooks.end=()=>{throw primary;};
  },f=>f.owner.frame(8));
  for(const value of [undefined,primary])run(f=>{f.hooks.end=()=>{throw value;};},f=>f.owner.resize(800,600));
  run(()=>{},f=>{f.count=0xffffffff;f.owner.packet(Uint8Array.of(1));return f.owner.resize(1,1);});
  for(const count of [0,-0,0.5,-1,NaN,Infinity,undefined,null,'2',2n,Symbol('count'),{valueOf(){throw new Error('must not coerce count');}}]) {
    run(f=>{f.count=count;},f=>f.owner.packet(Uint8Array.of(1)));
  }
  run(()=>{},f=>{
    const options={ get lagging(){f.trace.push('lagging-get');f.owner.render();return false;},
      get playing(){f.trace.push('playing-get');return false;},get gazeHeading(){f.trace.push('gaze-get');return undefined;},
      get onStep(){f.trace.push('on-step-get');return undefined;},get control(){f.trace.push('control-get');return undefined;},
      get readPlaying(){f.trace.push('reader-get');return undefined;} };
    return f.owner.update(8,options);
  });
  run(()=>{},f=>{Object.defineProperty(f.scene,'advance',{get(){f.trace.push('advance-get');return ()=>({free(){f.trace.push('free');}});}});return f.owner.frame(8);});
  run(()=>{},f=>f.owner.frame(8,{onStep(){return{get then(){f.trace.push('then-get');throw undefined;}};}}));
  run(()=>{},f=>f.owner.frame(8,{control(){},readPlaying(){throw undefined;}}));
  run(()=>{},f=>{for(const v of [NaN,Infinity,'1',null,{}]){assert(capture(()=>f.owner.frame(v)).threw);assert(!f.owner.diagnostics().stopped);}return f.owner.render();});
  run(()=>{},f=>{const p={schema:1,commandCount:1,guards:[{playing:true,closeRequested:false,deathPending:false}],finalCaptureIndices:[]};return f.owner.packetWithHud(Uint8Array.of(97),false,new Proxy(p,{ownKeys(){f.trace.push('plan-reflect');assert(capture(()=>f.owner.render()).threw);throw undefined;}}));});
  run(()=>{},f=>{f.hooks.render=()=>{assert(capture(()=>f.owner.dispose()).threw);assert(capture(()=>f.owner.frame(8)).threw);};return f.owner.render();});
  run(()=>{},f=>{
    let calls=0;
    const keys=['draws','drawsSinceStatistics','width','height','stopped'];
    const saved=keys.map(key=>Object.getOwnPropertyDescriptor(Object.prototype,key));
    try {
      for(const key of keys)Object.defineProperty(Object.prototype,key,{configurable:true,set(){calls++;throw undefined;}});
      const value=f.owner.diagnostics();
      for(const key of keys)assert(Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
      assert.equal(calls,0);return value;
    } finally {for(const [index,key]of keys.entries()){if(saved[index])Object.defineProperty(Object.prototype,key,saved[index]);else delete Object.prototype[key];}}
  });
  return Object.freeze({sequences,abi:'caller-supplied StockControllerPolicy; host/Canvas/step doubles; no browser'});
}

export function stockControllerLifetimeSmoke(wasm) {
  const Base=wasm.StockControllerPolicy;let cases=0;
  function tracked(hooks={}) {
    const counts={created:0,freed:0};
    class Policy extends Base {
      constructor(...args){super(...args);counts.created++;}
      snapshot(){if(hooks.snapshot)hooks.snapshot(counts);return super.snapshot();}
      free(){counts.freed++;super.free();hooks.free?.();}
    }
    return {Policy,counts};
  }
  for(const primary of [undefined,{authored:'copy failure'}]) {
    const {Policy,counts}=tracked({snapshot(){throw primary;},free(){throw new Error('secondary');}});
    const result=capture(()=>fixture(createStockClient,Policy));assert(result.threw);assert.equal(result.value,primary);assert.equal(counts.created,1);assert.equal(counts.freed,1);cases++;
  }
  for(const freeFailure of [false,true]) {
    const primary={authored:'free failure'};const {Policy,counts}=tracked({free(){if(freeFailure)throw primary;}}),f=fixture(createStockClient,Policy);
    f.hooks.render=()=>{assert(capture(()=>f.owner.dispose()).threw);assert.equal(counts.freed,0);};f.owner.render();
    const result=capture(()=>f.owner.dispose());assert.equal(result.threw,freeFailure);if(freeFailure)assert.equal(result.value,primary);
    f.owner.dispose();assert.equal(counts.freed,1);assert.equal(f.owner.diagnostics().draws,1);assert(f.owner.diagnostics().stopped);cases++;
  }
  for(const primary of [undefined,{authored:'retired copy failure'}]) {
    let retire=false;const {Policy,counts}=tracked({snapshot(){if(retire)throw primary;},free(){throw new Error('secondary');}}),f=fixture(createStockClient,Policy);
    retire=true;const result=capture(()=>f.owner.dispose());assert(result.threw);assert.equal(result.value,primary);f.owner.dispose();assert.equal(counts.freed,1);assert(capture(()=>f.owner.diagnostics()).threw);cases++;
  }
  const {Policy,counts}=tracked(),f=fixture(createStockClient,Policy);f.hooks.quality=()=>{assert(capture(()=>f.owner.dispose()).threw);throw undefined;};
  const result=capture(()=>f.owner.frame(8));assert(result.threw);assert.equal(result.value,undefined);assert.equal(counts.freed,0);f.owner.dispose();f.owner.dispose();assert.equal(counts.freed,1);cases++;
  for(const point of ['construction','retirement']) {
    const {Policy,counts}=tracked({free(){throw new Error('secondary free');}});
    const define=Object.defineProperty;
    let f;
    if(point==='retirement')f=fixture(createStockClient,Policy);
    let result;
    try {
      Object.defineProperty=function(object,key,descriptor){if(key==='draws')throw undefined;return define(object,key,descriptor);};
      result=capture(()=>point==='construction'?fixture(createStockClient,Policy):f.owner.dispose());
    } finally { Object.defineProperty=define; }
    assert(result.threw);assert.equal(result.value,undefined);assert.equal(counts.freed,1);
    if(f){f.owner.dispose();assert(f.owner.diagnostics().stopped);assert.equal(counts.freed,1);}
    cases++;
  }
  return Object.freeze({cases,abi:'caller-supplied policy; deterministic free/retired diagnostics; no browser'});
}

/** Required production injection and captured class methods, without a fallback. */
export function stockControllerAdmissionSmoke(wasm) {
  assert.throws(()=>fixture(options=>createStockClient({...options,StockControllerPolicy:undefined})),/StockControllerPolicy capability/);
  class Policy extends wasm.StockControllerPolicy {}
  const f=fixture(createStockClient,Policy);
  Policy.validate_size=()=>{throw new Error('late static replacement');};
  Policy.prototype.stop=()=>{throw new Error('late owner replacement');};
  f.owner.resize(800,600);f.owner.dispose();assert(f.owner.diagnostics().stopped);
  return Object.freeze({cases:2});
}
