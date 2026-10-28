// Installed before Playwright's fake clock. Log every Canvas method/setter in order.
export function installProbe() {
  const now = performance.now.bind(performance);
  const raf = requestAnimationFrame.bind(globalThis);
  const timer = setTimeout.bind(globalThis);
  const clearTimer = clearTimeout.bind(globalThis);
  const ids = new WeakMap(); let next = 0;
  const probe = globalThis.browserProbe = { now, raf, timer, frame: 0, recording: false,
    commands: [], timings: [], observations: [], transitions: [], dropped: 0 };
  function value(x) {
    if (typeof x === 'number') return Number.isFinite(x) ? (Object.is(x, -0) ? '-0' : x) : String(x);
    if (x === null || ['string', 'boolean', 'undefined'].includes(typeof x)) return x ?? null;
    if (Array.isArray(x) || ArrayBuffer.isView(x)) return [...x].map(value);
    if (!ids.has(x)) ids.set(x, ++next);
    return { object: ids.get(x), type: x.constructor?.name ?? 'Object' };
  }
  function record(row) {
    if (!probe.recording) return;
    if (probe.commands.length >= 500000) { probe.dropped++; throw new Error('Canvas log limit'); }
    probe.commands.push([probe.frame, ...row]);
  }
  for (const Type of [CanvasRenderingContext2D, HTMLCanvasElement, CanvasGradient, CanvasPattern]) {
    for (const name of Object.getOwnPropertyNames(Type.prototype)) {
      if (name === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(Type.prototype, name);
      if (!d.configurable) continue;
      if (typeof d.value === 'function') {
        const original = d.value;
        Object.defineProperty(Type.prototype, name, { ...d, value: function (...args) {
          const result = Reflect.apply(original, this, args);
          record(['call', value(this), name, args.map(value), value(result)]);
          return result;
        } });
      } else if (d.set) {
        const original = d.set;
        Object.defineProperty(Type.prototype, name, { ...d, set(x) {
          Reflect.apply(original, this, [x]); record(['set', value(this), name, value(x)]);
        } });
      }
    }
  }
  function observation(reason) {
    return { reason, at: now(), visibility: document.visibilityState, focus: document.hasFocus(),
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      canvas: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })) };
  }
  for (const event of ['visibilitychange', 'focus', 'blur', 'resize']) addEventListener(event, () => probe.transitions.push(observation(event)));
  probe.observe = reason => { const row = observation(reason); probe.observations.push(row); return row; };
  probe.present = () => new Promise((resolve, reject) => {
    const deadline = timer(() => reject(new Error('Native presentation cadence deadline')), 5000);
    raf(() => raf(() => { clearTimer(deadline); resolve(probe.observe('presented')); }));
  });
}
