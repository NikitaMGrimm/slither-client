//! Ordered packet, update, and draw transitions for one absolute presentation snake.

use super::{
    AngleCorrections, BodyGeometry, CurveInput, CurveOutput, FrameStep, HeadCorrections,
    HeadMotion, LengthPresentation, PairedFaceGeometry, PresentationError, StandardEyeGeometry,
    StandardEyeState, Turn, curve::single_anchor_eye_target, finite, sample_curve_with_heading,
};
use crate::{
    math,
    state::{Appearance, Direction, Point, Setup},
};

/// Caller-owned view inputs for a single anchor event.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AnchorView {
    /// Positive zoom used when recomputing target point spacing.
    pub zoom: f64,
    /// Already computed head extrapolation distance in world units.
    pub extrapolated_distance: f64,
}

/// Copyable numeric observation of a snake; positions remain absolute.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SnakeMetrics {
    /// Wire identifier, including zero.
    pub id: u16,
    /// Wire skin index, retained without rendering it.
    pub skin: u8,
    /// Uncorrected predicted head position.
    pub raw_head: Point,
    /// Predicted head plus current Float32 correction offsets.
    pub corrected_head: Point,
    /// Current uncorrected heading in radians.
    pub heading: f64,
    /// Independently retained wanted heading in radians.
    pub wanted_heading: f64,
    /// Current heading plus displayed angle correction.
    pub corrected_heading: f64,
    /// Active turning direction; appearance metadata does not start a turn.
    pub turn: Turn,
    /// Uncorrected dimensionless head progress.
    pub head_fraction: f64,
    /// Head progress plus current Float32 fraction correction.
    pub corrected_head_fraction: f64,
    /// Exact decoded speed scalar in world units per 32 milliseconds.
    pub speed_per_32ms: f64,
    /// Latest received fractional mass.
    pub fam: f64,
    /// Logical segment count, excluding dying retained body points.
    pub logical_segments: usize,
    /// Current live-update-assigned length, including the desktop end adjustment.
    pub displayed_length: f64,
    /// Size derived from logical segment count.
    pub scale: f64,
    /// Size-dependent turning factor.
    pub size_turn_factor: f64,
    /// Speed-dependent turning factor, capped at one.
    pub speed_turn_factor: f64,
    /// Size-dependent cruise speed in wire speed units.
    pub cruise_speed: f64,
    /// Cruise speed plus the visual boost threshold adjustment.
    pub boost_threshold_speed: f64,
    /// Maximum speed captured when this appearance was constructed.
    pub maximum_speed: f64,
    /// Speed eased once per live update, independently of elapsed time.
    pub visual_speed: f64,
    /// Accumulated visual boost animation phase.
    pub boost_phase: f64,
    /// Spacing adjusted only by eligible draw calls.
    pub point_spacing: f64,
    /// Latest packet-derived spacing target.
    pub target_point_spacing: f64,
    /// Live spawn fade in the inclusive range zero through one.
    pub spawn_progress: f64,
    /// Death fade; values at least one are expired.
    pub death_progress: f64,
    /// Whether live travel, length, and speed updates are enabled.
    pub alive: bool,
    /// Whether death completed and animation updates have stopped.
    pub expired: bool,
    /// Last caller-supplied visibility, retained for packet and draw transitions.
    pub visible: bool,
}

/// Coupled head, body, and length state with separate packet, update, and draw clocks.
///
/// Fallible transitions stage the entire snake, including every correction ring.
/// Packet methods can still update an expired retained own object; `advance`
/// remains stopped after expiry. No camera or skin rendering is done.
#[derive(Clone, Debug, PartialEq)]
pub struct SnakePresentation {
    id: u16,
    skin: u8,
    custom_skin: Vec<u8>,
    cosmetic: u8,
    head: HeadMotion,
    head_corrections: HeadCorrections,
    angle_corrections: AngleCorrections,
    body: BodyGeometry,
    length: LengthPresentation,
    eyes: StandardEyeState,
    face_geometry: PairedFaceGeometry,
    turn_rate: f64,
    speed_angle_divisor: f64,
    base_cruise_speed: f64,
    size_cruise_speed_factor: f64,
    scale: f64,
    size_turn_factor: f64,
    speed_turn_factor: f64,
    cruise_speed: f64,
    boost_threshold_speed: f64,
    maximum_speed: f64,
    visual_speed: f64,
    boost_phase: f64,
    point_spacing: f64,
    target_point_spacing: f64,
    spawn_progress: f64,
    death_progress: f64,
    alive: bool,
    expired: bool,
    visible: bool,
}

fn validate_zoom(zoom: f64) -> Result<(), PresentationError> {
    finite(&[zoom, 4.5 / zoom])?;
    if zoom <= 0. {
        return Err(PresentationError);
    }
    Ok(())
}

fn validate_mass(fam: f64) -> Result<(), PresentationError> {
    if !(0. ..=1.).contains(&fam) {
        return Err(PresentationError);
    }
    Ok(())
}

impl SnakePresentation {
    /// Refresh global configuration without replacing appearance-time state or metrics.
    pub(crate) fn apply_setup(&mut self, setup: &Setup) -> Result<(), PresentationError> {
        finite(&[setup.mamu, setup.spangdv, setup.nsp1, setup.nsp2])?;
        if setup.protocol != 19
            || setup.mamu < 0.
            || setup.spangdv <= 0.
            || setup.nsp1 < 0.
            || setup.nsp2 < 0.
        {
            return Err(PresentationError);
        }
        self.body.configure_contraction(setup.body_contraction)?;
        self.turn_rate = setup.mamu;
        self.speed_angle_divisor = setup.spangdv;
        self.base_cruise_speed = setup.nsp1;
        self.size_cruise_speed_factor = setup.nsp2;
        Ok(())
    }

    /// Initialize absolute geometry and effective heading from validated protocol 19 inputs.
    /// Initial length is constructed at zero mass before scheduling the wire mass,
    /// so its first displayed value excludes that mass even when it is nonzero.
    pub fn from_appearance(
        appearance: &Appearance,
        setup: &Setup,
        zoom: f64,
    ) -> Result<Self, PresentationError> {
        Self::from_appearance_with_eye_geometry(
            appearance,
            setup,
            zoom,
            StandardEyeGeometry::default(),
        )
    }

    /// Initialize paired-eye style before any pupil advancement. The style is
    /// appearance-owned and does not reset later gaze, face or pupil state.
    pub fn from_appearance_with_eye_geometry(
        appearance: &Appearance,
        setup: &Setup,
        zoom: f64,
        eye_geometry: StandardEyeGeometry,
    ) -> Result<Self, PresentationError> {
        Self::from_appearance_with_face_geometry(
            appearance,
            setup,
            zoom,
            PairedFaceGeometry {
                eyes: eye_geometry,
                decoration: None,
            },
        )
    }

    /// Install the complete paired face before the first update, per retained object.
    pub fn from_appearance_with_face_geometry(
        appearance: &Appearance,
        setup: &Setup,
        zoom: f64,
        face_geometry: PairedFaceGeometry,
    ) -> Result<Self, PresentationError> {
        face_geometry.validate()?;
        validate_zoom(zoom)?;
        validate_mass(appearance.fam)?;
        finite(&[
            setup.grid_center,
            setup.radius,
            setup.body_spacing,
            setup.body_contraction,
            setup.spangdv,
            setup.nsp1,
            setup.nsp2,
            setup.nsp3,
            setup.mamu,
            setup.mamu2,
            appearance.heading,
            appearance.wanted_heading,
            appearance.speed_per_32ms,
            appearance.speed_per_32ms / setup.spangdv,
        ])?;
        if setup.protocol != 19
            || appearance.custom_skin.len() > 255
            || setup.grid_center <= 0.
            || setup.radius <= 0.
            || setup.max_segments == 0
            || setup.sector_size == 0
            || setup.sector_count == 0
            || setup.spangdv <= 0.
            || setup.nsp1 < 0.
            || setup.nsp2 < 0.
            || setup.nsp3 < 0.
            || setup.mamu < 0.
            || setup.mamu2 < 0.
            || appearance.speed_per_32ms < 0.
        {
            return Err(PresentationError);
        }
        let body = BodyGeometry::from_appearance(appearance, setup)?;
        let mut length = LengthPresentation::new(body.logical_segments() as u32);
        length.set_length(body.logical_segments() as u32, appearance.fam)?;
        let mut snake = Self {
            id: appearance.id,
            skin: appearance.skin,
            custom_skin: appearance.custom_skin.clone(),
            cosmetic: appearance.cosmetic,
            head: HeadMotion {
                position: appearance.absolute_head,
                heading: appearance.heading,
                wanted_heading: appearance.wanted_heading,
                turn: Turn::None,
                speed_per_32ms: appearance.speed_per_32ms,
                segment_length: setup.body_spacing,
                head_fraction: 0.,
            },
            head_corrections: HeadCorrections::default(),
            angle_corrections: AngleCorrections::default(),
            body,
            length,
            eyes: StandardEyeState::new(appearance.heading, appearance.wanted_heading)?,
            face_geometry,
            turn_rate: setup.mamu,
            speed_angle_divisor: setup.spangdv,
            base_cruise_speed: setup.nsp1,
            size_cruise_speed_factor: setup.nsp2,
            scale: 0.,
            size_turn_factor: 0.,
            speed_turn_factor: (appearance.speed_per_32ms / setup.spangdv).min(1.),
            cruise_speed: 0.,
            boost_threshold_speed: 0.,
            maximum_speed: setup.nsp3,
            visual_speed: 0.,
            boost_phase: 0.,
            point_spacing: 0.,
            target_point_spacing: 0.,
            spawn_progress: 0.,
            death_progress: 0.,
            alive: true,
            expired: false,
            visible: false,
        };
        snake.recompute_size(zoom)?;
        snake.point_spacing = snake.target_point_spacing;
        snake.validate_observation()?;
        Ok(snake)
    }

    fn recompute_size(&mut self, zoom: f64) -> Result<(), PresentationError> {
        validate_zoom(zoom)?;
        self.scale = (1. + (self.body.logical_segments() as f64 - 2.) / 106.).min(6.);
        self.size_turn_factor = 0.13 + 0.87 * math::pow((7. - self.scale) / 6., 2.);
        self.cruise_speed = self.base_cruise_speed + self.size_cruise_speed_factor * self.scale;
        self.boost_threshold_speed = self.cruise_speed + 0.1;
        self.target_point_spacing = (6. * self.scale).max(4.5 / zoom);
        finite(&[
            self.scale,
            self.size_turn_factor,
            self.cruise_speed,
            self.boost_threshold_speed,
            self.target_point_spacing,
        ])
    }

    fn validate_observation(&self) -> Result<(), PresentationError> {
        let metrics = self.metrics();
        finite(&[
            metrics.raw_head.x,
            metrics.raw_head.y,
            metrics.corrected_head.x,
            metrics.corrected_head.y,
            metrics.heading,
            metrics.wanted_heading,
            metrics.corrected_heading,
            metrics.head_fraction,
            metrics.corrected_head_fraction,
            metrics.speed_per_32ms,
            metrics.speed_turn_factor,
            metrics.visual_speed,
            metrics.boost_phase,
            metrics.point_spacing,
            metrics.spawn_progress,
            metrics.death_progress,
        ])
    }

    fn transaction(
        &mut self,
        transition: impl FnOnce(&mut Self) -> Result<(), PresentationError>,
    ) -> Result<(), PresentationError> {
        let mut staged = self.clone();
        transition(&mut staged)?;
        staged.validate_observation()?;
        *self = staged;
        Ok(())
    }

    /// Apply present motion fields in direction, heading, wanted, then speed order.
    /// Equal heading reports still restart the angle correction interval.
    pub fn set_motion(
        &mut self,
        heading: Option<f64>,
        wanted_heading: Option<f64>,
        direction: Option<Direction>,
        speed_per_32ms: Option<f64>,
    ) -> Result<(), PresentationError> {
        self.transaction(|next| {
            if let Some(direction) = direction {
                next.head.turn = match direction {
                    Direction::None => Turn::None,
                    Direction::Decreasing => Turn::Decreasing,
                    Direction::Increasing => Turn::Increasing,
                };
            }
            if let Some(heading) = heading {
                finite(&[heading])?;
                next.angle_corrections.inject(heading - next.head.heading)?;
                next.head.heading = heading;
            }
            if let Some(wanted) = wanted_heading {
                finite(&[wanted])?;
                next.head.wanted_heading = wanted;
            }
            if let Some(speed) = speed_per_32ms {
                finite(&[speed, speed / next.speed_angle_divisor])?;
                if speed < 0. {
                    return Err(PresentationError);
                }
                next.head.speed_per_32ms = speed;
                next.speed_turn_factor = (speed / next.speed_angle_divisor).min(1.);
            }
            Ok(())
        })
    }

    /// Schedule fractional mass even when equal to the previous report.
    pub fn set_mass(&mut self, fam: f64) -> Result<(), PresentationError> {
        self.transaction(|next| {
            next.length
                .set_length(next.body.logical_segments() as u32, fam)
        })
    }

    /// Mark the oldest living anchor dying, then schedule optional mass and length.
    /// Size is recomputed only when a living anchor was found.
    pub fn remove_tail(&mut self, fam: Option<f64>, zoom: f64) -> Result<(), PresentationError> {
        validate_zoom(zoom)?;
        self.transaction(|next| {
            let removed = next.body.remove_tail()?;
            let fam = fam.unwrap_or(next.length.fractional_mass());
            next.length
                .set_length(next.body.logical_segments() as u32, fam)?;
            if removed {
                next.recompute_size(zoom)?;
            }
            Ok(())
        })
    }

    /// Apply body membership and contraction before reanchoring the predicted head.
    /// `Some(fam)` denotes growth, including zero fractional mass. Body correction
    /// injection uses the pre-event corrected head and retained visibility.
    pub fn apply_anchor(
        &mut self,
        absolute_position: Option<Point>,
        direction: Option<u16>,
        fam: Option<f64>,
        view: AnchorView,
    ) -> Result<(), PresentationError> {
        validate_zoom(view.zoom)?;
        finite(&[view.extrapolated_distance])?;
        if let Some(fam) = fam {
            validate_mass(fam)?;
        }
        self.transaction(|next| {
            let position = next.body.apply_anchor(
                absolute_position,
                direction,
                fam.is_some(),
                next.metrics().corrected_head,
                next.visible,
            )?;
            next.recompute_size(view.zoom)?;
            if let Some(fam) = fam {
                next.length
                    .set_length(next.body.logical_segments() as u32, fam)?;
            }
            next.head.reanchor(
                position,
                view.extrapolated_distance,
                &mut next.head_corrections,
            )
        })
    }

    /// Retain caller-computed visibility for subsequent packet and draw operations.
    pub fn set_visible(&mut self, visible: bool) {
        if visible && !self.visible {
            // Every head transition validates this private heading before commit.
            self.eyes
                .visible_entry(self.head.heading)
                .expect("snake heading is finite");
        }
        self.visible = visible;
    }

    /// Replace independent gaze without changing wanted steering or correction rings.
    /// The client owns pointer/remote routing; motion fields alone do not set gaze.
    pub fn set_gaze_heading(&mut self, heading: f64) -> Result<(), PresentationError> {
        self.eyes.set_gaze(heading)
    }

    /// Advance one explicit update atomically; return false after death expiry.
    /// Visual speed changes per live call, including zero elapsed time. Integer
    /// body/head/angle rings drain independently of live-only length updates.
    pub fn advance(&mut self, step: FrameStep) -> Result<bool, PresentationError> {
        finite(&[
            step.delta,
            step.unlagged_delta,
            step.lag_multiplier,
            step.accumulated,
            step.doubled_accumulated,
        ])?;
        if !(0. ..=5.).contains(&step.delta)
            || !(0. ..=5.).contains(&step.unlagged_delta)
            || !(0.2..=1.).contains(&step.lag_multiplier)
            || step.accumulated < 0.
            || step.doubled_accumulated < 0.
        {
            return Err(PresentationError);
        }
        if self.expired {
            return Ok(false);
        }
        self.transaction(|next| {
            if next.alive {
                let speed = next.head.speed_per_32ms;
                if next.visual_speed < speed {
                    next.visual_speed += (speed - next.visual_speed) * 0.1;
                    next.visual_speed += 0.0001;
                    if next.visual_speed > speed {
                        next.visual_speed = speed;
                    }
                } else if next.visual_speed > speed {
                    next.visual_speed += (speed - next.visual_speed) * 0.3;
                    next.visual_speed -= 0.0001;
                    if next.visual_speed < speed {
                        next.visual_speed = speed;
                    }
                }
                if next.visual_speed > next.boost_threshold_speed {
                    next.boost_phase +=
                        (next.visual_speed - next.boost_threshold_speed) * step.delta * 0.021;
                }
                next.length.advance(step.whole_steps, true);
            }
            next.head.advance(
                step,
                next.turn_rate,
                next.size_turn_factor,
                next.speed_turn_factor,
                next.alive,
            )?;
            next.eyes
                .advance(step, next.alive, next.face_geometry.eyes.pupil_travel)?;
            next.body.advance(step.whole_steps);
            next.head_corrections.advance(step.whole_steps);
            next.angle_corrections.advance(step.whole_steps);
            if next.alive {
                if next.spawn_progress != 1. {
                    next.spawn_progress += step.delta * 0.015;
                    if next.spawn_progress >= 1. {
                        next.spawn_progress = 1.;
                    }
                }
            } else {
                next.death_progress += step.delta * 0.02;
                next.expired = next.death_progress >= 1.;
            }
            Ok(())
        })?;
        Ok(!self.expired)
    }

    /// Approach packet-derived point spacing once per visible draw, by 0.0035.
    /// Expired objects no longer participate in drawing.
    pub fn prepare_draw(&mut self) -> Result<(), PresentationError> {
        if !self.visible || self.expired {
            return Ok(());
        }
        let previous_spacing = self.point_spacing;
        if self.point_spacing < self.target_point_spacing {
            self.point_spacing += 0.0035;
            if self.point_spacing >= self.target_point_spacing {
                self.point_spacing = self.target_point_spacing;
            }
        } else if self.point_spacing > self.target_point_spacing {
            self.point_spacing -= 0.0035;
            if self.point_spacing <= self.target_point_spacing {
                self.point_spacing = self.target_point_spacing;
            }
        }
        // Spacing is the only mutation; rollback needs no body/correction copy.
        if let Err(error) = self.validate_observation() {
            self.point_spacing = previous_spacing;
            return Err(error);
        }
        Ok(())
    }

    /// Begin death once; repeated calls do not restart or resurrect an object.
    pub fn mark_dead(&mut self) {
        self.alive = false;
        self.eyes.mark_dead();
    }

    /// Prepare a body inside an already staged client, freezing its single spacing
    /// transition in the sampler. The face heading precedes this draw's target.
    /// The caller must discard its staged client on failure.
    pub(crate) fn prepare_curve_staged(
        &mut self,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<(Option<CurveOutput>, f64), PresentationError> {
        let next = self;
        next.prepare_draw()?;
        let metrics = next.metrics();
        let input = CurveInput {
            corrected_head: metrics.corrected_head,
            head_fraction: metrics.corrected_head_fraction,
            body: next.body.points(),
            displayed_length: metrics.displayed_length,
            segment_length: next.body.segment_length(),
            point_spacing: metrics.point_spacing,
            target_point_spacing: metrics.point_spacing,
            quality_scale,
            detailed_style,
        };
        let (curve, target) = match input.body.len() {
            0 => (None, metrics.heading),
            1 => (None, single_anchor_eye_target(input, metrics.heading)?),
            _ => {
                let curve = sample_curve_with_heading(input, metrics.heading)?;
                let target = curve.target_eye_heading;
                (Some(curve), target)
            }
        };
        let face_heading = next.eyes.commit_draw_target(target)?;
        next.validate_observation()?;
        Ok((curve, face_heading))
    }

    /// Read-only retained face, target, turn, gaze and pupil state.
    pub fn eyes(&self) -> &StandardEyeState {
        &self.eyes
    }

    /// Standard paired-eye geometry; special topologies are not inferred from skin IDs.
    pub fn eye_geometry(&self) -> &StandardEyeGeometry {
        &self.face_geometry.eyes
    }

    /// Complete appearance-owned numeric style, independent of wire-ID lookup.
    pub fn face_geometry(&self) -> &PairedFaceGeometry {
        &self.face_geometry
    }

    /// Original custom bytes on this retained appearance, independent of ID reuse.
    pub fn custom_skin(&self) -> &[u8] {
        &self.custom_skin
    }

    /// Original cosmetic marker; interpretation belongs to the trusted provider.
    pub fn cosmetic(&self) -> u8 {
        self.cosmetic
    }

    /// Observe all coupled numeric channels without advancing them.
    pub fn metrics(&self) -> SnakeMetrics {
        let [x, y, fraction] = self.head_corrections.offset();
        SnakeMetrics {
            id: self.id,
            skin: self.skin,
            raw_head: self.head.position,
            corrected_head: Point {
                x: self.head.position.x + x,
                y: self.head.position.y + y,
            },
            heading: self.head.heading,
            wanted_heading: self.head.wanted_heading,
            corrected_heading: self.head.heading + self.angle_corrections.offset(),
            turn: self.head.turn,
            head_fraction: self.head.head_fraction,
            corrected_head_fraction: self.head.head_fraction + fraction,
            speed_per_32ms: self.head.speed_per_32ms,
            fam: self.length.fractional_mass(),
            logical_segments: self.body.logical_segments(),
            displayed_length: self.length.displayed(),
            scale: self.scale,
            size_turn_factor: self.size_turn_factor,
            speed_turn_factor: self.speed_turn_factor,
            cruise_speed: self.cruise_speed,
            boost_threshold_speed: self.boost_threshold_speed,
            maximum_speed: self.maximum_speed,
            visual_speed: self.visual_speed,
            boost_phase: self.boost_phase,
            point_spacing: self.point_spacing,
            target_point_spacing: self.target_point_spacing,
            spawn_progress: self.spawn_progress,
            death_progress: self.death_progress,
            alive: self.alive,
            expired: self.expired,
            visible: self.visible,
        }
    }

    /// Read-only predicted head, including exact wire speed and current fraction.
    pub fn head(&self) -> &HeadMotion {
        &self.head
    }

    /// Read-only head correction offsets, Float32 samples, index, and pending count.
    pub fn head_corrections(&self) -> &HeadCorrections {
        &self.head_corrections
    }

    /// Read-only angle correction offsets, Float32 samples, index, and pending count.
    pub fn angle_corrections(&self) -> &AngleCorrections {
        &self.angle_corrections
    }

    /// Read-only absolute body geometry, retained dying points, and correction rings.
    pub fn body(&self) -> &BodyGeometry {
        &self.body
    }

    /// Read-only logical/displayed length and its Float32 correction ring.
    pub fn length(&self) -> &LengthPresentation {
        &self.length
    }
}
