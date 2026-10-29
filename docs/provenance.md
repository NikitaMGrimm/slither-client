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
does not include this reference. Development tooling, normal tests and CI do not
download it or use its contents as a passing fixture. Optional archive requirements
and bounded comparison results are documented in [verification](verification.md).

## Explicit Play profile acquisition

An optional runtime exception permits one explicit Play acquisition in the
canonical, top-level, secure `https://slither.io` document. Authored code may
request only the pinned URL above as inert bytes, using captured native fetch
with credentials omitted, redirects rejected, no cache and no referrer. It must
observe complete EOF, the exact decoded size and full SHA-256 before parsing the
two pinned numeric declarations with a closed data grammar. It never evaluates,
imports or invokes the downloaded program.

Acquisition permits one attempt per document, at most 224092 decoded bytes,
1024 reader calls including EOF and a 5000 ms total deadline. Source drift,
cancellation, unsupported capabilities or malformed data stop the attempt
without a game socket, default profile, fallback request or automatic retry.
External caller profiles remain an explicit separate path.

The owned source and digest buffers clear before the private synchronous
authored consumer runs; its borrowed password clears afterward, including on
failure. Source/profile values must not be persisted, logged, exposed through
messages/globals/diagnostics or returned from acquisition. Browser/native
internal copies cannot be guaranteed erased. A matching fetch identifies only
the returned bytes, not the executed page program, asset compatibility, server
freshness or acceptance.

The closed literal grammar runs in browser-free Rust. Only the two admitted
declaration spans are scalar-copied to a new bounded Wasm scratch owner; the
complete program is never copied into Wasm, decoded to a string or evaluated.
Input regions clear after parsing, and the boundary explicitly clears live
Wasm input/output storage before freeing it on success and failure. Its copied
20-byte JS password retains the existing captured-native allocation and cleanup
order. Source and digest buffers still clear before the synchronous consumer,
and the borrowed password clears afterward. JS scalar arguments, compiler/register
temporaries and browser/native internal copies cannot be guaranteed erased;
this does not replace explicit clearing of authored owned buffers. The retained
JS grammar oracle and ABI double are labelled tools-only synthetic test support,
with no production import or fallback.

The captured capabilities, acquirer and final session/bootstrap composition need
independent current-code review before shipping. Agent-run HTTP verification
requires a separate exact one-request/no-session/no-socket authorization. Game
connections retain the manual single-attempt ledger requirements; this exception
does not renew or bypass a consumed ledger.

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
