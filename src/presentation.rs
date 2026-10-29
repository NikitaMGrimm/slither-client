//! Explicit-time presentation primitives, separate from received state and physics.
//!
//! Timing, prediction, corrected geometry, camera and quality state have explicit
//! packet, update and draw inputs. These types own no sockets or raster assets.

use std::{
    error::Error,
    f64::consts::{PI, TAU},
    fmt,
};

use crate::{math, state::Point};

mod accessory_request;
mod announcement;
mod antenna;
mod arena_edge;
mod background;
mod body;
mod body_painter;
mod boundary;
mod camera;
mod client;
mod curve;
mod end_screen;
mod eyes;
mod face;
mod follow_camera;
mod food;
mod food_painter;
mod hud;
mod hud_history;
mod leaderboard_history;
mod leaderboard_score;
mod length;
mod minimap;
mod mouth_face;
mod nickname;
mod prey;
mod prey_painter;
mod quality;
mod score;
mod single_eye;
mod skin;
mod snake;
mod static_accessory;

pub use accessory_request::{AccessoryRequestInput, SelectedAccessoryRequest};
pub(crate) use announcement::AnnouncementPacket;
pub use announcement::{
    AnnouncementContent, AnnouncementError, AnnouncementLifecycle, AnnouncementLine,
    AnnouncementState, AnnouncementView,
};
pub use antenna::{
    AntennaBarrierEffect, AntennaBulbCommand, AntennaBulbGeometry, AntennaCullBounds,
    AntennaDrawInput, AntennaDrawRequest, AntennaError, AntennaPath, AntennaSnapshot, AntennaState,
    AntennaStroke, MAX_ANTENNA_NODES, OrdinaryAntennaGeometry, PreparedAntenna,
};
pub use arena_edge::{ArenaEdgeInput, ArenaEdgePlan, ArenaEdgeView, plan_arena_edge};
pub use background::{
    BackgroundImageLayer, BackgroundInput, BackgroundPatternLayer, BackgroundPlan,
    BackgroundSolidLayer, BackgroundState,
};
pub use body::{BODY_SAMPLES, BodyGeometry, BodyPoint, MAX_RETAINED_BODY_POINTS};
pub use body_painter::{
    BodyAlpha, BodyAsset, BodyAssetStatus, BodyAssetUse, BodyBlend, BodyFade, BodyImageCommand,
    BodyPaintError, BodyPaintGeometry, BodyPaintInput, BodyPaintPass, BodyPaintPlan,
    BodyPaintQuality, BodyPaintRecipe, BodyPaintSample, BodyPaintView, BodyPaintVisual,
    BodyPalette, BodyRect, BodyRun, BodyStyle, BodyVariantMode, MAX_BODY_PAINT_COMMANDS,
    MAX_BODY_PAINT_SAMPLES, plan_standard_body, plan_standard_body_with_antenna,
};
pub use boundary::{BOUNDARY_SAMPLES, BoundaryRadius};
pub use camera::{CAMERA_SAMPLES, CameraCorrections};
pub use client::{
    AccessoryPresentation, AnimatedClient, AntennaDrawBudget, AntennaRandomRequest,
    AppearanceContext, AppearancePresentation, ClientControlActions, ClientControlView,
    ClientPresentationError, ClientScoreView, FacePresentation, MAX_DRAW_SAMPLES,
    MAX_RETAINED_SNAKES, MAX_RETAINED_TOTAL_BODY_POINTS, OwnControlView, OwnScoreView,
    PreparedAccessorySnake, PreparedBodyGeometry, PreparedSnake, ScoreStatus, TintedPresentation,
};
pub use curve::{
    CurveInput, CurveOutput, CurveSample, CurveVertex, MAX_CURVE_SAMPLES, sample_curve,
    sample_curve_with_heading,
};
pub use end_screen::{EndScreenInput, EndScreenPhase, EndScreenState, EndScreenView};
pub use eyes::{EyeLayoutInput, EyePair, StandardEyeGeometry, StandardEyeLayout, StandardEyeState};
pub use face::{PairedFaceGeometry, PairedSideGeometry, PairedSideLayout};
pub use follow_camera::{FollowCamera, INITIAL_ZOOM};
pub use food::{
    FoodConsume, FoodEaterPose, FoodError, FoodFactory, FoodFactoryInput, FoodInstance,
    FoodPalette, FoodPresentation, FoodSnapshot, FoodSource, FoodSources, FoodSpawn, FoodWorld,
    MAX_RETAINED_FOODS, SnakeObjectToken, food_palette,
};
pub use food_painter::{
    FoodCullBounds, FoodImageCommand, FoodImageDraw, FoodPaintCounts, FoodPaintError,
    FoodPaintInput, FoodPaintPass, FoodPaintPlan, MAX_FOOD_PAINT_COMMANDS, plan_food,
};
pub(crate) use hud::HudLeaderboardRowsBudget;
pub use hud::{
    HudCommandGuard, HudIngressError, HudIngressEvent, HudIngressEventKind, HudIngressPlan,
    HudIngressReport, HudLeaderboardRow, HudLeaderboardRows,
};
pub use hud_history::{
    HudCurrent, HudFinal, HudHistory, HudHistoryEvent, HudLifecycle, HudOpacity, HudSample,
    hud_score_text,
};
pub use leaderboard_history::{
    LeaderboardEvent, LeaderboardEventKind, LeaderboardHistory, LeaderboardPlan, LeaderboardRawRow,
    LeaderboardRequest, LeaderboardRevision, LeaderboardRow, LeaderboardView,
};
#[cfg(target_arch = "wasm32")]
pub(crate) use leaderboard_history::{
    validate_nickname as validate_leaderboard_nickname,
    validate_score as validate_leaderboard_score,
};
pub use leaderboard_score::{
    LeaderboardRowScore, LeaderboardScoreError, LeaderboardScoreInput, LeaderboardScoreProjector,
};
pub use length::LengthPresentation;
pub use minimap::{
    MinimapBackgroundPlan, MinimapComposite, MinimapError, MinimapImageLayer, MinimapLabelPlan,
    MinimapLayout, MinimapMarkerPlan, MinimapRenderPlan, MinimapState, MinimapUpdateInput,
    MinimapView, MinimapWidgetPlan, plan_minimap,
};
pub use mouth_face::{MouthFaceGeometry, MouthFaceLayout, MouthImageLayout};
pub use nickname::{
    NEUTRAL_NICKNAME_COLOR, NicknameAlignment, NicknameBaseline, NicknameCullBounds, NicknameDraw,
    NicknameInput, NicknameState, NicknameTint,
};
pub use prey::{
    MAX_PREY_FAMILY_SOURCES, MAX_RETAINED_PREYS, PreyCorrections, PreyEaterPose, PreyError,
    PreyFactory, PreyFactoryInput, PreyInstance, PreyPalette, PreyPresentation, PreySnapshot,
    PreySource, PreySources, PreyWorld,
};
pub use prey_painter::{
    MAX_PREY_PAINT_COMMANDS, PreyImageCommand, PreyPaintCounts, PreyPaintError, PreyPaintInput,
    PreyPaintPass, PreyPaintPlan, plan_prey,
};
pub use quality::{QualityMode, QualitySnapshot, QualityState};
pub use score::{ScoreError, ScoreTables};
pub use single_eye::{FaceGeometry, SingleEyeGeometry, SingleEyeLayout};
pub use skin::{
    SkinAntenna, SkinDescriptor, SkinError, SkinFaceSources, SkinImage, SkinSourceRole,
    resolve_authored_local_skin, resolve_skin, stock_custom_palette_mask_valid,
};
pub use snake::{AnchorView, SnakeMetrics, SnakePresentation};
pub use static_accessory::{StaticHeadAccessoryGeometry, StaticHeadAccessoryLayout};
mod accessory_selection;
pub use accessory_selection::{stock_accessory_forward, stock_accessory_id};

/// Number of samples in each head position/fraction correction channel.
pub const HEAD_SAMPLES: usize = 53;
/// Number of samples in the heading correction channel.
pub const ANGLE_SAMPLES: usize = 26;

/// An invalid scalar or arithmetic result; failed operations preserve prior state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PresentationError;

impl fmt::Display for PresentationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("invalid or overflowing presentation input")
    }
}

impl Error for PresentationError {}

fn finite(values: &[f64]) -> Result<(), PresentationError> {
    if values.iter().all(|value| value.is_finite()) {
        Ok(())
    } else {
        Err(PresentationError)
    }
}

/// One animation update; deltas are measured in eight-millisecond units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameStep {
    /// Clamped elapsed delta multiplied by the current lag multiplier.
    pub delta: f64,
    /// Elapsed delta clamped to 0 through 5, before lag multiplication.
    pub unlagged_delta: f64,
    /// Difference between floors of the accumulated delta.
    pub whole_steps: u32,
    /// Difference between floors of the separately accumulated doubled delta.
    pub double_steps: u32,
    /// Lag multiplier used for this update, in 0.2 through 1.
    pub lag_multiplier: f64,
    /// Accumulated lag-adjusted animation units after this update.
    pub accumulated: f64,
    /// Separately accumulated doubled animation units after this update.
    pub doubled_accumulated: f64,
}

/// A presentation clock advanced only by caller-supplied millisecond timestamps.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameClock {
    last_ms: f64,
    accumulated: f64,
    doubled_accumulated: f64,
    lag_multiplier: f64,
}

impl FrameClock {
    /// Start with zero accumulated time and a lag multiplier of one.
    pub fn new(start_ms: f64) -> Result<Self, PresentationError> {
        finite(&[start_ms])?;
        Ok(Self {
            last_ms: start_ms,
            accumulated: 0.,
            doubled_accumulated: 0.,
            lag_multiplier: 1.,
        })
    }

    /// Restore full speed without advancing or replacing the retained timeline.
    pub fn reset_lag(&mut self) {
        self.lag_multiplier = 1.;
    }

    /// Advance atomically. Backward time contributes zero but replaces the timestamp.
    /// Skin preview freezes multiplier adjustment, while still applying its value.
    pub fn advance(
        &mut self,
        now_ms: f64,
        lagging: bool,
        skin_preview: bool,
    ) -> Result<FrameStep, PresentationError> {
        let elapsed = now_ms - self.last_ms;
        finite(&[now_ms, elapsed])?;
        let unlagged_delta = (elapsed / 8.).clamp(0., 5.);
        let lag_multiplier = if skin_preview {
            self.lag_multiplier
        } else if lagging {
            (self.lag_multiplier * 0.85).max(0.2)
        } else {
            (self.lag_multiplier + 0.05).min(1.)
        };
        let delta = unlagged_delta * lag_multiplier;
        let accumulated = self.accumulated + delta;
        let doubled_accumulated = self.doubled_accumulated + delta * 2.;
        finite(&[accumulated, doubled_accumulated])?;
        // Above this bound, integer frame counts can no longer be exact in f64.
        if doubled_accumulated >= 9_007_199_254_740_992. {
            return Err(PresentationError);
        }
        let step = FrameStep {
            delta,
            unlagged_delta,
            whole_steps: (accumulated.floor() - self.accumulated.floor()) as u32,
            double_steps: (doubled_accumulated.floor() - self.doubled_accumulated.floor()) as u32,
            lag_multiplier,
            accumulated,
            doubled_accumulated,
        };
        self.last_ms = now_ms;
        self.accumulated = accumulated;
        self.doubled_accumulated = doubled_accumulated;
        self.lag_multiplier = lag_multiplier;
        Ok(step)
    }
}

/// Direction of heading change, expressed without screen-coordinate handedness.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Turn {
    /// Copy the wanted heading on each update.
    None,
    /// Subtract the maximum turn from the heading.
    Decreasing,
    /// Add the maximum turn to the heading.
    Increasing,
}

/// Predicted head state; all positions and distances use world units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HeadMotion {
    /// Predicted head position.
    pub position: Point,
    /// Current heading in radians.
    pub heading: f64,
    /// Requested heading in radians.
    pub wanted_heading: f64,
    /// Current signed turn direction.
    pub turn: Turn,
    /// Raw speed scalar in world units per 32 milliseconds.
    /// Retain the producer's byte/18 or appearance-u16/1000 floating value.
    pub speed_per_32ms: f64,
    /// Positive distance between presentation anchors.
    pub segment_length: f64,
    /// Dimensionless head progress; not constrained to 0 through 1.
    pub head_fraction: f64,
}

fn normalized(angle: f64) -> f64 {
    let mut angle = angle % TAU;
    if angle < 0. {
        angle += TAU;
    }
    angle
}

fn signed_angle(angle: f64) -> f64 {
    let angle = normalized(angle);
    if angle > PI { angle - TAU } else { angle }
}

impl HeadMotion {
    /// Replace a head anchor and accumulate its position/fraction discontinuity.
    /// The anchor consumes one logical segment before extrapolated fraction is set.
    /// Body and camera changes are separate operations owned by the caller.
    pub fn reanchor(
        &mut self,
        position: Point,
        extrapolated_distance: f64,
        corrections: &mut HeadCorrections,
    ) -> Result<(), PresentationError> {
        finite(&[
            self.position.x,
            self.position.y,
            self.head_fraction,
            self.segment_length,
            position.x,
            position.y,
            extrapolated_distance,
        ])?;
        if self.segment_length <= 0. {
            return Err(PresentationError);
        }
        let fraction = extrapolated_distance / self.segment_length;
        finite(&[fraction])?;
        corrections.inject(
            position.x - self.position.x,
            position.y - self.position.y,
            fraction - (self.head_fraction - 1.),
        )?;
        self.position = position;
        self.head_fraction = fraction;
        Ok(())
    }

    /// Turn, then move a living head by at most one segment length.
    /// `turn_rate` is radians per animation unit before the two turn factors.
    /// Exact target landing retains direction until a subsequent crossing.
    /// A dead head still turns, but its position and head fraction stay fixed.
    pub fn advance(
        &mut self,
        step: FrameStep,
        turn_rate: f64,
        size_turn_factor: f64,
        speed_turn_factor: f64,
        alive: bool,
    ) -> Result<(), PresentationError> {
        finite(&[
            self.position.x,
            self.position.y,
            self.heading,
            self.wanted_heading,
            self.speed_per_32ms,
            self.segment_length,
            self.head_fraction,
            step.delta,
            turn_rate,
            size_turn_factor,
            speed_turn_factor,
        ])?;
        if !(0. ..=5.).contains(&step.delta)
            || self.speed_per_32ms < 0.
            || self.segment_length <= 0.
            || turn_rate < 0.
            || size_turn_factor < 0.
            || speed_turn_factor < 0.
        {
            return Err(PresentationError);
        }
        let maximum_turn = turn_rate * step.delta * size_turn_factor * speed_turn_factor;
        // Preserve operation order: conversion through world units/second changes rounding.
        let travel = self.speed_per_32ms * step.delta / 4.;
        finite(&[maximum_turn, travel])?;
        let mut next = *self;
        match self.turn {
            Turn::None => next.heading = self.wanted_heading,
            direction => {
                let changed = match direction {
                    Turn::Decreasing => self.heading - maximum_turn,
                    Turn::Increasing => self.heading + maximum_turn,
                    Turn::None => unreachable!(),
                };
                finite(&[changed])?;
                next.heading = normalized(changed);
                let difference = self.wanted_heading - next.heading;
                finite(&[difference])?;
                let difference = signed_angle(difference);
                if (direction == Turn::Decreasing && difference > 0.)
                    || (direction == Turn::Increasing && difference < 0.)
                {
                    next.heading = self.wanted_heading;
                    next.turn = Turn::None;
                }
            }
        }
        if alive {
            let travel = travel.min(self.segment_length);
            next.position.x += math::cos(next.heading) * travel;
            next.position.y += math::sin(next.heading) * travel;
            next.head_fraction += travel / self.segment_length;
        }
        finite(&[next.position.x, next.position.y, next.head_fraction])?;
        *self = next;
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq)]
struct CorrectionRing<const N: usize, const C: usize> {
    weights: [f32; N],
    samples: [[f32; N]; C],
    index: usize,
    pending: i32,
    offset: [f64; C],
}

impl<const N: usize, const C: usize> Default for CorrectionRing<N, C> {
    fn default() -> Self {
        Self {
            weights: std::array::from_fn(|index| {
                (0.5 * (1. - math::cos(PI * (N - 1 - index) as f64 / (N - 1) as f64))) as f32
            }),
            samples: [[0.; N]; C],
            index: 0,
            pending: 0,
            offset: [0.; C],
        }
    }
}

impl<const N: usize, const C: usize> CorrectionRing<N, C> {
    fn inject(&mut self, delta: [f64; C], refresh_offset: bool) -> Result<(), PresentationError> {
        finite(&delta)?;
        let mut samples = self.samples;
        for (channel, delta) in delta.into_iter().enumerate() {
            for (sample, weight) in self.weights.iter().enumerate() {
                let slot = (self.index + sample) % N;
                // Each stored result rounds once, after f64 multiplication/subtraction.
                let value = (f64::from(samples[channel][slot]) - delta * f64::from(*weight)) as f32;
                if !value.is_finite() {
                    return Err(PresentationError);
                }
                samples[channel][slot] = value;
            }
        }
        self.samples = samples;
        self.pending = N as i32;
        if refresh_offset {
            self.offset = self.samples.map(|channel| f64::from(channel[self.index]));
        }
        Ok(())
    }

    fn advance(&mut self, steps: u32) {
        if steps == 0 {
            return;
        }
        if self.pending > 0 {
            let consumed = steps.min(self.pending as u32);
            for _ in 0..consumed {
                for (channel, offset) in self.samples.iter_mut().zip(&mut self.offset) {
                    *offset = f64::from(channel[self.index]);
                    channel[self.index] = 0.;
                }
                self.index = (self.index + 1) % N;
            }
            self.pending -= consumed as i32;
        } else if self.pending == 0 {
            self.pending = -1;
            self.offset = [0.; C];
        }
    }
}

/// Three fixed f32 correction channels for head x, y, and head fraction.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HeadCorrections {
    ring: CorrectionRing<HEAD_SAMPLES, 3>,
}

impl HeadCorrections {
    /// Add correction for new-minus-old x, y, and head-fraction differences.
    /// Refresh the current offset immediately and reset pending to 53 samples.
    pub fn inject(
        &mut self,
        delta_x: f64,
        delta_y: f64,
        delta_fraction: f64,
    ) -> Result<(), PresentationError> {
        self.ring.inject([delta_x, delta_y, delta_fraction], true)
    }

    /// Consume integer steps, clearing slots. Cleanup follows on a later positive call.
    pub fn advance(&mut self, steps: u32) {
        self.ring.advance(steps);
    }
    /// Current x, y, and head-fraction offsets promoted from f32 storage.
    pub fn offset(&self) -> [f64; 3] {
        self.ring.offset
    }
    /// Next sample index, wrapping at 53.
    pub fn index(&self) -> usize {
        self.ring.index
    }
    /// Positive sample count, zero awaiting cleanup, or -1 after cleanup.
    pub fn pending(&self) -> i32 {
        self.ring.pending
    }
    /// Read-only channel-major samples, ordered x, y, then head fraction.
    pub fn samples(&self) -> &[[f32; HEAD_SAMPLES]; 3] {
        &self.ring.samples
    }
    /// Read-only f32 easing weights, from one down to zero.
    pub fn weights(&self) -> &[f32; HEAD_SAMPLES] {
        &self.ring.weights
    }
}

/// A fixed f32 correction channel for heading changes in radians.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AngleCorrections {
    ring: CorrectionRing<ANGLE_SAMPLES, 1>,
}

impl AngleCorrections {
    /// Add a new-minus-old heading difference using the signed shortest arc.
    /// The half-turn tie is positive. Reset pending to 26 samples.
    /// The displayed offset changes only on a later positive advance.
    pub fn inject(&mut self, angle_delta: f64) -> Result<(), PresentationError> {
        finite(&[angle_delta])?;
        self.ring.inject([signed_angle(angle_delta)], false)
    }

    /// Consume integer steps, clearing slots. Cleanup follows on a later positive call.
    pub fn advance(&mut self, steps: u32) {
        self.ring.advance(steps);
    }
    /// Current angle offset in radians, promoted from f32 storage.
    pub fn offset(&self) -> f64 {
        self.ring.offset[0]
    }
    /// Next sample index, wrapping at 26.
    pub fn index(&self) -> usize {
        self.ring.index
    }
    /// Positive sample count, zero awaiting cleanup, or -1 after cleanup.
    pub fn pending(&self) -> i32 {
        self.ring.pending
    }
    /// Read-only physical ring samples.
    pub fn samples(&self) -> &[f32; ANGLE_SAMPLES] {
        &self.ring.samples[0]
    }
    /// Read-only f32 easing weights, from one down to zero.
    pub fn weights(&self) -> &[f32; ANGLE_SAMPLES] {
        &self.ring.weights
    }
}
