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
  try {
    if (realm.document.readyState !== 'loading' || ownValue(realm, 'oef') !== undefined || ownValue(realm, 'ws')) {
      throw new Error('Document-start ownership missed');
    }
    for (const name of ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask']) native[name] = bind(name);
    native.now = realm.performance.now.bind(realm.performance);
    native.random = realm.Math.random.bind(realm.Math);
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
    const sink = event => {
      if (event.type === 'click' && event.target?.id === 'slither-client-reload') {
        event.preventDefault(); event.stopImmediatePropagation();
        realm.sessionStorage.removeItem(key); realm.location.reload(); return;
      }
      if (!claimed || !input) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      try { input(event); }
      finally { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const inputTypes = ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove',
      'touchstart', 'touchend', 'touchmove', 'keydown', 'keyup', 'click', 'wheel', 'resize'];
    for (const type of inputTypes) realm.addEventListener(type, sink, { capture: true, passive: false });
    realm.document.addEventListener('DOMContentLoaded', () => { completed = true; completedAt = revision; }, { once: true });
    realm.addEventListener('message', event => {
      if (event.source !== realm || event.origin !== url.origin || event.data?.type !== 'slither-client-query'
        || Object.keys(event.data).length !== 2 || event.data.schema !== 1) return;
      status(phase);
    });
    Object.defineProperty(realm, slot, { value: Object.freeze({
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
            input = handler;
          },
          // Ordinary reload is the only recovery; never replay the held host callbacks.
          ordinaryReload() { realm.sessionStorage.removeItem(key); realm.location.reload(); },
        });
      },
    }) });
    status('held');
  } catch {
    // Keep any installed holds; replaying the original host is not a recovery path.
    Object.defineProperty(realm, slot, { value: Object.freeze({
      metadata: () => Object.freeze({ schema: 1, id: arm.id, code: 'gate-unavailable' }),
    }) });
    status('gate-unavailable');
  }
})();
