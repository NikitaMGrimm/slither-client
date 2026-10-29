# Authored startup/loading surface

The default entry presents the authored logo and a labelled native indeterminate
progress element while startup and the existing source wait run. Its static HTML
fallback works before Wasm initialization. After initialization,
`menu_loading::project_menu_loading` projects copied status observations and the
completed DOM-owner mount milestone. It reuses the existing StartPageView status
and busy policy; it owns no admission, readiness, session, retry or clock state.

The runtime hides this surface only after all selected owners mount successfully.
The Play panel uses its existing Rust `StartPageView.busy` and status text for a
passive native progress child. Root/control indices and lease schemas are stable.
The isolated loader preserves that owned status subtree on healthy notifications;
its existing module-error/deadline fallback can still reveal a terminal failure.
Pre-runtime local failures retain the original rejection with fixed fallback text.

The passive lease uses captured DOM construction/style/text operations, no timer,
RAF, progress percentage, automatic acquisition or new interaction. A containing
native label names progress; absence of a value keeps it indeterminate. Disposal
removes only its own still-current child; partial construction remains removable.
Stale documents are not repaired. First-thrown failures survive cleanup.

Focused authored native and Node/DOM/ABI-double tests cover delayed initialization,
source waiting, completed and failed handoff, stale settlements and cleanup. Real
Wasm/full checks and a combined loading/failure browser checkpoint are separate
verification phases. The earlier lifecycle run started at ready and does not
establish this new loading surface. There is no original geometry, spinner cadence,
pixel-equivalence, installed-host or full menu/graphical-preview claim.
