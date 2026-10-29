import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { loopbackEndpoint } from '../web/loopback-session.mjs';
import { readAuthoredSourceRecipes } from '../web/authored-source-recipes.mjs';
import { authoredSourceRecipesDouble } from './fixtures/authored-source-fixture.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureLocalGameDocument, createLocalGameHost } from '../web/local-game-host.mjs';
import { createGateTestDom, issuedMinimapViewDouble } from './game-gate-test-fixture.mjs';
import { createOwnedMinimapUi } from '../extension/game-owned-minimap-ui.mjs';
import { createClientInput } from './fixtures/client-input-fixture.mjs';

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
  class Storage {
    values = new Map();
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, value); }
  }
  const realm = { document, location: { href, reload() { calls.push('reload'); } },
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.hud.HTMLElement, Document: dom.Document,
    HTMLInputElement: dom.Input, HTMLTextAreaElement: class {}, HTMLButtonElement: dom.Button,
    CharacterData: dom.hud.CharacterData, CSSStyleDeclaration: dom.hud.CSSStyleDeclaration,
    HTMLCanvasElement: Canvas, HTMLImageElement: Image, Image, EventTarget: Events, Event: LocalEvent,
    WebSocket: Socket, Storage, localStorage: new Storage(), performance: { now() { assert.equal(this, realm.performance); return 125; } },
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
const create = (f, sourceRecipes = authoredSourceRecipesDouble()) => createLocalGameHost({ realm: f.realm, endpoint, sourceRecipes });
const claim = host => host.gate.claim(host.gate.metadata().id);

test('local preview captures an isolated native frame without changing the shared source adapter', async () => {
  const f = fixture({ minimap: true }), host = await create(f), native = claim(host), c = f.controls();
  const adapter = host.sources.adapter, cap = native.appearancePreviewDom;
  assert.equal(cap.document, f.document); assert(Object.isFrozen(cap));
  const canvas = f.document.createElement('canvas'); c.parent.appendChild(canvas);
  const { Context, Canvas, trace } = f.dom.minimap;
  const fail = () => { throw new Error('Late Canvas method lookup'); };
  Canvas.prototype.getContext = fail; Context.prototype.save = fail; Context.prototype.restore = fail;
  const frame = cap.prepare(canvas, 320, 128); frame.finish();
  assert.equal(host.sources.adapter, adapter); assert.equal(f.sockets.length, 0);
  assert.equal(trace.filter(row => row[0] === 'save').length, 1);
  assert.equal(trace.filter(row => row[0] === 'restore').length, 1);
  assert.throws(() => frame.finish(), /consumed/);
  const next = cap.prepare(canvas, 320, 128); f.realm.location.href += '?stale';
  assert.throws(() => next.finish(), /Current/);
  assert.equal(trace.filter(row => row[0] === 'restore').length, 2, 'restoration precedes freshness rejection');
  host.dispose();
});

test('local menu captures fixed-key bounded storage and schema2 buttons without automatic Play', async () => {
  const f = fixture(), host = await create(f), native = claim(host), c = f.controls();
  const menu = f.document.createElement('div'), action = f.document.createElement('button');
  c.parent.appendChild(menu); menu.appendChild(action);
  let presses = 0, plays = 0;
  const lease = native.ownedPlayDom.createControlsLease({ schema: 2, endpoint: c.field, endpointParent: c.parent,
    button: c.button, buttonParent: c.parent, onPlay() { plays++; }, actions: [{ button: action, parent: menu, onPress() { presses++; } }] });
  native.setInput(() => {}); lease.bind();
  f.dispatch(action, 'click', { isTrusted: false }); assert.equal(presses, 0);
  f.dispatch(action, 'click'); assert.equal(presses, 1); assert.equal(plays, 0);
  assert.equal(native.menuPreferences.read(), null);
  assert.equal(native.menuPreferences.write('1:4e616d65:02:'), true);
  assert.equal(native.menuPreferences.read(), '1:4e616d65:02:');
  f.realm.Storage.prototype.getItem = () => { throw Error('late reader'); };
  assert.equal(native.menuPreferences.read(), '1:4e616d65:02:');
  f.realm.localStorage.values.set('slither-client.menu.v1', 'x'.repeat(601));
  assert.equal(native.menuPreferences.read(), null);
  assert.throws(() => native.menuPreferences.write('x'.repeat(601)), /Bounded/);
  f.realm.localStorage.values.set = () => { throw Error('synthetic quota'); };
  assert.equal(native.menuPreferences.write('1::00:'), false);
  assert.equal(plays, 0); assert.equal(f.sockets.length, 0);
  lease.unregister(); f.dispatch(action, 'click'); assert.equal(presses, 1);
  host.dispose(); assert.throws(() => native.menuPreferences.read(), /Current/);
});

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

test('local native Play button keeps Tab, Enter and Space defaults while gameplay retains its Space fence', async () => {
  const f = fixture(), host = await create(f), native = claim(host), { field, parent, button } = f.controls();
  f.realm.HTMLButtonElement = class { static [Symbol.hasInstance]() { throw Error('Late button constructor read'); } };
  const lease = native.ownedPlayDom.createControlsLease({ schema: 1, endpoint: field, endpointParent: parent,
    button, buttonParent: parent, onPlay() {} }); lease.bind(); f.dom.state(f.document).active = button;
  const seen = []; native.setInput(event => seen.push(event));
  for (const code of ['Tab', 'Enter', 'Space']) for (const type of ['keydown', 'keyup']) {
    assert.equal(f.dispatch(f.realm, type, { target: button, code }).defaultPrevented, false);
  }
  assert.equal(f.dispatch(f.realm, 'keydown', { code: 'Space' }).defaultPrevented, true);
  assert.equal(seen.length, 7); assert.equal(f.sockets.length, 0);
  assert.equal(f.dispatch(f.realm, 'keydown', { target: button, code: 'ArrowLeft' }).defaultPrevented, true);
  assert.equal(f.dispatch(f.realm, 'keydown', { target: button, code: 'Space', ctrlKey: true }).defaultPrevented, true);
  f.dom.state(button).disabled = true;
  assert.equal(f.dispatch(f.realm, 'keydown', { target: button, code: 'Space' }).defaultPrevented, true);
  f.dom.state(button).disabled = false; f.dom.state(button).visible = false;
  assert.equal(f.dispatch(f.realm, 'keydown', { target: button, code: 'Space' }).defaultPrevented, true);
  f.dom.state(button).visible = true; lease.unregister();
  assert.equal(f.dispatch(f.realm, 'keydown', { target: button, code: 'Space' }).defaultPrevented, true);
  host.dispose();
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

// Actual default bootstrap and local host with the existing authored native realm.
// The runtime sink below observes initialization/source handoff, not browser gameplay.
const defaultBootstrap = readFileSync(new URL('../extension/game-bootstrap.mjs', import.meta.url), 'utf8')
  .split('// Trusted MAIN modules')[0].replace(/^import .+;\r?$/gm, '').replace(/^export /gm, '');
const bootstrapFactory = new Script(`(function(startRuntime,createLocalGameHost,captureLocalGameDocument,loopbackEndpoint,readAuthoredSourceRecipes){
  ${defaultBootstrap}\nreturn startGamePage;})`).runInThisContext();
const startDefault = runtime => bootstrapFactory(runtime, createLocalGameHost, captureLocalGameDocument, loopbackEndpoint, readAuthoredSourceRecipes);
const localConfig = f => { f.realm.fetch = async () => ({ ok: true, json: async () => ({ simulatorUrl: endpoint }) }); };

test('default local bootstrap initializes once before sources and shares the exact settled promise', async () => {
  const f = fixture(); localConfig(f); let initialized = false, calls = 0, release, runtimeHost;
  const ready = new Promise(resolve => { release = resolve; });
  const originalCreate = f.realm.Document.prototype.createElement;
  f.realm.Document.prototype.createElement = function (tag) {
    if (tag === 'canvas') assert.equal(initialized, true, 'Wasm must precede authored sources');
    return Reflect.apply(originalCreate, this, [tag]);
  };
  const start = startDefault(async options => {
    runtimeHost = options.localHost;
    assert.equal(options.ownedAppearancePreview, true); assert.equal(options.ownedLoadingUi, true);
    assert.equal(options.initialize(), ready); assert.equal(options.initialize(), ready);
    await options.initialize();
    runtimeHost.bindSkinPolicy(localRuleDouble);
    const adapter = runtimeHost.sources.adapter;
    adapter.beginOperation();
    try { assert.equal(adapter.resolveRecipe({ skin: 0, customBytes: new Uint8Array(), own: false, cosmetic: 0 }).status, 'ready'); }
    finally { adapter.endOperation(); }
    return 'authored runtime result';
  });
  const pending = start({ realm: f.realm, initialize() { calls++; return ready; },
    wasmApi: { authored_source_recipes: authoredSourceRecipesDouble } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(f.canvases.length, 0);
  initialized = true; release();
  assert.equal(await pending, 'authored runtime result'); assert.equal(calls, 1);
  assert.equal(f.canvases.length, 335); assert.equal(f.calls.filter(v => v === 'decode').length, 2);
  assert.equal(f.calls.filter(v => v === 'random').length, 0, 'preview recipe consumes no appearance randomness');
  runtimeHost.dispose();
});

test('default local initialization failures preserve even undefined without retry or source allocation', async () => {
  for (const primary of [undefined, new Error('authored initialization rejected')]) for (const sync of [false, true]) {
    const f = fixture(); localConfig(f); let calls = 0, caught = false;
    const status = { textContent: '' }; f.document.getElementById = () => status;
    const start = startDefault(() => assert.fail('runtime after initialization failure'));
    try {
      await start({ realm: f.realm, initialize() { calls++; if (sync) throw primary; return Promise.reject(primary); },
        wasmApi: { get authored_source_recipes() { assert.fail('recipe before initialization'); } } });
    } catch (error) { caught = true; assert.equal(error, primary); }
    assert(caught); assert.equal(calls, 1); assert.equal(f.canvases.length, 0); assert.equal(f.sockets.length, 0);
    assert.equal(status.textContent, 'Client unavailable. Reload this page.');
  }
});

test('default local invalid config, endpoint or document rejects before initialization', async () => {
  for (const value of [undefined, null, {}, { simulatorUrl: '' }, { simulatorUrl: 'ws://localhost:8766/slither' },
    { simulatorUrl: 'ws://127.0.0.1:8766/other' }, { get simulatorUrl() { assert.fail('config getter'); } }]) {
    const f = fixture(); f.realm.fetch = async () => ({ ok: true, json: async () => value });
    const start = startDefault(() => assert.fail('runtime after invalid config'));
    await assert.rejects(start({ realm: f.realm, initialize() { assert.fail('initialization before config admission'); }, wasmApi: {} }),
      error => error.code !== 'ERR_ASSERTION');
    assert.equal(f.canvases.length, 0);
  }
  const f = fixture(); localConfig(f); f.realm.top = {};
  await assert.rejects(startDefault(() => assert.fail('runtime'))({ realm: f.realm,
    initialize() { assert.fail('initialization'); }, wasmApi: {} }), /Literal top-level/);
  assert.equal(f.canvases.length, 0);
});

test('default local async initialization cannot continue after document replacement', async () => {
  const f = fixture(); localConfig(f); let calls = 0;
  await assert.rejects(startDefault(() => assert.fail('stale runtime'))({ realm: f.realm,
    async initialize() { calls++; f.realm.document = new f.dom.Document(); },
    wasmApi: { get authored_source_recipes() { assert.fail('stale recipe getter'); } } }), /Current local game document/);
  assert.equal(calls, 1); assert.equal(f.canvases.length, 0);
});

function startupStatusProbe(document) {
  const label = { progress: {} }, status = { children: [label] };
  let reads = 0, writes = 0;
  Object.defineProperty(status, 'textContent', { set() { writes++; status.children = []; } });
  document.getElementById = id => { assert.equal(id, 'slither-client-status'); reads++; return status; };
  return { status, label, get reads() { return reads; }, get writes() { return writes; } };
}

test('default local stale completions preserve both documents loading subtrees', async () => {
  for (const stage of ['config', 'initialize', 'decode']) {
    for (const outcome of [{ reject: true, primary: undefined }, { reject: true, primary: {} }, { reject: false }]) {
      let f, replacement;
      const complete = () => { f.realm.document = replacement; if (outcome.reject) throw outcome.primary; };
      f = fixture({ decode: async () => { if (stage === 'decode') complete(); } });
      replacement = new f.dom.Document();
      const original = startupStatusProbe(f.document), next = startupStatusProbe(replacement);
      localConfig(f);
      if (stage === 'config') f.realm.fetch = async () => {
        complete(); return { ok: true, json: async () => ({ simulatorUrl: endpoint }) };
      };
      let caught = false;
      try {
        await startDefault(() => assert.fail('stale runtime'))({ realm: f.realm,
          initialize: async () => { if (stage === 'initialize') complete(); },
          wasmApi: { authored_source_recipes: authoredSourceRecipesDouble } });
      } catch (error) {
        caught = true;
        if (outcome.reject) assert.equal(error, outcome.primary);
        else assert.match(error.message, /Current local game document/);
      }
      assert(caught);
      for (const probe of [original, next]) {
        assert.equal(probe.reads, 0, `${stage}: stale status lookup`);
        assert.equal(probe.writes, 0, `${stage}: stale status publication`);
        assert.deepEqual(probe.status.children, [probe.label]);
      }
      assert.equal(f.sockets.length, 0); assert.equal(f.listeners.size, 0);
    }
  }
});

test('default local fallback rechecks document ownership after status lookup', async () => {
  for (const change of ['document', 'top', 'url']) {
    const f = fixture(), replacement = new f.dom.Document(); localConfig(f);
    const original = startupStatusProbe(f.document), next = startupStatusProbe(replacement);
    const lookup = f.document.getElementById;
    f.document.getElementById = id => {
      const value = lookup(id);
      if (change === 'document') f.realm.document = replacement;
      else if (change === 'top') f.realm.top = {};
      else f.realm.location.href += '?new-document';
      return value;
    };
    let caught = false;
    try {
      await startDefault(() => assert.fail('failed runtime'))({ realm: f.realm,
        initialize() { throw undefined; }, wasmApi: {} });
    } catch (error) { caught = true; assert.equal(error, undefined); }
    assert(caught); assert.equal(original.reads, 1); assert.equal(next.reads, 0);
    for (const probe of [original, next]) {
      assert.equal(probe.writes, 0); assert.deepEqual(probe.status.children, [probe.label]);
    }
  }
});

test('default local decode failure retains its primary and supplied host bypasses early initialization', async () => {
  const primary = new Error('authored tile decode'); const f = fixture({ decode() { throw primary; } });
  localConfig(f); let calls = 0;
  await assert.rejects(startDefault(() => assert.fail('decode failure runtime'))({ realm: f.realm,
    initialize() { calls++; }, wasmApi: { authored_source_recipes: authoredSourceRecipesDouble } }), error => error === primary);
  assert.equal(calls, 1); assert.equal(f.canvases.length, 5);
  const supplied = { authored: true }, initialize = () => assert.fail('early supplied-host initialization');
  const g = fixture(); g.realm.fetch = () => assert.fail('supplied host fetch');
  const marker = {};
  const result = await startDefault(options => { assert.equal(options.initialize, initialize); assert.equal(options.localHost, supplied); return marker; })({ realm: g.realm, localHost: supplied, initialize, wasmApi: {} });
  assert.equal(result, marker); assert.equal(g.canvases.length, 0);
});

// Generated ABI policy DOUBLE with actual local host/provider, no Rust/browser proof.
import { resolveLocalSkinDouble } from './stock-skin-policy-double.mjs';
import { resolveStockSkin } from './stock-skin-policy-oracle.mjs';
test('local paired variants share numeric appearance and body recipes through retained host sources', async () => {
  const f = fixture(); standardNativeSourceMethods(f);
  const host = await create(f, standardSourceRecipesDouble()), adapter = host.sources.adapter;
  host.bindSkinPolicy(resolveLocalSkinDouble);
  try {
    adapter.beginOperation();
    try {
      for (const skin of [25, 44, 63, 64]) {
        for (const customBytes of [new Uint8Array(), Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2)]) {
          const request = { skin, customBytes, cosmetic: 0, own: false, x: 112, y: 0 };
          const appearance = adapter.resolveAppearance(request), recipe = adapter.resolveRecipe(request).recipe;
          const expected = resolveStockSkin({ skin: customBytes.length ? 0 : skin }).eyes;
          assert.deepEqual(appearance.face.eyes, expected); assert.deepEqual(recipe.eyes, expected);
          assert.equal(appearance.antenna, null); assert.deepEqual(appearance.face.decoration, { kind: 'none' });
          assert.equal(recipe.attachment, null); assert.equal(recipe.antenna, undefined);
          assert.equal(recipe.variantMode, customBytes.length ? 'first' : 'ping-pong');
          assert.equal(recipe.variantPeriod, customBytes.length ? 1 : 7);
          const repeated = adapter.resolveRecipe(request).recipe;
          for (const [i, palette] of recipe.palettes.entries()) {
            for (const [j, use] of palette.variants.entries()) {
              assert.equal(use.asset.source, repeated.palettes[i].variants[j].asset.source);
              assert(f.canvases.includes(use.asset.source));
            }
          }
        }
      }
    } finally { adapter.endOperation(); }
    assert.equal(f.sockets.length, 0);
  } finally { host.dispose(); }
});

import { standardSourceRecipesDouble } from './fixtures/standard-source-fixture.mjs';
import { createMenuPreferencesDouble } from './menu-preferences-double.mjs';
function standardNativeSourceMethods(f) {
  const method=f.realm.HTMLCanvasElement.prototype.getContext;
  f.realm.HTMLCanvasElement.prototype.getContext=function(...args){const ctx=Reflect.apply(method,this,args);
    return Object.assign(ctx,{createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(){}});};
}
test('default local host uses full standard source plans for saved chooser IDs without starting Play', async()=>{
  const f=fixture();standardNativeSourceMethods(f);const p=standardSourceRecipesDouble(),host=await create(f,p);
  const Menu=createMenuPreferencesDouble(),saved=new Menu(true,'1:5361766564:0a:');
  try {
    host.bindSkinPolicy(resolveLocalSkinDouble);const adapter=host.sources.adapter;adapter.beginOperation();
    try{
      const selected=saved.view(),request={skin:selected.skin,customBytes:selected.customSkin,cosmetic:0};
      const appearance=adapter.resolveAppearance(request),recipe=adapter.resolveRecipe(request).recipe;
      assert.deepEqual(recipe.runs,[{palette:9,count:5},{palette:1,count:5},{palette:7,count:5}]);
      assert.deepEqual(appearance.nicknameTint.baseRgb,[255,255,255]);
      assert.notEqual(recipe.palettes[9].variants[0].asset.source,recipe.palettes[0].variants[0].asset.source);
      saved.action('next-skin');assert.equal(saved.view().skin,11);assert.equal(new Menu(true,saved.serialize()).view().skin,11);
      assert.equal(f.sockets.length,0);assert.deepEqual(f.calls.filter(v=>Array.isArray(v)&&v[0]==='requestAnimationFrame'),[]);
    }finally{adapter.endOperation();}
  }finally{saved.free();host.dispose();}
});

test('ordinary default bootstrap hands standard source bank to runtime after one initialization',async()=>{
  const f=fixture();standardNativeSourceMethods(f);localConfig(f);let initialized=0,received;
  const raw=standardSourceRecipesDouble();
  const result=await startDefault(options=>{received=options;
    const host=options.localHost;host.bindSkinPolicy(resolveLocalSkinDouble);const menu=new (createMenuPreferencesDouble())(true,'1:5361766564:0a:');
    const saved=menu.view();host.sources.adapter.beginOperation();
    try{const recipe=host.sources.adapter.resolveRecipe({skin:saved.skin,customBytes:saved.customSkin,cosmetic:0}).recipe;
      assert.deepEqual(recipe.runs.map(r=>r.palette),[9,1,7]);assert.equal(recipe.palettes.length,42);
      assert.equal(recipe.palettes[36].variants.length,60);assert.equal(recipe.palettes[9].variants[0].asset.source.width,48);}
    finally{host.sources.adapter.endOperation();menu.free();}
    return 'standard default runtime sink';
  })({realm:f.realm,initialize(){initialized++;return Promise.resolve();},wasmApi:{authored_source_recipes:()=>raw}});
  assert.equal(initialized,1);assert.equal(result,'standard default runtime sink');assert.equal(f.sockets.length,0);
  received.localHost.dispose();
});
