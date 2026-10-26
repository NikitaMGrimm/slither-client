# Working in this repository

This is an unimplemented Rust/Wasm browser-client scaffold, version
`0.1.0-alpha.0`. Read `README.md`, `docs/architecture.md`, `docs/provenance.md`,
and `docs/verification.md` before changing behavior. Keep changes narrow and
preserve unrelated work. Do not claim gameplay, extension support, browser
execution, server compatibility, or parity without the corresponding evidence.

## Source boundary

Keep official client code, readable translations, dynamic challenge snippets,
source maps, restoration metadata, official assets and artwork, and raw captures
outside tracked history. The original local V3 reference stays outside this
repository. Do not copy implementation snippets from it. Record only the public
reference URL, fingerprint, and concise research observations permitted by
`docs/provenance.md`. Label synthetic fixtures explicitly. Human-source-derived
port research is not clean-room work.

Run `node tools/check-repository.mjs` against the reviewed Git index and
`node tools/check-repository.mjs --history` before delivery. The guard checks
known artifacts and file boundaries, not ownership. Never weaken it to admit a
reference artifact. Only the original `assets/logo.svg` and `assets/icon.svg`
vectors are permitted; keep them free of scripts and external resources.

## Implementation and verification

Use Rust 1.99.0, Node.js 24, LF text, and Conventional Commits. There are no
runtime dependencies or gameplay APIs yet; do not add speculative infrastructure.
Keep authoritative world simulation in the separate `slither-sim` repository.
Do not modify that checkout or an external local reference as a side effect.

Follow `docs/verification.md`: run the repository guard and history guard,
`node --test tools/*.test.mjs`, `cargo fmt --check`,
`cargo test --all-targets --locked`, `cargo test --doc --locked`,
`cargo clippy --all-targets --locked -- -D warnings`, and
`cargo build --release --locked --target wasm32-unknown-unknown`.
Tests stay offline from game servers and official-client resources. Distinguish
compilation, synthetic tests, external reference comparisons, and browser or
server verification; state exact limits and unrun checks. Native Rust currently
has zero gameplay tests.

CI runs on pushes to `main`, pull requests, and `workflow_dispatch`.
Release-plz configuration is intentionally disabled until the first releasable
client. There is no release workflow. Follow `docs/releases.md`; never turn a
check or ordinary push into publication.

## Independent review

Obtain independent review for consequential protocol, security, source boundary,
or behavior changes. Use T3 Code's app-owned `delegate_task` and continue the same
review conversation with `t3_thread_send`. Discover the configured provider and
model through `orchestrator_capabilities`; select the user's chosen **GPT 6.1
Sol**, with `reasoningEffort: high`, explicitly in the target options. Do not
substitute another model or delegation route when unavailable; report the
limitation and continue independent work. Keep reviewers read-only and retain
task IDs and terminal reports. The main agent evaluates findings against the
requirements and verification evidence.
