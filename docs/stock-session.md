# Caller-owned stock session

`createStockSession` in `web/stock-session.mjs` owns the authored handshake,
ping/lag and life-end state machine. Construction and subscription open no
socket. The caller supplies the clock, socket factory and complete packet sink;
the module creates no timer, scene, asset or directory probe.

An explicit Play requires one selected literal-IP endpoint and an external
profile containing `clientVersion`, a 20-byte `password` and protocol version
19. These values are not readable host globals. The module does not extract,
fetch, persist or supply defaults for them. Missing or invalid input leaves the
session ready with zero socket constructors.

Play validates and encodes the request, then stages a world reset. In the native
pre-motion callback, `afterStep` offers closed reset/connection actions. Only
`commitControl`, called after the entire successful controller operation outside
the Rust borrow, acknowledges the reset and constructs the selected socket once.
A failed or cancelled staged operation opens none. There is no automatic retry,
fallback endpoint or reconnect; a later manual attempt uses a new session.

The session sends the ordinary untimed negotiation prefixes, uses the existing
closed Rust challenge solver, and sends the encoded login. Unsupported
challenges fail. The complete Setup frame, including trailing commands, reaches
the packet sink exactly once. Session controls commit after that sink succeeds.
Setup establishes connected/playing state before own appearance. Removing the
own snake does not end the session; explicit life-control packets do.

The alternative `subscribeWithHud` uses the same staged controls and publishes
a copied command-indexed report before state notification. It requires a
synchronous complete-packet report producer; see the
[opt-in planning contract](stock-client.md#opt-in-session-hud-planning).
The existing subscription remains the default gameplay path.

One outstanding ping uses the original strict timing gates. Pong clears pending
and lag status, allowing gradual clock recovery; it does not reset the lag
multiplier. Game-over lag resets are offered through `pendingActions` and
selectively acknowledged outside the native borrow before the next clock step.
That acknowledgement cannot consume a pending world reset.

The caller composes [desktop input](stock-client.md) by accumulating arrow debt,
processing lifecycle actions, then sending input with zero additional whole
steps. Ping occupies the hook between keyboard and boost. Session state/error
notifications must latch information and defer scene mutation or teardown until
the owning operation unwinds. `commitControl` follows only successful operations.

The caller also owns the separate captured 25-ms login-fade timer while
`uiTimerNeeded` is true and reconciles the returned `uiTick` snapshot. Normal
life return uses the same lagged animation delta before input and motion.
The opt-in `afterStepWithHud` facade returns copied branch-local return edges
beside the same actions; see [same-step observations](hud-ingress.md#same-step-lifecycle-observation).
It neither advances another clock nor changes the existing commit latch.
Victory message submission and the complete stock UI remain unsupported.

Tests use authored profiles, challenges and socket doubles. Real-Wasm checks
exercise login encoding, challenge solving, complete frame application and
same-clock lifecycle/input composition without network activity. They do not
establish browser CSP/Origin compatibility, live credentials, original UI,
extension gameplay or server acceptance.
