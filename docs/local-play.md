# Local Play

The local page runs the default bootstrap with Play controls, score readouts and
leaderboard rows. It uses the same Rust/Wasm scene, controller, gameplay and
session as game-page integration. Browser glue binds Rust-planned procedural materials
and a selected loopback endpoint; it does not load official artwork or acquire
a remote profile. Simulation remains in the separate
[slither-sim repository](https://github.com/NikitaMGrimm/slither-sim).

## Run

Use the pinned client tools in [verification](verification.md) and a current
simulator build that supports the challenge handshake. Build the client:

```sh
npm run build:web
```

In a separate terminal, start the simulator:

```sh
slither-sim host --bind 127.0.0.1:8766
```

Then serve this checkout:

```sh
npm run scene -- --simulator-port 8766
```

Open `http://127.0.0.1:18884/`, enter a nickname and click **Play**. The page fills
in `ws://127.0.0.1:8766/slither` and accepts only that configured endpoint. Opening
the page constructs no game socket. Play supplies authored zero credentials to
the existing challenge/login/setup session; no direct-login bypass is used.

Each appearance supplies its selected standard palette's base channels
and three `random()` units as nickname tint inputs, so name colors vary per
appearance. These draws share the page random stream with food, prey and antennas.

Move the pointer to steer. Outside text fields, Space/ArrowUp or mouse press
requests boost; ArrowLeft/ArrowRight use the existing keyboard turn path. Editing
fields retains native editing behavior. After a normal session disconnect, Play
becomes available again; only the next explicit click replaces the disconnected
local session. There is no automatic reconnect or retry. Terminal failures are
not a restart promise. Remote profile acquisition remains one-shot under
[its existing policy](provenance.md#explicit-play-profile-acquisition), and
official-server checks retain [manual authorization and ledger requirements](verification.md#manual-live-check-boundary).

## Diagnostics and evidence

### Private comparison artwork

An external local comparison harness can call
`createLocalGameHost({ endpoint, sourceFactory })`. The single asset map awaits
`sourceFactory({ realm, random })` and uses its complete existing source bundle:
`{ palettes, background, backgroundImage?, adapter, hostAssets }`. `palettes`
contains the three context sources; the adapter's recipe catalog can contain
the full palette families. A loaded backdrop retains its full natural width
and height when scaled to the viewport. The supplied adapter owns its source
operations and skin selection. The default local Rust skin-policy binding remains available
for ordinary startup but does not select the private adapter's sources.

With no factory, the authored local assets and resolvers remain the default.
A supplied factory must succeed; failure does not fall back to authored artwork.
This hook does not load a pack, select a URL or change the simulator endpoint.
Keep the factory, original image pack and all original-containing comparison
evidence outside this checkout and public artifacts, following
[the source boundary](provenance.md#tracked-material). Compare rendering using
the same image pack on both sides; assess replacement artwork separately.

The default page displays the server's received minimap in a separate bottom-right
widget, with the own-position marker and a server label when supplied. Rust owns
its decoding, pixels, transitions and placement; the DOM only displays the plan.
It uses the existing update/UI timers and does not affect world draw counts.

`/anchors` retains the received-only preview; `/animated` retains the synthetic
animated diagnostic. Both also work without `--simulator-port`; `/` requires a
configured simulator endpoint. These previews have their own diagnostic
transport and do not substitute for the default game path.

The candidate default source plan contains 42 separate standard body palette
families. Built-in run counts, palette IDs and cycle seams are preserved without
modulo-three color collapse. Ordinary bodies use seven 48-by-48 shaded sources;
the represented cycle family has sixty. Body plans include numeric rim/tone
materials and geometric star marks, 62-pixel boost sources, a 52-pixel outline
ring, a 62-pixel shadow and the 32-pixel death highlight. These procedural
sources are authored from retained numeric interoperability facts; no original
program, image pack or downloaded artwork is shipped.

Food uses ten families with seventeen body/outline/glow sizes; prey uses nine
selectable families with twenty-two body sizes and the seventeen glow sizes.
Native Canvas binds Rust-owned RGBA samples, source shadows and radial-gradient
operands. The existing renderer, source leases, clocks, random callback order
and sourceFactory bypass are unchanged. The branded tile/backdrop and three
legacy context canvases are deliberately kept separate from the full body bank.

Saved built-in IDs 0 through 65 still use the same chooser, preview and explicit
Play paths. Custom admission and versioned storage are unchanged; the local
custom editor still offers indices 0, 1 and 2. These now reference their standard
palette colors, rather than the previous pastel substitutes. Admitted external
custom runs retain their full normal palette IDs and first-variant shading;
invalid custom data retains the requested built-in. Four ordinary paired-eye
variants remain supported, but image faces, antenna artwork, accessories and
local dense/swell geometry remain incomplete. The three legacy context canvases
are not evidence of a three-color gameplay fallback.

This source correction does not establish player-visible equivalence. The
reported player run has no screenshot, so no camera or geometry diagnosis is
inferred. Focused inert tests cover the actual default bootstrap, copied source
plan, host adapter and palette bindings using labelled numeric/native doubles.
Native/actual-Wasm assertions and matching builds are separate gates. Native
antialiasing and shadow rasterization require the matched visual check; the
source plan does not assert universal pixel identity. Food outlines use a native
circle instead of a 600-edge approximation of the same disk.

For the serialized comparison, keep packet bytes, scene composition, source
readiness, viewport/DPR, applied quality, clocks and random draws fixed. First
replay the retained same-art sourceFactory control with the same real source
objects on both code versions. Then compare the original default-source plan and
the candidate plan on that same fixture: standard skin 0 shading/boost/death,
built-ins 10/15/29/60/62, a supported custom cycle, and food/prey sizes. Assess
artwork/source differences separately from geometry and cadence. The retained
mock-source numeric comparison is not a pixel oracle; the exact retained native
sourceFactory/asset manifest is required before that visual gate can run.

The implementation connects the local host adapter to the shared runtime and
visible HUD/leaderboard. A local Chrome check completed trusted Play, steering and boost-on/off, then
normal death/return and another explicit Play through this default runtime. Historical preview
results do not establish this new composition. Generated stand-ins do not prove
stock artwork, loading or pixel equivalence, installed Chrome/Firefox behavior,
remote profile acquisition or official-server acceptance. See
[verification](verification.md#default-runtime-and-local-play-status) for the
current evidence boundary.

## Authored source initialization

The default local bootstrap admits the literal top-level local document, config
and loopback endpoint before initializing Wasm. It calls initialize once, awaits
that promise, copies the required authored_source_recipes output, then creates
the existing authored Canvas/Image sources. The runtime receives the same
settled initialization promise and binds resolve_local_skin at its existing
stage. Wasm initialization now precedes authored source allocation and decode;
this is an intentional startup-order change, not a byte-parity claim. Rejection
uses the existing local bootstrap status path without retry or source allocation.
Document freshness is rechecked after asynchronous initialization and decode.

Direct callers of createLocalGameHost and createClientAssetMap supply the copied
sourceRecipes plan explicitly. Food/prey factories receive its food/prey group
as a third argument. Explicit sourceFactory overrides still borrow their complete
bundle without generating these stand-ins or requiring this plan. Supplied local
hosts retain their existing runtime initialization contract. Source allocation,
paint/decode order and random callback order after successful initialization are
covered by authored recorder tests; real-Wasm and native browser acceptance are
separate checks. The source adapter beginOperation/resolveRecipe/endOperation
API and request fields remain unchanged; recipe-only previewing consumes no
appearance randomness.
