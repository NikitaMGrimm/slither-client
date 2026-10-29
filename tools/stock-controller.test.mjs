// Authored inert differential requirements; these ordinary tests use an explicit double.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { TestStockControllerPolicy } from './fixtures/stock-controller-double.mjs';
import { stockControllerSmoke, stockControllerLifetimeSmoke, stockControllerAdmissionSmoke } from './stock-controller-smoke.mjs';
const wasm={StockControllerPolicy:TestStockControllerPolicy};
test('tools-only controller oracle differential requirements',()=>{
  const result=stockControllerSmoke(wasm);assert(result.sequences>50);
  console.log('Authored controller DOUBLE differential:',JSON.stringify(result));
});
test('controller ownership construction, retirement and callback failures',()=>assert.equal(stockControllerLifetimeSmoke(wasm).cases,9));
test('production requires the controller ABI and captures its methods',()=>assert.equal(stockControllerAdmissionSmoke(wasm).cases,2));
test('negative controls detect wrong counters, resize commit, playing and statistics decisions',()=>{
  for(const broken of [
    class extends TestStockControllerPolicy { draw_succeeded(){super.draw_succeeded();this.view.draws--;} },
    class extends TestStockControllerPolicy { playing_observed(){super.playing_observed(true);} },
    class extends TestStockControllerPolicy { statistics_result(){super.statistics_result(false);} },
    class extends TestStockControllerPolicy { draw_succeeded(){const w=this.view.width;super.draw_succeeded();this.view.width=w;} },
    class extends TestStockControllerPolicy { charge(n){const old={...this.view};try{super.charge(n);}catch(e){this.view=old;throw e;}} },
  ])assert.throws(()=>stockControllerSmoke({StockControllerPolicy:broken}),assert.AssertionError);
});
test('negative control detects swallowing ordinary-finally free failure',async()=>{
  const source=fs.readFileSync(new URL('../web/stock-client.mjs',import.meta.url),'utf8');
  const target='finally { step.free(); }';assert(source.includes(target));
  const changed=source.replace(target,'finally { try { step.free(); } catch {} }')
    .replace("'./stock-hud-contract.mjs'",JSON.stringify(new URL('../web/stock-hud-contract.mjs',import.meta.url).href));
  const {createStockClient}=await import('data:text/javascript;base64,'+Buffer.from(changed).toString('base64'));
  assert.throws(()=>stockControllerSmoke(wasm,{create:createStockClient}),assert.AssertionError);
});
