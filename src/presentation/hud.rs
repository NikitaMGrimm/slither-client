//! Opt-in command-indexed semantic observations; no session lifecycle or row storage.

use std::{error::Error, fmt};

use super::{ClientScoreView, SnakeObjectToken};
use crate::{
    protocol::{MAX_FRAME_COMMANDS, hud::HudPacketError},
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

/// Borrowed schema-1 plan; callers may own its backing vectors.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HudIngressPlan<'a> {
    /// Must be one.
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
}

impl fmt::Display for HudIngressError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPlan => f.write_str("invalid HUD plan schema or bounds"),
            Self::CommandCountMismatch => f.write_str("HUD command count mismatch"),
            Self::InvalidCaptureIndices => f.write_str("HUD final capture indices mismatch"),
            Self::InvalidControl(code) => write!(f, "invalid HUD control opcode {code}"),
            Self::Leaderboard(error) => error.fmt(f),
        }
    }
}

impl Error for HudIngressError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Leaderboard(error) => Some(error),
            _ => None,
        }
    }
}

impl HudIngressPlan<'_> {
    pub(crate) fn validate(self, commands: &[&[u8]]) -> Result<(), HudIngressError> {
        if self.schema != 1
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

/// Owned bounded result. No journal is retained by the client after returning it.
#[derive(Clone, Debug, PartialEq)]
pub struct HudIngressReport {
    report: FrameReport,
    setup_draws: usize,
    events: Vec<HudIngressEvent>,
}

impl HudIngressReport {
    pub(crate) fn new(report: FrameReport) -> Self {
        Self {
            report,
            setup_draws: 0,
            events: Vec::with_capacity(2 * report.commands),
        }
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
    /// Always schema one.
    pub fn schema(&self) -> u8 {
        1
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
