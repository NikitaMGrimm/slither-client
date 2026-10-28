import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalGameHost } from '../web/local-game-host.mjs';
import { createGateTestDom } from './game-gate-test-fixture.mjs';
import { createClientInput } from '../web/client-input.mjs';

// Explicit DOM, generated-source and browser-capability doubles; no real sockets.
function fixture({ href = 'http://127.0.0.1:18884/game', decode } = {}) {
  const dom = createGateTestDom({ hud: true, ownedHud: true, ownedPlay: true, leaderboard: true });
  const document = new dom.Document();
  const listeners = new Map(), sockets = [], calls = [];
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
  class Canvas extends dom.hud.HTMLElement {
    width = 0; height = 0;
    constructor() { super('canvas'); }
    getContext(kind) {
      assert.equal(kind, '2d');
      return { beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, fillRect() {} };
    }
    toDataURL() { return `data:image/png;base64,synthetic-local-${this.width}x${this.height}`; }
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
    if (tag === 'canvas') return new Canvas();
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
  return { realm, document, dom, calls, sockets, listeners, dispatch, controls };
}

const endpoint = 'ws://127.0.0.1:8766/slither';
const create = f => createLocalGameHost({ realm: f.realm, endpoint });
const claim = host => host.gate.claim(host.gate.metadata().id);

test('local host supplies authored sources/profile and one claim without starting browser work', async () => {
  const f = fixture(), host = await create(f);
  assert.deepEqual(Object.keys(host).sort(), ['gate', 'sources', 'profile', 'endpoint', 'isCurrentDocument', 'presetEndpoint', 'dispose'].sort());
  assert.equal(host.endpoint, endpoint);
  assert.deepEqual(host.profile, { clientVersion: 0, password: new Uint8Array(20), protocolVersion: 19 });
  assert.equal(host.sources.palettes.length, 3);
  assert(host.sources.palettes.every(value => value instanceof f.realm.HTMLCanvasElement));
  assert(host.sources.background instanceof f.realm.HTMLImageElement);
  assert.equal(host.sources.background.src, 'data:image/png;base64,synthetic-local-108x64');
  assert(host.sources.backgroundImage instanceof f.realm.HTMLImageElement);
  assert.equal(host.sources.backgroundImage.src, 'data:image/png;base64,synthetic-local-512x512');
  assert.equal(host.sources.background.complete, true); assert.equal(host.sources.backgroundImage.complete, true);
  assert.equal(host.sources.background.naturalWidth, 108); assert.equal(host.sources.backgroundImage.naturalWidth, 512);
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

test('source operation wraps existing resolvers, maps ordinary skins modulo3 and draws no random tape eagerly', async () => {
  const f = fixture(), host = await create(f), { adapter, hostAssets, palettes } = host.sources;
  assert.throws(() => adapter.resolveAppearance({}), /operation required/);
  assert.throws(() => adapter.resolveRecipe({ skin: 0 }), /operation required/);
  const active = adapter.beginOperation();
  assert.throws(() => adapter.beginOperation(), /already active/);
  const appearance = adapter.resolveAppearance({ skin: 255 });
  assert.equal(appearance.face.kind, 'paired'); assert.equal(appearance.antenna, null);
  assert.equal(appearance.face.eyes.radius, 6);
  for (const skin of [0, 1, 2, 3, 41, 255]) {
    const result = adapter.resolveRecipe({ skin, customBytes: new Uint8Array(), cosmetic: 0 });
    assert.equal(result.status, 'ready'); assert.equal(result.recipe.basePalette, skin % 3);
    assert.deepEqual(result.recipe.eyes, appearance.face.eyes);
    assert.equal(result.recipe.palettes[skin % 3].variants[0].asset.source, palettes[skin % 3]);
  }
  assert.throws(() => adapter.resolveRecipe({ skin: 256 }), /skin byte/);
  assert.deepEqual(f.calls, ['decode', 'decode']);
  const food = hostAssets.resolveFood({ palette: 9 }, active), prey = hostAssets.resolvePrey({ palette: 8 }, active);
  assert.equal(food.palette.color, 9); assert.equal(prey.palette.color, 8);
  assert(food.palette.bodies[0].asset.source instanceof f.realm.HTMLCanvasElement);
  assert.equal(food.randomPhaseUnit, 0.25); assert.equal(prey.randomRateUnit, 0.25);
  assert.throws(() => hostAssets.resolveFood({ palette: 0 }, {}), /revision/);
  const randomCalls = f.calls.length;
  assert.equal(adapter.resolveAntennaRandom({ nodeCount: 8, randomPairCount: 7 }).length, 14);
  assert.equal(f.calls.length - randomCalls, 14);
  adapter.endOperation();
  assert.throws(() => hostAssets.resolvePrey({ palette: 0 }, active), /operation required/);
  adapter.beginOperation(); adapter.endOperation(); host.dispose();
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
