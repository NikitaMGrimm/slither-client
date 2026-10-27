# Authored client extension packages

The Chrome and Firefox Manifest V3 packages open the existing authored animated
Rust/Wasm preview in an extension-owned tab. The preview runs independently of
a game page's CSP, using generated stand-in artwork and synthetic packets.
This package foundation is not a replacement game client: game-page integration,
host asset/skin mapping, login/HUD, complete connection/input/lifecycle paths and
playable acceptance remain pending.

## Build

Use the pinned tools in [verification](verification.md), then:

```sh
npm run build:web
npm run build:extension
```

The second command packages both browsers without building Rust or installing
dependencies. It requires the existing, explicitly trusted `dist/web` pair:
`slither_client.js` and `slither_client_bg.wasm`. It rejects missing files,
symbolic links, invalid Wasm, missing generated entrypoints, mismatched referenced
Wasm exports, unresolved/nonlocal module imports, and files older than the Rust
sources, Cargo metadata, toolchain file or web builder. Timestamp checks detect
ordinary stale output; they do not attest build provenance. Use a fresh successful
web build and ABI smoke check when validating a candidate. Packaging does not
execute the generated JavaScript or instantiate its Wasm.

Outputs are ignored directories:

- `dist/extension/chrome/manifest.json`
- `dist/extension/firefox/manifest.json`

Each contains exactly 17 files: the browser manifest, action launcher HTML/JS,
license, ten existing preview files under `scene/`, a local configuration with
`simulatorUrl: null`, and the two generated bindings under `scene/pkg/`.
The original `/scene/...` HTML paths and relative module imports resolve against
the extension origin. The build copies those authored preview files unchanged;
it does not package the development HTTP server, external-reference harness,
official code/artwork, capture data, dependencies or Rust build intermediates.

Identical reruns leave output untouched. Different or unexpected existing output
is preserved and causes failure. Select a new destination under the ignored
`dist/extension` directory for another candidate:

```sh
node tools/build-extension.mjs --output-dir dist/extension/candidate-2
```

For an explicitly selected trusted build directory, `--web-dir <directory>`
replaces `dist/web`; there is no search or fallback. The JavaScript API is
`buildExtension({ projectRoot?, webDir?, outputDir? })`, returning
`{ outputDir, files: [{ path, bytes, sha256 }] }` with sorted relative paths.
It uses the same validation and always produces both browser directories.
No ZIP, signing, publication or release workflow is enabled. Repository index
and history guards remain required before delivery; see [provenance](provenance.md)
and [releases](releases.md).

## Extension boundary

Clicking the extension action opens a small launcher popup. Its packaged script
uses `runtime.getURL('scene/animated.html')` and `tabs.create({ url })`, then
closes the popup. It passes no opener, current-tab URL, credentials or host data.
The launcher declares `no-referrer`. Failure stays visible in its status text.
The preview tab owns RAF, Wasm objects, controls and pagehide cleanup.
There is no service worker, background page, content script, web-accessible
resource, storage access or host permission. Opening a tab needs no `tabs`
permission. See [Chrome's Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).

Both manifests restrict scripts to `'self' 'wasm-unsafe-eval'`, styles to
`'self'`, images to `'self' data:`, and connections to `'self'`, with
`default-src 'none'` and `object-src 'none'`. The `data:` image allowance supports
the preview's authored generated background. WebAssembly needs its explicit CSP
allowance; general JavaScript evaluation and inline scripts are not enabled.
See [Chrome CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
and [Mozilla CSP](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy).

The unchanged UI still labels local-simulator controls, but the packaged null
configuration disables connection and CSP grants no local WebSocket destination.
No remote assets or game sockets are used. The numeric extension version is
`0.1.0`; Chrome separately displays `version_name: 0.1.0-alpha.0`, since its
[manifest version](https://developer.chrome.com/docs/extensions/reference/manifest/version)
must use integers. Firefox declares an explicit Gecko ID and no data collection
for this offline slice, following
[Mozilla's manifest requirements](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).
Reassess those declarations before introducing network or host capabilities.

## Offline verification and installation

```sh
node --test tools/build-extension.test.mjs
node tools/wasm-smoke.mjs
npm run build:extension
```

The package tests run with Node's standard library and original synthetic Wasm
fixtures. They cover inventory and byte identity, source exclusions, imports,
browser differences, CSP, missing/stale/malformed bindings, output preservation,
symbolic-link refusal and launcher behavior with both WebExtension API namespaces.
They open no socket and prove neither browser installation nor native pixels.
The ABI smoke uses the real separately built Wasm, as described in
[verification](verification.md).

For a separately authorized stock-Windows browser check:

1. Chrome: open `chrome://extensions`, enable Developer mode, and load the
   unpacked `chrome` directory. Use the [official load-unpacked procedure](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).
2. Firefox: open `about:debugging`, choose **This Firefox**, then **Load Temporary
   Add-on** and select the `firefox/manifest.json`. This
   [temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
   lasts until removal or browser restart; ordinary signed distribution is separate.
3. Click the extension action. Verify the new tab has the browser's extension
   origin, the synthetic scene renders through real Wasm, Step/Reset/palette/gaze
   and resize work, connection stays disabled, and no external request occurs.
4. Close the tab and verify RAF/session cleanup; reload the extension and repeat
   in a fresh context. Record exact browser/build hashes and failed attempts.
   Remove the temporary installation afterward.

These are future acceptance steps, not a claim that installation or native-browser
verification has run for the package. Signed Firefox distribution requires
[Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).
Store submission and publication remain separate release decisions.

## Next host integration slice

Keep the extension-owned preview as a bounded package acceptance target. An
actual game-page replacement needs an authored host adapter with explicit asset,
packet, input and lifetime interfaces; attaching a manifest to the synthetic
preview does not supply those behaviors.

The existing trusted skin provider borrows exact live DOM sources in a supplied
realm. The isolated content-script world cannot directly access page JavaScript
globals. A future page-world adapter must keep host objects and their callbacks
in that realm and pass only bounded plain control/status data across an extension
boundary. Treat that data as untrusted; never expose arbitrary fetch, script
execution or privileged extension operations. MAIN-world code can be inspected
and modified by the host, and the page CSP applies. Extension-page CSP does not
grant a page-world Wasm bypass. See [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
and [Mozilla execution worlds](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld).

Before claiming connected gameplay, implement and test endpoint/profile
selection, challenge-to-setup handoff retaining bundled gameplay commands,
appearance/food/prey/antenna factories and readiness, active-own input gating,
ping/timeouts/backpressure, death/game-over and manual reconnect behavior.
`HandshakeSession` ends at setup, and `connectLoopback` deliberately supports
only direct local login. Neither is the complete browser connection path.
Do not reuse the Node probe's custom Origin header as browser evidence or
consume another official attempt during package validation.
