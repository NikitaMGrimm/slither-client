// TEST ONLY project-owned composition fixture retained from authored leaderboard
// requirements. Native scene/socket/clock/projector are inert; supplied owners
// may be actual Wasm. This is not an independent renderer or browser driver.
import assert from 'node:assert/strict';
import {createStockClient} from '../../web/stock-client.mjs';
export function createGameplayComposition(createStockGameplay, wasm, options = {}) {
const login = () => ({ endpoint: 'ws://192.0.2.9:1234/slither',
  profile: { clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19 },
  nickname: 'Own 1234567', skin: 0, customSkin: new Uint8Array() });
const noOwn = tableMax => ({ schema: 1, enabled: true, tableMax, own: null,
  status: 'no-own', score: null, error: null });
const board = (rows = [], localRow = 0) => [108, localRow, 0, 0, 0, 0, ...rows.flat()];
const row = (count = 2, mass = 8388607, color = 255, name = [65]) =>
  [count >> 8, count & 255, mass >> 16, (mass >> 8) & 255, mass & 255, color, name.length, ...name];
const frame = commands => Uint8Array.from(commands.length === 1 ? commands[0]
  : commands.flatMap(command => [command.length >> 8, command.length & 255, ...command])).buffer;

function harness({ configure, callback, rows = true } = {}) {
  const trace = [], pending = [], errors = [], sockets = [], projections = [], faults = {};
  const intervals = new Map();
  let held = false, borrowed = false, ingress = false, commands = [], gameplay, time = 0, timerSerial = 0;
  const outside = () => { assert(!held, 'held sources released'); assert(!borrowed, 'native borrow released'); };
  function hit(name) {
    trace.push(name); faults[`${name}Effect`]?.();
    if (Object.hasOwn(faults, name)) throw faults[name];
  }
  const scene = {
    control_view() { outside(); hit('control-view'); return { own: null, follows: true, camera: { x: 0, y: 0 }, zoom: 1 }; },
    set_connected() { outside(); assert(!ingress); hit('connected'); },
    reset_lag() { outside(); assert(!ingress); hit('reset-lag'); },
    score_view() { assert.fail('zero-rank boards never request own score'); },
    advance() { assert.fail('only existing same-step clock'); },
    set_gaze_heading() { assert.fail('gaze returned by existing control'); },
    advance_with_control(nowMs, _lagging, control) {
      assert(held); assert(!borrowed); borrowed = true; hit('clock');
      try {
        const actions = control({ nowMs, delta: faults.delta ?? .5, wholeSteps: 0,
          control: { own: null, follows: true, camera: { x: 0, y: 0 }, zoom: 1 } });
        if (actions.resetWorld) hit('reset-world');
      } finally { borrowed = false; }
      return { free() { outsideBorrow(); hit('free-step'); } };
    },
    render_standard_with_face_presentation_at_size() { assert(held); outsideBorrow(); hit('render'); },
    apply_frame_and_render_standard_with_face_presentation_and_prey() {
      hit('legacy-packet'); return commands.filter(command => command[0] === 97).length;
    },
    apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud(...args) {
      assert(held); outsideBorrow(); borrowed = true; hit('native-packet');
      try {
        const plan = args[15], events = [], leaderboardRows = [];
        assert.equal(plan.schema, rows ? 2 : 1);
        for (const [commandIndex, command] of commands.entries()) {
          if (command[0] === 97) {
            const tableMax = command[1] ?? 17;
            events.push({ commandIndex, kind: 'setup', tableMax },
              { commandIndex, kind: 'setup-draw', view: noOwn(tableMax) });
          } else if (command[0] === 108 && plan.guards[commandIndex].playing) {
            events.push({ commandIndex, kind: 'leaderboard', localRow: command[1], rank: 0, population: 0,
              deathPending: plan.guards[commandIndex].deathPending });
            const copied = [];
            for (let offset = 6; offset < command.length;) {
              const [hi, lo, m1, m2, m3, rawColor, length] = command.slice(offset, offset + 7);
              copied.push({ ordinal: copied.length + 1, count: hi * 256 + lo,
                fractionalMass: (m1 * 65536 + m2 * 256 + m3) / 16777215,
                rawColor, paletteIndex: rawColor % 9, name: command.slice(offset + 7, offset + 7 + length) });
              offset += 7 + length;
            }
            leaderboardRows.push({ commandIndex, rows: copied });
          } else if (plan.finalCaptureIndices.includes(commandIndex)) {
            events.push({ commandIndex, kind: 'final-score', view: {
              schema: 1, enabled: true, tableMax: 3, status: 'ready', score: 42, error: null,
              own: { token: 1n, id: 7, logicalSegments: 1, fractionalMass: 0, scoreAdjustment: 0, scoreIndex: 1 },
            } });
          }
        }
        const report = { schema: plan.schema, commandCount: commands.length,
          setupDraws: commands.filter(command => command[0] === 97).length, events,
          ...(rows ? { leaderboardRows } : {}) };
        faults.report?.(report); hit('native-commit'); return report;
      } finally { borrowed = false; hit('native-return'); }
    },
  };
  function outsideBorrow() { assert(!borrowed); }
  const quality = {
    begin_connection() { outside(); hit('begin-connection'); },
    advance() { outsideBorrow(); hit('quality'); },
    update_statistics() { outsideBorrow(); hit('statistics'); return false; },
  };
  const controller = createStockClient({ StockControllerPolicy: wasm.StockControllerPolicy, scene, quality,
    adapter: {
      beginOperation() { assert(!held); held = true; hit('capture'); return {}; },
      endOperation() { assert(held); held = false; hit('release'); },
      resolveAppearance() {}, resolveRecipe() {}, resolveAntennaRandom() {},
    }, hostAssets: { resolveFood() {}, resolvePrey() {} },
    target: {}, palettes: [{}, {}, {}], background: {}, width: 960, height: 540 });
  const routed = Object.fromEntries(['packet', 'packetWithHud', 'frame', 'render', 'resize'].map(name =>
    [name, (...args) => { const result = controller[name](...args); hit(`${name}-return`); return result; }]));
  const projector = {
    project(tableMax, counts, masses) {
      outside(); assert(ingress, 'projection inside original session ingress'); hit('project');
      assert.equal(Object.getPrototypeOf(counts), Float64Array.prototype);
      assert.equal(Object.getPrototypeOf(masses), Float64Array.prototype);
      projections.push({ tableMax, counts: [...counts], masses: [...masses] });
      return faults.result ? faults.result(counts) : Float64Array.from(counts, count => count > tableMax + 2048 ? NaN : -0);
    },
  };
  class ObservedInput extends wasm.DesktopInput {
    reset() { hit('input-reset'); return super.reset(); }
  }
  const options = { scene, quality, controller: routed, hudReadout: true, leaderboardRows: rows,
    leaderboardProjector: projector,
    wasm: { DesktopInput: ObservedInput, SessionPolicy: wasm.SessionPolicy, LeaderboardHistory: wasm.LeaderboardHistory, HudHistory: wasm.HudHistory,
      ProfileLiteralParser: wasm.ProfileLiteralParser,
      encode_login(_version, _password, nickname) { hit('encode'); faults.encodedNickname = nickname; return Uint8Array.of(115); },
      solve_challenge() { return new Uint8Array(27); }, setup_protocol_version() { return 19; },
      decode_frame(bytes) {
        hit('decode'); commands = [];
        if (bytes[0] >= 32) commands.push([...bytes]);
        else for (let offset = 0; offset < bytes.length;) {
          const length = bytes[offset++] * 256 + bytes[offset++];
          commands.push([...bytes.slice(offset, offset + length)]); offset += length;
        }
        return Uint8Array.from(commands.flatMap(command => [0, 0, command.length >> 8, command.length & 255, ...command]));
      },
    },
    createSocket() {
      outside(); assert(!ingress); hit('construct');
      const socket = { readyState: 0, bufferedAmount: 0, closes: 0, sent: [],
        send(bytes) { this.sent.push([...bytes]); hit('send'); },
        close() { this.readyState = 3; this.closes++; hit('close'); },
        open() { this.readyState = 1; ingress = true; try { this.onopen?.(); } finally { ingress = false; } },
        message(...parts) { ingress = true; try { this.onmessage?.({ data: frame(parts) }); } finally { ingress = false; } },
      };
      sockets.push(socket); return socket;
    },
    now: () => time, defer(fn) { pending.push(fn); },
    setInterval(fn) { outside(); assert(!ingress); intervals.set(++timerSerial, fn); return timerSerial; },
    clearInterval(id) { outside(); assert(!ingress); intervals.delete(id); hit('clear-timer'); },
    onStatus() { outside(); assert(!ingress); hit('status'); },
    onFatal(error) { outside(); assert(!ingress); errors.push(error); hit('fatal'); },
    onHudPacket(report) { outside(); assert(ingress); hit('hud'); callback?.(report, gameplay); },
  };
  configure?.(options, { faults, trace, scene, routed, projector });
  try { gameplay = createStockGameplay({ ...options, GameplayPolicy: wasm.GameplayPolicy }); }
  catch (error) { try { controller.dispose(); } catch { /* Preserve the authored constructor witness. */ } throw error; }
  function flush() { let budget = 50; while (pending.length) { assert(budget--); pending.shift()(); } }
  function start(request = login()) {
    gameplay.play(request); gameplay.frame(8); flush();
    sockets[0].open(); sockets[0].message([54, 1]); flush();
  }
  return { gameplay, trace, errors, faults, sockets, projections, controller, start, flush, options, intervals,
    tick(value) { time = value; for (const fn of [...intervals.values()]) fn(); } };
}


return {h:harness(options),login,board,row};
}
