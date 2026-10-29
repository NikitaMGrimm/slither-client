// TEST ONLY explicit gameplay ABI injection; normal tests stay build independent.
import {after} from 'node:test';
import {createStockGameplay as adapter} from '../../web/stock-gameplay.mjs';
import {TestGameplayPolicy} from './gameplay-policy-double.mjs';
const Policy=process.env.SLITHER_GAMEPLAY_WASM==='1'
  ?(await(await import('../reference-context.mjs')).loadWasm()).GameplayPolicy:TestGameplayPolicy;
const owners=[];
export function createStockGameplay(options){const owner=adapter({...options,GameplayPolicy:options.GameplayPolicy??Policy});owners.push(owner);return owner;}
after(()=>{for(const owner of owners.splice(0))owner.dispose();});
export{TestGameplayPolicy};
