// Authored fixture-policy/adapter composition only; native renderer execution is separate.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppearancePreviewDouble } from './appearance-preview-double.mjs';
import { stockSkinSourceFixture } from './stock-skin-source-fixture.mjs';
import { isUnsupportedStockAccessoryFace } from '../web/stock-skin-provider.mjs';

const custom = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2);
function selected(f) {
  const source = new f.realm.HTMLImageElement();
  const geometry = { forward: -0, imageScale: 0.375, pivotX: -3.25, pivotY: 7.5 };
  // Synthetic test ID, with no stock catalog meaning.
  f.snapshot.ownAccessory = 71;
  f.snapshot.ownAccessorySelection = { id: 71, geometry, source, width: 48, height: 48 };
  const commitment = { source, state: 'ready', revision: 'selected-1' };
  f.readiness.push(commitment);
  return { source, geometry, commitment };
}
function resolvePreview(f, { local = false, skin = 0, bytes = new Uint8Array() } = {}) {
  const Policy = createAppearancePreviewDouble(), preview = new Policy(local);
  const ticket = preview.select(skin, bytes);
  let request, response, finished = 0;
  f.adapter.beginOperation();
  try {
    const view = preview.render(ticket, {}, {}, value => {
      request = value; response = f.adapter.resolveRecipe(value); return response;
    }, () => ({ finish() { finished++; } }));
    return { request, response, view, finished };
  } finally { f.adapter.endOperation(); preview.free(); }
}

test('stock preview requests existing current-own selection for Paired/Mouth/custom faces', () => {
  for (const [skin, bytes] of [[0, new Uint8Array()], [24, new Uint8Array()], [40, new Uint8Array()],
    [41, new Uint8Array()], [27, custom]]) {
    const f = stockSkinSourceFixture('accessory'), use = selected(f);
    const { request, response, finished } = resolvePreview(f, { skin, bytes });
    assert.equal(request.own, true);
    assert.equal(request.cosmetic, 0);
    assert.equal(Object.hasOwn(request, 'id'), false);
    assert.equal(response.status, 'ready'); assert.equal(finished, 1);
    const attachment = response.recipe.attachment;
    assert.equal(attachment.asset.source, use.source);
    assert.equal(attachment.asset.revision, 'selected-1');
    assert.equal(attachment.sourceMode, 'crop');
    assert.deepEqual(attachment.sourceRect, [+0, +0, 48, 48]);
    assert(Object.is(attachment.forward, -0)); assert.equal(attachment.opacity, 1);
    assert.equal(f.randomCalls, 0);
  }
});

test('local and stock without selection preserve absent attachment and selection ticket independence', () => {
  for (const local of [true, false]) {
    const f = stockSkinSourceFixture('accessory');
    const result = resolvePreview(f, { local });
    assert.equal(result.request.own, !local); assert.equal(result.response.recipe.attachment, null);
  }
  const f = stockSkinSourceFixture('accessory'); selected(f);
  assert.equal(resolvePreview(f, { local: true }).response.recipe.attachment, null);
});

test('selected SingleImage is unsupported and pending/revision/replacement remain adapter-owned', () => {
  const f = stockSkinSourceFixture('accessory'), use = selected(f);
  assert.throws(() => resolvePreview(f, { skin: 27 }), error => error.status === 'unsupported');
  assert.equal(resolvePreview(f).response.recipe.attachment.asset.source, use.source);
  use.commitment.revision = 'selected-2'; f.snapshot.revision = 'capture-2';
  assert.equal(resolvePreview(f).response.recipe.attachment.asset.revision, 'selected-2');
  use.commitment.state = 'pending';
  assert.throws(() => resolvePreview(f), error => error.status === 'pending');
  use.commitment.state = 'ready'; use.source.complete = false;
  assert.throws(() => resolvePreview(f), error => error.status === 'pending');
  use.source.complete = true;
  f.snapshot.ownAccessorySelection.source = new f.realm.HTMLImageElement();
  assert.throws(() => resolvePreview(f), error => error.status === 'pending' || error.status === 'unsupported');
  assert.equal(f.randomCalls, 0);
});

test('only the unchanged authored selected-face throw has private unsupported identity', () => {
  const f = stockSkinSourceFixture('accessory'); selected(f);
  let primary;
  try { resolvePreview(f, { skin: 27 }); } catch (error) { primary = error; }
  assert(primary instanceof TypeError);
  assert.equal(primary.message, 'Selected stock accessory unsupported for this face family');
  assert.equal(primary.status, 'unsupported'); assert.equal(isUnsupportedStockAccessoryFace(primary), true);
  for (const value of [undefined, null, false, 0, '', new TypeError(primary.message),
    { status: 'unsupported' }, { get status() { assert.fail('Private classifier read status'); } }]) {
    assert.equal(isUnsupportedStockAccessoryFace(value), false);
  }
});
