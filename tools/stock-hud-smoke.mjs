import assert from 'node:assert/strict';
import { Path2D, recordPatternPath } from './pattern-path-fixture.mjs';
import { announcementSmoke } from './announcement-smoke.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createSkinProvider } from '../web/skin-provider.mjs';
import { bundle, syntheticScene, syntheticSetup } from '../web/synthetic-scene.mjs';
import { copyHudIngressReport } from '../web/stock-hud-contract.mjs';
import { unpackCommands } from '../web/handshake-session.mjs';
import { createStockClient } from '../web/stock-client.mjs';
import { createStockSession } from '../web/stock-session.mjs';
import { syntheticChallenge } from './reference-parity.mjs';

const word = n => [n >>> 8 & 255, n & 255];
const triple = n => [n >>> 16 & 255, n >>> 8 & 255, n & 255];
const eyes = () => ({ kind: 'standard', distance: 6, separation: 6, radius: 6,
  pupilRadius: 3.5, pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0,
  outlineColor: 0, eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 });

// Authored ordered Math.pow oracle, independent of the returned/native view.
function expectedScore(n, index, mass) {
  const factors = [], cumulative = [];
  for (let i = 0; i <= n; i++) {
    factors.push(i === n ? factors[i - 1] : Math.pow(1 - i / n, 2.25));
    cumulative.push(i === 0 ? 0 : cumulative[i - 1] + 1 / factors[i - 1]);
  }
  const at = Math.min(index, n);
  const divided = mass / factors[at];
  const added = cumulative[at] + divided;
  const subtracted = added - 1;
  const multiplied = subtracted * 15;
  const shifted = multiplied - 5;
  return Math.floor(shifted) / 1;
}

/** Authored real-Wasm HUD witnesses with a Canvas recorder, never a raster oracle. */
export function stockHudSmoke(wasm) {
  let assertions = 0, primaryFailed = false, networkAttempts = 0;
  const cases = [], owners = [], globals = new Map();
  const eq = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
  const ok = (value, message) => { assertions++; assert.ok(value, message); };
  const rejects = callback => { assertions++; assert.throws(callback); };
  const install = (key, value) => {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  class CanvasRenderingContext2D {
    trace = []; stack = []; alpha = 1; blend = 'source-over'; transforms = []; alphaWrites = [];
    failSource = null; failMethod = null; failSourceAt = 1; failSourceCount = 0; failMethodAfterEyes = null; nullPattern = false;
    beforeCanvasCall = null; path = []; pathCommands = []; fillStyle = '#000000'; strokeStyle = '#000000'; lineWidth = 1;
    lineCap = 'butt'; lineJoin = 'miter';
    reset() { this.trace.push({ op: 'reset' }); this.stack = []; this.alpha = 1; this.blend = 'source-over'; this.transforms = []; this.alphaWrites = [];
      this.path = []; this.pathCommands = []; this.fillStyle = '#000000'; this.strokeStyle = '#000000'; this.lineWidth = 1;
      this.lineCap = 'butt'; this.lineJoin = 'miter'; }
    get globalAlpha() { return this.alpha; }
    set globalAlpha(requested) {
      if (Number.isFinite(requested) && requested >= 0 && requested <= 1) this.alpha = requested;
      this.trace.push({ op: 'alpha', requested, effective: this.alpha });
      this.alphaWrites = [...this.alphaWrites.slice(-1), { requested, effective: this.alpha }];
    }
    get globalCompositeOperation() { return this.blend; }
    set globalCompositeOperation(value) { this.throwIf('globalCompositeOperation'); this.blend = value; this.trace.push({ op: 'blend', value }); }
    savedState() { return { alpha: this.alpha, blend: this.blend, transforms: this.transforms.slice(),
      fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth,
      lineCap: this.lineCap, lineJoin: this.lineJoin }; }
    save() { this.beforeCanvasCall?.('save', this); this.stack.push(this.savedState()); this.trace.push({ op: 'save', state: this.savedState() }); }
    restore() { Object.assign(this, this.stack.pop()); this.trace.push({ op: 'restore', state: this.savedState() }); }
    setTransform(...args) { this.throwIf('setTransform'); this.transforms = [['setTransform', ...args]]; }
    translate(...args) { this.throwIf('translate'); this.transforms.push(['translate', ...args]); }
    scale(...args) { this.throwIf('scale'); this.transforms.push(['scale', ...args]); }
    rotate(...args) { this.throwIf('rotate'); this.transforms.push(['rotate', ...args]); }
    throwIf(method) {
      this.beforeCanvasCall?.(method, this);
      if (this.failMethod === method || (this.failMethodAfterEyes === method && this.trace.filter(v => v.op === 'fill' && v.commands?.[0]?.op === 'arc').length >= 4)) {
        throw new Error(`synthetic Canvas ${method}`);
      }
    }
    createPattern(source, repetition) { this.throwIf('createPattern'); return this.nullPattern ? null : { source, repetition }; }
    beginPath() { this.throwIf('beginPath'); this.path = []; this.pathCommands = []; this.trace.push({ op: 'beginPath' }); }
    arc(...args) { this.throwIf('arc'); this.path.push(args); this.pathCommands.push({ op: 'arc', args }); this.trace.push({ op: 'arc', args }); }
    moveTo(...args) { this.throwIf('moveTo'); this.path.push(args); this.pathCommands.push({ op: 'moveTo', args }); this.trace.push({ op: 'moveTo', args }); }
    lineTo(...args) { this.throwIf('lineTo'); this.path.push(args); this.pathCommands.push({ op: 'lineTo', args }); this.trace.push({ op: 'lineTo', args }); }
    closePath() { this.throwIf('closePath'); this.pathCommands.push({ op: 'closePath' }); this.trace.push({ op: 'closePath' }); }
    fillRect(...args) { this.trace.push({ op: 'fillRect', args }); }
    fillText(text) { this.throwIf('fillText'); this.trace.push({ op: 'text', text, fillStyle: this.fillStyle }); }
    stroke() { this.throwIf('stroke'); this.trace.push({ op: 'stroke', path: this.path.slice(), commands: this.pathCommands.slice(), color: this.strokeStyle,
      width: this.lineWidth, alpha: this.alpha, blend: this.blend, transforms: this.transforms.slice(),
      lineCap: this.lineCap, lineJoin: this.lineJoin }); }
    fill(...args) { this.throwIf('fill'); if (recordPatternPath(this, args[0])) return; this.trace.push({ op: 'fill', args, path: this.path.slice(), commands: this.pathCommands.slice(),
      color: this.fillStyle, alpha: this.alpha, blend: this.blend, transforms: this.transforms.slice() }); }
    drawImage(source, ...args) {
      this.throwIf('drawImage');
      if (source === this.failSource && ++this.failSourceCount === this.failSourceAt) throw new Error('synthetic Canvas drawImage');
      this.trace.push({ op: 'image', source, args, alpha: this.alpha, blend: this.blend,
        transforms: this.transforms.slice(), alphaWrites: this.alphaWrites.slice() });
    }
  }
  class HTMLCanvasElement {
    context = new CanvasRenderingContext2D(); _width = 32; height = 32;
    constructor(name = 'canvas') { this.name = name; this.context.canvas = this; }
    get width() { return this._width; }
    set width(value) { this._width = value; this.context.reset(); }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
  }
  class HTMLImageElement { complete = true; naturalWidth = 64; naturalHeight = 64; constructor(name = 'image') { this.name = name; } }

  const denied = () => { networkAttempts++; throw new Error('HUD smoke forbids network'); };
  for (const key of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'WebTransport']) install(key, denied);
  for (const [key, value] of Object.entries({ HTMLCanvasElement, HTMLImageElement, CanvasRenderingContext2D, Path2D })) install(key, value);
  const appearance = unpackCommands(wasm.decode_frame(syntheticScene(), false)).find(c => c[0] === 115);
  const setup = n => { const bytes = syntheticSetup(); bytes.set(word(n), 4); return bytes; };
  const spawn = id => { const bytes = Uint8Array.from(appearance); bytes.set(word(id), 1); return bytes; };
  const mass = (value, id = 0) => [104, ...word(id), ...triple(value)];
  const prey = id => [121, ...word(id), 9, ...triple(162900), ...triple(162750), 20, 48,
    ...triple(0), ...triple(0), ...word(1000)];
  const food = [70, 108, 108, 0, 128, 128, 20];
  const leaderboard = [108, 2, 0, 17, 0, 33];
  const badLeaderboard = [...leaderboard, 0, 4, 0, 0, 0, 10, 2, 65];
  const guard = (playing = true, closeRequested = false, deathPending = false) => ({ playing, closeRequested, deathPending });
  // Caller-supplied decisions only: this fixture deliberately adds no lifecycle machine.
  const plan = (commands, captures = [], guards = commands.map(() => guard())) => ({
    schema: 1, commandCount: commands.length, guards, finalCaptureIndices: captures,
  });
  const frozen = value => {
    if (value && typeof value === 'object') {
      ok(Object.isFrozen(value), 'each report record/array is frozen');
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        ok(Object.hasOwn(descriptor, 'value'), 'report contains own data only');
        frozen(descriptor.value);
      }
    }
  };
  function fixture(enabled = true) {
    const scene = new wasm.AnimatedScene(0), quality = new wasm.DesktopQuality(1, 0);
    owners.push(scene, quality);
    if (enabled) scene.enable_score_tracking();
    const target = new HTMLCanvasElement('hud-target'); target.width = 320; target.height = 180;
    target.context.trace = [];
    const palettes = [0, 1, 2].map(i => new HTMLCanvasElement('palette-' + i));
    const background = new HTMLImageElement('hud-background'), body = new HTMLCanvasElement('hud-body');
    const metadata = { status: 'ready', basePalette: 0, custom: false,
      runs: [{ palette: 0, count: 1 }], palettes: [{ variants: [{ asset: 0 }], boostGlow: { asset: 0 } }],
      variantMode: 'cycle', variantPeriod: 1, eyes: eyes(), effects: ['outline', 'shadow', 'death-highlight'].map(kind => ({ kind, asset: 0, opacity: 1 })),
      bodyStyle: { detailedSegments: false, swell: 0, rotateSegments: true, headFade: null, tailFade: null },
      attachment: null, unsupportedFeatures: [] };
    const provider = createSkinProvider({ trusted: true, realm: { HTMLCanvasElement, HTMLImageElement },
      resolveHostRecipe: request => request, normalizeHostRecipe: () => metadata });
    const snapshot = { revision: 'hud-1', assetCatalog: [{ source: body, state: 'ready' }] };
    const calls = { appearance: 0, food: 0, prey: 0, recipe: 0, random: 0 };
    const sources = [];
    const entry = (source, revision) => ({ asset: { source, revision, kind: 'canvas', status: 'ready',
      width: source.width, height: source.height }, width: source.width, height: source.height,
      halfWidth: source.width / 2, halfHeight: source.height / 2 });
    const image = label => { const source = new HTMLCanvasElement(label + '-' + sources.length); sources.push(source); return source; };
    const callbacks = {
      appearance: () => { calls.appearance++; return { face: { kind: 'paired', eyes: eyes(), decoration: { kind: 'none' } }, antenna: null }; },
      food: request => { calls.food++; return { randomPhaseUnit: 0, randomWobbleUnit: 0,
        palette: { color: request.palette, count: 1, bodies: [entry(image('food-body'), 'hud-food')],
          outlines: [entry(image('food-outline'), 'hud-food')], glows: [entry(image('food-glow'), 'hud-food')] } }; },
      prey: request => { calls.prey++; return { randomPhaseUnit: 0, randomRateUnit: 0,
        palette: { color: request.palette, bodies: [entry(image('prey-body'), 'hud-prey')],
          glows: [entry(image('prey-glow'), 'hud-prey')] } }; },
      recipe: request => { calls.recipe++; return provider.resolve(request, snapshot); },
      random: () => { calls.random++; throw new Error('No antenna random expected'); },
    };
    const args = (commands, overrides = {}) => [overrides.bytes ?? bundle(...commands), false,
      overrides.appearance ?? callbacks.appearance, overrides.food ?? callbacks.food,
      overrides.prey ?? callbacks.prey, target, ...palettes, background,
      overrides.width ?? 320, overrides.height ?? 180,
      overrides.recipe ?? callbacks.recipe, callbacks.random, quality];
    const hud = (commands, p = plan(commands), overrides) => scene
      .apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud(...args(commands, overrides), p);
    const legacy = (commands, overrides) => scene
      .apply_frame_and_render_standard_with_face_presentation_and_prey(...args(commands, overrides));
    const state = () => [scene.snapshot(), scene.score_view(), scene.food_state(), scene.prey_state(),
      scene.drawn_snakes(), Array.from(scene.camera_samples()), Array.from(scene.own_body_samples()),
      Array.from(scene.length_samples()), Array.from(scene.boundary_samples()), quality.snapshot()];
    const atomic = (callback, untouchedCanvas = true) => {
      const before = state(), trace = target.context.trace.slice();
      let failed = false, caught;
      try { callback(); } catch (error) { failed = true; caught = error; }
      ok(failed, 'transaction must reject, including an undefined primary');
      eq(state(), before, 'failed transaction preserves model/score/sources/quality');
      if (untouchedCanvas) eq(target.context.trace, trace, 'failure before Canvas submission');
      return caught;
    };
    return { scene, quality, target, palettes, background, callbacks, calls, sources, body, hud, legacy, state, atomic };
  }
  try {
    announcementSmoke({ fixture, setup, spawn, food, prey, plan, expectedScore, eq, ok, rejects });
    cases.push('selected announcement text, receipt order, shared lifecycle and rollback ABI');
    const f = fixture();
    const commands = [setup(17), spawn(0), [82, 3], [118, 1], [250], [112], mass(8388608), [82, 5], [118, 1], setup(29)];
    const report = f.hud(commands, plan(commands, [3, 8]));
    eq(Reflect.ownKeys(report).sort(), ['schema', 'commandCount', 'setupDraws', 'events'].sort());
    eq(report.schema, 1); eq(report.commandCount, 10); eq(report.setupDraws, 2);
    eq(report.events.map(e => [e.commandIndex, e.kind]), [[0, 'setup'], [0, 'setup-draw'],
      [1, 'own-length-scheduled'], [3, 'final-score'], [6, 'own-length-scheduled'],
      [8, 'final-score'], [9, 'setup'], [9, 'setup-draw']]);
    const finals = report.events.filter(e => e.kind === 'final-score').map(e => e.view);
    eq(finals.map(v => [v.tableMax, v.own.scoreAdjustment, v.own.fractionalMass]),
      [[17, 3, 0], [17, 5, 8388608 / 16777215]]);
    for (const view of finals) {
      eq(Reflect.ownKeys(view).sort(), ['schema', 'enabled', 'tableMax', 'own', 'status', 'score', 'error'].sort());
      eq(Reflect.ownKeys(view.own).sort(), ['token', 'id', 'logicalSegments', 'fractionalMass', 'scoreAdjustment', 'scoreIndex'].sort());
      eq(view.status, 'ready'); eq(view.enabled, true); eq(view.error, null);
      eq(view.score, expectedScore(view.tableMax, view.own.scoreIndex, view.own.fractionalMass));
    }
    eq(finals[0].own.token, finals[1].own.token); eq(typeof finals[0].own.token, 'bigint');
    ok(finals[0].own.token >= 1n && finals[0].own.token <= 18446744073709551615n);
    eq(report.events[2].token, finals[0].own.token);
    eq(report.events[1].view.status, 'no-own'); eq(f.scene.score_view().tableMax, 29);
    eq(f.target.context.trace.filter(c => c.op === 'reset').length, 2);
    frozen(report);
    rejects(() => { report.events[3].view.own.scoreAdjustment = 99; });
    f.hud([[82, 7]]); eq(finals[0].own.scoreAdjustment, 3, 'later mutation cannot rewrite capture');
    eq(finals[1].own.scoreAdjustment, 5); cases.push('intermediate finals, no-event command indices, actual Setup draws, frozen copied views');

    const beforeReuse = f.scene.score_view().own;
    f.hud([[115, 0, 0, 1], spawn(0)]);
    for (let i = 1; i <= 12; i++) f.scene.advance(i * 40, false).free();
    const reused = [mass(16777215), [82, 9], [118, 1]];
    const retained = f.hud(reused, plan(reused, [2]));
    eq(retained.events.map(e => e.kind), ['final-score']);
    eq(retained.events[0].view.own.token, beforeReuse.token);
    eq(retained.events[0].view.own.fractionalMass, beforeReuse.fractionalMass);
    eq(retained.events[0].view.own.logicalSegments, beforeReuse.logicalSegments);
    eq(retained.events[0].view.own.scoreAdjustment, 9);
    cases.push('original own token/count/mass survives expiry and reused wire ID');

    const l = fixture(); l.hud([setup(17), spawn(0)]);
    eq(l.hud([leaderboard], plan([leaderboard], [], [guard(false)])).events, []);
    for (const deathPending of [false, true]) {
      const header = l.hud([leaderboard], plan([leaderboard], [], [guard(true, false, deathPending)]));
      eq(header.events, [{ commandIndex: 0, kind: 'leaderboard', localRow: 2, rank: 17, population: 33, deathPending }]);
    }
    l.atomic(() => l.hud([[82, 3], badLeaderboard], plan([[82, 3], badLeaderboard], [], [guard(false), guard(false)])));
    const row = [0, 4, 0, 0, 0, 10, 0];
    eq(l.hud([[...leaderboard, ...Array.from({ length: 11 }, () => row).flat()]]).events.length, 1);
    eq(l.hud([[109, 255]]).events, []);
    eq(l.legacy([badLeaderboard]), 0, 'legacy still admits opaque leaderboard');
    cases.push('gated headers, deathPending, complete malformed tail, eleven rows, opaque m and legacy l');

    const rowsPlan = (commands, guards) => ({ ...plan(commands, [], guards), schema: 2 });
    const rawRow = (count, mass, color, name) => [...word(count), ...triple(mass), color, name.length, ...name];
    const named = name => [...leaderboard, ...rawRow(4, 0, 10, name)];
    const rowsFixture = fixture(); rowsFixture.hud([setup(17), spawn(0)]);
    const a = named([65]), b = named([66]);
    eq(rowsFixture.hud([a]), rowsFixture.hud([b]), 'schema1 remains deliberately header-only');
    const namedA = rowsFixture.hud([a], rowsPlan([a]));
    const namedB = rowsFixture.hud([b], rowsPlan([b]));
    eq(namedA.leaderboardRows[0].rows[0].name, [65]);
    eq(namedB.leaderboardRows[0].rows[0].name, [66]);
    ok(JSON.stringify(namedA) !== JSON.stringify(namedB), 'explicit rows retain the previously lost name distinction');
    eq(Reflect.ownKeys(namedA).sort(), ['schema', 'commandCount', 'setupDraws', 'events', 'leaderboardRows'].sort());
    eq(namedA.schema, 2); eq(namedA.setupDraws, 0);
    const arbitraryName = Array.from({ length: 255 }, (_, index) => index);
    const board = [...leaderboard, ...rawRow(65535, 16777215, 255, arbitraryName),
      ...rawRow(0, 8388608, 10, []), ...rawRow(4, 1, 0, [255])];
    const rowCommands = [board, [250], leaderboard, a, [82, 3], setup(29)];
    const rowReport = rowsFixture.hud(rowCommands, rowsPlan(rowCommands));
    eq(rowReport.leaderboardRows.map(value => value.commandIndex), [0, 2, 3]);
    eq(rowReport.leaderboardRows[0].rows, [
      { ordinal: 1, count: 65535, fractionalMass: 1, rawColor: 255, paletteIndex: 3, name: arbitraryName },
      { ordinal: 2, count: 0, fractionalMass: 8388608 / 16777215, rawColor: 10, paletteIndex: 1, name: [] },
      { ordinal: 3, count: 4, fractionalMass: 1 / 16777215, rawColor: 0, paletteIndex: 0, name: [255] },
    ]);
    eq(rowReport.leaderboardRows[1].rows, []);
    eq(rowReport.leaderboardRows[2].rows[0].name, [65]);
    eq(rowReport.setupDraws, 1); frozen(rowReport);
    rejects(() => { rowReport.leaderboardRows[0].rows[0].name[0] = 99; });
    const suppressedRows = rowsFixture.hud([board, a], rowsPlan([board, a],
      [guard(false), guard(true, true, true)]));
    eq(suppressedRows.leaderboardRows.map(value => value.commandIndex), [1]);
    eq(suppressedRows.events[0].deathPending, true);
    const manyRows = [...leaderboard, ...Array.from({ length: 4097 }, () => rawRow(4, 0, 10, [])).flat()];
    eq(rowsFixture.hud([manyRows], rowsPlan([manyRows]), {
      bytes: Uint8Array.from(manyRows),
    }).leaderboardRows[0].rows.length, 4097);
    rowsFixture.atomic(() => rowsFixture.hud([setup(17), badLeaderboard],
      rowsPlan([setup(17), badLeaderboard], [guard(false), guard(false)])));
    rowsFixture.atomic(() => rowsFixture.hud([board, [104]], rowsPlan([board, [104]])));
    rowsFixture.scene.reset();
    eq(rowReport.leaderboardRows[0].rows[0].name, arbitraryName, 'copied names survive native reset');
    eq(namedA.leaderboardRows[0].rows[0].name, [65]);
    cases.push('schema2 raw rows, native f64 and byte ownership, all-row order, schema1 compatibility and rollback');

    const rowConversion = fixture(); rowConversion.hud([setup(17), spawn(0)]);
    for (const primary of [{ rowConversionFailure: true }, undefined]) {
      const originalKeys = Reflect.ownKeys;
      try {
        eq(rowConversion.atomic(() => rowConversion.hud([board, setup(29)], rowsPlan([board, setup(29)]), {
          recipe(request) {
            const result = rowConversion.callbacks.recipe(request);
            Reflect.ownKeys = value => {
              if (Object.hasOwn(value, 'ordinal')) throw primary;
              return originalKeys(value);
            };
            return result;
          },
        })), primary, 'row conversion fails before Canvas/commit with exact primary');
      } finally { Reflect.ownKeys = originalKeys; }
    }
    eq(rowConversion.hud([a], rowsPlan([a])).leaderboardRows[0].rows[0].name, [65]);
    cases.push('schema2 conversion errors precede Canvas and model/source commit, including undefined primary');

    // Actual Rust/Wasm -> controller -> session, with an in-memory socket and held-source double.
    const composed = fixture(), sourceLease = Object.freeze({ revision: 'authored-row-smoke' });
    const rowTrace = [], sockets = [], delivered = [], sessionErrors = [];
    let held = false, clockReads = 0, throwHud = false;
    const adapter = {
      beginOperation() { ok(!held); held = true; rowTrace.push('begin'); return sourceLease; },
      endOperation() { ok(held); held = false; rowTrace.push('end'); },
      resolveAppearance(request) { ok(held); return composed.callbacks.appearance(request); },
      resolveRecipe(request) { ok(held); return composed.callbacks.recipe(request); },
      resolveAntennaRandom(request) { ok(held); return composed.callbacks.random(request); },
    };
    const controller = createStockClient({ scene: composed.scene, quality: composed.quality, adapter,
      hostAssets: {
        resolveFood(request, lease) { ok(held); eq(lease, sourceLease); return composed.callbacks.food(request); },
        resolvePrey(request, lease) { ok(held); eq(lease, sourceLease); return composed.callbacks.prey(request); },
      }, target: composed.target, palettes: composed.palettes, background: composed.background, width: 320, height: 180 });
    const session = createStockSession({ wasm, now() { clockReads++; return 1000; }, createSocket() {
      const socket = { readyState: 0, bufferedAmount: 0, sends: [], closes: 0,
        send(bytes) { this.sends.push(Uint8Array.from(bytes)); },
        close() { this.closes++; this.readyState = 3; } };
      sockets.push(socket); return socket;
    } });
    owners.push({ free: () => session.dispose() });
    const unsubscribe = session.subscribeWithLeaderboardRows({
      packet(bytes, elapsed, packetPlan) {
        rowTrace.push('packet'); eq(packetPlan.schema, 2);
        return controller.packetWithHud(bytes, elapsed, packetPlan);
      },
      hud(value) {
        rowTrace.push('hud'); ok(!held); eq(session.snapshot().connected, true); frozen(value);
        delivered.push(value); if (throwHud) throw undefined;
      },
      state() { rowTrace.push('state'); },
      error(value) { sessionErrors.push(value); },
    });
    session.play({ endpoint: 'ws://192.0.2.9:1234/slither', profile: {
      clientVersion: 1, password: new Uint8Array(20), protocolVersion: 19,
    }, nickname: 'Authored rows', skin: 0, customSkin: new Uint8Array() });
    eq(sockets.length, 0);
    const resetStep = composed.scene.advance_with_control(0, false, request => session.afterStep(request));
    resetStep.free(); session.commitControl(); eq(sockets.length, 1);
    const socket = sockets[0]; socket.readyState = 1; socket.onopen();
    const message = bytes => socket.onmessage({ data: Uint8Array.from(bytes).buffer });
    message([54, ...syntheticChallenge('A'.repeat(27))]);
    eq(session.snapshot().phase, 'setup'); eq(socket.sends.length, 4);
    rowTrace.length = 0; const beforeReceiveReads = clockReads;
    message(bundle(setup(17), spawn(0), a));
    eq(sessionErrors, []); eq(rowTrace, ['packet', 'begin', 'end', 'hud', 'state']);
    eq(clockReads, beforeReceiveReads + 1, 'one existing receive clock read');
    eq(delivered[0].leaderboardRows[0].commandIndex, 2);
    eq(delivered[0].leaderboardRows[0].rows[0].name, [65]);
    eq(controller.diagnostics().draws, 1);
    const qualityBeforeRows = composed.quality.snapshot(); rowTrace.length = 0;
    message(b); eq(rowTrace, ['packet', 'begin', 'end', 'hud', 'state']);
    eq(delivered[1].leaderboardRows[0].rows[0].name, [66]);
    eq(composed.quality.snapshot(), qualityBeforeRows); eq(controller.diagnostics().draws, 1);
    eq(socket.sends.length, 4, 'row delivery adds no send');
    throwHud = true; message(a);
    eq(session.snapshot().phase, 'failed'); eq(sessionErrors, [undefined]);
    eq(delivered.length, 3); eq(socket.closes, 1); eq(socket.sends.length, 4);
    eq(socket.onmessage, null, 'post-commit callback failure detaches without replay');
    unsubscribe(); controller.dispose();
    cases.push('actual Wasm/controller/session row delivery after source release and control commit, no extra clock/send or replay');

    const invalid = fixture(); const cp = [setup(17), spawn(0), [118, 1], [250], [118, 1]];
    const valid = () => plan(cp, [2, 4]);
    const badPlans = [null, Promise.resolve(valid()), { ...valid(), schema: 3 }, { ...valid(), commandCount: 0 },
      { ...valid(), commandCount: 4097 }, { ...valid(), commandCount: 4 }, { ...valid(), then: () => {} },
      { ...valid(), [Symbol('extra')]: true }, { ...valid(), guards: [] },
      { ...valid(), guards: Array(5) }, { ...valid(), guards: [...valid().guards, guard()] },
      { ...valid(), guards: Object.assign(valid().guards, { extra: true }) },
      { ...valid(), guards: Object.assign(valid().guards, { [Symbol('extra')]: true }) },
      { ...valid(), guards: [Object.create(guard()), ...valid().guards.slice(1)] },
      { ...valid(), guards: [{ ...guard(), playing: 1 }, ...valid().guards.slice(1)] },
      { ...valid(), guards: [{ ...guard(), then: true }, ...valid().guards.slice(1)] },
      plan(cp.slice(0, 4), [2]),
      { ...valid(), guards: runInNewContext('[{playing:true,closeRequested:false,deathPending:false}]') },
      runInNewContext('({schema:1,commandCount:1,guards:[],finalCaptureIndices:[]})')];
    let getterCalls = 0;
    const accessor = valid(); Object.defineProperty(accessor, 'guards', { get() { getterCalls++; throw Error('getter'); } }); badPlans.push(accessor);
    const element = valid(); Object.defineProperty(element.guards, '0', { get() { getterCalls++; throw Error('element getter'); } }); badPlans.push(element);
    const guardAccessor = valid(); Object.defineProperty(guardAccessor.guards[0], 'playing', { get() { getterCalls++; throw Error('guard getter'); } }); badPlans.push(guardAccessor);
    const huge = valid(); huge.guards = new Proxy(Array(4097), { ownKeys() { getterCalls++; throw Error('must bound before keys'); } }); badPlans.push(huge);
    const structural = { structuralFailure: true };
    badPlans.push(new Proxy(valid(), { getPrototypeOf() { throw structural; } }));
    badPlans.push(new Proxy(valid(), { ownKeys() { throw structural; } }));
    badPlans.push(new Proxy(valid(), { getOwnPropertyDescriptor() { throw structural; } }));
    for (const indices of [[], [2], [4], [2, 2, 4], [4, 2], [2, 3, 4], [1, 2, 4], [2, 4, 5]]) badPlans.push({ ...valid(), finalCaptureIndices: indices });
    for (const p of badPlans) invalid.atomic(() => invalid.hud(cp, p));
    for (const primary of [undefined, null, false, 0]) {
      const p = new Proxy(valid(), { getPrototypeOf() { throw primary; } });
      eq(invalid.atomic(() => invalid.hud(cp, p)), primary, 'caught structural failure preserves primary presence/value');
    }
    eq(getterCalls, 0); eq(invalid.calls, { appearance: 0, food: 0, prey: 0, recipe: 0, random: 0 });
    for (const control of [[112, 0], [118], [118, 1, 2], [54]]) {
      const commands = [setup(17), spawn(0), control];
      invalid.atomic(() => invalid.hud(commands));
    }
    eq(invalid.calls.appearance, 0);
    const nullPlan = valid(); Object.setPrototypeOf(nullPlan, null);
    nullPlan.guards.forEach(g => Object.setPrototypeOf(g, null));
    eq(invalid.hud(cp, nullPlan).events.filter(e => e.kind === 'final-score').length, 2);
    cases.push('closed current-realm/null plans, bounded dense arrays, accessor tripwires, caught proxies and exhaustive pre-callback native admission');

    const disabled = fixture(false); disabled.atomic(() => disabled.hud([setup(17), spawn(0)]));
    eq(disabled.scene.score_view().enabled, false); eq(disabled.calls.appearance, 0);
    const missing = fixture(); const preOwn = [setup(17), [118, 1]];
    missing.atomic(() => missing.hud(preOwn, plan(preOwn, [1])));
    const suppressed = [[118, 2], [118, 1]];
    eq(missing.hud(suppressed, plan(suppressed, [], [guard(), guard(true, true)])).events, []);
    cases.push('tracking required, required unavailable final rolls back, unselected final does not invent score lookup');

    const atomic = fixture(); atomic.hud([setup(17), spawn(0), food, prey(1)]);
    for (const bad of [[104], badLeaderboard]) atomic.atomic(() => atomic.hud([[82, 6], setup(29), bad]));
    const primary = { factoryFailure: true }; let observed;
    const stagedStart = atomic.sources.length;
    atomic.atomic(() => atomic.hud([[82, 6], food, prey(2), spawn(9)], undefined, {
      appearance() { throw primary; },
    }));
    const stagedSources = atomic.sources.slice(stagedStart);
    ok(stagedSources.length >= 5, 'both source factories ran before the late appearance failure');
    try { atomic.hud([spawn(9)], undefined, { appearance() { throw primary; } }); } catch (error) { observed = error; }
    eq(observed, primary);
    const wasComplete = atomic.background.complete; atomic.background.complete = false;
    atomic.atomic(() => atomic.hud([[82, 6], food, prey(2), setup(29)])); atomic.background.complete = wasComplete;
    // Reuse a staged source with changed intrinsic dimensions but the same revision.
    // A leaked failed registry snapshot would reject this new authoritative size.
    const stagedFood = stagedSources[0]; stagedFood.width = 47;
    const retryFood = request => {
      const result = atomic.callbacks.food(request);
      result.palette.bodies[0] = { asset: { source: stagedFood, revision: 'hud-food', kind: 'canvas',
        status: 'ready', width: 47, height: 32 }, width: 47, height: 32, halfWidth: 23.5, halfHeight: 16 };
      return result;
    };
    eq(atomic.hud([food], undefined, { food: retryFood }).setupDraws, 0);
    eq(atomic.hud([food, prey(2)]).setupDraws, 0);
    // Force a conversion failure inside the caught shared validator, after native callbacks.
    const ownKeys = Reflect.ownKeys;
    try {
      eq(atomic.atomic(() => atomic.hud([[82, 6], setup(29)], undefined, {
        recipe(request) { const result = atomic.callbacks.recipe(request); Reflect.ownKeys = () => { throw primary; }; return result; },
      })), primary, 'report conversion failure preserves the primary');
    } finally { Reflect.ownKeys = ownKeys; }
    eq(atomic.scene.score_view().own.scoreAdjustment, 0);
    const beforeCanvas = atomic.state(); atomic.target.context.failMethod = 'createPattern';
    atomic.atomic(() => atomic.hud([[82, 6], setup(29)])); atomic.target.context.failMethod = null;
    eq(atomic.state(), beforeCanvas);
    atomic.target.context.failMethod = 'translate';
    atomic.atomic(() => atomic.hud([[82, 6], setup(29)]), false);
    atomic.target.context.failMethod = null;
    eq(atomic.hud([[82, 4]]).setupDraws, 0, 'borrow and registries usable after caught Canvas failure');
    cases.push('late typed/factory/preflight/report-conversion/Canvas failure rollback and caught primary identity');

    const budget = fixture(); const sixtyFour = Array.from({ length: 64 }, () => setup(17));
    eq(budget.hud(sixtyFour, undefined, { width: 1, height: 1 }).setupDraws, 64);
    eq(budget.target.context.trace.filter(c => c.op === 'reset').length, 64);
    budget.atomic(() => budget.hud([...sixtyFour, setup(17)], undefined, { width: 1, height: 1 }));
    budget.atomic(() => budget.hud(Array.from({ length: 5 }, () => setup(17)), undefined, { width: 4096, height: 4096 }));
    const opaque = Array.from({ length: 4096 }, () => [250]);
    eq(budget.hud(opaque).commandCount, 4096);
    budget.atomic(() => budget.hud([...opaque, [250]], plan(opaque)));
    cases.push('actual 64-Setup count, draw/pixel budgets, 4096 original commands and framing rejection above bound');

    const old = fixture(), modern = fixture();
    const neutral = [setup(17), spawn(0), food, prey(1), mass(8388608), setup(29)];
    eq(old.legacy(neutral), 2); eq(modern.hud(neutral).setupDraws, 2);
    eq(old.state(), modern.state());
    const normalize = f => f.target.context.trace.map(c => c.source ? { ...c, source: c.source.name } : c);
    eq(normalize(old), normalize(modern), 'HUD opt-in preserves existing draw commands');
    const noSetup = [[82, 3]]; const trace = old.target.context.trace.slice();
    eq(old.legacy(noSetup), 0); eq(old.target.context.trace, trace);
    cases.push('legacy u32 signatures, zero-draw neutrality and identical model/Canvas commands');

    const numeric = fixture();
    const empty = [115, 0, 9, ...triple(0), 48, ...triple(0), ...word(128), ...triple(0), 0,
      ...triple(500000), ...triple(5000), 0, 0, 255];
    const negativeCommands = [setup(1), empty, [118, 1]];
    const negative = numeric.hud(negativeCommands, plan(negativeCommands, [2])).events.at(-1).view;
    eq(negative.score, -20); eq(negative.own.logicalSegments, 0);
    const long = [...empty, ...triple(38000), ...triple(5000),
      ...Array.from({ length: 4070 }, () => [128, 127]).flat(), 0, 0];
    const large = fixture(); const largeCommands = [setup(4072), long, mass(16777215, 9), [118, 1]];
    const largeView = large.hud(largeCommands, plan(largeCommands, [3])).events.at(-1).view;
    ok(largeView.score > 4294967295); ok(Number.isInteger(largeView.score));
    eq(largeView.score, large.scene.score_view().score);
    const unsupported = large.hud([setup(1)]).events.at(-1).view;
    eq(unsupported.status, 'unsupported'); eq(unsupported.score, null);
    eq(unsupported.error, 'index-out-of-range');
    large.atomic(() => large.hud([[118, 1]], plan([[118, 1]], [0])));
    const zeroCommands = [[82, 1], mass(5592406, 9), [118, 1]];
    const zeroReport = numeric.hud(zeroCommands, plan(zeroCommands, [2]));
    ok(Object.is(zeroReport.events.at(-1).view.score, 0));
    ok(Object.is(zeroReport.events.at(-1).view.score, numeric.scene.score_view().score));
    // The admitted score arithmetic yields positive zero here. A separate closed
    // report double witnesses the shared copier preserving negative zero too.
    const signedDouble = { ...zeroReport, events: zeroReport.events.map(event => event.kind === 'final-score'
      ? { ...event, view: { ...event.view, score: -0 } } : event) };
    ok(Object.is(copyHudIngressReport(signedDouble, 3).events.at(-1).view.score, -0));
    cases.push('negative/above-u32 integer scores, BigInt own token, exact established score shape and signed-zero preservation');

    {
      // Authored synthetic tint inputs; Rust resolves [132,182,255] once at appearance.
      const g = fixture(); g.scene.enable_nicknames();
      const nicknameTint = { baseRgb: [8, 99, 250], randomUnits: [0, 0.5, 1 - 2 ** -53] };
      const appearance = () => ({ ...g.callbacks.appearance(), nicknameTint });
      const commands = [setup(17), spawn(0), setup(29)];
      g.target.context.trace = [];
      eq(g.hud(commands, plan(commands), { appearance }).setupDraws, 2);
      eq(g.target.context.trace.filter(c => c.op === 'text').map(c => c.fillStyle), ['#84b6ff']);
      eq(g.calls.appearance, 1);
      const invalid = [setup(31), spawn(1)];
      g.atomic(() => g.hud(invalid, plan(invalid), { appearance: () => ({ ...g.callbacks.appearance(),
        nicknameTint: { ...nicknameTint, randomUnits: [0, 1, 0] } }) }));
      cases.push('default HUD lane retains appearance nickname tint for ordered Setup text and rejects invalid units');
    }
    eq(networkAttempts, 0);
    return { assertions, cases: cases.length, checks: cases, owners: owners.length,
      networkAttempts, evidence: 'authored real-Wasm/Canvas recorder only; no browser/pixels/host/server acceptance' };
  } catch (error) { primaryFailed = true; console.error('HUD smoke completed cases before failure:', cases); throw error; }
  finally {
    const errors = [];
    for (const owner of owners) { try { owner.free(); } catch (error) { errors.push(error); } }
    for (const [key, prior] of globals) {
      if (prior) Object.defineProperty(globalThis, key, prior); else delete globalThis[key];
    }
    if (errors.length) {
      if (primaryFailed) console.error('Additional HUD smoke cleanup failures:', errors);
      else throw new AggregateError(errors, 'HUD smoke cleanup failed');
    }
  }
}

const fingerprint = name => {
  const bytes = fs.readFileSync(name);
  return { path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error('Supply explicit generated JS and Wasm paths');
  const files = process.argv.slice(2).map(name => path.resolve(name));
  // wasm-bindgen copies the shared validator into its generated snippets graph.
  // Pin that imported module too; the JS/Wasm pair alone is no longer complete.
  const snippets = Array.from(fs.readFileSync(files[0], 'utf8').matchAll(/^import .* from '(\.\/snippets\/[^']+)';$/gm),
    match => path.resolve(path.dirname(files[0]), match[1]));
  const pinnedFiles = [...files, ...snippets];
  const before = pinnedFiles.map(fingerprint);
  console.log(JSON.stringify({ event: 'stock-hud-smoke-before', artifacts: before }));
  let result, failed = false, primary;
  try {
    const wasm = await import(pathToFileURL(files[0]).href);
    wasm.initSync({ module: fs.readFileSync(files[1]) });
    result = stockHudSmoke(wasm);
  } catch (error) { failed = true; primary = error; }
  const after = pinnedFiles.map(fingerprint);
  console.log(JSON.stringify({ event: 'stock-hud-smoke-after', artifacts: after,
    unchanged: JSON.stringify(before) === JSON.stringify(after), result, failed,
    failure: failed ? String(primary?.stack ?? primary) : null }));
  let fingerprintFailure;
  try { assert.deepEqual(after, before, 'Supplied generated artifacts changed during smoke'); }
  catch (error) { fingerprintFailure = error; }
  if (failed) { if (fingerprintFailure) console.error(fingerprintFailure); throw primary; }
  if (fingerprintFailure) throw fingerprintFailure;
}
