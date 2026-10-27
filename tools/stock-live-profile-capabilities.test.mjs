// Authored native-style API doubles with private backing. No source fixture,
// profile/password, real fetch, network or browser is used by these tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';

const gateSource = readFileSync(new URL('../extension/game-gate.js', import.meta.url), 'utf8');
const route = 'https://slither.io/s/game1107249518.js';
function fixture({ href = 'https://slither.io/', secure = true, missing, countBytes = false } = {}) {
  const context = createContext({ Event, EventTarget, URL });
  const setup = new Script(`
    globalThis.window = globalThis; globalThis.top = globalThis;
    globalThis.location = { href: ${JSON.stringify(href)}, reload() {} };
    globalThis.isSecureContext = ${secure};
    globalThis.fixture = (() => {
      const calls = { fetch:0, digest:0, abortConstructed:0, aborted:0, reader:0,
        read:0, canceled:0, released:0, sockets:0, scheduled:0, bytesConstructed:0 };
      const events = new EventTarget();
      class Storage { constructor() { this.values = new Map(); }
        getItem(name) { return this.values.get(name) ?? null; }
        setItem(name,value) { this.values.set(name,value); } removeItem(name) { this.values.delete(name); } }
      const dimensions = new WeakMap();
      class Canvas { constructor() { dimensions.set(this,{width:32,height:32}); }
        get width() { return dimensions.get(this).width; } set width(v) { dimensions.get(this).width=v; }
        get height() { return dimensions.get(this).height; } set height(v) { dimensions.get(this).height=v; } }
      class Context { constructor(canvas) { this.target=canvas; } get canvas() { return this.target; }
        drawImage() {} putImageData() {} fill() {} stroke() {} fillRect() {} strokeRect() {} clearRect() {} reset() {} }
      const controllers = new WeakMap(), responses = new WeakMap(), streams = new WeakSet(), readers = new WeakSet();
      const branded = (store,value) => { if (!store.has(value)) throw new TypeError('Synthetic native brand'); return store.get(value); };
      class Abort { constructor() { calls.abortConstructed++; controllers.set(this,{aborted:false}); }
        get signal() { return branded(controllers,this); }
        abort() { branded(controllers,this).aborted=true; calls.aborted++; } }
      class Stream { constructor() { streams.add(this); }
        getReader() { if (!streams.has(this)) throw new TypeError('Synthetic stream brand'); calls.reader++; return new Reader(); } }
      const promiseResolve = Promise.resolve.bind(Promise), promiseReject = Promise.reject.bind(Promise);
      const promiseThen=Promise.prototype.then, apply=Reflect.apply;
      class Reader { constructor() { readers.add(this); }
        read() { if (!readers.has(this)) throw new TypeError('Synthetic reader brand'); calls.read++; return promiseResolve({done:true,value:undefined}); }
        cancel() { if (!readers.has(this)) throw new TypeError('Synthetic reader brand'); calls.canceled++; return promiseResolve(); }
        releaseLock() { if (!readers.has(this)) throw new TypeError('Synthetic reader brand'); calls.released++; } }
      class Response { constructor(info) { responses.set(this,info); }
        get status() { return branded(responses,this).status; } get type() { return branded(responses,this).type; }
        get url() { return branded(responses,this).url; } get redirected() { return branded(responses,this).redirected; }
        get body() { return branded(responses,this).body; } }
      const Buffer = ArrayBuffer;
      let digestResult;
      const subtle = { digest() { if(this!==subtle)throw new Error('Digest receiver'); calls.digest++; return promiseResolve(digestResult===undefined?new Buffer(32):digestResult); } };
      const nativeFetch = function() { if(this!==globalThis)throw new Error('Fetch receiver'); calls.fetch++; return promiseReject(new Error('Synthetic fetch guard: network forbidden')); };
      const document = new EventTarget(); document.readyState='loading';
      Object.assign(globalThis,{document,Storage,localStorage:new Storage(),sessionStorage:new Storage(),
        HTMLCanvasElement:Canvas,CanvasRenderingContext2D:Context,AbortController:Abort,Response,
        ReadableStream:Stream,ReadableStreamDefaultReader:Reader,crypto:{subtle},fetch:nativeFetch,
        performance:{now:()=>123},requestAnimationFrame:()=>{calls.scheduled++;return 1;},cancelAnimationFrame(){},
        setTimeout:()=>{calls.scheduled++;return 1;},clearTimeout(){},setInterval:()=>{calls.scheduled++;return 1;},clearInterval(){},
        queueMicrotask:callback=>promiseResolve().then(callback),WebSocket:function(){calls.sockets++;throw new Error('Synthetic socket guard');},
        addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),postMessage(){} });
      sessionStorage.setItem('__slitherClientArmV1',JSON.stringify({schema:1,build:'gamepage-v1',
        id:'a'.repeat(32),url:location.href,expires:Date.now()+25000}));
      if(${countBytes})globalThis.Uint8Array=new Proxy(Uint8Array,{construct(target,args,newTarget){calls.bytesConstructed++;return Reflect.construct(target,args,newTarget);}});
      return {calls,makeStream:()=>new Stream(),makeResponse:info=>new Response(info),setDigestResult:value=>{digestResult=value;},
        observePromise:(value,resolve,reject)=>apply(promiseThen,value,[resolve,reject]),
        poison() {
          const fail=()=>{throw new Error('Late host mutation used');};
          globalThis.fetch=fail;subtle.digest=fail;globalThis.crypto={subtle:{digest:fail}};
          for(const name of ['status','type','url','redirected','body'])Object.defineProperty(Response.prototype,name,{get:fail,configurable:true});
          Stream.prototype.getReader=fail;Reader.prototype.read=Reader.prototype.cancel=Reader.prototype.releaseLock=fail;
          Object.defineProperty(Abort.prototype,'signal',{get:fail,configurable:true});Abort.prototype.abort=fail;
          const typed=Object.getPrototypeOf(Uint8Array.prototype);
          for(const name of ['length','buffer','byteOffset',Symbol.toStringTag])Object.defineProperty(typed,name,{get:fail,configurable:true});
          typed.set=typed.fill=fail;ArrayBuffer.isView=fail;Object.defineProperty(ArrayBuffer.prototype,'byteLength',{get:fail,configurable:true});
          Promise.prototype.then=fail;globalThis.Promise=fail;globalThis.Uint8Array=fail;globalThis.ArrayBuffer=fail;
          globalThis.AbortController=fail;globalThis.Response=fail;globalThis.ReadableStream=fail;globalThis.ReadableStreamDefaultReader=fail;
          performance.now=fail;globalThis.setTimeout=globalThis.clearTimeout=fail;
          globalThis.isSecureContext=false;location.href='https://www.slither.io/';
          Reflect.apply=fail;
        },
      };
    })();
  `);
  setup.runInContext(context);
  if (missing) runInContext(missing, context);
  new Script(gateSource).runInContext(context);
  const gate = runInContext(`globalThis[Symbol.for('slither.client.gate.v1')]`, context);
  const native = gate.claim(gate.metadata().id);
  return { context, gate, native, cap: native.liveProfile, state: runInContext('fixture', context),
    evaluate: code => runInContext(code, context) };
}

function ownFrozenRecord(record, keys) {
  assert.equal(Object.isFrozen(record), true);
  assert.deepEqual(Object.keys(record).sort(), [...keys].sort());
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(record))) {
    assert.equal(Object.hasOwn(descriptor, 'value'), true);
    assert.equal(descriptor.writable, false); assert.equal(descriptor.configurable, false);
  }
}

test('optional capture and claim do no fetch, digest, abort construction, scheduling or socket work', () => {
  const f = fixture({countBytes:true});
  ownFrozenRecord(f.cap, ['fetch','digest','createAbort','setTimeout','clearTimeout','now','environment',
    'responseInfo','getReader','read','cancelReader','releaseReader','bytes']);
  ownFrozenRecord(f.cap.bytes, ['allocate','length','copy','clear']);
  ownFrozenRecord(f.cap.environment(), ['origin','topLevel','secureContext']);
  assert.deepEqual({ ...f.cap.environment() }, { origin:'https://slither.io',topLevel:true,secureContext:true });
  assert(Object.values(f.state.calls).every(value => value === 0));
  assert.equal(f.gate.metadata().code, 'held');
  assert.throws(() => f.gate.claim('a'.repeat(32)), /claimed/);
});

for (const options of [
  {href:'http://slither.io/'}, {href:'https://www.slither.io/'}, {secure:false},
  ...['delete fetch','delete crypto.subtle.digest','delete AbortController',
    "delete AbortController.prototype.signal", "delete Response.prototype.body",
    'delete ReadableStream', 'delete ReadableStreamDefaultReader.prototype.cancel',
    'delete ArrayBuffer.isView', "delete Promise.prototype.then",
    "Object.defineProperty(globalThis,'crypto',{get(){throw new Error('Synthetic unavailable native');}})"].map(missing => ({missing})),
]) {
  test(`optional unsupported environment/API preserves base held path: ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    assert.equal(Object.hasOwn(f.native, 'liveProfile'), false);
    assert.equal(f.gate.metadata().code, 'held');
    assert.equal(typeof f.native.createSocket, 'function'); assert.equal(typeof f.native.setInput, 'function');
    assert.equal(f.native.now(),123); assert(Object.values(f.state.calls).every(value => value === 0));
  });
}

test('closed profile route rejects arbitrary/request/spoof inputs before native fetch', async () => {
  const f = fixture();
  for (const value of ['http://slither.io/s/game1107249518.js','https://www.slither.io/s/game1107249518.js',
    'https://slither.io/s/game1107249518.js?x=1','https://example.invalid/',{url:route},new String(route),null]) {
    assert.throws(() => f.cap.fetch(value, {}), /Unsupported profile route/);
  }
  assert.equal(f.state.calls.fetch, 0);
  await assert.rejects(f.cap.fetch(route, {}), /Synthetic fetch guard/);
  assert.equal(f.state.calls.fetch, 1);
});

test('native Uint8 brand ignores own scalar/brand shadows, rejects every other view, proxies, spoof and shared backing', () => {
  const f = fixture(), bytes=f.cap.bytes;
  const ordinary=f.evaluate('new Uint8Array([7,8,9])');
  for (const name of ['length','buffer','byteOffset',Symbol.toStringTag]) Object.defineProperty(ordinary,name,{get(){assert.fail('shadow getter read');}});
  assert.equal(bytes.length(ordinary),3);
  const target=bytes.allocate(5); bytes.copy(target,ordinary,1); assert.deepEqual([...target],[0,7,8,9,0]);
  const wrongBrand=new Int8Array(3);Object.defineProperty(wrongBrand,Symbol.toStringTag,{value:'Uint8Array'});
  for (const value of [new Uint8ClampedArray(3),new Uint16Array(3),wrongBrand,new DataView(new ArrayBuffer(3)),
    new Proxy(new Uint8Array(3),{}),{length:3,buffer:new ArrayBuffer(3),[Symbol.toStringTag]:'Uint8Array'},
    f.evaluate('Object.create(Uint8Array.prototype)'),new Uint8Array(new SharedArrayBuffer(3))]) {
    assert.throws(()=>bytes.length(value)); assert.throws(()=>bytes.clear(value));
    assert.throws(()=>bytes.copy(target,value)); assert.throws(()=>bytes.copy(value,target));
  }
  assert.equal(bytes.length(new Uint8Array(0)),0);
});

test('captured set validates before mutation and fill wipes only the passed subview', () => {
  const f = fixture(), bytes=f.cap.bytes;
  const backing=new Uint8Array([1,2,3,4,5]),view=backing.subarray(1,4);
  bytes.clear(view); assert.deepEqual([...backing],[1,0,0,0,5]);
  for(const start of [-1,1.5,Infinity,4,{},undefined]) {
    const target=new Uint8Array([9,9,9]);
    if(start===undefined)continue;
    assert.throws(()=>bytes.copy(target,new Uint8Array([1,2]),start)); assert.deepEqual([...target],[9,9,9]);
  }
  for(const size of [-1,1.5,Infinity,{},'3'])assert.throws(()=>bytes.allocate(size));
});

test('Response native getters ignore scalar/accessor shadows and readers retain exact native object identities', async () => {
  const f=fixture(),cap=f.cap,body=f.state.makeStream();
  const response=f.state.makeResponse({status:200,type:'basic',url:route,redirected:false,body});
  for(const name of ['status','type','url','redirected','body'])Object.defineProperty(response,name,{get(){assert.fail('response shadow read');}});
  const info=cap.responseInfo(response);ownFrozenRecord(info,['status','type','url','redirected','body']);
  assert.deepEqual({...info},{status:200,type:'basic',url:route,redirected:false,body});
  const scalar=f.state.makeResponse({status:200,type:'basic',url:route,redirected:false,body});
  for(const [name,value] of Object.entries({status:999,type:'opaque',url:'https://example.invalid/',redirected:true,body:{}})) {
    Object.defineProperty(scalar,name,{value});
  }
  assert.deepEqual({...cap.responseInfo(scalar)},{...info});
  assert.throws(()=>cap.responseInfo({status:200})); assert.throws(()=>cap.responseInfo(new Proxy(response,{}))); assert.throws(()=>cap.getReader({}));
  const reader=cap.getReader(info.body);const result=await cap.read(reader);assert.equal(result.done,true);
  await cap.cancelReader(reader);cap.releaseReader(reader);
  assert.equal(f.state.calls.reader,1);assert.equal(f.state.calls.read,1);assert.equal(f.state.calls.canceled,1);assert.equal(f.state.calls.released,1);
  for(const method of ['read','cancelReader','releaseReader']) {
    assert.throws(()=>cap[method]({}));assert.throws(()=>cap[method](new Proxy(reader,{})));
  }
});

test('all optional wrappers retain document-start functions/getters/constructors after late host mutation', async () => {
  const f=fixture(),cap=f.cap,body=f.state.makeStream();
  const response=f.state.makeResponse({status:200,type:'basic',url:route,redirected:false,body});
  f.state.poison();
  // The test harness is another realm: assimilating a poisoned foreign Promise
  // with await would itself read that realm's late .then, outside the wrappers.
  const settle=value=>new Promise((resolve,reject)=>f.state.observePromise(value,resolve,reject));
  assert.deepEqual({...cap.environment()},{origin:'https://slither.io',topLevel:true,secureContext:true});
  assert.equal(cap.now(),123);cap.setTimeout(()=>{},1);cap.clearTimeout(1);
  const view=cap.bytes.allocate(4);cap.bytes.copy(view,new Uint8Array([8,9]),1);assert.deepEqual([...view],[0,8,9,0]);cap.bytes.clear(view);assert.equal(cap.bytes.length(view),4);
  const abort=cap.createAbort();ownFrozenRecord(abort,['signal','abort']);assert.equal(abort.signal.aborted,false);abort.abort();assert.equal(abort.signal.aborted,true);
  const info=cap.responseInfo(response);assert.equal(info.body,body);assert.equal(info.status,200);
  const reader=cap.getReader(body);assert.equal((await settle(cap.read(reader))).done,true);await settle(cap.cancelReader(reader));cap.releaseReader(reader);
  const digest=await settle(cap.digest('SHA-256',new Uint8Array([1,2])));assert.equal(cap.bytes.length(digest),32);cap.bytes.clear(digest);
  await assert.rejects(settle(cap.fetch(route,{})),/Synthetic fetch guard/);
  assert.equal(f.state.calls.fetch,1);assert.equal(f.state.calls.digest,1);assert.equal(f.state.calls.abortConstructed,1);assert.equal(f.state.calls.aborted,1);
});

test('digest wraps exactly32 ordinary bytes and rejects shared/spoof inputs without native digest', async () => {
  const f=fixture();
  assert.throws(()=>f.cap.digest('SHA-256',new Uint8Array(new SharedArrayBuffer(1))));
  assert.throws(()=>f.cap.digest('SHA-256',{}));assert.equal(f.state.calls.digest,0);
  const digest=await f.cap.digest('SHA-256',new Uint8Array([1]));
  assert.equal(f.cap.bytes.length(digest),32);assert.equal(digest instanceof ArrayBuffer,false);
  const buffer=f.evaluate('ArrayBuffer.prototype'),old=Object.getOwnPropertyDescriptor(buffer,'byteLength').get;
  assert.equal(Reflect.apply(old,digest.buffer,[]),32);
});

test('digest output must be exactly32 ordinary ArrayBuffer bytes, without own scalar coercion', async () => {
  const f=fixture();
  for(const value of [new ArrayBuffer(31),new ArrayBuffer(33),new SharedArrayBuffer(32),
    new Uint8Array(32),new Proxy(new ArrayBuffer(32),{}),{byteLength:32}]) {
    f.state.setDigestResult(value);
    await assert.rejects(f.cap.digest('SHA-256',new Uint8Array([1])));
  }
  const result=new ArrayBuffer(32);Object.defineProperty(result,'byteLength',{get(){assert.fail('output byteLength shadow read');}});
  f.state.setDigestResult(result);
  assert.equal(f.cap.bytes.length(await f.cap.digest('SHA-256',new Uint8Array([1]))),32);
});
