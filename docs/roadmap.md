# Roadmap

Version `0.1.0-alpha.0` contains bounded protocol and browser asset prototypes.
The local draw, selected offline comparisons, and one Node/WebSocket handshake
through setup have been demonstrated. See [verification](verification.md) for scope.

## 1. Decode synthetic client state and render it

Add decoded setup and entity state using explicitly labelled synthetic offline
fixtures. Build a deterministic minimal Canvas renderer for that state, then
integrate it with the separate [slither-sim](https://github.com/NikitaMGrimm/slither-sim)
server interface. Cover state transitions and rendering with focused tests and
browser evidence. Simulator results establish only the tested simulator path.

## 2. Package the browser client

After the state/rendering path works, add extension packaging with a documented
install and verification procedure. Input, connection flow, and gameplay still
need implemented and tested paths before claiming a fully playable client.

Keep [release configuration](releases.md) dormant until a releasable milestone
and its packaged contents have been reviewed.
