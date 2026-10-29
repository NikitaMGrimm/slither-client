// Actual isolated link, worker broker, private gate, bootstrap, receiver and runtime modules
// in one MAIN realm. Native DOM/IPC/stream/digest/parser/Wasm boundaries are labelled doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

// Shared scenario prologue. Each scenario is serialized into its own module-test worker,
// so the generated function closes over nothing.
const graphOptions = `({ href: 'http://slither.com/io', profileBroker: true, deferPrivateGate: true, hudNative: true,
  ownedHudNative: true, ownedPlayNative: true, leaderboardNative: true, minimapNative: true,
  prepareWasm(api, run) { api.LeaderboardScoreProjector = run('(class {project(){throw Error("No startup leaderboard projection expected");} free(){}})'); } })`;
const scenario = body => new Function(`return async ({ assert, createGraph }) => {
  const g = createGraph(${graphOptions}); g.hudWasm();
  const profile = g.profileNative();
  const capabilities = { ...profile.capabilities, environment: () => ({ origin: 'chrome-extension://' + 'a'.repeat(32), topLevel: false, secureContext: true }) };
  const key = Array.from({ length: 16 }, (_, i) => i + 31);
  const message = type => ({ type, schema: 1, activationId: 'a'.repeat(32), authority: [...key] });
  const play = () => {
    let mount;
    for (const child of g.f.document.getElementById('slither-client-root').children)
      if (child.children?.length >= 4 && child.children[0].children?.[1]?.localName === 'input') mount = child;
    assert(mount, 'owned Play controls mounted');
    g.f.edit.inputValue(mount.children[0].children[1]).value = 'ws://192.0.2.1:1234/slither';
    g.f.edit.inputValue(mount.children[1].children[1]).value = 'Synthetic';
    g.f.edit.dispatch('click', { target: mount.children[2], button: 0, trusted: true }); g.f.flush();
    assert(g.f.messages.some(value => value.type === 'slither-client-profile-wake'), 'owned Play emits the public wake');
  };
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); g.f.flush(); };
  ${body}
}`)();

test('transient page helpers installed after the classic gate never receive the private key', async () => {
  await runGameModuleTest(scenario(`
    // Page code after the classic document-start gate returned, before the private injection.
    // Each wrapper copies any key-bearing argument, restores every native and delegates.
    const page = g.run(\`(key => {
      const exposures = [], instances = [], restore = [];
      const apply = Reflect.apply, define = Object.defineProperty, describe = Object.getOwnPropertyDescriptor;
      const keyed = value => { try {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function') || value.length !== 16) return false;
        for (let i = 0; i < 16; i++) if (value[i] !== key[i]) return false;
        return true;
      } catch { return false; } };
      const observe = (self, args) => { for (const value of [self, ...args]) if (keyed(value)) {
        const copy = []; for (let i = 0; i < 16; i++) copy.push(value[i]);
        exposures.push(copy); for (const undo of restore.splice(0)) undo();
      } };
      for (const [owner, name] of [[Array, 'isArray'], [Number, 'isInteger'], [Object, 'getOwnPropertyDescriptor'],
        [Object, 'hasOwn'], [Object, 'freeze'], [Object, 'defineProperty'], [Reflect, 'apply']]) {
        const was = describe(owner, name), native = was.value;
        define(owner, name, { ...was, value: function (...args) { observe(this, args); return apply(native, this, args); } });
        restore.push(() => define(owner, name, was));
      }
      const bytes = describe(globalThis, 'Uint8Array');
      define(globalThis, 'Uint8Array', { ...bytes, value: new Proxy(bytes.value, {
        construct(target, args) { const made = new target(...args); instances.push(made); return made; } }) });
      restore.push(() => define(globalThis, 'Uint8Array', bytes));
      return { exposures, keyedStorage: () => instances.filter(keyed).length };
    })(\${JSON.stringify(key)})\`);
    const stored = [];
    const { broker, trace, sender } = g.privateBroker({ capabilities, afterStage(stage) { stored.push([stage, page.keyedStorage()]); } });
    assert.equal(await broker(message('slither-client-profile-bootstrap'), sender), true, 'genuine private construction completes');
    assert.equal(JSON.stringify(page.exposures), '[]', 'no page helper observed the private key');
    assert.deepEqual(stored, [['gate', 0], ['bootstrap', 0]], 'no page-constructed storage holds the key');
    const receiver = await g.load('profile-receiver.mjs'); // The page imports the same actual module.
    play();
    // The page reacts to the public wake first, with any copied key and with its own choice.
    for (const stolen of [...page.exposures, Array(16).fill(7)]) {
      assert.equal(receiver.claimPendingProfileBroker(stolen).accepted, false);
      assert.equal(receiver.deliverPendingProfileBroker('deliver', stolen, 17, 19, Array(20).fill(99)), false);
      assert.equal(receiver.deliverPendingProfileBroker('finish', stolen), false);
    }
    await settle(); g.f.frame(); assert.equal(g.f.sockets, 0, 'page calls neither consume the intent nor release acquiring');
    const work = broker(message('slither-client-profile-wake'), sender); profile.respond();
    assert.equal(await work, true); await settle();
    assert.equal(g.f.sockets, 0); g.f.frame(); assert.equal(g.f.sockets, 1);
    assert.deepEqual(trace, ['gate', 'bootstrap', 'claim', 'deliver', 'finish', 'fail']);
    assert.equal(JSON.stringify(page.exposures), '[]'); profile.assertWiped(); g.f.event('pagehide');
  `));
});

test('a preseeded self-deleting gate accessor is rejected without invocation or key exposure', async () => {
  await runGameModuleTest(scenario(`
    const state = g.run(\`(() => {
      const state = { invoked: 0, exposures: [] }, slot = Symbol.for('slither.client.gate.v1'), isArray = Array.isArray;
      Object.defineProperty(globalThis, slot, { configurable: true, get() {
        state.invoked++; delete globalThis[slot];
        Array.isArray = value => {
          if (value?.length === 16) state.exposures.push(Array.from(value));
          Array.isArray = isArray; return isArray(value);
        };
        return undefined;
      } });
      return state;
    })()\`);
    const { broker, trace, sender } = g.privateBroker({ capabilities });
    assert.equal(await broker(message('slither-client-profile-bootstrap'), sender), false);
    assert.equal(state.invoked, 0, 'the page accessor is never invoked');
    assert.equal(JSON.stringify(state.exposures), '[]'); assert.deepEqual(trace, ['gate']);
    assert.equal(g.counts.initialize, 0); assert.equal(profile.counts.fetch, 0); assert.equal(g.f.sockets, 0);
  `));
});

test('a page-redirected gate lookup before bootstrap never receives the private key', async () => {
  await runGameModuleTest(scenario(`
    let page;
    const { broker, trace, sender } = g.privateBroker({ capabilities, afterStage(stage, result) {
      if (stage !== 'gate' || result !== true) return;
      page = g.run(\`(() => {
        const state = { exposures: [] }, find = Symbol.for, fake = Symbol('page gate');
        Object.defineProperty(globalThis, fake, { value: Object.freeze({
          requiresProfileBootstrap: () => true, verifyExtensionProfile: () => true,
          metadata: () => ({ schema: 1, id: 'a'.repeat(32), code: 'held' }),
          claim(id, authority) { state.exposures.push(Array.from(authority ?? [])); throw Error('page gate'); },
        }) });
        Symbol.for = name => name === 'slither.client.gate.v1' ? fake : find(name);
        return state;
      })()\`);
    } });
    const constructed = await broker(message('slither-client-profile-bootstrap'), sender);
    assert.equal(JSON.stringify(page.exposures), '[]', 'runtime claims only the privately installed gate');
    assert.equal(constructed, true);
    // The runtime's existing current-document check no longer matches the redirected slot,
    // so this document fails closed: no intent, page claim, fetch or socket.
    const receiver = await g.load('profile-receiver.mjs');
    assert.equal(receiver.claimPendingProfileBroker(Array(16).fill(7)).accepted, false);
    assert.equal(await broker(message('slither-client-profile-wake'), sender), false);
    assert.equal(profile.counts.fetch, 0); g.f.frame(); assert.equal(g.f.sockets, 0);
    assert.deepEqual(trace, ['gate', 'bootstrap', 'claim', 'fail']); assert.equal(JSON.stringify(page.exposures), '[]');
  `));
});

test('a page-inherited liveProfile cannot displace the private receiver path', async () => {
  await runGameModuleTest(scenario(`
    let page;
    const { broker, trace, sender } = g.privateBroker({ capabilities, afterStage(stage, result) {
      if (stage !== 'gate' || result !== true) return;
      page = g.run(\`(() => {
        const state = { reads: 0, fetches: 0 };
        const caps = { fetch() { state.fetches++; return new Promise(() => {}); } };
        Object.defineProperty(Object.prototype, 'liveProfile', { configurable: true, get() { state.reads++; return caps; } });
        return state;
      })()\`);
    } });
    assert.equal(await broker(message('slither-client-profile-bootstrap'), sender), true);
    play();
    const work = broker(message('slither-client-profile-wake'), sender); profile.respond();
    assert.equal(await work, true); await settle(); g.f.frame(); assert.equal(g.f.sockets, 1);
    assert.deepEqual(trace, ['gate', 'bootstrap', 'claim', 'deliver', 'finish', 'fail']);
    assert.equal(page.fetches, 0); assert.equal(page.reads, 0);
  `));
});

test('genuine isolated link, worker and private MAIN gate complete one owned Play handoff', async () => {
  await runGameModuleTest(scenario(`
    const { broker, trace, sender } = g.privateBroker({ capabilities });
    const sent = [], work = [];
    const chrome = { runtime: { getManifest: () => ({ background: { service_worker: 'game/profile-worker.mjs' } }),
      getURL: name => 'chrome-extension://' + 'a'.repeat(32) + '/' + name,
      sendMessage(value) {
        // Native runtime messaging serializes at send time; the isolated closure then clears its copy.
        const copy = structuredClone(value); sent.push(copy.type);
        const result = broker(copy, sender); work.push(result); return result;
      } } };
    g.isolatedLink(chrome, { getRandomValues(value) { for (let i = 0; i < value.length; i++) value[i] = 31 + i; return value; } });
    assert.deepEqual(sent, ['slither-client-profile-bootstrap'], 'only the document-start arm starts the private flow');
    assert.equal(await work[0], true); await settle();
    assert(g.f.messages.every(value => !Object.hasOwn(value, 'authority')), 'no public message carries a key');
    play(); profile.respond();
    assert.deepEqual(sent, ['slither-client-profile-bootstrap', 'slither-client-profile-wake']);
    assert.equal(await work[1], true); await settle();
    assert.equal(g.f.sockets, 0); g.f.frame(); assert.equal(g.f.sockets, 1);
    assert.deepEqual(trace, ['gate', 'bootstrap', 'claim', 'deliver', 'finish', 'fail']); profile.assertWiped();
    g.f.event('pagehide'); await settle();
    assert.equal(sent.at(-1), 'slither-client-profile-cancel');
  `));
});

test('a page-forged held status cannot start the isolated private flow', async () => {
  await runGameModuleTest(scenario(`
    g.f.realm.sessionStorage.removeItem('__slitherClientArmV1'); // No arm survived to the isolated document start.
    const sent = [];
    const chrome = { runtime: { getManifest: () => ({ background: { service_worker: 'game/profile-worker.mjs' } }),
      getURL: name => 'chrome-extension://' + 'a'.repeat(32) + '/' + name,
      sendMessage(value) { sent.push(value.type); return Promise.resolve(false); } } };
    g.isolatedLink(chrome, { getRandomValues(value) { return value.fill(37); } });
    g.f.realm.postMessage({ type: 'slither-client-status', schema: 1, id: 'b'.repeat(32), code: 'held' });
    g.f.realm.postMessage({ type: 'slither-client-profile-wake', schema: 1, activationId: 'b'.repeat(32) });
    await settle();
    assert.deepEqual(sent, [], 'no key-bearing request follows a public status');
  `));
});
