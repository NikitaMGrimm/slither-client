# Opt-in command-indexed HUD journal

The packet journal connects native score state to the caller-owned session. It
reports command-time semantic data; it draws no HUD and retains no packet, row,
name or report queue. Default packet APIs retain their existing behavior.

## Native transaction

Explicitly enable score tracking before packets or after reset. The additive
`AnimatedClient::apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud`
accepts the existing face, food, prey and Setup callbacks followed by a borrowed
`HudIngressPlan`. It returns `HudIngressReport` with read-only `schema()`,
`command_count()`, `setup_draws()`, `events()` and `frame_report()` accessors.

The plan has schema 1, a command count in 1..=4096, exactly one
`HudCommandGuard { playing, close_requested, death_pending }` per original wire
command and sorted exhaustive final-capture indices. These guards are supplied
session decisions. Native code does not reconstruct the session lifecycle.
Canonical pong/game-over controls, repeated challenges, command count and capture
membership validate before source callbacks.

One shared decoder, typed transaction and presentation event fold preserve every
original command position, including commands without presentation events.
The journal has at most 8192 events:

| Event | Command-time meaning |
| --- | --- |
| `Setup` | Positive score-table parameter after cache update, before the existing Setup callback. |
| `SetupDraw` | Existing score view after that successful callback, before the next command. |
| `OwnLengthScheduled` | Actual retained-own appearance, growth, mass or tail scheduling, including equal values. |
| `Leaderboard` | Fully validated local-row/rank/population header and supplied death-pending guard, while playing. |
| `FinalScore` | Required ready score at an accepted non-2 game-over command, before later mass/R/Setup/removal. |

Object tokens retain original-own identity through death, expiry and wire-ID
reuse. Normal anchors, remote targets, removals and `R` do not create length
markers. Every leaderboard tail validates even when not playing: this is stricter
opt-in admission. Default and score-only leaderboard handling, and all public
announcements, remain opaque. No rows or text are copied into the journal.

`StateError::Hud` describes plan/control/leaderboard admission failures.
`ClientPresentationError::ScoreTrackingRequired` rejects implicit enablement;
`FinalScoreUnavailable(ScoreStatus)` rejects missing or unsupported final scores.
Native model, tables, counters and journal roll back together. External callback
effects cannot roll back. Native `setup_draws()` counts successful callbacks;
that alone does not prove Canvas preparation, submission or pixels.

## Wasm, controller and gameplay

The additive `AnimatedScene.apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud`
takes the existing standard face/prey renderer's arguments followed by the plan.
It shares staging, resolvers, actual Setup planning, budgets and source commit.
Actual planned draws must match the journal's count. Complete report conversion,
copying and recursive freezing finish before Canvas submission and model commit.

The immediate report is `{schema: 1, commandCount, setupDraws, events}`. Each
event has `commandIndex` and one of the kinds `setup`, `setup-draw`,
`own-length-scheduled`, `leaderboard` or `final-score`. Score views use the
existing [score-state schema](score-state.md), preserving BigInt tokens and
integer Number scores without JSON, clamping, recomputation or narrowing.

`createStockClient.packetWithHud(bytes, elapsedHeader, plan)` requires an explicit
boolean header flag. It validates the copied plan under its reentry guard before
capture, lazily requires the new native capability, then performs one held
operation and one native call. It validates the report, charges successful Setup
draws once and returns only after source release succeeds. It advances no step,
quality or statistics phase.

An optional synchronous `createStockGameplay` callback, `onHudPacket(report)`,
selects `subscribeWithHud` and this controller route. It must return `undefined`
and reduce semantic data without calling native code or publishing UI inside the
callback. Gameplay guards reentry while it runs; captured deferral reconciles
after both packet and native stacks unwind. Omit the callback to retain legacy
subscription and capability requirements. The caller must explicitly enable
score tracking; bootstrap does not activate this mode automatically.

Native failure preserves native model/source state. A later source-release,
controller, session or observer failure can happen after native effects commit.
Such failures terminate without replay and preserve the original thrown value,
including `undefined`; there is no rollback across those layers. Submitted
pixels and external callback effects are also irreversible by this transaction.

The Wasm glue imports a generated copy of the shared authored validator. The
packager checks that copy byte-for-byte, includes only that selected module in
each renderer graph and adds its exact generated path to the output game
manifest. Source manifests declare fixed resources; generated output contains
no wildcard permission. See [extension packaging](extension.md).

## Same-step lifecycle observation

After selecting the HUD subscription, `session.afterStepWithHud(request)`
returns a deeply frozen `{actions, lifecycle}` from the same lifecycle fold as
`afterStep`. Return only `actions` to the existing native control callback;
retain the copied observation for work after the operation succeeds.

`lifecycle` has exactly `{schema: 1, deathPending, returnActive,
returnCompleted, returnFraction}`. Death presence is sampled after the fold.
The two return flags come from the actual subtraction/completion branches;
the completing step has both flags true, even when a victory return remains
connected. A close-only `v2` does not create either edge. The fraction is the
existing post-fold value, without a second clock or fade calculation.

The new facade requires HUD subscription mode before reading the request or
consuming a step. The legacy `afterStep` remains valid in both modes and returns
only actions. Both share one step/commit latch; do not call both for one step.
The result is an observation of existing effects, not a transaction spanning
later native or observer failure. Reducer publication remains caller-owned.

Visible length/rank/final UI, fade/readout scheduling, leaderboard rows,
announcements and full login UI remain separate. Synthetic native, Node and
real-Wasm recorder evidence does not establish browser pixels, installed-host
compatibility or server acceptance. See [verification](verification.md).
