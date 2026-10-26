# Opt-in borrowed standard-body renderer

`AnimatedScene.render_standard` prepares production body geometry, calls
`plan_standard_body`, then submits its ordered Canvas2D commands. The existing
`render` API keeps its stand-in artwork and uniform sampling style. This API
creates no artwork, loads no assets and starts no animation loop.

```js
// Caller-owned, already initialized DesktopQuality and trusted skin provider.
// providerSnapshot is a coherent revision + catalog of existing loaded sources.
scene.render_standard(
  target, food0, food1, food2, loadedBackground,
  request => provider.resolve(request, providerSnapshot),
  quality,
);
```

The callback is a synchronous **trusted host capability**, not a sandbox. It must
return a normalized schema-1 [skin-provider](skin-provider.md) snapshot directly;
promises, pending and unsupported results fail. It must not mutate the scene,
target, borrowed sources or quality during the call. Callback side effects cannot
be rolled back. No raw host mappings, stock tables, raw-ID lookups or fallback
recipes are installed in Rust.

For each visible retained drawn object, the callback receives a **new plain
object**:

```ts
{
  skin: number;                // exact original wire skin, 0..255
  customBytes: Uint8Array;     // new copy, at most 255 bytes
  cosmetic: number;           // original opaque wire marker, 0..255
  x: number; y: number;        // finite current corrected absolute head
  id: number;                 // wire ID, diagnostic only; may be duplicated
  drawOrdinal: number;        // includes preceding culled drawn objects
  own: boolean;               // retained original own identity, independent of ID reuse
}
```

Custom bytes and cosmetics belong to that exact appearance, including duplicate
IDs and death fade. An undrawn retained own object is not resolved. The cosmetic
marker is not translated into an attachment ID. The provider copies the skin,
custom bytes, cosmetic and head fields into its host request; an outer callback
can use the identity fields before calling the provider. Culled objects are not
resolved, while their draw ordinals remain intact.

The snapshot must contain explicit `bodyStyle`, per-base/run-palette `boostGlow`,
and exactly the three shared effects `outline`, `shadow`, `death-highlight` at
opacity one. Body variants, palette runs, custom first-variant selection,
cycle/ping-pong shading, rotation suppression, swell and head/tail fades use the
planner's existing semantics. Every normalized asset use must include the opt-in
`sourceMode`: `whole` becomes `BodyAssetUse.source_rect = None`, and `crop` becomes
`Some(rect)`, including an explicitly full-size crop. The renderer does not infer
whole-source semantics from a full rectangle.

Eyes must be explicit `none` or standard paired metadata that exactly matches
the geometry retained on that appearance. Standard eyes are parsed into typed
geometry using the same validator as the appearance-time API below. Numeric
geometry and opacity comparisons distinguish signed zero, without a tolerance.
The renderer never overwrites pupil travel or installs style at draw time.
The existing `none` lane omits eyes for nondecorated faces without changing retained
state. Optional `faceDecoration` must match the retained paired-side kind and all
nine geometry fields bit for bit, including signed zero; omission cannot discard
a required retained decoration. Its feature tag must agree with its metadata,
and it requires standard paired eyes. Attachments,
antennas, other special faces, singleton boost effects and unknown feature tags still
fail explicitly. Full-skin support is outside this renderer.

## Complete ordinary paired faces

`apply_frame_with_face_geometry(bytes, elapsedHeader, resolve)` adds owned
`PairedFaceGeometry` to the same native/Wasm packet transaction as the eye-only
API. The synchronous trusted callback receives the appearance request described
below and returns explicit normalized data:

```js
// Check the adapter's complete face coverage and unsupported requirements first.
const recipe = result.recipe; // validated partial provider recipe is sufficient
return {
  eyes: recipe.eyes,
  decoration: recipe.faceDecoration == null
    ? { kind: 'none' }
    : { kind: 'paired-side-images', geometry: recipe.faceDecoration.geometry },
};
```

Both eyes and decoration belong to the exact retained appearance, including
duplicate/dead/reused IDs. Resolution occurs once in wire order after complete
received validation, even for short, offscreen, immediately removed or later
setup-cleared appearances. Late errors roll back the complete model; callback
side effects remain external. The old packet and eye-only APIs install no
decoration and preserve their default geometry and lifecycle.

`render_standard` borrows the decoration image from its ready recipe using the
same per-frame source pool as body assets. For basic stand-in bodies, use
`render_with_face_decorations(target, palette0, palette1, palette2, background,
qualityScale, detailedStyle, resolveFace)`. Its trusted callback receives the
same visible retained-object request as `render_standard` and returns
`{ revision, eyes, decoration }`, with explicit null or the provider-normalized
`faceDecoration`. A ready face-only projection can come from a partial provider
recipe while unrelated body assets are pending. Its own source must be ready;
the outer provider status alone cannot establish this. Required unsupported
features and complete face coverage remain the projecting adapter's responsibility.
The old basic `render` rejects a visible decorated face before clearing.

Each renderer prepares once. Layouts use the captured face heading, corrected
double-precision head, scale, camera and zoom. Forward trig products multiply
distance then entity scale; lateral distance scales before adding its unscaled
bias. Negative side precedes positive side. Each image has identity screen
transform, one complete translation, separate unnormalized rotation and the same
local destination rectangle. Pivots and nominal dimensions are independent of
source dimensions. Whole-source and explicit crop overloads remain distinct.
Both images use one exact borrowed source at alpha 1, source-over, after both
eye/pupil pairs and before the next snake. Pupils, spawn/death opacity and body
quality do not modulate this lane. Whole-snake inclusive anchor visibility and
short-face policy remain unchanged; no image/head culling or extra clock exists.

All layouts, numeric coherence, shared catalog/source revisions, readiness,
target aliases and budgets validate before reset. Backing/intrinsic dimensions
and readiness are checked again after all callbacks. Per-image scopes unwind on
Canvas exceptions and the disposable model is discarded; partial target pixels
cannot be rolled back. No assets are loaded, copied or read back.

This completes the represented ordinary paired face for trusted ready sources.
Startup blank-source equivalence, actual antennas, mouth/single-eye families,
accessories, general host recipe mapping, original pixels and extension packaging
remain outside the capability boundary. Synthetic crop support is separate from
whole-source fidelity evidence. Existing browser and external comparison results
below predate this lane; they do not validate it.

## Appearance-time paired eyes

The additive `AnimatedScene.apply_frame_with_eye_geometry` API installs explicit
normalized `StandardEyes` metadata before the object's first pupil update:

```js
scene.apply_frame_with_eye_geometry(bytes, elapsedHeader, request => {
  const result = provider.resolve(request, providerSnapshot);
  return result.recipe.eyes;
});
```

This callback receives a new plain object per appearance, with exactly `skin`,
`id`, copied `customBytes: Uint8Array`, opaque `cosmetic`, and absolute initial
head `x`/`y`. Skin and ID retain their original wire values. There is no wire-ID
cache, visibility filter, draw ordinal or inferred attachment selection. The
callback runs once in wire order for every validated appearance, including
duplicates, short/culled bodies and appearances immediately removed or cleared
by a later setup in the same frame. Each retained object owns its numeric style
through death, own removal and wire-ID reuse.

Return the `StandardEyes` object directly and synchronously, rather than a
provider envelope or promise. Required own data fields are `kind: 'standard'`,
`distance`, `separation`, `radius`, `pupilRadius`, `pupilTravel`, `outlineWidth`,
`eyeColor`, `pupilColor`, `outlineColor`, `eyeOpacity`, `pupilOpacity`, and
`angleSmoothing`. Geometry must be finite in 0..4096, packed colors exact integers
in 0..16777215, and opacities in 0..1. Outline color must be black (0), and
`angleSmoothing` must be the effective global rate 0.12. Missing, inherited,
accessor, nonfinite, coerced and unsupported values fail; metadata getters are
not called. Extra fields are ignored. The validated numeric values are copied;
later mutation of returned metadata cannot change the appearance.

This explicit paired lane rejects `none` and special-face metadata. A host must
represent unsupported styles honestly instead of supplying default pupils when
the metadata omits them. The callback consumes no assets or readiness state:
`result.recipe.eyes` can be used even while body assets are pending, provided
the trusted host has determined that these are supported standard paired eyes.
Drawing the body still requires the renderer's ready, coherent snapshot.

The callback and realm are trusted synchronous capabilities. Do not reenter or
mutate the scene during resolution; proxies, patched builtins and arbitrary
callback side effects are outside the validation boundary. Complete framing and
received-state validation precede all callbacks. Later presentation validation
or callback failure rolls back received state, entities, styles and counters
together, but cannot undo caller side effects or earlier callback invocations.
Callback exceptions propagate unchanged. Packet application advances no clock.

The existing `apply_frame` installs default geometry for preview compatibility:
distance/separation/radius 6, pupil radius 3.5, travel 2.3, outline width 0,
white eyes, black pupils, eye opacity .75 and pupil opacity 1. Both the basic
`render` and `render_standard` consume retained geometry. Native callers can use
`AnimatedClient::apply_frame_with_eye_geometry` with a typed fallible resolver,
or `SnakePresentation::from_appearance_with_eye_geometry`; the native style
validator preserves its finite/nonnegative geometry and 0..1 opacity domain.

## Submission

Rendering borrows a copied applied quality snapshot (`high_quality`, blend and
scale) without advancing interpolation, statistics or a clock. The caller owns
quality cadence and actual draw counts. Each recipe's `detailedSegments` controls
both sampling and its writes to the shared ordinal flag history. Offscreen flags,
original ordinals, Float32 stores, the actual f64 cursor seed, and existing
spacing/camera/eye-target transitions are preserved.

All visible recipes, curves, eye layouts and body commands are prepared in one
disposable client clone before CanvasFrame resets the target. Source object
brands, actual backing/intrinsic dimensions, image readiness, source mode/rect,
catalog IDs and target aliases are checked. Aliased catalog entries retain the
same exact live source object and coherent revision; the same source at different
revisions within one frame fails. Native dimensions/readiness are checked again
after every callback has finished. Sources must use the Wasm host's canvas/image
realm. Revisions are explicit trusted content/readiness commitments; a same-size
host repaint cannot be detected by dimension checks.

Limits per recipe remain 256 palettes/runs/variants and catalog IDs 0..4095.
Frame totals are at most 262,144 active curve samples, 524,304 body image commands,
4096 referenced catalog entries (counted per recipe), 4096 distinct source objects
and 262,144 asset uses, shared with face assets. A separate fixed ceiling allows
1024 side-image commands (two per retained object, at most 512). The aggregate
body command budget is checked by the planner
before each complete plan allocation. No recipe, source, revision or command is
cached in AnimatedScene after the call; live source references last only through
submission. Hosts must keep sources ready and unchanged throughout that call.

Background, arena and food precede snakes. Each snake completes body effects,
death, both eye/pupil pairs and any paired side images before the next snake.
Body commands preserve separate center/local translations, stored tangent rotation, crop overload, destination
arithmetic, and source-over/lighter composition. Flattened commands first install
the planner's effective scoped alpha, then issue its original requested alpha;
Canvas ignores an invalid request rather than clamps it. Body root alpha is
restored before eyes. The end of every ordinary face unconditionally restores
root alpha 1, including nondecorated and eye-less faces, so the next body enters
at 1. Standalone `plan_standard_body` retains its caller-supplied entry-alpha API.
This corrects a static state-boundary discrepancy; it is not a claimed pixel
failure from an invalid outer-boost request, whose validated formula is bounded.

Short or coincident unsupported stored body geometry is omitted, while valid
eyes and later snakes still draw. No synthetic anchors are added. Invalid recipe
or numeric inputs reject the complete draw before reset. Canvas exceptions may
leave partial pixels but unwind the frame scope and preserve all model state;
only successful complete submission commits camera, spacing, flags and targets.

`node tools/body-render-smoke.mjs` runs the focused real-Wasm synthetic Canvas
recorder checks after building; `tools/wasm-smoke.mjs` includes them. These check
the ABI and modeled Canvas calls/state. They do not establish native browser
pixels, external-runtime production collection parity, performance, arbitrary
skins, extension realms or official-server acceptance.

Separate stock Windows Firefox 158.0.1 headless checks passed 247 native Canvas
assertions and 1,290 authored-page assertions. Nine matched checkpoints preserve
the earlier numeric/camera state and reproduce the new pixels on fresh reloads.
Body pixels intentionally change with the authored effects. These checks cover
the tested synthetic recipes and native submission, without an original-pixel or
external-runtime production parity claim. See [verification](verification.md).

A separate Node/Wasm comparison matched 25,121 ordered production body calls
across five frozen schedules, 114 operations and 71 draws: all 502,822 body-call
cells matched exactly. Rust received authored inputs and normalized live recipes,
without observed geometry, flags, cursor seeds or command outputs. Coverage is
standard skin zero, whole-source calls and frozen HQ/LQ states; arbitrary skins,
cropped-use parity and adaptive-quality evolution remain outside that result.

The `/animated` synthetic preview uses this API with three original flat-color
recipes and generated stand-in effects from `synthetic-body.mjs`. That resolver
supports only the authored appearances with empty custom data and no cosmetic;
it does not map arbitrary stock skins. Local simulator mode explicitly uses the
existing basic renderer, including after disconnection until synthetic reset.

The page advances `DesktopQuality` with the same owned animation step, before
statistics and before drawing. Its raw counter counts successful Canvas draws,
including those between readout refreshes. A consumed statistics interval resets
the counter before the current draw. Each active preview RAF supplies `playing:
true`; this is a preview policy, not a reconstruction of server game-over state.
Synthetic reset starts HQ; the connection-quality preference applies on socket
open. Resets preserve the quality statistics clock and current draw count. Both
Wasm owners and each temporary step are freed on their lifecycle boundaries.
