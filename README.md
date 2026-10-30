<p align="center"><img src="assets/logo.svg" alt="SlitherClient" width="480"></p>

Independent Rust client for Slither-compatible servers, aiming for the look and
feel of the original game. Alpha, unreleased. Windows desktop and browser come
first; mobile comes later.

The shared wgpu client is in [apps/wgpu-slice](apps/wgpu-slice/README.md).
The Canvas2D browser client remains the visual reference. Both use the Rust core.
The server lives in the separate [slither-sim](https://github.com/NikitaMGrimm/slither-sim)
repository.

## Setup

Install Rust **1.99.0**, Node.js **24**, platform C/C++ build tools, and
**wasm-bindgen CLI 0.2.129**. The pinned Rust toolchain includes the Wasm target.
Put wasm-bindgen on PATH or set WASM_BINDGEN to its absolute executable path.

```sh
npm ci --ignore-scripts --no-audit --no-fund
git config core.hooksPath tools/hooks
```

Install a current challenge-capable slither-sim binary separately. Put it on PATH,
set SLITHER_SIM to its executable path, or pass `--simulator <path>` to either
development command below. These commands build first, start their own loopback
simulator on a free port, and stop it when the client exits or you press Ctrl+C.

## Run

Desktop (wgpu):

```sh
npm run dev:desktop
```

Press Enter to Play, Escape to Stop; use pointer/arrows and Space or mouse boost.

Browser (Canvas2D):

```sh
npm run dev:web
```

Open the printed loopback URL, choose a nickname and click Play.
This builds the Wasm client and serves it with the local endpoint filled in.
See the [wgpu app README](apps/wgpu-slice/README.md) for the WebGPU browser build.

To run the simulator separately, select unused ports:

```sh
slither-sim host --bind 127.0.0.1:19090
npm run build:web
npm run scene -- --port 19091 --simulator-port 19090
```

Open http://127.0.0.1:19091/. The scene command remains available for existing
Canvas workflows; diagnostic and extension routes have been removed.

## Test

```sh
npm run check
```

Runs repository guards, JavaScript tests, Rust format/tests/Clippy, native and
Wasm builds for both clients, and the real Canvas Wasm ABI tests. It opens no
window and connects to no game server. [Testing](docs/verification.md) lists
focused checks and prerequisites.

Read [architecture](docs/architecture.md) and [contributing](CONTRIBUTING.md) for
code ownership and development rules. Keep official source, assets, credentials
and captures out of Git; the private reference JS is a local specification to
port idiomatically. See [source and license](docs/provenance.md).
