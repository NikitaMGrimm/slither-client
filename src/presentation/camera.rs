//! Camera offsets advance with draws rather than entity animation steps.

use super::{PI, Point, PresentationError, finite};
use crate::math;

/// Number of double-precision camera correction samples.
pub const CAMERA_SAMPLES: usize = 62;

/// Additive camera offsets with one sample consumed per eligible draw.
///
/// The caller controls draw eligibility and following. Injection leaves the
/// current offset intact. Unlike entity rings, exhaustion has no cleanup state.
#[derive(Clone, Debug, PartialEq)]
pub struct CameraCorrections {
    weights: [f64; CAMERA_SAMPLES],
    samples: [[f64; CAMERA_SAMPLES]; 2],
    index: usize,
    pending: usize,
    offset: Point,
}

impl Default for CameraCorrections {
    fn default() -> Self {
        Self {
            weights: std::array::from_fn(|index| {
                let mut weight = 0.5
                    * (1.
                        - math::cos(
                            PI * (CAMERA_SAMPLES - 1 - index) as f64 / (CAMERA_SAMPLES - 1) as f64,
                        ));
                weight += (0.5 * (1. - math::cos(PI * weight)) - weight) * 0.5;
                weight
            }),
            samples: [[0.; CAMERA_SAMPLES]; 2],
            index: 0,
            pending: 0,
            offset: Point::default(),
        }
    }
}

impl CameraCorrections {
    /// Add new-minus-old camera displacement without changing the current offset.
    /// Nonfinite inputs/results leave the entire ring unchanged.
    pub fn inject(&mut self, displacement: Point) -> Result<(), PresentationError> {
        finite(&[displacement.x, displacement.y])?;
        let mut samples = self.samples;
        for (channel, delta) in [displacement.x, displacement.y].into_iter().enumerate() {
            for (sample, weight) in self.weights.iter().enumerate() {
                let slot = (self.index + sample) % CAMERA_SAMPLES;
                samples[channel][slot] -= delta * weight;
                finite(&[samples[channel][slot]])?;
            }
        }
        self.samples = samples;
        self.pending = CAMERA_SAMPLES;
        Ok(())
    }

    /// Consume exactly one pending sample for a draw with a retained own snake.
    /// No elapsed-time or integer-step argument belongs to this clock.
    pub fn advance_draw(&mut self) {
        if self.pending == 0 {
            return;
        }
        self.pending -= 1;
        self.offset = Point {
            x: self.samples[0][self.index],
            y: self.samples[1][self.index],
        };
        self.samples[0][self.index] = 0.;
        self.samples[1][self.index] = 0.;
        self.index = (self.index + 1) % CAMERA_SAMPLES;
    }

    /// Current draw-sampled x/y offset in world coordinates.
    pub fn offset(&self) -> Point {
        self.offset
    }

    /// Next sample index, wrapping at 62.
    pub fn index(&self) -> usize {
        self.index
    }

    /// Number of draws with pending samples; zero stays zero after exhaustion.
    pub fn pending(&self) -> usize {
        self.pending
    }

    /// Physical ring storage, x followed by y; samples remain double precision.
    pub fn samples(&self) -> &[[f64; CAMERA_SAMPLES]; 2] {
        &self.samples
    }

    /// Double-precision camera weights, including the additional curve shaping.
    pub fn weights(&self) -> &[f64; CAMERA_SAMPLES] {
        &self.weights
    }
}
