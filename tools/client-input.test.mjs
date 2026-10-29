// Authored synthetic desktop input schedules and hand-derived packet values.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import { createClientInput, desktopPointer, releaseTestInputs } from './fixtures/client-input-fixture.mjs';
after(releaseTestInputs);

const TAU = Math.PI * 2;
const own = (extra = {}) => ({ token: 1n, wantedHeading: 0, gazeHeading: 0, dead: false,
  turnRate: 0.03, sizeTurnFactor: 0.5, speedTurnFactor: 0.8, ...extra });
const pointer = (x, y, extra = {}) => ({ clientX: 400 + x, clientY: 300 + y,
  viewportWidth: 800, viewportHeight: 600, follow: true, ...extra });

function fixture(protocolVersion = 19) {
  const input = createClientInput({ protocolVersion });
  input.setOwn(own());
  input.setConnected(true);
  const sent = [];
  const tick = (nowMs, wholeSteps = 0) => input.tick({ nowMs, wholeSteps }, bytes => {
    assert.ok(bytes instanceof Uint8Array);
    sent.push([...bytes]);
  });
  return { input, sent, tick };
}

test('pointer geometry preserves CSS centering and follow-off raw-head operation order', () => {
  const a = desktopPointer(pointer(20, -30));
  assert.deepEqual(a, { x: 20, y: -30, gazeHeading: Math.atan2(-30, 20) });
  const b = desktopPointer(pointer(20, -30, { follow: false, camera: { x: 110, y: 220 },
    head: { x: 100, y: 200 }, zoom: 0.5 }));
  assert.deepEqual(b, { x: 25, y: -20, gazeHeading: Math.atan2(-20, 25) });
  // Backing dimensions are deliberately irrelevant to the source's CSS pointer handler.
  assert.deepEqual(desktopPointer(pointer(20, -30, { backingWidth: 2400, backingHeight: 1800 })), a);
  const huge = desktopPointer({ clientX: 9_007_199_254_740_992, clientY: 0,
    viewportWidth: 2, viewportHeight: 2, follow: false,
    camera: { x: 2, y: 1 }, head: { x: 0, y: 0 }, zoom: 1 });
  assert.equal(huge.x, 9_007_199_254_740_992);
  assert.equal(huge.y, 0);
});

test('pointer geometry validates finite scalars without mutating state', () => {
  const { input } = fixture();
  const before = input.snapshot();
  for (const bad of [NaN, Infinity, -Infinity, '20']) {
    assert.throws(() => input.pointer(pointer(bad, 1)));
    assert.deepEqual(input.snapshot(), before);
  }
  assert.throws(() => desktopPointer(pointer(1, 2, { viewportWidth: 0 })));
  assert.throws(() => desktopPointer(pointer(1, 2, { follow: 1 })));
  assert.throws(() => desktopPointer(pointer(1, 2, { follow: false, head: { x: 0, y: 0 },
    camera: { x: 0, y: 0 }, zoom: 0 })));
  assert.throws(() => desktopPointer({ clientX: Number.MAX_VALUE, clientY: 0,
    viewportWidth: 2, viewportHeight: 2, follow: true }));
});

test('heading gate is strictly greater than 33 and gaze is immediate without actual turn prediction', () => {
  const { input, sent, tick } = fixture();
  assert.equal(input.pointer(pointer(0, 100)).gazeHeading, Math.PI / 2);
  assert.equal(tick(0).gazeHeading, Math.PI / 2);
  tick(33);
  assert.deepEqual(sent, []);
  assert.equal(input.snapshot().wantHeading, true);
  tick(33.001);
  assert.deepEqual(sent, [[62]]);
  assert.equal(input.snapshot().lastHeadingMs, 33.001);
  assert.equal(input.snapshot().own.wantedHeading, 0);
  assert.equal('heading' in input.snapshot().own, false);
  assert.equal('position' in input.snapshot().own, false);
  tick(1000);
  assert.deepEqual(sent, [[62]]);
});

test('changed-pointer gates consume cadence even when heading quantization is unchanged', () => {
  const { input, sent, tick } = fixture();
  input.pointer(pointer(100, 100));
  tick(34);
  assert.deepEqual(sent, [[31]]);
  input.pointer(pointer(101, 101));
  tick(68);
  assert.deepEqual(sent, [[31]]);
  assert.equal(input.snapshot().lastHeadingMs, 68);
  assert.deepEqual(input.snapshot().comparedPointer, { x: 101, y: 101 });
  input.pointer(pointer(-100, 0));
  tick(101);
  assert.deepEqual(sent, [[31]]);
  tick(101.001);
  assert.deepEqual(sent, [[31], [125]]);
});

test('pointer changes remain pending even if it returns to the comparison point before gate', () => {
  const { input, sent, tick } = fixture();
  input.pointer(pointer(100, 0));
  tick(34); // initial quantized zero is not transmitted
  input.pointer(pointer(0, 100));
  tick(40);
  input.pointer(pointer(100, 0));
  tick(68);
  assert.equal(input.snapshot().lastHeadingMs, 68);
  assert.equal(input.snapshot().wantHeading, false);
  assert.deepEqual(sent, []);
});

test('16-unit dead zone is inclusive and only outgoing direction uses server wanted heading', () => {
  const { input, sent, tick } = fixture();
  input.setOwn(own({ wantedHeading: Math.PI }));
  input.pointer(pointer(0, 16));
  assert.equal(tick(34).gazeHeading, Math.PI / 2);
  assert.deepEqual(sent, [[125]]);
  input.pointer(pointer(0, 16.001));
  tick(68);
  assert.deepEqual(sent, [[125], [62]]);
  input.setOwn(own({ wantedHeading: Math.PI / 4 }));
  tick(200); // no pointer change, so no send based only on a server heading update
  assert.deepEqual(sent, [[125], [62]]);
});

test('251 compact directions and legacy 24-bit form use floor and signed remainder', () => {
  for (const [protocol, expected] of [[5, [[62], [125], [188]]],
    [19, [[62], [125], [188]]],
    [4, [[101, 63, 255, 255], [101, 127, 255, 255], [101, 191, 255, 255]]]]) {
    const { input, sent, tick } = fixture(protocol);
    input.pointer(pointer(0, 100)); tick(34);
    input.pointer(pointer(-100, 0)); tick(68);
    input.pointer(pointer(0, -100)); tick(102);
    assert.deepEqual(sent, expected);
    assert.equal(input.snapshot().own.gazeHeading, -Math.PI / 2);
  }
});

test('negative zero, full turns and the initial zero dedup are preserved', () => {
  const { input, sent, tick } = fixture();
  input.setOwn(own({ wantedHeading: TAU }));
  input.pointer(pointer(1, 0)); tick(34);
  assert.deepEqual(sent, []);
  assert.equal(input.snapshot().lastQuantizedHeading, 0);
  input.setOwn(own({ wantedHeading: -Math.PI / 2 }));
  input.pointer(pointer(2, 0)); tick(68);
  assert.deepEqual(sent, [[188]]);
  input.setOwn(own({ wantedHeading: -0 }));
  input.pointer(pointer(3, 0)); tick(102);
  assert.deepEqual(sent, [[188], [0]]);
  assert.ok(Object.is(input.snapshot().lastQuantizedHeading, -0));
});

test('boost gate is strictly greater than 50 and rapid reversals may coalesce', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('Space'); tick(50);
  assert.deepEqual(sent, []);
  tick(51);
  assert.deepEqual(sent, [[253]]);
  input.keyUp('Space'); tick(101);
  assert.deepEqual(sent, [[253]]);
  tick(101.001);
  assert.deepEqual(sent, [[253], [254]]);
  input.keyDown('Space'); input.keyUp('Space'); tick(1000);
  assert.deepEqual(sent, [[253], [254]]);
});

test('fractional timestamp subtraction retains native floating-point boundary behavior', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('Space'); tick(50.001);
  input.keyUp('Space'); tick(100.001);
  assert.ok(100.001 - 50.001 > 50);
  assert.deepEqual(sent, [[253], [254]]);
});

test('negative subnormal normalization is not replaced by a compact-heading clamp', () => {
  const { input, sent, tick } = fixture();
  input.setOwn(own({ wantedHeading: -Number.MIN_VALUE }));
  input.pointer(pointer(1, 0)); tick(34);
  assert.deepEqual(sent, [[251]]);
  assert.equal(input.snapshot().lastQuantizedHeading, 251);
});

test('legacy boost is two bytes and keyboard repeats never resend unchanged desire', () => {
  const { input, sent, tick } = fixture(4);
  input.keyDown('ArrowUp'); tick(51);
  input.keyDown('ArrowUp'); tick(200);
  input.keyUp('ArrowUp'); tick(201);
  assert.deepEqual(sent, [[109, 1], [109, 0]]);
});

test('boost sources follow ordered events rather than OR-combined held state', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('Space'); input.mouseDown(pointer(100, 0)); input.mouseUp(); tick(51);
  assert.deepEqual(sent, []);
  assert.equal(input.snapshot().boostKeyHeld, true);
  input.keyDown('Space'); input.keyDown('ArrowUp'); tick(52);
  input.keyUp('Space'); tick(103);
  assert.deepEqual(sent, [[253], [254]]);
  assert.equal(input.keyDown('KeyA'), false);
  assert.equal(input.keyUp('KeyA'), false);
});

test('blur leaves source intent unchanged and pagehide only disconnects', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('Space'); input.keyDown('ArrowLeft');
  const before = input.snapshot();
  input.blur();
  assert.deepEqual(input.snapshot(), before);
  input.pagehide(); tick(100, 5);
  assert.deepEqual(sent, []);
  assert.equal(input.snapshot().own.requestedBoost, true);
  assert.equal(input.snapshot().leftSteps, 0);
  input.setConnected(true); tick(101, 1);
  assert.deepEqual(sent, [[252, 1], [253]]);
});

test('no-own and disconnected states neither consume gates nor carry boost into a new appearance', () => {
  const { input, sent, tick } = fixture();
  input.setOwn(null);
  input.keyDown('Space'); input.keyDown('ArrowRight');
  input.pointer(pointer(0, 100));
  input.mouseDown(pointer(-100, 0));
  assert.deepEqual(input.snapshot().pointer, { x: 0, y: 100 });
  assert.equal(tick(1000, 5).gazeHeading, null);
  assert.deepEqual(sent, []);
  assert.equal(input.snapshot().lastHeadingMs, 0);
  assert.equal(input.snapshot().rightSteps, 0);
  input.setOwn(own());
  input.setConnected(false); tick(2000, 5);
  input.setConnected(true); tick(2001, 1);
  assert.deepEqual(sent, [[252, 129], [62]]);
  assert.equal(input.snapshot().own.sentBoost, false);
});

test('retained dead own still passes the source gate until detached by the host', () => {
  const { input, sent, tick } = fixture();
  input.setOwn(own({ dead: true }));
  input.keyDown('Space'); input.pointer(pointer(-100, 0)); tick(51);
  assert.deepEqual(sent, [[253], [125]]);
  input.setOwn(null); input.mouseUp(); tick(1000);
  assert.deepEqual(sent, [[253], [125]]);
});

test('reset and reconnect retain global pointer, dedup, timestamps, held keys and turn debt', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('ArrowLeft'); tick(0, 5);
  input.pointer(pointer(-100, 0)); input.keyDown('Space'); tick(51);
  input.keyDown('ArrowRight'); tick(52, 3);
  const before = input.snapshot();
  input.reset();
  const reset = input.snapshot();
  for (const field of ['pointer', 'comparedPointer', 'lastHeadingMs', 'lastBoostMs',
    'lastTurnMs', 'lastQuantizedHeading', 'leftHeld', 'rightHeld', 'boostKeyHeld', 'leftSteps', 'rightSteps']) {
    assert.deepEqual(reset[field], before[field], field);
  }
  assert.equal(reset.connected, false);
  assert.equal(reset.own, null);
  input.setOwn(own({ token: 2n })); input.setConnected(true); tick(103);
  assert.deepEqual(sent, [[252, 5], [253], [125], [252, 3]]);
  assert.equal(input.snapshot().own.sentBoost, false);
});

test('same token updates server metadata but new token resets appearance boost without wire-id inference', () => {
  const { input, sent, tick } = fixture();
  const token = {};
  input.setOwn(own({ token })); input.keyDown('Space'); tick(51);
  input.setOwn(own({ token, wantedHeading: 1, dead: true, gazeHeading: 20 }));
  assert.equal(input.snapshot().own.sentBoost, true);
  assert.equal(input.snapshot().own.requestedBoost, true);
  assert.equal(input.snapshot().own.gazeHeading, 0);
  input.setOwn(own({ token: {}, gazeHeading: 2 }));
  assert.equal(input.snapshot().own.sentBoost, false);
  assert.equal(input.snapshot().own.requestedBoost, false);
  assert.equal(input.snapshot().own.gazeHeading, 2);
  tick(200);
  assert.deepEqual(sent, [[253]]);
});

test('keyboard turns strictly gate at 50, cap at 127 and retain remaining debt after release', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('ArrowRight');
  for (let index = 0; index < 30; index++) tick(0, 5);
  input.keyUp('ArrowRight'); tick(50);
  assert.deepEqual(sent, []);
  tick(51);
  assert.deepEqual(sent, [[252, 255]]);
  assert.equal(input.snapshot().rightSteps, 23);
  tick(101);
  assert.deepEqual(sent, [[252, 255]]);
  tick(102);
  assert.deepEqual(sent, [[252, 255], [252, 151]]);
  assert.equal(input.snapshot().rightSteps, 0);
});

test('keyboard strict cancellation preserves equal debt and legacy turn packet forms', () => {
  const { input, sent, tick } = fixture(4);
  input.keyDown('ArrowLeft'); input.keyDown('ArrowRight'); tick(0, 5);
  input.keyUp('ArrowLeft'); input.keyUp('ArrowRight'); tick(51);
  assert.deepEqual(sent, [[108, 5]]);
  assert.equal(input.snapshot().rightSteps, 5);
  tick(102);
  assert.deepEqual(sent, [[108, 5], [114, 5]]);
  input.keyDown('ArrowRight'); tick(103, 4);
  input.keyDown('ArrowLeft'); tick(104, 2);
  input.keyUp('ArrowRight'); input.keyUp('ArrowLeft'); tick(153);
  assert.deepEqual(sent.at(-1), [114, 4]);
  assert.equal(input.snapshot().leftSteps, 0);
});

test('keyboard, boost and absolute heading send in source order with pointer gaze winning', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('ArrowLeft'); input.keyDown('Space'); input.pointer(pointer(0, 100));
  const result = tick(51, 3);
  assert.deepEqual(sent, [[252, 3], [253], [62]]);
  assert.deepEqual(result.intents.map(bytes => [...bytes]), sent);
  assert.equal(result.gazeHeading, Math.PI / 2);
  assert.equal(input.snapshot().own.wantedHeading, 0);
});

test('failed keyboard send retains debt consumption, clock and transient gaze but aborts later work', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('ArrowLeft'); input.keyDown('Space'); input.pointer(pointer(0, 100));
  const failure = new Error('authored send failure');
  assert.throws(() => input.tick({ nowMs: 51, wholeSteps: 5 }, bytes => {
    assert.deepEqual([...bytes], [252, 5]); throw failure;
  }), error => error === failure);
  const s = input.snapshot();
  assert.equal(s.leftSteps, 0);
  assert.equal(s.lastTurnMs, 51);
  assert.equal(s.own.gazeHeading, -(0.03 * 5 * 0.5 * 0.8));
  assert.equal(s.lastBoostMs, 0);
  assert.equal(s.lastHeadingMs, 0);
  input.keyUp('ArrowLeft'); tick(52);
  assert.deepEqual(sent, [[253], [62]]);
});

test('failed boost send commits its clock/desire before sending and does not retry it', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('Space'); input.pointer(pointer(-100, 0));
  const failure = {};
  assert.throws(() => input.tick({ nowMs: 51, wholeSteps: 0 }, () => { throw failure; }),
    error => error === failure);
  assert.equal(input.snapshot().own.sentBoost, true);
  assert.equal(input.snapshot().lastBoostMs, 51);
  assert.equal(input.snapshot().lastHeadingMs, 0);
  tick(52);
  assert.deepEqual(sent, [[125]]);
});

test('failed heading send commits quantization and comparison point before sending without retry', () => {
  const { input, sent, tick } = fixture();
  input.pointer(pointer(-100, 0));
  assert.throws(() => input.tick({ nowMs: 34, wholeSteps: 0 }, () => { throw new Error('send'); }));
  const s = input.snapshot();
  assert.equal(s.lastQuantizedHeading, 125);
  assert.equal(s.lastHeadingMs, 34);
  assert.equal(s.wantHeading, false);
  assert.deepEqual(s.comparedPointer, { x: -100, y: 0 });
  tick(200);
  input.pointer(pointer(-101, 0)); tick(201);
  assert.deepEqual(sent, []);
  assert.equal(input.snapshot().lastHeadingMs, 201);
});

test('a later send failure retains the successful capped turn and consumed boost attempt', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('ArrowRight');
  for (let i = 0; i < 30; i++) tick(0, 5);
  input.keyUp('ArrowRight'); input.keyDown('Space'); input.pointer(pointer(-100, 0));
  const attempts = [];
  const failure = new Error('second send');
  assert.throws(() => input.tick({ nowMs: 51, wholeSteps: 0 }, bytes => {
    attempts.push([...bytes]);
    if (attempts.length === 2) throw failure;
  }), error => error === failure);
  assert.deepEqual(attempts, [[252, 255], [253]]);
  assert.equal(input.snapshot().rightSteps, 23);
  assert.equal(input.snapshot().lastTurnMs, 51);
  assert.equal(input.snapshot().lastBoostMs, 51);
  assert.equal(input.snapshot().own.sentBoost, true);
  assert.equal(input.snapshot().lastHeadingMs, 0);
  tick(52); tick(102);
  assert.deepEqual(sent, [[125], [252, 151]]);
});

test('invalid computed keyboard gaze rejects before committing this tick', () => {
  const { input } = fixture();
  input.setOwn(own({ turnRate: Number.MAX_VALUE })); input.keyDown('ArrowLeft');
  const before = input.snapshot();
  assert.throws(() => input.tick({ nowMs: 51, wholeSteps: 5 }, () => assert.fail('invalid arithmetic send')));
  assert.deepEqual(input.snapshot(), before);
  assert.throws(() => input.pointer(pointer(1, 2, { follow: false, head: null })));
  assert.deepEqual(input.snapshot(), before);
});

test('backward caller time and no-op ticks do not reset cadence or invent requests', () => {
  const { input, sent, tick } = fixture();
  input.pointer(pointer(0, 100)); tick(100);
  input.pointer(pointer(-100, 0)); tick(90); tick(133);
  assert.deepEqual(sent, [[62]]);
  tick(134);
  assert.deepEqual(sent, [[62], [125]]);
  assert.equal(input.snapshot().lastHeadingMs, 134);
});

test('validation errors preserve state and observations return detached numeric records', () => {
  const { input } = fixture();
  const before = input.snapshot();
  for (const wholeSteps of [-1, 6, 0.5, NaN, '1']) {
    assert.throws(() => input.tick({ nowMs: 100, wholeSteps }, () => {}));
    assert.deepEqual(input.snapshot(), before);
  }
  assert.throws(() => input.tick({ nowMs: Infinity, wholeSteps: 0 }, () => {}));
  assert.throws(() => input.tick({ nowMs: 100, wholeSteps: 0 }, null));
  for (const extra of [{ turnRate: -1 }, { speedTurnFactor: NaN }, { gazeHeading: Infinity },
    { dead: 1 }, { token: null }]) assert.throws(() => input.setOwn(own(extra)));
  for (const version of [1, 256, 4.5, NaN, '19']) assert.throws(() => input.setProtocolVersion(version));
  assert.throws(() => input.setConnected(1));
  assert.deepEqual(input.snapshot(), before);
  const observed = input.snapshot();
  observed.pointer.x = 999; observed.own.requestedBoost = true;
  assert.deepEqual(input.snapshot(), before);
});

test('send gets fresh bytes and cannot mutate returned intent copies or later packets', () => {
  const { input } = fixture();
  input.pointer(pointer(-100, 0)); input.keyDown('Space');
  const result = input.tick({ nowMs: 51, wholeSteps: 0 }, bytes => bytes.fill(0));
  assert.deepEqual(result.intents.map(bytes => [...bytes]), [[253], [125]]);
});

test('module has no runtime transport, scheduler or simulator-helper dependency', async () => {
  const source = await readFile(new URL('../web/client-input.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new\s+WebSocket|requestAnimationFrame|setInterval|setTimeout|loopback-session/);
  assert.doesNotMatch(source, /\r/);
});

test('phase hook inserts versioned ping between keyboard and boost using the tracked emitter', () => {
  for (const protocol of [4, 19]) {
    const { input } = fixture(protocol);
    input.keyDown('ArrowLeft'); input.keyDown('Space'); input.pointer(pointer(0, 100));
    const order = [];
    const result = input.tick({ nowMs: 251, wholeSteps: 2 }, bytes => order.push([...bytes]),
      (context, emit) => {
        assert.ok(Object.isFrozen(context));
        assert.deepEqual(context, { nowMs: 251, protocolVersion: protocol });
        assert.equal(order.length, 1);
        assert.equal(input.snapshot().own.sentBoost, false);
        emit(Uint8Array.of(protocol >= 5 ? 251 : 112));
      });
    const expected = protocol >= 5 ? [[252, 2], [251], [253], [62]]
      : [[108, 2], [112], [109, 1], [101, 63, 255, 255]];
    assert.deepEqual(order, expected);
    assert.deepEqual(result.intents.map(bytes => [...bytes]), expected);
    assert.equal(result.gazeHeading, Math.PI / 2);
  }
});

test('connected-only phase hook runs once without own, but input debt and gates stay untouched', () => {
  const { input } = fixture();
  input.setOwn(null); input.keyDown('ArrowRight'); input.pointer(pointer(-100, 0));
  const before = input.snapshot();
  let calls = 0;
  const result = input.tick({ nowMs: 251, wholeSteps: 5 }, () => {}, (context, emit) => {
    calls++;
    assert.deepEqual(context, { nowMs: 251, protocolVersion: 19 });
    emit(Uint8Array.of(251));
  });
  assert.equal(calls, 1);
  assert.equal(result.gazeHeading, null);
  assert.deepEqual(result.intents.map(bytes => [...bytes]), [[251]]);
  assert.deepEqual(input.snapshot(), before);
  input.setConnected(false);
  const disconnected = input.snapshot();
  input.tick({ nowMs: 1000, wholeSteps: 5 }, () => assert.fail('disconnected send'),
    () => assert.fail('disconnected hook'));
  assert.deepEqual(input.snapshot(), disconnected);
});

test('phase hook runs once before delayed input gates and still runs for retained dead own', () => {
  const { input } = fixture();
  input.setOwn(own({ dead: true })); input.keyDown('Space');
  const calls = [];
  const sent = [];
  for (const nowMs of [0, 33, 50, 51]) {
    input.tick({ nowMs, wholeSteps: 0 }, bytes => sent.push([...bytes]), context => calls.push(context.nowMs));
  }
  assert.deepEqual(calls, [0, 33, 50, 51]);
  assert.deepEqual(sent, [[253]]);
});

test('invalid hook is rejected before keyboard, boost, gaze or send mutation', () => {
  const { input } = fixture();
  input.keyDown('ArrowLeft'); input.keyDown('Space'); input.pointer(pointer(0, 100));
  const before = input.snapshot();
  for (const hook of [null, false, {}, 1]) {
    assert.throws(() => input.tick({ nowMs: 251, wholeSteps: 5 }, () => assert.fail('invalid hook send'), hook),
      /input phase hook/);
    assert.deepEqual(input.snapshot(), before);
  }
});

test('hook exception preserves keyboard attempt state and aborts boost and pointer processing', () => {
  const { input, sent, tick } = fixture();
  input.keyDown('ArrowLeft'); input.keyDown('Space'); input.pointer(pointer(-100, 0));
  const failure = new Error('phase failure');
  const attempted = [];
  assert.throws(() => input.tick({ nowMs: 251, wholeSteps: 3 }, bytes => attempted.push([...bytes]), () => {
    throw failure;
  }), error => error === failure);
  assert.deepEqual(attempted, [[252, 3]]);
  const state = input.snapshot();
  assert.equal(state.lastTurnMs, 251);
  assert.equal(state.leftSteps, 0);
  assert.equal(state.own.gazeHeading, -(0.03 * 3 * 0.5 * 0.8));
  assert.equal(state.lastBoostMs, 0);
  assert.equal(state.own.sentBoost, false);
  assert.equal(state.lastHeadingMs, 0);
  assert.equal(state.wantHeading, false);
  assert.deepEqual(state.comparedPointer, { x: 0, y: 0 });
  input.keyUp('ArrowLeft'); tick(252);
  assert.deepEqual(sent, [[253], [125]]);
});

test('session hook commits ping attempt before failed send and receives no adapter retry', () => {
  const { input } = fixture();
  input.keyDown('Space'); input.pointer(pointer(-100, 0));
  const ping = { pending: false, lastPingMs: 0 };
  const hook = ({ nowMs }, emit) => {
    if (!ping.pending && nowMs - ping.lastPingMs > 250) {
      ping.pending = true; ping.lastPingMs = nowMs; emit(Uint8Array.of(251));
    }
  };
  const failure = {};
  assert.throws(() => input.tick({ nowMs: 251, wholeSteps: 0 }, bytes => {
    assert.deepEqual([...bytes], [251]); throw failure;
  }, hook), error => error === failure);
  assert.deepEqual(ping, { pending: true, lastPingMs: 251 });
  assert.equal(input.snapshot().own.sentBoost, false);
  assert.equal(input.snapshot().lastHeadingMs, 0);
  const later = [];
  input.tick({ nowMs: 1000, wholeSteps: 0 }, bytes => later.push([...bytes]), hook);
  assert.deepEqual(later, [[253], [125]]);
  assert.deepEqual(ping, { pending: true, lastPingMs: 251 });
});

test('failed keyboard send skips phase hook; failed boost send keeps earlier ping in order', () => {
  const { input } = fixture();
  input.keyDown('ArrowRight'); input.keyDown('Space');
  const failure = new Error('send failure');
  assert.throws(() => input.tick({ nowMs: 251, wholeSteps: 2 }, () => { throw failure; },
    () => assert.fail('hook after failed keyboard send')), error => error === failure);
  input.keyUp('ArrowRight');
  const attempted = [];
  assert.throws(() => input.tick({ nowMs: 252, wholeSteps: 0 }, bytes => {
    attempted.push([...bytes]);
    if (bytes[0] === 253) throw failure;
  }, (_context, emit) => emit(Uint8Array.of(251))), error => error === failure);
  assert.deepEqual(attempted, [[251], [253]]);
  assert.equal(input.snapshot().own.sentBoost, true);
  assert.equal(input.snapshot().lastBoostMs, 252);
});

test('accumulation before due close preserves debt through reset and produces no sends', () => {
  const { input } = fixture();
  input.setOwn(own({ dead: true }));
  input.keyDown('ArrowLeft'); input.keyDown('Space'); input.pointer(pointer(-100, 0));
  const before = input.snapshot();
  assert.equal(input.accumulateStep({ wholeSteps: 5 }), undefined);
  const accumulated = input.snapshot();
  assert.deepEqual(accumulated, { ...before, leftSteps: 5 });
  // Session.afterStep's due-close phase detaches the world before the send phase.
  input.reset();
  const result = input.tick({ nowMs: 1000, wholeSteps: 0 }, () => assert.fail('send after due close'),
    () => assert.fail('ping hook after due close'));
  assert.deepEqual(result, { gazeHeading: null, intents: [] });
  const closed = input.snapshot();
  assert.equal(closed.leftSteps, 5);
  assert.equal(closed.lastTurnMs, 0);
  assert.equal(closed.lastBoostMs, 0);
  assert.equal(closed.lastHeadingMs, 0);
  assert.deepEqual(closed.pointer, before.pointer);
  assert.equal(closed.own, null);
  assert.equal(closed.connected, false);
});

test('split accumulation then zero-step send exactly matches combined tick on normal schedules', () => {
  for (const protocol of [4, 19]) {
    const combined = fixture(protocol);
    const split = fixture(protocol);
    for (const { input } of [combined, split]) {
      input.keyDown('ArrowLeft'); input.keyDown('Space'); input.pointer(pointer(0, 100));
    }
    for (const [nowMs, wholeSteps] of [[0, 5], [33, 1], [51, 2], [101, 3], [102, 0], [251, 5]]) {
      if (nowMs === 101) {
        for (const { input } of [combined, split]) {
          input.keyUp('ArrowLeft'); input.keyDown('ArrowRight'); input.keyUp('Space');
          input.pointer(pointer(-100, 0));
        }
      }
      const a = [], b = [];
      const hook = (context, emit) => {
        if (context.nowMs === 251) emit(Uint8Array.of(context.protocolVersion >= 5 ? 251 : 112));
      };
      const first = combined.input.tick({ nowMs, wholeSteps }, bytes => a.push([...bytes]), hook);
      split.input.accumulateStep({ wholeSteps });
      const second = split.input.tick({ nowMs, wholeSteps: 0 }, bytes => b.push([...bytes]), hook);
      assert.deepEqual(a, b, `protocol ${protocol}, time ${nowMs}`);
      assert.deepEqual(first, second);
      assert.deepEqual(combined.input.snapshot(), split.input.snapshot());
    }
  }
});

test('accumulateStep validates without mutation and has the same retained-own gate as tick', () => {
  const { input } = fixture();
  input.keyDown('ArrowLeft'); input.keyDown('ArrowRight');
  const before = input.snapshot();
  for (const wholeSteps of [-1, 6, 0.25, NaN, Infinity, Number.MAX_SAFE_INTEGER, '1']) {
    assert.throws(() => input.accumulateStep({ wholeSteps }), /whole steps/);
    assert.deepEqual(input.snapshot(), before);
  }
  input.setConnected(false);
  const disconnected = input.snapshot();
  input.accumulateStep({ wholeSteps: 5 });
  assert.deepEqual(input.snapshot(), disconnected);
  assert.throws(() => input.accumulateStep({ wholeSteps: 6 }), /whole steps/);
  input.setConnected(true); input.setOwn(null);
  const noOwn = input.snapshot();
  input.accumulateStep({ wholeSteps: 5 });
  assert.deepEqual(input.snapshot(), noOwn);
  input.setOwn(own({ dead: true }));
  const dead = input.snapshot();
  input.accumulateStep({ wholeSteps: 3 });
  assert.deepEqual(input.snapshot(), { ...dead, leftSteps: 3, rightSteps: 3 });
});

test('accumulation does not change input gates and a zero-step tick consumes debt only once', () => {
  const { input } = fixture();
  input.keyDown('ArrowRight');
  input.accumulateStep({ wholeSteps: 5 });
  input.keyUp('ArrowRight');
  const before = input.snapshot();
  assert.equal(before.lastTurnMs, 0);
  assert.equal(before.rightSteps, 5);
  const sent = [];
  input.tick({ nowMs: 51, wholeSteps: 0 }, bytes => sent.push([...bytes]));
  input.tick({ nowMs: 102, wholeSteps: 0 }, bytes => sent.push([...bytes]));
  assert.deepEqual(sent, [[252, 133]]);
  assert.equal(input.snapshot().rightSteps, 0);
});

test('tick callbacks cannot reenter accumulation or tick and the guard clears after failures', () => {
  const { input } = fixture();
  input.keyDown('ArrowLeft');
  assert.throws(() => input.tick({ nowMs: 51, wholeSteps: 2 }, () => {
    input.accumulateStep({ wholeSteps: 5 });
  }), /already active/);
  assert.equal(input.snapshot().lastTurnMs, 51);
  assert.equal(input.snapshot().leftSteps, 0);
  input.accumulateStep({ wholeSteps: 1 });
  assert.equal(input.snapshot().leftSteps, 1);
  const nestedBefore = input.snapshot();
  input.tick({ nowMs: 52, wholeSteps: 0 }, () => assert.fail('early send'), () => {
    const observed = input.snapshot();
    assert.equal(observed.leftSteps, 1);
    assert.throws(() => input.accumulateStep({ wholeSteps: 0 }), /already active/);
    assert.throws(() => input.tick({ nowMs: 500, wholeSteps: 5 }, () => {}), /already active/);
    assert.deepEqual(input.snapshot(), observed);
  });
  assert.equal(input.snapshot().leftSteps, nestedBefore.leftSteps);
  input.accumulateStep({ wholeSteps: 1 });
  assert.equal(input.snapshot().leftSteps, 2);
});
