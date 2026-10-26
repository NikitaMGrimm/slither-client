# Provenance and source boundaries

## Tracked material

Track original authored Rust, browser code, tooling, documentation, and the
original SVG logo and icon. Label synthetic fixtures explicitly in their content and
description. Keep official client source, assets, credentials, and raw captures
outside Git history, issues, and pull requests. External comparison inputs and
outputs must remain separate from this checkout.

The repository guard checks the Git index and reachable historical blobs for
known artifacts, prohibited paths/formats, and unsafe vectors. It cannot prove
ownership or permission for arbitrary code. Review origin and attribution
separately; see [verification](verification.md).

## Optional external reference

Comparison tooling expects this pinned external client:

- Public URL: <https://slither.io/s/game1107249518.js>
- SHA-256: `5ad8aa8f06d1e71bad2945001bab077f8d4d279c093a046d19b6f26ac6b62095`
- Size: **224092 bytes**.

The fingerprint identifies the expected bytes; it does not assert that the live
URL still serves them or establish permission or compatibility. The repository
does not include or download this reference. Optional archive requirements and
the bounded comparison results are documented in [verification](verification.md).

## Branding and license

`assets/logo.svg` uses an original C-shaped snake with an eye cutout and the
SlitherClient wordmark. It pairs with SlitherSim's S-shaped snake. The lettering
was typeset in [Inter Medium](https://github.com/rsms/inter) and converted to vector
paths. Inter is distributed under the [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt).
The SVG contains no official game artwork, scripts or external resources.

`assets/icon.svg` contains the same original snake symbol without the wordmark
in a square viewport. T3 Code discovers this file automatically as the project
icon; `assets/logo.svg` remains the wide README logo.

[MIT](../LICENSE) covers our authored files and grants no license to official
client code or artwork. This project is independent of Slither.io.
