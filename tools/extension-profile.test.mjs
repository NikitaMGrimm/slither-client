// Authored synthetic native/IPC/stream/hash/parser doubles. No target requests or browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProfileBroker } from '../extension/profile-broker.mjs';
import { createExtensionLiveProfileAcquirer } from '../web/stock-live-profile.mjs';
import { ProfileLiteralParserDouble } from './fixtures/profile-literals-double.mjs';
import { profileDelivery } from '../extension/profile-transport.mjs';

const slot = Symbol.for('slither.client.gate.v1');
const id = 'a'.repeat(32), url = 'https://slither.io/s/game1107249518.js';
const pin = '5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095';
let serial = 0;
async function fixture(options = {}) {
  const module = await import(`../extension/profile-receiver.mjs?synthetic=${serial++}`);
  let mainNow = 0, workerNow = 10000, current = true, allowed = true;
  const timers = new Map(), owned = [], ipc = [], requests = [], consumed = [];
  let timerId = 0, initialized = 0, chunks, reads = 0;
  const bytes = { allocate(size) { const b = new Uint8Array(size); owned.push(b); return b; },
    length: b => b.length, copy: (a,b,i) => a.set(b,i), clear: b => b.fill(0) };
  const setTimeout = (callback, delay) => { const t = ++timerId; timers.set(t,{callback,delay}); return t; };
  const clearTimeout = t => timers.delete(t);
  const isArray=Array.isArray,integer=Number.isInteger;
  const native = { bytes, freeze:Object.freeze, octets:(a,n)=>isArray(a)&&a.length===n&&a.every(v=>integer(v)&&v>=0&&v<=255),
    now: () => mainNow, setTimeout, clearTimeout, wake() {}, cancel() {},
    authorize() { if (!allowed) throw Error('Synthetic untrusted action'); } };
  globalThis[slot] = { verifyExtensionProfile: value => value === native };
  const local = module.createExtensionProfileReceiver(native, () => current, Array(16).fill(37));
  delete globalThis[slot];
  const sender = { id, frameId: 0, tab: { id: 7 }, documentId: 'synthetic-document', url:'http://slither.com/io', origin:'http://slither.com' };
  const api = { runtime: { id, getURL: name => `chrome-extension://${id}/${name}` }, scripting: {
    async executeScript(injection) {
      assert.deepEqual(injection.target,{tabId:7,documentIds:['synthetic-document']});
      assert.equal(injection.world,'MAIN'); assert.equal(injection.func,profileDelivery);
      const args = structuredClone(injection.args); ipc.push({operation:args[1],args, original:injection.args});
      options.beforeInject?.(args[1]);
      const [receiverURL, operation, token, version, protocol, password] = args;
      assert.equal(receiverURL,`chrome-extension://${id}/game/profile-receiver.mjs`);
      let result;
      try { result = operation === 'claim' ? module.claimPendingProfileBroker(token)
        : module.deliverPendingProfileBroker(operation,token,version,protocol,password); }
      finally { token.fill(0); password?.fill(0); }
      return [{frameId:0,documentId:sender.documentId,result}];
    },
  } };
  const source = new Uint8Array(224092).fill(32);
  source.set(new TextEncoder().encode('var synthetic=17;'),181647);
  source.set(new TextEncoder().encode(`var synthetic=[${Array.from({length:20},(_,i)=>i).join(',')}];`),181670);
  chunks = options.chunks ?? [source.slice()];
  const caps = {
    fetch(input,init) { requests.push({input,init}); return options.fetch ? options.fetch() : Promise.resolve({}); },
    digest: async () => { const b=Uint8Array.from(pin.match(/../g),v=>parseInt(v,16)); if(options.badHash)b[0]^=1;owned.push(b); return b; },
    createAbort: () => ({signal:{},abort(){}}), setTimeout, clearTimeout, now:()=>workerNow,
    environment:()=>({origin:`chrome-extension://${id}`,topLevel:false,secureContext:true}),
    responseInfo:()=>({status:200,type:'cors',url,redirected:false,body:{},...options.response}),
    getReader:()=>({}), read: async()=>{reads++; return options.noEOF?{done:false,value:new Uint8Array()}:
      chunks.length?{done:false,value:chunks.shift()}:{done:true,value:undefined};},
    cancelReader(){},releaseReader(){},bytes,
  };
  const receive = createProfileBroker({api,native:{capabilities:caps,now:()=>workerNow,
    random: b=>b.fill(37),setTimeout,clearTimeout},initialize:async()=>{initialized++;await options.initialize?.();},
    Parser:ProfileLiteralParserDouble,createAcquirer:createExtensionLiveProfileAcquirer});
  const wake={type:'slither-client-profile-wake',schema:1,activationId:id,authority:Array(16).fill(37)};
  const begin = () => local.acquirer.acquireForPlay(profile=>{ consumed.push([...profile.password]); options.consume?.(profile); });
  return {module,local,receive,wake,sender,begin,requests,ipc,owned,consumed,timers,
    advance(ms){mainNow+=ms;workerNow+=ms;}, expire(){mainNow=5000;workerNow=15000;for(const {callback} of [...timers.values()])callback();},
    untrust(){allowed=false;},stale(){current=false;}, get reads(){return reads;},get initialized(){return initialized;},
    assertCleared(){assert(owned.every(b=>b.every(v=>v===0))); for(const e of ipc){assert(e.args[2].every(v=>v===0));assert(e.original[2].every(v=>v===0));if(e.args[5])assert(e.args[5].every(v=>v===0));} },
  };
}

test('HTTP-com: one owned Play uses fixed HTTPS, clears secrets, then releases acquisition once', async()=>{
  const f=await fixture(), pending=f.begin();
  assert.equal(f.requests.length,0);
  assert.equal(await f.receive(f.wake,f.sender),true); await pending;
  assert.equal(f.requests.length,1); assert.equal(f.requests[0].input,url);
  assert.deepEqual(Object.fromEntries(Object.entries(f.requests[0].init).filter(([k])=>k!=='signal')),
    {method:'GET',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',keepalive:false});
  assert.equal(f.consumed.length,1); assert.deepEqual(f.consumed[0],Array.from({length:20},(_,i)=>i));
  assert.equal(f.local.acquirer.status().state,'used'); assert.equal(f.reads,2); f.assertCleared();
  await f.receive(f.wake,f.sender); assert.equal(f.requests.length,1);
  await assert.rejects(f.begin());
});

for(const [name,change] of Object.entries({foreign:s=>s.id='b'.repeat(32),subframe:s=>s.frameId=1,
  wrongPath:s=>s.url='http://slither.com/io/',wrongOrigin:s=>s.origin='https://slither.io',missingDocument:s=>delete s.documentId,
  noTab:s=>delete s.tab})) test(`HTTP-com: ${name} sender cannot initialize or fetch`,async()=>{
  const f=await fixture();change(f.sender);assert.equal(await f.receive(f.wake,f.sender),false);assert.equal(f.requests.length,0);assert.equal(f.initialized,0);
});

test('activation, public forged wake and forged acquirer do not issue Play authority',async()=>{
  const f=await fixture();await f.receive(f.wake,f.sender);assert.equal(f.requests.length,0);assert.equal(f.initialized,0);
  f.untrust();await assert.rejects(f.begin());await f.receive(f.wake,f.sender);assert.equal(f.requests.length,0);
  const other=await import(`../extension/profile-receiver.mjs?synthetic=${serial++}`);
  assert.throws(()=>other.createExtensionProfileReceiver({},()=>true));
});

for(const mode of ['dispose','expiry','stale']) test(`HTTP-com: ${mode} while pending cannot deliver or retry`,async()=>{
  const f=await fixture(), pending=f.begin();const rejected=assert.rejects(pending);
  if(mode==='dispose')f.local.acquirer.dispose();else if(mode==='expiry')f.expire();else f.stale();
  await f.receive(f.wake,f.sender); if(mode==='stale')f.local.acquirer.dispose();await rejected;
  assert.equal(f.requests.length,0);assert.equal(f.consumed.length,0);f.assertCleared();
});

for(const [name,response] of Object.entries({redirect:{redirected:true},wrongURL:{url:'https://slither.io/other'},opaque:{type:'opaque'},status:{status:302}}))
 test(`HTTP-com: ${name} response fails closed before consumer`,async()=>{
  const f=await fixture({response}),pending=f.begin(),rejected=assert.rejects(pending);
  assert.equal(await f.receive(f.wake,f.sender),false);f.local.acquirer.dispose();await rejected;
  assert.equal(f.consumed.length,0);assert.equal(f.requests.length,1);f.assertCleared();
});

test('HTTP-com: initialization expiry and worker restart cannot reset a claimed intent',async()=>{
  let f; f=await fixture({initialize:()=>f.advance(5000)});
  const pending=f.begin(),rejected=assert.rejects(pending);
  assert.equal(await f.receive(f.wake,f.sender),false);f.local.acquirer.dispose();await rejected;
  await f.receive(f.wake,f.sender);assert.equal(f.requests.length,0);
});

test('HTTP-com: partial delivery failure clears password and does not release acquiring fence',async()=>{
  const f=await fixture({consume(){throw undefined;}}),pending=f.begin(),rejected=assert.rejects(pending);
  assert.equal(await f.receive(f.wake,f.sender),false);await rejected;f.assertCleared();assert.equal(f.local.acquirer.status().state,'failed');
});

test('serialized transport rejects unsupported receiver URLs before dynamic import',async()=>{
  const token=Array(16).fill(3),password=Array(20).fill(4);
  assert.equal(await profileDelivery('https://example.invalid/','deliver',token,17,19,password),false);
  assert(token.every(v=>v===0));assert(password.every(v=>v===0));
});

for(const [name,options] of Object.entries({hash:{badHash:true},size:{chunks:[new Uint8Array(224093)]},
  short:{chunks:[new Uint8Array(5)]},noEOF:{noEOF:true}})) test(`HTTP-com bounded ${name} failure never consumes a profile`,async()=>{
  const f=await fixture(options),pending=f.begin(),rejected=assert.rejects(pending);
  assert.equal(await f.receive(f.wake,f.sender),false);f.local.acquirer.dispose();await rejected;
  assert.equal(f.consumed.length,0);assert(f.reads<=1024);f.assertCleared();
});

for(const primary of [undefined,null,false]) test(`HTTP-com falsy consumer failure ${String(primary)} stays terminal and clears`,async()=>{
  const f=await fixture({consume(){throw primary;}}),pending=f.begin(),rejected=assert.rejects(pending);
  assert.equal(await f.receive(f.wake,f.sender),false);await rejected;f.assertCleared();
  await f.receive(f.wake,f.sender);assert.equal(f.requests.length,1);
});

test('HTTP-com reentrant disposal before delivery is terminal with no consumer',async()=>{
  let f;f=await fixture({beforeInject(operation){if(operation==='deliver')f.local.acquirer.dispose();}});
  const pending=f.begin(),rejected=assert.rejects(pending);
  assert.equal(await f.receive(f.wake,f.sender),false);await rejected;
  assert.equal(f.consumed.length,0);f.assertCleared();
});

test('HTTP-com clears source/digest before parsed delivery and password before finish acknowledgement',async()=>{
  let f;f=await fixture({beforeInject(operation){
    if(operation==='deliver')for(const b of f.owned.filter(b=>b.length===224092||b.length===32))assert(b.every(v=>v===0));
    if(operation==='finish') {
      for(const b of f.owned.filter(b=>b.length===20))assert(b.every(v=>v===0));
      for(const e of f.ipc.filter(e=>e.operation==='deliver'))assert(e.original[5].every(v=>v===0));
    }
  }});
  const pending=f.begin();assert.equal(await f.receive(f.wake,f.sender),true);await pending;f.assertCleared();
});

test('MAIN parsed receiver uses captured freeze/array admission after mutable page globals change',async()=>{
  const f=await fixture(),pending=f.begin(),token=Array(16).fill(37),password=Array(20).fill(8);
  const freeze=Object.freeze,isArray=Array.isArray;
  let leaked=0,result;
  try {
    Object.freeze=value=>{if(value?.password)leaked++;return freeze(value);};
    Array.isArray=value=>{if(value===password||value===token)leaked++;return isArray(value);};
    f.module.claimPendingProfileBroker(token);
    result=f.module.deliverPendingProfileBroker('deliver',token,17,19,password);
    f.module.deliverPendingProfileBroker('finish',token);
  } finally {Object.freeze=freeze;Array.isArray=isArray;}
  await pending;assert.equal(result,true);assert.equal(leaked,0);assert.equal(f.consumed.length,1);
});
