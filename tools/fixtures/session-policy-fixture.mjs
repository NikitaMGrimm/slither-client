// TEST ONLY explicit SessionPolicy injection; normal npm tests never build Wasm.
import {after} from 'node:test';
import {createStockSession as createAdapter,stockEndpoint} from '../../web/stock-session.mjs';
import {TestSessionPolicy} from './session-policy-double.mjs';
const selected=process.env.SLITHER_SESSION_WASM==='1'
  ?(await(await import('../reference-context.mjs')).loadWasm()).SessionPolicy:TestSessionPolicy;
const owners=[];
export function createStockSession(options){const session=createAdapter({...options,SessionPolicy:options.SessionPolicy??selected});owners.push(session);return session;}
after(()=>{for(const owner of owners.splice(0))owner.dispose();});
export{stockEndpoint,TestSessionPolicy};
