//! Atomic received events and bounded animation state, with separate update/draw clocks.

use std::{collections::BTreeSet, error::Error, fmt, sync::Arc};

use super::{
    AnchorView, AntennaCullBounds, AntennaDrawInput, AntennaError, AntennaSnapshot, AntennaState,
    ArenaEdgeView, BackgroundInput, BackgroundPlan, BackgroundState, BodyPaintGeometry,
    BodyPaintSample, BodyPaintView, BoundaryRadius, CurveOutput, FaceGeometry, FollowCamera,
    FoodConsume, FoodCullBounds, FoodEaterPose, FoodError, FoodFactory, FoodSpawn, FoodWorld,
    FrameClock, FrameStep, HudIngressEventKind, HudIngressPlan, HudIngressReport,
    MAX_CURVE_SAMPLES, MinimapError, MinimapLayout, MinimapRenderPlan, MinimapState,
    MinimapUpdateInput, MinimapView, NEUTRAL_NICKNAME_COLOR, NicknameCullBounds, NicknameDraw,
    NicknameInput, NicknameState, NicknameTint, OrdinaryAntennaGeometry, PairedFaceGeometry,
    PairedSideGeometry, PreparedAntenna, PresentationError, PreyError, PreyFactory, PreyWorld,
    ScoreError, ScoreTables, SnakeMetrics, SnakeObjectToken, SnakePresentation,
    StandardEyeGeometry, StaticHeadAccessoryGeometry, finite, plan_minimap,
};
use super::{AnnouncementLifecycle, AnnouncementState, AnnouncementView};
use crate::{
    protocol::ElapsedHeader,
    state::{
        Appearance, ClientState, FoodSpawnInput, FrameReport, HudCommandBoundary,
        HudCommandCollector, HudCommandMarker, MAX_SNAKES, MAX_TOTAL_BODY_POINTS, Point,
        PresentationEvent, PreySpawnInput, Setup, SnakeTarget, StateError,
    },
};

// Bound server-controlled resize/clear work before source or Setup draw
// callbacks run; short map bodies can still request large pixel surfaces.
fn validate_minimap_work(
    events: &[PresentationEvent],
    mut dimension: Option<u16>,
) -> Result<(), ClientPresentationError> {
    let mut remaining = 16 * 512_usize * 512;
    for event in events {
        let layers = match event {
            PresentationEvent::Setup(_) => {
                dimension = Some(24);
                1
            }
            PresentationEvent::Minimap(command) => {
                let packet = crate::protocol::minimap::parse_minimap(command)
                    .map_err(|error| ClientPresentationError::Minimap(error.into()))?;
                dimension = packet.dimension().or(dimension);
                packet
                    .visit_selected(dimension.unwrap_or(0), |_, _| {})
                    .map_err(|error| ClientPresentationError::Minimap(error.into()))?
                    .max(1)
            }
            _ => continue,
        };
        let side = usize::from(dimension.unwrap_or(0));
        remaining = remaining
            .checked_sub(side * side * layers)
            .ok_or(ClientPresentationError::MinimapFrameWorkLimit)?;
    }
    Ok(())
}

/// Retained objects, including duplicate appearances, deaths, and an undrawn own object.
pub const MAX_RETAINED_SNAKES: usize = MAX_SNAKES * 2;
/// Aggregate physical anchors, including retained dying body points and undrawn own geometry.
pub const MAX_RETAINED_TOTAL_BODY_POINTS: usize = MAX_TOTAL_BODY_POINTS * 2;
/// Aggregate active curve samples permitted in one prepared numeric draw.
pub const MAX_DRAW_SAMPLES: usize = MAX_RETAINED_TOTAL_BODY_POINTS * 2;

/// A copied score result; unavailable or unsupported inputs never invent a value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ScoreStatus {
    /// Tracking has not been explicitly enabled.
    Disabled,
    /// No enabled Setup has built a table yet.
    NoTables,
    /// No original own appearance exists in this world.
    NoOwn,
    /// The composed index or latest mass is outside the score-table domain.
    Unsupported(ScoreError),
    /// Integer-valued native f64 score, including negative and above-32-bit values.
    Ready(f64),
}

/// Original own score inputs, independent of wire lookup, draw membership and smoothing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OwnScoreView {
    /// Scene-local original own identity, retained until reset.
    pub token: SnakeObjectToken,
    /// Original wire identifier; reuse does not transfer ownership.
    pub id: u16,
    /// Latest logical membership, never a physical-point recount.
    pub logical_segments: usize,
    /// Latest unsmoothed decoded wire mass.
    pub fractional_mass: f64,
    /// Replacement u8 R value; separate from geometry and logical count.
    pub score_adjustment: u8,
    /// Logical count plus R, without clamping to table bounds.
    pub score_index: usize,
}

/// Pure copied native score observation; reading advances no update or draw.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClientScoreView {
    /// Whether canonical R admission and Setup caching are enabled.
    pub enabled: bool,
    /// Cached positive Setup parameter, retained even across world reset.
    pub table_max: Option<u16>,
    /// Retained original own inputs, including after death and draw expiry.
    pub own: Option<OwnScoreView>,
    /// Ready only for finite mass in 0..=1 and index through N+2048 inclusive.
    pub status: ScoreStatus,
}

/// Retained original own control data, independent of wire lookup and draw membership.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OwnControlView {
    /// Scene-local identity; never reused across world resets, scoped to this client.
    pub token: SnakeObjectToken,
    /// Original wire identifier; not an object identity.
    pub id: u16,
    /// Absolute uncorrected predicted head before this update's motion.
    pub raw_head: Point,
    /// Independently retained wanted heading.
    pub wanted_heading: f64,
    /// Visual gaze, including after death and draw expiry.
    pub gaze_heading: f64,
    /// Whether live travel has ended.
    pub dead: bool,
    /// Current setup's turning coefficient.
    pub turn_rate: f64,
    /// Retained size-dependent turning coefficient.
    pub size_turn_factor: f64,
    /// Retained speed-dependent turning coefficient.
    pub speed_turn_factor: f64,
}

/// Coherent copied input observation; reading it consumes neither update nor draw.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClientControlView {
    /// Original own object, retained until world reset, including after expiry.
    pub own: Option<OwnControlView>,
    /// Absolute displayed camera position.
    pub camera: Point,
    /// Displayed zoom from the retained draw state.
    pub zoom: f64,
    /// Caller-owned camera following preference.
    pub follows: bool,
    /// Current boundary connection gate.
    pub connected: bool,
}

/// Closed pre-motion actions, validated together before any action is applied.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ClientControlActions {
    /// Set retained-own visual gaze before this update's pupil movement.
    pub gaze_heading: Option<f64>,
    /// Perform the existing world reset while retaining the already computed step.
    pub reset_world: bool,
    /// Restore only the clock multiplier; the computed step is unchanged.
    pub reset_lag: bool,
    /// Override the connection gate after any reset.
    pub connected: Option<bool>,
    /// Existing session return-fade observation, before the connected map update.
    pub minimap_ui_fraction: Option<f64>,
    /// Existing session lifecycle for selected announcement fade, on this same step.
    pub announcement_lifecycle: Option<AnnouncementLifecycle>,
}

/// Appearance-owned numeric style; borrowed images are resolved only during drawing.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AppearancePresentation {
    /// Complete supported paired face, including optional side images.
    pub face: PairedFaceGeometry,
    /// Explicit ordinary antenna configuration, independent of wire skin identifiers.
    pub antenna: Option<OrdinaryAntennaGeometry>,
}

/// Complete numeric face family and antenna, owned by one retained appearance.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FacePresentation {
    /// Authoritative face family; image sources are borrowed only during a draw.
    pub face: FaceGeometry,
    /// Ordinary antenna geometry on the same stable appearance object.
    pub antenna: Option<OrdinaryAntennaGeometry>,
}

impl From<AppearancePresentation> for FacePresentation {
    fn from(value: AppearancePresentation) -> Self {
        Self {
            face: FaceGeometry::Paired(value.face),
            antenna: value.antenna,
        }
    }
}

/// Complete appearance metadata with an independent optional static head image.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AccessoryPresentation {
    /// Existing face and antenna metadata, unchanged by accessory selection.
    pub presentation: FacePresentation,
    /// Numeric geometry only; sources are borrowed during drawing.
    pub accessory: Option<StaticHeadAccessoryGeometry>,
}

impl From<FacePresentation> for AccessoryPresentation {
    fn from(presentation: FacePresentation) -> Self {
        Self {
            presentation,
            accessory: None,
        }
    }
}

impl From<AppearancePresentation> for AccessoryPresentation {
    fn from(presentation: AppearancePresentation) -> Self {
        FacePresentation::from(presentation).into()
    }
}

/// Complete appearance metadata with optional appearance-time nickname tint inputs.
///
/// Existing resolvers convert to this with no tint, retaining the neutral color.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TintedPresentation {
    /// Existing face, antenna and accessory metadata, unchanged by tint selection.
    pub presentation: AccessoryPresentation,
    /// Explicit base color and units; `None` selects [`NEUTRAL_NICKNAME_COLOR`].
    pub nickname_tint: Option<NicknameTint>,
}

impl From<AccessoryPresentation> for TintedPresentation {
    fn from(presentation: AccessoryPresentation) -> Self {
        Self {
            presentation,
            nickname_tint: None,
        }
    }
}

impl From<FacePresentation> for TintedPresentation {
    fn from(presentation: FacePresentation) -> Self {
        AccessoryPresentation::from(presentation).into()
    }
}

impl From<AppearancePresentation> for TintedPresentation {
    fn from(presentation: AppearancePresentation) -> Self {
        AccessoryPresentation::from(presentation).into()
    }
}

/// Event-time identity derived from the staged retained world before resolving.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AppearanceContext {
    /// Whether this appearance becomes the retained original own object.
    pub own: bool,
}

/// One prepared snake and its independently retained numeric accessory.
#[derive(Clone, Debug, PartialEq)]
pub struct PreparedAccessorySnake {
    /// The existing single camera/body/face/antenna preparation result.
    pub snake: PreparedSnake,
    /// Geometry captured from the same stable appearance token.
    pub accessory: Option<StaticHeadAccessoryGeometry>,
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
    /// Authoritative family captured with this draw's heading and pupil state.
    pub face_geometry: FaceGeometry,
    /// Paired-only metadata; absent for image eyes rather than a substitute style.
    pub eye_geometry: Option<StandardEyeGeometry>,
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
    /// HUD journal ingress never enables score admission implicitly.
    ScoreTrackingRequired,
    /// An accepted final capture requires an actual ready retained-own score.
    FinalScoreUnavailable(ScoreStatus),
    /// Score admission must start before packets or after reset.
    ScoreModeRequiresReset,
    /// Nickname retention must start before packets or after reset.
    NicknameModeRequiresReset,
    /// Minimap retention must start before packets or after reset.
    MinimapModeRequiresReset,
    /// A minimap command or used numeric input is invalid.
    Minimap(MinimapError),
    /// One frame requests more than sixteen maximum-size map layers of work.
    MinimapFrameWorkLimit,
    /// Canonical R requires an original own object at its event position.
    ScoreOwnRequired,
    /// Score-table construction failed without changing the cache or world.
    Score(ScoreError),
    /// Antenna configuration, random inputs or numeric preparation failed.
    Antenna(AntennaError),
    /// Full appearance metadata must be enabled before packets or after reset.
    AppearanceModeRequiresReset,
    /// Enabled appearance ownership requires the full resolver for new appearances.
    AppearanceResolverRequired,
    /// A configured drawn antenna requires an explicit draw-time random capability.
    AntennaRandomRequired,
    /// Generalized face ownership must start before packets or after reset.
    FacePresentationModeRequiresReset,
    /// Generalized ownership requires its full resolver for new appearances.
    FacePresentationResolverRequired,
    /// A visible single-image face requires an explicit capable draw path.
    FacePresentationRequired,
    /// Static accessory ownership must start before packets or after reset.
    AccessoryPresentationModeRequiresReset,
    /// Enabled accessory ownership requires its context-aware appearance resolver.
    AccessoryPresentationResolverRequired,
    /// A visible static accessory requires an explicit capable draw path.
    AccessoryPresentationRequired,
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
            Self::ScoreTrackingRequired => {
                f.write_str("HUD ingress requires enabled score tracking")
            }
            Self::FinalScoreUnavailable(_) => {
                f.write_str("HUD final capture requires a ready score")
            }
            Self::ScoreModeRequiresReset => {
                f.write_str("enable score tracking before packets or after reset")
            }
            Self::NicknameModeRequiresReset => {
                f.write_str("enable nicknames before packets or after reset")
            }
            Self::MinimapModeRequiresReset => {
                f.write_str("enable minimap tracking before packets or after reset")
            }
            Self::Minimap(error) => error.fmt(f),
            Self::MinimapFrameWorkLimit => f.write_str("minimap frame work limit exceeded"),
            Self::ScoreOwnRequired => {
                f.write_str("score adjustment requires retained original own")
            }
            Self::Score(error) => error.fmt(f),
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
            Self::FacePresentationModeRequiresReset => {
                f.write_str("enable face presentation before packets or after reset")
            }
            Self::FacePresentationResolverRequired => {
                f.write_str("appearance creation requires a face presentation resolver")
            }
            Self::FacePresentationRequired => {
                f.write_str("single-image face requires an explicit face draw capability")
            }
            Self::AccessoryPresentationModeRequiresReset => {
                f.write_str("enable accessory presentation before packets or after reset")
            }
            Self::AccessoryPresentationResolverRequired => {
                f.write_str("appearance creation requires an accessory presentation resolver")
            }
            Self::AccessoryPresentationRequired => {
                f.write_str("static accessory requires an explicit accessory draw capability")
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
            Self::Score(error) => Some(error),
            Self::Antenna(error) => Some(error),
            Self::State(error) => Some(error),
            Self::Presentation(error) => Some(error),
            Self::Food(error) => Some(error),
            Self::Prey(error) => Some(error),
            Self::Minimap(error) => Some(error),
            Self::ScoreTrackingRequired
            | Self::FinalScoreUnavailable(_)
            | Self::Limit
            | Self::ScoreModeRequiresReset
            | Self::NicknameModeRequiresReset
            | Self::MinimapModeRequiresReset
            | Self::MinimapFrameWorkLimit
            | Self::ScoreOwnRequired
            | Self::AppearanceModeRequiresReset
            | Self::AppearanceResolverRequired
            | Self::AntennaRandomRequired
            | Self::FacePresentationModeRequiresReset
            | Self::FacePresentationResolverRequired
            | Self::FacePresentationRequired
            | Self::AccessoryPresentationModeRequiresReset
            | Self::AccessoryPresentationResolverRequired
            | Self::AccessoryPresentationRequired
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

impl From<ScoreError> for ClientPresentationError {
    fn from(error: ScoreError) -> Self {
        Self::Score(error)
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
    accessory: Option<StaticHeadAccessoryGeometry>,
    nickname: Option<RetainedNickname>,
}

#[derive(Clone, Debug, PartialEq)]
struct RetainedNickname {
    text: String,
    // Resolved once at appearance; draws never consult tint inputs again.
    color: [u8; 3],
    state: NicknameState,
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
    announcements_enabled: bool,
    announcements: AnnouncementState,
    minimap_enabled: bool,
    minimap: MinimapState,
    nicknames_enabled: bool,
    nickname_draws: Vec<NicknameDraw>,
    score_enabled: bool,
    // Immutable sharing keeps equal-N caches intact across disposable transaction clones.
    score_tables: Option<Arc<ScoreTables>>,
    own_score_adjustment: u8,
    clock: FrameClock,
    camera: FollowCamera,
    background: BackgroundState,
    background_camera: Option<Point>,
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
    face_presentation_enabled: bool,
    accessory_presentation_enabled: bool,
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
            announcements_enabled: false,
            announcements: AnnouncementState::default(),
            minimap_enabled: false,
            minimap: MinimapState::default(),
            nicknames_enabled: false,
            nickname_draws: Vec::new(),
            score_enabled: false,
            score_tables: None,
            own_score_adjustment: 0,
            clock: FrameClock::new(start_ms)?,
            camera: FollowCamera::default(),
            background: BackgroundState::default(),
            background_camera: None,
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
            face_presentation_enabled: false,
            accessory_presentation_enabled: false,
            antenna_bounds: None,
            draw_serial: 0,
        })
    }

    /// Clear the world and draw corrections, and restore the lag multiplier to one.
    /// Preserve the clock's timestamp and both accumulated phases, boundary and arena-edge view state,
    /// camera position, background phase/baseline, caller follow preference and shared body-painter flag history. Use `new`
    /// to start a fresh timeline.
    pub fn reset(&mut self) {
        self.received = ClientState::default();
        self.clock.reset_lag();
        self.reset_camera();
        self.connected = false;
        self.entries.clear();
        self.minimap.reset_world();
        self.nickname_draws.clear();
        self.own_score_adjustment = 0;
        self.foods.clear();
        self.preys.clear();
    }

    /// Enable appearance-owned nicknames before ingress; idempotent once enabled.
    /// Reset preserves enablement. The default playable runtime always enables it.
    /// Initial opacity one and neutral light RGB are authored local visual policy.
    pub fn enable_nicknames(&mut self) -> Result<(), ClientPresentationError> {
        if !self.nicknames_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::NicknameModeRequiresReset);
        }
        self.nicknames_enabled = true;
        Ok(())
    }

    /// Frozen name commands from the latest preparation, independently of body culling.
    /// Reading these commands advances no fade, camera or update clock.
    pub fn nickname_draws(&self) -> &[NicknameDraw] {
        &self.nickname_draws
    }

    /// Select announcement admission on the HUD ingress lane before the first packet.
    /// Content and selection survive world reset; ordinary packet APIs stay opaque.
    pub fn enable_announcement_tracking(&mut self) -> Result<(), ClientPresentationError> {
        if !self.announcements_enabled && self.received.frames_applied != 0 {
            return Err(PresentationError.into());
        }
        self.announcements_enabled = true;
        Ok(())
    }

    /// Project retained announcement text and opacity without consuming clocks.
    pub fn announcement_view(&self) -> AnnouncementView {
        self.announcements.view()
    }

    /// Enable minimap admission before ingress; reset preserves this selection.
    pub fn enable_minimap_tracking(&mut self) -> Result<(), ClientPresentationError> {
        if !self.minimap_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::MinimapModeRequiresReset);
        }
        self.minimap_enabled = true;
        Ok(())
    }

    /// Whether the caller selected native minimap tracking.
    pub fn minimap_tracking_enabled(&self) -> bool {
        self.minimap_enabled
    }

    /// Borrow native minimap images and metadata without advancing presentation.
    pub fn minimap_view(&self) -> MinimapView<'_> {
        self.minimap.view()
    }

    /// Build backend-neutral widget geometry and styles with borrowed pixels.
    pub fn minimap_render_plan(
        &self,
        layout: MinimapLayout,
    ) -> Result<MinimapRenderPlan<'_>, ClientPresentationError> {
        plan_minimap(self.minimap.view(), layout).map_err(ClientPresentationError::Minimap)
    }

    /// Forward an observation from the existing session UI lifecycle. No clock
    /// or independent fraction progression is introduced here.
    pub fn observe_minimap_ui_fraction(
        &mut self,
        fraction: f64,
    ) -> Result<(), ClientPresentationError> {
        self.minimap
            .observe_ui_fraction(fraction)
            .map_err(ClientPresentationError::Minimap)
    }

    /// Opt into canonical R and ordered Setup score tables before packets or after reset.
    /// Idempotent once enabled; reset preserves enablement and the immutable table cache.
    /// Other score/HUD families remain opaque. This adds no Wasm export or clock.
    pub fn enable_score_tracking(&mut self) -> Result<(), ClientPresentationError> {
        if !self.score_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::ScoreModeRequiresReset);
        }
        self.score_enabled = true;
        Ok(())
    }

    /// Observe latest logical count/mass plus original-own R without changing any state.
    /// No required HUD lookup occurs during ingress: out-of-range geometry remains
    /// admitted and reports Unsupported here, without a fabricated or clamped score.
    pub fn score_view(&self) -> ClientScoreView {
        let own = self
            .own_token()
            .zip(self.own_snake())
            .map(|(token, snake)| {
                let metrics = snake.metrics();
                OwnScoreView {
                    token,
                    id: metrics.id,
                    logical_segments: metrics.logical_segments,
                    fractional_mass: metrics.fam,
                    score_adjustment: self.own_score_adjustment,
                    score_index: metrics.logical_segments + usize::from(self.own_score_adjustment),
                }
            });
        let status = if !self.score_enabled {
            ScoreStatus::Disabled
        } else if let Some(tables) = &self.score_tables {
            match own {
                None => ScoreStatus::NoOwn,
                Some(own) => match tables.score(own.score_index, own.fractional_mass) {
                    Ok(value) => ScoreStatus::Ready(value),
                    Err(error) => ScoreStatus::Unsupported(error),
                },
            }
        } else {
            ScoreStatus::NoTables
        };
        ClientScoreView {
            enabled: self.score_enabled,
            table_max: self.score_tables.as_ref().map(|tables| tables.table_max()),
            own,
            status,
        }
    }

    /// Restore only the lag multiplier, preserving world, timestamp and both phases.
    pub fn reset_lag(&mut self) {
        self.clock.reset_lag();
    }

    /// Observe the retained original own object and displayed camera before motion.
    /// Tokens belong to this client instance; pair them with client identity when
    /// sharing observations across clients. Reset never reuses an allocated token.
    pub fn control_view(&self) -> ClientControlView {
        let own = self.entries.iter().find(|entry| entry.own).map(|entry| {
            let metrics = entry.snake.metrics();
            OwnControlView {
                token: entry.token,
                id: metrics.id,
                raw_head: metrics.raw_head,
                wanted_heading: metrics.wanted_heading,
                gaze_heading: entry.snake.eyes().gaze_heading(),
                dead: !metrics.alive,
                turn_rate: self.received.setup.as_ref().map_or(0., |setup| setup.mamu),
                size_turn_factor: metrics.size_turn_factor,
                speed_turn_factor: metrics.speed_turn_factor,
            }
        });
        ClientControlView {
            own,
            camera: self.camera.position(),
            zoom: self.camera.zoom(),
            follows: self.camera.follows(),
            connected: self.connected,
        }
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
    #[cfg(test)]
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
    #[cfg(test)]
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
    #[cfg(test)]
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
    #[cfg(test)]
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

    /// Resolve complete appearance metadata once in wire order, before its first update.
    /// Start before packets or after reset; enabled sessions require this resolver
    /// for later appearances. Callback effects remain external to model rollback.
    pub fn apply_frame_with_face_presentation<E, F>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<FacePresentation, E>,
    {
        self.apply_frame_face_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            |_, _| Ok(None),
            false,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Install full appearances and food factories in the same atomic event transaction.
    pub fn apply_frame_with_face_presentation_and_factories<E, F, G>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<FacePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
    {
        self.apply_frame_face_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Install full appearances and both creation factories in wire order.
    pub fn apply_frame_with_face_presentation_and_all_factories<E, F, G, P>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        mut resolve_prey: P,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<FacePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
    {
        self.apply_frame_face_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            |_, _| Ok(()),
        )
    }

    /// Plan event-time Setup draws with full appearances and food factories.
    pub fn apply_frame_with_face_presentation_and_factories_and_setup<E, F, G, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<FacePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_face_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |_, _| Ok(None),
            false,
            on_setup,
        )
    }

    /// Plan every ordered Setup with the complete appearance, food and prey transaction.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_with_face_presentation_and_all_factories_and_setup<E, F, G, P, H>(
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
        F: FnMut(&Appearance) -> Result<FacePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_face_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            on_setup,
        )
    }

    /// Opt-in indexed HUD journal using the same typed transaction and event fold.
    ///
    /// Requires already enabled score tracking. Complete typed admission, including
    /// every leaderboard tail even while not playing, precedes source callbacks.
    /// Supplied booleans are private session decisions, not a native lifecycle.
    /// Setup counts successful callbacks; callers map actual draw planning to these
    /// callbacks. Observation adds no draw, update or decoder. All numeric changes
    /// roll back on failure; external callback side effects cannot roll back.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud<E, F, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        mut resolve_prey: P,
        on_setup: H,
        plan: HudIngressPlan<'_>,
    ) -> Result<HudIngressReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<FacePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        let (_, journal) = self.apply_frame_face_transaction(
            bytes,
            header,
            resolve,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            on_setup,
            Some(plan),
        )?;
        Ok(journal.expect("HUD mode always constructs a journal"))
    }

    /// Resolve complete appearance metadata once in wire order, before its first update.
    /// Start before packets or after reset; enabled sessions require this resolver
    /// for later appearances. Callback effects remain external to model rollback.
    pub fn apply_frame_with_accessory_presentation<E, F>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance, AppearanceContext) -> Result<AccessoryPresentation, E>,
    {
        self.apply_frame_accessory_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            true,
            |_, _| Ok(None),
            false,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Install full appearances and food factories in the same atomic event transaction.
    pub fn apply_frame_with_accessory_presentation_and_factories<E, F, G>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance, AppearanceContext) -> Result<AccessoryPresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
    {
        self.apply_frame_accessory_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Install full appearances and both creation factories in wire order.
    pub fn apply_frame_with_accessory_presentation_and_all_factories<E, F, G, P>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        mut resolve_prey: P,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance, AppearanceContext) -> Result<AccessoryPresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
    {
        self.apply_frame_accessory_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            |_, _| Ok(()),
        )
    }

    /// Plan event-time Setup draws with full appearances and food factories.
    pub fn apply_frame_with_accessory_presentation_and_factories_and_setup<E, F, G, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance, AppearanceContext) -> Result<AccessoryPresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_accessory_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |_, _| Ok(None),
            false,
            on_setup,
        )
    }

    /// Plan every ordered Setup with the complete appearance, food and prey transaction.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_with_accessory_presentation_and_all_factories_and_setup<E, F, G, P, H>(
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
        F: FnMut(&Appearance, AppearanceContext) -> Result<AccessoryPresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_accessory_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            on_setup,
        )
    }

    /// Opt-in indexed HUD journal using the same typed transaction and event fold.
    ///
    /// Requires already enabled score tracking. Complete typed admission, including
    /// every leaderboard tail even while not playing, precedes source callbacks.
    /// Supplied booleans are private session decisions, not a native lifecycle.
    /// Setup counts successful callbacks; callers map actual draw planning to these
    /// callbacks. Observation adds no draw, update or decoder. All numeric changes
    /// roll back on failure; external callback side effects cannot roll back.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_with_accessory_presentation_and_all_factories_and_setup_and_hud<
        E,
        F,
        G,
        P,
        H,
    >(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        mut resolve_food: G,
        mut resolve_prey: P,
        on_setup: H,
        plan: HudIngressPlan<'_>,
    ) -> Result<HudIngressReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance, AppearanceContext) -> Result<AccessoryPresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        let (_, journal) = self.apply_frame_accessory_transaction(
            bytes,
            header,
            resolve,
            true,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            on_setup,
            Some(plan),
        )?;
        Ok(journal.expect("HUD mode always constructs a journal"))
    }

    /// Resolve complete appearances plus optional explicit nickname tint inputs.
    ///
    /// Uses the [`Self::apply_frame_with_accessory_presentation`] mode. Each tint
    /// resolves once, before its appearance is retained; an invalid unit rejects
    /// the frame. Callback effects, including random draws made for the units,
    /// remain outside model rollback.
    pub fn apply_frame_with_tinted_presentation<E, F>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance, AppearanceContext) -> Result<TintedPresentation, E>,
    {
        self.apply_frame_accessory_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            true,
            |_, _| Ok(None),
            false,
            |_, _| Ok(None),
            false,
            |_, _| Ok(()),
        )
    }

    /// Plan every ordered Setup with tinted appearances, food and prey factories.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_with_tinted_presentation_and_all_factories_and_setup<E, F, G, P, H>(
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
        F: FnMut(&Appearance, AppearanceContext) -> Result<TintedPresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<FoodFactory, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<PreyFactory, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_accessory_resolved(
            bytes,
            header,
            resolve,
            true,
            true,
            true,
            |spawn, zoom| resolve_food(spawn, zoom).map(Some),
            true,
            |spawn, zoom| resolve_prey(spawn, zoom).map(Some),
            true,
            on_setup,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_frame_accessory_resolved<E, F, R, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        enable_appearance: bool,
        enable_face_presentation: bool,
        enable_accessory_presentation: bool,
        resolve_food: G,
        enable_food: bool,
        resolve_prey: P,
        enable_prey: bool,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance, AppearanceContext) -> Result<R, E>,
        R: Into<TintedPresentation>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<Option<FoodFactory>, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<Option<PreyFactory>, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_accessory_transaction(
            bytes,
            header,
            resolve,
            enable_appearance,
            enable_face_presentation,
            enable_accessory_presentation,
            resolve_food,
            enable_food,
            resolve_prey,
            enable_prey,
            on_setup,
            None,
        )
        .map(|(report, _)| report)
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
        resolve_food: G,
        enable_food: bool,
        resolve_prey: P,
        enable_prey: bool,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<AppearancePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<Option<FoodFactory>, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<Option<PreyFactory>, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_face_resolved(
            bytes,
            header,
            |appearance| resolve(appearance).map(Into::into),
            enable_appearance,
            false,
            resolve_food,
            enable_food,
            resolve_prey,
            enable_prey,
            on_setup,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_frame_face_resolved<E, F, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        resolve: F,
        enable_appearance: bool,
        enable_face_presentation: bool,
        resolve_food: G,
        enable_food: bool,
        resolve_prey: P,
        enable_prey: bool,
        on_setup: H,
    ) -> Result<FrameReport, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<FacePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<Option<FoodFactory>, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<Option<PreyFactory>, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_face_transaction(
            bytes,
            header,
            resolve,
            enable_appearance,
            enable_face_presentation,
            resolve_food,
            enable_food,
            resolve_prey,
            enable_prey,
            on_setup,
            None,
        )
        .map(|(report, _)| report)
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_frame_face_transaction<E, F, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        mut resolve: F,
        enable_appearance: bool,
        enable_face_presentation: bool,
        resolve_food: G,
        enable_food: bool,
        resolve_prey: P,
        enable_prey: bool,
        on_setup: H,
        plan: Option<HudIngressPlan<'_>>,
    ) -> Result<(FrameReport, Option<HudIngressReport>), E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance) -> Result<FacePresentation, E>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<Option<FoodFactory>, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<Option<PreyFactory>, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        self.apply_frame_accessory_transaction(
            bytes,
            header,
            |appearance, _| resolve(appearance),
            enable_appearance,
            enable_face_presentation,
            false,
            resolve_food,
            enable_food,
            resolve_prey,
            enable_prey,
            on_setup,
            plan,
        )
    }

    /// Shared appearance transaction; mode flags match the public resolver families.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn apply_frame_accessory_transaction<E, F, R, G, P, H>(
        &mut self,
        bytes: &[u8],
        header: ElapsedHeader,
        mut resolve: F,
        enable_appearance: bool,
        enable_face_presentation: bool,
        enable_accessory_presentation: bool,
        mut resolve_food: G,
        enable_food: bool,
        mut resolve_prey: P,
        enable_prey: bool,
        mut on_setup: H,
        plan: Option<HudIngressPlan<'_>>,
    ) -> Result<(FrameReport, Option<HudIngressReport>), E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(&Appearance, AppearanceContext) -> Result<R, E>,
        R: Into<TintedPresentation>,
        G: FnMut(&FoodSpawnInput, f64) -> Result<Option<FoodFactory>, E>,
        P: FnMut(&PreySpawnInput, f64) -> Result<Option<PreyFactory>, E>,
        H: FnMut(&mut AnimatedClient, &Setup) -> Result<(), E>,
    {
        if plan.is_some() && !self.score_enabled {
            return Err(ClientPresentationError::ScoreTrackingRequired.into());
        }
        let mut collector = plan.map(|plan| HudCommandCollector {
            plan,
            announcements: self.announcements_enabled,
            boundaries: Vec::new(),
        });
        let mut received = self.received.clone();
        let applied = if self.minimap_enabled {
            received.apply_frame_with_minimap_events(
                bytes,
                header,
                self.score_enabled,
                collector.as_mut(),
            )
        } else if let Some(collector) = &mut collector {
            received.apply_frame_with_hud_events(bytes, header, collector)
        } else if self.score_enabled {
            received.apply_frame_with_score_events(bytes, header)
        } else {
            received.apply_frame_with_events(bytes, header)
        }
        .map_err(ClientPresentationError::from)?;
        if self.minimap_enabled {
            validate_minimap_work(&applied.events, self.minimap.view().dimension)?;
        }
        if let Some(collector) = collector
            .as_ref()
            .filter(|collector| collector.announcements)
        {
            super::announcement::prevalidate_announcement_scores(
                self.score_tables.as_ref().map(|tables| tables.table_max()),
                &applied.events,
                &collector.boundaries,
            )
            .map_err(|error| {
                ClientPresentationError::from(StateError::Hud(
                    super::HudIngressError::Announcement(error),
                ))
            })?;
        }
        if enable_accessory_presentation
            && !self.accessory_presentation_enabled
            && self.received.frames_applied != 0
        {
            return Err(ClientPresentationError::AccessoryPresentationModeRequiresReset.into());
        }
        if enable_face_presentation
            && !self.face_presentation_enabled
            && self.received.frames_applied != 0
        {
            return Err(ClientPresentationError::FacePresentationModeRequiresReset.into());
        }
        if enable_appearance && !self.appearance_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::AppearanceModeRequiresReset.into());
        }
        if enable_food && !self.food_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::FoodModeRequiresReset.into());
        }
        if enable_prey && !self.prey_enabled && self.received.frames_applied != 0 {
            return Err(ClientPresentationError::PreyModeRequiresReset.into());
        }
        if applied.events.is_empty() && collector.is_none() {
            self.received = received;
            self.food_enabled |= enable_food;
            self.prey_enabled |= enable_prey;
            self.appearance_enabled |= enable_appearance;
            self.face_presentation_enabled |= enable_face_presentation;
            self.accessory_presentation_enabled |= enable_accessory_presentation;
            return Ok((applied.report, None));
        }
        let mut next = self.clone();
        next.food_enabled |= enable_food;
        next.prey_enabled |= enable_prey;
        next.appearance_enabled |= enable_appearance;
        next.face_presentation_enabled |= enable_face_presentation;
        next.accessory_presentation_enabled |= enable_accessory_presentation;
        let mut setup = self.received.setup.clone();
        let board_count = collector.as_ref().map_or(0, |c| {
            c.boundaries
                .iter()
                .filter(|b| {
                    matches!(
                        b.marker,
                        HudCommandMarker::Leaderboard { rows: Some(_), .. }
                    )
                })
                .count()
        });
        let mut journal = plan
            .map(|plan| HudIngressReport::new(applied.report, plan.schema, board_count))
            .transpose()
            .map_err(|error| ClientPresentationError::from(StateError::Hud(error)))?;
        let boundaries =
            collector
                .into_iter()
                .flat_map(|c| c.boundaries)
                .chain(plan.is_none().then_some(HudCommandBoundary {
                    event_end: applied.events.len(),
                    marker: HudCommandMarker::Other,
                }));
        let mut events = applied.events.into_iter();
        let mut event_start = 0;
        for (command_index, boundary) in boundaries.enumerate() {
            let mut own_length_scheduled = None;
            for event in events.by_ref().take(boundary.event_end - event_start) {
                match event {
                    PresentationEvent::Setup(value) => {
                        if value.game_mode == Some(2) {
                            return Err(ClientPresentationError::UnsupportedMode(2).into());
                        }
                        if next.announcements_enabled {
                            next.announcements.setup();
                        }
                        if next.minimap_enabled {
                            next.minimap
                                .apply_setup(&value)
                                .map_err(ClientPresentationError::Minimap)?;
                        }
                        if next.score_enabled
                            && next.score_tables.as_ref().map(|tables| tables.table_max())
                                != Some(value.max_segments)
                        {
                            next.score_tables = Some(Arc::new(
                                ScoreTables::new(value.max_segments)
                                    .map_err(ClientPresentationError::from)?,
                            ));
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
                        if let Some(journal) = &mut journal {
                            journal.push(
                                command_index,
                                HudIngressEventKind::Setup {
                                    table_max: value.max_segments,
                                },
                            );
                        }
                        on_setup(&mut next, setup.insert(value))?;
                        if let Some(journal) = &mut journal {
                            journal.setup_draw(command_index, next.score_view());
                        }
                    }
                    PresentationEvent::Minimap(command) => {
                        let packet = crate::protocol::minimap::parse_minimap(&command)
                            .map_err(|error| ClientPresentationError::Minimap(error.into()))?;
                        next.minimap
                            .apply_packet(packet)
                            .map_err(ClientPresentationError::Minimap)?;
                    }
                    PresentationEvent::OwnScoreAdjustment(adjustment) => {
                        if next.own_snake().is_none() {
                            return Err(ClientPresentationError::ScoreOwnRequired.into());
                        }
                        next.own_score_adjustment = adjustment;
                    }
                    PresentationEvent::SnakeAppearance(appearance) => {
                        if next.accessory_presentation_enabled && !enable_accessory_presentation {
                            return Err(
                                ClientPresentationError::AccessoryPresentationResolverRequired
                                    .into(),
                            );
                        }
                        if next.face_presentation_enabled && !enable_face_presentation {
                            return Err(
                                ClientPresentationError::FacePresentationResolverRequired.into()
                            );
                        }
                        if next.appearance_enabled && !enable_appearance {
                            return Err(ClientPresentationError::AppearanceResolverRequired.into());
                        }
                        let setup = setup
                            .as_ref()
                            .ok_or(StateError::MissingSetup)
                            .map_err(ClientPresentationError::from)?;
                        let own = next.own_snake().is_none();
                        let TintedPresentation {
                            presentation: resolved,
                            nickname_tint,
                        } = resolve(&appearance, AppearanceContext { own })?.into();
                        // Explicit tint inputs are validated even while nicknames are off.
                        let nickname_color = nickname_tint
                            .map(|tint| tint.light_color())
                            .transpose()
                            .map_err(ClientPresentationError::from)?
                            .unwrap_or(NEUTRAL_NICKNAME_COLOR);
                        if let Some(accessory) = resolved.accessory {
                            accessory
                                .validate()
                                .map_err(ClientPresentationError::from)?;
                            if matches!(resolved.presentation.face, FaceGeometry::SingleImage(_)) {
                                return Err(ClientPresentationError::Presentation(
                                    PresentationError,
                                )
                                .into());
                            }
                        }
                        let geometry = resolved.presentation;
                        let snake = SnakePresentation::from_appearance_with_active_face_geometry(
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
                        if own {
                            next.own_score_adjustment = 0;
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
                            accessory: resolved.accessory,
                            nickname: if next.nicknames_enabled {
                                Some(RetainedNickname {
                                    text: appearance.name.clone(),
                                    color: nickname_color,
                                    state: NicknameState::new(1.)
                                        .map_err(ClientPresentationError::from)?,
                                })
                            } else {
                                None
                            },
                        });
                        next.check_limits()?;
                        if own {
                            own_length_scheduled = next.own_token();
                        }
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
                                if grew {
                                    own_length_scheduled = Some(entry.token);
                                }
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
                            if next.entries[index].own {
                                own_length_scheduled = Some(next.entries[index].token);
                            }
                        }
                    }
                    PresentationEvent::SnakeTailRemoved { id, fam } => {
                        if let Some(index) = next.lookup_index(id) {
                            next.entries[index]
                                .snake
                                .remove_tail(fam, next.camera.zoom())
                                .map_err(ClientPresentationError::from)?;
                            if next.entries[index].own {
                                own_length_scheduled = Some(next.entries[index].token);
                            }
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
            if let Some(journal) = &mut journal {
                if let Some(token) = own_length_scheduled {
                    journal.push(
                        command_index,
                        HudIngressEventKind::OwnLengthScheduled { token },
                    );
                }
                match boundary.marker {
                    HudCommandMarker::Other => {}
                    HudCommandMarker::Announcement(packet) => {
                        next.announcements
                            .receive(&packet, next.score_tables.as_deref())
                            .map_err(|error| {
                                ClientPresentationError::from(StateError::Hud(
                                    super::HudIngressError::Announcement(error),
                                ))
                            })?;
                    }
                    HudCommandMarker::Leaderboard {
                        local_row,
                        rank,
                        population,
                        death_pending,
                        rows,
                    } => {
                        if next.announcements_enabled {
                            next.announcements.leaderboard(death_pending);
                        }
                        journal.push(
                            command_index,
                            HudIngressEventKind::Leaderboard {
                                local_row,
                                rank,
                                population,
                                death_pending,
                            },
                        );
                        if let Some(rows) = rows {
                            journal.push_leaderboard_rows(rows);
                        }
                    }
                    HudCommandMarker::FinalCapture => {
                        let view = next.score_view();
                        if !matches!(view.status, ScoreStatus::Ready(_)) {
                            return Err(ClientPresentationError::FinalScoreUnavailable(
                                view.status,
                            )
                            .into());
                        }
                        journal.push(command_index, HudIngressEventKind::FinalScore { view });
                    }
                }
            }
            event_start = boundary.event_end;
        }
        next.received = received;
        *self = next;
        Ok((applied.report, journal))
    }

    /// Advance the boundary and current draw collection, then retire completed deaths.
    /// An undrawn retained own object still accepts packets but stops animating.
    pub fn advance(
        &mut self,
        now_ms: f64,
        lagging: bool,
    ) -> Result<FrameStep, ClientPresentationError> {
        self.advance_with_control(now_ms, lagging, |_, _| Ok(ClientControlActions::default()))
    }

    /// Compute one retained-clock step, call control once before any entity moves,
    /// then apply gaze, world reset, lag reset and connection override in that order.
    /// Resets retain the computed step. Any error preserves the entire original
    /// model, including its clock. Callback sends and other external effects cannot
    /// roll back; callers must not automatically replay a failed control update.
    pub fn advance_with_control<E, F>(
        &mut self,
        now_ms: f64,
        lagging: bool,
        control: F,
    ) -> Result<FrameStep, E>
    where
        E: From<ClientPresentationError>,
        F: FnOnce(FrameStep, ClientControlView) -> Result<ClientControlActions, E>,
    {
        let mut next = self.clone();
        let step = next
            .clock
            .advance(now_ms, lagging, false)
            .map_err(ClientPresentationError::from)?;
        let actions = control(step, next.control_view())?;
        if let Some(heading) = actions.gaze_heading {
            finite(&[heading]).map_err(ClientPresentationError::from)?;
        }
        if let Some(fraction) = actions.minimap_ui_fraction {
            finite(&[fraction]).map_err(ClientPresentationError::from)?;
        }
        if let Some(heading) = actions.gaze_heading {
            next.set_own_gaze_heading(heading)?;
        }
        if actions.reset_world {
            next.reset();
        }
        if actions.reset_lag {
            next.reset_lag();
        }
        if let Some(connected) = actions.connected {
            next.set_connected(connected);
        }
        if let Some(fraction) = actions.minimap_ui_fraction {
            next.observe_minimap_ui_fraction(fraction)?;
        }
        if let Some(lifecycle) = actions.announcement_lifecycle
            && next.announcements_enabled
        {
            next.announcements
                .advance(step.delta, lifecycle)
                .map_err(ClientPresentationError::from)?;
        }
        next.advance_entities(step, now_ms)?;
        *self = next;
        Ok(step)
    }

    fn advance_entities(
        &mut self,
        step: FrameStep,
        now_ms: f64,
    ) -> Result<(), ClientPresentationError> {
        if let Some(boundary) = &mut self.boundary {
            boundary.advance(step.whole_steps, self.connected);
        }
        if self.minimap_enabled {
            self.minimap
                .advance(
                    MinimapUpdateInput {
                        now_ms,
                        step,
                        connected: self.connected,
                        center: self.received.setup.as_ref().map(|setup| setup.grid_center),
                        displayed_radius: self.boundary.as_ref().map(BoundaryRadius::displayed),
                        own_raw_head: self.own_snake().map(|snake| snake.metrics().raw_head),
                    },
                    Some(now_ms),
                )
                .map_err(ClientPresentationError::Minimap)?;
        }
        for entry in &mut self.entries {
            if entry.drawn && !entry.snake.advance(step)? {
                entry.drawn = false;
            }
        }
        let entries = &self.entries;
        let prey_turn_rate = self.received.setup.as_ref().map_or(0., |s| s.mamu2);
        self.preys.advance(step, prey_turn_rate, |token| {
            entries
                .iter()
                .find(|entry| entry.token == token)
                .map(Entry::eater_pose)
                .ok_or(PreyError::MissingEater(token))
        })?;
        self.foods.advance(step, |token| {
            entries
                .iter()
                .find(|entry| entry.token == token)
                .map(Entry::eater_pose)
                .ok_or(FoodError::MissingEater(token))
        })?;
        self.retire_entries();
        Ok(())
    }

    /// Gate boundary consumption and minimap fade/transition without advancing
    /// clocks, consuming samples or changing entity-animation eligibility.
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

    /// Retained background phase. Reset preserves it and its camera baseline.
    pub fn background(&self) -> &BackgroundState {
        &self.background
    }

    /// Plan a background after this draw's camera preparation. The first call
    /// establishes a camera baseline at zero phase; later calls use camera
    /// displacement even without an own snake. This authored policy survives
    /// reset. Input zoom controls projection without changing the camera.
    pub fn prepare_background(
        &mut self,
        input: BackgroundInput,
    ) -> Result<BackgroundPlan, ClientPresentationError> {
        let camera = self.camera.position();
        let mut background = self.background;
        if let Some(previous) = self.background_camera {
            background.advance_draw(previous, camera, input.tile_width, input.tile_height)?;
        }
        let plan = background.plan(input)?;
        self.background = background;
        self.background_camera = Some(camera);
        Ok(plan)
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

    /// Prepare once with a style resolved for each visible appearance, as the
    /// Canvas adapter does. A failed resolver leaves the complete client intact.
    pub fn prepare_draw_resolved<E, F>(
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
        let mut next = self.clone();
        let prepared =
            next.prepare_draw_resolved_staged(width, height, quality_scale, resolve_style)?;
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

    /// Prepare one numeric draw with explicit tagged faces and ordered antenna randomness.
    /// This consumes the same camera, spacing and eye transition as rendering;
    /// do not prepare again for the same draw. Callback effects cannot roll back.
    pub fn prepare_draw_with_face_presentation<E, R>(
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
        let prepared = next.prepare_draw_resolved_with_face_presentation_limited_staged(
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

    /// Prepare one numeric draw with static accessories, tagged faces and antenna randomness.
    /// This consumes the same camera, spacing and eye transition as rendering;
    /// do not prepare again for the same draw. Callback effects cannot roll back.
    pub fn prepare_draw_with_accessory_presentation<E, R>(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        detailed_style: bool,
        resolve_random: R,
    ) -> Result<Vec<PreparedAccessorySnake>, E>
    where
        E: From<ClientPresentationError>,
        R: FnMut(AntennaRandomRequest) -> Result<Vec<[f64; 2]>, E>,
    {
        let mut next = self.clone();
        let prepared = next.prepare_draw_resolved_with_accessory_presentation_limited_staged(
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
            false,
            false,
        )
        .map(|prepared| prepared.into_iter().map(|value| value.snake).collect())
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
            false,
            false,
        )
        .map(|prepared| prepared.into_iter().map(|value| value.snake).collect())
    }

    /// Prepare once on a disposable stage with aggregate sample and antenna limits.
    /// The caller must discard both client and budget after any later failure.
    /// Share this budget across all ordered Setup plans in the same ingress.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_draw_resolved_with_face_presentation_limited_staged<E, F, R>(
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
            true,
            false,
        )
        .map(|prepared| prepared.into_iter().map(|value| value.snake).collect())
    }

    /// Prepare once on a disposable stage with aggregate sample and antenna limits.
    /// The caller must discard both client and budget after any later failure.
    /// Share this budget across all ordered Setup plans in the same ingress.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_draw_resolved_with_accessory_presentation_limited_staged<E, F, R>(
        &mut self,
        width: u32,
        height: u32,
        quality_scale: f64,
        sample_limit: usize,
        antenna_budget: &mut AntennaDrawBudget,
        resolve_style: F,
        resolve_random: R,
    ) -> Result<Vec<PreparedAccessorySnake>, E>
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
            true,
            true,
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
        allow_face_presentation: bool,
        allow_accessory_presentation: bool,
    ) -> Result<Vec<PreparedAccessorySnake>, E>
    where
        E: From<ClientPresentationError>,
        F: FnMut(usize, bool, &SnakePresentation) -> Result<bool, E>,
        R: FnMut(AntennaRandomRequest) -> Result<Vec<[f64; 2]>, E>,
    {
        validate_draw_inputs(width, height, quality_scale)?;
        // A legacy caller must fail before any camera, cull, serial, curve or RNG
        // transition. Project only the camera copy to test this draw's visibility.
        if !allow_accessory_presentation
            && self.entries.iter().any(|entry| entry.accessory.is_some())
        {
            let mut camera = self.camera.clone();
            if let Some(own) = self.own_snake() {
                let metrics = own.metrics();
                camera
                    .prepare_draw(metrics.corrected_head, metrics.logical_segments as u32)
                    .map_err(ClientPresentationError::from)?;
            }
            let position = camera.position();
            let half_width = f64::from(width) / 2. / camera.zoom() + 84.;
            let half_height = f64::from(height) / 2. / camera.zoom() + 84.;
            let left = position.x - half_width;
            let right = position.x + half_width;
            let top = position.y - half_height;
            let bottom = position.y + half_height;
            finite(&[left, right, top, bottom]).map_err(ClientPresentationError::from)?;
            if self.entries.iter().any(|entry| {
                entry.drawn
                    && entry.accessory.is_some()
                    && !entry.snake.metrics().expired
                    && entry.snake.body().points().iter().any(|point| {
                        let position = point.position();
                        let offset = point.position_offset();
                        let x = position.x + offset.x;
                        let y = position.y + offset.y;
                        x >= left && y >= top && x <= right && y <= bottom
                    })
            }) {
                return Err(ClientPresentationError::AccessoryPresentationRequired.into());
            }
        }
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
        next.nickname_draws.clear();
        for entry in next.entries.iter_mut().filter(|entry| entry.drawn) {
            let Some(nickname) = &mut entry.nickname else {
                continue;
            };
            let metrics = entry.snake.metrics();
            if let Some(draw) = nickname
                .state
                .draw(NicknameInput {
                    text: &nickname.text,
                    color: nickname.color,
                    corrected_head: metrics.corrected_head,
                    camera,
                    viewport_half: Point {
                        x: f64::from(width) / 2.,
                        y: f64::from(height) / 2.,
                    },
                    zoom: next.camera.zoom(),
                    scale: metrics.scale,
                    spawn_progress: metrics.spawn_progress,
                    death_progress: metrics.death_progress,
                    own: entry.own,
                    bounds: NicknameCullBounds {
                        left,
                        right,
                        top,
                        bottom,
                    },
                })
                .map_err(ClientPresentationError::from)?
            {
                next.nickname_draws.push(draw);
            }
        }
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
        if !allow_face_presentation
            && next.entries.iter().any(|entry| {
                let metrics = entry.snake.metrics();
                entry.drawn
                    && metrics.visible
                    && !metrics.expired
                    && entry.snake.active_face_geometry().paired().is_none()
            })
        {
            return Err(ClientPresentationError::FacePresentationRequired.into());
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
            prepared.push(PreparedAccessorySnake {
                snake: PreparedSnake {
                    token: entry.token,
                    draw_ordinal,
                    own: entry.own,
                    metrics: entry.snake.metrics(),
                    curve,
                    body_geometry,
                    face_heading,
                    pupil: entry.snake.eyes().pupil(),
                    face_geometry: *entry.snake.active_face_geometry(),
                    eye_geometry: entry.snake.eye_geometry().copied(),
                    face_decoration: entry.snake.face_geometry().and_then(|face| face.decoration),
                    antenna_geometry,
                    antenna,
                },
                accessory: entry.accessory,
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

    /// Whether later appearances require the complete tagged face resolver.
    pub fn face_presentation_enabled(&self) -> bool {
        self.face_presentation_enabled
    }

    /// Whether later appearances require the context-aware accessory resolver.
    pub fn accessory_presentation_enabled(&self) -> bool {
        self.accessory_presentation_enabled
    }

    /// Numeric accessory owned by this stable object, including undrawn retained own.
    pub fn static_accessory_geometry(
        &self,
        token: SnakeObjectToken,
    ) -> Option<&StaticHeadAccessoryGeometry> {
        self.entries
            .iter()
            .find(|entry| entry.token == token)
            .and_then(|entry| entry.accessory.as_ref())
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

    fn background_input(client: &AnimatedClient, width: u32, height: u32) -> BackgroundInput {
        BackgroundInput {
            width,
            height,
            zoom: client.camera().zoom(),
            image_size: Some([512, 512]),
            pattern_available: true,
            quality: crate::presentation::QualityState::new(
                crate::presentation::QualityMode::High,
                0.,
            )
            .unwrap()
            .snapshot(),
            tile_width: 64.,
            tile_height: 32.,
        }
    }

    #[test]
    fn background_first_draw_resize_and_reset_retain_camera_baseline() {
        let mut client = AnimatedClient::new(0.).unwrap();
        client.set_follows(false);
        client
            .set_camera_position(Point { x: 100., y: 200. })
            .unwrap();
        client.set_zoom(2.).unwrap();
        client.prepare_draw(801, 603).unwrap();
        let first = client
            .prepare_background(background_input(&client, 801, 603))
            .unwrap();
        assert_eq!(first.pattern.unwrap().translation, Point::default());

        client
            .set_camera_position(Point { x: 116., y: 192. })
            .unwrap();
        client.prepare_draw(801, 603).unwrap();
        let moved = client
            .prepare_background(background_input(&client, 801, 603))
            .unwrap();
        assert_eq!(moved.pattern.unwrap().translation, Point { x: 48., y: 8. });
        let phase = *client.background();
        client.advance(8., false).unwrap();
        assert_eq!(*client.background(), phase);

        client.set_zoom(0.5).unwrap();
        client.prepare_draw(1280, 720).unwrap();
        let resized = client
            .prepare_background(background_input(&client, 1280, 720))
            .unwrap();
        assert_eq!(resized.pattern.unwrap().center, Point { x: 640., y: 360. });
        assert_eq!(
            resized.pattern.unwrap().translation,
            moved.pattern.unwrap().translation
        );
        assert_eq!(resized.image.unwrap().destination, [0., 0., 1280., 720.]);
        assert_eq!(*client.background(), phase);

        client.reset();
        assert_eq!(*client.background(), phase);
        client
            .set_camera_position(Point { x: 132., y: 200. })
            .unwrap();
        client.prepare_draw(1280, 720).unwrap();
        let reset = client
            .prepare_background(background_input(&client, 1280, 720))
            .unwrap();
        assert_eq!(reset.pattern.unwrap().translation, Point { x: 32., y: 0. });
        assert_eq!(reset.pattern.unwrap().zoom, client.camera().zoom());
    }

    #[test]
    fn background_ordered_setup_draws_freeze_each_camera_and_viewport() {
        let mut client = AnimatedClient::new(3.).unwrap();
        let clock = client.clock.clone();
        let mut plans = Vec::new();
        client
            .apply_frame_with_factories_and_setup(
                &bundle(&[setup(), setup()]),
                ElapsedHeader::Absent,
                |_| panic!("no appearance"),
                |_, _| panic!("no food"),
                |stage, _| {
                    let (camera, width, height) = if plans.is_empty() {
                        (Point { x: 100., y: 200. }, 801, 603)
                    } else {
                        (Point { x: 116., y: 192. }, 1280, 720)
                    };
                    stage.set_camera_position(camera)?;
                    stage.prepare_draw(width, height)?;
                    plans.push(stage.prepare_background(background_input(stage, width, height))?);
                    Ok::<_, ClientPresentationError>(())
                },
            )
            .unwrap();
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].clear.rect, [0., 0., 801., 603.]);
        assert_eq!(plans[0].pattern.unwrap().translation, Point::default());
        assert_eq!(plans[1].clear.rect, [0., 0., 1280., 720.]);
        assert_eq!(
            plans[1].pattern.unwrap().translation,
            Point { x: 48., y: 8. }
        );
        assert_eq!(client.background().phase(), Point { x: 0.75, y: 0.25 });
        assert_eq!(client.clock, clock);
    }

    #[test]
    fn score_cache_shares_equal_setup_and_reset_but_replaces_changed_parameter() {
        let mut client = AnimatedClient::new(0.).unwrap();
        client.enable_score_tracking().unwrap();
        apply(&mut client, &setup());
        let first = client.score_tables.clone().unwrap();
        apply(&mut client, &setup());
        assert!(Arc::ptr_eq(client.score_tables.as_ref().unwrap(), &first));
        client.reset();
        assert!(Arc::ptr_eq(client.score_tables.as_ref().unwrap(), &first));
        let mut changed = setup();
        changed[4..6].copy_from_slice(&17_u16.to_be_bytes());
        apply(&mut client, &changed);
        assert!(!Arc::ptr_eq(client.score_tables.as_ref().unwrap(), &first));
        assert_eq!(first.table_max(), 430);
        assert_eq!(client.score_view().table_max, Some(17));
    }

    #[test]
    fn single_eye_legacy_gate_precedes_every_style_and_random_callback() {
        let mut client = AnimatedClient::new(0.).unwrap();
        client
            .apply_frame_with_face_presentation::<ClientPresentationError, _>(
                &bundle(&[setup(), spawn(3, 11), spawn(8, 19)]),
                ElapsedHeader::Absent,
                |a| {
                    Ok(FacePresentation {
                        face: if a.custom_skin == [3] {
                            FaceGeometry::default()
                        } else {
                            FaceGeometry::SingleImage(super::super::SingleEyeGeometry {
                                base_size: 20.,
                                pupil_size: 8.,
                                pupil_travel: 3.,
                            })
                        },
                        antenna: None,
                    })
                },
            )
            .unwrap();
        let saved = client.clone();
        let mut stage = client.clone();
        assert_eq!(
            stage
                .prepare_draw_resolved_with_antenna_limited_staged::<ClientPresentationError, _, _>(
                    960,
                    540,
                    1.,
                    MAX_DRAW_SAMPLES,
                    &mut AntennaDrawBudget::default(),
                    |_, _, _| panic!("all visible face capabilities must be checked first"),
                    |_| panic!("legacy rejection must precede randomness"),
                ),
            Err(ClientPresentationError::FacePresentationRequired)
        );
        assert_eq!(client, saved);
        let mut stage = saved.clone();
        assert_eq!(
            stage.prepare_draw_resolved_limited_staged::<ClientPresentationError, _>(
                960,
                540,
                1.,
                MAX_DRAW_SAMPLES,
                |_, _, _| panic!("non-antenna legacy gate must also precede callbacks"),
            ),
            Err(ClientPresentationError::FacePresentationRequired)
        );
    }

    #[test]
    fn single_eye_generalized_helper_shares_sample_and_antenna_budgets_across_setup_plans() {
        let mut client = AnimatedClient::new(0.).unwrap();
        let mut styles = Vec::new();
        let mut budget = AntennaDrawBudget::default();
        let initial_budget = budget;
        client
            .apply_frame_with_face_presentation_and_factories_and_setup::<ClientPresentationError, _, _, _>(
                &bundle(&[setup(), spawn(3, 11), setup()]),
                ElapsedHeader::Absent,
                |_| Ok(FacePresentation {
                    face: FaceGeometry::SingleImage(super::super::SingleEyeGeometry {
                        base_size: 20., pupil_size: 8., pupil_travel: 3.,
                    }),
                    antenna: None,
                }),
                factory,
                |stage, _| {
                    let draw = stage.prepare_draw_resolved_with_face_presentation_limited_staged(
                        960, 540, 1., MAX_DRAW_SAMPLES, &mut budget,
                        |_, _, snake| { styles.push(*snake.active_face_geometry()); Ok(false) },
                        |_| -> Result<_, ClientPresentationError> { panic!("image eyes have no RNG visit") },
                    )?;
                    assert_eq!(draw.len(), styles.len());
                    Ok(())
                },
            )
            .unwrap();
        assert_eq!(client.draw_serial(), 2);
        assert_eq!(styles.len(), 1);
        assert_eq!(budget, initial_budget);
        let saved = client.clone();
        let mut stage = client.clone();
        assert_eq!(
            stage.prepare_draw_resolved_with_face_presentation_limited_staged::<ClientPresentationError, _, _>(
                960, 540, 1., 0, &mut budget,
                |_, _, _| Ok(false),
                |_| panic!("sample rejection precedes RNG"),
            ),
            Err(ClientPresentationError::Limit)
        );
        assert_eq!(client, saved);
        let mut retained_budget = AntennaDrawBudget::default();
        let mut legacy = antenna_client();
        let mut tagged = legacy.clone();
        let old = legacy
            .prepare_draw_resolved_with_antenna_limited_staged(
                960,
                540,
                1.,
                MAX_DRAW_SAMPLES,
                &mut retained_budget,
                |_, _, _| Ok(false),
                |r| Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count]),
            )
            .unwrap();
        let mut tagged_budget = AntennaDrawBudget::default();
        let new = tagged
            .prepare_draw_resolved_with_face_presentation_limited_staged(
                960,
                540,
                1.,
                MAX_DRAW_SAMPLES,
                &mut tagged_budget,
                |_, _, _| Ok(false),
                |r| Ok::<_, ClientPresentationError>(vec![[0.2, 0.8]; r.random_pair_count]),
            )
            .unwrap();
        assert_eq!(old, new);
        assert_eq!(legacy, tagged);
        assert_eq!(retained_budget, tagged_budget);
    }

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
            let mut adapter = client.clone();
            let c = adapter
                .prepare_draw_resolved(960, 540, 1.3, |_, _, _| {
                    Ok::<_, ClientPresentationError>(detailed)
                })
                .unwrap();
            assert_eq!(a, c);
            assert_eq!(uniform, adapter);
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
        assert!(
            client
                .prepare_draw_resolved(960, 540, 1., |ordinal, _, _| {
                    if ordinal == 1 {
                        Err(ClientPresentationError::Limit)
                    } else {
                        Ok(true)
                    }
                })
                .is_err()
        );
        assert_eq!(client, saved);
    }
    mod static_accessory_native_tests {
        use super::*;

        fn selected(custom: u8) -> AccessoryPresentation {
            AccessoryPresentation {
                presentation: FacePresentation::default(),
                accessory: (custom == 8).then_some(StaticHeadAccessoryGeometry {
                    forward: 5.,
                    image_scale: 0.25,
                    pivot_x: -0.,
                    pivot_y: 7.,
                }),
            }
        }

        #[test]
        fn every_legacy_staged_planner_rejects_before_style_random_or_any_model_write() {
            let mut client = AnimatedClient::new(0.).unwrap();
            client
                .apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
                    &bundle(&[setup(), spawn(3, 11), spawn(8, 19)]),
                    ElapsedHeader::Absent,
                    |appearance, _| Ok(selected(appearance.custom_skin[0])),
                )
                .unwrap();
            let saved = client.clone();
            let mut budget = AntennaDrawBudget::default();
            let saved_budget = budget;
            let mut stage = saved.clone();
            assert_eq!(stage.prepare_draw_resolved_with_face_presentation_limited_staged::<ClientPresentationError, _, _>(
                960, 540, 1., MAX_DRAW_SAMPLES, &mut budget,
                |_, _, _| panic!("legacy style callback must not run"),
                |_| panic!("legacy random callback must not run"),
            ), Err(ClientPresentationError::AccessoryPresentationRequired));
            assert_exact_client(&stage, &saved);
            assert_eq!(budget, saved_budget);
            let mut stage = saved.clone();
            assert_eq!(stage.prepare_draw_resolved_with_antenna_limited_staged::<ClientPresentationError, _, _>(
                960, 540, 1., MAX_DRAW_SAMPLES, &mut budget,
                |_, _, _| panic!("legacy style callback must not run"),
                |_| panic!("legacy random callback must not run"),
            ), Err(ClientPresentationError::AccessoryPresentationRequired));
            assert_exact_client(&stage, &saved);
            assert_eq!(budget, saved_budget);
            let mut stage = saved.clone();
            assert_eq!(
                stage.prepare_draw_resolved_limited_staged::<ClientPresentationError, _>(
                    960,
                    540,
                    1.,
                    MAX_DRAW_SAMPLES,
                    |_, _, _| panic!("legacy style callback must not run"),
                ),
                Err(ClientPresentationError::AccessoryPresentationRequired)
            );
            assert_exact_client(&stage, &saved);
        }

        #[test]
        fn accessory_staged_planner_traverses_once_and_preserves_shared_limits() {
            let mut client = AnimatedClient::new(0.).unwrap();
            client
                .apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
                    &bundle(&[setup(), spawn(3, 11), spawn(8, 19)]),
                    ElapsedHeader::Absent,
                    |appearance, _| Ok(selected(appearance.custom_skin[0])),
                )
                .unwrap();
            let mut budget = AntennaDrawBudget::default();
            let initial_budget = budget;
            let mut stage = client.clone();
            let mut visits = Vec::new();
            let prepared = stage.prepare_draw_resolved_with_accessory_presentation_limited_staged::<ClientPresentationError, _, _>(
                960, 540, 1., MAX_DRAW_SAMPLES, &mut budget,
                |ordinal, own, snake| { visits.push((ordinal, own, snake.custom_skin().to_vec())); Ok(false) },
                |_| panic!("no antenna"),
            ).unwrap();
            assert_eq!(visits, [(0, true, vec![3]), (1, false, vec![8])]);
            assert_eq!(stage.draw_serial(), client.draw_serial() + 1);
            assert_eq!(budget, initial_budget);
            assert_eq!(prepared.len(), 2);
            assert!(prepared[0].accessory.is_none() && prepared[1].accessory.is_some());
            let samples = prepared
                .iter()
                .map(|snake| {
                    snake
                        .snake
                        .curve
                        .as_ref()
                        .map_or(0, |curve| curve.samples.len())
                })
                .sum::<usize>();
            assert!(samples > 0);
            let mut stage = client.clone();
            assert!(stage.prepare_draw_resolved_with_accessory_presentation_limited_staged::<ClientPresentationError, _, _>(
                960, 540, 1., samples - 1, &mut budget, |_, _, _| Ok(false), |_| panic!("no antenna"),
            ).is_err());
            let mut stage = client.clone();
            let mut visits = 0;
            assert_eq!(
                stage.prepare_draw_resolved_with_accessory_presentation_limited_staged(
                    960,
                    540,
                    1.,
                    MAX_DRAW_SAMPLES,
                    &mut budget,
                    |_, _, _| {
                        visits += 1;
                        if visits == 2 {
                            Err(ClientPresentationError::Limit)
                        } else {
                            Ok(false)
                        }
                    },
                    |_| panic!("no antenna"),
                ),
                Err(ClientPresentationError::Limit)
            );
            assert_eq!(visits, 2);
        }
    }
}
