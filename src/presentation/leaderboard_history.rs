//! Transactional leaderboard history and text/style policy, without browser capabilities.

use std::{cell::Cell, rc::Rc};

use crate::protocol::{MAX_FRAME_BYTES, MAX_FRAME_COMMANDS};

use super::hud_score_text;

const MAX_ROWS: usize = 149_795;
const COLORS: [&str; 9] = [
    "#c080ff", "#9099ff", "#80d0d0", "#80ff80", "#eeee70", "#ffa060", "#ff9090", "#ff4040",
    "#e030e0",
];

/// One raw admitted row, in original board order.
#[derive(Clone, Debug, PartialEq)]
pub struct LeaderboardRawRow {
    /// Unadjusted wire score index.
    pub count: u16,
    /// Unsmooth fractional mass in the inclusive range zero through one.
    pub fractional_mass: f64,
    /// Original palette byte.
    pub raw_color: u8,
    /// Latin1 byte units, before filtering or Text-node normalization.
    pub name: Vec<u8>,
}

/// A Setup or board observation, after the complete ingress report was admitted.
#[derive(Clone, Debug, PartialEq)]
pub enum LeaderboardEventKind {
    /// Effective positive score-table parameter at this command.
    Setup(u16),
    /// Complete board, including accepted empty boards.
    Board {
        /// One-byte own row marker; zero selects no row.
        local_row: u8,
        /// All rows in original order, independently of visible top-ten projection.
        rows: Vec<LeaderboardRawRow>,
    },
}

/// Original wire command position with its admitted semantic observation.
#[derive(Clone, Debug, PartialEq)]
pub struct LeaderboardEvent {
    /// Zero-based position, restarting at every report.
    pub command_index: usize,
    /// Setup or board data; unrelated HUD journal observations are omitted.
    pub kind: LeaderboardEventKind,
}

/// Command-time request for the existing independent score projector.
#[derive(Clone, Debug, PartialEq)]
pub struct LeaderboardRequest {
    /// Original command position.
    pub command_index: usize,
    /// Effective table parameter at this board, before later Setups.
    pub table_max: u16,
    /// One unadjusted index for every original row.
    pub counts: Vec<u16>,
    /// Exact decoded fractional masses in matching order.
    pub fractional_masses: Vec<f64>,
}

/// One retained formatted row, including raw numeric score and requested opacity.
#[derive(Clone, Debug, PartialEq)]
pub struct LeaderboardRow {
    /// One-based original position, never sorted by score or header rank.
    pub ordinal: usize,
    /// Existing hash-prefixed position text.
    pub number_text: String,
    /// Safe integer Number or NaN for an out-of-table index; signed zero is retained.
    pub score: f64,
    /// Decimal score or literal NaN.
    pub score_text: String,
    /// Filtered and normalized safe Text-node content.
    pub name_text: String,
    /// Requested nine-palette CSS color.
    pub css_color: &'static str,
    /// Whether this original position equals the one-byte own-row marker.
    pub own: bool,
    /// Existing ordered arithmetic, including negative offscreen-row requests.
    pub opacity_request: f64,
}

/// Semantic board projection; actual DOM binding readiness remains a caller observation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LeaderboardView<'a> {
    /// Data presence, distinguishing absent and accepted empty boards.
    pub board_present: bool,
    /// Data readiness before DOM binding overrides.
    pub readiness: &'static str,
    /// Absent-data reason before DOM binding overrides.
    pub reason: Option<&'static str>,
    /// The top ten in original row order.
    pub rows: &'a [LeaderboardRow],
    /// Borrowed existing HUD heading opacity request.
    pub heading_opacity: f64,
    /// Borrowed existing HUD row opacity request.
    pub row_opacity: f64,
}

/// Arbitrary-length revision counter, preserving the existing BigInt lifetime.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaderboardRevision(Vec<u8>);

impl Default for LeaderboardRevision {
    fn default() -> Self {
        Self(vec![0])
    }
}

impl LeaderboardRevision {
    fn increment(&mut self) {
        for digit in &mut self.0 {
            if *digit != 9 {
                *digit += 1;
                return;
            }
            *digit = 0;
        }
        self.0.push(1);
    }

    /// Exact base-ten representation for a lossless browser BigInt conversion.
    pub fn decimal(&self) -> String {
        self.0
            .iter()
            .rev()
            .map(|digit| char::from(b'0' + digit))
            .collect()
    }
}

#[derive(Debug)]
struct Owner {
    open: Cell<bool>,
}

#[derive(Debug)]
struct PlannedBoard {
    local_row: u8,
    rows: Vec<LeaderboardRawRow>,
}

/// One issued staged packet. Begin consumes admission even if later conversion fails.
#[derive(Debug)]
pub struct LeaderboardPlan {
    owner: Rc<Owner>,
    begun: bool,
    boards: Option<Vec<PlannedBoard>>,
    requests: Vec<LeaderboardRequest>,
    table_max: Option<u16>,
    setup_seen: bool,
}

impl LeaderboardPlan {
    pub(crate) fn belongs_to(&self, history: &LeaderboardHistory) -> bool {
        Rc::ptr_eq(&self.owner, &history.owner)
    }
    /// All requests, in original board-command order.
    pub fn requests(&self) -> &[LeaderboardRequest] {
        &self.requests
    }

    /// Consume this plan's admission before caller-controlled result conversion.
    pub fn begin(&mut self) -> Result<(), &'static str> {
        if self.begun || !self.owner.open.get() {
            return Err("stale leaderboard plan");
        }
        self.begun = true;
        Ok(())
    }
}

/// Rust-owned immutable display history and one-use transition identity.
#[derive(Debug)]
pub struct LeaderboardHistory {
    owner: Rc<Owner>,
    pending_parent: Option<Rc<Owner>>,
    table_max: Option<u16>,
    setup_seen: bool,
    revision: LeaderboardRevision,
    board: Option<Rc<Vec<LeaderboardRow>>>,
}

impl Default for LeaderboardHistory {
    fn default() -> Self {
        Self {
            owner: Rc::new(Owner {
                open: Cell::new(true),
            }),
            pending_parent: None,
            table_max: None,
            setup_seen: false,
            revision: LeaderboardRevision::default(),
            board: None,
        }
    }
}

impl LeaderboardHistory {
    /// Whether this history can still prepare/complete/reset; old snapshots stay readable.
    pub fn is_open(&self) -> bool {
        self.owner.open.get()
    }

    /// Effective latest Setup parameter, without a default or reset-time replacement.
    pub fn table_max(&self) -> Option<u16> {
        self.table_max
    }

    /// Whether any admitted Setup has committed in this history.
    pub fn setup_seen(&self) -> bool {
        self.setup_seen
    }

    /// Exact number of committed board observations, including equal and empty boards.
    pub fn revision(&self) -> &LeaderboardRevision {
        &self.revision
    }

    /// Complete last accepted board; absent and accepted empty remain distinct.
    pub fn board(&self) -> Option<&[LeaderboardRow]> {
        self.board.as_deref().map(Vec::as_slice)
    }

    /// Existing top-ten presentation without discarding retained rows.
    pub fn visible_rows(&self) -> &[LeaderboardRow] {
        let rows = self.board().unwrap_or(&[]);
        &rows[..rows.len().min(10)]
    }

    /// Project semantic availability and rows without another fade clock or score read.
    pub fn view(&self, heading_opacity: f64, row_opacity: f64) -> LeaderboardView<'_> {
        let board_present = self.board.is_some();
        LeaderboardView {
            board_present,
            readiness: if board_present { "ready" } else { "pending" },
            reason: if board_present {
                None
            } else {
                Some("no-board")
            },
            rows: self.visible_rows(),
            heading_opacity,
            row_opacity,
        }
    }

    /// Whether two histories share the exact retained board (for copied-output identity).
    pub fn shares_board(&self, other: &Self) -> bool {
        match (&self.board, &other.board) {
            (Some(a), Some(b)) => Rc::ptr_eq(a, b),
            (None, None) => true,
            _ => false,
        }
    }

    /// Admit the complete bounded typed journal before exposing numeric requests.
    pub fn prepare(&self, events: &[LeaderboardEvent]) -> Result<LeaderboardPlan, &'static str> {
        if !self.is_open() || events.len() > MAX_FRAME_COMMANDS {
            return Err("invalid leaderboard history");
        }
        let mut table_max = self.table_max;
        let mut setup_seen = self.setup_seen;
        let mut previous = None;
        let mut rows_total = 0usize;
        let mut wire_bytes = 0usize;
        let mut requests = Vec::new();
        let mut boards = Vec::new();
        for event in events {
            if event.command_index >= MAX_FRAME_COMMANDS
                || previous.is_some_and(|old| old >= event.command_index)
            {
                return Err("invalid leaderboard command order");
            }
            previous = Some(event.command_index);
            match &event.kind {
                LeaderboardEventKind::Setup(maximum) => {
                    if *maximum == 0 {
                        return Err("invalid leaderboard table");
                    }
                    table_max = Some(*maximum);
                    setup_seen = true;
                }
                LeaderboardEventKind::Board { local_row, rows } => {
                    let maximum = table_max.ok_or("leaderboard requires prior Setup")?;
                    rows_total += rows.len();
                    if rows_total > MAX_ROWS {
                        return Err("leaderboard row budget exceeded");
                    }
                    wire_bytes += 6 + 7 * rows.len();
                    for row in rows {
                        if row.name.len() > 255
                            || !row.fractional_mass.is_finite()
                            || !(0. ..=1.).contains(&row.fractional_mass)
                        {
                            return Err("invalid leaderboard row");
                        }
                        wire_bytes += row.name.len();
                    }
                    if wire_bytes > MAX_FRAME_BYTES {
                        return Err("leaderboard byte budget exceeded");
                    }
                    requests.push(LeaderboardRequest {
                        command_index: event.command_index,
                        table_max: maximum,
                        counts: rows.iter().map(|row| row.count).collect(),
                        fractional_masses: rows.iter().map(|row| row.fractional_mass).collect(),
                    });
                    boards.push(PlannedBoard {
                        local_row: *local_row,
                        rows: rows.clone(),
                    });
                }
            }
        }
        Ok(LeaderboardPlan {
            owner: self.owner.clone(),
            begun: false,
            boards: Some(boards),
            requests,
            table_max,
            setup_seen,
        })
    }

    fn candidate(&self) -> Result<Self, &'static str> {
        if !self.is_open() {
            return Err("closed leaderboard history");
        }
        Ok(Self {
            owner: Rc::new(Owner {
                open: Cell::new(false),
            }),
            pending_parent: Some(self.owner.clone()),
            table_max: self.table_max,
            setup_seen: self.setup_seen,
            revision: self.revision.clone(),
            board: self.board.clone(),
        })
    }

    /// Consume a begun matching plan and stage all row/text/history output without publication.
    pub fn stage_complete(
        &self,
        plan: &mut LeaderboardPlan,
        scores: &[Vec<f64>],
        own_nickname: &str,
    ) -> Result<Self, &'static str> {
        if !self.is_open() || !plan.belongs_to(self) || !plan.begun {
            return Err("leaderboard plan owner mismatch");
        }
        let boards = plan.boards.take().ok_or("consumed leaderboard plan")?;
        validate_nickname(own_nickname)?;
        if scores.len() != boards.len() {
            return Err("invalid leaderboard completion");
        }
        // Admit every result, including earlier boards replaced in this same packet.
        for ((board, request), values) in boards.iter().zip(&plan.requests).zip(scores) {
            if values.len() != board.rows.len() {
                return Err("leaderboard score count mismatch");
            }
            for (row, score) in board.rows.iter().zip(values) {
                validate_score(request.table_max, row.count, *score)?;
            }
        }
        let mut next = self.candidate()?;
        next.table_max = plan.table_max;
        next.setup_seen = plan.setup_seen;
        for (board, values) in boards.into_iter().zip(scores) {
            let rows = board
                .rows
                .into_iter()
                .zip(values)
                .enumerate()
                .map(|(index, (row, score))| {
                    let ordinal = index + 1;
                    let own = ordinal == usize::from(board.local_row);
                    let name = if own {
                        own_nickname.to_owned()
                    } else {
                        remote_name(&row.name)
                    };
                    LeaderboardRow {
                        ordinal,
                        number_text: format!("#{ordinal}"),
                        score: *score,
                        score_text: if score.is_nan() {
                            "NaN".into()
                        } else {
                            hud_score_text(*score).unwrap()
                        },
                        name_text: normalize_text(&name),
                        css_color: COLORS[usize::from(row.raw_color % 9)],
                        own,
                        opacity_request: if own {
                            1.
                        } else {
                            0.7 * (0.3 + 0.7 * (1. - ordinal as f64 / 10.))
                        },
                    }
                })
                .collect();
            next.board = Some(Rc::new(rows));
            next.revision.increment();
        }
        Ok(next)
    }

    /// Stage a reset which retains board, table and revision and invalidates old plans on commit.
    pub fn stage_reset(&self) -> Result<Self, &'static str> {
        self.candidate()
    }

    /// Commit only after output conversion and caller capability/reentry guards succeed.
    pub fn commit(&self) -> Result<(), &'static str> {
        let parent = self
            .pending_parent
            .as_ref()
            .ok_or("leaderboard candidate required")?;
        if self.is_open() || !parent.open.get() {
            return Err("stale leaderboard candidate");
        }
        parent.open.set(false);
        self.owner.open.set(true);
        Ok(())
    }
}

pub(crate) fn validate_nickname(value: &str) -> Result<(), &'static str> {
    if value.len() > 24 || !value.bytes().all(|unit| (0x20..=0x7f).contains(&unit)) {
        return Err("invalid leaderboard nickname");
    }
    Ok(())
}

pub(crate) fn validate_score(table_max: u16, count: u16, score: f64) -> Result<(), &'static str> {
    if usize::from(count) > usize::from(table_max) + 2048 {
        if !score.is_nan() {
            return Err("out-of-table leaderboard score must be NaN");
        }
    } else {
        hud_score_text(score)?;
    }
    Ok(())
}

fn remote_name(bytes: &[u8]) -> String {
    let mut digits = 0;
    for unit in bytes {
        if unit.is_ascii_alphabetic() {
            digits = 0;
        } else if unit.is_ascii_digit() {
            digits += 1;
            if digits >= 7 {
                return String::new();
            }
        }
    }
    bytes.iter().map(|unit| char::from(*unit)).collect()
}

fn normalize_text(value: &str) -> String {
    let mut result = String::new();
    let mut units = value.chars().peekable();
    while let Some(unit) = units.next() {
        match unit {
            '\r' => {
                if units.peek() == Some(&'\n') {
                    units.next();
                }
                result.push('\n');
            }
            '\0' => {}
            ' ' => result.push('\u{a0}'),
            _ => result.push(unit),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn revision_carry_remains_exact_beyond_u64() {
        let mut revision = LeaderboardRevision(
            "18446744073709551615"
                .bytes()
                .rev()
                .map(|digit| digit - b'0')
                .collect(),
        );
        revision.increment();
        assert_eq!(revision.decimal(), "18446744073709551616");
        let mut revision = LeaderboardRevision(vec![9; 40]);
        revision.increment();
        assert_eq!(revision.decimal(), format!("1{}", "0".repeat(40)));
    }
}
