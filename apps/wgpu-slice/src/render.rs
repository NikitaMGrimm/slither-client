//! Same shared renderer inputs from live AnimatedClient. No simulation or transport.
use crate::{
    Result,
    bank::Bank,
    frame::{Draw, Frame, MAX_EXTENT, SnakeDrawObservation},
    scene::Resource,
};
use slither_client::{presentation::*, state::Point};

struct PreparationError(String);
impl From<ClientPresentationError> for PreparationError {
    fn from(e: ClientPresentationError) -> Self {
        Self(e.to_string())
    }
}

pub struct PreparedFrame {
    pub frame: Frame,
    pub resources: Vec<Resource>,
}
impl PreparedFrame {
    pub fn pixel_bytes(&self) -> usize {
        self.resources.iter().map(|r| r.image.pixels.len()).sum()
    }
}
/// Desktop content size in CSS/logical pixels. DPR affects presentation only.
pub fn backing_size(area: [f64; 2]) -> Result<[u32; 2]> {
    if area.into_iter().any(|n| !n.is_finite() || n < 0.) {
        return Err("Invalid desktop content size".into());
    }
    if area.contains(&0.) {
        return Ok([0, 0]);
    }
    let size = slither_client::desktop_layout::desktop_backing_size(area[0], area[1])?;
    Ok([size.width, size.height])
}
pub fn dimensions(extent: [u32; 2], scale: f64) -> Result<[u32; 2]> {
    if extent.contains(&0)
        || extent.iter().any(|n| *n > MAX_EXTENT)
        || !scale.is_finite()
        || scale <= 0.
    {
        return Err("suspended/invalid backing extent".into());
    }
    let logical = extent.map(|v| (f64::from(v) / scale).ceil());
    if logical
        .iter()
        .any(|n| !n.is_finite() || *n < 1. || *n > f64::from(MAX_EXTENT))
    {
        return Err("logical extent budget".into());
    }
    Ok(logical.map(|n| n as u32))
}
fn image(asset: BodyAsset, x: f64, y: f64, w: f64, h: f64, alpha: f64) -> Draw {
    Draw {
        corners: None,
        asset,
        source: None,
        repeat_uv: None,
        black_effect: false,
        destination: BodyRect {
            x,
            y,
            width: w,
            height: h,
        },
        translation: [0., 0.],
        rotation: 0.,
        effective_alpha: alpha,
        blend: BodyBlend::SourceOver,
    }
}
fn prey(c: &PreyImageCommand) -> Draw {
    let (source, destination) = match c.draw {
        FoodImageDraw::Whole { x, y } => (
            None,
            BodyRect {
                x,
                y,
                width: f64::from(c.source.asset().width),
                height: f64::from(c.source.asset().height),
            },
        ),
        FoodImageDraw::Scaled {
            source,
            destination,
        } => (Some(source), destination),
    };
    Draw {
        corners: None,
        asset: c.source.asset(),
        source,
        repeat_uv: None,
        black_effect: false,
        destination,
        translation: [0., 0.],
        rotation: 0.,
        effective_alpha: c.alpha.effective,
        blend: c.blend,
    }
}
fn polygon(asset: BodyAsset, points: [Point; 4], alpha: f64) -> Draw {
    let mut d = image(asset, 0., 0., 1., 1., alpha);
    d.corners = Some(points.map(|p| [p.x, p.y]));
    d
}

fn placed(
    asset: BodyAsset,
    source: Option<BodyRect>,
    destination: BodyRect,
    translation: Point,
    rotation: f64,
    alpha: f64,
) -> Draw {
    let mut draw = image(
        asset,
        destination.x,
        destination.y,
        destination.width,
        destination.height,
        alpha,
    );
    draw.source = source;
    draw.translation = [translation.x, translation.y];
    draw.rotation = rotation;
    draw
}

fn submit_face(
    bank: &mut Bank,
    skin: &SkinDescriptor,
    snake: &PreparedSnake,
    view: EyeLayoutInput,
    accessory: Option<(StaticHeadAccessoryGeometry, BodyAsset)>,
    draws: &mut Vec<Draw>,
) -> Result<()> {
    let heading = snake.face_heading;
    let pupil = snake.pupil;
    if let FaceGeometry::Paired(face) = snake.face_geometry {
        let e = face
            .eyes
            .layout(heading, pupil, view)
            .map_err(|e| e.to_string())?;
        for pair in e.pairs {
            for (color, point, radius, alpha) in [
                (
                    [0; 3],
                    pair.eye,
                    if e.outline_width > 0. {
                        e.eye_radius + e.outline_width / 2.
                    } else {
                        0.
                    },
                    e.eye_alpha,
                ),
                (e.eye_color, pair.eye, e.eye_radius, e.eye_alpha),
                (e.pupil_color, pair.pupil, e.pupil_radius, e.pupil_alpha),
            ] {
                if radius > 0. {
                    draws.push(image(
                        bank.disk(color)?,
                        point.x - radius,
                        point.y - radius,
                        radius * 2.,
                        radius * 2.,
                        alpha,
                    ));
                }
            }
        }
    }
    if let Some((geometry, asset)) = accessory {
        let layout = geometry
            .layout(
                heading,
                Point {
                    x: f64::from(asset.width),
                    y: f64::from(asset.height),
                },
                snake.metrics.spawn_progress,
                view,
            )
            .map_err(|e| e.to_string())?;
        draws.push(placed(
            asset,
            Some(BodyRect {
                x: 0.,
                y: 0.,
                width: f64::from(asset.width),
                height: f64::from(asset.height),
            }),
            layout.destination,
            layout.translation,
            layout.rotation,
            layout.alpha,
        ));
    }
    let Some(cosmetics) = &bank.cosmetics else {
        return Ok(());
    };
    match (snake.face_geometry, skin.face_sources) {
        (
            FaceGeometry::SingleImage(geometry),
            SkinFaceSources::SingleImage {
                base,
                pupil: source_pupil,
            },
        ) => {
            let layout = geometry
                .layout(heading, pupil, view)
                .map_err(|e| e.to_string())?;
            for (source, rect) in [base, source_pupil].into_iter().zip(layout.destinations) {
                draws.push(placed(
                    cosmetics.role(source.source),
                    source.source_rect,
                    rect,
                    Point { x: 0., y: 0. },
                    0.,
                    layout.alpha,
                ));
            }
        }
        (FaceGeometry::Mouth(geometry), SkinFaceSources::Mouth { eye_marks, mouth }) => {
            let layout = geometry
                .layout(heading, pupil, view)
                .map_err(|e| e.to_string())?;
            for (source, layout) in [eye_marks, eye_marks, mouth].into_iter().zip(layout.images) {
                draws.push(placed(
                    cosmetics.role(source),
                    None,
                    layout.destination,
                    layout.translation,
                    layout.rotation,
                    1.,
                ));
            }
        }
        (FaceGeometry::Paired(face), SkinFaceSources::PairedSide(source)) => {
            for layout in face
                .decoration
                .ok_or("Missing paired decoration")?
                .layout(heading, view)
                .map_err(|e| e.to_string())?
            {
                draws.push(placed(
                    cosmetics.role(source),
                    None,
                    layout.destination,
                    layout.translation,
                    layout.rotation,
                    1.,
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

fn submit_antenna(
    bank: &mut Bank,
    skin: &SkinDescriptor,
    antenna: &PreparedAntenna,
    draws: &mut Vec<Draw>,
) -> Result<()> {
    for stroke in &antenna.strokes {
        let path = match stroke.path {
            AntennaPath::Outer => &antenna.outer_path,
            AntennaPath::Inner => &antenna.inner_path,
        };
        let color = [
            (stroke.color >> 16) as u8,
            (stroke.color >> 8) as u8,
            stroke.color as u8,
        ];
        let solid = bank.solid(color);
        stroke_path(
            solid,
            path,
            antenna.center,
            stroke.width,
            stroke.alpha,
            draws,
        )?;
    }
    if let Some(bulb) = antenna.bulb {
        let asset = bank
            .cosmetics
            .as_ref()
            .ok_or("Antenna images unavailable")?
            .role(skin.antenna.ok_or("Missing antenna role")?.source);
        draws.push(placed(
            asset,
            None,
            bulb.destination,
            Point {
                x: bulb.center.x + bulb.translation.x,
                y: bulb.center.y + bulb.translation.y,
            },
            bulb.rotation.unwrap_or(0.),
            bulb.alpha,
        ));
    }
    Ok(())
}

/// Tessellate one round-cap/join stroke without alpha-overlapping segment disks.
/// Interior corners meet at their offset-line intersection; the exterior is a fan.
fn stroke_path(
    asset: BodyAsset,
    path: &[Point],
    center: Point,
    width: f64,
    alpha: f64,
    draws: &mut Vec<Draw>,
) -> Result<()> {
    use std::f64::consts::PI;
    let mut points: Vec<Point> = Vec::new();
    for p in path {
        if points
            .last()
            .is_none_or(|q| (p.x - q.x).hypot(p.y - q.y) > 1e-9)
        {
            points.push(*p);
        }
    }
    if points.len() < 2 {
        return Ok(());
    }
    let radius = width / 2.;
    let normals: Vec<_> = points
        .windows(2)
        .map(|p| {
            let dx = p[1].x - p[0].x;
            let dy = p[1].y - p[0].y;
            let length = dx.hypot(dy);
            Point {
                x: -dy / length * radius,
                y: dx / length * radius,
            }
        })
        .collect();
    let add = |a: Point, b: Point| Point {
        x: a.x + b.x,
        y: a.y + b.y,
    };
    let neg = |a: Point| Point { x: -a.x, y: -a.y };
    let mut starts: Vec<_> = points
        .windows(2)
        .zip(&normals)
        .map(|(p, n)| [add(p[0], *n), add(p[0], neg(*n))])
        .collect();
    let mut ends: Vec<_> = points
        .windows(2)
        .zip(&normals)
        .map(|(p, n)| [add(p[1], *n), add(p[1], neg(*n))])
        .collect();
    let mut fans = Vec::new();
    for i in 1..points.len() - 1 {
        let a = normals[i - 1];
        let b = normals[i];
        let turn = (a.x * b.y - a.y * b.x).atan2(a.x * b.x + a.y * b.y);
        if turn.abs() < 1e-9 {
            continue;
        }
        let denominator = 1. + (a.x * b.x + a.y * b.y) / (radius * radius);
        // Near reversal has no stable inside intersection. Bound the join locally.
        let factor = 1. / denominator.max(0.25);
        let m = Point {
            x: (a.x + b.x) * factor,
            y: (a.y + b.y) * factor,
        };
        let inner = usize::from(turn < 0.);
        let intersection = add(points[i], if inner == 0 { m } else { neg(m) });
        ends[i - 1][inner] = intersection;
        starts[i][inner] = intersection;
        let outer = if inner == 0 { neg(a) } else { a };
        fans.push((intersection, points[i], outer.y.atan2(outer.x), turn));
    }
    for (start, end) in starts.into_iter().zip(ends) {
        draws.push(polygon(
            asset,
            [start[0], end[0], end[1], start[1]].map(|p| add(p, center)),
            alpha,
        ));
    }
    for (point, normal, turn) in [
        (points[0], normals[0], PI),
        (
            *points.last().expect("path"),
            neg(*normals.last().expect("path")),
            PI,
        ),
    ] {
        fans.push((point, point, normal.y.atan2(normal.x), turn));
    }
    for (origin, point, start, sweep) in fans {
        let steps = (sweep.abs() * radius.max(1.) * 2.).ceil().max(1.);
        if !steps.is_finite() || steps > crate::frame::MAX_DRAWS.saturating_sub(draws.len()) as f64
        {
            return Err("Antenna stroke draw budget".into());
        }
        let steps = steps as usize;
        for i in 0..steps {
            let arc = |t: f64| {
                add(
                    point,
                    Point {
                        x: (start + t * sweep).cos() * radius,
                        y: (start + t * sweep).sin() * radius,
                    },
                )
            };
            draws.push(polygon(
                asset,
                [
                    origin,
                    arc(i as f64 / steps as f64),
                    arc((i + 1) as f64 / steps as f64),
                    origin,
                ]
                .map(|p| add(p, center)),
                alpha,
            ));
        }
    }
    Ok(())
}

/// Numeric camera/body/face preparation is called exactly once per actual draw, including Setup/resize.
pub fn prepare(
    client: &mut AnimatedClient,
    bank: &mut Bank,
    extent: [u32; 2],
    scale: f64,
    identity: u64,
    applied: QualitySnapshot,
) -> Result<PreparedFrame> {
    let logical = dimensions(extent, scale)?;
    let full_stock = bank.cosmetics.is_some();
    // Mix the draw identity before the local stream so successive draws do not
    // give the first antenna node nearly identical perturbations. Retried frames
    // reuse their already prepared plan and consume no additional randomness.
    let mut entropy = identity.wrapping_add(0x9e37_79b9_7f4a_7c15);
    entropy = (entropy ^ (entropy >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    entropy = (entropy ^ (entropy >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    entropy ^= entropy >> 31;
    let prepared = client
        .prepare_draw_with_accessory_styles::<PreparationError, _, _>(
            logical[0],
            logical[1],
            applied.quality_scale,
            |_, _, snake| {
                Ok(full_stock
                    && resolve_skin(snake.metrics().skin, snake.custom_skin(), false)
                        .expect("admitted custom bytes")
                        .body_style
                        .detailed_segments)
            },
            |request| {
                Ok((0..request.random_pair_count)
                    .map(|_| {
                        std::array::from_fn(|_| {
                            entropy = entropy.wrapping_mul(1664525).wrapping_add(1013904223)
                                & 0xffff_ffff;
                            entropy as f64 / 4294967296.
                        })
                    })
                    .collect())
            },
        )
        .map_err(|e| e.0)?;
    let view = BodyPaintView {
        camera: client.camera().position(),
        zoom: client.camera().zoom(),
        half_width: f64::from(extent[0]) / scale / 2.,
        half_height: f64::from(extent[1]) / scale / 2.,
    };
    let quality = BodyPaintQuality {
        high_quality: applied.high_quality,
        blend: applied.quality_blend,
    };
    let tile = bank.assets[bank.tile.asset];
    let backdrop = bank.assets[bank.backdrop.asset];
    let background = client
        .prepare_background(BackgroundInput {
            width: logical[0],
            height: logical[1],
            zoom: view.zoom,
            image_size: Some([backdrop.width, backdrop.height]),
            pattern_available: true,
            quality: applied,
            tile_width: f64::from(tile.width),
            tile_height: f64::from(tile.height),
        })
        .map_err(|e| e.to_string())?;
    let [x, y, w, h] = background.clear.rect;
    let mut draws = vec![image(
        bank.solid(background.clear.color),
        x,
        y,
        w,
        h,
        background.clear.alpha,
    )];
    if let Some(layer) = background.image {
        let [x, y, w, h] = layer.destination;
        draws.push(image(backdrop, x, y, w, h, layer.alpha));
    }
    if let Some(layer) = background.pattern {
        // Clip the oversized Canvas fill to the viewport; keep its pattern-space
        // coordinates so translation, zoom and fractional phase remain identical.
        let mut draw = image(
            tile,
            0.,
            0.,
            f64::from(logical[0]),
            f64::from(logical[1]),
            layer.alpha,
        );
        draw.repeat_uv = Some(BodyRect {
            x: (-layer.center.x / layer.zoom - layer.translation.x) / f64::from(tile.width),
            y: (-layer.center.y / layer.zoom - layer.translation.y) / f64::from(tile.height),
            width: f64::from(logical[0]) / layer.zoom / f64::from(tile.width),
            height: f64::from(logical[1]) / layer.zoom / f64::from(tile.height),
        });
        draws.push(draw);
    }
    let food = plan_food(FoodPaintInput {
        foods: client.foods().foods(),
        view,
        quality,
        bounds: client.food_bounds(),
        assets: &bank.assets,
        target_handle: None,
        entry_alpha: 1.,
        command_limit: 8192,
    })
    .map_err(|e| e.to_string())?;
    let eaters: Vec<_> = client
        .snake_objects()
        .map(|(token, _, _, snake)| {
            let m = snake.metrics();
            let o = snake.head_corrections().offset();
            (
                token,
                PreyEaterPose {
                    head: m.raw_head,
                    head_offset: Point { x: o[0], y: o[1] },
                    heading: m.heading,
                    angle_offset: snake.angle_corrections().offset(),
                },
            )
        })
        .collect();
    let prey_plan = plan_prey(PreyPaintInput {
        preys: client.preys().preys(),
        eaters: &eaters,
        view,
        assets: &bank.assets,
        target_handle: None,
        early_entry_alpha: 1.,
        late_entry_alpha: 1.,
        command_limit: 8192,
    })
    .map_err(|e| e.to_string())?;
    let mut text_draws = Vec::new();
    let mut text_resources = std::collections::BTreeMap::new();
    for name in client.nickname_draws() {
        use crate::text::{Align, Baseline, TextRun, TextStyle, Weight};
        for (draw, resource) in bank.text.draw(
            TextRun {
                text: &name.text,
                style: TextStyle {
                    // The core's nickname font is fixed in backing pixels.
                    size: name.font_size / scale,
                    weight: Weight::Normal,
                    color: name.color,
                },
                // The core mixes a fixed backing-pixel gap with world geometry;
                // only the latter should grow when the logical frame is scaled.
                position: [name.position.x, name.position.y - 32. + 32. / scale],
                align: Align::Center,
                baseline: Baseline::Middle,
                alpha: name.alpha,
            },
            scale,
        )? {
            text_resources.insert(resource.asset.handle, resource);
            text_draws.push(draw);
        }
    }
    let families = bank.bodies.clone();
    let palettes: Vec<_> = families
        .iter()
        .map(|p| BodyPalette {
            variants: &p.variants,
            boost_glow: Some(p.glow),
        })
        .collect();
    draws.extend(food.early.iter().map(Draw::from));
    draws.extend(prey_plan.early.iter().map(prey));
    draws.extend(text_draws);
    let mut snakes = Vec::new();
    for prepared_snake in prepared {
        let snake = prepared_snake.snake;
        let m = snake.metrics;
        let mut observation = SnakeDrawObservation {
            id: m.id,
            own: snake.own,
            body_commands: 0,
            viewport_body_commands: 0,
        };
        let raw = client
            .snake_object(snake.token)
            .ok_or("prepared appearance missing")?;
        let skin = if full_stock {
            resolve_skin(m.skin, raw.custom_skin(), false)
        } else {
            resolve_authored_local_skin(m.skin, raw.custom_skin())
        }
        .map_err(|e| e.to_string())?;
        let mut antenna_draws = Vec::new();
        if let Some(antenna) = &snake.antenna {
            submit_antenna(bank, &skin, antenna, &mut antenna_draws)?;
        }
        if let Some(geometry) = &snake.body_geometry {
            let body = plan_standard_body_with_antenna(
                BodyPaintInput {
                    geometry: geometry.as_paint_geometry(),
                    recipe: BodyPaintRecipe {
                        base_palette: skin.base_palette,
                        palettes: &palettes,
                        runs: &skin.runs,
                        variant_mode: skin.variant_mode,
                        variant_period: skin.variant_period,
                        custom: skin.custom,
                        style: Some(skin.body_style),
                        outline: Some(bank.outline),
                        shadow: Some(bank.shadow),
                        death: Some(bank.death),
                    },
                    assets: &bank.assets,
                    view,
                    quality,
                    visual: BodyPaintVisual {
                        scale: m.scale,
                        spawn: m.spawn_progress,
                        death: m.death_progress,
                        dead: !m.alive,
                        smoothed_speed: m.visual_speed,
                        boost_threshold: m.boost_threshold_speed,
                        cruise_speed: m.cruise_speed,
                        maximum_speed: m.maximum_speed,
                        boost_phase: m.boost_phase,
                    },
                    entry_alpha: 1.,
                    command_limit: 8192,
                },
                snake
                    .antenna
                    .as_ref()
                    .map_or(AntennaBarrierEffect::Disabled, |a| a.barrier_effect),
            )
            .map_err(|e| e.to_string())?;
            for command in &body.commands {
                if command.pass == BodyPaintPass::Body {
                    observation.body_commands += 1;
                    if Draw::from(command).image_intersects_viewport(extent, scale) {
                        observation.viewport_body_commands += 1;
                    }
                }
            }
            draws.extend(body.commands[..body.antenna_barrier].iter().map(Draw::from));
            draws.append(&mut antenna_draws);
            draws.extend(body.commands[body.antenna_barrier..].iter().map(Draw::from));
        } else {
            draws.append(&mut antenna_draws);
        }
        snakes.push(observation);
        let input = EyeLayoutInput {
            corrected_head: m.corrected_head,
            camera: view.camera,
            viewport_half: Point {
                x: view.half_width,
                y: view.half_height,
            },
            scale: m.scale,
            zoom: view.zoom,
            death_progress: m.death_progress,
        };
        let accessory = prepared_snake.accessory.and_then(|geometry| {
            bank.cosmetics
                .as_ref()
                .and_then(|c| c.accessory(snake.own, raw.cosmetic()))
                .map(|r| (geometry, r.asset))
        });
        submit_face(bank, &skin, &snake, input, accessory, &mut draws)?;
    }
    draws.extend(food.late.iter().map(Draw::from));
    draws.extend(prey_plan.late.iter().map(prey));
    if let Some(boundary) = client.boundary()
        && let Some(edge) = plan_arena_edge(ArenaEdgeInput {
            view: client.arena_edge_view(),
            camera: view.camera,
            zoom: view.zoom,
            width: logical[0],
            height: logical[1],
            radius: boundary.displayed(),
        })
        .map_err(|e| e.to_string())?
    {
        let fill = bank.solid([48, 0, 0]);
        for i in 0..40 {
            draws.push(polygon(
                fill,
                [
                    edge.fill[i + 1],
                    edge.fill[i + 2],
                    edge.fill[81 - i],
                    edge.fill[82 - i],
                ],
                0.8,
            ));
        }
        let stroke = bank.solid([128, 0, 0]);
        let points = &edge.stroke[1..];
        for i in 0..points.len() - 1 {
            let a = points[i];
            let b = points[i + 1];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let length = dx.hypot(dy);
            if length == 0. {
                continue;
            }
            let n = Point {
                x: -dy / length * edge.line_width / 2.,
                y: dx / length * edge.line_width / 2.,
            };
            draws.push(polygon(
                stroke,
                [
                    Point {
                        x: a.x + n.x,
                        y: a.y + n.y,
                    },
                    Point {
                        x: b.x + n.x,
                        y: b.y + n.y,
                    },
                    Point {
                        x: b.x - n.x,
                        y: b.y - n.y,
                    },
                    Point {
                        x: a.x - n.x,
                        y: a.y - n.y,
                    },
                ],
                0.8,
            ));
        }
    }
    bank.stage_text(identity, text_resources.into_values().collect())?;
    let mut frame = Frame {
        identity,
        extent,
        viewport_scale: scale,
        tick: 0,
        draws,
        snakes,
    };
    let mut resources = bank.resources(&frame)?;
    bank.minimap.append(client, &mut frame, &mut resources)?;
    Ok(PreparedFrame { frame, resources })
}
fn finish_plan(
    mut prepared: PreparedFrame,
    bank: &mut Bank,
    plan: Result<crate::hud::Plan>,
) -> Result<PreparedFrame> {
    let identity = prepared.frame.identity;
    let result = (|| {
        let plan = plan?;
        // Late overlays append to the captured scene. Re-resolving world resources
        // here could replace pixels belonging to an earlier queued Setup picture.
        crate::hud::rasterize(&plan, &mut bank.hud)?;
        for panel in &plan.panels {
            let mut command = image(
                bank.hud.asset,
                panel.destination.x,
                panel.destination.y,
                panel.destination.width,
                panel.destination.height,
                panel.opacity,
            );
            command.source = Some(panel.source());
            prepared.frame.draws.push(command);
        }
        if !plan.panels.is_empty() {
            prepared.resources.push(bank.hud.clone());
        }
        if prepared.pixel_bytes() > crate::bank::PIXEL_BUDGET {
            return Err("Active resource pixel budget exceeded".into());
        }
        let resident = prepared
            .resources
            .iter()
            .map(|r| (r.asset.into(), r.asset))
            .collect();
        prepared.frame.quads(&resident)?;
        Ok(prepared)
    })();
    bank.discard_text(identity);
    result
}
/// Retained string-only entry for existing callers; no domain parsing of text.
pub fn finish(frame: Frame, bank: &mut Bank, hud: &str) -> Result<PreparedFrame> {
    let identity = frame.identity;
    let result = (|| {
        let plan = crate::hud::plan_text(hud, frame.extent, frame.viewport_scale)?;
        let resources = bank.resources(&frame)?;
        finish_plan(PreparedFrame { frame, resources }, bank, Ok(plan))
    })();
    bank.discard_text(identity);
    result
}
/// Ordinary native/web gameplay shares this complete Rust projection and composition.
pub fn finish_hud(
    prepared: PreparedFrame,
    bank: &mut Bank,
    hud: &crate::hud::View,
) -> Result<PreparedFrame> {
    let plan = crate::hud::plan(hud, prepared.frame.extent, prepared.frame.viewport_scale);
    finish_plan(prepared, bank, plan)
}

#[cfg(test)]
mod text_staging_tests {
    //! Original synthetic pixels and failures; no fonts, GPU or server.
    use super::*;
    use crate::{materials::RgbaImage, scene::Resource};
    fn stage(bank: &mut Bank, identity: u64) -> Frame {
        let asset = BodyAsset {
            handle: 0x4000_0000_0000_0000 + identity,
            revision: 1,
            width: 1,
            height: 1,
            status: BodyAssetStatus::Ready,
        };
        bank.stage_text(
            identity,
            vec![Resource {
                asset,
                image: RgbaImage {
                    width: 1,
                    height: 1,
                    pixels: vec![255; 4],
                },
            }],
        )
        .unwrap();
        Frame {
            snakes: Vec::new(),
            identity,
            extent: [960, 540],
            viewport_scale: 1.,
            tick: 0,
            draws: vec![image(asset, 10., 10., 1., 1., 1.)],
        }
    }
    #[test]
    fn every_failed_finish_discards_only_its_own_staged_text() {
        let mut bank = Bank::new().unwrap();
        let retained = stage(&mut bank, 0);
        let view = crate::game::LocalGame::new(0.).unwrap().hud_view();
        // Repeated increasing identities used to exhaust the 16-picture budget.
        for identity in 1..=25 {
            let mut frame = stage(&mut bank, identity);
            let result = match identity % 5 {
                0 => {
                    frame.viewport_scale = f64::NAN;
                    finish(frame, &mut bank, "HUD")
                }
                1 => {
                    let mut plan =
                        crate::hud::plan_text("HUD", frame.extent, frame.viewport_scale).unwrap();
                    plan.extent = [513, 512];
                    finish_plan(
                        PreparedFrame {
                            frame,
                            resources: Vec::new(),
                        },
                        &mut bank,
                        Ok(plan),
                    )
                }
                2 => {
                    frame.draws[0].effective_alpha = f64::NAN;
                    finish(frame, &mut bank, "HUD")
                }
                3 => {
                    frame.draws[0].asset.handle += 1000;
                    bank.resources(&frame)
                        .map(|resources| PreparedFrame { frame, resources })
                }
                _ => {
                    frame.viewport_scale = f64::NAN;
                    finish_hud(
                        PreparedFrame {
                            frame,
                            resources: Vec::new(),
                        },
                        &mut bank,
                        &view,
                    )
                }
            };
            assert!(result.is_err());
        }
        bank.resources(&retained).unwrap();
        let frame = stage(&mut bank, 26);
        finish(frame, &mut bank, "HUD").unwrap();
    }
}
