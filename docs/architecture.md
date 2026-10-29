# Architecture

## Ownership decision

Game, HUD and presentation state and logic belong in Rust, exposed through the
Wasm API. JavaScript is limited to browser/DOM glue, extension plumbing and host
capability capture. This is the target boundary; the current split still has
the following exceptions:

| JavaScript module | State or logic still outside Rust |
| --- | --- |
| `web/stock-gameplay.mjs` | Mixed capability/scheduling glue and input/session reconciliation, reset ordering and staged HUD state publication. |
| `web/stock-client.mjs` | Mixed borrowed-source/Canvas/Wasm glue and update/draw/quality ordering with successful-draw statistics counters. |
| `web/handshake-session.mjs` | Standalone probe-only challenge/login/setup sequencing; production uses only packed-ABI record admission from this module. |
| `web/stock-hud-view.mjs` | Binding/readiness composition around Rust-formatted current/final HUD values. |

The browser-free Rust leaderboard owner retains command-ordered Setup/table and
board history, one-use prepared operations, revisions, name/text/style policy and
top-ten projection. `web/stock-leaderboard-state.mjs` and the copied view retain
closed JS record admission, generated-ABI capability capture, scene/issued
identity checks and DOM binding readiness composition. The same default runtime
consumes the copied Rust output. See [leaderboard history](leaderboard-state.md).
New local-host work is browser/DOM/capability glue; it must not introduce new
game-domain logic.
Browser-free `desktop_input` owns CSS pointer arithmetic, key/boost state,
retained own metadata, turn debt, strict timing gates and versioned packet intents.
The copied `DesktopInput` Wasm API commits keyboard, boost and heading phases
before returning to synchronous host callbacks. `web/client-input.mjs` retains
scalar/record admission, arbitrary `Object.is` token identity and callback order;
it contains no numeric policy fallback. Session ping remains between keyboard
and boost, and callbacks can update public input setters between phases.
Browser-free `session_policy` owns production session phases, launch/reset commit,
Setup and canonical-control admission, handshake budgets, pending action revisions,
ping/lag thresholds and command-time death/final/return history. Its copied
`SessionPolicy` Wasm stages return before socket, packet, HUD or state callbacks;
terminal flags commit before detach, reset intents and close/notification effects.
`web/stock-session.mjs` retains socket/listener/clock/send/close capabilities,
URL/buffer/record admission, generation and callback-resource fences, issued
action-record identity and exact JS errors. An accessor's uncoerced final ping-clock
value remains an opaque host value; Rust owns its marker, pending intent and
threshold gates. Necessary host arithmetic coercion runs at the original later
boundaries, outside Rust borrows. There is no production policy fallback.
Close and native resets retain the owner; explicit disposal releases it once,
with active resource leases deferring release and preserving primary failures.
The separate `HandshakeSession` class is used only by standalone probes, never
production gameplay. Its probe sequencing remains outside this migration.

The default [player menu](menu-preferences.md) keeps appearance selection, custom
run editing and bounded preference restore in Rust. Captured DOM/storage glue
restores nickname/appearance and passes their copied bytes to explicit Play.
The browser-free [Play admission owner](play-admission.md) retains availability,
accepted attempts and local explicit-return admission. Its primitive Wasm boundary
releases each Rust borrow before UI locking, status, unlock or launch effects.
Runtime JS retains native security/generation guards, URL/capability admission,
session observations, promises and browser effects; it has no admission fallback.
The authored [startup/loading surface](menu-loading.md) projects existing status
and completed DOM-owner mounts in Rust, reusing StartPageView. Native labelled
indeterminate progress and static pre-Wasm markup add no timer, clock, admission
or acquisition policy. JavaScript retains captured DOM effects and failure cleanup.
`desktop_layout::desktop_backing_size` owns desktop viewport arithmetic in
browser-free Rust. Its pure Wasm export returns a fresh copied width/height
record; `web/desktop-layout.mjs` admits primitive inputs and copies that output
without a JavaScript numeric fallback. The default runtime and the separate
animated diagnostic both use initialized Wasm. JavaScript still reads the actual
viewport and performs existing resize/DOM/Canvas effects. The policy retains
positive finite inputs, ceiled dimensions, squared-sum diagonal overflow
rejection, ceiled 1800 scaling and sequential ceiled 1500 dimension caps, without
DPR multiplication, UI insets, clocks or renderer changes. Authored native and
real-Wasm oracle checks cover arithmetic and boundary admission, not browser pixels.
See the [roadmap](roadmap.md) for remaining work.

Local rendering binds a pure Rust skin resolver after Wasm initialization. Rust
selects the existing three authored color stand-ins, plain paired eyes and
seven-variant shading cadence. The asset map supplies shaded body, boost-glow,
outline, shadow and death-highlight canvases; JavaScript binds those source
objects through the existing provider. Admitted custom runs use first-variant
shading and project each palette modulo three, preserving admitted run counts
and order without merging projection collisions. Empty or rejected custom data
keeps the existing `skin % 3` selection. These authored families do not imply
stock 42-color equivalence. The production stock adapter separately binds the
existing Rust resolve_skin for built-in/custom runs, face/antenna geometry and
rotation policy, and validates the host custom mask through the same Rust
palette predicate. Its JavaScript modules retain copied request admission and
borrowed source lookup/readiness/identity, without a numeric policy fallback.
The former authored JavaScript policy is a tools-only differential oracle.
This cutover does not expand the local stand-ins or establish stock artwork,
loading or installed-host acceptance.

Browser-free authored_sources owns the numeric plans for the existing local
RGB families, shaded body/effect sprites, hexagon tile, backdrop and food/prey
sources. The pure authored_source_recipes Wasm export returns fresh copied
operands. JavaScript admits own-data output, allocates/paints the same native
Canvas objects and performs the two existing generated-image decodes; there is
no JavaScript numeric fallback. Local skin selection and the source adapter
lease stay separate, and the diagnostic flat body resolver is unchanged.

The default runtime enables Rust-owned nickname presentation before ingress.
Each retained snake appearance owns its text and fade state, independently of
wire-ID reuse. Rust prepares screen-space text commands; a scoped Canvas pass
submits them before bodies for ordinary, Setup and resize draws. Names start at
opacity 1 with plain admitted Latin1 text. An appearance resolver may return
numeric `nicknameTint: {baseRgb, randomUnits}`: the selected skin's first palette
channels and three units in `0..1`. Rust adds `floor(unit * 20)` to each channel,
saturates at 255 and stores `(256 + channel) / 2`. The color is resolved once per
appearance, in both ordinary and target-aware ordered Setup ingress, and retained
through culling, death and wire-ID reuse. An absent field keeps neutral
`[238,238,238]`; invalid metadata rejects the frame. Native callers use
`TintedPresentation` with the additive `apply_frame_with_tinted_presentation*`
methods; existing methods remain neutral. Text policy and browser font
equivalence remain incomplete.

The default minimap also keeps state in Rust: decoding the five `U/L/M/V/u`
formats, retaining image/toggle planes, fade and transition state, and projecting
the retained original-own marker before prediction. Its updates borrow the
existing world step and session UI-fraction observations. A copied Wasm view
provides final CSS-pixel geometry, layer opacities and plain server-label text.
Image buffers are copied only when their Rust revision changes. The owned DOM
and Canvas widget submits that data outside world drawing and quality statistics;
it adds no timer or JavaScript lifecycle state. Legacy received-only APIs keep
minimap commands opaque when tracking is unselected.
Frame admission bounds cumulative minimap work to sixteen 512-square layers,
charging reachable payload layers and at least one surface per command. It
validates retained-size toggle runs before source or Setup draw callbacks. This
prevents small packets from causing thousands of large resizes; excess work
rejects the frame through the existing transaction.

## Protocol boundary

The extension's optional [private nickname-edit gate](extension.md#private-nickname-edit-defaults)
permits bounded native defaults for one exact registered text field while
fencing original handlers. A private runtime can explicitly bind a caller-owned
field through [its local owner API](extension.md#local-nickname-field-owner).
The default bootstrap constructs and binds its own nickname field and Play
controls alongside HUD and leaderboard owners. Native editing and installed
host/UI acceptance remain separate from implementation.

The Rust library builds as `rlib` and `cdylib`. It opens no sockets and fetches no
assets. Native code has no runtime dependencies; browser bindings use wasm32-only
wasm-bindgen 0.2.129 and web-sys 0.3.106.

- `protocol::encode_login` accepts caller-supplied client-version and 20-byte
  password values. Nicknames may be empty or contain up to 24 ASCII bytes in
  `0x20..=0x7f`, including literal DEL; custom skin data is limited to 255 bytes.
- `challenge::solve_challenge` accepts at most 512 encoded bytes and a closed
  token grammar with two fixed-length literals and a fixed copy loop. It rejects
  unsupported syntax without evaluating a general program.
- `profile_literals` owns only the existing closed decimal declaration grammar:
  bounded ASCII identifiers, four whitespace bytes, a u16 client version and
  exactly twenty u8 password values. The Wasm `ProfileLiteralParser` copies at
  most the admitted 128/256-byte spans through scalar calls into bounded scratch;
  no source string or generated slice allocation crosses that API. It clears
  each parsed input region and the JS adapter explicitly clears then frees the
  complete scratch owner before publishing its copied profile. URL/origin/pin,
  size/span/digest admission, native buffers, acquisition, deadline, cancellation
  and consumers remain in the browser boundary. Production requires initialized
  Wasm; the previous authored JS grammar exists only as a tools-only test oracle.
- `protocol::decode_frame` requires an explicit elapsed-header mode and validates
  the entire frame before returning borrowed command slices. Frames are limited
  to 1 MiB and 4096 commands. It checks framing and setup field boundaries;
  typed world validation is provided by `state::ClientState`.
- `protocol::setup_protocol_version` extracts the advertised setup version after
  structural checks. That value alone does not establish compatibility.

## Received scene state

`protocol::hud` separately supplies explicit borrowed leaderboard and public
announcement projections. It validates complete bounded commands before
exposing their fields and iterates rows without allocation. Raw text bytes,
score calculations and lifecycle policy remain separate. Generic framing and
state admission do not invoke these decoders automatically. Explicit schema-2
HUD ingress copies raw leaderboard rows through the transactional Wasm report
and a synchronous session callback. The default runtime selects schema 2 and
connects it to retained board state, safe Text-node rendering and a Rust/Wasm
`LeaderboardScoreProjector`. Schema 1 remains available for header-only callers;
row delivery alone does not choose a view. See [HUD ingress](hud-ingress.md) and
[HUD packet projections](hud-packets.md).

`ClientState::apply_frame` validates framing, applies supported commands to a
staged clone, and commits only on success. Malformed supported commands preserve
the entire previous state, including compact caches and counters. BTreeMaps keep
snake IDs and packed food keys in deterministic order. Setup must precede world
commands. Setup replaces configuration while preserving entities, own identity
and compact caches; an explicit world reset clears entities. Existing snakes
retain their appearance-time segment length. Only protocol 19 is accepted.

| Commands | Scene behavior |
| --- | --- |
| `a`, `z` | Typed setup, centered coordinates, radius updates. Optional server number, mode and team are retained. |
| `s` | Snake appearance/replacement and removal. The first appearance in a fresh world identifies self, including ID zero. |
| `g/n/G/N`, `=/+` | Relative, cached-direction and absolute front anchors, with growth variants. |
| `e/E/3/4/5/d/7` | Heading, wanted heading and speed variants selected by opcode and length. |
| `h/r` | Fractional mass and tail removal. |
| `F/f/b/c/C/<`, `w` | Accumulated sector listings, explicit/compact food additions and consumption, sector removal. |
| `j/y` | Validated prey motion and lifecycle events for retained presentation; no received prey map. |

Sector-entry `W`, pongs, game-over, leaderboard and minimap remain opaque to the
received scene map. Session control and opt-in HUD consumers handle their
supported subsets separately; score-enabled ingestion also accepts `R` own-score
adjustments. Unknown-snake updates are validated and
ignored. Compact food requires its stream's cached sector; relative anchors
require known geometry and direction. Removal and setup retain the original own ID.

Retention limits are 256 snakes, 4096 body anchors per snake, 65,536 total body
anchors and 65,536 food positions. Centered coordinate magnitudes are bounded by
16,777,215. Setup's `max_segments` is a score-table index, not a body cap. These
are client limits rather than assertions about every server.

## Ordered presentation inputs

`ClientState::apply_frame_with_events` uses the same transaction as `apply_frame`
and returns `AppliedFrame { report, events }` only after the complete frame
commits. Events retain command order, repeated equal updates, appearance
replacements and configuration changes within a frame. Each food creation,
consume request and sector clear emits in wire order, including duplicate keys
and unknown consumes. Raw color and eater caches remain independent of sector
caches; the first own appearance initializes all four. The received food map is
a lossy latest-value projection, separate from retained animation instances.
There is no retained event queue.

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

`ScoreTables` is a separate caller-owned score primitive. It builds private f64
factor and cumulative tables for a positive u16 Setup parameter, followed by
2048 copies of both endpoint values. `score(index, fractional_mass)` admits
indices through N+2048 and finite mass in 0..=1, preserving ordered arithmetic
and negative or above-32-bit results. Equal-parameter reconfiguration retains
allocations; a changed parameter replaces both tables atomically. Native math
tests do not establish browser bit equality.

An explicit [score-tracking mode](score-state.md) in `AnimatedClient` caches
those tables at ordered Setup events and retains the original own object's
replacement R byte. Pure native/Wasm observations use latest logical count and
mass, including after death or ID reuse. Legacy ingestion remains available;
the default runtime enables score tracking before ingress. An optional
[HUD journal](hud-ingress.md) shares the native transaction and supplies indexed
Setup samples, retained-own scheduling, leaderboard headers and required
command-time final captures through additive Wasm/controller/session APIs.
It adds no clock or visible UI by itself; the default bootstrap selects the
gameplay HUD and row consumers.
The browser-free Rust [semantic reducer](hud-state.md) retains bounded
dirty/header/final history and requested opacities. Its immutable Wasm histories
produce copied JS snapshots and formatted current/final values; JS retains
identity, copied-input admission and DOM binding/readiness composition. Explicit
gameplay readout mode stages it through packet, same-step lifecycle and successful draw boundaries, with required score
reads outside the native borrow and after held-source release.

The separate [HUD view and passive renderer](hud-view.md) project committed
history and consume exact owner-supplied DOM capabilities/nodes. An explicit
runtime `hudReadout: true` option binds fixed caller-owned nodes through the
gate's optional captured DOM capability and publishes after committed gameplay
operations. The side-effect-free runtime factory lets an entry select this mode
before the one-shot claim. The sole default package entry enables HUD, Play and
leaderboard construction together. It binds fixed current score/rank and final
score nodes, endpoint/nickname controls and visible leaderboard rows. Former
owned-HUD/owned-Play entry files are removed; their UI builders remain shared
runtime components. Activation alone starts no acquisition or game connection.
Announcement retention/display remains missing.
See [HUD views](hud-view.md), [stock adapters](stock-client.md) and
[extension integration](extension.md).

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
spacing. Targetless packet application advances neither clock. Elapsed headers do not add
anchor extrapolation time.

The additive target-aware Wasm factory APIs stage one draw at each ordered Setup
event. Each draw sees that event's configuration and retained world, including
its camera, spacing and source-selection effects on later commands in the bundle.
Complete received validation precedes callbacks; every draw is planned and
preflighted before the first target clear. The model and retained sources commit
only after all submissions succeed. These draws consume no animation step or
quality update. Existing targetless APIs retain their previous behavior.

`AnimatedClient::reset()` and Wasm `AnimatedScene.reset()` are infallible,
parameterless world resets. They retain the last update timestamp and both
accumulated animation phases, and restore the lag multiplier to one without
advancing an update or draw. Construct a new client with `new(start_ms)` to
start a fresh timeline. Reset clears received state, retained entities, camera
corrections and the connection gate; camera position, follow preference, camera
ring cursor, retained food cull bounds and shared body-painter flags survive.
Initial zoom is restored.
The animated page uses this same timeline across Reset, palette changes and
reconnections, independently of quality-statistics cadence.

The client retains boundary samples and cadence across resets. Setup fills the
ring and activates its connection gate; ordered radius targets schedule easing.
Setup preserves existing camera state and retained objects. Global turn/speed
and contraction parameters affect later operations; appearance-time segment
length and maximum speed remain with each snake.
Updates consume the same clock's whole steps only while connected. Disconnect
pauses boundary consumption while entity animation continues. Both render paths
use the displayed radius without consuming samples. A reset hides the retained
boundary until the next setup. Wasm exposes `set_connected`, copied
`boundary_samples` and separate `snapshot.boundary` diagnostics; `snapshot.radius`
continues to report the received target.

`ArenaEdgeView` retains the effective Setup center and camera angle/distance.
Setup changes the center before its ordered draw hook. Retained-own draw
preparation refreshes angle and distance after the camera, including follow-off,
offscreen and removed-own cases. No-own draws and reset preserve the cache;
a new client starts with angle and distance at positive zero.

`plan_arena_edge` freezes 83 fill points and 42 stroke points in screen space
using the displayed radius and strict `abs(radius - distance) < 4000` gate.
The fixed paths retain their duplicated initial endpoints and computed zero
radius. Both animated lanes stage them before target reset and submit after
late prey, under identity/source-over at alpha 0.8 with a `23 * zoom` stroke.
The closed dark-red band fills before the open inner red stroke. This adds no
animation step, quality gate, asset or image-budget charge. Ordered Setup draws
freeze their own center, radius, camera and size. Wasm `arena_edge_view()` returns
a copied Float64Array `[center, angle, distance]` without changing `snapshot`.
The received-anchor preview retains its separate circle. The actual cosmetic
chooser and full host layout remain unsupported.

## Retained food integration

`AnimatedClient::apply_frame_with_factories` accepts explicit paired-face and food
resolvers. Food creation receives two independent random units and owned source
families, selecting and retaining numeric source metadata at that event's zoom.
It must be enabled before packets or after reset; enabled sessions reject new
food through an application API lacking a food resolver. Legacy preview callers
can continue using the received-only food projection.

`FoodWorld` retains duplicate instances in insertion/swap order. Fractional food
updates follow the same owned frame step after all drawn snakes update, including
zero-delta and disconnected updates. Consumption captures a stable snake-object
token; detached referenced objects remain available until the last flight expires.
ID reuse cannot retarget an existing flight. Missing-at-capture eaters expire on
the next update rather than binding later. Model, counters, caches, tokens and
food roll back together after a late failure. Resolver side effects cannot.

The painter separates early outlines/body from late glows, with exact overloads,
applied-quality gates and a shared command budget. The additive Wasm factory API
commits retained source references with the model and releases them after expiry
or reset. Both render paths submit these plans; the authored animated page
exercises the complete path with synthetic textures and caller random inputs.
See [retained desktop food](food-presentation.md) for metadata, lifecycle,
transaction limits and bounded browser/reference evidence.

`apply_frame_and_render_standard` and `apply_frame_and_render_with_food` receive
the target, assets, desired backing dimensions and applied quality explicitly,
and return the submitted Setup-draw count. Sources used by an earlier draw remain
alive through later removals in the same transaction. Image, curve-sample and
layout budgets cover the complete ingress. Independent limits of 64 Setup draws
and 67,108,864 desired backing pixels also charge empty-world backgrounds before
draw resolution or native preflight. Explicit `render_standard_at_size`
and `render_with_food_at_size` support synchronous resize draws. Native failures
after submission starts may leave changed dimensions or partial pixels even
though the numeric model and source registry roll back.

The animated page uses the ceiled window viewport with zero UI insets to select
desktop backing dimensions. Its existing contained CSS remains a demo layout.
Initial/repeated Setup and every resize event submit synchronously, including an
unchanged-size resize; successful draws join the unthrottled quality counter.
Only RAF advances the shared update/quality step. Setup never reinitializes quality
or resets its statistics interval. Login/HUD/mobile layout and original background
pixels remain outside this host adapter.

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

`PairedFaceGeometry` additionally owns optional `PairedSideGeometry`. The additive
`apply_frame_with_face_geometry` installs both parts in that same transaction.
No DOM object, source revision or catalog ID is retained. `PreparedSnake` captures
the decoration beside the eyes and current face heading. Both production draw
paths share one bounded two-image layout and borrowed-source submitter; the basic
path exposes `render_with_face_decorations` for ready normalized face-only
projections independent of body readiness. The old basic API rejects visible
required decorations before reset. Standard recipes must match the entire retained
style exactly. Each ordinary face restores root alpha one after eyes, then paints
negative/positive side images at alpha one before the next body. This includes
nondecorated and eye-less completions. Standalone body entry-alpha semantics remain
caller-owned. See the [complete face contract](standard-body-renderer.md#complete-ordinary-paired-faces)
for source readiness, crop, trust and unsupported-family boundaries.

`FaceGeometry::Mouth` uses the same appearance and gaze timeline for a complete
three-image face. Both renderers share ordered whole-source submission: two marks
borrow one source and the mouth another. This family establishes root alpha one
independently of body spawn/death opacity. Numeric metadata stays separate from
ready borrowed sources, and face selection leaves prior body plans unchanged.
See [mouth faces](mouth-face.md).

`AppearancePresentation` extends that numeric ownership with an optional ordinary
antenna on each stable client entry. The full appearance resolver is required for
later appearances once enabled. The client retains separate 210-margin antenna
bounds after own-camera preparation and steps each eligible chain once during the
same curve/eye preparation. Its six Float32 channels, latch and double-precision
bulb angle advance on draws with supplied random pairs, independently of update
delta or direct quality gates. Setup preserves chains; reset clears them and
retains bounds/mode/timeline. The additive body planner consumes the antenna's
cursor and scoped-alpha effect before death highlighting. Both Wasm lanes share
the metadata/source pool and bounded prepared paths; bulbs join the existing
image budget, with separate aggregate path/stroke/vertex/random allowances.
See [ordinary antennas](antenna-presentation.md) for API, transaction and readiness
limits. The default no-antenna paths retain their existing signatures and output.

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

The additive `advance_with_control` computes the same existing clock step and
calls a synchronous control capability before entity motion. Its copied view
retains the original own identity, raw absolute head and displayed camera even
after own removal. Closed gaze, reset, lag-reset and connection actions validate
before staged mutation; motion consumes the already computed step. Callback
failure rolls back numeric/source state, while external effects cannot roll
back. The callback must not reenter its scene. The authored
[stock asset and input adapters](stock-client.md) use this boundary without a
second clock or local own-snake turn prediction.

`web/animated.mjs` runs update then render once per animation callback, applying
incoming packets immediately. It frees steps and the session, cancels callbacks
on pagehide, and continues animation after local transport disconnection. The
separate `/animated` page draws sampled bodies with three generated palettes.
Standard eyes are laid out from the f64 corrected head and painted after each
snake's body, with square-root death fading and no spawn/boost opacity factor.
All layouts validate before canvas reset. Pointer gaze uses full radians from
canvas-center offsets before each update, separately from quantized live steering.
The synthetic fixture uses ordered body effects and applied HQ/LQ state. Local
simulator mode retains the basic stand-ins. These preview fixtures do not exercise
the stock adapter's full recipes, special faces or attachments. This preview does not
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

Retained prey has a separate insertion-ordered world and typed canonical
appearance/motion events, sharing the animation step after snakes and before
food. Two Float32 position channels preserve reanchors; capture retains the
event-time snake token through removal and ID reuse. Food/prey eater references
jointly root detached snake objects. Both animated renderers insert prey bodies
after early food and prey glows after late food; direct prey commands are not
quality-gated. Ordered Setup plans retain their sources through later removals.
The opt-in APIs, shared resource ceilings, diagnostics and evidence limits are
documented in [prey presentation](prey-presentation.md).

`QualityState` independently models desktop quality preference and applied mode.
Connection initialization applies the preference; preview starts high quality.
Interpolation consumes the lag-adjusted update delta before the statistics
transition. Statistics use the raw draw count over a strictly greater than
1000-ms interval, retaining fallback/recovery history and its negative residual.
The caller owns that draw counter. `DesktopQuality` exposes this same state to
Wasm, validates numeric modes/counts before narrowing, and borrows an owned
animation step. The animated page owns the shared-step cadence and draw counter;
the renderer borrows its applied snapshot.

`BackgroundState` retains camera-driven tile phase in Rust and emits backend-neutral
clear, screen-image and repeating-pattern layers. Canvas2D consumes those layers
before entities and restores the world transform. The optional screen image is
gated by applied quality; its alpha is 0.3. A new scene establishes its camera
baseline on the first draw, and reset preserves that baseline and phase. This is
an authored initialization policy; visual comparison with the original remains
unverified. `web/client-asset-map.mjs` creates the local client's replacement
palettes, repeating tile and separate backdrop. An external comparison may map
private images without committing them.

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

`npm run scene -- --simulator-port 8766` serves `web/game.html` at `/` on literal
loopback. It imports the same default bootstrap as the extension. The
`web/local-game-host.mjs` adapter captures browser/DOM/input capabilities,
generates authored shaded sources and supplies only the configured loopback
endpoint and authored zero credentials. The same runtime, stock controller,
gameplay and session perform the existing challenge handshake, not a separate
gameplay implementation or direct-login bypass. A normally disconnected local
session can be replaced only on the next explicit Play; no automatic retry is
introduced and the remote profile-attempt limit is unchanged. See
[local Play](local-play.md) for commands and current evidence limits.

The received-only diagnostic now lives at `/anchors`; `/animated` remains the
separate animated diagnostic. They use generated stand-ins without a reference.
The received preview supports deterministic reset
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
`host` interface supplies the optional local demonstration. Chrome/Firefox
[extension packages](extension.md) include the authored client/Wasm and explicit
game-page activation; packaging does not establish installed gameplay. Source and
asset exclusions are defined in [provenance](provenance.md).
