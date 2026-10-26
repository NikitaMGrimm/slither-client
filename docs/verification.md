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

CI runs repository guards and npm tests, native Rust checks on Linux and Windows,
and the web build plus Wasm ABI smoke test on Linux. It runs on pushes to `main`,
pull requests, and manual dispatch. Normal tests and CI require no external
reference and do not connect to game servers. Dependency and toolchain setup may
access package sources. Release-plz remains dormant.

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

Those checks isolate the primitives. Coupled event/render checks are described
below; eyes, quality-dependent drawing and full skins remain separate work.

`tests/presentation_geometry.rs` verifies length/camera ring overlap, distinct
clock and cleanup rules, mass scheduling, copied samples and atomic errors.
`tests/presentation_body.rs` covers initial absolute geometry, sequential
contraction, visible/invisible corrections, cached relative anchors, dying-tail
retention, independent logical/physical caps and late-failure rollback. These
are synthetic tests of the native model. The original `/` preview continues to
draw received anchors; `/animated` connects the model to sampled body drawing.

## Coupled animation checks

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

## Standalone quality state

`tests/presentation_quality.rs` and the real `DesktopQuality` ABI smoke cover
requested versus applied mode, connection/preview resets, interpolation before
statistics, strict interval and draw-count thresholds, fallback, recovery and
negative residuals. Invalid modes, timestamps and fractional/out-of-range counts
preserve the previous state. These tests do not connect quality to the renderer.

A separate native offline comparison against the pinned complete runtime matched
51,240 fields across 8,540 operations in six cases exactly. It supplied explicit
draw counts rather than measuring browser FPS. This verifies the tested numerical
quality state; browser quality effects, renderer integration, pixel fidelity and
automatic fallback under actual desktop load remain unverified.

The integrated real Wasm bindings also matched those six frozen runtime traces:
51,240 fields and 8,492 statistics-reset return values matched exactly. The
private evidence documents JSON's signed-zero limitation. Seven Chrome/Electron
assertions separately checked preference application, interpolation ordering and
atomic input rejection through the browser ABI. These remain standalone checks;
the animated page does not yet apply quality state to its rendering passes.

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

## Dense-scene benchmark

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
