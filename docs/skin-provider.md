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
};
type CatalogEntry = {
  source: HTMLCanvasElement | HTMLImageElement | null;
  state: Status;
};
type AssetUse = { asset: number; sourceRect?: [number, number, number, number] };
type StandardEyes = {
  kind: 'standard';
  distance: number; separation: number; radius: number; pupilRadius: number;
  pupilTravel: number; outlineWidth: number; // each 0..4096
  eyeColor: number; pupilColor: number; outlineColor: number; // packed RGB integers
  eyeOpacity: number; pupilOpacity: number; angleSmoothing: number; // 0..1
};
type EffectKind = 'boost-glow' | 'outline' | 'shadow' | 'death-highlight';
type HostRecipe = { status: 'pending' | 'unsupported' } | {
  status: 'ready';
  basePalette: number;         // local index into palettes, distinct from requested skin
  custom: boolean;             // whether the host accepted custom data
  runs: { palette: number; count: number }[]; // ordered; local palette indices
  palettes: { variants: AssetUse[] }[];
  variantMode: 'first' | 'cycle' | 'ping-pong';
  variantPeriod: number;       // family period supplied from resolved base palette
  eyes: StandardEyes | { kind: 'none' };
  effects: (AssetUse & { kind: EffectKind; opacity: number })[];
  attachment?: AssetUse & {
    anchor: 'head'; scale: number; pivotX: number; pivotY: number; opacity: number;
  } | null;
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

The result is `{ schema: 1, revision, status, recipe }`. A non-ready host recipe
returns `recipe: null`. Otherwise metadata arrays and records are copied and
frozen, and each asset use becomes:

```ts
{
  asset: {
    id: number; source: HTMLCanvasElement | HTMLImageElement | null;
    kind: 'canvas' | 'image' | null; width: number; height: number; status: Status;
  };
  sourceRect: readonly [number, number, number, number] | null;
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

`supportedFeatures` is generated from represented body, standard eye, effect,
and attachment metadata. `unsupportedFeatures` contains opaque lowercase tags
matching `[a-z][a-z0-9-]{0,63}`. The adapter must list any required feature it
cannot represent (for example special eyes, antenna dynamics, or detailed body
sampling), rather than silently substitute standard eyes. Any unsupported tag
or referenced unsupported asset makes the overall result unsupported; otherwise
any pending asset makes it pending. The validated partial recipe remains
available in either case. Supported tags describe schema coverage, not readiness
or implemented renderer behavior. There is no special renderer in this module.

Normal tests use only original synthetic metadata and realm doubles. Private
runtime probes, if performed, remain outside this checkout and establish neither
real DOM/image readiness, pixel equality, extension integration, nor server
acceptance.
