# Stock asset and input adapters

The authored stock adapters connect existing live image objects to the Rust/Wasm
presentation APIs. They do not ship artwork, execute the original skin or entity
factories, open a connection, or establish complete game-page compatibility.

## Capture and source ownership

`createStockSkinAdapter` in `web/stock-skin-provider.mjs` captures one explicit
host snapshot per operation. Appearance callbacks retain numeric face and antenna
geometry; draw callbacks borrow the selected body, effect, face and bulb objects.
Accepted custom data takes precedence over built-in special features. Skin 27
uses the single-image face family. Skin 40 and static accessories remain
unsupported.

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
