# Roadmap

Version `0.1.0-alpha.0` contains bounded handshake primitives and an atomic
protocol-19 scene with a Rust/Wasm Canvas2D preview. Synthetic browser rendering,
borrowed-asset integration and a local simulator connection have been demonstrated.
See [verification](verification.md) for scope.

## 1. Received scene slice (implemented)

Setup, snake appearance/motion/removal and food state apply atomically with
bounded retention. The deterministic renderer has a camera, three palettes,
synthetic fixtures and optional loopback pointer/boost controls. It previews
received anchors; prediction, smooth bodies, complete skins, HUD and prey remain
unimplemented. Simulator results establish only the tested simulator path.

## 2. Match desktop presentation

Target Chrome and Firefox on Windows. Preserve the original client look and
feel, including animation clocks, head/body corrections, interpolation, camera,
quality modes, full skin recipes and effects. Validate numeric event/update/draw
traces before treating a similar screenshot as equivalent behavior. Keep wire
state, presentation state and drawing distinct, using idiomatic Rust types.

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
