//! Retained body anchors and their update-driven visual corrections.

use std::f64::consts::{PI, TAU};

use super::{PresentationError, finite};
use crate::math::{cos, sin};
use crate::state::{Appearance, MAX_BODY_POINTS, Point, Setup};

/// Samples in each body's x, y, edge-length, and spacing correction channel.
pub const BODY_SAMPLES: usize = 53;
/// Physical records, including dying anchors, retained by one body.
/// Logical segment count has the separate received-state limit of 4096.
pub const MAX_RETAINED_BODY_POINTS: usize = MAX_BODY_POINTS * 2;
const SPACING_SAMPLES: usize = 100;

#[derive(Clone, Debug, PartialEq)]
struct BodyCorrections {
    samples: [[f32; BODY_SAMPLES]; 4],
    offset: [f64; 4],
    index: usize,
    pending: i32,
}

impl Default for BodyCorrections {
    fn default() -> Self {
        Self {
            samples: [[0.; BODY_SAMPLES]; 4],
            offset: [0.; 4],
            index: 0,
            pending: 0,
        }
    }
}

impl BodyCorrections {
    fn inject(
        &mut self,
        changes: [Option<f64>; 4],
        weights: &[f32; BODY_SAMPLES],
    ) -> Result<(), PresentationError> {
        for (channel, change) in changes.into_iter().enumerate() {
            let Some(change) = change else { continue };
            finite(&[change])?;
            for (distance, weight) in weights.iter().enumerate() {
                let slot = (self.index + distance) % BODY_SAMPLES;
                let stored =
                    (f64::from(self.samples[channel][slot]) - change * f64::from(*weight)) as f32;
                if !stored.is_finite() {
                    return Err(PresentationError);
                }
                self.samples[channel][slot] = stored;
            }
            // An omitted channel retains its currently displayed offset as well
            // as its samples. Contraction does not refresh the edge channel.
            self.offset[channel] = f64::from(self.samples[channel][self.index]);
        }
        self.pending = BODY_SAMPLES as i32;
        Ok(())
    }

    fn advance(&mut self, steps: u32) {
        if steps == 0 {
            return;
        }
        if self.pending > 0 {
            let consumed = steps.min(self.pending as u32);
            for _ in 0..consumed {
                for (samples, offset) in self.samples.iter_mut().zip(&mut self.offset) {
                    *offset = f64::from(samples[self.index]);
                    samples[self.index] = 0.;
                }
                self.index = (self.index + 1) % BODY_SAMPLES;
            }
            self.pending -= consumed as i32;
        } else if self.pending == 0 {
            self.pending = -1;
            self.offset = [0.; 4];
        }
    }
}

/// One absolute body anchor, which can remain after its logical tail removal.
#[derive(Clone, Debug, PartialEq)]
pub struct BodyPoint {
    position: Point,
    previous_delta: Point,
    edge_length: f64,
    spacing_multiplier: f64,
    tail_fade: f64,
    dying: bool,
    corrections: BodyCorrections,
}

impl BodyPoint {
    /// Absolute, contracted anchor position before displayed corrections.
    pub fn position(&self) -> Point {
        self.position
    }

    /// Delta from the preceding tailward anchor at creation, never recomputed.
    pub fn previous_delta(&self) -> Point {
        self.previous_delta
    }

    /// Creation-time edge length divided by the configured segment length.
    pub fn edge_length(&self) -> f64 {
        self.edge_length
    }

    /// Current base spacing multiplier, promoted from the Float32 spacing table.
    pub fn spacing_multiplier(&self) -> f64 {
        self.spacing_multiplier
    }

    /// Tail fade in 0 through 1, independent of logical membership.
    pub fn tail_fade(&self) -> f64 {
        self.tail_fade
    }

    /// Whether this retained anchor has left the logical body.
    pub fn dying(&self) -> bool {
        self.dying
    }

    /// Displayed x, y, edge-length, and spacing correction offsets.
    pub fn offset(&self) -> [f64; 4] {
        self.corrections.offset
    }

    /// Displayed positional correction, promoted from Float32 storage.
    pub fn position_offset(&self) -> Point {
        Point {
            x: self.corrections.offset[0],
            y: self.corrections.offset[1],
        }
    }

    /// Displayed edge-length correction.
    pub fn edge_length_offset(&self) -> f64 {
        self.corrections.offset[2]
    }

    /// Displayed spacing correction.
    pub fn spacing_offset(&self) -> f64 {
        self.corrections.offset[3]
    }

    /// Next correction sample index.
    pub fn index(&self) -> usize {
        self.corrections.index
    }

    /// Positive sample count, zero awaiting positive-step cleanup, or -1.
    pub fn pending(&self) -> i32 {
        self.corrections.pending
    }

    /// Physical Float32 samples, ordered x, y, edge-length, then spacing.
    pub fn samples(&self) -> &[[f32; BODY_SAMPLES]; 4] {
        &self.corrections.samples
    }
}

/// Head-to-tail absolute body geometry, separate from head, mass, and camera state.
#[derive(Clone, Debug, PartialEq)]
pub struct BodyGeometry {
    points: Vec<BodyPoint>,
    logical_segments: usize,
    anchor_direction: Option<u16>,
    segment_length: f64,
    contraction: f64,
    weights: [f32; BODY_SAMPLES],
    spacing: [f32; SPACING_SAMPLES],
}

fn difference(a: Point, b: Point) -> Result<Point, PresentationError> {
    let result = Point {
        x: a.x - b.x,
        y: a.y - b.y,
    };
    finite(&[a.x, a.y, b.x, b.y, result.x, result.y])?;
    Ok(result)
}

fn distance(delta: Point) -> Result<f64, PresentationError> {
    // Preserve the squared-sum boundary instead of hypot's scaled arithmetic.
    let squared = delta.x * delta.x + delta.y * delta.y;
    finite(&[squared])?;
    Ok(squared.sqrt())
}

impl BodyGeometry {
    /// Initialize received absolute anchors without contracting their geometry.
    /// The tail's previous delta is zero; all initial normalized edge lengths are one.
    pub fn from_appearance(
        appearance: &Appearance,
        setup: &Setup,
    ) -> Result<Self, PresentationError> {
        finite(&[
            setup.body_spacing,
            setup.body_contraction,
            appearance.absolute_head.x,
            appearance.absolute_head.y,
        ])?;
        if setup.protocol != 19
            || setup.body_spacing <= 0.
            || !(0. ..=1.).contains(&setup.body_contraction)
            || appearance.absolute_body.len() > MAX_BODY_POINTS
        {
            return Err(PresentationError);
        }
        let weights = std::array::from_fn(|index| {
            (0.5 * (1. - cos(PI * (BODY_SAMPLES - 1 - index) as f64 / (BODY_SAMPLES - 1) as f64)))
                as f32
        });
        let spacing = std::array::from_fn(|index| {
            let contracted = index.saturating_sub(3).min(4);
            (1. - setup.body_contraction * contracted as f64 / 4.) as f32
        });
        let mut points = Vec::with_capacity(appearance.absolute_body.len());
        for (index, position) in appearance.absolute_body.iter().copied().enumerate() {
            let tailward = appearance
                .absolute_body
                .get(index + 1)
                .copied()
                .unwrap_or(position);
            points.push(BodyPoint {
                position,
                previous_delta: difference(position, tailward)?,
                edge_length: 1.,
                spacing_multiplier: f64::from(spacing[index.min(SPACING_SAMPLES - 4)]),
                tail_fade: 0.,
                dying: false,
                corrections: BodyCorrections::default(),
            });
        }
        Ok(Self {
            logical_segments: points.len(),
            points,
            anchor_direction: appearance.anchor_direction,
            segment_length: setup.body_spacing,
            contraction: setup.body_contraction,
            weights,
            spacing,
        })
    }

    /// Add an absolute or cached-direction anchor and return its absolute position.
    /// Non-growth marks the oldest living point dying; growth increments logical length.
    /// All arithmetic and retention failures preserve the entire previous body.
    pub fn apply_anchor(
        &mut self,
        absolute_position: Option<Point>,
        direction: Option<u16>,
        grew: bool,
        displayed_head: Point,
        visible: bool,
    ) -> Result<Point, PresentationError> {
        finite(&[displayed_head.x, displayed_head.y])?;
        if self.points.len() >= MAX_RETAINED_BODY_POINTS
            || (grew && self.logical_segments >= MAX_BODY_POINTS)
        {
            return Err(PresentationError);
        }
        let last = self.points.first().ok_or(PresentationError)?;
        let next_direction = direction.or(self.anchor_direction);
        let position = match absolute_position {
            Some(position) => position,
            None => {
                let angle = f64::from(next_direction.ok_or(PresentationError)?) * (TAU / 65_536.);
                Point {
                    x: last.position.x + cos(angle) * self.segment_length,
                    y: last.position.y + sin(angle) * self.segment_length,
                }
            }
        };
        let previous_delta = difference(position, last.position)?;
        let edge_length = distance(previous_delta)? / self.segment_length;
        finite(&[edge_length])?;
        if visible && edge_length == 0. {
            return Err(PresentationError);
        }
        let mut point = BodyPoint {
            position,
            previous_delta,
            edge_length,
            spacing_multiplier: 1.,
            tail_fade: 0.,
            dying: false,
            corrections: BodyCorrections::default(),
        };
        if visible {
            let tailward_display = Point {
                x: last.position.x + last.corrections.offset[0],
                y: last.position.y + last.corrections.offset[1],
            };
            let mut toward_head = difference(displayed_head, tailward_display)?;
            let head_distance = distance(toward_head)?;
            if head_distance > 1. {
                toward_head.x /= head_distance;
                toward_head.y /= head_distance;
            }
            let chord = edge_length * self.segment_length;
            let projected = if head_distance < self.segment_length {
                head_distance
            } else {
                chord
            };
            let prior_position = Point {
                x: tailward_display.x + toward_head.x * projected,
                y: tailward_display.y + toward_head.y * projected,
            };
            let displacement = difference(position, prior_position)?;
            point.corrections.inject(
                [
                    Some(displacement.x),
                    Some(displacement.y),
                    Some(1. - projected / chord),
                    Some(0.),
                ],
                &self.weights,
            )?;
        }
        let mut next = self.clone();
        if grew {
            next.logical_segments += 1;
        } else if let Some(tail) = next.points.iter_mut().rev().find(|point| !point.dying) {
            tail.dying = true;
        }
        next.points.insert(0, point);
        next.anchor_direction = next_direction;
        // The three newest anchors stay fixed. Each moved anchor follows the
        // already moved neighbor, including retained dying records.
        for index in 3..next.points.len() {
            let neighbor = next.points[index - 1].position;
            let point = &mut next.points[index];
            let before = point.position;
            let weight = next.contraction * (index - 2).min(4) as f64 / 4.;
            point.position.x += (neighbor.x - point.position.x) * weight;
            point.position.y += (neighbor.y - point.position.y) * weight;
            let moved = difference(point.position, before)?;
            let spacing = f64::from(next.spacing[index.min(SPACING_SAMPLES - 3)]);
            let spacing_change = spacing - point.spacing_multiplier;
            point.spacing_multiplier = spacing;
            if visible {
                point.corrections.inject(
                    [Some(moved.x), Some(moved.y), None, Some(spacing_change)],
                    &next.weights,
                )?;
            }
        }
        *self = next;
        Ok(position)
    }

    /// Mark the oldest living anchor dying and decrement logical length.
    /// Returns false when no living point remains; retained records are not erased.
    pub fn remove_tail(&mut self) -> Result<bool, PresentationError> {
        let Some(tail) = self.points.iter_mut().rev().find(|point| !point.dying) else {
            return Ok(false);
        };
        let remaining = self
            .logical_segments
            .checked_sub(1)
            .ok_or(PresentationError)?;
        tail.dying = true;
        self.logical_segments = remaining;
        Ok(true)
    }

    /// Fade dying anchors and consume correction slots on positive integer steps.
    /// Preserve the three newest dying records even after full fade. A drained
    /// correction ring cleans up only on a subsequent positive call.
    pub fn advance(&mut self, whole_steps: u32) {
        if whole_steps == 0 {
            return;
        }
        let mut dying_count = 0;
        self.points.retain_mut(|point| {
            if point.dying {
                dying_count += 1;
                point.tail_fade = (point.tail_fade + 0.0015 * f64::from(whole_steps)).min(1.);
                if point.tail_fade >= 1. && dying_count >= 4 {
                    return false;
                }
            }
            point.corrections.advance(whole_steps);
            true
        });
    }

    /// Retained anchors in head-to-tail order, including dying points.
    pub fn points(&self) -> &[BodyPoint] {
        &self.points
    }

    /// Logical length, independent of retained physical records.
    pub fn logical_segments(&self) -> usize {
        self.logical_segments
    }

    /// Effective cached wire heading for later relative anchors.
    pub fn anchor_direction(&self) -> Option<u16> {
        self.anchor_direction
    }

    /// Configured distance between directed anchors.
    pub fn segment_length(&self) -> f64 {
        self.segment_length
    }

    /// Configured contraction coefficient.
    pub fn contraction(&self) -> f64 {
        self.contraction
    }

    /// Float32 easing weights for all four body channels.
    pub fn weights(&self) -> &[f32; BODY_SAMPLES] {
        &self.weights
    }

    /// Float32 base spacing table, before per-point spacing corrections.
    pub fn spacing_multipliers(&self) -> &[f32; SPACING_SAMPLES] {
        &self.spacing
    }
}
