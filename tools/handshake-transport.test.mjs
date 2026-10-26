import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runHandshakeTransport } from './handshake-transport.mjs';

// Synthetic clock/transport: no socket, DNS, HTTP, or real timer is used.
function fixture(receive, { constructorError = false } = {}) {
  let time = 0;
  let constructs = 0;
  let options;
  const timers = new Set();
  const sent = [];
  const socket = new EventEmitter();
  Object.assign(socket, {
    readyState: 0, closes: 0, terminations: 0,
    send(bytes) { sent.push({ time, bytes: [...bytes] }); },
    close() { this.closes++; this.readyState = 2; },
    terminate() { this.terminations++; this.readyState = 3; },
  });
  const session = { state: 'challenge', start: () => [Uint8Array.of(1), Uint8Array.of(99, 0)], receive };
  const result = runHandshakeTransport({
    endpoint: 'ws://127.0.0.1:1/slither', session, started: 0, now: () => time,
    schedule(callback, delay) { const timer = { callback, at: time + delay }; timers.add(timer); return timer; },
    cancel(timer) { timers.delete(timer); },
    createSocket(_url, settings) { constructs++; options = settings; if (constructorError) throw new Error('synthetic constructor failure'); return socket; },
  });
  return {
    socket, session, result, sent, timers, setTime(value) { time = value; },
    get constructs() { return constructs; }, get options() { return options; },
    open() { socket.readyState = 1; socket.emit('open'); },
    message() { socket.emit('message', Buffer.from([54, 1]), true); },
    fireTimers() { for (const timer of [...timers]) if (timer.at <= time && timers.delete(timer)) timer.callback(); },
  };
}

test('challenge processing crossing the deadline sends neither reply nor login', async () => {
  const f = fixture(() => { f.setTime(10001); return { outbound: [Uint8Array.of(2), Uint8Array.of(3)], complete: false }; });
  f.open(); f.setTime(9999); f.message();
  const result = await f.result;
  assert.equal(result.success, false); assert.match(result.reason, /deadline/);
  assert.deepEqual(f.sent.map(item => item.bytes), [[1], [99, 0]]);
  assert.equal(f.socket.terminations, 1); assert.equal(f.timers.size, 0);
});

test('late open and late setup cannot send or succeed', async () => {
  const lateOpen = fixture(() => { throw new Error('unused'); });
  lateOpen.setTime(10000); lateOpen.open();
  assert.equal((await lateOpen.result).success, false); assert.deepEqual(lateOpen.sent, []);
  const lateSetup = fixture(() => { lateSetup.setTime(10000); return { outbound: [], complete: true, protocolVersion: 19 }; });
  lateSetup.open(); lateSetup.message();
  assert.equal((await lateSetup.result).success, false);
});

test('deadline is checked between individual sends', async () => {
  const f = fixture(() => ({ outbound: [Uint8Array.of(2), Uint8Array.of(3)], complete: false }));
  f.open();
  const send = f.socket.send;
  f.socket.send = bytes => { send(bytes); f.setTime(10001); };
  f.message();
  assert.equal((await f.result).success, false);
  assert.deepEqual(f.sent.map(item => item.bytes), [[1], [99, 0], [2]]);
});

test('constructor failure consumes one invocation and leaves no timers', async () => {
  const f = fixture(() => {}, { constructorError: true });
  assert.match((await f.result).reason, /constructor failure/);
  assert.equal(f.constructs, 1); assert.equal(f.timers.size, 0);
  assert.equal(f.options.followRedirects, false); assert.equal(f.options.maxRedirects, 0);
});

test('success closes immediately; uncooperative teardown is forced within the deadline', async () => {
  const f = fixture(() => ({ outbound: [], complete: true, protocolVersion: 19 }));
  f.open(); f.setTime(9990); f.message();
  assert.equal(f.socket.closes, 1);
  f.setTime(10000); f.fireTimers();
  const result = await f.result;
  assert.equal(result.success, false); assert.equal(f.socket.terminations, 1);
  f.socket.emit('open'); f.message();
  assert.deepEqual(f.sent.map(item => item.bytes), [[1], [99, 0]]);
});

test('setup followed by timely close succeeds without processing late events', async () => {
  const f = fixture(() => ({ outbound: [], complete: true, protocolVersion: 19 }));
  f.open(); f.message(); f.socket.readyState = 3; f.socket.emit('close', 1000);
  assert.equal((await f.result).success, true); assert.equal(f.timers.size, 0);
  f.socket.emit('error', new Error('late synthetic error')); f.message();
  assert.equal(f.socket.terminations, 0);
});
