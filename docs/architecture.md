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
  typed world validation is provided by `state::ClientState`.
- `protocol::setup_protocol_version` extracts the advertised setup version after
  structural checks. That value alone does not establish compatibility.

## Received scene state

`ClientState::apply_frame` validates framing, applies supported commands to a
staged clone, and commits only on success. Malformed supported commands preserve
the entire previous state, including compact caches and counters. BTreeMaps keep
snake IDs and packed food keys in deterministic order. Setup must precede world
commands; a new setup clears entities, own identity and caches. Only protocol 19
is accepted by the scene layer.

| Commands | Scene behavior |
| --- | --- |
| `a`, `z` | Typed setup, centered coordinates, radius updates. Optional server number, mode and team are retained. |
| `s` | Snake appearance/replacement and removal. The first appearance after setup identifies self, including ID zero. |
| `g/n/G/N`, `=/+` | Relative, cached-direction and absolute front anchors, with growth variants. |
| `e/E/3/4/5/d/7` | Heading, wanted heading and speed variants selected by opcode and length. |
| `h/r` | Fractional mass and tail removal. |
| `F/f/b/c/C/<`, `w` | Accumulated sector listings, explicit/compact food additions and consumption, sector removal. |

Unsupported families are opaque and counted, including sector-entry `W`, pongs,
game-over, score/HUD, minimap and prey. Unknown-snake updates are validated and
ignored. Compact food requires its stream's cached sector; relative anchors
require known geometry and direction. Removal retains own ID until setup/reset.

Retention limits are 256 snakes, 4096 body anchors per snake, 65,536 total body
anchors and 65,536 food positions. Centered coordinate magnitudes are bounded by
16,777,215. Setup's `max_segments` is a score-table index, not a body cap. These
are client limits rather than assertions about every server.

## Browser rendering

`web/asset-bridge.mjs` borrows the exact existing canvas and loaded image objects
from a supplied trusted page realm. It validates their types and readiness
without copying or loading assets. The wasm32 bindings in `src/browser.rs` expose
protocol operations and `render_borrowed_assets`.

The original `render_borrowed_assets` draw remains an integration probe. The
`Scene` Wasm class owns received state and exposes `apply_frame`, `reset`,
`snapshot` (numeric JSON diagnostics), and `render`. Its Canvas2D renderer borrows
three supplied canvases and a loaded background image. It resets caller drawing
state, tiles the background in world coordinates, draws the arena boundary,
food and received snake anchors, and adds simple eyes. Skin and food color select
palette `value % 3`; custom skin recipes and cosmetics are retained but not drawn.
Target dimensions must be 1..=4096 and zoom 0.05..=8; camera coordinates must be
finite and within the scene coordinate bound. The target cannot alias a sprite.

Rendering is isolated from protocol state, with no engine dependency. It culls
offscreen sprites, and the local socket page coalesces redraws through
`requestAnimationFrame` while applying every received frame immediately. This
is a received-anchor preview: bodies have a fixed six-unit presentation radius;
there is no body contraction, interpolation, extrapolation, prediction, score
calculation or authoritative physics. Transaction staging clones bounded state;
large-world performance remains a separate measurement and optimization task.

`web/handshake-session.mjs` sequences challenge, login, and setup through the Wasm
API without owning a socket. Optional tooling provides a loopback page, an
offline external comparison, and a separate manual single-attempt live transport.
Normal tests and CI use synthetic fixtures without external reference files.
See [verification](verification.md) for procedures and evidence limits.

## Local scene and transport

`npm run scene` serves an original synthetic page and generated stand-in sprites
on literal loopback, without a reference. The page supports deterministic reset
and anchor steps, palette/zoom selection and a follow camera. Optional
`--simulator-port` enables one explicit `ws://127.0.0.1:<port>/slither` destination.
The transport requests header-free framing and uses the simulator's direct-login
route. Pointer aim accounts for camera, zoom and CSS scaling; Space controls
boost. Controls are sent at 100 ms intervals with boost changes only, and pings
are sent with at most one outstanding. Missing open/setup/pong responses and send
queue congestion stop the session. Own removal ends the local life. There is no
discovery or automatic retry; each manual connection resets scene state.

The exact-route server checks its literal loopback Host, confines served files to
the canonical project root, and limits CSP connections to itself plus the selected
local socket. The optional external-asset prototype keeps its existing socket
fence; it renders the same synthetic scene using existing page objects.

## Project boundary

[slither-sim](https://github.com/NikitaMGrimm/slither-sim) remains the separate
simulator and server project. Client state and rendering belong here; its binary
`host` interface supplies the optional local demonstration. Extension packaging
is not yet implemented. Source and
asset exclusions are defined in [provenance](provenance.md).
