import assert from 'node:assert/strict';
import test from 'node:test';
import { activateGamePage, armDocument, gamePage } from '../extension/game-activation.mjs';
import { Script, createContext } from 'node:vm';
import { readFileSync } from 'node:fs';

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
  return { api, options, calls, tab, mutate(fn) { fn(registered); calls.length = 0; } };
}

test('com entry: activation admits only the observed origin/path pair and retains io homes', async () => {
  for (const href of ['http://slither.com/io', 'http://slither.io/', 'https://slither.io/',
    'http://www.slither.io/index.html', 'https://www.slither.io/index.html']) assert.equal(gamePage(href), href);
  for (const href of ['http://slither.com/', 'http://slither.com/index.html', 'http://slither.com/io/',
    'http://slither.com/IO', 'http://slither.com/%69o', 'https://slither.com/io', 'http://www.slither.com/io',
    'http://slither.io/io', 'https://www.slither.io/io', 'http://slither.com:81/io',
    'http://user@slither.com/io', 'http://slither.com/io?x=1', 'http://slither.com/io#x',
    'http://slither.com/io?', 'http://slither.com/io#',
    'http://slither.com.evil.invalid/io', 'http://evil.slither.com/io']) {
    assert.throws(() => gamePage(href), /supported game home page/, href);
  }
  const f = fixture(); f.tab.url = 'http://slither.com/io';
  assert.deepEqual(f.calls, []);
  await activateGamePage(f.api, f.options);
  assert.deepEqual(f.calls, ['register', 'arm', 'reload']);
  f.mutate(entries => {
    for (const entry of entries) {
      assert.deepEqual(entry.matches, ['http://slither.io/*', 'https://slither.io/*',
        'http://www.slither.io/*', 'https://www.slither.io/*', 'http://slither.com/io']);
      assert.equal(entry.allFrames, false); assert.equal(entry.persistAcrossSessions, false);
    }
  });
  await activateGamePage(f.api, f.options); assert.deepEqual(f.calls, ['arm', 'reload']);
});

test('com entry: serialized arm retains exact URL, top-level, identity and expiry fences', () => {
  const href = 'http://slither.com/io';
  const good = { schema: 1, build: 'gamepage-v1', id: 'a'.repeat(32), url: href, expires: Date.now() + 25000 };
  function arm({ url = href, record = good, nested = false } = {}) {
    const writes = [], window = {}; window.top = nested ? {} : window;
    const context = createContext({ window, location: { href: url }, URL,
      sessionStorage: { setItem(...args) { writes.push(args); } }, record });
    return { writes, run: () => new Script(`(${armDocument.toString()})(record)`).runInContext(context) };
  }
  const f = arm(), result = f.run();
  assert.equal(result.url, href); assert.equal(result.id, good.id); assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0][0], '__slitherClientArmV1'); assert.deepEqual(JSON.parse(f.writes[0][1]), good);
  for (const url of [href + '?', href + '#']) {
    const bad = arm({ url, record: { ...good, url } });
    assert.throws(bad.run, /changed or activation expired/); assert.equal(bad.writes.length, 0);
  }
  for (const options of [{ nested: true }, { url: 'http://slither.com/' }, { url: 'https://slither.com/io' },
    { url: 'http://www.slither.com/io' }, { url: href + '?x=1' }, { url: href + '#x' },
    ...[{ url: 'http://slither.io/' }, { schema: 2 }, { build: 'other' }, { id: 'a' },
      { expires: 0 }, { expires: Date.now() + 60000 }].map(change => ({ record: { ...good, ...change } }))]) {
    const bad = arm(options); assert.throws(bad.run, /changed or activation expired/); assert.equal(bad.writes.length, 0);
  }
});

test('com entry: manifest exposure follows exact origins while activation rejects other com paths', () => {
  for (const browser of ['chrome', 'firefox']) {
    const manifest = JSON.parse(readFileSync(new URL(`../extension/manifest.${browser}.json`, import.meta.url)));
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
    assert.deepEqual(manifest.web_accessible_resources[0].matches, ['http://slither.io/*', 'https://slither.io/*',
      'http://www.slither.io/*', 'https://www.slither.io/*', 'http://slither.com/*']);
    assert.equal(manifest.host_permissions, undefined); assert.equal(manifest.content_scripts, undefined);
    assert.throws(() => gamePage('http://slither.com/')); assert.throws(() => gamePage('http://slither.com/index.html'));
  }
});

test('com entry: activation keeps result identity and navigation races terminal before reload', async () => {
  for (const bad of [result => [], result => [result, result], result => [{ ...result, frameId: 1 }],
    result => [{ ...result, error: 'Synthetic permission error' }],
    result => [{ ...result, result: { ...result.result, schema: 2 } }],
    result => [{ ...result, result: { ...result.result, id: 'b'.repeat(32) } }],
    result => [{ ...result, result: { ...result.result, url: 'http://slither.io/' } }]]) {
    const f = fixture(); f.tab.url = 'http://slither.com/io';
    f.api.scripting.executeScript = async ({ args: [record] }) => bad({ frameId: 0,
      result: { schema: 1, id: record.id, url: record.url } });
    await assert.rejects(activateGamePage(f.api, f.options), /Could not arm/);
    assert.equal(f.calls.includes('reload'), false);
  }
  const f = fixture(); f.tab.url = 'http://slither.com/io';
  f.api.tabs.get = async () => ({ id: f.tab.id, url: 'http://slither.com/io#changed' });
  await assert.rejects(activateGamePage(f.api, f.options), /navigated/);
  assert.equal(f.calls.includes('reload'), false);
});

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
