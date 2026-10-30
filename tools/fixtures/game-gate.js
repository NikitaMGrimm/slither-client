// Test-only authored host harness for Canvas runtime regressions. Never served or packaged.
// Runs before host startup only on an explicitly armed document. No host callback is invoked.
(() => {
  'use strict';
  const realm = globalThis;
  if (realm !== realm.top) return;
  const url = new URL(realm.location.href);
  const home = url.origin === 'http://slither.com' ? url.href === 'http://slither.com/io'
    : ['http://slither.io', 'https://slither.io', 'http://www.slither.io', 'https://www.slither.io'].includes(url.origin)
      && ['/', '/index.html'].includes(url.pathname);
  if (!home || url.search || url.hash || url.username || url.password) return;
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
  let controlsLease, pendingPlay, controlsOperation, playFence;
  let ended = false, gateRecord, delivery, sinking = 0;
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
  let functionSource;
  const functionKind = Symbol.toStringTag;
  function revoke() {
    // Old unregister closures retain only an inert identity after revocation.
    if (lease) { lease.element = undefined; lease.parent = undefined; lease.generation = undefined; }
    lease = undefined; gesture = undefined;
  }
  function revokeControls() {
    pendingPlay = undefined;
    const previous = controlsLease;
    controlsLease = undefined;
    if (gesture?.lease === previous?.edit) gesture = undefined;
    if (previous) {
      for (const action of previous.actions) action.button = action.buttonParent = action.onPlay = undefined;
      previous.actions = [];
      previous.edit.element = previous.edit.parent = previous.edit.generation = undefined;
      previous.button = previous.buttonParent = previous.onPlay = previous.generation = undefined;
    }
  }
  function controlFailure(error) {
    for (const operation of [controlsOperation, playFence]) {
      if (operation && !operation.failed) { operation.failed = true; operation.primary = error; }
    }
    revokeControls();
  }
  function controlsIdle() {
    if (controlsOperation || playFence || sinking || routing || deciding || registering) {
      const error = new Error('Owned controls reentry');
      controlFailure(error); throw error;
    }
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
  function captureNicknameValue() {
    try {
      const value = descriptor(realm.HTMLInputElement.prototype, 'value');
      const code = descriptor(String.prototype, 'charCodeAt')?.value;
      const character = descriptor(String.prototype, 'charAt')?.value;
      if (typeof value?.get !== 'function' || typeof value.set !== 'function'
        || typeof code !== 'function' || typeof character !== 'function') return;
      return freeze({ get: value.get, set: value.set, code, character });
    } catch { return; }
  }
  // Value support is optional independently of the reviewed native-default group.
  const nicknameValue = captureNicknameValue();
  function captureHudDom() {
    // HUD support is optional independently of editing and profile acquisition.
    try {
      const node = realm.Node.prototype, element = realm.Element.prototype;
      const document = getter(realm, 'document'), top = getter(realm, 'top'), location = getter(realm, 'location');
      const initialDocument = document(realm), initialLocation = location(realm);
      const href = getter(initialLocation, 'href'), initialURL = url.href;
      const text = descriptor(realm.CharacterData.prototype, 'data')?.set;
      if (typeof text !== 'function') return;
      const setStyle = method(realm.CSSStyleDeclaration.prototype, 'setProperty');
      const dom = freeze({
        nodeType: getter(node, 'nodeType'), ownerDocument: getter(node, 'ownerDocument'),
        parentNode: getter(node, 'parentNode'), firstChild: getter(node, 'firstChild'),
        nextSibling: getter(node, 'nextSibling'), isConnected: getter(node, 'isConnected'),
        localName: getter(element, 'localName'), namespaceURI: getter(element, 'namespaceURI'),
        style: getter(realm.HTMLElement.prototype, 'style'),
        setText: (receiver, value) => apply(text, receiver, [value]),
        setStyle: (receiver, name, value) => setStyle(receiver, name, value),
      });
      return freeze({ schema: 1, document: initialDocument, dom,
        isCurrentDocument: () => !ended && claimed && realm[slot] === gateRecord && top(realm) === realm
          && document(realm) === initialDocument && location(realm) === initialLocation
          && href(initialLocation) === initialURL,
      });
    } catch { return; }
  }
  const hudDom = captureHudDom();
  function captureAppearancePreviewDom() {
    if (!hudDom) return;
    try {
      const canvas = realm.HTMLCanvasElement.prototype, context = realm.CanvasRenderingContext2D.prototype;
      const getContext = method(canvas, 'getContext'), contextCanvas = getter(context, 'canvas');
      const width = descriptor(canvas, 'width')?.set, height = descriptor(canvas, 'height')?.set;
      const save = method(context, 'save'), restore = method(context, 'restore');
      if (typeof width !== 'function' || typeof height !== 'function') return;
      function owned(value) {
        if (!hudDom.isCurrentDocument()) throw new Error('Current appearance preview document required');
        const dom = hudDom.dom;
        if (dom.nodeType(value) !== 1 || dom.ownerDocument(value) !== hudDom.document || !dom.isConnected(value)
          || dom.namespaceURI(value) !== 'http://www.w3.org/1999/xhtml' || dom.localName(value) !== 'canvas') {
          throw new TypeError('Current HTML appearance preview canvas required');
        }
        if (!hudDom.isCurrentDocument()) throw new Error('Current appearance preview document required');
      }
      return freeze({ schema: 1, document: hudDom.document, prepare(value, x, y) {
        if (![x, y].every(size => Number.isInteger(size) && size > 0 && size <= 1024)) {
          throw new TypeError('Bounded appearance preview dimensions required');
        }
        owned(value); apply(width, value, [x]); owned(value); apply(height, value, [y]); owned(value);
        const result = getContext(value, '2d'); owned(value);
        if (!result || contextCanvas(result) !== value) throw new TypeError('Appearance preview 2d context required');
        let finished = false;
        const finish = () => {
          if (finished) throw new Error('Appearance preview frame consumed');
          finished = true;
          // Restore even if document freshness was lost during submission.
          restore(result); owned(value);
        };
        try { save(result); owned(value); }
        catch (error) { try { finish(); } catch { /* Preserve the first thrown value, including undefined. */ } throw error; }
        return freeze({ context: result, finish });
      } });
    } catch { return; }
  }
  const appearancePreviewDom = captureAppearancePreviewDom();
  function captureMinimapDom() {
    if (!hudDom) return;
    try {
      const canvas = realm.HTMLCanvasElement.prototype, context = realm.CanvasRenderingContext2D.prototype;
      const getContext = method(canvas, 'getContext'), contextCanvas = getter(context, 'canvas');
      const width = descriptor(canvas, 'width')?.set, height = descriptor(canvas, 'height')?.set;
      const ImageData = realm.ImageData, Clamped = realm.Uint8ClampedArray;
      if (typeof width !== 'function' || typeof height !== 'function'
        || typeof ImageData !== 'function' || typeof Clamped !== 'function') return;
      const methods = Object.create(null), setters = Object.create(null), issued = new WeakMap();
      for (const name of ['save', 'restore', 'setTransform', 'clearRect', 'beginPath', 'arc',
        'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'putImageData']) methods[name] = method(context, name);
      for (const name of ['fillStyle', 'strokeStyle', 'lineWidth', 'shadowColor', 'shadowBlur',
        'shadowOffsetX', 'shadowOffsetY']) {
        const setter = descriptor(context, name)?.set;
        if (typeof setter !== 'function') return;
        setters[name] = (receiver, value) => apply(setter, receiver, [value]);
      }
      const current = () => {
        if (!hudDom.isCurrentDocument()) throw new Error('Current minimap document required');
      };
      function owned(value) {
        current();
        if (hudDom.dom.nodeType(value) !== 1 || hudDom.dom.ownerDocument(value) !== hudDom.document
          || hudDom.dom.namespaceURI(value) !== 'http://www.w3.org/1999/xhtml'
          || hudDom.dom.localName(value) !== 'canvas') throw new TypeError('Current HTML minimap canvas required');
        current();
      }
      function target(value) {
        current();
        const canvas = issued.get(value);
        if (!canvas || contextCanvas(value) !== canvas) throw new TypeError('Issued minimap context required');
        owned(canvas);
        return canvas;
      }
      const size = (value, limit) => {
        if (!Number.isInteger(value) || value < 0 || value > limit) throw new TypeError('Minimap dimension required');
      };
      return freeze({ schema: 1, document: hudDom.document, canvas: freeze({
        context(value) {
          owned(value);
          const result = getContext(value, '2d');
          owned(value);
          if (!result || contextCanvas(result) !== value) throw new TypeError('Minimap 2d context required');
          issued.set(result, value);
          return result;
        },
        resize(value, x, y) {
          size(x, 512 + 24); size(y, 512 + 24); owned(value);
          apply(width, value, [x]); owned(value);
          apply(height, value, [y]); owned(value);
        },
        set(value, name, entry) {
          target(value);
          if (!Object.hasOwn(setters, name)) throw new TypeError('Unsupported minimap property');
          setters[name](value, entry); target(value);
        },
        call(value, name, ...args) {
          target(value);
          if (name === 'putImageData' || !Object.hasOwn(methods, name)) throw new TypeError('Unsupported minimap method');
          methods[name](value, ...args); target(value);
        },
        upload(value, dimension, rgba) {
          size(dimension, 512); target(value);
          if (!(rgba instanceof Uint8Array) || rgba.length !== dimension * dimension * 4) {
            throw new TypeError('Minimap RGBA square required');
          }
          if (dimension !== 0) {
            const image = new ImageData(new Clamped(rgba), dimension, dimension);
            target(value); methods.putImageData(value, image, 0, 0); target(value);
          }
        },
      }) });
    } catch { return; }
  }
  const minimapDom = captureMinimapDom();
  function captureLeaderboardDom() {
    if (hudDom === undefined) return;
    try {
      const property = descriptor(realm.HTMLElement.prototype, 'translate');
      if (!property || !Object.hasOwn(property, 'set')) return;
      const translate = property.set;
      const source = descriptor(Function.prototype, 'toString')?.value;
      if (typeof translate !== 'function' || typeof source !== 'function') return;
      // Bound foreign asynchronous kinds retain their prototype ancestry. Inspect
      // descriptors without invoking a tag getter or the candidate setter.
      let cursor = translate;
      const seen = new Set();
      for (let visits = 0; cursor !== null && visits < 64; visits++) {
        if (seen.has(cursor)) return;
        seen.add(cursor);
        const kind = descriptor(cursor, functionKind);
        if (kind && (!Object.hasOwn(kind, 'value')
          || ['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(kind.value))) return;
        cursor = prototype(cursor);
      }
      if (cursor !== null || /^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/.test(apply(source, translate, []))) return;
      let operation;
      function setTranslate(receiver, booleanValue) {
        if (operation) {
          if (!operation.failed) { operation.failed = true; operation.primary = new Error('Leaderboard property reentry'); }
          throw operation.primary;
        }
        const active = { failed: false, primary: undefined };
        operation = active;
        const current = () => {
          if (active.failed) throw active.primary;
          const fresh = hudDom.isCurrentDocument();
          if (active.failed) throw active.primary;
          if (!fresh) throw new Error('Current leaderboard document required');
        };
        const receiverCurrent = () => {
          current();
          for (const [read, expected] of [[hudDom.dom.nodeType, 1],
            [hudDom.dom.namespaceURI, 'http://www.w3.org/1999/xhtml'],
            [hudDom.dom.ownerDocument, hudDom.document]]) {
            const value = read(receiver);
            current();
            if (value !== expected) throw new TypeError('Current HTML leaderboard receiver required');
          }
        };
        try {
          if (typeof booleanValue !== 'boolean') throw new TypeError('Leaderboard primitive boolean required');
          receiverCurrent();
          apply(translate, receiver, [booleanValue]);
          receiverCurrent();
        } catch (error) {
          if (active.failed) throw active.primary;
          throw error;
        } finally { operation = undefined; }
      }
      return freeze({ schema: 1, document: hudDom.document, properties: freeze({ setTranslate }) });
    } catch { return; }
  }
  const leaderboardDom = captureLeaderboardDom();
  function captureOwnedHudDom() {
    if (hudDom === undefined) return;
    try {
      const document = realm.Document.prototype, node = realm.Node.prototype;
      const createElement = method(document, 'createElement'), createTextNode = method(document, 'createTextNode');
      const appendChild = method(node, 'appendChild'), removeChild = method(node, 'removeChild');
      return freeze({ schema: 1, document: hudDom.document, dom: freeze({
        createElement: (receiver, tag) => createElement(receiver, tag),
        createTextNode: (receiver, text) => createTextNode(receiver, text),
        appendChild: (receiver, child) => appendChild(receiver, child),
        removeChild: (receiver, child) => removeChild(receiver, child),
      }) });
    } catch { return; }
  }
  const ownedHudDom = captureOwnedHudDom();
  function captureOwnedPlayDom() {
    if (!hudDom || !ownedHudDom || !editing || !nicknameValue || editing.initialDocument !== hudDom.document) return;
    try {
      functionSource = descriptor(Function.prototype, 'toString')?.value;
      if (typeof functionSource !== 'function') return;
      const input = realm.HTMLInputElement.prototype, button = realm.HTMLButtonElement.prototype;
      const value = descriptor(input, 'value')?.get, maxLength = descriptor(input, 'maxLength')?.set;
      const autocomplete = descriptor(input, 'autocomplete')?.set, type = descriptor(button, 'type')?.set;
      const disabled = descriptor(button, 'disabled')?.set;
      if (![value, maxLength, autocomplete, type, disabled].every(operation => typeof operation === 'function')) return;
      const dom = freeze({
        inputValue(receiver) {
          const result = apply(value, receiver, []);
          if (typeof result !== 'string') throw new TypeError('Native input string required');
          return result;
        },
        inputMaxLength(receiver, length) {
          if (length !== 24 && length !== 128) throw new TypeError('Owned input length required');
          apply(maxLength, receiver, [length]);
        },
        inputAutocompleteOff(receiver) { apply(autocomplete, receiver, ['off']); },
        buttonType(receiver) { apply(type, receiver, ['button']); },
        buttonDisabled(receiver, value) {
          if (typeof value !== 'boolean') throw new TypeError('Owned button boolean required');
          apply(disabled, receiver, [value]);
        },
      });
      return freeze({ schema: 1, document: hudDom.document, dom, createControlsLease });
    } catch { return; }
  }
  const ownedPlayDom = captureOwnedPlayDom();
  function captureMenuPreferences() {
    if (!hudDom || !ownedPlayDom || !nicknameValue) return;
    let storage, getItem, setItem;
    try {
      storage = realm.localStorage;
      getItem = descriptor(realm.Storage.prototype, 'getItem')?.value;
      setItem = descriptor(realm.Storage.prototype, 'setItem')?.value;
    } catch { /* Unavailable persistence keeps in-memory menu choices usable. */ }
    const current = () => { if (!hudDom.isCurrentDocument()) throw new Error('Current menu document required'); };
    const key = 'slither-client.menu.v1';
    return freeze({ schema: 1, document: hudDom.document,
      read() {
        current(); let result = null;
        try { if (typeof getItem === 'function') result = apply(getItem, storage, [key]); } catch { /* Blocked storage is optional. */ }
        current();
        return typeof result === 'string' && result.length <= 600 ? result : null;
      },
      write(value) {
        current();
        if (typeof value !== 'string' || value.length > 600) throw new TypeError('Bounded menu record required');
        let stored = false;
        try { if (typeof setItem === 'function') { apply(setItem, storage, [key, value]); stored = true; } } catch { /* Quota/permission failures do not consume Play. */ }
        current(); return stored;
      },
      setNickname(receiver, value) {
        current();
        if (typeof value !== 'string' || value.length > 24 || editing.ownerDocument(receiver) !== hudDom.document
          || editing.localName(receiver) !== 'input' || !editing.connected(receiver)) throw new TypeError('Current menu nickname field required');
        apply(nicknameValue.set, receiver, [value]); current();
      },
    });
  }
  const menuPreferences = captureMenuPreferences();
  function createControlsLease(record) {
    const extended = descriptor(record ?? {}, 'schema')?.value === 2;
    const keys = ['schema', 'endpoint', 'endpointParent', 'button', 'buttonParent', 'onPlay', ...(extended ? ['actions'] : [])];
    if (!record || typeof record !== 'object' || ![recordPrototype, null].includes(prototype(record))) {
      throw new TypeError('Closed owned controls record required');
    }
    const fields = ownKeys(record), values = {};
    if (fields.length !== keys.length || !keys.every(key => fields.includes(key))) throw new TypeError('Closed owned controls record required');
    for (const key of keys) {
      const field = descriptor(record, key);
      if (!field || !Object.hasOwn(field, 'value')) throw new TypeError('Owned controls data fields required');
      values[key] = field.value;
    }
    if (values.schema !== (extended ? 2 : 1)) throw new TypeError('Owned controls schema required');
    const callback = value => {
      if (typeof value !== 'function') throw new TypeError('Owned controls callback required');
      let cursor = value;
      const seen = new Set();
      for (let visits = 0; visits < 64; visits++) {
        cursor = prototype(cursor);
        if (cursor === null) break;
        const kind = descriptor(cursor, functionKind);
        if (seen.has(cursor) || kind && Object.hasOwn(kind, 'value')
          && ['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(kind.value)) {
          throw new TypeError('Synchronous owned controls callback required');
        }
        seen.add(cursor);
      }
      if (cursor !== null || /^(?:\*|function\s*\*|async(?:\s+function\b|\s+[$\w]+|\s*\([^]*?\)\s*=>))/.test(apply(functionSource, value, []))) {
        throw new TypeError('Synchronous owned controls callback required');
      }
      return value;
    };
    callback(values.onPlay);
    const actions = [];
    if (extended) {
      const length = descriptor(values.actions ?? {}, 'length')?.value;
      if (!Array.isArray(values.actions) || !Number.isInteger(length) || length < 1 || length > 16
        || ownKeys(values.actions).length !== length + 1) throw new TypeError('Bounded menu actions required');
      for (let index = 0; index < length; index++) {
        const entry = descriptor(values.actions, String(index));
        if (!entry || !Object.hasOwn(entry, 'value')) throw new TypeError('Menu action data required');
        const item = entry.value;
        if (!item || ![recordPrototype, null].includes(prototype(item)) || ownKeys(item).length !== 3) throw new TypeError('Closed menu action required');
        const copied = {};
        for (const key of ['button', 'parent', 'onPress']) {
          const field = descriptor(item, key);
          if (!field || !Object.hasOwn(field, 'value')) throw new TypeError('Menu action data required');
          copied[key] = field.value;
        }
        actions.push({ button: copied.button, buttonParent: copied.parent, onPlay: callback(copied.onPress) });
      }
      if (new Set([values.button, ...actions.map(action => action.button)]).size !== actions.length + 1) throw new TypeError('Distinct menu buttons required');
    }
    let candidate = { edit: { element: values.endpoint, parent: values.endpointParent, generation: undefined },
      button: values.button, buttonParent: values.buttonParent, onPlay: values.onPlay, actions, generation: undefined };
    let used = false;
    return freeze({
      bind() {
        controlsIdle();
        if (used) throw new Error('Owned controls lease already consumed');
        used = true;
        const next = candidate, generation = routerGeneration;
        const operation = { failed: false, primary: undefined };
        controlsOperation = operation;
        try {
          if (controlsLease || !current(generation)) throw new Error('Current empty owned controls slot required');
          next.generation = next.edit.generation = generation;
          if (!controlsStructural(next) || !current(generation)) throw new Error('Current owned controls required');
          if (operation.failed) throw operation.primary;
          if (candidate !== next || generation !== routerGeneration || ended || input === undefined) {
            throw new Error('Owned controls lease consumed during binding');
          }
          controlsLease = next;
        } catch (error) {
          if (!operation.failed) { operation.failed = true; operation.primary = error; }
          throw operation.primary;
        } finally { controlsOperation = undefined; }
      },
      unregister() {
        const previous = candidate;
        candidate = undefined; used = true;
        if (controlsLease === previous) revokeControls();
        if (previous) {
          for (const action of previous.actions) action.button = action.buttonParent = action.onPlay = undefined;
          previous.actions = [];
          previous.edit.element = previous.edit.parent = previous.edit.generation = undefined;
          previous.button = previous.buttonParent = previous.onPlay = previous.generation = undefined;
        }
      },
    });
  }
  function controlsStructural(value) {
    if (!structural(value.edit)) return false;
    for (const node of [value.button, value.buttonParent]) {
      if (editing.nodeType(node) !== 1 || editing.namespace(node) !== 'http://www.w3.org/1999/xhtml'
        || editing.ownerDocument(node) !== editing.initialDocument || !editing.connected(node)
        || editing.root(node, { composed: false }) !== editing.initialDocument) return false;
    }
    for (const action of value.actions) {
      for (const node of [action.button, action.buttonParent]) {
        if (editing.nodeType(node) !== 1 || editing.namespace(node) !== 'http://www.w3.org/1999/xhtml'
          || editing.ownerDocument(node) !== editing.initialDocument || !editing.connected(node)
          || editing.root(node, { composed: false }) !== editing.initialDocument) return false;
      }
      if (editing.localName(action.button) !== 'button' || editing.localName(action.buttonParent) !== 'div'
        || editing.parentNode(action.button) !== action.buttonParent || editing.parentNode(action.buttonParent) !== value.buttonParent) return false;
    }
    return value.edit.element !== value.button && value.edit.parent !== value.buttonParent
      && value.edit.element !== value.edit.parent && value.button !== value.buttonParent
      && (!lease || value.edit.element !== lease.element && value.edit.parent !== lease.parent)
      && editing.localName(value.button) === 'button' && editing.parentNode(value.button) === value.buttonParent
      && editing.parentNode(value.edit.parent) === value.buttonParent;
  }
  function validControls(value) {
    if (controlsLease !== value) return false;
    if (!current(value.generation) || !controlsStructural(value) || !current(value.generation)) { revokeControls(); return false; }
    return controlsLease === value && value.generation === routerGeneration;
  }
  function eligibleButton(value, action = value) {
    return validControls(value) && (action === value || value.actions.includes(action)) && !editing.disabled(action.button, ':disabled')
      && editing.inert(action.button, '[inert]') === null
      && editing.visible(action.button, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }) === true
      && current(value.generation) && controlsLease === value && value.generation === routerGeneration;
  }
  function editMember(target) {
    const endpoint = controlsLease?.edit;
    if (lease && target === lease.element) return lease;
    if (endpoint && (target === endpoint.element || target === editing.initialDocument
      && editing.active(editing.initialDocument) === endpoint.element || gesture?.lease === endpoint)) return endpoint;
    return lease;
  }
  function queuePlay(value, operation, action = value) {
    if (pendingPlay || controlsLease !== value) return;
    const ticket = { value, ready: false };
    pendingPlay = ticket;
    try {
      native.queueMicrotask(() => {
        if (pendingPlay !== ticket) return;
        if (!ticket.ready) {
          const error = new Error('Asynchronous owned Play scheduler required');
          controlFailure(error); throw error;
        }
        // Native freshness checks can themselves reenter; poison before releasing the guard.
        const check = { failed: false, primary: undefined };
        let callback;
        if (sinking || routing || deciding || registering || controlsOperation || playFence) {
          controlFailure(new Error('Idle owned Play boundary required')); return;
        }
        playFence = check;
        try {
          if (validControls(value) && eligibleButton(value, action) && controlsLease === value && pendingPlay === ticket) callback = action.onPlay;
          if (check.failed) throw check.primary;
        } catch (error) { controlFailure(error); throw check.primary; }
        finally { playFence = undefined; pendingPlay = undefined; }
        if (callback && callback() !== undefined) throw new TypeError('Owned Play callback must return undefined synchronously');
      });
      if (operation.failed) throw operation.primary;
      if (pendingPlay !== ticket || !validControls(value) || controlsLease !== value) {
        pendingPlay = undefined; return;
      }
      if (operation.failed) throw operation.primary;
      ticket.ready = true;
    } catch (error) {
      controlFailure(error);
      throw operation.primary;
    }
  }
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
    if (controlsLease?.edit === value) return validControls(controlsLease);
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
  function handleNicknameInput(value, event) {
    if (lease !== value) return;
    const previous = value.operation;
    if (previous) {
      // A caught reentry must remain primary until the outer native operation unwinds.
      if (!previous.failed) { previous.failed = true; previous.primary = new Error('Nickname input reentry'); }
      revoke();
      throw previous.primary;
    }
    const operation = { failed: false, primary: undefined };
    value.operation = operation;
    let active, original, corrected;
    const check = () => {
      if (operation.failed) throw operation.primary;
      if (sinking !== 1 || delivery !== active || lease !== value || active.lease !== value || active.event !== event
        || active.target !== value.element || !valid(value) || !current(value.generation) || lease !== value) {
        throw new Error('Current nickname input delivery required');
      }
      if (operation.failed) throw operation.primary;
    };
    try {
      active = delivery;
      if (sinking !== 1 || !active || active.lease !== value || active.event !== event || value.generation !== routerGeneration) {
        throw new Error('Current nickname input delivery required');
      }
      if (active.type !== 'input') return;
      if (active.handled) throw new Error('Nickname input already handled');
      active.handled = true;
      check();
      original = apply(nicknameValue.get, value.element, []);
      if (typeof original !== 'string') throw new TypeError('Native nickname string required');
      corrected = '';
      for (let index = 0; index < original.length && index < 24; index++) {
        const unit = apply(nicknameValue.code, original, [index]);
        corrected += unit >= 32 && unit <= 127 ? apply(nicknameValue.character, original, [index]) : ' ';
      }
      check();
      if (corrected !== original) apply(nicknameValue.set, value.element, [corrected]);
      check();
    } catch (error) {
      if (!operation.failed) { operation.failed = true; operation.primary = error; }
      if (lease === value) revoke();
      throw operation.primary;
    } finally {
      value.operation = undefined;
      active = original = corrected = event = undefined;
      operation.primary = undefined;
    }
  }
  function registerNicknameEditField(record) {
    if (controlsOperation) { const error = new Error('Owned controls registration reentry'); controlFailure(error); throw error; }
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
      const policy = keys.length === 4 && keys.includes('inputPolicy');
      if (keys.length !== (policy ? 4 : 3) || !['schema', 'element', 'parent'].every(name => keys.includes(name))) {
        throw new TypeError('Closed nickname edit record required');
      }
      const values = {};
      for (const name of keys) {
        const field = descriptor(record, name);
        if (!field || !Object.hasOwn(field, 'value')) throw new TypeError('Nickname edit data fields required');
        values[name] = field.value;
      }
      if (values.schema !== 1) throw new TypeError('Nickname edit schema required');
      if (policy && values.inputPolicy !== 'nickname-ascii-24') throw new TypeError('Nickname input policy required');
      if (policy && !nicknameValue) throw new Error('Native nickname input policy unavailable');
      const next = { element: values.element, parent: values.parent, generation, operation: undefined };
      if (!structural(next) || !current(generation)) throw new Error('Current native text field required');
      const result = freeze({ unregister() { if (lease === next) revoke(); },
        ...(policy ? { handleInput(event) { return handleNicknameInput(next, event); } } : {}) });
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
  // Permit native focus traversal and native button activation only inside the
  // current owned control lease. The resulting click still needs queuePlay's
  // trusted-event, visibility, disabled and post-router checks.
  function controlsKeyboardDefault(controls, event, type, target) {
    if (!['keydown', 'keyup', 'keypress'].includes(type) || !validControls(controls)
      || editing.active(editing.initialDocument) !== target) return false;
    const action = target === controls.button ? controls : controls.actions.find(action => action.button === target);
    const member = target === controls.edit.element ? controls.edit
      : lease && target === lease.element ? lease : undefined;
    if (action ? !eligibleButton(controls, action) : !member || !eligible(member, true)) return false;
    if (editing.ctrl(event) || editing.meta(event) || editing.alt(event)
      || editing.composing(event) || editing.modifier(event, 'AltGraph')) return false;
    const key = editing.key(event);
    const allow = key === 'Tab' || action && !editing.shift(event)
      && (key === 'Enter' || key === ' ' || editing.code(event) === 'NumpadEnter');
    if (!allow || controlsLease !== controls || !current(controls.generation)) return false;
    // Keyboard getters can revoke a member or change its focus/DOM eligibility.
    const eligibleNow = action ? eligibleButton(controls, action)
      : (member === controls.edit || lease === member) && eligible(member, true)
        && (member === controls.edit || lease === member);
    return eligibleNow && editing.active(editing.initialDocument) === target
      && controlsLease === controls && current(controls.generation) && controlsLease === controls;
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
    if (!value || lease !== value && controlsLease?.edit !== value) return;
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
  // The URL remains inside this one-entry native capability, never a caller argument.
  function captureSelectedAccessoryRequest(readAccessory) {
    try {
      const Image = realm.HTMLImageElement, image = Image.prototype;
      const initialDocument = realm.document, initialLocation = realm.location;
      const readDocument = getter(realm, 'document'), readLocation = getter(realm, 'location');
      const readHref = getter(initialLocation, 'href'), initialHref = readHref(initialLocation);
      const create = descriptor(realm.Document.prototype, 'createElement')?.value;
      const src = descriptor(image, 'src'), add = realm.EventTarget.prototype.addEventListener;
      const remove = realm.EventTarget.prototype.removeEventListener;
      const scalars = ['complete', 'width', 'height', 'naturalWidth', 'naturalHeight', 'currentSrc']
        .map(name => descriptor(image, name)?.get);
      const define = Object.defineProperty, extensible = Object.isExtensible, same = Object.is;
      if ([create, src?.get, src?.set, add, remove, ...scalars].some(fn => typeof fn !== 'function')) return;
      const data = (object, key, absent = false) => {
        const value = descriptor(object, key);
        if (!value && absent) return undefined;
        if (!value || !Object.hasOwn(value, 'value')) throw new TypeError('Selected accessory own data required');
        return value.value;
      };
      const writable = (object, key, absent = false) => {
        const value = descriptor(object, key);
        if (!value ? !absent || !extensible(object) : !Object.hasOwn(value, 'value') || value.writable !== true) {
          throw new TypeError('Selected accessory writable own slot required');
        }
      };
      const set = (object, key, value, absent = false) => {
        writable(object, key, absent);
        const old = descriptor(object, key);
        define(object, key, old ? { value } : { value, writable: true, enumerable: true, configurable: true });
      };
      let opened = false;
      return freeze({ open(resolveId) {
        if (opened) throw new Error('Selected accessory request already captured');
        opened = true;
        const raw = readAccessory();
        let count = 0, id = -1, table, entry, url, geometry, source, candidate, allocated = false, owned = false, published = false, requested = false;
        let expectedLoaded, expectedExtents, fingerprint, loadExtents;
        const none = raw === null || raw === '-1';
        if (!none) {
          count = data(realm, 'a_ct');
          if (!Number.isInteger(count) || count < 1 || count > 4096) throw new TypeError('Selected accessory table count invalid');
          id = resolveId(raw, count);
          if (!Number.isInteger(id) || id < 0 || id >= count) throw new TypeError('Selected accessory ID invalid');
          table = data(realm, 'a_imgs', true);
          // Missing native data leaves capture unconsumed; malformed data still throws.
          if (table == null) { opened = false; return; }
          if (!Array.isArray(table) || table.length !== count) throw new TypeError('Selected accessory table unavailable');
          entry = data(table, String(id), true);
          if (entry == null) { opened = false; return; }
          url = data(entry, 'u');
          geometry = ['sc', 'px', 'py'].map(key => data(entry, key));
          if (typeof url !== 'string' || geometry.some(value => typeof value !== 'number')) throw new TypeError('Selected accessory resource metadata invalid');
          source = data(entry, 'img'); expectedLoaded = data(entry, 'loaded');
          if (typeof expectedLoaded !== 'boolean' || source != null && !(source instanceof Image)
            || source == null && expectedLoaded) throw new TypeError('Selected accessory initial source invalid');
          if (source == null) { writable(entry, 'img'); writable(entry, 'loaded'); writable(entry, 'ww', true); writable(entry, 'hh', true); }
        }
        function fresh() {
          if (readDocument(realm) !== initialDocument || readLocation(realm) !== initialLocation
            || readHref(initialLocation) !== initialHref || !same(readAccessory(), raw)) throw new Error('Selected accessory document/selection changed');
          if (none) return;
          if (data(realm, 'a_ct') !== count || data(realm, 'a_imgs') !== table || table.length !== count
            || data(table, String(id)) !== entry || !same(data(entry, 'u'), url)
            || ['sc', 'px', 'py'].some((key, index) => !same(data(entry, key), geometry[index]))
            || !same(data(entry, 'img'), source)) throw new Error('Selected accessory binding changed');
          if (owned) {
            if (data(entry, 'loaded') !== expectedLoaded) throw new Error('Selected accessory loaded flag changed');
            if (requested && apply(src.get, source, []) !== url) throw new Error('Selected accessory source changed');
            if (published && (['ww', 'hh'].some((key, index) => !same(data(entry, key), expectedExtents[index]))
              || scalars.some((read, index) => !same(apply(read, source, []), fingerprint[index])))) throw new Error('Selected accessory extent/load changed');
            for (let index = 0; index < count; index++) if (index !== id && data(data(table, String(index)), 'img') === source) {
              throw new Error('Selected accessory image aliases another entry');
            }
          }
        }
        const binding = freeze({
          prepare(policy, now) { fresh(); return policy.prepare(raw, count, none ? 0 : source == null ? 0 : expectedLoaded ? 2 : 1,
            none ? '' : url, ...(none ? [1, 0, 0] : geometry), now); },
          assertCurrent: fresh,
          create() {
            fresh();
            if (allocated || source != null) throw new Error('Selected native image creation already attempted or unnecessary');
            allocated = true;
            const value = apply(create, initialDocument, ['img']);
            fresh();
            if (!(value instanceof Image) || source != null) throw new TypeError('Fresh native accessory image required');
            // Retain privately until the explicit cache-img publication step.
            candidate = value;
          },
          publishImage() {
            const value = candidate;
            if (!(value instanceof Image)) throw new Error('Created selected image required');
            if (source != null) throw new Error('Selected accessory image replaced during creation');
            fresh(); writable(entry, 'img'); set(entry, 'img', value); source = value; candidate = undefined; owned = true; fresh();
          },
          listen(load, error) {
            fresh(); apply(add, source, ['load', load]);
            try { apply(add, source, ['error', error]); }
            catch (primary) { try { apply(remove, source, ['load', load]); } catch {} throw primary; }
            return () => {
              let failed = false, primary;
              for (const [type, listener] of [['load', load], ['error', error]]) {
                try { apply(remove, source, [type, listener]); } catch (value) { if (!failed) { failed = true; primary = value; } }
              }
              if (failed) throw primary;
            };
          },
          request() {
            fresh();
            if (requested || !owned) throw new Error('Selected native src assignment already attempted or not owned');
            requested = true; apply(src.set, source, [url]); fresh();
          },
          extents() { fresh(); loadExtents = scalars.map(read => apply(read, source, [])); return loadExtents.slice(0, 5); },
          publishLoaded() {
            fresh();
            const values = scalars.map(read => apply(read, source, []));
            if (!loadExtents || values.some((value, index) => !same(value, loadExtents[index]))) {
              throw new Error('Selected accessory native extents changed before publication');
            }
            writable(entry, 'ww', true); writable(entry, 'hh', true); writable(entry, 'loaded');
            set(entry, 'ww', values[1], true); fresh();
            set(entry, 'hh', values[2], true); fresh();
            set(entry, 'loaded', true); expectedLoaded = true;
            expectedExtents = [values[1], values[2]]; fingerprint = values; published = true; fresh();
          },
          matches(value) { fresh(); return !none && source === value; },
        });
        return binding;
      } });
    } catch { return; }
  }
  try {
    if (realm.document.readyState !== 'loading' || ownValue(realm, 'oef') !== undefined || ownValue(realm, 'ws')) {
      throw new Error('Document-start ownership missed');
    }
    for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask']) native[name] = bind(name);
    native.now = realm.performance.now.bind(realm.performance);
    native.random = realm.Math.random.bind(realm.Math);
    if (hudDom !== undefined) native.hudDom = hudDom;
    if (appearancePreviewDom !== undefined) native.appearancePreviewDom = appearancePreviewDom;
    if (minimapDom !== undefined) native.minimapDom = minimapDom;
    if (leaderboardDom !== undefined) native.leaderboardDom = leaderboardDom;
    if (ownedHudDom !== undefined) native.ownedHudDom = ownedHudDom;
    if (ownedPlayDom !== undefined) native.ownedPlayDom = ownedPlayDom;
    if (menuPreferences !== undefined) native.menuPreferences = menuPreferences;
    const liveProfile = captureLiveProfile();
    if (liveProfile !== undefined) native.liveProfile = liveProfile;
    const storage = realm.localStorage;
    const getItem = realm.Storage?.prototype.getItem;
    if (!storage || typeof getItem !== 'function') throw new Error('Native storage reader unavailable');
    native.readAccessory = () => Reflect.apply(getItem, storage, ['cosmetic']);
    const selectedAccessoryRequest = captureSelectedAccessoryRequest(native.readAccessory);
    if (selectedAccessoryRequest) native.selectedAccessoryRequest = selectedAccessoryRequest;
    // Optional one-image load commitment. The pinned host uses these cached
    // images once per load; this does not fence arbitrary image mutations.
    try {
      const Image = realm.HTMLImageElement, image = Image.prototype;
      const reads = ['src', 'currentSrc', 'complete', 'naturalWidth', 'naturalHeight']
        .map(name => Object.getOwnPropertyDescriptor(image, name)?.get);
      const decode = image.decode, then = realm.Promise?.prototype.then;
      const add = realm.EventTarget?.prototype.addEventListener, remove = realm.EventTarget?.prototype.removeEventListener;
      if (reads.some(read => typeof read !== 'function') || [decode, then, add, remove].some(fn => typeof fn !== 'function')) {
        throw new TypeError('Accessory native load capabilities unavailable');
      }
      native.accessorySource = Object.freeze({
        inspect(source) {
          if (!(source instanceof Image)) throw new TypeError('Existing native accessory image required');
          return reads.map(read => Reflect.apply(read, source, []));
        },
        decode: source => Reflect.apply(decode, source, []),
        then: (promise, success, failure) => Reflect.apply(then, promise, [success, failure]),
        listen(source, invalidate) {
          Reflect.apply(add, source, ['load', invalidate]);
          try { Reflect.apply(add, source, ['error', invalidate]); }
          catch (error) { try { Reflect.apply(remove, source, ['load', invalidate]); } catch {} throw error; }
          return () => {
            let failed = false, primary;
            for (const type of ['load', 'error']) {
              try { Reflect.apply(remove, source, [type, invalidate]); }
              catch (error) { if (!failed) { failed = true; primary = error; } }
            }
            if (failed) throw primary;
          };
        },
        setTimeout: native.setTimeout, clearTimeout: native.clearTimeout, now: native.now,
      });
    } catch { /* No selection retains the existing capability requirements. */ }
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
      'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest', 'jmou'];
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
      const failure = error => {
        if (!failed) { failed = true; primary = operation?.failed ? operation.primary : error; }
        revoke(); controlFailure(primary); allow = false;
      };
      let entered = false, wasDeciding;
      let action, actionButton, operation;
      // Native fence operations can reenter before the nested dispatch is refused.
      sinking++;
      try {
        if (controlsOperation || playFence) {
          const error = new Error('Owned controls dispatch reentry');
          controlFailure(error); throw error;
        }
        if (controlsLease) { operation = { failed: false, primary: undefined }; playFence = operation; }
        const type = eventType(event), target = eventTarget(event);
        const initiallyPrevented = prevented(event); // Validate the native receiver without clearing earlier cancellation.
        stop(event); stopped = true;
        if (operation?.failed) throw operation.primary;
        if (deciding) return;
        if (type === 'click' && target?.id === 'slither-client-reload') {
          revoke(); revokeControls(); realm.sessionStorage.removeItem(key); realm.location.reload(); return;
        }
        if (!claimed || !input) return;
        const nickname = lease, value = editMember(target), router = input, generation = routerGeneration;
        routing++; entered = true; wasDeciding = deciding; deciding = Boolean(value || controlsLease);
        let attributed = false, candidate = false, navigation = false;
        const controls = controlsLease;
        try {
          const live = value && valid(value);
          if (value === nickname) {
            attributed = live && (target === nickname.element || type === 'selectionchange'
              && target === editing.initialDocument && editing.active(editing.initialDocument) === nickname.element);
          } else {
            attributed = nickname && (target === nickname.element || type === 'selectionchange'
              && target === editing.initialDocument && editing.active(editing.initialDocument) === nickname.element) && valid(nickname);
          }
          candidate = live && disposition(value, event, type, target);
          navigation = controls && controlsKeyboardDefault(controls, event, type, target);
          const chosen = controls && (target === controls.button ? controls : controls.actions.find(action => action.button === target));
          if (chosen && type === 'click' && initiallyPrevented === false
            && editing.button(event) === 0 && eligibleButton(controls, chosen)) {
            const trusted = descriptor(event, 'isTrusted');
            if (trusted && trusted.configurable === false && typeof trusted.get === 'function'
              && trusted.set === undefined && !Object.hasOwn(trusted, 'value')
              && apply(trusted.get, event, []) === true) { action = controls; actionButton = chosen; }
          }
        } catch (error) { failure(error); }
        let result;
        // Editing capability failure must not swallow an original raw keyup/mouse record.
        if (originalTypes.includes(type) || !failed && attributed) {
          try {
            delivery = { event, lease: nickname, type, target, handled: false };
            result = router(event);
          } catch (error) { failure(error); }
          finally { delivery = undefined; }
        }
        if (failed) return;
        if (operation?.failed) throw operation.primary;
        if (candidate && result !== undefined) throw new TypeError('Nickname edit router must return undefined synchronously');
        if (action && result !== undefined) throw new TypeError('Owned Play router must return undefined synchronously');
        if (navigation && result !== undefined) throw new TypeError('Owned keyboard router must return undefined synchronously');
        allow = Boolean(candidate && (lease === value || controlsLease?.edit === value) && input === router && routerGeneration === generation
          && disposition(value, event, type, eventTarget(event)));
        if (navigation && controlsLease === controls && input === router && routerGeneration === generation
          && controlsKeyboardDefault(controls, event, type, eventTarget(event))) allow = true;
        if (action && (controlsLease !== action || input !== router || routerGeneration !== generation
          || eventTarget(event) !== actionButton.button || !eligibleButton(action, actionButton))) action = undefined;
        finishGesture(value, event, type, target, allow);
      } catch (error) { failure(error); }
      finally {
        if (entered) { routing--; deciding = wasDeciding; }
        if (!allow || failed) { try { prevent(event); } catch (error) { failure(error); } }
        if (!stopped) { try { stop(event); } catch (error) { failure(error); } }
        sinking--;
        if (operation) {
          try {
            if (operation.failed) throw operation.primary;
            if (!failed && action && controlsLease === action && eligibleButton(action, actionButton)) {
              if (operation.failed) throw operation.primary;
              queuePlay(action, operation, actionButton);
            }
          } catch (error) { failure(error); }
          finally { if (playFence === operation) playFence = undefined; }
        }
        if (failed) throw primary;
      }
    };
    // Document selectionchange still traverses Window capture before its target.
    for (const type of [...originalTypes, ...notificationTypes]) {
      realm.addEventListener(type, sink, { capture: true, passive: false });
    }
    realm.addEventListener('pagehide', () => { ended = true; revoke(); revokeControls(); }, { capture: true });
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
            revoke(); revokeControls(); routerGeneration = {};
            input = handler;
          },
          registerNicknameEditField,
          // Ordinary reload is the only recovery; never replay the held host callbacks.
          ordinaryReload() { revoke(); revokeControls(); realm.sessionStorage.removeItem(key); realm.location.reload(); },
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
