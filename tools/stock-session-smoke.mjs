import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStockSession } from '../web/stock-session.mjs';
import { createClientInput } from '../web/client-input.mjs';
import { unpackCommands } from '../web/handshake-session.mjs';
import { bundle, syntheticScene, syntheticSetup, syntheticStep } from '../web/synthetic-scene.mjs';

// Original closed-grammar fixture, never a captured challenge or evaluated program.
function challengeFixture() {
  const source = 'var a="AAAAA";a+="AAAAAAAAAAAAAAAAAAAAAA";for(var i=0;i<27;i++){idba[i]=a.charCodeAt(i);}';
  let key = 23;
  const encoded = [];
  for (const byte of Buffer.from(source, 'ascii')) {
    for (const nibble of [byte >> 4, byte & 15]) {
      encoded.push(97 + (nibble + key) % 26);
      key = (key + 17) % 26;
    }
  }
  return Uint8Array.from(encoded);
}

/** Real authored Wasm and in-memory socket doubles only; owns no network or timers. */
export function stockSessionSmoke(wasm) {
  const setup = syntheticSetup();
  const appearance = unpackCommands(wasm.decode_frame(syntheticScene(), false))
    .find(command => command[0] === 115);
  assert.ok(appearance);
  assert.equal(wasm.setup_protocol_version(setup), 19);
  const challenge = challengeFixture();
  const expectedReply = Uint8Array.from({ length: 27 }, (_, index) => 65 + (3 + index * 4) % 26);
  assert.deepEqual(wasm.solve_challenge(challenge), expectedReply);
  const profile = { clientVersion: 7,
    password: Uint8Array.from({ length: 20 }, (_, index) => (index * 13 + 7) & 255),
    protocolVersion: 19 };
  const login = { endpoint: 'ws://192.0.2.7:1234/slither', profile,
    nickname: 'Synthetic smoke', skin: 0, customSkin: new Uint8Array() };
  const expectedLogin = Uint8Array.from([115, 30, 0, 7, ...profile.password, 0,
    login.nickname.length, ...Buffer.from(login.nickname, 'ascii'), 0, 255]);
  assert.deepEqual(wasm.encode_login(profile.clientVersion, profile.password,
    login.nickname, login.skin, login.customSkin), expectedLogin);
  const owners = [];
  const cases = [];
  let primaryFailed = false;

  function harness(seed = false) {
    const scene = new wasm.AnimatedScene(0);
    const input = createClientInput({InputPolicy:wasm.DesktopInput});
    let now = 0;
    let inControl = false;
    const sockets = [], ingresses = [], states = [], errors = [];
    let calls = 0;
    if (seed) scene.apply_frame(bundle(setup, appearance), false);
    const session = createStockSession({ wasm, now: () => now, createSocket(endpoint) {
      assert.equal(inControl, false, 'constructor must be outside native borrow');
      assert.equal(scene.control_view().own, null, 'initial native reset must commit before constructor');
      assert.equal(endpoint, login.endpoint);
      const socket = { readyState: 0, bufferedAmount: 0, sends: [], closes: 0,
        send(bytes) { this.sends.push(Uint8Array.from(bytes)); },
        close() { this.closes++; this.readyState = 3; },
        open() { this.readyState = 1; this.onopen?.(); },
        receive(bytes) {
          const copied = Uint8Array.from(bytes);
          this.onmessage?.({ data: copied.buffer });
        },
      };
      sockets.push(socket);
      return socket;
    } });
    const unsubscribe = session.subscribe({
      packet(bytes, timed) {
        assert.equal(inControl, false, 'ingress must not reenter native control');
        assert.equal(timed, false);
        ingresses.push(Uint8Array.from(bytes));
        calls++;
        scene.apply_frame(bytes, timed);
      },
      state(value) { states.push(value); },
      error(error) { errors.push(error); },
    });
    const h = { scene, input, session, sockets, ingresses, states, errors,
      setTime(value) { now = value; },
      get calls() { return calls; },
      control(value) {
        now = value;
        const pending = session.pendingActions();
        if (pending.actions.resetLag) {
          scene.reset_lag();
          session.acknowledgeActions(pending);
        }
        const flags = session.beforeUpdate(value);
        let observed, actions, intents = [], called = 0;
        const step = scene.advance_with_control(value, flags.lagging, request => {
          inControl = true;
          try {
            called++;
            observed = { nowMs: request.nowMs, wholeSteps: request.wholeSteps,
              delta: request.delta, lagMultiplier: request.lagMultiplier,
              accumulated: request.accumulated, doubledAccumulated: request.doubledAccumulated };
            input.setConnected(session.snapshot().connected);
            input.setOwn(request.control.own);
            input.accumulateStep({ wholeSteps: request.wholeSteps });
            actions = session.afterStep(request);
            if (actions.resetWorld) { input.reset(); return actions; }
            input.setConnected(session.snapshot().connected);
            const result = input.tick({ nowMs: request.nowMs, wholeSteps: 0 },
              bytes => session.sendInput(bytes),
              (context, emit) => session.betweenKeyboardAndBoost(context, emit));
            intents = result.intents;
            return result.gazeHeading === null ? actions : { ...actions, gazeHeading: result.gazeHeading };
          } finally { inControl = false; }
        });
        try {
          assert.equal(called, 1);
          assert.equal(step.delta, observed.delta);
          assert.equal(step.whole_steps, observed.wholeSteps);
          assert.equal(step.lag_multiplier, observed.lagMultiplier);
          assert.equal(step.accumulated, observed.accumulated);
          assert.equal(step.doubled_accumulated, observed.doubledAccumulated);
        } finally { step.free(); }
        session.commitControl();
        return { observed, actions, intents: intents.map(bytes => [...bytes]) };
      },
      start() {
        assert.equal(sockets.length, 0);
        session.play(login);
        assert.equal(sockets.length, 0);
        session.commitControl();
        assert.equal(sockets.length, 0);
        const first = h.control(0);
        assert.deepEqual(first.actions, { resetWorld: true, connected: false });
        assert.equal(sockets.length, 1);
        assert.equal(sockets[0].binaryType, 'arraybuffer');
        sockets[0].open();
        assert.deepEqual(sockets[0].sends, [Uint8Array.of(1), Uint8Array.of(99, 0)]);
        sockets[0].receive(Uint8Array.from([54, ...challenge]));
        assert.equal(sockets[0].sends.length, 4);
        assert.deepEqual(sockets[0].sends[2], expectedReply);
        assert.deepEqual(sockets[0].sends[3], expectedLogin);
        assert.equal(h.calls, 0, 'challenge must not enter native world');
        return sockets[0];
      },
      dispose() {
        let failed=false,primary;
        for(const cleanup of [()=>session.close('smoke-cleanup'),unsubscribe,()=>input.dispose(),()=>scene.free()]){
          try{cleanup();}catch(error){if(!failed){failed=true;primary=error;}}
        }
        if(failed)throw primary;
      },
    };
    owners.push(h);
    return h;
  }

  try {
    const main = harness(true);
    assert.ok(main.scene.control_view().own);
    const socket = main.start();
    assert.equal(main.scene.control_view().own, null);
    cases.push('real login/challenge, constructor after native reset commit');

    socket.receive(setup);
    assert.equal(main.calls, 1);
    assert.equal(main.scene.control_view().own, null);
    assert.equal(main.session.snapshot().connected, true);
    assert.equal(main.session.snapshot().playing, true);
    assert.equal(main.scene.control_view().connected, true);
    const beforeBundle = JSON.parse(main.scene.snapshot());
    const setupAndOwn = bundle(setup, appearance);
    socket.receive(setupAndOwn);
    assert.equal(main.calls, 2);
    assert.deepEqual(main.ingresses[1], setupAndOwn);
    const afterBundle = JSON.parse(main.scene.snapshot());
    assert.equal(afterBundle.frames, beforeBundle.frames + 1);
    assert.equal(afterBundle.commands, beforeBundle.commands + 2);
    assert.equal(afterBundle.snakes, 1);
    assert.equal(afterBundle.ownId, 0);
    assert.equal(typeof main.scene.control_view().own.token, 'bigint');
    cases.push('Setup-before-own flags and one full Setup/trailing-own native ingress');

    main.control(8);
    main.input.keyDown('ArrowLeft'); main.input.keyDown('Space');
    main.input.pointer({ clientX: 900, clientY: 500,
      viewportWidth: 1000, viewportHeight: 800, follow: true });
    const ordered = main.control(300);
    const heading = Math.floor(251 * Math.atan2(100, 400) / (Math.PI * 2));
    assert.equal(ordered.observed.wholeSteps, 5);
    assert.deepEqual(ordered.intents, [[252, 5], [251], [253], [heading]]);
    assert.equal(main.input.snapshot().leftSteps, 0, 'split tick must not double-add native wholeSteps');
    assert.equal(main.scene.control_view().own.gazeHeading, Math.atan2(100, 400));
    const aimed = JSON.parse(main.scene.snapshot()).own;
    assert.equal(aimed.heading, 0, 'input does not predict actual server heading');
    assert.ok(aimed.eyes.pupilY > 0, 'gaze must affect this same native eye step');
    main.input.keyUp('ArrowLeft'); main.input.keyUp('Space');
    cases.push('native wholeStep accumulation and keyboard/ping/boost/heading before current eyes');

    assert.equal(main.control(1050).observed.lagMultiplier, 1, '750ms lag boundary is strict');
    const firstLag = main.control(1050.25);
    assert.equal(firstLag.observed.lagMultiplier, 0.85);
    const secondLag = main.control(1090.25);
    assert.equal(secondLag.observed.lagMultiplier, 0.85 * 0.85);
    main.setTime(1090.25); socket.receive(Uint8Array.of(112));
    assert.equal(main.session.snapshot().lagging, false);
    assert.equal(main.session.snapshot().pingPending, false);
    assert.deepEqual(main.session.pendingActions().actions, {});
    const recovered = main.control(1098.25);
    assert.equal(recovered.observed.lagMultiplier, secondLag.observed.lagMultiplier + 0.05);
    assert.ok(recovered.observed.lagMultiplier < 1, 'pong must not reset multiplier');
    cases.push('pending ping strict lag and real native gradual pong recovery');

    main.setTime(1100); socket.receive(Uint8Array.of(118, 1));
    assert.equal(main.session.snapshot().phase, 'victory');
    assert.equal(main.session.snapshot().connected, true);
    assert.deepEqual(main.session.pendingActions().actions, { resetLag: true });
    const gameOver = main.control(1106.25);
    assert.equal(gameOver.observed.lagMultiplier, 1, 'gameOver reset must precede clock computation');
    assert.deepEqual(main.session.pendingActions().actions, {});
    cases.push('gameOver independent native multiplier reset before next clock');

    main.setTime(1110); socket.receive(Uint8Array.of(118, 1));
    const countBeforeClose = socket.sends.length;
    main.session.close('synthetic-explicit-close');
    const offer = main.session.pendingActions();
    assert.deepEqual(offer.actions, { resetLag: true, resetWorld: true, connected: false });
    main.scene.reset_lag(); main.session.acknowledgeActions(offer);
    assert.deepEqual(main.session.pendingActions().actions, { resetWorld: true, connected: false });
    assert.throws(() => main.session.acknowledgeActions(offer), /Stale/);
    main.control(1114.25);
    assert.equal(main.scene.control_view().own, null);
    assert.equal(socket.sends.length, countBeforeClose);
    assert.equal(socket.closes, 1);
    main.session.close('again'); assert.equal(socket.closes, 1);
    assert.throws(() => main.session.play(login), /one manual Play/i);
    assert.equal(main.session.snapshot().constructorAttempts, 1);
    cases.push('selective lag acknowledgement preserves real world-reset action; terminal no retry');

    const closing = harness(); const closingSocket = closing.start();
    closingSocket.receive(bundle(setup, appearance)); closing.control(8);
    const staleMessage = closingSocket.onmessage;
    closing.input.keyDown('ArrowLeft');
    closing.setTime(8); closingSocket.receive(Uint8Array.of(118, 2));
    const sentBeforeExit = closingSocket.sends.length;
    const exit = closing.control(16);
    assert.deepEqual(exit.actions, { resetWorld: true, connected: false });
    assert.equal(exit.observed.wholeSteps, 1);
    assert.equal(exit.observed.accumulated, 2);
    assert.equal(closing.input.snapshot().leftSteps, 1, 'debt accrues before due close');
    assert.deepEqual(exit.intents, []);
    assert.equal(closingSocket.sends.length, sentBeforeExit);
    assert.equal(closingSocket.closes, 1);
    assert.equal(closing.scene.control_view().own, null, 'reset must precede old entity iteration');
    assert.equal(closing.scene.control_view().connected, false);
    staleMessage({ data: setupAndOwn.slice().buffer });
    assert.equal(closing.calls, 2, 'stale packet handler must not reapply world');
    const afterExit = closing.control(16);
    assert.equal(afterExit.observed.delta, 0);
    assert.equal(afterExit.observed.accumulated, exit.observed.accumulated);
    assert.equal(closingSocket.closes, 1);
    cases.push('v2 reset before motion with retained current-step debt and stale callbacks');

    const malformed = harness(); const badSocket = malformed.start();
    badSocket.receive(bundle(setup, appearance)); malformed.control(300);
    assert.equal(malformed.session.snapshot().pingPending, true);
    const worldBefore = malformed.scene.snapshot();
    const controlBefore = malformed.scene.control_view();
    const callsBefore = malformed.calls;
    // Valid framing and early motion/control commands, then an incomplete supported food record.
    badSocket.receive(bundle(syntheticStep(9), [112], [118, 1], [70, 108, 108, 0]));
    assert.equal(malformed.calls, callsBefore + 1);
    assert.equal(malformed.scene.snapshot(), worldBefore, 'late typed rejection must roll back native world/counters');
    assert.deepEqual(malformed.scene.control_view(), controlBefore);
    assert.equal(malformed.session.snapshot().phase, 'failed');
    assert.equal(malformed.session.snapshot().lifeEnded, false, 'life control cannot commit before native validation');
    assert.ok(malformed.states.every(value => value.lifeEnded === false));
    assert.deepEqual(malformed.session.pendingActions().actions, { resetWorld: true, connected: false });
    assert.equal(malformed.errors.length, 1);
    assert.equal(badSocket.closes, 1);
    malformed.control(308);
    assert.equal(malformed.scene.control_view().own, null);
    assert.throws(() => malformed.session.play(login), /one manual Play/i);
    assert.equal(malformed.session.snapshot().constructorAttempts, 1);
    cases.push('late Rust world/control bundle rejection is atomic and terminal');
    return { cases: cases.length, checks: cases, socketDoubles: owners.length, networkConnections: 0 };
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    const cleanupErrors = [];
    for (const owner of owners) { try { owner.dispose(); } catch (error) { cleanupErrors.push(error); } }
    if (cleanupErrors.length) {
      if (primaryFailed) console.error('Additional session smoke cleanup failures:', cleanupErrors);
      else throw new AggregateError(cleanupErrors, 'Session smoke cleanup failed');
    }
  }
}

const fingerprint = file => {
  const bytes = fs.readFileSync(file);
  return { path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Supply explicit generated JS and Wasm paths');
  const files = process.argv.slice(2).map(file => path.resolve(file));
  const before = files.map(fingerprint);
  console.log(JSON.stringify({ event: 'stock-session-smoke-before', artifacts: before }));
  let result, failure;
  try {
    const wasm = await import(pathToFileURL(files[0]).href);
    wasm.initSync({ module: fs.readFileSync(files[1]) });
    result = stockSessionSmoke(wasm);
  } catch (error) { failure = error; }
  const after = files.map(fingerprint);
  console.log(JSON.stringify({ event: 'stock-session-smoke-after', artifacts: after,
    unchanged: JSON.stringify(before) === JSON.stringify(after), result,
    failure: failure ? String(failure.stack ?? failure) : null }));
  assert.deepEqual(after, before, 'Supplied generated artifacts changed during smoke');
  if (failure) throw failure;
}
