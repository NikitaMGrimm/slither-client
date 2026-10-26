import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectLoopback, headingByte, loopbackEndpoint, sceneHeading } from '../web/loopback-session.mjs';

test('endpoint cannot select external, aliased or ambiguous destinations', () => {
  assert.equal(loopbackEndpoint('ws://127.0.0.1:8766/slither'), 'ws://127.0.0.1:8766/slither');
  assert.equal(loopbackEndpoint('ws://127.0.0.1:80/slither'), 'ws://127.0.0.1:80/slither');
  for (const url of ['wss://127.0.0.1:8766/slither', 'ws://localhost:8766/slither', 'ws://127.1:8766/slither',
    'ws://example.invalid:8766/slither', 'ws://127.0.0.1:65536/slither', 'ws://127.0.0.1:0/slither',
    'ws://127.0.0.1:08766/slither', 'ws://127.0.0.1:8766/slither?x=1', 'ws://user@127.0.0.1:8766/slither']) {
    assert.throws(() => loopbackEndpoint(url));
  }
  assert.equal(headingByte(1, 0), 0); assert.equal(headingByte(0, 1), 62);
  assert.equal(headingByte(-1, 0), 125); assert.equal(headingByte(0, -1), 188);
  assert.throws(() => headingByte(NaN, 1));
});

test('aiming transforms from canvas to world relative to the actual head', () => {
  const aim = { x: 480, y: 270, width: 960, height: 540, zoom: 1.5, camera: { x: 0, y: 0 }, head: { x: 100, y: 0 } };
  assert.equal(sceneHeading(aim), 125, 'unfollowed head aims left toward world origin');
  assert.equal(sceneHeading({ ...aim, x: 780 }), 0, 'pointer beyond the head aims right');
  assert.equal(sceneHeading({ ...aim, camera: { x: 100, y: 0 }, x: 480, y: 420 }), 62);
  assert.throws(() => sceneHeading({ ...aim, zoom: 0 }));
});

function fixture(overrides = {}) {
  const sockets = []; const statuses = []; let timer; let cancelled = 0; let frames = 0; let resets = 0;
  class Socket {
    constructor(url) { this.url = url; this.sent = []; this.bufferedAmount = 0; this.closed = 0; sockets.push(this); }
    send(bytes) { this.sent.push([...bytes]); }
    close() { this.closed++; }
  }
  let head = null;
  const scene = { reset() { resets++; }, apply_frame() { frames++; head = {}; }, snapshot() { return JSON.stringify({ ownHead: head }); } };
  const wasm = { encode_login() { return Uint8Array.of(115, 30); }, decode_frame() { return Uint8Array.of(0, 0, 0, 1, 112); } };
  const session = connectLoopback({ url: 'ws://127.0.0.1:8766/slither', wasm, scene, skin: 0, onFrame() {}, onStatus: text => statuses.push(text), Socket,
    schedule(fn) { timer = fn; return 42; }, cancel(id) { assert.equal(id, 42); cancelled++; }, ...overrides });
  return { session, socket: sockets[0], sockets, statuses, tick: () => timer(), counts: () => ({ cancelled, frames, resets }) };
}

test('local session negotiates once, applies frames, sends bounded controls and tears down', () => {
  const f = fixture(); f.socket.onopen();
  assert.deepEqual(f.socket.sent, [[1], [115, 30]]); assert.equal(f.counts().resets, 1);
  f.socket.onmessage({ data: new ArrayBuffer(1) });
  f.session.setInput(125, true); f.tick();
  assert.deepEqual(f.socket.sent.slice(-2), [[125], [253]]);
  f.tick(); assert.deepEqual(f.socket.sent.at(-1), [125]);
  f.tick(); assert.deepEqual(f.socket.sent.at(-1), [251]);
  assert.throws(() => f.session.setInput(251, false));
  f.session.close(); f.session.close(); f.tick(); f.socket.onmessage({ data: new ArrayBuffer(1) });
  assert.equal(f.sockets.length, 1); assert.equal(f.socket.closed, 1);
  assert.deepEqual(f.counts(), { cancelled: 1, frames: 1, resets: 1 });
});

test('connection/open, setup, missing pong and congested sends all stop without retry', () => {
  const unopened = fixture(); for (let n = 0; n < 50; n++) unopened.tick();
  assert.equal(unopened.socket.closed, 1); unopened.socket.onopen(); assert.equal(unopened.socket.sent.length, 0);
  const noSetup = fixture(); noSetup.socket.onopen(); for (let n = 0; n < 50; n++) noSetup.tick();
  assert.equal(noSetup.socket.closed, 1);
  const noPong = fixture(); noPong.socket.onopen(); noPong.socket.onmessage({ data: new ArrayBuffer(1) });
  for (let n = 0; n < 53; n++) noPong.tick(); assert.equal(noPong.socket.closed, 1);
  const full = fixture(); full.socket.onopen(); full.socket.onmessage({ data: new ArrayBuffer(1) }); full.socket.bufferedAmount = 4097; full.tick();
  assert.equal(full.socket.closed, 1);
});

test('malformed local frames close session and clear its timer', () => {
  for (const data of ['text', new ArrayBuffer(1024 * 1024 + 1)]) {
    const f = fixture(); f.socket.onopen(); f.socket.onmessage({ data });
    assert.equal(f.socket.closed, 1); assert.equal(f.counts().frames, 0); assert.equal(f.counts().cancelled, 1);
  }
  const f = fixture({ scene: { reset() {}, apply_frame() { throw new Error('synthetic malformed body'); } } });
  f.socket.onopen(); f.socket.onmessage({ data: new ArrayBuffer(1) }); assert.equal(f.socket.closed, 1);
});

test('self removal ends a local life without a timeout or automatic reconnect', () => {
  let head = {};
  const f = fixture({ scene: { reset() {}, apply_frame() {}, snapshot: () => JSON.stringify({ ownHead: head }) } });
  f.socket.onopen(); f.socket.onmessage({ data: new ArrayBuffer(1) });
  head = null; f.socket.onmessage({ data: new ArrayBuffer(1) });
  assert.equal(f.statuses.at(-1), 'Local life ended'); assert.equal(f.socket.closed, 1);
  assert.equal(f.counts().cancelled, 1); assert.equal(f.sockets.length, 1);
});
