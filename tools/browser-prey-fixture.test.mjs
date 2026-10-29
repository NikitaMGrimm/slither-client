// Original authored fixture acceptance. Normal Node checks need no build.
// After build:web, run SLITHER_PREY_FIXTURE_WASM=1 node --test <this file> for
// the actual parser/controller/resolver/planner path. Canvas is a command double,
// not a browser or pixel oracle; default-bootstrap browser acceptance is pending.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserPreyFixture } from './browser-prey-fixture.mjs';
import { createClientAssetMap } from '../web/client-asset-map.mjs';
import { createLocalBodyResolver } from '../web/synthetic-body.mjs';
import { createSyntheticPreyResolver } from '../web/synthetic-prey.mjs';
import { createSyntheticFoodResolver } from '../web/synthetic-food.mjs';
import { createStockClient } from '../web/stock-client.mjs';

test('prey coverage is a bounded authored default-consumer contract, separate from saved matrices', () => {
  const f = createBrowserPreyFixture();
  assert.equal(f.kind, 'authored-synthetic');
  assert.equal(f.defaultRuntime.entry, 'extension/game-bootstrap.mjs');
  assert.equal(f.defaultRuntime.diagnosticUi, false);
  assert.deepEqual(f.checkpoints.map(p => p.at), [1000, 1550, 1650, 2075, 2500]);
  assert.equal(f.durationMs, 2500); assert.equal(f.durationMs / f.cadenceMs, 100);
  assert(f.browserAcceptance.startsWith('PENDING:'));
  assert(f.packets.every((p, i, rows) => p.bytes instanceof Uint8Array
    && p.at % f.cadenceMs === 0 && (!i || p.at > rows[i - 1].at)));
  assert.equal(f.packets.at(-1).at, 2000);
});

test('one run cannot mutate the next run packet tape or lifecycle expectations', () => {
  const f = createBrowserPreyFixture(), original = createBrowserPreyFixture();
  f.packets[0].bytes.fill(255); f.checkpoints[0].ids.length = 0;
  f.events[0].op = 'invalid'; f.defaultRuntime.diagnosticUi = true;
  assert.deepEqual(createBrowserPreyFixture(), original);
});

// Minimal Canvas command double; save/restore and accepted alpha are represented
// because body/glow counting must use effective submission state, not a mock draw
// planner. Rust creates every draw command; no lifecycle arithmetic is duplicated.
function canvasRealm() {
  class CanvasRenderingContext2D {
    calls = []; stack = []; alpha = 1; blend = 'source-over';
    get globalAlpha() { return this.alpha; }
    set globalAlpha(value) { if (Number.isFinite(value) && value >= 0 && value <= 1) this.alpha = value; }
    get globalCompositeOperation() { return this.blend; }
    set globalCompositeOperation(value) { this.blend = value; }
    reset() { this.alpha = 1; this.blend = 'source-over'; this.stack = []; }
    save() { this.stack.push({ alpha: this.alpha, blend: this.blend }); }
    restore() { Object.assign(this, this.stack.pop()); }
    drawImage(source, ...args) { this.calls.push({ source, args, alpha: this.alpha, blend: this.blend }); }
    createPattern(source) { return { source }; }
    createRadialGradient() { return { addColorStop() {} }; }
    setTransform() {} translate() {} scale() {} rotate() {} clearRect() {}
    beginPath() {} arc() {} moveTo() {} lineTo() {} closePath() {}
    fill() {} stroke() {} fillRect() {} fillText() {}
  }
  class HTMLCanvasElement {
    width = 32; height = 32; context = new CanvasRenderingContext2D();
    constructor() { this.context.canvas = this; }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
    toDataURL() { return 'data:authored-command-double,no-pixels'; }
  }
  class HTMLImageElement {
    complete = true; naturalWidth = 64; naturalHeight = 64;
    async decode() {}
  }
  const classes = { CanvasRenderingContext2D, HTMLCanvasElement, HTMLImageElement };
  const previous = new Map(Object.keys(classes).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(classes)) Object.defineProperty(globalThis, key, { value, configurable: true });
  return { ...classes, Image: HTMLImageElement, document: { createElement(tag) {
    assert.equal(tag, 'canvas'); return new HTMLCanvasElement();
  } }, restore() {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  } };
}

if (process.env.SLITHER_PREY_FIXTURE_WASM === '1') {
  test('authored prey lifecycle uses current parser, production local sources and shared Rust/controller draw path', async () => {
    const { loadWasm } = await import('./reference-context.mjs');
    const wasm = await loadWasm(), f = createBrowserPreyFixture(), realm = canvasRealm();
    const scene = new wasm.AnimatedScene(0), quality = new wasm.DesktopQuality(1, 0);
    let client;
    try {
      const sourceRecipes = wasm.authored_source_recipes();
      const assets = await createClientAssetMap({ realm, sourceRecipes });
      const body = createLocalBodyResolver(assets.bodySources, realm, wasm.resolve_local_skin);
      let randomCalls = 0;
      const random = () => { randomCalls++; return .25; };
      const resolvePrey = createSyntheticPreyResolver(realm, random, sourceRecipes.prey);
      const food = createSyntheticFoodResolver(realm, random, sourceRecipes.food);
      const creations = [], roles = new Map();
      const target = new realm.HTMLCanvasElement();
      target.width = f.viewport.width; target.height = f.viewport.height;
      const adapter = {
        beginOperation: () => ({ revision: 'authored-prey-fixture-1' }), endOperation() {},
        resolveAppearance(request) {
          const rule = wasm.resolve_local_skin(request.skin, request.customBytes);
          return { face: { kind: 'paired', eyes: rule.eyes, decoration: { kind: 'none' } }, antenna: null };
        },
        resolveRecipe: body,
        resolveAntennaRandom() { throw new Error('This authored scenario contains no antenna'); },
      };
      quality.begin_connection();
      client = createStockClient({ scene, quality, adapter, target, palettes: assets.palettes,
        background: assets.background, width: f.viewport.width, height: f.viewport.height,
        hostAssets: { resolveFood: food, resolvePrey(request) {
          const result = resolvePrey(request); creations.push({ request, result });
          for (const entry of result.palette.bodies) roles.set(entry.asset.source, 'body');
          for (const entry of result.palette.glows) roles.set(entry.asset.source, 'glow');
          return result;
        } },
      });
      let originalEater7, ownToken, captured31Scale;
      const selected = new Map(), reports = [];
      let batch = 0;
      for (let at = 0; at <= f.durationMs; at += f.cadenceMs) {
        batch++;
        for (const packet of f.packets.filter(p => p.at === at)) {
          // Actual protocol/state parsing precedes and shares production ingress.
          assert(wasm.decode_frame(packet.bytes, false).length > 0);
          client.packet(packet.bytes);
        }
        if (at === 0) {
          ownToken = scene.food_state().ownToken;
          originalEater7 = scene.antenna_state().snakes.find(s => s.id === 7).token;
          for (const prey of scene.prey_state().preys) selected.set(prey.id, { instance: prey.instance, sources: prey.sources });
        }
        if (at === 1500) {
          const prey = scene.prey_state().preys.find(p => p.id === 31);
          assert.equal(prey.x, 32581); assert.equal(prey.y, 32521); assert.equal(prey.pending, 53);
        }
        target.context.calls = [];
        client.frame(at, { playing: true });
        const before = scene.prey_state();
        for (const prey of before.preys) {
          if (!selected.has(prey.id)) selected.set(prey.id, { instance: prey.instance, sources: prey.sources });
          assert.deepEqual({ instance: prey.instance, sources: prey.sources }, selected.get(prey.id), 'creation identity/source selection survives movement and capture');
        }
        const expected = f.checkpoints.find(p => p.at === at);
        if (!expected) continue;
        const calls = target.context.calls.filter(c => roles.has(c.source));
        const count = role => calls.filter(c => roles.get(c.source) === role).length;
        assert.deepEqual(before.preys.map(p => p.id), expected.ids);
        assert.equal(before.sourceCount, expected.sourceCount);
        assert.equal(count('body'), expected.bodyCalls); assert.equal(count('glow'), expected.glowCalls);
        const sourceCount = role => new Set(calls.filter(c => roles.get(c.source) === role).map(c => c.source)).size;
        assert.equal(sourceCount('body'), expected.ids.length);
        assert.equal(sourceCount('glow'), expected.ids.length);
        assert(calls.every(c => c.blend === 'lighter'));
        assert(calls.filter(c => roles.get(c.source) === 'body').every(c => c.alpha > 0));
        assert(calls.filter(c => roles.get(c.source) === 'glow').some(c => c.alpha > 0) || expected.glowCalls === 0);
        assert.equal(target.context.stack.length, 0);
        if (at === 1000) {
          assert(before.preys.every(p => !p.eaten && p.fade > 0 && p.scale > 0));
          assert(before.preys.some(p => p.x !== 32580), 'shared updates actually move prey');
        }
        if (at === 1550 || at === 1650) {
          const prey = before.preys.find(p => p.id === 31);
          assert(prey.eaten); assert.equal(prey.eater, ownToken);
          assert(prey.progress > 0 && prey.progress < 1); assert(prey.scale > 0 && prey.scale < 1);
          if (at === 1550) captured31Scale = prey.scale; else assert(prey.scale < captured31Scale);
        }
        if (at === 2075) {
          const prey = before.preys[0];
          assert(prey.eaten); assert.equal(prey.eater, originalEater7);
          const sameId = scene.antenna_state().snakes.filter(s => s.id === 7);
          assert(sameId.some(s => s.token === originalEater7));
          assert(sameId.some(s => s.token !== originalEater7));
        }
        const readiness = creations.filter(c => expected.ids.includes(c.request.id)).map(c => ({
          id: c.request.id, states: [...c.result.palette.bodies, ...c.result.palette.glows].map(e => e.asset.status),
        }));
        assert(readiness.every(c => c.states.every(status => status === 'ready')));
        reports.push({ at, offlineBatch: batch, browserDriverFrame: null,
          preys: before.preys.map(p => ({ id: p.id, instance: p.instance.toString(),
            creationOccurrence: creations.findIndex(c => c.request.id === p.id) + 1,
            eaten: p.eaten, eater: p.eater?.toString() ?? null, sources: p.sources,
            fade: p.fade, scale: p.scale, progress: p.progress })), selectedSources: before.sourceCount,
          eaters: scene.antenna_state().snakes.filter(s => s.id === 0 || s.id === 7)
            .map(s => ({ id: s.id, token: s.token.toString(), own: s.own, drawn: s.drawn })),
          readiness, quality: JSON.parse(quality.snapshot()),
          culling: 'Each retained prey has a positive-alpha body source submission in this authored viewport; pixel visibility unverified',
          bodySources: sourceCount('body'), glowSources: sourceCount('glow'),
          bodyCalls: count('body'), glowCalls: count('glow'), positiveAlphaCalls: calls.filter(c => c.alpha > 0).length });
        client.render(); assert.deepEqual(scene.prey_state(), before, 'extra render consumes no prey animation or lifecycle');
      }
      assert.deepEqual(creations.map(c => c.request.id), [31, 32, 34]);
      assert.equal(randomCalls, 6, 'two entropy values per creation; no motion/capture/render entropy');
      assert.equal(scene.prey_state().sourceCount, 0);
      assert.equal(JSON.parse(scene.snapshot()).foods, 0);
      assert.equal(reports.length, f.checkpoints.length);
      console.log('Authored real-Wasm prey checkpoints (logical Canvas only):',
        JSON.stringify(reports, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
    } finally {
      client?.dispose(); scene.free(); quality.free(); realm.restore();
    }
  });
}
