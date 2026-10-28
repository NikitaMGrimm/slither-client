import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalGameHost } from '../web/local-game-host.mjs';
import { createGateTestDom, issuedMinimapViewDouble } from './game-gate-test-fixture.mjs';
import { createOwnedMinimapUi } from '../extension/game-owned-minimap-ui.mjs';
import { createClientInput } from '../web/client-input.mjs';

// Explicit DOM, generated-source and browser-capability doubles; no real sockets.
function fixture({ href = 'http://127.0.0.1:18884/game', decode, minimap = false } = {}) {
  const dom = createGateTestDom({ hud: true, ownedHud: true, ownedPlay: true, leaderboard: true, minimap });
  const document = new dom.Document();
  const listeners = new Map(), sockets = [], calls = [], canvases = [];
  const gradient = (...coordinates) => ({ coordinates, stops: [],
    addColorStop(offset, color) { this.stops.push([offset, color]); } });
  class Events {
    addEventListener(type, callback, capture) {
      let entries = listeners.get(this);
      if (!entries) listeners.set(this, entries = []);
      entries.push({ type, callback, capture });
    }
    removeEventListener(type, callback, capture) {
      const entries = listeners.get(this) ?? [];
      const index = entries.findIndex(entry => entry.type === type && entry.callback === callback && entry.capture === capture);
      if (index >= 0) entries.splice(index, 1);
    }
  }
  class LocalEvent {
    constructor(type, properties) { Object.assign(this, { type, isTrusted: true, defaultPrevented: false }, properties); }
    preventDefault() { this.defaultPrevented = true; }
  }
  const Canvas = minimap ? dom.minimap.Canvas : class Canvas extends dom.hud.HTMLElement {
    width = 0; height = 0;
    constructor() { super('canvas'); }
    getContext(kind) {
      assert.equal(kind, '2d');
      return { beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillRect() {},
        createRadialGradient: gradient };
    }
    toDataURL() { return `data:image/png;base64,synthetic-local-${this.width}x${this.height}`; }
  };
  if (minimap) {
    Canvas.prototype.toDataURL = function () {
      return `data:image/png;base64,synthetic-local-${this.width}x${this.height}`;
    };
    dom.minimap.Context.prototype.createRadialGradient = gradient;
  }
  class Image extends dom.hud.HTMLElement {
    constructor() { super('img'); }
    get naturalWidth() { return this.complete ? Number(this.src.match(/-(\d+)x/)[1]) : 0; }
    get naturalHeight() { return this.complete ? Number(this.src.match(/x(\d+)$/)[1]) : 0; }
    get complete() { return this.ready === true; }
    async decode() { calls.push('decode'); await decode?.(); this.ready = true; }
  }
  const originalCreate = dom.Document.prototype.createElement;
  dom.Document.prototype.createElement = function (tag) {
    if (tag === 'canvas') {
      const canvas = new Canvas(); dom.state(canvas).owner = this; canvases.push(canvas); return canvas;
    }
    return Reflect.apply(originalCreate, this, [tag]);
  };
  class Socket { constructor(url) { this.url = url; sockets.push(this); } }
  const realm = { document, location: { href, reload() { calls.push('reload'); } },
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.hud.HTMLElement, Document: dom.Document,
    HTMLInputElement: dom.Input, HTMLTextAreaElement: class {}, HTMLButtonElement: dom.Button,
    CharacterData: dom.hud.CharacterData, CSSStyleDeclaration: dom.hud.CSSStyleDeclaration,
    HTMLCanvasElement: Canvas, HTMLImageElement: Image, Image, EventTarget: Events, Event: LocalEvent,
    WebSocket: Socket, performance: { now() { assert.equal(this, realm.performance); return 125; } },
    Math: { random() { assert.equal(this, realm.Math); calls.push('random'); return 0.25; } },
  };
  realm.top = realm;
  if (minimap) Object.assign(realm, { CanvasRenderingContext2D: dom.minimap.Context,
    ImageData: dom.minimap.ImageData, Uint8ClampedArray });
  for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'queueMicrotask']) {
    realm[name] = function (...args) { assert.equal(this, realm); calls.push([name, ...args]); return 7; };
  }
  function dispatch(target, type, properties = {}) {
    const event = new LocalEvent(type, { target, ...properties });
    for (const entry of [...(listeners.get(target) ?? [])]) if (entry.type === type) entry.callback(event);
    return event;
  }
  function controls() {
    const parent = document.createElement('section'); document.appendChild(parent);
    const field = document.createElement('input'), button = document.createElement('button');
    parent.appendChild(field); parent.appendChild(button);
    return { parent, field, button };
  }
  return { realm, document, dom, calls, sockets, canvases, listeners, dispatch, controls };
}

const endpoint = 'ws://127.0.0.1:8766/slither';
const create = f => createLocalGameHost({ realm: f.realm, endpoint });
const claim = host => host.gate.claim(host.gate.metadata().id);

test('local comparison sources enter through the asset map without constructing authored stand-ins', async () => {
  const f = fixture();
  const operation = { revision: 'synthetic-private-pack' }, request = {};
  const sources = { palettes: [{}, {}, {}], background: {},
    adapter: { beginOperation: () => operation },
    hostAssets: { resolveFood: (value, active) => {
      assert.equal(value, request); assert.equal(active, operation); return 'synthetic-private-food';
    } },
  };
  const host = await createLocalGameHost({ realm: f.realm, endpoint, sourceFactory: async ({ realm, random }) => {
    assert.equal(realm, f.realm); assert.equal(random(), 0.25); return sources;
  } });
  assert.equal(host.sources, sources);
  assert.deepEqual(f.calls, ['random']); assert.equal(f.canvases.length, 0);
  assert.equal(f.sockets.length, 0);
  host.bindSkinPolicy(() => { throw new Error('Authored policy must not select comparison sources'); });
  assert.equal(host.sources.hostAssets.resolveFood(request, host.sources.adapter.beginOperation()), 'synthetic-private-food');
  const native = claim(host);
  assert.throws(() => native.createSocket('ws://127.0.0.1:8767/slither'), /Selected local/);
  host.dispose();
});

test('comparison source loading cannot publish a host after document replacement', async () => {
  const f = fixture();
  let finish;
  const pending = createLocalGameHost({ realm: f.realm, endpoint,
    sourceFactory: () => new Promise(resolve => { finish = resolve; }),
  });
  f.realm.document = new f.dom.Document();
  finish({ palettes: [{}, {}, {}], background: {}, adapter: {}, hostAssets: {} });
  await assert.rejects(pending, /Current local game document/);
  assert.equal(f.sockets.length, 0); assert.equal(f.canvases.length, 0);
});

// Labelled stand-in for the copied Rust numeric rule, not a second skin policy.
const localRuleDouble = () => ({ skin: 255, custom: false, basePalette: 2,
  runs: [{ palette: 2, count: 1 }], variantMode: 'ping-pong', variantPeriod: 7,
  eyes: { kind: 'standard', distance: 6, separation: 6, radius: 6, pupilRadius: 3.5,
    pupilTravel: 2.3, outlineWidth: 0, eyeColor: 0xffffff, pupilColor: 0, outlineColor: 0,
    eyeOpacity: 0.75, pupilOpacity: 1, angleSmoothing: 0.12 },
  bodyStyle: { detailedSegments: false, swell: 0, rotateSegments: true, headFade: null, tailFade: null },
  antenna: null, faceDecoration: null, unsupportedFeatures: [],
});

test('local native minimap capture composes with the builder using issued Rust-view doubles', async () => {
  const f = fixture({ minimap: true }), host = await create(f), native = claim(host);
  const cap = native.minimapDom, { dom } = native.hudDom, construct = native.ownedHudDom.dom;
  assert.deepEqual(Object.keys(cap), ['schema', 'document', 'canvas']);
  assert.deepEqual(Object.keys(cap.canvas), ['context', 'resize', 'set', 'call', 'upload']);
  assert.equal(cap.document, f.document); assert.equal(cap.schema, 1);
  assert(Object.isFrozen(cap)); assert(Object.isFrozen(cap.canvas));
  const parent = construct.createElement(f.document, 'main'); construct.appendChild(f.document, parent);
  const { Context, Canvas } = f.dom.minimap, fail = () => { throw new Error('Uncaptured minimap capability'); };
  for (const name of ['save', 'restore', 'setTransform', 'clearRect', 'beginPath', 'arc',
    'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'putImageData']) Context.prototype[name] = fail;
  for (const name of ['fillStyle', 'strokeStyle', 'lineWidth', 'shadowColor', 'shadowBlur',
    'shadowOffsetX', 'shadowOffsetY']) Object.defineProperty(Context.prototype, name, { configurable: true, set: fail });
  for (const name of ['width', 'height']) Object.defineProperty(Canvas.prototype, name, { configurable: true, set: fail });
  Object.defineProperty(Context.prototype, 'canvas', { configurable: true, get: fail });
  Canvas.prototype.getContext = fail; f.realm.ImageData = fail; f.realm.Uint8ClampedArray = fail;
  const ui = createOwnedMinimapUi({ document: f.document, parent, dom, construct,
    canvas: cap.canvas, isCurrentDocument: native.hudDom.isCurrentDocument });
  const root = ui.mount(), view = issuedMinimapViewDouble(); ui.render(view);
  const uploads = () => f.dom.minimap.trace.filter(call => call[0] === 'putImageData');
  assert.equal(uploads().length, 2); assert.equal(ui.imageRevision(), 1n);
  const first = uploads()[0][2]; view.baseRgba.fill(42);
  assert.equal(first.data[0], 0);
  ui.render({ ...view, baseRgba: null, alternateRgba: null }); assert.equal(uploads().length, 2);
  ui.render(issuedMinimapViewDouble(0, 2n)); assert.equal(uploads().length, 2);
  const context = f.dom.minimap.canvas(root.children[1]).context;
  assert.throws(() => cap.canvas.call(context, 'drawImage'), /Unsupported/);
  assert.throws(() => cap.canvas.set(context, 'globalAlpha', 1), /Unsupported/);
  assert.throws(() => cap.canvas.resize(root.children[1], 537, 0), /dimension/);
  const foreign = new f.dom.Document(); foreign.appendChild(root.children[1]);
  assert.throws(() => cap.canvas.call(context, 'fill'), /HTML minimap/);
  const before = f.dom.minimap.trace.length;
  host.dispose();
  assert.throws(() => ui.render(view), /Stale/);
  assert.throws(() => cap.canvas.upload(context, 0, new Uint8Array()), /Current minimap/);
  assert.equal(f.dom.minimap.trace.length, before); ui.dispose();
});

test('local host supplies authored sources/profile and one claim without starting browser work', async () => {
  const f = fixture(), host = await create(f);
  assert.deepEqual(Object.keys(host).sort(), ['gate', 'sources', 'profile', 'endpoint', 'isCurrentDocument', 'presetEndpoint', 'bindSkinPolicy', 'dispose'].sort());
  assert.equal(host.endpoint, endpoint);
  assert.deepEqual(host.profile, { clientVersion: 0, password: new Uint8Array(20), protocolVersion: 19 });
  assert.equal(host.sources.palettes.length, 3);
  assert(host.sources.palettes.every(value => value instanceof f.realm.HTMLCanvasElement));
  assert(host.sources.background instanceof f.realm.HTMLImageElement);
  assert.equal(host.sources.background.src, 'data:image/png;base64,synthetic-local-324x192');
  assert(host.sources.backgroundImage instanceof f.realm.HTMLImageElement);
  assert.equal(host.sources.backgroundImage.src, 'data:image/png;base64,synthetic-local-512x512');
  assert.equal(host.sources.background.complete, true); assert.equal(host.sources.backgroundImage.complete, true);
  assert.equal(host.sources.background.naturalWidth, 324); assert.equal(host.sources.backgroundImage.naturalWidth, 512);
  assert.deepEqual(f.calls, ['decode', 'decode']);
  assert.equal(f.sockets.length, 0); assert.equal(f.listeners.size, 0);
  const metadata = host.gate.metadata();
  assert.equal(metadata, host.gate.metadata()); assert.equal(metadata.schema, 1); assert.equal(metadata.code, 'held');
  assert.throws(() => host.gate.claim(Symbol()), /own id/);
  const native = claim(host);
  assert(Object.isFrozen(native));
  assert.throws(() => claim(host), /claimed once/);
  assert.equal(native.now(), 125);
  const field = f.realm.document.createElement('input');
  host.presetEndpoint(field);
  assert.equal(native.ownedPlayDom.dom.inputValue(field), endpoint);
  assert.throws(() => host.presetEndpoint(f.realm.document.createElement('div')), /endpoint field/);
  host.dispose(); host.dispose();
  assert.equal(host.isCurrentDocument(), false);
});

test('wrong document origins, endpoint aliases and missing browser capabilities reject before source work', async () => {
  for (const href of ['https://slither.io/', 'https://127.0.0.1:18884/game', 'http://localhost:18884/game',
    'http://127.0.0.1/game', 'http://127.0.0.1:65536/game', 'http://127.0.0.1:18884.evil/game',
    'http://127.0.0.1:18884@evil/game']) {
    const f = fixture({ href });
    await assert.rejects(create(f), /Literal top-level/); assert.deepEqual(f.calls, []);
  }
  const frame = fixture(); frame.realm.top = {};
  await assert.rejects(create(frame), /Literal top-level/);
  for (const url of ['ws://localhost:8766/slither', 'ws://192.0.2.1:8766/slither', 'ws://127.0.0.1:8766/other']) {
    const f = fixture();
    await assert.rejects(createLocalGameHost({ realm: f.realm, endpoint: url }), /Expected/);
    assert.deepEqual(f.calls, []);
  }
  const missing = fixture(); delete missing.realm.HTMLInputElement;
  await assert.rejects(create(missing), /DOM capabilities/);
  const socket = fixture(); delete socket.realm.WebSocket;
  await assert.rejects(create(socket), /WebSocket/);
});

test('bound Rust policy resolves only inside the existing source operation with raw skin/custom metadata', async () => {
  const f = fixture(), host = await create(f), { adapter, hostAssets, palettes } = host.sources;
  const calls = [], rule = localRuleDouble(), customBytes = Uint8Array.of(7, 255, 3);
  // Deliberately choose a palette different from 255 % 3 to expose JS selection.
  rule.eyes.radius = 7; rule.eyes.eyeColor = 0x123456;
  rule.bodyStyle.swell = 0.04;
  assert.throws(() => adapter.beginOperation(), /policy must be bound/);
  assert.throws(() => host.bindSkinPolicy(null), /policy function/);
  host.bindSkinPolicy((skin, bytes) => { calls.push({ skin, bytes }); return rule; });
  assert.deepEqual(calls, []);
  assert.throws(() => host.bindSkinPolicy(localRuleDouble), /already bound/);
  assert.throws(() => adapter.resolveAppearance({}), /operation required/);
  assert.throws(() => adapter.resolveRecipe({ skin: 0 }), /operation required/);
  assert.deepEqual(calls, []);
  const active = adapter.beginOperation();
  assert.throws(() => adapter.beginOperation(), /already active/);
  const request = { skin: 255, customBytes, cosmetic: 73, x: 4, y: -5 };
  const appearance = adapter.resolveAppearance(request);
  assert.equal(appearance.face.kind, 'paired'); assert.equal(appearance.antenna, null);
  assert.equal(appearance.face.eyes, rule.eyes);
  assert.equal(appearance.face.eyes.radius, 7);
  assert.deepEqual(appearance.face.decoration, { kind: 'none' });
  // The selected authored family supplies the base; three units are drawn once here.
  assert.deepEqual(appearance.nicknameTint, { baseRgb: [0x76, 0xb9, 0xed], randomUnits: [0.25, 0.25, 0.25] });
  assert(Object.isFrozen(appearance.nicknameTint) && Object.isFrozen(appearance.nicknameTint.randomUnits));
  assert.deepEqual(f.calls, ['decode', 'decode', 'random', 'random', 'random']);
  assert.deepEqual(calls, [{ skin: 255, bytes: customBytes }]);
  assert.equal(calls[0].bytes, customBytes);
  const result = adapter.resolveRecipe(request);
  assert.equal(result.status, 'ready'); assert.equal(result.recipe.basePalette, 2);
  assert.deepEqual(result.recipe.eyes, appearance.face.eyes);
  assert.deepEqual(result.recipe.bodyStyle, rule.bodyStyle);
  assert.equal(result.recipe.variantMode, 'ping-pong'); assert.equal(result.recipe.variantPeriod, 7);
  assert.equal(calls.length, 2); assert.equal(calls[1].skin, 255);
  assert.deepEqual(calls[1].bytes, customBytes);
  assert.deepEqual(request, { skin: 255, customBytes: Uint8Array.of(7, 255, 3), cosmetic: 73, x: 4, y: -5 });
  const used = [];
  for (const palette of result.recipe.palettes) {
    assert.equal(palette.variants.length, 7);
    used.push(...palette.variants.map(use => use.asset.source), palette.boostGlow.asset.source);
  }
  used.push(...result.recipe.effects.map(effect => effect.asset.source));
  assert.equal(new Set(used).size, 27);
  assert(used.every(source => f.canvases.includes(source) && !palettes.includes(source)));
  assert(palettes.every(source => source.width === 32 && source.height === 32));
  assert.throws(() => adapter.resolveRecipe({ skin: 256 }), /skin/);
  assert.equal(calls.length, 2);
  assert.deepEqual(f.calls, ['decode', 'decode', 'random', 'random', 'random'], 'recipes draw no tint units');
  const food = hostAssets.resolveFood({ palette: 9 }, active), prey = hostAssets.resolvePrey({ palette: 8 }, active);
  assert.equal(food.palette.color, 9); assert.equal(prey.palette.color, 8);
  assert(food.palette.bodies[0].asset.source instanceof f.realm.HTMLCanvasElement);
  assert.equal(food.randomPhaseUnit, 0.25); assert.equal(prey.randomRateUnit, 0.25);
  assert.throws(() => hostAssets.resolveFood({ palette: 0 }, {}), /revision/);
  const randomCalls = f.calls.length;
  assert.equal(adapter.resolveAntennaRandom({ nodeCount: 8, randomPairCount: 7 }).length, 14);
  assert.equal(f.calls.length - randomCalls, 14);
  adapter.endOperation();
  assert.throws(() => adapter.resolveRecipe(request), /operation required/);
  assert.throws(() => adapter.resolveAppearance(request), /operation required/);
  assert.equal(calls.length, 2);
  assert.throws(() => hostAssets.resolvePrey({ palette: 0 }, active), /operation required/);
  adapter.beginOperation(); adapter.endOperation(); host.dispose();
  assert.throws(() => host.bindSkinPolicy(localRuleDouble), /Current local/);
  assert.throws(() => adapter.beginOperation(), /Current local/);
  assert.throws(() => adapter.resolveAppearance(request), /Current local/);
  assert.throws(() => adapter.resolveRecipe(request), /Current local/);
  assert.equal(calls.length, 2);
});

test('captured native DOM groups construct and edit runtime nodes after prototype methods change', async () => {
  const f = fixture(), host = await create(f), native = claim(host);
  const { dom } = native.hudDom, construct = native.ownedHudDom.dom, controls = native.ownedPlayDom.dom;
  for (const group of [native.hudDom, native.ownedHudDom, native.ownedPlayDom, native.leaderboardDom]) {
    assert.equal(group.document, f.document); assert.equal(group.schema, 1); assert(Object.isFrozen(group));
  }
  f.realm.Document.prototype.createElement = () => { throw new Error('Uncaptured createElement'); };
  const parent = construct.createElement(f.document, 'section');
  construct.appendChild(f.document, parent);
  const field = construct.createElement(f.document, 'input'), button = construct.createElement(f.document, 'button');
  construct.appendChild(parent, field); construct.appendChild(parent, button);
  const text = construct.createTextNode(f.document, 'before'); construct.appendChild(parent, text);
  dom.setText(text, 'after'); dom.setStyle(dom.style(parent), 'opacity', '0.5');
  assert.equal(f.dom.hud.character(text).data, 'after');
  assert.equal(f.dom.hud.style(dom.style(parent)).get('opacity'), '0.5');
  native.leaderboardDom.properties.setTranslate(parent, false); assert.equal(parent.translate, false);
  controls.inputMaxLength(field, 24); controls.inputAutocompleteOff(field);
  controls.buttonType(button); controls.buttonDisabled(button, true);
  field.value = 'Local'; assert.equal(controls.inputValue(field), 'Local');
  assert.equal(f.dom.inputValue(field).maxLength, 24); assert.equal(f.dom.inputValue(field).autocomplete, 'off');
  assert.equal(f.dom.ownedPlay.buttonState(button).type, 'button');
  assert.equal(f.dom.ownedPlay.buttonState(button).disabled, true);
  assert.equal(dom.parentNode(field), parent); assert.equal(dom.firstChild(parent), field);
  assert.equal(dom.nextSibling(field), button); assert.equal(dom.ownerDocument(field), f.document);
  construct.removeChild(parent, text); host.dispose();
});

test('one replaceable input route keeps editing defaults, ASCII24 nickname policy and disposal', async () => {
  const f = fixture(), host = await create(f), native = claim(host), seen = [];
  const { field, parent } = f.controls();
  const lease = native.registerNicknameEditField({ schema: 1, element: field, parent, inputPolicy: 'nickname-ascii-24' });
  native.setInput(event => { lease.handleInput(event); seen.push(event); });
  assert.equal(f.listeners.get(f.realm).length, 12);
  field.value = 'A\nBé\x7f' + 'x'.repeat(25);
  f.dispatch(f.realm, 'input', { target: field });
  assert.equal(field.value, ('A B \x7f' + 'x'.repeat(25)).slice(0, 24));
  const editing = f.dispatch(f.realm, 'keydown', { target: field, code: 'Space' });
  assert.equal(editing.defaultPrevented, false); assert.equal(seen.length, 1);
  const steering = f.dispatch(f.realm, 'keydown', { code: 'ArrowLeft' });
  assert.equal(steering.defaultPrevented, true); assert.equal(seen.length, 2);
  const replacement = [];
  native.setInput(event => replacement.push(event));
  assert.equal(f.listeners.get(f.realm).length, 12);
  f.dispatch(f.realm, 'resize'); assert.equal(replacement.length, 1); assert.equal(seen.length, 2);
  lease.unregister(); lease.unregister();
  field.value = 'é'; lease.handleInput({ type: 'input', target: field }); assert.equal(field.value, 'é');
  host.dispose();
  assert.equal(f.listeners.get(f.realm).length, 0);
  f.dispatch(f.realm, 'resize'); assert.equal(replacement.length, 1);
});

test('releases over editable fields clear the existing game input owner without blocking editing', async () => {
  const f = fixture(), host = await create(f), native = claim(host), { field } = f.controls();
  const input = createClientInput({ protocolVersion: 19 });
  input.setOwn({ token: 1n, wantedHeading: 0, gazeHeading: 0, dead: false,
    turnRate: .03, sizeTurnFactor: 1, speedTurnFactor: 1 });
  const pointer = { clientX: 1, clientY: 1, viewportWidth: 100, viewportHeight: 100, follow: true };
  native.setInput(event => {
    if (event.type === 'keydown') input.keyDown(event.code);
    if (event.type === 'keyup') input.keyUp(event.code);
    if (event.type === 'mousedown') input.mouseDown(pointer);
    if (event.type === 'mouseup') input.mouseUp();
  });
  f.dispatch(f.realm, 'mousedown');
  assert.equal(input.snapshot().own.requestedBoost, true);
  const mouseRelease = f.dispatch(f.realm, 'mouseup', { target: field });
  assert.equal(input.snapshot().own.requestedBoost, false);
  assert.equal(mouseRelease.defaultPrevented, false);
  f.dispatch(f.realm, 'keydown', { code: 'Space' });
  const keyRelease = f.dispatch(f.realm, 'keyup', { target: field, code: 'Space' });
  assert.equal(input.snapshot().boostKeyHeld, false);
  assert.equal(input.snapshot().own.requestedBoost, false);
  assert.equal(keyRelease.defaultPrevented, false);
  host.dispose();
});

test('Play lease binds once, admits trusted clicks and unregisters on owner disposal', async () => {
  const f = fixture(), host = await create(f), native = claim(host), { field, button, parent } = f.controls();
  let plays = 0;
  const lease = native.ownedPlayDom.createControlsLease({ schema: 1, endpoint: field, endpointParent: parent,
    button, buttonParent: parent, onPlay() { plays++; } });
  assert.equal(f.listeners.size, 0); lease.bind();
  assert.throws(() => lease.bind(), /already bound/);
  f.dispatch(button, 'click', { isTrusted: false }); assert.equal(plays, 0);
  f.dispatch(button, 'click'); assert.equal(plays, 1);
  lease.unregister(); f.dispatch(button, 'click'); assert.equal(plays, 1);
  assert.throws(() => lease.bind(), /released/);
  const second = native.ownedPlayDom.createControlsLease({ schema: 1, endpoint: field, endpointParent: parent,
    button, buttonParent: parent, onPlay() { plays++; } });
  second.bind(); host.dispose();
  f.dispatch(button, 'click'); assert.equal(plays, 1); assert.equal(f.listeners.get(button).length, 0);
});

test('socket capability constructs only the selected endpoint; status and local reload send no messages', async () => {
  const f = fixture(), host = await create(f), native = claim(host);
  for (const url of ['ws://127.0.0.1:8767/slither', 'ws://192.0.2.1:8766/slither', 'ws://localhost:8766/slither']) {
    assert.throws(() => native.createSocket(url));
  }
  assert.equal(f.sockets.length, 0);
  const socket = native.createSocket(endpoint); assert.equal(socket.url, endpoint); assert.equal(f.sockets.length, 1);
  native.status('connected'); native.ordinaryReload(); assert.deepEqual(f.calls, ['decode', 'decode', 'reload']);
  f.realm.requestAnimationFrame = () => assert.fail('Uncaptured RAF');
  native.requestAnimationFrame(() => {}); assert.equal(f.calls.at(-1)[0], 'requestAnimationFrame');
  host.dispose(); assert.throws(() => native.createSocket(endpoint), /Current local/);
  assert.throws(() => native.ordinaryReload(), /Current local/);
});

test('document, top and URL changes invalidate the host, including navigation during source decode', async () => {
  for (const change of [f => { f.realm.document = {}; }, f => { f.realm.top = {}; },
    f => { f.realm.location.href += '?other'; }, f => { f.realm.location = { href: f.realm.location.href }; }]) {
    const f = fixture(), host = await create(f), native = claim(host);
    change(f); assert.equal(host.isCurrentDocument(), false);
    assert.equal(native.hudDom.isCurrentDocument(), false);
    assert.throws(() => host.sources.adapter.beginOperation(), /Current local/);
    assert.throws(() => native.createSocket(endpoint), /Current local/); host.dispose();
  }
  const releases = [];
  const f = fixture({ decode: () => new Promise(resolve => { releases.push(resolve); }) });
  const pending = create(f); f.realm.location.href += '?navigation';
  for (const release of releases) release();
  await assert.rejects(pending, /Current local/);
  assert.equal(f.listeners.size, 0); assert.equal(f.sockets.length, 0);
});
