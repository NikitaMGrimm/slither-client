// Original authored synthetic native-receiver/propagation cases, no native DOM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script, createContext, runInContext } from 'node:vm';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';

const gateSource = readFileSync(new URL('./fixtures/game-gate.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('./game-bootstrap.test.mjs', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function fixture('), source.indexOf("\ntest('an unarmed"));
const { fixture } = new Script(`(function(gateSource,Script,createContext,runInContext,assert,createGateTestDom,attachGateTestRealm){
  ${functions}\nreturn {fixture};})`).runInThisContext()(gateSource, Script, createContext, runInContext, assert,
  createGateTestDom, attachGateTestRealm);

function harness(options) {
  const f = fixture(options), native = f.gate.claim(f.gate.metadata().id), received = [];
  const parent = f.document.createElement('div'), field = f.document.createElement('input');
  f.document.body.appendChild(parent); parent.appendChild(field);
  f.edit.state(f.document).active = field;
  const router = event => { received.push(event); };
  native.setInput(router);
  const record = () => { const value = runInContext('({schema:1,element:null,parent:null})', f.context);
    value.element = field; value.parent = parent; return value; };
  const register = () => native.registerNicknameEditField(record());
  const key = (key, properties = {}) => f.edit.dispatch('keydown', { target: field, key, code: key, ...properties });
  return { f, native, field, parent, received, router, record, register, key };
}

function caught(operation) {
  let present = false, value;
  try { operation(); } catch (error) { present = true; value = error; }
  assert(present, 'expected a thrown value'); return value;
}

test('private exact lease and stop-before-router default policy', () => {
  const h = harness();
  const downstream = [];
  h.f.edit.originals.push(phase => downstream.push(phase));
  h.f.edit.dispatch('unlisted-synthetic-event', { target: h.field });
  assert.deepEqual(downstream.splice(0), ['document-capture-original', 'target-inline', 'target-listener', 'bubble']);
  const lease = h.register(); assert(Object.isFrozen(lease));
  h.native.setInput(event => { assert.deepEqual(h.f.edit.eventData.get(event).trace,
    ['window-capture', 'stop']); });
  assert.equal(h.key('a').defaultPrevented, true, 'setInput revoked previous lease');
  h.register();
  const event = h.key('a'); assert.equal(event.defaultPrevented, false);
  assert.deepEqual(h.f.edit.eventData.get(event).trace, ['window-capture', 'stop']);
  lease.unregister(); assert.equal(h.key('a').defaultPrevented, false, 'old lease cannot clear new one');
  assert.deepEqual(downstream, []);
});

test('closed own-data registration rejects malformed records without reading accessors or then', () => {
  const h = harness();
  let reads = 0;
  const access = h.record(); Object.defineProperty(access, 'element', { get() { reads++; throw new Error(); } });
  const inherited = Object.create(h.record());
  const symbol = h.record(); symbol[Symbol()] = 1;
  const unknown = h.record(); Object.defineProperty(unknown, 'then', { get() { reads++; throw new Error(); } });
  for (const record of [null, [], Promise.resolve(), {}, inherited, symbol, unknown, access,
    { ...h.record(), schema: 2 }, { ...h.record(), element: {} }]) {
    assert.throws(() => h.native.registerNicknameEditField(record));
  }
  assert.equal(reads, 0);
  const record = h.record(); Object.setPrototypeOf(record, null);
  h.native.registerNicknameEditField(record); assert.equal(h.key('a').defaultPrevented, false);
  assert.throws(h.register, /already registered/);
  assert.equal(h.key('a').defaultPrevented, false);
});

test('native brand, direct parent, document/root/type and namespace are mandatory', () => {
  for (const change of [
    h => { h.record = () => ({ schema: 1, element: Object.create(h.f.realm.HTMLInputElement.prototype), parent: h.parent }); },
    h => { h.record = () => ({ schema: 1, element: new Proxy(h.field, {}), parent: h.parent }); },
    h => { h.f.edit.state(h.field).type = 'password'; },
    h => { h.f.edit.state(h.field).namespace = 'urn:synthetic'; },
    h => { h.parent.removeChild(h.field); },
    h => { h.f.edit.state(h.field).owner = new h.f.edit.Document(); },
    h => { h.f.edit.state(h.field).parent = new h.f.edit.Element('shadow-root'); },
    h => { h.f.document.body.appendChild(h.field); },
  ]) {
    const h = harness(); change(h);
    // Malformed records here are null-prototype, preserving the current-realm rule.
    const record = h.record(); Object.setPrototypeOf(record, null);
    assert.throws(() => h.native.registerNicknameEditField(record));
    assert.equal(h.key('a').defaultPrevented, true);
  }
});

test('missing optional capture stays unavailable and critical missing fence retains holds', () => {
  const h = harness({ missingEdit: true });
  h.f.realm.Element.prototype.checkVisibility = () => true;
  assert.throws(h.register, /unavailable/);
  h.native.setInput(() => false);
  assert.equal(h.key('a').defaultPrevented, true, 'legacy return ignored');
  assert.equal(h.f.realm.requestAnimationFrame(() => assert.fail()), 0);
  const f = fixture({ missingFence: true });
  assert.equal(f.gate.metadata().code, 'gate-unavailable');
  assert.equal(f.realm.requestAnimationFrame(() => assert.fail()), 0);
  assert.throws(() => new f.realm.WebSocket(), /held/);
});

test('each optional operation is captured once from its selected own descriptor owner', () => {
  const inventory = {
    Window: ['document', 'top', 'location'], Location: ['href'],
    Node: ['nodeType', 'ownerDocument', 'parentNode', 'isConnected', 'getRootNode'],
    Element: ['namespaceURI', 'localName', 'matches', 'closest', 'checkVisibility'],
    HTMLInputElement: ['type', 'readOnly'], Document: ['activeElement'],
    KeyboardEvent: ['key', 'code', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing', 'getModifierState'],
    InputEvent: ['inputType'], MouseEvent: ['button', 'buttons'], PointerEvent: ['pointerId', 'pointerType', 'isPrimary'],
  };
  for (const [owner, names] of Object.entries(inventory)) for (const name of names) {
    const h = harness({ missingNative: [owner, name] });
    assert.throws(h.register, /unavailable/, `${owner}.${name}`);
    assert.equal(h.key('a').defaultPrevented, true); assert.equal(h.received.length, 1);
  }
  for (const name of ['preventDefault', 'stopImmediatePropagation', 'type', 'target', 'defaultPrevented']) {
    const f = fixture({ missingNative: ['Event', name] });
    assert.equal(f.gate.metadata().code, 'gate-unavailable', name);
    assert.equal(f.realm.requestAnimationFrame(() => assert.fail()), 0);
  }
});

test('captured exact native operations ignore later instance and prototype replacements', () => {
  const h = harness();
  const trip = () => assert.fail('mutable page capability used');
  for (const name of ['type', 'readOnly', 'ownerDocument', 'parentNode', 'isConnected', 'namespaceURI', 'localName',
    'value', 'selectionStart', 'selectionEnd', 'style']) Object.defineProperty(h.field, name, { get: trip });
  for (const name of ['matches', 'closest', 'checkVisibility', 'getRootNode']) h.field[name] = trip;
  for (const name of ['matches', 'closest', 'checkVisibility']) h.f.realm.Element.prototype[name] = trip;
  h.register();
  const event = h.f.edit.make('keydown', { target: h.field, key: 'a', code: 'KeyA' });
  for (const name of ['preventDefault', 'stopImmediatePropagation']) event[name] = trip;
  for (const name of ['type', 'target', 'defaultPrevented', 'key', 'code', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) {
    Object.defineProperty(event, name, { get: trip });
  }
  h.f.edit.deliver(event);
  assert.equal(h.f.edit.eventData.get(event).prevented, false);
  assert.equal(h.received[0], event);
});

test('temporary disabled fieldset, readonly, inert, visibility and focus deny without revocation', () => {
  for (const [node, property, bad] of [['parent', 'disabled', true], ['field', 'readOnly', true],
    ['parent', 'inert', true], ['parent', 'visible', false]]) {
    const h = harness(); h.register();
    const state = h.f.edit.state(h[node]), before = state[property]; state[property] = bad;
    assert.equal(h.key('a').defaultPrevented, true);
    state[property] = before;
    assert.equal(h.key('a').defaultPrevented, false);
    assert.equal(h.received.length, 2);
  }
  const h = harness(); h.register(); h.f.edit.state(h.f.document).active = h.parent;
  assert.equal(h.key('a').defaultPrevented, true);
  h.f.edit.state(h.f.document).active = h.field; assert.equal(h.key('a').defaultPrevented, false);
});

test('observed structural, type and URL invalidation permanently revoke', () => {
  for (const mutate of [
    h => { h.parent.removeChild(h.field); return () => h.parent.appendChild(h.field); },
    h => { h.f.edit.state(h.field).type = 'password'; return () => { h.f.edit.state(h.field).type = 'text'; }; },
    h => { const before = h.f.realm.location.href; h.f.realm.location.href += '#changed'; return () => { h.f.realm.location.href = before; }; },
    h => { const before = h.f.realm.document; h.f.realm.document = {}; return () => { h.f.realm.document = before; }; },
    h => { h.f.realm.top = {}; return () => { h.f.realm.top = h.f.realm; }; },
    h => { h.f.document.body.appendChild(h.field); return () => h.parent.appendChild(h.field); },
  ]) {
    const h = harness(); h.register(); const restore = mutate(h);
    assert.equal(h.key('a').defaultPrevented, true); restore();
    assert.equal(h.key('a').defaultPrevented, true);
    assert.equal(h.received.length, 2, 'raw key delivery survives invalid lease');
    h.register(); assert.equal(h.key('a').defaultPrevented, false);
  }
});

test('setInput validation, unregister, pagehide and reload revoke without synthetic delivery', () => {
  const h = harness(); const lease = h.register();
  assert.throws(() => h.native.setInput(false), /handler/);
  assert.equal(h.key('a').defaultPrevented, false);
  lease.unregister(); lease.unregister(); assert.equal(h.key('a').defaultPrevented, true);
  h.register(); h.native.setInput(h.router); assert.equal(h.key('a').defaultPrevented, true);
  h.register(); h.native.setInput(undefined); assert.equal(h.key('a').defaultPrevented, true);
  assert.throws(h.register, /router/);
  h.native.setInput(h.router); h.register();
  const count = h.received.length; h.f.event('pagehide'); assert.equal(h.received.length, count);
  assert.equal(h.key('a').defaultPrevented, true); assert.throws(h.register);
  const reload = harness(); reload.register(); reload.native.ordinaryReload();
  assert.equal(reload.f.reloads, 1); assert.equal(reload.key('a').defaultPrevented, true);
  assert.equal(reload.f.realm.sessionStorage.getItem('__slitherClientArmV1'), null);
});

test('reflection failures and router changes during reflection cannot publish stale lease', () => {
  for (const primary of [undefined, null, false, 0, { identity: 'reflection' }]) {
    const h = harness();
    const record = new Proxy(h.record(), { ownKeys() { throw primary; } });
    assert.equal(caught(() => h.native.registerNicknameEditField(record)), primary);
    h.register(); assert.equal(h.key('a').defaultPrevented, false);
  }
  const h = harness(); let reentries = 0;
  const record = new Proxy(h.record(), { ownKeys(target) {
    assert.throws(h.register, /reentry/); reentries++; h.native.setInput(h.router); return Reflect.ownKeys(target);
  } });
  assert.throws(() => h.native.registerNicknameEditField(record), /Current native/);
  assert.equal(reentries, 1); assert.equal(h.key('a').defaultPrevented, true);
});

test('bounded keyboard/chord/composition table and raw event code remain independent', () => {
  const allowed = [['a'], [' '], ['é'], ['😀'], ['\x7f'], ['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown'],
    ['Home'], ['End'], ['Backspace'], ['Delete'], ['ArrowLeft', { shiftKey: true }],
    ['Shift'], ['Control'], ['Meta'], ['AltGraph'], ['Dead'], ['Process'], ['Unidentified', { isComposing: true }],
    ['a', { ctrlKey: true }], ['C', { metaKey: true }], ['x', { ctrlKey: true }], ['v', { ctrlKey: true }],
    ['z', { metaKey: true }], ['Z', { ctrlKey: true, shiftKey: true }], ['y', { metaKey: true }],
    ['V', { ctrlKey: true, shiftKey: true }], ['Home', { metaKey: true, shiftKey: true }],
    ['Delete', { ctrlKey: true, shiftKey: true }], ['@', { ctrlKey: true, altKey: true, altGraph: true }],
    ['Dead', { ctrlKey: true, altKey: true, altGraph: true }]];
  const denied = [['Enter'], ['Tab'], ['Escape'], ['F1'], ['BrowserBack'], ['Unidentified'], ['longtext'], [''], ['\ud800'],
    ['\udfff'], ['😀a'], ['Alt'], ['a', { altKey: true }], ['a', { ctrlKey: true, metaKey: true }],
    ['a', { ctrlKey: true, altKey: true }], ['s', { ctrlKey: true }], ['a', { ctrlKey: true, shiftKey: true }],
    ['c', { metaKey: true, shiftKey: true }], ['x', { metaKey: true, shiftKey: true }], ['y', { ctrlKey: true, shiftKey: true }],
    ['ArrowLeft', { altKey: true }], ['ArrowLeft', { altGraph: true }], ['Enter', { isComposing: true }],
    ['Tab', { isComposing: true }], ['Escape', { isComposing: true }], ['F2', { isComposing: true }],
    ['a', { altGraph: true, metaKey: true }], ['a', { code: 'NumpadEnter' }]];
  const h = harness(); h.register();
  for (const type of ['keydown', 'keyup', 'keypress']) for (const [cases, prevented] of [[allowed, false], [denied, true]]) {
    for (const [key, options] of cases) {
      const event = h.f.edit.dispatch(type, { target: h.field, key, code: 'UnmodifiedRawCode', ...options });
      assert.equal(event.defaultPrevented, prevented, `${type}/${key}/${JSON.stringify(options)}`);
      assert.equal(h.received.at(-1), event); assert.equal(h.f.edit.eventData.get(event).code, options?.code ?? 'UnmodifiedRawCode');
    }
  }
});

test('closed beforeinput domain and notification-only postmutation boundary', () => {
  const h = harness(); h.register();
  for (const inputType of ['insertText', 'insertReplacementText', 'insertFromPaste', 'insertFromPasteAsQuotation',
    'insertCompositionText', 'insertFromComposition', 'deleteCompositionText', 'deleteContentBackward', 'deleteContentForward',
    'deleteWordBackward', 'deleteWordForward', 'deleteSoftLineBackward', 'deleteSoftLineForward',
    'deleteHardLineBackward', 'deleteHardLineForward', 'deleteByCut', 'historyUndo', 'historyRedo']) {
    assert.equal(h.f.edit.dispatch('beforeinput', { target: h.field, inputType }).defaultPrevented, false, inputType);
  }
  for (const inputType of ['', 'unknown', 'insertLineBreak', 'insertParagraph', 'insertFromDrop', 'deleteByDrag', 'formatBold']) {
    assert.equal(h.f.edit.dispatch('beforeinput', { target: h.field, inputType }).defaultPrevented, true, inputType);
  }
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'copy', 'cut', 'paste']) {
    assert.equal(h.f.edit.dispatch(type, { target: h.field }).defaultPrevented, false);
  }
  for (const type of ['input', 'select', 'selectionchange', 'focus', 'blur', 'focusin', 'focusout', 'mouseover', 'pointerover',
    'contextmenu', 'drop', 'dragstart', 'touchstart']) {
    assert.equal(h.f.edit.dispatch(type, { target: h.field }).defaultPrevented, true);
  }
  const event = h.f.edit.dispatch('input', { target: h.field, cancelable: false });
  assert.equal(event.defaultPrevented, false, 'noncancelable notification is not rolled back');
  assert.deepEqual(h.f.edit.eventData.get(event).trace, ['window-capture', 'stop', 'prevent']);
});

const added = ['keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
  'copy', 'cut', 'paste', 'selectstart', 'select', 'selectionchange', 'dblclick', 'contextmenu',
  'focus', 'blur', 'focusin', 'focusout', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
  'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel', 'touchcancel',
  'dragstart', 'drag', 'dragenter', 'dragleave', 'dragover', 'drop', 'dragend'];
const original = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove',
  'touchstart', 'touchend', 'touchmove', 'keydown', 'keyup', 'click', 'wheel', 'resize'];

test('exact fence inventory, Window selectionchange capture and attribution', () => {
  const h = harness(); h.register();
  const fences = h.f.edit.listeners.filter(entry => entry.options?.passive === false);
  assert.deepEqual(fences.map(entry => entry.type).sort(), [...original, ...added].sort());
  const selection = h.f.edit.documentListeners.filter(entry => entry.type === 'selectionchange');
  assert.equal(selection.length, 0);
  for (const entry of [...fences, ...selection]) { assert.equal(entry.options.capture, true); assert.equal(entry.options.passive, false); }
  const event = h.f.edit.dispatch('selectionchange', { target: h.f.document });
  assert.deepEqual(h.f.edit.eventData.get(event).trace, ['window-capture', 'stop', 'prevent']);
  assert.equal(h.received.length, 1);
  h.f.edit.state(h.f.document).active = h.parent;
  h.f.edit.dispatch('selectionchange', { target: h.f.document }); assert.equal(h.received.length, 1);
  for (const type of added) h.f.edit.dispatch(type, { target: h.parent });
  assert.equal(h.received.length, 1);
  for (const type of original) h.f.edit.dispatch(type, { target: h.parent });
  assert.equal(h.received.length, 1 + original.length);
});

test('Document selectionchange stops later Window and Document host capture before one owned notification', () => {
  const h = harness(), lease = h.register();
  let windowHost = 0, documentHost = 0, downstreamHost = 0;
  h.f.realm.addEventListener('selectionchange', () => { windowHost++; }, { capture: true });
  h.f.document.addEventListener('selectionchange', () => { documentHost++; }, { capture: true });
  h.f.edit.originals.push(() => { downstreamHost++; });
  const dispatch = () => h.f.edit.dispatch('selectionchange', { target: h.f.document, cancelable: false });
  const event = dispatch();
  assert.deepEqual({ windowHost, documentHost, downstreamHost }, { windowHost: 0, documentHost: 0, downstreamHost: 0 });
  assert.deepEqual(h.f.edit.eventData.get(event).trace, ['window-capture', 'stop', 'prevent']);
  assert.equal(event.defaultPrevented, false, 'noncancelable notification remains a notification');
  assert.equal(h.received.length, 1);
  h.f.edit.state(h.f.document).active = h.parent; dispatch();
  assert.equal(h.received.length, 1, 'unattributed Document selection does not reach the owner');
  lease.unregister(); dispatch();
  assert.equal(h.received.length, 1, 'no lease still fences the Document event');
  assert.deepEqual({ windowHost, documentHost, downstreamHost }, { windowHost: 0, documentHost: 0, downstreamHost: 0 });
});

test('post-router changes, undefined completion and nested dispatch cannot grant stale defaults', () => {
  for (const result of [false, 0, null, 'ALLOW_NATIVE_EDIT', Promise.resolve(), { then() { assert.fail('then inspected'); } }]) {
    const h = harness(); h.native.setInput(() => result); h.register();
    assert.throws(() => h.key('a'), /return undefined synchronously/);
    h.native.setInput(h.router); assert.equal(h.key('a').defaultPrevented, true);
  }
  for (const mutate of [h => { h.f.edit.state(h.field).readOnly = true; },
    h => { h.f.edit.state(h.parent).visible = false; }, h => h.native.setInput(h.router),
    h => h.parent.removeChild(h.field)]) {
    const h = harness(); h.native.setInput(() => { mutate(h); }); h.register();
    assert.equal(h.key('a').defaultPrevented, true);
  }
  const h = harness(); let lease, nested, count = 0;
  h.native.setInput(() => { count++; assert.throws(h.register, /reentry/);
    nested = h.f.edit.dispatch('keyup', { target: h.field, key: 'a', code: 'KeyA' }); lease.unregister(); });
  lease = h.register(); assert.equal(h.key('a').defaultPrevented, true);
  assert.equal(nested.defaultPrevented, true); assert.equal(count, 1);
});

test('all exact primary values survive independent secondary prevent and stop failures', () => {
  for (const primary of [undefined, null, false, 0, { identity: 'primary' }]) {
    for (const secondary of ['preventFailure', 'stopFailure']) {
      const h = harness();
      h.native.setInput(() => { throw primary; }); h.register();
      const event = h.f.edit.make('keydown', { target: h.field, key: 'a', [secondary]: new Error('secondary') });
      if (secondary === 'stopFailure') {
        // Event reflection fails before the final stop, which independently fails.
        h.f.edit.eventData.get(event).getterFailure = { name: 'type', value: primary };
      }
      assert.equal(caught(() => h.f.edit.deliver(event)), primary);
      assert(h.f.edit.eventData.get(event).trace.includes('prevent'));
      const fresh = h.register(); fresh.unregister();
      h.native.setInput(h.router);
      assert.equal(h.key('b').defaultPrevented, true);
    }
  }
});

test('native failure and failed fence attempt revoke without claiming successful native isolation', () => {
  for (const primary of [undefined, null, false, 0, { identity: 'native' }]) {
    const h = harness(); h.register();
    const event = h.f.edit.make('keydown', { target: h.field, key: 'a', getterFailure: { name: 'key', value: primary },
      preventFailure: new Error('secondary') });
    assert.equal(caught(() => h.f.edit.deliver(event)), primary);
    assert.equal(h.received.length, 1, 'editing getter failure preserves original raw delivery');
    assert.equal(h.key('a').defaultPrevented, true);
    const stop = harness(); stop.register();
    const failed = stop.f.edit.make('keydown', { target: stop.field, key: 'a', stopFailure: primary, preventFailure: new Error('secondary') });
    assert.equal(caught(() => stop.f.edit.deliver(failed)), primary);
    assert.equal(stop.f.edit.eventData.get(failed).stopped, false);
    assert.deepEqual(stop.f.edit.eventData.get(failed).trace, ['window-capture', 'stop', 'prevent', 'stop']);
    assert.equal(stop.received.length, 0);
  }
});

test('bounded primary mouse gesture, compatibility events, matching up and outside denial', () => {
  const h = harness(); h.register(); h.f.edit.state(h.f.document).active = null;
  const dispatch = (type, options = {}) => h.f.edit.dispatch(type, { target: h.field, button: 0, ...options });
  assert.equal(dispatch('pointerdown', { pointerId: 7 }).defaultPrevented, false, 'native focus initiation');
  assert.equal(dispatch('mousedown').defaultPrevented, false, 'compatibility does not replace pointer gesture');
  h.f.edit.state(h.f.document).active = h.field;
  assert.equal(dispatch('pointermove', { target: h.parent, pointerId: 8, buttons: 1 }).defaultPrevented, true);
  assert.equal(dispatch('pointermove', { target: h.parent, pointerId: 7, buttons: 0 }).defaultPrevented, true);
  assert.equal(dispatch('pointermove', { target: h.parent, pointerId: 7, buttons: 1 }).defaultPrevented, false);
  assert.equal(dispatch('pointerup', { target: h.parent, pointerId: 7, button: 2 }).defaultPrevented, true);
  assert.equal(dispatch('pointermove', { target: h.parent, pointerId: 7, buttons: 1 }).defaultPrevented, false,
    'secondary-button release cannot clear primary gesture');
  assert.equal(dispatch('selectstart', { target: h.parent }).defaultPrevented, false);
  assert.equal(dispatch('pointerup', { target: h.parent, pointerId: 7 }).defaultPrevented, false, 'up uses pre-clear gesture');
  assert.equal(dispatch('pointermove', { target: h.parent, pointerId: 7, buttons: 1 }).defaultPrevented, true);
  assert.equal(dispatch('mousedown').defaultPrevented, false);
  assert.equal(dispatch('mousemove', { target: h.parent, buttons: 1 }).defaultPrevented, false);
  assert.equal(dispatch('mouseup', { target: h.parent }).defaultPrevented, false);
  for (const options of [{ pointerType: 'pen' }, { pointerType: 'touch' }, { pointerType: 'unknown' }, { isPrimary: false }, { button: 2 }]) {
    assert.equal(dispatch('pointerdown', options).defaultPrevented, true);
  }
  for (const type of ['mousedown', 'pointerdown', 'click', 'dblclick', 'contextmenu']) {
    assert.equal(dispatch(type, { target: h.parent }).defaultPrevented, true);
  }
  dispatch('mousedown'); dispatch('pointercancel');
  assert.equal(dispatch('mousemove', { target: h.parent, buttons: 1 }).defaultPrevented, true);
  dispatch('mousedown'); dispatch('touchcancel');
  assert.equal(dispatch('mousemove', { target: h.parent, buttons: 1 }).defaultPrevented, true);
  dispatch('mousedown'); dispatch('touchstart');
  assert.equal(dispatch('mousemove', { target: h.parent, buttons: 1 }).defaultPrevented, true);
  dispatch('mousedown'); h.f.edit.state(h.f.document).active = h.parent;
  assert.equal(dispatch('mousemove', { target: h.parent, buttons: 1 }).defaultPrevented, true);
  h.f.edit.state(h.f.document).active = h.field;
  const other = new h.f.edit.Document(), outsider = new h.f.edit.Element('div'); other.appendChild(outsider);
  assert.equal(dispatch('mousemove', { target: outsider, buttons: 1 }).defaultPrevented, true);
});
