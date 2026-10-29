//! Browser ownership of the coupled model; caller-supplied time and borrowed assets.

use std::{cell::RefCell, f64::consts::TAU};

use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

use crate::{
    antenna_browser::{AntennaDecoration, appearance as parse_appearance},
    body_browser::{
        BorrowedSources, Recipe, ResolveError, appearance_request, nickname_tint, paired_face,
        request, same_decoration, same_eyes, standard_eyes,
    },
    canvas_browser::{CanvasFrame, CanvasPreflight, draw_sprite, validate_background_image},
    face_browser::{
        AccessorySources, FaceSources, accessory_appearance as parse_accessory_presentation,
        appearance as parse_face_presentation,
    },
    food_browser::FoodSources,
    presentation::{
        AccessoryPresentation, AnimatedClient, AntennaDrawBudget, AntennaPath,
        AntennaRandomRequest, AppearanceContext, AppearancePresentation, ArenaEdgeInput,
        ArenaEdgePlan, BackgroundInput, BackgroundPlan, BodyFade, BodyPaintError, BodyPaintInput,
        BodyPaintPlan, BodyPaintQuality, BodyPaintView, BodyPaintVisual, BodyVariantMode,
        ClientControlActions, ClientControlView, ClientScoreView, CurveInput, CurveOutput,
        EyeLayoutInput, FaceGeometry, FacePresentation, FoodImageCommand, FoodPaintInput,
        FoodPaintPlan, HudCommandGuard, HudIngressEventKind, HudIngressPlan, HudIngressReport,
        LeaderboardRowScore, LeaderboardScoreInput,
        LeaderboardScoreProjector as NativeLeaderboardScoreProjector, MAX_BODY_PAINT_COMMANDS,
        MAX_DRAW_SAMPLES, MAX_RETAINED_SNAKES, MinimapLayout, MinimapWidgetPlan, MouthFaceLayout,
        NicknameAlignment, NicknameBaseline, NicknameDraw, OrdinaryAntennaGeometry,
        PairedSideLayout, PreparedAccessorySnake, PreparedAntenna, PreparedSnake, PreyEaterPose,
        PreyImageCommand, PreyPaintInput, PreyPaintPlan, QualityMode, QualitySnapshot, ScoreError,
        ScoreStatus, SingleEyeLayout, SkinDescriptor, SkinFaceSources, SkinImage, SkinSourceRole,
        SnakePresentation, StandardEyeLayout, StaticHeadAccessoryGeometry,
        StaticHeadAccessoryLayout, TintedPresentation, Turn, plan_arena_edge, plan_food, plan_prey,
        plan_standard_body, plan_standard_body_with_antenna, resolve_authored_local_skin,
        resolve_skin as native_resolve_skin, sample_curve_with_heading,
    },
    presentation_browser::AnimationStep,
    prey_browser::PreySources,
    protocol::{ElapsedHeader, MAX_FRAME_BYTES},
    quality_browser::DesktopQuality,
    state::{Food, Point, Setup},
};

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn record<const N: usize>(fields: [(&str, JsValue); N]) -> Result<JsValue, JsValue> {
    let value = js_sys::Object::new();
    for (key, field) in fields {
        if !js_sys::Reflect::set(&value, &JsValue::from_str(key), &field)? {
            return Err(error("could not construct food diagnostics"));
        }
    }
    Ok(value.into())
}

fn serial(value: u64) -> JsValue {
    js_sys::BigInt::from(value).into()
}

enum ApplyRenderResult {
    Legacy(u32),
    Hud(JsValue),
}

impl ApplyRenderResult {
    fn legacy(self) -> Result<u32, JsValue> {
        match self {
            Self::Legacy(count) => Ok(count),
            Self::Hud(_) => Err(error("unexpected HUD render result")),
        }
    }

    fn hud(self) -> Result<JsValue, JsValue> {
        match self {
            Self::Hud(report) => Ok(report),
            Self::Legacy(_) => Err(error("missing HUD render result")),
        }
    }
}

fn control_actions(value: &JsValue) -> Result<ClientControlActions, JsValue> {
    if !value.is_object() || value.is_null() {
        return Err(error(
            "control callback must return a synchronous action record",
        ));
    }
    // Catch structural proxy failures too, so parsing always returns through the
    // borrowed export and releases its mutable scene borrow.
    let prototype = js_sys::Reflect::get_prototype_of(value)?;
    if !prototype.is_null()
        && !js_sys::Object::is(
            &prototype,
            &js_sys::Object::get_prototype_of(&js_sys::Object::new()),
        )
    {
        return Err(error(
            "control actions require a plain or null-prototype record",
        ));
    }
    let mut actions = ClientControlActions::default();
    for key in js_sys::Reflect::own_keys(value)? {
        let name = key
            .as_string()
            .ok_or_else(|| error("unknown control action"))?;
        if !matches!(
            name.as_str(),
            "gazeHeading"
                | "resetWorld"
                | "resetLag"
                | "connected"
                | "minimapUiFraction"
                | "announcementLifecycle"
        ) {
            return Err(error("unknown control action"));
        }
        // Descriptors reject metadata getters without invoking them. Proxy traps
        // remain effects of the trusted synchronous caller capability.
        let descriptor = js_sys::Reflect::get_own_property_descriptor(
            value.unchecked_ref::<js_sys::Object>(),
            &key,
        )?;
        if descriptor.is_undefined()
            || !js_sys::Object::has_own(
                descriptor.unchecked_ref::<js_sys::Object>(),
                &"value".into(),
            )
        {
            return Err(error("control actions require own data fields"));
        }
        let field = js_sys::Reflect::get(&descriptor, &"value".into())?;
        match name.as_str() {
            "gazeHeading" => {
                if !field.is_null() {
                    actions.gaze_heading = Some(
                        field
                            .as_f64()
                            .filter(|n| n.is_finite())
                            .ok_or_else(|| error("control gaze must be finite or null"))?,
                    );
                }
            }
            "resetWorld" => actions.reset_world = crate::body_browser::flag(field)?,
            "resetLag" => actions.reset_lag = crate::body_browser::flag(field)?,
            "connected" => actions.connected = Some(crate::body_browser::flag(field)?),
            "announcementLifecycle" => {
                actions.announcement_lifecycle =
                    Some(crate::announcement_browser::lifecycle(&field)?);
            }
            "minimapUiFraction" => {
                actions.minimap_ui_fraction = Some(
                    field
                        .as_f64()
                        .filter(|fraction| fraction.is_finite())
                        .ok_or_else(|| error("minimap UI fraction must be finite"))?,
                );
            }
            _ => unreachable!(),
        }
    }
    Ok(actions)
}

fn antenna_random_accessors() -> Result<[js_sys::Function; 2], JsValue> {
    let array = js_sys::Float64Array::new_with_length(0);
    let prototype = js_sys::Object::get_prototype_of(&js_sys::Object::get_prototype_of(&array));
    let getter = |key: &JsValue| {
        let descriptor = js_sys::Object::get_own_property_descriptor(&prototype, key);
        js_sys::Reflect::get(&descriptor, &"get".into())?
            .dyn_into::<js_sys::Function>()
            .map_err(|_| error("typed-array intrinsic accessor unavailable"))
    };
    Ok([
        getter(&js_sys::Symbol::to_string_tag().into())?,
        getter(&"length".into())?,
    ])
}

thread_local! {
    static ANTENNA_RANDOM_ACCESSORS: Result<[js_sys::Function; 2], JsValue> = antenna_random_accessors();
}

fn antenna_random(
    callback: &js_sys::Function,
    input: AntennaRandomRequest,
) -> Result<Vec<[f64; 2]>, ResolveError> {
    // Capture the trusted realm's intrinsic accessors before invoking the host.
    let [brand, length] = ANTENNA_RANDOM_ACCESSORS.with(Clone::clone)?;
    let request = record([
        ("token", serial(input.token.serial())),
        ("id", input.id.into()),
        ("own", input.own.into()),
        ("drawOrdinal", (input.draw_ordinal as u32).into()),
        ("nodeCount", (input.node_count as u32).into()),
        ("randomPairCount", (input.random_pair_count as u32).into()),
        ("drawSerial", serial(input.draw_serial)),
    ])?;
    let value = callback.call1(&JsValue::UNDEFINED, &request)?;
    // Intrinsic getters inspect storage, ignoring own properties and mutated
    // prototypes. A proxy must reject before any indexed or shadowed reads.
    if !js_sys::ArrayBuffer::is_view(&value)
        || brand.call0(&value)?.as_string().as_deref() != Some("Float64Array")
    {
        return Err(error("antenna random callback must return Float64Array").into());
    }
    let count = input
        .random_pair_count
        .checked_mul(2)
        .ok_or_else(|| error("antenna random pair count overflow"))?;
    if length.call0(&value)?.as_f64() != Some(count as f64) {
        return Err(error("antenna random callback returned the wrong number of units").into());
    }
    let values: js_sys::Float64Array = value.unchecked_into();
    let mut pairs = Vec::new();
    pairs
        .try_reserve(input.random_pair_count)
        .map_err(|_| error("antenna random allocation failed"))?;
    for index in 0..input.random_pair_count {
        pairs.push([
            values.get_index((2 * index) as u32),
            values.get_index((2 * index + 1) as u32),
        ]);
    }
    Ok(pairs)
}

fn antenna_geometry_snapshot(g: OrdinaryAntennaGeometry) -> Result<JsValue, JsValue> {
    record([
        ("kind", "ordinary-chain".into()),
        ("nodes", (g.nodes as u32).into()),
        ("outerColor", g.outer_color.into()),
        ("innerColor", g.inner_color.into()),
        ("innerOpacity", g.inner_opacity.into()),
        ("repeatedInnerStrokes", g.repeated_inner_strokes.into()),
        ("rotateBulb", g.rotate_bulb.into()),
        (
            "bulb",
            record([
                ("offsetX", g.bulb.offset_x.into()),
                ("offsetY", g.bulb.offset_y.into()),
                ("width", g.bulb.width.into()),
                ("height", g.bulb.height.into()),
                ("scale", g.bulb.scale.into()),
                ("opacity", g.bulb.opacity.into()),
            ])?,
        ),
    ])
}

fn elapsed_header_kind(present: bool) -> ElapsedHeader {
    if present {
        ElapsedHeader::TwoBytes
    } else {
        ElapsedHeader::Absent
    }
}

fn registry_allowance(entries: usize, snapshots: usize) -> Result<(usize, usize), JsValue> {
    let entries = 262_144_usize
        .checked_sub(entries)
        .ok_or_else(|| error("combined food/prey catalog budget exceeded"))?;
    let snapshots = 524_288_usize
        .checked_sub(snapshots)
        .ok_or_else(|| error("combined food/prey source budget exceeded"))?;
    Ok((entries, snapshots))
}

fn validate_registries(foods: &FoodSources, preys: &PreySources) -> Result<(), JsValue> {
    let (entries, snapshots) = registry_allowance(preys.entry_count(), preys.len())?;
    if foods.entry_count() > entries || foods.len() > snapshots {
        return Err(error("combined food/prey registry budget exceeded"));
    }
    foods.validate_ready()?;
    preys.validate_ready()?;
    for (asset, object, revision) in preys.object_snapshots() {
        foods.validate_shared(object, revision, asset.width, asset.height)?;
    }
    Ok(())
}

fn validate_scene_sources(
    sources: &BorrowedSources,
    foods: &FoodSources,
    preys: &PreySources,
    target: &HtmlCanvasElement,
) -> Result<(), JsValue> {
    validate_registries(foods, preys)?;
    sources.validate(target)?;
    foods.validate(target)?;
    preys.validate(target)?;
    sources.validate_food(foods)?;
    sources.validate_prey(preys)
}

fn food_source_snapshot(source: crate::presentation::FoodSource) -> Result<JsValue, JsValue> {
    let asset = source.asset();
    record([
        ("handle", serial(asset.handle)),
        ("revision", serial(asset.revision)),
        ("intrinsicWidth", asset.width.into()),
        ("intrinsicHeight", asset.height.into()),
        ("width", source.width().into()),
        ("height", source.height().into()),
        ("halfWidth", source.half_width().into()),
        ("halfHeight", source.half_height().into()),
    ])
}

// Values are finite numbers, booleans, null, or objects assembled here. Packet
// strings are deliberately excluded from this numeric diagnostic boundary.
macro_rules! object {
    ($($key:literal: $value:expr),* $(,)?) => {{
        let fields = [$(format!(concat!("\"", $key, "\":{}"), $value)),*];
        format!("{{{}}}", fields.join(","))
    }};
}

fn dimensions(value: f64) -> Result<u32, JsValue> {
    if !value.is_finite() || value.fract() != 0. || !(1. ..=4096.).contains(&value) {
        return Err(error("draw dimensions must be integers in 1..=4096"));
    }
    Ok(value as u32)
}

fn quality(value: f64) -> Result<(), JsValue> {
    if value.is_finite() && value > 0. {
        Ok(())
    } else {
        Err(error("sampling quality must be finite and positive"))
    }
}

fn curve(
    snake: &SnakePresentation,
    quality_scale: f64,
    detailed_style: bool,
) -> Result<CurveOutput, JsValue> {
    let metrics = snake.metrics();
    sample_curve_with_heading(
        CurveInput {
            corrected_head: metrics.corrected_head,
            head_fraction: metrics.corrected_head_fraction,
            body: snake.body().points(),
            displayed_length: metrics.displayed_length,
            segment_length: snake.body().segment_length(),
            point_spacing: metrics.point_spacing,
            // AnimatedClient already advanced spacing once during draw preparation.
            target_point_spacing: metrics.point_spacing,
            quality_scale,
            detailed_style,
        },
        metrics.heading,
    )
    .map_err(error)
}

fn has_curve(snake: &SnakePresentation) -> bool {
    let metrics = snake.metrics();
    // Short appearances are accepted packet state. Wait for a second anchor
    // before sampling instead of stopping every other snake's animation.
    metrics.visible && !metrics.expired && snake.body().points().len() >= 2
}

fn turn_number(turn: Turn) -> u8 {
    match turn {
        Turn::None => 0,
        Turn::Decreasing => 1,
        Turn::Increasing => 2,
    }
}

fn snake_snapshot(snake: &SnakePresentation) -> String {
    let m = snake.metrics();
    let [offset_x, offset_y, fraction_offset] = snake.head_corrections().offset();
    let eyes = snake.eyes();
    object! {
        "id": m.id, "skin": m.skin,
        "x": m.raw_head.x, "y": m.raw_head.y,
        "correctedX": m.corrected_head.x, "correctedY": m.corrected_head.y,
        "offsetX": offset_x, "offsetY": offset_y,
        "heading": m.heading, "wantedHeading": m.wanted_heading,
        "correctedHeading": m.corrected_heading, "turn": turn_number(m.turn),
        "fraction": m.head_fraction, "fractionOffset": fraction_offset,
        "speed": m.speed_per_32ms, "fam": m.fam,
        "logicalSegments": m.logical_segments, "physicalPoints": snake.body().points().len(),
        "displayedLength": m.displayed_length, "targetLength": snake.length().target(),
        "lengthOffset": snake.length().offset(), "lengthIndex": snake.length().index(),
        "lengthPending": snake.length().pending(),
        "headIndex": snake.head_corrections().index(),
        "headPending": snake.head_corrections().pending(),
        "angleOffset": snake.angle_corrections().offset(),
        "angleIndex": snake.angle_corrections().index(),
        "anglePending": snake.angle_corrections().pending(),
        "scale": m.scale, "sizeTurnFactor": m.size_turn_factor,
        "speedTurnFactor": m.speed_turn_factor, "cruiseSpeed": m.cruise_speed,
        "boostThresholdSpeed": m.boost_threshold_speed,
        "visualSpeed": m.visual_speed, "boostPhase": m.boost_phase,
        "pointSpacing": m.point_spacing, "targetPointSpacing": m.target_point_spacing,
        "spawnProgress": m.spawn_progress, "deathProgress": m.death_progress,
        "alive": m.alive, "expired": m.expired, "visible": m.visible,
        "eyes": object! {
            "heading": eyes.heading(), "targetHeading": eyes.target_heading(),
            "turn": turn_number(eyes.turn()), "gazeHeading": eyes.gaze_heading(),
            "pupilX": eyes.pupil().x, "pupilY": eyes.pupil().y
        },
        "anchorDirection": snake.body().anchor_direction().map_or_else(|| "null".into(), |v| v.to_string())
    }
}

fn draw_eyes(context: &CanvasRenderingContext2d, layout: StandardEyeLayout) -> Result<(), JsValue> {
    let [red, green, blue] = layout.eye_color;
    let eye_color = format!("rgb({red},{green},{blue})");
    let [red, green, blue] = layout.pupil_color;
    let pupil_color = format!("rgb({red},{green},{blue})");
    // Layout already includes the viewport center and f64 head/camera arithmetic.
    context.set_transform(1., 0., 0., 1., 0., 0.)?;
    for pair in layout.pairs {
        context.set_global_alpha(layout.eye_alpha);
        context.set_fill_style_str(&eye_color);
        context.begin_path();
        context.arc(pair.eye.x, pair.eye.y, layout.eye_radius, 0., TAU)?;
        context.close_path();
        if layout.outline_width > 0. {
            context.set_stroke_style_str("#000000");
            context.set_line_width(layout.outline_width);
            context.stroke();
        }
        context.fill();
        context.set_global_alpha(layout.pupil_alpha);
        context.set_fill_style_str(&pupil_color);
        context.begin_path();
        context.arc(pair.pupil.x, pair.pupil.y, layout.pupil_radius, 0., TAU)?;
        context.close_path();
        context.fill();
    }
    Ok(())
}

fn drawn_accessory_geometry(prepared: &AnimatedClient) -> Vec<Option<StaticHeadAccessoryGeometry>> {
    prepared
        .snake_objects()
        .filter(|(_, _, drawn, _)| *drawn)
        .map(|(token, _, _, _)| prepared.static_accessory_geometry(token).copied())
        .collect()
}

mod diagnostics_browser;
mod ingress_browser;
mod leaderboard_browser;
mod plans_browser;
mod rendering_browser;
mod skin_browser;
mod views_browser;

use plans_browser::*;
pub(crate) use plans_browser::{
    FaceLayout as PreviewFaceLayout, submit_antenna as submit_preview_antenna,
    submit_selected_face as submit_preview_face,
};
use views_browser::*;

/// Coupled packet/update/draw ownership with a synthetic three-palette preview.
/// This class does not open a socket, load artwork, or start an animation loop.
#[wasm_bindgen]
pub struct AnimatedScene {
    client: AnimatedClient,
    food_sources: FoodSources,
    prey_sources: PreySources,
    background_backdrop: Option<HtmlImageElement>,
}

#[wasm_bindgen]
impl AnimatedScene {
    /// Create a session at an explicitly supplied millisecond timestamp.
    #[wasm_bindgen(constructor)]
    pub fn new(start_ms: f64) -> Result<AnimatedScene, JsValue> {
        Ok(Self {
            client: AnimatedClient::new(start_ms).map_err(error)?,
            food_sources: FoodSources::default(),
            prey_sources: PreySources::default(),
            background_backdrop: None,
        })
    }

    /// Clear the world and transient view state; retain follow preference and animation time.
    /// Construct a new scene to start a fresh timeline.
    pub fn reset(&mut self) {
        self.client.reset();
        self.food_sources.clear();
        self.prey_sources.clear();
    }

    /// Supply the optional loaded screen-filling image from the asset map.
    /// None clears it. Existing render arguments remain the repeating tile.
    /// Selection survives world reset and never loads or copies a source.
    pub fn set_background_backdrop(
        &mut self,
        image: Option<HtmlImageElement>,
    ) -> Result<(), JsValue> {
        if let Some(image) = &image {
            validate_background_image(image)?;
        }
        self.background_backdrop = image;
        Ok(())
    }

    /// Restore only the existing clock's lag multiplier, without advancing time.
    pub fn reset_lag(&mut self) {
        self.client.reset_lag();
    }

    /// Opt into score tracking before packets or after world reset. The mode and
    /// immutable table cache survive ordinary reset; legacy ingestion is the default.
    pub fn enable_score_tracking(&mut self) -> Result<(), JsValue> {
        self.client.enable_score_tracking().map_err(error)
    }

    /// Enable Rust-owned name retention and drawing before ingress.
    /// The default runtime enables this authored neutral-color slice unconditionally.
    pub fn enable_nicknames(&mut self) -> Result<(), JsValue> {
        self.client.enable_nicknames().map_err(error)
    }

    /// Select announcement admission on the existing HUD packet path.
    pub fn enable_announcement_tracking(&mut self) -> Result<(), JsValue> {
        self.client.enable_announcement_tracking().map_err(error)
    }

    /// Enable native minimap tracking before ingress or after a world reset.
    /// Selection survives resets and adds no timer, connection or scene update.
    pub fn enable_minimap_tracking(&mut self) -> Result<(), JsValue> {
        self.client.enable_minimap_tracking().map_err(error)
    }

    /// Apply an observation from the caller's existing session UI lifecycle.
    pub fn observe_minimap_ui_fraction(&mut self, fraction: f64) -> Result<(), JsValue> {
        self.client
            .observe_minimap_ui_fraction(fraction)
            .map_err(error)
    }

    /// Gate connected boundary/minimap updates; Setup activates this gate and reset clears it.
    pub fn set_connected(&mut self, connected: bool) {
        self.client.set_connected(connected);
    }

    /// Advance the animation clock and drawn entities; free the returned step.
    pub fn advance(&mut self, now_ms: f64, lagging: bool) -> Result<AnimationStep, JsValue> {
        let inner = self.client.advance(now_ms, lagging).map_err(error)?;
        self.food_sources.retain(self.client.foods().foods());
        self.prey_sources.retain(self.client.preys().preys());
        Ok(AnimationStep { inner })
    }

    /// Compute one step and synchronously obtain closed actions before motion.
    /// The callback must not reenter this borrowed scene. Return an own-data
    /// record with optional gazeHeading, resetWorld, resetLag, connected and
    /// minimapUiFraction fields;
    /// return {} for no actions. No raw Wasm step escapes into the callback.
    /// All numeric/source state rolls back on failure; external sends and host
    /// attempt state cannot. Do not automatically retry a failed callback/update.
    pub fn advance_with_control(
        &mut self,
        now_ms: f64,
        lagging: bool,
        callback: &js_sys::Function,
    ) -> Result<AnimationStep, JsValue> {
        let mut reset_world = false;
        let inner = self
            .client
            .advance_with_control::<ResolveError, _>(now_ms, lagging, |step, view| {
                let input = record([
                    ("nowMs", now_ms.into()),
                    ("wholeSteps", step.whole_steps.into()),
                    ("delta", step.delta.into()),
                    ("unlaggedDelta", step.unlagged_delta.into()),
                    ("doubleSteps", step.double_steps.into()),
                    ("lagMultiplier", step.lag_multiplier.into()),
                    ("accumulated", step.accumulated.into()),
                    ("doubledAccumulated", step.doubled_accumulated.into()),
                    ("control", control_view_record(view)?),
                ])?;
                let actions = control_actions(&callback.call1(&JsValue::UNDEFINED, &input)?)?;
                reset_world = actions.reset_world;
                Ok(actions)
            })
            .map_err(|e| e.0)?;
        if reset_world {
            self.food_sources.clear();
            self.prey_sources.clear();
        } else {
            self.food_sources.retain(self.client.foods().foods());
            self.prey_sources.retain(self.client.preys().preys());
        }
        Ok(AnimationStep { inner })
    }

    /// Set independent visual gaze on the retained original own object, including
    /// death fade. This neither sends steering nor advances an animation clock.
    pub fn set_gaze_heading(&mut self, heading: f64) -> Result<(), JsValue> {
        self.client.set_own_gaze_heading(heading).map_err(error)
    }

    /// Toggle following without advancing the camera's draw clock.
    pub fn set_follows(&mut self, follows: bool) {
        self.client.set_follows(follows);
    }

    /// Set absolute coordinates for a fixed or externally controlled camera.
    pub fn set_camera_position(&mut self, x: f64, y: f64) -> Result<(), JsValue> {
        self.client
            .set_camera_position(Point { x, y })
            .map_err(error)
    }

    /// Set zoom; source-compatible automatic adjustment resumes on the next draw.
    pub fn set_zoom(&mut self, zoom: f64) -> Result<(), JsValue> {
        self.client.set_zoom(zoom).map_err(error)
    }
}

impl AnimatedScene {
    fn apply_appearance_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: Option<&js_sys::Function>,
        resolve_prey: Option<&js_sys::Function>,
    ) -> Result<(), JsValue> {
        self.apply_face_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            resolve_prey,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_accessory_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: Option<&js_sys::Function>,
        resolve_prey: Option<&js_sys::Function>,
        generalized: bool,
    ) -> Result<(), JsValue> {
        self.apply_presentation_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            resolve_prey,
            generalized,
            true,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_face_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: Option<&js_sys::Function>,
        resolve_prey: Option<&js_sys::Function>,
        generalized: bool,
    ) -> Result<(), JsValue> {
        self.apply_presentation_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            resolve_prey,
            generalized,
            false,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_presentation_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: Option<&js_sys::Function>,
        resolve_prey: Option<&js_sys::Function>,
        generalized: bool,
        accessory: bool,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        let foods = RefCell::new(self.food_sources.clone());
        let preys = RefCell::new(self.prey_sources.clone());
        let appearance = |input: &crate::state::Appearance,
                          context: AppearanceContext|
         -> Result<_, ResolveError> {
            let request = appearance_request(input)?;
            if accessory {
                js_sys::Reflect::set(&request, &"own".into(), &context.own.into())?;
            }
            let raw = resolve_appearance.call1(&JsValue::UNDEFINED, &request)?;
            let presentation = if accessory {
                parse_accessory_presentation(&raw)?
            } else if generalized {
                AccessoryPresentation::from(parse_face_presentation(&raw)?)
            } else {
                AccessoryPresentation::from(parse_appearance(&raw)?)
            };
            Ok(TintedPresentation {
                presentation,
                nickname_tint: nickname_tint(&raw)?,
            })
        };
        let food = |spawn: &crate::state::FoodSpawnInput, zoom| -> Result<_, ResolveError> {
            let callback = resolve_food.ok_or_else(|| error("food factory resolver required"))?;
            let other = preys
                .try_borrow()
                .map_err(|_| error("prey registry already borrowed"))?;
            let (catalog, snapshots) = registry_allowance(other.entry_count(), other.len())?;
            Ok(foods
                .try_borrow_mut()
                .map_err(|_| error("food registry already borrowed"))?
                .resolve_limited(callback, spawn, zoom, catalog, snapshots)?)
        };
        let prey = |spawn: &crate::state::PreySpawnInput, zoom| -> Result<_, ResolveError> {
            let callback = resolve_prey.ok_or_else(|| error("prey factory resolver required"))?;
            let other = foods
                .try_borrow()
                .map_err(|_| error("food registry already borrowed"))?;
            let (catalog, snapshots) = registry_allowance(other.entry_count(), other.len())?;
            Ok(preys
                .try_borrow_mut()
                .map_err(|_| error("prey registry already borrowed"))?
                .resolve_limited(callback, spawn, zoom, catalog, snapshots)?)
        };
        let header = elapsed_header_kind(elapsed_header);
        // Prey resolution also enables food, matching the public factory families.
        let (enable_food, enable_prey) = (
            resolve_food.is_some() || resolve_prey.is_some(),
            resolve_prey.is_some(),
        );
        prepared
            .apply_frame_accessory_transaction(
                bytes,
                header,
                appearance,
                true,
                generalized || accessory,
                accessory,
                |spawn, zoom| {
                    if enable_food {
                        food(spawn, zoom).map(Some)
                    } else {
                        Ok(None)
                    }
                },
                enable_food,
                |spawn, zoom| {
                    if enable_prey {
                        prey(spawn, zoom).map(Some)
                    } else {
                        Ok(None)
                    }
                },
                enable_prey,
                |_, _| Ok(()),
                None,
            )
            .map_err(|e| e.0)?;
        self.commit_all(prepared, foods.into_inner(), preys.into_inner())
    }

    #[allow(clippy::too_many_arguments)]
    fn render_committed(
        &mut self,
        target: HtmlCanvasElement,
        sprites: [HtmlCanvasElement; 3],
        background: HtmlImageElement,
        lane: DrawLane<'_>,
        applied: QualitySnapshot,
    ) -> Result<(), JsValue> {
        let size = DrawSize::new(f64::from(target.width()), f64::from(target.height()))?;
        if lane.with_antenna() {
            return self.render_at_size(target, sprites, background, size, lane, applied);
        }
        let entry = size;
        let mut prepared = self.client.clone();
        let context = SceneDrawContext::committed(
            &prepared,
            size,
            &background,
            self.background_backdrop.as_ref(),
        );
        let mut sources = BorrowedSources::default();
        let mut budget = DrawBudget::default();
        let plan = PlannedScene::build(
            &mut prepared,
            &self.food_sources,
            &self.prey_sources,
            &mut sources,
            &target,
            context,
            lane,
            applied,
            &mut budget,
        )?;
        validate_scene_sources(&sources, &self.food_sources, &self.prey_sources, &target)?;
        entry.validate_entry(&target)?;
        let frame = CanvasPreflight::new(
            &target,
            &sprites,
            &background,
            size.width,
            size.height,
            plan.camera.x - context.center,
            plan.camera.y - context.center,
            plan.zoom,
            self.background_backdrop.as_ref(),
            &plan.background,
        )?
        .begin(&target, &plan.background, self.background_backdrop.as_ref())?;
        plan.submit(
            frame,
            &sprites,
            &sources,
            &self.food_sources,
            &self.prey_sources,
        )?;
        self.client = prepared;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_and_render(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: Option<&js_sys::Function>,
        target: HtmlCanvasElement,
        sprites: [HtmlCanvasElement; 3],
        background: HtmlImageElement,
        size: DrawSize,
        lane: DrawLane<'_>,
        applied: QualitySnapshot,
        hud: Option<HudIngressPlan<'_>>,
    ) -> Result<ApplyRenderResult, JsValue> {
        let entry = DrawSize::entry(&target);
        let mut prepared = self.client.clone();
        let food_sources = RefCell::new(self.food_sources.clone());
        let prey_sources = RefCell::new(self.prey_sources.clone());
        let mut sources = BorrowedSources::default();
        let mut plans = Vec::new();
        let mut budget = DrawBudget::default();
        let mut setup_budget = SetupDrawBudget::default();
        let appearance = |input: &crate::state::Appearance,
                          context: AppearanceContext|
         -> Result<_, ResolveError> {
            let request = appearance_request(input)?;
            if lane.with_accessory_presentation() {
                js_sys::Reflect::set(&request, &"own".into(), &context.own.into())?;
            }
            let raw = resolve_appearance.call1(&JsValue::UNDEFINED, &request)?;
            let presentation = if lane.with_accessory_presentation() {
                parse_accessory_presentation(&raw)?
            } else if lane.with_face_presentation() {
                AccessoryPresentation::from(parse_face_presentation(&raw)?)
            } else if lane.with_antenna() {
                AccessoryPresentation::from(parse_appearance(&raw)?)
            } else {
                AccessoryPresentation::from(FacePresentation {
                    face: FaceGeometry::Paired(paired_face(&raw)?),
                    antenna: None,
                })
            };
            Ok(TintedPresentation {
                presentation,
                nickname_tint: nickname_tint(&raw)?,
            })
        };
        let food_factory =
            |spawn: &crate::state::FoodSpawnInput, zoom| -> Result<_, ResolveError> {
                let other = prey_sources
                    .try_borrow()
                    .map_err(|_| error("prey registry already borrowed"))?;
                let (catalog, snapshots) = registry_allowance(other.entry_count(), other.len())?;
                Ok(food_sources
                    .try_borrow_mut()
                    .map_err(|_| error("food registry already borrowed"))?
                    .resolve_limited(resolve_food, spawn, zoom, catalog, snapshots)?)
            };
        let prey_factory = |spawn: &crate::state::PreySpawnInput,
                            zoom|
         -> Result<_, ResolveError> {
            let callback = resolve_prey.ok_or_else(|| error("prey factory resolver required"))?;
            let other = food_sources
                .try_borrow()
                .map_err(|_| error("food registry already borrowed"))?;
            let (catalog, snapshots) = registry_allowance(other.entry_count(), other.len())?;
            Ok(prey_sources
                .try_borrow_mut()
                .map_err(|_| error("prey registry already borrowed"))?
                .resolve_limited(callback, spawn, zoom, catalog, snapshots)?)
        };
        let mut on_setup =
            |client: &mut AnimatedClient, setup: &Setup| -> Result<(), ResolveError> {
                setup_budget.charge(size)?;
                let context = SceneDrawContext::at_setup(
                    client,
                    size,
                    Some(setup),
                    &background,
                    self.background_backdrop.as_ref(),
                );
                // Finish host callbacks before borrowing the food registry.
                let paint = build_paint(
                    client,
                    &mut sources,
                    &target,
                    size,
                    lane,
                    applied,
                    &mut budget,
                )?;
                let mut foods = food_sources
                    .try_borrow_mut()
                    .map_err(|_| error("food registry already borrowed"))?;
                let mut preys = prey_sources
                    .try_borrow_mut()
                    .map_err(|_| error("prey registry already borrowed"))?;
                let plan = PlannedScene::finish(
                    client,
                    &foods,
                    &preys,
                    &target,
                    context,
                    paint,
                    applied,
                    &mut budget,
                )?;
                if let Some(food) = &plan.food {
                    foods.observe_draw_sources(food)?;
                }
                if let Some(prey) = &plan.prey {
                    preys.observe_draw_sources(prey)?;
                }
                push(&mut plans, plan)?;
                Ok(())
            };
        let header = elapsed_header_kind(elapsed_header);
        // HUD ingress always uses at least the generalized face family with prey.
        let accessory = lane.with_accessory_presentation();
        let face = hud.is_some() || lane.with_face_presentation();
        let enable_prey = hud.is_some() || resolve_prey.is_some();
        let (_, report) = prepared
            .apply_frame_accessory_transaction(
                bytes,
                header,
                appearance,
                face || lane.with_antenna(),
                face,
                accessory,
                |spawn, zoom| food_factory(spawn, zoom).map(Some),
                true,
                |spawn, zoom| {
                    if enable_prey {
                        prey_factory(spawn, zoom).map(Some)
                    } else {
                        Ok(None)
                    }
                },
                enable_prey,
                &mut on_setup,
                hud,
            )
            .map_err(|e: ResolveError| e.0)?;
        let foods = food_sources.into_inner();
        let preys = prey_sources.into_inner();
        let count = plans.len() as u32;
        // Finish all fallible output work before any Canvas submission or commit.
        let result = if let Some(report) = report {
            if report.setup_draws() != plans.len() {
                return Err(error("HUD Setup draw count mismatch"));
            }
            ApplyRenderResult::Hud(hud_report_record(&report)?)
        } else {
            ApplyRenderResult::Legacy(count)
        };
        submit_plans(
            plans,
            &target,
            &sprites,
            &background,
            self.background_backdrop.as_ref(),
            entry,
            &sources,
            &foods,
            &preys,
        )?;
        self.commit_all(prepared, foods, preys)?;
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    fn render_at_size(
        &mut self,
        target: HtmlCanvasElement,
        sprites: [HtmlCanvasElement; 3],
        background: HtmlImageElement,
        size: DrawSize,
        lane: DrawLane<'_>,
        applied: QualitySnapshot,
    ) -> Result<(), JsValue> {
        if !self.client.food_enabled() && !lane.with_antenna() {
            return Err(error(
                "retained food factories must be enabled before rendering food",
            ));
        }
        let entry = DrawSize::entry(&target);
        let mut prepared = self.client.clone();
        let context = SceneDrawContext::committed(
            &prepared,
            size,
            &background,
            self.background_backdrop.as_ref(),
        );
        let mut sources = BorrowedSources::default();
        let mut budget = DrawBudget::default();
        let plan = PlannedScene::build(
            &mut prepared,
            &self.food_sources,
            &self.prey_sources,
            &mut sources,
            &target,
            context,
            lane,
            applied,
            &mut budget,
        )?;
        let mut plans = Vec::new();
        push(&mut plans, plan)?;
        submit_plans(
            plans,
            &target,
            &sprites,
            &background,
            self.background_backdrop.as_ref(),
            entry,
            &sources,
            &self.food_sources,
            &self.prey_sources,
        )?;
        self.client = prepared;
        Ok(())
    }

    fn commit_client(
        &mut self,
        client: AnimatedClient,
        sources: FoodSources,
    ) -> Result<(), JsValue> {
        self.commit_all(client, sources, self.prey_sources.clone())
    }

    fn commit_all(
        &mut self,
        client: AnimatedClient,
        mut foods: FoodSources,
        mut preys: PreySources,
    ) -> Result<(), JsValue> {
        validate_registries(&foods, &preys)?;
        foods.retain(client.foods().foods());
        preys.retain(client.preys().preys());
        self.client = client;
        self.food_sources = foods;
        self.prey_sources = preys;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn render_basic(
        &mut self,
        target: HtmlCanvasElement,
        sprites: [HtmlCanvasElement; 3],
        background: HtmlImageElement,
        quality_scale: f64,
        detailed_style: bool,
        resolve_face: Option<&js_sys::Function>,
        applied: Option<QualitySnapshot>,
    ) -> Result<(), JsValue> {
        quality(quality_scale)?;
        if (self.client.food_enabled() || self.client.prey_enabled()) && applied.is_none() {
            return Err(error(
                "retained food requires the basic renderer's applied-quality API",
            ));
        }
        let size = DrawSize::new(f64::from(target.width()), f64::from(target.height()))?;
        let mut prepared = self.client.clone();
        let context = SceneDrawContext::committed(
            &prepared,
            size,
            &background,
            self.background_backdrop.as_ref(),
        );
        let mut sources = BorrowedSources::default();
        let mut budget = DrawBudget::default();
        let paint = build_basic(
            &mut prepared,
            &mut sources,
            &target,
            size,
            quality_scale,
            detailed_style,
            resolve_face,
            None,
            false,
            false,
            &mut budget,
        )?;
        let camera = prepared.camera().position();
        let zoom = prepared.camera().zoom();
        let food = applied
            .map(|q| {
                food_plan(
                    &self.food_sources,
                    &prepared,
                    &target,
                    view(size, camera, zoom),
                    BodyPaintQuality {
                        high_quality: q.high_quality,
                        blend: q.quality_blend,
                    },
                    &mut budget,
                )
            })
            .transpose()?
            .flatten();
        let fallback = fallback_food(&prepared, food.is_none())?;
        let prey = prey_plan(
            &self.prey_sources,
            &prepared,
            &target,
            view(size, camera, zoom),
            &mut budget,
        )?;
        let plan = PlannedScene {
            context,
            // Legacy diagnostic APIs have no applied-quality input and draw HQ.
            background: context.background(
                &mut prepared,
                applied.unwrap_or(QualitySnapshot {
                    requested: QualityMode::High,
                    high_quality: true,
                    quality_blend: 1.,
                    quality_scale,
                    low_fps_counter: 0.,
                }),
            )?,
            camera,
            zoom,
            food,
            prey,
            arena_edge: arena_edge_plan(&prepared, context)?,
            nicknames: prepared.nickname_draws().to_vec(),
            fallback,
            paint,
        };
        validate_scene_sources(&sources, &self.food_sources, &self.prey_sources, &target)?;
        size.validate_entry(&target)?;
        let frame = CanvasPreflight::new(
            &target,
            &sprites,
            &background,
            size.width,
            size.height,
            camera.x - context.center,
            camera.y - context.center,
            zoom,
            self.background_backdrop.as_ref(),
            &plan.background,
        )?
        .begin(&target, &plan.background, self.background_backdrop.as_ref())?;
        plan.submit(
            frame,
            &sprites,
            &sources,
            &self.food_sources,
            &self.prey_sources,
        )?;
        self.client = prepared;
        Ok(())
    }
}
