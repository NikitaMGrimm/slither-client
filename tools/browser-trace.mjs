import { writeFile } from 'node:fs/promises';

export const traceCategories = ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
  'cc', 'viz', 'gpu', 'benchmark', 'disabled-by-default-gpu.service', 'disabled-by-default-cc.debug'];
export function summarizeTrace(events) {
  const categories = {}, names = {}, tracks = new Set();
  const threadNames = new Map(), processNames = new Map();
  let gpu = 0, raster = 0, presentation = 0;
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args?.name);
    if (e.ph === 'M' && e.name === 'process_name') processNames.set(e.pid, e.args?.name);
    for (const c of (e.cat ?? '').split(',').filter(Boolean)) categories[c] = (categories[c] ?? 0) + 1;
    if (/gpu/i.test(e.cat ?? '')) gpu++;
    if (/raster/i.test(e.name ?? '')) raster++;
    if (/DrawFrame|Display::DrawAndSwap|FramePresented|SwapBuffers|PresentationFeedback/i.test(e.name ?? '')) presentation++;
    if (/gpu|raster|DrawFrame|SwapBuffers/i.test(`${e.cat} ${e.name}`)) {
      names[e.name] = (names[e.name] ?? 0) + 1; tracks.add(`${e.pid}:${e.tid}`);
    }
  }
  return { eventCount: events.length, categories, relevantNames: names,
    relevantTracks: [...tracks].map(id => ({ id, thread: threadNames.get(id) ?? null,
      process: processNames.get(Number(id.split(':')[0])) ?? null })),
    gpuEvents: gpu, rasterEvents: raster, presentationEvents: presentation,
    hasGpuRasterPresentation: gpu > 0 && raster > 0 && presentation > 0,
    limit: 'CDP event presence is not a GPU completion duration or hardware acceleration proof.' };
}
export async function startTrace(browser) {
  const cdp = await browser.newBrowserCDPSession();
  const graphics = await cdp.send('SystemInfo.getInfo');
  const version = await cdp.send('Browser.getVersion');
  const commandLine = await cdp.send('Browser.getBrowserCommandLine');
  if (commandLine.arguments.some(x => /^--disable-gpu(?:=|$)/.test(x))) throw new Error('GPU disabled in actual Chrome command line');
  const available = await cdp.send('Tracing.getCategories');
  const rendererLabels = [graphics.gpu.auxAttributes?.glRenderer,
    graphics.gpu.auxAttributes?.glVendor, ...graphics.gpu.devices.map(x => x.deviceString)].filter(x => typeof x === 'string');
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => { for (const event of value) events.push(event); });
  await cdp.send('Tracing.start', { categories: traceCategories.join(','), options: 'record-as-much-as-possible', transferMode: 'ReportEvents' });
  let stopped = false;
  return { metadata: { version, commandLine, requestedCategories: traceCategories,
    graphicsAssessment: { featureStatus: graphics.gpu.featureStatus,
      softwareRendererDetected: rendererLabels.some(x => /swiftshader|llvmpipe|software|microsoft basic render|\bwarp\b/i.test(x)),
      rendererIdentificationAvailable: rendererLabels.length > 0,
      limit: 'Feature status and renderer metadata describe this process; trace event names alone cannot prove hardware execution.' },
    availableRelevantCategories: available.categories.filter(x => /gpu|raster|viz|^cc$/.test(x)), graphics },
  async stop(file) {
    if (stopped) throw new Error('Trace already stopped'); stopped = true;
    const complete = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP trace completion deadline')), 20000);
      cdp.once('Tracing.tracingComplete', result => { clearTimeout(timeout); resolve(result); });
    });
    await cdp.send('Tracing.end'); const completion = await complete;
    await writeFile(file, JSON.stringify({ traceEvents: events }), { flag: 'wx' });
    await cdp.detach();
    return { ...summarizeTrace(events), completion };
  } };
}
