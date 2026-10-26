//! Browser ownership of the coupled model; caller-supplied time and borrowed assets.

use std::f64::consts::TAU;

use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

use crate::{
    canvas_browser::{CanvasFrame, draw_sprite},
    presentation::{
        AnimatedClient, CurveInput, CurveOutput, EyeLayoutInput, SnakePresentation,
        StandardEyeLayout, Turn, sample_curve_with_heading,
    },
    presentation_browser::AnimationStep,
    protocol::ElapsedHeader,
    state::Point,
};

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
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
}

#[wasm_bindgen]
impl AnimatedScene {
    /// Create a session at an explicitly supplied millisecond timestamp.
    #[wasm_bindgen(constructor)]
    pub fn new(start_ms: f64) -> Result<AnimatedScene, JsValue> {
        Ok(Self {
            client: AnimatedClient::new(start_ms).map_err(error)?,
        })
    }

    /// Reset received state, retained entities and all clocks for a new session.
    pub fn reset(&mut self, start_ms: f64) -> Result<(), JsValue> {
        self.client.reset(start_ms).map_err(error)
    }

    /// Commit a complete frame and its presentation actions atomically.
    pub fn apply_frame(&mut self, bytes: &[u8], elapsed_header: bool) -> Result<(), JsValue> {
        self.client
            .apply_frame(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
            )
            .map_err(error)?;
        Ok(())
    }

    /// Advance the animation clock and drawn entities; free the returned step.
    pub fn advance(&mut self, now_ms: f64, lagging: bool) -> Result<AnimationStep, JsValue> {
        Ok(AnimationStep {
            inner: self.client.advance(now_ms, lagging).map_err(error)?,
        })
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
        quality(quality_scale)?;
        dimensions(f64::from(target.width()))?;
        dimensions(f64::from(target.height()))?;
        let sprites = [palette_0, palette_1, palette_2];
        let mut prepared = self.client.clone();
        let snakes = prepared
            .prepare_draw_with_style_staged(
                target.width(),
                target.height(),
                quality_scale,
                detailed_style,
            )
            .map_err(error)?;
        let received = prepared.received();
        let center = received.setup.as_ref().map_or(0., |s| s.grid_center);
        let camera = prepared.camera().position();
        let zoom = prepared.camera().zoom();
        let viewport_half = Point {
            x: f64::from(target.width()) / 2.,
            y: f64::from(target.height()) / 2.,
        };
        // Complete numeric validation before the target's destructive width reset.
        let layouts = snakes
            .iter()
            .map(|snake| {
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
            })
            .collect::<Result<Vec<_>, _>>()?;
        let frame = CanvasFrame::new(
            &target,
            &sprites,
            &background,
            camera.x - center,
            camera.y - center,
            zoom,
        )?;
        let context = frame.context();
        if let Some(setup) = &received.setup {
            context.begin_path();
            context.arc(0., 0., setup.radius, 0., TAU)?;
            context.set_stroke_style_str("#647481");
            context.set_line_width(1. / zoom);
            context.stroke();
        }
        for food in received.foods.values() {
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
        // Preserve subtraction-before-scaling for body screen coordinates. The
        // borrowed background/food preview above retains its existing transform.
        for (snake, layout) in snakes.into_iter().zip(layouts) {
            context.set_transform(1., 0., 0., 1., viewport_half.x, viewport_half.y)?;
            let m = snake.metrics;
            let opacity = m.spawn_progress * (1. - m.death_progress);
            context.set_global_alpha(opacity * opacity);
            if let Some(curve) = snake.curve {
                for point in curve.samples.iter().rev() {
                    context.save();
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
                    context.restore();
                }
            }
            draw_eyes(context, layout)?;
        }
        drop(frame);
        self.client = prepared;
        Ok(())
    }
}
