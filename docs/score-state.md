# Opt-in retained-own score state

`AnimatedClient::enable_score_tracking()` and
`AnimatedScene.enable_score_tracking()` enable canonical score tracking before
packets or after world reset. Enablement is idempotent and survives reset.
Existing callers remain in the legacy mode: `R` packets are opaque and retain
their previous admission and ignored-command counts.

In enabled mode, Setup selects a positive-u16 `ScoreTables` cache at its event
position, before an ordered Setup callback. Equal parameters share the immutable
cache; changed parameters replace it on the disposable transaction. The cache
survives ordinary world reset. This parameter is a score-table bound, independent
of the retained body limit.

Canonical `R` is exactly two bytes: opcode 82 and one replacement adjustment
byte. It addresses the original retained own object, without a wire ID, and
does not change logical membership, fractional mass or smoothing. A truncated,
extended or pre-own `R` rejects the complete enabled transaction. Legacy mode
continues accepting these as opaque commands.

The adjustment starts at zero with each new own world and survives repeated
Setup, removal, death, draw expiry and wire-ID reuse. Explicitly addressed mass
and body updates still follow the newest wire lookup; they do not transfer
ownership away from the retained original own. Reset clears own state and its
adjustment while retaining the tracking mode and table cache.

Every existing native ingestion wrapper uses this same staged transaction.
Later malformed commands, resolver failures and rejected Setup callbacks roll
back the tables and adjustment together with the numeric model. Callback
side effects remain caller-owned.

## Copied observations

Native `score_view()` returns `ClientScoreView` with the mode, optional cached
parameter, optional `OwnScoreView` and `ScoreStatus`. Own data uses the existing
logical segment count and latest unsmoothed fractional mass, plus the adjustment.
The composed table index is count plus adjustment. A read advances no clock,
update, draw, statistics, quality or source-registry operation.

Wasm `AnimatedScene.score_view()` returns this copied own-data record:

```js
{
  schema: 1,
  enabled: true,
  tableMax: 430, // null until an enabled Setup
  own: {
    token: 1n, // identity scoped to this scene, never reused by reset
    id: 7,
    logicalSegments: 12,
    fractionalMass: 0,
    scoreAdjustment: 3,
    scoreIndex: 15
  },
  status: 'ready',
  score: 213, // Node-host result for these authored inputs
  error: null
}
```

`own` is null without a retained own object. `status` is `disabled`,
`no-tables`, `no-own`, `unsupported` or `ready`. Only `ready` supplies a Number
score; other statuses supply null. Only `unsupported` supplies an error code:
`zero-table-max`, `invalid-fractional-mass` or `index-out-of-range`. No mutable
table storage escapes. Callers may change the returned records without changing
the scene.

Scores preserve ordered f64 arithmetic, including negative and above-32-bit
results. An own index above N+2048 is an explicit observation status, without
clamping or a fabricated score. Otherwise valid geometry ingestion remains
admitted: this slice has no required HUD or final-result lookup.

## Scope and verification

The feature does not enable itself in gameplay. The optional
[packet journal](hud-ingress.md) supplies command-time final capture,
intermediate Setup samples and leaderboard headers. Dirty-readout scheduling,
HUD display and login UI remain separate. `score_view()` is an out-of-borrow
read and cannot replace event-time journal samples.

Native synthetic tests cover legacy behavior, canonical admission, rollback,
cache ownership, reset, event-time Setup and retained-own identity. The authored
real-Wasm helper uses this Node host's `Math.pow` for exact expected scores and
checks copied records, negative results, domain status, same-step reset and owner
cleanup. This is not browser arithmetic parity, installed-extension, HUD, pixel
or server acceptance. See [verification](verification.md).
