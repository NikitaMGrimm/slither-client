import assert from 'node:assert/strict';
import { copyAuthoredSourceRecipes, readAuthoredSourceRecipes } from '../web/authored-source-recipes.mjs';
import { createClientAssetMap } from '../web/client-asset-map.mjs';
import { createSyntheticFoodResolver } from '../web/synthetic-food.mjs';
import { createSyntheticPreyResolver } from '../web/synthetic-prey.mjs';
import { createClientAssetMap as originalAssets } from './fixtures/authored-client-asset-map-oracle.mjs';
import { createSyntheticFoodResolver as originalFood } from './fixtures/authored-food-source-oracle.mjs';
import { createSyntheticPreyResolver as originalPrey } from './fixtures/authored-prey-source-oracle.mjs';
import { authoredSourceRecipesDouble, authoredSourceRealm } from './fixtures/authored-source-fixture.mjs';

/** Shared focused Node/real-Wasm witness; sources and all effects are authored doubles. */
export async function compareAuthoredSourceEffects(raw) {
  const plan = copyAuthoredSourceRecipes(raw), current = authoredSourceRealm(), prior = authoredSourceRealm();
  const a = await createClientAssetMap({ realm: current.realm, sourceRecipes: plan });
  const b = await originalAssets({ realm: prior.realm });
  const random = f => () => { f.events.push(['random']); return .25; };
  const food = createSyntheticFoodResolver(current.realm, random(current), plan.food);
  const oldFood = originalFood(prior.realm, random(prior));
  const prey = createSyntheticPreyResolver(current.realm, random(current), plan.prey);
  const oldPrey = originalPrey(prior.realm, random(prior));
  const metadata = (value, f) => {
    if (Array.isArray(value)) return value.map(entry => metadata(entry, f));
    if (value !== null && typeof value === 'object') {
      if (value instanceof f.realm.HTMLCanvasElement) return { sourceIndex: f.canvases.indexOf(value) };
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, metadata(entry, f)]));
    }
    return value;
  };
  for (let palette = 0; palette < 10; palette++) assert.deepEqual(metadata(food({ palette }), current), metadata(oldFood({ palette }), prior));
  for (let palette = 0; palette < 9; palette++) assert.deepEqual(metadata(prey({ palette }), current), metadata(oldPrey({ palette }), prior));
  assert.deepEqual(current.events, prior.events, 'allocation, dimensions, paint, encode/decode and random order');
  assert.deepEqual(current.canvases.map(canvas => canvas.commands), prior.canvases.map(canvas => canvas.commands));
  assert.equal(current.canvases.length, 335); assert.equal(current.images.length, 2);
  for (const [key, old] of [['palettes', b.palettes], ['bodySources', b.bodySources]]) assert.deepEqual(metadata(a[key], current), metadata(old, prior));
  assert(a.palettes.every(source => current.canvases.includes(source)));
  assert.notEqual(a.background, a.backgroundImage);
  return { canvases: 335, images: 2, commands: current.events.length, randomCalls: current.events.filter(e => e[0] === 'random').length };
}
