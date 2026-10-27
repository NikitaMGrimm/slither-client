// Entirely authored fixtures. Actual gate/bootstrap/gameplay/session/acquirer run
// with synthetic DOM, scheduling, byte source, digest and socket/Wasm API doubles.
// No archived source, real fetch/socket, browser or Wasm runtime is reachable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, after } from 'node:test';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';
import { Script, createContext, runInContext } from 'node:vm';
import { createStockHostSnapshot } from '../web/stock-host-snapshot.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockEntityAssets } from '../web/stock-food-provider.mjs';
import { desktopBackingSize } from '../web/desktop-layout.mjs';
import { createStockGameplay } from '../web/stock-gameplay.mjs';

// Guard the Node test process as well as the synthetic Window. These descriptors
// are restored after this suite; product code gains no globals or fallback APIs.
const networkGlobals=['fetch','WebSocket'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
for(const [name] of networkGlobals)Object.defineProperty(globalThis,name,{configurable:true,writable:true,
  value:function(){throw new Error(`Real ${name} forbidden in synthetic bootstrap tests`);}});
after(()=>{for(const [name,descriptor] of networkGlobals) {
  if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
}});

const gateSource=readFileSync(new URL('../extension/game-gate.js',import.meta.url),'utf8');
const bootstrapSource=readFileSync(new URL('../extension/game-runtime.mjs',import.meta.url),'utf8');
const testSource=readFileSync(new URL('./game-bootstrap.test.mjs',import.meta.url),'utf8');
const hostFunctions=testSource.slice(testSource.indexOf('function fixture('),testSource.indexOf("\ntest('an unarmed"));
const {fixture,wasmDouble}=new Script(`(function(gateSource,Script,createContext,runInContext,assert,createGateTestDom,attachGateTestRealm){
  ${hostFunctions}\nreturn {fixture,wasmDouble};})`).runInThisContext()(gateSource,Script,createContext,runInContext,assert,createGateTestDom,attachGateTestRealm);
// Keep the actual modules and data records in ONE JS realm. Only the synthetic
// Window/native boundary below is adapted; no acquirer/factory override exists.
const makeBootstrap=new Script(`(function(init,wasm,createStockHostSnapshot,createStockSkinAdapter,
  createStockClient,createStockEntityAssets,desktopBackingSize,createStockGameplay){
  ${bootstrapSource.replace(/^import .+;\r?$/gm,'').replace(/^export /gm,'')}
  return (options = {}) => startGamePage({initialize:init,wasmApi:wasm,...options});})`).runInThisContext();
const startGamePage=makeBootstrap(async()=>{},{},createStockHostSnapshot,createStockSkinAdapter,
  createStockClient,createStockEntityAssets,desktopBackingSize,createStockGameplay);
const route='https://slither.io/s/game1107249518.js';
const publicHash='5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095';
const pending=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const request=()=>({endpoint:'ws://192.0.2.9:1234/slither',nickname:'Synthetic',skin:24,customSkin:new Uint8Array()});

async function harness() {
  const f=fixture();f.host();f.complete();const wasm=wasmDouble(f);
  const counts={fetch:0,digest:0,abort:0,cancel:0,release:0};
  const owned=[],trace=[],endpoints=[],fetching=pending(),digesting=pending();
  let read=false,digestHold,clearHook,runtime;
  const body={},reader={};
  // Full-sized authored padding and decimal literals only. A labelled digest
  // DOUBLE admits it for composition tests; this proves NO real source pin match.
  function syntheticBytes() {
    const bytes=new Uint8Array(224092).fill(32);
    bytes.set(new TextEncoder().encode('var v=17;'),181647);
    bytes.set(new TextEncoder().encode(`var k=[${Array.from({length:20},(_,i)=>i).join(',')}];`),181670);
    return bytes;
  }
  const caps=Object.freeze({
    fetch(url,init) {
      assert.equal(url,route);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
      counts.fetch++;trace.push('fetch');return fetching.promise;
    },
    async digest(algorithm,bytes) {
      assert.equal(algorithm,'SHA-256');assert.equal(bytes.length,224092);counts.digest++;trace.push('digest');digesting.resolve();
      if(digestHold)await digestHold.promise;
      const value=Uint8Array.from(publicHash.match(/../g),x=>Number.parseInt(x,16));owned.push(value);return value;
    },
    createAbort:()=>Object.freeze({signal:Object.freeze({synthetic:true}),abort(){counts.abort++;}}),
    setTimeout:callback=>{assert.equal(typeof callback,'function');return 99;},clearTimeout(){},now:()=>0,
    environment:()=>Object.freeze({origin:'https://slither.io',topLevel:true,secureContext:true}),
    responseInfo:()=>Object.freeze({status:200,type:'basic',url:route,redirected:false,body}),
    getReader(value){assert.equal(value,body);return reader;},
    read(value){
      assert.equal(value,reader);if(read)return Promise.resolve({done:true,value:undefined});read=true;
      const chunk=syntheticBytes();owned.push(chunk);return Promise.resolve({done:false,value:chunk});
    },
    cancelReader(value){assert.equal(value,reader);counts.cancel++;return Promise.resolve();},
    releaseReader(value){assert.equal(value,reader);counts.release++;},
    bytes:Object.freeze({
      allocate(size){const bytes=new Uint8Array(size);owned.push(bytes);return bytes;},
      length:bytes=>bytes.length,copy:(to,from,offset)=>to.set(from,offset),
      clear(bytes){bytes.fill(0);clearHook?.(bytes);},
    }),
  });
  // The actual gate installs/owns all native scheduling/socket/input/paint holds.
  // This test Window facade supplies same-realm synthetic profile capabilities;
  // every DOM/source object and privately claimed base capability keeps identity.
  const realm={};const slot=Symbol.for('slither.client.gate.v1');
  for(const key of Reflect.ownKeys(f.realm))if(![slot,'top','window','globalThis','document','location'].includes(key)) {
    Object.defineProperty(realm,key,Object.getOwnPropertyDescriptor(f.realm,key));
  }
  // The profile facade is not the native Window; retain its existing mutable values.
  realm.document=f.document;realm.location=f.realm.location;realm.top=realm;realm.window=realm;
  const gate=Object.freeze({metadata:()=>f.gate.metadata(),claim(id){
    const native=f.gate.claim(id);
    return Object.freeze({...native,liveProfile:caps,
      createSocket(endpoint){endpoints.push(endpoint);return native.createSocket(endpoint);}});
  }});
  Object.defineProperty(realm,slot,{value:gate,writable:true,configurable:true});
  runtime=await startGamePage({realm,wasmApi:wasm.api});
  return {f,wasm,realm,runtime,counts,owned,trace,endpoints,fetching,digesting,
    respond(){fetching.resolve({synthetic:true});},
    holdDigest(){digestHold=pending();return digestHold;},
    setClearHook(hook){clearHook=hook;},
    assertWiped(){for(const bytes of owned)assert(bytes.every(value=>value===0));},
    assertNoSocket(){assert.equal(f.sockets,0);assert.equal(f.original,0);},
  };
}

test('actual bootstrap is inert at startup and exposes local additive profile Play only',async()=>{
  const h=await harness();
  assert.equal(typeof h.runtime.playWithLiveProfile,'function');assert.equal(typeof h.runtime.play,'function');
  assert.equal(h.counts.fetch,0);assert.equal(h.counts.digest,0);assert.equal(h.owned.length,0);h.assertNoSocket();
  assert.equal(h.f.messages.at(-1).code,'ready-not-connected');
  h.runtime.dispose();h.f.flush();h.assertNoSocket();
});

test('full acquisition succeeds before initial native reset/frame commit constructs exactly one synthetic socket',async()=>{
  const h=await harness();h.f.event('keydown',{code:'ArrowLeft'});
  const work=h.runtime.playWithLiveProfile(request());
  assert.equal(h.counts.fetch,1);h.assertNoSocket();
  const advances=h.wasm.calls.filter(c=>c[0]==='advance').length;
  h.f.frame(8);h.f.flush();assert.equal(h.wasm.calls.filter(c=>c[0]==='advance').length,advances);h.assertNoSocket();
  h.f.event('keyup',{code:'ArrowLeft'});
  h.respond();await work;
  assert.equal(h.runtime.diagnostics().gameplay.profilePhase,'ready');h.assertWiped();h.assertNoSocket();
  assert.equal(h.runtime.diagnostics().gameplay.input.leftHeld,false);
  h.f.frame(16);assert.equal(h.f.sockets,1);assert.equal(h.wasm.counts().stepFrees,1);
  await assert.rejects(h.runtime.playWithLiveProfile(request()));assert.equal(h.counts.fetch,1);
  h.runtime.dispose();assert.equal(h.f.socket.closes,1);assert.equal(h.f.original,0);
});

test('stale preflight and invalid selected endpoint perform no acquisition; caller intent is copied before awaits',async()=>{
  const stale=await harness();stale.realm.location.href='https://slither.io/#stale';
  await assert.rejects(stale.runtime.playWithLiveProfile(request()));assert.equal(stale.counts.fetch,0);stale.assertNoSocket();stale.runtime.dispose();
  const h=await harness();const invalid={...request(),endpoint:'ws://example.invalid:1234/slither'};
  await assert.rejects(h.runtime.playWithLiveProfile(invalid));assert.equal(h.counts.fetch,0);h.assertNoSocket();
  const selected={...request(),nickname:'Before',skin:3,customSkin:Uint8Array.of(7,8)};
  const observed=[];const encode=h.wasm.api.encode_login;
  h.wasm.api.encode_login=(version,password,nickname,skin,custom)=>{
    observed.push({nickname,skin,custom:[...custom]});return encode(version,password,nickname,skin,custom);
  };
  const work=h.runtime.playWithLiveProfile(selected);
  selected.endpoint='ws://192.0.2.10:2345/slither';selected.nickname='After';selected.skin=4;selected.customSkin.fill(0);
  h.respond();await work;h.f.frame(8);
  assert.deepEqual(h.endpoints,['ws://192.0.2.9:1234/slither']);
  assert.deepEqual(observed,[{nickname:'Before',skin:3,custom:[7,8]}]);h.assertWiped();h.runtime.dispose();
});

test('changed asset readiness/document/URL/renderer context cancels pending acquisition and opens none',async()=>{
  for(const mutate of [
    h=>{h.realm.document={};},h=>{h.realm.location.href='https://slither.io/?stale=1';},
    h=>{h.realm.top={};},h=>{h.realm[Symbol.for('slither.client.gate.v1')]={};},
    h=>{h.realm.bg_hex=new h.f.realm.HTMLImageElement();},
    h=>{const body=h.realm.per_color_imgs[0].kmcs[0];body.width=body.width;},
  ]) {
    const h=await harness(),hold=h.holdDigest();
    const work=h.runtime.playWithLiveProfile(request());h.respond();await h.digesting.promise;
    mutate(h);hold.resolve();await assert.rejects(work);h.f.flush();h.assertNoSocket();h.assertWiped();
    if(h.f.raf.size)h.f.frame(8);h.assertNoSocket();h.runtime.dispose();
  }
});

test('pagehide disposes a pending acquisition and late results are cleanup-only',async()=>{
  const h=await harness(),work=h.runtime.playWithLiveProfile(request());
  h.f.event('pagehide');await assert.rejects(work);h.respond();await new Promise(resolve=>setImmediate(resolve));h.f.flush();
  h.assertNoSocket();h.assertWiped();assert.equal(h.f.raf.size,0);assert.equal(h.runtime.diagnostics().disposed,true);
  await assert.rejects(h.runtime.playWithLiveProfile(request()));assert.equal(h.counts.fetch,1);
});

test('post-staging cleanup failure or stale intent keeps RAF locked, cancels staged session and opens none',async()=>{
  for(const mode of ['cleanup-failure','stale-document','pagehide']) {
    const h=await harness();let observed=false;
    h.setClearHook(bytes=>{
      if(bytes.length!==20||observed)return;
      observed=true;assert.equal(h.runtime.diagnostics().gameplay.session.phase,'opening');
      h.f.frame(8);h.f.flush();assert.equal(h.wasm.counts().stepFrees,0);h.assertNoSocket();
      if(mode==='cleanup-failure')throw new Error('Synthetic cleanup rejection after staging');
      if(mode==='stale-document')h.realm.location.href='https://slither.io/#stale';
      if(mode==='pagehide')h.f.event('pagehide');
    });
    const work=h.runtime.playWithLiveProfile(request());h.respond();await assert.rejects(work);assert(observed);
    h.f.flush();h.assertNoSocket();h.assertWiped();
    if(h.f.raf.size)h.f.frame(16);h.assertNoSocket();h.runtime.dispose();
  }
});

test('same document check runs after complete native/controller frame before Socket commit',async()=>{
  const h=await harness(),work=h.runtime.playWithLiveProfile(request());h.respond();await work;h.assertNoSocket();
  const render=h.wasm.api.AnimatedScene.prototype.render_standard_with_face_presentation_at_size;
  h.wasm.api.AnimatedScene.prototype.render_standard_with_face_presentation_at_size=function(...args){
    render.apply(this,args);h.realm.location.href='https://slither.io/#after-render';
  };
  h.f.frame(8);h.f.flush();h.assertNoSocket();assert.equal(h.runtime.diagnostics().disposed,true);
});
