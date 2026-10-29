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
starts no acquisition. The sole default bootstrap mounts Play controls, score
readouts and leaderboard rows as described below. Minimap, unsupported
appearances/modes, native Play interaction, live acquisition/host/CSP and server
acceptance remain separate.

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

Each contains the original preview package, fixed game
activation/gate/link/bootstrap/runtime/HUD/Play/leaderboard UI/CSS, authored game
and local-host modules, and a generated JS/Wasm/validator graph for each renderer.
Preview HTML/modules are copied unchanged
under `scene/`; null simulator configuration disables its local connection.

The [semantic HUD view and passive renderer](hud-view.md) are fixed local
resources. The default `game/bootstrap.mjs` starts one runtime with HUD, Play and
leaderboard owners enabled, including schema-2 rows and Rust score projection.
Only `--game-entry default` is accepted; the former owned-HUD/owned-Play entry
files and package choices are removed. UI builders remain shared modules.
The module graph includes the authored local-host stand-in helpers, used by
the [standalone loopback page](local-play.md). Remote game-page integration
continues to use ready borrowed host sources.

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
`buildExtension({ projectRoot?, webDir?, outputDir?, gameEntry? })` accepts exactly
`default` for `gameEntry` and returns
`{ outputDir, files: [{ path, bytes, sha256 }] }` with sorted relative paths.
Output stays under ignored `dist/extension`, separate from input. Input/output
symlinks are rejected. See [provenance](provenance.md) and [releases](releases.md).

## Explicit owned Play controls

The default entry enables the semantic HUD, owned readout, Play panel and
leaderboard in one claimed runtime. On the remote game page, address and
nickname start empty. Enter a supported
literal-IP `ws://` or `wss://` endpoint with an explicit port and `/slither`
path, then click **Play**. There is no server discovery or preselected endpoint.
Nickname input uses the existing 24-byte ASCII policy; the wire domain allows
bytes `0x20..=0x7f`, including DEL, without trimming.

The separate captured control lease permits native editing only for the exact
owned address field. The nickname keeps its existing correction lease. Play
requires the exact current enabled button, an uncancelled primary trusted click
and the selected native trusted-event descriptor form. Unsupported descriptors
refuse the action. The existing gate completes its delivery and fencing before
it queues a private callback; the callback checks the same lease, document and
idle owners again. No second event listener or public Play binding is added.

Invalid local strings show fixed status text and leave correction available.
An accepted remote proposal locks Play before invoking the existing bounded
`playWithLiveProfile` path. Acquisition is supported only on canonical HTTPS
with the complete captured profile capabilities; otherwise the panel is locked
and reports unavailable. Activation alone starts no acquisition or socket.
The accepted remote attempt has no automatic retry or unlock. The standalone
local page instead presets its selected loopback endpoint and uses authored zero
credentials. Only a normal local disconnect makes Play available again; the next
explicit Play replaces that disconnected session. This does not renew a remote
profile attempt. See [local Play](local-play.md). Status contains fixed
labels, never the address, nickname, profile values or error details.

Disposal invalidates pending actions and late settlement, releases nickname and
controls before removing their panel, and preserves the first failure even when
cleanup also throws. Cleanup attempts do not certify successful native release.
Retained synthetic full-module-graph checks cover their tested revisions. Actual
browser click/edit/default behavior, installed-host/CSP compatibility, profile HTTP and
game/server acceptance remain unverified.

## Activation and ownership

The popup performs no activation until its button is clicked. It needs only
`activeTab` and `scripting`: no permanent host permissions, `tabs`, storage,
webRequest, DNR, native messaging or background context. Admitted origin/path
pairs are HTTP/HTTPS `slither.io` and explicitly named `www.slither.io` with `/`
or `/index.html`, plus exactly `http://slither.com/io`. The `.com` origin is not
combined with the `.io` home paths; HTTPS `.com`, `www.slither.com`, `/io/`, query,
fragment, credentials, other ports and wildcard subdomains gain no admission.
The HTTP `.com/io` allowance addresses an observed installed entry route; it is
not a grant of secure same-origin profile acquisition or a live Play result.

Activation registers fixed MAIN and ISOLATED document-start scripts for those
`.io` origins and the exact HTTP `.com/io` path with `allFrames:false`,
`persistAcrossSessions:false`. It then writes a
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
to the five named origins. These resource match patterns use `/*`; activation,
serialized arming, MAIN gate and isolated link independently retain the exact
origin/path pairs above. Preview resources, gate, link and activation scripts
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
commitments, including single-image eyes and the complete mouth-face sources.
Mouth marks require generated completion; the mouth canvas requires its final
whole-source painting commitment. It requires the supported
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

Disposal attempts the remaining owned cleanup steps even when cancellation,
listener removal, router replacement or an owner release throws. It consumes
scheduling and listener entries before invoking them, attempts terminal status
once, then throws the first cleanup failure, including a thrown `undefined`.
Repeated disposal stays inert. An attempted release that throws is not proof
that the underlying resource was released.

Startup preserves its original failure through cleanup or status failures.
Runtime failure handling keeps its existing quiet behavior when cleanup succeeds;
if classification or cleanup also fails, the original runtime failure takes
precedence. These paths add no field registration or native editing behavior.

## Explicit local HUD owner

Custom trusted composition can select readout mode in the side-effect-free
`game/runtime.mjs` factory and bind caller-owned nodes through
`runtime.bindHudReadout({ schema: 1, scope, nodes })`. The default bootstrap
already enables this mode and occupies its binding with owned nodes; a second
binding rejects. The runtime factory accepts explicit
`initialize` and `wasmApi` dependencies so an entry can choose its options before
claiming. Importing the default bootstrap in an armed realm still starts its
default runtime immediately; a later call cannot reconfigure that claim.
Semantic readout selection alone adds no UI, labels, mount, field registration
or Play action.
See [the fixed-node contract and publication seams](hud-view.md#explicit-bootstrap-owner).

The gate optionally supplies frozen `native.hudDom` in the existing one-shot
claim. It captures own native Node/Element/HTMLElement getters, the CharacterData
setter and CSSStyleDeclaration method with exact receivers. Capture failure omits
the whole group independently of editing and profile support. Its freshness
predicate checks the captured document/location, initially armed URL and gate
ownership without asset, source, profile or router observations. It creates,
searches for and writes no nodes during capture.

The opt-in owner requires that complete group and enables score tracking before
gameplay. A single local binding renders genuine committed history after idle
bind, successful frame/resize and changed deferred publication. No new queue or
timer is added. Native/source/owner reentry stays guarded; cleanup releases the
nickname field before the HUD and native owners. Stale bindings require explicit
unbind; old tickets are inert. Native writes may partially complete before a
failure and are not restored. Default startup binds its owned readout. Installed-host
behavior and native owner composition remain unverified.

### Package-selected owned HUD

The sole default entry selects `hudReadout:true, ownedHudUi:true`, Play and
leaderboard ownership before the
same one-shot claim. Visible mode requires both complete captured groups and
the same captured Document before initialization. Missing construction support
fails startup. Default startup requires the captured `native.ownedHudDom`
sibling. Its four exact captured operations create Elements/Text and append or
remove one child; existing renderer operations and freshness stay separate.

The builder returns an inert frozen `{mount, dispose}` lease. Runtime stores it
before guarded construction, exits that guard, and binds the existing readout
owner once. It creates 13 Elements and 8 Text nodes under the existing root,
with fixed lines for `Length: `, `Place: ` and `Last length: `. Numbers begin
empty; the existing renderer supplies committed history. Numeric widths stay
fixed, and the final line remains present independently of current-readout
opacity. This is original UI policy without an artwork or layout-parity claim.

Cleanup detaches nickname and HUD references before removing the owned mount.
Failed construction performs no internal cleanup while the runtime guard is
active; outer cleanup consumes the retained lease after the guard unwinds.
Removal is attempted only while the document is current and the mount remains
at its exact parent. Stale, reparented or throwing cleanup is not retried.
Partial native effects cannot be rolled back. The HUD builder itself adds no
profile acquisition or game socket; Play and leaderboard construction are
separate owners selected by the same default bootstrap.

## Session and input boundary

### Local nickname-field owner

A successfully initialized private runtime exposes a field-owner capability.
The default entry already occupies it with its own nickname field. For a custom
composition with no registered field:

```js
const runtime = await gamePageRuntime;
const binding = runtime.bindNicknameField({ schema: 1, element: ownedInput, parent: directParent });
binding.unbind();
```

The closed request accepts exactly those own data fields with an ordinary
current-realm or null prototype. The runtime fixes the gate policy to
`nickname-ascii-24`, holds its single lease privately, and returns a frozen
`{unbind()}` ticket. It performs no initial value read, correction or focus.
The default constructs and registers its own field without discovering a host
login field. Early dispose-only startup
results do not expose this method; no capability is installed on the window or
message bridge.

The existing router calls the private input handler synchronously before its
editing-notification filter. It adds no router, listener, control/source read,
clock, packet or Play operation. Raw keyboard/mouse gameplay delivery and reload
priority remain unchanged. The importing caller must bind or unbind at a
completed idle owner boundary. Local operation/router and held-capture guards
reject known active paths; they do not certify universal native idleness.

Only one owner slot may be occupied. Binding prepares its ticket before gate
registration and rejects caught reentry before publication. Unbind clears the
slot and method references before attempting unregister; old tickets are inert
and cannot revoke a later binding. Gate-only revocation is opaque, so an occupied
stale slot still requires explicit unbind. Registration success is not an ongoing
readiness or native-editing guarantee.

An input-handler failure detaches the field, attempts unregister and rethrows
the exact original value, including falsy values. It does not free game owners
while the gate delivery is active. Earlier pre-router gate failures remain
unobservable here. Permanent idle disposal detaches the field first, then uses
the existing complete-cleanup/first-error behavior. A throwing unregister cannot
certify native permission removal; dropping references is not a successful
revocation claim. Completed native value writes cannot be rolled back.

This API does not create a login UI, choose labels/layout, export a nickname,
read a field for Play, or attach a production field automatically. Its actual
bootstrap VM tests use synthetic native-receiver doubles; browser composition,
caret/IME/clipboard/undo and installed-host/UI acceptance remain separate.

### Private nickname-edit defaults

The single claimed native record additionally exposes
`registerNicknameEditField({schema:1,element,parent})`, returning a frozen
`{unregister()}` lease. The argument is a closed three-field own-data record
with the current realm's ordinary or null prototype. Registration requires an
installed input router and one exact connected native HTML `INPUT` of normalized
type `text`, its exact direct HTML parent, and the captured light-DOM Document.
The default bootstrap registers its owned nickname field through the owner API
above; custom compositions may bind a caller-supplied field.

Without registration, fenced events retain cancellation. A registered field
can receive the following native-default permissions; original propagation is
stopped before the private router runs in every supported path:

| Category | Admitted domain |
| --- | --- |
| Text and caret keys | One Unicode scalar text key, Space, arrows, Home/End, Backspace/Delete; optional Shift. |
| Ctrl or Meta | Exactly one modifier: A/C/X/V/Z/Y, ShiftZ/ShiftV, and caret/deletion keys with optional Shift. Other shifted letters and ordinary Alt chords are excluded. |
| Composition | Dead/Process initiation; bounded text/editing keys and composing Unidentified; explicit AltGraph text/Dead/Process handling. |
| Editing events | Closed `beforeinput` types below; composition and copy/cut/paste on the exact focused eligible field. |
| Mouse selection | Primary desktop mouse focus/caret initiation on the field, exact-field caret/word selection, and one bounded originating-field selection gesture. |

Enter/NumpadEnter, Tab, Escape, context menus, drag/drop, touch/pen editing and
unknown keys/chords/input types receive no permission. Modifier-only
Shift/Control/Meta/AltGraph notifications are admitted on the eligible field;
standalone Alt is excluded. Native permission never synthesizes a character,
performs clipboard access, submits Play or changes the nickname wire domain.

The exact `beforeinput` allowlist is:

```text
insertText insertReplacementText insertFromPaste insertFromPasteAsQuotation
insertCompositionText insertFromComposition deleteCompositionText
deleteContentBackward deleteContentForward deleteWordBackward deleteWordForward
deleteSoftLineBackward deleteSoftLineForward deleteHardLineBackward deleteHardLineForward
deleteByCut historyUndo historyRedo
```

Keyboard, composition, clipboard and editing admission requires the exact field
target and focus. Native disabled-fieldset, readonly, inert and visibility
checks may temporarily deny permission without discarding the structural lease.
The gate rechecks eligibility and the same router/lease after delivery. A router
must return `undefined` synchronously for an editing candidate; another return
or any thrown value cancels and revokes. Legacy callbacks without an editing
candidate retain their ignored-return behavior. A previously ineligible event
cannot be promoted by its callback.

The gate additionally fences keypress, beforeinput/input, composition,
clipboard, selection, double-click/contextmenu, focus, hover, cancellation and
drag events. Window capture handles target-path events, including the earlier
capture phase of non-bubbling Document selectionchange. One fence handles each
event; no second Document selectionchange listener is installed. New
notifications reach the owned router only
when attributable to the exact field, or to Document selectionchange with that
field active. The bootstrap filters that exact new inventory before gameplay,
so it adds no control/source/clock/send observations. Every original event
family, including raw keydown/keyup outside the field or after eligibility
changes, keeps its existing gameplay delivery. No keyCode/which normalization
or artificial release is added.

One lease-bound primary mouse selection can continue with same-document outside
move/up/selectstart while the exact field remains focused and eligible. Pointer
continuations match the captured primary mouse pointer identity. This grants no
outside click/down permission, pointer capture, timer or synthetic mouseup.
Matching up, incompatible initiation, cancellation or lease revocation clears
the private gesture.

Unregister is idempotent; an old lease cannot revoke a newer one. Every successful
`setInput`, including the same handler or `undefined`, revokes registration;
invalid handler arguments preserve the existing route. Observed structural,
type, Document/Location/URL, top-level or gate/router identity changes revoke
permanently. Pagehide and ordinary reload also revoke. No observer detects
detach/reattach entirely between checks. Cleanup drops retained field references
without changing value, selection, focus, styles or gameplay held state.

Event fencing and the optional editing group use fixed captured native
operations with exact receivers. Window document/top/location and Location href
use their selected own descriptors; there is no prototype search or mutable
instance fallback. Visibility requires captured `checkVisibility` with
`opacityProperty`, `visibilityProperty` and `contentVisibilityAuto` all true.
Missing editing capabilities make registration unavailable while preserving
legacy holds; missing critical Event fencing uses `gate-unavailable`. A native
failure cancels/revokes, and the exact first thrown value survives secondary
fence failures. A failed fence call proves only an attempt at isolation.

These bounds are verified with authored Node doubles. Actual descriptors,
visibility semantics, native propagation/defaults, IME, clipboard, selection,
installed-host/CSP and server behavior remain unverified. Input notifications
can be noncancelable or follow a mutation; fencing does not roll back a value.
This slice implements no field binder, sanitizer, layout, focus or login UI.

#### Lease-bound input correction

The existing three-field registration keeps its unregister-only result. An
explicit four-field variant adds only a lease-bound input handler:

```js
native.registerNicknameEditField({schema: 1, element, parent,
  inputPolicy: 'nickname-ascii-24'}); // frozen {unregister(), handleInput(event)}
```

Only that exact policy string is admitted; an omitted policy preserves the
legacy shape, and an explicit unknown/undefined/null policy is rejected. This
variant also requires separately captured own native `HTMLInputElement.prototype`
value getter/setter operations. Their absence makes only the policy variant
unavailable. No mutable instance accessor, alternate owner or coercion fallback
is used, and registration never reads or edits an existing value.

A trusted future owner must call `lease.handleInput(event)` synchronously inside
the same gate-selected router, before the bootstrap's notification filter. No
production registration or router hook is installed here. Stale leases are inert
before argument inspection; a live handler requires that exact active delivery.
Noninput deliveries perform no value work. Input is handled at most once per
delivery; outside/deferred/wrong-event calls, duplicates and reentry fail and
revoke. An event object may be used by a later separate delivery; no event history
or nickname store is retained.

For exact-field input, read the primitive native value once. Inspect at most its
first 24 UTF-16 code units: preserve units `0x20..=0x7f`, replace each other unit
with an ordinary space, and discard the tail. Preserve literal DEL, empty names,
spaces, punctuation and digits. An astral pair becomes two spaces if both units
are retained. Write through the captured native setter only when the result
differs, at most once. Native getter materialization may still depend on the
original string length; the 24-unit limit bounds local processing and output.

Shared structural/document/router ownership is checked before the getter,
before any setter and after it. Temporary default ineligibility does not add a
focus/visibility/readonly guard to correction of an already-performed input.
Composing input uses the same immediate rule. There is no selection save/restore,
IME deferral, synthetic event, initialization/Play-time correction, name-admission
policy, value export, extra scene/source/clock/send or gameplay key filtering.

Failures preserve the exact first thrown value and clear the active delivery
and operation references. Native effects already completed cannot be rolled
back. Actual native descriptor, caret, undo, IME and selection consequences
remain unverified for the current composition; the default's production binding
still requires native-browser acceptance.

### Session composition

Default state is `ready-not-connected`. The exported MAIN runtime exposes local
`play(request)`, `playWithLiveProfile(request)`, `diagnostics()` and `dispose()`
capabilities. External-profile Play requires
`{endpoint,profile:{clientVersion,password,protocolVersion:19},nickname,skin,customSkin}`;
the password is a caller-supplied 20-byte Uint8Array. Endpoint is one selected
literal IP with explicit port and `/slither`, using ws/wss. No discovery, DNS
selection, stored remote profile, automatic Play or retry exists. The standalone
local page uses its explicitly configured loopback endpoint and authored profile.
No credential, packet or socket command is accepted through the status bridge.
The default entry supplies [owned Play controls](#explicit-owned-play-controls).
This local API is
for explicit trusted composition. An importing MAIN module can await exported
`gamePageRuntime`, the single auto-entry promise, to obtain this runtime without
claiming the gate again; nothing is installed on `window` for this purpose.

The separate asynchronous `playWithLiveProfile` path requests the exact pinned
same-origin script only after explicit invocation in canonical, top-level, secure
`https://slither.io`. Optional captured native capabilities are absent on HTTP,
www, `.com` or unsupported environments; the external-profile path remains
available only to an explicit trusted MAIN caller supplying its own profile.
The default HTTP `.com/io` Play control has no automatic profile capability and
remains unavailable. Admitting activation does not make that normal-user Play
path complete, move the profile URL under `.com/io/s`, or authorize a cross-origin
or insecure profile request. Existing host adapters still borrow the captured
ready Canvas/image objects, including absolute `.io` sources, under their normal
readiness/identity/mode checks; no asset-origin alias or new download is added.
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
For local-host composition only, the next explicit Play may replace a normally
disconnected session; it does not automatically reconnect, retry failures or
reset the remote profile budget.
The page's own constructor and scheduling callbacks remain held.

Incoming world/control bundles feed the selected `controller.packetWithHud`
path exactly once for the default schema-2 HUD/leaderboard composition. Rejection
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

Separately authorized installed-extension checks should use an authored offline
HTTP host fixture with representative CSP and real DOM sources. Testing the
extension on localhost requires an explicit test package; the standalone
[local game page](local-play.md) needs no extension installation. Exercise the
actual action, armed reload, module
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
