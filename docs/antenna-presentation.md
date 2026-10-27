# Ordinary antenna presentation

The opt-in appearance APIs retain ordinary antenna chains on stable snake
objects. Both animated renderers prepare them once per eligible draw with
caller-supplied random units. Standard rendering inserts the antenna before
death highlighting and preserves its effect on that pass's distance cursor.
The basic renderer demonstrates the same chain with its existing stand-in body.

This represents the ordinary desktop chain with 8, 9 or 11 nodes, including
rotating and unrotated bulbs. Actual host skin mapping, chooser wind/re-skinning,
mobile/team behavior, accessories, post-bulb strokes and startup blank-source
loading remain outside this API. Artwork is borrowed from trusted ready sources;
the client neither loads nor reproduces stock assets.

## Appearance metadata

`apply_frame_with_appearance(bytes, elapsedHeader, resolveAppearance)` resolves
each appearance once, after complete received validation. The callback returns
an explicit own-data `{face, antenna}` record. `face` uses the existing paired-face
geometry schema. `antenna` is `null` or the following numeric configuration:

```js
// Original synthetic configuration; no stock skin mapping is implied.
const antenna = {
  kind: 'ordinary-chain', nodes: 9,
  outerColor: 0x183d52, innerColor: 0x7acadc,
  innerOpacity: 0.5, repeatedInnerStrokes: true, rotateBulb: true,
  bulb: { offsetX: -8, offsetY: -12, width: 24, height: 32,
    scale: 0.75, opacity: 1 },
};
```

Colors are packed RGB values. Offsets are finite in `[-65535, 65535]`, dimensions
in `(0, 65535]`, scale in `(0, 256]`, and opacities in `[0, 1]`. Fields are read as
own data without coercion or accessor invocation. `postBulbStrokes`, if supplied,
must be `false`. Exact configuration agreement preserves accepted signed zeros.

`apply_frame_with_appearance_and_factories` adds the retained food factory;
`apply_frame_with_appearance_and_all_factories` adds both food and prey factories.
Their callback ordering and transactions match the existing factory APIs.
Enable full appearance mode before packets or after reset. The mode survives
reset; subsequent appearances require the full resolver. Legacy application
remains usable for appearance-free frames, subject to existing food/prey rules.

Each appearance owns independent positions, velocities and acceleration channels
stored as Float32, a shown latch and a double-precision bulb angle. Duplicate or
reused wire IDs share no chain state. Setup preserves chains. Reset clears them
while retaining the timeline, appearance mode and cached antenna bounds.

## Draw cadence and randomness

Updates do not advance the chain. An eligible explicit render, resize draw or
ordered Setup draw takes one sequential root-to-tip step, even at the same
timestamp or zero opacity. Death continues until ordinary draw expiry. HQ/LQ,
quality blending and connection state add no direct antenna gate.

The root uses the corrected double-precision head and raw heading. Eligibility
requires whole-snake visibility, at least two active curve samples, and the
root inside retained inclusive view bounds with a 210-world-unit margin. Bounds
refresh after retained-own camera preparation, including follow-off and removed
own cases. No-own draws retain them. A visible inner-gate exit clears the shown
latch; whole-snake culling preserves it. Re-entry straightens positions while
retaining velocities and bulb rotation.

`resolveRandom(request)` receives a fresh record with `token: BigInt`, `id`,
`own`, `drawOrdinal`, `nodeCount`, `randomPairCount` and `drawSerial: BigInt`.
It synchronously returns a `Float64Array` of exactly `2 * randomPairCount`
finite units in `[0, 1)`, ordered x then y for each non-root node. Eligible
lengths consume 14, 16 or 20 units. Rejected gates and culled snakes consume none.
No generator or replacement tape is chosen by the client.

The solver retains binary32 assignment boundaries and the host-math-built
Float32 angle lookup. Bulb rotation uses direct host `atan2` and signed remainder.
Native standard-library trig tests do not prove browser bit agreement. A supplied
antenna tape also does not establish global random ordering with other host work.

## Borrowed source and renderer APIs

The trusted provider accepts optional recipe metadata:

```js
antenna: { kind: 'ordinary-chain', geometry: antenna,
  image: { asset: bulbCatalogIndex, sourceMode: 'whole' } }
```

This adds the `ordinary-antenna` feature. Absent/null metadata preserves legacy
output shapes. The existing static `attachment` remains separate and unsupported
by this renderer. Antenna input requires explicit whole-source mode; crops are
rejected. A coherent ready bulb source is required even when the inner gate
rejects drawing. Pending sources reject the draw before reset; this ready-only
policy does not establish timing during the source's pending interval.

`render_standard_with_antenna` takes the existing target/palettes/background,
then `resolveRecipe, resolveRandom, quality`. Its `_at_size` variant inserts
`width, height` after the background. `render_with_antenna` takes those assets,
then `detailedStyle, resolvePresentation, resolveRandom, quality`; its `_at_size`
variant inserts dimensions in the same place. The basic presentation callback
returns `{revision, face: {eyes, decoration}, antenna}` with normalized borrowed
uses. A host projecting provider output must check ready status and complete
represented feature coverage first.

Target-aware `apply_frame_and_render_with_appearance` and
`apply_frame_and_render_standard_with_appearance` include food factories;
their `_and_prey` variants include both factories. They retain the existing
argument order with the explicit appearance/presentation callbacks and insert
`resolveRandom` immediately before `quality`. Each returns the actual ordered
Setup-draw count. `prepare_draw_with_antenna` is the numeric-only alternative;
do not invoke it immediately before a render for the same intended draw.

Standard order is body prefix, antenna paths/bulb, death suffix, eyes/face, then
the next snake. Even a rejected inner gate changes the death cursor. Eligible
paths use round source-over strokes; repeated inner strokes reuse the current
path. The bulb keeps a whole-source five-argument draw and separate center/tip
transforms. Zero-alpha strokes and images remain. Late food/prey and arena edge
follow all snakes.

## Transactions, limits and diagnostics

One disposable ingress stage owns all numeric changes and shared source pools.
Dimensions, readiness, source identity/revision, configuration coherence and
budgets are checked before target reset. Sources used by an earlier Setup draw
remain alive through later removal in the same bundle. Successful complete
submission commits the stage. Callback effects, consumed random attempts and
partial pixels after a native failure remain external.

Per-ingress antenna ceilings are 512 bulbs, 1024 paths, 2048 strokes, 11,264
vertices and 10,240 random units, shared across all ordered Setup plans.
Bulbs also debit the existing shared image budget. Random-unit capacity is
checked before its callback; exact output counts, including random-dependent
vertex decimation, are checked after numeric planning and before reset.

`antenna_state()` copies mode, draw serial, bounds and token-bearing retained
snake records. Enabled chains include geometry, six Float32Arrays, shown state
and bulb rotation. Readouts advance no draw or update. Existing `snapshot` and
`drawn_snakes` schemas remain unchanged. Existing calls with no configured antenna
preserve their behavior; configured antennas require the explicit draw capability.

Verification distinguishes synthetic native/real-Wasm checks, stock-browser
observations and original-runtime comparison. A passing recorder does not prove
original pixels, full host adaptation, gameplay or extension acceptance.
