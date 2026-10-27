# Optional responsiveness experiments

Status: future-work design note, requested by the owner through the slither-sim
agent on 2026-10-27. These proposals are not implemented or approved for
implementation. Faithful stock behavior remains the default; any experiment
described here would be opt-in in our own client.

## Supplied latency observations

The slither-sim agent reported these observations from an external snapshot of
the pinned stock client `game1107249518.js`. They have not been independently
re-measured for this note. The reference identity and source boundary are
documented in [provenance](../provenance.md); no reference source or raw capture
is included here.

- Steering sends require more than 33 ms since the previous send and are
  quantized to 251 directions for protocol versions >= 5. Boost changes are
  sent at most every 50 ms.
- The stock client turns the eyes (`eang`) toward the mouse locally. Actual
  snake turning (`ang`/`wang`) follows server rotation packets, with no local
  prediction of the own snake's input-driven turning. Its visible turn therefore
  waits for the round trip.
- On a slither-sim host, the server reads inputs received during each 7 ms
  physics tick. Its default `responsive` delivery sends a changed wanted
  heading in the next frame; official pacing can hold it for up to six ticks
  (42 ms).

An illustrative budget at 40 ms ping is 0-33 ms of steering-send delay, about
40 ms round trip, 0-7 ms of tick wait, broadcast delay and about one rendered
frame. This is a rough supplied estimate, not a measurement of this Rust/Wasm
client or a guaranteed latency bound.

## Candidate experiments, in proposed priority order

1. **Predict own-snake turning locally.** Apply the server's turn model when
   input changes, then reconcile with authoritative rotation and position
   updates. This could hide the steering round trip and is expected to offer
   the largest perceived improvement. Visible corrections remain a risk around
   deaths, speed changes and the boost floor. It needs slither-sim's turn and
   speed model to keep corrections small.
2. **Shorten steering and boost throttles.** Consider reducing or removing the
   33 ms steering throttle and, with prediction, the 50 ms boost throttle.
   Verify how a slither-sim host handles several inputs within one physics tick
   before relying on more frequent sends.
3. **Improve interpolation for other snakes.** Explore a small jitter buffer
   and extrapolation tuned to measured frame pacing. This is a proposal to
   evaluate separately from faithful default interpolation.
4. **Explore WebTransport/QUIC datagrams.** A matching server transport could
   avoid a lost packet stalling later state behind a TCP WebSocket stream.
   The expected benefit is limited to lossy links; this requires separate
   transport design and does not replace stock-client compatibility.

## Constraints and ownership

- slither-sim must continue working with the unmodified stock client.
- These are opt-in client experiments; this note changes no timing, prediction,
  interpolation, input throttles, protocol or transport.
- A server counterpart, including a new transport or more frequent input
  handling, requires its own slither-sim design discussion.
- Preserve the faithful path and evaluate each experiment against measured
  behavior before deciding whether to implement or adopt it.
