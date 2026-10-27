# Static head accessories

The additive accessory APIs retain one optional head-image geometry on each
appearance, independently of its face and antenna. Paired and Mouth faces can
select an accessory; SingleImage with a non-null accessory is unsupported.
Sources are caller-owned ready images or canvases. This capability adds no
artwork, chooser, downloader or animation loop.

Install numeric metadata before the appearance's first update:

```js
scene.apply_frame_with_accessory_presentation(bytes, elapsedHeader, request => ({
  face: { kind: 'mouth-face', geometry: { pupilTravel: 2.3 } },
  antenna: null,
  accessory: { forward: 5, imageScale: 0.25, pivotX: 3, pivotY: 7 },
}));
```

The new copied appearance request includes `own`, computed from the staged
retained world before the callback. It identifies the original own appearance,
including through death and wire-ID reuse. It does not interpret the opaque wire
cosmetic as a local accessory selection. Numeric geometry stays on that stable
appearance through Setup; reset clears appearances. The new mode must start
before packets or after reset, and later appearances require its resolver.

Native callers use `AccessoryPresentation`, wrapping the existing
`FacePresentation` and an optional `StaticHeadAccessoryGeometry`.
`AppearanceContext { own }` supplies the same staged identity.
`PreparedAccessorySnake` wraps the existing prepared snake without changing its
public layout. Existing face/appearance structs, constructors and callbacks keep
their signatures. Legacy drawing methods reject a required visible accessory
before source/style callbacks, antenna randomness or model preparation.

Forward distance is finite in 0..4096, image scale is positive and at most 256,
and pivots are finite in -65535..65535. Admitted negative zero is preserved and
compared by bits against draw metadata. Invalid geometry rejects the complete
transaction. Callbacks and model updates use the existing single transaction;
the accessory adds no gaze, clock, RNG or curve-sampling step.

## Borrowed source metadata

The trusted provider reuses `HostRecipe.attachment` with this explicit tag:

```js
attachment: {
  kind: 'static-head-image',
  asset: accessoryCatalogIndex,
  sourceMode: 'crop',
  sourceRect: [0, 0, 20, 12],
  anchor: 'head',
  forward: 5,
  scale: 0.25,
  pivotX: 3,
  pivotY: 7,
  opacity: 1,
}
```

These ten fields must be own synchronous data. The crop origin must be positive
zero; its extents must be positive, at most 65535 and contained in the actual
source. Explicit crop mode is required even without a body style. A full-size
rectangle remains a crop and uses the nine-argument `drawImage` overload.
Arbitrary opacity, other anchors, unknown tags and selected SingleImage/none
families reject. Existing untagged attachment normalization keeps its prior
behavior and supplies no accessory-rendering capability.

Both new rendering lanes consume the complete ready provider snapshot. Pending,
unsupported or null recipes supply no numeric/source fallback. The face,
antenna, accessory and represented feature set must agree; the maximum complete
feature set is nine. The draw metadata must match retained geometry by bits.
Borrowed identity, native readiness, dimensions and revisions use the existing
shared source pool. Same-size source-content changes require a new explicit
content revision. The provider does not detect arbitrary pixel mutations.

The new Wasm methods mirror the existing `with_face_presentation` family with
`face` replaced by `accessory`: ingress, factories, ordered Setup/prey/HUD,
basic/standard draws, at-size draws and numeric preparation. Existing methods
and their source contracts remain available.

## Placement and submission

Translation projects the corrected head plus a forward displacement along the
captured face heading. It contains no pupil displacement or half-unit bias.
The image multiplier is `(entityScale * zoom) * imageScale`; local destination
pivots use `(-multiplier) * pivot`. The captured heading supplies a separate
rotation. Arithmetic preserves grouping, signed zero and finite underflow, and
checks intermediates before submission.

The accessory's opacity is `(spawn * (1 - death))` squared. Zero alpha still
submits its command. Paired rendering places it after eyes/pupils and before the
alpha-one reset and optional side images. Mouth rendering places it before the
three alpha-one face images. Body/death passes and antenna insertion remain
unchanged. Each accessory saves/restores its own transform and alpha scope;
its state cannot carry into the next snake or later food/prey.

One accessory charges one image command and one asset use, including aliases.
Quotas remain cumulative across ordered Setup plans and share the existing
body/food/prey/antenna source pool. Preflight precedes target clear/resize, and
model state commits only after complete submission. Canvas exceptions unwind
local scopes but can leave partial pixels or completed target-size changes.

The stock adapters retain their `ownAccessory=-1` admission requirement. Generic
ready-source support does not create the stock image's lazy download, select a
table entry, or supply a direct-image content commitment. Startup loading,
installed-host behavior, original artwork/pixels and gameplay acceptance remain
separate. Native arithmetic and synthetic Wasm recordings establish only their
documented inputs; see [verification](verification.md).
