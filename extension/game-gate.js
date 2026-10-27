// Runs before host startup only on an explicitly armed document. No host callback is invoked.
(() => {
  'use strict';
  const realm = globalThis;
  if (realm !== realm.top) return;
  const url = new URL(realm.location.href);
  if (!['http://slither.io', 'https://slither.io', 'http://www.slither.io', 'https://www.slither.io'].includes(url.origin)
    || !['/', '/index.html'].includes(url.pathname) || url.search || url.hash || url.username || url.password) return;
  const key = '__slitherClientArmV1';
  let arm;
  try {
    const text = realm.sessionStorage.getItem(key);
    if (text === null) return;
    realm.sessionStorage.removeItem(key);
    if (text.length > 512) return;
    arm = JSON.parse(text);
    if (arm.schema !== 1 || arm.build !== 'gamepage-v1' || arm.url !== url.href
      || !/^[a-f0-9]{32}$/.test(arm.id) || !Number.isSafeInteger(arm.expires)
      || arm.expires <= Date.now() || arm.expires > Date.now() + 30000) return;
  } catch { return; }
  const slot = Symbol.for('slither.client.gate.v1');
  if (realm[slot]) return;
  const bind = name => {
    if (typeof realm[name] !== 'function') throw new Error(`Native capability unavailable: ${name}`);
    return realm[name].bind(realm);
  };
  let phase = 'held';
  let claimed = false;
  let completed = false;
  let completedAt = 0;
  let revision = 0;
  let input;
  let routerGeneration = {}, lease, gesture, registering = false, routing = 0, deciding = false;
  let ended = false, gateRecord;
  const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
  const ownKeys = Reflect.ownKeys, prototype = Object.getPrototypeOf, recordPrototype = Object.prototype;
  const freeze = Object.freeze;
  const getter = (owner, name) => {
    const operation = descriptor(owner, name)?.get;
    if (typeof operation !== 'function') throw new TypeError('Native edit getter unavailable');
    return receiver => apply(operation, receiver, []);
  };
  const method = (owner, name) => {
    const operation = descriptor(owner, name)?.value;
    if (typeof operation !== 'function') throw new TypeError('Native edit method unavailable');
    return (receiver, ...args) => apply(operation, receiver, args);
  };
  function revoke() {
    // Old unregister closures retain only an inert identity after revocation.
    if (lease) { lease.element = undefined; lease.parent = undefined; lease.generation = undefined; }
    lease = undefined; gesture = undefined;
  }
  function captureEditing() {
    try {
      const node = realm.Node.prototype, element = realm.Element.prototype;
      const keyboard = realm.KeyboardEvent.prototype, mouse = realm.MouseEvent.prototype, pointer = realm.PointerEvent.prototype;
      const document = getter(realm, 'document'), top = getter(realm, 'top'), location = getter(realm, 'location');
      const initialDocument = document(realm), initialLocation = location(realm);
      const href = getter(initialLocation, 'href');
      return freeze({ document, top, location, href, initialDocument, initialLocation,
        nodeType: getter(node, 'nodeType'), ownerDocument: getter(node, 'ownerDocument'),
        parentNode: getter(node, 'parentNode'), connected: getter(node, 'isConnected'), root: method(node, 'getRootNode'),
        namespace: getter(element, 'namespaceURI'), localName: getter(element, 'localName'),
        type: getter(realm.HTMLInputElement.prototype, 'type'), readOnly: getter(realm.HTMLInputElement.prototype, 'readOnly'),
        disabled: method(element, 'matches'), inert: method(element, 'closest'), visible: method(element, 'checkVisibility'),
        active: getter(realm.Document.prototype, 'activeElement'),
        key: getter(keyboard, 'key'), code: getter(keyboard, 'code'), ctrl: getter(keyboard, 'ctrlKey'),
        meta: getter(keyboard, 'metaKey'), alt: getter(keyboard, 'altKey'), shift: getter(keyboard, 'shiftKey'),
        composing: getter(keyboard, 'isComposing'), modifier: method(keyboard, 'getModifierState'),
        inputType: getter(realm.InputEvent.prototype, 'inputType'), button: getter(mouse, 'button'), buttons: getter(mouse, 'buttons'),
        pointerId: getter(pointer, 'pointerId'), pointerType: getter(pointer, 'pointerType'), primary: getter(pointer, 'isPrimary'),
      });
    } catch { return; }
  }
  const editing = captureEditing();
  function current(generation) {
    return !ended && claimed && input !== undefined && generation === routerGeneration
      && realm[slot] === gateRecord && editing.top(realm) === realm
      && editing.document(realm) === editing.initialDocument && editing.location(realm) === editing.initialLocation
      && editing.href(editing.initialLocation) === url.href;
  }
  function structural(value) {
    const { element, parent } = value, document = editing.initialDocument;
    for (const node of [element, parent]) {
      if (editing.nodeType(node) !== 1 || editing.namespace(node) !== 'http://www.w3.org/1999/xhtml'
        || editing.ownerDocument(node) !== document || !editing.connected(node)
        || editing.root(node, { composed: false }) !== document) return false;
    }
    return editing.localName(element) === 'input' && editing.type(element) === 'text'
      && editing.parentNode(element) === parent;
  }
  function valid(value) {
    if (lease !== value) return false;
    if (!current(value.generation) || !structural(value)) { revoke(); return false; }
    return true;
  }
  function eligible(value, focused) {
    return valid(value) && !editing.disabled(value.element, ':disabled') && editing.readOnly(value.element) === false
      && editing.inert(value.element, '[inert]') === null
      && editing.visible(value.element, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) === true
      && (!focused || editing.active(editing.initialDocument) === value.element);
  }
  function registerNicknameEditField(record) {
    if (registering || routing) throw new Error('Nickname edit registration reentry');
    if (!editing) throw new Error('Native nickname editing unavailable');
    if (lease) throw new Error('Nickname edit field already registered');
    const generation = routerGeneration;
    registering = true;
    try {
      if (!current(generation)) throw new Error('Current input router required');
      if (record === null || typeof record !== 'object'
        || ![recordPrototype, null].includes(prototype(record))) throw new TypeError('Closed nickname edit record required');
      const keys = ownKeys(record);
      if (keys.length !== 3 || !['schema', 'element', 'parent'].every(name => keys.includes(name))) {
        throw new TypeError('Closed nickname edit record required');
      }
      const values = {};
      for (const name of keys) {
        const field = descriptor(record, name);
        if (!field || !Object.hasOwn(field, 'value')) throw new TypeError('Nickname edit data fields required');
        values[name] = field.value;
      }
      if (values.schema !== 1) throw new TypeError('Nickname edit schema required');
      const next = { element: values.element, parent: values.parent, generation };
      if (!structural(next) || !current(generation)) throw new Error('Current native text field required');
      const result = freeze({ unregister() { if (lease === next) revoke(); } });
      lease = next;
      return result;
    } finally { registering = false; }
  }
  const originalTypes = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove',
    'touchstart', 'touchend', 'touchmove', 'keydown', 'keyup', 'click', 'wheel', 'resize'];
  const notificationTypes = ['keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
    'copy', 'cut', 'paste', 'selectstart', 'select', 'selectionchange', 'dblclick', 'contextmenu',
    'focus', 'blur', 'focusin', 'focusout', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout',
    'pointerenter', 'pointerleave', 'pointerover', 'pointerout', 'pointercancel', 'touchcancel',
    'dragstart', 'drag', 'dragenter', 'dragleave', 'dragover', 'drop', 'dragend'];
  const inputTypes = ['insertText', 'insertReplacementText', 'insertFromPaste', 'insertFromPasteAsQuotation',
    'insertCompositionText', 'insertFromComposition', 'deleteCompositionText', 'deleteContentBackward', 'deleteContentForward',
    'deleteWordBackward', 'deleteWordForward', 'deleteSoftLineBackward', 'deleteSoftLineForward',
    'deleteHardLineBackward', 'deleteHardLineForward', 'deleteByCut', 'historyUndo', 'historyRedo'];
  function scalar(key) {
    if (typeof key !== 'string') return false;
    const first = key.charCodeAt(0), last = key.charCodeAt(1);
    return key.length === 1 && (first < 0xd800 || first > 0xdfff)
      || key.length === 2 && first >= 0xd800 && first <= 0xdbff && last >= 0xdc00 && last <= 0xdfff;
  }
  function keyboardDefault(event) {
    const key = editing.key(event), code = editing.code(event), ctrl = editing.ctrl(event), meta = editing.meta(event);
    const alt = editing.alt(event), shift = editing.shift(event), composing = editing.composing(event);
    const altGraph = editing.modifier(event, 'AltGraph');
    if (['Enter', 'Tab', 'Escape'].includes(key) || code === 'NumpadEnter') return false;
    if (['Shift', 'Control', 'Meta', 'AltGraph'].includes(key)) return true;
    const composition = key === 'Dead' || key === 'Process' || composing && key === 'Unidentified';
    if (altGraph) return !meta && (scalar(key) || composition);
    if (alt) return false;
    const caret = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Backspace', 'Delete'].includes(key);
    if (!ctrl && !meta) return scalar(key) || caret || composition;
    if (ctrl === meta) return false;
    if (caret) return true;
    const letter = key.length === 1 && key >= 'A' && key <= 'Z' ? key.toLowerCase() : key;
    return shift ? ['z', 'v'].includes(letter) : ['a', 'c', 'x', 'v', 'z', 'y'].includes(letter);
  }
  function sameDocument(target) {
    return target === editing.initialDocument || editing.ownerDocument(target) === editing.initialDocument;
  }
  function mouseDefault(value, event, type, target) {
    const pointer = type.startsWith('pointer');
    if (pointer && (editing.pointerType(event) !== 'mouse' || editing.primary(event) !== true)) return false;
    if (type.endsWith('down') || type === 'click' || type === 'dblclick') {
      return target === value.element && editing.button(event) === 0 && eligible(value, false);
    }
    if (editing.button(event) !== 0 && type.endsWith('up')) return false;
    if (target === value.element) return eligible(value, false);
    return gesture?.lease === value && eligible(value, true) && sameDocument(target)
      && (pointer ? gesture.mode === 'pointer' && editing.pointerId(event) === gesture.id : true)
      && (!type.endsWith('move') || (editing.buttons(event) & 1) === 1);
  }
  function disposition(value, event, type, target) {
    if (!valid(value)) return false;
    if (['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick'].includes(type)) {
      return mouseDefault(value, event, type, target);
    }
    if (type === 'selectstart' && target !== value.element) {
      return gesture?.lease === value && eligible(value, true) && sameDocument(target);
    }
    if (target !== value.element || !eligible(value, true)) return false;
    if (['keydown', 'keyup', 'keypress'].includes(type)) return keyboardDefault(event);
    if (type === 'beforeinput') return inputTypes.includes(editing.inputType(event));
    return ['compositionstart', 'compositionupdate', 'compositionend', 'copy', 'cut', 'paste', 'selectstart'].includes(type);
  }
  function finishGesture(value, event, type, target, allow) {
    if (!value || lease !== value) return;
    if (type === 'pointercancel' || type === 'touchcancel' || type === 'touchstart') { gesture = undefined; return; }
    if (type === 'pointerdown' || type === 'mousedown') {
      if (!allow || target !== value.element) { gesture = undefined; return; }
      if (type === 'mousedown' && gesture?.lease === value && gesture.mode === 'pointer') return;
      gesture = { lease: value, mode: type === 'pointerdown' ? 'pointer' : 'mouse',
        id: type === 'pointerdown' ? editing.pointerId(event) : undefined };
    } else if (type === 'mouseup' && editing.button(event) === 0
      || type === 'pointerup' && gesture?.mode === 'pointer' && editing.pointerId(event) === gesture.id
      && editing.pointerType(event) === 'mouse' && editing.primary(event) === true && editing.button(event) === 0) gesture = undefined;
  }
  const writes = new WeakMap();
  const native = {};
  const ownValue = (record, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(record, name);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  function status(code) {
    phase = code;
    realm.postMessage({ type: 'slither-client-status', schema: 1, id: arm.id, code }, url.origin);
  }
  function replace(record, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(record, name);
    if (!descriptor || !descriptor.configurable) throw new Error(`Cannot install native guard: ${name}`);
    Object.defineProperty(record, name, { ...descriptor, value });
  }
  function changed(canvas, ready, generated = false) {
    if (!canvas || !(canvas instanceof realm.HTMLCanvasElement)) return;
    revision++;
    writes.set(canvas, { revision, ready, generated });
  }
  function captureLiveProfile() {
    // Optional preparation only. Missing profile APIs must not disable the
    // reviewed external-profile path or any of its document ownership holds.
    try {
      if (url.origin !== 'https://slither.io' || realm.isSecureContext !== true) return;
      const apply = Reflect.apply, freeze = Object.freeze;
      const descriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf;
      const integer = Number.isSafeInteger, Invalid = TypeError;
      const method = (object, name) => {
        const value = object?.[name];
        if (typeof value !== 'function') throw new Invalid('Optional native method unavailable');
        return value;
      };
      const getter = (object, name) => {
        const value = descriptor(object, name)?.get;
        if (typeof value !== 'function') throw new Invalid('Optional native getter unavailable');
        return value;
      };
      const fetch = method(realm, 'fetch');
      const subtle = realm.crypto?.subtle, digest = method(subtle, 'digest');
      const Bytes = realm.Uint8Array, Buffer = realm.ArrayBuffer, Abort = realm.AbortController;
      if (typeof Bytes !== 'function' || typeof Buffer !== 'function' || typeof Abort !== 'function') return;
      const typed = prototype(Bytes.prototype);
      const brand = getter(typed, Symbol.toStringTag), length = getter(typed, 'length');
      const buffer = getter(typed, 'buffer'), offset = getter(typed, 'byteOffset');
      const bufferLength = getter(Buffer.prototype, 'byteLength'), isView = method(Buffer, 'isView');
      const set = method(typed, 'set'), fill = method(typed, 'fill');
      const then = method(realm.Promise?.prototype, 'then');
      const signal = getter(Abort.prototype, 'signal'), abort = method(Abort.prototype, 'abort');
      const response = realm.Response?.prototype;
      const status = getter(response, 'status'), type = getter(response, 'type');
      const responseUrl = getter(response, 'url'), redirected = getter(response, 'redirected'), body = getter(response, 'body');
      const getReader = method(realm.ReadableStream?.prototype, 'getReader');
      const reader = realm.ReadableStreamDefaultReader?.prototype;
      const read = method(reader, 'read'), cancel = method(reader, 'cancel'), release = method(reader, 'releaseLock');
      const environment = freeze({ origin: url.origin, topLevel: true, secureContext: true });
      function byteLength(value) {
        if (!apply(isView, Buffer, [value]) || apply(brand, value, []) !== 'Uint8Array') {
          throw new Invalid('Ordinary Uint8Array required');
        }
        const backing = apply(buffer, value, []);
        const capacity = apply(bufferLength, backing, []); // Reject SharedArrayBuffer/proxies.
        const size = apply(length, value, []), start = apply(offset, value, []);
        if (start > capacity || size > capacity - start) throw new Invalid('Invalid byte view');
        return size;
      }
      const bytes = freeze({
        allocate(size) {
          if (!integer(size) || size < 0) throw new Invalid('Invalid byte allocation');
          return new Bytes(size);
        },
        length: byteLength,
        copy(target, source, start = 0) {
          const targetSize = byteLength(target), sourceSize = byteLength(source);
          if (!integer(start) || start < 0 || start > targetSize || sourceSize > targetSize - start) {
            throw new Invalid('Invalid byte copy range');
          }
          apply(set, target, [source, start]);
        },
        clear(value) { byteLength(value); apply(fill, value, [0]); },
      });
      return freeze({
        fetch(input, init) {
          if (input !== 'https://slither.io/s/game1107249518.js') throw new Invalid('Unsupported profile route');
          return apply(fetch, realm, [input, init]);
        },
        digest(algorithm, value) {
          byteLength(value);
          return apply(then, apply(digest, subtle, [algorithm, value]), [result => {
            if (apply(bufferLength, result, []) !== 32) throw new Invalid('Invalid native digest size');
            const owned = new Bytes(result);
            if (byteLength(owned) !== 32) throw new Invalid('Invalid native digest view');
            return owned;
          }]);
        },
        createAbort() {
          const controller = new Abort();
          return freeze({ signal: apply(signal, controller, []), abort: () => apply(abort, controller, []) });
        },
        setTimeout: native.setTimeout, clearTimeout: native.clearTimeout, now: native.now,
        environment: () => environment,
        responseInfo(value) {
          return freeze({ status: apply(status, value, []), type: apply(type, value, []),
            url: apply(responseUrl, value, []), redirected: apply(redirected, value, []), body: apply(body, value, []) });
        },
        getReader: value => apply(getReader, value, []),
        read: value => apply(read, value, []),
        cancelReader: value => apply(cancel, value, []),
        releaseReader: value => apply(release, value, []),
        bytes,
      });
    } catch { return; }
  }
  try {
    if (realm.document.readyState !== 'loading' || ownValue(realm, 'oef') !== undefined || ownValue(realm, 'ws')) {
      throw new Error('Document-start ownership missed');
    }
    for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask']) native[name] = bind(name);
    native.now = realm.performance.now.bind(realm.performance);
    native.random = realm.Math.random.bind(realm.Math);
    const liveProfile = captureLiveProfile();
    if (liveProfile !== undefined) native.liveProfile = liveProfile;
    const storage = realm.localStorage;
    const getItem = realm.Storage?.prototype.getItem;
    if (!storage || typeof getItem !== 'function') throw new Error('Native storage reader unavailable');
    native.readAccessory = () => Reflect.apply(getItem, storage, ['cosmetic']);
    for (const name of ['requestAnimationFrame', 'setTimeout', 'setInterval']) replace(realm, name, () => 0);
    if (typeof realm.WebSocket !== 'function') throw new Error('Native WebSocket unavailable');
    const Socket = realm.WebSocket;
    function HeldSocket() { throw new Error('Original game sockets are held by SlitherClient'); }
    Object.assign(HeldSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    replace(realm, 'WebSocket', HeldSocket);
    // Only the privately claimed authored session receives this factory; no message
    // command can select a URL or construct a socket through the extension bridge.
    native.createSocket = endpoint => new Socket(endpoint);
    const Context = realm.CanvasRenderingContext2D;
    const Canvas = realm.HTMLCanvasElement;
    if (typeof Context !== 'function' || typeof Canvas !== 'function') throw new Error('Native Canvas unavailable');
    const contextCanvas = Object.getOwnPropertyDescriptor(Context.prototype, 'canvas')?.get;
    if (!contextCanvas) throw new Error('Native context canvas getter unavailable');
    const downloaded = ['kwkbulb', 'pwdbulb', 'playbulb', 'leafbulb', 'swissbulb',
      'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest'];
    for (const name of ['drawImage', 'putImageData', 'fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'reset']) {
      const method = Context.prototype[name];
      if (typeof method !== 'function') {
        if (name === 'reset') continue;
        throw new Error(`Native paint unavailable: ${name}`);
      }
      replace(Context.prototype, name, function (...args) {
        const canvas = Reflect.apply(contextCanvas, this, []);
        changed(canvas, false);
        const result = Reflect.apply(method, this, args);
        // Mutation alone is not a paint commitment: clears, resets and failed paints
        // leave generated sources pending, including before the startup checkpoint.
        if (name !== 'clearRect' && name !== 'reset') changed(canvas, false, true);
        // The pinned profile's downloaded sources commit at their final whole-source write.
        if (name === 'drawImage' && args.length === 3 && args[1] === 0 && args[2] === 0
          && downloaded.some(slotName => ownValue(realm, slotName) === canvas)) changed(canvas, true);
        return result;
      });
    }
    for (const name of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(Canvas.prototype, name);
      if (!descriptor?.get || !descriptor.set || !descriptor.configurable) throw new Error('Native canvas dimensions unavailable');
      Object.defineProperty(Canvas.prototype, name, { ...descriptor, set(value) {
        changed(this, false);
        return Reflect.apply(descriptor.set, this, [value]);
      } });
    }
    const prevent = method(realm.Event.prototype, 'preventDefault');
    const stop = method(realm.Event.prototype, 'stopImmediatePropagation');
    const eventType = getter(realm.Event.prototype, 'type'), eventTarget = getter(realm.Event.prototype, 'target');
    const prevented = getter(realm.Event.prototype, 'defaultPrevented');
    const sink = event => {
      let allow = false, stopped = false, failed = false, primary;
      const failure = error => { if (!failed) { failed = true; primary = error; } revoke(); allow = false; };
      let entered = false, wasDeciding;
      try {
        const type = eventType(event), target = eventTarget(event);
        prevented(event); // Validate the captured native Event receiver, without clearing earlier cancellation.
        stop(event); stopped = true;
        if (deciding) return;
        if (type === 'click' && target?.id === 'slither-client-reload') {
          revoke(); realm.sessionStorage.removeItem(key); realm.location.reload(); return;
        }
        if (!claimed || !input) return;
        const value = lease, router = input, generation = routerGeneration;
        routing++; entered = true; wasDeciding = deciding; deciding = Boolean(value);
        let attributed = false, candidate = false;
        try {
          const live = value && valid(value);
          attributed = live && (target === value.element || type === 'selectionchange'
            && target === editing.initialDocument && editing.active(editing.initialDocument) === value.element);
          candidate = live && disposition(value, event, type, target);
        } catch (error) { failure(error); }
        let result;
        // Editing capability failure must not swallow an original raw keyup/mouse record.
        if (originalTypes.includes(type) || !failed && attributed) {
          try { result = router(event); } catch (error) { failure(error); }
        }
        if (failed) return;
        if (candidate && result !== undefined) throw new TypeError('Nickname edit router must return undefined synchronously');
        allow = Boolean(candidate && lease === value && input === router && routerGeneration === generation
          && disposition(value, event, type, eventTarget(event)));
        finishGesture(value, event, type, target, allow);
      } catch (error) { failure(error); }
      finally {
        if (entered) { routing--; deciding = wasDeciding; }
        if (!allow || failed) { try { prevent(event); } catch (error) { failure(error); } }
        if (!stopped) { try { stop(event); } catch (error) { failure(error); } }
        if (failed) throw primary;
      }
    };
    // Document selectionchange still traverses Window capture before its target.
    for (const type of [...originalTypes, ...notificationTypes]) {
      realm.addEventListener(type, sink, { capture: true, passive: false });
    }
    realm.addEventListener('pagehide', () => { ended = true; revoke(); }, { capture: true });
    realm.document.addEventListener('DOMContentLoaded', () => { completed = true; completedAt = revision; }, { once: true });
    realm.addEventListener('message', event => {
      if (event.source !== realm || event.origin !== url.origin || event.data?.type !== 'slither-client-query'
        || Object.keys(event.data).length !== 2 || event.data.schema !== 1) return;
      status(phase);
    });
    gateRecord = Object.freeze({
      metadata: () => Object.freeze({ schema: 1, id: arm.id, code: phase }),
      claim(id) {
        if (id !== arm.id || claimed) throw new Error('Game document already claimed');
        claimed = true;
        return Object.freeze({ ...native,
          completed: () => completed,
          revision: () => revision,
          stamp: source => writes.get(source)?.revision ?? 0,
          generated: source => completed && writes.get(source)?.generated === true
            && writes.get(source).revision <= completedAt,
          painted: source => writes.get(source)?.ready === true,
          status,
          setInput(handler) {
            if (handler !== undefined && typeof handler !== 'function') throw new TypeError('Input handler required');
            revoke(); routerGeneration = {};
            input = handler;
          },
          registerNicknameEditField,
          // Ordinary reload is the only recovery; never replay the held host callbacks.
          ordinaryReload() { revoke(); realm.sessionStorage.removeItem(key); realm.location.reload(); },
        });
      },
    });
    Object.defineProperty(realm, slot, { value: gateRecord });
    status('held');
  } catch {
    // Keep any installed holds; replaying the original host is not a recovery path.
    Object.defineProperty(realm, slot, { value: Object.freeze({
      metadata: () => Object.freeze({ schema: 1, id: arm.id, code: 'gate-unavailable' }),
    }) });
    status('gate-unavailable');
  }
})();
