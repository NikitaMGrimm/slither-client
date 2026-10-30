# Shared wgpu client

Windows desktop and browser WebGPU hosts share game::LocalGame, the root Rust
protocol/session/input/HUD/presentation policies and a small ordered wgpu renderer.
The crate has its own lockfile and a path dependency on the core. Canvas remains
the visual reference.

On Windows, from the repository root, run the desktop client and a local simulator:

```sh
npm run dev:desktop
```

If slither-sim is not on PATH, set SLITHER_SIM or run
`npm run dev:desktop -- --simulator <path>`.
Enter starts Play, Escape stops; pointer/arrows/Space and mouse boost feed the
shared input policy. No connection starts until Play, and reconnect is explicit.
Use `--endpoint ws://host:port/slither` for a simulator elsewhere.

## Official servers

`--official` plays on the official servers (native only). Each Play fetches the
homepage, its `/s/game<digits>.js` script and the server directory as inert data,
parses `client_version`/`cpw` with the core's closed literal grammar (code is
never evaluated), pings one address per cluster over `ws://address:80/ptc` and
picks a server like the original: lowest cluster RTT, then population-weighted.
`--server host:port` skips discovery. Game sockets use the original `ws://`
path with `Origin: http://slither.io`. Downloads are capped after gzip decoding
(256 KiB page/directory, 1 MiB script, 5 s, at most three same-host redirects,
no HTTPS-to-HTTP downgrade for the script/directory) and kept only in memory.
There is no automatic reconnect.

`--headless --duration <s> --frames <new-dir> [--frame-every <s>]` starts one
Play without a window, wanders along broad drifting arcs with a periodic boost through the
normal input path, saves 960x540 PNGs outside the checkout and prints a summary
(server, profile version, handshake/login/Setup, packet and frame counts, own
length over time, exit reason). Passwords and raw packets are never printed.

The encounter summary separates received retained other appearances (maximum
count and distinct wire IDs) from the core's culled-visible appearances, and
from others whose positive-alpha normal-body quads overlap the viewport.
It reports the viewport maximum with a frame/time and up to eight sample IDs,
and whether any other normal body reached a successfully submitted draw list.
Counts include death fades; ID reuse contributes once to each distinct-ID set.
Viewport overlap tests transformed quad geometry, not opaque source pixels or
occlusion. Observations travel with the actual prepared picture, including Setup
and retained pictures. The first viewport-body encounter also saves one extra
`first-other-*.png` immediately, before another picture can replace it.
The deterministic autopilot keeps its existing input cadence/boost schedule;
its slow heading drift makes the first minute travel across the map rather than
repeat a small orbit. It does not avoid opponents or the arena edge.

The browser build stays simulator-only: browser fetches need CORS permission for
the official page, script and directory, JavaScript cannot set WebSocket Origin,
and HTTPS pages block the original `ws://` endpoints. Options are a same-origin
page host or an HTTPS/WSS relay that supplies the upstream Origin.

## Build and test

Use Rust 1.99.0 and wasm-bindgen CLI 0.2.129. From the repository root, on Windows
or Linux:

```sh
npm run check
```

The native wgpu tests, Clippy and desktop build run only on Windows; Linux skips
those steps. For focused native checks on Windows:

```sh
cargo build --manifest-path apps/wgpu-slice/Cargo.toml --locked --bin slither-wgpu-desktop
cargo test --manifest-path apps/wgpu-slice/Cargo.toml --locked --lib --tests
```

The full check command also generates bindings in dist/wgpu-slice/pkg. To try the
WebGPU host, copy web/index.html and web/*.mjs from this app alongside that pkg
folder, serve the output over loopback HTTP, and enter a local simulator endpoint.
A WebGPU-capable browser is required. There is no Canvas fallback.

On Windows, from this app directory, `cargo run --release --example sprite_parity -- <private-pack-dir>`
compares authored sprites against an external private pack.

Background uses the shared phase/zoom plan and Canvas-authored tile/backdrop.
`LocalGame` shares Canvas's adaptive quality owner and capped desktop backing
policy, without DPR multiplication. Native scales the backing to the window;
browser controls overlay the full-window canvas. Retries do not advance quality.

## Text

Nicknames reuse core tint, culling, placement and fading before body drawing,
at 15 backing pixels with a fixed 32 backing-pixel gap at every DPR. Browser text
uses OffscreenCanvas; Windows loads system Arial through fontdue (kerning, 4x
coverage). No fonts are bundled; native coverage differs from browser hinting.
Native C0/C1 controls use Canvas's
whitespace/missing-glyph choices; DEL keeps its blank fallback advance.
Raster/style failures omit labels; failed frame completion releases staged pixels.

`text::TextCache::draw(TextRun, scale)` returns ordered draw/resource pairs for
Arial regular/bold, RGB, size, opacity, alignment and baseline; no shadows.
The LRU holds 256 runs / 4 MiB. Runs admit 1024 UTF-8 bytes, 1..=128 backing font
pixels and an 8192x512 raster, tiled into 512px textures. Existing active/queued
budgets still apply. HUD/leaderboard text conversion is a follow-up.

## Scope

Ordered body, early/late food and prey, paired eyes and arena are implemented
using authored procedural materials. The HUD shows length and rank at bottom left
and the top-ten leaderboard at top right, in a temporary 5x7 bitmap font. Complete
menus and mobile integration remain open. Material/edge rasterization differs
from Canvas; tests do not establish visual parity or player feel.

The minimap uses shared retained occupancy, crossfade, marker and session opacity
plans, with Canvas CSS sizing and bottom/right insets across DPR changes. Its
layers compose before holder alpha, and the marker keeps visible overflow.
Server-label text awaits `minimap::Minimap::append_server_label` and the text adapter.

The synthetic slither-wgpu-diagnostic executable, web/diagnostic.html and examples
are renderer development aids. Offline tests use authored synthetic packets and
socket doubles; they open no GPU or game connection. See root docs/architecture.md
and docs/verification.md for ownership and checks.

## Optional cosmetics

Set `--cosmetics-dir <artwork-dir>` on the desktop executable to use a local
directory containing the original `s/` and `s2/` image paths. `--accessory 0..31`
selects an accessory for the own snake only. Image faces, antennas and dense/swell
styles reuse the shared core; unavailable images fall back locally with one warning.
Without a directory, rendering stays plain. Artwork and captures remain outside Git.

For WebGPU, copy this app's web files beside the generated pkg directory, then run
`node apps/wgpu-slice/dev-server.mjs --web-dir dist/wgpu-slice --port 19087 --simulator-port 19086 --cosmetics-dir <artwork-dir> --accessory 30`.
Use a separately started simulator on the chosen free port. PNG/JPEG reads are
capped at 4 MiB per file, the decoded cosmetic bank at 16 MiB, and active resources
at the existing 64 MiB budget. Rasterization and independent random streams still
limit pixel parity; normal tests use synthetic images only.
