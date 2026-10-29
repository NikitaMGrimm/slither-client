# Shared offline gameplay rendering slice

This separate crate consumes the existing `slither-client` pure Rust core by
path dependency. It does not change the root Cargo files, Canvas entry, generated
Canvas payload, protocol, simulator, extension or accepted local test bundle.
All fixture packets are original synthetic inputs. No game connections exist.

Both hosts use `scene::Scene`: the same Setup, skin-zero appearance,48 foods,
absolute anchor packet schedule, received-speed transitions, `AnimatedClient`,
fixed 1000/60ms updates, sampled geometry, camera, `plan_standard_body` and
`plan_food`. Tick120 enables boost; tick360 returns to cruise; tick600 stops the
finite packet/update schedule. This is not a server responding to host input.
No keyboard/pointer control is claimed by this slice. Paired eyes, prey, UI text,
antennae, other skins and live transport are not rendered here.

## Shared boundary and material limits

`Frame` carries identity, tick, backing extent, viewport scale and ordered draws.
Food outlines/bodies precede snakes; late food glows follow snakes. Every body
pass stays in its original position. Source handles and revisions remain full
`u64`; readiness, dimensions and the exact revision must match resident textures.
Create/update retires older revisions of the same handle only after validation;
release is explicit, and dropping the renderer releases all its owned objects.
At most128 textures,512x512 per texture,8192 draws and8192 backing pixels per axis
are admitted. No regrouping or texture sorting occurs.

Crop UVs, translations/rotation and destination corners are calculated from
the core's f64 plans. Only final clip/UV/alpha vertices convert to f32, with
overflow/nonfinite rejection. Positive in-bounds crops and nonnegative destination
sizes are supported; other image-overload cases fail explicitly. Zero backing
extent suspends rendering and fixture updates, without surface configuration.

The CPU recipe adapter uses the existing Rust-authored RGBA samples and only the
operations needed by palette-zero body/effects/food: full-circle fills/masks,
constant colors, concentric radial gradients, full-source rectangles and black
disk shadows. Circle coverage uses4x4 samples; blur uses a separable Gaussian
with sigma=blur/2 truncated at3sigma. This is a declared raster approximation,
not proof of Canvas pixels. Unsupported polygons (including star decorations),
general paths/gradients/shadows, text and native images return errors. No selected
body/boost/food pass is silently omitted or replaced with stand-in artwork.

Source samples become premultiplied encoded-sRGB RGBA bytes in `Rgba8Unorm`
textures. Linear clamp sampling uses one mip level. Targets must expose encoded
`Bgra8Unorm`/`Rgba8Unorm`; there is no automatic sRGB decode/encode. SourceOver
uses premultiplied One/OneMinusSrcAlpha; Lighter uses One/One for color and alpha,
clamped by the unorm attachment. These conventions are explicit comparison
inputs, not a universal Canvas color-management equivalence claim.

## Hosts and lifecycle

Windows uses winit0.30.13 and wgpu30.0.1 DX12/Vulkan. Browser uses WebGPU only,
standalone wasm-bindgen0.2.129, web-sys/js-sys0.3.106 and futures0.4.79. CPU/software
adapters and unsupported WebGPU report errors; no Canvas/WebGL/software fallback
is labelled success. Dependencies are isolated in this crate's Cargo.lock.

The shared Driver admits monotonic host timestamps, performs at most8 fixed
ticks per pump, preserves bounded catch-up debt, and pauses after gaps over250ms.
This pauses fixture time rather than inventing packets or resetting gameplay.
Windows resize uses physical backing dimensions and scale factor. Web copies CSS
extent times DPR into the backing canvas; all scene/clock math stays Rust-owned.
Surface timeout/occlusion skips presentation. Outdated configuration reconfigures
without changing the scene. Lost surface/device or validation error stops the
host explicitly: no automatic gameplay reset, connection or device retry.
Close/pagehide cancels the owned scheduling and drops/frees GPU/scene owners.

## Build and later run vectors

Run from this directory with Rust1.99.0, one Cargo lane and a fresh external
`CARGO_TARGET_DIR`. Native and web commands must be serialized:

```powershell
$env:CARGO_BUILD_JOBS = '1'
$env:RUST_TEST_THREADS = '1'
cargo test --locked --lib --tests -- --test-threads=1
cargo build --locked --bin slither-wgpu-desktop
cargo clippy --locked --all-targets -- -D warnings
cargo build --locked --target wasm32-unknown-unknown --lib
& $env:WASM_BINDGEN --target web --out-dir web-dist/pkg --out-name slither_wgpu_slice <matching-target>/wasm32-unknown-unknown/debug/slither_wgpu_slice.wasm
```

Copy `web/index.html` and `web/entry.mjs` into `web-dist` alongside that new pkg
directory. Do not copy or overwrite root `dist/web`. These are manual build
vectors, not permission to launch a window, browser or listener.

After separate root review/resource approval, the desktop executable opens a
window; the standalone web directory needs an approved secure/local serving
surface. No server is included. Native window and browser WebGPU execution,
resize/DPR/cleanup, matched Canvas captures, visual fidelity and performance
remain separate runtime gates. Neither a compile nor offscreen readback closes
player-visible appearance acceptance. No mobile SDK/platform acceptance claimed.
