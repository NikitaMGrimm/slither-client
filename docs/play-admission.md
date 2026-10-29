# Explicit Play admission

`play_admission::PlayAdmission` owns the default menu's available/accepted state.
Availability observes the existing local route or captured remote profile
capability. It creates no capability, acquisition, connection or automatic retry.
Nickname checks reuse `MenuPreferences`; endpoint URL admission remains in JS.

After native field/endpoint checks and copied menu selection, `accept()` consumes
the attempt before the existing UI lock, preparing status and browser launch.
Exceptions during those effects leave it consumed. Remote attempts remain
one-shot, including errors and terminal session observations.

Only an accepted local attempt can prepare a return: copied phase `disconnected`,
or `victory` with `playing == false`. The runtime invokes native UI unlock, checks
its existing operation guard, then calls `complete_return()`. A thrown value or
caught reentry before completion cannot clear acceptance. Return itself launches
nothing; the next attempt requires explicit Play. Unknown phases grant no return.

`play_admission_browser::PlayAdmission` exposes only primitive copied observations
and commands. No Rust borrow spans JS callbacks. The runtime captures own-data
synchronous constructor/method capabilities, frees its owner during existing
cleanup, and retains document, topology, input, generation and promise guards.
Session protocol/lifecycle, source/profile one-shot behavior, selected bytes and
persisted nickname remain with their existing owners.

Authored native tests and explicit Node-only doubles cover the policy and existing
runtime seams. The flagged real-Wasm phase replays those same requirements with
the compiled admission class and separately checks menu-to-session login bytes.
These checks establish synthetic composition, without browser, installed UI,
profile HTTP, gameplay server or pixel acceptance. Menu/loading/graphical chooser
feature coverage remains separate.
