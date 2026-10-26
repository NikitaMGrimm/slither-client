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

Eyes must be explicit `none` or exactly the existing vanilla-compatible lane:
distance/separation/radius 6, pupil radius 3.5, pupil travel 2.3, outline width 0,
white eyes, black pupils/outline, eye opacity .75, pupil opacity 1, smoothing .12.
These fields are eligibility checks; arbitrary provider eye parameters are not
coupled to the retained eye state. Different geometry/style, attachments,
antennas, special faces, singleton boost effects and unknown feature tags fail
explicitly. Full-skin support is outside this renderer.

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
and 262,144 asset uses. The aggregate command budget is checked by the planner
before each complete plan allocation. No recipe, source, revision or command is
cached in AnimatedScene after the call; live source references last only through
submission. Hosts must keep sources ready and unchanged throughout that call.

Background, arena and food precede snakes. Each snake completes body effects,
death and both eye/pupil pairs before the next snake. Commands preserve separate
center/local translations, stored tangent rotation, crop overload, destination
arithmetic, and source-over/lighter composition. Flattened commands first install
the planner's effective scoped alpha, then issue its original requested alpha;
Canvas ignores an invalid request rather than clamps it. Body root alpha is
restored before eyes, whose last pupil alpha supplies the next body's entry
alpha. Eye-less bodies leave their root alpha for the next snake.

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
