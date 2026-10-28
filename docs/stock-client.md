# Stock asset and input adapters

The authored stock adapters connect existing live image objects to the Rust/Wasm
presentation APIs. The source adapters do not ship artwork, execute the original
skin or entity factories, or open connections. The separate session/gameplay
composition provides explicit Play and transport; complete game-page compatibility
remains unverified.

## Capture and source ownership

`createStockSkinAdapter` in `web/stock-skin-provider.mjs` captures one explicit
host snapshot per operation. Appearance callbacks retain numeric face and antenna
geometry; draw callbacks borrow the selected body, effect, face and bulb objects.
Accepted custom data takes precedence over built-in special features. Skin 27
uses the single-image face family; skin 40 uses the mouth-face family. The stock
rules also select ordinary/custom body recipes, paired side images and ordinary
antennas from ready borrowed sources. The controller can explicitly select the
existing accessory APIs; stock accessory selection remains unintegrated and
active host accessories are rejected. Ready-source support does
not establish pending-source/loading equivalence.

A snapshot may include caller-owned `nicknamePaletteRgb`: 42 own-data
`[red, green, blue]` byte triples indexed by stock palette. It joins the
same-revision consistency check. When present, each appearance returns the
selected rule's first-palette triple and three units from the adapter's `random`
capability as `nicknameTint`; Rust computes the color. The extension snapshot
does not supply this table, so its names keep the neutral color and consume no
extra randomness. The added draws shift the shared random stream for later food,
prey and antenna units. External callback effects, including those draws, cannot
roll back with a rejected frame.

`createStockEntityAssets` in `web/stock-food-provider.mjs` supplies food and prey
factories from that same held capture. Rust selects creation-time image indices;
the adapter supplies every selectable entry and the declared full and half
dimensions. Each successful factory consumes exactly two caller-supplied random
units after source validation, followed by a source/coherence recheck.

Every live readiness commitment is `{source, state, revision}`. The revision
identifies that source's content, independently of the enclosing capture's
revision. Unchanged sources retain their tokens when unrelated assets change.
Repainting, resizing or changing readiness requires a new content commitment.
Shared body, face, food and prey uses must agree on the exact token and native
dimensions. A sized canvas alone does not prove that painting completed.

The adapters read trusted DOM prototype getters and reject incompatible own
scalar shadows. They do not read pixels, load URLs, create artwork or infer
content changes from dimensions. The caller owns truthful readiness and content
commitments, including same-size repaints. Missing commitments remain pending;
metadata accessors and conflicting aliases reject.

`beginOperation()` and `endOperation()` delimit the held capture. The entity
factory's `snapshotForOperation` must return that capture, never recapture the
page independently. Release it even after a failed operation.

## Update and draw ownership

`createStockClient` in `web/stock-client.mjs` accepts caller-owned scene, quality,
assets and target capabilities. Packets use the target-aware generalized-face
factory API, preserving ordered Setup draws. A frame advances one animation
step, passes it to quality, frees it, updates statistics and renders once.
Explicit resize renders synchronously without another animation update. Backing
dimensions are integers in `1..4096`.

The fixed construction option `appearanceMode: 'accessory'` routes packet,
HUD, frame, resize and explicit rendering through the existing accessory APIs.
The default is `'face'`; it does not inspect or require accessory methods.
An external local source bundle can supply the same `appearanceMode` before
startup. Changing it while the runtime retains sources rejects the operation.
Accessory mode requires an explicit accessory or null in every appearance
result and coherent ready attachment sources in recipes. It does not select an
accessory from skin IDs or packet cosmetics, load artwork or add updates.

The optional `control` callback uses `scene.advance_with_control` to run between
the existing clock step and entity motion. It receives copied step values and a
coherent retained-own/control view. The own token is a BigInt identity scoped to
one scene, independent of a reusable wire ID; the own view survives death and
removal until reset. Head coordinates are raw absolute coordinates, while the
camera is its displayed absolute position.

Return a plain current-realm or null-prototype record with optional
`gazeHeading`, `resetWorld`, `resetLag` and `connected` actions. All actions
validate before staged mutation. Gaze and lifecycle actions precede motion,
which uses the already computed step even after reset. The callback must not
reenter or free its scene. Numeric and source state roll back on failure;
external sends and callback effects cannot roll back and must not be replayed.

`onStep` is a separate diagnostic callback after the owned step is freed. It
cannot establish pre-motion input order. `reset_lag()` changes only the retained
clock multiplier; a stock pong clears lag status and permits gradual recovery,
rather than resetting that multiplier.

## Entry composition and remaining gaps

The extension runtime composes the host snapshot, skin/entity adapters,
controller, gameplay and session. One default bootstrap enables score tracking,
fixed current score/rank and final-score readouts, endpoint/nickname Play
controls and visible schema-2 leaderboard rows. The packager no longer offers
owned entry variants. Activation alone starts neither profile acquisition nor
a game socket.

The [local host adapter](local-play.md) supplies generated flat sources and
captured browser capabilities to this same composition. It restricts Play to the
configured loopback endpoint and supplies authored zero credentials through the
existing challenge session, with no profile acquisition. A normally disconnected
local session is replaced only on the next explicit Play. Remote profile
acquisition remains one-shot; neither path gains automatic retries.

Announcement display remains missing. Full viewport/login layout, menu transitions,
nickname drawing, background layers, preference controls and victory/save/replay
flows remain incomplete. See the [roadmap](roadmap.md).

Game/HUD/presentation policy still held in JavaScript is listed in the
[architecture ownership decision](architecture.md#ownership-decision). Browser
capability capture, DOM operations and extension plumbing remain JavaScript's
intended responsibilities.

## Opt-in session HUD planning

`createStockSession.subscribeWithHud({packet, hud, state, error})` is an
alternative to the existing subscription, selected before Play. Both use one
subscriber and the same staged control fold. Its packet callback receives the
complete packet, elapsed-header flag and a copied frozen plan containing each
command's incoming lifecycle guards and every required final-score index.

The callback must synchronously return a closed command-indexed report. The
session copies and validates its shape, Setup pairs, accepted leaderboard
headers and exhaustive final captures before publishing controls. The
synchronous `hud` callback receives that frozen report before state notification.
It must return `undefined`. Callback errors, incompatible reports and cleanup
failures stop the session without replay; the original thrown value is retained,
including `undefined`.
Admission inspects at most 64 callback prototype links and rejects cycles or
longer chains. It rechecks subscription ownership after reflective validation.

`web/stock-hud-contract.mjs` exports pure `copyHudIngressPlan(value)` and
`copyHudIngressReport(value, commandCount)` validators. They enforce bounded
closed records and dense arrays without decoding packets or calculating scores.
Reports retain BigInt object tokens and command-time score samples. The session
matches report events to its existing decoded commands; native code remains
responsible for score arithmetic and retained-own target resolution.

`packetWithHud` and the optional gameplay `onHudPacket` callback connect this
session seam to the native command-time journal and real Setup renderer.
Score tracking requires enablement before ingress; the default runtime performs
it and selects `subscribeWithLeaderboardRows` for schema-2 copied raw rows.
Header-only `subscribeWithHud` and legacy subscriptions remain available to
other explicit callers. The selected gameplay path stages board history and
projects row scores through the Rust/Wasm `LeaderboardScoreProjector` after
native ingress and source release, then publishes the visible board through
its DOM owner. Row history/text/display policy still held in JavaScript remains
Rust migration debt. See the
[journal API](hud-ingress.md).
The optional [semantic readout mode](hud-state.md) stages lifecycle fade and
required draw samples after source release. The default entry binds its
[view/DOM renderer](hud-view.md) to fixed readout/final nodes alongside the
leaderboard owner.
An error after a future native commit or observer effect cannot roll those
effects back; the session terminates and never replays the packet.

## Desktop input

`createClientInput` in `web/client-input.mjs` accepts explicit pointer geometry,
retained-own coefficients and the existing step's integer count. It constructs
byte intents through a supplied synchronous send capability. It creates no
clock, socket, timer or local own-snake movement prediction.

The stock strict steering and boost/keyboard gates remain unchanged. The
accumulation-only `accumulateStep` permits arrow debt to advance before a due
life-end close; a later `tick` with `wholeSteps: 0` performs sends. The optional
hook between keyboard and boost lets the session insert its ping in order,
including connected frames without an own snake. Blur does not invent a
boost-off packet. The proposals in [responsiveness](future/responsiveness.md)
remain design-only.

Synthetic tests and real-Wasm recorder checks cover these seams separately from
browser installation, live source loading, pixels, session UI and gameplay.
See [verification](verification.md) and [extension integration](extension.md)
for the evidence and remaining boundaries.
