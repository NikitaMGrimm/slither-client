import assert from 'node:assert/strict';
import { copyAuthoredSourceRecipes } from '../web/authored-source-recipes.mjs';
import { authoredSourceRecipesDouble } from './fixtures/authored-source-fixture.mjs';
import { compareStandardSourceEffects } from './authored-source-effects.mjs';

/** Run only at the approved fresh-build checkpoint. Logical sources, never browser pixels. */
export async function authoredSourcesSmoke(wasm) {
  const raw = wasm.authored_source_recipes();
  const copied = copyAuthoredSourceRecipes(raw);
  const legacy=copyAuthoredSourceRecipes(authoredSourceRecipesDouble());
  assert.deepEqual(copied.tile,legacy.tile,'intended background remains unchanged');
  assert.deepEqual(copied.backdrop,legacy.backdrop);assert.equal(copied.paletteRgb.length,42);
  assert.deepEqual(copied.paletteRgb[0],[192,128,255]);assert.deepEqual(copied.paletteRgb[39],[104,40,170]);
  const sample=(recipe,x,y)=>{const c=recipe.commands[0];assert.equal(c[0],'pixels');return [...c[3].slice((y*c[1]+x)*4,(y*c[1]+x)*4+4)];};
  assert.deepEqual(sample(copied.bodySources.palettes[0].variants[0],24,24),[234,156,255,255]);
  assert.deepEqual(sample(copied.bodySources.palettes[0].variants[3],24,24),[192,128,255,255]);
  assert.deepEqual(sample(copied.bodySources.palettes[0].variants[6],24,24),[149,99,198,255]);
  assert.deepEqual(sample(copied.bodySources.effects.outline,26,26),[0,0,0,0]);
  assert.deepEqual(sample(copied.bodySources.effects.outline,42,26),[0,0,0,204]);
  const effects = await compareStandardSourceEffects(raw, wasm.resolve_local_skin);
  raw.paletteRgb[0][0] = 0; raw.bodySources.palettes[0].variants[0].commands[0][3].fill(0);
  assert.deepEqual(copyAuthoredSourceRecipes(wasm.authored_source_recipes()), copied, 'fresh Wasm copies cannot alias');
  const menu = new wasm.MenuPreferences(true,'1:5361766564:0a:');
  try {
    const chosen=menu.view();assert.equal(chosen.skin,10);
    assert.deepEqual(wasm.resolve_local_skin(chosen.skin,chosen.customSkin).runs,
      [{palette:9,count:5},{palette:1,count:5},{palette:7,count:5}]);
    const bytes=wasm.encode_login(1,new Uint8Array(20),chosen.nickname,chosen.skin,chosen.customSkin);
    assert.equal(bytes[24],10,'existing explicit Play login encoding retains selected full-color builtin');
  } finally { menu.free(); }
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
  return { ...effects, knownMaterialSamples: true, freshCopies: true, prototypeSetters: 0,
    evidence: 'authored source recorder and real Rust numeric plans; no browser/pixels/installed-host acceptance' };
}
