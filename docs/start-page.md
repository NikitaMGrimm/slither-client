# Start and ready view

The default local and packaged game entries display nickname and Play controls
in a responsive centered panel with the project's original `assets/logo.svg`.
The technical server-address row and ordinary Reload control are hidden in this
consumer entry. Explicit runtime composition retains diagnostic controls through
`diagnosticUi: true` (the runtime factory's default). The configured endpoint node,
native labels, 24-byte nickname editor, endpoint validation and single explicit
Play admission are retained. Local startup still presets only its selected
loopback endpoint; hiding the row supplies no remote endpoint or connection.
The logo is packaged byte for byte at its approved asset path. No new artwork
or external source is included.

`src/start_page.rs` projects fixed status text, busy button text, disabled state
and panel visibility. `src/start_page_browser.rs` copies that result through the
`start_page_view` Wasm ABI. The DOM owner applies the copied projection through
captured native operations; `extension/start-page-layout.mjs` supplies authored
CSS composition only. It adds no timer, transition clock or connection state.

The panel stays hidden whenever the existing session reports `playing: true`,
including its death/return interval. A committed return or disconnect makes it
visible again. Only the existing local session owner may release the admission
lock; the remote attempt remains one-shot. A separate end-screen owner can mount
as a root sibling below the panel without changing the Play nodes or their
control leases.

Tab and Shift+Tab keep native defaults among the current owned endpoint,
nickname and eligible Play button. Enter and Space retain native activation
only on the focused eligible button. Enter in a field has no Play shortcut.
The extension still fences original handlers and requires the subsequent trusted
click to pass the existing visibility, disabled, topology, scheduling and
admission checks. Local native buttons retain their keyboard defaults too.
Hidden, disabled, stale or unregistered extension controls gain no activation
authority. No scripted focus change is introduced.

## Evidence and limits

The authored coverage ledger records MENU-01 and DRAW-06 as partial. It identifies
the start-page/layout gap but supplies no exact logo placement, responsive
dimensions, original focus timing, spinner or transition recipe for this lane.
This change supplies a bounded authored start/ready composition and busy readout;
it does not assert exact original layout pixels, spinner/transition or focus
parity, localization, installed-host/CSP support, profile acquisition or server
acceptance. Coverage counts remain unchanged pending main's reassessment.

Native tests exercise readiness, validation, busy, playing, return and retained
locks. Synthetic DOM and full-module graph tests cover the original node
relationships, hidden gameplay panel, existing return-to-Play path, native
keyboard-default confinement, guarded failures and cleanup. The normal
`tools/wasm-smoke.mjs` suite executes the new projection on real Wasm through
`tools/start-page-smoke.mjs`. Package and route tests check the allowlisted module
and logo. These checks need no reference files or game server. Browser screenshot
and keyboard-default observations remain separate evidence.
