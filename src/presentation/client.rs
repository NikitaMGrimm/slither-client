//! Atomic received events and bounded animation state, with separate update/draw clocks.

use std::{error::Error, fmt};

use super::{
    AnchorView, BodyPaintGeometry, BodyPaintSample, BoundaryRadius, CurveOutput, FollowCamera,
    FrameClock, FrameStep, MAX_CURVE_SAMPLES, PairedFaceGeometry, PairedSideGeometry,
    PresentationError, SnakeMetrics, SnakePresentation, StandardEyeGeometry, finite,
};
use crate::{
    protocol::ElapsedHeader,
    state::{
        Appearance, ClientState, FrameReport, MAX_SNAKES, MAX_TOTAL_BODY_POINTS, Point,
        PresentationEvent, SnakeTarget, StateError,
    },
};

/// Retained objects, including duplicate appearances, deaths, and an undrawn own object.
pub const MAX_RETAINED_SNAKES: usize = MAX_SNAKES * 2;
/// Aggregate physical anchors, including retained dying body points and undrawn own geometry.
pub const MAX_RETAINED_TOTAL_BODY_POINTS: usize = MAX_TOTAL_BODY_POINTS * 2;
/// Aggregate active curve samples permitted in one prepared numeric draw.
pub const MAX_DRAW_SAMPLES: usize = MAX_RETAINED_TOTAL_BODY_POINTS * 2;

/// Owned active body-painter inputs captured during a visible snake's numeric draw.
#[derive(Clone, Debug, PartialEq)]
pub struct PreparedBodyGeometry {
    /// All active samples in original head-to-tail order, including skipped flags.
    pub samples: Vec<BodyPaintSample>,
    /// Actual final unrounded tangent displacement, before Float32 storage.
    pub distance_cursor_seed: Point,
}

impl PreparedBodyGeometry {
    /// Borrow the complete active prefix of this visible body for the standard planner.
    /// Recipe eligibility and readiness still belong to the caller's recipe inputs.
    pub fn as_paint_geometry(&self) -> BodyPaintGeometry<'_> {
        BodyPaintGeometry {
            samples: &self.samples,
            active_count: self.samples.len(),
            distance_cursor_seed: self.distance_cursor_seed,
            eligible: true,
        }
    }
}

/// One visible snake's complete numeric draw data, in current draw-collection order.
/// Finish this body's eye/pupil pairs before painting the next prepared snake.
#[derive(Clone, Debug, PartialEq)]
pub struct PreparedSnake {
    /// Index in the full draw collection, including culled entries before this one.
    pub draw_ordinal: usize,
    /// Whether this is the retained original own object, independently of wire ID.
    pub own: bool,
    /// Existing numeric metrics after this draw's single spacing transition.
    pub metrics: SnakeMetrics,
    /// Sampled body, or none when fewer than two retained anchors exist.
    pub curve: Option<CurveOutput>,
    /// Painter snapshot, omitted when the curve has fewer than two active samples.
    pub body_geometry: Option<PreparedBodyGeometry>,
    /// Face heading captured before committing this draw's new curve target.
    pub face_heading: f64,
    /// World-axis pupil displacement, before entity scale and zoom.
    pub pupil: Point,
    /// Caller-ready standard paired-eye geometry and style.
    pub eye_geometry: StandardEyeGeometry,
    /// Appearance-owned side-image geometry; assets are borrowed only during submission.
    pub face_decoration: Option<PairedSideGeometry>,
}

/// A failed received, numeric, or retention transition; the entire client is preserved.
#[derive(Clone, Debug, PartialEq)]
pub enum ClientPresentationError {
    /// Packet framing, validation, received-state policy, or received-state capacity failed.
    State(StateError),
    /// A presentation input or arithmetic result is invalid.
    Presentation(PresentationError),
    /// The presentation world or prepared draw would exceed a retention/sample bound.
    Limit,
    /// Presentation requires an unimplemented mode-specific skin/color ordering.
    UnsupportedMode(u8),
}

impl fmt::Display for ClientPresentationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::State(error) => error.fmt(f),
            Self::Presentation(error) => error.fmt(f),
            Self::Limit => f.write_str("retained presentation capacity exceeded"),
            Self::UnsupportedMode(mode) => write!(f, "unsupported presentation mode {mode}"),
        }
    }
}

impl Error for ClientPresentationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::State(error) => Some(error),
            Self::Presentation(error) => Some(error),
            Self::Limit | Self::UnsupportedMode(_) => None,
        }
    }
}

impl From<StateError> for ClientPresentationError {
    fn from(error: StateError) -> Self {
        Self::State(error)
    }
}

impl From<PresentationError> for ClientPresentationError {
    fn from(error: PresentationError) -> Self {
        Self::Presentation(error)
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Entry {
    // A duplicate keeps its original wire identity for oldest-first removal,
    // while only the newest appearance remains in the packet lookup.
    wire_id: Option<u16>,
    addressed: bool,
    own: bool,
    drawn: bool,
    snake: SnakePresentation,
}

/// Bounded native animation world with transactional numeric draws. No sockets.
///
/// Entries are stored in update/paint order, oldest appearance first. The own
/// object is retained independently of the packet lookup and draw collection.
/// Every fallible public transition preserves received counters/caches, clocks,
/// camera, membership, and all entity channels on failure.
/// Shared ordinal flags start at zero and survive setup and explicit reset on
/// this object; only a brand-new client starts a new flag history.
#[derive(Clone, Debug, PartialEq)]
pub struct AnimatedClient {
    received: ClientState,
    clock: FrameClock,
    camera: FollowCamera,
    boundary: Option<BoundaryRadius>,
    connected: bool,
    entries: Vec<Entry>,
    body_paint_flags: Vec<u8>,
}

fn validate_draw_inputs(
    width: u32,
    height: u32,
    quality_scale: f64,
) -> Result<(), ClientPresentationError> {
    finite(&[quality_scale])?;
    if width == 0 || height == 0 || quality_scale <= 0. {
        return Err(PresentationError.into());
    }
    Ok(())
}

impl AnimatedClient {
    /// Start an empty received and animation world at an explicit timestamp.
    pub fn new(start_ms: f64) -> Result<Self, ClientPresentationError> {
        Ok(Self {
            received: ClientState::default(),
            clock: FrameClock::new(start_ms)?,
            camera: FollowCamera::default(),
            boundary: None,
            connected: false,
            entries: Vec::new(),
            body_paint_flags: vec![0; MAX_CURVE_SAMPLES],
        })
    }

    /// Clear the world and transient view state, and restore the lag multiplier to one.
    /// Preserve the clock's timestamp and both accumulated phases, boundary state,
    /// caller follow preference and shared body-painter flag history. Use `new`
    /// to start a fresh timeline.
    pub fn reset(&mut self) {
        self.received = ClientState::default();
        self.clock.reset_lag();
        self.reset_camera();
        self.connected = false;
        self.entries.clear();
    }

    fn reset_camera(&mut self) {
        // Following is a caller preference that survives world/connection resets.
        let follows = self.camera.follows();
        self.camera = FollowCamera::default();
        self.camera.set_follows(follows);
    }

    fn target_index(&self, target: SnakeTarget) -> Option<usize> {
        match target {
            SnakeTarget::Own => self.entries.iter().position(|entry| entry.own),
            SnakeTarget::Id(id) => self.lookup_index(id),
        }
    }

    fn lookup_index(&self, id: u16) -> Option<usize> {
        self.entries
            .iter()
            .rposition(|entry| entry.addressed && entry.wire_id == Some(id))
    }

    fn check_limits(&self) -> Result<(), ClientPresentationError> {
        if self.entries.len() > MAX_RETAINED_SNAKES
            || self.retained_body_points() > MAX_RETAINED_TOTAL_BODY_POINTS
        {
            Err(ClientPresentationError::Limit)
        } else {
            Ok(())
        }
    }

    /// Commit a complete received frame and its presentation events together.
    /// Elapsed headers are retained by received state; anchor extrapolation is zero.
    /// A setup clears the world and camera without resetting the fractional clock.
    /// Shared body-painter ordinal flags survive setup on the same client.
    pub fn apply_frame(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
    ) -> Result<FrameReport, ClientPresentationError> {
        self.apply_frame_with_eye_geometry(bytes, header, |_| Ok(StandardEyeGeometry::default()))
    }

    /// Resolve paired-eye parameters once for each appearance in packet order,
    /// before its first animation update. Geometry belongs to the retained object,
    /// independently of later wire-ID reuse. Complete framing and received-state
    /// validation precede callbacks; a later presentation error can still follow
    /// a callback. Model changes roll back on any error; caller effects cannot.
    pub fn apply_frame_with_eye_geometry<E, F>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        mut resolve: F,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<StandardEyeGeometry, E>,
    {
        self.apply_frame_with_face_geometry(bytes, header, |appearance| {
            Ok(PairedFaceGeometry {
                eyes: resolve(appearance)?,
                decoration: None,
            })
        })
    }

    /// Resolve the complete paired face in the same single staged event transaction.
    /// Numeric metadata is owned before any update; callback side effects remain external.
    pub fn apply_frame_with_face_geometry<E, F>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        mut resolve: F,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<PairedFaceGeometry, E>,
    {
        let mut received = self.received.clone();
        let applied = received
            .apply_frame_with_events(bytes, header)
            .map_err(ClientPresentationError::from)?;
        if applied.events.is_empty() {
            self.received = received;
            return Ok(applied.report);
        }
        let mut next = self.clone();
        let mut setup = self.received.setup.clone();
        for event in applied.events {
            match event {
                PresentationEvent::Setup(value) => {
                    if value.game_mode == Some(2) {
                        return Err(ClientPresentationError::UnsupportedMode(2).into());
                    }
                    if let Some(boundary) = &mut next.boundary {
                        boundary
                            .apply_setup(value.radius)
                            .map_err(ClientPresentationError::from)?;
                    } else {
                        next.boundary = Some(
                            BoundaryRadius::new(value.radius)
                                .map_err(ClientPresentationError::from)?,
                        );
                    }
                    next.connected = true;
                    setup = Some(value);
                    next.entries.clear();
                    next.reset_camera();
                }
                PresentationEvent::SnakeAppearance(appearance) => {
                    let setup = setup
                        .as_ref()
                        .ok_or(StateError::MissingSetup)
                        .map_err(ClientPresentationError::from)?;
                    let geometry = resolve(&appearance)?;
                    let snake = SnakePresentation::from_appearance_with_face_geometry(
                        &appearance,
                        setup,
                        next.camera.zoom(),
                        geometry,
                    )
                    .map_err(ClientPresentationError::from)?;
                    let own = next.own_snake().is_none();
                    if own {
                        let position = snake
                            .body()
                            .points()
                            .first()
                            .map(|point| point.position())
                            .unwrap_or(appearance.absolute_head);
                        next.camera
                            .set_position(position)
                            .map_err(ClientPresentationError::from)?;
                    }
                    for entry in &mut next.entries {
                        if entry.wire_id == Some(appearance.id) {
                            entry.addressed = false;
                        }
                    }
                    next.entries.push(Entry {
                        wire_id: Some(appearance.id),
                        addressed: true,
                        own,
                        drawn: true,
                        snake,
                    });
                    next.check_limits()?;
                }
                PresentationEvent::SnakeMotion {
                    target,
                    heading,
                    wanted_heading,
                    direction,
                    speed_per_32ms,
                } => {
                    if let Some(index) = next.target_index(target) {
                        let entry = &mut next.entries[index];
                        entry
                            .snake
                            .set_motion(heading, wanted_heading, direction, speed_per_32ms)
                            .map_err(ClientPresentationError::from)?;
                        if !entry.own
                            && let Some(wanted) = wanted_heading
                        {
                            entry
                                .snake
                                .set_gaze_heading(wanted)
                                .map_err(ClientPresentationError::from)?;
                        }
                    }
                }
                PresentationEvent::SnakeAnchor {
                    target,
                    absolute_position,
                    direction,
                    grew,
                    fam,
                } => {
                    if let Some(index) = next.target_index(target) {
                        let entry = &mut next.entries[index];
                        let previous = entry.snake.metrics().corrected_head;
                        entry
                            .snake
                            .apply_anchor(
                                absolute_position,
                                direction,
                                if grew { fam } else { None },
                                AnchorView {
                                    zoom: next.camera.zoom(),
                                    extrapolated_distance: 0.,
                                },
                            )
                            .map_err(ClientPresentationError::from)?;
                        if entry.own {
                            next.camera
                                .reanchor(previous, entry.snake.metrics().corrected_head)
                                .map_err(ClientPresentationError::from)?;
                        }
                        next.check_limits()?;
                    }
                }
                PresentationEvent::SnakeMass { id, fam } => {
                    if let Some(index) = next.lookup_index(id) {
                        next.entries[index]
                            .snake
                            .set_mass(fam)
                            .map_err(ClientPresentationError::from)?;
                    }
                }
                PresentationEvent::SnakeTailRemoved { id, fam } => {
                    if let Some(index) = next.lookup_index(id) {
                        next.entries[index]
                            .snake
                            .remove_tail(fam, next.camera.zoom())
                            .map_err(ClientPresentationError::from)?;
                    }
                }
                PresentationEvent::SnakeRemoved { id, died } => {
                    // Removal scans the draw collection in paint order, then
                    // deletes the lookup even if it addressed a newer duplicate.
                    let removed = next
                        .entries
                        .iter()
                        .position(|entry| entry.drawn && entry.wire_id == Some(id));
                    for entry in &mut next.entries {
                        if entry.wire_id == Some(id) {
                            entry.addressed = false;
                        }
                    }
                    if let Some(index) = removed {
                        let entry = &mut next.entries[index];
                        entry.wire_id = None;
                        if died {
                            entry.snake.mark_dead();
                        } else if entry.own {
                            entry.drawn = false;
                        } else {
                            next.entries.remove(index);
                        }
                    }
                }
                PresentationEvent::RadiusTarget(radius) => {
                    if let Some(boundary) = &mut next.boundary {
                        boundary
                            .set_target(radius)
                            .map_err(ClientPresentationError::from)?;
                    }
                    if let Some(setup) = &mut setup {
                        setup.radius = radius;
                    }
                }
            }
        }
        next.received = received;
        *self = next;
        Ok(applied.report)
    }

    /// Advance the boundary and current draw collection, then retire completed deaths.
    /// An undrawn retained own object still accepts packets but stops animating.
    pub fn advance(
        &mut self,
        now_ms: f64,
        lagging: bool,
    ) -> Result<FrameStep, ClientPresentationError> {
        let mut next = self.clone();
        let step = next.clock.advance(now_ms, lagging, false)?;
        if let Some(boundary) = &mut next.boundary {
            boundary.advance(step.whole_steps, next.connected);
        }
        for entry in &mut next.entries {
            if entry.drawn && !entry.snake.advance(step)? {
                entry.drawn = false;
            }
        }
        next.entries.retain(|entry| entry.drawn || entry.own);
        *self = next;
        Ok(step)
    }

    /// Gate boundary consumption without changing clocks, samples or entity animation.
    pub fn set_connected(&mut self, connected: bool) {
        self.connected = connected;
    }

    /// Current connection gate, activated by an accepted setup.
    pub fn connected(&self) -> bool {
        self.connected
    }

    /// Retained boundary state, including across resets before the next setup.
    pub fn boundary(&self) -> Option<&BoundaryRadius> {
        self.boundary.as_ref()
    }

    /// Prepare a default-style numeric draw and discard its paint data.
    /// This commits the same camera, spacing and eye targets as a real draw;
    /// do not call immediately before another preparation for the same draw.
    pub fn prepare_draw(&mut self, width: u32, height: u32) -> Result<(), ClientPresentationError> {
        self.prepare_draw_with_style(width, height, 1., false)?;
        Ok(())
    }

    /// Stage camera/zoom, corrected-anchor culling, spacing and one curve per
    /// visible snake, then commit every eye target together. Outputs retain the
    /// existing oldest-first draw order and original ordinals without resampling.
    /// Invalid style is rejected even for an empty or entirely culled world.
    pub fn prepare_draw_with_style(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<Vec<PreparedSnake>, ClientPresentationError> {
        validate_draw_inputs(width, height, quality_scale)?;
        let mut next = self.clone();
        let prepared =
            next.prepare_draw_with_style_staged(width, height, quality_scale, detailed_style)?;
        *self = next;
        Ok(prepared)
    }

    /// Prepare an already staged client without copying the world again.
    /// The caller must discard this client on any later preparation or drawing
    /// error: this method can leave partial camera, eye, spacing and flag changes.
    pub(crate) fn prepare_draw_with_style_staged(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<Vec<PreparedSnake>, ClientPresentationError> {
        self.prepare_draw_resolved_staged(width, height, quality_scale, |_, _, _| {
            Ok::<_, ClientPresentationError>(detailed_style)
        })
    }

    /// Resolve each visible retained object once, after culling and before its
    /// sampling/flag writes. This client must be a disposable transaction stage.
    pub(crate) fn prepare_draw_resolved_staged<E, F>(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        mut resolve_style: F,
    ) -> Result<Vec<PreparedSnake>, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(usize, bool, &SnakePresentation) -> Result<bool, E>,
    {
        validate_draw_inputs(width, height, quality_scale)?;
        let next = self;
        if let Some(own) = next.own_snake() {
            let metrics = own.metrics();
            next.camera
                .prepare_draw(metrics.corrected_head, metrics.logical_segments as u32)
                .map_err(ClientPresentationError::from)?;
        }
        let camera = next.camera.position();
        let half_width = f64::from(width) / 2. / next.camera.zoom() + 84.;
        let half_height = f64::from(height) / 2. / next.camera.zoom() + 84.;
        let left = camera.x - half_width;
        let right = camera.x + half_width;
        let top = camera.y - half_height;
        let bottom = camera.y + half_height;
        finite(&[left, right, top, bottom]).map_err(ClientPresentationError::from)?;
        for entry in next.entries.iter_mut().filter(|entry| entry.drawn) {
            let visible = entry.snake.body().points().iter().any(|point| {
                let position = point.position();
                let offset = point.position_offset();
                let x = position.x + offset.x;
                let y = position.y + offset.y;
                x >= left && y >= top && x <= right && y <= bottom
            });
            entry.snake.set_visible(visible);
        }
        let mut prepared = Vec::new();
        let mut samples = 0_usize;
        for (draw_ordinal, entry) in next
            .entries
            .iter_mut()
            .filter(|entry| entry.drawn)
            .enumerate()
        {
            let metrics = entry.snake.metrics();
            if !metrics.visible || metrics.expired {
                continue;
            }
            let detailed_style = resolve_style(draw_ordinal, entry.own, &entry.snake)?;
            let (curve, face_heading) = entry
                .snake
                .prepare_curve_staged(quality_scale, detailed_style)
                .map_err(ClientPresentationError::from)?;
            samples = samples
                .checked_add(curve.as_ref().map_or(0, |curve| curve.samples.len()))
                .filter(|count| *count <= MAX_DRAW_SAMPLES)
                .ok_or(ClientPresentationError::Limit)?;
            let body_geometry = curve.as_ref().and_then(|curve| {
                let distance_cursor_seed = curve.distance_cursor_seed()?;
                let samples = curve
                    .samples
                    .iter()
                    .zip(curve.vertices())
                    .enumerate()
                    .map(|(ordinal, (sample, vertex))| {
                        let p = vertex.position;
                        // Cull before Float32 storage. Offscreen ordinals retain
                        // the last write from any preceding snake or draw.
                        if p.x >= left && p.y >= top && p.x <= right && p.y <= bottom {
                            next.body_paint_flags[ordinal] = if !detailed_style || ordinal % 3 == 0
                            {
                                2
                            } else {
                                1
                            };
                        }
                        BodyPaintSample {
                            ordinal,
                            x: sample.x,
                            y: sample.y,
                            tangent: sample.angle,
                            flag: next.body_paint_flags[ordinal],
                        }
                    })
                    .collect();
                Some(PreparedBodyGeometry {
                    samples,
                    distance_cursor_seed,
                })
            });
            prepared.push(PreparedSnake {
                draw_ordinal,
                own: entry.own,
                metrics: entry.snake.metrics(),
                curve,
                body_geometry,
                face_heading,
                pupil: entry.snake.eyes().pupil(),
                eye_geometry: *entry.snake.eye_geometry(),
                face_decoration: entry.snake.face_geometry().decoration,
            });
        }
        Ok(prepared)
    }

    /// Set visual gaze on the retained original own object, including death fade
    /// and retention after expiry. A missing own object is a validated no-op.
    /// This does not depend on transport, wire lookup, or live steering eligibility.
    pub fn set_own_gaze_heading(&mut self, heading: f64) -> Result<(), ClientPresentationError> {
        finite(&[heading])?;
        if let Some(entry) = self.entries.iter_mut().find(|entry| entry.own) {
            entry.snake.set_gaze_heading(heading)?;
        }
        Ok(())
    }

    /// Toggle camera following without advancing its draw clock.
    pub fn set_follows(&mut self, follows: bool) {
        self.camera.set_follows(follows);
    }

    /// Set finite absolute camera coordinates without changing following mode.
    pub fn set_camera_position(&mut self, position: Point) -> Result<(), ClientPresentationError> {
        self.camera.set_position(position)?;
        Ok(())
    }

    /// Set a positive finite zoom; automatic zoom adjustment resumes on the next draw.
    pub fn set_zoom(&mut self, zoom: f64) -> Result<(), ClientPresentationError> {
        self.camera.set_zoom(zoom)?;
        Ok(())
    }

    /// Latest committed received state, including food and protocol caches/counters.
    pub fn received(&self) -> &ClientState {
        &self.received
    }

    /// Read-only draw-driven camera and correction samples.
    pub fn camera(&self) -> &FollowCamera {
        &self.camera
    }

    /// Retained own object, even after lookup removal, draw expiry, or ID reuse.
    pub fn own_snake(&self) -> Option<&SnakePresentation> {
        self.entries
            .iter()
            .find(|entry| entry.own)
            .map(|entry| &entry.snake)
    }

    /// Original own object while it belongs to the draw collection, including death fade.
    pub fn drawn_own_snake(&self) -> Option<&SnakePresentation> {
        self.entries
            .iter()
            .find(|entry| entry.own && entry.drawn)
            .map(|entry| &entry.snake)
    }

    /// Original own object while alive and still in the draw collection.
    /// Input must follow this lifecycle rather than a later reuse of its wire ID.
    pub fn active_own_snake(&self) -> Option<&SnakePresentation> {
        self.drawn_own_snake().filter(|snake| snake.metrics().alive)
    }

    /// Latest addressable appearance for an explicit wire ID.
    pub fn snake(&self, id: u16) -> Option<&SnakePresentation> {
        self.lookup_index(id)
            .map(|index| &self.entries[index].snake)
    }

    /// Current draw collection in update/paint order, including culled snakes.
    pub fn drawn_snakes(&self) -> impl Iterator<Item = &SnakePresentation> {
        self.entries
            .iter()
            .filter(|entry| entry.drawn)
            .map(|entry| &entry.snake)
    }

    /// All retained objects, including the own object after it stops drawing.
    pub fn retained_count(&self) -> usize {
        self.entries.len()
    }

    /// Physical anchors across every retained object, including dying points.
    pub fn retained_body_points(&self) -> usize {
        self.entries
            .iter()
            .map(|entry| entry.snake.body().points().len())
            .sum()
    }
}

#[cfg(test)]
mod resolved_draw_tests {
    use super::*;

    // Original synthetic protocol-19 inputs; no external source or fixture.
    fn u24(v: u32) -> [u8; 3] {
        [(v >> 16) as u8, (v >> 8) as u8, v as u8]
    }

    fn setup() -> Vec<u8> {
        let mut p = vec![b'a'];
        p.extend(u24(1000));
        for v in [430_u16, 100, 20] {
            p.extend(v.to_be_bytes());
        }
        p.push(48);
        for v in [539_u16, 40, 1400, 33, 28, 430] {
            p.extend(v.to_be_bytes());
        }
        p.extend([19, 42]);
        p
    }

    fn spawn(custom: u8, cosmetic: u8) -> Vec<u8> {
        let mut p = vec![b's', 0, 7];
        p.extend(u24(0));
        p.push(48);
        p.extend(u24(0));
        p.extend(4250_u16.to_be_bytes());
        p.extend(u24(0));
        p.push(9);
        p.extend(u24(10_000));
        p.extend(u24(5000));
        p.extend([0, 1, custom, cosmetic]);
        p.extend(u24(7480));
        p.extend(u24(5000));
        for _ in 2..12 {
            p.extend([211, 127]);
        }
        p.extend(0_u16.to_be_bytes());
        p
    }

    fn apply(client: &mut AnimatedClient, p: &[u8]) {
        client.apply_frame(p, ElapsedHeader::Absent).unwrap();
    }

    #[test]
    fn resolved_style_uses_each_retained_appearance_and_preserves_original_own() {
        let mut client = AnimatedClient::new(0.).unwrap();
        for p in [setup(), spawn(3, 11), spawn(8, 19)] {
            apply(&mut client, &p);
        }
        client.advance(40., false).unwrap();
        let mut requests = Vec::new();
        let prepared = client
            .prepare_draw_resolved_staged(960, 540, 1., |ordinal, own, snake| {
                requests.push((
                    ordinal,
                    own,
                    snake.metrics().skin,
                    snake.custom_skin().to_vec(),
                    snake.cosmetic(),
                ));
                Ok::<_, ClientPresentationError>(snake.custom_skin()[0] == 8)
            })
            .unwrap();
        assert_eq!(
            requests,
            [(0, true, 9, vec![3], 11), (1, false, 9, vec![8], 19)]
        );
        assert!(
            prepared[0]
                .body_geometry
                .as_ref()
                .unwrap()
                .samples
                .iter()
                .all(|s| s.flag == 2)
        );
        let detailed = &prepared[1].body_geometry.as_ref().unwrap().samples;
        assert!(detailed.len() > 4);
        for s in detailed {
            assert_eq!(s.flag, if s.ordinal % 3 == 0 { 2 } else { 1 });
        }
        apply(&mut client, &[b's', 0, 7, 0]);
        apply(&mut client, &spawn(27, 31));
        assert_eq!(client.own_snake().unwrap().custom_skin(), [3]);
        let mut requests = Vec::new();
        client
            .prepare_draw_resolved_staged(960, 540, 1., |_, own, snake| {
                requests.push((own, snake.custom_skin().to_vec(), snake.cosmetic()));
                Ok::<_, ClientPresentationError>(false)
            })
            .unwrap();
        assert_eq!(requests, [(false, vec![8], 19), (false, vec![27], 31)]);
    }

    #[test]
    fn uniform_and_resolved_styles_match_and_failed_disposable_stage_does_not_commit() {
        let mut client = AnimatedClient::new(0.).unwrap();
        for p in [setup(), spawn(3, 11), spawn(8, 19)] {
            apply(&mut client, &p);
        }
        client.advance(40., false).unwrap();
        for detailed in [false, true] {
            let mut uniform = client.clone();
            let a = uniform
                .prepare_draw_with_style(960, 540, 1.3, detailed)
                .unwrap();
            let mut resolved = client.clone();
            let b = resolved
                .prepare_draw_resolved_staged(960, 540, 1.3, |_, _, _| {
                    Ok::<_, ClientPresentationError>(detailed)
                })
                .unwrap();
            assert_eq!(a, b);
            assert_eq!(uniform, resolved);
        }
        let saved = client.clone();
        let mut stage = client.clone();
        assert!(
            stage
                .prepare_draw_resolved_staged(960, 540, 1., |ordinal, _, _| {
                    if ordinal == 1 {
                        Err(ClientPresentationError::Limit)
                    } else {
                        Ok(true)
                    }
                })
                .is_err()
        );
        assert_eq!(client, saved);
        assert_ne!(stage, saved);
    }
}
