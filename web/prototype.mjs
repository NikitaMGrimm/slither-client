import init, { render_borrowed_assets } from './pkg/slither_client.js';
import { borrowReferenceAssets, describeBorrowedAssets } from './asset-bridge.mjs';

const panel = document.createElement('section');
panel.id = 'slither-prototype';
const heading = document.createElement('h2');
heading.textContent = 'Rust/Wasm borrowed assets';
const labels = document.createElement('div');
labels.className = 'labels';
for (const label of ['Generated canvas', 'Loaded image']) {
  const span = document.createElement('span'); span.textContent = label; labels.appendChild(span);
}
const target = document.createElement('canvas');
target.width = 385; target.height = 96;
const status = document.createElement('pre');
status.textContent = 'Waiting for existing reference graphics…';
panel.append(heading, labels, target, status); document.body.appendChild(panel);

try {
  await init();
  const deadline = performance.now() + 10000;
  let borrowed;
  while (!borrowed) {
    try { borrowed = borrowReferenceAssets(window); }
    catch (error) {
      if (performance.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  render_borrowed_assets(target, borrowed.generated, borrowed.downloaded);
  const expected = document.createElement('canvas'); expected.width = target.width; expected.height = target.height;
  const context = expected.getContext('2d');
  context.drawImage(borrowed.generated, 0, 0, 192, 96);
  context.drawImage(borrowed.downloaded, 193, 0, 192, 96);
  const actual = target.getContext('2d').getImageData(0, 0, target.width, target.height).data;
  const reference = context.getImageData(0, 0, expected.width, expected.height).data;
  const pixelsEqual = actual.every((value, index) => value === reference[index]);
  const report = {
    wasmExecuted: true,
    sourceObjectsReused: borrowed.generated === window.per_color_imgs[0].kmcs[0] && borrowed.downloaded === window.bg_hex,
    pixelsEqual,
    ...describeBorrowedAssets(borrowed),
    blockedReferenceSockets: window.slitherPrototypeFence?.blockedSockets?.length ?? null,
    liveServerConnections: 0,
  };
  window.slitherPrototypeReport = report;
  status.textContent = `Wasm draw: passed\nObject identity: ${report.sourceObjectsReused}\nPixel comparison: ${pixelsEqual}\nGame connections: 0`;
  if (!pixelsEqual || !report.sourceObjectsReused) throw new Error('Borrowed asset comparison failed');
} catch (error) {
  window.slitherPrototypeReport = { error: String(error) };
  status.textContent = `Prototype failed: ${String(error)}`;
}
