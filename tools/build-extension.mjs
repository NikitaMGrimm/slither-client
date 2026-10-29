import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEntry } from './repository-policy.mjs';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const pageFiles = [
  'authored-source-recipes.mjs', 'animated.html', 'scene.css', 'animated.mjs', 'desktop-layout.mjs',
  'synthetic-scene.mjs', 'synthetic-body.mjs', 'synthetic-food.mjs',
  'synthetic-prey.mjs', 'skin-provider.mjs', 'loopback-session.mjs',
];
const bindingFiles = ['slither_client.js', 'slither_client_bg.wasm'];
const gameWebFiles = ['stock-client.mjs', 'stock-skin-provider.mjs', 'stock-skin-rules.mjs', 'stock-accessory-selection.mjs', 'stock-cached-accessory.mjs', 'stock-accessory-load.mjs',
  'stock-host-snapshot.mjs', 'stock-food-provider.mjs', 'stock-prey-provider.mjs', 'stock-asset-sources.mjs',
  'skin-provider.mjs', 'desktop-layout.mjs', 'client-input.mjs', 'stock-gameplay.mjs',
  'stock-session.mjs', 'stock-hud-contract.mjs', 'stock-hud-state.mjs', 'stock-hud-view.mjs',
  'stock-hud-dom.mjs', 'handshake-session.mjs', 'stock-live-profile.mjs',
  'stock-leaderboard-state.mjs', 'stock-leaderboard-view.mjs',
  'local-game-host.mjs', 'client-asset-map.mjs', 'authored-source-recipes.mjs', 'synthetic-body.mjs', 'synthetic-food.mjs', 'synthetic-prey.mjs', 'loopback-session.mjs'];
const gameFiles = [['game-activation.mjs', 'activation.mjs'], ['game-gate.js', 'gate.js'],
  ['game-link.js', 'link.js'], ['game-runtime.mjs', 'runtime.mjs'], ['game-owned-hud-ui.mjs', 'owned-hud-ui.mjs'],
  ['game-owned-play-ui.mjs', 'owned-play-ui.mjs'],
  ['game-owned-appearance-ui.mjs', 'owned-appearance-ui.mjs'],
  ['game-appearance-preview.mjs', 'appearance-preview.mjs'],
  ['game-owned-loading-ui.mjs', 'game-owned-loading-ui.mjs'],
  ['start-page-layout.mjs', 'start-page-layout.mjs'],
  ['game-owned-leaderboard-ui.mjs', 'owned-leaderboard-ui.mjs'],
  ['game-owned-announcement-ui.mjs', 'owned-announcement-ui.mjs'],
  ['game-owned-minimap-ui.mjs', 'owned-minimap-ui.mjs'],
  ['game-owned-end-screen-ui.mjs', 'owned-end-screen-ui.mjs'], ['game-host.css', 'host.css']];

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
export function buildExtension({ projectRoot = defaultRoot, webDir, outputDir, gameEntry = 'default' } = {}) {
  if (gameEntry !== 'default') {
    throw new TypeError('gameEntry must be default');
  }
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
    || !/export class ProfileLiteralParser\b/.test(glue)
    || !/export class DesktopInput\b/.test(glue)
    || !/export class GameplayPolicy\b/.test(glue)
    || !/export class StockControllerPolicy\b/.test(glue)
    || !/export function authored_source_recipes\b/.test(glue)
    || !/export class SessionPolicy\b/.test(glue)
    || !/export class AppearancePreview\b/.test(glue)
    || !/export function desktop_backing_size\b/.test(glue)
    || !/export function menu_loading_view\b/.test(glue)
    || !/export class PlayAdmission\b/.test(glue)
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
  for (const name of ['memory', 'animatedscene_new', 'desktopquality_new', 'desktopinput_new', 'gameplaypolicy_new', 'gameplaypolicy_snapshot', 'gameplaypolicy_timer_action', 'gameplaypolicy_css_ceil', 'gameplaypolicy_set_nickname', 'gameplaypolicy_nickname', 'gameplaypolicy_disposed', 'gameplaypolicy_fatal', 'gameplaypolicy_profile', 'gameplaypolicy_acquiring', 'gameplaypolicy_poison_reentry', 'gameplaypolicy_packet_rejected', 'gameplaypolicy_run_rejected', 'gameplaypolicy_play_rejected', 'gameplaypolicy_live_rejected', 'gameplaypolicy_post_callback_fatal', 'gameplaypolicy_current_allowed', 'gameplaypolicy_mark_dirty', 'gameplaypolicy_dirty', 'gameplaypolicy_may_schedule', 'gameplaypolicy_retain_error', 'gameplaypolicy_reconcile_entry', 'gameplaypolicy_needs_connected', 'gameplaypolicy_connected_done', 'gameplaypolicy_take_status', 'gameplaypolicy_packet_base', 'gameplaypolicy_clear_companion', 'gameplaypolicy_stage_companion', 'gameplaypolicy_take_companion', 'gameplaypolicy_stage_packet', 'gameplaypolicy_publish_pending', 'gameplaypolicy_publication_allowed', 'gameplaypolicy_begin_frame', 'gameplaypolicy_frame_stage', 'gameplaypolicy_begin_control', 'gameplaypolicy_debt_done', 'gameplaypolicy_lifecycle_done', 'gameplaypolicy_reset_input', 'gameplaypolicy_control_done', 'gameplaypolicy_include_announcements', 'gameplaypolicy_include_minimap', 'gameplaypolicy_controller_done', 'gameplaypolicy_score_done', 'gameplaypolicy_commit_profile', 'gameplaypolicy_frame_commit_done', 'gameplaypolicy_finish_frame', 'gameplaypolicy_profile_needs_current', 'gameplaypolicy_profile_available', 'gameplaypolicy_profile_idle', 'gameplaypolicy_begin_profile', 'gameplaypolicy_profile_started', 'gameplaypolicy_profile_retry_allowed', 'gameplaypolicy_profile_retry', 'gameplaypolicy_profile_ready', 'gameplaypolicy_profile_failed', 'gameplaypolicy_replace_local', 'gameplaypolicy_begin_dispose', 'gameplaypolicy_claim_fatal_notification', 'gameplaypolicy_frame_score_required', 'gameplaypolicy_frame_commit_allowed', 'gameplaypolicy_frame_publication_allowed', 'gameplaypolicy_input_allowed', 'gameplaypolicy_history_reset', 'gameplaypolicy_status', '__wbg_gameplaypolicy_free', 'stockcontrollerpolicy_new', 'stockcontrollerpolicy_validate_size', 'stockcontrollerpolicy_validate_time', 'stockcontrollerpolicy_validate_gaze', 'stockcontrollerpolicy_snapshot', 'stockcontrollerpolicy_stage', 'stockcontrollerpolicy_uses_control', 'stockcontrollerpolicy_playing', 'stockcontrollerpolicy_target_width', 'stockcontrollerpolicy_target_height', 'stockcontrollerpolicy_statistics_count', 'stockcontrollerpolicy_is_stopped', 'stockcontrollerpolicy_begin_packet', 'stockcontrollerpolicy_begin_draw', 'stockcontrollerpolicy_begin_update', 'stockcontrollerpolicy_gaze_done', 'stockcontrollerpolicy_advance_done', 'stockcontrollerpolicy_playing_observed', 'stockcontrollerpolicy_quality_done', 'stockcontrollerpolicy_step_observed', 'stockcontrollerpolicy_step_freed', 'stockcontrollerpolicy_observer_done', 'stockcontrollerpolicy_statistics_result', 'stockcontrollerpolicy_packet_succeeded', 'stockcontrollerpolicy_draw_succeeded', 'stockcontrollerpolicy_finish', 'stockcontrollerpolicy_stop', '__wbg_stockcontrollerpolicy_free', 'sessionpolicy_new', 'sessionpolicy_prepare_controls', 'sessionpolicy_commit_controls', 'sessionpolicy_commit_control', 'sessionpolicy_protocol_allowed', 'sessionpolicy_negotiation_packet', 'sessionpolicy_commit_ping', 'sessionpolicy_ping_external', 'sessionpolicy_ping_due_elapsed', 'sessionpolicy_commit_opaque_ping', 'sessionpolicy_lag_check_needed', 'sessionpolicy_observe_lag_elapsed', 'sessionpolicy_death_time', 'sessionpolicy_death_elapsed', 'sessionpolicy_advance_step_elapsed', 'sessionpolicy_valid_input', '__wbg_sessionpolicy_free',
    'animatedscene_apply_frame_and_render_standard_with_face_presentation_and_prey',
    'animatedscene_apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud',
    'animatedscene_render_standard_with_face_presentation_at_size',
    'animatedscene_control_view', 'animatedscene_advance_with_control', 'animatedscene_reset_lag',
    'animatedscene_set_background_backdrop',
    'animatedscene_enable_nicknames',
    'animatedscene_enable_announcement_tracking', 'animatedscene_announcement_view',
    'animatedscene_enable_minimap_tracking', 'animatedscene_observe_minimap_ui_fraction', 'animatedscene_minimap_view',
    'encode_login', 'solve_challenge', 'decode_frame', 'setup_protocol_version',
    'resolve_skin', 'resolve_local_skin', 'stock_custom_palette_mask_valid', 'authored_source_recipes', 'stock_accessory_id', 'stock_accessory_forward', 'start_page_view', 'menu_loading_view', 'desktop_backing_size',
    'profileliteralparser_new',
    'profileliteralparser_write',
    'profileliteralparser_parse_version',
    'profileliteralparser_parse_password',
    'profileliteralparser_password_byte',
    'profileliteralparser_protocol_version',
    'profileliteralparser_clear',
    '__wbg_profileliteralparser_free',
    'endscreenprojector_new', 'endscreenprojector_project', '__wbg_endscreenprojector_free',
    'playadmission_new', 'playadmission_available', 'playadmission_accepted', 'playadmission_nickname_valid',
    'playadmission_accept', 'playadmission_lock_unavailable', 'playadmission_return_ready', 'playadmission_complete_return', '__wbg_playadmission_free',
    'appearancepreview_new', 'appearancepreview_select', 'appearancepreview_revision', 'appearancepreview_needs_draw', 'appearancepreview_render', '__wbg_appearancepreview_free',
    ...Array.from(glue.matchAll(/\bwasm\.([A-Za-z_]\w*)/g), match => match[1])]) {
    if (!exports.has(name)) throw new Error(`Wasm/glue export mismatch: ${name}`);
  }

  const common = new Map(pageFiles.map(name => [`scene/${name}`, readFile(path.join(projectRoot, 'web', name))]));
  for (const name of ['launcher.html', 'launcher.js']) common.set(name, readFile(path.join(projectRoot, 'extension', name)));
  for (const [source, destination] of gameFiles) common.set(`game/${destination}`, readFile(path.join(projectRoot, 'extension', source)));
  common.set('game/bootstrap.mjs', readFile(path.join(projectRoot, 'extension', 'game-bootstrap.mjs')));
  for (const name of gameWebFiles) common.set(`game/${name}`, readFile(path.join(projectRoot, 'web', name)));
  common.set('LICENSE', readFile(path.join(projectRoot, 'LICENSE')));
  common.set('assets/logo.svg', readFile(path.join(projectRoot, 'assets/logo.svg')));
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
    const expected = new Set(['game/bootstrap.mjs', 'game/runtime.mjs', 'game/owned-hud-ui.mjs', 'game/owned-play-ui.mjs',
      'game/owned-appearance-ui.mjs', 'game/appearance-preview.mjs', 'game/game-owned-loading-ui.mjs', 'game/start-page-layout.mjs', 'assets/logo.svg',
      'game/owned-leaderboard-ui.mjs', 'game/owned-minimap-ui.mjs', 'game/owned-end-screen-ui.mjs', 'game/owned-announcement-ui.mjs', ...gameWebFiles.map(name => `game/${name}`),
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
    const key = { __proto__: null, '--web-dir': 'webDir', '--output-dir': 'outputDir', '--game-entry': 'gameEntry' }[args[index]];
    if (!key || options[key] !== undefined || typeof args[index + 1] !== 'string' || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Usage: node tools/build-extension.mjs [--web-dir <trusted build directory>] [--output-dir <fresh dist/extension path>] [--game-entry default]');
    }
    options[key] = args[index + 1];
  }
  if (options.gameEntry !== undefined && options.gameEntry !== 'default') {
    throw new TypeError('gameEntry must be default');
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
