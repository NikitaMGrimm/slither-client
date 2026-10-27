# Borrowed HUD packet projections

`protocol::hud::parse_leaderboard` and `parse_announcement` explicitly decode
one bare command, including its opcode. They do not infer elapsed headers or
bundle lengths. Both reject commands above the existing 1 MiB frame bound.
Generic framing and state admission continue treating `l` and `m` as opaque;
these functions do not enable HUD handling automatically.

The returned views borrow immutable input. Their fields and constructors are
private, and parsing allocates no row/name/message storage. Raw name and message
bytes remain unchanged; decoding, name admission, text formatting and scoring
belong to later integration.

## Leaderboard

`parse_leaderboard(&[u8]) -> Result<Leaderboard<'_>, HudPacketError>` requires
opcode 108 and a six-byte header. It retains the local row byte, big-endian u16
rank and big-endian u16 population independently, including zero and unmatched
local-row values. A header without rows is valid.

Every row has a seven-byte prefix: u16 count, u24 mass numerator, raw color and
one-byte name length, followed by the complete name. Parsing validates the
entire tail before returning any view or header. A malformed final row rejects
the whole command. Fractional mass is the numerator divided by 16,777,215 in
f64; raw color and its modulo-nine leaderboard palette index remain separate.
There is no snake ID or score calculation.

`rows()` returns an independent `LeaderboardRows` iterator in wire order with
one-based ordinals. It is cloned, exact-size, fused and infallible after
validation. Blank names and rows beyond ten remain present. The byte bound
allows at most 149,795 rows; validation is linear with constant auxiliary
storage, without an arbitrary row-count cap.

## Public announcement

`parse_announcement(&[u8]) -> Result<Announcement<'_>, HudPacketError>` requires
opcode 109 and an eight-byte header. It projects the u24 count into u32, the
u24 mass numerator into f64 fractional mass, the complete declared name and
every remaining byte as the message. Empty name/message values are valid.
The outbound editor's name/message limits do not apply to these inbound bytes.
Validation and field access take constant work.

Both decoders return `HudPacketError`: `EmptyCommand`, `CommandTooLarge`,
`WrongOpcode` or `TruncatedPacket`. Error precedence is oversize, empty input,
wrong opcode, then incomplete required fields or name bytes.

## Scope

This slice supplies validated packet data, not a rendered HUD. It adds no
playing guard, rank state, score-table lookup, dirty-readout scheduling,
announcement replacement policy, game-over capture or Wasm export. Names may
contain arbitrary bytes; parser acceptance is not HTML or text-rendering
acceptance. Native synthetic tests and independent review cover the declared
parser boundary; browser, pixel, server and complete HUD behavior remain
unverified. See [verification](verification.md).
