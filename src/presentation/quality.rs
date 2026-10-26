//! Desktop quality transitions with caller-owned timing and draw counts.

use super::{FrameStep, PresentationError, finite};

/// The user's preference, which can differ from the applied runtime mode.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QualityMode {
    /// Begin connections in low quality and disable automatic recovery.
    Low,
    /// Begin connections in high quality, allowing low-frame-count fallback.
    High,
}

/// A copied view of desktop quality state; no rendering or asset ownership.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct QualitySnapshot {
    /// Stored preference; changing it alone does not reset runtime quality.
    pub requested: QualityMode,
    /// Whether runtime updates currently target high quality.
    pub high_quality: bool,
    /// High-quality contribution, between zero and one.
    pub quality_blend: f64,
    /// Density spacing multiplier, between one and 1.7.
    pub quality_scale: f64,
    /// Fallback history, including the negative residual after recovery.
    pub low_fps_counter: f64,
}

/// Pure desktop (Canvas2D) quality state, independent of the animation clock.
#[derive(Clone, Debug, PartialEq)]
pub struct QualityState {
    snapshot: QualitySnapshot,
    last_statistics_ms: f64,
}

impl QualityState {
    /// Initialize runtime quality to high even when the stored preference is low.
    /// Apply the preference with `begin_connection` when a connection opens.
    pub fn new(requested: QualityMode, start_ms: f64) -> Result<Self, PresentationError> {
        finite(&[start_ms])?;
        Ok(Self {
            snapshot: QualitySnapshot {
                requested,
                high_quality: true,
                quality_blend: 1.,
                quality_scale: 1.,
                low_fps_counter: 0.,
            },
            last_statistics_ms: start_ms,
        })
    }

    /// Store a preference without immediately changing the applied runtime mode.
    pub fn set_requested_mode(&mut self, requested: QualityMode) {
        self.snapshot.requested = requested;
    }

    /// Reset fallback history and apply the current preference on connection open.
    /// The ongoing statistics interval is preserved.
    pub fn begin_connection(&mut self) {
        self.begin_skin_preview();
        if self.snapshot.requested == QualityMode::Low {
            self.snapshot.high_quality = false;
            self.snapshot.quality_blend = 0.;
            self.snapshot.quality_scale = 1.7;
        }
    }

    /// Start skin preview in high quality regardless of the stored preference.
    /// Subsequent playing updates and statistics still use the normal rules.
    pub fn begin_skin_preview(&mut self) {
        self.snapshot.high_quality = true;
        self.snapshot.quality_blend = 1.;
        self.snapshot.quality_scale = 1.;
        self.snapshot.low_fps_counter = 0.;
    }

    /// Advance blend and density using the lag-adjusted delta, only while playing.
    /// Call before `update_statistics` for the same animation update: a fallback
    /// or recovery affects interpolation starting with the following update.
    pub fn advance(&mut self, step: FrameStep, playing: bool) -> Result<(), PresentationError> {
        finite(&[step.delta])?;
        if !(0. ..=5.).contains(&step.delta) {
            return Err(PresentationError);
        }
        if playing {
            let state = &mut self.snapshot;
            if state.high_quality {
                if state.quality_blend < 1. {
                    state.quality_blend = (state.quality_blend + step.delta * 0.0075).min(1.);
                }
                if state.quality_scale > 1. {
                    state.quality_scale = (state.quality_scale - step.delta * 4E-5).max(1.);
                }
            } else {
                if state.quality_blend > 0. {
                    state.quality_blend = (state.quality_blend - step.delta * 0.0075).max(0.);
                }
                if state.quality_scale < 1.7 {
                    state.quality_scale = (state.quality_scale + step.delta * 4E-5).min(1.7);
                }
            }
        }
        Ok(())
    }

    /// Observe the draw count accumulated since the last consumed interval.
    /// This is a raw count, not FPS normalized by elapsed time. Return true only
    /// when more than 1000 ms elapsed; the caller then resets its draw counter.
    /// Consume at most one interval per call, including while not playing.
    /// Connection and preview resets do not restart this clock.
    pub fn update_statistics(
        &mut self,
        now_ms: f64,
        frames_since_statistics: u32,
        playing: bool,
    ) -> Result<bool, PresentationError> {
        let elapsed = now_ms - self.last_statistics_ms;
        finite(&[now_ms, elapsed])?;
        if elapsed <= 1000. {
            return Ok(false);
        }
        let mut next = self.snapshot;
        if playing && next.requested == QualityMode::High {
            if frames_since_statistics <= 24 {
                next.low_fps_counter += 1.;
                if next.high_quality && next.low_fps_counter >= 1. {
                    next.high_quality = false;
                }
            } else if (next.high_quality || frames_since_statistics >= 32)
                && next.low_fps_counter > 0.
            {
                next.low_fps_counter *= 0.987;
                next.low_fps_counter -= 0.1;
                if next.low_fps_counter <= 0. {
                    next.high_quality = true;
                }
            }
        }
        finite(&[next.low_fps_counter])?;
        self.snapshot = next;
        self.last_statistics_ms = now_ms;
        Ok(true)
    }

    /// Copy the current preference, runtime flags, interpolation and history.
    pub fn snapshot(&self) -> QualitySnapshot {
        self.snapshot
    }

    /// Timestamp of the most recently consumed statistics interval.
    pub fn last_statistics_ms(&self) -> f64 {
        self.last_statistics_ms
    }
}
