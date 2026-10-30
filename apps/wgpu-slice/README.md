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
The endpoint must be ws://127.0.0.1:<port>/slither.

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

The synthetic slither-wgpu-diagnostic executable, web/diagnostic.html and examples
are renderer development aids. Offline tests use authored synthetic packets and
socket doubles; they open no GPU or game connection. See root docs/architecture.md
and docs/verification.md for ownership and checks.
