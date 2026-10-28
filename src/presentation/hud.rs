//! Opt-in command-indexed observations; owned rows live only in schema-2 reports.

use std::{error::Error, fmt};

use super::{ClientScoreView, SnakeObjectToken};
use crate::{
    protocol::{
        MAX_FRAME_BYTES, MAX_FRAME_COMMANDS,
        hud::{HudPacketError, Leaderboard},
    },
    state::FrameReport,
};

/// Private session decisions immediately before one original wire command.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HudCommandGuard {
    /// Session playing flag, independent of connection and native draw membership.
    pub playing: bool,
    /// Session close request already pending at this command.
    pub close_requested: bool,
    /// Session death timestamp already present, rather than a life-ended flag.
    pub death_pending: bool,
}

/// Borrowed explicitly versioned plan; callers may own its backing vectors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HudIngressPlan<'a> {
    /// One for header-only observations, two to also retain raw leaderboard rows.
    pub schema: u8,
    /// Original wire command count, in 1..=4096.
    pub command_count: usize,
    /// Exactly one pre-command decision per original command.
    pub guards: &'a [HudCommandGuard],
    /// Strictly increasing, exhaustive accepted non-2 v command indices.
    pub final_capture_indices: &'a [usize],
}

/// Bounded admission errors, without raw command or text copies.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HudIngressError {
    /// Schema or collection bounds are invalid.
    InvalidPlan,
    /// Plan count differs from the decoded frame.
    CommandCountMismatch,
    /// Capture positions are unsorted, duplicate, missing or extraneous.
    InvalidCaptureIndices,
    /// A pong/game-over envelope or repeated challenge is inadmissible.
    InvalidControl(u8),
    /// Full leaderboard validation failed, including an ignored-playing tail.
    Leaderboard(HudPacketError),
    /// Selected announcement admission or command-time scoring failed.
    Announcement(super::AnnouncementError),
    /// Aggregate leaderboard bounds or fallible owned-buffer reservation failed.
    LeaderboardRowsResource,
}

impl fmt::Display for HudIngressError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPlan => f.write_str("invalid HUD plan schema or bounds"),
            Self::CommandCountMismatch => f.write_str("HUD command count mismatch"),
            Self::InvalidCaptureIndices => f.write_str("HUD final capture indices mismatch"),
            Self::InvalidControl(code) => write!(f, "invalid HUD control opcode {code}"),
            Self::Leaderboard(error) => error.fmt(f),
            Self::Announcement(error) => error.fmt(f),
            Self::LeaderboardRowsResource => {
                f.write_str("HUD leaderboard row resource limit exceeded")
            }
        }
    }
}

impl Error for HudIngressError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Leaderboard(error) => Some(error),
            Self::Announcement(error) => Some(error),
            _ => None,
        }
    }
}

impl HudIngressPlan<'_> {
    pub(crate) fn validate(self, commands: &[&[u8]]) -> Result<(), HudIngressError> {
        if !matches!(self.schema, 1 | 2)
            || !(1..=MAX_FRAME_COMMANDS).contains(&self.command_count)
            || self.guards.len() != self.command_count
            || self.final_capture_indices.len() > self.command_count
        {
            return Err(HudIngressError::InvalidPlan);
        }
        if commands.len() != self.command_count {
            return Err(HudIngressError::CommandCountMismatch);
        }
        if self
            .final_capture_indices
            .iter()
            .any(|&index| index >= self.command_count)
            || self
                .final_capture_indices
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
        {
            return Err(HudIngressError::InvalidCaptureIndices);
        }
        let mut captures = self.final_capture_indices.iter().copied().peekable();
        for (index, (&command, guard)) in commands.iter().zip(self.guards).enumerate() {
            match command[0] {
                b'p' if command.len() != 1 => return Err(HudIngressError::InvalidControl(b'p')),
                b'v' if command.len() != 2 => return Err(HudIngressError::InvalidControl(b'v')),
                b'6' => return Err(HudIngressError::InvalidControl(b'6')),
                _ => {}
            }
            let expected =
                command[0] == b'v' && command[1] != 2 && guard.playing && !guard.close_requested;
            let supplied = captures.peek() == Some(&index);
            if expected != supplied {
                return Err(HudIngressError::InvalidCaptureIndices);
            }
            if supplied {
                captures.next();
            }
        }
        Ok(())
    }
}

/// One immutable-by-report command-time semantic observation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HudIngressEvent {
    /// Zero-based ORIGINAL wire command position, including opaque controls.
    pub command_index: usize,
    /// Copied semantic payload with no rows, names, packets or callbacks.
    pub kind: HudIngressEventKind,
}

/// The minimal packet journal; score views use the existing native representation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HudIngressEventKind {
    /// Table cache has been updated, before the existing Setup callback.
    Setup {
        /// Active positive Setup score-table parameter.
        table_max: u16,
    },
    /// Score observation after that successful callback, without an extra draw.
    SetupDraw {
        /// Exact client observation after the existing callback succeeds.
        view: ClientScoreView,
    },
    /// An actual original-own length scheduling operation, including equal requests.
    OwnLengthScheduled {
        /// Retained original own identity, independent of addressable wire IDs.
        token: SnakeObjectToken,
    },
    /// Fully validated header while the supplied pre-command playing flag is true.
    Leaderboard {
        /// Raw one-byte local row position, including zero.
        local_row: u8,
        /// Header rank, including zero, without a row-order reduction.
        rank: u16,
        /// Header population, independent of the received snake collection.
        population: u16,
        /// Supplied pre-command death timestamp presence.
        death_pending: bool,
    },
    /// Required ready score frozen at the exact accepted v boundary.
    FinalScore {
        /// Existing score representation, guaranteed to have Ready status.
        view: ClientScoreView,
    },
}

/// One owned raw row, without text admission, score calculation or snake identity.
#[derive(Clone, Debug, PartialEq)]
pub struct HudLeaderboardRow {
    ordinal: u32,
    count: u16,
    fractional_mass: f64,
    raw_color: u8,
    palette_index: u8,
    name: Vec<u8>,
}

impl HudLeaderboardRow {
    /// One-based original row position, independent of header rank.
    pub fn ordinal(&self) -> u32 {
        self.ordinal
    }
    /// Unadjusted wire count.
    pub fn count(&self) -> u16 {
        self.count
    }
    /// Exact existing decoder f64 division, without score arithmetic.
    pub fn fractional_mass(&self) -> f64 {
        self.fractional_mass
    }
    /// Unmodified color byte.
    pub fn raw_color(&self) -> u8 {
        self.raw_color
    }
    /// Nine-color leaderboard palette index.
    pub fn palette_index(&self) -> u8 {
        self.palette_index
    }
    /// Exact raw bytes, including empty names and arbitrary byte values.
    pub fn name(&self) -> &[u8] {
        &self.name
    }
}

/// One playing leaderboard command, including a header-only empty board.
#[derive(Clone, Debug, PartialEq)]
pub struct HudLeaderboardRows {
    command_index: usize,
    rows: Vec<HudLeaderboardRow>,
}

impl HudLeaderboardRows {
    /// Zero-based original wire position, including preceding opaque commands.
    pub fn command_index(&self) -> usize {
        self.command_index
    }
    /// Rows in original wire order.
    pub fn rows(&self) -> &[HudLeaderboardRow] {
        &self.rows
    }
}

/// Shared by all boards in one report; bounds derive from the complete frame.
#[derive(Default)]
pub(crate) struct HudLeaderboardRowsBudget {
    rows: usize,
    wire_bytes: usize,
}

impl HudLeaderboardRowsBudget {
    fn charge(&mut self, rows: usize, wire_bytes: usize) -> Result<(), HudIngressError> {
        let rows = self
            .rows
            .checked_add(rows)
            .ok_or(HudIngressError::LeaderboardRowsResource)?;
        let wire_bytes = self
            .wire_bytes
            .checked_add(wire_bytes)
            .ok_or(HudIngressError::LeaderboardRowsResource)?;
        if rows > (MAX_FRAME_BYTES - 6) / 7 || wire_bytes > MAX_FRAME_BYTES {
            return Err(HudIngressError::LeaderboardRowsResource);
        }
        self.rows = rows;
        self.wire_bytes = wire_bytes;
        Ok(())
    }

    pub(crate) fn copy_board(
        &mut self,
        command_index: usize,
        board: Leaderboard<'_>,
    ) -> Result<HudLeaderboardRows, HudIngressError> {
        let mut wire_bytes = 6_usize;
        for row in board.rows() {
            wire_bytes = wire_bytes
                .checked_add(7)
                .and_then(|n| n.checked_add(row.name().len()))
                .ok_or(HudIngressError::LeaderboardRowsResource)?;
        }
        self.charge(board.row_count(), wire_bytes)?;
        let mut rows = Vec::new();
        rows.try_reserve_exact(board.row_count())
            .map_err(|_| HudIngressError::LeaderboardRowsResource)?;
        for row in board.rows() {
            let mut name = Vec::new();
            name.try_reserve_exact(row.name().len())
                .map_err(|_| HudIngressError::LeaderboardRowsResource)?;
            name.extend_from_slice(row.name());
            rows.push(HudLeaderboardRow {
                ordinal: u32::try_from(row.ordinal())
                    .map_err(|_| HudIngressError::LeaderboardRowsResource)?,
                count: row.count(),
                fractional_mass: row.fractional_mass(),
                raw_color: row.raw_color(),
                palette_index: row.palette_index(),
                name,
            });
        }
        Ok(HudLeaderboardRows {
            command_index,
            rows,
        })
    }
}

/// Owned bounded result. No journal is retained by the client after returning it.
#[derive(Clone, Debug, PartialEq)]
pub struct HudIngressReport {
    schema: u8,
    report: FrameReport,
    setup_draws: usize,
    events: Vec<HudIngressEvent>,
    leaderboard_rows: Vec<HudLeaderboardRows>,
}

impl HudIngressReport {
    pub(crate) fn new(
        report: FrameReport,
        schema: u8,
        boards: usize,
    ) -> Result<Self, HudIngressError> {
        let event_capacity = report
            .commands
            .checked_mul(2)
            .ok_or(HudIngressError::LeaderboardRowsResource)?;
        if report.commands > MAX_FRAME_COMMANDS || boards > report.commands {
            return Err(HudIngressError::LeaderboardRowsResource);
        }
        let mut events = Vec::new();
        events
            .try_reserve_exact(event_capacity)
            .map_err(|_| HudIngressError::LeaderboardRowsResource)?;
        let mut leaderboard_rows = Vec::new();
        leaderboard_rows
            .try_reserve_exact(boards)
            .map_err(|_| HudIngressError::LeaderboardRowsResource)?;
        Ok(Self {
            schema,
            report,
            setup_draws: 0,
            events,
            leaderboard_rows,
        })
    }
    pub(crate) fn push_leaderboard_rows(&mut self, rows: HudLeaderboardRows) {
        debug_assert!(self.leaderboard_rows.len() < self.leaderboard_rows.capacity());
        self.leaderboard_rows.push(rows);
    }
    pub(crate) fn push(&mut self, command_index: usize, kind: HudIngressEventKind) {
        debug_assert!(self.events.len() < 2 * self.report.commands);
        self.events.push(HudIngressEvent {
            command_index,
            kind,
        });
    }
    pub(crate) fn setup_draw(&mut self, command_index: usize, view: ClientScoreView) {
        self.setup_draws += 1;
        self.push(command_index, HudIngressEventKind::SetupDraw { view });
    }
    /// Explicitly selected schema, one or two.
    pub fn schema(&self) -> u8 {
        self.schema
    }
    /// Owned command-time raw boards; empty in schema one.
    pub fn leaderboard_rows(&self) -> &[HudLeaderboardRows] {
        &self.leaderboard_rows
    }
    /// Original wire commands, including opaque commands and no-event controls.
    pub fn command_count(&self) -> usize {
        self.report.commands
    }
    /// Successful existing Setup callbacks, not proof of Canvas submission or pixels.
    pub fn setup_draws(&self) -> usize {
        self.setup_draws
    }
    /// Read-only journal with at most twice the command count entries.
    pub fn events(&self) -> &[HudIngressEvent] {
        &self.events
    }
    /// Existing received-state command counts for this same transaction.
    pub fn frame_report(&self) -> FrameReport {
        self.report
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaderboard_budget_is_shared_inclusive_and_rejects_overflow_without_charging() {
        let mut budget = HudLeaderboardRowsBudget::default();
        budget.charge(100_000, 700_006).unwrap();
        budget.charge(49_795, MAX_FRAME_BYTES - 700_006).unwrap();
        for (rows, bytes) in [(1, 0), (0, 1), (usize::MAX, 0), (0, usize::MAX)] {
            assert_eq!(
                budget.charge(rows, bytes),
                Err(HudIngressError::LeaderboardRowsResource)
            );
            assert_eq!(budget.rows, 149_795);
            assert_eq!(budget.wire_bytes, MAX_FRAME_BYTES);
        }
    }

    #[test]
    fn leaderboard_report_rejects_size_overflow_and_board_count_before_reservation() {
        for (commands, boards) in [(usize::MAX, 0), (MAX_FRAME_COMMANDS + 1, 0), (1, 2)] {
            assert_eq!(
                HudIngressReport::new(
                    FrameReport {
                        commands,
                        ignored: 0
                    },
                    2,
                    boards
                ),
                Err(HudIngressError::LeaderboardRowsResource)
            );
        }
        assert_eq!(
            HudIngressError::LeaderboardRowsResource.to_string(),
            "HUD leaderboard row resource limit exceeded"
        );
    }
}
