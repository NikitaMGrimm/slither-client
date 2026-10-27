# Browser extension

Chrome and Firefox Manifest V3 packages contain two explicit action choices.
**Activate on this game page** installs the authored MAIN-world bootstrap on a
supported game home page; **Open offline preview** opens the existing synthetic
Rust/Wasm preview in an extension tab. Activation reloads the selected page and
never starts a game connection. The bootstrap binds the actual stock skin, food
and prey adapters to the stock packet/update/draw controller, reporting
`ready-not-connected` when its borrowed sources are ready.

The local trusted runtime also composes the authored session and desktop input
through the native pre-motion control seam. Play requires a selected endpoint
and either an explicit external profile or an explicit request for bounded
pinned profile acquisition on canonical HTTPS. Activation supplies neither and
starts no acquisition. A Play UI, HUD/minimap, unsupported appearances/modes,
live acquisition/host/CSP and server acceptance remain separate.

## Build

Use the pinned tools in [verification](verification.md), then:

```sh
npm run build:web
node tools/wasm-smoke.mjs
npm run build:extension
```

Packaging uses an explicitly trusted existing `dist/web/slither_client.js` and
`slither_client_bg.wasm` and the glue's generated shared-validator module. The
selected `snippets/slither-client-<identifier>/web/stock-hud-contract.mjs` must
match the authored validator byte-for-byte. Its identifier is discovered from
the static glue import; no other generated module is admitted. Packaging
does not build Rust, install dependencies, execute
generated JavaScript or instantiate Wasm. It validates Wasm magic/structure,
generated entrypoints and referenced exports, including generalized face
packet/render APIs and the control/session exports. Missing, stale, malformed or mismatched files fail. Source
timestamps detect ordinary stale output, without attesting build provenance.
Use a fresh successful build and real ABI smoke for each candidate.

The default produces both ignored directories:

- `dist/extension/chrome`
- `dist/extension/firefox`

Each contains exactly 42 files: the original preview package, fixed game
activation/gate/link/bootstrap/CSS, sixteen authored game modules and a generated
JS/Wasm/validator module graph for each renderer. Preview HTML/modules are copied unchanged
under `scene/`; null simulator configuration disables its local connection.
The game entry imports no synthetic resolver or fixture.

Source manifests declare the fixed resource list. Packaging adds the verified
generated validator's exact game-local path to each output manifest. Other
manifest fields, origin matches, permissions and CSP are preserved; output
resources contain no wildcard. Generated module bytes and glue are copied
unchanged into both `scene/pkg` and `game/pkg`.

Only explicit files are copied. There is no reference harness, official code or
artwork, capture, dependency tree, server binary or Rust build intermediate.
Authored inputs pass the repository entry guard; generated outputs remain outside
Git. Index/history guards remain required before delivery. No ZIP, signing,
publication or release automation is enabled.

Identical reruns do not rewrite files. Differing/unexpected output is preserved
and fails. Select a fresh candidate directory:

```sh
node tools/build-extension.mjs --output-dir dist/extension/candidate-2
```

`--web-dir <trusted directory>` explicitly selects a different build pair; no
search or fallback occurs. API:
`buildExtension({ projectRoot?, webDir?, outputDir? })` returns
`{ outputDir, files: [{ path, bytes, sha256 }] }` with sorted relative paths.
Output stays under ignored `dist/extension`, separate from input. Input/output
symlinks are rejected. See [provenance](provenance.md) and [releases](releases.md).

## Activation and ownership

The popup performs no activation until its button is clicked. It needs only
`activeTab` and `scripting`: no permanent host permissions, `tabs`, storage,
webRequest, DNR, native messaging or background context. Supported URLs are
HTTP/HTTPS `slither.io` and explicitly named `www.slither.io`, with `/` or
`/index.html`, no query/fragment/credentials, other port or wildcard subdomain.

Activation registers fixed MAIN and ISOLATED document-start scripts for those
origins with `allFrames:false`, `persistAcrossSessions:false`. It then writes a
single-use 30-second session-storage arm and reloads the same selected tab.
API failure or observed navigation change aborts. Without a valid arm the gate
leaves native APIs untouched. The page-readable marker is not an authentication
boundary against that page and authorizes no privileged bridge operation.

On the armed reload, MAIN captures native scheduling before the host captures
RAF aliases, then holds host RAF/timers, WebSocket construction and input/resize
dispatch. It never invokes or replays those callbacks. Our bootstrap privately
claims the native capabilities once. Existing page startup may construct its
artwork normally; our code calls no original connect, skin, simulation, draw,
packet or asset-generation function. A late gate refuses ownership. **Reload
ordinary page** clears the arm before reload; old callbacks are not a fallback.

The isolated link loads one fixed `runtime.getURL('game/bootstrap.mjs')` module
in the page realm. Only its exact transitive JS/Wasm set is web accessible, scoped
to the four named origins. Preview resources, gate, link and activation scripts
are absent from that declaration. The builder refuses broader resources/origins.
The worlds exchange bounded typed status/query only: no packet input, callbacks,
DOM source clones, arbitrary fetch or extension commands.

Bootstrap, Wasm, controller, providers, target and borrowed assets all remain in
MAIN. Exact canvas/image references are preserved without copying pixels, object
URLs, cross-origin cloning or an extension iframe. The host is a trusted
compatibility boundary, not a sandbox against hostile page scripts.

## Readiness and captured operations

The gate observes native Canvas writes before startup. Generated canvases require
successful supported painting before the completed construction checkpoint.
Mutation stamps alone never establish readiness: dimensions, clear/reset and
failed paints invalidate the painting commitment even before that checkpoint. Download-painted
bulbs/side sources require their final native whole-source write; dimensions or
a completed download do not establish a painted canvas. Reset, clear, repaint,
failed writes and dimension assignment invalidate readiness. No pixels are read
and no original image handler/generator is invoked.

`createStockHostSnapshot` captures own-data metadata, exact sources and explicit
commitments, including the single-image eye sources. It requires the supported
desktop standard mode, normal custom policy, no team/chooser/builder/testing mode,
no original session and no selected static accessory. Missing metadata/sources
are pending or unsupported. Full selectable entity families and independent
declared metrics are copied; Rust owns creation-index selection. Revision changes
cover identity/order, dimensions, readiness/painting, policy and metrics, including
signed-zero metric changes.
Each commitment also carries a stable per-source content revision derived from
native paint observation, identity and intrinsic state. Unrelated capture changes
do not relabel untouched sources. Entity and recipe source projections must use
those commitments consistently; a transaction version is not an asset revision.

One stock-skin `beginOperation` captures one raw view. Food/prey callbacks receive
that same held snapshot/revision without rereading globals. Outer begin/end
wrappers release it after success/failure. Packet Setup draws use the generalized
face API. RAF calls one controller frame; resize draws without another update.
Pointer gaze uses authored CSS/window geometry before that update. No original
or synthetic presentation path runs alongside it.

The entry waits at most ten seconds for ready sources before constructing scene
and quality owners. Missing capability, changed context source or unsupported
mode stops the path; it does not substitute palettes or replay packets against
a different capture/random tape. Pagehide/error cleanup stops scheduling and the
injected session, releases listeners/capture, disposes the controller and frees
owned Wasm objects once. Numeric rollback cannot undo native pixels or callback
effects.

## Session and input boundary

Default state is `ready-not-connected`. The exported MAIN runtime exposes local
`play(request)`, `playWithLiveProfile(request)`, `diagnostics()` and `dispose()`
capabilities. External-profile Play requires
`{endpoint,profile:{clientVersion,password,protocolVersion:19},nickname,skin,customSkin}`;
the password is a caller-supplied 20-byte Uint8Array. Endpoint is one selected
literal IP with explicit port and `/slither`, using ws/wss. No discovery, DNS
selection, stored profile, defaults, automatic Play or retry exists.
No credential, packet or socket command is accepted through the status bridge.
The installed entry offers no Play UI yet; this local API is for explicit trusted
composition. An importing MAIN module can await exported
`gamePageRuntime`, the single auto-entry promise, to obtain this runtime without
claiming the gate again; nothing is installed on `window` for this purpose.

The separate asynchronous `playWithLiveProfile` path requests the exact pinned
same-origin script only after explicit invocation in canonical, top-level, secure
`https://slither.io`. Optional captured native capabilities are absent on HTTP,
www or unsupported environments; the external-profile path remains available.
The acquirer observes complete EOF and verifies exact length/SHA-256 before
closed numeric parsing. Owned source/digest bytes clear before the synchronous
private consumer stages Play, and its borrowed password clears afterward.
No source or profile is returned, cached, logged or sent through the bridge.
See [the runtime policy](provenance.md#explicit-play-profile-acquisition).

There is at most one acquisition attempt per document, with no fallback or retry.
Current document, intent and ready source commitments are rechecked during
acquisition. Staged launch cannot advance or commit while acquisition is pending;
rejection after staging cancels it before any socket can open. On success, the
normal native reset and complete controller operation must still succeed before
socket construction. Acquisition-specific freshness checks end after that socket
commit; ordinary controller source validation and pagehide cleanup continue.
Matching fetched bytes does not prove executed-page identity,
current asset compatibility or server acceptance.

The gate retains its native Socket constructor in a once-claimed factory for the
authored session. Play validates/copies/encodes first and stages a reset without
constructing a socket. The next native control callback returns resetWorld and
disconnected actions. Only after the complete controller operation, including
render and held-capture release, succeeds does `commitControl()` construct one
socket. Cancellation/failure opens none. A session supports one manual attempt.
The page's own constructor and scheduling callbacks remain held.

Incoming world/control bundles feed `controller.packet` exactly once. Rejection
propagates before session controls commit. State/error callbacks only latch and
schedule captured native microtasks; scene connection/lag changes and terminal
cleanup wait for both session ingress and Rust borrow to unwind. Setup is
connected and playing before own creation. Retained-own removal/death/ID reuse
does not infer life end; v packets own that lifecycle, independently of playing
and connected. Committed game-over controls reset the future lag multiplier
outside the borrow, with selective action acknowledgement. Pong never resets it.

Each RAF uses `beforeUpdate(now)` and exactly one `advance_with_control` step.
The callback observes the copied retained own, accumulates held arrow debt, then
processes due-close/reset before keyboard/ping/boost/gaze/heading sends. Input
ticks with wholeSteps zero after accumulation. The shared emitter places ping
between keyboard and boost, including connected/no-own ticks. Final gaze is a
closed native action before entity/eye motion; no scene method/getter/free runs
inside control. Post-advance `onStep` remains diagnostic only. Pointer events
read `control_view()` outside borrow, using raw head, displayed camera and CSS
viewport. No second input clock, local prediction or blur/death boost-off exists.

Only login fade owns a captured native 25 ms interval, while `uiTimerNeeded`.
Its `uiTick` uses the same native time epoch and never advances motion/input.
The interval is cancelled when fade completes or the runtime is disposed.
There is no hard pong timeout. Native numeric rollback cannot roll back input
attempts, sends or closes; a failure is terminal with no replay. This composition
does not establish full original UI phase parity or any network acceptance.

## CSP and verification

Extension pages allow scripts `'self' 'wasm-unsafe-eval'`, styles `'self'`, images
`'self' data:` and connections `'self'`, under `default-src 'none'`. The data URL
supports the generated offline background. MAIN loading/imports/Wasm fetch and
compilation instead obey the page's applicable CSP/Trusted Types. Web accessibility
is not a CSP bypass. Load/compile/deadline failures give explicit status and retain
the holds; there is no header rewrite, eval/blob script or alternate-realm fallback.
See [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
and [Mozilla execution worlds](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/ExecutionWorld).

```sh
node --test tools/game-bootstrap.test.mjs tools/stock-gameplay.test.mjs tools/build-extension.test.mjs
```

These execute the actual activation/gate/link/MAIN entry with authored host objects,
Wasm API spies and actual stock modules. They cover identity/revision/readiness,
no original callbacks or real sockets, staged Play/Setup/RAF/resize ownership, shared capture, cleanup,
CSP denial, pending deadlines, exact package imports/WAR/CSP and output preservation.
Labelled synthetic Wasm fixtures prove neither native pixels nor live compatibility;
the real ABI smoke is separate.

Separately authorized Windows browser checks should use an authored offline HTTP
host fixture with representative CSP and real DOM sources. Localhost matches belong
only in an explicit test package. Exercise the actual action, armed reload, module
load, native Wasm, readiness and cleanup in both browsers, without game sockets or
archived code execution. Automation navigation restrictions do not establish CSP
success/failure. Earlier installed 17-file preview evidence does not establish
this game entry. Live host/server checks require separate explicit scope; these
offline tests consume no official-attempt ledger.

Chrome uses the [unpacked procedure](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).
Firefox [temporary loading](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
is separate from [signed distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).
The numeric version stays `0.1.0` with Chrome's alpha display name. Firefox declares
its Gecko ID and `authenticationInfo` transmission because explicit Play can send
explicit login data, including an explicitly acquired profile. There is no analytics
or startup credential acquisition.
See [Mozilla's data-type declaration](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings).
Publication/release enablement remain separate actions.
