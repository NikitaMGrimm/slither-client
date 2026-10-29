// TEST ONLY authored inert payload/digest capabilities. No network or external input.
export function profileEnvironment({ fetchResult, current = () => true } = {}) {
  const payload = new Uint8Array(224092).fill(32), allocations = [], timeouts = new Map();
  payload.set(new TextEncoder().encode('var v=17;'), 181647);
  payload.set(new TextEncoder().encode(`var k=[${Array.from({ length: 20 }, (_, i) => i).join(',')}];`), 181670);
  let reads = 0, fetches = 0;
  const capabilities = Object.freeze({
    fetch() { fetches++; return fetchResult ?? Promise.resolve({}); },
    digest() { return Promise.resolve(Uint8Array.from('5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095'.match(/../g), x => Number.parseInt(x, 16))); },
    createAbort: () => Object.freeze({ signal: {}, abort() {} }),
    setTimeout(fn) { timeouts.set(1, fn); return 1; }, clearTimeout(id) { timeouts.delete(id); }, now: () => 0,
    environment: () => Object.freeze({ origin: 'https://slither.io', topLevel: true, secureContext: true }),
    responseInfo: () => Object.freeze({ status: 200, type: 'basic', url: 'https://slither.io/s/game1107249518.js', redirected: false, body: {} }),
    getReader: () => ({}),
    read: () => Promise.resolve(++reads === 1 ? { done: false, value: payload.slice() } : { done: true, value: undefined }),
    cancelReader: () => Promise.resolve(), releaseReader() {},
    bytes: Object.freeze({
      allocate(n) { const bytes = new Uint8Array(n); allocations.push(bytes); return bytes; },
      length: bytes => bytes.length, copy: (target, bytes, offset) => target.set(bytes, offset), clear: bytes => bytes.fill(0),
    }),
  });
  return { liveProfile: { capabilities, isCurrentDocument: current }, allocations, get fetches() { return fetches; } };
}
