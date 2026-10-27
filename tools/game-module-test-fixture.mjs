// Authored Node-only full ESM graph boundary. No browser or production Wasm proof.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import * as vm from 'node:vm';
import { createGateTestDom, attachGateTestRealm } from './game-gate-test-fixture.mjs';

const root = new URL('../', import.meta.url);
const webNames = ['stock-skin-provider.mjs', 'stock-client.mjs', 'stock-food-provider.mjs',
  'stock-host-snapshot.mjs', 'desktop-layout.mjs', 'stock-gameplay.mjs', 'stock-hud-dom.mjs',
  'stock-hud-view.mjs', 'stock-skin-rules.mjs', 'stock-prey-provider.mjs', 'stock-asset-sources.mjs',
  'skin-provider.mjs', 'client-input.mjs', 'stock-session.mjs', 'stock-hud-contract.mjs',
  'stock-hud-state.mjs', 'handshake-session.mjs', 'stock-live-profile.mjs'];
const entryNames = { 'bootstrap.mjs': 'game-bootstrap.mjs', 'runtime.mjs': 'game-runtime.mjs',
  'owned-entry.mjs': 'game-owned-hud-entry.mjs', 'owned-hud-ui.mjs': 'game-owned-hud-ui.mjs' };
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

function createGraph({ armed = true, hudNative = false, ownedHudNative = false, initialize, prepare } = {}) {
  // Reuse authored native/Wasm fixture definitions, never transform a product module.
  const testSource = readFileSync(new URL('tools/game-bootstrap.test.mjs', root), 'utf8');
  const definitions = testSource.slice(testSource.indexOf('function fixture('), testSource.indexOf("\ntest('an unarmed"));
  const makeFixture = new vm.Script(`(function(gateSource,Script,createContext,runInContext,assert,createGateTestDom,attachGateTestRealm){
    ${definitions}\nreturn {fixture,wasmDouble};})`).runInThisContext();
  const nativeSource = readFileSync(new URL('extension/game-gate.js', root), 'utf8');
  const { fixture, wasmDouble } = makeFixture(nativeSource, vm.Script, vm.createContext, vm.runInContext, assert,
    options => { const dom = createGateTestDom({ ...options, ownedHud: ownedHudNative }); prepare?.(dom); return dom; }, attachGateTestRealm);
  const f = fixture({ armed, hudNative });
  if (hudNative) {
    // The legacy native boundary must create HTML-branded borrowed root/status nodes too.
    const create = f.document.createElement;
    f.document.createElement = name => name === 'canvas' || name === 'input'
      ? create(name) : new f.edit.hud.HTMLElement(name);
  }
  f.host(); f.complete();
  const wasm = wasmDouble(f), counts = { initialize: 0 };
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
  return { f, wasm, counts, load, sources, run: source => vm.runInContext(source, f.context),
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
    const value = await scenario({ assert, createGraph });
    parentPort.postMessage({ ok: true, value });
  } catch (error) { parentPort.postMessage({ ok: false, error: error?.stack ?? String(error) }); }
}
