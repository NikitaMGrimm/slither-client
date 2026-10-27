# Single image eyes

The additive face-presentation APIs select an appearance-owned face family.
Ordinary paired faces retain their existing behavior. A `single-image` face uses
one borrowed base image followed by one borrowed pupil image, sharing the existing
face-heading and world-axis gaze timeline. It adds no clock or randomness.

## Geometry and submission

Appearance metadata supplies `baseSize`, `pupilSize` and `pupilTravel`. Sizes must
be positive and at most 4096; travel is in 0..=4096. All values must be finite.
Draw-time metadata must match the retained geometry bit for bit, including signed
zero. Source dimensions and crop sizes are independent of destination sizes.

Both images use identity screen coordinates, with no image rotation. Their forward
offset is based on the captured face heading and entity scale. The pupil adds an
unscaled forward bias and the retained world-axis pupil displacement. Centering
occurs before camera subtraction and zoom, preserving arithmetic order.

The base sets alpha to one while alive or the square root of remaining death
progress while dying; the pupil inherits that value. Spawn, boost and direct
HQ/LQ gates do not multiply it. Both images remain in the command stream even
at very small alpha. Face completion restores root alpha to one before the next
snake. Body and antenna death-pass cursors are unchanged.

The standard order is body prefix, antenna, death suffix, selected face, then the
next snake. Early food/prey and late food/prey/arena ordering is preserved.
The basic lane uses its existing stand-in body with the same selected face.

## Metadata and APIs

The generalized appearance callback returns own-data metadata:

```js
{ face: { kind: 'single-image', geometry: {
    baseSize: 20, pupilSize: 8, pupilTravel: 3,
  } }, antenna: null }
```

The paired alternative uses `kind: 'paired'` with the existing `eyes` and
`decoration` fields. Existing paired appearance APIs remain adapters.

The trusted skin provider accepts an image-eye branch:

```js
eyes: {
  kind: 'single-image',
  geometry: { baseSize: 20, pupilSize: 8, pupilTravel: 3 },
  baseImage: { asset: 0, sourceRect: [0, 0, 40, 36] },
  pupilImage: { asset: 1 },
}
```

These values are authored examples, not stock recipes. The provider copies and
freezes metadata, borrows exact existing sources and emits `single-image-eye`.
Both uses carry explicit normalized source rectangles, including when the caller
omits a crop. Submission always uses the rectangle image overload. Paired side
decorations cannot be combined with this family.

Use `apply_frame_with_face_presentation` and its factory variants to retain the
selected family before updates. Use `render_with_face_presentation` or
`render_standard_with_face_presentation`, including their `_at_size` forms, for
draws. The corresponding target-aware apply-and-render APIs preserve ordered
Setup draws. The explicit random callback is shared with antenna support; an
image-eye-only scene consumes no random units.

Once generalized mode is enabled, later appearances require its resolver. Reset
clears appearance objects and retains the mode/timeline. Legacy render APIs reject
visible required image eyes before reset rather than substituting paired eyes.
Native paired-only geometry getters now return `Option`; tagged geometry is
available through `active_face_geometry`. Existing Wasm snapshot shapes remain
unchanged.

## Ownership and limits

Geometry follows stable appearance tokens through duplicate IDs and death fade.
Sources belong only to the complete draw/ingress operation, including earlier
Setup plans whose appearance is later removed. Both images debit shared source
and image budgets. Numeric validation, readiness, revision coherence, target
alias checks and native preflight precede target reset.

A late Canvas failure restores scopes and discards staged model/source changes;
callback effects and already-painted pixels remain external. Ready-only borrowing
does not establish original pending-source timing. This capability does not add
stock skin selection, mouth overlays, team drawing, static accessories or mobile
behavior. Synthetic native/Wasm checks, browser observations and original-runtime
comparison remain separate evidence categories.
