// Actual session/gameplay/runtime modules with labelled generated-Wasm and native DOM doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('post-operation end-screen publication forwards session and captured final without extra game work', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const calls = { observations: [], frees: 0, created: 0, view: {
      schema: 1, visible: false, title: '', scoreText: '', statusText: '',
    } };
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, minimapNative: true, prepareWasm(api, run) {
      api.EndScreenProjector = run(`(calls => class {
        constructor(){calls.created++;}
        project(...args){calls.observations.push(args);return {...calls.view};}
        free(){calls.frees++;}
      })`)(calls);
    } });
    const hud = graph.hudWasm(), factory = await graph.load('runtime.mjs'), profile = graph.profileNative();
    const realm = graph.nativeBoundary(native => Object.freeze({ ...native, liveProfile: profile.capabilities }));
    const runtime = await factory.startGamePage({ realm, initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedMenuUi: true,
      ownedAppearancePreview: true, ownedEndScreenUi: true });
    const root = graph.f.document.getElementById('slither-client-root'), play = root.children[4];
    const menu = play.children[4], preview = menu.children.at(-1), end = play.children.at(-1);
    const display = node => graph.f.edit.hud.style(node.style).get('display');
    assert.notEqual(play, end); assert.equal(display(play), 'block');
    assert.notEqual(end, menu); assert.equal(end.parentNode, play);
    assert.equal(graph.f.edit.hud.style(play.style).get('overflow'), 'auto', 'returned contents share the existing responsive scroll panel');
    assert.equal(calls.created, 1); assert.equal(calls.observations.at(-1)[0], 'ready');
    assert.equal(graph.f.sockets, 0); assert.equal(hud.scoreReads, 0);
    graph.wasm.api.EndScreenProjector.prototype.project = () => assert.fail('Late method lookup');
    graph.wasm.api.EndScreenProjector.prototype.free = () => assert.fail('Late free lookup');
    runtime.play(graph.run(`({endpoint:'ws://192.0.2.1:1234/slither',
      profile:{clientVersion:1,password:new Uint8Array(20),protocolVersion:19},
      nickname:'Synthetic',skin:0,customSkin:new Uint8Array()})`));
    graph.f.frame(8); graph.f.socket.open(); graph.message([54, 1]);
    graph.message([97, ...new Array(24).fill(0)]); graph.f.flush();
    assert.equal(calls.observations.at(-1)[0], 'playing');
    assert.equal(display(play), 'none', 'the separate start panel does not cover active gameplay');
    assert.equal(end.parentNode, root);
    calls.view = { schema: 1, visible: true, title: 'Rust supplied title', scoreText: 'Rust supplied score', statusText: 'Rust supplied status' };
    const count = calls.observations.length;
    graph.message([118, 1]);
    assert.equal(calls.observations.length, count, 'ingress callback does not publish DOM');
    graph.f.flush();
    const observation = calls.observations.at(-1);
    assert.equal(observation[0], 'victory'); assert.equal(observation[1], true);
    assert.equal(observation[2], true); assert.equal(observation[3], false);
    assert.equal(Object.is(observation[4], -0), true, 'existing command-time capture forwarded exactly');
    assert.deepEqual(end.children.map(node => graph.f.edit.hud.character(node.children[0]).data),
      ['Rust supplied title', 'Rust supplied score', 'Rust supplied status']);
    assert.equal(display(play), 'none'); assert.equal(display(end), 'block');
    assert.equal(end.parentNode, root, 'the result stays visible independently throughout the death delay');
    const reads = hud.scoreReads;
    graph.f.frame(16); assert.equal(hud.scoreReads, reads, 'projection adds no score read');
    assert.equal(graph.f.sockets, 1, 'projection adds no reconnect');
    graph.f.socket.onclose(); graph.f.flush();
    assert.equal(display(play), 'block', 'committed disconnect returns the same start controls');
    assert.equal(display(end), 'block', 'return retains the visible outcome');
    assert.equal(end.parentNode, play); assert.equal(play.children.at(-1), end);
    assert.equal(graph.f.edit.hud.style(end.style).get('position'), 'static');
    assert.equal(play.children[4], menu); assert.equal(menu.children.at(-1), preview);
    const text = node => graph.f.edit.hud.character(node.children[0]).data;
    const next = menu.children.find(node => node.localName === 'button' && text(node) === 'Next skin');
    graph.f.edit.dispatch('click', { target: next, button: 0, trusted: true }); graph.f.flush();
    assert.equal(text(menu.children[1]), 'Skin 2 of 66', 'result placement preserves menu actions');
    assert.equal(display(preview.children[0]), 'block', 'preview remains available beside the retained result');
    assert.equal(hud.scoreReads, reads); assert.equal(graph.f.sockets, 1); assert.equal(profile.counts.fetch, 0);
    assert.equal(runtime.diagnostics().disposed, false);
    runtime.dispose(); runtime.dispose(); assert.equal(calls.frees, 1);
    assert.equal(root.children.length, 3);
  });
});

test('end-screen without an owned start panel retains its independent passive placement', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true }); graph.hudWasm();
    const factory = await graph.load('runtime.mjs');
    const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedEndScreenUi: true });
    const root = graph.f.document.getElementById('slither-client-root'), end = root.children.at(-1);
    assert.equal(end.localName, 'section'); assert.equal(end.parentNode, root);
    assert.equal(graph.f.edit.hud.style(end.style).get('position'), 'fixed');
    assert.equal(graph.f.sockets, 0); runtime.dispose(); runtime.dispose();
    assert.equal(root.children.length, 3);
  });
});

test('return placement failure preserves falsy primary through cleanup after source release', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    for (const primary of [undefined, null, false, 0, Error('Synthetic return placement failure')]) {
      const calls = { free: 0 };
      const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true,
        prepareWasm(api, run) {
          api.EndScreenProjector = run(`(calls => class {
            project(){return {schema:1,visible:true,title:'Game over',scoreText:'Captured final',statusText:'Session ended.'};}
            free(){calls.free++;throw new Error('Secondary projector cleanup failure');}
          })`)(calls);
        } });
      graph.hudWasm();
      const factory = await graph.load('runtime.mjs');
      const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
        hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedEndScreenUi: true });
      const root = graph.f.document.getElementById('slither-client-root'), play = root.children[4], end = play.children.at(-1);
      runtime.play(graph.run(`({endpoint:'ws://192.0.2.1:1234/slither',
        profile:{clientVersion:1,password:new Uint8Array(20),protocolVersion:19},
        nickname:'Synthetic',skin:0,customSkin:new Uint8Array()})`));
      graph.f.frame(8); graph.f.socket.open(); graph.message([54, 1]);
      graph.message([97, ...new Array(24).fill(0)]); graph.f.flush();
      graph.message([118, 1]); graph.f.flush(); assert.equal(end.parentNode, root);
      let moved = 0;
      graph.f.edit.hud.controls.set('appendChild', { afterHook(parent, node) {
        if (parent === play && node === end) {
          moved++; assert.equal(runtime.diagnostics().captureHeld, false);
          throw primary;
        }
      } });
      graph.f.socket.onclose();
      let threw = false;
      try { graph.f.flush(); } catch (error) { threw = true; assert.equal(error, primary); }
      assert.equal(threw, true); assert.equal(moved, 1);
      assert.equal(calls.free, 1); assert.equal(runtime.diagnostics().disposed, true);
      assert.equal(runtime.diagnostics().captureHeld, false); assert.equal(end.isConnected, false);
      assert.equal(root.children.length, 3); assert.equal(graph.f.sockets, 1);
      runtime.dispose(); assert.equal(calls.free, 1);
    }
  });
});
