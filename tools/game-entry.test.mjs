// Actual authored ESM graphs; generated Wasm exports and native hosts are labelled doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('local setup failures are visible and retain their original rejection', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ armed: false });
    const entry = await graph.load('bootstrap.mjs');
    const primary = Error('Local configuration fetch failed');
    for (const fetch of [async () => { throw primary; },
      async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ simulatorUrl: null }) })]) {
      const status = { textContent: 'Loading local client…' };
      const realm = { location: { href: 'http://127.0.0.1:18884/' }, fetch,
        document: { getElementById: () => status } };
      await assert.rejects(entry.startGamePage({ realm }), /configuration|simulator-port/);
      assert.notEqual(status.textContent, 'Loading local client…');
    }
    const realm = { location: { href: 'http://127.0.0.1:18884/' },
      fetch: async () => { throw primary; }, document: { getElementById: () => null } };
    await assert.rejects(entry.startGamePage({ realm }), error => error === primary);
    assert.equal(graph.counts.initialize, 0);
  });
});

test('actual default graph mounts HUD, Play and leaderboard with one claim, scene and RAF', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    let release;
    const projector = { created: 0, freed: 0 };
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true,
      leaderboardNative: true, minimapNative: true, initialize: () => new Promise(resolve => { release = resolve; }),
      prepareWasm(api, run) {
        api.LeaderboardScoreProjector = run('(counts => class { constructor() { counts.created++; } project() { throw Error("No startup score projection expected"); } free() { counts.freed++; } })')(projector);
      } });
    const hud = graph.hudWasm();
    const entry = await graph.load('bootstrap.mjs');
    assert.notEqual(graph.f.gate.metadata().code, 'held'); assert.equal(graph.counts.initialize, 1);
    assert.equal(graph.wasm.calls.includes('scene'), false);
    await assert.rejects(entry.startGamePage(), /Armed document-start gate/);
    assert.notEqual(graph.f.gate.metadata().code, 'held');
    release(); const runtime = await entry.gamePageRuntime;
    assert.deepEqual(Object.keys(runtime).sort(), ['diagnostics', 'play', 'playWithLiveProfile', 'bindNicknameField', 'bindHudReadout', 'dispose'].sort());
    assert.equal(graph.wasm.calls.filter(value => value === 'scene').length, 1);
    assert.equal(graph.wasm.calls.filter(value => value === 'enable-nicknames').length, 1);
    assert.ok(graph.wasm.calls.indexOf('enable-nicknames') > graph.wasm.calls.indexOf('scene'));
    assert.equal(graph.wasm.calls.includes('packet'), false, 'nickname selection precedes ingress');
    assert.equal(graph.wasm.calls.filter(value => value === 'quality').length, 1);
    assert.equal(graph.f.raf.size, 1); assert.equal(graph.f.intervals.size, 0);
    assert.equal(graph.f.sockets, 0); assert.equal(graph.f.original, 0);
    assert.equal(hud.tracking, 1); assert.equal(hud.scoreReads, 0); assert.equal(projector.created, 1);
    const root = graph.f.document.getElementById('slither-client-root');
    assert.equal(root.children.length, 9, 'existing scene nodes plus HUD, Play, leaderboard, minimap, end-screen and announcement mounts');
    const [hudMount, playMount, leaderboardMount, minimapMount, endScreenMount, announcementMount] = root.children.slice(3);
    assert.equal(hudMount.children.length, 2); assert.equal(playMount.children.length, 4);
    assert.equal(graph.f.document.getElementById('slither-client-reload').hidden, true);
    assert.equal(graph.f.edit.hud.style(playMount.children[0].style).get('display'), 'none');
    assert.equal(graph.f.edit.hud.style(playMount.children[1].style).get('display'), 'block');
    assert.equal(graph.f.edit.hud.style(playMount.children[2].style).get('display'), 'block');
    assert.equal(leaderboardMount.children.length, 4);
    assert.equal(minimapMount.children.length, 5);
    assert.equal(endScreenMount.children.length, 3);
    assert.equal(announcementMount.children.length, 3);
    assert.equal(graph.minimap.enabled, 1); assert.equal(graph.minimap.reads.length, 1);
    assert.equal(graph.f.edit.ownedPlay.buttonState(playMount.children[2]).disabled, true);
    assert.equal(graph.f.edit.hud.character(playMount.children[3].children[0]).data, 'Play unavailable on this page.');
    const repeated = await graph.load('bootstrap.mjs');
    assert.equal(repeated.gamePageRuntime, entry.gamePageRuntime);
    assert.equal(await repeated.gamePageRuntime, runtime); assert.notEqual(graph.f.gate.metadata().code, 'held');
    runtime.dispose(); runtime.dispose(); assert.equal(graph.f.raf.size, 0);
    assert.equal(root.children.length, 3); assert.equal(projector.freed, 1);
    assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
  });
});

test('legacy native fixture retains eleven renderer operations without opting into construction', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true });
    const native = graph.f.gate.claim(graph.f.gate.metadata().id);
    assert.equal(Object.hasOwn(native, 'ownedHudDom'), false);
    assert.equal(Object.keys(native.hudDom.dom).length, 11);
    assert.equal(graph.counts.initialize, 0); assert.equal(graph.f.raf.size, 0);
  });
});

test('factory graph evaluation is inert in armed and unarmed realms', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const armed of [false, true]) {
      const graph = createGraph({ armed, hudNative: true, ownedHudNative: true });
      const before = graph.f.edit.hud.trace.length, messages = graph.f.messages.length;
      const code = graph.f.gate?.metadata().code;
      Object.defineProperty(graph.f.realm, 'document', { configurable: true, get() { assert.fail('Factory import read document'); } });
      const factory = await graph.load('runtime.mjs');
      assert.equal(typeof factory.startGamePage, 'function');
      assert.equal(graph.f.edit.hud.trace.length, before); assert.equal(graph.f.messages.length, messages);
      assert.equal(graph.f.gate?.metadata().code, code); assert.equal(graph.counts.initialize, 0);
      assert.equal(graph.wasm.calls.length, 0); assert.equal(graph.f.raf.size, 0);
      assert.equal(graph.f.sockets, 0);
      const source = graph.sources.get('https://authored-package.invalid/game/runtime.mjs');
      assert.doesNotMatch(source, /from ['"].*(?:pkg\/|bootstrap)/);
    }
  });
});

test('factory validates explicit dependencies and primitive options before any gate observation', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ armed: false });
    const { startGamePage } = await graph.load('runtime.mjs');
    let observed = 0;
    const realm = new Proxy({}, { get() { observed++; throw new Error('Unexpected realm observation'); } });
    const valid = { realm, initialize() {}, wasmApi: {} };
    for (const request of [{}, { initialize: undefined }, { initialize: null }, { initialize: {} }, { wasmApi: undefined }, { wasmApi: null },
      { wasmApi: () => {} }, { wasmApi: 0 }, { hudReadout: undefined, ownedHudUi: true },
      { hudReadout: false, ownedHudUi: true }, { hudReadout: {} }, { hudReadout: 1 },
      { ownedHudUi: null }, { ownedHudUi: 0 }, { ownedHudUi: {} },
      { diagnosticUi: null }, { diagnosticUi: 0 }, { diagnosticUi: {} }]) {
      const options = { ...valid, ...request };
      if (Object.keys(request).length === 0) delete options.initialize;
      await assert.rejects(startGamePage(options), /Explicit/);
    }
    assert.equal(observed, 0); assert.equal(graph.counts.initialize, 0);
  });
});

test('unarmed default entry exports undefined and keeps initialization quiet', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ armed: false });
    const entry = await graph.load('bootstrap.mjs');
    assert.equal(entry.gamePageRuntime, undefined);
    assert.equal((await graph.load('bootstrap.mjs')).gamePageRuntime, undefined);
    assert.equal(graph.counts.initialize, 0); assert.equal(graph.wasm.calls.length, 0);
    assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
  });
});

test('default wrapper honors explicit dependencies and always selects all owned UI options', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ armed: false, hudNative: true, ownedHudNative: true,
      ownedPlayNative: true, leaderboardNative: true, minimapNative: true });
    const entry = await graph.load('bootstrap.mjs'); graph.arm();
    const hud = graph.hudWasm(); let initialized = 0, projectors = 0;
    graph.wasm.api.LeaderboardScoreProjector = graph.run('(created => class { constructor() { created(); } project() { throw Error("Unexpected projection"); } free() {} })')(() => { projectors++; });
    const runtime = await entry.startGamePage({ realm: graph.f.realm, initialize() { initialized++; },
      wasmApi: graph.wasm.api, hudReadout: false, ownedHudUi: false, ownedPlayUi: false, ownedLeaderboardUi: false, diagnosticUi: true });
    assert.equal(initialized, 1); assert.equal(graph.counts.initialize, 0);
    assert.equal(hud.tracking, 1); assert.equal(projectors, 1);
    assert.equal(typeof runtime.bindHudReadout, 'function');
    assert.equal(graph.f.document.getElementById('slither-client-root').children.length, 9);
    assert.equal(graph.f.document.getElementById('slither-client-reload').hidden, true);
    assert.equal(graph.f.raf.size, 1); assert.equal(graph.f.sockets, 0); runtime.dispose();
  });
});

test('HUD factory option builds one owned tree and binds pending histories', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true }), hud = graph.hudWasm();
    const beforeTrace = graph.f.edit.hud.trace.length;
    const factory = await graph.load('runtime.mjs');
    const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true });
    assert.equal(graph.counts.initialize, 0); assert.equal(hud.tracking, 1); assert.equal(hud.scoreReads, 0);
    assert.deepEqual(Object.keys(runtime).sort(), ['diagnostics','play','playWithLiveProfile','bindNicknameField','bindHudReadout','dispose'].sort());
    const native = graph.f.edit.hud, trace = native.trace.slice(beforeTrace);
    const elements = trace.filter(([name]) => name === 'createElement');
    const texts = trace.filter(([name]) => name === 'createTextNode');
    assert.equal(elements.length, 13); assert.equal(texts.length, 8);
    assert.equal(trace.filter(([name]) => name === 'appendChild').length, 25, '21 owned edges plus four existing bootstrap edges');
    assert.equal(trace.filter(([name]) => name === 'setText').length, 0, 'missing histories remain blank');
    const root = graph.f.document.getElementById('slither-client-root');
    const mount = root.children.at(-1); assert.equal(mount.localName, 'div');
    assert.equal(mount.children.length, 2); assert.equal(root.children.length, 4);
    const count = native.trace.length;
    assert.equal((await graph.load('runtime.mjs')).startGamePage, factory.startGamePage);
    assert.equal(native.trace.length, count); assert.equal(graph.counts.initialize, 0);
    assert.throws(() => runtime.bindHudReadout({}), /already bound/);
    await assert.rejects(factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true }), /Armed document-start gate/);
    assert.equal(graph.counts.initialize, 0); assert.equal(graph.f.raf.size, 1);
    assert.equal(graph.f.sockets, 0); assert.equal(graph.f.original, 0);
    runtime.dispose(); runtime.dispose();
    assert.equal(root.children.length, 3); assert.equal(native.trace.filter(([name]) => name === 'removeChild').length, 1);
    assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
  });
});

test('HUD factory refuses each missing construction operation before initialization', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const [owner, name] of [['Document','createElement'],['Document','createTextNode'],['Node','appendChild'],['Node','removeChild']]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, prepare(dom) {
        // Keep the authored fixture usable, while the exact capture owner lacks its own descriptor.
        const target = dom[owner].prototype, method = Object.getOwnPropertyDescriptor(target, name).value;
        delete target[name]; Object.setPrototypeOf(target, Object.assign(Object.create(Object.getPrototypeOf(target)), { [name]: method }));
      } });
      graph.hudWasm();
      const factory = await graph.load('runtime.mjs');
      const pending = factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true });
      await assert.rejects(pending, /HUD owner record|required/);
      assert.equal(graph.counts.initialize, 0); assert.equal(graph.wasm.calls.length, 0);
      assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
    }
  });
});

test('semantic-only factory works without construction while owned HUD fails without renderer capture', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const semantic = createGraph({ hudNative: true });
    const hud = semantic.hudWasm(), factory = await semantic.load('runtime.mjs');
    const runtime = await factory.startGamePage({ initialize() {}, wasmApi: semantic.wasm.api, hudReadout: true });
    assert.equal(hud.tracking, 1); assert.equal(hud.scoreReads, 0);
    assert.equal(typeof runtime.bindHudReadout, 'function');
    assert.equal(semantic.f.document.getElementById('slither-client-root').children.length, 3);
    runtime.dispose();
    const visible = createGraph({ ownedHudNative: true });
    const factoryVisible = await visible.load('runtime.mjs');
    await assert.rejects(factoryVisible.startGamePage({ initialize() {}, wasmApi: visible.wasm.api, hudReadout: true, ownedHudUi: true }), /Closed HUD owner record/);
    assert.equal(visible.counts.initialize, 0); assert.equal(visible.wasm.calls.length, 0);
  });
});

test('visible construction adds no scene score/control/draw or scheduling observations to semantic startup', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const observations = [];
    for (const ownedHudUi of [false, true]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true });
      const hud = graph.hudWasm(), factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi });
      observations.push({calls:graph.wasm.calls,scoreReads:hud.scoreReads,controlReads:graph.wasm.controlReads(),
        frames:graph.f.raf.size,timers:graph.f.timers.size,intervals:graph.f.intervals.size,
        sockets:graph.f.sockets,draws:runtime.diagnostics().draws,captureHeld:runtime.diagnostics().captureHeld});
      runtime.dispose();
    }
    assert.deepEqual(observations[1], observations[0]);
  });
});

test('visible factory validates complete frozen own-data groups and exact document before initialize', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const change of ['missing', 'schema', 'document', 'extra', 'inherited', 'accessor', 'unfrozen', 'unfrozen-dom',
      'createElement', 'createTextNode', 'appendChild', 'removeChild', 'missing-renderer']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
      let getter = 0;
      const realm = graph.nativeBoundary(native => {
        const original = native.ownedHudDom;
        let group = Object.assign(Object.create(null), original);
        if (change === 'missing') group = undefined;
        if (change === 'schema') group.schema = 2;
        if (change === 'document') group.document = {};
        if (change === 'extra') group.extra = true;
        if (change === 'inherited') group = Object.create(group);
        if (change === 'accessor') Object.defineProperty(group, 'document', { get() { getter++; return original.document; } });
        if (change === 'unfrozen-dom') group.dom = Object.assign(Object.create(null), original.dom);
        if (['createElement','createTextNode','appendChild','removeChild'].includes(change)) {
          group.dom = Object.assign(Object.create(null), original.dom, { [change]: undefined }); Object.freeze(group.dom);
        }
        if (group && change !== 'unfrozen') Object.freeze(group);
        return Object.freeze({ ...native, ownedHudDom: group, ...(change === 'missing-renderer' ? { hudDom: undefined } : {}) });
      });
      const { startGamePage } = await graph.load('runtime.mjs');
      await assert.rejects(startGamePage({ realm, initialize() { assert.fail('Initialize before validation'); },
        wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true }), /HUD owner|HUD DOM|required/);
      assert.equal(getter, 0); assert.equal(graph.wasm.calls.length, 0); assert.equal(graph.f.raf.size, 0);
      assert.equal(graph.f.edit.hud.trace.filter(([name]) => name === 'createElement').length, 0);
    }
  });
});

test('visible factory rejects asynchronous or generator native substitutes before initialization', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const source of ['(async function () {})','(function* () {})','(async function* () {})',
      '(async function () {}).bind(null)']) for (const role of ['constructor','renderer','freshness']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true });
      const callback = graph.run(source);
      const realm = graph.nativeBoundary(native => {
        const owned = Object.assign(Object.create(null), native.ownedHudDom);
        const hud = Object.assign(Object.create(null), native.hudDom);
        if (role === 'constructor') owned.dom = Object.freeze(Object.assign(Object.create(null), owned.dom, { createElement: callback }));
        if (role === 'renderer') hud.dom = Object.freeze(Object.assign(Object.create(null), hud.dom, { setText: callback }));
        if (role === 'freshness') hud.isCurrentDocument = callback;
        return Object.freeze({ ...native, ownedHudDom: Object.freeze(owned), hudDom: Object.freeze(hud) });
      });
      const factory = await graph.load('runtime.mjs');
      await assert.rejects(factory.startGamePage({ realm, initialize() { assert.fail('Initialize before synchronous validation'); },
        wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true }), /HUD DOM group/);
      assert.equal(graph.wasm.calls.length, 0); assert.equal(graph.f.raf.size, 0);
    }
  });
});

test('actual HUD factory graph publishes genuine current and final history after native/source release', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true }), hud = graph.hudWasm();
    const factory = await graph.load('runtime.mjs');
    const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true });
    const native = graph.f.edit.hud, root = graph.f.document.getElementById('slither-client-root'), mount = root.children.at(-1);
    const [readout, final] = mount.children, currentText = readout.children[0].children[1].children[0];
    const rankText = readout.children[1].children[1].children[0], populationText = readout.children[1].children[3].children[0];
    const finalText = final.children[1].children[0];
    for (const node of [currentText,rankText,populationText,finalText]) assert.equal(native.character(node).data, '');
    const writes = [];
    native.controls.set('setText', { hook(node, value) {
      assert.equal(runtime.diagnostics().captureHeld, false); writes.push([node,value]);
    } });
    runtime.play(graph.run(`({endpoint:'ws://192.0.2.1:1234/slither',
      profile:{clientVersion:1,password:new Uint8Array(20),protocolVersion:19},
      nickname:'Synthetic',skin:24,customSkin:new Uint8Array()})`));
    graph.f.frame(); graph.f.socket.open(); graph.message([54,1]);
    graph.message([97,...new Array(24).fill(0)]); graph.f.flush();
    graph.message([108,7,23]); graph.f.flush(); graph.f.frame();
    assert.equal(native.character(currentText).data, '0');
    assert.equal(native.character(rankText).data, '7'); assert.equal(native.character(populationText).data, '23');
    assert.equal(native.character(finalText).data, ''); assert(hud.scoreReads > 0);
    graph.message([118,1]); graph.f.flush(); graph.f.frame();
    assert.equal(native.character(finalText).data, '0'); assert(writes.some(([node]) => node === finalText));
    const before = native.trace.length;
    graph.f.realm.location.href = 'https://slither.io/#synthetic-stale'; graph.f.frame();
    assert.equal(native.trace.length, before, 'stale freshness adds no DOM observation/effect');
    runtime.dispose(); assert.equal(native.trace.length, before, 'stale disposal does not observe/remove nodes');
    assert.equal(root.children.at(-1), mount, 'stale mount may remain by selected policy');
    assert.equal(graph.f.original, 0);
  });
});

test('construction failures preserve each exact primary and cleanup after partial attachment', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const primaries = [undefined,null,false,0,'',Symbol('synthetic primary'),new Error('synthetic primary')];
    for (const operation of ['createElement','createTextNode','appendChild','setStyle']) for (const primary of primaries) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
      const native = graph.f.edit.hud;
      native.controls.set(operation, operation === 'appendChild' ? {
        afterHook(receiver, child) { if (receiver.id === 'slither-client-root' && child.localName === 'div') throw primary; },
      } : { failure: primary });
      const factory = await graph.load('runtime.mjs');
      const pending = factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true });
      let thrown = false, actual;
      try { await pending; } catch (error) { thrown = true; actual = error; }
      assert(thrown); assert.equal(actual, primary);
      const root = graph.f.document.getElementById('slither-client-root');
      assert.equal(root.children.length, 3);
      assert.equal(native.trace.filter(([name]) => name === 'removeChild').length, Number(operation === 'appendChild'));
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
      assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
    }
  });
});

test('caught construction callback reentry stays sticky and removal happens after guard unwind', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const operation of ['createElement','createTextNode','setStyle','appendChild']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
      let refusal, removed = 0;
      const reenter = () => { try { graph.f.edit.dispatch('resize'); } catch (error) { refusal = error; } };
      const control = { hook: reenter };
      if (operation === 'appendChild') { control.afterHook = (receiver, child) => {
        if (receiver.id === 'slither-client-root' && child.localName === 'div') reenter();
      }; delete control.hook; }
      graph.f.edit.hud.controls.set(operation, control);
      graph.f.edit.hud.controls.set('removeChild', { hook() {
        removed++; graph.f.edit.dispatch('resize');
        assert.equal(graph.wasm.counts().sceneFrees, 0, 'UI removal precedes native owner free');
      } });
      const factory = await graph.load('runtime.mjs');
      const pending = factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true });
      await assert.rejects(pending, error => error === refusal && /owner operation active/.test(error.message));
      assert.equal(graph.f.document.getElementById('slither-client-root').children.length, 3);
      assert.equal(removed, Number(operation === 'appendChild'));
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.f.raf.size, 0);
    }
  });
});

test('owned removal failure consumes lease once and exhausts remaining owners with falsy first failures', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const primary of [undefined,null,false,0,'',Symbol('remove'),new Error('remove')]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true });
      graph.f.edit.hud.controls.set('removeChild', { afterFailure: primary });
      graph.f.faults.cleanup = () => { throw new Error('secondary native cleanup'); };
      let threw = false, value;
      try { runtime.dispose(); } catch (error) { threw = true; value = error; }
      assert(threw); assert.equal(value, primary); runtime.dispose();
      assert.equal(graph.f.edit.hud.trace.filter(([name]) => name === 'removeChild').length, 1);
      assert.equal(graph.f.document.getElementById('slither-client-root').children.length, 3);
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
      assert.equal(graph.f.raf.size, 0);
    }
  });
});

test('owned startup keeps nickname-first disposal and earlier falsy unregister primaries', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const primary of [undefined,null,false,0,'',Symbol('unregister'),new Error('unregister')]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
      const order = [];
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, registerNicknameEditField(request) {
        const lease = native.registerNicknameEditField(request);
        return Object.freeze({ handleInput: lease.handleInput, unregister() {
          order.push('nickname'); lease.unregister(); throw primary;
        } });
      } }));
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true });
      const parent = graph.f.document.createElement('div'), field = graph.f.document.createElement('input');
      graph.f.document.body.appendChild(parent); parent.appendChild(field);
      graph.f.edit.state(graph.f.document).active = field;
      const request = graph.run('((element,parent) => ({schema:1,element,parent}))')(field,parent);
      const ticket = runtime.bindNicknameField(request), state = graph.f.edit.inputValue(field);
      state.value = '\u00e9';
      graph.f.edit.hud.controls.set('removeChild', { hook() {
        order.push('ui'); assert.deepEqual(order, ['nickname','ui']);
        graph.f.edit.dispatch('input', { target: field }); assert.equal(state.gets, 0);
      }, afterFailure: new Error('secondary removal failure') });
      let threw = false, value;
      try { runtime.dispose(); } catch (error) { threw = true; value = error; }
      assert(threw); assert.equal(value, primary); ticket.unbind(); runtime.dispose();
      assert.deepEqual(order, ['nickname','ui']);
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
    }
  });
});
