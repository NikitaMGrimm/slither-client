import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const referenceHash = '5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095';
export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export function externalDirectory(input) {
  const directory = fs.realpathSync(input);
  const project = fs.realpathSync(projectRoot);
  if (isWithin(project, directory) || isWithin(directory, project)) throw new Error('Reference and evidence directories must be separate from this repository');
  if (!fs.statSync(directory).isDirectory()) throw new Error('Expected an external directory');
  return directory;
}

/** Optional local oracle. Its trusted harness and official source remain external. */
export async function createReferenceOracle(input) {
  const root = externalDirectory(input);
  const sourceFile = fs.realpathSync(path.join(root, 'raw/game1107249518.js'));
  const harnessFile = fs.realpathSync(path.join(root, 'tests/browser-double.mjs'));
  if (![sourceFile, harnessFile].every(file => isWithin(root, file))) throw new Error('Reference file escapes the supplied root');
  const source = fs.readFileSync(sourceFile);
  assert.equal(sha256(source), referenceHash, 'External reference fingerprint mismatch');
  const { startClient } = await import(pathToFileURL(harnessFile).href);
  const runtime = startClient(source.toString('utf8'));

  function login(nickname, skin = 0, customSkin = []) {
    runtime.context.__prototypeInput = { nickname, skin, customSkin: [...customSkin] };
    const bytes = runtime.run(`
      waiting_for_sos = false;
      nick.value = __prototypeInput.nickname;
      localStorage.snakercv = String(__prototypeInput.skin);
      localStorage.want_custom_skin = __prototypeInput.customSkin.length ? '1' : '0';
      localStorage.custom_skin = __prototypeInput.customSkin.join(',');
      forceOnce('127.0.0.1', 1);
      connect(); ws.onopen(); Array.from(lgba);
    `);
    return Uint8Array.from(bytes);
  }
  const baseline = login('');
  const profile = Object.freeze({ clientVersion: baseline[2] * 256 + baseline[3], password: baseline.slice(4, 24), protocolVersion: 19 });
  return {
    profile,
    login,
    /** The original evaluator is reachable only after the Rust closed grammar accepts. */
    compareChallenge(encoded, wasm) {
      const rust = wasm.solve_challenge(encoded);
      runtime.context.__prototypeChallenge = String.fromCharCode(...encoded);
      const reference = Uint8Array.from(runtime.run('lgba = null; gotServerVersion(__prototypeChallenge); Array.from(idba)'));
      assert.deepEqual(rust, reference, 'Rust and external-reference challenge replies differ');
      return rust;
    },
    decodeDirectory(text) {
      runtime.context.__prototypeDirectory = text;
      return JSON.parse(runtime.run('forcing = false; loadSos(__prototypeDirectory); JSON.stringify(sos.map(s => ({address:s.ip,port:s.po,population:s.ac,active:s.active})))'));
    },
    directoryRequests: runtime.startup.requests.filter(request => request[0] === 'http').map(request => request[1]),
  };
}

export async function loadWasm() {
  const wasm = await import(pathToFileURL(path.join(projectRoot, 'dist/web/slither_client.js')).href);
  wasm.initSync({ module: fs.readFileSync(path.join(projectRoot, 'dist/web/slither_client_bg.wasm')) });
  return wasm;
}
