import { createStockSkinAdapter } from '../web/stock-skin-provider.mjs';
import { normalCustomPalette } from './stock-skin-policy-oracle.mjs';
import { stockSkinPolicyDouble } from './stock-skin-policy-double.mjs';

// Authored synthetic DOM/source doubles. No external file, runtime or artwork.
export function stockSkinSourceFixture(appearanceMode, policy = stockSkinPolicyDouble) {
  class HTMLCanvasElement {
    #width = 48; #height = 48;
    get width() { return this.#width; } set width(value) { this.#width = value; }
    get height() { return this.#height; } set height(value) { this.#height = value; }
  }
  class HTMLImageElement {
    #complete = true; #width = 48; #height = 48;
    get complete() { return this.#complete; } set complete(value) { this.#complete = value; }
    get naturalWidth() { return this.#width; } set naturalWidth(value) { this.#width = value; }
    get naturalHeight() { return this.#height; } set naturalHeight(value) { this.#height = value; }
  }
  const realm = { HTMLCanvasElement, HTMLImageElement };
  const readiness = [];
  const source = () => {
    const canvas = new HTMLCanvasElement();
    readiness.push({ source: canvas, state: 'ready', revision: `authored-source-${readiness.length}` });
    return canvas;
  };
  const host = { nsr: false, alcsc: Uint8Array.from({ length: 256 }, (_, i) => Number(normalCustomPalette(i))),
    per_color_imgs: Array.from({ length: 42 }, (_, i) => ({
      kmcs: Array.from({ length: i === 36 ? 60 : 7 }, source), klp: i !== 36, kfmc: source() })) };
  for (const slot of ['komc', 'ksmc', 'kdmc', 'acbulb', 'cdbulb', 'kwkbulb', 'pwdbulb', 'playbulb',
    'leafbulb', 'swissbulb', 'moldovabulb', 'vietnambulb', 'argentinabulb', 'movbulb', 'bonkbulb', 'sest',
    'jsebi', 'jsepi', 'ecmc', 'jmou']) host[slot] = source();
  host.jsebi.width = host.jsebi.height = 64;
  host.jmou.width = 79; host.jmou.height = 130;
  let snapshot = { revision: 'authored-1', normalGameplay: true, ownAccessory: -1, host, readiness };
  let reads = 0, randomCalls = 0;
  let random = () => (randomCalls++ % 64) / 64;
  let read = () => snapshot;
  const adapter = createStockSkinAdapter({ ...policy, realm, appearanceMode,
    readSnapshot: () => { reads++; return read(); }, random: () => random() });
  return { adapter, realm, host, readiness, get reads() { return reads; }, get randomCalls() { return randomCalls; },
    get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; },
    set random(value) { random = value; }, set read(value) { read = value; },
    resolve(request) { adapter.beginOperation(); try { return adapter.resolveRecipe(request); } finally { adapter.endOperation(); } } };
}

