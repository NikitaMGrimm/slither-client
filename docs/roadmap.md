# Roadmap

Version `0.1.0-alpha.0` contains bounded handshake primitives and an atomic
protocol-19 scene with a Rust/Wasm Canvas2D preview. Synthetic browser rendering,
borrowed-asset integration and a local simulator connection have been demonstrated.
See [verification](verification.md) for scope.

## 1. Received scene slice (implemented)

Setup, snake appearance/motion/removal and food state apply atomically with
bounded retention. The deterministic renderer has a camera, three palettes,
synthetic fixtures and optional loopback pointer/boost controls. It previews
received anchors. Simulator results establish only the tested simulator path.

## 2. Match desktop presentation

Target Chrome and Firefox on Windows. Preserve the original client look and
feel, including animation clocks, head/body corrections, interpolation, camera,
quality modes, full skin recipes and effects. Validate numeric event/update/draw
traces before treating a similar screenshot as equivalent behavior. Keep wire
state, presentation state and drawing distinct, using idiomatic Rust types.

The separate animated preview now connects ordered events, head/body/length
corrections, following camera, draw-driven spacing and sampled curves. Synthetic
native/Wasm and Windows browser checks exercise this path. Standard paired eyes
now retain gaze, pupil motion and deferred draw targets. Full skins, special
faces, HUD and team-mode drawing remain pending. An additive API now
installs trusted normalized paired geometry before the first pupil update,
retains it per appearance and checks standard-recipe coherence before drawing.
An additional paired-face API retains side geometry and ready borrowed
images to compose the complete represented ordinary paired family in both renderers.
Startup blank-source behavior, other special faces and general host mapping remain
outside this completion. Full host skin adaptation and antennas remain future
work. Radius easing now shares the connected update clock and retains cadence
through reset. The opt-in
standard-body renderer now connects ordered body effects and applied quality to
production geometry; the synthetic page demonstrates three authored recipes.
Native Firefox checks cover that bounded integration. Five frozen external-runtime
schedules match production body commands exactly; full-skin and original-pixel
parity remain unverified.

Retained desktop food now connects ordered events, duplicate instances, captured
eater objects, creation-selected sources and quality-dependent paint passes in
both Wasm renderers and the authored page. Bounded numeric and native Windows
browser checks cover the food engine and explicit draws; complete host parity is
not established. Target-aware application now stages ordered Setup draws, with
explicit resize APIs and synchronous page sizing/counting. New host-cadence
reference/browser acceptance remains bounded. Retained prey now joins the same
event/update/Setup transactions and both animated renderers, with independent
appearances, captured eaters, source selections and early/late paint passes.
Synthetic native/Wasm/page checks cover this path; source-runtime, original
artwork/loading and stock-browser prey acceptance remain unverified. The
animated arena edge now uses a late vector band and open inner stroke with
retained camera selection and displayed-radius easing. Original browser pixels
and full host cadence remain separate evidence requirements.

## 3. Measure dense scenes

The offline benchmark provides deterministic received-anchor workloads without
changing the renderer. Treat performance as secondary to presentation precision.
Promote optimizations only with evidence that they preserve supported behavior;
the existing preview does not establish original rendering or gameplay parity.

## 4. Package the browser client

After the state/rendering path works, add extension packaging with a documented
install and verification procedure. Input, connection flow, and gameplay still
need implemented and tested paths before claiming a fully playable client.

Keep [release configuration](releases.md) dormant until a releasable milestone
and its packaged contents have been reviewed.
