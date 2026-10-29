import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyAuthoredSourceRecipes, paintAuthoredCanvas } from '../web/authored-source-recipes.mjs';
import { createClientAssetMap } from '../web/client-asset-map.mjs';
import { createLocalBodyResolver } from '../web/synthetic-body.mjs';
import { createSyntheticFoodResolver } from '../web/synthetic-food.mjs';
import { createSyntheticPreyResolver } from '../web/synthetic-prey.mjs';
import { resolveLocalSkinDouble } from './stock-skin-policy-double.mjs';
import { standardSourceRecipesDouble, standardRgb } from './fixtures/standard-source-fixture.mjs';
import { authoredSourceRecipesDouble, authoredSourceRealm } from './fixtures/authored-source-fixture.mjs';

// All native effects and numeric policy here are explicitly tools-only doubles.
// This tests the real source/recipe/default-host glue, not Rust or browser pixels.
function realm() {
  const calls=[],sources=[];
  class Canvas {
    width=0;height=0;context;
    constructor(){sources.push(this);this.context={
      createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
      putImageData:(image,x,y)=>calls.push({op:'pixels',canvas:this,image:{...image,data:image.data.slice()},x,y}),
      createRadialGradient:(...args)=>({addColorStop(){},args}),
      beginPath(){},arc(){},fill(){},fillRect(){},moveTo(){},lineTo(){},closePath(){}};}
    getContext(kind){assert.equal(kind,'2d');return this.context;}
    toDataURL(){return `inert:${sources.indexOf(this)}`;}
  }
  class Image {complete=false;naturalWidth=0;naturalHeight=0;async decode(){const source=sources[+this.src.split(':')[1]];this.complete=true;this.naturalWidth=source.width;this.naturalHeight=source.height;}}
  return {calls,sources,realm:{HTMLCanvasElement:Canvas,HTMLImageElement:Image,Image,document:{createElement(tag){assert.equal(tag,'canvas');return new Canvas();}}}};
}
test('standard source topology reaches existing local binder without modulo-three color collapse',async()=>{
  const f=realm(),raw=standardSourceRecipesDouble(),copied=copyAuthoredSourceRecipes(raw);
  const assets=await createClientAssetMap({realm:f.realm,sourceRecipes:copied});
  assert.equal(assets.bodySources.palettes.length,42);assert.equal(assets.bodySources.palettes[36].variants.length,60);
  assert.equal(assets.palettes.length,3,'legacy context sources are separate from full body palette');
  assert.deepEqual(copied.tile,copyAuthoredSourceRecipes(authoredSourceRecipesDouble()).tile);
  assert.deepEqual(copied.backdrop,copyAuthoredSourceRecipes(authoredSourceRecipesDouble()).backdrop);
  const bind=createLocalBodyResolver(assets.bodySources,f.realm,resolveLocalSkinDouble);
  const expected=[[10,[9,1,7]],[15,[0,1,2,3,4,5,6,7,8]],[29,[11,4,11,4,11]],[62,[17,39]]];
  for(const [skin,palettes]of expected){const {recipe}=bind({skin,customBytes:new Uint8Array()});assert.deepEqual(recipe.runs.map(r=>r.palette),palettes);for(const r of recipe.runs)assert.equal(recipe.palettes[r.palette].variants[0].asset.source,assets.bodySources.palettes[r.palette].variants[0]);}
  const cycle=bind({skin:60,customBytes:new Uint8Array()}).recipe;assert.equal(cycle.variantMode,'cycle');assert.equal(cycle.variantPeriod,60);
  const custom=bind({skin:29,customBytes:Uint8Array.of(0,0,0,0,0,0,0,0,2,5,3,41,4,39)}).recipe;
  assert.deepEqual(custom.runs,[{palette:5,count:2},{palette:41,count:3},{palette:39,count:4}]);assert.equal(custom.variantMode,'first');
  assert.deepEqual(copied.paletteRgb[0],[192,128,255]);assert.notDeepEqual(copied.paletteRgb[0],copied.paletteRgb[3]);assert.deepEqual(copied.paletteRgb,standardRgb);
  let draws=0;const random=()=>{draws++;return .25;};const food=createSyntheticFoodResolver(f.realm,random,copied.food),prey=createSyntheticPreyResolver(f.realm,random,copied.prey);
  assert.equal(food({palette:0}).palette.bodies.length,17);assert.equal(prey({palette:0}).palette.bodies.length,22);assert.equal(prey({palette:0}).palette.glows.length,17);assert.equal(draws,6);
});
test('pixel source admission copies bytes before native effects and preserves exact thrown undefined',()=>{
  const raw=standardSourceRecipesDouble(),source=raw.bodySources.palettes[0].variants[0],plan=copyAuthoredSourceRecipes(raw),f=realm();
  const before=source.commands[0][3].slice();source.commands[0][3].fill(0);paintAuthoredCanvas(f.realm,plan.bodySources.palettes[0].variants[0]);
  assert.deepEqual(f.calls[0].image.data,Uint8ClampedArray.from(before));
  for(const mutate of [p=>{p.bodySources.palettes[0].variants[0].commands[0][3]=new Uint16Array(48*48*4);},p=>{p.bodySources.palettes[0].variants[0].commands[0][3]=new Uint8Array(2);},p=>{p.bodySources.palettes[0].variants[0].commands[0][1]=4096;},p=>{p.bodySources.palettes[0].variants[0].commands.push(['composite','copy']);}]){const p=standardSourceRecipesDouble();mutate(p);assert.throws(()=>copyAuthoredSourceRecipes(p));}
  const failing=realm();failing.realm.document.createElement=()=>({width:0,height:0,getContext(){throw undefined;}});let caught=false;
  try{paintAuthoredCanvas(failing.realm,plan.bodySources.palettes[0].variants[0]);}catch(error){caught=true;assert.equal(error,undefined);}assert(caught);
});