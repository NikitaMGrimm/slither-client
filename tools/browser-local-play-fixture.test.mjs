// Authored in-memory transport/packet tests. No listening peer or browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyntheticSession, createPeerReceipt, syntheticPeer } from './browser-session-fixture.mjs';
import { createBrowserLocalPlayFixture } from './browser-local-play-fixture.mjs';

const login = () => Uint8Array.from([115, 30, ...Array(22).fill(0)]);
function connected(fixture = createBrowserLocalPlayFixture(), receipt = createPeerReceipt()) {
  const sent = []; let closed = 0;
  const session = createSyntheticSession({ fixture, receipt, send: bytes => sent.push(bytes), close: () => closed++ });
  session.receive(Uint8Array.of(99, 0));
  assert.equal(sent[0][0], 54);
  session.receive(new Uint8Array(27).fill(65));
  session.receive(login());
  return { session, receipt, sent, closed: () => closed };
}

test('fresh lifecycle tapes are independent, zero-food data; death is explicit and one-use', () => {
  const a = createBrowserLocalPlayFixture(), b = createBrowserLocalPlayFixture();
  assert.notEqual(a.packets[0].bytes, b.packets[0].bytes);
  assert.notEqual(a.named.death, b.named.death);
  assert.equal(a.defaultRuntime.entry, 'extension/game-bootstrap.mjs');
  assert.equal(a.defaultRuntime.diagnosticUi, false);
  const h = connected(a);
  const before = h.sent.length;
  h.session.advance(600); assert.equal(h.sent.length, before);
  h.session.deliver('death'); assert.equal(h.sent.length, before + 1);
  assert.throws(() => h.session.deliver('death'), /one-use/);
  assert.throws(() => h.session.deliver('unknown'), /one-use/);
  h.session.end(); h.session.advance(500); assert.equal(h.receipt.logins, 1);
  assert.throws(() => h.session.deliver('death'));
  connected(b, h.receipt); assert.equal(h.receipt.connections, 2); assert.equal(h.receipt.logins, 2);
});

test('generic prey-compatible tape copies bytes and delivers equal-time packets before caller update', () => {
  const fixture = { packets: [{ at: 0, bytes: Uint8Array.of(97) },
    { at: 25, bytes: Uint8Array.of(121) }, { at: 25, bytes: Uint8Array.of(106) },
    { at: 50, bytes: Uint8Array.of(115) }] };
  const h = connected(fixture);
  fixture.packets[1].bytes[0] = 0;
  h.session.advance(24); assert.equal(h.sent.length, 2);
  h.session.advance(1); assert.deepEqual(h.sent.slice(2).map(x => [...x]), [[121], [106]]);
  h.session.advance(0); assert.equal(h.sent.length, 4);
  h.session.advance(25); assert.equal(h.sent[4][0], 115);
  assert.deepEqual(h.receipt.deliveries.map(x => x.at), [0, 25, 25, 50]);
  // Legacy UI scenarios may advance beyond the bounded packet tape's end.
  for (let i = 0; i < 4; i++) h.session.advance(10000);
  assert.equal(h.sent.length, 5);
});

test('bounded input recorder distinguishes controls from handshake and logs no profile bytes', () => {
  const h = connected();
  for (const bytes of [[100], [252, 3], [253], [254], [251]]) h.session.receive(Uint8Array.from(bytes));
  assert.deepEqual(h.receipt.inputs.map(x => x.kind), ['heading', 'turn', 'boostOn', 'boostOff', 'ping']);
  assert.deepEqual([...h.sent.at(-1)], [112]);
  assert.equal(h.receipt.inputs.every(x => x.connection === 1 && x.bytes.length <= 2), true);
  h.session.receive(Uint8Array.of(255)); assert.equal(h.receipt.errors.length, 1);
  for (let i = 0; i < 4091; i++) h.session.receive(Uint8Array.of(10));
  assert.equal(h.receipt.inputs.length, 4096);
  assert.throws(() => h.session.receive(Uint8Array.of(10)), /recording limit/);
});

test('invalid fixtures fail before a listening resource; nonzero login is rejected without recording it', async () => {
  for (const packets of [[], [{ at: -1, bytes: Uint8Array.of(97) }],
    [{ at: 20, bytes: Uint8Array.of(97) }, { at: 10, bytes: Uint8Array.of(97) }],
    [{ at: 0, bytes: [] }]]) {
    await assert.rejects(syntheticPeer({ fixture: { packets } }));
  }
  const receipt = createPeerReceipt(); let closes = 0;
  const session = createSyntheticSession({ receipt, send() {}, close() { closes++; } });
  session.receive(Uint8Array.of(99, 0)); const bytes = login(); bytes[2] = 1; session.receive(bytes);
  assert.equal(closes, 1); assert.equal(receipt.logins, 0); assert.deepEqual(receipt.inputs, []);
});

// Run explicitly after a matching build: SLITHER_LOCAL_PLAY_WASM=1 node --test tools/browser-local-play-fixture.test.mjs
if (process.env.SLITHER_LOCAL_PLAY_WASM === '1') {
  const { loadWasm } = await import('./reference-context.mjs');
  const { unpackCommands } = await import('../web/handshake-session.mjs');
  const { createHudState, reduceHudState } = await import('../web/stock-hud-state.mjs');
  const wasm = await loadWasm();
  test('actual parser/score ABI and Rust HUD history preserve command-time final score across return/restart', () => {
    const fixture = createBrowserLocalPlayFixture(), scene = new wasm.AnimatedScene(0), identity = Symbol('authored lifecycle');
    scene.enable_score_tracking();
    let hud = createHudState(identity, wasm.HudHistory);
    const change = value => { hud = reduceHudState(hud, identity, value); };
    const apply = (bytes, death = false) => {
      const commands = unpackCommands(wasm.decode_frame(bytes, false));
      const events = [];
      for (const [commandIndex, command] of commands.entries()) {
        if (death && command[0] === 118) events.push({ kind: 'final-score', commandIndex, view: scene.score_view() });
        scene.apply_frame(command, false);
        if (command[0] === 97) events.push({ kind: 'setup', commandIndex, tableMax: scene.score_view().tableMax },
          { kind: 'setup-draw', commandIndex, view: scene.score_view() });
        else if (command[0] === 115 && command.length > 4) events.push({ kind: 'own-length-scheduled', commandIndex, token: scene.score_view().own.token });
        else if (command[0] === 108) events.push({ kind: 'leaderboard', commandIndex, localRow: 0, rank: 1, population: 1, deathPending: false });
      }
      change({ kind: 'packet', report: { schema: 1, commandCount: commands.length,
        setupDraws: events.filter(x => x.kind === 'setup').length, events } });
    };
    try {
      apply(fixture.packets[0].bytes);
      assert.equal(JSON.parse(scene.snapshot()).foods, 0);
      const first = scene.score_view(); assert.equal(first.status, 'ready'); assert.equal(first.score, 165);
      change({ kind: 'draw', playing: true, view: first }); assert.equal(hud.current.score, first.score);
      apply(fixture.named.death, true); assert.equal(hud.final.score, first.score);
      change({ kind: 'world-reset' }); assert.equal(hud.final.score, first.score); assert.equal(hud.current.score, first.score);
      scene.reset(); apply(fixture.packets[0].bytes);
      const second = scene.score_view(); assert.notEqual(second.own.token, first.own.token);
      change({ kind: 'draw', playing: true, view: second });
      assert.equal(hud.current.score, first.score); assert.equal(hud.final.score, first.score);
    } finally { scene.free(); }
  });

  test('real protocol ABI/session/input complete death return and construct a second socket only on explicit Play', async () => {
    const { createStockSession } = await import('../web/stock-session.mjs');
    const { createClientInput } = await import('../web/client-input.mjs');
    const fixture = createBrowserLocalPlayFixture(), receipt = createPeerReceipt(), peers = [], errors = [];
    const scene = new wasm.AnimatedScene(0), input = createClientInput(); let clock = 0;
    const createSession = () => createStockSession({ wasm, now: () => clock, createSocket() {
      let peer;
      const socket = { readyState: 0, bufferedAmount: 0,
        send(bytes) { queueMicrotask(() => peer.receive(bytes)); },
        close() { if (this.readyState === 3) return; this.readyState = 3; peer.end(); queueMicrotask(() => this.onclose?.({})); } };
      peer = createSyntheticSession({ fixture, receipt,
        send(bytes) { queueMicrotask(() => socket.onmessage?.({ data: bytes.buffer })); }, close: () => socket.close() });
      peers.push(peer); queueMicrotask(() => { socket.readyState = 1; socket.onopen?.(); }); return socket;
    } });
    let session;
    const replaceSession = () => {
      session = createSession();
      session.subscribe({ packet: (bytes, timed) => scene.apply_frame(bytes, timed), state() {}, error: error => errors.push(error) });
    };
    replaceSession();
    const settle = () => new Promise(resolve => setImmediate(resolve));
    const tick = (now, delta = 3.125, wholeSteps = 3) => {
      clock = now;
      const actions = session.afterStep({ nowMs: now, delta, wholeSteps });
      if (actions.resetWorld) { scene.reset(); input.reset(); }
      session.commitControl(); return actions;
    };
    const play = () => session.play({ endpoint: 'ws://127.0.0.1:12345/slither',
      profile: { clientVersion: 0, password: new Uint8Array(20), protocolVersion: 19 },
      nickname: 'Synthetic browser', skin: 0, customSkin: new Uint8Array() });
    try {
      play(); tick(0, 0, 0); await settle(); assert.equal(session.snapshot().phase, 'playing');
      clock = 600; session.uiTick(clock); assert.equal(session.snapshot().returnFraction, 1);
      input.setProtocolVersion(19); input.setConnected(true); input.setOwn(scene.control_view().own);
      const controls = now => { clock = now; input.tick({ nowMs: now, wholeSteps: 5 }, session.sendInput, session.betweenKeyboardAndBoost); };
      input.keyDown('ArrowLeft'); controls(1000); input.keyUp('ArrowLeft'); controls(1100);
      input.keyDown('Space'); controls(1200); input.keyUp('Space'); controls(1300); await settle();
      assert.ok(receipt.inputs.some(x => x.kind === 'turn'));
      assert.deepEqual(receipt.inputs.filter(x => x.kind.startsWith('boost')).map(x => x.kind), ['boostOn', 'boostOff']);
      clock = 1400; peers[0].deliver('death'); await settle(); assert.equal(session.snapshot().phase, 'dead');
      for (let now = 1425; now <= 5700; now += 25) tick(now);
      await settle(); assert.equal(session.snapshot().phase, 'disconnected'); assert.equal(receipt.closed, 1);
      for (let now = 5725; now <= 6200; now += 25) tick(now);
      assert.equal(receipt.connections, 1); assert.equal(receipt.logins, 1);
      // The production local gameplay owner replaces its one-Play session only
      // after an explicit admitted Play; the session itself never reconnects.
      replaceSession(); assert.equal(receipt.connections, 1);
      play(); tick(6225); await settle(); assert.equal(receipt.connections, 2); assert.equal(receipt.logins, 2);
      assert.equal(session.snapshot().phase, 'playing'); assert.deepEqual(errors, []); assert.deepEqual(receipt.errors, []);
    } finally { session.close(); scene.free(); }
  });
}
