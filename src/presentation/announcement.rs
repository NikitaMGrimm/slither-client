//! Retained public announcements and their shared HUD-clock projection.
//!
//! There is no independent timeout. Setup and world reset preserve content;
//! accepted leaderboard and existing session lifecycle observations drive fade.

use std::{error::Error, fmt, sync::Arc};

use super::{PresentationError, ScoreError, ScoreTables};
use crate::{
    protocol::hud::{HudPacketError, parse_announcement},
    state::{HudCommandBoundary, HudCommandMarker, PresentationEvent},
};

/// Invalid announcement bytes, unsupported score or recoverable allocation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AnnouncementError {
    /// The complete bare command failed validation.
    Packet(HudPacketError),
    /// The command requires a score outside the selected table domain.
    Score(ScoreError),
    /// Announcement scoring requires an earlier Setup.
    MissingTable,
    /// The bounded owned packet could not be reserved.
    AllocationFailed,
}

impl fmt::Display for AnnouncementError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Packet(error) => error.fmt(f),
            Self::Score(error) => error.fmt(f),
            Self::MissingTable => f.write_str("announcement requires a score table"),
            Self::AllocationFailed => f.write_str("announcement allocation failed"),
        }
    }
}
impl Error for AnnouncementError {}

/// Validated bounded wire bytes; private fields prevent unvalidated construction.
#[derive(Debug)]
pub(crate) struct AnnouncementPacket(Vec<u8>);

impl AnnouncementPacket {
    pub(crate) fn copy(command: &[u8]) -> Result<Self, AnnouncementError> {
        parse_announcement(command).map_err(AnnouncementError::Packet)?;
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(command.len())
            .map_err(|_| AnnouncementError::AllocationFailed)?;
        bytes.extend_from_slice(command);
        Ok(Self(bytes))
    }

    fn validate_table(&self, table_max: Option<u16>) -> Result<(), AnnouncementError> {
        let table_max = table_max.ok_or(AnnouncementError::MissingTable)?;
        if table_max == 0 {
            return Err(AnnouncementError::Score(ScoreError::ZeroTableMax));
        }
        let packet = parse_announcement(&self.0).map_err(AnnouncementError::Packet)?;
        if packet.count() > u32::from(table_max) + 2048 {
            return Err(AnnouncementError::Score(ScoreError::IndexOutOfRange));
        }
        Ok(())
    }
}

/// Admit every announcement's lookup before any resolver or Setup callback.
/// Only table availability/bounds are needed here; scoring still happens at the
/// original command position with the unchanged ordered f64 arithmetic.
pub(crate) fn prevalidate_announcement_scores(
    mut table_max: Option<u16>,
    events: &[PresentationEvent],
    boundaries: &[HudCommandBoundary],
) -> Result<(), AnnouncementError> {
    let mut event_start = 0;
    for boundary in boundaries {
        for event in &events[event_start..boundary.event_end] {
            if let PresentationEvent::Setup(setup) = event {
                table_max = Some(setup.max_segments);
            }
        }
        if let HudCommandMarker::Announcement(packet) = &boundary.marker {
            packet.validate_table(table_max)?;
        }
        event_start = boundary.event_end;
    }
    Ok(())
}

/// Frozen receipt-time content, independent of own identity and later tables.
#[derive(Clone, Debug, PartialEq)]
pub struct AnnouncementContent {
    /// Positive score computed at the command's position, with no own R addition.
    pub score: f64,
    /// Independently admitted Latin-1 name, with ordinary spaces preserved.
    pub name: String,
    /// Independently admitted Latin-1 message, with no outgoing editor cap.
    pub message: String,
}

/// Existing session lifecycle at the pre-motion control boundary.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AnnouncementLifecycle {
    /// A death timestamp exists, including the ordinary death hold.
    pub death_pending: bool,
    /// The existing return animation is active on this step.
    pub return_active: bool,
    /// This step completes the existing return animation.
    pub return_completed: bool,
    /// Existing return fraction, without a separate announcement timer.
    pub return_fraction: f64,
}

/// A text line and its complete local presentation policy.
#[derive(Clone, Debug, PartialEq)]
pub struct AnnouncementLine {
    /// Plain text; never interpret as markup.
    pub text: String,
    /// Font size in CSS pixels.
    pub font_size: u8,
    /// Bold weight selection.
    pub bold: bool,
    /// Italic style selection.
    pub italic: bool,
    /// Space following this line in CSS pixels.
    pub space_after: u8,
}

/// Backend-neutral authored text and bounded desktop placement.
#[derive(Clone, Debug, PartialEq)]
pub struct AnnouncementView {
    /// Whether an admitted positive-score announcement has been retained.
    pub present: bool,
    /// Raw shared-HUD opacity request, including the completion sentinel -1.
    pub opacity: f64,
    /// Left inset in CSS pixels.
    pub left: u16,
    /// Top inset in CSS pixels.
    pub top: u16,
    /// Container width in CSS pixels.
    pub width: u16,
    /// Container height in CSS pixels.
    pub height: u16,
    /// Message, attribution and length in presentation order, at most three.
    pub lines: Vec<AnnouncementLine>,
}

/// Constant-size history aside from one bounded retained announcement.
#[derive(Clone, Debug, PartialEq)]
pub struct AnnouncementState {
    content: Option<Arc<AnnouncementContent>>,
    fade: f64,
    opacity: f64,
}

impl Default for AnnouncementState {
    fn default() -> Self {
        Self {
            content: None,
            fade: -1.,
            opacity: 0.,
        }
    }
}

impl AnnouncementState {
    /// Borrow frozen content without consuming a draw or update.
    pub fn content(&self) -> Option<&AnnouncementContent> {
        self.content.as_deref()
    }

    /// Setup hides but retains the previous announcement.
    pub fn setup(&mut self) {
        self.fade = -1.;
        self.opacity = 0.;
    }

    /// An accepted playing leaderboard starts an alive fade only outside death.
    pub fn leaderboard(&mut self, death_pending: bool) {
        if self.fade == -1. && !death_pending {
            self.fade = 0.;
        }
    }

    pub(crate) fn receive(
        &mut self,
        packet: &AnnouncementPacket,
        tables: Option<&ScoreTables>,
    ) -> Result<(), AnnouncementError> {
        let packet = parse_announcement(&packet.0).map_err(AnnouncementError::Packet)?;
        let tables = tables.ok_or(AnnouncementError::MissingTable)?;
        let score = tables
            .score(packet.count() as usize, packet.fractional_mass())
            .map_err(AnnouncementError::Score)?;
        if score > 0. {
            self.content = Some(Arc::new(AnnouncementContent {
                score,
                name: admitted_text(packet.name()),
                message: admitted_text(packet.message()),
            }));
        }
        Ok(())
    }

    /// Advance once with the existing lag-adjusted frame delta. Invalid lifecycle
    /// observations preserve the entire previous state, including opacity.
    pub fn advance(
        &mut self,
        delta: f64,
        life: AnnouncementLifecycle,
    ) -> Result<(), PresentationError> {
        if !delta.is_finite()
            || !(0. ..=5.).contains(&delta)
            || !life.return_fraction.is_finite()
            || !(0. ..=1.).contains(&life.return_fraction)
            || if life.return_completed {
                !life.return_active || life.death_pending || life.return_fraction != 0.
            } else {
                life.return_active && (!life.death_pending || life.return_fraction <= 0.)
            }
        {
            return Err(PresentationError);
        }
        if life.return_completed {
            self.fade = -1.;
            self.opacity = self.fade;
        } else if life.return_active {
            self.fade = life.return_fraction;
            self.opacity = self.fade;
        } else if !life.death_pending && self.fade != -1. && self.fade != 1. {
            self.fade = (self.fade + 0.01 * delta).min(1.);
            self.opacity = self.fade;
        }
        Ok(())
    }

    /// Project safe text with authored English labels. Exact stock wording and
    /// legacy HTML control-character parsing are outside this text-node boundary.
    pub fn view(&self) -> AnnouncementView {
        let mut lines = Vec::new();
        if let Some(content) = self.content() {
            let line = |text, font_size, bold, italic, space_after| AnnouncementLine {
                text,
                font_size,
                bold,
                italic,
                space_after,
            };
            if !content.message.is_empty() {
                lines.push(line(format!("\"{}\"", content.message), 17, true, true, 5));
            }
            if !content.name.is_empty() || !content.message.is_empty() {
                let attribution = if content.name.is_empty() {
                    "Anonymous player".to_owned()
                } else {
                    format!("By {}", content.name)
                };
                lines.push(line(attribution, 13, false, false, 0));
                lines.push(line(
                    format!("Longest today: {}", content.score),
                    13,
                    false,
                    false,
                    0,
                ));
            } else {
                lines.push(line(
                    format!("Longest today: {}", content.score),
                    13,
                    false,
                    false,
                    0,
                ));
            }
        }
        AnnouncementView {
            present: self.content.is_some(),
            opacity: self.opacity,
            left: 8,
            top: 4,
            width: 300,
            height: 228,
            lines,
        }
    }
}

fn admitted_text(bytes: &[u8]) -> String {
    let mut digits = 0;
    for &byte in bytes {
        if byte.is_ascii_alphabetic() {
            digits = 0;
        } else if byte.is_ascii_digit() {
            digits += 1;
            if digits == 7 {
                return String::new();
            }
        }
    }
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(count: u32, mass: u32, name: &[u8], message: &[u8]) -> AnnouncementPacket {
        // Authored synthetic wire data; no reference fixture.
        let mut bytes = vec![b'm'];
        bytes.extend_from_slice(&count.to_be_bytes()[1..]);
        bytes.extend_from_slice(&mass.to_be_bytes()[1..]);
        bytes.push(name.len() as u8);
        bytes.extend_from_slice(name);
        bytes.extend_from_slice(message);
        AnnouncementPacket::copy(&bytes).unwrap()
    }

    fn alive() -> AnnouncementLifecycle {
        AnnouncementLifecycle {
            death_pending: false,
            return_active: false,
            return_completed: false,
            return_fraction: 1.,
        }
    }

    #[test]
    fn replacement_is_positive_only_and_freezes_receipt_score_without_own_identity() {
        let mut state = AnnouncementState::default();
        let tables = ScoreTables::new(1).unwrap();
        state
            .receive(
                &packet(1, 16777215, b"  Name  ", b"<tag> &  text"),
                Some(&tables),
            )
            .unwrap();
        assert_eq!(state.content().unwrap().score, 10.);
        let retained = state.clone();
        for input in [packet(0, 0, b"other", b""), packet(1, 0, b"", b"")] {
            state.receive(&input, Some(&tables)).unwrap();
            assert_eq!(state, retained);
        }
        assert!(
            state
                .receive(&packet(0xffffff, 0, b"", b""), Some(&tables))
                .is_err()
        );
        assert_eq!(state, retained);
        state.setup();
        assert_eq!(state.content(), retained.content());
        assert_eq!(state.view().opacity, 0.);
        state
            .receive(
                &packet(2, 0xffffff, b"new", b"new"),
                Some(&ScoreTables::new(2).unwrap()),
            )
            .unwrap();
        assert_ne!(state.content(), retained.content());
    }

    #[test]
    fn text_admission_is_independent_latin1_uncapped_and_never_markup() {
        let tables = ScoreTables::new(1).unwrap();
        let mut state = AnnouncementState::default();
        let long = [b'x'; 600];
        state
            .receive(&packet(1, 0xffffff, b"123456-7", &long), Some(&tables))
            .unwrap();
        assert_eq!(state.content().unwrap().name, "");
        assert_eq!(state.content().unwrap().message.len(), 600);
        assert_eq!(state.view().lines[1].text, "Anonymous player");
        state
            .receive(
                &packet(1, 0xffffff, b"123456a7\xff ", b"123456 7"),
                Some(&tables),
            )
            .unwrap();
        assert_eq!(state.content().unwrap().name, "123456a7ÿ ");
        assert_eq!(state.content().unwrap().message, "");
        assert_eq!(state.view().lines.len(), 2);
        assert_eq!(admitted_text(b"<>&\0\r\n\x7f"), "<>&\0\r\n\u{7f}");
        state
            .receive(&packet(1, 0xffffff, b"", b""), Some(&tables))
            .unwrap();
        assert_eq!(state.view().lines.len(), 1);
        state
            .receive(&packet(1, 0xffffff, b"N", b"A  B"), Some(&tables))
            .unwrap();
        let lines = state.view().lines;
        assert_eq!(
            lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            ["\"A  B\"", "By N", "Longest today: 10"]
        );
        assert_eq!(
            (
                lines[0].font_size,
                lines[0].bold,
                lines[0].italic,
                lines[0].space_after
            ),
            (17, true, true, 5)
        );
    }

    #[test]
    fn fixed_step_fade_has_no_expiry_and_preserves_death_hold_and_completion_sentinel() {
        let mut state = AnnouncementState::default();
        state
            .receive(
                &packet(1, 0xffffff, b"N", b"M"),
                Some(&ScoreTables::new(1).unwrap()),
            )
            .unwrap();
        state.advance(5., alive()).unwrap();
        assert_eq!(state.view().opacity, 0.);
        state.leaderboard(true);
        state.advance(5., alive()).unwrap();
        assert_eq!(state.view().opacity, 0.);
        state.leaderboard(false);
        state.advance(2.5, alive()).unwrap();
        assert_eq!(state.view().opacity, 0.025);
        let hold = AnnouncementLifecycle {
            death_pending: true,
            ..alive()
        };
        state.advance(5., hold).unwrap();
        assert_eq!(state.view().opacity, 0.025);
        state
            .advance(
                0.,
                AnnouncementLifecycle {
                    return_active: true,
                    return_fraction: 0.6,
                    ..hold
                },
            )
            .unwrap();
        assert_eq!(state.view().opacity, 0.6);
        state
            .advance(
                0.,
                AnnouncementLifecycle {
                    return_active: true,
                    return_completed: true,
                    return_fraction: 0.,
                    ..alive()
                },
            )
            .unwrap();
        assert_eq!(state.view().opacity, -1.);
        for _ in 0..200 {
            state.advance(5., alive()).unwrap();
        }
        assert_eq!(state.view().opacity, -1.);
        assert!(state.content().is_some());
        state.setup();
        state.leaderboard(false);
        for _ in 0..100 {
            state.advance(5., alive()).unwrap();
        }
        assert_eq!(state.view().opacity, 1.);
        assert!(state.content().is_some());
    }

    #[test]
    fn malformed_packet_and_invalid_lifecycle_are_atomic() {
        assert!(AnnouncementPacket::copy(b"m\0\0\0\0\0\0\x02x").is_err());
        let mut state = AnnouncementState::default();
        let before = state.clone();
        assert_eq!(
            state.receive(&packet(1, 0xffffff, b"", b""), None),
            Err(AnnouncementError::MissingTable)
        );
        for delta in [-1., 5.1, f64::NAN, f64::INFINITY] {
            assert!(state.advance(delta, alive()).is_err());
        }
        assert!(
            state
                .advance(
                    1.,
                    AnnouncementLifecycle {
                        return_active: true,
                        ..alive()
                    }
                )
                .is_err()
        );
        assert_eq!(state, before);
    }
}
