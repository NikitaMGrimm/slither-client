import assert from 'node:assert/strict';
import { copyAuthoredSourceRecipes } from '../web/authored-source-recipes.mjs';
import { authoredSourceRecipesDouble } from './fixtures/authored-source-fixture.mjs';
import { compareAuthoredSourceEffects } from './authored-source-effects.mjs';

/** Run only at the approved fresh-build checkpoint. Logical sources, never browser pixels. */
export async function authoredSourcesSmoke(wasm) {
  const raw = wasm.authored_source_recipes();
  const copied = copyAuthoredSourceRecipes(raw);
  assert.deepEqual(copied, copyAuthoredSourceRecipes(authoredSourceRecipesDouble()), 'every Rust dimension/paint operand exactly matches the authored pre-R7 oracle');
  const effects = await compareAuthoredSourceEffects(raw);
  raw.paletteRgb[0][0] = 0; raw.food[0].bodies[0].commands[0][1] = 'changed';
  assert.deepEqual(copyAuthoredSourceRecipes(wasm.authored_source_recipes()), copied, 'fresh Wasm copies cannot alias');
  let writes = 0, result;
  const schema = Object.getOwnPropertyDescriptor(Object.prototype, 'schema');
  const zero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
  Object.defineProperty(Object.prototype, 'schema', { configurable: true, set() { writes++; } });
  Object.defineProperty(Array.prototype, '0', { configurable: true, set(value) {
    writes++; Object.defineProperty(this, '0', { value, configurable: true, writable: true, enumerable: true });
  } });
  try { result = wasm.authored_source_recipes(); }
  finally {
    if (schema) Object.defineProperty(Object.prototype, 'schema', schema); else delete Object.prototype.schema;
    if (zero) Object.defineProperty(Array.prototype, '0', zero); else delete Array.prototype[0];
  }
  assert.equal(writes, 0, 'native serialization does not invoke prototype setters');
  assert.deepEqual(copyAuthoredSourceRecipes(result), copied);
  return { ...effects, exactPlan: true, freshCopies: true, prototypeSetters: 0,
    evidence: 'authored source recorder and real Rust numeric plans; no browser/pixels/installed-host acceptance' };
}
