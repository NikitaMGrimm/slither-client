// Labelled inert Wasm/socket doubles exercise actual production adapter ownership only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHost } from '../web/local-host.mjs';
function fixture(make) {
  const log = [], sockets = [], queue = [];
  let generation = 1, next = 9007199254740999n, time = 123;
  const add = (kind, data) => queue.push({ kind, data, id: next++, generation });
  const owner = {
    play() { add(1, 'ws://127.0.0.1:19491/slither'); },
    effect_kind: () => queue[0]?.kind ?? 0, effect_id: () => queue[0].id,
    effect_generation: () => queue[0].generation, effect_url: () => queue[0].data,
    effect_bytes: () => queue[0].data,
    construct(g, id, time) { assert.equal(g, queue[0].generation); assert.equal(id, queue[0].id); log.push(['begin-construct',g,id,time]); },
    acknowledge(g, id, ok) { assert.equal(g, queue[0].generation); assert.equal(id, queue[0].id); assert.equal(typeof id, 'bigint'); log.push(['ack', id, ok]); queue.shift(); if (!ok) this.fail(); },
    opened(g, time) { log.push(['opened', g, time]); add(2, Uint8Array.of(1)); add(2, Uint8Array.of(99, 0)); },
    receive(g, b, t) { log.push(['received', g, [...b], t]); },
    closed(g) { log.push(['closed', g]); },
    fail() { log.push(['fail']); queue.length = 0; if (sockets.length) add(3); },
    stop() { queue.length = 0; add(3); log.push(['stop']); },
    free() { log.push(['free']); }, hud: () => 'RUST HUD', can_play: () => true,
    frame(...args) { log.push(['frame', ...args]); }, flush(...args) { log.push(['flush', ...args]); },
  };
  function construct(url) {
    const socket = { readyState: 1, bufferedAmount: 0, send(b) { log.push(['send', [...b]]); }, close() { log.push(['close']); this.onclose?.(); } };
    sockets.push(socket); log.push(['construct', url]); make?.(socket); return socket;
  }
  const host = localHost({ owner, socket: construct, now: () => time, extent: () => [960, 540, 1], readout: (s) => log.push(['hud', s]) });
  return { host, owner, log, sockets, clock: value => { time=value; }, restart: () => generation++ };
}
test('no implicit socket; full-u64 effects acknowledged outside callbacks; copied binary receive', () => {
  const f = fixture(); f.host.frame(20); assert.equal(f.sockets.length, 0);
  f.host.call(() => f.owner.play()); const s = f.sockets[0]; assert.equal(s.binaryType, 'arraybuffer');
  s.onopen(); assert.deepEqual(f.log.filter(x => x[0] === 'send'), [['send', [1]], ['send', [99, 0]]]);
  s.onmessage({ data: Uint8Array.of(0, 2, 112).buffer });
  assert.deepEqual(f.log.find(x => x[0] === 'received'), ['received', 1, [0, 2, 112], 123]);
});
test('failed send preserves exact undefined, closes once and suppresses later effects', () => {
  const f = fixture(s => { s.send = () => { throw undefined; }; }); f.host.call(() => f.owner.play()); f.sockets[0].onopen();
  assert.deepEqual(f.host.failure(), { failed: true, failure: undefined });
  assert.equal(f.log.filter(x => x[0] === 'close').length, 1); assert.equal(f.log.filter(x => x[0] === 'send').length, 0);
});
test('remote-close and stale-generation handlers are fenced; explicit restart only', () => {
  const f = fixture(); f.host.call(() => f.owner.play()); const old = f.sockets[0]; const late = old.onmessage;
  old.onclose(); late({ data: new ArrayBuffer(0) }); assert.equal(f.log.filter(x => x[0] === 'received').length, 0);
  f.host.frame(100); assert.equal(f.sockets.length, 1); f.restart(); f.host.call(() => f.owner.play()); assert.equal(f.sockets.length, 2); late({ data: new ArrayBuffer(0) }); assert.equal(f.log.filter(x => x[0] === 'received').length, 0);
});
test('nonbinary and oversized frames fail before Wasm receive', () => {
  for (const data of ['text', new ArrayBuffer(1048577)]) {
    const f = fixture(); f.host.call(() => f.owner.play()); f.sockets[0].onmessage({ data }); assert.equal(f.host.failure().failed, true); assert.equal(f.log.filter(x => x[0] === 'received').length, 0); f.host.dispose();
  }
});
test('dispose detaches before synchronous close, frees once, no late owner calls', () => {
  const f = fixture(); f.host.call(() => f.owner.play()); const late = f.sockets[0].onopen; f.host.dispose(); f.host.dispose(); late(); f.host.frame(5);
  assert.equal(f.log.filter(x => x[0] === 'free').length, 1); assert.equal(f.log.filter(x => x[0] === 'opened').length, 0);
});
test('partial constructor setup failure closes the owned socket', () => {
  const f = fixture(s => Object.defineProperty(s, 'binaryType', { set() { throw new Error('setter failure'); } }));
  f.host.call(() => f.owner.play()); assert.match(f.host.failure().failure.message, /setter failure/); assert.equal(f.log.filter(x => x[0] === 'close').length, 1);
});
test('GPU failure stops further frame attempts and disables Play without reconnect', () => {
  const f = fixture(); let frames = 0;
  f.owner.frame = () => { frames++; throw new Error('device lost'); };
  f.host.frame(1); f.host.frame(2); assert.equal(frames, 1); assert.equal(f.sockets.length, 0);
  assert.match(f.host.failure().failure.message, /device lost/); f.host.dispose();
});
test('fresh host clocks fence actual construction, open and presentation flush', () => {
  const f=fixture();f.clock(5000);f.host.call(()=>f.owner.play());
  const begin=f.log.findIndex(x=>x[0]==='begin-construct');const native=f.log.findIndex(x=>x[0]==='construct');
  assert.ok(begin>=0 && begin<native);assert.equal(f.log[begin][3],5000);
  f.clock(5001);f.sockets[0].onopen();assert.deepEqual(f.log.find(x=>x[0]==='opened'),['opened',1,5001]);
  assert.deepEqual(f.log.filter(x=>x[0]==='flush').at(-1),['flush',5001,960,540,1]);
});
test('failed fresh-construction admission creates no socket', () => {
  const f=fixture();f.owner.construct=()=>{throw undefined;};f.host.call(()=>f.owner.play());
  assert.equal(f.sockets.length,0);assert.deepEqual(f.host.failure(),{failed:true,failure:undefined});
});
