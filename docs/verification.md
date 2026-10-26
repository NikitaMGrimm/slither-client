# Verification

The initial scaffold is checked natively and compiled to `wasm32-unknown-unknown`.
It is not yet a playable client or a browser extension. There are no Rust gameplay
tests yet because no gameplay code has been ported.

Run from the repository root with Rust 1.99.0 and Node.js 24 or newer:

```sh
node --test tools/*.test.mjs
cargo fmt --all --check
cargo test --all-targets --locked
cargo test --doc --locked
cargo clippy --all-targets --locked -- -D warnings
cargo build --release --locked --target wasm32-unknown-unknown
```

The Rust toolchain file installs the required target and components. Cargo's
`target/` directory belongs to this checkout; do not reuse a running agent's
target directory or modify `slither-sim` to build this project.

Before a commit, stage the intended files and inspect the index:

```sh
git add <reviewed-paths>
git diff --cached
node tools/check-repository.mjs
```

Before a push, also inspect reachable Git history:

```sh
node tools/check-repository.mjs --history
```

The pre-push hook additionally reads Git's outgoing object IDs and their ancestry,
including a commit pushed by SHA after local branches stop referencing it.
The guard reads staged and committed Git blobs rather than trusting the current
working tree. Its synthetic regression cases cover permitted original code,
forbidden artifact paths, renamed known content fingerprints, embedded source
maps, binary payloads, unsafe vector resources, and artifacts removed in a later
commit, and outgoing history not reachable from current local refs. Synthetic
forbidden payloads never contain official-client source.

Enable the local pre-commit and pre-push checks in each clone:

```sh
git config core.hooksPath tools/hooks
```

CI runs the guard and its tests on Linux, native Rust checks on Linux and Windows,
and a release Wasm build on Linux. Actions are SHA-pinned, use read-only repository
permissions, disable persisted checkout credentials, and have bounded timeouts.
Old checks are cancelled when superseded. Builds and tests do not contact game
servers or fetch official-client resources. Toolchain/action installation can
access their normal package sources.

These checks establish repository boundaries and compilation. They do not prove
ownership of arbitrary new code, protocol parity, graphical fidelity, official
server acceptance, browser execution, extension-store approval, or gameplay
performance. Review origin and attribution for every contribution. Local reference
comparisons are a separate, explicitly reported check using external reference
files; see [provenance](provenance.md) and [roadmap](roadmap.md).
