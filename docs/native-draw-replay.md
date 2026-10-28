# Native draw-list replay

The fast native tier replays an authored synthetic packet recording through
`AnimatedClient` and `plan_standard_body`. It needs no browser, Wasm build,
external capture, original program, artwork, simulator or game server.

```sh
cargo test --test render_replay --locked
cargo bench --bench draw_list --locked -- --measure
```

The shared recording in `tests/support/draw_list_fixture.rs` builds immutable
packet batches and fixed 60 Hz timestamps before replay. Its 96 frames start
with 40 snakes and 48 anchors per appearance. Thirty-two snakes start inside
the 1500 by 938 view and eight outside. Alternate snakes boost. Ordered anchors,
growth, death, replacement of the dying wire ID, immediate removal and a 24-frame
low-quality interval exercise retained state, culling and pass selection.
This schedule is authored test data, not a recording of another implementation.

The test compares complete prepared geometry and ordered body plans from two
fresh clients at every frame, including command floating-point bits and signed
zero. Eight checked-in structural snapshots pin body counts, per-pass counts
and an order-sensitive fingerprint of sequence, pass, ordinal and asset index.
The fingerprint is a compact regression checksum, not a cryptographic proof.
Floating-point values are compared within the same process, not pinned across
native libm implementations or browser Math. A separate packet/quality witness
checks that removing the death event changes output and LQ removes quality passes.
Snapshots describe the existing authored implementation; they are not a reference
oracle or pixel acceptance.

The dependency-free benchmark uses `Instant` and `black_box` in the normal release
profile. One untimed warmup precedes five samples. Each sample starts from a fresh
client, consumes all frames and checks the same body/command totals. It reports
microseconds per frame for ingress, update, public numeric draw preparation and
standard-body planning, plus their enclosing total. The total includes output
destruction, counters and timer overhead; initial packet application, recording
construction and client teardown are excluded. Frames without packets contribute
to the ingress denominator. Public atomic APIs include their staged clones.
Timing samples require `--measure`; without it, including under
`cargo test --all-targets`, the benchmark runs one replay and checks the pinned
3,065 body plans and 1,289,338 image commands, without timing assertions.

This measures native CPU wall time only. Faces, accessories, food/prey plans,
backgrounds, nickname/minimap/HUD, source-provider conversion, browser bridge,
Canvas submission, rasterization and GPU completion are excluded. No output
timing is a CI threshold or a claim about the measured browser gap. Browser work
belongs to the separately owned scripted pipeline. No renderer policy changed.

## Bounded baseline observation

Three local release invocations on Rust 1.99.0, each with one warmup and five
samples, produced the following total CPU wall times. The shared 16-logical-CPU
Windows host had concurrent application/agent activity; the second invocation
also overlapped this lane's tooling/Wasm checks. No workload or production code
changed between these invocations.

| Invocation | Median us/frame | Range us/frame |
| --- | ---: | ---: |
| Initial | 789.130 | 767.649 to 832.113 |
| Concurrent checks | 895.474 | 839.627 to 1218.525 |
| Later shared-host run | 2273.995 | 1382.760 to 2324.721 |

All samples completed with the same 3,065 plans and 1,289,338 commands; focused
debug and release tests passed the complete output comparisons and snapshots.
Retain the spread: this is a reproducible workload baseline, not an isolated
hardware result or a performance comparison. No unchanged side was selected as
a winner. The replay excludes browser drawing and differs from the private
browser recording, so its timing cannot explain or subtract from that gap.

The authored per-frame path inspection found bounded staged clones in public
ingress, update and draw preparation, curve sampling/culling, geometry snapshots,
and command validation/allocation. The measured stages distribute cost among
these phases; they do not isolate any clone or allocation as a causal hotspot.
Atomic staging is a rollback safeguard. No measured narrow correction was
established, so this change preserves those safeguards and adds the replay tier
needed to assess future candidates with unchanged output.

## Development notes

The first focused compile rejected the fixture's nonexistent `BodyPaintPass::Shadow`;
the snapshot mapper was corrected to the actual near-head and tail passes. The
initial snapshot assertion intentionally compared against a placeholder before
the existing authored output was inspected and pinned. Both are fixture bring-up
results, not product regressions.
The first integrated run also showed Cargo invokes harness-free benches without
`--test` on this host. Timing now requires `--measure` explicitly, keeping normal
all-target tests on the count-only path.
