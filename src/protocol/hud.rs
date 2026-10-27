//! Borrowed projections of canonical bare leaderboard and announcement commands.
//!
//! These explicit decoders do not change generic framing or state admission.
//! Names and messages remain raw Latin-1 bytes; scoring, text policy and HUD
//! lifecycle belong to callers. No parser or iterator allocates or mutates input.
//! Commands are bounded by [`super::MAX_FRAME_BYTES`] (1 MiB). Leaderboard
//! validation is linear with constant auxiliary storage; each row consumes at
//! least seven bytes. Announcement validation and field access take constant
//! work. Views borrow immutable input and retain no owned packet queue.

use std::{fmt, iter::FusedIterator};

use super::MAX_FRAME_BYTES;

/// Structural failures when decoding one bare HUD command.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HudPacketError {
    /// No opcode was supplied.
    EmptyCommand,
    /// The command exceeds the existing frame byte bound.
    CommandTooLarge,
    /// The opcode does not match the selected decoder.
    WrongOpcode,
    /// A required header, row prefix or declared name is incomplete.
    TruncatedPacket,
}

impl fmt::Display for HudPacketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::EmptyCommand => "HUD command has no opcode",
            Self::CommandTooLarge => "HUD command exceeds the frame byte bound",
            Self::WrongOpcode => "HUD command has the wrong opcode for this decoder",
            Self::TruncatedPacket => "HUD command has an incomplete header, row or name",
        })
    }
}

impl std::error::Error for HudPacketError {}

/// A leaderboard whose complete row tail has been validated.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Leaderboard<'a> {
    command: &'a [u8],
    row_count: usize,
}

impl<'a> Leaderboard<'a> {
    /// Wire local-row ordinal; zero may identify none. Independent of rank.
    pub fn local_row(&self) -> u8 {
        self.command[1]
    }

    /// Wire rank, including zero.
    pub fn rank(&self) -> u16 {
        u16::from_be_bytes([self.command[2], self.command[3]])
    }

    /// Wire total population, including zero.
    pub fn population(&self) -> u16 {
        u16::from_be_bytes([self.command[4], self.command[5]])
    }

    /// Number of complete rows, without a ten-row cap.
    pub fn row_count(&self) -> usize {
        self.row_count
    }

    /// Start an independent, infallible traversal in wire order.
    pub fn rows(&self) -> LeaderboardRows<'a> {
        LeaderboardRows {
            remaining: &self.command[6..],
            next_ordinal: 1,
            remaining_rows: self.row_count,
        }
    }
}

/// A lazy traversal of an already validated immutable leaderboard tail.
#[derive(Clone, Debug)]
pub struct LeaderboardRows<'a> {
    remaining: &'a [u8],
    next_ordinal: usize,
    remaining_rows: usize,
}

impl<'a> Iterator for LeaderboardRows<'a> {
    type Item = LeaderboardRow<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining_rows == 0 {
            return None;
        }
        // Only full-tail validation constructs this iterator; immutable borrows
        // preserve every checked prefix and name boundary for its lifetime.
        let end = 7 + usize::from(self.remaining[6]);
        let row = LeaderboardRow {
            bytes: &self.remaining[..end],
            ordinal: self.next_ordinal,
        };
        self.remaining = &self.remaining[end..];
        self.next_ordinal += 1;
        self.remaining_rows -= 1;
        Some(row)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining_rows, Some(self.remaining_rows))
    }
}

impl ExactSizeIterator for LeaderboardRows<'_> {}
impl FusedIterator for LeaderboardRows<'_> {}

/// A validated row borrowing its exact wire bytes; no snake ID is present.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct LeaderboardRow<'a> {
    bytes: &'a [u8],
    ordinal: usize,
}

impl<'a> LeaderboardRow<'a> {
    /// One-based position in the packet, independent of the header rank.
    pub fn ordinal(&self) -> usize {
        self.ordinal
    }

    /// Wire count, with no score calculation or table lookup.
    pub fn count(&self) -> u16 {
        u16::from_be_bytes([self.bytes[0], self.bytes[1]])
    }

    /// Wire u24 numerator divided by 16777215 in f64.
    pub fn fractional_mass(&self) -> f64 {
        f64::from(u24(&self.bytes[2..5])) / 16777215.0
    }

    /// Unmodified color byte; this is not a stock skin mapping.
    pub fn raw_color(&self) -> u8 {
        self.bytes[5]
    }

    /// Index into the nine-color leaderboard palette only.
    pub fn palette_index(&self) -> u8 {
        self.raw_color() % 9
    }

    /// Exact Latin-1 name bytes, including empty names and arbitrary byte values.
    pub fn name(&self) -> &'a [u8] {
        &self.bytes[7..]
    }
}

/// A validated public announcement, independent of local final-score state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Announcement<'a> {
    command: &'a [u8],
}

impl<'a> Announcement<'a> {
    /// Wire u24 count, without own adjustment or score calculation.
    pub fn count(&self) -> u32 {
        u24(&self.command[1..4])
    }

    /// Wire u24 numerator divided by 16777215 in f64.
    pub fn fractional_mass(&self) -> f64 {
        f64::from(u24(&self.command[4..7])) / 16777215.0
    }

    /// Exact Latin-1 name bytes, without decoding or name admission.
    pub fn name(&self) -> &'a [u8] {
        &self.command[8..8 + usize::from(self.command[7])]
    }

    /// Every remaining byte after the name, without an outgoing-editor cap.
    pub fn message(&self) -> &'a [u8] {
        &self.command[8 + usize::from(self.command[7])..]
    }
}

/// Validate one bare `l` command, including every row, before exposing its header.
///
/// No elapsed header or bundle is inferred. Header-only commands are valid;
/// zero rank/population and local-row values outside the row count are retained.
/// Errors check oversize, empty input, wrong opcode, then required boundaries.
pub fn parse_leaderboard(command: &[u8]) -> Result<Leaderboard<'_>, HudPacketError> {
    validate_opcode(command, b'l')?;
    let mut remaining = command.get(6..).ok_or(HudPacketError::TruncatedPacket)?;
    let mut row_count = 0;
    while !remaining.is_empty() {
        let prefix = remaining.get(..7).ok_or(HudPacketError::TruncatedPacket)?;
        let end = 7 + usize::from(prefix[6]);
        remaining = remaining
            .get(end..)
            .ok_or(HudPacketError::TruncatedPacket)?;
        row_count += 1;
    }
    Ok(Leaderboard { command, row_count })
}

/// Validate one bare `m` command before exposing any fields.
///
/// The declared name must be complete. Its entire remainder is the message;
/// either may be empty. No text, positive-score or playing policy is applied.
/// Errors check oversize, empty input, wrong opcode, then required boundaries.
pub fn parse_announcement(command: &[u8]) -> Result<Announcement<'_>, HudPacketError> {
    validate_opcode(command, b'm')?;
    let prefix = command.get(..8).ok_or(HudPacketError::TruncatedPacket)?;
    command
        .get(..8 + usize::from(prefix[7]))
        .ok_or(HudPacketError::TruncatedPacket)?;
    Ok(Announcement { command })
}

fn validate_opcode(command: &[u8], expected: u8) -> Result<(), HudPacketError> {
    if command.len() > MAX_FRAME_BYTES {
        return Err(HudPacketError::CommandTooLarge);
    }
    let opcode = command.first().ok_or(HudPacketError::EmptyCommand)?;
    if *opcode != expected {
        return Err(HudPacketError::WrongOpcode);
    }
    Ok(())
}

fn u24(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([0, bytes[0], bytes[1], bytes[2]])
}
