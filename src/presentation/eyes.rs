//! Standard desktop paired eyes, independent of body sampling and painting.

use std::f64::consts::{FRAC_PI_2, TAU};

use super::{FrameStep, PresentationError, Turn, finite, signed_angle};
use crate::{math, state::Point};

const EASING: [f32; 250] = {
    let mut table = [0.; 250];
    let mut value = 0.;
    let mut index = 0;
    while index < table.len() {
        table[index] = value as f32;
        value += (1. - value) * 0.12;
        index += 1;
    }
    table
};

/// Retained face and gaze state. Updates also run while offscreen or dying.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StandardEyeState {
    heading: f64,
    target_heading: f64,
    turn: Turn,
    gaze_heading: f64,
    pupil: Point,
}

impl StandardEyeState {
    /// Use the effective appearance heading and independently decoded wanted gaze.
    /// Neither heading is normalized at construction.
    pub fn new(heading: f64, gaze_heading: f64) -> Result<Self, PresentationError> {
        finite(&[heading, gaze_heading])?;
        Ok(Self {
            heading,
            target_heading: heading,
            turn: Turn::None,
            gaze_heading,
            pupil: Point::default(),
        })
    }

    /// Current face heading, without advancing or committing a draw target.
    pub fn heading(&self) -> f64 {
        self.heading
    }

    /// Target retained from the preceding visible draw or visibility entry.
    pub fn target_heading(&self) -> f64 {
        self.target_heading
    }

    /// Retained direction; equality alone does not clear it.
    pub fn turn(&self) -> Turn {
        self.turn
    }

    /// Independent world-axis gaze heading.
    pub fn gaze_heading(&self) -> f64 {
        self.gaze_heading
    }

    /// World-axis pupil displacement before entity scale and zoom.
    pub fn pupil(&self) -> Point {
        self.pupil
    }

    /// Stored Float32 coefficient, generated with a double-precision accumulator.
    /// Indices 0 through 249 are supported; normal frame steps use 0 through 5.
    pub fn easing_coefficient(whole_steps: u32) -> Result<f32, PresentationError> {
        EASING
            .get(whole_steps as usize)
            .copied()
            .ok_or(PresentationError)
    }

    /// Replace gaze from caller-owned pointer input or a remote wanted heading.
    pub fn set_gaze(&mut self, heading: f64) -> Result<(), PresentationError> {
        finite(&[heading])?;
        self.gaze_heading = heading;
        Ok(())
    }

    /// On entry to visibility, reset face and target to the raw head heading.
    /// Pupil displacement, gaze and retained direction survive this transition.
    pub fn visible_entry(&mut self, raw_heading: f64) -> Result<(), PresentationError> {
        finite(&[raw_heading])?;
        self.heading = raw_heading;
        self.target_heading = raw_heading;
        Ok(())
    }

    /// Capture this draw's face heading, then retain its target for later updates.
    /// Call exactly once per real visible draw, after visibility entry. Diagnostics
    /// must only use the getters. The caller supplies raw heading for a short curve.
    pub fn commit_draw_target(&mut self, target: f64) -> Result<f64, PresentationError> {
        finite(&[target])?;
        let captured = self.heading;
        self.target_heading = target;
        Ok(captured)
    }

    /// Handle the actual death event without resetting the face, gaze or pupils.
    pub fn mark_dead(&mut self) {
        self.turn = Turn::None;
    }

    /// Advance face using whole steps, then pupils by fractional delta / 6 per axis.
    /// Dead input skips direction selection, but retains any existing direction.
    /// Call `mark_dead` on death to freeze the face while pupils keep approaching.
    /// Only delta and whole_steps are consumed from the supplied frame step.
    pub fn advance(
        &mut self,
        step: FrameStep,
        alive: bool,
        pupil_travel: f64,
    ) -> Result<(), PresentationError> {
        finite(&[step.delta, pupil_travel])?;
        if !(0. ..=5.).contains(&step.delta) || pupil_travel < 0. {
            return Err(PresentationError);
        }
        let coefficient = f64::from(Self::easing_coefficient(step.whole_steps)?);
        let mut next = *self;
        if (alive && next.heading != next.target_heading) || next.turn != Turn::None {
            let difference = next.target_heading - next.heading;
            finite(&[difference])?;
            let difference = signed_angle(difference);
            if alive && next.heading != next.target_heading {
                if difference < 0. {
                    next.turn = Turn::Decreasing;
                } else if difference > 0. {
                    next.turn = Turn::Increasing;
                }
            }
            if next.turn != Turn::None {
                next.heading += difference * coefficient;
                finite(&[next.heading])?;
                if next.heading < 0. || next.heading >= TAU {
                    next.heading %= TAU;
                }
                if next.heading < 0. {
                    next.heading += TAU;
                }
                let remaining = next.target_heading - next.heading;
                finite(&[remaining])?;
                let remaining = signed_angle(remaining);
                if (next.turn == Turn::Decreasing && remaining > 0.)
                    || (next.turn == Turn::Increasing && remaining < 0.)
                {
                    next.heading = next.target_heading;
                    next.turn = Turn::None;
                }
            }
        }
        let target = Point {
            x: math::cos(next.gaze_heading) * pupil_travel,
            y: math::sin(next.gaze_heading) * pupil_travel,
        };
        next.pupil.x = approach(next.pupil.x, target.x, step.delta / 6.);
        next.pupil.y = approach(next.pupil.y, target.y, step.delta / 6.);
        finite(&[target.x, target.y, next.pupil.x, next.pupil.y])?;
        *self = next;
        Ok(())
    }
}

fn approach(current: f64, target: f64, distance: f64) -> f64 {
    if current < target {
        (current + distance).min(target)
    } else if current > target {
        (current - distance).max(target)
    } else {
        current
    }
}

/// Caller-supplied standard paired-eye parameters, without skin IDs or recipes.
/// Single eyes, suppressed eyes and special face overlays require another module.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StandardEyeGeometry {
    /// Unscaled eye radius, nonnegative.
    pub eye_radius: f64,
    /// Unscaled pupil radius, nonnegative.
    pub pupil_radius: f64,
    /// World-axis pupil travel radius consumed by `StandardEyeState::advance`.
    pub pupil_travel: f64,
    /// Unscaled distance along the face heading, nonnegative.
    pub forward: f64,
    /// Unscaled lateral distance from the head, nonnegative.
    pub separation: f64,
    /// Eye fill RGB; an optional outline is always black.
    pub eye_color: [u8; 3],
    /// Pupil fill RGB.
    pub pupil_color: [u8; 3],
    /// Eye fill and outline opacity before death fading, in 0 through 1.
    pub eye_alpha: f64,
    /// Pupil opacity before death fading, in 0 through 1.
    pub pupil_alpha: f64,
    /// Nonnegative outline width, multiplied by zoom alone; zero disables it.
    pub outline_width: f64,
}

impl Default for StandardEyeGeometry {
    fn default() -> Self {
        Self {
            eye_radius: 6.,
            pupil_radius: 3.5,
            pupil_travel: 2.3,
            forward: 6.,
            separation: 6.,
            eye_color: [255; 3],
            pupil_color: [0; 3],
            eye_alpha: 0.75,
            pupil_alpha: 1.,
            outline_width: 0.,
        }
    }
}

/// View and life inputs for numeric layout. Positions stay double precision.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EyeLayoutInput {
    /// Raw absolute predicted head plus its displayed positional correction.
    pub corrected_head: Point,
    /// Absolute displayed camera position.
    pub camera: Point,
    /// Half the viewport width and height in screen units, nonnegative.
    pub viewport_half: Point,
    /// Positive entity scale.
    pub scale: f64,
    /// Positive world-to-screen zoom.
    pub zoom: f64,
    /// Death progress in 0 (alive) through strictly less than 1 (not yet removed).
    pub death_progress: f64,
}

/// One eye followed immediately by its pupil in painter order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EyePair {
    /// Screen-space eye center.
    pub eye: Point,
    /// Screen-space pupil center.
    pub pupil: Point,
}

/// Numeric paint values. Paint each complete pair before advancing to the next.
/// Outline (black, at eye alpha) precedes the eye fill; pupils have no outline.
/// There is no spawn, speed, boost, quality or team-pass multiplier.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StandardEyeLayout {
    /// Ordered sides: face heading minus pi/2, then face heading plus pi/2.
    pub pairs: [EyePair; 2],
    /// Shared screen-space eye radius.
    pub eye_radius: f64,
    /// Shared screen-space pupil radius.
    pub pupil_radius: f64,
    /// Screen-space outline width; zero disables the outline.
    pub outline_width: f64,
    /// Eye and outline opacity after square-root death fading.
    pub eye_alpha: f64,
    /// Pupil opacity after square-root death fading.
    pub pupil_alpha: f64,
    /// Eye fill RGB.
    pub eye_color: [u8; 3],
    /// Pupil fill RGB.
    pub pupil_color: [u8; 3],
}

impl StandardEyeGeometry {
    /// Validate retained style parameters before the first pupil update or draw.
    pub fn validate(&self) -> Result<(), PresentationError> {
        let nonnegative = [
            self.eye_radius,
            self.pupil_radius,
            self.pupil_travel,
            self.forward,
            self.separation,
            self.outline_width,
        ];
        finite(&nonnegative)?;
        finite(&[self.eye_alpha, self.pupil_alpha])?;
        if nonnegative.iter().any(|value| *value < 0.)
            || !(0. ..=1.).contains(&self.eye_alpha)
            || !(0. ..=1.).contains(&self.pupil_alpha)
        {
            return Err(PresentationError);
        }
        Ok(())
    }

    /// Compute a read-only layout from a captured face heading and pupil vector.
    /// Half-unit offsets follow distance scaling, and absolute coordinates are
    /// added before camera subtraction to retain double-precision operation order.
    pub fn layout(
        &self,
        face_heading: f64,
        pupil: Point,
        view: EyeLayoutInput,
    ) -> Result<StandardEyeLayout, PresentationError> {
        self.validate()?;
        let nonnegative = [view.viewport_half.x, view.viewport_half.y];
        finite(&nonnegative)?;
        finite(&[
            face_heading,
            pupil.x,
            pupil.y,
            view.corrected_head.x,
            view.corrected_head.y,
            view.camera.x,
            view.camera.y,
            view.scale,
            view.zoom,
            view.death_progress,
        ])?;
        if nonnegative.iter().any(|value| *value < 0.)
            || view.scale <= 0.
            || view.zoom <= 0.
            || !(0. ..1.).contains(&view.death_progress)
        {
            return Err(PresentationError);
        }
        let forward = self.forward * view.scale;
        let separation = self.separation * view.scale;
        let screen = |local: Point| -> Result<Point, PresentationError> {
            let absolute = Point {
                x: local.x + view.corrected_head.x,
                y: local.y + view.corrected_head.y,
            };
            let relative = Point {
                x: absolute.x - view.camera.x,
                y: absolute.y - view.camera.y,
            };
            let point = Point {
                x: view.viewport_half.x + relative.x * view.zoom,
                y: view.viewport_half.y + relative.y * view.zoom,
            };
            finite(&[local.x, local.y, point.x, point.y])?;
            Ok(point)
        };
        let pair = |side: f64| -> Result<EyePair, PresentationError> {
            Ok(EyePair {
                eye: screen(Point {
                    x: math::cos(face_heading) * forward + math::cos(side) * (separation + 0.5),
                    y: math::sin(face_heading) * forward + math::sin(side) * (separation + 0.5),
                })?,
                pupil: screen(Point {
                    x: math::cos(face_heading) * (forward + 0.5)
                        + pupil.x * view.scale
                        + math::cos(side) * separation,
                    y: math::sin(face_heading) * (forward + 0.5)
                        + pupil.y * view.scale
                        + math::sin(side) * separation,
                })?,
            })
        };
        let death_factor = if view.death_progress == 0. {
            1.
        } else {
            (1. - view.death_progress).sqrt()
        };
        let layout = StandardEyeLayout {
            pairs: [
                pair(face_heading - FRAC_PI_2)?,
                pair(face_heading + FRAC_PI_2)?,
            ],
            eye_radius: self.eye_radius * view.scale * view.zoom,
            pupil_radius: self.pupil_radius * view.scale * view.zoom,
            outline_width: self.outline_width * view.zoom,
            eye_alpha: self.eye_alpha * death_factor,
            pupil_alpha: self.pupil_alpha * death_factor,
            eye_color: self.eye_color,
            pupil_color: self.pupil_color,
        };
        finite(&[
            forward,
            separation,
            layout.eye_radius,
            layout.pupil_radius,
            layout.outline_width,
            layout.eye_alpha,
            layout.pupil_alpha,
        ])?;
        Ok(layout)
    }
}
