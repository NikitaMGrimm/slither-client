# Complete three-image mouth faces

The existing generalized face APIs accept an exclusive `mouth-face` family.
It replaces ordinary eyes with two ordered eye marks and a mouth image, using
ready caller-owned canvas/image sources. It adds no artwork, loader, animation
loop or renderer API.

Install numeric metadata before the first pupil update:

```js
scene.apply_frame_with_face_presentation(bytes, elapsedHeader, request => ({
  face: { kind: 'mouth-face', geometry: { pupilTravel: 2.3 } },
  antenna: null,
}));
```

Travel must be finite in 0..4096. Negative zero is retained and compared bit for
bit against draw metadata. The native equivalent is
`FaceGeometry::Mouth(MouthFaceGeometry { pupil_travel })`. No default mouth
geometry, arbitrary image offset or face-alpha parameter is supplied.

Each appearance owns its family and gaze through death, duplicate IDs, reuse
and Setup. Reset clears appearances. The existing fractional pupil updates and
captured-heading timeline apply; rendering adds no update, random input or
sampling step. Face selection leaves prior body commands and cursor state intact.

The trusted skin provider requires this complete source metadata:

```js
eyes: {
  kind: 'mouth-face',
  geometry: { pupilTravel: 2.3 },
  eyeMarks: { asset: markCatalogIndex, sourceMode: 'whole' },
  mouth: { asset: mouthCatalogIndex, sourceMode: 'whole' },
}
```

Both uses are mandatory own-data metadata. Input mode must be exactly `whole`;
any own `sourceRect`, including undefined, fails. A full-size crop cannot replace
the whole-source overload. The provider freezes copied metadata, keeps exact
borrowed identity and emits the exclusive `mouth-face` feature. Non-null paired
decoration fails. Existing unsupported-status precedence remains.

Standard rendering consumes the complete ready provider result through
`render_standard_with_face_presentation` and existing at-size and ordered factory
variants. The basic renderer takes `{ revision, face: { kind: 'mouth-face', eyes:
result.recipe.eyes }, antenna: null }`. Both face sources must be ready even if
unrelated body assets are pending. A result with `recipe: null` supplies no face.
Geometry, features, revisions, native dimensions/readiness and aliases are checked
before target reset. Paired-only APIs reject a required mouth family.

Submission paints the negative-side mark, positive-side mark using the same exact
source, then the mouth. Each has a separate save, screen translation, captured
heading rotation, whole-source draw and restore. Destination sizes do not depend
on source dimensions. Gaze stays in world axes; the mouth has an asymmetric
horizontal pivot. Layout preserves arithmetic grouping and validates intermediates.

The shared submitter establishes identity, source-over and alpha one. All three
images remain at alpha one during spawn and death, independently of body opacity
or ordinary-eye fading. Common completion restores root alpha one before the next
body. Existing visibility and death expiry determine whether a face is drawn.

Three commands borrow two sources and consume shared operation budgets, including
ordered Setup draws. Canvas failures may leave partial pixels; scopes unwind and
model state commits only after complete submission.

The stock adapter requires generated eye-mark and completed mouth-paint
commitments. Dimensions alone do not establish readiness. Clear/reset, failed
painting and dimension assignment invalidate commitments; same-size repaint
changes content revision. Host-mode and static-accessory restrictions remain.
Sources are borrowed without copying artwork or invoking original generators.

Native tests and synthetic real-Wasm recordings cover their documented inputs.
They do not establish original artwork, startup-loading equivalence, installed
host compatibility or official-server acceptance. See [verification](verification.md).
