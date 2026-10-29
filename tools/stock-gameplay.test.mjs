import { TestSessionPolicy } from './fixtures/session-policy-double.mjs';
import { TestDesktopInput } from './fixtures/client-input-fixture.mjs';
// Original synthetic protocol, scene and native scheduling doubles; no real socket.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockGameplay } from '../web/stock-gameplay.mjs';
import { createStockClient } from './fixtures/stock-client-fixture.mjs';

const request = () => ({ endpoint: 'ws://192.0.2.9:1234/slither',
  profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 },
  nickname: 'Synthetic', skin: 0, customSkin: new Uint8Array() });
const own = (token = 1n, dead = false) => ({ token, id: 7, rawHead: { x: 300, y: 400 },
  wantedHeading: 0.4, gazeHeading: 0, dead, turnRate: 0.03, sizeTurnFactor: 1, speedTurnFactor: 1 });
const frame = commands => Uint8Array.from(commands.length === 1 ? commands[0] : commands.flatMap((c, i) =>
  i === 0 ? [0, c.length, ...c] : [c.length + 32, ...c])).buffer;

function harness({ useStockController = false, InputPolicy = TestDesktopInput } = {}) {
  let time = 0, borrowed = false, ingress = false, serial = 0;
  let nativeConnected = false, currentOwn = null, stopped = false;
  const trace = [], sockets = [], pending = [], intervals = new Map(), errors = [], statuses = [], faults = {};
  const outside = () => { assert.equal(borrowed, false, 'native borrow reentry'); assert.equal(ingress, false, 'session ingress reentry'); };
  const scene = {
    control_view() { outside(); return { own: currentOwn, camera: { x: 100, y: 200 }, follows: faults.follow !== false, zoom: 0.5, connected: nativeConnected }; },
    set_connected(value) { outside(); trace.push(['set-connected', value]); nativeConnected = value; },
    reset_lag() { outside(); trace.push(['reset-lag']); },
  };
  function nativeStep(nowMs, lagging, callback) {
    outside(); assert.equal(stopped, false);
    const control = scene.control_view();
    borrowed = true;
    let actions;
    try {
      trace.push(['control']);
      actions = callback({ nowMs, wholeSteps: faults.wholeSteps ?? 1, delta: faults.delta ?? 1, control });
      trace.push(['actions', actions]);
      if (faults.numeric) throw faults.numeric;
      if (actions.resetWorld) { currentOwn = null; nativeConnected = false; }
      if (actions.connected !== undefined) nativeConnected = actions.connected;
      trace.push(['motion', actions.gazeHeading]);
    } finally { borrowed = false; }
    return actions;
  }
  const quality = {
    begin_connection() { outside(); trace.push(['quality-connection']); },
    advance(step, playing) { outside(); trace.push(['quality', playing]); },
    update_statistics(nowMs, count, playing) { outside(); trace.push(['statistics', playing]); return false; },
  };
  let controller = {
    packet(bytes, elapsed) {
      assert.equal(borrowed, false); assert.equal(elapsed, false); trace.push(['packet', [...bytes]]);
      if (Object.hasOwn(faults, 'packet')) throw faults.packet;
      if (faults.packetEffect) faults.packetEffect();
      return 2;
    },
    frame(nowMs, options) {
      outside(); assert.equal(stopped, false); trace.push(['before-step', nowMs, options.lagging, options.playing]);
      const actions = nativeStep(nowMs, options.lagging, options.control);
      const playing = options.readPlaying();
      trace.push(['quality', playing], ['free-step'], ['statistics', playing], ['render']);
      if (faults.render) throw faults.render;
      trace.push(['end-operation']);
      return actions;
    },
  };
  if (useStockController) {
    const packet = controller.packet;
    Object.assign(scene, {
      advance() { assert.fail('Production gameplay must use the pre-motion seam'); },
      set_gaze_heading() { assert.fail('Production gaze must be a closed control action'); },
      advance_with_control(nowMs, lagging, callback) {
        trace.push(['before-step', nowMs, lagging]); nativeStep(nowMs, lagging, callback);
        return { free() { outside(); trace.push(['free-step']); } };
      },
      apply_frame_and_render_standard_with_face_presentation_and_prey: packet,
      render_standard_with_face_presentation_at_size() {
        outside(); trace.push(['render']); if (faults.render) throw faults.render;
      },
    });
    controller = createStockClient({ scene, quality,
      adapter: {
        beginOperation() { trace.push(['begin-operation']); return { revision: 'synthetic' }; },
        endOperation() { trace.push(['end-operation']); },
        resolveAppearance() {}, resolveRecipe() {}, resolveAntennaRandom() {},
      },
      hostAssets: { resolveFood() {}, resolvePrey() {} },
      target: {}, palettes: [{}, {}, {}], background: {}, width: 960, height: 540,
    });
  }
  const gameplay = createStockGameplay({ scene, controller,
    quality,
    wasm: { DesktopInput: InputPolicy, SessionPolicy: TestSessionPolicy,
      encode_login() { return Uint8Array.of(115, 1); }, solve_challenge() { return new Uint8Array(27); },
      setup_protocol_version() { return 19; },
      decode_frame(bytes) {
        const commands = [];
        if (bytes[0] >= 32) commands.push([...bytes]);
        else for (let i = 0; i < bytes.length;) {
          const prefix = bytes[i++], length = prefix < 32 ? prefix * 256 + bytes[i++] : prefix - 32;
          commands.push([...bytes.slice(i, i + length)]); i += length;
        }
        return Uint8Array.from(commands.flatMap(c => [0, 0, 0, c.length, ...c]));
      },
    },
    createSocket(endpoint) {
      outside(); trace.push(['construct', endpoint]);
      const socket = { readyState: 0, bufferedAmount: 0, sent: [], closes: 0,
        send(bytes) { trace.push(['send', [...bytes]]); this.sent.push([...bytes]); faults.onSend?.(bytes); if (faults.send) throw faults.send; },
        close() { this.closes++; this.readyState = 3; trace.push(['close']); },
        open() { this.readyState = 1; ingress = true; try { this.onopen?.(); } finally { ingress = false; } },
        message(...commands) { ingress = true; try { this.onmessage?.({ data: frame(commands) }); } finally { ingress = false; } },
      };
      sockets.push(socket); return socket;
    },
    now: () => time,
    defer(callback) { pending.push(callback); },
    setInterval(callback, delay) { outside(); assert.equal(delay, 25); const id = ++serial; intervals.set(id, callback); return id; },
    clearInterval(id) { outside(); intervals.delete(id); },
    onStatus(code) { outside(); statuses.push(code); },
    onFatal(error) { outside(); errors.push(error); stopped = true; trace.push(['fatal']); },
  });
  const flush = () => { for (let i = 0; pending.length; i++) { assert(i < 100); pending.shift()(); } };
  const at = value => { time = value; };
  const tick = value => { at(value); const result = gameplay.frame(value); flush(); return result; };
  const event = (type, value = {}) => gameplay.event({ type, ...value }, { width: 960, height: 540 });
  const start = () => { gameplay.play(request()); assert.equal(sockets.length, 0); tick(8); sockets[0].open(); sockets[0].message([54, 1]); };
  const connected = () => { start(); sockets[0].message([97]); flush(); };
  return { gameplay, trace, sockets, intervals, errors, statuses, faults, tick, event, flush, at, start, connected,
    setOwn(value) { currentOwn = value; },
    interval(value) { at(value); for (const callback of [...intervals.values()]) callback(); },
  };
}

test('default and invalid/missing profile construct zero sockets; successful whole operation commits one attempt', () => {
  const h = harness(); h.tick(1);
  assert.equal(h.gameplay.diagnostics().session.phase, 'ready'); assert.equal(h.sockets.length, 0);
  const missing = request(); delete missing.profile;
  assert.throws(() => h.gameplay.play(missing), /Missing profile/);
  assert.equal(h.errors.length, 0); assert.equal(h.sockets.length, 0);
  h.gameplay.play(request()); assert.equal(h.sockets.length, 0);
  assert.deepEqual(h.tick(8), { resetWorld: true, connected: false });
  assert.equal(h.sockets.length, 1);
  const keys = h.trace.map(c => c[0]); assert(keys.lastIndexOf('end-operation') < keys.indexOf('construct'));
  assert.throws(() => h.gameplay.play(request()), /one manual Play/i);
  h.tick(16); assert.equal(h.sockets.length, 1);
  h.gameplay.dispose(); h.gameplay.dispose(); assert.equal(h.sockets[0].closes, 1);
});

for (const fault of ['numeric', 'render']) {
  test(`staged Play opens none after ${fault} failure and never retries`, () => {
    const h = harness(), error = new Error(`synthetic ${fault}`);
    h.gameplay.play(request()); h.faults[fault] = error;
    assert.throws(() => h.gameplay.frame(8), value => value === error);
    assert.equal(h.errors.length, 0); assert.equal(h.sockets.length, 0);
    h.flush(); assert.equal(h.errors[0], error); assert.equal(h.gameplay.diagnostics().disposed, true);
    assert.throws(() => h.gameplay.frame(16), /stopped/); assert.equal(h.sockets.length, 0);
  });
}

test('cancel before first step opens none', () => {
  const h = harness(); h.gameplay.play(request()); h.gameplay.dispose(); h.flush();
  assert.equal(h.sockets.length, 0); assert.equal(h.intervals.size, 0);
});

test('Setup connects without own; entire bundled packet applies once and UI owns one 25ms interval', () => {
  const h = harness(); h.start();
  const packet = [[97], [112], [115, 0, 1]];
  h.sockets[0].message(...packet);
  assert.equal(h.trace.filter(c => c[0] === 'packet').length, 1);
  assert.equal(h.gameplay.diagnostics().session.connected, true);
  assert.equal(h.gameplay.diagnostics().input.own, null);
  assert.equal(h.intervals.size, 0, 'notification only during ingress'); h.flush();
  assert.equal(h.intervals.size, 1);
  h.sockets[0].message([97]); h.flush(); assert.equal(h.intervals.size, 1);
  const advances = h.trace.filter(c => c[0] === 'before-step').length;
  h.interval(508); assert.equal(h.intervals.size, 0);
  assert.equal(h.gameplay.diagnostics().session.returnFraction, 1);
  assert.equal(h.trace.filter(c => c[0] === 'before-step').length, advances, 'UI timer never advances motion/input');
  const before = h.sockets[0].sent.length;
  h.tick(600); assert.deepEqual(h.sockets[0].sent.slice(before), [[251]], 'no-own ping is connected-only');
});

test('keyboard, ping, boost and gaze precede motion on the single copied step, with no double debt', () => {
  const h = harness(); h.connected(); h.setOwn(own());
  h.event('pointermove', { clientX: 580, clientY: 370 }); h.event('keydown', { code: 'ArrowLeft' });
  h.event('keydown', { code: 'Space' });
  const before = h.sockets[0].sent.length;
  const actions = h.tick(300), sent = h.sockets[0].sent.slice(before);
  assert.equal(sent[0][0], 252); assert.deepEqual(sent[1], [251]); assert.deepEqual(sent[2], [253]);
  assert.equal(sent[0][1], 1, 'one step of left debt, not two');
  assert.equal(actions.gazeHeading, Math.PI / 4);
  const motion = h.trace.findLastIndex(c => c[0] === 'motion');
  assert(h.trace.findLastIndex(c => c[0] === 'send') < motion);
  assert.equal(h.gameplay.diagnostics().input.leftSteps, 0);
});

test('due close accumulates debt before lifecycle, sends none, resets before motion and retains globals', () => {
  const h = harness(); h.connected(); h.setOwn(own(1n, true)); h.interval(508);
  h.event('keydown', { code: 'ArrowLeft' }); h.sockets[0].message([118, 2]); h.flush();
  const before = h.sockets[0].sent.length, actions = h.tick(520);
  assert.deepEqual(actions, { resetWorld: true, connected: false });
  assert.equal(h.sockets[0].sent.length, before);
  const state = h.gameplay.diagnostics(); assert.equal(state.input.leftSteps, 1); assert.equal(state.input.leftHeld, true);
  assert.equal(state.input.connected, false); assert.equal(state.input.own, null); assert.equal(state.session.connected, false);
  assert.equal(h.sockets[0].closes, 1); assert.equal(h.errors.length, 0);
});

test('retained dead/removed own remains steerable and does not end life; token, not wire ID, identifies input', () => {
  const h = harness(); h.connected(); h.setOwn(own(1n, true));
  h.sockets[0].message([115, 0, 7, 1]); h.flush();
  assert.equal(h.gameplay.diagnostics().session.lifeEnded, false);
  h.event('keydown', { code: 'Space' }); const before = h.sockets[0].sent.length; h.tick(100);
  assert.deepEqual(h.sockets[0].sent.slice(before), [[253]]);
  h.setOwn(own(2n)); h.tick(108);
  assert.equal(h.gameplay.diagnostics().input.own.token, 2n);
  assert.equal(h.gameplay.diagnostics().input.own.requestedBoost, false);
  h.event('blur'); assert.equal(h.sockets[0].sent.length, before + 1);
});

test('pointer event uses copied raw head/camera/zoom and ceiled CSS viewport before motion', () => {
  const h = harness(); h.connected(); h.setOwn(own()); h.faults.follow = false;
  h.event('pointermove', { clientX: 580, clientY: 370 });
  assert.deepEqual(h.gameplay.diagnostics().input.pointer, { x: 0, y: 0 });
  assert.equal(h.trace.filter(c => c[0] === 'before-step').length, 1);
});

test('pong never resets lag; committed gameOver resets once before next FrameClock and selectively acknowledges', () => {
  const h = harness(); h.connected(); h.tick(300);
  h.sockets[0].message([112]); h.flush(); assert.equal(h.trace.filter(c => c[0] === 'reset-lag').length, 0);
  h.sockets[0].message([118, 1]);
  assert.equal(h.trace.filter(c => c[0] === 'reset-lag').length, 0, 'no native scene call during ingress');
  h.flush(); assert.equal(h.trace.filter(c => c[0] === 'reset-lag').length, 1);
  h.tick(320); h.flush(); assert.equal(h.trace.filter(c => c[0] === 'reset-lag').length, 1);
  assert(h.trace.findIndex(c => c[0] === 'reset-lag') < h.trace.findIndex(c => c[0] === 'before-step' && c[1] === 320));
  assert.equal(h.gameplay.diagnostics().session.connected, true);
  assert.equal(h.gameplay.diagnostics().session.playing, true);
  assert.equal(h.gameplay.diagnostics().session.lifeEnded, true);
});

test('lag acknowledgement leaves a simultaneous terminal world reset pending for the native transaction', () => {
  const h = harness(); h.connected(); h.setOwn(own());
  h.sockets[0].message([118, 0]); h.sockets[0].onclose();
  h.flush(); assert.equal(h.trace.filter(c => c[0] === 'reset-lag').length, 1);
  assert.deepEqual(h.tick(32), { resetWorld: true, connected: false });
  assert.equal(h.gameplay.diagnostics().input.own, null);
  assert.equal(h.gameplay.diagnostics().session.connected, false);
  assert.equal(h.sockets.length, 1);
});

test('session notification during native due-close only latches; UI cancellation waits beyond the borrow', () => {
  const h = harness(); h.connected(); h.sockets[0].message([118, 2]); h.flush();
  assert.equal(h.intervals.size, 1);
  assert.deepEqual(h.tick(32), { resetWorld: true, connected: false });
  assert.equal(h.intervals.size, 0); assert.equal(h.sockets[0].closes, 1); assert.equal(h.errors.length, 0);
});

test('v0 return waits for UI fade completion and strict death age; playing can end while victory remains connected', () => {
  for (const variant of [0, 1]) {
    const h = harness(); h.connected(); h.sockets[0].message([118, variant]); h.flush();
    h.interval(508); h.tick(1608);
    assert.equal(h.gameplay.diagnostics().session.playing, true, 'strict death age excludes equality');
    h.faults.delta = 5;
    for (let i = 0; i < 51; i++) h.tick(1609 + i * 8);
    const state = h.gameplay.diagnostics().session;
    assert.equal(state.playing, false); assert.equal(state.connected, variant === 1);
    assert.equal(h.sockets[0].closes, variant === 0 ? 1 : 0);
    assert.equal(h.errors.length, 0);
  }
});

test('actual stock controller samples lifecycle true-to-false for quality and statistics in the same native step', () => {
  for (const variant of [0, 1]) {
    const h = harness({ useStockController: true }); h.connected(); h.interval(508);
    h.sockets[0].message([118, variant]); h.flush();
    h.faults.delta = 5;
    let transition;
    for (let i = 0; i < 51 && !transition; i++) {
      assert.equal(h.gameplay.diagnostics().session.playing, true);
      const start = h.trace.length;
      h.tick(2110 + i * 8);
      if (!h.gameplay.diagnostics().session.playing) transition = h.trace.slice(start);
      else {
        assert.equal(h.trace.findLast(c => c[0] === 'quality')[1], true);
        assert.equal(h.trace.findLast(c => c[0] === 'statistics')[1], true);
      }
    }
    assert(transition, 'one native lifecycle operation must end playing');
    assert.deepEqual(transition.filter(c => ['control', 'motion', 'quality', 'free-step', 'statistics', 'render', 'end-operation'].includes(c[0]))
      .map(c => c[0] === 'quality' || c[0] === 'statistics' ? c : [c[0]]),
    [['control'], ['motion'], ['quality', false], ['free-step'], ['statistics', false], ['render'], ['end-operation']]);
    assert.equal(transition.filter(c => c[0] === 'before-step').length, 1);
    assert.equal(h.gameplay.diagnostics().session.connected, variant === 1);
    assert.equal(h.errors.length, 0);
  }
});

test('lag flags use outstanding ping from previous frame; no invented five-second pong timeout', () => {
  const h = harness(); h.connected(); h.tick(300); h.tick(1050); h.tick(1051); h.tick(10000);
  const steps = h.trace.filter(c => c[0] === 'before-step');
  assert.equal(steps.find(c => c[1] === 1050)[2], false); assert.equal(steps.find(c => c[1] === 1051)[2], true);
  assert.equal(h.sockets[0].closes, 0); assert.equal(h.gameplay.diagnostics().session.connected, true);
});

test('packet failure propagates into session and defers terminal cleanup beyond ingress', () => {
  const h = harness(); h.connected(); const error = new Error('synthetic packet rejection'); h.faults.packet = error;
  h.sockets[0].message([118, 1], [115, 0]);
  assert.equal(h.trace.filter(c => c[0] === 'packet').length, 2);
  assert.equal(h.errors.length, 0); assert.equal(h.gameplay.diagnostics().session.phase, 'failed');
  assert.equal(h.gameplay.diagnostics().session.lifeEnded, false, 'rejected controls never commit');
  h.flush(); assert.equal(h.errors[0], error); assert.equal(h.sockets[0].closes, 1); assert.equal(h.intervals.size, 0);
  assert.equal(h.trace.filter(c => c[0] === 'reset-lag').length, 0);
});

test('a non-Error thrown value remains terminal and is passed unchanged after ingress unwinds', () => {
  const h = harness(); h.connected(); h.faults.packet = undefined;
  h.sockets[0].message([112]); assert.equal(h.errors.length, 0);
  h.flush(); assert.equal(h.errors.length, 1); assert.equal(h.errors[0], undefined);
  assert.equal(h.gameplay.diagnostics().disposed, true); assert.equal(h.sockets[0].closes, 1);
});

test('send failure inside control latches only, preserves attempts and never replays later phases', () => {
  const h = harness(); h.connected(); h.setOwn(own()); h.event('keydown', { code: 'ArrowLeft' });
  h.event('keydown', { code: 'Space' }); const error = new Error('synthetic send failure'); h.faults.send = error;
  assert.throws(() => h.gameplay.frame(300), value => value === error);
  assert.equal(h.errors.length, 0); h.flush(); assert.equal(h.errors[0], error);
  assert.deepEqual(h.sockets[0].sent.at(-1), [252, 1]);
  assert.equal(h.gameplay.diagnostics().input.lastTurnMs, 300);
  assert.equal(h.sockets[0].sent.some(c => c[0] === 251 || c[0] === 253 || c[0] === 254), false);
  assert.throws(() => h.gameplay.frame(308), /stopped/); assert.equal(h.sockets[0].closes, 1);
});

test('disposal reentry during input send releases the input only after controller unwind, preserving undefined', () => {
 let frees=0;class OwnedInput extends TestDesktopInput { free(){frees++;super.free();} }
 const h=harness({InputPolicy:OwnedInput});h.connected();h.setOwn(own());h.event('keydown',{code:'ArrowLeft'});
 h.faults.onSend=bytes=>{if(bytes[0]===252){assert.throws(()=>h.gameplay.dispose(),/disposal reentry/);assert.equal(frees,0);throw undefined;}};
 let thrown=false,primary;try{h.gameplay.frame(251);}catch(error){thrown=true;primary=error;}
 assert.equal(thrown,true);assert.equal(primary,undefined);assert.equal(frees,0);h.flush();assert.equal(frees,1);
 assert.deepEqual(h.errors,[undefined]);h.gameplay.dispose();assert.equal(frees,1);assert.equal(h.gameplay.diagnostics().input.connected,false);
});
