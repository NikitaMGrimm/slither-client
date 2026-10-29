# Player appearance choices and saved preferences

The default entry enables `ownedMenuUi:true` alongside its existing owned Play
panel. Native buttons choose a built-in skin or build a custom stripe pattern:
choose a stripe/color, adjust its length, add/remove stripes, or reset appearance.
The nickname and appearance persist under the private `slither-client.menu.v1`
storage key. Changing choices or restoring storage never presses Play, acquires a
profile, selects an endpoint or starts a connection.

## Rust policy and wire contract

`menu_preferences::MenuPreferences` owns nickname validation, skin selection,
copied custom run bytes, menu actions/availability, display strings and the
versioned bounded persistence grammar. The minimal Wasm class copies every view
and custom byte array. It neither borrows a scene nor accesses browser APIs.

The installed menu selects built-ins 0 through 65 represented by the existing
stock resolver. Custom patterns retain stock palette IDs admitted by that
resolver: 0 through 35, 37, 39 and 41. Each positive byte count/palette pair follows
an authored zero-filled eight-byte prefix. At most 123 pairs fit the existing
255-byte login limit. No accessory ID is inferred from these bytes. Existing
custom composition/session request APIs retain their broader inputs unchanged.

The local menu exposes only the existing three authored families and their
stripe combinations. It does not substitute the local modulo-three resolver for
stock selection, or claim stock artwork. Restoring a choice unsupported by the
current route resets the complete preference record to defaults.

Nicknames retain the existing 24-byte ASCII domain, including DEL. Existing
native editing policy still normalizes input; the Rust menu validates its copied
result. `Reset appearance` retains the nickname. The native policy's explicit
`reset()` clears both nickname and appearance.

## Captured browser capabilities

The gate/local host capture a separate frozen `menuPreferences` sibling with
`schema`, exact `document`, `read`, `write` and `setNickname`. Storage uses captured
native methods and one fixed key. Reads are bounded to 600 code units before
Wasm copying; Rust bounds the ASCII record to 600 bytes before parsing. Invalid,
oversized, unknown-version or unsupported records restore defaults atomically.
Only nickname/skin/custom data is serialized; endpoint, profile and credentials
never enter this record. Blocked/quota-limited persistence keeps current in-memory
choices usable. The existing accessory/cosmetic reader is unchanged.

The existing controls lease keeps schema 1. Schema 2 adds a copied bounded list
of native menu action buttons. Trusted click admission, disabled/inert/visible
checks, exact current parents and deferred callback checks apply to every button.
Tab and native Enter/Space activation use those same leased controls. Original
event propagation stays fenced. Menu presses do not become game steering/boost;
releases retain the existing held-input cleanup path. Stale topology cancels
queued actions. Play's existing local/remote admission locks also disable the
menu, and chosen wire bytes enter the existing request before that lock is taken.

## Verification and remaining features

Authored native policy tests cover validation, copied arrays, complete restore,
reset, supported stock/local families, menu actions and bounds. Synthetic DOM and
full module-graph tests cover selection-to-login, reload restoration, captured
storage, quota failure, stale controls, native-default eligibility and locks.
The standard real-Wasm smoke includes policy/copy/restore/session-shape checks.
These tests do not execute a browser or establish installed/native-control pixels.

Graphical stock/color preview, original-style menu/loading, a full stock palette
and special artwork in the local route remain missing features. This first pass
uses native buttons and indexed skin/color labels; it has no graphical preview,
technical JSON/byte editor, downloader, secondary renderer or automatic Play.
Browser after-checks, trusted installed editing and loading/chooser visual
coverage remain separate. No reference or server execution is part of testing.
