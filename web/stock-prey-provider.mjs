import { createStockSourceAccess, entityPalette } from './stock-asset-sources.mjs';

const freeze = Object.freeze;
const bodies = freeze(['pr_imgs', 'pr_fws', 'pr_fhs', 'pr_fw2s', 'pr_fh2s']);
const glows = freeze(['gimgs', 'gfws', 'gfhs', 'gfw2s', 'gfh2s']);

// Also used by the combined adapter so cross-factory reentry shares one guard.
export function stockPreyResolver(withSnapshot) {
  return function resolvePrey(request, operation) {
    const color = entityPalette(request, false);
    const { palette, units } = withSnapshot(operation, sources => {
      const record = sources.palette(color);
      return freeze({ color,
        bodies: sources.family(record, bodies, sources.count(record, 'pr_imgs')),
        glows: sources.family(record, glows, sources.count(record, 'gimgs')) });
    });
    return freeze({ randomPhaseUnit: units[0], randomRateUnit: units[1], palette });
  };
}

/** Borrow independent complete prey body/glow families without preselection. */
export function createStockPreyProvider(options) {
  return stockPreyResolver(createStockSourceAccess(options));
}
