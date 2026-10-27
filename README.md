<p align="center">
  <img src="assets/logo.svg" alt="SlitherClient" width="480">
</p>

<p align="center">
  Independent Rust and WebAssembly browser client.
</p>

<p align="center">
  <a href="#development">Development</a> |
  <a href="docs/README.md">Documentation</a> |
  <a href="docs/provenance.md">Source boundaries</a> |
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
<p align="center">
  <a href="https://github.com/NikitaMGrimm/slither-client/actions/workflows/checks.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/NikitaMGrimm/slither-client/checks.yml?branch=main&amp;style=flat-square&amp;label=CI"></a>
  <a href="CHANGELOG.md"><img alt="Version: 0.1.0-alpha.0, unreleased" src="https://img.shields.io/badge/version-0.1.0--alpha.0%20unreleased-blue?style=flat-square"></a>
  <a href="rust-toolchain.toml"><img alt="Rust 1.99.0" src="https://img.shields.io/badge/rust-1.99.0-orange?style=flat-square"></a>
  <a href="docs/verification.md"><img alt="Target: wasm32-unknown-unknown" src="https://img.shields.io/badge/target-wasm32--unknown--unknown-blue?style=flat-square"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

## Status

Version `0.1.0-alpha.0` is unreleased. The client provides bounded handshake
primitives, atomic protocol-19 scene state, and Rust/Wasm Canvas2D previews
with three stand-in palettes. The animated preview connects prediction, body
corrections, sampled curves and a following camera. Deterministic synthetic scenes
run offline; an optional loopback simulator connection adds pointer heading and Space boost.
There is no fully playable game or installed browser extension.
See [architecture](docs/architecture.md) for supported inputs and limits.

Local loopback browser verification demonstrated Wasm execution, exact source
object identity, and matching output pixels. An offline external comparison
matched four login cases and three synthetic challenge cases byte for byte.
On 2026-10-26, one Node/WebSocket session accepted the handshake through setup
protocol 19 using an explicit Origin header. These results cover only the
documented handshake primitives. The scene has separately passed synthetic
Wasm/browser checks and a local simulator demonstration; see
[verification](docs/verification.md).

[slither-sim](https://github.com/NikitaMGrimm/slither-sim) is the separate
simulator and server project. This repository owns browser-client behavior.

## Development

Use Rust **1.99.0**, platform build tools, and Node.js **24**. The Rust toolchain
file includes the Wasm target. Install the **wasm-bindgen CLI 0.2.129** separately
and put it on `PATH`, or set `WASM_BINDGEN` to its absolute executable path.
From this checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
cargo fmt --all --check
cargo test --all-targets --locked
cargo test --doc --locked
cargo clippy --all-targets --locked -- -D warnings
npm run build:web
node tools/wasm-smoke.mjs
```

`build:web` generates ignored bindings and Wasm in `dist/web`. Normal tests and
CI require no external reference and do not connect to game servers. The optional
loopback prototype and external comparison are described in
[verification](docs/verification.md), along with index/history guards and hooks.

After building, run `npm run scene` and open `http://127.0.0.1:18884/` for the
synthetic scene. **Step** advances a received anchor; **Palette**, **Zoom**, and
**Follow** change the preview. For local simulator controls, see
[the loopback procedure](docs/verification.md#offline-scene-and-local-simulator).

Open `http://127.0.0.1:18884/animated` for continuous prediction, corrected
body sampling, standard paired eyes and an eased arena edge. Pointer motion
controls visual gaze,
including in the synthetic preview. The synthetic fixture uses original
stand-ins with ordered body effects, retained food/prey animation and adaptive quality.
Local simulator mode keeps its basic snake stand-ins and uses the same retained
food path. Full skins, special faces and attachments remain pending.
The received-anchor preview at `/` remains available for comparison.

Both animated renderers draw the nearby arena edge as a late red band and open
inner stroke. Its camera angle/distance update with retained-own draw preparation;
the displayed radius follows the existing connected update clock. This gameplay
adapter does not implement the original cosmetic chooser.

The separate opt-in [`render_standard` API](docs/standard-body-renderer.md)
submits standard body plans from trusted borrowed skin-provider snapshots and
applied quality. The animated page demonstrates it with three authored synthetic
recipes. Stock Firefox checks cover native Canvas submission and page cadence;
a bounded external-runtime comparison matches production body commands exactly.
Full skins and original-pixel parity remain separate.

An additive [appearance-time paired-eye API](docs/standard-body-renderer.md#appearance-time-paired-eyes)
retains trusted normalized geometry before the first pupil update. Both render
paths consume that style; standard recipes must match it exactly. The existing
packet API and synthetic page retain their default paired-eye geometry.

An additive [food factory API](docs/food-presentation.md) retains duplicate foods,
captured eater objects and creation-selected sources. Both renderers place early
outlines/body and late glows around snake drawing, using applied quality. Setup
preserves the existing world; explicit reset clears it on the retained timeline.
Additive target-aware APIs also stage a draw at each ordered Setup. The animated
page uses these calls and synchronous resize draws with desktop backing sizes;
its contained demo layout does not implement the original login/HUD layout.

The additive [prey factory API](docs/prey-presentation.md) retains independent
appearances, position corrections, movement and captured eater objects. Both
animated render paths place prey bodies and glows around snake drawing. The
page uses three authored prey and original flat stand-ins; source artwork,
loading equivalence and complete host adaptation remain separate.

An additive [paired-face API](docs/standard-body-renderer.md#complete-ordinary-paired-faces)
also retains optional geometric side images and composes the complete represented
face through both renderers with trusted ready borrowed sources. Host skin mapping,
startup loading equivalence, other special faces and extension packaging remain pending.

CI checks native Rust on Linux and Windows and runs a real Wasm ABI smoke test
on Linux. Release-plz remains dormant; ordinary pushes do not publish artifacts.
See [releases](docs/releases.md) and the [roadmap](docs/roadmap.md).

## Source and license

Keep official client source, assets, credentials, and raw captures outside Git
history and public reports. Commit original code and explicitly labelled
synthetic fixtures; see [provenance](docs/provenance.md).

[MIT](LICENSE) covers our authored files, including the original SVG logo. It
does not license official client code or artwork. This project is independent
of Slither.io.
