import fs from 'node:fs';

/** Load this checkout's generated ABI; no reference program or network. */
export async function loadWasm() {
  const wasm = await import('../dist/web/slither_client.js');
  wasm.initSync({ module: fs.readFileSync(new URL('../dist/web/slither_client_bg.wasm', import.meta.url)) });
  return wasm;
}
