# Architecture

## Current scaffold

The repository defines a Rust library built as `rlib` and `cdylib`, with
`wasm32-unknown-unknown` as the browser-oriented compilation target. Version
`0.1.0-alpha.0` has no runtime dependencies and no gameplay APIs. The scaffold
does not load a page, bridge assets, perform a handshake, render a world, or
provide an extension. Native and Wasm builds establish compilation only.

## Client scope

Future implementation belongs on the browser side: page integration, input,
network decoding, client state, and rendering. These are areas of work, not
existing modules or stable interfaces. Establish the asset bridge and handshake
first, using the [roadmap](roadmap.md), before choosing further abstractions.

[slither-sim](https://github.com/NikitaMGrimm/slither-sim) owns the separate
authoritative simulator and server. A client receives server state; it does not
establish official world rules. Success against that simulator alone would not
prove official-server acceptance or official-client parity.

## Reference boundary

The official client and the original local V3 reference remain external to this
repository. Research may inform original authored code, but copied client source,
translations, challenge snippets, assets, raw captures, and source-restoration
materials do not belong in tracked history. See [provenance](provenance.md).

Introduce tests alongside behavior. Keep synthetic fixtures explicitly labelled
and separate from descriptions of external observations. Record what a
comparison demonstrates and what remains unverified; see
[verification](verification.md).
