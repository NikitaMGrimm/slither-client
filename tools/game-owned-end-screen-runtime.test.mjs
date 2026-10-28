// Actual session/gameplay/runtime modules with labelled generated-Wasm and native DOM doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('post-operation end-screen publication forwards session and captured final without extra game work', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const calls = { observations: [], frees: 0, created: 0, view: {
      schema: 1, visible: false, title: '', scoreText: '', statusText: '',
    } };
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true, prepareWasm(api, run) {
      api.EndScreenProjector = run(`(calls => class {
        constructor(){calls.created++;}
        project(...args){calls.observations.push(args);return {...calls.view};}
        free(){calls.frees++;}
      })`)(calls);
    } });
    const hud = graph.hudWasm(), factory = await graph.load('runtime.mjs');
    const runtime = await factory.startGamePage({ initialize() {}, wasmApi: graph.wasm.api,
      hudReadout: true, ownedHudUi: true, ownedPlayUi: true, ownedEndScreenUi: true });
    const root = graph.f.document.getElementById('slither-client-root'), end = root.children.at(-1);
    const play = root.children[4], display = node => graph.f.edit.hud.style(node.style).get('display');
    assert.notEqual(play, end); assert.equal(display(play), 'block');
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
    const reads = hud.scoreReads;
    graph.f.frame(16); assert.equal(hud.scoreReads, reads, 'projection adds no score read');
    assert.equal(graph.f.sockets, 1, 'projection adds no reconnect');
    graph.f.socket.onclose(); graph.f.flush();
    assert.equal(display(play), 'block', 'committed disconnect returns the same start controls');
    assert.equal(display(end), 'block', 'start publication does not hide the independent result sibling');
    runtime.dispose(); runtime.dispose(); assert.equal(calls.frees, 1);
    assert.equal(root.children.length, 3);
  });
});
