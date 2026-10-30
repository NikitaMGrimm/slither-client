# Shared gameplay with wgpu

This isolated app consumes the existing pure Rust core by path dependency. It
does not change root Cargo files, the Canvas entry/payload, simulator, extension
or previously accepted local bundles. Windows and browser use `game::LocalGame`,
the same actual protocol ingress, session/input/HUD policies and ordered plans.
Windowed mode has no socket at startup. Enter starts explicit Play; the game socket opens
after the initial reset frame is successfully presented. Native mode supports
official discovery or a supplied simulator endpoint. There is no automatic reconnect.

## Gameplay and adapters

`LocalGame` uses `SessionPolicy` for phases, budgets, death/return, ping/lag and
launch/reset commits. It sends the existing negotiation prefixes, solves the
received challenge in Rust, then sends the existing login with the selected
profile (authored zero credentials for simulator mode). Both hosts use the negotiated header-free framing and admit
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
transport. The connector has a 3 s total deadline: at most 1 s DNS wait, 1 s TCP,
and 2 s HTTP upgrade, within that total (including slow-drip peers). A timed-out
OS DNS worker can finish later but owns no socket.
After handshake, all I/O is nonblocking. A WouldBlock write remains owned by
tungstenite and is never duplicated. Binary frames, receive bursts and pending
writes are bounded. Remote close drops socket ownership; later Play is explicit.

The browser owns DOM, WebSocket, RAF and backing size/DPR only. Copied effect
IDs remain full-u64 BigInts. Socket callbacks are generation/lifetime fenced;
listeners detach before close/free. The first thrown JS value is retained
separately, including `undefined`. GPU failure stops render attempts and disables
Play; there is no Canvas/software fallback presented as GPU success. The input
policy's existing focus-loss semantics are preserved (blur invents no release).

## Official Windows mode

From the repository root:

```powershell
cargo run --manifest-path apps/wgpu-slice/Cargo.toml --locked --bin slither-wgpu-desktop -- --official --nickname Player --skin 0
```

In windowed mode, press Enter once for Play. Add `--server host:port` to skip directory fetching
and latency probes while still acquiring the current profile. IPv4, DNS names,
and bracketed IPv6 are supported. Escape cancels preparation or stops the game;
another Enter is a new explicit attempt. Nothing is fetched before Play; headless
mode starts that one Play automatically.

Each Play reads the canonical homepage, selects its `/s/game<digits>.js` script
element, and parses the unique `client_version` and `cpw` declarations with the
core's closed literal grammar. Downloaded code is never evaluated. Automatic
selection reads the script's `https://slither.io/i<digits>.txt` directory URL,
decodes rotating nibbles into IPv4/IPv6 records, and sends three byte-112 echoes
to one random address per cluster at `ws://address:80/ptc`. The minimum rounded
RTT chooses the cluster; active servers are weighted by population plus five.
The original port/population fallback applies when no active weighted choice
is available. Each Play starts fresh, without historical server exclusions.

Acquisition admits at most 256 KiB homepage/directory and 1 MiB script, with a
5 s deadline and at most three canonical-host redirects per resource. The cap
applies after gzip decoding, with cancellation/deadline checks between bounded
reads. The recorded homepage may redirect HTTPS to HTTP. Script/directory fetches
cannot downgrade an originally HTTPS URL; an originally HTTP script may use HTTP. Probes
use at most 32 workers, a 7 s window shortened to 2667 ms after the first reply,
and at most 4096 decoded endpoints. In larger directories some clusters may not
be sampled before the deadline. Escape cancels publication immediately; an active
HTTP read may take up to its remaining deadline to release. Source/profile bytes
stay in memory, with owned buffers cleared on release; no disk cache is used.
Library/OS copies and compiler temporaries are not guaranteed erased.

Game and probe upgrades use the original `ws://` paths, `Origin: http://slither.io`,
a desktop User-Agent, and tungstenite's generated Host, Upgrade, Connection,
WebSocket version and random key headers. Compression extensions are not advertised.
The existing negotiation/challenge/login and gameplay owner remain shared.
Official network acceptance is manual and is not established by offline tests.

The standalone browser build remains simulator-only. Browser fetch needs CORS
permission for the homepage, script and directory; JavaScript cannot override
WebSocket Origin. HTTPS pages also block the original insecure `ws://` endpoints.
Possible follow-up approaches are a same-origin HTTP game-page host (subject to
WebGPU secure-context availability), or a controlled HTTPS/WSS relay that fetches
metadata and supplies the upstream Origin. A separately permissioned extension
transport could address fetch CORS but still needs a compatible Origin/socket
route. No relay, extension integration, or browser official mode is included.

## Headless native acceptance

No window, event loop or desktop input is created with `--headless`. This command
starts one automatic official Play and writes PNGs to a new external directory:

```powershell
$frames = Join-Path $env:TEMP ('slither-official-headless-' + [guid]::NewGuid().ToString('N'))
cargo run --manifest-path apps/wgpu-slice/Cargo.toml --locked --bin slither-wgpu-desktop -- --official --headless --duration 60 --frames $frames --frame-every 5 --nickname Player --skin 0
```

For the simulator, replace `--official` with
`--endpoint ws://127.0.0.1:<separately-owned-port>/slither`. The same native
preparation/transport and shared game owner are used. A deterministic circular
pointer target rotates at 0.25 radians/s; Space boosts for one second in every
twelve seconds of active play. Both use the existing DesktopInput path.

The existing offscreen renderer draws 960x540 RGBA8 pictures, waits for GPU
completion/validation before acknowledging them, and saves a first picture,
one latest picture per interval and a final changed picture. PNGs contain the
original authored materials. Existing directories/files are never overwritten;
the parent must already exist and captures must stay outside this checkout.
Duration includes GPU setup and acquisition, is at most 3600 s, and is checked
between operations. In-flight GPU/readback/acquisition cleanup can extend exit
slightly. Capture intervals are 0.1..3600 s with at most 600 scheduled captures.
Death, victory, disconnect and failure stop immediately without another Play.

The terminal summary reports the selected server, profile version (zero for
simulator mode), WebSocket/negotiation/challenge/login/Setup observations, received
WebSocket frames and decoded commands, sent packets, rendered/captured frames,
up to 32 timed own-length/segment samples, and the exit reason. Passwords and raw
packets are never printed. A closed peer is reported as a WebSocket close; the
existing transport does not expose the peer's close code/text. Failure before
Setup or a failed session returns a nonzero exit status.

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
crate/lock. Native acquisition uses ureq 3.5.0 with Rustls/gzip, scraper 0.29.0
and rand 0.10.3; PNG capture uses png 0.18.1. URL admission uses url 2.5.8.
Native DX12/Vulkan and browser WebGPU share frame/resource/render code.
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

`cargo run --release --example sprite_parity -- <private-pack-dir>` scores the
authored body, food and prey sprites against a local capture of the original
client's rasters (`catalog.json` plus `r*.png`). The pack stays outside the
repository; the example only reads it and prints per-family error counts.

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
