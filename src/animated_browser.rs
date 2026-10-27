//! Browser ownership of the coupled model; caller-supplied time and borrowed assets.

use std::{cell::RefCell, f64::consts::TAU};

use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

use crate::{
    antenna_browser::{AntennaDecoration, appearance as parse_appearance},
    body_browser::{
        BorrowedSources, Recipe, ResolveError, appearance_request, paired_face, request,
        same_decoration, same_eyes, standard_eyes,
    },
    canvas_browser::{CanvasFrame, CanvasPreflight, draw_sprite},
    face_browser::{FaceSources, appearance as parse_face_presentation},
    food_browser::FoodSources,
    presentation::{
        AnimatedClient, AntennaDrawBudget, AntennaPath, AntennaRandomRequest,
        AppearancePresentation, ArenaEdgeInput, ArenaEdgePlan, BodyPaintError, BodyPaintInput,
        BodyPaintPlan, BodyPaintQuality, BodyPaintView, BodyPaintVisual, ClientControlActions,
        ClientControlView, CurveInput, CurveOutput, EyeLayoutInput, FaceGeometry, FacePresentation,
        FoodImageCommand, FoodPaintInput, FoodPaintPlan, MAX_BODY_PAINT_COMMANDS, MAX_DRAW_SAMPLES,
        MAX_RETAINED_SNAKES, OrdinaryAntennaGeometry, PairedSideLayout, PreparedAntenna,
        PreparedSnake, PreyEaterPose, PreyImageCommand, PreyPaintInput, PreyPaintPlan,
        QualitySnapshot, SingleEyeLayout, SnakePresentation, StandardEyeLayout, Turn,
        plan_arena_edge, plan_food, plan_prey, plan_standard_body, plan_standard_body_with_antenna,
        sample_curve_with_heading,
    },
    presentation_browser::AnimationStep,
    prey_browser::PreySources,
    protocol::ElapsedHeader,
    quality_browser::DesktopQuality,
    state::{Food, Point, Setup},
};

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn paired_presentation(value: FacePresentation) -> Result<AppearancePresentation, ResolveError> {
    Ok(AppearancePresentation {
        face: *value
            .face
            .paired()
            .ok_or_else(|| error("paired face required by legacy API"))?,
        antenna: value.antenna,
    })
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

fn control_view_record(view: ClientControlView) -> Result<JsValue, JsValue> {
    let point = |p: Point| record([("x", p.x.into()), ("y", p.y.into())]);
    let own = match view.own {
        None => JsValue::NULL,
        Some(own) => record([
            ("token", serial(own.token.serial())),
            ("id", own.id.into()),
            ("rawHead", point(own.raw_head)?),
            ("wantedHeading", own.wanted_heading.into()),
            ("gazeHeading", own.gaze_heading.into()),
            ("dead", own.dead.into()),
            ("turnRate", own.turn_rate.into()),
            ("sizeTurnFactor", own.size_turn_factor.into()),
            ("speedTurnFactor", own.speed_turn_factor.into()),
        ])?,
    };
    record([
        ("own", own),
        ("camera", point(view.camera)?),
        ("zoom", view.zoom.into()),
        ("follows", view.follows.into()),
        ("connected", view.connected.into()),
    ])
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
            "gazeHeading" | "resetWorld" | "resetLag" | "connected"
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

/// Coupled packet/update/draw ownership with a synthetic three-palette preview.
/// This class does not open a socket, load artwork, or start an animation loop.
#[wasm_bindgen]
pub struct AnimatedScene {
    client: AnimatedClient,
    food_sources: FoodSources,
    prey_sources: PreySources,
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
        })
    }

    /// Clear the world and transient view state; retain follow preference and animation time.
    /// Construct a new scene to start a fresh timeline.
    pub fn reset(&mut self) {
        self.client.reset();
        self.food_sources.clear();
        self.prey_sources.clear();
    }

    /// Restore only the existing clock's lag multiplier, without advancing time.
    pub fn reset_lag(&mut self) {
        self.client.reset_lag();
    }

    /// Copied pre-motion original-own and displayed-camera data. Tokens are BigInt
    /// serials scoped to this scene instance, never reused by world reset.
    pub fn control_view(&self) -> Result<JsValue, JsValue> {
        control_view_record(self.client.control_view())
    }

    /// Gate boundary updates only; setup activates this gate and reset clears it.
    pub fn set_connected(&mut self, connected: bool) {
        self.client.set_connected(connected);
    }

    /// Commit a complete frame and its presentation actions atomically.
    pub fn apply_frame(&mut self, bytes: &[u8], elapsed_header: bool) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        prepared
            .apply_frame(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
            )
            .map_err(error)?;
        self.commit_client(prepared, self.food_sources.clone())
    }

    /// Install explicit normalized paired eyes once per appearance, before its
    /// first update. Framing and received-state validation precede callbacks.
    /// The synchronous resolver is trusted; its side effects cannot roll back.
    /// Any error preserves the complete model and callback exceptions keep identity.
    pub fn apply_frame_with_eye_geometry(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_eyes: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        prepared
            .apply_frame_with_eye_geometry(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
                |appearance| -> Result<_, ResolveError> {
                    let metadata = resolve_eyes
                        .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
                    Ok(standard_eyes(&metadata)?)
                },
            )
            .map_err(|e| e.0)?;
        self.commit_client(prepared, self.food_sources.clone())
    }

    /// Install owned numeric paired-face metadata atomically before any update.
    /// The direct synchronous callback is trusted and owns face-family coverage.
    pub fn apply_frame_with_face_geometry(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_face: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        prepared
            .apply_frame_with_face_geometry(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
                |appearance| -> Result<_, ResolveError> {
                    let metadata = resolve_face
                        .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
                    Ok(paired_face(&metadata)?)
                },
            )
            .map_err(|e| e.0)?;
        self.commit_client(prepared, self.food_sources.clone())
    }

    /// Retain complete appearance geometry and food factory inputs in one packet
    /// transaction. Start before packets or after reset; sources remain owned until
    /// their last food disappears. Callback side effects remain caller-owned.
    pub fn apply_frame_with_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_face: &js_sys::Function,
        resolve_food: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        let mut sources = self.food_sources.clone();
        prepared
            .apply_frame_with_factories(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
                |appearance| -> Result<_, ResolveError> {
                    let metadata = resolve_face
                        .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
                    Ok(paired_face(&metadata)?)
                },
                |spawn, zoom| -> Result<_, ResolveError> {
                    if self.prey_sources.len() == 0 {
                        return Ok(sources.resolve(resolve_food, spawn, zoom)?);
                    }
                    let (catalog, snapshots) = registry_allowance(0, self.prey_sources.len())?;
                    Ok(sources.resolve_limited(resolve_food, spawn, zoom, catalog, snapshots)?)
                },
            )
            .map_err(|e| e.0)?;
        self.commit_client(prepared, sources)
    }

    /// Retain face, food and prey creation inputs in wire order. All packet
    /// validation precedes callbacks; external callback effects cannot roll back.
    pub fn apply_frame_with_all_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_face: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        let foods = RefCell::new(self.food_sources.clone());
        let preys = RefCell::new(self.prey_sources.clone());
        prepared
            .apply_frame_with_all_factories(
                bytes,
                elapsed_header_kind(elapsed_header),
                |appearance| -> Result<_, ResolveError> {
                    let metadata = resolve_face
                        .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
                    Ok(paired_face(&metadata)?)
                },
                |spawn, zoom| -> Result<_, ResolveError> {
                    let other = preys
                        .try_borrow()
                        .map_err(|_| error("prey registry already borrowed"))?;
                    let (catalog, snapshots) =
                        registry_allowance(other.entry_count(), other.len())?;
                    Ok(foods
                        .try_borrow_mut()
                        .map_err(|_| error("food registry already borrowed"))?
                        .resolve_limited(resolve_food, spawn, zoom, catalog, snapshots)?)
                },
                |spawn, zoom| -> Result<_, ResolveError> {
                    let other = foods
                        .try_borrow()
                        .map_err(|_| error("food registry already borrowed"))?;
                    if other.entry_count() == 0 && other.len() == 0 {
                        return Ok(preys
                            .try_borrow_mut()
                            .map_err(|_| error("prey registry already borrowed"))?
                            .resolve(resolve_prey, spawn, zoom)?);
                    }
                    let (catalog, snapshots) =
                        registry_allowance(other.entry_count(), other.len())?;
                    Ok(preys
                        .try_borrow_mut()
                        .map_err(|_| error("prey registry already borrowed"))?
                        .resolve_limited(resolve_prey, spawn, zoom, catalog, snapshots)?)
                },
            )
            .map_err(|e| e.0)?;
        self.commit_all(prepared, foods.into_inner(), preys.into_inner())
    }

    /// Retain explicit numeric face and antenna metadata before the first update.
    pub fn apply_frame_with_appearance(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_appearance_factories(bytes, elapsed_header, resolve_appearance, None, None)
    }

    /// Retain explicit appearance metadata and creation-selected food sources.
    pub fn apply_frame_with_appearance_and_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_appearance_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            None,
        )
    }

    /// Retain explicit appearance, food and prey inputs in wire order.
    pub fn apply_frame_with_appearance_and_all_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_appearance_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            Some(resolve_prey),
        )
    }

    /// Apply retained factories and submit each Setup draw in wire order.
    /// Callback/preflight failures preserve model and sources before any clear.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_food(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_draw_face: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Basic {
                detailed: detailed_style,
                face: resolve_draw_face,
            },
            quality.applied(),
        )
    }

    /// Standard-body counterpart of the ordered Setup transaction.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
        )
    }

    /// Apply all factories and draw every Setup using basic bodies and retained prey.
    /// Plans share the ingress budgets; source and model commit follows submission.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_food_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_draw_face: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Basic {
                detailed: detailed_style,
                face: resolve_draw_face,
            },
            quality.applied(),
        )
    }

    /// Standard-body counterpart including retained prey in every ordered Setup draw.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
        )
    }

    /// Submit one retained-food draw at the desired backing size, without update.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_food_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_draw_face: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Basic {
                detailed: detailed_style,
                face: resolve_draw_face,
            },
            quality.applied(),
        )
    }

    /// Standard-body retained-food draw at an explicit desired backing size.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
        )
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_appearance(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicAntenna {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_appearance(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAntenna {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_appearance_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicAntenna {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_appearance_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAntenna {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_antenna_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicAntenna {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_antenna_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAntenna {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Submit one draw with explicit retained antenna sources and random units.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_antenna(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::BasicAntenna {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Submit one draw with explicit retained antenna sources and random units.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_antenna(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::StandardAntenna {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Retain the selected numeric face family before its first update; no sources are required.
    pub fn apply_frame_with_face_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_face_factories(bytes, elapsed_header, resolve_appearance, None, None, true)
    }

    /// Select face mode and retain creation-selected food inputs atomically.
    pub fn apply_frame_with_face_presentation_and_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_face_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            None,
            true,
        )
    }

    /// Select face mode and retain food and prey creation inputs in wire order.
    pub fn apply_frame_with_face_presentation_and_all_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_face_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            Some(resolve_prey),
            true,
        )
    }

    /// Submit every Setup draw with tagged faces and shared ingress budgets.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_face_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicFace {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Submit ordered standard-body Setup draws with complete tagged face metadata.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_face_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Include retained prey in every ordered tagged-face Setup draw.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_face_presentation_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicFace {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Share source and image budgets across standard-body Setup draws with prey.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_face_presentation_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw tagged faces at the requested backing size without advancing update clocks.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_face_presentation_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicFace {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw standard bodies and tagged faces at the requested backing size.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_face_presentation_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Preflight native contexts and patterns before resetting the target for tagged faces.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_face_presentation(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::BasicFace {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Preflight a standard-body tagged-face draw before resetting the target.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_face_presentation(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Prepare numeric tagged-face draw feedback; do not also render the same draw.
    pub fn prepare_draw_with_face_presentation(
        &mut self,
        width: f64,
        height: f64,
        quality_scale: f64,
        detailed_style: bool,
        resolve_random: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.client
            .prepare_draw_with_face_presentation(
                dimensions(width)?,
                dimensions(height)?,
                quality_scale,
                detailed_style,
                |input| antenna_random(resolve_random, input),
            )
            .map_err(|e| e.0)?;
        Ok(())
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
    /// record with optional gazeHeading, resetWorld, resetLag and connected fields;
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

    /// Prepare one numeric draw without rasterization, for deterministic clients.
    /// `render` prepares its own draw; do not call both for the same draw.
    pub fn prepare_draw(&mut self, width: f64, height: f64) -> Result<(), JsValue> {
        self.client
            .prepare_draw(dimensions(width)?, dimensions(height)?)
            .map_err(error)
    }

    /// Numeric-only draw with the same sampling style and eye feedback as `render`.
    pub fn prepare_draw_with_style(
        &mut self,
        width: f64,
        height: f64,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<(), JsValue> {
        self.client
            .prepare_draw_with_style(
                dimensions(width)?,
                dimensions(height)?,
                quality_scale,
                detailed_style,
            )
            .map_err(error)?;
        Ok(())
    }

    /// Set independent visual gaze on the retained original own object, including
    /// death fade. This neither sends steering nor advances an animation clock.
    pub fn set_gaze_heading(&mut self, heading: f64) -> Result<(), JsValue> {
        self.client.set_own_gaze_heading(heading).map_err(error)
    }

    /// Prepare one numeric draw with explicit antenna random units and no Canvas.
    pub fn prepare_draw_with_antenna(
        &mut self,
        width: f64,
        height: f64,
        quality_scale: f64,
        detailed_style: bool,
        resolve_random: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.client
            .prepare_draw_with_antenna(
                dimensions(width)?,
                dimensions(height)?,
                quality_scale,
                detailed_style,
                |input| antenna_random(resolve_random, input),
            )
            .map_err(|e| e.0)?;
        Ok(())
    }

    /// Copied family and shared gaze state for every retained appearance.
    /// Native Number fields preserve signed zeros; observation advances no clock.
    pub fn face_state(&self) -> Result<JsValue, JsValue> {
        let snakes = js_sys::Array::new();
        for (token, own, drawn, snake) in self.client.snake_objects() {
            let face = match snake.active_face_geometry() {
                FaceGeometry::Paired(_) => {
                    record([("kind", "paired".into()), ("geometry", JsValue::NULL)])?
                }
                FaceGeometry::SingleImage(geometry) => record([
                    ("kind", "single-image".into()),
                    (
                        "geometry",
                        record([
                            ("baseSize", geometry.base_size.into()),
                            ("pupilSize", geometry.pupil_size.into()),
                            ("pupilTravel", geometry.pupil_travel.into()),
                        ])?,
                    ),
                ])?,
            };
            let eyes = snake.eyes();
            snakes.push(&record([
                ("token", serial(token.serial())),
                ("id", snake.metrics().id.into()),
                ("own", own.into()),
                ("drawn", drawn.into()),
                ("face", face),
                ("heading", eyes.heading().into()),
                ("targetHeading", eyes.target_heading().into()),
                ("pupilX", eyes.pupil().x.into()),
                ("pupilY", eyes.pupil().y.into()),
            ])?);
        }
        record([
            ("enabled", self.client.face_presentation_enabled().into()),
            ("snakes", snakes.into()),
        ])
    }

    /// Fresh copies of retained appearance chains; observation advances no clock.
    pub fn antenna_state(&self) -> Result<JsValue, JsValue> {
        let bounds = self
            .client
            .antenna_bounds()
            .map(|bounds| {
                record([
                    ("minX", bounds.min_x.into()),
                    ("maxX", bounds.max_x.into()),
                    ("minY", bounds.min_y.into()),
                    ("maxY", bounds.max_y.into()),
                ])
            })
            .transpose()?
            .unwrap_or(JsValue::NULL);
        let snakes = js_sys::Array::new();
        for (token, own, drawn, snake) in self.client.snake_objects() {
            let antenna = if let Some(snapshot) = self.client.antenna_snapshot(token) {
                record([
                    ("geometry", antenna_geometry_snapshot(snapshot.geometry)?),
                    (
                        "x",
                        js_sys::Float32Array::from(snapshot.x.as_slice()).into(),
                    ),
                    (
                        "y",
                        js_sys::Float32Array::from(snapshot.y.as_slice()).into(),
                    ),
                    (
                        "velocityX",
                        js_sys::Float32Array::from(snapshot.velocity_x.as_slice()).into(),
                    ),
                    (
                        "velocityY",
                        js_sys::Float32Array::from(snapshot.velocity_y.as_slice()).into(),
                    ),
                    (
                        "accelerationX",
                        js_sys::Float32Array::from(snapshot.acceleration_x.as_slice()).into(),
                    ),
                    (
                        "accelerationY",
                        js_sys::Float32Array::from(snapshot.acceleration_y.as_slice()).into(),
                    ),
                    ("shown", snapshot.shown.into()),
                    ("bulbRotation", snapshot.bulb_rotation.into()),
                ])?
            } else {
                JsValue::NULL
            };
            snakes.push(&record([
                ("token", serial(token.serial())),
                ("id", snake.metrics().id.into()),
                ("own", own.into()),
                ("drawn", drawn.into()),
                ("antenna", antenna),
            ])?);
        }
        record([
            ("appearanceEnabled", self.client.appearance_enabled().into()),
            ("drawSerial", serial(self.client.draw_serial())),
            ("bounds", bounds),
            ("snakes", snakes.into()),
        ])
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

    /// Numeric diagnostics. Input-facing ownHead/camera x/y are centered;
    /// nested own geometry and camera absoluteX/absoluteY retain absolute units.
    /// Radius is the received target; boundary reports the retained display and gate.
    pub fn snapshot(&self) -> String {
        let received = self.client.received();
        let center = received.setup.as_ref().map_or(0., |s| s.grid_center);
        let camera = self.client.camera();
        let position = camera.position();
        let offset = camera.corrections().offset();
        let own = self.client.own_snake();
        let input_head = self.client.active_own_snake();
        let own_head = input_head.map_or_else(
            || "null".into(),
            |snake| {
                let m = snake.metrics();
                object! {"x": m.corrected_head.x - center, "y": m.corrected_head.y - center, "skin": m.skin}
            },
        );
        object! {
            "frames": received.frames_applied, "commands": received.commands_applied,
            "ignored": received.ignored_commands, "snakes": received.snakes.len(),
            "foods": received.foods.len(), "gridCenter": center,
            "protocol": received.setup.as_ref().map_or_else(|| "null".into(), |s| s.protocol.to_string()),
            "radius": received.setup.as_ref().map_or(0., |s| s.radius),
            "boundary": self.client.boundary().map_or_else(|| "null".into(), |boundary| object! {
                "displayed": boundary.displayed(), "target": boundary.target(),
                "index": boundary.index(), "pending": boundary.pending(),
                "connected": self.client.connected()
            }),
            "ownId": received.own_snake_id.map_or_else(|| "null".into(), |id| id.to_string()),
            "ownHead": own_head,
            "retainedSnakes": self.client.retained_count(),
            "drawnSnakes": self.client.drawn_snakes().count(),
            "retainedBodyPoints": self.client.retained_body_points(),
            "camera": object! {
                "x": position.x - center, "y": position.y - center,
                "absoluteX": position.x, "absoluteY": position.y,
                "zoom": camera.zoom(), "follows": camera.follows(),
                "offsetX": offset.x, "offsetY": offset.y,
                "index": camera.corrections().index(), "pending": camera.corrections().pending()
            },
            "own": own.map_or_else(|| "null".into(), snake_snapshot)
        }
    }

    /// Copied center, camera angle and distance, preserving signed zeros.
    pub fn arena_edge_view(&self) -> Vec<f64> {
        let view = self.client.arena_edge_view();
        vec![view.center(), view.angle(), view.distance()]
    }

    /// Copied retained-food diagnostics with lossless BigInt identities and native
    /// Number cells, preserving signed zeros. This is separate from the received
    /// map count in `snapshot`; returned objects cannot mutate the model.
    pub fn food_state(&self) -> Result<JsValue, JsValue> {
        let rows = js_sys::Array::new();
        for food in self.client.foods().foods() {
            let f = food.snapshot();
            let sources = js_sys::Array::new();
            for source in [
                f.sources.body,
                f.sources.outline,
                f.sources.inner,
                f.sources.outer,
            ] {
                sources.push(&food_source_snapshot(source)?);
            }
            let indices = js_sys::Array::new();
            for index in f.sources.indices {
                indices.push(&JsValue::from_f64(index as f64));
            }
            rows.push(&record([
                ("instance", serial(f.instance.serial())),
                ("key", f.key.into()),
                ("sectorX", f.sector.0.into()),
                ("sectorY", f.sector.1.into()),
                ("x", f.position.x.into()),
                ("y", f.position.y.into()),
                ("rawColor", f.raw_color.into()),
                ("palette", f.effective_palette.into()),
                ("size", f.base_size.into()),
                ("spawnSpeed", f.spawn_speed.into()),
                ("renderX", f.render_position.x.into()),
                ("renderY", f.render_position.y.into()),
                ("fade", f.fade.into()),
                ("scale", f.scale.into()),
                ("uneatenScale", f.uneaten_scale.into()),
                ("phase", f.animation_phase.into()),
                ("rate", f.animation_rate.into()),
                ("wobbleRate", f.wobble_rate.into()),
                ("eaten", f.eaten.into()),
                ("progress", f.consumption_progress.into()),
                (
                    "eater",
                    f.eater.map_or(JsValue::NULL, |t| serial(t.serial())),
                ),
                ("creationZoom", f.creation_zoom.into()),
                ("indices", indices.into()),
                ("sources", sources.into()),
            ])?);
        }
        let bounds = self.client.food_bounds().map_or(JsValue::NULL, |bounds| {
            bounds
                .limits()
                .into_iter()
                .map(JsValue::from_f64)
                .collect::<js_sys::Array>()
                .into()
        });
        record([
            ("enabled", self.client.food_enabled().into()),
            (
                "receivedCount",
                (self.client.received().foods.len() as f64).into(),
            ),
            (
                "ownToken",
                self.client
                    .own_token()
                    .map_or(JsValue::NULL, |t| serial(t.serial())),
            ),
            ("sourceCount", (self.food_sources.len() as f64).into()),
            ("bounds", bounds),
            ("foods", rows.into()),
        ])
    }

    /// Copy prey scalars, retained identities and both Float32 correction rings.
    /// Diagnostics borrow no source objects and advance no update or draw state.
    pub fn prey_state(&self) -> Result<JsValue, JsValue> {
        let rows = js_sys::Array::new();
        for p in self.client.preys().snapshots() {
            let sources = js_sys::Array::new();
            sources.push(&food_source_snapshot(p.sources.body)?);
            sources.push(&food_source_snapshot(p.sources.glow)?);
            let indices = p
                .sources
                .indices
                .into_iter()
                .map(|v| JsValue::from_f64(v as f64))
                .collect::<js_sys::Array>();
            let counts = p
                .sources
                .family_counts
                .into_iter()
                .map(|v| JsValue::from_f64(v as f64))
                .collect::<js_sys::Array>();
            let samples = js_sys::Array::new();
            for channel in p.corrections.samples() {
                samples.push(&js_sys::Float32Array::from(channel.as_slice()));
            }
            let [offset_x, offset_y] = p.corrections.offset();
            let direction = match p.direction {
                crate::state::Direction::None => 0_u8,
                crate::state::Direction::Decreasing => 1,
                crate::state::Direction::Increasing => 2,
            };
            rows.push(&record([
                ("instance", serial(p.instance.serial())),
                ("id", p.id.into()),
                ("x", p.position.x.into()),
                ("y", p.position.y.into()),
                ("sizeByte", p.size_byte.into()),
                ("size", p.base_size.into()),
                ("rawColor", p.raw_color.into()),
                ("palette", p.palette.into()),
                ("direction", direction.into()),
                ("heading", p.heading.into()),
                ("wantedHeading", p.wanted_heading.into()),
                ("speedPer32ms", p.speed_per_32ms.into()),
                ("scale", p.scale.into()),
                ("fade", p.fade.into()),
                ("glowPhase", p.glow_phase.into()),
                ("glowRate", p.glow_rate.into()),
                ("randomPhaseUnit", p.random_phase_unit.into()),
                ("randomRateUnit", p.random_rate_unit.into()),
                ("creationZoom", p.creation_zoom.into()),
                ("eaten", p.eaten.into()),
                ("progress", p.consumption_progress.into()),
                (
                    "eater",
                    p.eater.map_or(JsValue::NULL, |t| serial(t.serial())),
                ),
                ("indices", indices.into()),
                ("familyCounts", counts.into()),
                ("sources", sources.into()),
                ("offsetX", offset_x.into()),
                ("offsetY", offset_y.into()),
                ("index", (p.corrections.index() as f64).into()),
                ("pending", p.corrections.pending().into()),
                ("samples", samples.into()),
                (
                    "weights",
                    js_sys::Float32Array::from(p.corrections.weights().as_slice()).into(),
                ),
            ])?);
        }
        record([
            ("enabled", self.client.prey_enabled().into()),
            ("sourceCount", (self.prey_sources.len() as f64).into()),
            ("preys", rows.into()),
        ])
    }

    /// Copied absolute-radius ring, retained across resets; draws never consume it.
    pub fn boundary_samples(&self) -> Vec<f64> {
        self.client
            .boundary()
            .map_or_else(Vec::new, |boundary| boundary.samples().to_vec())
    }

    /// Copied numeric snapshots in draw order, including culled entries. The own
    /// flag identifies the original object independently of a reused wire ID.
    pub fn drawn_snakes(&self) -> String {
        let own = self.client.own_snake();
        let rows = self
            .client
            .drawn_snakes()
            .enumerate()
            .map(|(ordinal, snake)| {
                object! {
                    "drawOrdinal": ordinal,
                    "own": own.is_some_and(|own| std::ptr::eq(own, snake)),
                    "snake": snake_snapshot(snake)
                }
            })
            .collect::<Vec<_>>();
        format!("[{}]", rows.join(","))
    }

    /// Read-only paired-eye layouts for currently visible drawn snakes. Rows:
    /// ordinal, ID, own, eye1 x/y, pupil1 x/y, eye2 x/y, pupil2 x/y,
    /// eye radius, pupil radius, outline width, eye alpha, pupil alpha (stride 16).
    /// This observes current state; it does not prepare or commit another draw.
    pub fn drawn_eyes(&self, width: f64, height: f64) -> Result<Vec<f64>, JsValue> {
        let viewport_half = Point {
            x: f64::from(dimensions(width)?) / 2.,
            y: f64::from(dimensions(height)?) / 2.,
        };
        let camera = self.client.camera();
        let own = self.client.own_snake();
        let mut rows = Vec::new();
        for (ordinal, snake) in self.client.drawn_snakes().enumerate() {
            let m = snake.metrics();
            if !m.visible || m.expired {
                continue;
            }
            let layout = snake
                .eye_geometry()
                .ok_or_else(|| error("drawn_eyes requires paired faces"))?
                .layout(
                    snake.eyes().heading(),
                    snake.eyes().pupil(),
                    EyeLayoutInput {
                        corrected_head: m.corrected_head,
                        camera: camera.position(),
                        viewport_half,
                        scale: m.scale,
                        zoom: camera.zoom(),
                        death_progress: m.death_progress,
                    },
                )
                .map_err(error)?;
            let [first, second] = layout.pairs;
            rows.extend([
                ordinal as f64,
                f64::from(m.id),
                f64::from(u8::from(own.is_some_and(|own| std::ptr::eq(own, snake)))),
                first.eye.x,
                first.eye.y,
                first.pupil.x,
                first.pupil.y,
                second.eye.x,
                second.eye.y,
                second.pupil.x,
                second.pupil.y,
                layout.eye_radius,
                layout.pupil_radius,
                layout.outline_width,
                layout.eye_alpha,
                layout.pupil_alpha,
            ]);
        }
        Ok(rows)
    }

    /// Copied own body rows: x/y, previous dx/dy, edge, spacing, fade, dying,
    /// x/y/edge/spacing offsets, correction index, pending count (stride 14).
    pub fn own_body(&self) -> Vec<f64> {
        self.client.own_snake().map_or_else(Vec::new, |snake| {
            snake
                .body()
                .points()
                .iter()
                .flat_map(|point| {
                    let p = point.position();
                    let d = point.previous_delta();
                    let o = point.offset();
                    [
                        p.x,
                        p.y,
                        d.x,
                        d.y,
                        point.edge_length(),
                        point.spacing_multiplier(),
                        point.tail_fade(),
                        f64::from(u8::from(point.dying())),
                        o[0],
                        o[1],
                        o[2],
                        o[3],
                        point.index() as f64,
                        f64::from(point.pending()),
                    ]
                })
                .collect()
        })
    }

    /// Copied own body samples: point, channel (x/y/edge/spacing), then 53 slots.
    pub fn own_body_samples(&self) -> Vec<f32> {
        self.client.own_snake().map_or_else(Vec::new, |snake| {
            snake
                .body()
                .points()
                .iter()
                .flat_map(|p| p.samples().iter().flatten().copied())
                .collect()
        })
    }

    /// Copied own head channels, in x/y/fraction order.
    pub fn head_samples(&self) -> Vec<f32> {
        self.client.own_snake().map_or_else(Vec::new, |s| {
            s.head_corrections()
                .samples()
                .iter()
                .flatten()
                .copied()
                .collect()
        })
    }

    /// Copied own heading correction samples.
    pub fn angle_samples(&self) -> Vec<f32> {
        self.client
            .own_snake()
            .map_or_else(Vec::new, |s| s.angle_corrections().samples().to_vec())
    }

    /// Copied own displayed-length correction samples.
    pub fn length_samples(&self) -> Vec<f32> {
        self.client
            .own_snake()
            .map_or_else(Vec::new, |s| s.length().samples().to_vec())
    }

    /// Copied double-precision camera channels, x followed by y.
    pub fn camera_samples(&self) -> Vec<f64> {
        self.client
            .camera()
            .corrections()
            .samples()
            .iter()
            .flatten()
            .copied()
            .collect()
    }

    /// Sample the prepared visible own geometry without advancing any draw clock.
    /// Flat output is x/y/tailward-angle in Float32 storage order.
    pub fn own_curve(&self, quality_scale: f64, detailed_style: bool) -> Result<Vec<f32>, JsValue> {
        quality(quality_scale)?;
        let Some(snake) = self.client.drawn_own_snake().filter(|s| has_curve(s)) else {
            return Ok(Vec::new());
        };
        Ok(curve(snake, quality_scale, detailed_style)?
            .samples
            .into_iter()
            .flat_map(|p| [p.x, p.y, p.angle])
            .collect())
    }

    /// Copied pre/post-redistribution diagnostics for a prepared visible own curve.
    /// Rows are sampled x/y, final f64 x/y, distance-present, distance (stride 6).
    pub fn own_curve_vertices(
        &self,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<Vec<f64>, JsValue> {
        quality(quality_scale)?;
        let Some(snake) = self.client.drawn_own_snake().filter(|s| has_curve(s)) else {
            return Ok(Vec::new());
        };
        Ok(curve(snake, quality_scale, detailed_style)?
            .vertices()
            .iter()
            .flat_map(|v| {
                [
                    v.sampled.x,
                    v.sampled.y,
                    v.position.x,
                    v.position.y,
                    f64::from(u8::from(v.distance_from_previous.is_some())),
                    v.distance_from_previous.unwrap_or(0.),
                ]
            })
            .collect())
    }

    /// Active sample count, prepared spacing, eye target and redistribution count.
    pub fn own_curve_info(
        &self,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<Vec<f64>, JsValue> {
        quality(quality_scale)?;
        let Some(snake) = self.client.drawn_own_snake().filter(|s| has_curve(s)) else {
            return Ok(Vec::new());
        };
        let output = curve(snake, quality_scale, detailed_style)?;
        Ok(vec![
            output.samples.len() as f64,
            output.point_spacing,
            output.target_eye_heading,
            output.redistribution_count() as f64,
        ])
    }

    /// Draw sampled curves with caller-owned stand-in palettes, then standard
    /// paired eyes after each body. Full skin recipes, attachments, special faces
    /// and quality-dependent effects remain separate.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<(), JsValue> {
        self.render_basic(
            target,
            [palette_0, palette_1, palette_2],
            background,
            quality_scale,
            detailed_style,
            None,
            None,
        )
    }

    /// Basic stand-in bodies plus complete retained paired faces. The resolver
    /// returns a trusted normalized face-only projection, independent of body readiness.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_face_decorations(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        quality_scale: f64,
        detailed_style: bool,
        resolve_face: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.render_basic(
            target,
            [palette_0, palette_1, palette_2],
            background,
            quality_scale,
            detailed_style,
            Some(resolve_face),
            None,
        )
    }

    /// Basic bodies and complete paired faces with retained two-pass food.
    /// Borrow applied quality without advancing its clock or statistics.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_food(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        detailed_style: bool,
        resolve_face: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        if !self.client.food_enabled() {
            return Err(error(
                "retained food factories must be enabled before rendering food",
            ));
        }
        let applied = quality.applied();
        self.render_basic(
            target,
            [palette_0, palette_1, palette_2],
            background,
            applied.quality_scale,
            detailed_style,
            Some(resolve_face),
            Some(BodyPaintQuality {
                high_quality: applied.high_quality,
                blend: applied.quality_blend,
            }),
        )
    }

    /// Opt-in standard-body renderer using synchronous trusted normalized
    /// skin-provider snapshots and read-only applied quality. See
    /// `docs/standard-body-renderer.md` for the supported recipe and lifetime.
    /// No quality/update clock advances here. All recipes and commands validate
    /// before Canvas reset; Canvas failures preserve the complete model.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard(
        &mut self,
        target: HtmlCanvasElement,
        food_0: HtmlCanvasElement,
        food_1: HtmlCanvasElement,
        food_2: HtmlCanvasElement,
        background: HtmlImageElement,
        resolve_recipe: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [food_0, food_1, food_2],
            background,
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
        )
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
    fn apply_face_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: Option<&js_sys::Function>,
        resolve_prey: Option<&js_sys::Function>,
        generalized: bool,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        let foods = RefCell::new(self.food_sources.clone());
        let preys = RefCell::new(self.prey_sources.clone());
        let mut appearance = |input: &crate::state::Appearance| -> Result<_, ResolveError> {
            let raw = resolve_appearance
                .call1(&JsValue::UNDEFINED, &appearance_request(input)?.into())?;
            if generalized {
                Ok(parse_face_presentation(&raw)?)
            } else {
                Ok(FacePresentation::from(parse_appearance(&raw)?))
            }
        };
        let mut food = |spawn: &crate::state::FoodSpawnInput, zoom| -> Result<_, ResolveError> {
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
        let mut prey = |spawn: &crate::state::PreySpawnInput, zoom| -> Result<_, ResolveError> {
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
        if generalized && resolve_prey.is_some() {
            prepared.apply_frame_with_face_presentation_and_all_factories(
                bytes,
                header,
                &mut appearance,
                &mut food,
                &mut prey,
            )
        } else if generalized && resolve_food.is_some() {
            prepared.apply_frame_with_face_presentation_and_factories(
                bytes,
                header,
                &mut appearance,
                &mut food,
            )
        } else if generalized {
            prepared.apply_frame_with_face_presentation(bytes, header, &mut appearance)
        } else if resolve_prey.is_some() {
            prepared.apply_frame_with_appearance_and_all_factories(
                bytes,
                header,
                |input| paired_presentation(appearance(input)?),
                &mut food,
                &mut prey,
            )
        } else if resolve_food.is_some() {
            prepared.apply_frame_with_appearance_and_factories(
                bytes,
                header,
                |input| paired_presentation(appearance(input)?),
                &mut food,
            )
        } else {
            prepared.apply_frame_with_appearance(bytes, header, |input| {
                paired_presentation(appearance(input)?)
            })
        }
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
        let context = SceneDrawContext::committed(&prepared, size);
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
        let frame = CanvasFrame::new(
            &target,
            &sprites,
            &background,
            plan.camera.x - context.center,
            plan.camera.y - context.center,
            plan.zoom,
        )?;
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
    ) -> Result<u32, JsValue> {
        let entry = DrawSize::entry(&target);
        let mut prepared = self.client.clone();
        let food_sources = RefCell::new(self.food_sources.clone());
        let prey_sources = RefCell::new(self.prey_sources.clone());
        let mut sources = BorrowedSources::default();
        let mut plans = Vec::new();
        let mut budget = DrawBudget::default();
        let mut setup_budget = SetupDrawBudget::default();
        let mut appearance = |appearance: &crate::state::Appearance| -> Result<_, ResolveError> {
            let raw = resolve_appearance
                .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
            if lane.with_face_presentation() {
                Ok(parse_face_presentation(&raw)?)
            } else if lane.with_antenna() {
                Ok(FacePresentation::from(parse_appearance(&raw)?))
            } else {
                Ok(FacePresentation {
                    face: FaceGeometry::Paired(paired_face(&raw)?),
                    antenna: None,
                })
            }
        };
        let mut food_factory =
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
        let mut prey_factory = |spawn: &crate::state::PreySpawnInput,
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
                let context = SceneDrawContext::at_setup(client, size, Some(setup));
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
        if lane.with_face_presentation() && resolve_prey.is_some() {
            prepared.apply_frame_with_face_presentation_and_all_factories_and_setup(
                bytes,
                header,
                &mut appearance,
                &mut food_factory,
                &mut prey_factory,
                &mut on_setup,
            )
        } else if lane.with_face_presentation() {
            prepared.apply_frame_with_face_presentation_and_factories_and_setup(
                bytes,
                header,
                &mut appearance,
                &mut food_factory,
                &mut on_setup,
            )
        } else if lane.with_antenna() && resolve_prey.is_some() {
            prepared.apply_frame_with_appearance_and_all_factories_and_setup(
                bytes,
                header,
                |input| paired_presentation(appearance(input)?),
                &mut food_factory,
                &mut prey_factory,
                &mut on_setup,
            )
        } else if lane.with_antenna() {
            prepared.apply_frame_with_appearance_and_factories_and_setup(
                bytes,
                header,
                |input| paired_presentation(appearance(input)?),
                &mut food_factory,
                &mut on_setup,
            )
        } else if resolve_prey.is_some() {
            prepared.apply_frame_with_all_factories_and_setup(
                bytes,
                header,
                |input| Ok::<_, ResolveError>(paired_presentation(appearance(input)?)?.face),
                &mut food_factory,
                &mut prey_factory,
                &mut on_setup,
            )
        } else {
            prepared.apply_frame_with_factories_and_setup(
                bytes,
                header,
                |input| Ok::<_, ResolveError>(paired_presentation(appearance(input)?)?.face),
                &mut food_factory,
                &mut on_setup,
            )
        }
        .map_err(|e| e.0)?;
        let foods = food_sources.into_inner();
        let preys = prey_sources.into_inner();
        let count = plans.len() as u32;
        submit_plans(
            plans,
            &target,
            &sprites,
            &background,
            entry,
            &sources,
            &foods,
            &preys,
        )?;
        self.commit_all(prepared, foods, preys)?;
        Ok(count)
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
        let context = SceneDrawContext::committed(&prepared, size);
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
        food_quality: Option<BodyPaintQuality>,
    ) -> Result<(), JsValue> {
        quality(quality_scale)?;
        if (self.client.food_enabled() || self.client.prey_enabled()) && food_quality.is_none() {
            return Err(error(
                "retained food requires the basic renderer's applied-quality API",
            ));
        }
        let size = DrawSize::new(f64::from(target.width()), f64::from(target.height()))?;
        let mut prepared = self.client.clone();
        let context = SceneDrawContext::committed(&prepared, size);
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
            &mut budget,
        )?;
        let camera = prepared.camera().position();
        let zoom = prepared.camera().zoom();
        let food = food_quality
            .map(|q| {
                food_plan(
                    &self.food_sources,
                    &prepared,
                    &target,
                    view(size, camera, zoom),
                    q,
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
            camera,
            zoom,
            food,
            prey,
            arena_edge: arena_edge_plan(&prepared, context)?,
            fallback,
            paint,
        };
        validate_scene_sources(&sources, &self.food_sources, &self.prey_sources, &target)?;
        size.validate_entry(&target)?;
        let frame = CanvasFrame::new(
            &target,
            &sprites,
            &background,
            camera.x - context.center,
            camera.y - context.center,
            zoom,
        )?;
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

#[derive(Clone, Copy)]
struct DrawSize {
    width: u32,
    height: u32,
}

impl DrawSize {
    fn new(width: f64, height: f64) -> Result<Self, JsValue> {
        Ok(Self {
            width: dimensions(width)?,
            height: dimensions(height)?,
        })
    }
    fn entry(target: &HtmlCanvasElement) -> Self {
        Self {
            width: target.width(),
            height: target.height(),
        }
    }
    fn half(self) -> Point {
        Point {
            x: f64::from(self.width) / 2.,
            y: f64::from(self.height) / 2.,
        }
    }
    fn validate_entry(self, target: &HtmlCanvasElement) -> Result<(), JsValue> {
        if target.width() != self.width || target.height() != self.height {
            return Err(error("target dimensions changed during recipe resolution"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct SceneDrawContext {
    size: DrawSize,
    center: f64,
    boundary: Option<f64>,
}

impl SceneDrawContext {
    fn at_setup(client: &AnimatedClient, size: DrawSize, setup: Option<&Setup>) -> Self {
        Self {
            size,
            center: setup.map_or(0., |s| s.grid_center),
            boundary: setup.and(client.boundary()).map(|b| b.displayed()),
        }
    }
    fn committed(client: &AnimatedClient, size: DrawSize) -> Self {
        Self::at_setup(client, size, client.received().setup.as_ref())
    }
}

// Empty Setup draws still reset and repaint the complete desired target.
// Charge those draws independently of geometry before invoking draw resolvers.
struct SetupDrawBudget {
    remaining_draws: u32,
    remaining_pixels: u64,
}

impl Default for SetupDrawBudget {
    fn default() -> Self {
        Self {
            remaining_draws: 64,
            remaining_pixels: 67_108_864,
        }
    }
}

impl SetupDrawBudget {
    fn charge(&mut self, size: DrawSize) -> Result<(), JsValue> {
        let draws = self
            .remaining_draws
            .checked_sub(1)
            .ok_or_else(|| error("Setup draw count budget exceeded"))?;
        let area = u64::from(size.width)
            .checked_mul(u64::from(size.height))
            .ok_or_else(|| error("Setup background pixel budget exceeded"))?;
        let pixels = self
            .remaining_pixels
            .checked_sub(area)
            .ok_or_else(|| error("Setup background pixel budget exceeded"))?;
        self.remaining_draws = draws;
        self.remaining_pixels = pixels;
        Ok(())
    }
}

struct DrawBudget {
    samples: usize,
    images: usize,
    layouts: usize,
    antenna: AntennaDrawBudget,
}
impl Default for DrawBudget {
    fn default() -> Self {
        Self {
            samples: MAX_DRAW_SAMPLES,
            images: MAX_BODY_PAINT_COMMANDS,
            layouts: MAX_DRAW_SAMPLES,
            antenna: AntennaDrawBudget::default(),
        }
    }
}
impl DrawBudget {
    fn prepared(&mut self, snakes: &[PreparedSnake]) -> Result<(), JsValue> {
        self.layouts = self
            .layouts
            .checked_sub(snakes.len())
            .ok_or_else(|| error("scene layout budget exceeded"))?;
        for snake in snakes {
            self.samples = self
                .samples
                .checked_sub(snake.curve.as_ref().map_or(0, |c| c.samples.len()))
                .ok_or_else(|| error("scene sample budget exceeded"))?;
        }
        Ok(())
    }
}

fn push<T>(values: &mut Vec<T>, value: T) -> Result<(), JsValue> {
    values
        .try_reserve(1)
        .map_err(|_| error("scene plan allocation failed"))?;
    values.push(value);
    Ok(())
}

fn collect_layouts<T>(values: impl Iterator<Item = Result<T, JsValue>>) -> Result<Vec<T>, JsValue> {
    let mut layouts = Vec::new();
    for value in values {
        push(&mut layouts, value?)?;
    }
    Ok(layouts)
}

#[derive(Clone, Copy)]
enum DrawLane<'a> {
    Basic {
        detailed: bool,
        face: &'a js_sys::Function,
    },
    Standard(&'a js_sys::Function),
    BasicAntenna {
        detailed: bool,
        presentation: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
    StandardAntenna {
        recipe: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
    BasicFace {
        detailed: bool,
        presentation: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
    StandardFace {
        recipe: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
}

impl DrawLane<'_> {
    fn with_antenna(self) -> bool {
        matches!(
            self,
            Self::BasicAntenna { .. }
                | Self::StandardAntenna { .. }
                | Self::BasicFace { .. }
                | Self::StandardFace { .. }
        )
    }

    fn with_face_presentation(self) -> bool {
        matches!(self, Self::BasicFace { .. } | Self::StandardFace { .. })
    }
}

enum FaceLayout {
    Paired {
        eyes: Option<StandardEyeLayout>,
        decoration: Option<[PairedSideLayout; 2]>,
    },
    SingleImage(SingleEyeLayout),
}

enum PlannedSnakePaint {
    Basic {
        snakes: Vec<PreparedSnake>,
        layouts: Vec<FaceLayout>,
        faces: Vec<FaceSources>,
        antennas: Vec<Option<AntennaDecoration>>,
    },
    Standard {
        draws: Vec<StandardDraw>,
        recipes: Vec<Recipe>,
    },
}
struct StandardDraw {
    plan: Option<BodyPaintPlan>,
    layout: FaceLayout,
    root_alpha: f64,
    antenna: Option<PreparedAntenna>,
}
struct PlannedScene {
    context: SceneDrawContext,
    camera: Point,
    zoom: f64,
    food: Option<FoodPaintPlan>,
    prey: Option<PreyPaintPlan>,
    arena_edge: Option<ArenaEdgePlan>,
    fallback: Vec<Food>,
    paint: PlannedSnakePaint,
}

fn arena_edge_plan(
    prepared: &AnimatedClient,
    context: SceneDrawContext,
) -> Result<Option<ArenaEdgePlan>, JsValue> {
    context
        .boundary
        .map(|radius| {
            plan_arena_edge(ArenaEdgeInput {
                view: prepared.arena_edge_view(),
                camera: prepared.camera().position(),
                zoom: prepared.camera().zoom(),
                width: context.size.width,
                height: context.size.height,
                radius,
            })
            .map_err(error)
        })
        .transpose()
        .map(Option::flatten)
}

fn submit_arena_edge(
    context: &CanvasRenderingContext2d,
    plan: &ArenaEdgePlan,
) -> Result<(), JsValue> {
    context.save();
    let result = (|| {
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.set_global_composite_operation("source-over")?;
        context.set_global_alpha(0.8);
        context.set_line_width(plan.line_width);
        context.set_fill_style_str("#300000");
        context.set_stroke_style_str("#800000");
        context.begin_path();
        context.move_to(plan.fill[0].x, plan.fill[0].y);
        for point in &plan.fill[1..] {
            context.line_to(point.x, point.y);
        }
        context.close_path();
        context.fill();
        context.begin_path();
        context.move_to(plan.stroke[0].x, plan.stroke[0].y);
        for point in &plan.stroke[1..] {
            context.line_to(point.x, point.y);
        }
        context.stroke();
        Ok(())
    })();
    context.restore();
    result
}

fn view(size: DrawSize, camera: Point, zoom: f64) -> BodyPaintView {
    let half = size.half();
    BodyPaintView {
        camera,
        zoom,
        half_width: half.x,
        half_height: half.y,
    }
}

fn fallback_food(prepared: &AnimatedClient, needed: bool) -> Result<Vec<Food>, JsValue> {
    let mut foods = Vec::new();
    if needed {
        foods
            .try_reserve(prepared.received().foods.len())
            .map_err(|_| error("scene plan allocation failed"))?;
        foods.extend(prepared.received().foods.values().cloned());
    }
    Ok(foods)
}

fn food_plan(
    sources: &FoodSources,
    prepared: &AnimatedClient,
    target: &HtmlCanvasElement,
    view: BodyPaintView,
    quality: BodyPaintQuality,
    budget: &mut DrawBudget,
) -> Result<Option<FoodPaintPlan>, JsValue> {
    if !prepared.food_enabled() {
        return Ok(None);
    }
    sources.validate(target)?;
    let plan = plan_food(FoodPaintInput {
        foods: prepared.foods().foods(),
        view,
        quality,
        bounds: prepared.food_bounds(),
        assets: &sources.assets()?,
        target_handle: None,
        entry_alpha: 1.,
        command_limit: budget.images,
    })
    .map_err(error)?;
    budget.images = budget
        .images
        .checked_sub(plan.early.len())
        .and_then(|n| n.checked_sub(plan.late.len()))
        .ok_or_else(|| error("scene image budget exceeded"))?;
    Ok(Some(plan))
}

fn submit_food(
    sources: &FoodSources,
    context: &CanvasRenderingContext2d,
    commands: &[FoodImageCommand],
) -> Result<(), JsValue> {
    context.save();
    let result = commands
        .iter()
        .try_for_each(|command| sources.submit(context, command));
    context.restore();
    result
}

fn prey_plan(
    sources: &PreySources,
    prepared: &AnimatedClient,
    target: &HtmlCanvasElement,
    view: BodyPaintView,
    budget: &mut DrawBudget,
) -> Result<Option<PreyPaintPlan>, JsValue> {
    if !prepared.prey_enabled() {
        return Ok(None);
    }
    sources.validate(target)?;
    let mut eaters = Vec::new();
    for token in prepared.preys().referenced_eaters() {
        if eaters.iter().any(|(prior, _)| *prior == token) {
            continue;
        }
        let snake = prepared
            .snake_object(token)
            .ok_or_else(|| error("missing captured prey eater"))?;
        let metrics = snake.metrics();
        let offset = snake.head_corrections().offset();
        push(
            &mut eaters,
            (
                token,
                PreyEaterPose {
                    head: metrics.raw_head,
                    head_offset: Point {
                        x: offset[0],
                        y: offset[1],
                    },
                    heading: metrics.heading,
                    angle_offset: snake.angle_corrections().offset(),
                },
            ),
        )?;
    }
    let plan = plan_prey(PreyPaintInput {
        preys: prepared.preys().preys(),
        eaters: &eaters,
        view,
        assets: &sources.assets()?,
        target_handle: None,
        early_entry_alpha: 1.,
        late_entry_alpha: 1.,
        command_limit: budget.images,
    })
    .map_err(error)?;
    budget.images = budget
        .images
        .checked_sub(plan.counts.total())
        .ok_or_else(|| error("scene image budget exceeded"))?;
    Ok(Some(plan))
}

fn submit_prey(
    sources: &PreySources,
    context: &CanvasRenderingContext2d,
    commands: &[PreyImageCommand],
) -> Result<(), JsValue> {
    context.save();
    let result = (|| {
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.set_global_composite_operation("lighter")?;
        commands
            .iter()
            .try_for_each(|command| sources.submit(context, command))
    })();
    context.restore();
    result
}

#[allow(clippy::too_many_arguments)]
fn prepare_snakes<F>(
    prepared: &mut AnimatedClient,
    size: DrawSize,
    quality_scale: f64,
    budget: &mut DrawBudget,
    resolve_style: F,
    random: Option<&js_sys::Function>,
    generalized: bool,
) -> Result<Vec<PreparedSnake>, JsValue>
where
    F: FnMut(usize, bool, &SnakePresentation) -> Result<bool, ResolveError>,
{
    let result = if generalized {
        let random = random.ok_or_else(|| error("face presentation random resolver required"))?;
        prepared.prepare_draw_resolved_with_face_presentation_limited_staged(
            size.width,
            size.height,
            quality_scale,
            budget.samples,
            &mut budget.antenna,
            resolve_style,
            |input| antenna_random(random, input),
        )
    } else if let Some(random) = random {
        prepared.prepare_draw_resolved_with_antenna_limited_staged(
            size.width,
            size.height,
            quality_scale,
            budget.samples,
            &mut budget.antenna,
            resolve_style,
            |input| antenna_random(random, input),
        )
    } else {
        prepared.prepare_draw_resolved_limited_staged(
            size.width,
            size.height,
            quality_scale,
            budget.samples,
            resolve_style,
        )
    };
    result.map_err(|e| e.0)
}

// Ordinals include culled draw entries; copy only configurations before the
// client is mutably borrowed for its single draw-preparation pass.
fn drawn_antenna_geometry(
    prepared: &AnimatedClient,
) -> Result<Vec<Option<OrdinaryAntennaGeometry>>, JsValue> {
    collect_layouts(
        prepared
            .snake_objects()
            .filter(|(_, _, drawn, _)| *drawn)
            .map(|(token, _, _, _)| Ok(prepared.antenna_geometry(token))),
    )
}

fn face_image_count(face: Option<&FaceSources>) -> usize {
    match face {
        Some(FaceSources::SingleImage(_))
        | Some(FaceSources::Paired {
            decoration: Some(_),
            ..
        }) => 2,
        _ => 0,
    }
}

fn plan_face(
    snake: &PreparedSnake,
    face: Option<&FaceSources>,
    view: EyeLayoutInput,
) -> Result<FaceLayout, JsValue> {
    match face {
        Some(FaceSources::SingleImage(_)) => Ok(FaceLayout::SingleImage(
            snake
                .face_geometry
                .single_image()
                .ok_or_else(|| error("single image geometry required"))?
                .layout(snake.face_heading, snake.pupil, view)
                .map_err(error)?,
        )),
        Some(FaceSources::Paired { decoration, .. }) => Ok(FaceLayout::Paired {
            eyes: Some(
                snake
                    .eye_geometry
                    .ok_or_else(|| error("paired geometry required"))?
                    .layout(snake.face_heading, snake.pupil, view)
                    .map_err(error)?,
            ),
            decoration: decoration
                .as_ref()
                .map(|d| d.geometry.layout(snake.face_heading, view).map_err(error))
                .transpose()?,
        }),
        None => Ok(FaceLayout::Paired {
            eyes: None,
            decoration: None,
        }),
    }
}

fn submit_selected_face(
    sources: &BorrowedSources,
    context: &CanvasRenderingContext2d,
    face: Option<&FaceSources>,
    layout: FaceLayout,
    basic: bool,
) -> Result<(), JsValue> {
    match layout {
        FaceLayout::SingleImage(layout) => {
            let Some(FaceSources::SingleImage(face)) = face else {
                return Err(error("planned single image sources missing"));
            };
            sources.submit_single_eye(context, face, &layout)?;
            context.set_global_alpha(1.);
        }
        FaceLayout::Paired { eyes, decoration } => {
            if let Some(layout) = eyes {
                draw_eyes(context, layout)?;
            }
            context.set_global_alpha(1.);
            if basic {
                context.set_global_composite_operation("source-over")?;
            }
            if let Some(layouts) = decoration {
                let Some(FaceSources::Paired {
                    decoration: Some(face),
                    ..
                }) = face
                else {
                    return Err(error("planned paired decoration missing"));
                };
                sources.submit_face(context, face, layouts)?;
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn build_standard(
    prepared: &mut AnimatedClient,
    sources: &mut BorrowedSources,
    target: &HtmlCanvasElement,
    size: DrawSize,
    resolve_recipe: &js_sys::Function,
    random: Option<&js_sys::Function>,
    generalized: bool,
    applied: QualitySnapshot,
    budget: &mut DrawBudget,
) -> Result<PlannedSnakePaint, JsValue> {
    let DrawSize { width, height } = size;
    let mut recipes = Vec::new();
    let retained = if random.is_some() {
        drawn_antenna_geometry(prepared)?
    } else {
        Vec::new()
    };
    let snakes = prepare_snakes(
        prepared,
        size,
        applied.quality_scale,
        budget,
        |ordinal, own, snake| -> Result<bool, ResolveError> {
            let request = request(ordinal, own, snake)?;
            let recipe = if generalized {
                sources.resolve_with_face(
                    resolve_recipe,
                    &request,
                    target,
                    &FacePresentation {
                        face: *snake.active_face_geometry(),
                        antenna: *retained
                            .get(ordinal)
                            .ok_or_else(|| error("missing retained antenna configuration"))?,
                    },
                )?
            } else if random.is_some() {
                sources.resolve_with_antenna(
                    resolve_recipe,
                    &request,
                    target,
                    retained
                        .get(ordinal)
                        .ok_or_else(|| error("missing retained antenna configuration"))?
                        .as_ref(),
                )?
            } else {
                sources.resolve(resolve_recipe, &request, target)?
            };
            if !generalized {
                let retained = snake
                    .face_geometry()
                    .ok_or_else(|| error("legacy renderer requires paired face"))?;
                let decoration = match &recipe.face {
                    Some(FaceSources::Paired { eyes, decoration }) => {
                        if !same_eyes(eyes, &retained.eyes) {
                            return Err(error(
                                "recipe eyes differ from retained appearance geometry",
                            )
                            .into());
                        }
                        decoration.as_ref()
                    }
                    None => None,
                    Some(FaceSources::SingleImage(_)) => {
                        return Err(error("legacy renderer requires paired face").into());
                    }
                };
                if !same_decoration(decoration, retained.decoration.as_ref()) {
                    return Err(error(
                        "recipe decoration differs from retained appearance geometry",
                    )
                    .into());
                }
            }
            let detailed = recipe.style.detailed_segments;
            push(&mut recipes, recipe)?;
            Ok(detailed)
        },
        random,
        generalized,
    )?;
    if snakes.len() > MAX_RETAINED_SNAKES {
        return Err(error("face command budget exceeded"));
    }
    let camera = prepared.camera().position();
    let zoom = prepared.camera().zoom();
    let viewport_half = Point {
        x: f64::from(width) / 2.,
        y: f64::from(height) / 2.,
    };
    let mut draws = Vec::new();
    budget.prepared(&snakes)?;
    let mut remaining = budget.images;
    // Every ordinary face completes with an unconditional root alpha one,
    // including eye-less and nondecorated faces. Standalone planner callers
    // still control their own entry alpha.
    let entry_alpha = 1.;
    for (snake, recipe) in snakes.iter().zip(&recipes) {
        if snake
            .antenna
            .as_ref()
            .is_some_and(|antenna| antenna.bulb.is_some())
        {
            remaining = remaining
                .checked_sub(1)
                .ok_or_else(|| error("scene image budget exceeded"))?;
        }
        remaining = remaining
            .checked_sub(face_image_count(recipe.face.as_ref()))
            .ok_or_else(|| error("scene image budget exceeded"))?;
        let m = snake.metrics;
        let layout = plan_face(
            snake,
            recipe.face.as_ref(),
            EyeLayoutInput {
                corrected_head: m.corrected_head,
                camera,
                viewport_half,
                scale: m.scale,
                zoom,
                death_progress: m.death_progress,
            },
        )?;
        let mut root_alpha = entry_alpha;
        let plan = if let Some(geometry) = &snake.body_geometry {
            let palettes = recipe.palettes();
            let maximum_speed = m.maximum_speed;
            let input = BodyPaintInput {
                geometry: geometry.as_paint_geometry(),
                recipe: recipe.borrowed(&palettes),
                assets: &recipe.assets,
                view: BodyPaintView {
                    camera,
                    zoom,
                    half_width: viewport_half.x,
                    half_height: viewport_half.y,
                },
                quality: BodyPaintQuality {
                    high_quality: applied.high_quality,
                    blend: applied.quality_blend,
                },
                visual: BodyPaintVisual {
                    scale: m.scale,
                    spawn: m.spawn_progress,
                    death: m.death_progress,
                    dead: !m.alive,
                    smoothed_speed: m.visual_speed,
                    boost_threshold: m.boost_threshold_speed,
                    cruise_speed: m.cruise_speed,
                    maximum_speed,
                    boost_phase: m.boost_phase,
                },
                entry_alpha,
                command_limit: remaining,
            };
            let body = if let Some(antenna) = &snake.antenna {
                plan_standard_body_with_antenna(input, antenna.barrier_effect)
            } else {
                plan_standard_body(input)
            };
            match body {
                Ok(plan) => {
                    remaining = remaining
                        .checked_sub(plan.commands.len())
                        .ok_or_else(|| error("scene image budget exceeded"))?;
                    let mut opacity = m.spawn_progress * (1. - m.death_progress);
                    opacity *= opacity;
                    let boost = if m.visual_speed > m.boost_threshold_speed {
                        m.spawn_progress
                            * (1. - m.death_progress)
                            * ((m.visual_speed - m.cruise_speed) / (maximum_speed - m.cruise_speed))
                                .clamp(0., 1.)
                    } else {
                        0.
                    };
                    root_alpha = opacity * (1. - boost);
                    Some(plan)
                }
                // Coincident/short stored geometry has no production body.
                // Its independently valid eyes still complete in draw order.
                Err(BodyPaintError::UnsupportedGeometry) => None,
                Err(e) => return Err(error(e)),
            }
        } else {
            None
        };
        push(
            &mut draws,
            StandardDraw {
                plan,
                layout,
                root_alpha,
                antenna: snake.antenna.clone(),
            },
        )?;
    }
    budget.images = remaining;
    Ok(PlannedSnakePaint::Standard { draws, recipes })
}

#[allow(clippy::too_many_arguments)]
fn build_basic(
    prepared: &mut AnimatedClient,
    sources: &mut BorrowedSources,
    target: &HtmlCanvasElement,
    size: DrawSize,
    quality_scale: f64,
    detailed_style: bool,
    resolve_face: Option<&js_sys::Function>,
    random: Option<&js_sys::Function>,
    generalized: bool,
    budget: &mut DrawBudget,
) -> Result<PlannedSnakePaint, JsValue> {
    let DrawSize { width, height } = size;
    let mut faces = Vec::new();
    let mut antennas = Vec::new();
    let retained = if random.is_some() {
        drawn_antenna_geometry(prepared)?
    } else {
        Vec::new()
    };
    let snakes = prepare_snakes(
        prepared,
        size,
        quality_scale,
        budget,
        |ordinal, own, snake| -> Result<bool, ResolveError> {
            let (face, antenna) = if generalized {
                let retained = FacePresentation {
                    face: *snake.active_face_geometry(),
                    antenna: *retained
                        .get(ordinal)
                        .ok_or_else(|| error("missing retained antenna configuration"))?,
                };
                let resolved = sources.resolve_generalized_presentation(
                    resolve_face.ok_or_else(|| error("presentation resolver required"))?,
                    &request(ordinal, own, snake)?,
                    &retained,
                    target,
                )?;
                (resolved.face, resolved.antenna)
            } else {
                let paired = snake
                    .face_geometry()
                    .ok_or_else(|| error("legacy renderer requires paired face"))?;
                let (decoration, antenna) = if random.is_some() {
                    let retained = AppearancePresentation {
                        face: *paired,
                        antenna: *retained
                            .get(ordinal)
                            .ok_or_else(|| error("missing retained antenna configuration"))?,
                    };
                    let resolved = sources.resolve_presentation(
                        resolve_face.ok_or_else(|| error("presentation resolver required"))?,
                        &request(ordinal, own, snake)?,
                        &retained,
                        target,
                    )?;
                    (resolved.decoration, resolved.antenna)
                } else if let Some(resolve_face) = resolve_face {
                    (
                        sources.resolve_face(
                            resolve_face,
                            &request(ordinal, own, snake)?,
                            paired,
                            target,
                        )?,
                        None,
                    )
                } else {
                    if paired.decoration.is_some() {
                        return Err(
                            error("decorated face requires render_with_face_decorations").into(),
                        );
                    }
                    (None, None)
                };
                (
                    FaceSources::Paired {
                        eyes: paired.eyes,
                        decoration,
                    },
                    antenna,
                )
            };
            push(&mut faces, face)?;
            push(&mut antennas, antenna)?;
            Ok(detailed_style)
        },
        random,
        generalized,
    )?;
    if snakes.len() > MAX_RETAINED_SNAKES {
        return Err(error("face command budget exceeded"));
    }
    let camera = prepared.camera().position();
    let zoom = prepared.camera().zoom();
    let viewport_half = Point {
        x: f64::from(width) / 2.,
        y: f64::from(height) / 2.,
    };
    budget.prepared(&snakes)?;
    // Complete numeric validation before the target's destructive width reset.
    let layouts = collect_layouts(snakes.iter().zip(&faces).map(|(snake, face)| {
        plan_face(
            snake,
            Some(face),
            EyeLayoutInput {
                corrected_head: snake.metrics.corrected_head,
                camera,
                viewport_half,
                scale: snake.metrics.scale,
                zoom,
                death_progress: snake.metrics.death_progress,
            },
        )
    }))?;
    let image_count = snakes
        .iter()
        .try_fold(0_usize, |count, snake| {
            count
                .checked_add(snake.curve.as_ref().map_or(0, |curve| curve.samples.len()))
                .and_then(|count| {
                    count.checked_add(usize::from(
                        snake
                            .antenna
                            .as_ref()
                            .is_some_and(|antenna| antenna.bulb.is_some()),
                    ))
                })
        })
        .and_then(|count| {
            faces.iter().try_fold(count, |count, face| {
                count.checked_add(face_image_count(Some(face)))
            })
        })
        .ok_or_else(|| error("scene image budget exceeded"))?;
    budget.images = budget
        .images
        .checked_sub(image_count)
        .ok_or_else(|| error("scene image budget exceeded"))?;
    Ok(PlannedSnakePaint::Basic {
        snakes,
        layouts,
        faces,
        antennas,
    })
}

#[allow(clippy::too_many_arguments)]
fn build_paint(
    prepared: &mut AnimatedClient,
    sources: &mut BorrowedSources,
    target: &HtmlCanvasElement,
    size: DrawSize,
    lane: DrawLane<'_>,
    applied: QualitySnapshot,
    budget: &mut DrawBudget,
) -> Result<PlannedSnakePaint, JsValue> {
    let generalized = lane.with_face_presentation();
    match lane {
        DrawLane::Basic { detailed, face } => build_basic(
            prepared,
            sources,
            target,
            size,
            applied.quality_scale,
            detailed,
            Some(face),
            None,
            false,
            budget,
        ),
        DrawLane::Standard(recipe) => build_standard(
            prepared, sources, target, size, recipe, None, false, applied, budget,
        ),
        DrawLane::BasicAntenna {
            detailed,
            presentation,
            random,
        }
        | DrawLane::BasicFace {
            detailed,
            presentation,
            random,
        } => build_basic(
            prepared,
            sources,
            target,
            size,
            applied.quality_scale,
            detailed,
            Some(presentation),
            Some(random),
            generalized,
            budget,
        ),
        DrawLane::StandardAntenna { recipe, random }
        | DrawLane::StandardFace { recipe, random } => build_standard(
            prepared,
            sources,
            target,
            size,
            recipe,
            Some(random),
            generalized,
            applied,
            budget,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn submit_plans(
    plans: Vec<PlannedScene>,
    target: &HtmlCanvasElement,
    sprites: &[HtmlCanvasElement; 3],
    background: &HtmlImageElement,
    entry: DrawSize,
    sources: &BorrowedSources,
    foods: &FoodSources,
    preys: &PreySources,
) -> Result<(), JsValue> {
    validate_scene_sources(sources, foods, preys, target)?;
    entry.validate_entry(target)?;
    let mut frames = Vec::new();
    frames
        .try_reserve(plans.len())
        .map_err(|_| error("scene preflight allocation failed"))?;
    // Acquire every native context and pattern before the first destructive draw.
    for plan in &plans {
        frames.push(CanvasPreflight::new(
            target,
            sprites,
            background,
            plan.context.size.width,
            plan.context.size.height,
            plan.camera.x - plan.context.center,
            plan.camera.y - plan.context.center,
            plan.zoom,
        )?);
    }
    entry.validate_entry(target)?;
    for (plan, frame) in plans.into_iter().zip(frames) {
        plan.submit(frame.begin(target)?, sprites, sources, foods, preys)?;
    }
    Ok(())
}

fn submit_antenna(
    sources: &BorrowedSources,
    context: &CanvasRenderingContext2d,
    decoration: Option<&AntennaDecoration>,
    plan: &PreparedAntenna,
) -> Result<(), JsValue> {
    if plan.strokes.is_empty() {
        return Ok(());
    }
    context.save();
    let result = (|| {
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.translate(plan.center.x, plan.center.y)?;
        context.set_global_composite_operation("source-over")?;
        context.set_line_cap("round");
        context.set_line_join("round");
        let mut current_path = None;
        for stroke in &plan.strokes {
            if current_path != Some(stroke.path) {
                let vertices = match stroke.path {
                    AntennaPath::Outer => &plan.outer_path,
                    AntennaPath::Inner => &plan.inner_path,
                };
                context.begin_path();
                if let Some((first, rest)) = vertices.split_first() {
                    context.move_to(first.x, first.y);
                    for point in rest {
                        context.line_to(point.x, point.y);
                    }
                }
                current_path = Some(stroke.path);
            }
            context.set_global_alpha(stroke.alpha);
            context.set_stroke_style_str(&format!("#{:06x}", stroke.color));
            context.set_line_width(stroke.width);
            context.stroke();
        }
        if let Some(bulb) = &plan.bulb {
            sources.submit_antenna_bulb(
                context,
                decoration.ok_or_else(|| error("planned antenna bulb source missing"))?,
                bulb,
            )?;
        }
        Ok(())
    })();
    context.restore();
    result
}

impl PlannedScene {
    #[allow(clippy::too_many_arguments)]
    fn build(
        prepared: &mut AnimatedClient,
        food_sources: &FoodSources,
        prey_sources: &PreySources,
        sources: &mut BorrowedSources,
        target: &HtmlCanvasElement,
        context: SceneDrawContext,
        lane: DrawLane<'_>,
        applied: QualitySnapshot,
        budget: &mut DrawBudget,
    ) -> Result<Self, JsValue> {
        let paint = build_paint(
            prepared,
            sources,
            target,
            context.size,
            lane,
            applied,
            budget,
        )?;
        Self::finish(
            prepared,
            food_sources,
            prey_sources,
            target,
            context,
            paint,
            applied,
            budget,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn finish(
        prepared: &AnimatedClient,
        food_sources: &FoodSources,
        prey_sources: &PreySources,
        target: &HtmlCanvasElement,
        context: SceneDrawContext,
        paint: PlannedSnakePaint,
        applied: QualitySnapshot,
        budget: &mut DrawBudget,
    ) -> Result<Self, JsValue> {
        let camera = prepared.camera().position();
        let zoom = prepared.camera().zoom();
        let food = food_plan(
            food_sources,
            prepared,
            target,
            view(context.size, camera, zoom),
            BodyPaintQuality {
                high_quality: applied.high_quality,
                blend: applied.quality_blend,
            },
            budget,
        )?;
        let fallback = fallback_food(prepared, food.is_none())?;
        let prey = prey_plan(
            prey_sources,
            prepared,
            target,
            view(context.size, camera, zoom),
            budget,
        )?;
        Ok(Self {
            context,
            camera,
            zoom,
            food,
            prey,
            arena_edge: arena_edge_plan(prepared, context)?,
            fallback,
            paint,
        })
    }

    fn submit(
        self,
        frame: CanvasFrame,
        sprites: &[HtmlCanvasElement; 3],
        sources: &BorrowedSources,
        food_sources: &FoodSources,
        prey_sources: &PreySources,
    ) -> Result<(), JsValue> {
        let context = frame.context();
        let camera = self.camera;
        let zoom = self.zoom;
        let viewport_half = self.context.size.half();
        if let Some(plan) = &self.food {
            submit_food(food_sources, context, &plan.early[..plan.outline_barrier])?;
            submit_food(food_sources, context, &plan.early[plan.outline_barrier..])?;
        } else {
            for food in &self.fallback {
                if frame.visible(food.position.x, food.position.y, food.size.max(1.)) {
                    draw_sprite(
                        context,
                        &sprites[usize::from(food.color) % 3],
                        food.position.x,
                        food.position.y,
                        food.size.max(1.),
                    )?;
                }
            }
        }
        if let Some(plan) = &self.prey {
            submit_prey(prey_sources, context, &plan.early)?;
        }
        match self.paint {
            PlannedSnakePaint::Basic {
                snakes,
                layouts,
                faces,
                antennas,
            } => {
                // Preserve subtraction-before-scaling for body screen coordinates. The
                // borrowed background/food preview above retains its existing transform.
                for (((snake, layout), face), antenna) in
                    snakes.into_iter().zip(layouts).zip(&faces).zip(&antennas)
                {
                    context.set_transform(1., 0., 0., 1., viewport_half.x, viewport_half.y)?;
                    let m = snake.metrics;
                    let opacity = m.spawn_progress * (1. - m.death_progress);
                    context.set_global_alpha(opacity * opacity);
                    if let Some(curve) = snake.curve {
                        for point in curve.samples.iter().rev() {
                            context.save();
                            let result = (|| {
                                context.translate(
                                    (f64::from(point.x) - camera.x) * zoom,
                                    (f64::from(point.y) - camera.y) * zoom,
                                )?;
                                context.rotate(f64::from(point.angle))?;
                                draw_sprite(
                                    context,
                                    &sprites[usize::from(m.skin) % 3],
                                    0.,
                                    0.,
                                    zoom * (29. * m.scale),
                                )?;
                                Ok::<_, JsValue>(())
                            })();
                            context.restore();
                            result?;
                        }
                    }
                    if let Some(plan) = &snake.antenna {
                        submit_antenna(sources, context, antenna.as_ref(), plan)?;
                    }
                    submit_selected_face(sources, context, Some(face), layout, true)?;
                }
            }
            PlannedSnakePaint::Standard { draws, recipes } => {
                for (
                    StandardDraw {
                        plan,
                        layout,
                        root_alpha,
                        antenna,
                    },
                    recipe,
                ) in draws.into_iter().zip(&recipes)
                {
                    let barrier = plan.as_ref().map_or(0, |p| p.antenna_barrier);
                    if let Some(antenna) = &antenna {
                        if let Some(plan) = &plan {
                            for command in &plan.commands[..barrier] {
                                sources.submit(context, command)?;
                            }
                        }
                        submit_antenna(sources, context, recipe.antenna.as_ref(), antenna)?;
                        if let Some(plan) = &plan {
                            for command in &plan.commands[barrier..] {
                                sources.submit(context, command)?;
                            }
                        }
                    } else if let Some(plan) = &plan {
                        for command in &plan.commands {
                            sources.submit(context, command)?;
                        }
                    }
                    context.set_global_alpha(root_alpha);
                    context.set_global_composite_operation("source-over")?;
                    submit_selected_face(sources, context, recipe.face.as_ref(), layout, false)?;
                }
            }
        }
        if let Some(plan) = &self.food {
            submit_food(food_sources, context, &plan.late)?;
        }
        if let Some(plan) = &self.prey {
            submit_prey(prey_sources, context, &plan.late)?;
        }
        if let Some(plan) = &self.arena_edge {
            submit_arena_edge(context, plan)?;
        }
        Ok(())
    }
}
