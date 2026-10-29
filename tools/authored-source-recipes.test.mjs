import { compareAuthoredSourceEffects } from './authored-source-effects.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyAuthoredSourceRecipes, readAuthoredSourceRecipes } from '../web/authored-source-recipes.mjs';
import { createClientAssetMap } from '../web/client-asset-map.mjs';
import { createSyntheticFoodResolver } from '../web/synthetic-food.mjs';
import { createSyntheticPreyResolver } from '../web/synthetic-prey.mjs';
import { createClientAssetMap as originalAssets } from './fixtures/authored-client-asset-map-oracle.mjs';
import { createSyntheticFoodResolver as originalFood } from './fixtures/authored-food-source-oracle.mjs';
import { createSyntheticPreyResolver as originalPrey } from './fixtures/authored-prey-source-oracle.mjs';
import { authoredSourceRecipesDouble, authoredSourceRealm } from './fixtures/authored-source-fixture.mjs';


test('explicit source plan preserves every existing source/paint/decode/random operation', async () => {
  await compareAuthoredSourceEffects(authoredSourceRecipesDouble());
});

test('required export and every nested output use own data without executing getters', async () => {
  let calls = 0;
  const getter = { get() { calls++; assert.fail('output getter executed'); }, configurable: true };
  const api = {}; Object.defineProperty(api, 'authored_source_recipes', getter);
  assert.throws(() => readAuthoredSourceRecipes(api), /Own-data/);
  for (const mutate of [raw => Object.defineProperty(raw, 'schema', getter),
    raw => Object.defineProperty(raw.bodySources.effects, 'shadow', getter),
    raw => Object.defineProperty(raw.food[0].bodies[0].commands[2], '0', getter),
    raw => { raw.prey[0].glows[0].width = NaN; },
    raw => { raw.tile.commands[0][0] = { get [Symbol.toPrimitive]() { assert.fail('coercion getter'); } }; }]) {
    const raw = authoredSourceRecipesDouble(), f = authoredSourceRealm(); mutate(raw);
    await assert.rejects(createClientAssetMap({ realm: f.realm, sourceRecipes: raw }), error => error.code !== 'ERR_ASSERTION');
    assert.equal(f.events.length, 0);
  }
  assert.equal(calls, 0);
  assert.throws(() => readAuthoredSourceRecipes({ authored_source_recipes: null }), /Wasm capability/);
});

test('copied source output neither aliases input nor invokes prototype setters', () => {
  const raw = authoredSourceRecipesDouble(); let writes = 0, copied;
  const schema = Object.getOwnPropertyDescriptor(Object.prototype, 'schema');
  const zero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  Object.defineProperty(Object.prototype, 'schema', { configurable: true, set() { writes++; } });
  Object.defineProperty(Array.prototype, '0', { configurable: true, set(value) {
    writes++; Object.defineProperty(this, '0', { value, writable: true, configurable: true, enumerable: true });
  } });
  try { copied = readAuthoredSourceRecipes({ authored_source_recipes: () => raw }); }
  finally {
    if (schema) Object.defineProperty(Object.prototype, 'schema', schema); else delete Object.prototype.schema;
    if (zero) Object.defineProperty(Array.prototype, '0', zero); else delete Array.prototype[0];
  }
  assert.equal(writes, 0);
  raw.paletteRgb[0][0] = 0; raw.tile.commands[0][1] = 'changed';
  assert.equal(copied.paletteRgb[0][0], 131); assert.equal(copied.tile.commands[0][1], '#09131d');
  assert(Object.isFrozen(copied) && Object.isFrozen(copied.food[0].bodies[0].commands));
});

test('missing recipe plan never falls back and decode errors preserve the primary value', async () => {
  const f = authoredSourceRealm();
  await assert.rejects(createClientAssetMap({ realm: f.realm }), /record/);
  assert.equal(f.events.length, 0);
  for (const value of [undefined, new Error('authored decode failure')]) {
    const failed = authoredSourceRealm({ decode() { throw value; } }); let caught = false;
    try { await createClientAssetMap({ realm: failed.realm, sourceRecipes: authoredSourceRecipesDouble() }); }
    catch (error) { caught = true; assert.equal(error, value); }
    assert(caught); assert.equal(failed.canvases.length, 5); assert.equal(failed.images.length, 2);
  }
});
