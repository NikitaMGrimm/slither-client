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

Normal tests and CI never start this host or open a game socket. Optional CLI
ports are bounded; HTTP serves only literal `127.0.0.1` with exact Host checking.

## Presentation primitive checks

Native `tests/presentation.rs` covers fractional clocks, skew/clamps, lag changes,
turn wrapping/crossing, speed units, exact speed arithmetic, ring overlap/wrap,
Float32 assignments, deferred cleanup and invalid-input rollback. The real Wasm
smoke test also exercises owned animation steps, predictor motion/corrections,
rejection of invalid JavaScript directions before integer narrowing, copied
sample arrays and atomic failure. These checks use original synthetic inputs.

This verifies the primitives only. The scene still needs ordered presentation
events, sampled bodies, camera/draw timing, eyes, quality modes and full skins
before visual or gameplay equivalence can be assessed.

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
