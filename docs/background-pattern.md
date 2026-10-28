# Browser background pattern submission

The animated browser renderer submits its repeating background through one
isolated rectangular `Path2D`. Rust still prepares the rectangle, phase, zoom,
opacity and layer order. The browser adapter uses the same borrowed ready image
and creates a fresh `CanvasPattern` for every planned draw.

There is no cross-frame pattern or source cache. The source identity does not
provide a content revision: an image can be reloaded without changing its object.
An isolated path also preserves the context's ambient current path.

The complete batch preflight constructs and populates every path before the
first target clear or backing-width assignment, including ordered Setup draws.
Missing Path2D capabilities and constructor/rectangle errors reject through that
preflight, preserving the primary exception and the existing target and retained
scene state. This adds a native Path2D requirement to the animated browser path.

Authored real-Wasm recorder checks cover fractional and negative rectangle
coordinates, transforms, source reload metadata, fresh pattern creation,
ambient-path preservation and construction/capability failures before clearing.
These are command and rollback checks, not native raster equivalence evidence.

Exact pixel equality, unchanged gameplay controls, native source/path behavior,
perceptual picture/motion assessment and matched-original fidelity are separate
verification axes. Switching between native rectangle and path submission can
produce unequal output bytes. A byte difference alone establishes neither what
a player notices nor which output is closer to an original runtime. Any timing
claim must name its measured workload and instrumentation; no Canvas backend can
be identified from event counts or pixel differences alone.

A bounded Chrome 156 local replay with the default authored assets observed
`ReadbackImagePixels` events fall from 117 to 0 over 120 callbacks, one run per
variant. The corresponding callback timings may include concurrent repository
guard/push work and do not establish an isolated or general speedup. This browser
evidence uses the composition at commit `82a4020`; later UI and skin-input
changes have separate delivery builds/tests, not a new browser comparison.

Native-size review covered startup, gameplay, active boost and two death points.
The ready images were exact; all four gameplay pairs had unequal bytes. No
supported visible regression was found in those stills or sampled consecutive
25 fps recording frames around boost/death. The frame samples are not continuous
playback, live-input latency or natural frame-pacing acceptance. Separate authored
native checks passed 29 source/path/clip/inventory assertions using 30 terminal-read
targets; the earlier unrun 99-case matrix is not counted as passing evidence.
