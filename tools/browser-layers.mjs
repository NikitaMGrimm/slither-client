// CDP metadata only. No layer snapshots, pictures, pixels or Canvas arguments.
export function safeLayer(layer) {
  return Object.fromEntries(['layerId', 'parentLayerId', 'backendNodeId', 'offsetX', 'offsetY',
    'width', 'height', 'paintCount', 'drawsContent', 'invisible'].filter(k => layer[k] !== undefined).map(k => [k, layer[k]]));
}
export function correlateWorldTrace(events, world) {
  const layerIds = new Set(world.layerIds.map(String));
  const matchedNames = {}, identifierFields = new Set();
  let matches = 0, gpu = 0, raster = 0;
  const frames = new Set();
  function inspect(object, depth = 0) {
    if (!object || typeof object !== 'object' || depth > 4) return false;
    let match = false;
    for (const [key, value] of Object.entries(object)) {
      if (/^(?:layer_?id|backendNodeId|backend_node_id|frame_?id|layerTreeId)$/i.test(key)
        && ['string', 'number'].includes(typeof value)) {
        identifierFields.add(key);
        if (/^layer_?id$/i.test(key) && layerIds.has(String(value))) match = true;
        if (/^backend_?node_?id$/i.test(key) && value === world.backendNodeId) match = true;
        if (/^frame_?id$/i.test(key)) frames.add(String(value));
      } else if (value && typeof value === 'object') match = inspect(value, depth + 1) || match;
    }
    return match;
  }
  for (const event of events) if (inspect(event.args)) {
    matches++; matchedNames[event.name] = (matchedNames[event.name] ?? 0) + 1;
    if (/gpu/i.test(event.cat ?? '')) gpu++;
    if (/raster/i.test(event.name ?? '')) raster++;
  }
  return { worldBackendNodeId: world.backendNodeId, worldLayerIds: [...layerIds],
    directIdentifierMatches: matches, matchedNames, matchingGpuEvents: gpu, matchingRasterEvents: raster,
    observedIdentifierFields: [...identifierFields], observedFrameIdentifierCount: frames.size,
    limit: 'Only exact layer/backend-node identifier fields are matched. Trace/CDP identifier namespace equivalence and GPU resource ownership are not inferred; generic GPU/raster events and missing direct matches do not establish the world Canvas backend.' };
}
export async function observeWorldLayers(context, page, selector) {
  const cdp = await context.newCDPSession(page);
  const changes = [], paints = [], samples = [], seen = new Map();
  let layers = [], dropped = 0, enabled = false;
  const metadata = { selector, backendNodeId: null, layerIds: [], changes, paints, samples,
    limit: 'A missing dedicated Canvas layer is inconclusive. Compositing reasons describe actual mapped layers; they do not measure GPU completion.' };
  cdp.on('LayerTree.layerTreeDidChange', event => {
    layers = (event.layers ?? []).map(safeLayer);
    if (changes.length < 10000) changes.push({ nativeNodeAt: performance.now(), layers }); else dropped++;
    for (const layer of layers) if (layer.backendNodeId === metadata.backendNodeId) seen.set(layer.layerId, layer);
  });
  cdp.on('LayerTree.layerPainted', event => {
    if (paints.length < 10000) paints.push({ nativeNodeAt: performance.now(), layerId: event.layerId, clip: event.clip }); else dropped++;
  });
  try { await cdp.send('DOM.enable'); await cdp.send('LayerTree.enable'); enabled = true; }
  catch { metadata.unavailable = true; }
  async function sample(label) {
    if (!enabled) return;
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) { samples.push({ label, worldNodeMissing: true }); return; }
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: 0 });
    metadata.backendNodeId = node.backendNodeId;
    const matches = layers.filter(layer => layer.backendNodeId === node.backendNodeId);
    const reasons = [];
    for (const layer of matches) {
      seen.set(layer.layerId, layer);
      try { reasons.push({ layerId: layer.layerId, ...await cdp.send('LayerTree.compositingReasons', { layerId: layer.layerId }) }); }
      catch { reasons.push({ layerId: layer.layerId, unavailable: true }); }
    }
    samples.push({ label, nativeNodeAt: performance.now(), backendNodeId: node.backendNodeId,
      nodeName: node.nodeName, matchedLayers: matches, reasons });
    metadata.layerIds = [...seen.keys()];
  }
  await sample('before-arm');
  return { metadata, sample, async stop() {
    await sample('after-replay'); metadata.droppedEvents = dropped;
    if (enabled) { await cdp.send('LayerTree.disable'); await cdp.send('DOM.disable'); }
    await cdp.detach(); return metadata;
  } };
}
