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
npm run build:web
node tools/wasm-smoke.mjs
```

The web build produces ignored `dist/web` JavaScript bindings and Wasm. The smoke
test executes that real Wasm ABI with a synthetic challenge/login/setup sequence
and rejection cases. It needs no browser, external reference, or socket. Keep
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

## Optional external checks

These commands use an existing trusted archive outside the checkout. They do not
download a reference. Build the web bindings first.

```sh
npm run compare:reference -- --reference-root <external-directory>
npm run prototype -- --reference-root <external-directory>
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
