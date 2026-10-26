//! Logical length and its independently clocked desktop presentation.

use super::{CorrectionRing, HEAD_SAMPLES, PresentationError, finite};

/// Desktop displayed length with additive, Float32 stored corrections.
///
/// Construct with the fresh logical point count, then schedule the transmitted
/// spawn mass through `set_length`. This preserves mass smoothing on appearance.
#[derive(Clone, Debug, PartialEq)]
pub struct LengthPresentation {
    segments: u32,
    fractional_mass: f64,
    target: f64,
    displayed: f64,
    corrections: CorrectionRing<HEAD_SAMPLES, 1>,
}

impl LengthPresentation {
    /// Start at zero fractional mass with the desktop 0.6-segment end adjustment.
    pub fn new(segments: u32) -> Self {
        let target = f64::from(segments);
        Self {
            segments,
            fractional_mass: 0.,
            target,
            displayed: target - 0.6,
            corrections: CorrectionRing::default(),
        }
    }

    /// Schedule a logical count and a decoded mass in 0 through 1 atomically.
    /// Even equal targets restart the pending correction interval.
    pub fn set_length(
        &mut self,
        segments: u32,
        fractional_mass: f64,
    ) -> Result<(), PresentationError> {
        finite(&[fractional_mass])?;
        if !(0. ..=1.).contains(&fractional_mass) {
            return Err(PresentationError);
        }
        let target = f64::from(segments) + fractional_mass.min(1.);
        self.corrections.inject([target - self.target], true)?;
        self.segments = segments;
        self.fractional_mass = fractional_mass;
        self.target = target;
        Ok(())
    }

    /// Advance a living snake's length clock and update its desktop length.
    /// A zero-step live update can clean up an already exhausted ring; a dead
    /// snake skips both ring advancement and the displayed-length assignment.
    pub fn advance(&mut self, whole_steps: u32, alive: bool) {
        if !alive {
            return;
        }
        if whole_steps == 0 && self.corrections.pending == 0 {
            self.corrections.advance(1);
        } else {
            self.corrections.advance(whole_steps);
        }
        self.displayed = self.target + self.corrections.offset[0] - 0.6;
    }

    /// Logical segment count, independent of retained dying anchors.
    pub fn segments(&self) -> u32 {
        self.segments
    }

    /// Latest received fractional mass.
    pub fn fractional_mass(&self) -> f64 {
        self.fractional_mass
    }

    /// Unsmoothed logical count plus fractional mass.
    pub fn target(&self) -> f64 {
        self.target
    }

    /// Length assigned by the latest eligible live update.
    pub fn displayed(&self) -> f64 {
        self.displayed
    }

    /// Current correction offset promoted from Float32 storage.
    pub fn offset(&self) -> f64 {
        self.corrections.offset[0]
    }

    /// Next physical sample index.
    pub fn index(&self) -> usize {
        self.corrections.index
    }

    /// Positive pending count, zero awaiting eligible cleanup, or -1 after cleanup.
    pub fn pending(&self) -> i32 {
        self.corrections.pending
    }

    /// Physical Float32 correction samples.
    pub fn samples(&self) -> &[f32; HEAD_SAMPLES] {
        &self.corrections.samples[0]
    }

    /// Float32 entity easing weights.
    pub fn weights(&self) -> &[f32; HEAD_SAMPLES] {
        &self.corrections.weights
    }
}
