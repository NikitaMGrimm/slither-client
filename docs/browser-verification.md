# Scripted browser verification

These opt-in jobs load our current Rust/Wasm in owned browsers. They are separate
from `npm test`. No ordinary test invokes a browser, reads a private reference,
downloads artwork, or connects to a game server. Browser installation can access
the Playwright CDN; the regression itself uses only literal loopback.

Use Node 24, Rust 1.99 and wasm-bindgen CLI 0.2.129. Set `WASM_BINDGEN` to the
matching executable if it is not on PATH. Install with:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npx playwright install chromium firefox
```

Playwright is pinned to 1.64.1 in both npm manifests. Every command below rebuilds
current Wasm, except the external reference command whose caller-owned adapter
selects its runtime. Output arguments are mandatory, create-only directories
outside the checkout with an existing parent. Existing and failed runs are never
overwritten. No PNG, binary capture, private program, source map, or external
artwork belongs in Git. Browser/context/server cleanup runs in `finally`.

## Per-PR synthetic regression

```sh
npm run browser:regression -- --output /absolute/external/fresh-run
```

This runs headless Chromium and Firefox sequentially, using the actual generated
Wasm, authored three-snake/food/prey sources, six deterministic packet deliveries,
and 24 fake-clock RAF frames. Pointer input changes gaze; Space events record
boost intent only, without a server response. Game-domain logic remains in Rust.
It saves Canvas PNGs at frames 1, 12 and 24, a complete ordered Canvas submission
log from Arm, packet/input receipts, snapshots, and native callback timestamps.
All Canvas methods, drawing-state setters, dimensions, and Pattern/Gradient
operations are forwarded and recorded; object IDs describe identity, not pixels.
The bounded log fails on overflow. Native `performance.now`, RAF and timer
functions are captured before clock installation; each run verifies that the
native clock still advances while game time is paused.

The saved synthetic expectations in `tools/browser-baselines.json` compare exact
screenshot PNG hashes, decoded Canvas RGBA hashes, and the complete ordered
command-log hash/count. PNG bytes and raw pixels stay external. A mismatch fails
and retains its outputs. The comparison never updates its expected values.

The initial saved scope is Windows x64, Playwright Chromium 156.0.8078.4 and
Firefox 157.0, viewport 640x480, requested DPR 1, Node 24.15.0. Rendering/PNG
encoding can depend on OS, browser build, graphics backend and driver. These are
exact environment-scoped expectations, not portable pixel tolerances. Unsupported
platforms fail closed; add separately reviewed expectations from that platform.
Do not claim that a Windows baseline establishes Linux CI rendering equivalence.
The command is ready for a matching per-PR runner; this change does not modify
the existing CI workflow or make browser execution part of ordinary npm tests.

For an intentional rendering or browser-version change:

```sh
npm run browser:regression -- --candidate --output /absolute/external/new-candidate
```

This writes `baseline-candidate.json` externally. Inspect all PNGs, the complete
command differences, and the intended change; run again to prove repeatability.
Only then explicitly edit the textual synthetic expectations in Git. Never copy
reference artwork into an expectation or automatically bless a failing run.

## Shared local feature scenarios

```sh
npm run browser:scenario -- --scenario tools/browser-local-play.json --output /absolute/external/feature-run
node /absolute/pipeline/tools/browser-scenario.mjs --repo /absolute/feature-clone --scenario /absolute/scenario.json --browser firefox --output /absolute/external/feature-firefox
```

The optional `--repo` selects another authored checkout, builds its current
Wasm, and serves its default page through the existing scene server. One owned
ephemeral WebSocket fixture sends an authored challenge and saved synthetic scene
after a zero-profile local login. It is a packet fixture, not a simulator or
game server. It accepts no nonzero credential profile. The page uses the real
default bootstrap, runtime, session, controller and renderer. The original
repository logo is available at `/assets/logo.svg` through the shared static
route. No feature-specific HTTP control endpoint is added.

Scenarios are labelled JSON data, not Playwright code. Required fields are
`kind: "authored-synthetic"`, `viewport: {width,height}`, and at most 100 `steps`.
Optional `expectedLogins` checks exact explicit Play count. Supported steps:

| `op` | Fields and behavior |
| --- | --- |
| `press` | `key`, e.g. `Tab`, `Enter`, `Space`; trusted Playwright keyboard input |
| `fill` | `label` or `role`/`name` or `selector`, plus `value` |
| `click` | The same locator fields; trusted mouse input with RAF actionability polling disabled |
| `assert` | Locator fields and `state`: `visible`, `hidden`, `enabled`, `focused` |
| `advance` | `ms`, integer 0..10000; advances fake game clock, then services native ingress |
| `disconnect` | Closes only owned synthetic fixture sockets normally |
| `screenshot` | Unique safe `name`; saves the whole current viewport externally |

Assertions poll from Node while advancing the game clock in 16 ms increments,
up to 120 attempts. The fixture saves action order, exact connection/login counts,
ordered Canvas commands, screenshot hashes and actual browser version. It fails
on unexpected page errors, blocked network, fixture errors or log truncation.
This is a screenshot/checkpoint job without automatic screenshot expectations;
per-PR visual baseline enforcement remains the dedicated regression above.

For the Start/Play lane, adapt `browser-local-play.json`: checkpoint Ready, fill
Nickname, press `Tab` and assert Play is focused, press `Enter`, assert the Play
panel is hidden, checkpoint Playing, disconnect, assert Play enabled, checkpoint
Returned. A second explicit keyboard Play can set `expectedLogins: 2`. The lane
owns its UI assertions; this job does not invent layout or visibility acceptance.

## Installed headed Chrome and real GPU trace

```sh
npm run browser:performance -- --output /absolute/external/chrome-run
```

This uses installed `channel: 'chrome'`, `headless: false`, one browser process,
one context, a newly created temporary profile, requested DPR 1 and a 640x480
viewport. It neither accesses user profiles nor changes browser/system settings.
It supplies no disable-GPU flag and verifies the actual process command line.
The profile is removed only after browser closure and canonical-path confinement
checks. The complete actual flags and version are retained externally.

Fake game time advances one 16 ms frame at a time. Between updates, two captured
native RAF callbacks give the compositor a presentation opportunity; the target
is not rapidly reset in a tight synthetic timer loop. A native five-second
deadline rejects a stalled cadence. These callbacks are scheduling evidence,
not GPU fences. Visible/focused state and actual viewport/DPR are sampled before
Arm, after every update and every native cadence, with focus/visibility/resize
transitions retained. All observations must remain stable. Headed Windows Chrome
can report DPR `1.0000000149011612` for a requested 1; the actual value is saved
and compared exactly throughout the run.

`Tracing.start`/`Tracing.end` record a genuine Chrome CDP timeline with `gpu`,
`cc`, `viz`, raster and GPU-service categories. The job saves the raw external
trace, checks event categories, actual raster/presentation event names, track
IDs/names, and `dataLossOccurred`. Missing/truncated GPU/raster/presentation
evidence fails. `SystemInfo.getInfo` supplies actual graphics feature status and
renderer metadata, with software-renderer detection explicitly reported. An
enabled feature or a GPU-named event alone is not proof of hardware execution.
This is not a Playwright trace archive.

Before Arm, the headed diagnostic also enables CDP DOM and LayerTree, resolves
the exact world element to a backend node ID, and retains safe
`layerTreeDidChange`/`layerPainted` metadata. It queries `compositingReasons` only
for exact backend-node matches before and during replay. Trace summaries match
explicit layer/backend-node fields where available, without treating generic GPU
events as world-specific evidence. Missing layers are inconclusive; Chrome's
`Canvas` reason can mean accelerated Canvas or a promoted display-list Canvas.
No LayerTree snapshot, picture, replay or command-log API is called.

Native callback timestamps cover CPU/submission plus forwarding/recording
instrumentation. Keyframe screenshot/readback, fake-clock control and native RAF
wait overhead occur outside those callbacks and remain in the full trace. No
callback duration is reported as GPU completion, end-to-end latency, or pure
Rust/Wasm bridge cost. This small synthetic job is not a crowded-scene benchmark.

## Private reference: record once, compare later

```sh
npm run browser:reference -- --mode capture-original --adapter /external/authored-adapter.mjs --reference-root /external/cached-archive --pack /external/read-only-pack --scenario /external/scenario.json --output /external/new-reference
npm run browser:reference -- --mode compare-ours --adapter /external/authored-adapter.mjs --reference-root /external/cached-archive --pack /external/read-only-pack --scenario /external/scenario.json --reference /external/new-reference --output /external/new-ours
```

These are explicit manual jobs. No reference is downloaded. Each role runs alone
in a fresh installed headed Chrome process/context/profile. Compare reads the
saved reference identity and PNG/log hashes; it does not open an original page.
Actual viewport and DPR must equal the reference before Arm. Each output is
create-only and separate from archive, pack and saved reference directories.
Refresh requires an explicit new capture command and fresh directory when the
scenario changes. Normal regression has no private adapter or scratch dependency.

The trusted external adapter exports `createAdapter(options)`, receiving `role`,
`referenceRoot`, `pack`, `scenario`, `output`, `repo` and `exactFrame`. It returns:

| Field | Contract |
| --- | --- |
| `server` | Unbound Node HTTP server; runner binds literal 127.0.0.1 port 0 |
| `pagePath`, `canvasSelector` | Selected single-role local page and world Canvas |
| `viewport` | `{width,height,dpr}` before Arm |
| `frames`, `keyframes` | Bounded 1..600 batch count and selected checkpoints |
| `ready(page)` | Native/Node polling; never wait on the frozen game's RAF/timers |
| `arm(page)` | Explicit trusted startup/input, zero credentials, no automatic retries |
| `step(page,{frame})` | One replay batch; returns retained private receipt with `failed` flag |
| `verify(rows)` | Completion, packet, source, foreground and dimension gates; `{accepted:true}` only on evidence |
| `close()` | Close owned peers and server, including failed initialization |
| `exact(page)` | Optional one-shot in-memory exact-frame diagnostic, ours only |

The adapter owns existing cache-integrity, credential-substitution, route and
socket fences. Page requests are additionally restricted to its exact loopback
origin and `/slither` socket path. Workers must review adapters as trusted code;
this extension point is not a sandbox. No source-map embedding or original
program inspection is required. Commands, original keyframes, source-bearing
errors and logs stay private and external. Stdout reports only status, paths,
versions and counts. Private Canvas logs drain after each batch to avoid silent
truncation. Hash differences remain differences, not visual-parity acceptance.

`--exact-frame` is permitted only with `compare-ours`. It calls the external
helper once after the source replay passes its gates. That helper must preserve
method/setter/dimension order and actual source, Pattern and Gradient references
in page memory, use a fresh same-size context, reject incomplete captures or
source rewrites, and serialize safe telemetry only. There is no built-in
synthetic substitute or automatic probe retry.

For a cheap source/backend investigation, append `--metadata-only` to each
explicit reference command. This suppresses screenshots and Canvas argument
logs, and keeps only scrubbed step metadata, exact world layer mappings/reasons,
native callback timings and the real trace. Captured native Canvas/element
forwarders count `getImageData`, `toDataURL`, `toBlob` and world self-draws by
startup/play/driver phase without serializing their arguments or artwork. Driver
keyframe captures are kept outside the play interval in ordinary capture mode.
This mode cannot run the exact-frame probe. A separately requested diagnostic
recording uses a fresh external reference; ordinary comparison still never
reruns original implicitly.

## Executed evidence and limits

On 2026-10-28, the 24-frame synthetic regression passed twice with unchanged
expectations in Chromium 156.0.8078.4 and Firefox 157.0 on Windows x64. Installed
Chrome 156.0.8078.48 passed the same synthetic foreground job with actual GPU,
raster and presentation events and no trace loss. The local default-page fixture
passed one Play, synthetic ingress, normal disconnect and returned-Play checks.

A separate private 120-batch original capture completed once with keyframes,
ordered Canvas log, native callback timing and real CDP trace. Ours later used
that saved reference without executing original. One exact frame-120 probe
captured/replayed 1,791 commands with retained source/Pattern identities, equal
1500x938 backing sizes and no drawn-source writes during or after capture. Its
instrumented callback and plain-JS submission are separate CPU observations;
neither establishes GPU completion or an isolated bridge-cost difference.
Setup/readiness failures and earlier failed synthetic/Chrome runs remain external.
All six prepared full-skin scenarios later completed 361-batch serial original
and ours runs with matching actual viewport/DPR, foreground gates, keyframes and
real traces. Every saved keyframe comparison differed, so no visual parity is
claimed. A separate 120-batch metadata-only layer check mapped both exact world
nodes to content layers with Chrome's `Canvas` compositing reason. It found no
supporting creation-order difference; no creation-order variant was run. Ours
had zero play-time Canvas pixel reads, element serialization or world self-draws
in that interval. Direct trace layer matches did not identify world-specific
GPU/raster work, so that attribution remains unknown. Official-server acceptance
and installed extension gameplay remain separate.

Primary API references checked for this implementation:
[Playwright clock](https://playwright.dev/docs/api/class-clock),
[browser channels](https://playwright.dev/docs/browsers),
[CDP sessions](https://playwright.dev/docs/api/class-cdpsession),
[Chrome Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/),
[Chrome SystemInfo](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/),
[Chrome LayerTree](https://chromedevtools.github.io/devtools-protocol/tot/LayerTree/).
