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
Play without a window, steers in slow circles with a periodic boost through the
normal input path, saves 960x540 PNGs outside the checkout and prints a summary
(server, profile version, handshake/login/Setup, packet and frame counts, own
length over time, exit reason). Passwords and raw packets are never printed.

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

## Scope

Ordered body, early/late food and prey, paired eyes and arena are implemented
using authored procedural materials. The HUD shows length and rank at bottom left
and the top-ten leaderboard at top right, in a temporary 5x7 bitmap font. Complete menus, image faces,
antennas and mobile integration remain open. Material/edge rasterization differs
from Canvas; tests do not establish visual parity or player feel.

The minimap uses shared retained occupancy, crossfade, marker and session opacity
plans, with Canvas CSS sizing and bottom/right insets across DPR changes. Its
layers compose before holder alpha, and the marker keeps visible overflow.
Server-label text awaits `minimap::Minimap::append_server_label` and the text adapter.

The synthetic slither-wgpu-diagnostic executable, web/diagnostic.html and examples
are renderer development aids. Offline tests use authored synthetic packets and
socket doubles; they open no GPU or game connection. See root docs/architecture.md
and docs/verification.md for ownership and checks.
