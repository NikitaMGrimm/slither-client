# Trusted skin provider

`web/skin-provider.mjs` is an optional synchronous metadata boundary, separate
from the existing asset bridge and renderer. It contains no host member mapping,
stock recipes, artwork, or asset loading. A caller supplies **trusted** callbacks,
DOM constructors from the trusted page realm, and a bounded asset catalog.
It is not a sandbox for callbacks, proxies, getters, patched builtins, or an
arbitrary page. The caller is responsible for authorization and host compatibility.

```ts
type Status = 'ready' | 'pending' | 'unsupported';
type Revision = string | number;
type Request = {
  skin: number;                // exact integer 0..255, no coercion
  customBytes?: Uint8Array;    // provider-realm Uint8Array, at most 255 bytes
  x?: number; y?: number;      // finite, optional factory initialization positions
  attachmentId?: number;      // exact integer 0..65535; adapter interprets selection
  cosmetic?: number;          // exact opaque wire marker 0..255; no ID mapping
  own?: boolean;              // explicit retained-own context, never inferred
};
type CatalogEntry = {
  source: HTMLCanvasElement | HTMLImageElement | null;
  state: Status;
};
type AssetUse = {
  asset: number; sourceRect?: [number, number, number, number];
  sourceMode?: 'whole' | 'crop';
};

type StaticHeadAttachment = {
  kind: 'static-head-image'; asset: number;
  sourceMode: 'crop'; sourceRect: [0, 0, number, number];
  anchor: 'head'; forward: number; scale: number;
  pivotX: number; pivotY: number; opacity: 1;
};

type SingleImageEyes = {
  kind: 'single-image';
  geometry: { baseSize: number; pupilSize: number; pupilTravel: number };
  baseImage: AssetUse; pupilImage: AssetUse;
};

type MouthFace = {
  kind: 'mouth-face';
  geometry: { pupilTravel: number }; // finite 0..4096, signed zero retained
  eyeMarks: { asset: number; sourceMode: 'whole' };
  mouth: { asset: number; sourceMode: 'whole' };
};
type PairedSideGeometry = {
  forward: number; lateral: number; lateralBias: number; // finite 0..4096
  rotationOffset: number; // finite 0..pi
  imageScale: number; // finite 0 < value <= 256
  pivotX: number; pivotY: number; // finite -65535..65535
  width: number; height: number; // finite 0 < value <= 65535
};
type StandardEyes = {
  kind: 'standard';
  distance: number; separation: number; radius: number; pupilRadius: number;
  pupilTravel: number; outlineWidth: number; // each 0..4096
  eyeColor: number; pupilColor: number; outlineColor: number; // packed RGB integers
  eyeOpacity: number; pupilOpacity: number; angleSmoothing: number; // 0..1
};
type EffectKind = 'boost-glow' | 'outline' | 'shadow' | 'death-highlight';
type BodyFade = { palette: number; length: number }; // local palette; finite 0 < length <= 65535
type BodyStyle = {
  detailedSegments: boolean;
  swell: number;               // finite -4096..4096, including signed values
  rotateSegments: boolean;
  headFade: BodyFade | null;
  tailFade: BodyFade | null;
};
type HostRecipe = { status: 'pending' | 'unsupported' } | {
  status: 'ready';
  basePalette: number;         // local index into palettes, distinct from requested skin
  custom: boolean;             // whether the host accepted custom data
  runs: { palette: number; count: number }[]; // ordered; local palette indices
  palettes: { variants: AssetUse[]; boostGlow?: AssetUse }[];
  variantMode: 'first' | 'cycle' | 'ping-pong';
  variantPeriod: number;       // family period supplied from resolved base palette
  eyes: StandardEyes | SingleImageEyes | MouthFace | { kind: 'none' };
  effects: (AssetUse & { kind: EffectKind; opacity: number })[];
  bodyStyle?: BodyStyle | null;
  faceDecoration?: {
    kind: 'paired-side-images'; geometry: PairedSideGeometry; image: AssetUse;
  } | null;
  attachment?: (AssetUse & {
    anchor: 'head'; scale: number; pivotX: number; pivotY: number; opacity: number;
  }) | StaticHeadAttachment | null;
  unsupportedFeatures: string[];
};

const provider = createSkinProvider({
  trusted: true,
  realm, // own HTMLCanvasElement and HTMLImageElement constructor values
  resolveHostRecipe(request: Readonly<Request>): unknown { /* trusted capability */ },
  normalizeHostRecipe(raw: unknown, request: Readonly<Request>): HostRecipe {
    /* original host adapter; no raw host recipe is retained by the provider */
  },
});
const result = provider.resolve(request, { revision, assetCatalog });
```

The two callbacks are synchronous and invoked once, in order. The resolver may
call an authorized existing metadata factory on a fresh target; the normalizer
maps its result to this schema. That adapter remains caller-owned. Validation
does not make arbitrary callback execution safe. Invalid request fields,
revision, or catalog shape/state fail before either callback. `customBytes` is
copied before callbacks; the request wrapper is frozen, but its copied byte
array remains writable for host compatibility. Neither caller bytes nor the raw
host result appear in the output. Unknown record fields are ignored; whitelisted
metadata fields must be own data properties. Exceptions propagate without a
partial result or retained provider state. Callback side effects cannot be
rolled back by this contract.

Each resolve requires a fresh explicit snapshot. Revision is a nonempty string
of at most 128 characters or a nonnegative safe integer. **The adapter must
change it for readiness, pixel/content, dimensions, policy, or object replacement
changes**, even when asset identity remains equal. It must supply a coherent
snapshot for the duration of a call. The provider has no global cache, observer,
automatic refresh, or monotonic-revision inference. Re-resolve and invalidate a
retained display when the caller observes a new revision. Old results retain
their old numeric snapshot and exact live source references; later host repaint
can still change what those references draw.

An asset-catalog entry may also supply its own `revision` in the same scalar
domain. This content revision is copied to every use of that asset. It must
change when that source's content, readiness or dimensions change, and remain
stable across unrelated catalog changes. The enclosing revision still describes
the complete capture. Body and face submission use the asset revision when
present; legacy entries continue to use the enclosing revision. When a source
is also retained by food or prey, all uses must supply its exact same content
revision and dimensions.

The result is `{ schema: 1, revision, status, recipe }`. A non-ready host recipe
returns `recipe: null`. Otherwise metadata arrays and records are copied and
frozen, and each asset use becomes:

```ts
{
  asset: {
    id: number; source: HTMLCanvasElement | HTMLImageElement | null;
    kind: 'canvas' | 'image' | null; width: number; height: number; status: Status;
    revision?: string | number; // explicit source content revision, when supplied
  };
  sourceRect: readonly [number, number, number, number] | null;
  sourceMode?: 'whole' | 'crop'; // bodyStyle uses and explicit face-image uses
}
```

Asset wrappers are shared by catalog index within one result. `source` is the
exact borrowed object; it is never frozen, copied, loaded, painted, or retained
in a global cache. Canvas readiness requires explicit catalog `state: 'ready'`
and positive actual dimensions. A sized blank canvas with `state: 'pending'`
stays pending. An existing image uses `complete` and positive `naturalWidth` /
`naturalHeight` for native readiness; `unsupported` remains unsupported. A null
source stays pending unless explicitly unsupported, including a cosmetic whose
host image does not yet exist. No image is created to resolve it. Only fixed DOM
scalar properties are read, using the supplied constructor prototype getters
when the scalar is not an own data property; intermediate getters are bypassed.

Source rectangles use backing-canvas dimensions or intrinsic image dimensions,
never CSS/UI size. Rectangles have nonnegative x/y and positive width/height,
each at most 65535. They must fit actual nonzero dimensions, even for a pending
source. When dimensions are unavailable, the output rectangle is null; resolving
again validates the supplied rectangle against the now-available dimensions.
Absent rectangles cover the whole available source. Dimensions are exact
integers 0..65535. No URLs or pixels are inspected.

Bounds are 4096 catalog entries, 256 palettes, 256 variants per palette, 256
runs, 65535 total run count, and 256 unsupported tags. Every run count is positive.
Palette indices and asset indices must exist. Base and run palettes must have
at least `variantPeriod` variants (1..256). `cycle` and `ping-pong` describe
selection; the provider does not choose a frame. Accepted custom recipes require
`first` mode. Runs and variant order are preserved without expansion. Effects
are optional via an empty list; at most one of each standard kind is allowed,
with opacity 0..1. Head attachment scale is positive and at most 256, pivots are
within -65535..65535, and opacity is 0..1. Placement coordinates are in the
adapter's declared head-local units; this module performs no placement or drawing.

An explicit `static-head-image` attachment instead requires exactly the ten own
data fields in `StaticHeadAttachment`. Its forward distance is finite in
0..4096, opacity is exactly 1, and it requires standard paired or Mouth faces.
The crop origin must be positive zero and explicit crop mode remains present
without a body style. Full-size crops stay crops. Signed-zero forward/pivots
are retained for appearance/draw coherence. See the
[additive accessory renderer](static-accessory.md); provider readiness alone
does not enable a legacy draw path. Untagged attachments keep the normalization
described above.

Schema version 1 also accepts optional per-palette `boostGlow` uses and explicit
`bodyStyle` metadata. A supplied glow follows the same asset borrowing, native
readiness, source-rectangle validation, wrapper sharing, and revision rules as
variants and effects. It has no extra opacity multiplier. An absent glow is
omitted from that output palette; a supplied glow must be an `AssetUse`, not null.

When `bodyStyle` is absent or null, the output omits `bodyStyle` and preserves
the existing feature tags and behavior. Supplied per-palette glows still appear
in the palette output and contribute their asset readiness, without adding a
feature tag. Older singleton `boost-glow` effects remain valid, including their
existing opacity range, but cannot substitute for per-palette glows.

A present `bodyStyle` adds `sourceMode` to every output asset use (variants,
glows, effects and attachments): `whole` when the input omitted `sourceRect`,
`crop` when it supplied one. An explicitly full rectangle remains `crop`, even
though its numeric rectangle equals the normalized full rectangle of `whole`.
Pending assets retain that mode while their normalized rectangle is null. The
legacy uses without a body style retain their exact shape and omit `sourceMode`.
The opt-in [standard-body renderer](standard-body-renderer.md) consumes this
distinction as native `None` versus `Some(source_rect)`.

Optional `faceDecoration` represents the fixed paired side-image family, following
standard paired eyes. It requires `eyes.kind: 'standard'`; other face families
remain unsupported. Its geometry and wrapper are copied and frozen, and its
single image shares the same borrower, readiness and revision rules as body
assets. Both emitted side draws use that exact source object. The image always
has explicit `sourceMode`, including when `bodyStyle` is absent. Absence/null
omits both the output field and the `paired-side-images` feature tag, preserving
the exact legacy shape. No skin number or cosmetic marker enables it implicitly.

All nine geometry scalars are required own data numbers. Nonnegative and signed
domains preserve negative zero; strictly positive fields reject both zeros.
These are validation bounds, not stock parameters. A pending image keeps a
validated partial recipe; unsupported tags/assets still dominate pending. Hosts
may project the numeric face before unrelated artwork is ready, but must first
check required unsupported tags and complete face-family coverage. A host-status
result with `recipe: null` has no installable face geometry. A trusted direct
callback must not hide an unrepresented mouth, single eye, antenna or accessory.

The renderer's readiness policy requires the side source to be ready before
target reset. A sized pending canvas remains pending. This deliberately excludes
startup blank-source draw equivalence. Same-size repaints require a new coherent
revision; no pixel reads, URL loading or observers are added.

A present style requires all five own data fields; no values are inferred or
coerced. `detailedSegments` and `rotateSegments` are exact booleans. `swell` is
finite within -4096..4096 and retains its sign, including negative zero. Each
fade is explicitly null or a record with an existing local palette index and a
finite positive length at most 65535; fractional lengths are allowed. The swell
bound uses the existing geometry-scalar envelope, extended symmetrically; the
fade bound uses the total-run-count envelope. These are validation limits, not
stock recipe rules. Every palette already requires at least one variant, so a
fade always has variant zero. A palette used only for a fade need not satisfy
the base family's longer variant period or provide a glow.

Advertising a style also requires a per-palette glow for the base palette and
every run palette, plus shared `outline`, `shadow`, and `death-highlight` effects
with opacity exactly 1. Missing required metadata or a different shared-effect
opacity throws, consistently with other invalid recipe metadata. A required
asset whose catalog source is null or not loaded instead stays pending under
the existing rules; unsupported assets still take precedence. No additional
effect opacity is applied by this metadata boundary. The output includes a
copied, frozen `bodyStyle` (with copied, frozen fade records) and the precise
`standard-body-style` feature tag. Base-family variant mode/period and ordered
runs remain independent and unchanged. This tag describes metadata sufficient
for the standard body scope; it does not claim renderer integration, arbitrary
skin support, or an implemented drawing pass.

`supportedFeatures` is generated from represented body, standard eye, effect,
and attachment metadata. `unsupportedFeatures` contains opaque lowercase tags
matching `[a-z][a-z0-9-]{0,63}`. The adapter must list any required feature it
cannot represent (for example special eyes or antenna dynamics), rather than
silently substitute standard eyes. Any unsupported tag
or referenced unsupported asset makes the overall result unsupported; otherwise
any pending asset makes it pending. The validated partial recipe remains
available in either case. Supported tags describe schema coverage, not readiness
or implemented renderer behavior. There is no special renderer in this module.

The additive [appearance-time paired-eye API](standard-body-renderer.md#appearance-time-paired-eyes)
can consume `result.recipe.eyes` directly, even while body assets are pending.
It requires explicit `standard` metadata, black outline color and effective
global `angleSmoothing: 0.12`; provider schema coverage alone does not establish
renderer support. The caller must check unsupported features rather than turn
special faces or omitted pupils into standard eyes. No asset readiness, source
reference or provider envelope is retained by that API. `render_standard` still
requires a ready full snapshot whose paired-eye geometry matches the appearance.

Normal tests use only original synthetic metadata and realm doubles. Private
runtime probes, if performed, remain outside this checkout and establish neither
real DOM/image readiness, pixel equality, extension integration, nor server
acceptance.
