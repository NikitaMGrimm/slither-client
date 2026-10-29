# Roadmap

The product goal is a compatible client with a shared, idiomatic Rust core and
platform adapters for native desktop, browser, Android and sideloaded iOS.
Windows desktop and browser are the immediate targets. Android and iOS are later
goals; mobile SDKs, devices, touch controls, signing and packaging do not gate the
desktop/browser milestone.

Version `0.1.0-alpha.0` remains an unreleased prototype. Browser delivery and
cross-platform product completion are different milestones. A working extension
alone does not complete the product, and platform plans do not establish
official-server acceptance or authorize a connection.

## Preserve the implemented core

Keep the existing Rust protocol/state, challenge and profile grammar, session and
gameplay policies, input policy, clock/camera, presentation geometry, HUD/menu
policies and authored material recipes. Preserve their bounded native/Wasm tests
and accepted artifacts; do not restart the behavior port.

Browser-free presentation already produces ordered body, food and prey plans.
`BodyAsset` uses opaque `u64` handles and revisions with dimensions and readiness;
body commands retain source rectangles, transforms, effective alpha, composition
and order. These are reusable foundations, rather than a completed portable
renderer. The main browser application submits through wasm32 `web_sys`
Canvas2D; the additive shared slice now supplies wgpu submission on Windows and
WebGPU. Native unit-test success alone does not demonstrate a native game window.

Canvas remains the reference backend. Continue the bounded default-appearance
feedback and controlled same-scene comparison. Procedural artwork, original
artwork comparisons, rendering geometry and simulator world composition must
retain separate evidence. Remaining image faces, antenna artwork, geometry and
player-visible differences are not closed by recipe or API coverage.

Chrome page injection, privileged profile acquisition and extension packaging are
one browser adapter lane. Preserve their safe checkpoints and withhold rejected
packages. Their completion is not a prerequisite for the shared core, standalone
browser client or native desktop renderer.

## Shared wgpu gameplay-rendering slice

The first bounded slice is implemented in
[`apps/wgpu-slice`](../apps/wgpu-slice/README.md). A final-source Windows Vulkan
window and browser WebGPU execution have been observed, including resize and
cleanup. Matched Canvas checks cover two selected normal/boost keyframes using
the same authored resources and draw plans. Source-raster and one-pixel
quad-edge differences remain recorded; this does not establish whole-game
fidelity. The subsequent shared owner now implements input, local transport,
Rust HUD and body/food/prey/paired-eye/arena presentation. Native offscreen and
ordinary browser local sessions have run; native-window input remains open.
Detailed limits are in
[verification](verification.md#shared-wgpu-rendering-slice).

The narrow renderer is used by a Windows host and a standalone browser canvas.
It uses `wgpu` while preserving the existing core. Its dependencies and artifacts
stay separate from the accepted Canvas path; no generic engine is introduced.

The first slice consumes the existing Rust scene/presentation path and original,
explicitly synthetic gameplay events. It draws an animated standard snake with
normal/boost passes and food, using the same scene, resources and update times
on desktop and web. That diagnostic remains available beside the explicit local
Play route. Authoritative simulation stays in the separate simulator.

The common frame/resource boundary contains:

- A frame identity, backing extent, viewport scale and explicit clock/update
  inputs. Rust retains the presentation clock and geometry decisions.
- Existing ordered painter output, composed without regrouping translucent or
  additive passes. Preserve the original numeric plans; document any GPU-side
  `f64` to `f32` conversion at submission.
- Resources addressed by the existing handle/revision identities, with explicit
  dimensions, readiness, ownership and create/update/release operations. DOM,
  `wgpu` texture and platform window objects stay in their adapters.
- Explicit texture color/alpha conventions, sampling, crop and blend behavior.
  Use portable pixel data or an implemented materialization of the selected
  recipes. Canvas paths, gradients, shadows, text and borrowed image objects do
  not convert to GPU rendering automatically.
- Validation before submission, bounded frame/resource storage, and explicit
  resize, surface/device-loss and resource-generation behavior. Renderer recovery
  must not silently reset gameplay or open another connection.

This boundary is a small adapter over current plans. Add shared abstractions only
when both consumers need them. Keep the Canvas consumer available for trace and
image comparison; do not replace correct behavior with backend-specific game
logic or numeric fallbacks in JavaScript.

Acceptance for this milestone requires both builds and actual execution on
Windows and a supported browser: the same Rust fixture/updates, correct resource
identity and draw order, visible normal/boost/food output, resize behavior and
bounded cleanup. Record the actual adapter/backend and unsupported capabilities.
Compare against Canvas with controlled assets, viewport/DPR, quality and timing.
Judge meaningful player-visible differences; do not require harmless raster
differences to be bit-identical or infer speed from GPU use alone. A compile,
offscreen test or screenshot by itself is not full gameplay acceptance.

The [wgpu platform matrix](https://github.com/gfx-rs/wgpu#supported-platforms)
includes Windows, browser, Android and Apple backends. Actual feature support and
fallbacks need target-specific checks; a browser WebGPU result does not establish
WebGL2, Firefox, Safari or mobile acceptance.

## Current milestone: playable shared local client

Develop the shared gameplay owner through native CLI tests and offscreen checks,
with small browser checks at input, session and rendering milestones. Reuse the
existing local-session path, input policy and presentation plans. Both hosts
should consume the same Rust behavior; platform networking, window/DOM effects
and event delivery stay in their adapters. Desktop automation is not required
to make progress on the shared owner.

The bounded local route is implemented and exercised on both runtime paths.
Next, improve the ordinary playable experience and close concrete visual or
behavioral differences with controlled comparisons. Preserve the Canvas reference
and separate source artwork, draw geometry/camera/blending/cadence and simulator
world composition. Avoid exhaustive synthetic-scene polish before player-facing
work. Keep these remaining integration tasks explicit:

- UI and input: consume Rust menu/HUD values, connect mouse/keyboard/window focus
  to existing input policy, and establish text/font, clipboard and accessibility
  behavior. The current ASCII bitmap HUD and minimal Play form are functional;
  full menu, leaderboard/text and accessible UI remain work. Native window/input
  checks that require desktop takeover stay pending under the user's restriction.
- Network and profiles: provide browser and native socket/HTTP adapters around
  the existing Rust session/protocol policies, with the same bounded profile and
  credential lifetime rules. Browser-specific injection permissions do not belong
  in the shared core. Test a declared local transport before separate authorized
  official-server acceptance; never reuse a consumed attempt ledger. The shared
  loopback transport is exercised; remote acquisition/extension work stays parked.
- Lifecycle: resize, display scaling, suspend/resume, surface/device loss,
  disconnect, death/return and explicit restart, preserving the existing state and
  one-attempt semantics.
- Build/delivery: reproducible native and web artifacts, capability reporting,
  packaging and independent release verification. Keep release automation dormant
  until a releasable milestone is reviewed.

Measure and optimize only after behavior and the visible slice are established.
Reuse allocations and batch compatible adjacent commands when evidence supports
it; do not reorder effects or perform a broad cleanup alongside the first port.

## Later mobile goals

Android and sideloaded iOS use the same core and intended renderer boundary.
Their later work includes native surfaces, touch/virtual controls, safe areas,
orientation, app suspension and resource loss, platform networking permissions,
and device performance/thermal checks. Packaging is separate: signed APKs for
Android and a supported Xcode/provisioning/signing distribution path for iOS.
See [Android signing](https://developer.android.com/studio/publish/app-signing)
and [Apple device distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices).
No mobile implementation or acceptance is implied by this roadmap.

Completion is recorded per platform and per behavior/rendering/network/delivery
scope. Windows/browser success is the next milestone, not a silent exclusion of
mobile from the product goal. Preserve source privacy and all earlier failures
and evidence boundaries described in [provenance](provenance.md) and
[verification](verification.md).
