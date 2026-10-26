# Changelog

## Unreleased

- Add bounded Rust login encoding, strict challenge parsing, whole-frame structural
  validation, and setup-version extraction with synthetic regression tests.
- Add wasm32 browser bindings and an original bridge that borrows existing canvas
  and image objects for a two-rectangle Wasm draw with a one-pixel gutter.
- Add optional loopback browser and offline external-comparison tools, plus an
  explicitly authorized single-attempt manual handshake tool.
- Verify local browser Wasm execution, source object identity, and output pixels;
  match four login and three synthetic challenge cases in an offline comparison.
- Add Linux/Windows native checks and a real Wasm ABI smoke test to CI.
- Retain original branding, repository boundary guards, and dormant release setup.
- On 2026-10-26, verify handshake acceptance through setup protocol 19 in one
  Node/WebSocket session with an explicit Origin header; stop after setup.

No fully playable game or installed extension has been released. See
[verification](docs/verification.md) for the exact evidence limits.
