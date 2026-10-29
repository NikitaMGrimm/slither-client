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
const pageNames = ['authored-source-recipes.mjs', 'animated.html', 'animated.mjs', 'desktop-layout.mjs', 'scene.css',
  'synthetic-scene.mjs', 'synthetic-body.mjs', 'synthetic-food.mjs', 'synthetic-prey.mjs',
  'skin-provider.mjs', 'loopback-session.mjs'];
const gameWebNames = ['stock-client.mjs', 'stock-skin-provider.mjs', 'stock-skin-rules.mjs', 'stock-accessory-selection.mjs', 'stock-cached-accessory.mjs', 'stock-accessory-load.mjs',
  'stock-host-snapshot.mjs', 'stock-food-provider.mjs', 'stock-prey-provider.mjs', 'stock-asset-sources.mjs',
  'skin-provider.mjs', 'desktop-layout.mjs', 'client-input.mjs', 'stock-gameplay.mjs',
  'stock-session.mjs', 'stock-hud-contract.mjs', 'stock-hud-state.mjs', 'stock-hud-view.mjs',
  'stock-hud-dom.mjs', 'handshake-session.mjs', 'stock-live-profile.mjs',
  'stock-leaderboard-state.mjs', 'stock-leaderboard-view.mjs',
  'local-game-host.mjs', 'client-asset-map.mjs', 'authored-source-recipes.mjs', 'synthetic-body.mjs', 'synthetic-food.mjs', 'synthetic-prey.mjs', 'loopback-session.mjs'];
const gameSources = [['game-activation.mjs', 'activation.mjs'], ['game-gate.js', 'gate.js'],
  ['game-link.js', 'link.js'], ['game-bootstrap.mjs', 'bootstrap.mjs'], ['game-runtime.mjs', 'runtime.mjs'],
  ['game-owned-hud-ui.mjs', 'owned-hud-ui.mjs'], ['game-owned-play-ui.mjs', 'owned-play-ui.mjs'],
  ['game-owned-appearance-ui.mjs', 'owned-appearance-ui.mjs'],
  ['game-appearance-preview.mjs', 'appearance-preview.mjs'],
  ['start-page-layout.mjs', 'start-page-layout.mjs'],
  ['game-owned-leaderboard-ui.mjs', 'owned-leaderboard-ui.mjs'],
  ['game-owned-announcement-ui.mjs', 'owned-announcement-ui.mjs'],
  ['game-owned-minimap-ui.mjs', 'owned-minimap-ui.mjs'],
  ['game-owned-end-screen-ui.mjs', 'owned-end-screen-ui.mjs'], ['game-host.css', 'host.css']];
const snippetName = 'snippets/slither-client-0000000000000000/web/stock-hud-contract.mjs';

// Original synthetic Wasm with empty constructor exports, never a playable fixture.
function syntheticWasm(omit) {
  const text = value => [...Buffer.from(value)];
  const leb = value => value < 128 ? [value] : [(value & 127) | 128, ...leb(value >>> 7)];
  const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
  const entry = (name, kind, index) => [name.length, ...text(name), kind, index];
  const functions = ['animatedscene_new', 'desktopquality_new', 'desktopinput_new', 'sessionpolicy_new', 'sessionpolicy_prepare_controls', 'sessionpolicy_commit_controls', 'sessionpolicy_commit_control', 'sessionpolicy_protocol_allowed', 'sessionpolicy_negotiation_packet', 'sessionpolicy_commit_ping', 'sessionpolicy_ping_external', 'sessionpolicy_ping_due_elapsed', 'sessionpolicy_commit_opaque_ping', 'sessionpolicy_lag_check_needed', 'sessionpolicy_observe_lag_elapsed', 'sessionpolicy_death_time', 'sessionpolicy_death_elapsed', 'sessionpolicy_advance_step_elapsed', 'sessionpolicy_valid_input', '__wbg_sessionpolicy_free',
    'animatedscene_apply_frame_and_render_standard_with_face_presentation_and_prey',
    'animatedscene_apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud',
    'animatedscene_render_standard_with_face_presentation_at_size',
    'animatedscene_control_view', 'animatedscene_advance_with_control', 'animatedscene_reset_lag',
    'animatedscene_set_background_backdrop',
    'animatedscene_enable_nicknames',
    'animatedscene_enable_announcement_tracking', 'animatedscene_announcement_view',
    'animatedscene_enable_minimap_tracking', 'animatedscene_observe_minimap_ui_fraction', 'animatedscene_minimap_view',
    'encode_login', 'solve_challenge', 'decode_frame', 'setup_protocol_version',
    'resolve_skin', 'resolve_local_skin', 'stock_custom_palette_mask_valid', 'authored_source_recipes', 'stock_accessory_id', 'stock_accessory_forward', 'start_page_view', 'desktop_backing_size', 'endscreenprojector_new', 'endscreenprojector_project', '__wbg_endscreenprojector_free',
    'playadmission_new', 'playadmission_available', 'playadmission_accepted', 'playadmission_nickname_valid',
    'playadmission_accept', 'playadmission_lock_unavailable', 'playadmission_return_ready', 'playadmission_complete_return', '__wbg_playadmission_free',
    'profileliteralparser_new',
    'profileliteralparser_write',
    'profileliteralparser_parse_version',
    'profileliteralparser_parse_password',
    'profileliteralparser_password_byte',
    'profileliteralparser_protocol_version',
    'profileliteralparser_clear',
    '__wbg_profileliteralparser_free',
    'appearancepreview_new', 'appearancepreview_select', 'appearancepreview_revision', 'appearancepreview_needs_draw', 'appearancepreview_render', '__wbg_appearancepreview_free'].filter(name => name !== omit);
  return Buffer.from([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(3, [2, 0, 0]),
    ...section(5, [1, 0, 1]),
    ...section(7, [functions.length + 1, ...entry('memory', 2, 0), ...functions.flatMap(name => entry(name, 0, 0))]),
    ...section(10, [2, 2, 0, 0x0b, 2, 0, 0x0b]),
  ]);
}
const syntheticGlue = `// Original synthetic package-validation fixture; not generated production bindings.
import { copyHudIngressPlan, copyHudIngressReport } from './${snippetName}';
export class AnimatedScene {}
export class DesktopQuality {}
export class PlayAdmission {}
export class ProfileLiteralParser {}
export class DesktopInput {}
export function authored_source_recipes() {}
export class SessionPolicy {}
export class AppearancePreview {}
export function desktop_backing_size() {}
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
  write('assets/logo.svg', fs.readFileSync(path.join(projectRoot, 'assets/logo.svg')));
  for (const name of pageNames) write(`web/${name}`, fs.readFileSync(path.join(projectRoot, 'web', name)));
  for (const name of gameWebNames) write(`web/${name}`, fs.readFileSync(path.join(projectRoot, 'web', name)));
  for (const name of ['manifest.chrome.json', 'manifest.firefox.json', 'launcher.html', 'launcher.js', ...gameSources.map(value => value[0])]) {
    write(`extension/${name}`, fs.readFileSync(path.join(projectRoot, 'extension', name)));
  }
  write('dist/web/slither_client.js', syntheticGlue);
  write(`dist/web/${snippetName}`, fs.readFileSync(path.join(projectRoot, 'web/stock-hud-contract.mjs')));
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

test('default packages have a closed deterministic inventory and preserve module inputs byte for byte', t => {
  const f = fixture(t);
  f.write('web/unselected.mjs', 'throw new Error("must never be copied");');
  f.write('dist/web/unselected.wasm', Buffer.from('not a package input'));
  f.write('raw/synthetic-excluded.txt', 'Original synthetic excluded fixture.');
  const expectedPerBrowser = ['assets/logo.svg', 'LICENSE', 'launcher.html', 'launcher.js', 'manifest.json', 'scene/config.json',
    ...pageNames.map(name => `scene/${name}`), 'scene/pkg/slither_client.js', 'scene/pkg/slither_client_bg.wasm', `scene/pkg/${snippetName}`,
    ...gameWebNames.map(name => `game/${name}`), ...gameSources.map(value => `game/${value[1]}`),
    'game/pkg/slither_client.js', 'game/pkg/slither_client_bg.wasm', `game/pkg/${snippetName}`].sort();
  const result = f.build();
  assert.deepEqual(result.files.map(file => file.path), ['chrome', 'firefox'].flatMap(browser => expectedPerBrowser.map(name => `${browser}/${name}`)));
  assert.equal(result.files.length, 136);
  assert(result.files.every(file => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.deepEqual(f.build(), result, 'an identical rerun neither accumulates nor changes files');
  for (const browser of ['chrome', 'firefox']) {
    for (const name of pageNames) {
      assert.deepEqual(fs.readFileSync(path.join(f.output, browser, 'scene', name)), fs.readFileSync(path.join(f.root, 'web', name)));
    }
    for (const name of gameWebNames) {
      assert.deepEqual(fs.readFileSync(path.join(f.output, browser, 'game', name)), fs.readFileSync(path.join(f.root, 'web', name)));
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.output, browser, 'scene/config.json'))), { simulatorUrl: null });
    for (const name of expectedPerBrowser.filter(name => !name.endsWith('.wasm'))) {
      assert.deepEqual(checkEntry(name, fs.readFileSync(path.join(f.output, browser, name))), []);
    }
  }
});

test('generated validator paths remain exact, byte-preserved and independent of the bindgen crate identifier', t => {
  const f = fixture(t);
  const alternate = snippetName.replace('0000000000000000', '1234567890abcdef');
  const helper = fs.readFileSync(path.join(f.root, 'web/stock-hud-contract.mjs'));
  const glue = syntheticGlue.replace(snippetName, alternate);
  f.write(`dist/web/${alternate}`, helper);
  f.write('dist/web/slither_client.js', glue);
  const result = f.build();
  for (const browser of ['chrome', 'firefox']) {
    for (const lane of ['scene', 'game']) {
      assert.deepEqual(fs.readFileSync(path.join(f.output, browser, lane, 'pkg', alternate)), helper);
      assert.equal(fs.readFileSync(path.join(f.output, browser, lane, 'pkg/slither_client.js'), 'utf8'), glue);
      assert.equal(fs.existsSync(path.join(f.output, browser, lane, 'pkg', snippetName)), false);
    }
    const output = JSON.parse(fs.readFileSync(path.join(f.output, browser, 'manifest.json')));
    const source = JSON.parse(fs.readFileSync(path.join(f.root, 'extension', `manifest.${browser}.json`)));
    assert.deepEqual(output.web_accessible_resources[0].resources,
      [...source.web_accessible_resources[0].resources, `game/pkg/${alternate}`]);
    assert(output.web_accessible_resources[0].resources.every(name => !name.includes('*')));
    output.web_accessible_resources[0].resources.pop();
    assert.deepEqual(output, source, 'all source manifest fields remain intact');
  }
  assert.equal(result.files.length, 136);
});

test('changing the authored HUD validator makes the generated pair stale', t => {
  const f = fixture(t);
  fs.utimesSync(path.join(f.root, 'web/stock-hud-contract.mjs'), new Date('2031-01-01'), new Date('2031-01-01'));
  assert.throws(() => f.build(), /Stale .*npm run build:web/);
  assert.equal(fs.existsSync(f.output), false);
});

test('a source manifest cannot preauthorize a generated wildcard or extra resource', t => {
  const f = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, 'extension/manifest.chrome.json')));
  manifest.web_accessible_resources[0].resources.push('game/pkg/snippets/*');
  f.write('extension/manifest.chrome.json', JSON.stringify(manifest));
  assert.throws(() => f.build(), /exact local module graph/);
  assert.equal(fs.existsSync(f.output), false);
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
      resources: ['game/bootstrap.mjs', 'game/runtime.mjs', 'game/owned-hud-ui.mjs', 'game/owned-play-ui.mjs', 'game/owned-appearance-ui.mjs', 'game/appearance-preview.mjs', 'game/start-page-layout.mjs', 'assets/logo.svg', 'game/owned-leaderboard-ui.mjs', 'game/owned-minimap-ui.mjs', 'game/owned-end-screen-ui.mjs', 'game/owned-announcement-ui.mjs', 'game/stock-host-snapshot.mjs', 'game/stock-client.mjs', 'game/stock-skin-provider.mjs',
        'game/stock-skin-rules.mjs', 'game/stock-accessory-selection.mjs', 'game/stock-cached-accessory.mjs', 'game/stock-accessory-load.mjs', 'game/skin-provider.mjs', 'game/stock-food-provider.mjs', 'game/stock-prey-provider.mjs',
        'game/stock-asset-sources.mjs', 'game/desktop-layout.mjs', 'game/client-input.mjs',
        'game/stock-gameplay.mjs', 'game/stock-session.mjs', 'game/stock-hud-contract.mjs', 'game/stock-hud-state.mjs',
        'game/stock-hud-view.mjs', 'game/stock-hud-dom.mjs', 'game/handshake-session.mjs', 'game/stock-live-profile.mjs',
        'game/stock-leaderboard-state.mjs', 'game/stock-leaderboard-view.mjs',
        'game/local-game-host.mjs', 'game/client-asset-map.mjs', 'game/authored-source-recipes.mjs', 'game/synthetic-body.mjs', 'game/synthetic-food.mjs', 'game/synthetic-prey.mjs', 'game/loopback-session.mjs',
        'game/pkg/slither_client.js', 'game/pkg/slither_client_bg.wasm', `game/pkg/${snippetName}`],
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
  ['missing JavaScript session policy export',
    f => f.write('dist/web/slither_client.js', syntheticGlue.replace('export class SessionPolicy {}\n', '')),
    /generated web entrypoint/],
  ['missing JavaScript desktop input export',
    f => f.write('dist/web/slither_client.js', syntheticGlue.replace('export class DesktopInput {}\n', '')),
    /generated web entrypoint/],
  ['missing JavaScript appearance preview export',
    f => f.write('dist/web/slither_client.js', syntheticGlue.replace('export class AppearancePreview {}\n', '')),
    /generated web entrypoint/],
  ['missing JavaScript desktop sizing export',
    f => f.write('dist/web/slither_client.js', syntheticGlue.replace('export function desktop_backing_size() {}\n', '')),
    /generated web entrypoint/],
  ['missing JavaScript authored source recipes export',
    f => f.write('dist/web/slither_client.js', syntheticGlue.replace('export function authored_source_recipes() {}\n', '')),
    /generated web entrypoint/],
  ['missing JavaScript Play admission export',
    f => f.write('dist/web/slither_client.js', syntheticGlue.replace('export class PlayAdmission {}\n', '')),
    /generated web entrypoint/],
  ['missing JavaScript profile literal owner',
    f => f.write('dist/web/slither_client.js', syntheticGlue.replace('export class ProfileLiteralParser {}\n', '')),
    /generated web entrypoint/],
  ['wrong generated URL', f => f.write('dist/web/slither_client.js', syntheticGlue.replace('slither_client_bg.wasm', 'elsewhere.wasm')), /generated web entrypoint/],
  ['mismatched glue exports', f => f.write('dist/web/slither_client.js', `${syntheticGlue}\nwasm.absent();`), /Wasm\/glue export mismatch: absent/],
  ['remote module', f => f.write('web/animated.mjs', "import init from 'https://example.invalid/client.js';"), /Nonlocal module import/],
  ['multiline remote module', f => f.write('web/animated.mjs', "import {\n init\n} from 'https://example.invalid/client.js';"), /Nonlocal module import/],
  ['remote re-export', f => f.write('web/animated.mjs', "export { init } from 'https://example.invalid/client.js';"), /Nonlocal module import/],
  ['missing imported module', f => f.write('web/animated.mjs', "import init from './absent.mjs';"), /Missing packaged module/],
  ['missing HUD validator', f => fs.unlinkSync(path.join(f.root, 'dist/web', snippetName)), /ENOENT/],
  ['changed HUD validator', f => f.write(`dist/web/${snippetName}`, '// Original synthetic incompatible helper.\n'), /differs from its authored source/],
  ['missing generated HUD import', f => f.write('dist/web/slither_client.js', syntheticGlue.replace(/^import .+\n/m, '')), /exactly one generated HUD validator/],
  ['unsupported generated module', f => f.write('dist/web/slither_client.js', syntheticGlue.replace(snippetName, 'snippets/unreviewed.mjs')), /exactly one generated HUD validator/],
  ['additional generated module', f => f.write('dist/web/slither_client.js', `${syntheticGlue}\nimport './snippets/unreviewed.mjs';`), /Missing packaged module/],
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

for (const name of ['desktopinput_new', 'sessionpolicy_new', 'sessionpolicy_prepare_controls', 'sessionpolicy_commit_controls', 'sessionpolicy_commit_control', 'sessionpolicy_protocol_allowed', 'sessionpolicy_negotiation_packet', 'sessionpolicy_commit_ping', 'sessionpolicy_ping_external', 'sessionpolicy_ping_due_elapsed', 'sessionpolicy_commit_opaque_ping', 'sessionpolicy_lag_check_needed', 'sessionpolicy_observe_lag_elapsed', 'sessionpolicy_death_time', 'sessionpolicy_death_elapsed', 'sessionpolicy_advance_step_elapsed', 'sessionpolicy_valid_input', '__wbg_sessionpolicy_free', 'animatedscene_control_view', 'animatedscene_advance_with_control', 'animatedscene_reset_lag',
  'animatedscene_set_background_backdrop',
  'animatedscene_enable_nicknames',
    'animatedscene_enable_announcement_tracking', 'animatedscene_announcement_view',
  'animatedscene_enable_minimap_tracking', 'animatedscene_observe_minimap_ui_fraction', 'animatedscene_minimap_view',
  'animatedscene_apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud',
  'encode_login', 'solve_challenge', 'decode_frame', 'setup_protocol_version',
  'resolve_skin', 'resolve_local_skin', 'stock_custom_palette_mask_valid', 'authored_source_recipes', 'stock_accessory_id', 'stock_accessory_forward', 'desktop_backing_size', 'endscreenprojector_new', 'endscreenprojector_project', '__wbg_endscreenprojector_free',
  'playadmission_new', 'playadmission_available', 'playadmission_accepted', 'playadmission_nickname_valid',
  'playadmission_accept', 'playadmission_lock_unavailable', 'playadmission_return_ready', 'playadmission_complete_return', '__wbg_playadmission_free',
    'profileliteralparser_new',
    'profileliteralparser_write',
    'profileliteralparser_parse_version',
    'profileliteralparser_parse_password',
    'profileliteralparser_password_byte',
    'profileliteralparser_protocol_version',
    'profileliteralparser_clear',
    '__wbg_profileliteralparser_free',
    'appearancepreview_new', 'appearancepreview_select', 'appearancepreview_revision', 'appearancepreview_needs_draw', 'appearancepreview_render', '__wbg_appearancepreview_free']) {
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
  assert.equal(f.build({ outputDir: 'dist/extension/fresh' }).files.length, 136);
});

test('one default package copies the actual bootstrap and all owned UI helpers in both browsers', t => {
  const f = fixture(t), outputDir = 'dist/extension/default';
  const result = f.build({ outputDir });
  assert.equal(result.files.length, 136);
  for (const browser of ['chrome', 'firefox']) {
    const game = path.join(f.root, outputDir, browser, 'game');
    for (const [source, destination] of gameSources) {
      assert.deepEqual(fs.readFileSync(path.join(game, destination)), fs.readFileSync(path.join(f.root, 'extension', source)));
    }
    assert.equal(result.files.filter(file => file.path.startsWith(browser + '/')).length, 67);
    assert.equal(result.files.filter(file => file.path.startsWith(browser + '/')).length, 66);
    assert.deepEqual(fs.readdirSync(game).filter(name => /(?:bootstrap|entry)/.test(name)), ['bootstrap.mjs']);
    const bytes = fs.readFileSync(path.join(game, 'bootstrap.mjs'));
    const stamp = fs.statSync(path.join(game, 'bootstrap.mjs')).mtimeMs;
    assert.deepEqual(f.build({ gameEntry: 'default', outputDir }), result);
    assert.equal(fs.statSync(path.join(game, 'bootstrap.mjs')).mtimeMs, stamp, 'explicit default compatibility does not rewrite');
    for (const gameEntry of ['owned-hud', 'owned-play', 'owned-leaderboard']) {
      assert.throws(() => f.build({ gameEntry, outputDir }), /gameEntry must be default/);
      assert.deepEqual(fs.readFileSync(path.join(game, 'bootstrap.mjs')), bytes);
    }
  }
});

test('game entry API and CLI reject ambiguous and nonstring selection before output mutation', t => {
  const f = fixture(t);
  for (const gameEntry of [null, false, true, 0, '', 'other', 'owned-hud', 'owned-play', 'owned-leaderboard', {}, [], new String('default')]) {
    assert.throws(() => f.build({ gameEntry }), /gameEntry must be/);
    assert.equal(fs.existsSync(f.output), false);
  }
  for (const args of [['--game-entry'], ['--game-entry', ''], ['--game-entry', undefined],
    ['--game-entry', null], ['--game-entry', {}], ['--game-entry', '--web-dir'],
    ['--game-entry', 'default', '--game-entry', 'owned-hud'], ['--game-entry', 'other'], ['--game-entry', 'owned-hud'], ['--game-entry', 'owned-play'],
    ['--game-entry', 'owned-leaderboard'], ['__proto__', 'x']]) {
    assert.throws(() => extensionArguments(args), /Usage:|gameEntry must be/);
    assert.equal(fs.existsSync(f.output), false);
  }
  assert.deepEqual(extensionArguments(['--game-entry', 'default']), { gameEntry: 'default' });
  assert.deepEqual(extensionArguments(['--web-dir', 'trusted', '--game-entry', 'default', '--output-dir', 'dist/extension/fresh']),
    { webDir: 'trusted', gameEntry: 'default', outputDir: 'dist/extension/fresh' });
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
