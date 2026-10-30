// TEST ONLY explicit controller injection; normal tests do not load/build Wasm.
import { after } from 'node:test';
import { createStockClient as adapter } from '../../web/stock-client.mjs';
import { TestStockControllerPolicy } from './stock-controller-double.mjs';
const Policy = process.env.SLITHER_CONTROLLER_WASM === '1'
  ? (await (await import('../wasm-test-context.mjs')).loadWasm()).StockControllerPolicy : TestStockControllerPolicy;
const owners = [];
export function createStockClient(options) {
  const owner = adapter({ ...options, StockControllerPolicy: options.StockControllerPolicy ?? Policy });
  owners.push(owner); return owner;
}
after(() => {
  const failures = [];
  for (const owner of owners.splice(0)) {
    try { owner.dispose(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Stock client fixture cleanup failed');
});
export { TestStockControllerPolicy };
