// TEST ONLY explicit controller injection; normal tests do not load/build Wasm.
import { after } from 'node:test';
import { createStockClient as adapter } from '../../web/stock-client.mjs';
import { TestStockControllerPolicy } from './stock-controller-double.mjs';
const Policy = process.env.SLITHER_CONTROLLER_WASM === '1'
  ? (await (await import('../reference-context.mjs')).loadWasm()).StockControllerPolicy : TestStockControllerPolicy;
const owners = [];
export function createStockClient(options) {
  const owner = adapter({ ...options, StockControllerPolicy: options.StockControllerPolicy ?? Policy });
  owners.push(owner); return owner;
}
after(() => { for (const owner of owners.splice(0)) owner.dispose(); });
export { TestStockControllerPolicy };
