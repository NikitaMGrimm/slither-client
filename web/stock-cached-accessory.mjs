import { ownData, stockInteger } from './stock-skin-rules.mjs';
import { readStockAccessoryMetadata, sameStockAccessorySelection } from './stock-accessory-selection.mjs';
import { createStockAccessoryLoadLease } from './stock-accessory-load.mjs';
import { assertStockAccessoryRequest, handoffStockAccessoryRequest, hasFailedStockAccessoryRequest } from './stock-accessory-request.mjs';

function unavailable(status, message) {
  const error = new TypeError(message); error.status = status; throw error;
}

/** Borrow only the one selected already-loaded cached entry. No catalog copy. */
export function createStockCachedAccessory({ realm, readAccessory, resolveId, native, requestOwner }) {
  let selected, entry, lease, busy = false, disposed = false, poisoned = false;
  function capture() {
    if (disposed || busy || poisoned) unavailable('unsupported', 'Accessory capture disposed, invalidated or reentered');
    busy = true;
    try {
      assertStockAccessoryRequest(requestOwner);
      if (lease?.read().state === 'unsupported') unavailable('unsupported', 'Accessory load invalidated; new session required');
      const raw = readAccessory();
      if (raw === null || raw === '-1') {
        if (selected) unavailable('unsupported', 'Accessory selection changed; new session required');
        return null;
      }
      if (typeof raw !== 'string' || typeof resolveId !== 'function') unavailable('unsupported', 'Rust accessory selection policy required');
      const count = stockInteger(ownData(realm, 'a_ct'), 1, 4096, 'accessory count');
      let id; try { id = resolveId(raw, count); } catch { unavailable('unsupported', 'Invalid persisted accessory selection'); }
      stockInteger(id, 0, count - 1, 'selected accessory');
      const table = ownData(realm, 'a_imgs');
      if (!Array.isArray(table) || table.length !== count) unavailable(selected ? 'unsupported' : 'pending', 'Accessory cache unavailable');
      const cached = ownData(table, String(id));
      if (!cached) unavailable(selected ? 'unsupported' : 'pending', 'Selected accessory entry unavailable');
      if (entry && entry !== cached) unavailable('unsupported', 'Accessory entry replaced; new session required');
      const loaded = ownData(cached, 'loaded');
      if (loaded !== true) unavailable(loaded === false && !selected ? 'pending' : 'unsupported', 'Selected accessory not loaded');
      const source = ownData(cached, 'img');
      if (source == null) unavailable(selected ? 'unsupported' : 'pending', 'Selected accessory image unavailable');
      if (!(source instanceof realm.HTMLImageElement)) unavailable('unsupported', 'Cached accessory requires an existing image');
      const input = Object.freeze({ id, geometry: Object.freeze({ imageScale: ownData(cached, 'sc'),
        pivotX: ownData(cached, 'px'), pivotY: ownData(cached, 'py') }),
      source, width: ownData(cached, 'ww'), height: ownData(cached, 'hh') });
      const snapshot = { ownAccessory: id, ownCachedAccessorySelection: input };
      // A changed pinned binding cannot become initial pending metadata again.
      if (selected && !sameStockAccessorySelection(selected, { ...input, appearanceForward: true })) unavailable('unsupported', 'Accessory binding changed; new session required');
      const metadata = readStockAccessoryMetadata(snapshot, realm);
      if (!lease) {
        selected = metadata; entry = cached;
        try {
          lease = createStockAccessoryLoadLease(source, native);
          // Producer guards stay live until the existing lease has listeners.
          handoffStockAccessoryRequest(requestOwner, source, lease);
        }
        catch (error) { poisoned = true; throw error; }
      }
      const content = lease.read();
      if (content.state !== 'ready') unavailable(content.state, 'Selected accessory load commitment unavailable');
      return Object.freeze({ ...snapshot, commitment: Object.freeze({ source, state: 'ready', revision: content.revision }) });
    } catch (error) {
      if (selected && (hasFailedStockAccessoryRequest(requestOwner) || error?.status !== 'pending')) {
        poisoned = true;
        try { lease?.dispose(); } catch { /* Preserve primary admission failure. */ }
      }
      if (error instanceof Error && !Object.hasOwn(error, 'status') && Object.isExtensible(error)) {
        Object.defineProperty(error, 'status', { value: 'unsupported' });
      }
      throw error;
    } finally { busy = false; }
  }
  return Object.freeze({ capture, assertCurrent() { if (lease) capture(); },
    dispose() { if (disposed) return; disposed = true; lease?.dispose(); } });
}
