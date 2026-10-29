import { loopbackEndpoint } from './loopback-session.mjs';
import { authoredPaletteRgb, createClientAssetMap } from './client-asset-map.mjs';
import { createLocalBodyResolver } from './synthetic-body.mjs';
import { createSyntheticFoodResolver } from './synthetic-food.mjs';
import { createSyntheticPreyResolver } from './synthetic-prey.mjs';

const freeze = Object.freeze;
const apply = Reflect.apply;

function accessor(prototype, name, kind = 'get') {
  const operation = prototype && Object.getOwnPropertyDescriptor(prototype, name)?.[kind];
  if (typeof operation !== 'function') throw new TypeError(`Local browser capability required: ${name}`);
  return (receiver, ...args) => apply(operation, receiver, args);
}

function method(prototype, name) {
  const operation = prototype?.[name];
  if (typeof operation !== 'function') throw new TypeError(`Local browser capability required: ${name}`);
  return (receiver, ...args) => apply(operation, receiver, args);
}

/** Browser plumbing and original stand-ins for the same game runtime on localhost. */
export async function createLocalGameHost({ realm = globalThis, endpoint, sourceFactory } = {}) {
  const document = realm.document, location = realm.location, href = location?.href;
  const match = typeof href === 'string' && /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})(?:[/?#]|$)/.exec(href);
  if (!document || realm.top !== realm || !match || Number(match[1]) > 65535) {
    throw new Error('Literal top-level http://127.0.0.1:<port> document required');
  }
  endpoint = loopbackEndpoint(endpoint);
  let disposed = false, claimed = false, operation = false, inputRoute, nickname, skinPolicy, playControl;
  const cleanups = new Set();
  const isCurrentDocument = () => {
    try {
      return !disposed && realm.top === realm && realm.document === document
        && realm.location === location && location.href === href;
    } catch { return false; }
  };
  function current() {
    if (!isCurrentDocument()) throw new Error('Current local game document required');
  }
  const node = realm.Node?.prototype, element = realm.Element?.prototype;
  const html = realm.HTMLElement?.prototype, input = realm.HTMLInputElement?.prototype;
  const button = realm.HTMLButtonElement?.prototype;
  if (!node || !element || !html || !input || !button) throw new TypeError('Local browser DOM capabilities required');
  const dom = freeze({
    ...Object.fromEntries(['nodeType', 'ownerDocument', 'parentNode', 'firstChild', 'nextSibling', 'isConnected']
      .map(name => [name, accessor(node, name)])),
    localName: accessor(element, 'localName'), namespaceURI: accessor(element, 'namespaceURI'),
    style: accessor(html, 'style'), setText: accessor(realm.CharacterData?.prototype, 'data', 'set'),
    setStyle: method(realm.CSSStyleDeclaration?.prototype, 'setProperty'),
  });
  const construct = freeze({
    createElement: method(realm.Document?.prototype, 'createElement'),
    createTextNode: method(realm.Document?.prototype, 'createTextNode'),
    appendChild: method(node, 'appendChild'), removeChild: method(node, 'removeChild'),
  });
  function captureAppearancePreviewDom() {
    try {
      const canvas = realm.HTMLCanvasElement.prototype, context = realm.CanvasRenderingContext2D.prototype;
      const getContext = method(canvas, 'getContext'), contextCanvas = accessor(context, 'canvas');
      const width = Object.getOwnPropertyDescriptor(canvas, 'width')?.set, height = Object.getOwnPropertyDescriptor(canvas, 'height')?.set;
      const save = method(context, 'save'), restore = method(context, 'restore');
      if (typeof width !== 'function' || typeof height !== 'function') return;
      function owned(value) {
        if (!isCurrentDocument()) throw new Error('Current appearance preview document required');
        if (dom.nodeType(value) !== 1 || dom.ownerDocument(value) !== document || !dom.isConnected(value)
          || dom.namespaceURI(value) !== 'http://www.w3.org/1999/xhtml' || dom.localName(value) !== 'canvas') {
          throw new TypeError('Current HTML appearance preview canvas required');
        }
        if (!isCurrentDocument()) throw new Error('Current appearance preview document required');
      }
      return freeze({ schema: 1, document: document, prepare(value, x, y) {
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
    try {
      const canvas = realm.HTMLCanvasElement.prototype, context = realm.CanvasRenderingContext2D.prototype;
      const getContext = method(canvas, 'getContext'), contextCanvas = accessor(context, 'canvas');
      const width = Object.getOwnPropertyDescriptor(canvas, 'width')?.set, height = Object.getOwnPropertyDescriptor(canvas, 'height')?.set;
      const ImageData = realm.ImageData, Clamped = realm.Uint8ClampedArray;
      if (typeof width !== 'function' || typeof height !== 'function'
        || typeof ImageData !== 'function' || typeof Clamped !== 'function') return;
      const methods = Object.create(null), setters = Object.create(null), issued = new WeakMap();
      for (const name of ['save', 'restore', 'setTransform', 'clearRect', 'beginPath', 'arc',
        'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'putImageData']) methods[name] = method(context, name);
      for (const name of ['fillStyle', 'strokeStyle', 'lineWidth', 'shadowColor', 'shadowBlur',
        'shadowOffsetX', 'shadowOffsetY']) {
        const setter = Object.getOwnPropertyDescriptor(context, name)?.set;
        if (typeof setter !== 'function') return;
        setters[name] = (receiver, value) => apply(setter, receiver, [value]);
      }
      const current = () => {
        if (!isCurrentDocument()) throw new Error('Current minimap document required');
      };
      function owned(value) {
        current();
        if (dom.nodeType(value) !== 1 || dom.ownerDocument(value) !== document
          || dom.namespaceURI(value) !== 'http://www.w3.org/1999/xhtml'
          || dom.localName(value) !== 'canvas') throw new TypeError('Current HTML minimap canvas required');
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
      return freeze({ schema: 1, document, canvas: freeze({
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
  const inputValue = accessor(input, 'value'), setInputValue = accessor(input, 'value', 'set');
  const Input = realm.HTMLInputElement, TextArea = realm.HTMLTextAreaElement;
  const activeElement = accessor(realm.Document.prototype, 'activeElement');
  const matches = method(element, 'matches'), closest = method(element, 'closest'), visible = method(element, 'checkVisibility');
  const autocomplete = accessor(input, 'autocomplete', 'set'), buttonType = accessor(button, 'type', 'set');
  const controls = freeze({
    inputValue, inputMaxLength: accessor(input, 'maxLength', 'set'),
    inputAutocompleteOff: receiver => autocomplete(receiver, 'off'),
    buttonType: receiver => buttonType(receiver, 'button'),
    buttonDisabled: accessor(button, 'disabled', 'set'),
  });
  const setTranslate = accessor(html, 'translate', 'set');
  const add = method(realm.EventTarget?.prototype, 'addEventListener');
  const remove = method(realm.EventTarget?.prototype, 'removeEventListener');
  const preventDefault = method(realm.Event?.prototype, 'preventDefault');
  const Socket = realm.WebSocket;
  if (typeof Socket !== 'function') throw new TypeError('Local browser capability required: WebSocket');
  const bound = (receiver, name) => {
    const callback = receiver?.[name];
    if (typeof callback !== 'function') throw new TypeError(`Local browser capability required: ${name}`);
    return callback.bind(receiver);
  };
  const scheduling = Object.fromEntries(['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout',
    'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'].map(name => [name, bound(realm, name)]));
  const now = bound(realm.performance, 'now'), random = bound(realm.Math, 'random');
  const reload = bound(location, 'reload');
  function listen(target, type, handler, capture = false) {
    add(target, type, handler, capture);
    const cleanup = () => { remove(target, type, handler, capture); cleanups.delete(cleanup); };
    cleanups.add(cleanup);
    return cleanup;
  }
  function child(value, parent) {
    if (dom.ownerDocument(value) !== document || dom.parentNode(value) !== parent) {
      throw new TypeError('Local control in its original document and parent required');
    }
  }
  function createControlsLease({ schema, endpoint: field, endpointParent, button: play, buttonParent, onPlay, actions = [] }) {
    current();
    if (![1, 2].includes(schema) || typeof onPlay !== 'function' || !Array.isArray(actions) || actions.length > 16
      || schema === 1 && actions.length) throw new TypeError('Local Play control lease required');
    child(field, endpointParent); child(play, buttonParent);
    const copied = actions.map(({ button, parent, onPress }) => {
      child(button, parent); child(parent, buttonParent);
      if (dom.localName(button) !== 'button' || typeof onPress !== 'function') throw new TypeError('Local menu action required');
      return { button, parent, onPress };
    });
    if (new Set([play, ...copied.map(item => item.button)]).size !== copied.length + 1) throw new TypeError('Distinct local menu buttons required');
    let unlisteners = [], ended = false;
    const control = { button: play, parent: buttonParent, field, fieldParent: endpointParent, actions: copied };
    const checkActions = () => { for (const action of copied) { child(action.button, action.parent); child(action.parent, buttonParent); } };
    const unregister = () => {
      ended = true; if (playControl === control) playControl = undefined;
      for (const unlisten of unlisteners) unlisten(); unlisteners = []; cleanups.delete(unregister);
    };
    cleanups.add(unregister);
    return freeze({
      bind() {
        current();
        if (ended || unlisteners.length) throw new Error('Local Play lease already bound or released');
        checkActions();
        for (const action of [{ button: play, parent: buttonParent, onPress: onPlay }, ...copied]) {
          unlisteners.push(listen(action.button, 'click', event => {
            if (!isCurrentDocument() || ended || !event.isTrusted || event.defaultPrevented
              || matches(action.button, ':disabled') || closest(action.button, '[inert]') !== null
              || !visible(action.button, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return;
            child(field, endpointParent); child(play, buttonParent); checkActions(); child(action.button, action.parent);
            action.onPress();
          }));
        }
        playControl = control;
      },
      unregister,
    });
  }
  function registerNicknameEditField({ schema, element: field, parent, inputPolicy }) {
    current();
    if (schema !== 1 || inputPolicy !== 'nickname-ascii-24' || nickname) {
      throw new TypeError('One ASCII24 local nickname field required');
    }
    child(field, parent);
    const lease = { field };
    nickname = lease;
    const unregister = () => { if (nickname === lease) nickname = undefined; cleanups.delete(unregister); };
    cleanups.add(unregister);
    return freeze({ unregister, handleInput(event) {
      if (nickname !== lease || !isCurrentDocument() || event.type !== 'input' || event.target !== field) return;
      child(field, parent);
      // Match the existing editor: replace each non-ASCII code unit, then keep 24.
      const value = inputValue(field), corrected = value.slice(0, 24).replace(/[^\x20-\x7f]/g, ' ');
      if (corrected !== value) setInputValue(field, corrected);
    } });
  }
  function setInput(route) {
    current();
    if (typeof route !== 'function') throw new TypeError('Local input route required');
    inputRoute = route;
    if (inputInstalled) return;
    inputInstalled = true;
    const nativePlayDefault = event => {
      const control = playControl;
      const action = control && (event.target === control.button ? { button: control.button, parent: control.parent }
        : control.actions.find(action => action.button === event.target));
      return event.code === 'Space' && action
        && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing
        && dom.ownerDocument(action.button) === document && dom.isConnected(action.button)
        && dom.parentNode(action.button) === action.parent && activeElement(document) === action.button
        && dom.ownerDocument(control.field) === document && dom.isConnected(control.field)
        && dom.parentNode(control.field) === control.fieldParent
        && !matches(action.button, ':disabled') && closest(action.button, '[inert]') === null
        && visible(action.button, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })
        && isCurrentDocument() && playControl === control;
    };
    const deliver = event => {
      if (!isCurrentDocument()) return;
      // Editing keeps native defaults and never becomes steering or boost input.
      const editable = event.target instanceof Input
        || (typeof TextArea === 'function' && event.target instanceof TextArea) || event.target?.isContentEditable;
      // A release belongs to the game input owner even after the pointer/focus
      // moves into an editor. Editing keeps its native default behavior.
      if (editable && !['input', 'mouseup', 'pointerup', 'keyup', 'blur'].includes(event.type)) return;
      if (!editable && ['keydown', 'keyup'].includes(event.type)
        && ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)
        && !nativePlayDefault(event)) preventDefault(event);
      inputRoute?.(event);
    };
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove',
      'keydown', 'keyup', 'blur', 'resize', 'click', 'input']) listen(realm, type, deliver, true);
  }
  let inputInstalled = false;

  const sourceRealm = { HTMLCanvasElement: realm.HTMLCanvasElement, HTMLImageElement: realm.HTMLImageElement,
    document: { createElement: tag => construct.createElement(document, tag) } };
  let sources = await createClientAssetMap({
    realm: sourceFactory === undefined ? { ...sourceRealm, Image: realm.Image } : realm,
    sourceFactory, random,
  });
  current();
  if (sourceFactory === undefined) {
    const { palettes, background, backgroundImage, bodySources } = sources;
    const resolveBody = createLocalBodyResolver(bodySources, sourceRealm, (skin, customBytes) => {
      inOperation();
      const rule = skinPolicy(skin, customBytes);
      inOperation();
      return rule;
    });
    const resolveFood = createSyntheticFoodResolver(sourceRealm, random);
    const resolvePrey = createSyntheticPreyResolver(sourceRealm, random);
    const revision = 'authored-local-1';
    function inOperation() {
      current();
      if (!operation) throw new Error('Local source operation required');
    }
    const adapter = freeze({
      beginOperation() {
        current();
        if (!skinPolicy) throw new Error('Local skin policy must be bound before source operations');
        if (operation) throw new Error('Local source operation already active');
        operation = true;
        return freeze({ revision });
      },
      resolveAppearance(request) {
        inOperation();
        const rule = skinPolicy(request.skin, request.customBytes);
        inOperation();
        // Rust validates the units and resolves the color once for this appearance.
        // These draws share the page random stream with food, prey and antennas.
        const nicknameTint = freeze({ baseRgb: authoredPaletteRgb[rule.basePalette],
          randomUnits: freeze([random(), random(), random()]) });
        return freeze({ face: freeze({ kind: 'paired', eyes: rule.eyes, decoration: freeze({ kind: 'none' }) }),
          antenna: null, nicknameTint });
      },
      resolveRecipe(request) {
        inOperation();
        return resolveBody(request);
      },
      resolveAntennaRandom({ nodeCount, randomPairCount }) {
        inOperation();
        if (![8, 9, 11].includes(nodeCount) || randomPairCount !== nodeCount - 1) throw new TypeError('Local antenna random request required');
        return Float64Array.from({ length: randomPairCount * 2 }, random);
      },
      endOperation() { inOperation(); operation = false; },
    });
    const hostAssets = freeze({
      resolveFood(request, active) { inOperation(); if (active?.revision !== revision) throw new Error('Local source revision required'); return resolveFood(request); },
      resolvePrey(request, active) { inOperation(); if (active?.revision !== revision) throw new Error('Local source revision required'); return resolvePrey(request); },
    });
    sources = { palettes, background, backgroundImage, adapter, hostAssets };
  }
  let preferenceStorage, readPreference, writePreference;
  try {
    preferenceStorage = realm.localStorage;
    readPreference = realm.Storage?.prototype.getItem;
    writePreference = realm.Storage?.prototype.setItem;
  } catch { /* Optional persistence keeps local in-memory choices usable. */ }
  const preferenceKey = 'slither-client.menu.v1';
  const menuPreferences = freeze({ schema: 1, document,
    read() {
      current(); let saved = null;
      try { if (typeof readPreference === 'function') saved = apply(readPreference, preferenceStorage, [preferenceKey]); } catch { /* Optional persistence. */ }
      current(); return typeof saved === 'string' && saved.length <= 600 ? saved : null;
    },
    write(value) {
      current(); if (typeof value !== 'string' || value.length > 600) throw new TypeError('Bounded menu record required');
      let stored = false;
      try { if (typeof writePreference === 'function') { apply(writePreference, preferenceStorage, [preferenceKey, value]); stored = true; } } catch { /* Optional quota/permission failure. */ }
      current(); return stored;
    },
    setNickname(receiver, value) {
      current(); if (typeof value !== 'string' || value.length > 24 || dom.ownerDocument(receiver) !== document || !dom.isConnected(receiver)) throw new TypeError('Current menu nickname field required');
      setInputValue(receiver, value); current();
    },
  });
  const native = freeze({ ...scheduling, now, random, setInput, registerNicknameEditField, menuPreferences,
    hudDom: freeze({ schema: 1, document, dom, isCurrentDocument }),
    ...(appearancePreviewDom ? { appearancePreviewDom } : {}),
    ...(minimapDom ? { minimapDom } : {}),
    ownedHudDom: freeze({ schema: 1, document, dom: construct }),
    ownedPlayDom: freeze({ schema: 1, document, dom: controls, createControlsLease }),
    leaderboardDom: freeze({ schema: 1, document, properties: freeze({ setTranslate }) }),
    createSocket(url) {
      current();
      if (loopbackEndpoint(url) !== endpoint) throw new Error('Selected local simulator endpoint required');
      return new Socket(endpoint);
    },
    status() {}, ordinaryReload() { current(); reload(); },
  });
  const metadata = freeze({ schema: 1, id: Symbol('Local game host'), code: 'held' });
  const gate = freeze({ metadata: () => metadata, claim(id) {
    current();
    if (claimed || id !== metadata.id) throw new Error('Local host may be claimed once with its own id');
    claimed = true;
    return native;
  } });
  return { gate, sources,
    bindSkinPolicy(resolveSkin) {
      current();
      if (skinPolicy) throw new Error('Local skin policy already bound');
      if (typeof resolveSkin !== 'function') throw new TypeError('Local skin policy function required');
      skinPolicy = resolveSkin;
    },
    // Authored local credentials accepted by the simulator; no profile discovery.
    profile: { clientVersion: 0, password: new Uint8Array(20), protocolVersion: 19 },
    endpoint, isCurrentDocument,
    presetEndpoint(field) {
      current();
      if (!(field instanceof Input) || dom.ownerDocument(field) !== document) {
        throw new TypeError('Current local endpoint field required');
      }
      setInputValue(field, endpoint);
    },
    dispose() {
      if (disposed) return;
      disposed = true; inputRoute = nickname = skinPolicy = undefined; operation = false;
      for (const cleanup of [...cleanups]) cleanup();
    },
  };
}
