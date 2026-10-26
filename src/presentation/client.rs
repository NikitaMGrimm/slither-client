//! Atomic received events and bounded animation state, with separate update/draw clocks.

use std::{error::Error, fmt};

use super::{
    AnchorView, FollowCamera, FrameClock, FrameStep, PresentationError, SnakePresentation, finite,
};
use crate::{
    protocol::ElapsedHeader,
    state::{
        ClientState, FrameReport, MAX_SNAKES, MAX_TOTAL_BODY_POINTS, Point, PresentationEvent,
        SnakeTarget, StateError,
    },
};

/// Retained objects, including duplicate appearances, deaths, and an undrawn own object.
pub const MAX_RETAINED_SNAKES: usize = MAX_SNAKES * 2;
/// Aggregate physical anchors, including retained dying body points and undrawn own geometry.
pub const MAX_RETAINED_TOTAL_BODY_POINTS: usize = MAX_TOTAL_BODY_POINTS * 2;

/// A failed received, numeric, or retention transition; the entire client is preserved.
#[derive(Clone, Debug, PartialEq)]
pub enum ClientPresentationError {
    /// Packet framing, validation, received-state policy, or received-state capacity failed.
    State(StateError),
    /// A presentation input or arithmetic result is invalid.
    Presentation(PresentationError),
    /// The retained presentation world would exceed its object or physical-anchor bound.
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

/// Bounded native animation world. No sockets, prediction timestamps, or curve sampling.
///
/// Entries are stored in update/paint order, oldest appearance first. The own
/// object is retained independently of the packet lookup and draw collection.
/// Every fallible public transition preserves received counters/caches, clocks,
/// camera, membership, and all entity channels on failure.
#[derive(Clone, Debug, PartialEq)]
pub struct AnimatedClient {
    received: ClientState,
    clock: FrameClock,
    camera: FollowCamera,
    entries: Vec<Entry>,
}

impl AnimatedClient {
    /// Start an empty received and animation world at an explicit timestamp.
    pub fn new(start_ms: f64) -> Result<Self, ClientPresentationError> {
        Ok(Self {
            received: ClientState::default(),
            clock: FrameClock::new(start_ms)?,
            camera: FollowCamera::default(),
            entries: Vec::new(),
        })
    }

    /// Reset received state, retained objects, view controls, and the animation timeline.
    pub fn reset(&mut self, start_ms: f64) -> Result<(), ClientPresentationError> {
        *self = Self::new(start_ms)?;
        Ok(())
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
    pub fn apply_frame(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
    ) -> Result<FrameReport, ClientPresentationError> {
        let mut received = self.received.clone();
        let applied = received.apply_frame_with_events(bytes, header)?;
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
                        return Err(ClientPresentationError::UnsupportedMode(2));
                    }
                    setup = Some(value);
                    next.entries.clear();
                    next.camera = FollowCamera::default();
                }
                PresentationEvent::SnakeAppearance(appearance) => {
                    let setup = setup.as_ref().ok_or(StateError::MissingSetup)?;
                    let snake =
                        SnakePresentation::from_appearance(&appearance, setup, next.camera.zoom())?;
                    let own = next.own_snake().is_none();
                    if own {
                        let position = snake
                            .body()
                            .points()
                            .first()
                            .map(|point| point.position())
                            .unwrap_or(appearance.absolute_head);
                        next.camera.set_position(position)?;
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
                        next.entries[index].snake.set_motion(
                            heading,
                            wanted_heading,
                            direction,
                            speed_per_32ms,
                        )?;
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
                        entry.snake.apply_anchor(
                            absolute_position,
                            direction,
                            if grew { fam } else { None },
                            AnchorView {
                                zoom: next.camera.zoom(),
                                extrapolated_distance: 0.,
                            },
                        )?;
                        if entry.own {
                            next.camera
                                .reanchor(previous, entry.snake.metrics().corrected_head)?;
                        }
                        next.check_limits()?;
                    }
                }
                PresentationEvent::SnakeMass { id, fam } => {
                    if let Some(index) = next.lookup_index(id) {
                        next.entries[index].snake.set_mass(fam)?;
                    }
                }
                PresentationEvent::SnakeTailRemoved { id, fam } => {
                    if let Some(index) = next.lookup_index(id) {
                        next.entries[index]
                            .snake
                            .remove_tail(fam, next.camera.zoom())?;
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

    /// Advance only the current draw collection, then retire completed deaths.
    /// An undrawn retained own object still accepts packets but stops animating.
    pub fn advance(
        &mut self,
        now_ms: f64,
        lagging: bool,
    ) -> Result<FrameStep, ClientPresentationError> {
        let mut next = self.clone();
        let step = next.clock.advance(now_ms, lagging, false)?;
        for entry in &mut next.entries {
            if entry.drawn && !entry.snake.advance(step)? {
                entry.drawn = false;
            }
        }
        next.entries.retain(|entry| entry.drawn || entry.own);
        *self = next;
        Ok(step)
    }

    /// Prepare one draw: own camera/zoom, inclusive corrected-anchor culling,
    /// then spacing for visible snakes. This does not advance the update clock.
    pub fn prepare_draw(&mut self, width: u32, height: u32) -> Result<(), ClientPresentationError> {
        if width == 0 || height == 0 {
            return Err(PresentationError.into());
        }
        let mut next = self.clone();
        if let Some(own) = next.own_snake() {
            let metrics = own.metrics();
            next.camera
                .prepare_draw(metrics.corrected_head, metrics.logical_segments as u32)?;
        }
        let camera = next.camera.position();
        let half_width = f64::from(width) / 2. / next.camera.zoom() + 84.;
        let half_height = f64::from(height) / 2. / next.camera.zoom() + 84.;
        let left = camera.x - half_width;
        let right = camera.x + half_width;
        let top = camera.y - half_height;
        let bottom = camera.y + half_height;
        finite(&[left, right, top, bottom])?;
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
        for entry in next.entries.iter_mut().filter(|entry| entry.drawn) {
            entry.snake.prepare_draw()?;
        }
        *self = next;
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
