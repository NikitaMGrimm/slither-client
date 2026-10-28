# Semantic HUD state

`presentation::HudHistory` reduces the admitted packet journal, same-step
lifecycle observations and successful draw samples into bounded semantic state.
The browser-free Rust module retains no packets, rows, report history, timers
or DOM nodes. `hud_history_browser.rs` converts copied records at the Wasm
boundary. `web/stock-hud-state.mjs` captures that ABI, admits closed JS inputs and
associates immutable Rust histories with issued frozen diagnostic snapshots.
Score arithmetic remains in the existing native score owner. This state is separate
from a visible HUD or proof that host UI nodes are ready.

## Pure API

- `createHudState(sceneIdentity, wasm.HudHistory)` creates a frozen empty state for
  a caller-owned Symbol identifying one scene lifetime. The generated constructor
  is an explicit trusted composition dependency; its methods are captured once.
- `hudReadoutRequired(state, playing)` returns exactly
  `dirty && playing && rank > 0 && population > 0`, with a required boolean.
- `reduceHudState(state, sceneIdentity, change)` returns a complete frozen
  candidate or throws without mutating its input.

Only snapshots issued by these functions are accepted as state. Module-private
weak membership rejects structural clones and Proxy wrappers without walking
their object graphs. There is no deserialization or restore API, and the module
does not strongly retain a snapshot history. Each issued snapshot has one
private Rust history handle; unreachable handles use the generated bindgen
finalizer. The copied fields are diagnostic output, never reducer input. A different
scene Symbol rejects before reduction; historical tokens must not migrate between scene lifetimes.

State contains the scene Symbol, live own token, rank/population and extrema,
dirty flag, fade, four requested opacities, and optional current/final score
records. Tokens remain BigInt. Scores remain Numbers, including signed zero,
negative values and values above 32-bit bounds. The reducer performs no score
narrowing, clamping or recomputation. Rust also formats current/final semantic values through `hudSemanticValues`, using the
existing safe-integer decimal contract and captured final suffix. The JS view
composes those values with actual binding/readiness observations.

| Change | Effect |
| --- | --- |
| `{kind: 'packet', report}` | Fold the bounded journal once in original command order. |
| `{kind: 'step', delta, lifecycle}` | Apply branch-local return/fade observations from the existing native step. |
| `{kind: 'world-reset'}` | Clear live token, rank/population and extrema; preserve dirty and displayed/final/visibility histories. |
| `{kind: 'draw', playing, view}` | Consume dirty only for an eligible draw with a ready matching score; require null otherwise. |

Setup hides requested opacity and sets fade to the waiting sentinel `-1`, while
preserving rank, dirty and displayed histories. Its following draw uses that
command's journal sample with playing true. Own-length scheduling binds or
checks the live retained-own token and marks dirty, including equal schedules.
Leaderboard headers replace rank/population, update extrema and mark dirty;
an alive header can start a waiting fade at zero. `R` alone has no dirty event.
Final samples replace final score and its strict `score > 1000` exclamation flag.

Required ready views must match the current world's token. World reset detaches
that live token while preserving historical current/final records. A new own
token may then bind. Death, expiry or wire-ID reuse do not change original-own
identity. Repeated Setup does not create a new world.

## Lifecycle and failure domain

Step changes accept a finite native lag-adjusted delta in `0..=5` and the exact
five-field lifecycle record with finite fraction in `0..=1`. Completion requires
an active return, no remaining death timestamp and fraction zero. An active
noncompleted return requires a death timestamp and positive fraction. Invalid
required metadata rejects without repairing the session's legacy arithmetic.

Completion wins before alive fading: it sets fade and the readout/row/announcement
requests to `-1`, with header request `-0.85`. Active return uses the supplied
fraction. Otherwise alive fading uses `min(1, fade + .01 * delta)` only after its
sentinel has started; header requests use `.85 * fade`. These are raw semantic
requests, not browser CSS clamping or pixel results. Holds preserve the previous
requests, including Setup's hidden zero values.

Pure failure leaves the prior state intact. It does not undo earlier native,
session, transport, pixel or observer effects. Required score/readout failure
after those effects must terminate without replay; see the
[journal's operation boundaries](hud-ingress.md).

The shared `copyHudScoreView(value)` boundary and packet/report grammar remain
unchanged. Complete copied JS input admission precedes the Rust fold; semantic
lifecycle bounds and candidate transitions are checked in Rust. Native callers
provide typed admitted events. Neither path changes inclusive score-table bounds
or command-time score acquisition.

## Explicit gameplay composition

`createStockGameplay({...existing, hudReadout: true})` selects the journal and
reducer path, requiring `packetWithHud`, `scene.score_view` and the generated
`wasm.HudHistory` constructor. The caller must still enable score tracking before packets. Omitting the flag preserves the
existing gameplay path; `onHudPacket` remains an independent packet-only option.
There is no bootstrap, global, message or UI activation added here.

`gameplay.hudSnapshot()` returns only the last committed frozen state, or null
when disabled or disposed. Reading it performs no native access, reconciliation
or action consumption. Packet observers see the preceding committed snapshot.
One pending semantic candidate coalesces consecutive reports in callback order;
it publishes only after ingress unwinds and reconciliation succeeds.

Frame control accumulates the original arrow steps, calls `afterStepWithHud`
once, reduces that lifecycle, and applies world reset only for an actual returned
reset action. After the entire controller frame and source release, it evaluates
same-operation playing and reads `score_view` exactly once only when required.
All fallible reduction finishes before `commitControl`; semantic assignment
follows its success. No score getter or publication runs inside native control.

The additive `gameplay.render()` and `gameplay.resize(width, height)` facades
lazily require the corresponding controller method, preserve its return value,
and apply the same post-release readout gate. They add no animation, quality,
statistics or control-commit step. Direct controller calls are not intercepted;
the current bootstrap's direct resize remains outside this observer.

Required score, callback, source or reconciliation failure withholds the candidate
and terminates without replay. Disposal attempts all owned cleanup and preserves
the first thrown value, including `undefined`, before notifying once. A failing
injected scheduler is not replaced or retried; explicit disposal remains
available to finish cleanup. Already committed native draws are not undone.

DOM binding, rows, announcements, login UI and installed-browser/server acceptance
remain separate. See [verification](verification.md) for the exact evidence.

The separate [view and passive renderer](hud-view.md) consume committed history
with explicit binding readiness. They add no bootstrap activation or score read.

## Migration boundary and synthetic evidence

HUD semantic history (RM-01) and dependent current/final numeric text projection
live in Rust. The separate [leaderboard owner](leaderboard-state.md) also owns
prepared-board lifetime, revisions, row ordering, name policy, row text/style and
top-ten semantic projection (RM-02 and the leaderboard portion of RM-08). Session,
handshake and gameplay orchestration remain separate migration work.

Authored native tests port the existing history and text requirements. Ordinary
Node/VM shell tests inject an explicitly labelled generated-ABI double, without
requiring prebuilt Wasm. The full `tools/wasm-smoke.mjs` suite reruns the existing
HUD state/view/DOM and leaderboard composition fixtures with the fresh real
`HudHistory` and `LeaderboardHistory` classes, then runs the existing actual-Wasm ingress/draw/gameplay
matrix. These are synthetic tests, with no browser, pixel, installed-host or
server acceptance claim.
