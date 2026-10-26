# Architecture

## Protocol boundary

The Rust library builds as `rlib` and `cdylib`. It opens no sockets and fetches no
assets. Native code has no runtime dependencies; browser bindings use wasm32-only
wasm-bindgen 0.2.129 and web-sys 0.3.106.

- `protocol::encode_login` accepts caller-supplied client-version and 20-byte
  password values. Nicknames may be empty or contain up to 24 printable ASCII
  bytes; custom skin data is limited to 255 bytes.
- `challenge::solve_challenge` accepts at most 512 encoded bytes and a closed
  token grammar with two fixed-length literals and a fixed copy loop. It rejects
  unsupported syntax without evaluating a general program.
- `protocol::decode_frame` requires an explicit elapsed-header mode and validates
  the entire frame before returning borrowed command slices. Frames are limited
  to 1 MiB and 4096 commands. It checks framing and setup field boundaries;
  other command bodies remain opaque.
- `protocol::setup_protocol_version` extracts the advertised setup version after
  structural checks. That value alone does not establish compatibility.

## Browser prototype

`web/asset-bridge.mjs` borrows the exact existing canvas and loaded image objects
from a supplied trusted page realm. It validates their types and readiness
without copying or loading assets. The wasm32 bindings in `src/browser.rs` expose
protocol operations and `render_borrowed_assets`.

The Wasm draw resets the output canvas and draws the two borrowed sources into
rectangles separated by a one-pixel gutter. This is an asset integration probe;
a world renderer, input loop, and playable game remain future work.

`web/handshake-session.mjs` sequences challenge, login, and setup through the Wasm
API without owning a socket. Optional tooling provides a loopback page, an
offline external comparison, and a separate manual single-attempt live transport.
Normal tests and CI use synthetic fixtures without external reference files.
See [verification](verification.md) for procedures and evidence limits.

## Project boundary

[slither-sim](https://github.com/NikitaMGrimm/slither-sim) remains the separate
simulator and server project. Client state and rendering belong here; simulator
integration is planned. Extension packaging is not yet implemented. Source and
asset exclusions are defined in [provenance](provenance.md).
