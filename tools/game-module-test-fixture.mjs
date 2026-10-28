// Authored Node-only full ESM graph boundary. No browser or production Wasm proof.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as vm from 'node:vm';
import { createGateTestDom, attachGateTestRealm, issuedMinimapViewDouble } from './game-gate-test-fixture.mjs';
import { projectStartPageDouble } from './start-page-view-double.mjs';

const root = new URL('../', import.meta.url);
const webNames = ['stock-skin-provider.mjs', 'stock-client.mjs', 'stock-food-provider.mjs',
  'stock-host-snapshot.mjs', 'desktop-layout.mjs', 'stock-gameplay.mjs', 'stock-hud-dom.mjs',
  'stock-hud-view.mjs', 'stock-skin-rules.mjs', 'stock-accessory-selection.mjs', 'stock-prey-provider.mjs', 'stock-asset-sources.mjs',
  'skin-provider.mjs', 'client-input.mjs', 'stock-session.mjs', 'stock-hud-contract.mjs',
  'stock-hud-state.mjs', 'handshake-session.mjs', 'stock-live-profile.mjs',
  'stock-leaderboard-state.mjs', 'stock-leaderboard-view.mjs',
  'local-game-host.mjs', 'client-asset-map.mjs', 'synthetic-body.mjs', 'synthetic-food.mjs', 'synthetic-prey.mjs', 'loopback-session.mjs'];
const entryNames = { 'bootstrap.mjs': 'game-bootstrap.mjs', 'runtime.mjs': 'game-runtime.mjs',
  'owned-hud-ui.mjs': 'game-owned-hud-ui.mjs', 'owned-play-ui.mjs': 'game-owned-play-ui.mjs',
  'start-page-layout.mjs': 'start-page-layout.mjs',
  'owned-leaderboard-ui.mjs': 'game-owned-leaderboard-ui.mjs',
  'owned-minimap-ui.mjs': 'game-owned-minimap-ui.mjs', 'owned-end-screen-ui.mjs': 'game-owned-end-screen-ui.mjs' };
const origin = 'https://authored-package.invalid/game/';

export async function runGameModuleTest(scenario) {
  if (!isMainThread) throw new Error('Only the test process creates the isolated VM worker');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { execArgv: ['--experimental-vm-modules'],
      workerData: { kind: 'authored-game-module-test', scenario: scenario.toString() } });
    let result;
    worker.on('message', message => { result = message; });
    worker.on('error', reject);
    worker.on('exit', code => {
      if (code !== 0 || !result?.ok) reject(new Error(result?.error ?? `Module test worker exited ${code}`));
      else resolve(result.value);
    });
  });
}

function createGraph({ armed = true, hudNative = false, ownedHudNative = false, ownedPlayNative = false,
  leaderboardNative = false, minimapNative = false, initialize, prepare, prepareWasm } = {}) {
  // Reuse authored native/Wasm fixture definitions, never transform a product module.
  const testSource = readFileSync(new URL('tools/game-bootstrap.test.mjs', root), 'utf8');
  const definitions = testSource.slice(testSource.indexOf('function fixture('), testSource.indexOf("\ntest('an unarmed"));
  const makeFixture = new vm.Script(`(function(gateSource,Script,createContext,runInContext,assert,createGateTestDom,attachGateTestRealm){
    ${definitions}\nreturn {fixture,wasmDouble};})`).runInThisContext();
  const nativeSource = readFileSync(new URL('extension/game-gate.js', root), 'utf8');
  const { fixture, wasmDouble } = makeFixture(nativeSource, vm.Script, vm.createContext, vm.runInContext, assert,
    options => { const dom = createGateTestDom({ ...options, ownedHud: ownedHudNative, ownedPlay: ownedPlayNative,
      leaderboard: leaderboardNative, minimap: minimapNative }); prepare?.(dom); return dom; }, attachGateTestRealm);
  const f = fixture({ armed, hudNative });
  if (hudNative) {
    // The legacy native boundary must create HTML-branded borrowed root/status nodes too.
    const create = f.document.createElement;
    f.document.createElement = name => name === 'canvas' || name === 'input'
      ? create(name) : new f.edit.hud.HTMLElement(name);
  }
  f.host(); f.complete();
  const wasm = wasmDouble(f), counts = { initialize: 0 };
  wasm.api.start_page_view = vm.runInContext('(' + projectStartPageDouble.toString() + ')', f.context);
  const minimap = { enabled: 0, reads: [], fractions: [], view: {
    schema: 1, enabled: true, imageRevision: 0n, dimension: null,
    baseRgba: new Uint8Array(), alternateRgba: new Uint8Array(), widget: null,
  } };
  if (minimapNative) Object.assign(wasm.api.AnimatedScene.prototype, {
    enable_minimap_tracking() { minimap.enabled++; },
    observe_minimap_ui_fraction(value) { minimap.fractions.push(value); },
    minimap_view(right, bottom, revision) {
      minimap.reads.push({ right, bottom, revision });
      return revision === minimap.view.imageRevision
        ? { ...minimap.view, baseRgba: null, alternateRgba: null } : minimap.view;
    },
  });
  // Test-owned generated-ABI doubles are installed before module export capture.
  wasm.api.EndScreenProjector = vm.runInContext(`(class {
    project() { return { schema: 1, visible: false, title: '', scoreText: '', statusText: '' }; }
    free() {}
  })`, f.context);
  prepareWasm?.(wasm.api, source => vm.runInContext(source, f.context));
  const sources = new Map();
  for (const name of webNames) sources.set(origin + name, readFileSync(new URL('web/' + name, root), 'utf8'));
  for (const [name, file] of Object.entries(entryNames)) {
    const url = new URL('extension/' + file, root);
    sources.set(origin + name, readFileSync(url, 'utf8'));
  }
  const modules = new Map();
  const wasmUrl = origin + 'pkg/slither_client.js';
  const init = () => { counts.initialize++; return initialize?.(); };
  const generated = new vm.SyntheticModule(['default', ...Object.keys(wasm.api)], function () {
    this.setExport('default', init);
    for (const [name, value] of Object.entries(wasm.api)) this.setExport(name, value);
  }, { context: f.context, identifier: wasmUrl });
  modules.set(wasmUrl, generated);
  const get = url => {
    if (modules.has(url)) return modules.get(url);
    if (!sources.has(url)) throw new Error('Non-whitelisted authored module: ' + url);
    const module = new vm.SourceTextModule(sources.get(url), { context: f.context, identifier: url,
      initializeImportMeta(meta) { meta.url = url; } });
    modules.set(url, module); return module;
  };
  const load = async name => {
    const module = get(origin + name);
    if (module.status === 'unlinked') await module.link((specifier, parent) => {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error('Nonlocal test import');
      return get(new URL(specifier, parent.identifier).href);
    });
    if (module.status === 'linked') await module.evaluate();
    return module.namespace;
  };
  return { f, wasm, counts, minimap, load, sources, run: source => vm.runInContext(source, f.context),
    message(values) {
      // Native WebSocket delivery supplies an ArrayBuffer from the document's own realm.
      const data = vm.runInContext(`(values => {
        const buffer = new ArrayBuffer(values.length); new Uint8Array(buffer).set(values); return buffer;
      })`, f.context)(values);
      f.socket.onmessage?.({ data });
    },
    arm() {
      f.document.readyState = 'loading'; delete f.realm.oef; f.realm.ws = null;
      f.realm.sessionStorage.setItem('__slitherClientArmV1', JSON.stringify({ schema: 1, build: 'gamepage-v1',
        id: 'a'.repeat(32), url: f.realm.location.href, expires: Date.now() + 25000 }));
      new vm.Script(nativeSource).runInContext(f.context); f.host(); f.complete();
    },
    nativeBoundary(transform) {
      // Fault-only native boundary: the real one-shot claim still supplies all unchanged owners.
      const realm = { ...f.realm }, gate = f.gate;
      Object.defineProperty(realm, Symbol.for('slither.client.gate.v1'), { value: Object.freeze({
        metadata: gate.metadata, claim(id) { return transform(gate.claim(id)); },
      }) });
      Object.defineProperty(realm, 'top', { value: realm });
      return realm;
    },
    profileNative() {
      // Authored inert bytes and a labelled native digest/fetch boundary DOUBLE.
      // This does not establish a production source pin, HTTP or game acceptance.
      const counts = { fetch: 0, digest: 0, cancel: 0, release: 0, abort: 0 };
      let respond, reject, delivered = false, clearHook;
      const response = new Promise((yes, no) => { respond = yes; reject = no; });
      const buffers = [], body = {}, reader = {};
      const route = 'https://slither.io/s/game1107249518.js';
      const capabilities = Object.freeze({ __proto__: null,
        fetch(url, options) {
          assert.equal(url, route); assert.equal(options.credentials, 'omit');
          assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
          counts.fetch++; return response;
        },
        async digest(algorithm, bytes) {
          assert.equal(algorithm, 'SHA-256'); assert.equal(bytes.length, 224092); counts.digest++;
          const value = Uint8Array.from('5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095'.match(/../g), x => parseInt(x, 16));
          buffers.push(value); return value;
        },
        createAbort: () => Object.freeze({ __proto__: null, signal: {}, abort() { counts.abort++; } }),
        setTimeout: () => 9999, clearTimeout() {}, now: () => 0,
        environment: () => Object.freeze({ __proto__: null, origin: 'https://slither.io', topLevel: true, secureContext: true }),
        responseInfo: () => Object.freeze({ __proto__: null, status: 200, type: 'basic', url: route, redirected: false, body }),
        getReader(value) { assert.equal(value, body); return reader; },
        read(value) {
          assert.equal(value, reader);
          if (delivered) return Promise.resolve({ __proto__: null, done: true, value: undefined });
          delivered = true;
          const valueBytes = new Uint8Array(224092).fill(32);
          valueBytes.set(new TextEncoder().encode('var v=17;'), 181647);
          valueBytes.set(new TextEncoder().encode('var k=[' + Array.from({length:20}, (_, i) => i).join(',') + '];'), 181670);
          buffers.push(valueBytes); return Promise.resolve({ __proto__: null, done: false, value: valueBytes });
        },
        cancelReader(value) { assert.equal(value, reader); counts.cancel++; return Promise.resolve(); },
        releaseReader(value) { assert.equal(value, reader); counts.release++; },
        bytes: Object.freeze({ __proto__: null,
          allocate(length) { const bytes = new Uint8Array(length); buffers.push(bytes); return bytes; },
          length: bytes => bytes.length, copy: (to, from, at) => to.set(from, at),
          clear(bytes) { bytes.fill(0); clearHook?.(bytes); },
        }),
      });
      return { capabilities, counts, buffers, respond: () => respond({ synthetic: true }), reject,
        setClearHook(hook) { clearHook = hook; },
        async settle() { for (let i = 0; i < 40; i++) await Promise.resolve(); },
        assertWiped() { for (const bytes of buffers) assert(bytes.every(value => value === 0)); },
      };
    },
    hudWasm() {
      const counts = { tracking: 0, scoreReads: 0, packets: 0 };
      // Only this generated-Wasm boundary is doubled. Records originate in the module realm.
      const boundary = vm.runInContext(`((Base, counts) => {
        let commands = [];
        const scoreView = () => ({schema:1,enabled:true,tableMax:17,
          own:{token:7n,id:7,logicalSegments:4,fractionalMass:.5,scoreAdjustment:3,scoreIndex:7},
          status:'ready',score:-0,error:null});
        return { setCommands(value) { commands = value; }, Scene: class extends Base {
        enable_score_tracking() { this.outside(); counts.tracking++; }
        score_view() { this.outside(); counts.scoreReads++; return scoreView(); }
        apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud(...args) {
          this.outside(); this.borrowed = true;
          try {
            counts.packets++;
            const events = [], plan = args[15];
            let setupDraws = 0;
            for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
              const command = commands[commandIndex];
              if (command[0] === 97) {
                setupDraws++; events.push({commandIndex,kind:'setup',tableMax:17},
                  {commandIndex,kind:'setup-draw',view:scoreView()});
              } else if (command[0] === 108 && plan.guards[commandIndex].playing) {
                events.push({commandIndex,kind:'leaderboard',localRow:2,rank:command[1] ?? 7,
                  population:command[2] ?? 23,deathPending:plan.guards[commandIndex].deathPending});
              } else if (plan.finalCaptureIndices.includes(commandIndex)) {
                events.push({commandIndex,kind:'final-score',view:scoreView()});
              } else if ([115,104].includes(command[0])) events.push({commandIndex,kind:'own-length-scheduled',token:7n});
            }
            return {schema:1,commandCount:commands.length,setupDraws,events};
          } finally { this.borrowed = false; }
        }
      }};
      })`, f.context)(wasm.api.AnimatedScene, counts);
      for (const name of ['enable_minimap_tracking', 'minimap_view', 'observe_minimap_ui_fraction']) {
        const method = Object.getOwnPropertyDescriptor(wasm.api.AnimatedScene.prototype, name);
        if (method) Object.defineProperty(boundary.Scene.prototype, name, method);
      }
      wasm.api.AnimatedScene = boundary.Scene;
      const decode = wasm.api.decode_frame;
      wasm.api.decode_frame = bytes => {
        const decoded = decode(bytes), commands = [];
        for (let offset = 0; offset < decoded.length;) {
          const length = decoded[offset] * 16777216 + decoded[offset + 1] * 65536 + decoded[offset + 2] * 256 + decoded[offset + 3];
          offset += 4; commands.push([...decoded.slice(offset, offset + length)]); offset += length;
        }
        boundary.setCommands(commands); return decoded;
      };
      return counts;
    },
  };
}

if (!isMainThread && workerData?.kind === 'authored-game-module-test') {
  try {
    const scenario = new vm.Script('(' + workerData.scenario + ')').runInThisContext();
    const value = await scenario({ assert, createGraph, issuedMinimapViewDouble });
    parentPort.postMessage({ ok: true, value });
  } catch (error) { parentPort.postMessage({ ok: false, error: error?.stack ?? String(error) }); }
}
