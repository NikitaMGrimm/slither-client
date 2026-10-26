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

## Ordered presentation inputs

`ClientState::apply_frame_with_events` uses the same transaction as `apply_frame`
and returns `AppliedFrame { report, events }` only after the complete frame
commits. Events retain command order, repeated equal updates, appearance
replacements and setup resets within a frame. Food still updates received state;
it does not yet produce presentation events. There is no retained event queue.

`Appearance` supplies absolute head/body coordinates and the effective initial
heading, plus appearance metadata and the decoded speed scalar. Its body runs
head to tail. Absolute geometry avoids a centering round trip before prediction.
The header's `wire_direction` is metadata; initial active turning is none.
Motion fields are independently optional. Anchor events retain an explicit
direction and an optional absolute position, so the presentation layer can
reconstruct relative anchors with its own absolute geometry.

`SnakeTarget::Own` addresses the retained own presentation object independently
of the visible ID map; explicit unknown IDs emit no events. Removal distinguishes
death from immediate disappearance. Radius events change a target, leaving
display easing to presentation. Neither elapsed headers nor event application
advance an animation clock. The existing browser preview still uses received
state; these native inputs are not yet connected to its render loop.

## Presentation timing primitives

`presentation` provides explicit-time arithmetic separately from received state.
`FrameClock` clamps elapsed milliseconds divided by eight to 0..=5, applies lag
decay/recovery, and derives integer steps from differences of accumulated floors.
The caller supplies timestamps, lag detection and skin-preview state.

`HeadMotion` applies signed turning and target crossing before live-head travel,
capped at one segment per update. Its `speed_per_32ms` retains the decoded speed
scalar; multiplication and division order are preserved instead of converting
through world-units-per-second. Received `ClientState` speed fields still use
world units per second. These units must not be interchanged.

Head position/fraction corrections have 53 samples; angle corrections have 26.
Weights and stored samples use `f32`, with arithmetic in `f64` before each stored
assignment. New corrections accumulate in the current ring. Positive integer
steps consume and clear samples; consuming the final sample leaves cleanup for
a later eligible update. Head injection refreshes its displayed offsets
immediately; heading injection waits for integer advancement.

`LengthPresentation` keeps logical segments and fractional mass separate from
retained anchors. Spawn mass is scheduled after zero-mass construction. Its
53-sample Float32 ring advances only while alive; an exhausted ring can clean up
on a zero-step live update. Desktop displayed length is target plus offset minus
0.6. `CameraCorrections` instead stores 62 double-precision samples and consumes
one per eligible draw. Injection retains the current camera offset; exhaustion
has no entity-style cleanup sentinel. Following, zoom and event scheduling remain
caller responsibilities.

`BodyGeometry` keeps absolute anchors head to tail, including dying points.
Normal anchors mark the oldest living point dying; growth changes logical count.
Contraction walks older points sequentially and schedules visible x/y, edge and
spacing corrections with Float32 storage. Positive integer steps advance those
corrections and fade tails, retaining the three newest dying records. Logical
count is capped at 4096 and physical retention at 8192 per body. This module does
not sample curves, draw sprites or implement authoritative physics.

Wasm trigonometry uses the current host's `Math.sin`/`Math.cos`, preserving browser
rounding in geometry and correction weights. Native builds use standard-library
trigonometry; no cross-platform bit-equality claim follows from that fallback.

Wasm exports `AnimationClock`, owned `AnimationStep` values, and `HeadPredictor`.
Free a step after its consumers advance, and free clocks/predictors when finished.
Predictor direction accepts exactly 0, 1 or 2. Its correction methods express
direct numeric discontinuities. `reanchor` applies the head portion of an anchor,
including its consumed logical segment and an explicitly supplied extrapolated
distance. Packet validation, body changes and camera corrections remain separate.

Standalone `LengthSmoother` and `CameraSmoother` bindings expose those two clocks
and copied sample/weight arrays. Segment counts are checked as exact unsigned
integers before conversion at the JavaScript boundary. `BodyGeometry` currently
has a native Rust API; it is not a browser body renderer.

These primitives are not yet connected to the scene's packet or render loop.
Applying ordered events to a complete snake, sampled curves, following-camera
integration, eyes, complete skins and HQ/LQ rendering still require implementation
and comparison. The visible scene remains a received-anchor preview.

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
