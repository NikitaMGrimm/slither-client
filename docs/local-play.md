# Local Play

The local page runs the default bootstrap with Play controls, score readouts and
leaderboard rows. It uses the same Rust/Wasm scene, controller, gameplay and
session as game-page integration. Browser glue supplies generated shaded stand-ins
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
the full palette families. The supplied adapter owns its source operations and
skin selection. The default local Rust skin-policy binding remains available
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

The default local body path uses three authored color families, with seven shaded
variants, separate boost glow and shared outline/shadow/death sources from the
single asset map. Rust owns the three-color selection and shading cadence;
browser code binds the source objects after Wasm initialization. Full skin
identity, displayed custom skins, special faces and accessories remain incomplete.

The implementation connects the local host adapter to the shared runtime and
visible HUD/leaderboard. A local Chrome check completed trusted Play, steering and boost-on/off, then
normal death/return and another explicit Play through this default runtime. Historical preview
results do not establish this new composition. Generated stand-ins do not prove
stock artwork, loading or pixel equivalence, installed Chrome/Firefox behavior,
remote profile acquisition or official-server acceptance. See
[verification](verification.md#default-runtime-and-local-play-status) for the
current evidence boundary.
