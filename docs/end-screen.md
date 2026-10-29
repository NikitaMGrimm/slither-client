# Death, return and victory presentation

The default entry mounts a passive result panel alongside the existing Play and
HUD owners. During the death/return delay it remains a bottom-center overlay,
independent of the hidden start panel. After return, the same node follows the
appearance controls and preview in the start panel's normal scroll flow. Its
border-box width follows that responsive panel; it cannot cover earlier menu
controls or the preview with fixed positioning. The result remains passive with
pointer events disabled. Compositions without an owned Play panel retain the
independent overlay. `EndScreenState` owns the accepted outcome and plain-text
projection in pure Rust. `EndScreenProjector` copies the committed session phase,
playing/life-ended flags, local replay capability and optional command-time final
score into that model. The DOM view submits the copied text using Text nodes.
It opens no socket, starts no timer, reads no score and owns no game state.

The accepted `dead` phase displays **Game over**; the accepted `victory` phase
displays **Victory**. Both remain visible during the existing delayed return.
After return, local sessions say **Select Play to play again.** The existing Play
control owns that explicit action. Remote sessions say **Session ended.** and
retain their existing one-shot admission. An accepted victory heading survives a
later disconnect. A new session/ordinary playing observation clears the result.
A close without a previously observed death/victory phase supplies no outcome.
Snake removal, absence, rank and score thresholds cannot select a result.

Final length comes only from the existing command-time HUD final capture. There
is no fallback to the latest displayed score or a later score read. Safe integers,
negative values and the existing strict `score > 1000` exclamation rule are
preserved; negative zero displays as `0`. Without a capture the score line is
empty. Invalid numeric input rejects before the retained outcome changes.

This is authored bounded presentation, based on the existing session/HUD code,
tests, and ledger rows NET-04, HUD-03 and MENU-02. The lane inspected no original
source, artwork or captures. The ledger provides no authored victory message/save
request contract, so no editor, sanitizer or save packet is implemented here.
Original layout, exact text/localization/fades, victory-save interaction,
installed-host behavior and official-server acceptance remain unverified. Ledger
counts are unchanged pending separate reassessment.

Verification covers synthetic native lifecycle/score tests, native DOM and
runtime doubles, real-Wasm ABI execution, packaging and ordinary integrated
checks. The runtime case executes the authored session/gameplay path, verifies
post-operation publication of the accepted victory phase and exact final capture,
and checks that projection adds no score read or reconnect. These tests establish
neither native browser pixels nor reference equivalence. Independent review and
any scripted screenshot comparison are owned by the integrating main agent.
