//! Atomic received events and bounded animation state, with separate update/draw clocks.

use std::{collections::BTreeSet, error::Error, fmt};

use super::{
    AnchorView, AntennaCullBounds, AntennaDrawInput, AntennaError, AntennaSnapshot, AntennaState,
    ArenaEdgeView, BodyPaintGeometry, BodyPaintSample, BodyPaintView, BoundaryRadius, CurveOutput,
    FollowCamera, FoodConsume, FoodCullBounds, FoodEaterPose, FoodError, FoodFactory, FoodSpawn,
    FoodWorld, FrameClock, FrameStep, MAX_CURVE_SAMPLES, OrdinaryAntennaGeometry,
    PairedFaceGeometry, PairedSideGeometry, PreparedAntenna, PresentationError, PreyError,
    PreyFactory, PreyWorld, SnakeMetrics, SnakeObjectToken, SnakePresentation, StandardEyeGeometry,
    finite,
};
use crate::{
    protocol::ElapsedHeader,
    state::{
        Appearance, ClientState, FoodSpawnInput, FrameReport, MAX_SNAKES, MAX_TOTAL_BODY_POINTS,
        Point, PresentationEvent, PreySpawnInput, Setup, SnakeTarget, StateError,
    },
};

/// Retained objects, including duplicate appearances, deaths, and an undrawn own object.
pub const MAX_RETAINED_SNAKES: usize = MAX_SNAKES * 2;
/// Aggregate physical anchors, including retained dying body points and undrawn own geometry.
pub const MAX_RETAINED_TOTAL_BODY_POINTS: usize = MAX_TOTAL_BODY_POINTS * 2;
/// Aggregate active curve samples permitted in one prepared numeric draw.
pub const MAX_DRAW_SAMPLES: usize = MAX_RETAINED_TOTAL_BODY_POINTS * 2;

/// Appearance-owned numeric style; borrowed images are resolved only during drawing.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AppearancePresentation {
    /// Complete supported paired face, including optional side images.
    pub face: PairedFaceGeometry,
    /// Explicit ordinary antenna configuration, independent of wire skin identifiers.
    pub antenna: Option<OrdinaryAntennaGeometry>,
}

/// Identity and consumption of one eligible appearance's draw-time random request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AntennaRandomRequest {
    /// Stable appearance identity, retained through duplicate/reused wire IDs.
    pub token: SnakeObjectToken,
    /// Appearance's wire identifier; diagnostic only.
    pub id: u16,
    /// Whether this is the retained original own object.
    pub own: bool,
    /// Index in the current complete draw collection, including culled entries.
    pub draw_ordinal: usize,
    /// Configured chain length, including the root.
    pub node_count: usize,
    /// Exactly one x/y pair for each non-root node.
    pub random_pair_count: usize,
    /// Monotonic numeric draw serial, shared by every appearance in this draw.
    pub draw_serial: u64,
}

/// Remaining aggregate antenna resources for a disposable ingress transaction.
/// Reuse the same budget for every ordered Setup draw; image budgets also charge bulbs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AntennaDrawBudget {
    /// Remaining bulb image commands.
    pub bulbs: usize,
    /// Remaining nonempty paths.
    pub paths: usize,
    /// Remaining stroke commands.
    pub strokes: usize,
    /// Remaining stored outer and inner path vertices.
    pub vertices: usize,
    /// Remaining scalar random units (two per node pair).
    pub random_units: usize,
}

impl Default for AntennaDrawBudget {
    fn default() -> Self {
        Self {
            bulbs: 512,
            paths: 1024,
            strokes: 2048,
            vertices: 11264,
            random_units: 10240,
        }
    }
}

impl AntennaDrawBudget {
    fn charge(
        &mut self,
        prepared: &PreparedAntenna,
        random_units: usize,
    ) -> Result<(), ClientPresentationError> {
        let vertices = prepared
            .outer_path
            .len()
            .checked_add(prepared.inner_path.len())
            .ok_or(ClientPresentationError::Limit)?;
        let paths = usize::from(!prepared.outer_path.is_empty())
            + usize::from(!prepared.inner_path.is_empty());
        *self = Self {
            bulbs: self
                .bulbs
                .checked_sub(usize::from(prepared.bulb.is_some()))
                .ok_or(ClientPresentationError::Limit)?,
            paths: self
                .paths
                .checked_sub(paths)
                .ok_or(ClientPresentationError::Limit)?,
            strokes: self
                .strokes
                .checked_sub(prepared.strokes.len())
                .ok_or(ClientPresentationError::Limit)?,
            vertices: self
                .vertices
                .checked_sub(vertices)
                .ok_or(ClientPresentationError::Limit)?,
            random_units: self
                .random_units
                .checked_sub(random_units)
                .ok_or(ClientPresentationError::Limit)?,
        };
        Ok(())
    }
}

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
    /// Stable appearance identity for coherent draw-time source resolution.
    pub token: SnakeObjectToken,
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
    /// Exact appearance configuration, retained even when its inner gate rejects.
    pub antenna_geometry: Option<OrdinaryAntennaGeometry>,
    /// Numeric commands and death-barrier effect from this draw's single chain visit.
    pub antenna: Option<PreparedAntenna>,
}

/// A failed received, numeric, or retention transition; the entire client is preserved.
#[derive(Clone, Debug, PartialEq)]
pub enum ClientPresentationError {
    /// Antenna configuration, random inputs or numeric preparation failed.
    Antenna(AntennaError),
    /// Full appearance metadata must be enabled before packets or after reset.
    AppearanceModeRequiresReset,
    /// Enabled appearance ownership requires the full resolver for new appearances.
    AppearanceResolverRequired,
    /// A configured drawn antenna requires an explicit draw-time random capability.
    AntennaRandomRequired,
    /// Packet framing, validation, received-state policy, or received-state capacity failed.
    State(StateError),
    /// A presentation input or arithmetic result is invalid.
    Presentation(PresentationError),
    /// Food creation, animation or captured eater invariants failed.
    Food(FoodError),
    /// Enabled food presentation requires creation metadata for every new food.
    FoodFactoryRequired,
    /// Food presentation must start before packets, or immediately after an explicit reset.
    FoodModeRequiresReset,
    /// Prey creation, animation or captured eater invariants failed.
    Prey(PreyError),
    /// Enabled prey presentation requires metadata for every new appearance.
    PreyFactoryRequired,
    /// Prey factories must start before packets or immediately after reset.
    PreyModeRequiresReset,
    /// The presentation world or prepared draw would exceed a retention/sample bound.
    Limit,
    /// Presentation requires an unimplemented mode-specific skin/color ordering.
    UnsupportedMode(u8),
}

impl fmt::Display for ClientPresentationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Antenna(error) => error.fmt(f),
            Self::AppearanceModeRequiresReset => {
                f.write_str("enable full appearance presentation before packets or after reset")
            }
            Self::AppearanceResolverRequired => {
                f.write_str("appearance creation requires a full presentation resolver")
            }
            Self::AntennaRandomRequired => {
                f.write_str("antenna drawing requires an explicit random capability")
            }
            Self::State(error) => error.fmt(f),
            Self::Presentation(error) => error.fmt(f),
            Self::Food(error) => error.fmt(f),
            Self::Prey(error) => error.fmt(f),
            Self::FoodFactoryRequired => f.write_str("food creation requires a factory resolver"),
            Self::FoodModeRequiresReset => {
                f.write_str("enable food presentation before packets or after reset")
            }
            Self::PreyFactoryRequired => f.write_str("prey creation requires a factory resolver"),
            Self::PreyModeRequiresReset => {
                f.write_str("enable prey presentation before packets or after reset")
            }
            Self::Limit => f.write_str("retained presentation capacity exceeded"),
            Self::UnsupportedMode(mode) => write!(f, "unsupported presentation mode {mode}"),
        }
    }
}

impl Error for ClientPresentationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Antenna(error) => Some(error),
            Self::State(error) => Some(error),
            Self::Presentation(error) => Some(error),
            Self::Food(error) => Some(error),
            Self::Prey(error) => Some(error),
            Self::Limit
            | Self::AppearanceModeRequiresReset
            | Self::AppearanceResolverRequired
            | Self::AntennaRandomRequired
            | Self::UnsupportedMode(_)
            | Self::FoodFactoryRequired
            | Self::FoodModeRequiresReset
            | Self::PreyFactoryRequired
            | Self::PreyModeRequiresReset => None,
        }
    }
}

impl From<StateError> for ClientPresentationError {
    fn from(error: StateError) -> Self {
        Self::State(error)
    }
}

impl From<AntennaError> for ClientPresentationError {
    fn from(error: AntennaError) -> Self {
        Self::Antenna(error)
    }
}

impl From<PresentationError> for ClientPresentationError {
    fn from(error: PresentationError) -> Self {
        Self::Presentation(error)
    }
}

impl From<FoodError> for ClientPresentationError {
    fn from(error: FoodError) -> Self {
        Self::Food(error)
    }
}

impl From<PreyError> for ClientPresentationError {
    fn from(error: PreyError) -> Self {
        Self::Prey(error)
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Entry {
    token: SnakeObjectToken,
    // A duplicate keeps its original wire identity for oldest-first removal,
    // while only the newest appearance remains in the packet lookup.
    wire_id: Option<u16>,
    addressed: bool,
    own: bool,
    drawn: bool,
    snake: SnakePresentation,
    antenna: Option<AntennaState>,
}

impl Entry {
    fn eater_pose(&self) -> FoodEaterPose {
        let metrics = self.snake.metrics();
        let offset = self.snake.head_corrections().offset();
        FoodEaterPose {
            head: metrics.raw_head,
            head_offset: Point {
                x: offset[0],
                y: offset[1],
            },
            heading: metrics.heading,
            angle_offset: self.snake.angle_corrections().offset(),
        }
    }
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
    arena_edge_view: ArenaEdgeView,
    connected: bool,
    entries: Vec<Entry>,
    body_paint_flags: Vec<u8>,
    foods: FoodWorld,
    food_bounds: Option<FoodCullBounds>,
    food_enabled: bool,
    preys: PreyWorld,
    prey_enabled: bool,
    last_snake_serial: u64,
    appearance_enabled: bool,
    antenna_bounds: Option<AntennaCullBounds>,
    draw_serial: u64,
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
            arena_edge_view: ArenaEdgeView::default(),
            connected: false,
            entries: Vec::new(),
            body_paint_flags: vec![0; MAX_CURVE_SAMPLES],
            foods: FoodWorld::new(),
            food_bounds: None,
            food_enabled: false,
            preys: PreyWorld::new(),
            prey_enabled: false,
            last_snake_serial: 0,
            appearance_enabled: false,
            antenna_bounds: None,
            draw_serial: 0,
        })
    }

    /// Clear the world and draw corrections, and restore the lag multiplier to one.
    /// Preserve the clock's timestamp and both accumulated phases, boundary and arena-edge view state,
    /// camera position, caller follow preference and shared body-painter flag history. Use `new`
    /// to start a fresh timeline.
    pub fn reset(&mut self) {
        self.received = ClientState::default();
        self.clock.reset_lag();
        self.reset_camera();
        self.connected = false;
        self.entries.clear();
        self.foods.clear();
        self.preys.clear();
    }

    fn reset_camera(&mut self) {
        self.camera.reset_world();
    }

    fn retire_entries(&mut self) {
        let referenced: BTreeSet<_> = self
            .foods
            .referenced_tokens()
            .chain(self.preys.referenced_eaters())
            .collect();
        self.entries
            .retain(|entry| entry.drawn || entry.own || referenced.contains(&entry.token));
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
    /// Setup updates configuration without clearing the world, camera or fractional clock.
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
        resolve: F,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<PairedFaceGeometry, E>,
    {
        self.apply_frame_resolved(
            bytes,
            header,
            resolve,
            |_, _| Ok(None),
            false,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Apply ordered appearances and food creations with explicit factory inputs.
    /// Start this path before any packets or after reset. Once enabled, other apply
    /// APIs reject food creation instead of silently dropping animation. Resolvers
    /// run after complete received validation; their side effects cannot roll back.
    pub fn apply_frame_with_factories<E, F, G>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve_face: F,
        mut resolve_food: G,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<PairedFaceGeometry, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
    {
        self.apply_frame_resolved(
            bytes,
            header,
            resolve_face,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Plan each Setup draw in event order on the disposable transaction stage.
    /// Received validation precedes all callbacks; any error discards the stage.
    #[cfg(any(target_arch = "wasm32", test))]
    pub(crate) fn apply_frame_with_factories_and_setup<E, F, G, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve_face: F,
        mut resolve_food: G,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<PairedFaceGeometry, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_resolved(
            bytes,
            header,
            resolve_face,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |_, _| Ok(None),
            false,
            on_setup,
        )
    }

    /// Retain food and prey factories in the same ordered packet transaction.
    /// All wire validation precedes callbacks. Reset preserves mode enablement,
    /// but clears instances and permits replacing caller-owned factory sources.
    pub fn apply_frame_with_all_factories<E, F, G, P>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve_face: F,
        mut resolve_food: G,
        mut resolve_prey: P,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<PairedFaceGeometry, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
    {
        self.apply_frame_resolved(
            bytes,
            header,
            resolve_face,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            |_, _| Ok(()),
        )
    }

    /// Include every prey transition in event-time Setup draw planning.
    #[cfg(any(target_arch = "wasm32", test))]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn apply_frame_with_all_factories_and_setup<E, F, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve_face: F,
        mut resolve_food: G,
        mut resolve_prey: P,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<PairedFaceGeometry, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_resolved(
            bytes,
            header,
            resolve_face,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            on_setup,
        )
    }

    /// Resolve complete appearance metadata once in wire order, before its first update.
    /// Start before packets or after reset; enabled sessions require this resolver
    /// for later appearances. Callback effects remain external to model rollback.
    pub fn apply_frame_with_appearance<E, F>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<AppearancePresentation, E>,
    {
        self.apply_frame_appearance_resolved(
            bytes,
            header,
            resolve,
            true,
            |_, _| Ok(None),
            false,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Install full appearances and food factories in the same atomic event transaction.
    pub fn apply_frame_with_appearance_and_factories<E, F, G>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<AppearancePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
    {
        self.apply_frame_appearance_resolved(
            bytes,
            header,
            resolve,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Install full appearances and both creation factories in wire order.
    pub fn apply_frame_with_appearance_and_all_factories<E, F, G, P>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        mut resolve_prey: P,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<AppearancePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
    {
        self.apply_frame_appearance_resolved(
            bytes,
            header,
            resolve,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            |_, _| Ok(()),
        )
    }

    /// Plan event-time Setup draws with full appearances and food factories.
    #[cfg(any(target_arch = "wasm32", test))]
    pub(crate) fn apply_frame_with_appearance_and_factories_and_setup<E, F, G, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<AppearancePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_appearance_resolved(
            bytes,
            header,
            resolve,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |_, _| Ok(None),
            false,
            on_setup,
        )
    }

    /// Plan every ordered Setup with the complete appearance, food and prey transaction.
    #[cfg(any(target_arch = "wasm32", test))]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn apply_frame_with_appearance_and_all_factories_and_setup<E, F, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        mut resolve_prey: P,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<AppearancePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_appearance_resolved(
            bytes,
            header,
            resolve,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            on_setup,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_frame_resolved<E, F, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        mut resolve: F,
        resolve_food: G,
        enable_food: bool,
        resolve_prey: P,
        enable_prey: bool,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<PairedFaceGeometry, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<Option<FoodFactory>, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<Option<PreyFactory>, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_appearance_resolved(
            bytes,
            header,
            |appearance| {
                Ok(AppearancePresentation {
                    face: resolve(appearance)?,
                    antenna: None,
                })
            },
            false,
            resolve_food,
            enable_food,
            resolve_prey,
            enable_prey,
            on_setup,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_frame_appearance_resolved<E, F, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        mut resolve: F,
        enable_appearance: bool,
        mut resolve_food: G,
        enable_food: bool,
        mut resolve_prey: P,
        enable_prey: bool,
        mut on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<AppearancePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<Option<FoodFactory>, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<Option<PreyFactory>, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        let mut received = self.received.clone();
        let applied = received
            .apply_frame_with_events(bytes, header)
            .map_err(ClientPresentationError::from)?;
        if enable_appearance && !self.appearance_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::AppearanceModeRequiresReset.into());
        }
        if enable_food && !self.food_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::FoodModeRequiresReset.into());
        }
        if enable_prey && !self.prey_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::PreyModeRequiresReset.into());
        }
        if applied.events.is_empty() {
            self.received = received;
            self.food_enabled |= enable_food;
            self.prey_enabled |= enable_prey;
            self.appearance_enabled |= enable_appearance;
            return Ok(applied.report);
        }
        let mut next = self.clone();
        next.food_enabled |= enable_food;
        next.prey_enabled |= enable_prey;
        next.appearance_enabled |= enable_appearance;
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
                    for entry in &mut next.entries {
                        entry
                            .snake
                            .apply_setup(&value)
                            .map_err(ClientPresentationError::from)?;
                    }
                    // Received state commits after all callbacks; draws need this event's center.
                    next.arena_edge_view
                        .set_center(value.grid_center)
                        .map_err(ClientPresentationError::from)?;
                    next.connected = true;
                    on_setup(&mut next, setup.insert(value))?;
                }
                PresentationEvent::SnakeAppearance(appearance) => {
                    if next.appearance_enabled && !enable_appearance {
                        return Err(ClientPresentationError::AppearanceResolverRequired.into());
                    }
                    let setup = setup
                        .as_ref()
                        .ok_or(StateError::MissingSetup)
                        .map_err(ClientPresentationError::from)?;
                    let geometry = resolve(&appearance)?;
                    let snake = SnakePresentation::from_appearance_with_face_geometry(
                        &appearance,
                        setup,
                        next.camera.zoom(),
                        geometry.face,
                    )
                    .map_err(ClientPresentationError::from)?;
                    let antenna = geometry
                        .antenna
                        .map(|geometry| {
                            AntennaState::from_appearance(geometry, appearance.absolute_head)
                        })
                        .transpose()
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
                    next.last_snake_serial = next
                        .last_snake_serial
                        .checked_add(1)
                        .ok_or(ClientPresentationError::Limit)?;
                    next.entries.push(Entry {
                        token: SnakeObjectToken::new(next.last_snake_serial)
                            .map_err(ClientPresentationError::from)?,
                        wire_id: Some(appearance.id),
                        addressed: true,
                        own,
                        drawn: true,
                        snake,
                        antenna,
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
                        } else {
                            entry.drawn = false;
                        }
                    }
                    next.retire_entries();
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
                PresentationEvent::FoodSpawn(spawn) => {
                    if let Some(factory) = resolve_food(&spawn, next.camera.zoom())? {
                        next.foods
                            .spawn(
                                FoodSpawn {
                                    key: spawn.key,
                                    sector: spawn.sector,
                                    position: spawn.absolute_position,
                                    base_size: spawn.base_size,
                                    raw_color: spawn.raw_color,
                                    rapid: spawn.rapid,
                                },
                                factory.input(next.camera.zoom()),
                            )
                            .map_err(ClientPresentationError::from)?;
                    } else if next.food_enabled {
                        return Err(ClientPresentationError::FoodFactoryRequired.into());
                    }
                }
                PresentationEvent::FoodConsume { key, eater_id } => {
                    if next.food_enabled {
                        let consume = match eater_id {
                            None => FoodConsume::Immediate,
                            Some(id) => FoodConsume::Eaten(
                                next.lookup_index(id).map(|i| next.entries[i].token),
                            ),
                        };
                        next.foods.consume(key, consume);
                        next.retire_entries();
                    }
                }
                PresentationEvent::FoodSectorClear { sector } => {
                    next.foods.clear_sector(sector);
                    next.retire_entries();
                }
                PresentationEvent::PreySpawn(spawn) => {
                    if let Some(factory) = resolve_prey(&spawn, next.camera.zoom())? {
                        next.preys
                            .spawn(spawn, factory.input(next.camera.zoom()))
                            .map_err(ClientPresentationError::from)?;
                    } else if next.prey_enabled {
                        return Err(ClientPresentationError::PreyFactoryRequired.into());
                    }
                }
                PresentationEvent::PreyMotion(motion) => {
                    if next.prey_enabled {
                        next.preys
                            .motion(motion, next.clock.lag_multiplier)
                            .map_err(ClientPresentationError::from)?;
                    }
                }
                PresentationEvent::PreyRemoved { id } => {
                    next.preys.remove(id);
                    next.retire_entries();
                }
                PresentationEvent::PreyEaten { id, eater_id } => {
                    if next.prey_enabled {
                        let eater = next.lookup_index(eater_id).map(|i| next.entries[i].token);
                        next.preys.consume(id, eater);
                        next.retire_entries();
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
        let entries = &next.entries;
        let prey_turn_rate = next.received.setup.as_ref().map_or(0., |s| s.mamu2);
        next.preys.advance(step, prey_turn_rate, |token| {
            entries
                .iter()
                .find(|entry| entry.token == token)
                .map(Entry::eater_pose)
                .ok_or(PreyError::MissingEater(token))
        })?;
        next.foods.advance(step, |token| {
            entries
                .iter()
                .find(|entry| entry.token == token)
                .map(Entry::eater_pose)
                .ok_or(FoodError::MissingEater(token))
        })?;
        next.retire_entries();
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

    /// Copied event-time arena center and retained own-draw camera polar coordinates.
    /// Reset and no-own draws preserve the angle and distance.
    pub fn arena_edge_view(&self) -> ArenaEdgeView {
        self.arena_edge_view
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

    /// Prepare one numeric draw with explicit ordered antenna randomness.
    /// This consumes the same camera, spacing and eye transition as rendering;
    /// do not prepare again for the same draw. Callback effects cannot roll back.
    pub fn prepare_draw_with_antenna<E, R>(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        detailed_style: bool,
        resolve_random: R,
    ) -> Result<Vec<PreparedSnake>, E>
    where
        E: From<ClientPresentationError>,
        R: FnMut(AntennaRandomRequest) -> Result<Vec<[f64; 2]>, E>,
    {
        let mut next = self.clone();
        let prepared = next.prepare_draw_resolved_with_antenna_limited_staged(
            width,
            height,
            quality_scale,
            MAX_DRAW_SAMPLES,
            &mut AntennaDrawBudget::default(),
            |_, _, _| Ok(detailed_style),
            resolve_random,
        )?;
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
        resolve_style: F,
    ) -> Result<Vec<PreparedSnake>, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(usize, bool, &SnakePresentation) -> Result<bool, E>,
    {
        self.prepare_draw_resolved_limited_staged(
            width,
            height,
            quality_scale,
            MAX_DRAW_SAMPLES,
            resolve_style,
        )
    }

    /// Prepare on a disposable stage with the caller's remaining aggregate sample budget.
    /// Zero permits empty/face-only draws; only actual curve samples spend the budget.
    pub(crate) fn prepare_draw_resolved_limited_staged<E, F>(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        sample_limit: usize,
        resolve_style: F,
    ) -> Result<Vec<PreparedSnake>, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(usize, bool, &SnakePresentation) -> Result<bool, E>,
    {
        self.prepare_draw_antenna_resolved_staged(
            width,
            height,
            quality_scale,
            sample_limit,
            &mut AntennaDrawBudget::default(),
            resolve_style,
            None::<fn(AntennaRandomRequest) -> Result<Vec<[f64; 2]>, E>>,
        )
    }

    /// Prepare once on a disposable stage with aggregate sample and antenna limits.
    /// The caller must discard both client and budget after any later failure.
    /// Share this budget across all ordered Setup plans in the same ingress.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_draw_resolved_with_antenna_limited_staged<E, F, R>(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        sample_limit: usize,
        antenna_budget: &mut AntennaDrawBudget,
        resolve_style: F,
        resolve_random: R,
    ) -> Result<Vec<PreparedSnake>, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(usize, bool, &SnakePresentation) -> Result<bool, E>,
        R: FnMut(AntennaRandomRequest) -> Result<Vec<[f64; 2]>, E>,
    {
        self.prepare_draw_antenna_resolved_staged(
            width,
            height,
            quality_scale,
            sample_limit,
            antenna_budget,
            resolve_style,
            Some(resolve_random),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_draw_antenna_resolved_staged<E, F, R>(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        sample_limit: usize,
        antenna_budget: &mut AntennaDrawBudget,
        mut resolve_style: F,
        mut resolve_random: Option<R>,
    ) -> Result<Vec<PreparedSnake>, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(usize, bool, &SnakePresentation) -> Result<bool, E>,
        R: FnMut(AntennaRandomRequest) -> Result<Vec<[f64; 2]>, E>,
    {
        validate_draw_inputs(width, height, quality_scale)?;
        if resolve_random.is_none()
            && self
                .entries
                .iter()
                .any(|entry| entry.drawn && entry.antenna.is_some())
        {
            return Err(ClientPresentationError::AntennaRandomRequired.into());
        }
        let sample_limit = sample_limit.min(MAX_DRAW_SAMPLES);
        let next = self;
        next.draw_serial = next
            .draw_serial
            .checked_add(1)
            .ok_or(ClientPresentationError::Limit)?;
        if let Some(own) = next.own_snake() {
            let metrics = own.metrics();
            next.camera
                .prepare_draw(metrics.corrected_head, metrics.logical_segments as u32)
                .map_err(ClientPresentationError::from)?;
            next.arena_edge_view
                .prepare_draw(next.camera.position())
                .map_err(ClientPresentationError::from)?;
            next.food_bounds = Some(
                FoodCullBounds::from_view(BodyPaintView {
                    camera: next.camera.position(),
                    zoom: next.camera.zoom(),
                    half_width: f64::from(width) / 2.,
                    half_height: f64::from(height) / 2.,
                })
                .map_err(|_| ClientPresentationError::Presentation(PresentationError))?,
            );
            next.antenna_bounds = Some(
                AntennaCullBounds::from_view(BodyPaintView {
                    camera: next.camera.position(),
                    zoom: next.camera.zoom(),
                    half_width: f64::from(width) / 2.,
                    half_height: f64::from(height) / 2.,
                })
                .map_err(ClientPresentationError::from)?,
            );
        }
        let camera = next.camera.position();
        let antenna_view = BodyPaintView {
            camera,
            zoom: next.camera.zoom(),
            half_width: f64::from(width) / 2.,
            half_height: f64::from(height) / 2.,
        };
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
                .filter(|count| *count <= sample_limit)
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
            let antenna_geometry = entry.antenna.as_ref().map(AntennaState::geometry);
            let antenna = if let Some(state) = &entry.antenna {
                let metrics = entry.snake.metrics();
                let request = state
                    .prepare_draw(AntennaDrawInput {
                        raw_heading: metrics.heading,
                        corrected_head: metrics.corrected_head,
                        scale: metrics.scale,
                        spawn: metrics.spawn_progress,
                        death: metrics.death_progress,
                        active_curve_count: curve.as_ref().map_or(0, |curve| curve.samples.len()),
                        whole_snake_visible: metrics.visible,
                        view: antenna_view,
                        bounds: next.antenna_bounds,
                    })
                    .map_err(ClientPresentationError::from)?;
                let pair_count = request.random_pair_count();
                let random_units = pair_count
                    .checked_mul(2)
                    .filter(|count| *count <= antenna_budget.random_units)
                    .ok_or(ClientPresentationError::Limit)?;
                let pairs = if pair_count == 0 {
                    Vec::new()
                } else {
                    let callback = resolve_random
                        .as_mut()
                        .ok_or(ClientPresentationError::AntennaRandomRequired)?;
                    callback(AntennaRandomRequest {
                        token: entry.token,
                        id: metrics.id,
                        own: entry.own,
                        draw_ordinal,
                        node_count: state.geometry().nodes,
                        random_pair_count: pair_count,
                        draw_serial: next.draw_serial,
                    })?
                };
                let (state, commands) = request
                    .finish(&pairs)
                    .map_err(ClientPresentationError::from)?;
                antenna_budget.charge(&commands, random_units)?;
                entry.antenna = Some(state);
                Some(commands)
            } else {
                None
            };
            prepared.push(PreparedSnake {
                token: entry.token,
                draw_ordinal,
                own: entry.own,
                metrics: entry.snake.metrics(),
                curve,
                body_geometry,
                face_heading,
                pupil: entry.snake.eyes().pupil(),
                eye_geometry: *entry.snake.eye_geometry(),
                face_decoration: entry.snake.face_geometry().decoration,
                antenna_geometry,
                antenna,
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

    /// Retained food instances in dense insertion/swap order, including flights.
    pub fn foods(&self) -> &FoodWorld {
        &self.foods
    }

    /// Retained inclusive food cull bounds; initialized only by an own-object draw.
    pub fn food_bounds(&self) -> Option<FoodCullBounds> {
        self.food_bounds
    }

    /// Whether explicit factory ownership is enabled for this session.
    pub fn food_enabled(&self) -> bool {
        self.food_enabled
    }

    /// Insertion-ordered prey appearances, including active capture flights.
    pub fn preys(&self) -> &PreyWorld {
        &self.preys
    }

    /// Whether every prey appearance requires a retained creation factory.
    pub fn prey_enabled(&self) -> bool {
        self.prey_enabled
    }

    /// Whether new appearances require the complete numeric presentation resolver.
    pub fn appearance_enabled(&self) -> bool {
        self.appearance_enabled
    }

    /// Retained 210-unit root-culling bounds, refreshed only by retained-own draws.
    pub fn antenna_bounds(&self) -> Option<AntennaCullBounds> {
        self.antenna_bounds
    }

    /// Successful numeric draw serial; reset retains the draw timeline.
    pub fn draw_serial(&self) -> u64 {
        self.draw_serial
    }

    /// Copy all retained antenna channels without advancing any draw or update.
    pub fn antenna_snapshot(&self, token: SnakeObjectToken) -> Option<AntennaSnapshot> {
        self.entries
            .iter()
            .find(|entry| entry.token == token)
            .and_then(|entry| entry.antenna.as_ref())
            .map(AntennaState::snapshot)
    }

    /// Copy retained configuration without allocating any channel snapshots.
    pub fn antenna_geometry(&self, token: SnakeObjectToken) -> Option<OrdinaryAntennaGeometry> {
        self.entries
            .iter()
            .find(|entry| entry.token == token)
            .and_then(|entry| entry.antenna.as_ref())
            .map(AntennaState::geometry)
    }

    /// Stable identities, own/draw membership and read-only snakes in retained order.
    /// The tuple is (token, own, drawn, snake), including undrawn retained own objects.
    pub fn snake_objects(
        &self,
    ) -> impl Iterator<Item = (SnakeObjectToken, bool, bool, &SnakePresentation)> {
        self.entries
            .iter()
            .map(|entry| (entry.token, entry.own, entry.drawn, &entry.snake))
    }

    /// Stable identity of the retained original own object.
    pub fn own_token(&self) -> Option<SnakeObjectToken> {
        self.entries
            .iter()
            .find(|entry| entry.own)
            .map(|entry| entry.token)
    }

    /// Address a captured object independently of wire-ID reuse or draw membership.
    pub fn snake_object(&self, token: SnakeObjectToken) -> Option<&SnakePresentation> {
        self.entries
            .iter()
            .find(|entry| entry.token == token)
            .map(|entry| &entry.snake)
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
    use crate::presentation::{BodyAsset, BodyAssetStatus, FoodSource, food_palette};
    use std::{cell::RefCell, rc::Rc};

    fn antenna_style() -> AppearancePresentation {
        AppearancePresentation {
            face: PairedFaceGeometry::default(),
            antenna: Some(OrdinaryAntennaGeometry {
                nodes: 9,
                outer_color: 0x123456,
                inner_color: 0xabcdef,
                inner_opacity: 0.4,
                repeated_inner_strokes: true,
                rotate_bulb: true,
                bulb: super::super::AntennaBulbGeometry {
                    offset_x: -7.,
                    offset_y: -9.,
                    width: 21.,
                    height: 25.,
                    scale: 0.75,
                    opacity: 0.8,
                },
            }),
        }
    }

    fn antenna_client() -> AnimatedClient {
        let mut client = AnimatedClient::new(0.).unwrap();
        client
            .apply_frame_with_appearance_and_factories::<ClientPresentationError, _, _>(
                &bundle(&[setup(), spawn(3, 11)]),
                ElapsedHeader::Absent,
                |_| Ok(antenna_style()),
                factory,
            )
            .unwrap();
        client
    }

    #[test]
    fn antenna_setup_draws_match_ordered_controls_and_later_failure_rolls_back_chains() {
        let mut client = antenna_client();
        let before = client.clone();
        let mut second = spawn(8, 19);
        second[1..3].copy_from_slice(&8_u16.to_be_bytes());
        let commands = [setup(), second, setup(), setup()];
        let mut seen = Vec::new();
        let mut states = Vec::new();
        let mut budget = AntennaDrawBudget::default();
        client
            .apply_frame_with_appearance_and_factories_and_setup(
                &bundle(&commands),
                ElapsedHeader::Absent,
                |_| Ok(antenna_style()),
                factory,
                |stage, _| {
                    stage.prepare_draw_resolved_with_antenna_limited_staged(
                        960,
                        540,
                        1.,
                        MAX_DRAW_SAMPLES,
                        &mut budget,
                        |_, _, _| Ok(false),
                        |r| {
                            seen.push(r);
                            Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count])
                        },
                    )?;
                    states.push(stage.clone());
                    Ok::<_, ClientPresentationError>(())
                },
            )
            .unwrap();
        assert_eq!(
            seen.iter()
                .map(|r| (r.id, r.draw_serial))
                .collect::<Vec<_>>(),
            [(7, 1), (7, 2), (8, 2), (7, 3), (8, 3)]
        );
        let mut control = before.clone();
        let mut draw_index = 0;
        for command in &commands {
            control
                .apply_frame_with_appearance_and_factories::<ClientPresentationError, _, _>(
                    command,
                    ElapsedHeader::Absent,
                    |_| Ok(antenna_style()),
                    factory,
                )
                .unwrap();
            if command[0] == b'a' {
                control
                    .prepare_draw_with_antenna(960, 540, 1., false, |r| {
                        Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count])
                    })
                    .unwrap();
                let staged = &states[draw_index];
                assert_eq!(staged.camera, control.camera);
                assert_eq!(staged.entries, control.entries);
                assert_eq!(staged.antenna_bounds, control.antenna_bounds);
                assert_eq!(staged.draw_serial, control.draw_serial);
                draw_index += 1;
            }
        }
        for fail_draw in [1, 2, 3] {
            let mut rejected = before.clone();
            let mut calls = 0;
            let mut hooks = 0;
            let mut budget = AntennaDrawBudget::default();
            let result = rejected.apply_frame_with_appearance_and_factories_and_setup(
                &bundle(&commands),
                ElapsedHeader::Absent,
                |_| Ok(antenna_style()),
                factory,
                |stage, _| {
                    hooks += 1;
                    stage.prepare_draw_resolved_with_antenna_limited_staged(
                        960,
                        540,
                        1.,
                        MAX_DRAW_SAMPLES,
                        &mut budget,
                        |_, _, _| Ok(false),
                        |r| {
                            calls += 1;
                            Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count])
                        },
                    )?;
                    if hooks == fail_draw {
                        Err(ClientPresentationError::Limit)
                    } else {
                        Ok(())
                    }
                },
            );
            assert_eq!(result, Err(ClientPresentationError::Limit));
            assert!(calls > 0);
            assert!(
                rejected == before,
                "rollback includes every prior chain and draw serial"
            );
        }
    }

    #[test]
    fn antenna_shared_limits_charge_actual_paths_and_reject_before_or_after_rng_atomically() {
        let client = antenna_client();
        let mut measured = client.clone();
        let mut used = AntennaDrawBudget::default();
        let output = measured
            .prepare_draw_resolved_with_antenna_limited_staged(
                960,
                540,
                1.,
                MAX_DRAW_SAMPLES,
                &mut used,
                |_, _, _| Ok(false),
                |r| Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count]),
            )
            .unwrap();
        let antenna = output[0].antenna.as_ref().unwrap();
        assert_eq!(used.bulbs, 511);
        assert_eq!(used.paths, 1022);
        assert_eq!(used.strokes, 2044);
        assert_eq!(
            used.vertices,
            11264 - antenna.outer_path.len() - antenna.inner_path.len()
        );
        assert_eq!(used.random_units, 10224);
        let vertices = antenna.outer_path.len() + antenna.inner_path.len();
        for index in 0..6 {
            let mut rejected = client.clone();
            let mut budget = AntennaDrawBudget::default();
            let sample_limit = if index == 5 { 0 } else { MAX_DRAW_SAMPLES };
            match index {
                0 => budget.bulbs = 0,
                1 => budget.paths = 1,
                2 => budget.strokes = 3,
                3 => budget.vertices = vertices - 1,
                4 => budget.random_units = 15,
                _ => (),
            }
            let mut random_calls = 0;
            let result = rejected.apply_frame_with_appearance_and_factories_and_setup(
                &setup(),
                ElapsedHeader::Absent,
                |_| Ok(antenna_style()),
                factory,
                |stage, _| {
                    stage.prepare_draw_resolved_with_antenna_limited_staged(
                        960,
                        540,
                        1.,
                        sample_limit,
                        &mut budget,
                        |_, _, _| Ok(false),
                        |r| {
                            random_calls += 1;
                            Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count])
                        },
                    )?;
                    Ok::<_, ClientPresentationError>(())
                },
            );
            assert_eq!(result, Err(ClientPresentationError::Limit));
            assert_eq!(random_calls, usize::from(index < 4));
            assert!(
                rejected == client,
                "resource failure {index} must roll back the entire ingress"
            );
        }
    }

    #[test]
    fn antenna_late_style_callback_failure_rolls_back_an_earlier_chain_step() {
        let mut client = antenna_client();
        client
            .apply_frame_with_appearance_and_factories::<ClientPresentationError, _, _>(
                &spawn(8, 19),
                ElapsedHeader::Absent,
                |_| Ok(antenna_style()),
                factory,
            )
            .unwrap();
        let before = client.clone();
        let mut budget = AntennaDrawBudget::default();
        let mut random_calls = 0;
        let result = client.apply_frame_with_appearance_and_factories_and_setup(
            &setup(),
            ElapsedHeader::Absent,
            |_| Ok(antenna_style()),
            factory,
            |stage, _| {
                stage.prepare_draw_resolved_with_antenna_limited_staged(
                    960,
                    540,
                    1.,
                    MAX_DRAW_SAMPLES,
                    &mut budget,
                    |ordinal, _, _| {
                        if ordinal == 1 {
                            Err(ClientPresentationError::Limit)
                        } else {
                            Ok(false)
                        }
                    },
                    |r| {
                        random_calls += 1;
                        Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count])
                    },
                )?;
                Ok::<_, ClientPresentationError>(())
            },
        );
        assert_eq!(result, Err(ClientPresentationError::Limit));
        assert_eq!(random_calls, 1);
        assert!(client == before);
    }

    #[test]
    fn antenna_budget_is_shared_across_sixty_four_setup_plans_and_final_draw() {
        let mut client = antenna_client();
        let spawns: Vec<_> = (8_u16..15)
            .map(|id| {
                let mut snake = spawn(3, 11);
                snake[1..3].copy_from_slice(&id.to_be_bytes());
                snake
            })
            .collect();
        client
            .apply_frame_with_appearance_and_factories::<ClientPresentationError, _, _>(
                &bundle(&spawns),
                ElapsedHeader::Absent,
                |_| Ok(antenna_style()),
                factory,
            )
            .unwrap();
        let before = client.clone();
        let mut budget = AntennaDrawBudget::default();
        let mut hooks = 0;
        let mut calls = 0;
        client
            .apply_frame_with_appearance_and_factories_and_setup(
                &bundle(&vec![setup(); 64]),
                ElapsedHeader::Absent,
                |_| Ok(antenna_style()),
                factory,
                |stage, _| {
                    hooks += 1;
                    stage.prepare_draw_resolved_with_antenna_limited_staged(
                        960,
                        540,
                        1.,
                        MAX_DRAW_SAMPLES,
                        &mut budget,
                        |_, _, _| Ok(false),
                        |r| {
                            calls += 1;
                            Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count])
                        },
                    )?;
                    Ok::<_, ClientPresentationError>(())
                },
            )
            .unwrap();
        assert_eq!(hooks, 64);
        assert_eq!(calls, 512);
        assert_eq!(budget.bulbs, 0);
        assert_eq!(budget.paths, 0);
        assert_eq!(budget.strokes, 0);
        let mut rejected = before.clone();
        let mut budget = AntennaDrawBudget::default();
        let mut hooks = 0;
        let result = rejected.apply_frame_with_appearance_and_factories_and_setup(
            &bundle(&vec![setup(); 64]),
            ElapsedHeader::Absent,
            |_| Ok(antenna_style()),
            factory,
            |stage, _| {
                hooks += 1;
                for _ in 0..if hooks == 64 { 2 } else { 1 } {
                    stage.prepare_draw_resolved_with_antenna_limited_staged(
                        960,
                        540,
                        1.,
                        MAX_DRAW_SAMPLES,
                        &mut budget,
                        |_, _, _| Ok(false),
                        |r| Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count]),
                    )?;
                }
                Ok::<_, ClientPresentationError>(())
            },
        );
        assert_eq!(result, Err(ClientPresentationError::Limit));
        assert!(rejected == before);
    }

    #[test]
    fn antenna_full_factory_setup_preserves_every_mode_and_resolver_order() {
        let mut client = AnimatedClient::new(0.).unwrap();
        let mut prey = vec![b'y', 0, 1, 9];
        prey.extend(u24(10_000));
        prey.extend(u24(5000));
        prey.extend([20, b'0']);
        prey.extend(u24(0));
        prey.extend(u24(0));
        prey.extend(1000_u16.to_be_bytes());
        let order = RefCell::new(Vec::new());
        let mut budget = AntennaDrawBudget::default();
        client
            .apply_frame_with_appearance_and_all_factories_and_setup(
                &bundle(&[
                    setup(),
                    spawn(3, 11),
                    vec![b'f', 1, 2, 3, 4, 7, 25],
                    prey,
                    setup(),
                ]),
                ElapsedHeader::Absent,
                |_| {
                    order.borrow_mut().push("appearance");
                    Ok(antenna_style())
                },
                |spawn, zoom| {
                    order.borrow_mut().push("food");
                    factory(spawn, zoom)
                },
                |_, _| {
                    order.borrow_mut().push("prey");
                    let source = FoodSource::new(
                        BodyAsset {
                            handle: 100,
                            revision: 1,
                            width: 20,
                            height: 16,
                            status: BodyAssetStatus::Ready,
                        },
                        20.,
                        16.,
                        10.,
                        8.,
                    )
                    .unwrap();
                    Ok::<_, ClientPresentationError>(PreyFactory {
                        random_phase_unit: 0.2,
                        random_rate_unit: 0.8,
                        palette: 0,
                        bodies: vec![source],
                        glows: vec![source],
                    })
                },
                |stage, _| {
                    order.borrow_mut().push("setup");
                    stage.prepare_draw_resolved_with_antenna_limited_staged(
                        960,
                        540,
                        1.,
                        MAX_DRAW_SAMPLES,
                        &mut budget,
                        |_, _, _| Ok(false),
                        |r| {
                            order.borrow_mut().push("random");
                            Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count])
                        },
                    )?;
                    Ok::<_, ClientPresentationError>(())
                },
            )
            .unwrap();
        assert!(client.food_enabled() && client.prey_enabled() && client.appearance_enabled());
        assert_eq!(
            *order.borrow(),
            ["setup", "appearance", "food", "prey", "setup", "random"]
        );
    }

    #[test]
    fn all_factories_setup_hook_is_ordered_and_rolls_back_enablement() {
        let mut client = AnimatedClient::new(0.).unwrap();
        let before = client.clone();
        let bytes = bundle(&[setup(), setup()]);
        let mut calls = 0;
        let result = client
            .apply_frame_with_all_factories_and_setup::<ClientPresentationError, _, _, _, _>(
                &bytes,
                ElapsedHeader::Absent,
                |_| Ok(PairedFaceGeometry::default()),
                |_, _| Err(ClientPresentationError::FoodFactoryRequired),
                |_, _| Err(ClientPresentationError::PreyFactoryRequired),
                |stage, _| {
                    calls += 1;
                    assert!(stage.prey_enabled());
                    assert!(stage.food_enabled());
                    if calls == 2 {
                        Err(ClientPresentationError::Limit)
                    } else {
                        Ok(())
                    }
                },
            );
        assert_eq!(result, Err(ClientPresentationError::Limit));
        assert_eq!(calls, 2);
        assert_eq!(client, before);
        client
            .apply_frame_with_all_factories_and_setup::<ClientPresentationError, _, _, _, _>(
                &bytes,
                ElapsedHeader::Absent,
                |_| Ok(PairedFaceGeometry::default()),
                |_, _| Err(ClientPresentationError::FoodFactoryRequired),
                |_, _| Err(ClientPresentationError::PreyFactoryRequired),
                |_, _| Ok(()),
            )
            .unwrap();
        assert!(client.prey_enabled());
        assert_eq!(client.received.frames_applied, 1);
    }

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

    fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
        commands
            .iter()
            .flat_map(|p| {
                let mut bytes = (p.len() as u16).to_be_bytes().to_vec();
                bytes.extend(p);
                bytes
            })
            .collect()
    }

    fn factory(spawn: &FoodSpawnInput, _: f64) -> Result<FoodFactory, ClientPresentationError> {
        let sources: Vec<_> = (1..=8)
            .map(|handle| {
                FoodSource::new(
                    BodyAsset {
                        handle,
                        revision: 1,
                        width: 20,
                        height: 16,
                        status: BodyAssetStatus::Ready,
                    },
                    20.,
                    16.,
                    10.,
                    8.,
                )
                .unwrap()
            })
            .collect();
        Ok(FoodFactory {
            random_phase_unit: 0.,
            random_wobble_unit: 0.5,
            palette: food_palette(spawn.raw_color),
            image_count: sources.len(),
            bodies: sources.clone(),
            outlines: sources.clone(),
            glows: sources,
        })
    }

    fn apply_factories(client: &mut AnimatedClient, p: &[u8]) {
        client
            .apply_frame_with_factories(
                p,
                ElapsedHeader::Absent,
                |_| Ok(PairedFaceGeometry::default()),
                factory,
            )
            .unwrap();
    }

    fn assert_exact_client(actual: &AnimatedClient, expected: &AnimatedClient) {
        assert_eq!(actual, expected);
        // Debug also distinguishes finite signed zero throughout the owned state.
        assert_eq!(format!("{actual:?}"), format!("{expected:?}"));
    }

    #[test]
    fn initial_empty_setup_hook_prepares_once_without_advancing_update_or_camera() {
        let mut client = AnimatedClient::new(3.).unwrap();
        client
            .set_camera_position(Point { x: -0., y: 17. })
            .unwrap();
        client.set_zoom(0.9).unwrap();
        let before = client.clone();
        let mut calls = 0;
        client
            .apply_frame_with_factories_and_setup(
                &setup(),
                ElapsedHeader::Absent,
                |_| panic!("no appearance"),
                |_, _| panic!("no food"),
                |stage, setup| {
                    calls += 1;
                    assert!(stage.connected());
                    assert_eq!(stage.boundary().unwrap().displayed(), setup.radius);
                    assert!(stage.received().setup.is_none());
                    assert_eq!(stage.arena_edge_view().center(), setup.grid_center);
                    assert_eq!(stage.arena_edge_view().angle().to_bits(), 0_f64.to_bits());
                    assert_eq!(
                        stage.arena_edge_view().distance().to_bits(),
                        0_f64.to_bits()
                    );
                    assert!(
                        stage
                            .prepare_draw_resolved_limited_staged::<ClientPresentationError, _>(
                                960,
                                540,
                                1.,
                                0,
                                |_, _, _| { panic!("no snake") }
                            )?
                            .is_empty()
                    );
                    Ok::<_, ClientPresentationError>(())
                },
            )
            .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(client.clock, before.clock);
        assert_eq!(client.camera, before.camera);
        assert_eq!(client.camera.position().x.to_bits(), (-0_f64).to_bits());
        assert!(client.food_bounds().is_none());
        let mut control = before;
        apply_factories(&mut control, &setup());
        assert_eq!(client.draw_serial(), 1);
        control.draw_serial = 1;
        assert_exact_client(&client, &control);
    }

    #[test]
    fn bundled_setup_draws_match_ordered_packet_and_draw_controls() {
        let mut client = AnimatedClient::new(0.).unwrap();
        apply_factories(&mut client, &bundle(&[setup(), spawn(3, 11)]));
        client.advance(3., false).unwrap();
        apply_factories(&mut client, &[b'g', 0, 7, 131, 129]);
        // Consecutive own draws straddle a food source-selection threshold.
        client.set_zoom(0.8247).unwrap();
        let mut control = client.clone();
        let mut changed_setup = setup();
        changed_setup[1..4].copy_from_slice(&u24(1400));
        let mut appearance = spawn(8, 19);
        appearance[1..3].copy_from_slice(&8_u16.to_be_bytes());
        let commands = [
            setup(),
            appearance,
            vec![b'f', 1, 2, 3, 4, 7, 25],
            changed_setup.clone(),
            vec![b'f', 1, 2, 8, 9, 8, 25],
            vec![b's', 0, 8, 0],
            changed_setup,
        ];
        let order = RefCell::new(Vec::new());
        let mut draws = Vec::new();
        let mut factory_zooms = Vec::new();
        client
            .apply_frame_with_factories_and_setup(
                &bundle(&commands),
                ElapsedHeader::Absent,
                |_| {
                    order.borrow_mut().push("face");
                    Ok(PairedFaceGeometry::default())
                },
                |spawn, zoom| {
                    order.borrow_mut().push("food");
                    factory_zooms.push(zoom);
                    factory(spawn, zoom)
                },
                |stage, setup| {
                    order.borrow_mut().push("setup");
                    assert_eq!(stage.clock, control.clock);
                    assert_eq!(stage.boundary().unwrap().displayed(), setup.radius);
                    assert_eq!(stage.arena_edge_view().center(), setup.grid_center);
                    let draw = stage.prepare_draw_with_style_staged(960, 540, 1.3, true)?;
                    let camera = stage.camera().position();
                    let dx = camera.x - setup.grid_center;
                    let dy = camera.y - setup.grid_center;
                    assert_eq!(
                        stage.arena_edge_view().angle().to_bits(),
                        dy.atan2(dx).to_bits()
                    );
                    assert_eq!(
                        stage.arena_edge_view().distance().to_bits(),
                        (dx * dx + dy * dy).sqrt().to_bits()
                    );
                    draws.push((setup.clone(), draw, stage.clone()));
                    Ok::<_, ClientPresentationError>(())
                },
            )
            .unwrap();
        assert_eq!(
            order.into_inner(),
            ["setup", "face", "food", "setup", "food", "setup"]
        );
        let mut expected_zooms = Vec::new();
        let mut draw_index = 0;
        for packet in &commands {
            control
                .apply_frame_with_factories(
                    packet,
                    ElapsedHeader::Absent,
                    |_| Ok(PairedFaceGeometry::default()),
                    |spawn, zoom| {
                        expected_zooms.push(zoom);
                        factory(spawn, zoom)
                    },
                )
                .unwrap();
            if packet[0] == b'a' {
                let draw = control
                    .prepare_draw_with_style(960, 540, 1.3, true)
                    .unwrap();
                let (setup, actual_draw, stage) = &draws[draw_index];
                assert_eq!(setup, control.received().setup.as_ref().unwrap());
                assert_eq!(*actual_draw, draw);
                assert_eq!(format!("{actual_draw:?}"), format!("{draw:?}"));
                // Received state commits once after the bundle, independently of draws.
                let mut expected_stage = control.clone();
                expected_stage.received = stage.received.clone();
                assert_exact_client(stage, &expected_stage);
                draw_index += 1;
            }
        }
        assert_eq!(draw_index, 3);
        assert_eq!(
            draws.iter().map(|d| d.1.len()).collect::<Vec<_>>(),
            [1, 2, 1]
        );
        assert_eq!(factory_zooms, expected_zooms);
        assert_ne!(factory_zooms[0], factory_zooms[1]);
        let foods = client.foods().foods();
        assert_ne!(
            foods[0].snapshot().sources.indices,
            foods[1].snapshot().sources.indices
        );
        let mut expected_received = draws[0].2.received.clone();
        expected_received
            .apply_frame(&bundle(&commands), ElapsedHeader::Absent)
            .unwrap();
        assert_eq!(client.received, expected_received);
        control.received = expected_received;
        assert_exact_client(&client, &control);
    }

    #[derive(Debug)]
    enum HookError {
        Model(ClientPresentationError),
        Callback(Rc<()>),
    }

    impl From<ClientPresentationError> for HookError {
        fn from(error: ClientPresentationError) -> Self {
            Self::Model(error)
        }
    }

    #[test]
    fn rejected_setup_draw_preserves_complete_client_and_callback_error_identity() {
        let mut client = AnimatedClient::new(0.).unwrap();
        apply_factories(&mut client, &bundle(&[setup(), spawn(3, 11)]));
        client.advance(3., false).unwrap();
        apply_factories(&mut client, &[b'g', 0, 7, 131, 129]);
        client.set_own_gaze_heading(-0.).unwrap();
        let before = client.clone();
        let commands = bundle(&[
            spawn(8, 19),
            vec![b'f', 1, 2, 3, 4, 7, 25],
            setup(),
            vec![b'g', 0, 7, 129, 130],
            setup(),
            setup(),
        ]);
        for reject_at in 1..=3 {
            let sentinel = Rc::new(());
            let mut calls = 0;
            let error = client
                .apply_frame_with_factories_and_setup(
                    &commands,
                    ElapsedHeader::Absent,
                    |_| Ok(PairedFaceGeometry::default()),
                    |spawn, zoom| factory(spawn, zoom).map_err(HookError::from),
                    |stage, _| {
                        calls += 1;
                        stage.prepare_draw_with_style_staged(960, 540, 1., true)?;
                        if calls == reject_at {
                            Err(HookError::Callback(Rc::clone(&sentinel)))
                        } else {
                            Ok(())
                        }
                    },
                )
                .unwrap_err();
            match error {
                HookError::Callback(actual) => assert!(Rc::ptr_eq(&actual, &sentinel)),
                HookError::Model(error) => panic!("unexpected model failure: {error}"),
            }
            assert_eq!(calls, reject_at);
            assert_exact_client(&client, &before);
        }
    }

    #[test]
    fn malformed_late_packet_prevents_every_factory_and_setup_callback() {
        let mut client = AnimatedClient::new(0.).unwrap();
        let before = client.clone();
        let calls = RefCell::new(Vec::new());
        let error = client
            .apply_frame_with_factories_and_setup::<ClientPresentationError, _, _, _>(
                &bundle(&[
                    setup(),
                    spawn(3, 11),
                    vec![b'f', 1, 2, 3, 4, 7, 25],
                    setup(),
                    vec![b'g', 0],
                ]),
                ElapsedHeader::Absent,
                |_| {
                    calls.borrow_mut().push("face");
                    Ok(PairedFaceGeometry::default())
                },
                |spawn, zoom| {
                    calls.borrow_mut().push("food");
                    factory(spawn, zoom)
                },
                |_, _| {
                    calls.borrow_mut().push("setup");
                    Ok(())
                },
            )
            .unwrap_err();
        assert!(matches!(error, ClientPresentationError::State(_)));
        assert!(calls.into_inner().is_empty());
        assert_exact_client(&client, &before);
    }

    #[test]
    fn targetless_wrappers_preserve_draw_state_and_match_noop_setup_hook() {
        let mut client = AnimatedClient::new(0.).unwrap();
        apply_factories(&mut client, &bundle(&[setup(), spawn(3, 11)]));
        client.advance(3., false).unwrap();
        client.prepare_draw(960, 540).unwrap();
        apply_factories(&mut client, &[b'g', 0, 7, 131, 129]);
        let packets = bundle(&[setup(), setup()]);
        let mut expected = client.clone();
        expected
            .apply_frame_with_factories_and_setup(
                &packets,
                ElapsedHeader::Absent,
                |_| Ok(PairedFaceGeometry::default()),
                factory,
                |_, _| Ok(()),
            )
            .unwrap();
        assert_eq!(expected.clock, client.clock);
        assert_eq!(expected.camera, client.camera);
        assert_eq!(expected.body_paint_flags, client.body_paint_flags);
        assert_eq!(expected.food_bounds, client.food_bounds);
        assert_eq!(expected.entries, client.entries);
        for wrapper in 0..4 {
            let mut targetless = client.clone();
            match wrapper {
                0 => targetless
                    .apply_frame(&packets, ElapsedHeader::Absent)
                    .unwrap(),
                1 => targetless
                    .apply_frame_with_eye_geometry::<ClientPresentationError, _>(
                        &packets,
                        ElapsedHeader::Absent,
                        |_| Ok(StandardEyeGeometry::default()),
                    )
                    .unwrap(),
                2 => targetless
                    .apply_frame_with_face_geometry::<ClientPresentationError, _>(
                        &packets,
                        ElapsedHeader::Absent,
                        |_| Ok(PairedFaceGeometry::default()),
                    )
                    .unwrap(),
                _ => targetless
                    .apply_frame_with_factories(
                        &packets,
                        ElapsedHeader::Absent,
                        |_| Ok(PairedFaceGeometry::default()),
                        factory,
                    )
                    .unwrap(),
            };
            assert_exact_client(&targetless, &expected);
        }
    }

    #[test]
    fn limited_draw_accepts_exact_aggregate_budget_and_rejects_one_less() {
        let mut client = AnimatedClient::new(0.).unwrap();
        for p in [setup(), spawn(3, 11), spawn(8, 19)] {
            apply(&mut client, &p);
        }
        client.advance(40., false).unwrap();
        let mut control = client.clone();
        let expected = control.prepare_draw_with_style(960, 540, 1., true).unwrap();
        let sample_count: usize = expected
            .iter()
            .filter_map(|snake| snake.curve.as_ref())
            .map(|curve| curve.samples.len())
            .sum();
        assert!(expected.len() == 2 && sample_count > 2);
        let mut stage = client.clone();
        let actual = stage
            .prepare_draw_resolved_limited_staged(960, 540, 1., sample_count, |_, _, _| {
                Ok::<_, ClientPresentationError>(true)
            })
            .unwrap();
        assert_eq!(actual, expected);
        assert_eq!(format!("{actual:?}"), format!("{expected:?}"));
        assert_exact_client(&stage, &control);
        let mut stage = client.clone();
        assert_eq!(
            stage.prepare_draw_resolved_limited_staged(
                960,
                540,
                1.,
                sample_count - 1,
                |_, _, _| { Ok::<_, ClientPresentationError>(true) }
            ),
            Err(ClientPresentationError::Limit)
        );
        // A nonempty face-only scene still runs its draw with no samples remaining.
        for anchors in 0..=1 {
            let mut short = spawn(3, 11);
            short.truncate(26 + anchors * 6);
            let mut client = AnimatedClient::new(0.).unwrap();
            for p in [setup(), short] {
                apply(&mut client, &p);
            }
            client.set_zoom(0.9).unwrap();
            let mut control = client.clone();
            let expected = control
                .prepare_draw_with_style(960, 540, 1., false)
                .unwrap();
            let actual = client
                .prepare_draw_resolved_limited_staged(960, 540, 1., 0, |_, _, _| {
                    Ok::<_, ClientPresentationError>(false)
                })
                .unwrap();
            assert_eq!(actual.len(), anchors);
            assert!(actual.iter().all(|snake| snake.curve.is_none()));
            assert_eq!(actual, expected);
            assert_eq!(format!("{actual:?}"), format!("{expected:?}"));
            assert_exact_client(&client, &control);
        }
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
