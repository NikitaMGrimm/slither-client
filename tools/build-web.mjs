import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cli = process.env.WASM_BINDGEN || 'wasm-bindgen';
const expected = '0.2.129';
const version = execFileSync(cli, ['--version'], { encoding: 'utf8' }).trim();
if (version !== `wasm-bindgen ${expected}`) throw new Error(`Expected wasm-bindgen ${expected}; received ${version}`);
execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], { stdio: 'inherit' });
fs.mkdirSync('dist/web', { recursive: true });
execFileSync(cli, [path.resolve('target/wasm32-unknown-unknown/release/slither_client.wasm'), '--target', 'web', '--out-dir', 'dist/web', '--out-name', 'slither_client', '--no-typescript'], { stdio: 'inherit' });
console.log('Built authored Rust/Wasm browser bindings in dist/web (not tracked).');
