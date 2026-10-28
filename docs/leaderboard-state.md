# Rust-owned leaderboard history

`presentation::LeaderboardHistory` owns the selected schema-2 leaderboard's
command-ordered Setup/table and board history. It retains every row of the last
accepted board, exact BigInt-equivalent revisions, one-use staged operations and
all existing row/text/style policy. Its `LeaderboardView` selects the top ten and
projects data availability, borrowing the committed HUD heading/row opacity
requests without a second fade clock. This code has no browser dependency.

`leaderboard_history_browser.rs` converts copied records and numeric results,
creates frozen output and preserves the existing copied-board object identity
when Setup/reset leaves the native board unchanged. Its cached JS board is
output only. Future reductions and projections read Rust history, never those
copied fields. No DOM capability enters the core or the Wasm history owner.

## Staging and publication

The JS shell creates one owner with
`createLeaderboardState(sceneIdentity, wasm.LeaderboardHistory)`. It captures
generated methods once and retains weak issued-state/plan membership, exact
scene identity, closed current-realm record/array admission and caught-reentry
guards. Historical snapshots remain readable after their transition owner closes.

`prepareLeaderboardPacket` copies and admits the complete schema-2 report before
Rust stages numeric requests. Each board uses its command-time table parameter;
later Setup updates history without rescoring the displayed board. The existing
independent score projector still runs after ingress/source release through the
same caller-owned callback. Rust retains the raw companion for each issued plan.

Completion consumes the plan before nickname or score-result conversion. Rust
admits the local nickname before JS reflects through scores, and validates each
numeric element before JS reflects through later elements. This preserves the
existing first-failure order. Integer scores must be safe; an index strictly
above `tableMax + 2048` requires NaN. The inclusive endpoint remains supported.

Rust stages the complete history and formatted board without closing the old
owner. JS converts the output, releases the raw plan and checks caught reentry
before the native publication step. Conversion/cleanup failure or caught reentry within that operation leaves the
prior history usable; the attempted plan remains consumed. Gameplay retains its
existing pending-publication and fatal-callback boundaries; external effects are
not rolled back.
Committed alternatives and resets invalidate old plans through native identity.
Reset retains board, Setup/table history and revision. Every board, including
equal and empty boards, replaces display history and increments revision.

## Row and text contract

Rows keep original order and one-based ordinals. The one-byte local-row marker
selects own-name substitution independently of header rank/population and death
state. Non-own names retain Latin1 byte units, with the existing seven-digit
filter resetting only on ASCII letters. Own nicknames use the admitted ASCII
login range, including DEL. Text normalizes CRLF/lone CR to LF, removes NUL and
replaces spaces with NBSP; it does not parse markup or escapes.

Scores retain signed zero as numeric data, format plain decimal text and use
literal `NaN` only for out-of-table rows. Colors retain the nine-entry palette;
raw row opacity keeps the existing arithmetic and can be negative outside the
visible ten. HUD opacity requests remain independent from per-row requests.

Native admission preserves the 4096-command, 149795-row and 1 MiB aggregate
bounds, including all names and board headers. It retains full history while
only the view is capped at ten. JavaScript composes Rust data readiness with the
current binding/document observation and retains its issued-view guards. DOM
construction, actual native readiness, setters and cleanup remain separate.

## Evidence boundary

Authored native tests port the existing board fixtures and native lifecycle,
resource and revision boundaries. Ordinary Node/VM tests inject an explicitly
labelled ABI double. The full fresh Wasm smoke repeats the existing HUD/board
state/view/DOM requirements with the actual Rust owners, then runs the existing
real-Wasm ingress/draw/gameplay matrix. Synthetic socket, Canvas and numeric
projector doubles retain their labels. These tests establish no browser pixels,
installed-host, official-source, server or visual-fidelity acceptance.
