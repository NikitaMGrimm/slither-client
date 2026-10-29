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

## Explicit ready stock source binding

An external complete source bundle may create `createStockSkinAdapter` with
`appearanceMode: 'accessory'` and supply this snapshot data alongside its existing
host and readiness records. The controller must select the same mode before
ingress. This is explicitly supplied metadata, not automatic stock chooser
behavior. All values below are authored synthetic examples:

```js
ownAccessory: 71,
ownAccessorySelection: {
  id: 71,
  geometry: { forward: 5, imageScale: 0.25, pivotX: 3, pivotY: 7 },
  source: callerOwnedReadyImageOrCanvas,
  width: 20,
  height: 12,
},
readiness: [
  // In addition to the existing body/face/entity commitments:
  { source: callerOwnedReadyImageOrCanvas, state: 'ready', revision: 'selected-content-1' },
],
```

The selection record has exactly the five shown own data fields, and geometry
has exactly its four own numeric fields. The ID is an explicit integer in
0..65535 and must equal `ownAccessory`; it has no built-in catalog semantics.
Geometry uses the native bounds above. Width and height are positive integer
cached extents at most 65535, equal to the full native canvas/natural image
extent. Native prototype getters establish image completeness and dimensions.
The exact source must have its own ready content revision in `readiness`;
capture-wide revisions cannot substitute for it. Same-size pixel changes are
the caller's responsibility and require a truthful new source content token
and a new capture revision.

`ownAccessory: -1` with an absent or null selection keeps the legacy no-selection
contract. An active selection with `-1` rejects. Default `'face'` mode rejects a
selected ready record. In accessory mode appearances always include `accessory`,
null unless `request.own === true`. The generic recipe projection preserves an
optional own boolean; absent old callers keep their old projected shape.
Only the retained native own context selects numeric geometry and the tagged
attachment. Wire cosmetic, skin, attachment ID, wire-ID reuse and callback order
never select it. Rust continues to own death retention, placement, ordering,
alpha and crop submission. Paired and Mouth are supported; selected SingleImage
rejects. Accepted custom overrides determine face eligibility first.

Both skin and entity source adapters use the same selected-source admission.
Missing record/source/commitment, incomplete native image, zero cached/native
extent or pending commitment rejects with `status: 'pending'` before numeric
appearance metadata or entity entropy. Malformed/extra/inherited/accessor
selection fields, ID mismatch, invalid geometry, extent mismatch and unsupported
source reject with `status: 'unsupported'`. Neither path silently becomes null.
The admitted ID, source identity, extent and geometry stay fixed for the adapter,
including signed zero; changing them requires a new adapter/session. Operations
copy selection metadata. Failed capture leaves no active operation; callers must
still end held operations after resolver failures. Reentry guards release on error.
Source content revisions may advance under the existing capture rules. Entity
factories also recheck the complete commitment after their random callbacks.

The recipe borrows the selected source through the existing shared catalog and
normalizer, with `[+0, +0, width, height]` and the ten-field attachment above.
Full-image extent remains explicit crop mode. No catalog, image creation,
downloader, lazy-loading transition, fallback or chooser is provided. The caller
supplies the full forward distance for every face family. The cached-entry path
below instead uses a pure Rust appearance-forward projection; neither binding
introduces a JavaScript formula or numeric table.

## Already-ready live cached entry

Live capture can borrow one already-loaded selected entry from `a_imgs`, bounded
by its captured `a_ct`. Rust admits the persisted `cosmetic` string: absent or
`-1` selects none, otherwise a canonical unsigned decimal ID must be inside the
captured table (at most 4096 entries). The wire cosmetic is never consulted.
Missing entry/image or `loaded: false` stays pending; malformed metadata rejects.
No image, URL request, catalog copy or lazy load is created.

The entry supplies its existing `img`, cached `ww/hh`, `sc` and `px/py`. Native
image completeness and intrinsic dimensions must agree with the cached extents.
The additive snapshot field `ownCachedAccessorySelection` has the same closed
five-field shape as the explicit selection above, except its closed geometry is
`{imageScale,pivotX,pivotY}`. The selected entry, ID, source, extents and those
three fields stay fixed for the session; replacement requires a fresh session.
The existing complete-geometry `ownAccessorySelection` API is unchanged. Supplying
both forms rejects; cached metadata never invents a placeholder forward value.

For the cached form only, `resolveAccessoryForward` binds the pure Rust
`stock_accessory_forward` projection to the skin adapter. Both appearance and
recipe use the same skin/custom input. Paired faces reuse their admitted eye
forward distance, Mouth uses the ordinary default head-forward distance, and a
selected SingleImage rejects. Accepted custom runs suppress special features
first. Native appearance retention owns the resulting forward through death,
Setup and wire-ID reuse. Session-fixed entry metadata is not relaxed by this
per-appearance projection. Adapter and controller both select accessory mode
before ingress; no-selection defaults retain face mode.

The optional document-start `accessorySource` capability captures native image
getters, decode, promise/listener methods and timers. One selected image receives
listeners before one decode; capture stays pending until decode succeeds within
5000 ms with unchanged private source/load fingerprint and ready dimensions.
Only then does the source receive its own **trusted load commitment** revision.
Rejection, deadline, load/error event or observed fingerprint/extent/completeness
drift permanently invalidates the lease for that session. Normal capture and
operation completion recheck it. Disposal removes listeners/timers; late decode
settlement is inert. URLs are neither returned nor logged, and no pixels are read.

This commitment trusts the pinned host's load-once use of the already-loaded
image. It is not proof of arbitrary image immutability: **same-URL reassignment
can evade checks before its load/error event**. Decode proves neither immutable
pixels nor pre-event mutation protection. No source/attribute setter fencing is
provided. Startup loading, installed-host behavior, original artwork/pixels and
gameplay acceptance remain separate. Synthetic native/Wasm and inert gate tests
establish only their documented inputs; see [verification](verification.md).
