# Retained desktop food

This opt-in path connects ordered protocol-19 packets, retained food objects,
the existing animation clock and two Canvas paint passes. The authored animated
page uses it with original synthetic textures. It is separate from the lossy
received-position food map used by the `/` preview.

## Packet and lifecycle ownership

`F/f/b` create one retained object per record, including duplicate keys. `f`
uses the slow appearance rate; `b/F` use the rapid rate. Omitted `f/b` colors
reuse their raw color cache. Colors through nine remain unchanged; larger
colors use modulo nine for palette selection. Spawn and consume sectors and
the cached eater ID are independent. The first own appearance initializes
the compact caches; repeated Setup preserves them.

`c` immediately removes the newest matching food. `<` captures the newest
addressable eater object, including explicit ID zero; `C` resolves the cached
ID again at that command. Existing flights retain their captured object through
removal, death and ID reuse. A missing captured eater stays missing and expires
on the next update, including zero delta. Sector clear removes all matching
retained instances, including flights. Removal uses dense reverse-scan swap
order rather than key order or stable erase.

All drawn snakes update before food, using the same fractional `AnimationStep`.
Food flight uses the captured object's raw head and head/angle corrections.
Food continues to animate while disconnected and offscreen. Consumption freezes
the current spawn fade and uneaten scale. Drawing never advances these channels.

Setup configures the existing world and refreshes global snake parameters.
Appearance-time segment length, maximum speed and selected food textures remain
retained. Explicit reset clears objects and source references, restores initial
zoom and lag, and preserves animation phases, camera position, Follow, boundary
cadence and previously initialized food cull bounds. An unprimed compact sector
is rejected; malformed/unprimed-stream parity is outside this API.

## Applying packets

Start `AnimatedScene.apply_frame_with_factories(bytes, elapsedHeader,
resolveFace, resolveFood)` before any packets, or after explicit reset. Native
`AnimatedClient` exposes the corresponding typed method. Once enabled, older
apply APIs reject new food creations without a factory. Both resolvers run
synchronously in event order after complete received-frame validation.
Resolvers are trusted, non-reentrant capabilities: do not call the same scene
during resolution. Nested mutation rejects, but the pinned binding runtime has a
pre-existing cleanup limitation after such rejected reentry; subsequent `.free()`
can fail. This behavior is outside the supported resolver contract.

The face resolver uses the existing complete paired-face numeric contract.
The food resolver receives a fresh own-data record:

```js
{ key, sectorX, sectorY, x, y, size, sizeByte, rawColor, palette, rapid, zoom }
```

Return two independently supplied finite random units in `[0, 1)` and one
effective palette. The family count is 1..4096; each family provides at least
that selectable prefix. Extra array tails are unread.

```js
{
  randomPhaseUnit, randomWobbleUnit,
  palette: { color, count, bodies: [entry], outlines: [entry], glows: [entry] }
}
```

Each entry has independent intrinsic and declared draw metadata:

```js
{
  asset: { source, kind: 'canvas', status: 'ready', revision, width, height },
  width, height, halfWidth, halfHeight
}
```

`kind` can also be `image`, requiring a complete, nonempty `HTMLImageElement`.
Intrinsic dimensions are integers 1..65535 matching the live DOM object. Declared
full dimensions are positive finite Numbers and halves are nonnegative finite
Numbers; halves are not recomputed or rounded. Revisions are nonempty strings
of at most 128 UTF-16 units or unsigned safe integer Numbers. `Object.is`
distinguishes signed-zero revisions. Required metadata must be own data fields;
accessors, inherited fields, coercion, pending sources and Promises reject.

Creation uses the current event-time zoom to select body/outline and two glow
indices from these families. Both glows share the same family. Selected exact
objects, revisions and declared metadata remain retained until the food ends;
later zoom changes projection without selecting new textures.

Client and JavaScript-reference ownership stage and commit together. Final source
readiness is rechecked after every callback, including a later face callback.
Failure preserves committed model, caches, counters and references. Callback
side effects, entropy consumption and changes to external raster pixels cannot
roll back. Sources, realm and revision truthfulness remain trusted capabilities.
Changing a canvas's pixels also changes what every retained reference sees;
revision snapshots do not copy or freeze those pixels.

## Rendering and diagnostics

`render_standard` selects retained food when factories are enabled and otherwise
keeps its received-food preview. Its existing `DesktopQuality` supplies the
applied HQ flag and blend. The basic path uses additive
`render_with_food(target, p0, p1, p2, background, detailedStyle, resolveFace,
quality)`. Its face-only draw metadata uses `decoration: null` for no images;
numeric appearance metadata uses `{ kind: 'none' }`. Legacy basic render calls
reject an enabled food session because they do not supply applied quality.

After one camera/zoom preparation, all food outlines precede all food bodies;
all existing snake/body/eye/face work follows. Late food glows then draw in
reverse food order, with each food's inner/inner/outer/outer calls together.
Outlines use source-over and body/glow calls use lighter. LQ retains outline
and body; HQ or positive blend also retains the pulsating body and four glows.
Zero-alpha calls are preserved. Full scale uses three-argument `drawImage`;
other scales use the explicit nine-argument source/destination overload.
Declared destination sizes receive no additional zoom multiplier.

Food uses inclusive center culling with a fixed 24-world-unit margin, retained
from the existing own-object view point. Fresh pre-own state has no bounds;
reset preserves previously initialized bounds. Planning advances no clocks and
preflights all sources and the shared image budget before clearing pixels.
Body/face aliases of retained food sources must agree in revision and intrinsic
dimensions. Canvas exceptions preserve the model and balance scopes; partially
painted target pixels cannot roll back.

`food_state()` returns copied objects with Number cells, preserving signed zero,
and BigInt identities for food instances, source/revision handles and captured
eaters. It reports enabled state, received count, selected source count, own
token, retained cull bounds and every retained food's numeric state. Mutating
the returned objects has no effect. Plain JSON cannot serialize BigInt or retain
negative zero; comparison tools need a lossless encoding.

Limits are 65,536 retained food objects, 262,144 inspected selectable catalog
entries per transaction, 524,288 temporary/retained source snapshots, and a
combined frame image budget of `MAX_BODY_PAINT_COMMANDS` (524,304). Exceeding a
limit rejects the complete transaction or draw; foods are never silently skipped.

## Evidence limits

The earlier food integration has bounded exact numeric and stock Windows
Chrome/Firefox Canvas evidence using authored textures and timestamps. Its six
Setup/layout draw-presence differences remain recorded failures. The additive
host path below has separate synthetic checks; those earlier results do not
establish its original-runtime cadence or native pixels. The current arena boundary remains
a stand-in painted before food, so whole-frame boundary occlusion is not claimed.
Prey, team ordering, mobile, other cosmetics, host skin/texture mapping, transport
close policy, installed extensions and official-server acceptance remain outside
this integration.

## Ordered Setup draws and explicit resize

The additive target-aware factory methods accept the same two resolvers, followed
by explicit rendering inputs. They return the number of submitted Setup draws:

```js
scene.apply_frame_and_render_standard(bytes, elapsedHeader, resolveAppearance,
  resolveFood, target, p0, p1, p2, background, width, height, resolveRecipe, quality);
scene.apply_frame_and_render_with_food(bytes, elapsedHeader, resolveAppearance,
  resolveFood, target, p0, p1, p2, background, width, height, detailedStyle,
  resolveDrawFace, quality);
```

Each Setup plans exactly one draw before the next command. An initial empty Setup
still paints its background; a packet without Setup returns zero and adds no
draw. Later creations use the zoom after preceding draws. Earlier plans retain
their exact source objects even when later commands remove the corresponding
food or snake. Final GC follows successful submission of all plans.

Dimensions must be finite integers in 1..4096. They describe the desired backing
size, which can differ from the entry target size. No renderer resize, reset or
paint occurs until all callbacks, plans, shared-source revisions, readiness,
context/pattern acquisition and budgets pass. A callback changing the target's
entry dimensions rejects. Callback side effects remain external. All new paths
require retained food factories, enabled by target-aware apply before packets or
after reset. They store no target, pending queue or quality owner on the scene.

For resize without a packet, use `render_standard_at_size` or
`render_with_food_at_size` with the existing render arguments and `width, height`
immediately after `background`. These calls prepare and submit once without
advancing animation or quality. A changed backing size assigns both dimensions;
unchanged size still resets drawing state for hostile clip/transform isolation.

Per-ingress limits are 64 Setup draws and 67,108,864 aggregate desired backing
pixels, independent of scene contents. Every Setup charges its desired width
times height before its draw resolvers or native preflight; excess rejects the
whole ingress. This bounds logical target area, not measured browser time or
physical pixel work. Explicit single renders remain unaffected. The separate
protocol limit is `MAX_FRAME_COMMANDS` commands. Other ingress limits are `MAX_DRAW_SAMPLES` total
curve samples and retained snake layouts, and `MAX_BODY_PAINT_COMMANDS` total
image commands. Source/catalog ceilings still apply across the whole transaction.
Limits reject before target mutation instead of dropping or combining draws.
Late native Canvas failure preserves model/source state, while already resized,
cleared or painted target pixels cannot be restored.

The authored page routes both synthetic and local packets through these APIs.
Its zero-inset desktop window sizing uses diagonal/ceil arithmetic and ordered
1500-pixel caps; CSS scales the backing target inside the existing page. Setup
counts and synchronous resize draws join the quality statistics counter. RAF
alone advances the shared step; it continues to render once per callback.
