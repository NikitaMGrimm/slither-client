# Architecture

The product has three layers: a shared Rust client core, thin platform adapters,
and renderers. The separate slither-sim repository owns server simulation.

| Path | Responsibility |
| --- | --- |
| src/protocol*, src/challenge.rs | Wire decoding, encoding and closed challenge grammar |
| src/state.rs | Atomic packet application and received world state |
| src/presentation* | Animation, prediction/correction, camera, skins, ordered draw plans and HUD |
| src/*_policy.rs, src/desktop_input.rs, src/menu_*.rs | Session, input, gameplay and menu policy |
| src/*_browser.rs | Copied Wasm API and Canvas submission |
| web/ | Canvas reference client, browser/DOM/socket glue, authored procedural sources |
| apps/wgpu-slice/ | Shared wgpu renderer, Windows host and browser WebGPU adapter |
| tests/, tools/*.test.mjs | Authored synthetic behavior and adapter regression tests |
| tools/ | Build, local development, ABI verification and source guard |
| .github/workflows/checks.yml | Offline CI on Linux and Windows |

## Shared core

Protocol packets update state atomically. Presentation retains its own timeline,
interpolates/corrects movement and prepares ordered body, food, prey, face and
arena plans. Session and input policies own connection phases, timing, ping,
turning and boost intents. HUD/menu owners retain scores, leaderboard, minimap,
appearance and player-facing state.

Adapters execute socket, DOM and GPU effects outside Rust borrows and acknowledge
successful work. Preserve packet ordering, arithmetic and transactional rollback
when changing these boundaries; do not add another policy reducer in JavaScript.

## Canvas reference

The local page at / is served by tools/scene-server.mjs. It loads
web/game-bootstrap.mjs, creates the local host and starts web/game-runtime.mjs.
The runtime uses the Wasm core with Canvas2D, authored procedural materials and
owned DOM UI. Module URLs under /game are an explicit server map; generated
bindings live in ignored dist/web. npm run scene remains the standalone server.

Some stock-source adapters are still used by the Canvas composition and its
regression tests. The former document-start host is retained only under
tools/fixtures for those inert tests. There is no extension package or injection
entry on main; the parked extension work is preserved on origin branches
fix/http-com-module-integrity, fix/http-com-live-play and feat/default-appearance.

## Shared wgpu client

apps/wgpu-slice is a separate crate with its own lockfile and a path dependency
on the core. game::LocalGame owns the shared protocol/session/input/presentation
flow. Windows uses winit and tungstenite; the browser uses WebSocket and RAF.
Both submit ordered frames and authored materials through the same wgpu renderer.

Play opens a simulator endpoint or, natively with `--official`, an official
server chosen from the live directory; there is no automatic reconnect. The
renderer covers body, food, prey, paired eyes, arena and a small bitmap HUD.
Image faces, antennas and complete menus remain incomplete. Rasterization can
differ from Canvas; passing tests does not establish perceptual parity.

The wgpu crate still includes its small synthetic diagnostic executable and
examples alongside the renderer. See its README for builds and controls.
