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
faces, HUD, prey and team-mode drawing remain pending. An additive API now
installs trusted normalized paired geometry before the first pupil update,
retains it per appearance and checks standard-recipe coherence before drawing.
Full host skin adaptation and antennas remain future work. Radius easing now
shares the connected update clock and retains cadence through reset. The opt-in
standard-body renderer now connects ordered body effects and applied quality to
production geometry; the synthetic page demonstrates three authored recipes.
Native Firefox checks cover that bounded integration. Five frozen external-runtime
schedules match production body commands exactly; full-skin and original-pixel
parity remain unverified.

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
