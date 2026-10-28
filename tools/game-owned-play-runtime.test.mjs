// Actual authored ESM graph. Native operations and generated Wasm are labelled doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('owned Play requires both HUD options before any realm observation', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ armed: false });
    const { startGamePage } = await graph.load('runtime.mjs');
    let observed = 0;
    const realm = new Proxy({}, { get() { observed++; throw Error('Unexpected realm observation'); } });
    for (const options of [{ ownedPlayUi: true }, { ownedPlayUi: true, hudReadout: true },
      { ownedPlayUi: true, ownedHudUi: true }, { ownedPlayUi: null }, { ownedPlayUi: 1 }, { ownedPlayUi: {} }]) {
      await assert.rejects(startGamePage({ realm, initialize() {}, wasmApi: {}, ...options }), /Explicit owned/);
    }
    assert.equal(observed, 0);
  });
});

test('Play factory option mounts controls with one scene, one RAF and no startup request', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true });
    const hud = graph.hudWasm();
    const factory = await graph.load('runtime.mjs');
    const runtime = await factory.startGamePage({ initialize() { graph.counts.initialize++; }, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
    assert.equal(graph.counts.initialize, 1); assert.equal(hud.tracking, 1); assert.equal(hud.scoreReads, 0);
    assert.deepEqual(Object.keys(runtime).sort(), ['diagnostics','play','playWithLiveProfile','bindNicknameField','bindHudReadout','dispose'].sort());
    assert.equal(graph.f.raf.size, 1); assert.equal(graph.f.intervals.size, 0); assert.equal(graph.f.sockets, 0);
    assert.equal(graph.wasm.calls.filter(x => x === 'scene').length, 1);
    assert.equal((await graph.load('runtime.mjs')).startGamePage, factory.startGamePage);
    await assert.rejects(factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true }), /Armed document-start gate/);
    const root = graph.f.document.getElementById('slither-client-root');
    const hudMount = root.children[3], playMount = root.children[4];
    const all = node => [node, ...node.children.flatMap(all)];
    assert.equal(all(hudMount).length, 21); assert.equal(all(playMount).length, 11);
    assert.equal(graph.f.edit.ownedPlay.buttonState(playMount.children[2]).disabled, true);
    assert.equal(graph.f.edit.hud.character(playMount.children[3].children[0]).data, 'Play unavailable on this page.');
    assert.equal(graph.f.document.getElementById('slither-client-status').textContent, 'SlitherClient: Unavailable');
    assert.equal(graph.f.messages.at(-1).code, 'ready-not-connected');
    runtime.dispose(); runtime.dispose(); assert.equal(root.children.length, 3);
    assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
  });
});

test('Play startup disposed during initialization retains the exact early-disposed key set', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    let release;
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
    const factory = await graph.load('runtime.mjs');
    const pending = factory.startGamePage({ initialize: () => new Promise(resolve => { release = resolve; }),
      wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
    graph.f.event('pagehide'); release();
    const runtime = await pending;
    assert.deepEqual(Object.keys(runtime), ['dispose']); assert.equal(graph.wasm.calls.length, 0);
    assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0); runtime.dispose();
  });
});

test('runtime factory modes without Play never inspect its optional native sibling', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const ownedHudUi of [false, true]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
      let reads = 0;
      const realm = graph.nativeBoundary(native => Object.freeze(Object.defineProperty({ ...native }, 'ownedPlayDom', {
        get() { reads++; throw Error('Unselected group observed'); },
      })));
      const { startGamePage } = await graph.load('runtime.mjs');
      const runtime = await startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi });
      assert.equal(reads, 0); assert.equal(graph.f.raf.size, 1); runtime.dispose();
    }
  });
});

test('complete frozen same-document Play group and raw synchronous callbacks are preflighted before initialize', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const functions = ['inputValue','inputMaxLength','inputAutocompleteOff','buttonType','buttonDisabled','createControlsLease'];
    const mutations = ['missing','schema','document','extra','accessor','inherited','unfrozen','unfrozen-dom', ...functions];
    for (const change of mutations) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true });
      let getters = 0;
      const realm = graph.nativeBoundary(native => {
        const original = native.ownedPlayDom;
        let group = Object.assign(Object.create(null), original);
        if (change === 'missing') group = undefined;
        if (change === 'schema') group.schema = 0;
        if (change === 'document') group.document = {};
        if (change === 'extra') group.extra = true;
        if (change === 'accessor') Object.defineProperty(group, 'document', { get() { getters++; return original.document; } });
        if (change === 'inherited') group = Object.create(group);
        if (change === 'unfrozen-dom') group.dom = Object.assign(Object.create(null), original.dom);
        if (functions.includes(change)) {
          if (change === 'createControlsLease') group.createControlsLease = undefined;
          else group.dom = Object.freeze(Object.assign(Object.create(null), original.dom, { [change]: undefined }));
        }
        if (group && change !== 'unfrozen') Object.freeze(group);
        return Object.freeze({ ...native, ownedPlayDom: group });
      });
      const factory = await graph.load('runtime.mjs');
      await assert.rejects(factory.startGamePage({ realm, initialize() { assert.fail('Initialized before Play preflight'); },
        wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true }));
      assert.equal(getters, 0); assert.equal(graph.wasm.calls.length, 0); assert.equal(graph.f.raf.size, 0);
      assert.equal(graph.f.edit.ownedPlay.trace.length, 0);
    }
    for (const name of functions) for (const source of ['(async function(){})','(function*(){})','(async function*(){})','(async function(){}).bind(null)']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true });
      const callback = graph.run(source);
      const realm = graph.nativeBoundary(native => {
        const group = Object.assign(Object.create(null), native.ownedPlayDom);
        if (name === 'createControlsLease') group[name] = callback;
        else group.dom = Object.freeze(Object.assign(Object.create(null), group.dom, { [name]: callback }));
        return Object.freeze({ ...native, ownedPlayDom: Object.freeze(group) });
      });
      const factory = await graph.load('runtime.mjs');
      await assert.rejects(factory.startGamePage({ realm, initialize() { assert.fail('Async native callback admitted'); },
        wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true }), /owned Play/);
      assert.equal(graph.wasm.calls.length, 0); assert.equal(graph.f.raf.size, 0);
    }
  });
});

test('owned Play rejects every raw foreign asynchronous callback kind before initialize or forwarding', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const roles = [
      ...['inputValue','inputMaxLength','inputAutocompleteOff','buttonType','buttonDisabled'].map(name => ['ownedPlayDom','dom',name]),
      ['ownedPlayDom',null,'createControlsLease'],
      ...['nodeType','ownerDocument','parentNode','firstChild','nextSibling','isConnected','localName','namespaceURI','style','setText','setStyle'].map(name => ['hudDom','dom',name]),
      ['hudDom',null,'isCurrentDocument'],
      ...['createElement','createTextNode','appendChild','removeChild'].map(name => ['ownedHudDom','dom',name]),
    ];
    const foreign = createGraph({ armed: false });
    for (const source of ['(async function(){})','(function*(){})','(async function*(){})',
      '(async function(){}).bind(null)','(function*(){}).bind(null)','(async function*(){}).bind(null)']) {
      for (const [groupName,nested,name] of roles) {
        const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true });
        let calls = 0, initialized = 0;
        const callback = new Proxy(foreign.run(source), { apply() { calls++; assert.fail('Validation invoked raw callback'); } });
        const realm = graph.nativeBoundary(native => {
          const group = Object.assign(Object.create(null), native[groupName]);
          if (nested) group[nested] = Object.freeze(Object.assign(Object.create(null), group[nested], { [name]: callback }));
          else group[name] = callback;
          return Object.freeze({ ...native, [groupName]: Object.freeze(group) });
        });
        const factory = await graph.load('runtime.mjs');
        await assert.rejects(factory.startGamePage({ realm, initialize() { initialized++; throw Error('Unexpected initialize'); },
          wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true }));
        assert.equal(initialized, 0, `${groupName}.${name}: ${source}`);
        assert.equal(calls, 0); assert.equal(graph.wasm.calls.length, 0);
        assert.equal(graph.f.edit.hud.trace.filter(([operation]) => ['createElement','createTextNode'].includes(operation)).length, 0);
        assert.equal(graph.f.edit.ownedPlay.trace.length, 0);
      }
    }
  });
});

test('owned Play admits raw foreign synchronous callbacks without invoking callbacks or tag getters', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const roles = [
      ...['inputValue','inputMaxLength','inputAutocompleteOff','buttonType','buttonDisabled'].map(name => ['ownedPlayDom','dom',name]),
      ['ownedPlayDom',null,'createControlsLease'],
      ...['nodeType','ownerDocument','parentNode','firstChild','nextSibling','isConnected','localName','namespaceURI','style','setText','setStyle'].map(name => ['hudDom','dom',name]),
      ['hudDom',null,'isCurrentDocument'],
      ...['createElement','createTextNode','appendChild','removeChild'].map(name => ['ownedHudDom','dom',name]),
    ];
    const foreign = createGraph({ armed: false });
    for (const source of ['(function(){})','(function(){}).bind(null)', `(() => {
      const callback = function() {}, parent = Object.create(Object.getPrototypeOf(callback));
      Object.defineProperty(parent, Symbol.toStringTag, { get() { throw Error('Tag getter invoked'); } });
      Object.setPrototypeOf(callback, parent); return callback;
    })()`]) for (const [groupName,nested,name] of roles) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true });
      let calls = 0, initialized = 0;
      const primary = { synthetic: 'End admission before native use' };
      const callback = new Proxy(foreign.run(source), { apply() { calls++; assert.fail('Admission invoked callback'); } });
      const realm = graph.nativeBoundary(native => {
        const group = Object.assign(Object.create(null), native[groupName]);
        if (nested) group[nested] = Object.freeze(Object.assign(Object.create(null), group[nested], { [name]: callback }));
        else group[name] = callback;
        return Object.freeze({ ...native, [groupName]: Object.freeze(group) });
      });
      const factory = await graph.load('runtime.mjs');
      await assert.rejects(factory.startGamePage({ realm, initialize() { initialized++; throw primary; },
        wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true }), error => error === primary);
      assert.equal(initialized, 1); assert.equal(calls, 0); assert.equal(graph.wasm.calls.length, 0);
      assert.equal(graph.f.edit.hud.trace.filter(([operation]) => ['createElement','createTextNode'].includes(operation)).length, 0);
      assert.equal(graph.f.edit.ownedPlay.trace.length, 0);
    }
  });
});

test('owned Play raw callback prototype traversal rejects cycles and depth beyond its fixed bound', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const kind of ['cycle','depth']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true });
      let visits = 0, calls = 0, initialized = 0, callback;
      const chain = Array.from({ length: 70 }, () => Object.create(null));
      for (let index = 0; index < chain.length - 1; index++) Object.setPrototypeOf(chain[index], chain[index + 1]);
      callback = new Proxy(function() {}, {
        getPrototypeOf() { visits++; return kind === 'cycle' ? callback : chain[0]; },
        apply() { calls++; assert.fail('Traversal invoked callback'); },
      });
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native,
        ownedPlayDom: Object.freeze(Object.assign(Object.create(null), native.ownedPlayDom, {
          dom: Object.freeze(Object.assign(Object.create(null), native.ownedPlayDom.dom, { buttonDisabled: callback })),
        })),
      }));
      const factory = await graph.load('runtime.mjs');
      await assert.rejects(factory.startGamePage({ realm, initialize() { initialized++; throw Error('Unexpected initialize'); },
        wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true }));
      assert.equal(initialized, 0); assert.equal(calls, 0); assert(visits > 0 && visits <= 64);
    }
  });
});

test('foreign kind correction preserves low-level factory admission without Play', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const foreign = createGraph({ armed: false }), callback = foreign.run('(async function(){}).bind(null)');
    for (const [hudReadout,ownedHudUi] of [[false,false],[true,false],[true,true]]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true });
      let initialized = 0;
      const primary = { synthetic: 'Stop after unchanged legacy admission' };
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native,
        ownedHudDom: Object.freeze(Object.assign(Object.create(null), native.ownedHudDom, {
          dom: Object.freeze(Object.assign(Object.create(null), native.ownedHudDom.dom, { createElement: callback })),
        })),
      }));
      const factory = await graph.load('runtime.mjs');
      await assert.rejects(factory.startGamePage({ realm, initialize() { initialized++; throw primary; },
        wasmApi: graph.wasm.api, hudReadout, ownedHudUi }), error => error === primary);
      assert.equal(initialized, 1); assert.equal(graph.wasm.calls.length, 0);
    }
  });
});

test('genuine queued action validates local proposals once, permits correction and latches one accepted attempt', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }), hud = graph.hudWasm();
    const profile = graph.profileNative();
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
    const factory = await graph.load('runtime.mjs');
    const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
    const mount = graph.f.document.getElementById('slither-client-root').children.at(-1);
    const endpoint = mount.children[0].children[1], nickname = mount.children[1].children[1], button = mount.children[2];
    const endpointState = graph.f.edit.inputValue(endpoint), nicknameState = graph.f.edit.inputValue(nickname);
    const status = () => graph.f.edit.hud.character(mount.children[3].children[0]).data;
    assert.equal(status(), 'Ready.'); assert.equal(profile.counts.fetch, 0); assert.equal(hud.scoreReads, 0);
    const baselineControls = graph.wasm.controlReads();
    let clicks = 0;
    const click = () => { clicks++; graph.f.edit.dispatch('click', { target: button, button: 0, trusted: true }); graph.f.flush(); };
    for (const [address, nick, expected] of [
      ['', '', 'Enter a server address.'], ['ws://host.invalid:1/slither','','Enter a valid server address.'],
      ['ws://192.0.2.1:0/slither','','Enter a valid server address.'],
      ['ws://192.0.2.1:65536/slither','','Enter a valid server address.'],
      [' ws://192.0.2.1:1/slither','','Enter a valid server address.'],
      ['ws://192.0.2.1:1/slither?x','','Enter a valid server address.'],
      ['ws://192.0.2.1:1/slither#x','','Enter a valid server address.'],
      ['ws://user@192.0.2.1:1/slither','','Enter a valid server address.'],
      ['ws://192.0.2.1:1/slither/extra','','Enter a valid server address.'],
      ['x'.repeat(129),'','Enter a valid server address.'],
      ['ws://192.0.2.1:1/slither','a'.repeat(25),'Check the nickname.'],
      ['ws://192.0.2.1:1/slither','\u0080','Check the nickname.'],
      ['ws://192.0.2.1:1/slither','\u001f','Check the nickname.'],
    ]) {
      endpointState.value = address; nicknameState.value = nick;
      const before = [endpointState.gets, nicknameState.gets]; click();
      assert.deepEqual([endpointState.gets, nicknameState.gets], before.map(x => x + 1));
      assert.equal(status(), expected); assert.equal(profile.counts.fetch, 0);
      assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled, false);
      assert.equal(graph.wasm.calls.includes('quality.connection'), false); assert.equal(graph.f.sockets, 0);
      assert.equal(runtime.diagnostics().gameplay.profilePhase, 'idle');
    }
    endpointState.value = 'wss://[2001:db8::1]:65535/slither'; nicknameState.value = ' \u007f ';
    const reads = [endpointState.gets, nicknameState.gets];
    graph.f.edit.dispatch('click', { target: button, button: 0, trusted: false }); graph.f.flush();
    clicks++;
    assert.deepEqual([endpointState.gets, nicknameState.gets], reads); assert.equal(profile.counts.fetch, 0);
    click(); assert.equal(profile.counts.fetch, 1); assert.equal(status(), 'Preparing connection.');
    assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled, true);
    assert.equal(hud.scoreReads, 0); assert.equal(graph.f.sockets, 0);
    assert.equal(graph.wasm.controlReads(), baselineControls + clicks, 'raw clicks keep their existing single control observation');
    const acceptedReads = [endpointState.gets, nicknameState.gets]; click();
    assert.equal(profile.counts.fetch, 1); assert.deepEqual([endpointState.gets, nicknameState.gets], acceptedReads);
    profile.reject({ private: 'Never display this proposal or error' }); await profile.settle(); graph.f.flush();
    assert.equal(profile.counts.fetch, 1); assert.equal(graph.f.sockets, 0);
    assert.doesNotMatch(status(), /private|proposal|192|db8/);
    assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled, true);
    runtime.dispose(); profile.assertWiped();
  });
});

test('accepted genuine action keeps staged reset, source release and one socket on the existing next-frame seam', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const address of ['ws://192.0.2.9:1234/slither','wss://[2001:db8::9]:443/slither']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }), hud = graph.hudWasm();
      const profile = graph.profileNative(), endpoints = [], login = [];
      const encode = graph.wasm.api.encode_login;
      graph.wasm.api.encode_login = (version, password, nickname, skin, customSkin) => {
        login.push({ nickname, skin, customSkin: [...customSkin] });
        return encode(version, password, nickname, skin, customSkin);
      };
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities,
        createSocket(endpoint) {
          endpoints.push(endpoint); assert.equal(runtime.diagnostics().captureHeld, false);
          assert.equal(graph.wasm.counts().stepFrees, 1); return native.createSocket(endpoint);
        },
      }));
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
      const mount = graph.f.document.getElementById('slither-client-root').children.at(-1);
      const endpoint = mount.children[0].children[1], nickname = mount.children[1].children[1], button = mount.children[2];
      graph.f.edit.inputValue(endpoint).value = address; graph.f.edit.inputValue(nickname).value = ' \u007f ';
      const readout = () => graph.f.edit.hud.character(mount.children[3].children[0]).data;
      const beforeCalls = [...graph.wasm.calls], source = graph.f.realm.per_color_imgs[0].kmcs[0];
      const beforeReads = graph.wasm.controlReads();
      const event = graph.f.edit.dispatch('click', { target: button, button: 0, trusted: true });
      assert.deepEqual(graph.f.edit.eventData.get(event).trace.slice(-2), ['stop','prevent']);
      assert.equal(profile.counts.fetch, 0); assert.equal(graph.wasm.controlReads(), beforeReads + 1);
      graph.f.flush(); assert.equal(profile.counts.fetch, 1); assert.equal(graph.f.sockets, 0);
      assert.deepEqual(graph.wasm.calls, beforeCalls, 'accepted UI does not advance/reset/render/change quality');
      const advances = graph.wasm.calls.filter(x => x[0] === 'advance').length;
      graph.f.frame(8); graph.f.flush();
      assert.equal(graph.wasm.calls.filter(x => x[0] === 'advance').length, advances);
      assert.equal(hud.scoreReads, 0); assert.equal(graph.f.sockets, 0);
      profile.respond(); await profile.settle(); graph.f.flush();
      assert.equal(profile.counts.digest, 1); profile.assertWiped();
      assert.equal(runtime.diagnostics().gameplay.profilePhase, 'ready');
      assert.equal(graph.f.sockets, 0);
      assert(['Connecting.','Not connected.'].includes(readout()), 'preparation is not connection acceptance');
      assert.equal(graph.f.realm.per_color_imgs[0].kmcs[0], source);
      graph.f.frame(16); assert.equal(graph.f.sockets, 1); assert.deepEqual(endpoints, [address]);
      assert.deepEqual(login, [{ nickname: ' \u007f ', skin: 0, customSkin: [] }]);
      assert.equal(graph.f.raf.size, 1); assert.equal(profile.counts.fetch, 1);
      graph.f.socket.open(); graph.message([54,1]); graph.message([97,...new Array(24).fill(0)]); graph.f.flush();
      assert.equal(readout(), 'Connected.'); assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled, true);
      assert.equal(graph.f.edit.hud.style(mount.style).get('display'), 'none', 'accepted Setup hides the entire start panel');
      assert.equal(graph.f.document.getElementById('slither-client-status').textContent, 'SlitherClient: Connected');
      assert.equal(graph.f.messages.at(-1).code, 'connected');
      graph.f.socket.onclose(); graph.f.flush();
      assert.equal(graph.f.edit.hud.style(mount.style).get('display'), 'block');
      assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled, true, 'remote disconnect does not grant a second profile attempt');
      runtime.dispose(); assert.equal(graph.f.socket.closes, 1); assert.equal(graph.f.original, 0);
    }
  });
});

test('pending actions and Promise settlements after disposal do no value, UI or socket work', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const stage of ['before-queue-flush','pending-profile','fulfilled-before-frame']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const profile = graph.profileNative();
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
      const root = graph.f.document.getElementById('slither-client-root'), mount = root.children.at(-1);
      const endpoint = mount.children[0].children[1], nickname = mount.children[1].children[1], button = mount.children[2];
      const ep = graph.f.edit.inputValue(endpoint), nick = graph.f.edit.inputValue(nickname);
      ep.value = 'ws://192.0.2.1:1/slither'; nick.value = 'Synthetic';
      graph.f.edit.dispatch('click', { target: button, button: 0, trusted: true });
      if (stage !== 'before-queue-flush') graph.f.flush();
      if (stage === 'fulfilled-before-frame') { profile.respond(); await profile.settle(); graph.f.flush(); }
      runtime.dispose();
      const reads = [ep.gets,nick.gets], writes = graph.f.edit.hud.trace.filter(([name]) => name === 'setText').length;
      profile.respond(); await profile.settle(); graph.f.flush();
      assert.deepEqual([ep.gets,nick.gets], reads);
      assert.equal(graph.f.edit.hud.trace.filter(([name]) => name === 'setText').length, writes);
      assert.equal(profile.counts.fetch, stage === 'before-queue-flush' ? 0 : 1);
      assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0); assert.equal(root.children.length, 3);
      profile.assertWiped(); runtime.dispose();
    }
  });
});

test('Play native read and disable failures preserve falsy primaries and free owners only after guard unwind', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const name of ['inputValue','buttonDisabled']) for (const primary of [undefined,null,false,0,'',Symbol('primary'),new Error('primary')]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const profile = graph.profileNative();
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
      const mount = graph.f.document.getElementById('slither-client-root').children.at(-1);
      const endpoint = mount.children[0].children[1], nickname = mount.children[1].children[1], button = mount.children[2];
      graph.f.edit.inputValue(endpoint).value = 'ws://192.0.2.1:1/slither'; graph.f.edit.inputValue(nickname).value = 'Synthetic';
      let active = false;
      const controls = graph.f.edit.ownedPlay.controls;
      controls.set(name, { hook() { active = true; assert.equal(graph.wasm.counts().sceneFrees, 0); }, afterFailure: primary });
      graph.f.faults.cleanup = () => {
        assert.equal(active, false); throw Error('Secondary native cleanup failure');
      };
      graph.f.edit.dispatch('click', { target: button, button: 0, trusted: true });
      // Native operation hooks clear their local stack before throwing; cleanup observes the sentinel below.
      controls.get(name).afterHook = () => { active = false; };
      let threw = false, value;
      try { graph.f.flush(); } catch (error) { threw = true; value = error; }
      assert(threw); assert.equal(value, primary); assert.equal(profile.counts.fetch, 0);
      assert.equal(runtime.diagnostics().disposed, true); assert.equal(graph.wasm.counts().sceneFrees, 1);
      assert.equal(graph.wasm.counts().qualityFrees, 1); assert.equal(graph.f.raf.size, 0);
      runtime.dispose(); assert.equal(graph.f.sockets, 0);
    }
  });
});

test('nonstring native value results are terminal boundary failures without coercion or profile effects', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const invalid of [null,undefined,false,0,{ toString() { assert.fail('Native result coerced'); } }]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const profile = graph.profileNative();
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
      const mount = graph.f.document.getElementById('slither-client-root').children.at(-1);
      const endpoint = graph.f.edit.inputValue(mount.children[0].children[1]);
      const nickname = graph.f.edit.inputValue(mount.children[1].children[1]);
      endpoint.value = invalid;
      const reads = [endpoint.gets,nickname.gets];
      graph.f.edit.dispatch('click', { target: mount.children[2], button: 0, trusted: true }); graph.f.flush();
      assert.deepEqual([endpoint.gets,nickname.gets], [reads[0] + 1,reads[1]]);
      assert.equal(runtime.diagnostics().disposed, true); assert.equal(profile.counts.fetch, 0);
      assert.equal(graph.f.sockets, 0); assert.equal(graph.wasm.calls.includes('quality.connection'), false);
      runtime.dispose();
    }
  });
});

test('caught reentry during Play reads, lock and status poisons the action before profile effects', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const stage of ['read','lock','status']) for (const action of ['dispose','play','nickname','router','callback']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const profile = graph.profileNative();
      let callback;
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities,
        ownedPlayDom: Object.freeze(Object.assign(Object.create(null), native.ownedPlayDom, {
          createControlsLease(request) { callback = request.onPlay; return native.ownedPlayDom.createControlsLease(request); },
        })),
      }));
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
      const mount = graph.f.document.getElementById('slither-client-root').children.at(-1);
      const endpoint = mount.children[0].children[1], nickname = mount.children[1].children[1], button = mount.children[2];
      graph.f.edit.inputValue(endpoint).value = 'ws://192.0.2.1:1/slither'; graph.f.edit.inputValue(nickname).value = 'Synthetic';
      let primary, entered = false;
      const reenter = () => {
        if (entered) return; entered = true;
        try {
          if (action === 'dispose') runtime.dispose();
          if (action === 'play') runtime.play({});
          if (action === 'nickname') runtime.bindNicknameField({});
          if (action === 'router') graph.f.edit.dispatch('resize');
          if (action === 'callback') callback();
        } catch (error) { primary = error; }
        assert(primary); assert.equal(graph.wasm.counts().sceneFrees, 0);
        assert.equal(runtime.diagnostics().captureHeld, false);
      };
      if (stage === 'read') graph.f.edit.ownedPlay.controls.set('inputValue', { hook: reenter });
      if (stage === 'lock') graph.f.edit.ownedPlay.controls.set('buttonDisabled', { hook: reenter });
      if (stage === 'status') graph.f.edit.hud.controls.set('setText', { hook(node, value) {
        if (value === 'Preparing connection.') reenter();
      } });
      graph.f.faults.cleanup = () => { throw Error('Secondary cleanup'); };
      graph.f.edit.dispatch('click', { target: button, button: 0, trusted: true });
      let value; try { graph.f.flush(); } catch (error) { value = error; }
      assert(entered); assert.equal(value, primary);
      assert.equal(profile.counts.fetch, 0); assert.equal(runtime.diagnostics().disposed, true);
      assert.equal(graph.wasm.counts().sceneFrees, 1); runtime.dispose();
    }
  });
});

test('Play control lease is saved before a partially effective bind and cleanup preserves the startup primary', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const primary of [undefined,null,false,0,'',Symbol('bind'),new Error('bind')]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const order = []; let nicknameCalls = 0;
      const realm = graph.nativeBoundary(native => {
        const group = Object.assign(Object.create(null), native.ownedPlayDom, {
          createControlsLease(request) {
            assert.equal(nicknameCalls, 1); assert.equal(Object.keys(request).length, 6);
            const lease = native.ownedPlayDom.createControlsLease(request);
            return Object.freeze({ __proto__: null,
              bind() { order.push('bind'); lease.bind(); throw primary; },
              unregister() { order.push('controls'); lease.unregister(); throw Error('Secondary unregister'); },
            });
          },
        });
        return Object.freeze({ ...native, ownedPlayDom: Object.freeze(group), registerNicknameEditField(request) {
          nicknameCalls++; assert.equal(Object.keys(request).length, 4);
          const lease = native.registerNicknameEditField(request);
          return Object.freeze({ handleInput: lease.handleInput, unregister() { order.push('nickname'); lease.unregister(); } });
        } });
      });
      graph.f.edit.hud.controls.set('removeChild', { hook() { order.push('mount'); assert.equal(graph.wasm.counts().sceneFrees, 0); } });
      const factory = await graph.load('runtime.mjs');
      let threw = false, value;
      try { await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true }); } catch (error) { threw = true; value = error; }
      assert(threw); assert.equal(value, primary); assert.deepEqual(order, ['bind','nickname','controls','mount','mount']);
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.wasm.counts().qualityFrees, 1);
      assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
      assert.equal(graph.f.document.getElementById('slither-client-root').children.length, 3);
    }
  });
});

test('failed Play mount is externally disposed after its guard and before HUD/native owners', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const mode of ['throw-after-append','caught-reentry']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const primary = { synthetic: 'Play attachment failure' }; let refusal, attached, removed = [];
      graph.f.edit.hud.controls.set('appendChild', { afterHook(parent, child) {
        if (parent.id !== 'slither-client-root' || parent.children.length !== 5) return;
        attached = child;
        if (mode === 'throw-after-append') throw primary;
        try { graph.f.edit.dispatch('resize'); } catch (error) { refusal = error; }
      } });
      graph.f.edit.hud.controls.set('removeChild', { hook(parent, child) {
        assert.equal(graph.wasm.counts().sceneFrees, 0); removed.push(child);
      } });
      const factory = await graph.load('runtime.mjs');
      await assert.rejects(factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true }), error => error === (mode === 'throw-after-append' ? primary : refusal));
      assert(attached); assert.equal(removed.length, 2); assert.equal(removed[0], attached);
      assert.equal(graph.wasm.counts().sceneFrees, 1); assert.equal(graph.f.raf.size, 0);
      assert.equal(graph.f.document.getElementById('slither-client-root').children.length, 3);
    }
  });
});

test('disposal releases nickname, controls, Play mount, HUD mount and remaining owners once with falsy first failures', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const primary of [undefined,null,false,0,'',Symbol('unregister'),new Error('unregister')]) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const order = [];
      const realm = graph.nativeBoundary(native => {
        const group = Object.assign(Object.create(null), native.ownedPlayDom, { createControlsLease(request) {
          const lease = native.ownedPlayDom.createControlsLease(request);
          return Object.freeze({ __proto__: null, bind: lease.bind, unregister() {
            order.push('controls'); lease.unregister(); throw Error('Secondary controls failure');
          } });
        } });
        return Object.freeze({ ...native, ownedPlayDom: Object.freeze(group), registerNicknameEditField(request) {
          const lease = native.registerNicknameEditField(request);
          return Object.freeze({ handleInput: lease.handleInput, unregister() {
            order.push('nickname'); lease.unregister(); throw primary;
          } });
        } });
      });
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
      const root = graph.f.document.getElementById('slither-client-root'), play = root.children.at(-1);
      const field = play.children[1].children[1], button = play.children[2];
      const fieldState = graph.f.edit.inputValue(field); fieldState.value = '\u00e9';
      graph.f.edit.hud.controls.set('removeChild', { hook(parent, child) {
        order.push(child === play ? 'play-mount' : 'hud-mount');
        graph.f.edit.dispatch('input', { target: field });
        graph.f.edit.dispatch('click', { target: button, button: 0, trusted: true });
        assert.equal(fieldState.gets, 1, 'only the initial mount value observation');
        assert.equal(graph.wasm.counts().sceneFrees, 0);
      }, afterFailure: Error('Secondary removal failure') });
      graph.f.faults.cleanup = name => { order.push(name); };
      let threw = false, value;
      try { runtime.dispose(); } catch (error) { threw = true; value = error; }
      assert(threw); assert.equal(value, primary); runtime.dispose(); graph.f.flush();
      assert.deepEqual(order, ['nickname','controls','play-mount','hud-mount','scene.free','quality.free']);
      assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
      assert.equal(graph.f.edit.hud.trace.filter(([name]) => name === 'removeChild').length, 2);
    }
  });
});

test('source freshness loss and post-consumer cleanup rejection cannot commit a socket from a genuine action', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const stage of ['before-action','pending-profile','consumer-cleanup','frame-source']) {
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true }); graph.hudWasm();
      const profile = graph.profileNative();
      const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true });
      const mount = graph.f.document.getElementById('slither-client-root').children.at(-1);
      const endpoint = mount.children[0].children[1], nickname = mount.children[1].children[1], button = mount.children[2];
      graph.f.edit.inputValue(endpoint).value = 'ws://192.0.2.1:1/slither'; graph.f.edit.inputValue(nickname).value = 'Synthetic';
      if (stage === 'before-action') realm.location.href = 'https://slither.io/#changed';
      if (stage === 'consumer-cleanup') profile.setClearHook(bytes => {
        if (bytes.length === 20) {
          assert.equal(runtime.diagnostics().gameplay.session.phase, 'opening');
          graph.f.frame(8); assert.equal(graph.f.sockets, 0); assert.equal(graph.wasm.counts().stepFrees, 0);
          throw Error('Labelled synthetic cleanup failure');
        }
      });
      graph.f.edit.dispatch('click', { target: button, button: 0, trusted: true }); graph.f.flush();
      if (stage === 'pending-profile') realm.location.href = 'https://slither.io/#changed';
      profile.respond(); await profile.settle(); graph.f.flush();
      if (stage === 'frame-source') graph.f.faults.renderOperation = () => {
        const source = realm.per_color_imgs[0].kmcs[0]; source.width = source.width;
      };
      if (graph.f.raf.size) graph.f.frame(16);
      graph.f.flush(); assert.equal(graph.f.sockets, 0);
      assert.equal(profile.counts.fetch, stage === 'before-action' ? 0 : 1);
      assert.equal(graph.f.edit.ownedPlay.buttonState(button).disabled, stage === 'before-action' ? false : true);
      runtime.dispose(); profile.assertWiped();
    }
  });
});

test('selected Play missing its native sibling fails before initialize or constructors', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
    const { startGamePage } = await graph.load('runtime.mjs');
    await assert.rejects(startGamePage({ realm: graph.f.realm, initialize() { graph.counts.initialize++; },
      wasmApi: graph.wasm.api, hudReadout: true, ownedHudUi: true, ownedPlayUi: true }), /owned Play/);
    assert.equal(graph.counts.initialize, 0); assert.equal(graph.wasm.calls.length, 0);
    assert.equal(graph.f.raf.size, 0); assert.equal(graph.f.sockets, 0);
  });
});
