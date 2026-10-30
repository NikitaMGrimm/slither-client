# Testing

Use Rust 1.99.0, Node.js 24, platform build tools and wasm-bindgen CLI 0.2.129.
The toolchain file installs wasm32-unknown-unknown. Set WASM_BINDGEN to an absolute
CLI path if it is not on PATH.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

The check command mirrors .github/workflows/checks.yml on the current host:

- Git index and reachable-history source guards.
- JavaScript behavior, build/server tooling and wgpu socket-adapter tests.
- Core rustfmt, all-target tests, doctests and strict Clippy.
- Canvas release Wasm build and real ABI tests using synthetic packets and sources.
- wgpu rustfmt, library/integration tests, strict native/Wasm Clippy, desktop and
  Wasm builds, and generated WebGPU bindings.

It opens no window or GPU and connects to no game server. Dependency installation
can access package registries. CI runs native checks on Linux and Windows, wgpu
native checks on Windows, and Wasm checks on Linux. A local run covers its host;
it does not replace the other OS job.

## Focused checks

```sh
npm test
cargo test --locked --test protocol
cargo fmt --all --check
cargo test --all-targets --locked
cargo test --doc --locked
cargo clippy --all-targets --locked -- -D warnings
npm run build:web
node tools/wasm-smoke.mjs
cargo test --manifest-path apps/wgpu-slice/Cargo.toml --locked --lib --tests
```

The ABI smoke helpers are shared regression coverage, not standalone network
probes. Tests use explicit authored doubles or real generated Wasm as labelled.
Run the ABI suite again after changing Rust/browser boundaries. For wgpu, the
full check command uses one build job and target/wgpu-slice-check to limit memory
and keep its artifacts separate from Canvas. Generated bindings stay in dist/.

## Source guard

```sh
git config core.hooksPath tools/hooks
git add <intended-files>
node tools/check-repository.mjs
node tools/check-repository.mjs --history
```

The guard reads Git blobs, so inspect unstaged changes separately. It blocks
known official bundles, raw captures, credentials, prohibited binary/generated
formats and unsafe SVGs. It complements review of authorship; it cannot identify
every copied program. Never bypass hooks to push an artifact the guard rejects.

## Manual checks

Use npm run dev:desktop or npm run dev:web with a separately installed slither-sim
binary. Both choose a free loopback port and clean up their own simulator. The
browser command prints the Canvas URL. Existing npm run scene accepts --port and
--simulator-port for a separately managed server; see the README.

Use offscreen rendering or headless browsers for automated visual work. Keep
captures outside Git. State what ran and any limitations: synthetic correctness,
local gameplay, browser rendering and perceptual parity are different results.
No tests or CI may connect to official game servers.
