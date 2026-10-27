import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEntry } from './repository-policy.mjs';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const pageFiles = [
  'animated.html', 'scene.css', 'animated.mjs', 'desktop-layout.mjs',
  'synthetic-scene.mjs', 'synthetic-body.mjs', 'synthetic-food.mjs',
  'synthetic-prey.mjs', 'skin-provider.mjs', 'loopback-session.mjs',
];
const bindingFiles = ['slither_client.js', 'slither_client_bg.wasm'];
const gameWebFiles = ['stock-client.mjs', 'stock-skin-provider.mjs', 'stock-skin-rules.mjs',
  'stock-host-snapshot.mjs', 'stock-food-provider.mjs', 'stock-prey-provider.mjs', 'stock-asset-sources.mjs',
  'skin-provider.mjs', 'desktop-layout.mjs', 'client-input.mjs', 'stock-gameplay.mjs',
  'stock-session.mjs', 'stock-hud-contract.mjs', 'stock-hud-state.mjs', 'stock-hud-view.mjs',
  'stock-hud-dom.mjs', 'handshake-session.mjs', 'stock-live-profile.mjs'];
const gameFiles = [['game-activation.mjs', 'activation.mjs'], ['game-gate.js', 'gate.js'],
  ['game-link.js', 'link.js'], ['game-bootstrap.mjs', 'bootstrap.mjs'], ['game-host.css', 'host.css']];

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function noSymlinks(filename) {
  for (let current = path.resolve(filename);;) {
    let info;
    try { info = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info?.isSymbolicLink()) throw new Error(`Symbolic links are not accepted: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function readFile(filename) {
  noSymlinks(filename);
  if (!fs.statSync(filename).isFile()) throw new Error(`Expected a regular file: ${filename}`);
  return fs.readFileSync(filename);
}

function sourceFiles(directory) {
  noSymlinks(directory);
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not accepted: ${filename}`);
    if (entry.isDirectory()) return sourceFiles(filename);
    if (!entry.isFile()) throw new Error(`Expected a regular source file: ${filename}`);
    return [filename];
  });
}

function validateModules(files) {
  for (const [name, bytes] of files) {
    if (!/\.(?:mjs|js)$/.test(name)) continue;
    const source = bytes.toString('utf8');
    if (/\bimport\s*\(/.test(source)) throw new Error(`Dynamic imports require package review: ${name}`);
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/gm)) {
      const specifier = match[1];
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`Nonlocal module import: ${name}: ${specifier}`);
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
      if (!files.has(resolved)) throw new Error(`Missing packaged module: ${name}: ${specifier}`);
    }
  }
}

/** Package an explicitly trusted existing build. This never builds or executes client code. */
export function buildExtension({ projectRoot = defaultRoot, webDir, outputDir } = {}) {
  projectRoot = path.resolve(projectRoot);
  webDir = path.resolve(projectRoot, webDir ?? 'dist/web');
  outputDir = path.resolve(projectRoot, outputDir ?? 'dist/extension');
  const permittedOutput = path.join(projectRoot, 'dist', 'extension');
  if (!within(permittedOutput, outputDir)) throw new Error('Extension output must stay inside dist/extension');
  if (within(webDir, outputDir) || within(outputDir, webDir)) throw new Error('Build input and extension output must be separate');
  noSymlinks(projectRoot);
  noSymlinks(outputDir);

  const bindings = new Map(bindingFiles.map(name => [name, readFile(path.join(webDir, name))]));
  const buildInputs = [
    'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'tools/build-web.mjs', 'web/stock-hud-contract.mjs',
  ].map(name => path.join(projectRoot, name)).concat(sourceFiles(path.join(projectRoot, 'src')));
  const newestSource = Math.max(...buildInputs.map(filename => { readFile(filename); return fs.statSync(filename).mtimeMs; }));
  for (const name of bindingFiles) {
    if (fs.statSync(path.join(webDir, name)).mtimeMs < newestSource) {
      throw new Error(`Stale ${name}; run npm run build:web before packaging`);
    }
  }
  const wasm = bindings.get('slither_client_bg.wasm');
  if (!wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])) || !WebAssembly.validate(wasm)) {
    throw new Error('Expected a valid version-1 WebAssembly build');
  }
  const exports = new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(entry => entry.name));
  const glue = bindings.get('slither_client.js').toString('utf8');
  if (!/export class AnimatedScene\b/.test(glue) || !/export class DesktopQuality\b/.test(glue)
    || !/new URL\(['"]slither_client_bg\.wasm['"], import\.meta\.url\)/.test(glue)
    || !/export\s*\{[^}]*\b__wbg_init as default\s*\}/.test(glue)) {
    throw new Error('Expected the generated web entrypoint for slither_client');
  }
  // Bindgen's crate identifier may change; admit only its one byte-exact authored helper.
  const snippetImports = [...glue.matchAll(/\bfrom\s*['"]\.\/(snippets\/[^'"]+)['"]/g)];
  if (snippetImports.length !== 1
    || !/^snippets\/slither-client-[0-9a-f]{16}\/web\/stock-hud-contract\.mjs$/.test(snippetImports[0][1])) {
    throw new Error('Expected exactly one generated HUD validator module');
  }
  const snippetName = snippetImports[0][1];
  const snippet = readFile(path.join(webDir, snippetName));
  if (!snippet.equals(readFile(path.join(projectRoot, 'web/stock-hud-contract.mjs')))) {
    throw new Error('Generated HUD validator differs from its authored source; rebuild before packaging');
  }
  bindings.set(snippetName, snippet);
  for (const name of ['memory', 'animatedscene_new', 'desktopquality_new',
    'animatedscene_apply_frame_and_render_standard_with_face_presentation_and_prey',
    'animatedscene_apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud',
    'animatedscene_render_standard_with_face_presentation_at_size',
    'animatedscene_control_view', 'animatedscene_advance_with_control', 'animatedscene_reset_lag',
    'encode_login', 'solve_challenge', 'decode_frame', 'setup_protocol_version',
    ...Array.from(glue.matchAll(/\bwasm\.([A-Za-z_]\w*)/g), match => match[1])]) {
    if (!exports.has(name)) throw new Error(`Wasm/glue export mismatch: ${name}`);
  }

  const common = new Map(pageFiles.map(name => [`scene/${name}`, readFile(path.join(projectRoot, 'web', name))]));
  for (const name of ['launcher.html', 'launcher.js']) common.set(name, readFile(path.join(projectRoot, 'extension', name)));
  for (const [source, destination] of gameFiles) common.set(`game/${destination}`, readFile(path.join(projectRoot, 'extension', source)));
  for (const name of gameWebFiles) common.set(`game/${name}`, readFile(path.join(projectRoot, 'web', name)));
  common.set('LICENSE', readFile(path.join(projectRoot, 'LICENSE')));
  common.set('scene/config.json', Buffer.from('{"simulatorUrl":null}\n'));
  for (const [name, bytes] of bindings) {
    common.set(`scene/pkg/${name}`, bytes);
    common.set(`game/pkg/${name}`, bytes);
  }
  for (const [name, bytes] of common) {
    if (name.endsWith('.wasm')) continue;
    const errors = checkEntry(name, bytes);
    if (errors.length) throw new Error(errors.join('\n'));
  }
  validateModules(common);
  const page = common.get('scene/animated.html').toString('utf8');
  for (const match of page.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const resource = match[1];
    const resolved = resource.startsWith('/') ? resource.slice(1) : path.posix.join('scene', resource);
    if (!common.has(resolved)) throw new Error(`Missing packaged page resource: ${resource}`);
  }

  const files = new Map();
  for (const browser of ['chrome', 'firefox']) {
    const manifestBytes = readFile(path.join(projectRoot, 'extension', `manifest.${browser}.json`));
    const errors = checkEntry('manifest.json', manifestBytes);
    if (errors.length) throw new Error(errors.join('\n'));
    const manifest = JSON.parse(manifestBytes);
    const expected = new Set(['game/bootstrap.mjs', ...gameWebFiles.map(name => `game/${name}`),
      ...bindingFiles.map(name => `game/pkg/${name}`)]);
    const declarations = manifest.web_accessible_resources;
    const matches = ['http://slither.io/*', 'https://slither.io/*', 'http://www.slither.io/*', 'https://www.slither.io/*'];
    if (declarations?.length !== 1 || JSON.stringify(Object.keys(declarations[0]).sort()) !== '["matches","resources"]'
      || JSON.stringify(declarations[0].matches) !== JSON.stringify(matches)
      || declarations[0].resources?.length !== expected.size
      || declarations[0].resources.some(name => !expected.delete(name)) || expected.size) {
      throw new Error('Game web-accessible resources must match the exact local module graph and host origins');
    }
    // Source manifests declare fixed resources; bind the generated import to its exact path.
    declarations[0].resources.push(`game/pkg/${snippetName}`);
    files.set(`${browser}/manifest.json`, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    for (const [name, bytes] of common) files.set(`${browser}/${name}`, bytes);
  }
  const inventory = [...files.keys()].sort();
  const result = { outputDir, files: inventory.map(name => ({
    path: name, bytes: files.get(name).length,
    sha256: createHash('sha256').update(files.get(name)).digest('hex'),
  })) };
  if (fs.existsSync(outputDir)) {
    const existing = sourceFiles(outputDir).map(filename => path.relative(outputDir, filename).split(path.sep).join('/')).sort();
    if (JSON.stringify(existing) !== JSON.stringify(inventory)
      || inventory.some(name => !readFile(path.join(outputDir, name)).equals(files.get(name)))) {
      throw new Error('Extension output already exists with different files; select a fresh output directory');
    }
    return result;
  }
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  fs.mkdirSync(outputDir);
  for (const [name, bytes] of files) {
    const destination = path.join(outputDir, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
  }
  return result;
}

export function extensionArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--web-dir': 'webDir', '--output-dir': 'outputDir' }[args[index]];
    if (!key || options[key] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Usage: node tools/build-extension.mjs [--web-dir <trusted build directory>] [--output-dir <fresh dist/extension path>]');
    }
    options[key] = args[index + 1];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildExtension(extensionArguments(process.argv.slice(2)));
    console.log(`Packaged SlitherClient for Chrome and Firefox: ${result.outputDir} (${result.files.length} files).`);
  } catch (error) {
    console.error(`Extension packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
