# Verification

## Local checks

Use Rust **1.99.0**, Node.js **24**, and platform build tools. The pinned Rust
toolchain includes `wasm32-unknown-unknown`, rustfmt, and Clippy. Install
**wasm-bindgen CLI 0.2.129** separately on `PATH`, or set `WASM_BINDGEN` to its
absolute executable path. The build checks the CLI version.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
cargo fmt --all --check
cargo test --all-targets --locked
cargo test --doc --locked
cargo clippy --all-targets --locked -- -D warnings
cargo clippy --lib --locked --target wasm32-unknown-unknown -- -D warnings
npm run build:web
node tools/wasm-smoke.mjs
```

The web build produces ignored `dist/web` JavaScript bindings and Wasm. The smoke
test executes that real Wasm ABI with synthetic handshake and scene sequences,
including spawn, update, removal, food, setup truncations and atomic rollback.
It needs no browser, external reference, or socket. Keep
this checkout's `target/` separate from other projects and running jobs.

The web build uses the matching cdylib Wasm path reported by its successful Cargo
invocation. `CARGO_TARGET_DIR` and Cargo target-directory configuration are
respected; a missing or ambiguous artifact fails without using a stale default.
Synthetic tooling checks cover selection and failure propagation. Integrated
default and custom-target builds passed the real ABI smoke; custom bindings
matched an independent bindgen run and left the default artifact unchanged.

CI runs repository guards and npm tests, native Rust checks on Linux and Windows,
and the web build plus Wasm ABI smoke test on Linux. It runs on pushes to `main`,
pull requests, and manual dispatch. Normal tests and CI require no external
reference and do not connect to game servers. Dependency and toolchain setup may
access package sources. Release-plz remains dormant.

## Explicit bootstrap HUD owner

The integrated optional native HUD capture and bootstrap owner pass 997 Node
tests with zero skips. The focused integrated run passes 379 cases: 101 bootstrap,
60 native-capability capture and 218 existing HUD cases. All 71 original literal
bootstrap cases and the automatic-entry code remain unchanged. Independent
capture review reruns 104 focused synthetic cases and three syntax checks.

The positive composition case executes the actual gate capture and bootstrap in
one VM document realm. Actual reducer/view/DOM modules verify numeric text and
local styles through branded operation doubles, then block further observations
when captured freshness becomes false. Other cases cover default-off keys and
scheduling, closed requests, missing histories, negative zero/wide/negative
scores, unchanged deferred identities, exact getter/draw seams, caught reentry,
stale tickets, partial writes and first-presence cleanup including falsy throws.
The captured group is independent of editing, nickname and profile acquisition.

Missing-capability baselines, a corrected armed-URL regression, setup/expectation
mistakes and all attempted runs remain retained outside Git. A worktree run with
one dependency-absent skip is excluded from integrated proof; the private frozen
composition run has zero skips.

These results use authored Node/VM and native-operation doubles. They do not
establish native DOM/CSS, pixels, installed-host/UI, profile HTTP, gameplay or
server acceptance for this owner. Earlier native renderer checks do not transfer
that acceptance. Default startup remains unbound; no nodes, labels, final
visibility or automatic activation are selected. See [the owner contract](hud-view.md#explicit-bootstrap-owner).

## Static head accessories

The integrated generic accessory change passes 907 Node tests and 535 native
all-target tests. Formatting, doctests, strict native/Wasm Clippy, a fresh web
build with wasm-bindgen 0.2.129, and the full real-Wasm suite pass. Both extension
packages build with the existing 88-file graph and permissions.

The focused actual-Wasm recorder adds 142 cases and 769 assertions. It exercises
all 13 additive entrypoints, both rendering lanes, Paired/Mouth ordering and
alpha, optional antenna/side images, mixed families, signed-zero coherence,
explicit crops, source revisions/aliases, pending rejection, exceptions and
model rollback. Ordered Setup/prey/HUD paths share the existing source pool and
budgets. Cases include 512 objects, 1,536 side/accessory images, 2,048 Mouth/
accessory images, source/catalog/use limits, 64 Setup plans and backing pixels.
The exact global 524,304 image-command limit/limit-plus-one is source-accounted
but is not separately instantiated by this helper.

Native arithmetic tests cover large-head cancellation and pure finite underflow;
those are not browser last-bit witnesses. The browser rational fixture accounts
for the existing draw-time zoom transition. Missing-API baselines, loader/fixture
mistakes and all candidate attempts remain retained outside Git.

These checks use authored synthetic metadata and a logical Canvas recorder.
They do not establish native Canvas pixels, original artwork, stock lazy loading,
installed-host behavior or gameplay/server acceptance. The stock no-accessory
guard remains. See [static accessories](static-accessory.md).

## Bootstrap cleanup failures

The cleanup repair passes 102 focused Node tests across bootstrap, profile,
editing-default and nickname-policy suites. The 27 additive bootstrap cases
exercise the actual authored modules through VM, DOM, scheduler, socket and Wasm
doubles. The corrected tests retain 25 regression failures on the original
product, with all 24 preexisting bootstrap cases passing. Earlier fixture and
expectation mistakes remain recorded beside the corrected baseline and results.

Cases cover cleanup ordering and remaining attempts after failure, repeated and
reentrant disposal, waiting-startup settlement, post-dispose diagnostics and exact
first failures including falsy values. Startup and runtime primaries survive
secondary cleanup, status and status-getter failures. Controller disposal is
observed through stopped diagnostics before scene release; no active-stack
controller failure or replacement native Promise resolver was injected.

These are synthetic source-path checks. A throwing cleanup may leave its
resource unreleased, and terminal status cannot report its own failure without
another attempt. No installed-browser cleanup, native editing, real-Wasm cleanup,
profile acquisition or server acceptance follows from these tests. The default
startup still registers no nickname field.

## Local nickname-field owner

The integrated private owner composition passes 896 Node tests, including
164 focused bootstrap/gate/policy/profile/input tests. Its 19 new actual-source
bootstrap cases cover closed request/ticket shapes, zero startup registration,
same-router correction before filtering, unchanged raw gameplay delivery and
absence of extra control/source/clock/send observations.

Reentry and fault cases retain exact falsy primaries through request reflection,
registration, native handling and unregister cleanup. They cover caught nested
violations, late publication failure, stale occupied leases, old tickets,
held controller work, field-only failure without active-stack native disposal,
field-first complete cleanup and the existing startup/runtime cleanup controls.
The genuine missing-method failure and all candidate/check records are retained.

The full prebuilt real-Wasm suite passes with unchanged generated JS/Wasm and
validator bytes. Both browser packages contain 44 files; only their bootstrap
copies change from the mouth-face package, and both match the current source.
Native Rust behavior is unchanged; this integration reuses its existing build.

These tests execute the actual gate IIFE and bootstrap with authored VM/native
receiver and Wasm doubles. They do not establish native browser execution of
the owner composition, field attachment, caret, IME, clipboard, undo, Firefox,
installed-host/UI or server acceptance. Startup remains unbound. See
[the local owner API](extension.md#local-nickname-field-owner).

## Lease-bound nickname input policy

The opt-in policy integration passes 836 Node tests, including 117 focused
gate/bootstrap/profile/input cases. Its 26 new policy cases execute the actual
gate IIFE with authored native receiver/value operations. They cover legacy
shape compatibility, missing getter/setter groups, closed grammar, captured
intrinsics, every admitted unit at lengths 0..24, controls/surrogates/cutoff,
conditional writes and primitive-string rejection without coercion.

Delivery tests cover one exact active routed event, stale/duplicate/deferred
calls, nested fence and handler reentry, pre/post native-operation ownership,
structural checks invalidating the URL before a setter, all falsy primaries and
secondary fence failures. Composing/noncancelable/already-mutated input follows
the selected rule even when native defaults are temporarily ineligible. Raw
keys and other notifications perform zero value work.

A test-only single-claim facade composes actual bootstrap/gameplay/input modules
with the handler before the existing notification filter. It verifies no extra
control/source/clock/send/socket effects and preserves input errors through gate
finalization. The Wasm boundary there is a synthetic double; production startup
still registers no field. The separate explicit local owner API above now
installs its private handler when a caller supplies a field.

A fresh web build and the unchanged full real-Wasm suite pass. Generated
JS/Wasm/validator fingerprints remain exact; both packages contain 44 files with
the same module graph, manifests and permissions. Native sources remain
unchanged; native tests/Clippy are inherited from the DEL integration.

The worker retained a genuine absent-policy baseline and three supported local
defect groups: a nested fence claiming the outer event, inherited private-state
or result-method accessors, and URL invalidation during a structural check just
before a setter. Failing source copies and transcripts remain preserved beside
the passing corrections. These are authored source/delivery checks, not native
descriptor/default/caret/undo/IME/clipboard/selection, installed-browser/login or
server acceptance. Completed native value effects cannot be rolled back; production
attachment remains separate. See [the policy API](extension.md#lease-bound-input-correction).

## Private nickname-edit default gate

The integrated gate/bootstrap slice passes 810 Node tests, including 91 focused
gate/bootstrap/profile/input cases and the existing 47 package tests. Eighteen
new gate cases use deliberate native receiver brands, fixed descriptor owners
and Window/Document/target propagation doubles. They cover the closed field
lease, optional versus critical capture failure, bounded keyboard/input-type
tables, temporary ineligibility, permanent observed invalidation, post-callback
rechecks, one primary selection gesture, reentry and exact falsy primary errors.

An additional actual authored bootstrap/gameplay/input composition case checks
raw ArrowLeft/Right/ArrowUp/Space holds and outside-target keyup through modifier,
composition and eligibility changes. Every newly fenced notification adds zero
control/source/clock/send observations. Its Wasm boundary is a synthetic double;
it is not a native-browser input test. Existing profile-bootstrap cases retain
their synthetic network guards.

A fresh web build and the existing full real-Wasm matrix pass. Generated
JS/Wasm/validator fingerprints remain byte-identical to the DEL integration;
native sources are unchanged. Both 44-file packages build with the same fixed
module graph, manifests and permissions. Formatting and whitespace checks pass.
The native test/Clippy suites are unchanged evidence from the DEL integration,
not rerun results for this JavaScript-only slice.

The absent-registration-API baseline failure is retained. Three later failed
attempts came from test setup/expectations: a deliberately throwing router reused
by a follow-up probe, an incorrect Ctrl+Space permission expectation, and a
missing-capability fixture invoking a native-brand getter on its prototype.
Corrected fixtures pass; those failures did not require product changes.

Independent review then exposed a selectionchange fencing gap: Document-only
capture let a later Window capture host listener run first. A retained parent
regression observes one such host call before correction. The gate now captures
that event once at Window, and the propagation fixture includes Window before
Document even for non-bubbling selectionchange. The regression verifies zero
host calls, one attributed owned notification, and continued fencing with no
lease or field focus. This is event-path algorithm evidence, not browser execution;
see [DOM event dispatch](https://dom.spec.whatwg.org/#concept-event-dispatch).

These are authored Node/default-decision and separate real-Wasm/package checks.
Actual descriptor support, visibility options, native propagation/defaults,
typing/IME/clipboard/selection, CSS, installed-host/CSP and server acceptance
remain unverified. No field is bound or registered by production startup, and
no sanitizer, focus, value mutation or login UI is added. Noncancelable and
postmutation notifications are not value rollback. See the
[private API and bounds](extension.md#private-nickname-edit-defaults).

## DEL nickname admission

The aligned session/Rust nickname boundary passes 791 Node and 492 native
all-target tests. Formatting, doctest checks and strict native/Wasm Clippy pass.
Focused native/Node tests cover every admitted byte at lengths 0..24, exact
24-byte DEL wire layout, controls/non-ASCII/overlong rejection and password
clearing. Legacy rejection fixtures use U+0080 and retain their original cleanup
assertions; new staging tests use no constructor overrides.

A fresh build passes the full real-Wasm suite. Direct ABI checks preserve all
24 DEL bytes and reject both adjacent domain boundaries and excessive length.
The profile helper passes 768 assertions across 11 cases, including a separate
DEL intent through the actual acquirer/session/Rust encoder/control/handshake
composition. Fetch/digest/socket inputs are authored doubles; all network
sentinels remain unused. Both 44-file packages build with the new native payload.

Worker Rust/Node DEL baselines, its initial test lint failure and the parent's
stale synthetic encoder failure remain retained. Aligning that double and its
invalid-name fixture passes without a production acquirer change. These results
establish authored domain and wire consistency, not native editing, sanitization,
digit policy, actual profile HTTP, browser or server acceptance.

## Semantic HUD view and passive renderer

The integrated view/renderer revision passes 786 Node tests, including 11 pure
view and 21 passive renderer cases. The combined reducer/view/renderer command
passes 65 cases. Pure independent review adds four private probes, including
103 exact BigInt decimal-boundary comparisons. Histories, negative-zero scores,
safe integer limits, closed readiness combinations, weak admission and alias
isolation are covered without a native score lookup.

Renderer tests use authored native-capability doubles with receiver brands and
fixed topology. They cover both scopes, missing/stale nodes, styles, identities,
never promoting old nonready views, current-ready/final-pending writes, operation
reentry and exact first-primary preservation at every one of 16 setter positions.
The retained first failed fixture had an original child still in its synthetic
tree, correctly becoming pending before the intended brand check. Correcting
the fixture passes without a product change for that failure.

A fresh web build preserves the generated JS/Wasm/validator fingerprints. The
full real-Wasm suite passes with 1428 stock assertions across 16 cases. Actual
gameplay/session/controller/reducer history flows through the real view and
renderer against an authored fixed-tree capability double. Source-release
tripwires and counters verify publication adds no score, source, step or draw
operation. It covers missing histories, current before final, command-time final
versus later Setup, retained histories after reset, raw negative requested opacity
and disposed data. Both 44-file packages build with the fixed module graph.

Native sources remain unchanged. These are synthetic Node/real-Wasm Canvas and
DOM-capability-recorder checks, not actual DOM/CSS, garbage collection, browser
pixels, installed-host/CSP, wording, login or server acceptance. The bootstrap
and gate remain unchanged; no labels, mount, final visibility or activation are
selected by these passive modules. See [view and binding limits](hud-view.md).

## Semantic HUD readout composition

The integrated semantic reducer and gameplay path pass 754 Node tests. The pure
slice independently passes 251 focused cases and six private probes, including
512 legal packet partitions with identical bounded state. Six worker mutation
controls verify token checks, Setup gates, reset history, completion precedence,
alive fade rate and ineligible dirty retention. Gameplay adds 62 focused cases against
the actual session, controller, input and reducer with authored native doubles.

A fresh build preserves the existing JS/Wasm fingerprints and regenerates the
byte-exact updated shared validator. The full real-Wasm suite passes; the stock
helper now has 1264 assertions across sixteen cases. Added actual composition
checks cover prior committed snapshots inside observers, release-before-score
reads, required read once versus clean resize, no extra step/quality phase,
intermediate Setup/current versus final scores, and completion history/reset.
A required getter throwing `undefined` after a successful native draw remains
the primary through a throwing timer cleanup; no partial HUD state publishes,
fatal notification occurs once and the socket closes once. A retained fatal value
also blocks subsequent HUD ingress before source capture or native commit, even
when deferred cleanup cannot be scheduled. Both packages build
with 42 files and retain exact module/resource closure.

Worker failures remain preserved: the gameplay draft initially allowed nested
status-driven draws to publish before reconciliation completed, and existing
cleanup/scheduling paths could lose falsy primaries. Regressions pass after the
narrow staging/cleanup corrections. Two authored fixture mistakes were corrected
without changing session or input behavior. The parent's first full run used a
25-character failure-fixture nickname; shortening it to the admitted wire bound
passes without a product change. The earlier missing-mode baseline is retained.
Final independent review exposed HUD ingress continuing after a fatal score-read
failure. The retained Node regression observed a second native commit; checking
fatal presence at HUD entry fixes all six primary-value cases with queued or
unavailable scheduling. The extended pre-fix Wasm run exits with an uncaught
`undefined` during cleanup, so that transcript alone does not identify the
failing assertion. The corrected real-Wasm cases verify unchanged native state,
no additional source capture and exact `undefined` preservation.

Native sources remain unchanged from the 489-test journal integration. These are
authored Node/real-Wasm Canvas-recorder results, not DOM/CSS, raster pixels,
installed-host, full login or server acceptance. Bootstrap does not enable the
mode. See [semantic state and publication limits](hud-state.md).

## Same-step HUD lifecycle observation

The additive session facade passes 659 Node tests, including 48 new lifecycle
cases. Paired fixtures compare legacy subscription/legacy facade, HUD
subscription/legacy facade and HUD subscription/new facade: actions, snapshots,
revisions, socket traces and clock/decode counts agree. They cover strict return
timing, incoming-fade delay, zero delta, completion, victory connection retention,
close-only controls, pending-death Setup and terminal/cleanup failures.

The full real-Wasm suite passes with the unchanged generated module graph. Its
stock helper now has 1052 assertions across thirteen cases. Two additional
actual session/controller/native-render cases check the native step delta,
the strict 1600-ms boundary, the completing and following steps, release before
socket commit, ordinary reset/disconnect and connected victory return. Both
41-file packages build. Native sources and generated JS/Wasm/validator are
unchanged from the journal integration.

The retained baseline run fails at the absent facade before implementation.
The worker also retained an initial fixture error where its paired verifier
replaced an action-offer identity before acknowledgment; corrected fixtures
pass without a product change for that failure. These checks establish the
copied observation seam, not fade/readout reduction, UI, pixels or server
acceptance. See the [lifecycle API](hud-ingress.md#same-step-lifecycle-observation).

## Integrated command-indexed HUD journal

The integrated journal passes 611 Node tests, including 47 package checks, and
489 native all-target tests. Doctests, strict rustdoc, formatting and native/Wasm
Clippy pass. Independent native review finds no supported actionable defect;
the same reviewer separately checks the Wasm and controller/gameplay candidates
with 346 real-Wasm assertions, 272 focused Node tests and 30 additional
report-freeze failure assertions. Final parent integration review is separate.

A fresh build passes the complete existing ABI suite plus the 346 journal
assertions across nine cases. The stock adapter helper now passes 362 assertions
across eleven cases, including actual session/controller/gameplay/native/render
composition. It verifies release before publication, exact intermediate final
score before later mass/R/Setup, command indices, one Setup count and no extra
clock/quality step. Both packages build with 41 files each; the generated
validator matches its authored source, and output manifests list its exact path.

The first composed fixture repeated Setup four milliseconds later than the
legacy case but retained its old fade-timer checkpoint. The retained failed run
exposes that fixture mistake. Advancing the new case's checkpoint by the same
four milliseconds passes without changing product lifecycle behavior.

These are authored native/Node/real-Wasm Canvas-recorder checks. They do not
establish raster pixels, installed-host compatibility, full fade/readout UI or
server acceptance. Gameplay requires explicit callback and score-mode opt-in.
See [journal API and failure boundaries](hud-ingress.md).

## Opt-in session HUD planning

The session integration passes 522 Node tests, including 112 focused session
cases and the 38 package checks. Authored doubles cover shared control staging,
per-command guards, exhaustive final indices, closed report copies, reentry,
observer ordering and cleanup preserving falsy thrown values. A parent probe
found a cyclic callback prototype could hang validation; the retained failing
regression passes with bounded cycle detection. Independent review also exposed
unbounded fresh-prototype chains and reflective subscription reentry; retained
regressions cover bounded admission and the final ownership/readiness recheck.
Both package inventories include the
new shared validator, with 39 files per browser.

These checks cover the session boundary and package graph. They do not exercise
a native HUD report producer, controller/gameplay HUD routing, lifecycle fade,
visible UI, browser or server acceptance. Existing default gameplay remains on
the legacy subscription. See the [planning contract](stock-client.md#opt-in-session-hud-planning).

## Borrowed HUD packet decoders

The decoder integration passes 469 native all-target tests, formatting,
doctests, strict rustdoc and native/Wasm Clippy. Independent read-only review
finds no supported actionable defect in its three-file behavioral slice. It
passes 16 new HUD tests, seven existing protocol tests and three private probes,
including deterministic arbitrary-byte and generated-row samples.

A fresh web build passes the existing full ABI suite, including the 297
score-state assertions, and both extension packages contain 38 files. This
checks existing ABI behavior with the new native module present; the packet
decoders have no Wasm export or HUD routing. All 85 JavaScript source paths
match the earlier 449-test candidate; those Node results remain unchanged.

These are authored native and Node/Wasm checks. They do not establish browser,
text/HTML, pixel, server or complete HUD acceptance. See
[the packet API](hud-packets.md).

## Opt-in retained-own score state

The integrated opt-in slice passes 453 native all-target tests and 449 Node
tests, formatting, doctests, strict rustdoc and native/Wasm Clippy. A fresh web
build passes 297 score-state ABI assertions across ten cases with five owners
freed. The existing full ABI suite also passes, including 7,624 body assertions,
38 control cases, 252 stock assertions, eight session scenarios and 643 profile
assertions. All use authored fixtures with no real network connection.

Native tests cover unchanged legacy R handling, canonical opt-in admission,
same/different Setup caches and event-time callbacks, reset persistence,
latest count/mass, retained own through expiry/reuse and complete rollback after
late errors. The Wasm helper checks closed copied records, BigInt identity,
negative integer results, explicit unsupported-index status and same-step reset.
Its first fixture incorrectly expected the dead control-own object to disappear;
that failed transcript is retained. The corrected assertion follows the existing
retained-own contract, with no product change for that fixture failure.

These are native and Node/Wasm results, using the current Node host's Math.pow.
Browser arithmetic, installed extension, HUD and server acceptance remain
unverified. Gameplay does not automatically enable tracking. See
[score-state API](score-state.md).

## Native score arithmetic

The initial caller-owned score primitive passed 444 native all-target tests, doctests,
strict rustdoc, formatting and native/Wasm Clippy. Independent review passes
36 focused native tests and finds no supported defect in ordered arithmetic,
table boundaries, cache ownership or resource bounds. A retained mutation that
reassociates the score arithmetic fails the exact fractional-floor witness.

A fresh web build passes the full ABI suite recorded below, and both extension
packages contain 38 files. This checks existing ABI behavior with the new native
module present; `ScoreTables` has no Wasm export or gameplay/HUD binding yet.
Native powf results do not establish browser Math.pow parity.

## Explicit game-page composition

The composed extension sources pass 449 Node tests. A fresh Wasm build passes
the full ABI smoke: 7,624 body assertions, 38 control cases, 252 stock/gameplay
assertions across ten cases, eight session scenarios and 643 profile assertions
across ten cases. The native sources
are unchanged from the 434-test integration below. Both extension packages
build with 38 files each and retain the exact generated module fingerprints.

The real-Wasm gameplay fixture composes the actual session, input, controller,
skin/entity adapters and renderer with authored sources and an in-memory socket.
It checks staged Play/reset before construction, handshake, complete Setup,
current gaze, own-removal retention, life return, same-frame quality flags and
populated-registry cleanup. It opens no network connection.

Independent security review found that mutation stamps alone could incorrectly
mark blank or failed generated canvases ready. The corrected gate requires a
successful paint commitment; dimension-only, clear/reset and failed-paint
witnesses remain pending. Focused rechecks found no actionable issue in that
correction or the later post-control playing binding. The separate controller
recheck also passed its real-Wasm probes.

These are source, packaging and synthetic ABI results. Installed extension
activation, native browser CSP/Trusted Types, live host loading/pixels, real
profile acquisition and connected gameplay remain unverified. The earlier
temporary Firefox foundation install and its blocked launcher automation do
not establish acceptance of this composed package. See [extension](extension.md).

## Explicit profile acquisition

The optional profile path uses authored acquisition, captured native operations
and a private synchronous Play consumer. Synthetic tests cover exact byte/EOF
and read/deadline bounds, complete hash checks before closed parsing, owned-byte
cleanup, cancellation and late results. Pure verifier tests use real Node
WebCrypto with wholly synthetic pins. Positive production-factory fixtures use
authored full-size padding/declarations and an explicitly labelled digest double;
real crypto correctly rejects those synthetic bytes against the production pin.
No archive-backed passing fixture is used.

Gameplay and bootstrap composition tests use the actual acquirer/session/input
modules with authored document, Canvas, acquisition, socket and Wasm doubles.
They check no startup acquisition, copied intent, preserved key releases/pointer
changes during the wait, post-consumer failure/disposal, stale document/assets
and rejection after rendering before socket commit. Cleanup regressions cover
session closure despite intent-buffer errors and original failure identity,
including an `undefined` throw. These synthetic results do not establish actual
source acquisition, native browser/CSP behavior or server acceptance.

The approved runtime exception and separate agent-run HTTP/game-connection limits
are defined in [provenance](provenance.md#explicit-play-profile-acquisition).

## Stock adapters and same-clock input

The frozen native/input/asset integration passes 434 native all-target tests and
272 Node tests, formatting, doctests, strict rustdoc and native/Wasm Clippy. A
fresh generated module passes the full existing Wasm ABI smoke with 7,624 body
recorder assertions. The additive pre-motion control helper passes 38 real-Wasm
cases; the stock adapter helper passes 211 assertions across eight cases using
the actual skin/entity adapters, controller, scene and quality objects.

Coverage includes unchanged-source revisions across catalog churn, shared
body/food/prey aliases, intrinsic source scalars, exact crop/whole identities,
single-image and antenna selection, custom suppression, ordered Setup and resize,
same-tick control/gaze, native rollback and owned-step release. Independent
read-only review covers the control/input seam; stock adapter corrections are
recorded with their separate scoped review.

The first control helper deliberately attempted forbidden scene reentry. All
case bodies passed, but pinned wasm-bindgen retained an extra reference after
rejecting those calls, preventing explicit free. The failure and isolated
reproductions remain preserved. The corrected valid-lifetime helper retains
callback-throw, malformed-action and structural-proxy checks and frees all three
owners. It does not claim recovery after contract-violating reentry.

One additional body/food alias fixture initially enabled food after applying
packets, contrary to the API. Its failure is retained; the corrected fixture
enables the factory at initial ingress. These synthetic observations do not
establish original artwork/loading, browser pixels, full game-page/session UI,
extension activation or gameplay acceptance. See [stock adapters](stock-client.md).

## Complete mouth-face integration

The integrated feature passes 877 Node tests and 514 native all-target tests,
formatting, doctests, strict native/Wasm Clippy, a fresh matching-bindgen web
build and the full real-Wasm smoke matrix. Chrome/Firefox packages contain
88 files; changed runtime copies match the reviewed authored/generated inputs.

The focused real-Wasm recorder passes 1,852 assertions across 34 cases through
both renderers. Coverage includes exact three-image whole-source order and
transforms, root alpha one during spawn/death, retained travel including signed
zero, mixed families, preclear rejection, source/revision changes, exceptions and
scope unwinding, ordered Setup retention and shared command/catalog/asset-use
budgets. A 512-appearance case submits 1,536 face images. Stock-adapter smoke
also exercises the actual built-in selection and rejects an unpainted required
mouth before clear. The actual gate/bootstrap test verifies the final painting
commitment and later invalidation without invoking host functions.

These native, synthetic Node and real-Wasm results do not establish native Canvas
pixels, original artwork/loading, installed-host compatibility or game-server
acceptance. See [mouth faces](mouth-face.md) for the API and source boundary.

## Single image eye integration

The additive face-family path passes 426 native all-target tests and 169 Node
tests in a frozen feature snapshot, plus formatting, doctests, strict rustdoc
and native/Wasm Clippy. A fresh Wasm build passes full ABI smoke with 7,542
recorder assertions. The extended focused recorder passes 7,602 assertions,
including exact signed-zero configuration rejection in both lanes.

Checks cover unfactored two-image geometry, shared gaze updates, death-only alpha,
both rendering lanes and size forms, legacy rejection before reset, explicit
crops, source readiness, late-image rollback and ordered Setup source retention.
Independent read-only review found no actionable defect in the frozen feature;
its focused Wasm probes additionally cover mixed face families, source aliases,
revision conflicts, callback mutations and Promise/accessor rejection.

These are synthetic native/Wasm observations. Stock-browser pixels, original
artwork/loading equivalence, original-runtime comparisons and complete host skin
mapping remain separate. See [single image eyes](single-image-eye.md).

## Draw-driven ordinary antennas

The opt-in ordinary-antenna implementation passes 407 native all-target tests,
133 Node tests and a fresh real-Wasm build/full smoke with 7,226 recorder
assertions. Formatting, doctests, strict rustdoc and native/Wasm Clippy pass.
Synthetic coverage includes exact six-channel Float32 stepping, draw-only
cadence, both bulb modes, zero alpha, retained bounds and object lifetimes,
source/revision coherence, ordered Setup draws and shared resource boundaries.
Standard-renderer tests include eligible and rejected inner gates with
non-saturated first-death alpha witnesses.

Independent read-only review identified three issues, now corrected and
rechecked: rounded lookup indices return arithmetic errors, new antenna APIs
acquire native patterns before reset, and random tapes use intrinsic Float64
brand/length validation. Regressions preserve legacy pattern-failure ordering,
reject spoofed tapes without reading shadow getters, and retain valid tapes
whose own length property differs from their intrinsic length. Earlier failed
fixtures and review witnesses remain preserved outside the repository.

Stock Windows Chrome 156.0.8078.48 verification is partial: 3,836 executed
checks passed with no assertion or initialization failure. The N9 configuration
completed both lanes and fresh-context repeats, using the same authored inputs,
source pixels, camera policy and 31 update/draw pairs as the retained baseline.
Those primary checks cover exact channels, rotation, native calls and repeated
pixels. A frozen pre-operation artifact reservation guard stopped the allocation
after 140 of 330 planned draws and four of 22 planned pixel checkpoints; there
was no observed hard-cap breach or retry. Complete NULL/legacy equivalence,
N8/N11, lifecycle, death, fault, Setup, resize and LQ browser checks remain unrun.
Two PNGs and full compressed returns are retained; independent cleanup and input
integrity audits pass.

The separate stock Windows Firefox 158.0.1 attempt is inconclusive: fixture
instrumentation failed before any product assertion or pixel checkpoint. Its one
startup/session was consumed without retry; cleanup passed and the failed
returns remain preserved. Synthetic Canvas recorders do not rasterize or establish original
pixels, full host mapping, pending-source timing, extension installation,
performance or server acceptance. See the [antenna contract](antenna-presentation.md).

## Retained prey integration

The retained-prey integration has passed 360 native all-target tests, 127 Node
tests and a fresh real-Wasm build/full smoke with 2359 body/face/food/Setup/prey
recorder assertions. The prey checks include both production rendering lanes,
zero-alpha calls, whole/scaled overloads, ordering around food/snakes, LQ
retention, copied Float32 diagnostics, captured-object lifetime, late-Canvas
rollback, ordered Setup source retention and signed-zero revision conflicts.
An isolated registry probe additionally passed 588 assertions; it is separate
from the production renderer count. Page tests use authored doubles.

A separate bounded offline external-runtime comparison of the historical prey
candidate `993322acba23ee7b37639a661bd02a6a0e1ff798` completed all ten frozen
operations and 44 retained returns. With constant entropy 0.25 and authored or
mapped source objects, all 26,398 compared cells matched exactly: 20,938 across
11 neutral-state reports and 2,730 each across ten basic-render and ten
standard-render reports. Both production rendering lanes submitted their prey
commands. No actual network attempt occurred; the run used fake transport
constructors, sends and closes. Input pins and predecessor seals remained
unchanged, owned workers terminated, and no retry or post-data fixture change
was made. Earlier incomplete attempts remain preserved separately.

That result covers the frozen minimal numeric and submitted-command projections
of the named historical candidate. It does not establish current-client or
full-state parity, stock-browser pixels, full host adaptation, original
artwork/loading equivalence, gameplay or extension acceptance. Stock-browser
prey verification remains separate.

## Animated arena-edge rendering

The arena edge has a native fixed-path planner and retained camera polar cache,
integrated into both animated lanes and ordered Setup draws. Focused native and
real-Wasm recorder checks cover strict distance gating, projection/order, stale
no-own state, reset, event-time Setup centers, scoped Canvas state and rollback.
The integrated checks pass 371 native tests, 127 Node tests and the full real-Wasm
smoke, including 3,674 body/face/food/Setup/prey/edge recorder assertions.
The recorder distinguishes vector paths from arc-based eyes. These are synthetic
model/command checks; native trig is not a browser bit oracle. A stock Windows
Chrome capture of the preceding build preserves the thin gray-circle baseline.
Original-runtime commands, original pixels and the actual cosmetic chooser are
separate from this implementation's acceptance.

## Repository guards

Before committing, review and stage only intended files, then run:

```sh
git diff --cached
node tools/check-repository.mjs
node tools/check-repository.mjs --history
```

The guard reads index and committed blobs, so it does not cover unstaged edits.
The pre-push hook also inspects actual outgoing commits and their ancestry.
Enable hooks per clone with `git config core.hooksPath tools/hooks`. Passing
checks establish the guarded file boundaries, not ownership of arbitrary code.

## Offline scene and local simulator

Build the web bindings, then run:

```sh
npm run scene
```

Open `http://127.0.0.1:18884/`. The initial scene is entirely synthetic: three
snakes, 28 food items, original generated sprites and a generated background.
Step advances the own front anchor by eight units. Reset restores the fixture;
palette selection resets it with the selected own skin. Zoom and Follow affect
only the camera. `window.slitherSceneReport` exposes state counts and camera data.

For manual local integration, start an existing
[slither-sim](https://github.com/NikitaMGrimm/slither-sim) executable in a separate
terminal, then enable that exact port on the scene server:

```sh
slither-sim host --bind 127.0.0.1:8766
npm run scene -- --simulator-port 8766
```

Use the simulator's **host**, not its JSON `serve` command. Click **Connect local
simulator**, move the pointer over the canvas to aim, and hold **Space** while the
canvas has focus to boost. Blur releases boost. Disconnect stops the socket and
input timer; Reset returns to the synthetic fixture. A life ends on own removal;
another connection requires a manual click. No game discovery or official
endpoint is accepted. The local host accepts placeholder login credentials, so
this route does not verify credentials against another service.

Use a recent source build of the simulator and record its commit. Its package
version can remain unchanged between releases; `--version` alone does not
identify unreleased behavior.

Normal tests and CI never start this host or open a game socket. Optional CLI
ports are bounded; HTTP serves only literal `127.0.0.1` with exact Host checking.

## Presentation primitive checks

`tests/state_events.rs` covers ordered bundled actions, replacement/reset,
independent motion fields/directions, direct speed scalars, absolute appearance
geometry, compact own targeting after removal, food exclusion, truncations,
retention limits and complete rollback. The one-field `5` motion form is a
validated no-op; complete six-byte `3/4/5` forms retain their three motion fields.
The event API is native Rust. Earlier Wasm/browser checks exercised the received
scene and standalone predictors; the coupled checks below exercise its animation
consumer.

Native `tests/presentation.rs` covers fractional clocks, skew/clamps, lag changes,
turn wrapping/crossing, speed units, exact speed arithmetic, ring overlap/wrap,
Float32 assignments, deferred cleanup and invalid-input rollback. The real Wasm
smoke test also exercises owned animation steps, predictor motion/corrections,
rejection of invalid JavaScript directions before integer narrowing, copied
sample arrays and atomic failure. These checks use original synthetic inputs.

Those checks isolate the primitives. Coupled animation and standard-eye checks
are described below; quality-dependent drawing and full skins remain separate work.

`tests/presentation_geometry.rs` verifies length/camera ring overlap, distinct
clock and cleanup rules, mass scheduling, copied samples and atomic errors.
`tests/presentation_body.rs` covers initial absolute geometry, sequential
contraction, visible/invisible corrections, cached relative anchors, dying-tail
retention, independent logical/physical caps and late-failure rollback. These
are synthetic tests of the native model. The original `/` preview continues to
draw received anchors; `/animated` connects the model to sampled body drawing.

## Standalone boundary-radius checks

Seven native synthetic tests cover target scheduling, connection and whole-step
gating, overlapping/equal updates, absolute samples, wrap, deferred cleanup,
setup cadence, double-precision storage, cancellation to zero for a tiny positive
target and atomic rejection. The real Wasm
presentation smoke checks the copied arrays, current-host cosine weights,
borrowed-step gating, setup behavior, exhaustion and invalid inputs through
`BoundarySmoother`. These establish the standalone numeric API; the coupled
checks below exercise scene packet consumption and boundary rendering.

A private real-Wasm comparison against the complete pinned runtime matched
6,385 fields exactly across four frozen schedules and 97 operations. Inputs were
authored radius targets, connection changes and timestamps; Rust consumed its
own animation clock. Weights, complete double-precision rings, displayed/target
radii, cursor and pending state matched without a tolerance. Observed/control
snapshots also matched. Coverage includes shrink, overlap/equal targets, wrap,
disconnect/reconnect, fractional/lagged time and backward timestamps. Setup was
initialized explicitly, so setup-parser equivalence is not established. This is
numeric Node/Wasm evidence without scene, pixel, browser or server acceptance.

## Coupled animation checks

Thirteen native boundary-client tests cover ordered and repeated targets, setup and
reset retention, connection gating without a catch-up backlog, continued entity
animation, draw independence and complete packet/numeric failure rollback.
The real Wasm smoke checks copied boundary samples and received/displayed radius
separation. Canvas-recorder checks exercise both render paths, radius easing,
disconnected drawing, Canvas failures and hiding retained state before setup.
Page doubles verify that socket open alone does not activate the gate and that
disconnect, life end and teardown clear it without touching freed owners.
Native and real-Wasm reset regressions cover the retained 3-ms plus 5-ms phase,
doubled accumulation, backward timestamps, clamped pauses, restored lag speed,
world clearing and boundary retention without an extra step. The generated Wasm
reset signature and all page reset routes are checked as parameterless. Existing
body-painter tests cover retained flags; page doubles cover owner cleanup and
unchanged update/quality ordering. These are synthetic numeric/command checks;
the following comparisons separately exercise native rendering and the runtime.

Stock Windows Firefox 158.0.1 headless passed 1,265 assertions on the initial
integration, including both Canvas paths and authored-page lifecycle checks.
At matched initial/immediate/8-ms/48-ms checkpoints, native boundary radii changed
from `[1000,400,400,400]` to `[1000,1000,1000,987.8478920843492]`. All four new
checkpoints repeat exact decoded pixels; nine no-target body checkpoints preserve
their prior pixels and existing numeric fields.

A focused corrected-build Firefox recheck passed 235 assertions. It reproduced
the old fractional-step loss and verified one whole and two doubled steps after
3 ms, reset, then 5 ms. All five tested page reset routes passed no arguments.
Both Canvas paths passed phase, lag, retained-ring and connection checks. Four
no-reset checkpoints preserve the initial integration's pixels and complete
snapshots exactly. The page checks use an explicitly synthetic transport.

The corrected real Wasm also matches eight frozen runtime schedules and 195
operations exactly: 12,106 boundary/absence, 931 clock, 693 bundled/sequential and
195 copied-array checks, plus 36,068 preserved observer/control comparisons.
All 29 earlier reset mismatch cells are cleared without changing cases or
expected observations. Equality uses `Object.is` without tolerance; these cells
contain no negative zero. Setup, targets, shared timing, repeated setup and reset
are covered; source WebSocket framing and entity behavior are outside this empty-
world comparison. These results do not establish original pixels, full skins,
real transport, extension installation or full-client equivalence.

After building and starting `npm run scene`, open
`http://127.0.0.1:18884/animated`. Its animation callback advances the explicit
clock, frees the returned step, then renders once. Step anchor injects a packet
while animation continues. Reset, Palette, Follow and Zoom exercise the same
model. `window.slitherAnimatedSceneReport` exposes the latest numeric readout.
The existing loopback controls are available when the server was started with
`--simulator-port`.

`tests/presentation_snake.rs`, `presentation_camera.rs`, `presentation_client.rs`
and `presentation_curve.rs` cover the coupled packet/update/draw clocks,
absolute geometry, sequential contraction, correction overlap, dying retention,
draw-driven zoom/spacing/culling, curve redistribution and exact stored tangent
order. They also cover duplicate lookup/removal, retained own identity through
ID reuse, retention limits, signed corrected edges and late-failure rollback.
Team mode 2 is explicitly rejected atomically. A short appearance with fewer
than two anchors is retained but omitted from curve drawing until another
anchor arrives; no one-point visual-equivalence claim is made.

The real ABI smoke includes the coupled `AnimatedScene`: copied diagnostics,
packet/update/draw ordering, invalid JavaScript inputs, late malformed-frame
rollback, duplicate removals, short-body recovery and dead/immediate own removal
followed by separate or bundled wire-ID reuse.

On 2026-10-26, Chrome 152 / Electron 44 on Windows passed 28 assertions across
six coupled Canvas2D groups with a 960x540 backing canvas. Checks included
prediction without packets, one camera sample per render, independent head-ring
consumption, complete deterministic pixels after hostile caller drawing state,
atomic rejection, one-anchor render recovery and retained-own input lifecycle.
Stock Windows Firefox 158.0.1 headless passed 606 assertions on the final build,
including the prior Scene pixel regression and the authored
animated page's animation loop, controls and pagehide cleanup. These use only
original synthetic packets/artwork. They establish execution and these cases;
they do not establish original pixels, complete quality/skin fidelity, desktop
Firefox interaction, performance targets or official-server acceptance.

A coupled offline comparison against the complete pinned runtime passed ten
cases and 508 operations: 2,037,174 comparisons matched exactly, including signed
zero, without a tolerance. It covered 326 updates, 53 packet operations, 289
numeric draws and 14,411 active curve samples. Inputs were authored packets,
timestamps and view controls; Rust received no observed head, body, visibility
or integer-step state. Coverage includes fractional/lagged clocks, motion,
overlapping rings, growth/mass/tails, camera/culling, signed corrected edges,
death/expiry and retained-own compact packets. Setup constants were initialized
explicitly in the private oracle, so this does not compare its setup parser.
Quality scale and detailed-style flags were external inputs; pixels, full skins,
quality-state integration and general whole-world equivalence remain unverified.

The animated page also ran against unreleased simulator commit `9480608` in
Windows Chrome/Electron with the small sandbox configuration described below.
The first local life applied 117 frames / 210 commands without rejection, then
ended normally: the own object remained retained after death expiry and left the
draw collection. A second manual connection verified heading, ping and boost
start/release messages, then disconnected manually. The boost hold used explicit
synthetic DOM key events across the transport timer. Both local test processes
were stopped and their listeners closed. This is bounded local integration
evidence; it does not establish official-server or full gameplay acceptance.

A small Chrome/Electron diagnostic measured the coupled model separately from
drawing at 1280x720 with a fixed centered camera and initial zoom 0.3. Across two
rotating rounds, six measured calls per metric gave baseline/dense medians of
below timer resolution / 1.3 ms for updates, 0.4 / 249.4 ms for render submission,
and below timer resolution / 0.3 ms for opaque frame application. The dense case
used 64 snakes, 8192 anchors and 8192 food items. The submission canvas was never
read back. This is a small diagnostic, not FPS, a GPU timer, a performance target
or a comparison with the received-anchor renderer's different geometry. Dense
curve drawing still requires profiling and precision-preserving optimization.

### Isolated numeric comparisons

A further offline comparison matched 25,610 length/camera scalar and sample
values exactly across 133 operations. Camera discontinuities were supplied from
observed head/base-camera state to isolate its correction ring; this does not
verify a complete following camera. The actual Wasm bindings also passed Chrome
152 / Electron 44 checks for all 62 camera weights, per-draw consumption, live
zero-step length cleanup and integer-input rejection. Stock Windows Firefox
158.0.1 headless passed 158 assertions across 13 synthetic ABI/Canvas2D groups
on the refreshed build, including the new length/camera bindings. Desktop
interaction, Firefox performance and complete presentation parity remain unverified.

Synthetic exhausted-body tests cover absolute and cached-direction anchors,
non-growing zero-count retention, growth recovery, and complete rollback when
a later tail removal would require a negative logical count. The native body
API supports nonnegative counts; these tests do not claim negative-count parity.

A native body comparison covered five cases and 779 operations: 6,349,529
Float32 samples/weights, 330,206 double-precision values and 92,987 discrete
fields matched exactly, with maximum observed body error zero. It initialized
through synthetic setup/appearance packets and the Rust events. Cases included
growth/tail removal, visibility changes, overlapping corrections, dead updates,
ring drain and 140 updates of 40 ms for dying-tail retention. Head positions,
visibility and integer steps were supplied from runtime observations to isolate
the body; coupled head/body/camera behavior remains a separate comparison.

An offline comparison on 2026-10-26 matched all seven timing fields exactly
across 67 synthetic clock updates against the pinned client runtime. Cases
included fractional accumulation, zero/backward time, long pauses, lag decay,
skin-preview timing and recovery. The external harness replaced drawing with
numeric capture and used no real network. This establishes the tested clock
sequence; it does not establish full presentation or visual parity.

Five head-motion cases covered 102 updates and 1,428 scalar comparisons with no
numeric differences observed. A further 68 updates through the original packet
handler matched 1,022 head/correction scalar values and 13,505 stored Float32
samples exactly, including immediate injection, overlap, wrap, clearing and
deferred cleanup. The head-only comparison supplied body-derived turn factors
from the reference and used zero packet-extrapolation time. It does not verify
body, camera, curves, skins, rendering or entity death lifetime.

## Standard paired eyes

Appearance-time geometry regressions cover first fractional-update clamps at
travel 0.02/0.04, explicit-default solver equivalence, constructor rejection,
copied ownership, wire-order resolution through duplicates and mid-frame setup,
short/immediately removed appearances, retained death/reused-ID styles, and
complete rollback after a late callback or geometry error. Framing and received
tail failures invoke no resolver. Native tests compare complete client state.

The real Wasm ABI smoke also checks exact appearance requests, copied custom
bytes, callback exception identity, accessor/inherited/missing metadata rejection
without getter calls, numeric/color bounds, unsupported rates/styles/promises,
post-application metadata mutation, and default diagnostics/curve preservation.
The Canvas recorder checks nondefault colors/radii/outline/layout and first
fractional pupil travel, pending-body metadata use, exact default commands in
both render paths, signed-zero-aware recipe coherence, and pre-reset rejection
with model rollback. The explicit `none` renderer lane remains covered.

The integrated milestone passed all 250 native tests and 116 Node tests,
formatting, doctests (no examples), native/Wasm Clippy, a fresh web build and
the complete synthetic Wasm smoke, including 496 Canvas-recorder assertions.
Focused independent review found no actionable defect and separately passed
59 native tests, the pinned integrated ABI smoke and both source guards.

A separate exact comparison against the complete pinned offline runtime passed
64,069 cells in four frozen schedules: 13,548 retained eye/head/camera cells,
406 clock cells, 8,788 ordered paired-eye call cells, 2,734 frozen-metadata and
appearance-request cells, 32,747 observer/control cells and 5,846 default-API
preservation cells. Ten Wasm runs covered 176 operations and 84 draws. Nondefault
travel matched before the first fractional update's draw; duplicate/death/ID-reuse
styles matched through both render paths. Rust received authored packets,
timestamps, controls and frozen recipe metadata, without observed motion,
geometry, camera or expected commands. Equality used no tolerance; none of the
compared cells contained negative zero. Five additional mismatched-recipe probes
rejected before target reset. Supplemental face decorations, full skins, host
mapping and native raster equivalence are outside this comparison.

Stock Windows Firefox 158.0.1 separately passed 524 assertions across 24 native
checkpoints and eight fresh-context repeats. Explicit travel was active before
the first fractional update; both draw paths retained nondefault paired colors,
radii, outlines and layouts. Inherited/accessor metadata and mismatched ready
recipes rejected without clearing pixels or changing model state. Default APIs
preserved baseline pixels, complete snapshots and Canvas calls exactly. Matched
raw captures use authored synthetic artwork and metadata; the old build uses
its default-only API, without implying it supported the new parameters. These
checks do not establish original pixels, full skins, performance, extension
integration or server acceptance. Browser diagnostics do not retain signed zero.

Synthetic native checks cover effective/wanted heading initialization, Float32
easing, shortest arcs, fractional pupils, visibility entry, deferred draw-target
feedback, death/expiry and per-eye layout arithmetic. Coupling checks include
remote gaze versus original-own pointer gaze through wire-ID reuse, spacing
cadence, prepared sample limits and complete rollback. A drained two-anchor body
that emits one render sample retains its raw-heading eye target.

One-anchor tests separately cover a finite sampled head-lead target, predecessor
independence, detailed style and negative displayed length. Coincident or longer
geometry requiring a missing following anchor keeps a finite raw-heading
fallback and no body curve. This policy does not claim general one-anchor parity;
the external runtime can consume scratch coordinates from a preceding snake,
produce nonfinite geometry or fail on that missing anchor.

The integrated build passes 176 native tests, formatting, doctests and native/Wasm
Clippy. The real Wasm smoke checks independent gaze, copied eye diagnostics,
input rejection, style-aware preparation, fractional pupil motion, death fading
and short-curve output. These are synthetic numeric checks; full skin geometry,
special faces and complete renderer fidelity are outside this layer.

All 97 Node tests pass, including 14 mocked-page cases for full-radian gaze,
CSS-to-backing coordinate conversion, separate quantized steering, RAF ordering,
retained gaze through death/disconnect/reset, boost release and teardown. These
page doubles do not establish browser input or raster behavior.

Stock Windows Firefox 158.0.1 headless passed 614 direct Canvas/ABI assertions
and 889 assertions on the unchanged authored page. Nine matched synthetic
checkpoints reproduced the saved baseline pixels exactly before testing the
new build; its changes were confined to the eye/pupil bounds. Existing numeric
head/body/camera fields and the received Scene pixels remained unchanged.
Checks included fractional pupils, death alpha, per-snake paint order,
short-body recovery, retained-own identity, hostile context reset and rollback.
The page checks covered CSS-scaled full-radian gaze, reset/death/disconnect
retention, native RAF ordering and pagehide cleanup. Deterministic checkpoints
and native real-time RAF observations were recorded separately. All test
processes, listeners and temporary profiles were removed.

The bounded one-anchor correction subsequently passed 324 ABI/Canvas assertions
and 13 native-page assertions in the same stock Firefox version. These checked
finite lead targets, predecessor independence, raw-heading fallback, fractional
updates, continued native animation and rollback, while body/curve diagnostics
remain omitted for one anchor. All nine normal-fixture pixel hashes matched the
earlier eye build exactly. Existing media retains its original build label;
these checkpoints do not compare every frame of the native-timed recording.

A corrected-build Wasm rerun against hash-verified, frozen observations from
the complete pinned runtime matched all supported numeric comparisons exactly:

| Comparison | Cases | Operations | Exact comparisons |
| --- | ---: | ---: | ---: |
| Unchanged coupled core | 10 | 508 | 2,037,174 |
| Coupled eyes | 9 | 263 | 78,213 |
| Focused continuation | 1 | 5 | 1,598 |
| Supported one-anchor targets | 6 | 80 | 12,783 |

All 2,129,768 executed comparisons had zero mismatches and maximum error zero,
using signed-zero-aware equality without a tolerance. The continuation overlaps
a primary case; these are executed comparisons, not independent features.
Five unsupported one-anchor policy cases passed 51 separate assertions; their
eight intentional source-target differences are recorded and excluded from
parity totals. These numerical results cover standard eye state and layout
arguments, with quality/style supplied externally, not full one-anchor body
geometry, renderer quality integration or raster equivalence.

These browser checks use original synthetic packets and stand-in artwork.
They do not establish original-client pixels, full skins, connected transport,
desktop performance or official-server acceptance.

## Standalone quality state

`tests/presentation_quality.rs` and the real `DesktopQuality` ABI smoke cover
requested versus applied mode, connection/preview resets, interpolation before
statistics, strict interval and draw-count thresholds, fallback, recovery and
negative residuals. Invalid modes, timestamps and fractional/out-of-range counts
preserve the previous state. These tests do not connect quality to the renderer.

A separate native offline comparison against the pinned complete runtime matched
51,240 fields across 8,540 operations in six cases exactly. It supplied explicit
draw counts rather than measuring browser FPS. This verifies the tested numerical
quality state. It does not verify browser quality effects, renderer integration,
pixel fidelity or automatic fallback under actual desktop load. Separate bounded
renderer and authored-page checks appear below.

The integrated real Wasm bindings also matched those six frozen runtime traces:
51,240 fields and 8,492 statistics-reset return values matched exactly. The
private evidence documents JSON's signed-zero limitation. Seven Chrome/Electron
assertions separately checked preference application, interpolation ordering and
atomic input rejection through the browser ABI. These remain standalone checks;
page integration has separate synthetic checks described below.

Stock Windows Firefox 158.0.1 headless separately passed 224 standalone quality
assertions on that build. This checked the numerical ABI and input rejection;
it did not exercise quality effects under actual rendering load.

## Trusted skin-provider checks

`tools/skin-provider.test.mjs` uses original synthetic metadata and realm doubles
to check trust/input boundaries, collection limits, frozen numeric snapshots,
exact asset identities, readiness/revisions, source rectangles and unsupported
features. The provider does not contain stock recipes or host member mappings.
It does not load images, draw, read pixels or open connections.

On 2026-10-26, eleven Windows Chrome/Electron assertions and 49 stock Firefox
158.0.1 headless assertions exercised synthetic trusted callbacks with real
canvas/image objects. They verified pending-to-ready transitions, native image
dimensions, preserved identity after canvas painting, frozen old snapshots,
rejection before callbacks and explicit unsupported status. Firefox imported
the unchanged ES module. These establish that provider boundary only; host
mapping, full skin/attachment coverage, rendered pixels and extension integration
remain separate work.

## Standard body planner checks

Thirty-two native synthetic tests cover pass order, shared distance-cursor
updates, quality gates, palette runs and variants, overlapping fades, opacity
retention, stored tangents, exact source identity/revisions/crops, bounds and
atomic failures. Independent read-only review reran these tests and the source
guards without finding an actionable defect. The provider extension separately
passed 24 focused synthetic tests and independent boundary review.

A private real-Wasm adapter compared the planner with fresh observations from
the complete pinned runtime in ten cases: all 4,823 ordered image calls matched
across 118,830 exact comparisons, including signed zero, without a tolerance.
Fresh numeric observations also matched the preserved earlier capture, and
the observer/control state and buffers remained equal in the tested cases.
Coverage includes HQ/LQ/transition gates, boost, spawn/death, mixed runs, custom
and detailed variants, overlapping fades and fresh versus retained cull flags.

This isolates the planner: geometry, effective flags, recipe metadata and cursor
seed were supplied from observations. It does not verify their production
collection, quality evolution, Canvas submission, browser pixels, antennas or
all-skin behavior. The runtime fixtures use whole-source image calls; cropped
uses have synthetic coverage only. Effective alpha is the observer's logical
Canvas-state interpretation, not native raster evidence. Pass labels and final
cursor output were not directly observed and are excluded from the comparison
claim. External adapters, source identities and raw evidence remain outside Git.

## Retained food integration checks

The combined local suite passes 308 native tests, 119 Node tests, formatting,
doctests, native/Wasm Clippy, a fresh web build and the full real-Wasm ABI smoke.
The combined body/face/food recorder passes 1,654 assertions. Of these, 99 exercise
the integrated food factory/state/render path through both actual renderer APIs:
duplicate instances versus the received map, raw/effective colors, BigInt
identities and copied diagnostics, initial/zero-delta/full-size scale, early/late
order and exact overloads, glow projection, HQ/LQ/blend, creation-selected sources,
configuration-only Setup, retained eater ID zero through removal/reuse, expiry/GC,
late factory failure and Canvas-fault rollback. The basic legacy quality-less API
rejects an enabled food session before clearing. The page uses the same complete
factory path, preserves shared update/quality/statistics/draw cadence and passes
23 focused page/server tests included in the 119-test suite. Another 72 recorder
assertions cover 16 signed-zero revision schedules across both render APIs:
matching positive or negative zero is accepted, while every conflicting alias
observation rejects before target clear and preserves the complete model.

A separate synthetic harness passed 243 real-Wasm registry assertions, including
own-data parsing, all canvas/image overloads, source aliases, revisions, signed
zero, resource caps, GC and exception identity. It executes the actual registry
against a frozen native component; it is separate from production integration.
Independent native review at the earlier native integration revision passed 122
focused tests and found one stale cache comment, since corrected. That review
predates the Wasm/face/page integration.

These are synthetic state and logical Canvas checks. Independent combined review
found a signed-zero source-revision coherence defect; the corrected alias boundary
passes the new regressions and a focused independent recheck. At the corrected
food revision, a bounded numeric comparison matches 124,356 food-engine cells;
the same six Setup/layout submission-presence differences remain failures.
Separate corrected stock Windows Chrome and Firefox checks pass 20,172 and
10,805 assertions respectively, using authored textures and timestamps. These
earlier results cover the food engine and explicit draws. No food original-pixel, installed
extension or live-server acceptance is claimed. See [the food contract](food-presentation.md).

## Target-aware Setup and resize checks

The initial host change passed 314 native tests, 127 Node tests, formatting,
doctests, strict rustdoc, native/Wasm Clippy, a fresh web build and full real-Wasm
smoke. The body/face/food/Setup recorder passes 2,093 assertions, including 439
new Setup/resize assertions. These are synthetic native-call doubles rather than
browser rasterization.

The new host route has separate synthetic tests for ordered per-Setup plans,
event-time configuration, draw-driven camera/spacing changes, creation-time food
zoom and source retention through later removals. Real-Wasm recorder checks cover
both target-aware application and size-aware render APIs, multi-Setup ordering,
preclear callback/metadata/readiness/alias rejection, aggregate resource limits,
changed/unchanged dimensions and late Canvas-failure model rollback.

Page doubles cover initial and repeated Setup counts, synchronous unchanged-size
and changed-size resize, renderer selection before reset packets, exact shared
RAF/quality/statistics ownership, CSS-to-backing input coordinates and teardown.
The pure desktop layout tests use authored viewport/expected-dimension pairs and
invalid/overflow inputs. Fullscreen login/HUD layout and mobile insets are not
represented by the contained zero-inset demo page.

These checks compare actual candidate operations against authored ordered
controls. Independent review found no supported defect and passed 493 focused
Wasm assertions and 28 page/layout tests. Stock Windows Chrome and Firefox
checks passed 1,722 accepted assertions across six successful runs, including
exact copied state, ordered painting, decoded pixels and authored-page cadence.
Five failed/incomplete attempts remain preserved and excluded. The browser task
exceeded its required 100 MiB artifact cap before lossless compression; its
result is qualified and is not cap-compliant.

A separate offline runtime comparison retained 40,602 projected cells with 18
camera-cursor differences from pre-existing reset behavior. Initial Setup, resize
and strict quality cases matched within its projection. Its three-Setup axis
remains inconclusive after a control VM timeout with missing durable operation
data; no retry occurred. All 86 reservations remain charged. The reset correction
preserves the camera-ring cursor while clearing offsets; its native regression
first reproduced the old mismatch. Corrected-build comparison and the new
background-budget boundary checks are recorded separately when completed. Earlier food
evidence and its six retained host mismatches are unchanged; no full-client,
original-pixel, extension or official-server acceptance follows from these tests.

The correction passes 315 native tests, 127 Node tests and full real-Wasm smoke
with 2,228 recorder assertions, plus formatting, doctests, strict rustdoc and
native/Wasm Clippy. Both renderer lanes accept exactly 64 tiny Setup draws or
four 4096-square draws and reject the next excess before context/pattern
acquisition or renderer mutation. Tests preserve the independent sample,
catalog and image budget probes, explicit maximum-size rendering and late
callback side-effect boundaries. Native and Wasm reset regressions retain the
camera cursor while clearing corrections. These corrected results are synthetic;
the earlier browser observations remain evidence for their pinned prior build.

## Opt-in standard-body renderer checks

The integrated paired-face completion adds six native geometry/ownership tests,
three provider tests and real-Wasm coverage through both actual render APIs.
The combined local suite passed 256 native and 119 Node tests, with 1,483
body/face Canvas recorder assertions. Checks cover exact source identity and
whole/crop overloads, oblique non-unit geometry, signed-zero coherence and derived
zero/underflow, body/death/eyes/reset/pair/next-snake order, spawn/death and applied
quality, inclusive anchor culling and short faces, duplicate/dead/reused IDs,
partial provider projections, readiness/revision/alias rejection, late source
mutation and Canvas-exception model rollback. Legacy default forms retain the
same recorded commands under the corrected unconditional end-of-face alpha reset.

Those authored synthetic checks use a logical Canvas recorder. Separately, the
paired-face production revision passed independent review, 97,624 exact frozen
complete-runtime comparisons with zero mismatches, and 1,667 accepted Windows
Firefox 158.0.1 assertions across 40 native checkpoints and ten fresh-context
repeats. Numeric coverage includes paired-eye/image transforms, shared source
identity, logical alpha and body/face/next-body barriers; body artwork remained
synthetic. Firefox uses original asymmetric artwork and preserves default
numeric state and pixels. No compared numeric cells contained negative zero.
These results predate the food/setup integration and do not establish its parity.
Ready trusted sources bound the capability; startup blank-source draws, general
host mapping, original pixels, other face families, extension installation and
server acceptance remain separate.

`tools/body-render-smoke.mjs` executes the real Wasm `render_standard` ABI with
an original synthetic Canvas recorder and normalized provider snapshots. Its
296 assertions cover per-appearance custom/cosmetic requests, duplicate IDs and
original-own removal/reuse, whole-source versus full/partial crops, exact source
objects, transforms/destination arithmetic, ordered body/death/eyes, HQ/LQ/blend
gates, mixed glows, ignored invalid alpha, readiness/revision coherence, short
bodies, aggregate command limits, pre-reset rejection and Canvas exception model
rollback. The same checks run from `tools/wasm-smoke.mjs` after the web build.

Two additional native client tests cover heterogeneous sampling/flags, retained
appearance metadata and uniform API equivalence. The provider suite has 26 tests,
including opt-in source-mode preservation and legacy output shape. These are
synthetic checks. The Canvas recorder models alpha/state and records calls; it
does not rasterize or measure a browser. The earlier planner differential result
does not establish production collection/submission parity. The production
comparison below separately covers bounded schedules; performance and all-skin
support remain unverified.
See the [API contract](standard-body-renderer.md).

The animated page's synthetic body resolver and mocked-page tests separately
check the three authored recipes, exact source identity, unsupported appearances,
shared-step quality ordering, raw draw counts at the strict statistics boundary,
deferred connection preference, reset cadence and cleanup after quality errors.
These are synthetic Node checks; they do not establish browser pixels or
production collection parity with an external runtime.

Stock Windows Firefox 158.0.1 headless separately passed 247 native Canvas
assertions and 1,290 assertions on the unchanged authored page. Native checks
cover live source identity, crop overloads, mixed styles, quality borrowing,
painter order, native invalid-alpha retention, preflight rejection, hostile
context reset and model rollback after Canvas exceptions. An independent native
Canvas getter supplies the expected alpha round trip; no tolerance is used.

Nine matched synthetic checkpoints use the same three views and explicit
0..624-ms timeline as the preserved BEFORE build. All complete exported numeric
and camera snapshots match BEFORE exactly, and all nine fresh-reload repeats
match AFTER pixels and numeric state exactly. Body pixels intentionally change;
there is no external pixel oracle. The JSON diagnostics do not retain signed zero.
A separate received-Scene fixture retains its prior pixel hash.

Native RAF and trusted CSS-scaled pointer input separately verify gaze before
advance, one shared owned step, quality interpolation before statistics, raw
successful draw counts independent of throttled readouts, deferred preference,
HQ synthetic reset and pagehide teardown. No game socket is constructed. A
6.264-second native recording preserves 155 decoded source frames; it is a
synthetic demonstration, not an FPS or performance measurement. Test processes,
listeners and temporary profiles were removed.

These checks establish the tested native Canvas and page behavior. They do not
establish original pixels, full skins, extension realms, connected transport or
official-server acceptance.

A separate production `render_standard` comparison against the complete pinned
runtime passed five frozen schedules, 114 operations and 71 draws. All 25,121
ordered body image calls matched across 502,822 body-call cells. The total,
including supplemental clocks, camera, entity/eye state and diagnostics, is
525,983 exact cells, with zero mismatches and no tolerance. Separate translations
and rotations, source IDs, overloads, requested/effective alpha and blend match.
The comparison normalizes a leading identity transform; it compares each image's
logical scoped state rather than equal raw save/restore sequences.

Rust receives authored packets, timestamps, pointer/view controls and normalized
live recipe/source metadata. Observed geometry, sample flags, cursor seeds,
camera outputs and commands are not supplied. Independent observed/control runs
match 119 snapshot pairs and 71 draw pairs, including curve caches, buffers,
retained flags and fake-network records. No actual network connection is made.

Coverage includes turning/anchors, multiple snakes, culling/retained flags,
detailed sampling, boost, death and own-ID reuse. All calls use whole sources and
standard skin zero. HQ and LQ are frozen at their public initialization states;
adaptive-quality evolution, mixed/custom skins, cropped-use parity and general
one-anchor bodies are excluded. Equality distinguishes signed zero, but no body
comparison cell in these schedules contains negative zero. This is Node/Wasm
numeric evidence, separate from native Canvas, pixel and server acceptance.

## Dense-scene benchmark

Native collector tests cover the unrounded sampler seed, original ordinals,
inclusive culling, shared retained flags, detailed cadence, short-curve omission
and transactional failures. Independent review passed 75 focused tests for
collection and 78 for the later staging cleanup. The combined native suite
passed 221 tests.

A private before/after real-Wasm recorder checked the staging cleanup across
123 normal draw pairs and nine failure cases, plus death continuation: 420
assertions passed, comparing 126,187 Canvas calls and copied model diagnostics
exactly. This establishes command preservation for those fixtures. It does not
measure a speedup or verify production-collector parity against an external
runtime, browser rasterization, or the new body painter's Canvas submission.

After `npm run build:web` and `npm run scene`, open
`http://127.0.0.1:18884/benchmark` and use **Run benchmark**. It generates only
original synthetic packets/artwork, uses real Wasm state and the existing
Canvas2D renderer, and exposes the final JSON as `window.slitherBenchmarkReport`.
It does not start a simulator or connect to game servers.

| Profile | Snakes | Anchors per snake | Food |
| --- | ---: | ---: | ---: |
| Baseline | 3 | 16 | 64 |
| Dense | 64 | 128 | 8192 |
| Stress | 128 | 512 | 32768 |

Profiles rotate order across rounds. Submission canvases never undergo pixel
readback; separate canvases measure draw plus forced readback. Unsupported-only
`p` frames measure full atomic application overhead, including staging, without
changing geometry. Median/p95 call durations are not presentation FPS or GPU
timer measurements. MessageChannel yields let the browser service input between
draws. Browser, driver, viewport and acceleration state affect these results.

A 2026-10-26 T3 Code Windows run (Chrome 152 / Electron 44, 1280x720 backing
canvas, NVIDIA RTX 5070 Ti through ANGLE/D3D11) used two rounds of five measured
draws per profile. Submission medians were 4.4 / 7.6 / 38.6 ms; atomic unchanged
frame medians were below timer resolution / 0.1 / 0.3 ms. These ten-sample results
are a diagnostic baseline, not a stable performance threshold. Firefox timing
has not been measured. They establish neither original visual fidelity nor a
reason to trade precision for speed.

## Recorded scene results

On 2026-10-26, the T3 Code browser (Chrome 152 / Electron 44, Windows) executed
the real Wasm renderer. Ten synthetic checks passed: own palette pixel,
deterministic full output, caller clip/filter/transform reset, state and rendered
rollback after malformed input, camera following an updated head, alternate
palette, invalid camera/zoom, source-target alias, unloaded image and empty target.
These use original generated fixtures, not a visual parity oracle.

Stock Firefox 158.0.1 on Windows, running headless with a fresh isolated profile,
also executed the standalone clock/predictor and received-anchor Canvas2D scene:
119 assertions across 13 synthetic groups passed on the presentation-foundation
build. This covers deterministic output, palette pixels, caller-state reset,
input rejection, atomic rollback and scene transitions. Interactive desktop
behavior, performance and original visual equivalence remain unverified.

The optional loopback asset page rendered the same three-snake/28-food scene
with exact existing palette canvas identities and its loaded background image.
The earlier two-rectangle pixel comparison continued to pass, with zero game
sockets. The scene observation establishes object reuse and execution only.

A locally rebuilt simulator at `dd9604455e7a373bd82fe107514eb01f33f3d49a`
accepted header-free direct login from the browser. Real Wasm applied setup,
own appearance with the selected skin, food and subsequent motion/removal frames;
the camera followed the own head. Local life-end handling and manual reset were
observed. No simulator source was changed. This establishes the tested local
path, without a full gameplay or official-server acceptance claim.

A follow-up on the same date used a fresh source build of unreleased simulator
commit `9480608d6c3cd0e6c12c0ec247ca52a4cdede9bc`, whose package version still
reported `0.4.0`. A small sandbox configuration used one client, no bots or prey,
fixed radius 1500 and food target 200. Windows Chrome 152 / Electron 44 applied
119 frames (213 commands, including 34 opaque commands) without rejection through
the real Wasm client, received protocol 19 and rendered the own snake and food.
Pointer aim and boost messages were sent, followed by manual disconnection.
The isolated host and page server were stopped afterward. This refresh verifies
the local transport/received-state path; the new presentation primitives remain
separate from it. Firefox simulator integration and complete presentation
equivalence remain unverified.

## Optional external checks

These commands use an existing trusted archive outside the checkout. They do not
download a reference. Build the web bindings first. Replace `/path/to/trusted archive`
with the path to your existing trusted archive.

```sh
npm run compare:reference -- --reference-root "/path/to/trusted archive"
npm run prototype -- --reference-root "/path/to/trusted archive"
```

The offline comparison requires `raw/game1107249518.js` and
`tests/browser-double.mjs` under the supplied root. The harness must export
`startClient` with the runtime interface used by `tools/reference-context.mjs`.
Only use a trusted harness: the comparison imports and executes it locally.

The browser prototype requires the same pinned client, `site/index.html`,
`site/assets-manifest.json`, and the cached images named by that manifest. The
manifest has `schema: 1` and a `files` object keyed by `s/<image>` or `s2/<image>`;
each entry supplies a lowercase SHA-256 and positive byte count. Images reside
at the corresponding paths under `site/` and are checked when served. The HTML
must have head/body elements and load the client through `/client.js`.

The prototype serves `http://127.0.0.1:18882/reference/` by default. Its page fence
blocks WebSockets and maps reference image loads to the local cache. Open the
printed loopback URL to inspect the Wasm draw and `window.slitherPrototypeReport`:
`wasmExecuted`, `sourceObjectsReused`, and `pixelsEqual` should all be true.

## Recorded prototype results

- Local loopback verification in the T3 Code browser (Chrome 152 / Electron 44,
  Windows) executed Wasm, retained exact existing
  canvas/image object identity, and matched all output pixels for the
  two-rectangle draw and blank one-pixel gutter. Additional real browser checks
  passed for resetting caller clip, filter, and transform state, and rejecting
  an invalid target, incomplete image, and source canvas used as target.
  No game sockets were opened.
- The offline external comparison matched four login cases and three synthetic
  challenge cases byte for byte. This establishes those cases only, without
  general protocol or gameplay parity.
- On **2026-10-26**, one Node/WebSocket session to a selected literal-IP official
  endpoint accepted the handshake through setup protocol 19 with an explicit
  Origin header and nickname `(Bot) Bottington`. Exactly one WebSocket
  constructor was used. Rust solved the actual server challenge and matched
  the external handler; login bytes were identical. The probe stopped immediately
  after setup, with no movement, gameplay, ping, or retries. It completed in
  351 ms including teardown. The ledger and raw evidence remain external;
  that attempt's allowance is consumed. This establishes acceptance for that session only, without
  browser-origin, extension, gameplay, or general parity proof.

These results do not establish a playable game, full world rendering, or an
installed extension. Browser evidence is separate from the Node Wasm ABI smoke
test; use exact environments and procedures when reporting further observations.

## Manual live-check boundary

`tools/live-handshake.mjs` is a separate, explicit manual entry point. It requires
authorized scope for **one attempt**, a selected literal-IP endpoint, an external
reference, and a fixed external evidence directory. It reserves
`official-attempt.json` exclusively before socket construction and limits the
probe to ten seconds. The ledger remains consumed even if no connection succeeds.
Never retry, delete or replace the ledger, or select another evidence directory
to bypass it. Keep raw evidence external and report only a bounded textual result.
This check is never part of normal tests or CI.
