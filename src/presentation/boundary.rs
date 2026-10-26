//! Double-precision boundary samples with connection-gated whole-step consumption.

use super::{PI, PresentationError, finite};
use crate::math;

/// Number of absolute-radius samples in the boundary ring.
pub const BOUNDARY_SAMPLES: usize = 56;

/// Boundary easing, separate from received radius and the animation clock.
///
/// Samples store absolute radii, rather than additive offsets. The caller owns
/// connection state and supplies whole steps from its existing animation clock.
#[derive(Clone, Debug, PartialEq)]
pub struct BoundaryRadius {
    weights: [f64; BOUNDARY_SAMPLES],
    samples: [f64; BOUNDARY_SAMPLES],
    displayed: f64,
    target: f64,
    index: usize,
    pending: i32,
}

fn validate_radius(radius: f64) -> Result<(), PresentationError> {
    finite(&[radius])?;
    if radius <= 0. {
        return Err(PresentationError);
    }
    Ok(())
}

impl BoundaryRadius {
    /// Initialize a new ring without a pending transition.
    pub fn new(radius: f64) -> Result<Self, PresentationError> {
        validate_radius(radius)?;
        Ok(Self {
            weights: std::array::from_fn(|index| {
                0.5 * (1. - math::cos(PI * index as f64 / (BOUNDARY_SAMPLES - 1) as f64))
            }),
            samples: [radius; BOUNDARY_SAMPLES],
            displayed: radius,
            target: radius,
            index: 0,
            pending: 0,
        })
    }

    /// Replace setup radii while preserving the ring cursor and pending cadence.
    /// Invalid input preserves all state.
    pub fn apply_setup(&mut self, radius: f64) -> Result<(), PresentationError> {
        validate_radius(radius)?;
        self.samples.fill(radius);
        self.displayed = radius;
        self.target = radius;
        Ok(())
    }

    /// Blend every pending absolute sample toward a new target in ring order.
    /// The displayed radius changes only on a later eligible whole-step update.
    /// Equal targets still blend existing samples and restart the pending window.
    pub fn set_target(&mut self, radius: f64) -> Result<(), PresentationError> {
        validate_radius(radius)?;
        let mut samples = self.samples;
        for (offset, weight) in self.weights.iter().enumerate() {
            let slot = (self.index + offset) % BOUNDARY_SAMPLES;
            let sample = samples[slot] + (radius - samples[slot]) * weight;
            validate_radius(sample)?;
            samples[slot] = sample;
        }
        self.samples = samples;
        self.target = radius;
        self.pending = BOUNDARY_SAMPLES as i32;
        Ok(())
    }

    /// Consume whole steps only while connected; zero steps preserve cleanup state.
    /// Consumed slots become the latest target. Exhaustion changes to -1 on a
    /// subsequent eligible update, without changing the displayed radius.
    pub fn advance(&mut self, whole_steps: u32, connected: bool) {
        if !connected || whole_steps == 0 {
            return;
        }
        if self.pending > 0 {
            let consumed = whole_steps.min(self.pending as u32) as usize;
            self.pending -= consumed as i32;
            for offset in 0..consumed {
                if offset + 1 == consumed {
                    self.displayed = self.samples[self.index];
                }
                self.samples[self.index] = self.target;
                self.index = (self.index + 1) % BOUNDARY_SAMPLES;
            }
        } else if self.pending == 0 {
            self.pending = -1;
        }
    }

    /// Current displayed absolute radius.
    pub fn displayed(&self) -> f64 {
        self.displayed
    }

    /// Most recently received target radius.
    pub fn target(&self) -> f64 {
        self.target
    }

    /// Next physical ring slot to consume.
    pub fn index(&self) -> usize {
        self.index
    }

    /// Remaining samples, zero on exhaustion, or -1 after deferred cleanup.
    pub fn pending(&self) -> i32 {
        self.pending
    }

    /// Physical absolute-radius storage; no Float32 conversion is applied.
    pub fn samples(&self) -> &[f64; BOUNDARY_SAMPLES] {
        &self.samples
    }

    /// Increasing double-precision blend weights from zero through one.
    pub fn weights(&self) -> &[f64; BOUNDARY_SAMPLES] {
        &self.weights
    }
}
