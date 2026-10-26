//! Read-only prey commands at the early-body and late-glow insertion barriers.

use std::{error::Error, fmt};

use crate::{math, state::Point};

use super::{
    BodyAlpha, BodyAsset, BodyAssetStatus, BodyBlend, BodyPaintView, BodyRect, FoodImageDraw,
    MAX_RETAINED_PREYS, PreyEaterPose, PreyInstance, PreyPresentation, PreySnapshot, PreySource,
    SnakeObjectToken,
};

/// Two body and four glow calls per retained prey before culling.
pub const MAX_PREY_PAINT_COMMANDS: usize = 6 * MAX_RETAINED_PREYS;

/// Never regroup these calls by source or alpha.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreyPaintPass {
    /// Early additive body, base then pulse.
    Body,
    /// Late inner lobe, base then pulse.
    InnerGlow,
    /// Late outer lobe, always the explicit nine-argument overload.
    OuterGlow,
}

/// One exact pixel-space drawImage call and Canvas alpha assignment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PreyImageCommand {
    /// Across early then late calls, ignoring intervening snake work.
    pub sequence: usize,
    /// Insertion-vector index at preparation.
    pub prey_index: usize,
    /// Stable appearance identity.
    pub instance: PreyInstance,
    /// Insertion pass and lobe.
    pub pass: PreyPaintPass,
    /// Retained source and independent declared sizes/halves.
    pub source: PreySource,
    /// Exact three- or nine-argument overload intent.
    pub draw: FoodImageDraw,
    /// Requested, effective and accepted alpha, including ignored assignments.
    pub alpha: BodyAlpha,
    /// Always additive; the submitter scopes the entire traversal once.
    pub blend: BodyBlend,
}

/// Independent visibility and complete exact command counts.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct PreyPaintCounts {
    /// Centers admitted by the early, pre-interpolation 50-pixel cull.
    pub visible_bodies: usize,
    /// Post-interpolation expanded inner centers admitted by the 150-pixel cull.
    pub visible_inner_glows: usize,
    /// Independently admitted expanded outer centers.
    pub visible_outer_glows: usize,
    /// Early image calls.
    pub early: usize,
    /// Late image calls.
    pub late: usize,
}
impl PreyPaintCounts {
    /// Calls to charge against the caller's combined frame budget.
    pub fn total(self) -> usize {
        self.early + self.late
    }
}

/// Complete immutable plan; save/restore once around each whole traversal.
#[derive(Clone, Debug, PartialEq)]
pub struct PreyPaintPlan {
    /// Newest-to-oldest body pairs, before any snake drawing.
    pub early: Vec<PreyImageCommand>,
    /// Newest-to-oldest inner pair then outer pair, after late food.
    pub late: Vec<PreyImageCommand>,
    /// Exact independent cull and call counts.
    pub counts: PreyPaintCounts,
    /// Final accepted alpha inside the early scope, before restore.
    pub final_early_alpha: f64,
    /// Final accepted alpha inside the late scope, before restore.
    pub final_late_alpha: f64,
}

/// Already prepared inputs; planning advances no world, clock or camera state.
#[derive(Clone, Copy, Debug)]
pub struct PreyPaintInput<'a> {
    /// Insertion-order retained world.
    pub preys: &'a [PreyPresentation],
    /// Frozen captured raw poses, keyed by object token rather than wire ID.
    pub eaters: &'a [(SnakeObjectToken, PreyEaterPose)],
    /// Final camera, zoom and backing-canvas half dimensions.
    pub view: BodyPaintView,
    /// Coherent current snapshots in the prey source namespace.
    pub assets: &'a [BodyAsset],
    /// Target identity in that same namespace, when known.
    pub target_handle: Option<u64>,
    /// Canvas root alpha at entry to the early scope.
    pub early_entry_alpha: f64,
    /// Canvas root alpha at entry to the late scope.
    pub late_entry_alpha: f64,
    /// Caller-owned remaining combined frame budget.
    pub command_limit: usize,
}

/// Failure occurs before a partial plan is returned or any Canvas work begins.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PreyPaintError {
    /// Invalid camera, zoom or backing dimensions.
    InvalidView,
    /// Entry alpha must be finite in `0..=1`.
    InvalidVisual,
    /// More than 4096 retained objects.
    PreyLimit,
    /// Missing, unready or incoherent source snapshot.
    InvalidSource,
    /// A source aliases the target.
    TargetAlias,
    /// Parent failed to retain a captured eater.
    MissingEater(SnakeObjectToken),
    /// Invalid or inconsistent captured pose snapshots.
    InvalidEater,
    /// Exact call count exceeds the remaining budget.
    CommandLimit,
    /// Derived geometry or requested alpha became nonfinite.
    Arithmetic,
    /// Fallible command-vector reservation failed.
    Allocation,
}
impl fmt::Display for PreyPaintError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "prey paint planning failed: {self:?}")
    }
}
impl Error for PreyPaintError {}

fn finite(values: &[f64]) -> bool {
    values.iter().all(|v| v.is_finite())
}

fn pose_bits(p: PreyEaterPose) -> [u64; 6] {
    [
        p.head.x,
        p.head.y,
        p.head_offset.x,
        p.head_offset.y,
        p.heading,
        p.angle_offset,
    ]
    .map(f64::to_bits)
}

fn validate(input: PreyPaintInput<'_>) -> Result<(), PreyPaintError> {
    let v = input.view;
    if !finite(&[v.camera.x, v.camera.y, v.zoom, v.half_width, v.half_height])
        || v.zoom <= 0.
        || v.half_width <= 0.
        || v.half_height <= 0.
        || v.half_width > 2048.
        || v.half_height > 2048.
    {
        return Err(PreyPaintError::InvalidView);
    }
    if !(0. ..=1.).contains(&input.early_entry_alpha)
        || !(0. ..=1.).contains(&input.late_entry_alpha)
    {
        return Err(PreyPaintError::InvalidVisual);
    }
    if input.preys.len() > MAX_RETAINED_PREYS {
        return Err(PreyPaintError::PreyLimit);
    }
    for (i, (token, pose)) in input.eaters.iter().enumerate() {
        if !finite(&[
            pose.head.x,
            pose.head.y,
            pose.head_offset.x,
            pose.head_offset.y,
            pose.heading,
            pose.angle_offset,
        ]) || input.eaters[..i]
            .iter()
            .any(|(t, p)| t == token && pose_bits(*p) != pose_bits(*pose))
        {
            return Err(PreyPaintError::InvalidEater);
        }
    }
    for (i, a) in input.assets.iter().enumerate() {
        if a.status != BodyAssetStatus::Ready
            || a.width == 0
            || a.height == 0
            || a.width > 65535
            || a.height > 65535
            || input.assets[..i]
                .iter()
                .any(|b| b.handle == a.handle && b != a)
        {
            return Err(PreyPaintError::InvalidSource);
        }
    }
    for prey in input.preys {
        let p = prey.state();
        for source in [p.sources.body, p.sources.glow] {
            source
                .validate()
                .map_err(|_| PreyPaintError::InvalidSource)?;
            let asset = source.asset();
            if input.target_handle == Some(asset.handle) {
                return Err(PreyPaintError::TargetAlias);
            }
            if !input.assets.contains(&asset) {
                return Err(PreyPaintError::InvalidSource);
            }
        }
        if let Some(token) = p.eater
            && !input.eaters.iter().any(|(t, _)| *t == token)
        {
            return Err(PreyPaintError::MissingEater(token));
        }
    }
    Ok(())
}

fn project(point: Point, view: BodyPaintView) -> Result<Point, PreyPaintError> {
    let p = Point {
        x: view.half_width + view.zoom * (point.x - view.camera.x),
        y: view.half_height + view.zoom * (point.y - view.camera.y),
    };
    if !finite(&[p.x, p.y]) {
        return Err(PreyPaintError::Arithmetic);
    }
    Ok(p)
}
fn visible(p: Point, v: BodyPaintView, margin: f64) -> bool {
    p.x >= -margin
        && p.x <= v.half_width * 2. + margin
        && p.y >= -margin
        && p.y <= v.half_height * 2. + margin
}
fn interpolated(
    p: &PreySnapshot,
    raw: Point,
    eaters: &[(SnakeObjectToken, PreyEaterPose)],
) -> Result<Point, PreyPaintError> {
    let mut result = raw;
    if p.eaten {
        let token = p.eater.ok_or(PreyPaintError::InvalidEater)?;
        let pose = eaters
            .iter()
            .find(|(t, _)| *t == token)
            .ok_or(PreyPaintError::MissingEater(token))?
            .1;
        let k = math::pow(p.consumption_progress, 2.);
        let heading = pose.heading + pose.angle_offset;
        if !finite(&[k, heading]) {
            return Err(PreyPaintError::Arithmetic);
        }
        let mouth_x =
            pose.head.x + pose.head_offset.x + math::cos(heading) * (43. - k * 24.) * (1. - k);
        let mouth_y =
            pose.head.y + pose.head_offset.y + math::sin(heading) * (43. - k * 24.) * (1. - k);
        result.x += (mouth_x - result.x) * k;
        result.y += (mouth_y - result.y) * k;
    }
    if !finite(&[result.x, result.y]) {
        return Err(PreyPaintError::Arithmetic);
    }
    Ok(result)
}
fn draw(
    source: PreySource,
    center: Point,
    scale: f64,
    force_scaled: bool,
) -> Result<FoodImageDraw, PreyPaintError> {
    if scale == 1. && !force_scaled {
        let x = center.x - source.half_width();
        let y = center.y - source.half_height();
        if !finite(&[x, y]) {
            return Err(PreyPaintError::Arithmetic);
        }
        Ok(FoodImageDraw::Whole { x, y })
    } else {
        let destination = BodyRect {
            x: center.x - source.half_width() * scale,
            y: center.y - source.half_height() * scale,
            width: source.width() * scale,
            height: source.height() * scale,
        };
        if !finite(&[
            destination.x,
            destination.y,
            destination.width,
            destination.height,
        ]) {
            return Err(PreyPaintError::Arithmetic);
        }
        Ok(FoodImageDraw::Scaled {
            source: BodyRect {
                x: 0.,
                y: 0.,
                width: source.width(),
                height: source.height(),
            },
            destination,
        })
    }
}

struct Recorder<F> {
    emit: F,
    counts: PreyPaintCounts,
    limit: usize,
    alpha: f64,
}
impl<F: FnMut(PreyImageCommand)> Recorder<F> {
    fn pair(
        &mut self,
        p: &PreySnapshot,
        prey_index: usize,
        pass: PreyPaintPass,
        center: Point,
        scale: f64,
        base: f64,
    ) -> Result<(), PreyPaintError> {
        let source = if pass == PreyPaintPass::Body {
            p.sources.body
        } else {
            p.sources.glow
        };
        let draw = draw(source, center, scale, pass == PreyPaintPass::OuterGlow)?;
        let pulse = 0.5 + 0.5 * math::cos(p.glow_phase / 13.);
        let alphas = [base * p.fade, base * pulse * p.fade];
        if !finite(&alphas) {
            return Err(PreyPaintError::Arithmetic);
        }
        if self
            .counts
            .total()
            .checked_add(2)
            .is_none_or(|n| n > self.limit || n > MAX_PREY_PAINT_COMMANDS)
        {
            return Err(PreyPaintError::CommandLimit);
        }
        match pass {
            PreyPaintPass::Body => self.counts.visible_bodies += 1,
            PreyPaintPass::InnerGlow => self.counts.visible_inner_glows += 1,
            PreyPaintPass::OuterGlow => self.counts.visible_outer_glows += 1,
        }
        for requested in alphas {
            let accepted = (0. ..=1.).contains(&requested);
            if accepted {
                self.alpha = requested;
            }
            let sequence = self.counts.total();
            (self.emit)(PreyImageCommand {
                sequence,
                prey_index,
                instance: p.instance,
                pass,
                source,
                draw,
                alpha: BodyAlpha {
                    requested,
                    effective: self.alpha,
                    accepted,
                },
                blend: BodyBlend::Lighter,
            });
            if pass == PreyPaintPass::Body {
                self.counts.early += 1;
            } else {
                self.counts.late += 1;
            }
        }
        Ok(())
    }
}

fn traverse<F: FnMut(PreyImageCommand)>(
    input: PreyPaintInput<'_>,
    emit: F,
) -> Result<(PreyPaintCounts, f64, f64), PreyPaintError> {
    let mut r = Recorder {
        emit,
        counts: PreyPaintCounts::default(),
        limit: input.command_limit,
        alpha: input.early_entry_alpha,
    };
    for (index, prey) in input.preys.iter().enumerate().rev() {
        let p = prey.state();
        let offset = p.corrections.offset();
        let raw = Point {
            x: p.position.x + offset[0],
            y: p.position.y + offset[1],
        };
        if visible(project(raw, input.view)?, input.view, 50.) {
            let center = project(interpolated(p, raw, input.eaters)?, input.view)?;
            r.pair(p, index, PreyPaintPass::Body, center, p.scale, 0.75)?;
        }
    }
    let early_alpha = r.alpha;
    r.alpha = input.late_entry_alpha;
    for (index, prey) in input.preys.iter().enumerate().rev() {
        let p = prey.state();
        let offset = p.corrections.offset();
        let point = interpolated(
            p,
            Point {
                x: p.position.x + offset[0],
                y: p.position.y + offset[1],
            },
            input.eaters,
        )?;
        let tx = point.x - input.view.camera.x;
        let ty = point.y - input.view.camera.y;
        let pd2 = tx * tx + ty * ty;
        if !finite(&[tx, ty, pd2]) {
            return Err(PreyPaintError::Arithmetic);
        }
        for (pass, expansion, strength, denominator) in [
            (PreyPaintPass::InnerGlow, 0.08, 0.4, 176000.),
            (PreyPaintPass::OuterGlow, 0.32, 0.35, 46500.),
        ] {
            let fs = 1. + expansion * p.scale;
            let mut pal = strength * (1. - pd2 / (denominator + pd2));
            if p.scale != 1. {
                pal *= math::pow(p.scale, 0.25);
            }
            let x = tx * fs;
            let y = ty * fs;
            let center = Point {
                x: x * input.view.zoom + input.view.half_width,
                y: y * input.view.zoom + input.view.half_height,
            };
            if !finite(&[fs, pal, x, y, center.x, center.y]) {
                return Err(PreyPaintError::Arithmetic);
            }
            if visible(center, input.view, 150.) {
                let scale = if pass == PreyPaintPass::OuterGlow {
                    p.scale * 2.
                } else {
                    p.scale
                };
                r.pair(p, index, pass, center, scale, pal)?;
            }
        }
    }
    Ok((r.counts, early_alpha, r.alpha))
}

/// Validate and count every call before allocating either command vector.
/// Direct prey visibility and alpha are independent of rendering quality.
pub fn plan_prey(input: PreyPaintInput<'_>) -> Result<PreyPaintPlan, PreyPaintError> {
    validate(input)?;
    let (counts, final_early_alpha, final_late_alpha) = traverse(input, |_| {})?;
    let mut early = Vec::new();
    let mut late = Vec::new();
    early
        .try_reserve_exact(counts.early)
        .map_err(|_| PreyPaintError::Allocation)?;
    late.try_reserve_exact(counts.late)
        .map_err(|_| PreyPaintError::Allocation)?;
    traverse(input, |c| {
        if c.pass == PreyPaintPass::Body {
            early.push(c);
        } else {
            late.push(c);
        }
    })?;
    Ok(PreyPaintPlan {
        early,
        late,
        counts,
        final_early_alpha,
        final_late_alpha,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outer_unit_destination_scale_still_uses_declared_crop_and_halves() {
        let source = PreySource::new(
            BodyAsset {
                handle: 1,
                revision: 1,
                width: 37,
                height: 41,
                status: BodyAssetStatus::Ready,
            },
            9.5,
            11.25,
            2.75,
            -0.,
        )
        .unwrap();
        // Controlled numeric boundary: scale .5 gives outer destination scale one.
        let result = draw(source, Point { x: -0., y: -0. }, 0.5 * 2., true).unwrap();
        assert_eq!(
            result,
            FoodImageDraw::Scaled {
                source: BodyRect {
                    x: 0.,
                    y: 0.,
                    width: 9.5,
                    height: 11.25
                },
                destination: BodyRect {
                    x: -2.75,
                    y: 0.,
                    width: 9.5,
                    height: 11.25
                },
            }
        );
        let FoodImageDraw::Scaled { destination, .. } = result else {
            unreachable!()
        };
        assert_eq!(destination.y.to_bits(), 0_f64.to_bits());
        assert!(matches!(
            draw(source, Point { x: 0., y: 0. }, 1., false).unwrap(),
            FoodImageDraw::Whole { .. }
        ));
    }
}
