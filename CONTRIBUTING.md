# Contributing

Keep changes focused on the current Rust/Wasm browser prototypes. Read
[architecture](docs/architecture.md) and [provenance](docs/provenance.md) before
changing behavior. Describe supported inputs, failure cases, and evidence limits.

## Source boundaries

Commit original code and explicitly labelled synthetic fixtures. Keep official
client source, assets, credentials, and raw captures outside Git history, issues,
and pull requests. Use concise textual observations and public identifiers when
reporting comparisons. A passing repository guard does not prove authorship or
permission; review origin and attribution separately.

## Checks and review

Use Rust 1.99.0, Node.js 24, and wasm-bindgen CLI 0.2.129. Follow
[verification](docs/verification.md) for dependency installation, npm tests,
native Rust checks, the web build, Wasm ABI smoke test, and index/history guards.
Normal tests need no external reference and do not connect to game servers.
Enable the local hooks per clone:

```sh
git config core.hooksPath tools/hooks
```

Use LF text and Conventional Commits. Add focused tests for changed behavior and
report unrun checks. Consequential protocol, browser-security, or source-boundary
changes need independent review. Report external comparisons and browser or live
observations separately from build and synthetic test results.

Use the issue templates for reproducible bugs and bounded compatibility checks.
Live checks require separate explicit authorization for one attempt with a fixed
ledger; follow the manual-check limits in [verification](docs/verification.md).
Keep simulator and server changes in the separate
[slither-sim](https://github.com/NikitaMGrimm/slither-sim) project.

## Releases

Version `0.1.0-alpha.0` is unreleased. Release-plz remains dormant and there is no
release workflow. See [releases](docs/releases.md) before changing delivery.
MIT covers this project's authored files.
