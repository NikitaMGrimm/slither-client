import { buildSync } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Bundle the exact packaged authored graph into Chrome's serialized function body.
 * No MAIN import, namespace lookup or external dependency selects a secret recipient. */
export function buildProfileInjection(files) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'slither-profile-injection-'));
  try {
    for (const [name, bytes] of files) {
      if (!name.startsWith('game/') || !/\.(mjs|js)$/.test(name)) continue;
      const target = path.join(temporary, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Each authored module keeps its own extension URL for Wasm/logo resources.
      const source = bytes.toString('utf8').replaceAll('import.meta.url',
        `(__profileBase + ${JSON.stringify(name.slice(5))})`);
      fs.writeFileSync(target, source, { flag: 'wx' });
    }
    // ESM namespace descriptors are data properties. Bundler namespace helpers use
    // getters, which are deliberately rejected by the existing Wasm admission.
    // Resolve the actual exports at build time and emit direct lexical bindings;
    // no mutable MAIN helper constructs/selects the Wasm dependency namespace.
    const metadata = buildSync({ absWorkingDir: temporary, entryPoints: ['game/pkg/slither_client.js'],
      bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true });
    const exports = Object.values(metadata.metafile.outputs)[0].exports.filter(name => name !== 'default');
    if (!exports.length || exports.some(name => !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name))) throw new Error('Expected named Wasm exports');
    const bootstrap = path.join(temporary, 'game/bootstrap.mjs');
    const original = fs.readFileSync(bootstrap, 'utf8');
    const namespace = "import init, * as wasm from './pkg/slither_client.js';";
    if (!original.includes(namespace)) throw new Error('Expected the authored bootstrap Wasm import');
    fs.writeFileSync(bootstrap, original.replace(namespace,
      `import init, { ${exports.join(', ')} } from './pkg/slither_client.js';\nconst wasm = { __proto__: null, ${exports.join(', ')} };`));
    const entry = `import { startGamePage } from './game/bootstrap.mjs';
      async function runPrivateBootstrap() {
        let fixed;
        try { fixed = !delete window.__slitherClientGateNativesV1; } catch { fixed = true; }
        const natives = fixed ? window.__slitherClientGateNativesV1 : undefined;
        const field = typeof natives === 'object' && natives !== null ? natives.descriptor(window, natives.slot) : undefined;
        if (!field || !natives.own(field, 'value') || field.configurable !== false || field.writable !== false) return false;
        try {
          await startGamePage({ profileAuthority: authority, profileGate: field.value });
          return true;
        } finally { field.value.clearExtensionProfileBinding(authority); }
      }`;
    const result = buildSync({ absWorkingDir: temporary,
      stdin: { contents: entry, sourcefile: 'private-entry.mjs', resolveDir: temporary },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'chrome120',
      metafile: true, legalComments: 'none', sourcemap: false, minify: false, treeShaking: false,
    });
    const body = result.outputFiles[0].text;
    if (!body.includes('async function runPrivateBootstrap()') || /\b__export\b|\b__toESM\b/.test(body)
      || Object.values(result.metafile.outputs).some(output => output.imports.length)
      || /\bimport\s*[(]|\bimport\.meta|\beval\s*\(|\bnew\s+Function\b/.test(body)) {
      throw new Error('Private injection must have a closed executable dependency graph');
    }
    const source = `// Generated from the packaged authored graph by pinned esbuild. Not a MAIN module.\n`
      + `export default async function profileBootstrap(bootstrapURL, authority) {\n'use strict';\ntry {\n`
      + `if (globalThis !== globalThis.top || globalThis.location.href !== 'http://slither.com/io'\n`
      + ` || !/^chrome-extension:\\/\\/[a-p]{32}\\/game\\/bootstrap\\.mjs$/.test(bootstrapURL)) return false;\n`
      + `const __profileBase = bootstrapURL.slice(0, -'bootstrap.mjs'.length);\n`
      + body + `\nreturn await runPrivateBootstrap();\n} catch { return false; }\n`
      + `finally { if (authority !== null && authority !== undefined) for (let i = 0; i < authority.length; i++) authority[i] = 0; }\n}\n`;
    return { source, inputs: Object.keys(result.metafile.inputs).sort() };
  } finally {
    // Only the directory freshly allocated above is removed; no retained artifact lives here.
    fs.rmSync(temporary, { recursive: true });
  }
}
