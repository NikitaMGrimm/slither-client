// Real Wasm end-screen ABI, entirely authored synthetic observations.
import assert from 'node:assert/strict';

export function endScreenSmoke(wasm) {
  const projector = new wasm.EndScreenProjector();
  try {
    const project = (phase, playing = true, ended = true, local = true, score = 1001) =>
      projector.project(phase, playing, ended, local, score);
    for (const phase of ['ready', 'opening', 'challenge', 'setup', 'playing', 'disconnected', 'failed']) {
      assert.equal(project(phase).visible, false);
    }
    assert.deepEqual(project('dead'), { schema: 1, visible: true, title: 'Game over',
      scoreText: 'Your final length was 1001!', statusText: 'Returning to the start screen...' });
    assert.equal(project('disconnected', false).statusText, 'Select Play to play again.');
    assert.equal(project('victory', false, true, false).statusText, 'Session ended.');
    assert.equal(project('disconnected', false).title, 'Victory');
    for (const score of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => project('dead', true, true, true, score));
      assert.equal(project('disconnected').title, 'Victory');
    }
    assert.throws(() => project('invented-victory'));
    assert.equal(project('disconnected').title, 'Victory');
    assert.equal(projector.project('dead', true, true, true, undefined).scoreText, '');
    assert.equal(project('dead', true, true, true, -0).scoreText, 'Your final length was 0');
    assert.equal(project('dead', true, true, true, Number.MAX_SAFE_INTEGER).scoreText,
      'Your final length was 9007199254740991!');
    assert.equal(project('playing', true, false).visible, false);
    assert.equal(project('disconnected', false).visible, false);
  } finally { projector.free(); }
}
