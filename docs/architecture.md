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
of the visible ID map; explicit unknown updates emit no events except removal
requests. Every validated removal reaches presentation, allowing repeated IDs to
remove surviving duplicate appearances. Removal distinguishes death from
immediate disappearance. Radius events change a target, leaving display easing
to presentation. Neither elapsed headers nor event application advance an
animation clock.

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

`BoundaryRadius` stores 56 double-precision absolute-radius samples. Radius
targets blend every sample at the current cursor without changing display
immediately. Connected whole-step updates consume samples and replace consumed
slots with the latest target; a later positive connected update performs deferred
cleanup. Setup replaces radii while preserving cursor and pending cadence.
Inputs must be positive and finite; computed finite samples retain cancellation
to zero, including at the final unit weight, without an endpoint shortcut.
`BoundarySmoother` exposes the standalone state to Wasm and borrows existing owned
animation steps. The coupled animated client below consumes the same radius state.

`BodyGeometry` keeps absolute anchors head to tail, including dying points.
Normal anchors mark the oldest living point dying; growth changes logical count.
Contraction walks older points sequentially and schedules visible x/y, edge and
spacing corrections with Float32 storage. Positive integer steps advance those
corrections and fade tails, retaining the three newest dying records. Logical
count is capped at 4096 and physical retention at 8192 per body. This module does
not sample curves, draw sprites or implement authoritative physics.

Logical count is nonnegative protocol state, not a recount of living points.
After all points are marked dying, a non-growing anchor still leaves the count
at zero while adding a living point. A later tail removal requiring a negative
count fails without changing the body. Growth directly from an exhausted body
increments the count and permits later removal. Negative logical counts are
outside this API's supported domain.

Wasm presentation math uses the current host's `Math.sin`, `Math.cos`, `Math.pow`
and `Math.atan2`, preserving browser rounding at those boundaries. Native builds
use standard-library math; no cross-platform bit-equality claim follows.

Wasm exports `AnimationClock`, owned `AnimationStep` values, and `HeadPredictor`.
Free a step after its consumers advance, and free clocks/predictors when finished.
Predictor direction accepts exactly 0, 1 or 2. Its correction methods express
direct numeric discontinuities. `reanchor` applies the head portion of an anchor,
including its consumed logical segment and an explicitly supplied extrapolated
distance. Packet validation, body changes and camera corrections remain separate.

Standalone `LengthSmoother` and `CameraSmoother` bindings expose those two clocks
and copied sample/weight arrays. Segment counts are checked as exact unsigned
integers before conversion at the JavaScript boundary. `BodyGeometry` also feeds
the coupled client described below.

## Coupled animation

`SnakePresentation` couples motion, body, head/angle/length corrections, size,
visual speed, spawn and death progress. `AnimatedClient` applies ordered events
atomically with received state. Updates advance the explicit frame clock; draws
advance camera samples, automatic zoom, corrected-body visibility and point
spacing. Packet application advances neither clock. Elapsed headers do not add
anchor extrapolation time.

`AnimatedClient::reset()` and Wasm `AnimatedScene.reset()` are infallible,
parameterless world resets. They retain the last update timestamp and both
accumulated animation phases, and restore the lag multiplier to one without
advancing an update or draw. Construct a new client with `new(start_ms)` to
start a fresh timeline. Reset still clears received state, retained entities,
camera controls and the connection gate; shared body-painter flags survive.
The animated page uses this same timeline across Reset, palette changes and
reconnections, independently of quality-statistics cadence.

The client retains boundary samples and cadence across resets. Setup fills the
ring and activates its connection gate; ordered radius targets schedule easing.
Updates consume the same clock's whole steps only while connected. Disconnect
pauses boundary consumption while entity animation continues. Both render paths
use the displayed radius without consuming samples. A reset hides the retained
boundary until the next setup. Wasm exposes `set_connected`, copied
`boundary_samples` and separate `snapshot.boundary` diagnostics; `snapshot.radius`
continues to report the received target.

Retained objects preserve duplicate appearances and original own identity through
death, draw expiry and wire-ID reuse. Explicit lookup addresses the newest
appearance; removals scan surviving drawn objects oldest first. Input uses the
original own object's active lifecycle independently of lookup reuse. Retention
is capped at 512 objects and 131,072 physical anchors across all objects. Team
mode 2 is rejected atomically because normalized-skin grouping is unimplemented.

`sample_curve` accepts corrected absolute geometry and returns ordered Float32
positions/tangents with read-only Float64 diagnostics. Redistribution precedes
tangent calculation and Float32 storage. Finite signed corrected edge widths are
retained. Each curve is capped at 65,536 samples; entering a zero divisor or
producing nonfinite geometry fails. Bodies with fewer than two anchors remain
valid received/presentation state but are omitted from curve drawing until
another anchor arrives.

For one retained anchor, eye targeting uses only a completed finite head lead,
or a lead followed by one terminal sample whose coordinates stay outside the
redistribution prefix. Body drawing remains omitted. Geometry requiring the
missing following anchor uses the raw head heading as an explicit finite fallback.
No general one-anchor curve or eye parity is claimed for that unsupported geometry.

`sample_curve_with_heading` additionally accepts the raw head heading for a
valid traversal that emits only one sample. That sample keeps its zero tangent;
the eye target uses the supplied heading. Numeric and capacity errors still fail.

`StandardEyeState` retains face heading, the previous draw's target, turn,
independent gaze and double-precision pupil offsets. Whole steps select Float32
easing coefficients; pupils approach each world-axis target by fractional delta
divided by six. Visible entry resets face/target to raw heading. Death clears
face turning while pupils keep moving until expiry. Own gaze is caller-owned;
remote wanted-heading packets update the remote gaze.

An appearance can install owned `StandardEyeGeometry` before the first pupil
advance. `AnimatedClient::apply_frame_with_eye_geometry` resolves each appearance
once in wire order after complete framing and received-state validation; later
failure rolls back the model, including all styles. Callback side effects remain
caller-owned. The old API supplies the same default geometry. The additive Wasm
API accepts explicit normalized paired metadata with black outline and effective
global smoothing 0.12; it needs no asset readiness. Both renderers consume the
retained style. Standard recipe eyes must match it exactly, including signed
zero, before Canvas reset. See the [paired-eye contract](standard-body-renderer.md#appearance-time-paired-eyes).

`prepare_draw_with_style` samples each visible body once and returns ordered
`PreparedSnake` values. It captures the current face heading before committing
the new curve target for a later update. Spacing advances once; sampling uses that
frozen spacing. Short appearances still prepare a face without a body curve.
The entire numeric draw rolls back on failure, including camera and eye targets.

The Wasm `AnimatedScene` owns this model. `advance` returns an owned step to free;
`render` prepares one draw internally and commits numeric state after successful
drawing. `prepare_draw` is a numeric-only alternative: do not call it immediately
before `render` for the same draw. Own body, correction and curve diagnostics are
copied arrays. `snapshot` separates the active input head from retained own
diagnostics; nested own and explicit camera absolute fields use absolute units.
`set_gaze_heading` changes the retained original own gaze independently of live
input eligibility. `drawn_snakes` returns copied numeric snapshots with original
own identity and draw ordinals; `drawn_eyes` observes current paired-eye layouts
without advancing any clock. A style-aware numeric preparation is also exposed.

`web/animated.mjs` runs update then render once per animation callback, applying
incoming packets immediately. It frees steps and the session, cancels callbacks
on pagehide, and continues animation after local transport disconnection. The
separate `/animated` page draws sampled bodies with three generated palettes.
Standard eyes are laid out from the f64 corrected head and painted after each
snake's body, with square-root death fading and no spawn/boost opacity factor.
All layouts validate before canvas reset. Pointer gaze uses full radians from
canvas-center offsets before each update, separately from quantized live steering.
The synthetic fixture uses ordered body effects and applied HQ/LQ state. Local
simulator mode retains the basic stand-ins. Complete skins, special faces,
attachments remain unimplemented. This preview does not
establish visual or gameplay equivalence.

## Ordered body paint planning

`plan_standard_body` consumes frozen Float32 curve samples, original ordinals,
effective draw flags, the sampler's unrounded f64 distance-cursor seed, and an
externally resolved recipe/asset snapshot. It returns image commands for one
standard snake in painter order: boost, outlines/shadows, interleaved body and
color fades, inner boost, then death highlighting after an antenna insertion
barrier. Antenna work is not implemented by this planner.

The planner preserves source identity/revision, whole-source or cropped uses,
stored tangent rotation, separate f64 translations, and Canvas alpha assignment
semantics. Invalid alpha assignments retain the preceding scoped value rather
than clamp. Original ordinals and effective flags survive culling; this API does
not generate or clear flags. It advances no clocks, spacing, lifecycle or quality
state and performs no browser calls. Validation and a complete command-budget
check precede allocation; arithmetic errors return no partial plan.

Inputs are bounded to 65,536 active samples, 256 palettes/runs/variants, 4096
asset entries and 524,304 image commands. Fewer than two active samples,
coincident stored geometry, absent style metadata and unready referenced assets
fail explicitly. The provider's opt-in `bodyStyle` and per-palette `boostGlow`
describe these inputs without distributing host mappings or stock recipes.
The opt-in [`AnimatedScene.render_standard`](standard-body-renderer.md) consumes
trusted normalized borrowed recipes, prepares production geometry with each
recipe's detailed style, and submits these commands using borrowed applied quality.
It does not evolve quality. The synthetic animated page supplies authored
stand-in recipes and advances quality before statistics, counting successful
draws independently of its throttled readout. Its connection preference applies
on socket open; synthetic reset starts HQ without resetting the statistics clock.

Numeric draw preparation also captures owned `PreparedBodyGeometry` snapshots
for eligible curves. Each keeps original sample ordinals, effective flags and
the sampler's final unrounded f64 displacement. Inclusive culling updates shared
ordinal flags; offscreen ordinals retain their previous value across snakes,
draws and resets of the same client. Short curves omit this painter snapshot.
Public preparation stages the client once and commits only after all operations
succeed. The browser renderer reuses its disposable stage, preserving model
rollback if validation, sampling, eye layout or Canvas submission fails.

## Browser rendering

`QualityState` independently models desktop quality preference and applied mode.
Connection initialization applies the preference; preview starts high quality.
Interpolation consumes the lag-adjusted update delta before the statistics
transition. Statistics use the raw draw count over a strictly greater than
1000-ms interval, retaining fallback/recovery history and its negative residual.
The caller owns that draw counter. `DesktopQuality` exposes this same state to
Wasm, validates numeric modes/counts before narrowing, and borrows an owned
animation step. The animated page owns the shared-step cadence and draw counter;
the renderer borrows its applied snapshot.

`web/asset-bridge.mjs` borrows the exact existing canvas and loaded image objects
from a supplied trusted page realm. It validates their types and readiness
without copying or loading assets. The wasm32 bindings in `src/browser.rs` expose
protocol operations and `render_borrowed_assets`.

The optional [trusted skin provider](skin-provider.md) accepts caller-owned
recipe-resolution/normalization callbacks and a revisioned asset catalog. It
validates bounded palette runs, variants and represented feature metadata while
preserving exact existing canvas/image objects. Canvas readiness is explicit;
missing cosmetics remain pending. It neither loads artwork nor selects renderer
passes. Unsupported features remain explicit, and no stock recipe tables or host
member mappings are distributed with it.

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
