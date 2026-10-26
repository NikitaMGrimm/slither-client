import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildWeb() {
  const cli = process.env.WASM_BINDGEN || 'wasm-bindgen';
  const expected = '0.2.129';
  const version = execFileSync(cli, ['--version'], { encoding: 'utf8' }).trim();
  if (version !== `wasm-bindgen ${expected}`) throw new Error(`Expected wasm-bindgen ${expected}; received ${version}`);
  // Cargo resolves target directories from both environment and configuration.
  // Keep rendered diagnostics on stderr while selecting only this build's artifacts.
  const output = execFileSync('cargo', ['build', '--release', '--locked', '--lib', '--target', 'wasm32-unknown-unknown', '--message-format=json-render-diagnostics'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  const messages = [];
  for (const line of output.split(/\r?\n/).filter(line => line.trim())) {
    // Procedural macros can print non-JSON lines even in Cargo's JSON mode.
    if (line.startsWith('{')) messages.push(JSON.parse(line));
    else console.log(line);
  }
  const artifacts = messages
    .filter(message => message.reason === 'compiler-artifact'
      && path.resolve(message.manifest_path) === path.resolve('Cargo.toml')
      && message.target.name === 'slither_client'
      && message.target.crate_types.includes('cdylib'))
    .flatMap(message => message.filenames.filter(filename => path.extname(filename) === '.wasm'));
  if (artifacts.length !== 1) throw new Error(`Expected exactly one slither_client cdylib Wasm artifact from Cargo; received ${artifacts.length}`);
  fs.mkdirSync('dist/web', { recursive: true });
  execFileSync(cli, [artifacts[0], '--target', 'web', '--out-dir', 'dist/web', '--out-name', 'slither_client', '--no-typescript'], { stdio: 'inherit' });
  console.log('Built authored Rust/Wasm browser bindings in dist/web (not tracked).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildWeb();
