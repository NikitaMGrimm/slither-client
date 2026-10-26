# Provenance and source boundaries

## External reference

The public official-client reference identifier is:

- URL: <https://slither.io/s/game1107249518.js>
- SHA-256: `5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095`
- Size: **224092 bytes**.

These identify the expected external research reference; this repository does
not vendor it or assert that the live URL still serves those bytes. Keep the
original local V3 reference outside this repository as well. A hash establishes
byte identity, not permission, authorship, or compatibility.

Research informed by human reading of official source is **not clean-room**.
Original implementation work must retain that distinction; do not describe a
human-source-derived port as independently specified clean-room work.

## What may be tracked

Track original authored Rust, tooling, documentation, and the original SVG logo
and icon.
Use concise textual observations and the public reference identifier above for
research notes. Synthetic fixtures must be explicitly labelled synthetic in
their content and accompanying description. They are not official captures.

Keep all of the following outside tracked history, including temporary commits:

- Official minified client JavaScript and readable translations.
- Copied implementation snippets, including dynamic challenge code.
- Source maps and source-restoration metadata.
- Official artwork and other official-client assets.
- Raw captures, recordings of protocol payloads, and the original local V3 reference.

Do not paste those materials into issues or pull requests. A later deletion
does not remove an artifact from Git history. Never import a reference merely
to make a test self-contained.

The repository guard inspects the Git index and all reachable historical blobs.
It detects known artifacts, forbidden paths and formats, and unsafe vectors;
it is **not ownership proof** for arbitrary new code. Its tests use synthetic
payloads. Review origin, permissions, and attribution separately from a passing
guard. See [verification](verification.md).

## Branding and license

The logo in `assets/logo.svg` is an original square angular snake and client
wordmark. Its blue palette, adaptive light/dark colors, and compact presentation
follow the visual family of the public
[slither-sim README](https://github.com/NikitaMGrimm/slither-sim/blob/bb9d457a9649ac7c6a63fdb3970b1a7f945f3366/README.md)
and [SVG](https://github.com/NikitaMGrimm/slither-sim/blob/bb9d457a9649ac7c6a63fdb3970b1a7f945f3366/assets/logo.svg),
inspected at `bb9d457a9649ac7c6a63fdb3970b1a7f945f3366`. It contains no official
game artwork or raster assets.

`assets/icon.svg` contains the same original snake symbol without the wordmark
in a square viewport. T3 Code discovers this file automatically as the project
icon; `assets/logo.svg` remains the wide README logo.

[MIT](../LICENSE) covers our authored files. It grants no license to official
client code or artwork. This project is independent of Slither.io and currently
makes no gameplay, server-compatibility, or parity claim.
