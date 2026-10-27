// Authored native-receiver and explicit propagation doubles. No browser semantics.
export function createGateTestDom() {
  const nodes = new WeakMap(), eventData = new WeakMap();
  const state = value => {
    if (!nodes.has(value)) throw new TypeError('Synthetic native Node receiver');
    return nodes.get(value);
  };
  const root = value => { let node = value; while (state(node).parent) node = state(node).parent; return node; };
  class Node extends EventTarget {
    constructor(tag, document = false) {
      super(); nodes.set(this, { tag, document, parent: null, owner: null, type: 'text',
        readOnly: false, disabled: false, inert: false, visible: true, active: null });
      this.children = []; this.id = ''; this.textContent = '';
    }
    get nodeType() { return state(this).document ? 9 : 1; }
    get ownerDocument() { return state(this).document ? null : state(this).owner; }
    get parentNode() { return state(this).parent; }
    get isConnected() { return state(this).document || root(this) === state(this).owner; }
    getRootNode() { return root(this); }
    appendChild(value) {
      const old = state(value).parent;
      if (old) old.children.splice(old.children.indexOf(value), 1);
      this.children.push(value); state(value).parent = this;
      const owner = state(this).document ? this : state(this).owner;
      const adopt = node => { state(node).owner = owner; for (const child of node.children) adopt(child); };
      adopt(value); return value;
    }
    removeChild(value) {
      this.children.splice(this.children.indexOf(value), 1); state(value).parent = null; return value;
    }
  }
  const elements = new WeakSet();
  const elementState = value => {
    if (!elements.has(value)) throw new TypeError('Synthetic Element receiver'); return state(value);
  };
  class Element extends Node {
    constructor(tag) { super(tag.toLowerCase()); elements.add(this); this.tagName = tag; }
    get namespaceURI() { return elementState(this).namespace ?? 'http://www.w3.org/1999/xhtml'; }
    get localName() { return elementState(this).tag; }
    matches(selector) {
      elementState(this);
      if (selector !== ':disabled') throw new Error('Unexpected synthetic selector');
      for (let node = this; node; node = state(node).parent) if (state(node).disabled) return true;
      return false;
    }
    closest(selector) {
      elementState(this);
      if (selector !== '[inert]') throw new Error('Unexpected synthetic selector');
      for (let node = this; node; node = state(node).parent) if (state(node).inert) return node;
      return null;
    }
    checkVisibility(options) {
      elementState(this);
      if (Object.keys(options).length !== 3 || options.opacityProperty !== true
        || options.visibilityProperty !== true || options.contentVisibilityAuto !== true) throw new Error('Visibility options');
      for (let node = this; node; node = state(node).parent) if (!state(node).visible) return false;
      return true;
    }
    setAttribute() {}
  }
  const inputs = new WeakSet(), valueState = new WeakMap();
  const inputValue = receiver => {
    if (!inputs.has(receiver)) throw new TypeError('Synthetic Input value receiver');
    return valueState.get(receiver);
  };
  class Input extends Element {
    constructor() {
      super('input'); inputs.add(this);
      valueState.set(this, { value: '', gets: 0, sets: 0, trace: [], getHook: undefined, setHook: undefined });
    }
    get type() { if (!inputs.has(this)) throw new TypeError('Synthetic Input receiver'); return state(this).type; }
    get readOnly() { if (!inputs.has(this)) throw new TypeError('Synthetic Input receiver'); return state(this).readOnly; }
    get value() {
      const data = inputValue(this); data.gets++; data.trace.push(['get', this]);
      data.getHook?.(this);
      if (Object.hasOwn(data, 'getFailure')) throw data.getFailure;
      return data.value;
    }
    set value(value) {
      const data = inputValue(this); data.sets++; data.trace.push(['set', this, value]);
      data.setHook?.(this, value);
      if (Object.hasOwn(data, 'setFailure')) throw data.setFailure;
      data.value = value;
      data.afterSetHook?.(this, value);
    }
  }
  const documents = new WeakSet();
  class Document extends Node {
    constructor() { super('#document', true); documents.add(this); }
    get activeElement() { if (!documents.has(this)) throw new TypeError('Synthetic Document receiver'); return state(this).active; }
  }
  const nativeType = Object.getOwnPropertyDescriptor(Event.prototype, 'type').get;
  const nativeTarget = Object.getOwnPropertyDescriptor(Event.prototype, 'target').get;
  const nativePrevented = Object.getOwnPropertyDescriptor(Event.prototype, 'defaultPrevented').get;
  class FenceEvent extends Event {
    constructor(type, properties = {}) {
      super(type, { cancelable: properties.cancelable ?? true });
      eventData.set(this, { type, target: properties.target ?? null, prevented: false, stopped: false,
        trace: [], ...properties });
      for (const name of ['clientX', 'clientY', 'deltaY']) if (name in properties) this[name] = properties[name];
    }
    get type() {
      if (eventData.get(this)?.getterFailure?.name === 'type') throw eventData.get(this).getterFailure.value;
      return eventData.has(this) ? eventData.get(this).type : Reflect.apply(nativeType, this, []);
    }
    get target() {
      if (eventData.get(this)?.getterFailure?.name === 'target') throw eventData.get(this).getterFailure.value;
      return eventData.has(this) ? eventData.get(this).target : Reflect.apply(nativeTarget, this, []);
    }
    get defaultPrevented() {
      if (eventData.get(this)?.getterFailure?.name === 'defaultPrevented') throw eventData.get(this).getterFailure.value;
      return eventData.has(this) ? eventData.get(this).prevented : Reflect.apply(nativePrevented, this, []);
    }
    preventDefault() {
      if (!eventData.has(this)) return Reflect.apply(Event.prototype.preventDefault, this, []);
      const data = eventData.get(this); data.trace.push('prevent');
      if (Object.hasOwn(data, 'preventFailure')) throw data.preventFailure;
      if (this.cancelable) data.prevented = true;
    }
    stopImmediatePropagation() {
      if (!eventData.has(this)) return Reflect.apply(Event.prototype.stopImmediatePropagation, this, []);
      const data = eventData.get(this); data.trace.push('stop');
      if (Object.hasOwn(data, 'stopFailure')) throw data.stopFailure;
      data.stopped = true;
    }
  }
  const eventBrands = new Map();
  function eventGetter(owner, name, fallback) {
    Object.defineProperty(owner.prototype, name, { configurable: true, get() {
      if (!eventBrands.get(owner).has(this)) throw new TypeError('Synthetic event receiver');
      const data = eventData.get(this);
      if (data.getterFailure?.name === name) throw data.getterFailure.value;
      return data[name] ?? fallback;
    } });
  }
  class Keyboard extends FenceEvent {
    constructor(...args) { super(...args); eventBrands.get(Keyboard).add(this); }
    getModifierState(name) {
      if (!eventBrands.get(Keyboard).has(this) || name !== 'AltGraph') throw new TypeError('Synthetic Keyboard receiver');
      return eventData.get(this).altGraph ?? false;
    }
  }
  eventBrands.set(Keyboard, new WeakSet());
  for (const name of ['key', 'code']) eventGetter(Keyboard, name, '');
  for (const name of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing']) eventGetter(Keyboard, name, false);
  class InputEvent extends FenceEvent { constructor(...args) { super(...args); eventBrands.get(InputEvent).add(this); } }
  eventBrands.set(InputEvent, new WeakSet());
  eventGetter(InputEvent, 'inputType', '');
  class Mouse extends FenceEvent { constructor(...args) { super(...args); eventBrands.get(Mouse).add(this); } }
  eventBrands.set(Mouse, new WeakSet());
  for (const name of ['button', 'buttons']) eventGetter(Mouse, name, 0);
  class Pointer extends Mouse { constructor(...args) { super(...args); eventBrands.get(Pointer).add(this); } }
  eventBrands.set(Pointer, new WeakSet());
  eventGetter(Pointer, 'pointerId', 1); eventGetter(Pointer, 'pointerType', 'mouse'); eventGetter(Pointer, 'isPrimary', true);
  return { Node, Element, Input, Document, FenceEvent, Keyboard, InputEvent, Mouse, Pointer, state, eventData, inputValue };
}

export function attachGateTestRealm(dom, realm, document, actualRealm) {
  Object.assign(realm, { Node: dom.Node, Element: dom.Element, HTMLInputElement: dom.Input, Document: dom.Document,
    Event: dom.FenceEvent, KeyboardEvent: dom.Keyboard, InputEvent: dom.InputEvent,
    MouseEvent: dom.Mouse, PointerEvent: dom.Pointer });
  const location = realm.location;
  let href = location.href;
  Object.defineProperty(location, 'href', { configurable: true, get() {
    if (this !== location) throw new TypeError('Synthetic Location receiver'); return href;
  }, set(value) { href = value; } });
  for (const name of ['document', 'top', 'location']) {
    let value = name === 'top' ? actualRealm : realm[name];
    Object.defineProperty(realm, name, { configurable: true, get() {
      if (this !== actualRealm && this !== realm) throw new TypeError('Synthetic Window receiver'); return value;
    }, set(next) { value = next; } });
  }
  const listeners = [], documentListeners = [], originals = [];
  const add = realm.addEventListener;
  realm.addEventListener = (type, handler, options) => { listeners.push({ type, handler, options }); add(type, handler, options); };
  const docAdd = document.addEventListener.bind(document);
  document.addEventListener = (type, handler, options) => { documentListeners.push({ type, handler, options }); docAdd(type, handler, options); };
  function make(type, properties = {}) {
    const Constructor = /^key/.test(type) ? dom.Keyboard : type === 'beforeinput' || type === 'input' ? dom.InputEvent
      : /^pointer/.test(type) ? dom.Pointer : /^(mouse|click|dblclick)/.test(type) ? dom.Mouse : dom.FenceEvent;
    return new Constructor(type, properties);
  }
  function deliver(event) {
    const data = dom.eventData.get(event), type = data.type;
    // A non-bubbling Document selectionchange still has a Window capture ancestor.
    const phases = type === 'selectionchange'
      ? [['window-capture', listeners], ['document-capture', documentListeners]]
      : [['window-capture', listeners]];
    for (const [phase, path] of phases) {
      data.trace.push(phase);
      for (const entry of path.filter(entry => entry.type === type)) {
        entry.handler(event); if (data.stopped) break;
      }
      if (data.stopped) break;
    }
    if (!data.stopped) for (const phase of ['document-capture-original', 'target-inline', 'target-listener', 'bubble']) {
      data.trace.push(phase);
      for (const handler of originals) handler(phase, event);
    }
    return event;
  }
  return { ...dom, listeners, documentListeners, make, deliver, originals,
    dispatch: (type, properties) => deliver(make(type, properties)) };
}
