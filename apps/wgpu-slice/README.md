# Shared local gameplay with wgpu

This isolated app consumes the existing pure Rust core by path dependency. It
does not change root Cargo files, the Canvas entry/payload, simulator, extension
or previously accepted local bundles. Windows and browser use `game::LocalGame`,
the same actual protocol ingress, session/input/HUD policies and ordered plans.
No socket exists at startup. Only explicit Play to an entered
`ws://127.0.0.1:<port>/slither` endpoint can construct one, after the initial
reset frame is successfully presented. There is no automatic reconnect, remote
profile, official-server adapter or client-authoritative movement.

## Gameplay and adapters

`LocalGame` uses `SessionPolicy` for phases, budgets, death/return, ping/lag and
launch/reset commits. It sends the existing negotiation prefixes, solves the
received challenge in Rust, then sends the existing login with authored local
zero credentials. Both hosts use the negotiated header-free framing and admit
protocol 19. The core atomically ingests actual Setup/spawn/update/food/prey/HUD
packets. No fixture is injected into the playable owner.

The existing transactional `advance_with_control` callback is first probed and
aborted before entity updates, to obtain the actual core step without adding a
second clock or planner API. `DesktopInput` accumulates debt and stages keyboard,
ping, boost, then heading packets. Each effect is acknowledged outside Rust
borrows before the next phase. After all sends, one candidate world update and
draw are prepared. Successful presentation commits that candidate and consumes
session actions; surface timeout normally retains it without a second update. Failure
commits terminal state and closes the owned socket, cancelling the candidate.
Packet-time Setup pictures preserve the core callback order. Resize supersedes
queued intermediate pictures while retaining the admitted packet state.
All staged Setup pictures, HUD/resources and the aggregate pixel charge validate
before publishing packet world/history/serial/RNG and the complete picture queue.
Draining exactly 16 admitted pictures succeeds; the limit check does not take an
extra unacknowledged picture.

Host clock contract: call `construct(generation, effect_id, fresh_now_ms)` once
immediately before executing an issued Connect, then acknowledge the effect.
`opened(generation, fresh_now_ms)` and `receive(..., fresh_now_ms)` fence late
handshake callbacks. `observe_time(fresh_now_ms)` checks the absolute 3333 ms expiry
without advancing the model, including during retained/zero-size waits.
`begin_frame` also checks expiry before those waits. Work keeps its original model
timestamp; successful presentation only issues Connect, whose fresh constructor
boundary starts the handshake budget. Wasm `flush(now_ms,width,height,dpr)` carries
fresh time before presentation-only work; `presented(bool)` remains unchanged.

Windows uses thin winit pointer/key/window glue and a native tungstenite
transport. The connector has a 1 s TCP deadline plus an absolute 2 s HTTP handshake
deadline (including slow-drip peers); cancellation/join is bounded by them.
After handshake, all I/O is nonblocking. A WouldBlock write remains owned by
tungstenite and is never duplicated. Binary frames, receive bursts and pending
writes are bounded. Remote close drops socket ownership; later Play is explicit.

The browser owns DOM, WebSocket, RAF and backing size/DPR only. Copied effect
IDs remain full-u64 BigInts. Socket callbacks are generation/lifetime fenced;
listeners detach before close/free. The first thrown JS value is retained
separately, including `undefined`. GPU failure stops render attempts and disables
Play; there is no Canvas/software fallback presented as GPU success. The input
policy's existing focus-loss semantics are preserved (blur invents no release).

## Represented visuals and limits

The renderer consumes existing normal/boost/death body, early/late food/prey,
paired-eye layout and arena-edge plans. The 42 authored body families and existing
skin runs keep their actual palette IDs and order. Only resources used by a
frame are materialized/resident; this does not eagerly rasterize the catalogue.
There is no JS numeric fallback. Admitted local face behavior remains the core's
ordinary paired eyes (including 25/44/63/64); image faces 27/40/41 remain plain.
No antenna art, official images or complete cosmetic chooser is added.

The small original bitmap HUD shows Rust current/final length, rank/population,
the first projected leaderboard row and session status. Native title and browser
DOM also expose the full Rust text. The bitmap font covers ASCII, substitutes a
visible question glyph for other characters, and clips to 80 columns/four lines.
This is a functional slice, not a complete scoreboard/menu/text system.

`Frame` keeps full-u64 handle/revision, backing extent, viewport scale, ordered
crops/transforms/effective alpha and SourceOver/Lighter. No draw regrouping occurs.
The final vertex submission is the sole f64-to-f32 conversion. CPU materialization
uses the existing original Rust recipes: RGBA pixels, circles, concentric radial
gradients, single-contour nonzero polygon fills (authored stars), full rectangles
and colored disk shadows. Circle/polygon coverage uses 4x4 samples; blur is the
existing separable Gaussian approximation, sigma=blur/2, truncated at 3 sigma.
Unsupported Canvas operations fail explicitly. Paired eyes use sampled disks;
arena fill uses the core path strips, and stroke uses segment quads with butt
joins. These raster approximations do not establish Canvas pixel parity.

Textures contain premultiplied encoded-sRGB RGBA8, linear clamp sampling, one mip
level. Targets are encoded-unorm, with no implicit sRGB conversion. SourceOver
uses One/OneMinusSrcAlpha; Lighter uses One/One for color/alpha. Supported 4x MSAA
improves quad-edge coverage; unsupported formats explicitly report 1 sample.
Limits: 2048 active sources, 64 MiB active CPU/GPU pixels, 512 px per source axis,
8192 ordered draws, 8192 backing pixels per axis and 128 MiB render attachment.
Queued Setup pictures share a 64 MiB aggregate pixel bound. Zero backing suspends
updates/presentation without resetting session/world; packets still admit.
Timeout/occlusion/outdated surface normally retains work. At deferred-ingress
capacity, a fully prepared connected model update commits once and its unseen
picture is superseded; queued packets then apply in FIFO order without a second
model advance. This also covers zero backing with retained work. Initial reset/
Connect, pending host effects and host-owned pictures keep their existing
barriers and bounded errors. No successful GPU presentation is inferred.
Lost surface/device stops the host, without a new connection or gameplay reset/retry.

## Isolated builds and offline checks

Rust 1.99.0, wgpu 30.0.1, winit 0.30.13, tungstenite 0.30.0 (handshake/no TLS),
wasm-bindgen 0.2.129, futures 0.4.79 and web-sys/js-sys 0.3.106 are pinned in this
crate/lock. Native DX12/Vulkan and browser WebGPU share frame/resource/render code.
Use one isolated Cargo lane; never overwrite the root Canvas target/generated
files. From this app directory:

```powershell
$env:CARGO_BUILD_JOBS = '1'
$env:RUST_TEST_THREADS = '1'
$env:CARGO_TARGET_DIR = '<new-internal-target>'
cargo fmt --all --check
node --test --test-concurrency=1 tests/local-host.test.mjs
cargo test --locked --all-targets -- --test-threads=1
cargo test --locked --doc
cargo clippy --locked --all-targets -- -D warnings
cargo clippy --locked --lib --target wasm32-unknown-unknown -- -D warnings
cargo build --locked --bins
cargo build --locked --lib --target wasm32-unknown-unknown
& $env:WASM_BINDGEN --target web --out-dir '<new-web-dir>/pkg' --out-name slither_wgpu_slice '<new-internal-target>/wasm32-unknown-unknown/debug/slither_wgpu_slice.wasm'
```

Copy the authored `web/*.mjs` and `web/*.html` alongside that new pkg directory.
These build vectors do not authorize a window, browser, listener or game attempt.
The ordinary desktop entry's `--help` exits before creating an event loop/window.
The retained `slither-wgpu-diagnostic` and `diagnostic.html` use the original
finite synthetic Scene and are labelled diagnostics, not playable server modes.

After separate root review/resource gates, a manual native vector is:

```text
slither-wgpu-desktop --endpoint ws://127.0.0.1:<separately-owned-port>/slither --nickname Player --skin 0
```

Enter starts; Escape stops; arrows/pointer/Space feed existing Rust input.
For browser, serve only this standalone web output on a separately owned secure
or loopback route, enter that separately owned simulator endpoint, then Play.
No simulator/listener is included or automatically started. Never attach to
another user's server or reuse their processes/ports.

Normal tests are offline original synthetic packets and labelled host doubles.
They verify state/effect/geometry/material contracts, not actual network or UI.
Actual local handshake/control/gameplay, both host runtimes, visual fidelity,
player feel, performance and official-server acceptance remain distinct gates.
No mobile SDK/device/signing work is part of this milestone.
