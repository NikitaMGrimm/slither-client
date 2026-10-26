# Changelog

## Unreleased

- Couple standard paired-eye motion, independent pointer gaze and per-snake
  Canvas painting to the animated preview. Preserve fractional pupil updates,
  deferred curve targets, visibility resets and death fading. Special faces,
  skin-supplied geometry and attachment rendering remain pending.
- Select web-build Wasm from Cargo's artifact report, including configured target
  directories, and reject missing or ambiguous artifacts before binding.
- Add a separate trusted host recipe provider with bounded metadata, explicit
  readiness/revisions and exact borrowed asset identities. No recipes or artwork
  are bundled; renderer and extension integration remain pending.
- Add standalone desktop quality state and `DesktopQuality` Wasm bindings,
  separating requested preference, connection/preview initialization, blend,
  sampling density and draw-count fallback/recovery. Rendering integration is pending.
- Connect ordered packets to head/body/length prediction, draw-driven camera
  and bounded curve sampling in a separate animated Canvas2D preview. Preserve
  retained own identity through removal/ID reuse and repeated duplicate removals;
  test synthetic native, Wasm, Chrome and Firefox transitions. Full skins,
  eyes, quality effects and team-mode drawing remain pending.
- Add retained body contraction/correction state, logical visual length and
  draw-driven camera correction primitives, including standalone length/camera
  Wasm bindings and host presentation math.
- Add atomic ordered snake/world presentation events with absolute geometry,
  independent motion fields and direct decoded speed scalars. The native event
  API retains individual actions for the animation consumer.
- Add explicit-time presentation clock, signed head prediction and additive
  Float32 head/angle correction primitives, with native and real Wasm checks.
  Keep separate update and draw clocks.
- Add atomic protocol-19 setup, snake and food scene state with bounded retention,
  synthetic transition/rejection tests and a real Wasm scene ABI smoke test.
- Add a Rust/Wasm Canvas2D received-anchor preview with camera/palette controls,
  borrowed sprites, viewport culling and one scheduled paint per network burst.
- Add an offline synthetic page and an optional loopback simulator connection
  with pointer heading, Space boost, ping and session teardown.
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
