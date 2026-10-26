# Contributing

This is an unimplemented Rust/Wasm browser-client scaffold. Keep changes narrow
and describe the behavior actually implemented. Read [architecture](docs/architecture.md)
and [provenance](docs/provenance.md) before proposing client behavior.

## Source boundaries

Do not commit official minified JavaScript, readable translations, dynamic
challenge snippets, source maps, restoration metadata, official artwork or
assets, or raw captures. Keep the original local V3 reference outside this
checkout. Do not paste those materials into issues or pull requests either.
Use public reference identifiers and concise observations instead.

Write original implementations. Label every synthetic fixture as synthetic in
the fixture and its description; never present one as an official observation.
Human-source-derived port research is not clean-room work. The repository guard
detects known artifacts and unsafe formats; it cannot prove authorship or legal
permission. Review origin and attribution separately.

## Checks and review

Use Rust 1.99.0 and Node.js 24. Follow [verification](docs/verification.md) for
the required guard, Node tests, native Rust checks, doctests, and release Wasm
build. Tests must not connect to game servers or download official resources.
Stage only reviewed files before checking the index; also check all reachable
history before pushing. Enable hooks per clone:

```sh
git config core.hooksPath tools/hooks
```

Use LF text and Conventional Commits. Add focused tests for implemented behavior
and document unrun checks. Consequential protocol, browser-security, or source
boundary changes need independent review. A successful build is not evidence of
browser execution, server compatibility, or parity. Report those separately with
the reference fingerprint, environment, procedure, and limitations.

Use the issue templates for reproducible bugs and compatibility questions.
Include synthetic reproducers and textual observations, not restricted source or
captures. Keep simulator and server changes in the separate
[slither-sim](https://github.com/NikitaMGrimm/slither-sim) project.

## Releases

The version is `0.1.0-alpha.0`, unreleased. Release-plz is configured but disabled;
there is no release workflow. See [releases](docs/releases.md) before changing
versioning or delivery behavior. MIT covers this project's authored files, not
official client code or artwork.
