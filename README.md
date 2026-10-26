<p align="center">
  <img src="assets/logo.svg" alt="SlitherClient" width="480">
</p>

<p align="center">
  An independent browser-client project in Rust and WebAssembly. Unimplemented scaffold.
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

Version `0.1.0-alpha.0` is unreleased. The repository contains a Rust/Wasm
scaffold with no runtime dependencies or gameplay APIs. There is no playable
game, browser extension, renderer, connection flow, or verified server
compatibility. Compiling the Wasm target does not establish browser execution.

The first milestone is to prove the official-page asset bridge and handshake
behavior against an external local reference. No parity claim is made today.
See the [roadmap](docs/roadmap.md) for the evidence required.

[slither-sim](https://github.com/NikitaMGrimm/slither-sim) is the separate
authoritative simulator and server project. This repository concerns the browser
client; it does not implement authoritative world rules.

## Development

Install Rust **1.99.0**, platform build tools, and Node.js **24**. The pinned Rust
toolchain includes the Wasm target. From this checkout:

```sh
node tools/check-repository.mjs
node tools/check-repository.mjs --history
node --test tools/*.test.mjs
cargo fmt --check
cargo test --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
cargo build --release --locked --target wasm32-unknown-unknown
```

The repository guard checks the Git index and reachable historical blobs, so
review and stage intended changes before treating its result as coverage of new
files. Enable the local hooks with `git config core.hooksPath tools/hooks`.
See [verification](docs/verification.md) for doctests, CI coverage, and limits.
Checks stay offline from game servers; toolchain installation may use package
sources. Rust has no gameplay tests yet.

CI runs automatically on pushes to `main` and pull requests, and can be started
with `workflow_dispatch`. It checks native builds on Linux and Windows and the
Wasm target on Linux. Release-plz configuration is present but intentionally
disabled until the first releasable client. There is no release workflow;
pushes do not publish anything. See [releases](docs/releases.md).

## Source and license

Keep official client code, readable translations, source maps, restoration
metadata, artwork, assets, and raw captures outside tracked history. The original
local V3 reference also stays outside this repository. Only original authored
code and clearly labelled synthetic fixtures belong here.

Research informed by human reading of the official client is **not clean-room**.
[Provenance](docs/provenance.md) records the public reference URL and fingerprint,
what may be committed, and what verification cannot establish.

[MIT](LICENSE) covers our authored files, including the original SVG logo. It
does not grant a license to official artwork or client code. This project is
independent of Slither.io.
