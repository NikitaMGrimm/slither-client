//! Browser ownership of the coupled model; caller-supplied time and borrowed assets.

use std::{cell::RefCell, f64::consts::TAU};

use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

use crate::{
    body_browser::{
        BorrowedSources, FaceDecoration, Recipe, ResolveError, appearance_request, paired_face,
        request, same_decoration, same_eyes, standard_eyes,
    },
    canvas_browser::{CanvasFrame, CanvasPreflight, draw_sprite},
    food_browser::FoodSources,
    presentation::{
        AnimatedClient, BodyPaintError, BodyPaintInput, BodyPaintPlan, BodyPaintQuality,
        BodyPaintView, BodyPaintVisual, CurveInput, CurveOutput, EyeLayoutInput, FoodImageCommand,
        FoodPaintInput, FoodPaintPlan, MAX_BODY_PAINT_COMMANDS, MAX_DRAW_SAMPLES,
        MAX_RETAINED_SNAKES, PairedSideLayout, PreparedSnake, PreyEaterPose, PreyImageCommand,
        PreyPaintInput, PreyPaintPlan, QualitySnapshot, SnakePresentation, StandardEyeLayout, Turn,
        plan_food, plan_prey, plan_standard_body, sample_curve_with_heading,
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

    /// Advance the animation clock and drawn entities; free the returned step.
    pub fn advance(&mut self, now_ms: f64, lagging: bool) -> Result<AnimationStep, JsValue> {
        let inner = self.client.advance(now_ms, lagging).map_err(error)?;
        self.food_sources.retain(self.client.foods().foods());
        self.prey_sources.retain(self.client.preys().preys());
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
        let size = DrawSize::new(f64::from(target.width()), f64::from(target.height()))?;
        let entry = size;
        let sprites = [food_0, food_1, food_2];
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
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
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
}

impl AnimatedScene {
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
            Ok(paired_face(&raw)?)
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
        if resolve_prey.is_some() {
            prepared.apply_frame_with_all_factories_and_setup(
                bytes,
                header,
                &mut appearance,
                &mut food_factory,
                &mut prey_factory,
                &mut on_setup,
            )
        } else {
            prepared.apply_frame_with_factories_and_setup(
                bytes,
                header,
                &mut appearance,
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
        if !self.client.food_enabled() {
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
}
impl Default for DrawBudget {
    fn default() -> Self {
        Self {
            samples: MAX_DRAW_SAMPLES,
            images: MAX_BODY_PAINT_COMMANDS,
            layouts: MAX_DRAW_SAMPLES,
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
}

enum PlannedSnakePaint {
    Basic {
        snakes: Vec<PreparedSnake>,
        layouts: Vec<StandardEyeLayout>,
        decorations: Vec<Option<FaceDecoration>>,
        decoration_layouts: Vec<Option<[PairedSideLayout; 2]>>,
    },
    Standard {
        draws: Vec<StandardDraw>,
        recipes: Vec<Recipe>,
    },
}
struct StandardDraw {
    plan: Option<BodyPaintPlan>,
    layout: Option<StandardEyeLayout>,
    root_alpha: f64,
    decoration_layout: Option<[PairedSideLayout; 2]>,
}
struct PlannedScene {
    context: SceneDrawContext,
    camera: Point,
    zoom: f64,
    food: Option<FoodPaintPlan>,
    prey: Option<PreyPaintPlan>,
    fallback: Vec<Food>,
    paint: PlannedSnakePaint,
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
fn build_standard(
    prepared: &mut AnimatedClient,
    sources: &mut BorrowedSources,
    target: &HtmlCanvasElement,
    size: DrawSize,
    resolve_recipe: &js_sys::Function,
    applied: QualitySnapshot,
    budget: &mut DrawBudget,
) -> Result<PlannedSnakePaint, JsValue> {
    let DrawSize { width, height } = size;
    let mut recipes = Vec::new();
    let snakes = prepared
        .prepare_draw_resolved_limited_staged(
            width,
            height,
            applied.quality_scale,
            budget.samples,
            |ordinal, own, snake| -> Result<bool, ResolveError> {
                let recipe =
                    sources.resolve(resolve_recipe, &request(ordinal, own, snake)?, target)?;
                if let Some(eyes) = &recipe.eyes
                    && !same_eyes(eyes, snake.eye_geometry())
                {
                    return Err(
                        error("recipe eyes differ from retained appearance geometry").into(),
                    );
                }
                if !same_decoration(
                    recipe.decoration.as_ref(),
                    snake.face_geometry().decoration.as_ref(),
                ) {
                    return Err(error(
                        "recipe decoration differs from retained appearance geometry",
                    )
                    .into());
                }
                let detailed = recipe.style.detailed_segments;
                push(&mut recipes, recipe)?;
                Ok(detailed)
            },
        )
        .map_err(|e| e.0)?;
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
        if recipe.decoration.is_some() {
            remaining = remaining
                .checked_sub(2)
                .ok_or_else(|| error("scene image budget exceeded"))?;
        }
        let m = snake.metrics;
        let layout = if recipe.eyes.is_some() {
            Some(
                snake
                    .eye_geometry
                    .layout(
                        snake.face_heading,
                        snake.pupil,
                        EyeLayoutInput {
                            corrected_head: m.corrected_head,
                            camera,
                            viewport_half,
                            scale: m.scale,
                            zoom,
                            death_progress: m.death_progress,
                        },
                    )
                    .map_err(error)?,
            )
        } else {
            None
        };
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
            match plan_standard_body(input) {
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
        let decoration_layout = recipe
            .decoration
            .as_ref()
            .map(|d| {
                d.geometry
                    .layout(
                        snake.face_heading,
                        EyeLayoutInput {
                            corrected_head: m.corrected_head,
                            camera,
                            viewport_half,
                            scale: m.scale,
                            zoom,
                            death_progress: m.death_progress,
                        },
                    )
                    .map_err(error)
            })
            .transpose()?;
        push(
            &mut draws,
            StandardDraw {
                plan,
                layout,
                root_alpha,
                decoration_layout,
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
    budget: &mut DrawBudget,
) -> Result<PlannedSnakePaint, JsValue> {
    let DrawSize { width, height } = size;
    let mut decorations = Vec::new();
    let snakes = prepared
        .prepare_draw_resolved_limited_staged(
            width,
            height,
            quality_scale,
            budget.samples,
            |ordinal, own, snake| -> Result<bool, ResolveError> {
                let decoration = if let Some(resolve_face) = resolve_face {
                    sources.resolve_face(
                        resolve_face,
                        &request(ordinal, own, snake)?,
                        snake.face_geometry(),
                        target,
                    )?
                } else {
                    if snake.face_geometry().decoration.is_some() {
                        return Err(
                            error("decorated face requires render_with_face_decorations").into(),
                        );
                    }
                    None
                };
                push(&mut decorations, decoration)?;
                Ok(detailed_style)
            },
        )
        .map_err(|e| e.0)?;
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
    let layouts = collect_layouts(snakes.iter().map(|snake| {
        snake
            .eye_geometry
            .layout(
                snake.face_heading,
                snake.pupil,
                EyeLayoutInput {
                    corrected_head: snake.metrics.corrected_head,
                    camera,
                    viewport_half,
                    scale: snake.metrics.scale,
                    zoom,
                    death_progress: snake.metrics.death_progress,
                },
            )
            .map_err(error)
    }))?;
    let decoration_layouts =
        collect_layouts(snakes.iter().zip(&decorations).map(|(snake, decoration)| {
            decoration
                .as_ref()
                .map(|d| {
                    d.geometry
                        .layout(
                            snake.face_heading,
                            EyeLayoutInput {
                                corrected_head: snake.metrics.corrected_head,
                                camera,
                                viewport_half,
                                scale: snake.metrics.scale,
                                zoom,
                                death_progress: snake.metrics.death_progress,
                            },
                        )
                        .map_err(error)
                })
                .transpose()
        }))?;
    let image_count = snakes
        .iter()
        .try_fold(0_usize, |count, snake| {
            count.checked_add(snake.curve.as_ref().map_or(0, |curve| curve.samples.len()))
        })
        .and_then(|count| {
            decorations
                .iter()
                .filter(|d| d.is_some())
                .count()
                .checked_mul(2)
                .and_then(|sides| count.checked_add(sides))
        })
        .ok_or_else(|| error("scene image budget exceeded"))?;
    budget.images = budget
        .images
        .checked_sub(image_count)
        .ok_or_else(|| error("scene image budget exceeded"))?;
    Ok(PlannedSnakePaint::Basic {
        snakes,
        layouts,
        decorations,
        decoration_layouts,
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
    match lane {
        DrawLane::Basic { detailed, face } => build_basic(
            prepared,
            sources,
            target,
            size,
            applied.quality_scale,
            detailed,
            Some(face),
            budget,
        ),
        DrawLane::Standard(recipe) => {
            build_standard(prepared, sources, target, size, recipe, applied, budget)
        }
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
        if let Some(boundary) = self.context.boundary {
            context.begin_path();
            context.arc(0., 0., boundary, 0., TAU)?;
            context.set_stroke_style_str("#647481");
            context.set_line_width(1. / zoom);
            context.stroke();
        }
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
                decorations,
                decoration_layouts,
            } => {
                // Preserve subtraction-before-scaling for body screen coordinates. The
                // borrowed background/food preview above retains its existing transform.
                for (((snake, layout), decoration), side_layouts) in snakes
                    .into_iter()
                    .zip(layouts)
                    .zip(&decorations)
                    .zip(decoration_layouts)
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
                    draw_eyes(context, layout)?;
                    context.set_global_alpha(1.);
                    context.set_global_composite_operation("source-over")?;
                    if let Some(side_layouts) = side_layouts {
                        sources.submit_face(
                            context,
                            decoration.as_ref().expect("planned decoration"),
                            side_layouts,
                        )?;
                    }
                }
            }
            PlannedSnakePaint::Standard { draws, recipes } => {
                for (
                    StandardDraw {
                        plan,
                        layout,
                        root_alpha,
                        decoration_layout,
                    },
                    recipe,
                ) in draws.into_iter().zip(&recipes)
                {
                    if let Some(plan) = plan {
                        for command in &plan.commands {
                            sources.submit(context, command)?;
                        }
                    }
                    context.set_global_alpha(root_alpha);
                    context.set_global_composite_operation("source-over")?;
                    if let Some(layout) = layout {
                        draw_eyes(context, layout)?;
                    }
                    context.set_global_alpha(1.);
                    if let Some(layouts) = decoration_layout {
                        sources.submit_face(
                            context,
                            recipe.decoration.as_ref().expect("planned decoration"),
                            layouts,
                        )?;
                    }
                }
            }
        }
        if let Some(plan) = &self.food {
            submit_food(food_sources, context, &plan.late)?;
        }
        if let Some(plan) = &self.prey {
            submit_prey(prey_sources, context, &plan.late)?;
        }
        Ok(())
    }
}
