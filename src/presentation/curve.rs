//! Bounded, draw-driven sampling of a corrected desktop snake body.

use std::f64::consts::PI;

use super::{BodyPoint, MAX_RETAINED_BODY_POINTS, PresentationError, finite};
use crate::{math, state::Point};

/// Independent retention limit for the active curve, including its terminal sample.
pub const MAX_CURVE_SAMPLES: usize = 65_536;

/// Read-only inputs for one visible desktop draw, with anchors ordered head to tail.
#[derive(Clone, Copy, Debug)]
pub struct CurveInput<'a> {
    /// Absolute head position after applying its displayed positional correction.
    pub corrected_head: Point,
    /// Validated for the caller; desktop curve sampling does not consume this value.
    pub head_fraction: f64,
    /// All retained anchors, including dying points.
    pub body: &'a [BodyPoint],
    /// Current displayed length in logical segment units.
    pub displayed_length: f64,
    /// Positive distance between directed body anchors.
    pub segment_length: f64,
    /// Current draw-driven point spacing, before this draw's transition.
    pub point_spacing: f64,
    /// Positive target point spacing.
    pub target_point_spacing: f64,
    /// Positive sampling-density multiplier, normally between one and 1.7.
    pub quality_scale: f64,
    /// Double the sampling density for a detailed segment style.
    pub detailed_style: bool,
}

/// One active sample in head-to-tail order, rounded at the drawing boundary.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurveSample {
    /// Absolute horizontal position.
    pub x: f32,
    /// Absolute vertical position.
    pub y: f32,
    /// Tailward tangent, in radians.
    pub angle: f32,
}

/// Existing f64 scratch retained for diagnostics without another allocation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurveVertex {
    /// Position before distance redistribution.
    pub sampled: Point,
    /// Position after this draw's redistribution.
    pub position: Point,
    /// Freshly measured incoming distance, or none outside the measured prefix.
    pub distance_from_previous: Option<f64>,
}

/// Complete result of one draw; failure never mutates the borrowed inputs.
#[derive(Clone, Debug, PartialEq)]
pub struct CurveOutput {
    /// Active samples only; length is the authoritative active count.
    pub samples: Vec<CurveSample>,
    /// Point spacing after exactly one draw transition.
    pub point_spacing: f64,
    /// Eye target from the rounded second tangent plus pi, or the supplied raw
    /// heading when `sample_curve_with_heading` emits fewer than two samples.
    pub target_eye_heading: f64,
    vertices: Vec<CurveVertex>,
    redistribution_count: usize,
}

impl CurveOutput {
    /// Pre- and post-redistribution f64 positions in head-to-tail order.
    pub fn vertices(&self) -> &[CurveVertex] {
        &self.vertices
    }

    /// Number of leading vertices considered by distance redistribution.
    pub fn redistribution_count(&self) -> usize {
        self.redistribution_count
    }
}

fn point(x: f64, y: f64) -> Result<Point, PresentationError> {
    finite(&[x, y])?;
    Ok(Point { x, y })
}

fn corrected(body: &BodyPoint) -> Result<Point, PresentationError> {
    let p = body.position();
    let offset = body.position_offset();
    point(p.x + offset.x, p.y + offset.y)
}

fn distance(a: Point, b: Point) -> Result<f64, PresentationError> {
    let x = a.x - b.x;
    let y = a.y - b.y;
    let squared = x * x + y * y;
    finite(&[x, y, squared])?;
    Ok(squared.sqrt())
}

fn midpoint(a: Point, b: Point) -> Result<Point, PresentationError> {
    point(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5)
}

/// Chained interpolation preserves the scalar rounding of a quadratic traversal.
fn quadratic(a: Point, control: Point, b: Point, t: f64) -> Result<Point, PresentationError> {
    let left = point(a.x + (control.x - a.x) * t, a.y + (control.y - a.y) * t)?;
    let right = point(
        control.x + (b.x - control.x) * t,
        control.y + (b.y - control.y) * t,
    )?;
    point(
        left.x + (right.x - left.x) * t,
        left.y + (right.y - left.y) * t,
    )
}

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Body,
    Terminal,
    Finished,
}

struct LengthBudget {
    remaining: f64,
    phase: Phase,
}

impl LengthBudget {
    fn continues(&self) -> bool {
        self.phase != Phase::Finished && (self.remaining >= 0. || self.phase == Phase::Terminal)
    }

    fn settle(&mut self) {
        if (-0.0001..=0.).contains(&self.remaining) {
            self.remaining = 0.;
        }
    }

    /// A terminal endpoint is emitted once after the last fractional interval.
    fn consume(
        &mut self,
        step: f64,
        clear_remainder: bool,
    ) -> Result<Option<f64>, PresentationError> {
        if self.phase == Phase::Terminal {
            self.phase = Phase::Finished;
            return Ok(None);
        }
        self.remaining -= step;
        finite(&[self.remaining])?;
        let advance = if self.remaining <= 0. {
            self.phase = Phase::Terminal;
            let advance = step + self.remaining;
            if clear_remainder {
                self.remaining = 0.;
            }
            advance
        } else {
            step
        };
        finite(&[advance])?;
        Ok(Some(advance))
    }
}

struct Scratch {
    vertices: Vec<CurveVertex>,
    measured: usize,
}

impl Scratch {
    fn push(
        &mut self,
        position: Point,
        measure: bool,
        fixed_distance: Option<f64>,
    ) -> Result<(), PresentationError> {
        if self.vertices.len() == MAX_CURVE_SAMPLES {
            return Err(PresentationError);
        }
        finite(&[position.x, position.y])?;
        let incoming = if measure {
            let value = match fixed_distance {
                Some(value) => value,
                None => distance(
                    position,
                    self.vertices.last().ok_or(PresentationError)?.sampled,
                )?,
            };
            finite(&[value])?;
            self.measured += 1;
            Some(value)
        } else {
            None
        };
        self.vertices.push(CurveVertex {
            sampled: position,
            position,
            distance_from_previous: incoming,
        });
        Ok(())
    }

    fn redistribute(&mut self) -> Result<usize, PresentationError> {
        self.redistribute_prefix(self.measured.saturating_sub(1))
    }

    fn redistribute_prefix(&mut self, count: usize) -> Result<usize, PresentationError> {
        let count = count.min(self.vertices.len());
        if count < 3 {
            return Ok(0);
        }
        let mut total = 0.;
        for vertex in &self.vertices[..count - 1] {
            total += vertex.distance_from_previous.ok_or(PresentationError)?;
        }
        let interval = total / (count - 2) as f64;
        finite(&[total, interval])?;
        let mut segment = 1;
        let mut previous = self.vertices[0].sampled;
        let mut along = interval;
        for index in 1..count {
            loop {
                let next = self.vertices[segment];
                let edge = next.distance_from_previous.ok_or(PresentationError)?;
                if along < edge {
                    let mut p = point(
                        previous.x + (next.sampled.x - previous.x) * along / edge,
                        previous.y + (next.sampled.y - previous.y) * along / edge,
                    )?;
                    let original = self.vertices[index].sampled;
                    let restoration = math::pow(index as f64 / count as f64, 2.);
                    p.x += (original.x - p.x) * restoration;
                    p.y += (original.y - p.y) * restoration;
                    finite(&[p.x, p.y])?;
                    self.vertices[index].position = p;
                    along += interval;
                    finite(&[along])?;
                    break;
                }
                along -= edge;
                previous = next.sampled;
                segment += 1;
                if segment >= count {
                    return Ok(count);
                }
            }
        }
        Ok(count)
    }
}

fn positive(value: f64) -> Result<(), PresentationError> {
    if value.is_finite() && value > 0. {
        Ok(())
    } else {
        Err(PresentationError)
    }
}

/// Sample one visible curve, preserving retained geometry and draw arithmetic.
/// Call this exactly once per visible draw; no animation clock advances here.
pub fn sample_curve(input: CurveInput<'_>) -> Result<CurveOutput, PresentationError> {
    sample_curve_inner(input, None)
}

/// Sample with the raw head heading needed when fewer than two samples are emitted.
/// A single sample retains its zero tangent; only the eye target uses this heading.
pub fn sample_curve_with_heading(
    input: CurveInput<'_>,
    raw_heading: f64,
) -> Result<CurveOutput, PresentationError> {
    finite(&[raw_heading])?;
    sample_curve_inner(input, Some(raw_heading))
}

fn sampling_parameters(input: CurveInput<'_>) -> Result<(f64, f64), PresentationError> {
    finite(&[
        input.corrected_head.x,
        input.corrected_head.y,
        input.head_fraction,
        input.displayed_length,
    ])?;
    for value in [
        input.segment_length,
        input.point_spacing,
        input.target_point_spacing,
        input.quality_scale,
    ] {
        positive(value)?;
    }
    if input.body.is_empty() || input.body.len() > MAX_RETAINED_BODY_POINTS {
        return Err(PresentationError);
    }
    for body in input.body {
        let p = body.position();
        let offsets = body.offset();
        finite(&[p.x, p.y, body.edge_length(), body.spacing_multiplier()])?;
        finite(&offsets)?;
        corrected(body)?;
        // Arrival corrections can collapse or reverse a signed traversal interval.
        finite(&[body.edge_length() + offsets[2]])?;
        positive(body.spacing_multiplier() + offsets[3])?;
    }
    let mut spacing = input.point_spacing;
    if spacing < input.target_point_spacing {
        spacing += 0.0035;
        if spacing >= input.target_point_spacing {
            spacing = input.target_point_spacing;
        }
    } else if spacing > input.target_point_spacing {
        spacing -= 0.0035;
        if spacing <= input.target_point_spacing {
            spacing = input.target_point_spacing;
        }
    }
    positive(spacing)?;
    let mut density = 6. / (input.quality_scale * spacing / 6.);
    if input.detailed_style {
        density *= 2.;
    }
    positive(density)?;
    Ok((spacing, density))
}

struct HeadLead {
    scratch: Scratch,
    budget: LengthBudget,
    front: Point,
    start: Point,
    scale: f64,
    length: f64,
    cursor: f64,
}

fn sample_head_lead(
    input: CurveInput<'_>,
    increment: f64,
    world_step: f64,
) -> Result<HeadLead, PresentationError> {
    positive(increment)?;
    positive(world_step)?;
    let mut scratch = Scratch {
        vertices: Vec::new(),
        measured: 0,
    };
    let mut budget = LengthBudget {
        remaining: input.displayed_length,
        phase: Phase::Body,
    };
    let head = input.corrected_head;
    let front = corrected(&input.body[0])?;
    let gap = distance(head, front)?;
    // At coincidence the direction is unused: the straight lead-in has zero extent.
    let direction = if gap == 0. {
        Point::default()
    } else {
        point((head.x - front.x) / gap, (head.y - front.y) / gap)?
    };
    let scale = gap / input.segment_length;
    finite(&[scale])?;
    let capped = if gap > input.segment_length {
        point(
            front.x + direction.x * input.segment_length,
            front.y + direction.y * input.segment_length,
        )?
    } else {
        head
    };
    let mut start = midpoint(capped, front)?;
    if scale < 1. {
        start.x += (capped.x - start.x) * (1. - scale);
        start.y += (capped.y - start.y) * (1. - scale);
    }
    let lead_length = distance(head, start)?;
    scratch.push(head, true, Some(0.))?;
    let mut walked = world_step;
    let mut multiplier = 1.;
    while walked < lead_length {
        scratch.push(
            point(
                head.x - multiplier * direction.x * world_step,
                head.y - multiplier * direction.y * world_step,
            )?,
            true,
            Some(world_step),
        )?;
        let Some(advance) = budget.consume(increment, false)? else {
            break;
        };
        if budget.phase == Phase::Terminal {
            let fraction = advance / increment;
            multiplier += fraction;
            walked += world_step * fraction;
        } else {
            multiplier += 1.;
            walked += world_step;
        }
        finite(&[multiplier, walked])?;
    }
    let cursor = (walked - lead_length) / input.segment_length;
    finite(&[cursor])?;
    Ok(HeadLead {
        scratch,
        budget,
        front,
        start,
        scale,
        length: lead_length,
        cursor,
    })
}

/// One anchor has no independent quadratic or tail geometry. Use only a finite
/// lead whose eye target cannot depend on a missing following anchor; otherwise
/// retain the raw heading as an explicit unsupported-geometry fallback.
pub(super) fn single_anchor_eye_target(
    input: CurveInput<'_>,
    raw_heading: f64,
) -> Result<f64, PresentationError> {
    finite(&[raw_heading])?;
    if input.body.len() != 1 {
        return Err(PresentationError);
    }
    let (_, density) = sampling_parameters(input)?;
    let mut lead = sample_head_lead(input, 1. / density, input.segment_length / density)?;
    lead.budget.settle();
    if !lead.budget.continues() {
        lead.scratch.redistribute()?;
    } else if lead.budget.phase == Phase::Terminal {
        let extent = 0.5 + lead.scale - lead.length / input.segment_length;
        finite(&[extent])?;
        if lead.cursor < 0. || lead.cursor >= extent {
            return Ok(raw_heading);
        }
        // A single terminal quadratic sample would be excluded from this
        // prefix. Its missing coordinates and incoming distance are never used.
        lead.scratch.redistribute_prefix(lead.scratch.measured)?;
    } else {
        return Ok(raw_heading);
    }
    let [first, second, ..] = lead.scratch.vertices.as_slice() else {
        return Ok(raw_heading);
    };
    let delta = point(
        second.position.x - first.position.x,
        second.position.y - first.position.y,
    )?;
    let angle = math::atan2(delta.y, delta.x) as f32;
    finite(&[f64::from(angle)])?;
    Ok(f64::from(angle) + PI)
}

fn sample_curve_inner(
    input: CurveInput<'_>,
    raw_heading: Option<f64>,
) -> Result<CurveOutput, PresentationError> {
    if input.body.len() < 2 {
        return Err(PresentationError);
    }
    let (spacing, mut density) = sampling_parameters(input)?;
    let base_density = density;
    let mut increment = 1. / density;
    let mut world_step = input.segment_length / density;
    let HeadLead {
        mut scratch,
        mut budget,
        front,
        start,
        scale,
        length: lead_length,
        mut cursor,
    } = sample_head_lead(input, increment, world_step)?;
    let head = input.corrected_head;
    let following = corrected(&input.body[1])?;
    let end = midpoint(following, front)?;
    if budget.phase != Phase::Finished {
        budget.settle();
        if budget.continues() {
            let mut control = front;
            if scale < 1. {
                control.x += (end.x - control.x) * 0.5 * (1. - scale);
                control.y += (end.y - control.y) * 0.5 * (1. - scale);
            }
            let extent = 0.5 + scale - lead_length / input.segment_length;
            finite(&[extent, control.x, control.y])?;
            while cursor >= 0. && cursor < extent {
                scratch.push(quadratic(start, control, end, cursor / extent)?, true, None)?;
                let Some(advance) = budget.consume(increment, true)? else {
                    break;
                };
                let next = cursor + advance;
                if next == cursor && budget.phase != Phase::Terminal {
                    return Err(PresentationError);
                }
                cursor = next;
            }
            cursor -= extent;
            finite(&[cursor])?;
        }
        budget.settle();
    }
    let mut tail_pair = (front, following);
    // Two-anchor bodies never establish an interior distance-measurement cutoff.
    let mut distance_cutoff = None;
    if budget.continues() {
        let mut carry_fraction = 0.;
        let mut traversed = false;
        let mut prior = &input.body[0];
        for window in input.body.windows(3) {
            let [anchor, control, following] = window else {
                unreachable!()
            };
            tail_pair = (corrected(control)?, corrected(following)?);
            let a = corrected(anchor)?;
            let c = tail_pair.0;
            let b = tail_pair.1;
            let start = midpoint(a, c)?;
            let end = midpoint(c, b)?;
            let extent = anchor.edge_length() + anchor.edge_length_offset();
            distance_cutoff = Some(base_density * 2. + 2.);
            if anchor.spacing_multiplier() != prior.spacing_multiplier()
                || anchor.spacing_offset() != prior.spacing_offset()
            {
                cursor *= (prior.spacing_multiplier() + prior.spacing_offset())
                    / (anchor.spacing_multiplier() + anchor.spacing_offset());
                density = base_density * (anchor.spacing_multiplier() + anchor.spacing_offset());
                positive(density)?;
                increment = 1. / density;
                world_step = input.segment_length / density;
                positive(increment)?;
                positive(world_step)?;
            }
            budget.remaining -= carry_fraction * increment;
            finite(&[cursor, budget.remaining])?;
            while cursor < extent {
                if extent == 0. {
                    // Entered zero-width intervals have no finite parameterization.
                    return Err(PresentationError);
                }
                let measure = distance_cutoff.is_some_and(|limit| scratch.measured as f64 <= limit);
                scratch.push(quadratic(start, c, end, cursor / extent)?, measure, None)?;
                let Some(advance) = budget.consume(increment, false)? else {
                    break;
                };
                let next = cursor + advance;
                if next == cursor && budget.phase != Phase::Terminal {
                    return Err(PresentationError);
                }
                cursor = next;
            }
            cursor -= extent;
            carry_fraction = cursor / increment;
            budget.remaining += cursor;
            finite(&[cursor, carry_fraction, budget.remaining])?;
            traversed = true;
            prior = anchor;
            if budget.phase == Phase::Finished {
                break;
            }
        }
        if traversed {
            budget.remaining -= cursor;
        }
    }
    if budget.phase != Phase::Finished {
        budget.settle();
        if budget.continues() {
            let (near, far) = tail_pair;
            while budget.continues() {
                let p = point(
                    far.x - (near.x - far.x) * (cursor - 0.5),
                    far.y - (near.y - far.y) * (cursor - 0.5),
                )?;
                let measure = distance_cutoff.is_some_and(|limit| scratch.measured as f64 <= limit);
                scratch.push(p, measure, None)?;
                let Some(advance) = budget.consume(increment, false)? else {
                    break;
                };
                let next = cursor + advance;
                if next == cursor && budget.phase != Phase::Terminal {
                    return Err(PresentationError);
                }
                cursor = next;
                budget.settle();
            }
        }
    }
    let redistribution_count = scratch.redistribute()?;
    let mut samples = Vec::with_capacity(scratch.vertices.len());
    let mut previous = head;
    for (index, vertex) in scratch.vertices.iter().enumerate() {
        let p = vertex.position;
        let angle = if index == 0 {
            0.
        } else {
            let delta = point(p.x - previous.x, p.y - previous.y)?;
            math::atan2(delta.y, delta.x)
        };
        let sample = CurveSample {
            x: p.x as f32,
            y: p.y as f32,
            angle: angle as f32,
        };
        if !sample.x.is_finite() || !sample.y.is_finite() || !sample.angle.is_finite() {
            return Err(PresentationError);
        }
        samples.push(sample);
        previous = p;
    }
    let target_eye_heading = if samples.len() >= 2 {
        samples[0].angle = samples[1].angle;
        f64::from(samples[1].angle) + PI
    } else {
        raw_heading.ok_or(PresentationError)?
    };
    Ok(CurveOutput {
        samples,
        point_spacing: spacing,
        target_eye_heading,
        vertices: scratch.vertices,
        redistribution_count,
    })
}
