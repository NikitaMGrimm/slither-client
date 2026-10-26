//! Read-only pixel-space food commands with early and late insertion barriers.

use std::{error::Error, fmt};

use crate::{math, state::Point};

use super::{
    BodyAlpha, BodyAsset, BodyBlend, BodyPaintQuality, BodyPaintView, BodyRect, FoodInstance,
    FoodPresentation, FoodSnapshot, FoodSource, MAX_RETAINED_FOODS, food::all_finite,
};

/// Seven calls per visible food in the full quality path.
pub const MAX_FOOD_PAINT_COMMANDS: usize = 7 * MAX_RETAINED_FOODS;

/// Inclusive absolute-world cull bounds retained by the parent across resets.
/// None on FoodPaintInput means no food calls, including before the first own draw.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FoodCullBounds {
    left: f64,
    right: f64,
    top: f64,
    bottom: f64,
}

impl FoodCullBounds {
    /// Validate explicitly retained left/right/top/bottom bounds.
    pub fn new(left: f64, right: f64, top: f64, bottom: f64) -> Result<Self, FoodPaintError> {
        if !all_finite(&[left, right, top, bottom]) || left > right || top > bottom {
            return Err(FoodPaintError::InvalidView);
        }
        Ok(Self {
            left,
            right,
            top,
            bottom,
        })
    }

    /// Compute fixed 24-world-unit margins from the already prepared draw view.
    /// Call only at the parent's own-object camera point, never to advance a draw.
    pub fn from_view(view: BodyPaintView) -> Result<Self, FoodPaintError> {
        validate_view(view)?;
        let x = view.half_width / view.zoom + 24.;
        let y = view.half_height / view.zoom + 24.;
        Self::new(
            view.camera.x - x,
            view.camera.x + x,
            view.camera.y - y,
            view.camera.y + y,
        )
    }

    /// Copy left, right, top, bottom, without recomputing the retained view.
    pub fn limits(self) -> [f64; 4] {
        [self.left, self.right, self.top, self.bottom]
    }

    fn contains(self, point: Point) -> bool {
        point.x >= self.left
            && point.x <= self.right
            && point.y >= self.top
            && point.y <= self.bottom
    }
}

/// Distinct scoped food passes; never regroup commands by source or opacity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FoodPaintPass {
    /// All outlines precede every body call.
    Outline,
    /// Additive body calls after the outline barrier.
    Body,
    /// Two inner calls immediately before this food's two outer calls.
    InnerGlow,
    /// Completes one food before moving to the preceding dense-vector entry.
    OuterGlow,
}

/// Exact Canvas overload intent, in pixels with the identity transform.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FoodImageDraw {
    /// Three-argument drawImage(source, x, y); natural source extent is retained.
    Whole {
        /// Destination left in backing-canvas pixels.
        x: f64,
        /// Destination top in backing-canvas pixels.
        y: f64,
    },
    /// Nine-argument drawImage with explicit declared source and destination sizes.
    Scaled {
        /// Full declared numeric source rectangle, starting at zero.
        source: BodyRect,
        /// Pixel destination; zero size is preserved as a call.
        destination: BodyRect,
    },
}

/// One immutable planned image call; no arbitrary caller commands enter the model.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FoodImageCommand {
    /// Sequence across early then late calls, ignoring the intervening snake work.
    pub sequence: usize,
    /// Current dense index, unrelated to instance identity or packed key.
    pub food_index: usize,
    /// Stable food identity for diagnostics.
    pub instance: FoodInstance,
    /// Exact insertion pass.
    pub pass: FoodPaintPass,
    /// Retained source identity, revision and numeric metadata.
    pub source: FoodSource,
    /// Whole-source or explicit scaled Canvas overload.
    pub draw: FoodImageDraw,
    /// Canvas requested/effective assignment, using retention rather than clamping.
    pub alpha: BodyAlpha,
    /// Source-over for outlines, lighter for every other food call.
    pub blend: BodyBlend,
}

/// Exact command and visibility counts, available only on complete validation.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct FoodPaintCounts {
    /// Retained food centers inside the inclusive cull rectangle.
    pub visible_foods: usize,
    /// Outline and body calls before all snake work.
    pub early: usize,
    /// Inner and outer glow calls after all snake eyes.
    pub late: usize,
}

impl FoodPaintCounts {
    /// Total image calls charged against the caller's combined frame budget.
    pub fn total(self) -> usize {
        self.early + self.late
    }
}

/// Complete food plan. Save/restore each pass's alpha/composition scope and use
/// identity pixel coordinates. Insert all snake work between early and late.
#[derive(Clone, Debug, PartialEq)]
pub struct FoodPaintPlan {
    /// Reverse-order outlines, then reverse-order bodies.
    pub early: Vec<FoodImageCommand>,
    /// Early index immediately after all outlines; begin the lighter body scope.
    pub outline_barrier: usize,
    /// Reverse-order foods, with each food's inner/inner/outer/outer calls together.
    pub late: Vec<FoodImageCommand>,
    /// Exact counts; the planner never silently drops over-budget foods.
    pub counts: FoodPaintCounts,
}

/// Coherent frozen draw inputs. Planning changes no clocks, assets or food state.
#[derive(Clone, Copy, Debug)]
pub struct FoodPaintInput<'a> {
    /// Retained dense order, borrowed directly from FoodWorld::foods().
    pub foods: &'a [FoodPresentation],
    /// Final already prepared camera, zoom and canvas center.
    pub view: BodyPaintView,
    /// Borrowed applied desktop quality; no quality evolution occurs here.
    pub quality: BodyPaintQuality,
    /// Caller-retained bounds; never initialized means no image calls.
    pub bounds: Option<FoodCullBounds>,
    /// Current coherent source snapshots, revalidated against frozen identities.
    /// The parent must retain actual source objects and check native readiness
    /// again after callbacks and before resetting/submitting to Canvas.
    pub assets: &'a [BodyAsset],
    /// Target identity when known; any food source alias is rejected.
    pub target_handle: Option<u64>,
    /// Valid Canvas globalAlpha on entry to each scoped food pass.
    pub entry_alpha: f64,
    /// Remaining image budget for the combined frame, supplied by its owner.
    pub command_limit: usize,
}

/// Complete input, source, arithmetic or allocation failure; no partial plan escapes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FoodPaintError {
    /// Invalid view or retained cull bounds.
    InvalidView,
    /// Invalid quality blend or scoped entry alpha.
    InvalidVisual,
    /// Retained food count exceeds the native domain.
    FoodLimit,
    /// A frozen source is missing, changed or unready in the current catalog.
    InvalidSource,
    /// A retained source aliases the destination canvas.
    TargetAlias,
    /// The complete food count exceeds the remaining combined or hard budget.
    CommandLimit,
    /// A command's distance, center or rectangle became nonfinite.
    Arithmetic,
    /// Reserving the complete command vectors failed.
    Allocation,
}

impl fmt::Display for FoodPaintError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "food paint planning failed: {self:?}")
    }
}
impl Error for FoodPaintError {}

fn validate_view(view: BodyPaintView) -> Result<(), FoodPaintError> {
    if !all_finite(&[
        view.camera.x,
        view.camera.y,
        view.zoom,
        view.half_width,
        view.half_height,
    ]) || view.zoom <= 0.
        || view.half_width <= 0.
        || view.half_height <= 0.
    {
        return Err(FoodPaintError::InvalidView);
    }
    Ok(())
}

fn validate(input: FoodPaintInput<'_>) -> Result<(), FoodPaintError> {
    validate_view(input.view)?;
    if !(0. ..=1.).contains(&input.quality.blend) || !(0. ..=1.).contains(&input.entry_alpha) {
        return Err(FoodPaintError::InvalidVisual);
    }
    if input.foods.len() > MAX_RETAINED_FOODS {
        return Err(FoodPaintError::FoodLimit);
    }
    for food in input.foods {
        let sources = food.snapshot().sources;
        for source in [sources.body, sources.outline, sources.inner, sources.outer] {
            source
                .validate()
                .map_err(|_| FoodPaintError::InvalidSource)?;
            let frozen = source.asset();
            if input.target_handle == Some(frozen.handle) {
                return Err(FoodPaintError::TargetAlias);
            }
            let mut found = false;
            for actual in input.assets.iter().filter(|a| a.handle == frozen.handle) {
                if *actual != frozen {
                    return Err(FoodPaintError::InvalidSource);
                }
                found = true;
            }
            if !found {
                return Err(FoodPaintError::InvalidSource);
            }
        }
    }
    Ok(())
}

fn draw(source: FoodSource, center: Point, scale: f64) -> Result<FoodImageDraw, FoodPaintError> {
    let draw = if scale == 1. {
        FoodImageDraw::Whole {
            x: center.x - source.half_width(),
            y: center.y - source.half_height(),
        }
    } else {
        FoodImageDraw::Scaled {
            source: BodyRect {
                x: 0.,
                y: 0.,
                width: source.width(),
                height: source.height(),
            },
            destination: BodyRect {
                x: center.x - source.half_width() * scale,
                y: center.y - source.half_height() * scale,
                width: source.width() * scale,
                height: source.height() * scale,
            },
        }
    };
    let finite = match draw {
        FoodImageDraw::Whole { x, y } => all_finite(&[x, y]),
        FoodImageDraw::Scaled { destination: d, .. } => all_finite(&[d.x, d.y, d.width, d.height]),
    };
    if !finite {
        return Err(FoodPaintError::Arithmetic);
    }
    Ok(draw)
}

struct Recorder<F> {
    emit: F,
    counts: FoodPaintCounts,
    limit: usize,
    previous_alpha: f64,
}

fn alpha_assignment(requested: f64, previous: f64) -> BodyAlpha {
    let accepted = (0. ..=1.).contains(&requested);
    BodyAlpha {
        requested,
        effective: if accepted { requested } else { previous },
        accepted,
    }
}

impl<F: FnMut(FoodImageCommand)> Recorder<F> {
    fn image(
        &mut self,
        food: FoodSnapshot,
        index: usize,
        pass: FoodPaintPass,
        source: FoodSource,
        center: Point,
        alpha: f64,
    ) -> Result<(), FoodPaintError> {
        // Keep Canvas's assignment rule explicit even though valid food state
        // normally requests bounded alpha. Do not clamp or elide zero calls.
        let alpha = alpha_assignment(alpha, self.previous_alpha);
        let draw = draw(source, center, food.scale)?;
        let sequence = self.counts.total();
        if sequence >= self.limit || sequence >= MAX_FOOD_PAINT_COMMANDS {
            return Err(FoodPaintError::CommandLimit);
        }
        let early = matches!(pass, FoodPaintPass::Outline | FoodPaintPass::Body);
        let command = FoodImageCommand {
            sequence,
            food_index: index,
            instance: food.instance,
            pass,
            source,
            draw,
            alpha,
            blend: if pass == FoodPaintPass::Outline {
                BodyBlend::SourceOver
            } else {
                BodyBlend::Lighter
            },
        };
        if early {
            self.counts.early += 1;
        } else {
            self.counts.late += 1;
        }
        self.previous_alpha = alpha.effective;
        (self.emit)(command);
        Ok(())
    }
}

fn generate<F: FnMut(FoodImageCommand)>(
    input: FoodPaintInput<'_>,
    emit: F,
) -> Result<FoodPaintCounts, FoodPaintError> {
    let mut recorder = Recorder {
        emit,
        counts: FoodPaintCounts::default(),
        limit: input.command_limit,
        previous_alpha: input.entry_alpha,
    };
    let Some(bounds) = input.bounds else {
        return Ok(recorder.counts);
    };
    let q = input.quality;
    let v = input.view;
    let detailed = q.high_quality || q.blend > 0.;
    let visible = || {
        input
            .foods
            .iter()
            .enumerate()
            .rev()
            .map(|(i, food)| (i, food.snapshot()))
            .filter(|(_, f)| bounds.contains(f.render_position))
    };
    for (index, food) in visible() {
        let center = Point {
            x: v.half_width + v.zoom * (food.render_position.x - v.camera.x),
            y: v.half_height + v.zoom * (food.render_position.y - v.camera.y),
        };
        recorder.image(
            food,
            index,
            FoodPaintPass::Outline,
            food.sources.outline,
            center,
            0.8 * food.fade,
        )?;
        recorder.counts.visible_foods += 1;
    }
    recorder.previous_alpha = input.entry_alpha;
    for (index, food) in visible() {
        let center = Point {
            x: v.half_width + v.zoom * (food.render_position.x - v.camera.x),
            y: v.half_height + v.zoom * (food.render_position.y - v.camera.y),
        };
        recorder.image(
            food,
            index,
            FoodPaintPass::Body,
            food.sources.body,
            center,
            food.fade,
        )?;
        if detailed {
            let alpha = (if q.blend == 1. { 1. } else { q.blend })
                * (0.5 + 0.5 * math::cos(food.animation_phase / 13.))
                * food.fade;
            recorder.image(
                food,
                index,
                FoodPaintPass::Body,
                food.sources.body,
                center,
                alpha,
            )?;
        }
    }
    recorder.previous_alpha = input.entry_alpha;
    if detailed {
        for (index, food) in visible() {
            let dx = food.render_position.x - v.camera.x;
            let dy = food.render_position.y - v.camera.y;
            let distance = dx * dx + dy * dy;
            if !distance.is_finite() {
                return Err(FoodPaintError::Arithmetic);
            }
            for (pass, source, shift, mut alpha) in [
                (
                    FoodPaintPass::InnerGlow,
                    food.sources.inner,
                    0.06,
                    0.005 + 0.09 * (1. - distance / (86000. + distance)),
                ),
                (
                    FoodPaintPass::OuterGlow,
                    food.sources.outer,
                    0.32,
                    0.085 * (1. - distance / (16500. + distance)),
                ),
            ] {
                let t = 1. + shift * food.scale;
                let center = Point {
                    x: dx * t * v.zoom + v.half_width,
                    y: dy * t * v.zoom + v.half_height,
                };
                if food.scale != 1. {
                    alpha *= math::pow(food.scale, 0.25);
                }
                if q.blend != 1. {
                    alpha *= q.blend;
                }
                recorder.image(food, index, pass, source, center, alpha * food.fade)?;
                recorder.image(
                    food,
                    index,
                    pass,
                    source,
                    center,
                    alpha * (0.5 + 0.5 * math::cos(food.animation_phase / 13.)) * food.fade,
                )?;
            }
        }
    }
    Ok(recorder.counts)
}

/// Validate every retained source and preflight all numeric commands and the
/// complete remaining budget before allocating output. Returned early/late
/// barriers are mandatory. Later Canvas submission and model commit are owned
/// by the parent; failed submission does not promise pixel rollback.
pub fn plan_food(input: FoodPaintInput<'_>) -> Result<FoodPaintPlan, FoodPaintError> {
    validate(input)?;
    let counts = generate(input, |_| {})?;
    let mut early = Vec::new();
    let mut late = Vec::new();
    early
        .try_reserve_exact(counts.early)
        .map_err(|_| FoodPaintError::Allocation)?;
    late.try_reserve_exact(counts.late)
        .map_err(|_| FoodPaintError::Allocation)?;
    generate(input, |command| {
        if matches!(command.pass, FoodPaintPass::Outline | FoodPaintPass::Body) {
            early.push(command);
        } else {
            late.push(command);
        }
    })?;
    Ok(FoodPaintPlan {
        early,
        outline_barrier: counts.visible_foods,
        late,
        counts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_ignores_invalid_alpha_assignments_and_accepts_signed_zero() {
        for requested in [-0.1, 1.1, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let result = alpha_assignment(requested, 0.375);
            assert!(!result.accepted);
            assert_eq!(result.requested.to_bits(), requested.to_bits());
            assert_eq!(result.effective, 0.375);
        }
        for requested in [-0., 0., 0.5, 1.] {
            let result = alpha_assignment(requested, 0.375);
            assert!(result.accepted);
            assert_eq!(result.effective.to_bits(), requested.to_bits());
        }
    }
}
