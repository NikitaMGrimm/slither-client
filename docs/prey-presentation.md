# Retained prey presentation

The opt-in animated client retains independent prey appearances, movement,
position smoothing, captured eater objects and creation-selected raster sources.
The received-anchor preview validates these packets but does not draw prey.

Canonical `y` commands create, remove or capture prey; canonical `j` commands
reanchor and independently update motion fields. They now count as supported
commands. Invalid forms or directions, and either family before Setup, reject
the whole frame. This intentionally changes their earlier opaque-ignore behavior.
No prey map or packet cache is added to received state.

## Packet and update ownership

Appearances append even when their wire ID already exists. Updates, removals
and captures reach the newest surviving match. Removal preserves the other
appearances' order; update and drawing traverse newest first. A capture uses
the eater addressable at that event. Missing eaters remove prey immediately.
Captured objects stay bound through snake removal, expiry and ID reuse; food
and prey share the parent object's retention roots.

Prey borrows the existing animation step after snakes update and before food.
It keeps moving and turning during capture, including while disconnected.
A zero-delta update still applies non-clock-gated spawn/flight rules. Position
corrections use two 53-slot Float32 channels; scalar animation and draw arithmetic
remain double precision. Packets, Setup draws, resizes and explicit renders do
not advance this clock. Setup preserves prey. Reset clears prey while retaining
mode enablement, monotonic identities and the existing timeline.

## Creation APIs

Existing signatures remain available. To enable both retained food and prey
before the first packet, or immediately after reset, call:

```js
scene.apply_frame_with_all_factories(
  bytes, elapsedHeader, resolveFace, resolveFood, resolvePrey,
);
```

The prey callback receives a fresh record with `id`, `x`, `y`, `size`,
`sizeByte`, `rawColor`, `palette`, `direction`, `heading`,
`wantedHeading`, `speedPer32ms` and creation-time `zoom`. Palette is raw
color modulo nine; direction is numeric zero, one or two.

Return a synchronous own-data record:

```js
{
  randomPhaseUnit: 0.25,
  randomRateUnit: 0.5,
  palette: {
    color: request.palette,
    bodies: bodyEntries,
    glows: glowEntries,
  },
}
```

Each random unit must be finite in `[0, 1)`. The caller supplies the two
independent values once per creation. Body and glow arrays each contain
1..4096 entries, with independent lengths. Body selection uses the event-time
zoom and size; the final glow entry serves both glow lobes. Selections stay
fixed through later zoom changes.

Each entry has the same raster shape as retained food:

```js
{
  asset: {
    source: existingCanvasOrLoadedImage,
    kind: 'canvas', // or 'image'
    status: 'ready',
    revision: 'caller-owned-revision',
    width: intrinsicWidth,
    height: intrinsicHeight,
  },
  width: declaredWidth,
  height: declaredHeight,
  halfWidth: declaredHalfWidth,
  halfHeight: declaredHalfHeight,
}
```

Intrinsic sizes must match the actual ready object. Declared full sizes and
independent halves retain fractional values; no halves are recomputed.
Revisions are bounded nonempty strings or safe nonnegative integer Numbers.
Numeric revision identity uses `Object.is`, including opposite signed zeros.
Inherited/accessor-backed required fields, holes, pending sources, coercions,
Promises and target aliases reject. These trusted callbacks and DOM capabilities
are not a sandbox. No assets are loaded, copied or extracted.

Once enabled, a creation passed through an older apply method without a prey
resolver fails atomically. Updates, captures and removals can still use those
older methods. A disabled legacy animation session validates/counts prey inputs
without creating a retained approximation. Enabling cannot reconstruct earlier
entropy or sources.

## Rendering and Setup

Existing quality-aware `render_standard[_at_size]` and
`render_with_food[_at_size]` include retained prey automatically. The
quality-less basic APIs reject enabled retained sessions before clearing.

Two additive ingress methods include prey in ordered Setup planning:

- `apply_frame_and_render_standard_with_prey`: the standard method's arguments,
  with `resolvePrey` immediately after `resolveFood`.
- `apply_frame_and_render_with_food_and_prey`: the basic method's arguments,
  with the same resolver insertion.

They return the number of Setup submissions. Each plan freezes its event-time
world, camera and selected sources. An earlier plan can still draw prey removed
by a later command in the same bundle.

Painting orders food outlines/bodies, prey bodies, complete snakes/faces, food
glows, then prey inner/outer glow pairs. Prey uses additive composition in both
HQ and LQ without a direct quality-blend multiplier. Early culling uses the
corrected center before capture interpolation; the two late lobes independently
cull their interpolated expanded centers. Full-scale body/inner images use the
whole-source overload. Outer glows always use an explicit source/destination
rectangle. Zero-size and zero-alpha calls remain represented. Canvas ignores
finite out-of-range alpha assignments, retaining the prior accepted value
through the traversal rather than clamping.

Every plan, source, alias, budget and native context is checked before the first
destructive target operation. Model/registry failure rolls back the entire
ingress. Callback effects and consumed entropy remain external. A native
exception after submission starts can leave resized or partial pixels.
Callbacks remain non-reentrant, including the existing binding-cleanup limitation
after prohibited reentry.

The limit is 4096 retained prey, with no silent eviction. Food and prey share
262144 inspected catalog entries and 524288 source snapshots per transaction.
Their image calls share the existing 524304-command budget with bodies/faces
and all ordered Setup draws. Existing dimension, sample, layout, frame-size,
Setup-count and backing-area limits remain enforced.

## Diagnostics and evidence

`prey_state()` returns copied own records, BigInt identities and source handles,
scalar Numbers, two Float32 sample arrays and Float32 weights for each prey.
It exposes no source objects or pixels and advances no state. Existing
`snapshot()` and `food_state()` schemas remain unchanged.

The animated page supplies three authored prey commands and original flat
stand-ins from `synthetic-prey.mjs`. Its prey entropy tape is independent of
the food tape. Local mode uses the same additive APIs and does not open any
additional connection.

Focused native and real-Wasm recorder checks cover packet/lifecycle ownership,
arithmetic, painting barriers, copied diagnostics, source retention and rollback.
Page tests use explicit authored doubles. A separate bounded external-runtime
comparison of historical candidate `993322a` matched 26,398 frozen minimal
numeric and submitted-command cells exactly; see
[verification](verification.md#retained-prey-integration) for its fixture and
coverage limits. These results do not establish current-client or full-state
source-runtime parity, stock-browser raster parity, original artwork/loading
equivalence, extension packaging or gameplay/server acceptance.
