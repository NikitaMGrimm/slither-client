// Actual default entry/gate/gameplay/DOM modules; generated Wasm views are doubles.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

test('default announcement publication uses Rust views without a second draw or timer', async () => {
  await runGameModuleTest(async ({ assert, createGraph }) => {
    const graph = createGraph({ hudNative: true, ownedHudNative: true, ownedPlayNative: true,
      leaderboardNative: true, minimapNative: true,
      prepareWasm(api, run) {
        api.LeaderboardScoreProjector = run('(class { project() { throw Error("No board expected"); } free() {} })');
        api.EndScreenProjector = run(`(class { project() { return { schema: 1, visible: true,
          title: 'Separate end title', scoreText: 'Separate final score', statusText: 'Separate end status' }; } free() {} })`);
      } });
    graph.hudWasm();
    const entry = await graph.load('bootstrap.mjs'), runtime = await entry.gamePageRuntime;
    const root = graph.f.document.getElementById('slither-client-root'), holder = root.children.at(-1);
    const style = node => graph.f.edit.hud.style(node.style);
    const end = root.children.at(-2); assert.notEqual(end, holder);
    assert.equal(graph.announcements.enabled, 1); assert.equal(graph.announcements.reads, 1);
    assert.equal(style(holder).get('display'), 'none'); assert.equal(runtime.diagnostics().draws, 0);
    graph.announcements.view = { schema: 1, present: true, opacity: .4, left: 8, top: 4, width: 300, height: 228,
      lines: [{ text: '"<tag> & text"', fontSize: 17, bold: true, italic: true, spaceAfter: 5 },
        { text: 'By synthetic player', fontSize: 13, bold: false, italic: false, spaceAfter: 0 },
        { text: 'Longest today: 10', fontSize: 13, bold: false, italic: false, spaceAfter: 0 }] };
    const [id, callback] = graph.f.raf.entries().next().value; graph.f.raf.delete(id); callback(16);
    assert.equal(graph.announcements.reads, 2); assert.equal(runtime.diagnostics().draws, 1);
    assert.equal(style(holder).get('display'), 'block'); assert.equal(style(holder).get('opacity'), '0.4');
    assert.equal(graph.f.edit.hud.character(holder.children[0].children[0]).data, '"<tag> & text"');
    assert.equal(style(end).get('display'), 'block');
    assert.deepEqual(end.children.map(node => graph.f.edit.hud.character(node.children[0]).data),
      ['Separate end title', 'Separate final score', 'Separate end status']);
    assert.equal(graph.f.intervals.size, 0); assert.equal(graph.f.raf.size, 1); assert.equal(graph.f.sockets, 0);
    runtime.dispose(); runtime.dispose(); assert.equal(root.children.length, 3); assert.equal(graph.f.raf.size, 0);
  });
});
