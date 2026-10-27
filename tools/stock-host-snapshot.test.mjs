import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStockHostSnapshot } from '../web/stock-host-snapshot.mjs';
import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';

// Original synthetic source/realm/observer doubles. No pixels, host program or network.
function fixture() {
  class HTMLCanvasElement {
    #width = 48; #height = 48;
    get width() { return this.#width; } set width(value) { this.#width = value; }
    get height() { return this.#height; } set height(value) { this.#height = value; }
  }
  class HTMLImageElement {
    get naturalWidth() { return 32; } get naturalHeight() { return 32; } get complete() { return true; }
  }
  const generated = new WeakSet(), painted = new WeakSet(), stamps = new WeakMap(), calls = [];
  const canvas = (width = 48, height = 48) => {
    const value = new HTMLCanvasElement(); value.width = width; value.height = height;
    generated.add(value); stamps.set(value, 1); return value;
  };
  const realm = { HTMLCanvasElement, HTMLImageElement, render_mode: 2, is_mobile: false, team_mode: false,
    choosing_skin: false, building_skin: false, testing: false, playing: false, connecting: false,
    ws: null, nsr: false, alcsc: Uint8Array.from({ length: 256 }, (_, i) => Number(i <= 35 || [37, 39, 41].includes(i))) };
  const shared = canvas();
  realm.per_color_imgs = Array.from({ length: 42 }, (_, i) => {
    const entry = { klp: i !== 36, kmcs: Array(i === 36 ? 60 : 7).fill(shared), kfmc: shared, ic: 1 };
    for (const [images, ...metrics] of [['imgs', 'fws', 'fhs', 'fw2s', 'fh2s'], ['oimgs', 'ofws', 'ofhs', 'ofw2s', 'ofh2s'],
      ['gimgs', 'gfws', 'gfhs', 'gfw2s', 'gfh2s'], ['pr_imgs', 'pr_fws', 'pr_fhs', 'pr_fw2s', 'pr_fh2s']]) {
      entry[images] = [shared]; for (const key of metrics) entry[key] = [24];
    }
    return entry;
  });
  const downloads = ['kwkbulb', 'pwdbulb', 'playbulb', 'leafbulb', 'swissbulb', 'moldovabulb',
    'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest', 'jmou'];
  for (const slot of ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'jsebi', 'jsepi', 'ecmc', ...downloads]) realm[slot] = canvas();
  realm.jsebi.width = realm.jsebi.height = 64;
  realm.jmou.width = 79; realm.jmou.height = 130;
  for (const slot of downloads) painted.add(realm[slot]);
  realm.bg_hex = new HTMLImageElement(); stamps.set(realm.bg_hex, 1);
  let complete = true, accessory = null, captures = 0;
  const observer = { completed: () => complete,
    generated: source => { calls.push(['generated', source]); return generated.has(source); },
    painted: source => { calls.push(['painted', source]); return painted.has(source); },
    stamp: source => stamps.get(source) ?? 0 };
  const reader = createStockHostSnapshot({ realm, observer, readAccessory: () => accessory });
  const adapter = createStockSkinAdapter({ realm, random: () => { throw new Error('Unexpected random'); },
    readSnapshot: () => { captures++; return reader.capture(); } });
  return { realm, observer, reader, adapter, generated, painted, stamps, calls, canvas, downloads,
    set complete(value) { complete = value; }, set accessory(value) { accessory = value; }, get captures() { return captures; } };
}

test('host mouth readiness distinguishes generated marks and painted mouth; same-size paints revise tokens', () => {
  const f = fixture(); f.painted.delete(f.realm.jmou);
  const pending = f.reader.capture();
  const entry = (snapshot, source) => snapshot.readiness.find(value => value.source === source);
  assert.equal(pending.host.ecmc, f.realm.ecmc); assert.equal(pending.host.jmou, f.realm.jmou);
  assert.equal(entry(pending, f.realm.ecmc).state, 'ready'); assert.equal(entry(pending, f.realm.jmou).state, 'pending');
  assert(f.calls.some(([kind, source]) => kind === 'generated' && source === f.realm.ecmc));
  assert(f.calls.some(([kind, source]) => kind === 'painted' && source === f.realm.jmou));
  assert(!f.calls.some(([kind, source]) => kind === 'generated' && source === f.realm.jmou));
  assert(!f.calls.some(([kind, source]) => kind === 'painted' && source === f.realm.ecmc));
  assert.equal(f.reader.capture().revision, pending.revision);
  f.painted.add(f.realm.jmou); f.stamps.set(f.realm.jmou, 2);
  const ready = f.reader.capture(); assert(ready.revision > pending.revision);
  assert.equal(entry(ready, f.realm.jmou).state, 'ready');
  assert.notEqual(entry(ready, f.realm.jmou).revision, entry(pending, f.realm.jmou).revision);
  f.stamps.set(f.realm.jmou, 3); const repaint = f.reader.capture();
  assert(repaint.revision > ready.revision);
  assert.notEqual(entry(repaint, f.realm.jmou).revision, entry(ready, f.realm.jmou).revision);
  f.generated.delete(f.realm.ecmc); const marksPending = f.reader.capture();
  assert.equal(entry(marksPending, f.realm.ecmc).state, 'pending');
  assert.equal(entry(ready, f.realm.ecmc).state, 'ready');
});

test('all old source slots, food/prey families, exact aliases and gameplay restrictions remain captured', () => {
  const f = fixture(); const snapshot = f.reader.capture();
  for (const name of ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'jsebi', 'jsepi', 'ecmc', ...f.downloads]) {
    assert.equal(snapshot.host[name], f.realm[name]);
    assert.equal(snapshot.readiness.find(entry => entry.source === f.realm[name]).state, 'ready');
  }
  assert.equal(snapshot.background, f.realm.bg_hex);
  const body = f.realm.per_color_imgs[0].kmcs[0];
  assert.equal(snapshot.readiness.filter(entry => entry.source === body).length, 1);
  for (const name of ['kmcs', 'imgs', 'oimgs', 'gimgs', 'pr_imgs']) assert.equal(snapshot.host.per_color_imgs[0][name][0], body);
  for (const [key, value] of [['render_mode', 1], ['is_mobile', true], ['team_mode', true], ['choosing_skin', true],
    ['building_skin', true], ['testing', true], ['playing', true], ['connecting', true], ['ws', {}]]) {
    const old = f.realm[key]; f.realm[key] = value;
    assert.throws(() => f.reader.capture(), error => error.status === 'unsupported'); f.realm[key] = old;
  }
  f.accessory = '0'; assert.throws(() => f.reader.capture(), /accessory/);
  f.accessory = '-1'; assert.equal(f.reader.capture().ownAccessory, -1);
  f.complete = false; assert.throws(() => f.reader.capture(), error => error.status === 'pending');
});

test('host capture rejects missing, wrong shape/type and accessor mouth slots without invoking accessors', () => {
  for (const slot of ['ecmc', 'jmou']) {
    const f = fixture(); const original = f.realm[slot]; delete f.realm[slot];
    assert.throws(() => f.reader.capture(), error => error.status === 'pending');
    f.realm[slot] = original; original.width++;
    assert.throws(() => f.reader.capture(), /mouth canvas/); original.width--;
    f.realm[slot] = new f.realm.HTMLImageElement(); assert.throws(() => f.reader.capture(), /mouth canvas/);
    let reads = 0;
    Object.defineProperty(f.realm, slot, { configurable: true, get() { reads++; return original; } });
    assert.throws(() => f.reader.capture(), /accessor/); assert.equal(reads, 0);
    Object.defineProperty(f.realm, slot, { configurable: true, value: original });
    Object.defineProperty(original, 'width', { get() { reads++; return 48; } });
    assert.throws(() => f.reader.capture(), /shadow/); assert.equal(reads, 0);
  }
});

test('captured mouth/body sources and readiness stay in one adapter operation through pending-to-painted callbacks', () => {
  const f = fixture(); f.painted.delete(f.realm.jmou); f.adapter.beginOperation();
  const pending = f.adapter.resolveRecipe({ skin: 40 }); assert.equal(pending.status, 'pending');
  assert.equal(pending.recipe, null, 'status-only snapshots never install a face');
  const appearance = f.adapter.resolveAppearance({ skin: 40 }); assert.equal(appearance.face.kind, 'mouth-face');
  f.painted.add(f.realm.jmou); f.stamps.set(f.realm.jmou, 2);
  assert.equal(f.adapter.resolveRecipe({ skin: 40 }).status, 'pending'); assert.equal(f.captures, 1);
  f.adapter.endOperation(); f.adapter.beginOperation();
  const ready = f.adapter.resolveRecipe({ skin: 40 }); assert.equal(ready.status, 'ready');
  assert.equal(ready.recipe.eyes.eyeMarks.asset.source, f.realm.ecmc);
  assert.equal(ready.recipe.eyes.mouth.asset.source, f.realm.jmou);
  assert.equal(f.adapter.resolveRecipe({ skin: 0 }).revision, ready.revision);
  assert.equal(f.captures, 2); f.adapter.endOperation();
});
