import assert from 'node:assert/strict';
import test from 'node:test';
import { activateGamePage } from '../extension/game-activation.mjs';

// Authored API double: first register, then return a browser-style serialization.
function fixture() {
  let registered = [];
  const calls = [];
  const tab = { id: 7, url: 'https://slither.io/' };
  const api = {
    tabs: {
      query: async () => [tab], get: async () => tab,
      reload: async () => { calls.push('reload'); },
    },
    scripting: {
      getRegisteredContentScripts: async () => structuredClone(registered),
      registerContentScripts: async entries => { registered = structuredClone(entries); calls.push('register'); },
      executeScript: async ({ args: [record] }) => {
        calls.push('arm');
        return [{ frameId: 0, result: { schema: 1, id: record.id, url: record.url } }];
      },
    },
  };
  const options = { now: () => 100, random: bytes => bytes.fill(42) };
  return { api, options, calls, mutate(fn) { fn(registered); calls.length = 0; } };
}

test('activation accepts returned default omissions and reordered match patterns on reactivation', async () => {
  const f = fixture();
  await activateGamePage(f.api, f.options);
  f.mutate(entries => {
    for (const entry of entries) {
      delete entry.allFrames;
      if (entry.world === 'ISOLATED') delete entry.world;
      entry.matches.reverse();
    }
  });
  await activateGamePage(f.api, f.options);
  assert.deepEqual(f.calls, ['arm', 'reload']);
});

for (const [name, mutate] of [
  ['unchanged explicit defaults', () => {}],
  ['reordered matches only', entries => { entries[0].matches.reverse(); }],
]) {
  test(`activation reuses ${name}`, async () => {
    const f = fixture();
    await activateGamePage(f.api, f.options);
    f.mutate(mutate);
    await activateGamePage(f.api, f.options);
    assert.deepEqual(f.calls, ['arm', 'reload']);
  });
}

for (const [name, mutate] of [
  ['omitted persistence defaults to true', entries => { delete entries[0].persistAcrossSessions; }],
  ['explicit persistence true', entries => { entries[0].persistAcrossSessions = true; }],
  ['omitted MAIN world defaults to ISOLATED', entries => { delete entries[0].world; }],
  ['omitted runAt defaults to document_idle', entries => { delete entries[0].runAt; }],
  ['all frames', entries => { entries[1].allFrames = true; }],
  ['different match pattern', entries => { entries[0].matches[0] = 'https://example.invalid/*'; }],
  ['missing stylesheet', entries => { delete entries[1].css; }],
  ['different script', entries => { entries[0].js = ['game/link.js']; }],
]) {
  test(`activation rejects registration with ${name} before arming or reloading`, async () => {
    const f = fixture();
    await activateGamePage(f.api, f.options);
    f.mutate(mutate);
    await assert.rejects(activateGamePage(f.api, f.options), /Existing game registration differs/);
    assert.deepEqual(f.calls, []);
  });
}
