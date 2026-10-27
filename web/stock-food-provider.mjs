import { ownData, stockInteger } from './stock-skin-rules.mjs';
import { createStockSourceAccess, entityPalette } from './stock-asset-sources.mjs';
import { stockPreyResolver } from './stock-prey-provider.mjs';

const freeze = Object.freeze;
const families = freeze([
  freeze(['imgs', 'fws', 'fhs', 'fw2s', 'fh2s']),
  freeze(['oimgs', 'ofws', 'ofhs', 'ofw2s', 'ofh2s']),
  freeze(['gimgs', 'gfws', 'gfhs', 'gfw2s', 'gfh2s']),
]);

function foodResolver(withSnapshot) {
  return function resolveFood(request, operation) {
    const color = entityPalette(request, true);
    const { palette, units } = withSnapshot(operation, sources => {
      const record = sources.palette(color);
      const count = stockInteger(ownData(record, 'ic'), 1, 4096, 'food family count');
      const [bodies, outlines, glows] = families.map(slots => sources.family(record, slots, count));
      return freeze({ color, count, bodies, outlines, glows });
    });
    return freeze({ randomPhaseUnit: units[0], randomWobbleUnit: units[1], palette });
  };
}

/** Borrow actual existing food families; Rust selects creation-time indices. */
export function createStockFoodProvider(options) {
  return foodResolver(createStockSourceAccess(options));
}

/** Share the operation/reentry guard and supplied entropy across both factories. */
export function createStockEntityAssets(options) {
  const access = createStockSourceAccess(options);
  return freeze({ resolveFood: foodResolver(access), resolvePrey: stockPreyResolver(access) });
}
