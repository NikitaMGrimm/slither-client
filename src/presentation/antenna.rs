//! Draw-cadenced ordinary antenna geometry, independent of assets and clocks.

use std::{
    error::Error,
    f64::consts::{PI, TAU},
    fmt,
    sync::OnceLock,
};

use super::{BodyPaintView, BodyRect};
use crate::{math, state::Point};

/// Maximum nodes in the represented ordinary topology.
pub const MAX_ANTENNA_NODES: usize = 11;

/// Numeric whole-source bulb layout. No asset identity is retained.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AntennaBulbGeometry {
    /// Signed nominal horizontal destination offset, magnitude at most 65535.
    pub offset_x: f64,
    /// Signed nominal vertical destination offset, magnitude at most 65535.
    pub offset_y: f64,
    /// Positive nominal destination width, at most 65535.
    pub width: f64,
    /// Positive nominal destination height, at most 65535.
    pub height: f64,
    /// Positive image multiplier, at most 256.
    pub scale: f64,
    /// Image opacity, zero through one.
    pub opacity: f64,
}

/// Explicit appearance metadata for the supported ordinary chain.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrdinaryAntennaGeometry {
    /// Exactly 8, 9 or 11 nodes, including the root.
    pub nodes: usize,
    /// Packed 24-bit RGB outer stroke.
    pub outer_color: u32,
    /// Packed 24-bit RGB inner stroke.
    pub inner_color: u32,
    /// Inner stroke multiplier, zero through one.
    pub inner_opacity: f64,
    /// Repeat the same inner path with widths three and two.
    pub repeated_inner_strokes: bool,
    /// Retain and ease the tip heading before drawing the bulb.
    pub rotate_bulb: bool,
    /// Whole-source image geometry, independent of intrinsic dimensions.
    pub bulb: AntennaBulbGeometry,
}

impl OrdinaryAntennaGeometry {
    /// Validate numeric metadata without loading or selecting assets.
    pub fn validate(&self) -> Result<(), AntennaError> {
        let b = self.bulb;
        if !matches!(self.nodes, 8 | 9 | 11)
            || self.outer_color > 0xff_ffff
            || self.inner_color > 0xff_ffff
            || !unit(self.inner_opacity)
            || !unit(b.opacity)
            || ![b.offset_x, b.offset_y]
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 65535.)
            || ![b.width, b.height]
                .iter()
                .all(|v| v.is_finite() && *v > 0. && *v <= 65535.)
            || !b.scale.is_finite()
            || b.scale <= 0.
            || b.scale > 256.
        {
            return Err(AntennaError::InvalidGeometry);
        }
        Ok(())
    }

    /// Exact appearance/draw agreement, preserving accepted signed zeros.
    pub fn same_bits(&self, other: &Self) -> bool {
        self.nodes == other.nodes
            && self.outer_color == other.outer_color
            && self.inner_color == other.inner_color
            && self.repeated_inner_strokes == other.repeated_inner_strokes
            && self.rotate_bulb == other.rotate_bulb
            && [
                self.inner_opacity,
                self.bulb.offset_x,
                self.bulb.offset_y,
                self.bulb.width,
                self.bulb.height,
                self.bulb.scale,
                self.bulb.opacity,
            ]
            .iter()
            .zip([
                other.inner_opacity,
                other.bulb.offset_x,
                other.bulb.offset_y,
                other.bulb.width,
                other.bulb.height,
                other.bulb.scale,
                other.bulb.opacity,
            ])
            .all(|(a, b)| a.to_bits() == b.to_bits())
    }
}

/// Retained world bounds, refreshed only by caller-owned camera preparation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AntennaCullBounds {
    /// Inclusive minimum horizontal world position.
    pub min_x: f64,
    /// Inclusive maximum horizontal world position.
    pub max_x: f64,
    /// Inclusive minimum vertical world position.
    pub min_y: f64,
    /// Inclusive maximum vertical world position.
    pub max_y: f64,
}

impl AntennaCullBounds {
    /// Derive the independent 210-world-unit antenna margin.
    pub fn from_view(view: BodyPaintView) -> Result<Self, AntennaError> {
        validate_view(view)?;
        let ex = view.half_width / view.zoom + 210.;
        let ey = view.half_height / view.zoom + 210.;
        let result = Self {
            min_x: view.camera.x - ex,
            max_x: view.camera.x + ex,
            min_y: view.camera.y - ey,
            max_y: view.camera.y + ey,
        };
        result.validate()?;
        Ok(result)
    }

    /// Check externally retained bounds before use.
    pub fn validate(&self) -> Result<(), AntennaError> {
        if !finite(&[self.min_x, self.max_x, self.min_y, self.max_y])
            || self.min_x > self.max_x
            || self.min_y > self.max_y
        {
            return Err(AntennaError::InvalidInput);
        }
        Ok(())
    }

    fn contains(self, p: Point) -> bool {
        p.x >= self.min_x && p.x <= self.max_x && p.y >= self.min_y && p.y <= self.max_y
    }
}

/// Frozen draw-time values. No clock, quality switch or random callback is read.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AntennaDrawInput {
    /// Uncorrected motion heading, independent of face/curve heading.
    pub raw_heading: f64,
    /// Corrected double-precision absolute head.
    pub corrected_head: Point,
    /// Positive finite current entity scale.
    pub scale: f64,
    /// Spawn lifecycle progress, zero through one.
    pub spawn: f64,
    /// Death lifecycle progress, zero through one.
    pub death: f64,
    /// Active sampled curve prefix, including culled points.
    pub active_curve_count: usize,
    /// Whole-snake visibility; false preserves the chain and shown latch.
    pub whole_snake_visible: bool,
    /// Already prepared camera and canvas center.
    pub view: BodyPaintView,
    /// Caller-retained independent antenna bounds; initially absent.
    pub bounds: Option<AntennaCullBounds>,
}

/// Explicit scratch mutation at the body/death insertion barrier.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AntennaBarrierEffect {
    /// No reached antenna branch; preserve all body scratch state.
    Disabled,
    /// Visible branch with failed inner gate: raw-heading cosine/sine cursor.
    Rejected {
        /// Raw-heading cosine and sine, without world or view conversion.
        cursor: Point,
    },
    /// Successful inner path leaves its relative-screen cursor and bulb alpha.
    Eligible {
        /// Last accepted inner-path vertex in center-relative screen coordinates.
        cursor: Point,
        /// Body-scope alpha left by the bulb before the death lane.
        scoped_alpha: f64,
    },
}

/// Path selected by an ordered stroke; repeated strokes reuse the inner path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AntennaPath {
    /// Outer path ending at the optional root midpoint.
    Outer,
    /// Inner path including the root candidate and reused for repeated strokes.
    Inner,
}

/// One source-over stroke, always with round line cap and join.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AntennaStroke {
    /// Existing path to stroke without reconstructing or closing it.
    pub path: AntennaPath,
    /// Packed 24-bit RGB.
    pub color: u32,
    /// Positive screen width.
    pub width: f64,
    /// Scoped global alpha, including zero.
    pub alpha: f64,
}

/// One five-argument whole-source bulb draw, using a caller-borrowed ready image.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AntennaBulbCommand {
    /// Backing-canvas center translation, kept separate.
    pub center: Point,
    /// Tip translation only in rotating mode; zero otherwise.
    pub translation: Point,
    /// Separate rotate operation; absent in nonrotating mode.
    pub rotation: Option<f64>,
    /// Whole-source destination, retaining each branch's arithmetic order.
    pub destination: BodyRect,
    /// Scoped image opacity, including zero.
    pub alpha: f64,
}

/// Owned native plan; no source identity or raster object is stored.
#[derive(Clone, Debug, PartialEq)]
pub struct PreparedAntenna {
    /// Backing-canvas translation for both paths.
    pub center: Point,
    /// Open outer path: tip through accepted nodes and optional root midpoint.
    pub outer_path: Vec<Point>,
    /// Open inner path: tip through accepted nodes, including the root candidate.
    pub inner_path: Vec<Point>,
    /// Exact outer/inner/repeated-inner source-over stroke order.
    pub strokes: Vec<AntennaStroke>,
    /// One whole-source image for eligible draws.
    pub bulb: Option<AntennaBulbCommand>,
    /// Effect to apply before calculating body death commands.
    pub barrier_effect: AntennaBarrierEffect,
}

/// A copied active-channel diagnostic, never a mutable state capability.
#[derive(Clone, Debug, PartialEq)]
pub struct AntennaSnapshot {
    /// Appearance-owned metadata.
    pub geometry: OrdinaryAntennaGeometry,
    /// Active absolute horizontal positions.
    pub x: Vec<f32>,
    /// Active absolute vertical positions.
    pub y: Vec<f32>,
    /// Active horizontal velocities.
    pub velocity_x: Vec<f32>,
    /// Active vertical velocities.
    pub velocity_y: Vec<f32>,
    /// Retained zero-initialized horizontal acceleration channel.
    pub acceleration_x: Vec<f32>,
    /// Retained zero-initialized vertical acceleration channel.
    pub acceleration_y: Vec<f32>,
    /// Visibility-reentry latch.
    pub shown: bool,
    /// Retained double-precision signed-remainder bulb heading.
    pub bulb_rotation: f64,
}

/// Stable appearance-owned chain, with separate binary32 stores per channel.
#[derive(Clone, Debug, PartialEq)]
pub struct AntennaState {
    data: AntennaSnapshot,
}

/// Validated owned gate result; finishing cannot mutate the source state.
#[derive(Clone, Debug)]
pub struct AntennaDrawRequest {
    state: AntennaState,
    input: AntennaDrawInput,
    root: Point,
    direction: Point,
    reached: bool,
    eligible: bool,
}

/// Closed validation and arithmetic errors, without partial state output.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AntennaError {
    /// Unsupported node count or out-of-domain appearance metadata.
    InvalidGeometry,
    /// Invalid draw/view/bounds or unrepresentable initial binary32 position.
    InvalidInput,
    /// Wrong pair count or a nonfinite/out-of-range random unit.
    InvalidRandomPairs,
    /// A computed chain, path or destination value is nonfinite or unusable.
    Arithmetic,
}

impl fmt::Display for AntennaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ordinary antenna input failed: {self:?}")
    }
}
impl Error for AntennaError {}

fn finite(v: &[f64]) -> bool {
    v.iter().all(|x| x.is_finite())
}
fn unit(v: f64) -> bool {
    v.is_finite() && (0. ..=1.).contains(&v)
}
fn validate_view(v: BodyPaintView) -> Result<(), AntennaError> {
    if !finite(&[v.camera.x, v.camera.y, v.zoom, v.half_width, v.half_height])
        || v.zoom <= 0.
        || v.half_width < 0.
        || v.half_height < 0.
    {
        return Err(AntennaError::InvalidInput);
    }
    Ok(())
}

impl AntennaState {
    /// Initialize six active binary32 channels without randomness.
    pub fn from_appearance(
        geometry: OrdinaryAntennaGeometry,
        head: Point,
    ) -> Result<Self, AntennaError> {
        geometry.validate()?;
        if !(head.x as f32).is_finite() || !(head.y as f32).is_finite() {
            return Err(AntennaError::InvalidInput);
        }
        let n = geometry.nodes;
        Ok(Self {
            data: AntennaSnapshot {
                geometry,
                x: vec![head.x as f32; n],
                y: vec![head.y as f32; n],
                velocity_x: vec![0.; n],
                velocity_y: vec![0.; n],
                acceleration_x: vec![0.; n],
                acceleration_y: vec![0.; n],
                shown: false,
                bulb_rotation: 0.,
            },
        })
    }

    /// Copy all active channels and numeric metadata for diagnostics.
    pub fn snapshot(&self) -> AntennaSnapshot {
        self.data.clone()
    }

    /// Immutable retained numeric geometry.
    pub fn geometry(&self) -> OrdinaryAntennaGeometry {
        self.data.geometry
    }

    /// Freeze gating before the caller reserves exactly the needed random pairs.
    pub fn prepare_draw(
        &self,
        input: AntennaDrawInput,
    ) -> Result<AntennaDrawRequest, AntennaError> {
        validate_view(input.view)?;
        if !finite(&[
            input.raw_heading,
            input.corrected_head.x,
            input.corrected_head.y,
            input.scale,
        ]) || input.scale <= 0.
            || !unit(input.spawn)
            || !unit(input.death)
            || input.active_curve_count > super::MAX_CURVE_SAMPLES
        {
            return Err(AntennaError::InvalidInput);
        }
        if let Some(b) = input.bounds {
            b.validate()?;
        }
        let direction = Point {
            x: math::cos(input.raw_heading),
            y: math::sin(input.raw_heading),
        };
        let root = Point {
            x: input.corrected_head.x - direction.x * 8. * input.scale,
            y: input.corrected_head.y - direction.y * 8. * input.scale,
        };
        if !finite(&[root.x, root.y]) {
            return Err(AntennaError::Arithmetic);
        }
        let eligible = input.whole_snake_visible
            && input.active_curve_count >= 2
            && input.bounds.is_some_and(|b| b.contains(root));
        Ok(AntennaDrawRequest {
            state: self.clone(),
            input,
            root,
            direction,
            reached: input.whole_snake_visible,
            eligible,
        })
    }
}

impl AntennaDrawRequest {
    /// Exact x/y pairs required, logically x then y for each nonroot node.
    pub fn random_pair_count(&self) -> usize {
        if self.eligible {
            self.state.data.geometry.nodes - 1
        } else {
            0
        }
    }

    /// Validate the complete tape and return staged state and owned commands.
    pub fn finish(
        mut self,
        pairs: &[[f64; 2]],
    ) -> Result<(AntennaState, PreparedAntenna), AntennaError> {
        if pairs.len() != self.random_pair_count()
            || !pairs
                .iter()
                .flatten()
                .all(|u| u.is_finite() && (0. ..1.).contains(u))
        {
            return Err(AntennaError::InvalidRandomPairs);
        }
        let center = Point {
            x: self.input.view.half_width,
            y: self.input.view.half_height,
        };
        let mut plan = PreparedAntenna {
            center,
            outer_path: Vec::new(),
            inner_path: Vec::new(),
            strokes: Vec::new(),
            bulb: None,
            barrier_effect: AntennaBarrierEffect::Disabled,
        };
        if !self.eligible {
            if self.reached {
                self.state.data.shown = false;
                plan.barrier_effect = AntennaBarrierEffect::Rejected {
                    cursor: self.direction,
                };
            }
            return Ok((self.state, plan));
        }
        let s = &mut self.state.data;
        let scale = self.input.scale;
        s.x[0] = self.root.x as f32;
        s.y[0] = self.root.y as f32;
        if !s.shown {
            s.shown = true;
            for j in 1..s.geometry.nodes {
                s.x[j] = (self.root.x - self.direction.x * j as f64 * 4. * scale) as f32;
                s.y[j] = (self.root.y - self.direction.y * j as f64 * 4. * scale) as f32;
            }
        }
        for (j, pair) in (1..s.geometry.nodes).zip(pairs) {
            let mut qx = f64::from(s.x[j - 1]);
            let mut qy = f64::from(s.y[j - 1]);
            qx += pair[0] * 2. - 1.;
            qy += pair[1] * 2. - 1.;
            let phi = lookup_angle(f64::from(s.x[j]) - qx, f64::from(s.y[j]) - qy)?;
            qx += math::cos(phi) * 4. * scale;
            qy += math::sin(phi) * 4. * scale;
            s.velocity_x[j] = (f64::from(s.velocity_x[j]) + (qx - f64::from(s.x[j])) * 0.1) as f32;
            s.velocity_y[j] = (f64::from(s.velocity_y[j]) + (qy - f64::from(s.y[j])) * 0.1) as f32;
            s.x[j] = (f64::from(s.x[j]) + f64::from(s.velocity_x[j])) as f32;
            s.y[j] = (f64::from(s.y[j]) + f64::from(s.velocity_y[j])) as f32;
            s.velocity_x[j] = (f64::from(s.velocity_x[j]) * 0.88) as f32;
            s.velocity_y[j] = (f64::from(s.velocity_y[j]) * 0.88) as f32;
            let dx = f64::from(s.x[j]) - f64::from(s.x[j - 1]);
            let dy = f64::from(s.y[j]) - f64::from(s.y[j - 1]);
            let distance = (dx * dx + dy * dy).sqrt();
            if !distance.is_finite() {
                return Err(AntennaError::Arithmetic);
            }
            if distance > 4. * scale {
                let phi = lookup_angle(dx, dy)?;
                s.x[j] = (f64::from(s.x[j - 1]) + math::cos(phi) * 4. * scale) as f32;
                s.y[j] = (f64::from(s.y[j - 1]) + math::sin(phi) * 4. * scale) as f32;
            }
        }
        if !s
            .x
            .iter()
            .chain(&s.y)
            .chain(&s.velocity_x)
            .chain(&s.velocity_y)
            .all(|v| v.is_finite())
        {
            return Err(AntennaError::Arithmetic);
        }
        let view = self.input.view;
        let position = |j: usize| Point {
            x: (f64::from(s.x[j]) - view.camera.x) * view.zoom,
            y: (f64::from(s.y[j]) - view.camera.y) * view.zoom,
        };
        let last = s.geometry.nodes - 1;
        let tip = position(last);
        plan.outer_path.push(tip);
        for j in (1..last).rev() {
            append(&mut plan.outer_path, position(j))?;
        }
        append(
            &mut plan.outer_path,
            Point {
                x: ((f64::from(s.x[1]) + f64::from(s.x[0])) * 0.5 - view.camera.x) * view.zoom,
                y: ((f64::from(s.y[1]) + f64::from(s.y[0])) * 0.5 - view.camera.y) * view.zoom,
            },
        )?;
        plan.inner_path.push(tip);
        for j in (0..last).rev() {
            append(&mut plan.inner_path, position(j))?;
        }
        let mut alpha = self.input.spawn * (1. - self.input.death);
        alpha *= alpha;
        let m = scale * view.zoom;
        plan.strokes.push(AntennaStroke {
            path: AntennaPath::Outer,
            color: s.geometry.outer_color,
            width: 5. * m,
            alpha,
        });
        let inner_alpha = s.geometry.inner_opacity * alpha;
        plan.strokes.push(AntennaStroke {
            path: AntennaPath::Inner,
            color: s.geometry.inner_color,
            width: 4. * m,
            alpha: inner_alpha,
        });
        if s.geometry.repeated_inner_strokes {
            for width in [3. * m, 2. * m] {
                plan.strokes.push(AntennaStroke {
                    path: AntennaPath::Inner,
                    color: s.geometry.inner_color,
                    width,
                    alpha: inner_alpha,
                });
            }
        }
        let b = s.geometry.bulb;
        let (translation, rotation, x, y) = if s.geometry.rotate_bulb {
            let mut delta = math::atan2(
                f64::from(s.y[last]) - f64::from(s.y[last - 1]),
                f64::from(s.x[last]) - f64::from(s.x[last - 1]),
            ) - s.bulb_rotation;
            if !(0. ..TAU).contains(&delta) {
                delta %= TAU;
            }
            if delta < -PI {
                delta += TAU;
            } else if delta > PI {
                delta -= TAU;
            }
            s.bulb_rotation = (s.bulb_rotation + delta * 0.15) % TAU;
            (
                tip,
                Some(s.bulb_rotation),
                b.offset_x * b.scale * m,
                b.offset_y * b.scale * m,
            )
        } else {
            (
                Point { x: 0., y: 0. },
                None,
                (f64::from(s.x[last]) - view.camera.x + b.offset_x * b.scale * scale) * view.zoom,
                (f64::from(s.y[last]) - view.camera.y + b.offset_y * b.scale * scale) * view.zoom,
            )
        };
        let bulb_alpha = alpha * b.opacity;
        let destination = BodyRect {
            x,
            y,
            width: b.width * b.scale * m,
            height: b.height * b.scale * m,
        };
        if !finite(&[
            tip.x,
            tip.y,
            x,
            y,
            destination.width,
            destination.height,
            m,
            s.bulb_rotation,
        ]) || !plan
            .strokes
            .iter()
            .all(|stroke| stroke.width.is_finite() && stroke.width > 0.)
        {
            return Err(AntennaError::Arithmetic);
        }
        plan.bulb = Some(AntennaBulbCommand {
            center,
            translation,
            rotation,
            destination,
            alpha: bulb_alpha,
        });
        plan.barrier_effect = AntennaBarrierEffect::Eligible {
            cursor: *plan.inner_path.last().expect("tip is present"),
            scoped_alpha: bulb_alpha,
        };
        Ok((self.state, plan))
    }
}

fn append(path: &mut Vec<Point>, point: Point) -> Result<(), AntennaError> {
    let previous = path.last().expect("tip is present");
    let distance = (point.x - previous.x).abs() + (point.y - previous.y).abs();
    if !finite(&[point.x, point.y, distance]) {
        return Err(AntennaError::Arithmetic);
    }
    if distance >= 1. {
        path.push(point);
    }
    Ok(())
}

fn lookup_angle(dx: f64, dy: f64) -> Result<f64, AntennaError> {
    let multiplier = [
        (-4., 4., 32.),
        (-8., 8., 16.),
        (-16., 16., 8.),
        (-127., 127., 1.),
    ]
    .into_iter()
    .find(|&(low, high, _)| dx >= low && dx < high && dy >= low && dy < high)
    .map(|(_, _, m)| m);
    if let Some(m) = multiplier {
        // The bounded shifted operands are nonnegative: these casts are ToInt32.
        let x = (dx * m + 128.) as usize;
        let y = (dy * m + 128.) as usize;
        static TABLE: OnceLock<Vec<f32>> = OnceLock::new();
        let table = TABLE.get_or_init(|| {
            (0..65536)
                .map(|i| math::atan2((i >> 8) as f64 - 128., (i & 255) as f64 - 128.) as f32)
                .collect()
        });
        // A component just below the strict upper bound can round to 256 after
        // shifting. Preserve the combined index; an absent cell is arithmetic
        // failure rather than a clamped angle or a native indexing panic.
        table
            .get((y << 8) | x)
            .copied()
            .map(f64::from)
            .ok_or(AntennaError::Arithmetic)
    } else {
        Ok(math::atan2(dy, dx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry() -> OrdinaryAntennaGeometry {
        OrdinaryAntennaGeometry {
            nodes: 8,
            outer_color: 0,
            inner_color: 1,
            inner_opacity: 0.5,
            repeated_inner_strokes: false,
            rotate_bulb: true,
            bulb: AntennaBulbGeometry {
                offset_x: 0.,
                offset_y: 0.,
                width: 1.,
                height: 1.,
                scale: 1.,
                opacity: 1.,
            },
        }
    }
    fn input() -> AntennaDrawInput {
        AntennaDrawInput {
            raw_heading: 0.,
            corrected_head: Point {
                x: 8.0000003,
                y: 0.0000002,
            },
            scale: 1.,
            spawn: 1.,
            death: 0.,
            active_curve_count: 2,
            whole_snake_visible: true,
            view: BodyPaintView {
                camera: Point { x: 0., y: 0. },
                zoom: 1.,
                half_width: 10.,
                half_height: 10.,
            },
            bounds: Some(AntennaCullBounds {
                min_x: -100.,
                max_x: 100.,
                min_y: -100.,
                max_y: 100.,
            }),
        }
    }
    #[test]
    fn lookup_thresholds_to_int32_and_host_fallback_are_exact() {
        let quantized = |dx: f64, dy: f64, m: f64| {
            let x = (dx * m + 128.) as i32;
            let y = (dy * m + 128.) as i32;
            f64::from(((y - 128) as f64).atan2((x - 128) as f64) as f32)
        };
        for (dx, dy, m) in [
            (-4., 0.1249, 32.),
            (3.999999, -3.99999, 32.),
            (4., 0.1249, 16.),
            (-8., 7.999, 16.),
            (8., 0.1249, 8.),
            (-16., 15.999, 8.),
            (16., 0.1249, 1.),
            (-127., 126.999, 1.),
            (-0.03126, 0.03126, 32.),
        ] {
            assert_eq!(
                lookup_angle(dx, dy).unwrap().to_bits(),
                quantized(dx, dy, m).to_bits()
            );
            assert_eq!(
                lookup_angle(dy, dx).unwrap().to_bits(),
                quantized(dy, dx, m).to_bits()
            );
        }
        for (dx, dy) in [(127., 0.1249), (-127.000001, 0.1249), (0.1249, 127.)] {
            assert_eq!(
                lookup_angle(dx, dy).unwrap().to_bits(),
                dy.atan2(dx).to_bits()
            );
        }
        assert_ne!(
            lookup_angle(-0.03126, 0.03126).unwrap(),
            0.03126_f64.atan2(-0.03126)
        );
        let below_four = f64::from_bits(4_f64.to_bits() - 1);
        assert!(matches!(
            lookup_angle(below_four, below_four),
            Err(AntennaError::Arithmetic)
        ));
    }

    #[test]
    fn reentry_uses_unrounded_root_and_preserves_velocity_and_rotation() {
        let mut state = AntennaState::from_appearance(geometry(), Point { x: 0., y: 0. }).unwrap();
        state.data.velocity_x[1] = 0.375;
        state.data.velocity_y[1] = -0.25;
        state.data.bulb_rotation = -1.75;
        let mut rejected = input();
        rejected.bounds = None;
        let (rejected, _) = state.prepare_draw(rejected).unwrap().finish(&[]).unwrap();
        assert_eq!(rejected.data.velocity_x, state.data.velocity_x);
        assert_eq!(rejected.data.velocity_y, state.data.velocity_y);
        assert_eq!(rejected.data.bulb_rotation.to_bits(), (-1.75_f64).to_bits());
        let i = input();
        let root = i.corrected_head.x - 8.;
        let initial_x = (root - 4.) as f32;
        let initial_y = i.corrected_head.y as f32;
        let qx0 = f64::from(root as f32);
        let qy0 = f64::from(initial_y);
        let angle = lookup_angle(f64::from(initial_x) - qx0, f64::from(initial_y) - qy0).unwrap();
        let target_x = qx0 + angle.cos() * 4.;
        let target_y = qy0 + angle.sin() * 4.;
        let vx = (0.375 + (target_x - f64::from(initial_x)) * 0.1) as f32;
        let vy = (-0.25 + (target_y - f64::from(initial_y)) * 0.1) as f32;
        let mut expected_x = (f64::from(initial_x) + f64::from(vx)) as f32;
        let mut expected_y = (f64::from(initial_y) + f64::from(vy)) as f32;
        let dx = f64::from(expected_x) - qx0;
        let dy = f64::from(expected_y) - qy0;
        if (dx * dx + dy * dy).sqrt() > 4. {
            let angle = lookup_angle(dx, dy).unwrap();
            expected_x = (qx0 + angle.cos() * 4.) as f32;
            expected_y = (qy0 + angle.sin() * 4.) as f32;
        }
        let (next, _) = rejected
            .prepare_draw(i)
            .unwrap()
            .finish(&[[0.5, 0.5]; 7])
            .unwrap();
        assert_eq!(next.data.x[0].to_bits(), (root as f32).to_bits());
        assert_eq!(next.data.x[1].to_bits(), expected_x.to_bits());
        assert_eq!(next.data.y[1].to_bits(), expected_y.to_bits());
        assert_eq!(
            next.data.velocity_x[1].to_bits(),
            ((f64::from(vx) * 0.88) as f32).to_bits()
        );
        assert_eq!(
            next.data.velocity_y[1].to_bits(),
            ((f64::from(vy) * 0.88) as f32).to_bits()
        );
    }

    #[test]
    fn equality_distance_keeps_position_and_damped_velocity() {
        let mut g = geometry();
        g.rotate_bulb = false;
        let mut s = AntennaState::from_appearance(g, Point { x: 0., y: 0. }).unwrap();
        s.data.shown = true;
        // An exact horizontal four-unit chain points along table angle zero.
        for j in 0..8 {
            s.data.x[j] = j as f32 * 4.;
        }
        let mut i = input();
        i.corrected_head = Point { x: 8., y: 0. };
        let (next, _) = s.prepare_draw(i).unwrap().finish(&[[0.5, 0.5]; 7]).unwrap();
        assert_eq!(next.data.x, s.data.x);
        assert_eq!(next.data.y, s.data.y);
        assert!(next.data.velocity_x.iter().all(|v| v.to_bits() == 0));
    }

    #[test]
    fn updated_predecessor_is_used_sequentially_and_constraint_keeps_velocity() {
        let mut g = geometry();
        g.rotate_bulb = false;
        let mut s = AntennaState::from_appearance(g, Point { x: 0., y: 0. }).unwrap();
        s.data.shown = true;
        for j in 0..8 {
            s.data.x[j] = j as f32 * 4.;
        }
        s.data.velocity_x[1] = -1.;
        let mut i = input();
        i.corrected_head = Point { x: 8., y: 0. };
        let (next, _) = s.prepare_draw(i).unwrap().finish(&[[0.5, 0.5]; 7]).unwrap();
        assert_eq!(next.data.x[1], 3.);
        assert_eq!(next.data.velocity_x[1].to_bits(), (-0.88_f32).to_bits());
        for j in 2..8 {
            assert_eq!(next.data.x[j], j as f32 * 4. - 1.);
            assert_eq!(
                next.data.velocity_x[j].to_bits(),
                ((f64::from(-0.1_f32) * 0.88) as f32).to_bits()
            );
        }
    }

    #[test]
    fn straightening_uses_root_before_its_binary32_store() {
        let s = AntennaState::from_appearance(geometry(), Point { x: 0., y: 0. }).unwrap();
        let mut i = input();
        i.corrected_head = Point {
            x: 16_777_225.,
            y: 0.,
        };
        i.bounds = Some(AntennaCullBounds {
            min_x: 16_777_100.,
            max_x: 16_777_300.,
            min_y: -100.,
            max_y: 100.,
        });
        let (next, _) = s.prepare_draw(i).unwrap().finish(&[[0.5, 0.5]; 7]).unwrap();
        assert_eq!(next.data.x[0], 16_777_216.);
        assert_eq!(next.data.x[1], 16_777_213.);
        // Rounding the root first would initialize node one to 16,777,212.
        assert_ne!(next.data.x[1], next.data.x[0] - 4.);
    }

    #[test]
    fn bulb_signed_remainder_preserves_negative_rotation_on_reentry() {
        let mut s = AntennaState::from_appearance(geometry(), Point { x: 0., y: 0. }).unwrap();
        s.data.bulb_rotation = -0.75;
        let (next, plan) = s
            .prepare_draw(input())
            .unwrap()
            .finish(&[[0.5, 0.5]; 7])
            .unwrap();
        let last = 7;
        let angle = (f64::from(next.data.y[last]) - f64::from(next.data.y[last - 1]))
            .atan2(f64::from(next.data.x[last]) - f64::from(next.data.x[last - 1]));
        let mut delta = angle - (-0.75);
        if !(0. ..TAU).contains(&delta) {
            delta %= TAU;
        }
        if delta < -PI {
            delta += TAU;
        } else if delta > PI {
            delta -= TAU;
        }
        let expected = (-0.75 + delta * 0.15) % TAU;
        assert_eq!(next.data.bulb_rotation.to_bits(), expected.to_bits());
        assert_eq!(plan.bulb.unwrap().rotation, Some(expected));
        assert!(expected < 0.);
    }
}
