# Roadmap

Current status: **unimplemented scaffold**, `0.1.0-alpha.0`. No milestone below
has been demonstrated by the scaffold's compilation checks.

## 1. Prove the official-page asset bridge and handshake

Use the external local reference identified in [provenance](provenance.md).
Keep its files, assets, and captures outside this repository. Establish how
original client code can integrate with the official page's asset boundary and
reproduce the required handshake behavior without committing reference source
or dynamic challenge snippets.

Record the reference fingerprint, browser environment, procedure, textual
observations, and failure cases. Separate evidence from a local comparison from
official-server acceptance. Any later online check needs explicit scope and
must stay outside automated offline tests. Label synthetic regression fixtures
as synthetic. Completion requires observed bridge and handshake behavior, not
just a Wasm build. Current scaffold parity remains unclaimed.

## 2. Implement the smallest playable client

After the first milestone, add the minimum input, network decoding, client
state, and rendering needed for a documented playable path. Add focused tests
and browser evidence as each behavior lands. Describe exact supported behavior
and known gaps; do not imply general server compatibility.

## 3. Evaluate delivery

Choose packaging and version boundaries after a playable milestone is verified.
Browser-extension delivery is a future decision, not current functionality.
Keep [release configuration](releases.md) disabled until the first releasable
client is ready. Review source provenance and packaged files before enabling
any delivery action.
