// Inert import-map resolver/DOM/IPC/stream/digest/parser/generated-Wasm doubles.
// Execute the actual emitted injection, never downloaded source or a browser.
import { test } from 'node:test';
import { runGameModuleTest } from './game-module-test-fixture.mjs';

for (const mapped of ['bootstrap.mjs', 'profile-receiver.mjs', 'stock-gameplay.mjs']) {
  test(`emitted private graph ignores page mapping of ${mapped} and admits only genuine Play`, async () => {
    const scenario = async ({ assert, createGraph }) => {
      const mapped = 'MAPPED_MODULE';
      const g = createGraph({ href: 'http://slither.com/io', profileBroker: true, deferPrivateGate: true,
        hudNative: true, ownedHudNative: true, ownedPlayNative: true, leaderboardNative: true, minimapNative: true,
        prepareWasm(api, run) { api.LeaderboardScoreProjector = run('(class {project(){throw Error("No startup projection");} free(){}})'); } });
      g.hudWasm();
      const packageOrigin = 'https://authored-package.invalid/game/';
      const attackerURL = packageOrigin + 'page-substitute.mjs';
      g.run('globalThis.__sentinelExposures=[]');
      g.sources.set(attackerURL, `export function startGamePage(x){globalThis.__sentinelExposures.push(x.profileAuthority);}
        export function claimPendingProfileBroker(x){globalThis.__sentinelExposures.push(x);return {accepted:true,remainingMs:5000};}
        export function deliverPendingProfileBroker(op,key,v,p,password){globalThis.__sentinelExposures.push(password);return true;}
        export function createStockGameplay(x){globalThis.__sentinelExposures.push(x);}`);
      g.pageModuleMappings.set(packageOrigin + mapped, attackerURL);
      const profile = g.profileNative(), key = Array(16).fill(37);
      const capabilities = { ...profile.capabilities,
        environment: () => ({ origin: 'chrome-extension://' + 'a'.repeat(32), topLevel: false, secureContext: true }) };
      let pageResolutions = 0;
      const { broker, sender } = g.privateBroker({ capabilities, importOverride(specifier) {
        pageResolutions++;
        return g.load(specifier.slice(specifier.lastIndexOf('/') + 1));
      } });
      // The resolver stands for exact URL and transitive import-map substitutions;
      // its callback must not be reached at all, rather than trusting a namespace ID.
      assert.doesNotMatch(g.injectionArtifact, /\bimport\s*\(|\bimport\.meta|\b__export\b|\b__toESM\b|\beval\s*\(|\bnew\s+Function\b/);
      const message = type => ({ type, schema: 1, activationId: 'a'.repeat(32), authority: [...key] });
      assert.equal(await broker(message('slither-client-profile-bootstrap'), sender), true);
      assert.equal(await broker(message('slither-client-profile-wake'), sender), false, 'wake without Play has no intent');
      assert.equal(profile.counts.fetch, 0);
      let mount;
      for (const child of g.f.document.getElementById('slither-client-root').children)
        if (child.children?.length >= 4 && child.children[0].children?.[1]?.localName === 'input') mount = child;
      assert(mount);
      g.f.edit.inputValue(mount.children[0].children[1]).value = 'ws://192.0.2.1:1234/slither';
      g.f.edit.inputValue(mount.children[1].children[1]).value = 'Synthetic';
      g.f.edit.dispatch('click', { target: mount.children[2], button: 0, trusted: true }); g.f.flush();
      const wrong = Array(16).fill(7);
      assert.equal(g.f.gate.bindExtensionProfile(wrong, { claim() { throw Error('Page receiver'); } }), false);
      assert.equal(g.f.gate.deliverExtensionProfile('claim', wrong).accepted, false);
      assert.equal(g.f.gate.deliverExtensionProfile('deliver', wrong, 17, 19, Array(20).fill(99)), false);
      assert.equal(g.f.gate.deliverExtensionProfile('finish', wrong), false);
      assert.equal(g.f.sockets, 0);
      const work = broker(message('slither-client-profile-wake'), sender); profile.respond();
      assert.equal(await work, true);
      await profile.settle(); g.f.flush(); assert.equal(g.f.sockets, 0);
      g.f.frame(); assert.equal(g.f.sockets, 1);
      assert.equal(pageResolutions, 0, 'all secret-bearing recipients are lexical injected code');
      assert.equal(g.run('globalThis.__sentinelExposures.length'), 0);
      assert.equal(profile.counts.fetch, 1); profile.assertWiped();
      assert.equal(await broker(message('slither-client-profile-wake'), sender), false);
      assert.equal(profile.counts.fetch, 1);
      g.f.event('pagehide');
      assert.equal(g.f.gate.deliverExtensionProfile('finish', [...key]), false);
    };
    await runGameModuleTest({ toString: () => scenario.toString().replace('MAPPED_MODULE', mapped) });
  });
}
