import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { buildExtension, extensionArguments } from './build-extension.mjs';
import { checkEntry } from './repository-policy.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const pageNames = ['animated.html', 'animated.mjs', 'desktop-layout.mjs', 'scene.css',
  'synthetic-scene.mjs', 'synthetic-body.mjs', 'synthetic-food.mjs', 'synthetic-prey.mjs',
  'skin-provider.mjs', 'loopback-session.mjs'];
const gameWebNames = ['stock-client.mjs', 'stock-skin-provider.mjs', 'stock-skin-rules.mjs',
  'stock-host-snapshot.mjs', 'stock-food-provider.mjs', 'stock-prey-provider.mjs', 'stock-asset-sources.mjs',
  'skin-provider.mjs', 'desktop-layout.mjs', 'client-input.mjs', 'stock-gameplay.mjs',
  'stock-session.mjs', 'stock-hud-contract.mjs', 'handshake-session.mjs', 'stock-live-profile.mjs'];
const gameSources = [['game-activation.mjs', 'activation.mjs'], ['game-gate.js', 'gate.js'],
  ['game-link.js', 'link.js'], ['game-bootstrap.mjs', 'bootstrap.mjs'], ['game-host.css', 'host.css']];

// Original synthetic Wasm with empty constructor exports, never a playable fixture.
function syntheticWasm(omit) {
  const text = value => [...Buffer.from(value)];
  const leb = value => value < 128 ? [value] : [(value & 127) | 128, ...leb(value >>> 7)];
  const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
  const entry = (name, kind, index) => [name.length, ...text(name), kind, index];
  const functions = ['animatedscene_new', 'desktopquality_new',
    'animatedscene_apply_frame_and_render_standard_with_face_presentation_and_prey',
    'animatedscene_render_standard_with_face_presentation_at_size',
    'animatedscene_control_view', 'animatedscene_advance_with_control', 'animatedscene_reset_lag',
    'encode_login', 'solve_challenge', 'decode_frame', 'setup_protocol_version'].filter(name => name !== omit);
  return Buffer.from([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(3, [2, 0, 0]),
    ...section(5, [1, 0, 1]),
    ...section(7, [functions.length + 1, ...entry('memory', 2, 0), ...functions.flatMap(name => entry(name, 0, 0))]),
    ...section(10, [2, 2, 0, 0x0b, 2, 0, 0x0b]),
  ]);
}
const syntheticGlue = `// Original synthetic package-validation fixture; not generated production bindings.
export class AnimatedScene {}
export class DesktopQuality {}
const url = new URL('slither_client_bg.wasm', import.meta.url);
async function __wbg_init() {}
export { __wbg_init as default };
`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slither-extension-test-'));
  const write = (name, bytes) => {
    const destination = path.join(root, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
  };
  for (const name of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'tools/build-web.mjs', 'src/lib.rs']) {
    write(name, '// Original synthetic freshness input.\n');
  }
  write('LICENSE', fs.readFileSync(path.join(projectRoot, 'LICENSE')));
  for (const name of pageNames) write(`web/${name}`, fs.readFileSync(path.join(projectRoot, 'web', name)));
  for (const name of gameWebNames) write(`web/${name}`, fs.readFileSync(path.join(projectRoot, 'web', name)));
  for (const name of ['manifest.chrome.json', 'manifest.firefox.json', 'launcher.html', 'launcher.js', ...gameSources.map(value => value[0])]) {
    write(`extension/${name}`, fs.readFileSync(path.join(projectRoot, 'extension', name)));
  }
  write('dist/web/slither_client.js', syntheticGlue);
  write('dist/web/slither_client_bg.wasm', syntheticWasm());
  const future = new Date('2030-01-01T00:00:00Z');
  for (const name of ['slither_client.js', 'slither_client_bg.wasm']) {
    fs.utimesSync(path.join(root, 'dist/web', name), future, future);
  }
  t.after(() => {
    assert.equal(fs.realpathSync(root), path.resolve(root));
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, write, output: path.join(root, 'dist/extension'), build: options => buildExtension({ projectRoot: root, ...options }) };
}

test('default packages have a closed deterministic inventory and preserve authored inputs byte for byte', t => {
  const f = fixture(t);
  f.write('web/unselected.mjs', 'throw new Error("must never be copied");');
  f.write('dist/web/unselected.wasm', Buffer.from('not a package input'));
  f.write('raw/synthetic-excluded.txt', 'Original synthetic excluded fixture.');
  const expectedPerBrowser = ['LICENSE', 'launcher.html', 'launcher.js', 'manifest.json', 'scene/config.json',
    ...pageNames.map(name => `scene/${name}`), 'scene/pkg/slither_client.js', 'scene/pkg/slither_client_bg.wasm',
    ...gameWebNames.map(name => `game/${name}`), ...gameSources.map(value => `game/${value[1]}`),
    'game/pkg/slither_client.js', 'game/pkg/slither_client_bg.wasm'].sort();
  const result = f.build();
  assert.deepEqual(result.files.map(file => file.path), ['chrome', 'firefox'].flatMap(browser => expectedPerBrowser.map(name => `${browser}/${name}`)));
  assert.equal(result.files.length, 78);
  assert(result.files.every(file => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.deepEqual(f.build(), result, 'an identical rerun neither accumulates nor changes files');
  for (const browser of ['chrome', 'firefox']) {
    for (const name of pageNames) {
      assert.deepEqual(fs.readFileSync(path.join(f.output, browser, 'scene', name)), fs.readFileSync(path.join(f.root, 'web', name)));
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.output, browser, 'scene/config.json'))), { simulatorUrl: null });
    for (const name of expectedPerBrowser.filter(name => !name.endsWith('.wasm'))) {
      assert.deepEqual(checkEntry(name, fs.readFileSync(path.join(f.output, browser, name))), []);
    }
  }
});

test('MV3 browser differences, explicit activation permissions, closed WAR and offline Wasm CSP', t => {
  const f = fixture(t);
  f.build();
  const chrome = JSON.parse(fs.readFileSync(path.join(f.output, 'chrome/manifest.json')));
  const firefox = JSON.parse(fs.readFileSync(path.join(f.output, 'firefox/manifest.json')));
  assert.equal(chrome.version_name, '0.1.0-alpha.0');
  assert.deepEqual(firefox.browser_specific_settings, {
    gecko: { id: 'slither-client@nikitamgrimm', data_collection_permissions: { required: ['authenticationInfo'] } },
  });
  const { version_name, ...sharedChrome } = chrome;
  const { browser_specific_settings, ...sharedFirefox } = firefox;
  assert.deepEqual(sharedChrome, sharedFirefox);
  for (const manifest of [chrome, firefox]) {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, '0.1.0');
    assert.equal(manifest.action.default_popup, 'launcher.html');
    assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
    assert.deepEqual(manifest.web_accessible_resources, [{
      matches: ['http://slither.io/*', 'https://slither.io/*', 'http://www.slither.io/*', 'https://www.slither.io/*'],
      resources: ['game/bootstrap.mjs', 'game/stock-host-snapshot.mjs', 'game/stock-client.mjs', 'game/stock-skin-provider.mjs',
        'game/stock-skin-rules.mjs', 'game/skin-provider.mjs', 'game/stock-food-provider.mjs', 'game/stock-prey-provider.mjs',
        'game/stock-asset-sources.mjs', 'game/desktop-layout.mjs', 'game/client-input.mjs',
        'game/stock-gameplay.mjs', 'game/stock-session.mjs', 'game/stock-hud-contract.mjs', 'game/handshake-session.mjs', 'game/stock-live-profile.mjs',
        'game/pkg/slither_client.js', 'game/pkg/slither_client_bg.wasm'],
    }]);
    for (const key of ['host_permissions', 'optional_host_permissions', 'content_scripts', 'background', 'externally_connectable']) {
      assert.equal(Object.hasOwn(manifest, key), false, key);
    }
    const directives = Object.fromEntries(manifest.content_security_policy.extension_pages.split(';').filter(value => value.trim()).map(value => {
      const [name, ...sources] = value.trim().split(/\s+/);
      return [name, sources];
    }));
    assert.deepEqual(directives['default-src'], ["'none'"]);
    assert.deepEqual(directives['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
    assert.deepEqual(directives['img-src'], ["'self'", 'data:']);
    assert.deepEqual(directives['connect-src'], ["'self'"]);
    assert.deepEqual(directives['object-src'], ["'none'"]);
    assert.doesNotMatch(manifest.content_security_policy.extension_pages, /https?:|wss?:|\*|'unsafe-inline'|'unsafe-eval'/);
  }
});

test('every authored module import, page resource and generated Wasm URL resolves inside each package', t => {
  const f = fixture(t);
  const { files } = f.build();
  const names = new Set(files.map(file => file.path));
  for (const { path: name } of files) {
    const text = name.endsWith('.wasm') ? '' : fs.readFileSync(path.join(f.output, name), 'utf8');
    for (const match of text.matchAll(/^import .+? from ['"]([^'"]+)['"]/gm)) {
      assert(names.has(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]))), `${name}: ${match[1]}`);
    }
  }
  for (const browser of ['chrome', 'firefox']) {
    const base = `chrome-extension://synthetic/${browser}/scene/pkg/slither_client.js`;
    assert.equal(new URL('slither_client_bg.wasm', base).pathname, `/${browser}/scene/pkg/slither_client_bg.wasm`);
    const page = fs.readFileSync(path.join(f.output, browser, 'scene/animated.html'), 'utf8');
    for (const match of page.matchAll(/\b(?:src|href)="([^"]+)"/g)) assert(names.has(`${browser}${match[1]}`));
    assert(names.has(`${browser}/scene/config.json`));
  }
});

for (const name of ['slither_client.js', 'slither_client_bg.wasm']) {
  test(`missing ${name} fails before creating extension output`, t => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.root, 'dist/web', name));
    assert.throws(() => f.build(), /ENOENT/);
    assert.equal(fs.existsSync(f.output), false);
  });
  test(`stale ${name} fails without changing a retained prior package`, t => {
    const f = fixture(t);
    f.build();
    const retained = fs.readFileSync(path.join(f.output, 'chrome/scene/pkg', name));
    const past = new Date('2000-01-01T00:00:00Z');
    fs.utimesSync(path.join(f.root, 'dist/web', name), past, past);
    assert.throws(() => f.build(), /Stale .*npm run build:web/);
    assert.deepEqual(fs.readFileSync(path.join(f.output, 'chrome/scene/pkg', name)), retained);
  });
}

for (const [name, change, expected] of [
  ['non-Wasm bytes', f => f.write('dist/web/slither_client_bg.wasm', Buffer.from('not Wasm')), /valid version-1 WebAssembly/],
  ['truncated Wasm', f => f.write('dist/web/slither_client_bg.wasm', syntheticWasm().subarray(0, 10)), /valid version-1 WebAssembly/],
  ['empty valid Wasm', f => f.write('dist/web/slither_client_bg.wasm', syntheticWasm().subarray(0, 8)), /Wasm\/glue export mismatch/],
  ['wrong generated URL', f => f.write('dist/web/slither_client.js', syntheticGlue.replace('slither_client_bg.wasm', 'elsewhere.wasm')), /generated web entrypoint/],
  ['mismatched glue exports', f => f.write('dist/web/slither_client.js', `${syntheticGlue}\nwasm.absent();`), /Wasm\/glue export mismatch: absent/],
  ['remote module', f => f.write('web/animated.mjs', "import init from 'https://example.invalid/client.js';"), /Nonlocal module import/],
  ['multiline remote module', f => f.write('web/animated.mjs', "import {\n init\n} from 'https://example.invalid/client.js';"), /Nonlocal module import/],
  ['remote re-export', f => f.write('web/animated.mjs', "export { init } from 'https://example.invalid/client.js';"), /Nonlocal module import/],
  ['missing imported module', f => f.write('web/animated.mjs', "import init from './absent.mjs';"), /Missing packaged module/],
  ['dynamic module', f => f.write('web/animated.mjs', "import('./unreviewed.mjs');"), /Dynamic imports require package review/],
  ['source-map payload', f => f.write('web/animated.mjs', JSON.stringify({ ['sources' + 'Content']: ['synthetic excluded content'] })), /embedded source-map/],
  ['missing HTML asset', f => f.write('web/animated.html', '<script src="https://example.invalid/asset.js"></script>'), /Missing packaged page resource/],
]) {
  test(`rejects ${name} before output creation`, t => {
    const f = fixture(t);
    change(f);
    // These invalid binding fixtures are fresh; freshness must not hide the intended validation.
    const future = new Date('2030-01-01T00:00:00Z');
    for (const binding of ['slither_client.js', 'slither_client_bg.wasm']) fs.utimesSync(path.join(f.root, 'dist/web', binding), future, future);
    assert.throws(() => f.build(), expected);
    assert.equal(fs.existsSync(f.output), false);
  });
}

for (const name of ['animatedscene_control_view', 'animatedscene_advance_with_control', 'animatedscene_reset_lag',
  'encode_login', 'solve_challenge', 'decode_frame', 'setup_protocol_version']) {
  test(`missing production gameplay ABI ${name} fails before package output`, t => {
    const f = fixture(t);
    f.write('dist/web/slither_client_bg.wasm', syntheticWasm(name));
    const future = new Date('2030-01-01T00:00:00Z');
    fs.utimesSync(path.join(f.root, 'dist/web/slither_client_bg.wasm'), future, future);
    assert.throws(() => f.build(), new RegExp(`Wasm/glue export mismatch: ${name}`));
    assert.equal(fs.existsSync(f.output), false);
  });
}

test('unrecognized or changed output is preserved rather than merged or overwritten', t => {
  const f = fixture(t);
  f.build();
  f.write('dist/extension/chrome/unreviewed.txt', 'keep existing data');
  assert.throws(() => f.build(), /already exists with different files/);
  assert.equal(fs.readFileSync(path.join(f.output, 'chrome/unreviewed.txt'), 'utf8'), 'keep existing data');
  fs.unlinkSync(path.join(f.output, 'chrome/unreviewed.txt'));
  f.write('dist/extension/chrome/manifest.json', 'keep changed data');
  assert.throws(() => f.build(), /already exists with different files/);
  assert.equal(fs.readFileSync(path.join(f.output, 'chrome/manifest.json'), 'utf8'), 'keep changed data');
});

for (const place of ['output ancestor', 'existing output child', 'source directory', 'build input directory']) {
  test(`rejects a symbolic link at ${place} without writing through it`, t => {
    const f = fixture(t);
    f.write('sentinel/keep.txt', 'keep');
    const link = place === 'output ancestor' ? f.output
      : place === 'existing output child' ? path.join(f.output, 'chrome')
        : path.join(f.root, place === 'source directory' ? 'web' : 'dist/web');
    if (place === 'source directory' || place === 'build input directory') fs.renameSync(link, `${link}-original`);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(f.root, 'sentinel'), link, 'junction');
    assert.throws(() => f.build(), /Symbolic links are not accepted/);
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'sentinel')), ['keep.txt']);
  });
}

test('CLI requires unambiguous paths and confines outputs to the ignored extension directory', t => {
  const f = fixture(t);
  assert.deepEqual(extensionArguments([]), {});
  assert.deepEqual(extensionArguments(['--web-dir', 'dist/web', '--output-dir', 'dist/extension/fresh']), {
    webDir: 'dist/web', outputDir: 'dist/extension/fresh',
  });
  for (const args of [['--web-dir'], ['--output-dir', ''], ['--unknown', 'x'], ['--web-dir', 'x', '--web-dir', 'y']]) {
    assert.throws(() => extensionArguments(args), /Usage:/);
  }
  for (const outputDir of ['dist/elsewhere', '.', 'dist/extension/../../outside']) assert.throws(() => f.build({ outputDir }), /must stay inside/);
  assert.throws(() => f.build({ webDir: 'dist/extension' }), /must be separate/);
  assert.equal(f.build({ outputDir: 'dist/extension/fresh' }).files.length, 78);
});

const launcher = new Script(fs.readFileSync(new URL('../extension/launcher.js', import.meta.url), 'utf8').replace(/^import .+;\r?$/gm, ''));
for (const namespace of ['chrome', 'browser']) {
  test(`${namespace} action popup opens only the packaged page and then closes, without a socket`, async () => {
    const calls = [];
    let closed = 0, sockets = 0;
    const api = {
      runtime: { getURL(resource) { calls.push(['getURL', resource]); return `extension-synthetic://id/${resource}`; } },
      tabs: { async create(options) { calls.push(['create', options]); } },
    };
    const elements = Object.fromEntries(['activate', 'preview', 'status'].map(id => [id, { disabled: false, textContent: '', addEventListener(type, callback) { this.click = callback; } }]));
    launcher.runInNewContext({ [namespace]: api, activateGamePage: () => { throw new Error('Activation was not clicked'); },
      window: { close() { closed++; } },
      document: { getElementById: id => elements[id] },
      WebSocket() { sockets++; throw new Error('Sockets are forbidden'); },
    });
    assert.deepEqual(calls, []);
    await elements.preview.click();
    assert.equal(JSON.stringify(calls), JSON.stringify([
      ['getURL', 'scene/animated.html'], ['create', { url: 'extension-synthetic://id/scene/animated.html' }],
    ]));
    assert.equal(closed, 1);
    assert.equal(sockets, 0);
  });
}

test('launcher reports tab creation failure and keeps its status visible', async () => {
  const status = { textContent: '' };
  const elements = { status, activate: { addEventListener(type, callback) { this.click = callback; } },
    preview: { addEventListener(type, callback) { this.click = callback; } } };
  let closed = false;
  launcher.runInNewContext({ activateGamePage() { throw new Error('Activation was not clicked'); }, browser: {
    runtime: { getURL: () => 'extension-synthetic://id/scene/animated.html' },
    tabs: { create: async () => { throw new Error('synthetic denied tab'); } },
  }, window: { close: () => { closed = true; } }, document: { getElementById: id => elements[id] } });
  await elements.preview.click();
  assert.match(status.textContent, /SlitherClient: Error: synthetic denied tab/);
  assert.equal(closed, false);
  assert.match(fs.readFileSync(new URL('../extension/launcher.html', import.meta.url), 'utf8'), /name="referrer" content="no-referrer"/);
});

for (const mutate of [
  manifest => manifest.web_accessible_resources[0].matches.push('https://*.slither.io/*'),
  manifest => manifest.web_accessible_resources[0].resources.push('scene/animated.mjs'),
  manifest => { manifest.web_accessible_resources[0].extension_ids = ['*']; },
]) {
  test('builder refuses broadened host/resource declarations before output creation', t => {
    const f = fixture(t);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.root, 'extension/manifest.chrome.json')));
    mutate(manifest); f.write('extension/manifest.chrome.json', JSON.stringify(manifest));
    assert.throws(() => f.build(), /web-accessible resources must match/);
    assert.equal(fs.existsSync(f.output), false);
  });
}
