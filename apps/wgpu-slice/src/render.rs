//! Same shared renderer inputs from live AnimatedClient. No simulation or transport.
use crate::{
    Result,
    bank::Bank,
    frame::{Draw, Frame, MAX_EXTENT},
    scene::Resource,
};
use slither_client::{presentation::*, state::Point};

pub struct PreparedFrame {
    pub frame: Frame,
    pub resources: Vec<Resource>,
}
impl PreparedFrame {
    pub fn pixel_bytes(&self) -> usize {
        self.resources.iter().map(|r| r.image.pixels.len()).sum()
    }
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

/// Numeric camera/body/face preparation is called exactly once per actual draw, including Setup/resize.
pub fn prepare(
    client: &mut AnimatedClient,
    bank: &mut Bank,
    extent: [u32; 2],
    scale: f64,
    identity: u64,
) -> Result<PreparedFrame> {
    let logical = dimensions(extent, scale)?;
    let prepared = client
        .prepare_draw_with_style(logical[0], logical[1], 1., false)
        .map_err(|e| e.to_string())?;
    let view = BodyPaintView {
        camera: client.camera().position(),
        zoom: client.camera().zoom(),
        half_width: f64::from(extent[0]) / scale / 2.,
        half_height: f64::from(extent[1]) / scale / 2.,
    };
    let quality = BodyPaintQuality {
        high_quality: true,
        blend: 1.,
    };
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
    let palettes: Vec<_> = bank
        .bodies
        .iter()
        .map(|p| BodyPalette {
            variants: &p.variants,
            boost_glow: Some(p.glow),
        })
        .collect();
    let mut draws: Vec<Draw> = food.early.iter().map(Draw::from).collect();
    draws.extend(prey_plan.early.iter().map(prey));
    let mut eyes = Vec::new();
    for snake in prepared {
        let m = snake.metrics;
        let raw = client
            .snake_object(snake.token)
            .ok_or("prepared appearance missing")?;
        let skin =
            resolve_authored_local_skin(m.skin, raw.custom_skin()).map_err(|e| e.to_string())?;
        if let Some(geometry) = &snake.body_geometry {
            let body = plan_standard_body(BodyPaintInput {
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
            })
            .map_err(|e| e.to_string())?;
            draws.extend(body.commands.iter().map(Draw::from));
        }
        let start = draws.len();
        if let Some(style) = snake.eye_geometry {
            eyes.push((
                start,
                style
                    .layout(
                        snake.face_heading,
                        snake.pupil,
                        EyeLayoutInput {
                            corrected_head: m.corrected_head,
                            camera: view.camera,
                            viewport_half: Point {
                                x: view.half_width,
                                y: view.half_height,
                            },
                            scale: m.scale,
                            zoom: view.zoom,
                            death_progress: m.death_progress,
                        },
                    )
                    .map_err(|e| e.to_string())?,
            ));
        }
    }
    drop(palettes);
    // Insert complete pairs immediately after each snake; never regroup them across bodies.
    for (index, e) in eyes.into_iter().rev() {
        let mut face = Vec::new();
        for pair in e.pairs {
            if e.outline_width > 0. {
                let r = e.eye_radius + e.outline_width / 2.;
                face.push(image(
                    bank.disk([0; 3])?,
                    pair.eye.x - r,
                    pair.eye.y - r,
                    r * 2.,
                    r * 2.,
                    e.eye_alpha,
                ));
            }
            let r = e.eye_radius;
            face.push(image(
                bank.disk(e.eye_color)?,
                pair.eye.x - r,
                pair.eye.y - r,
                r * 2.,
                r * 2.,
                e.eye_alpha,
            ));
            let r = e.pupil_radius;
            face.push(image(
                bank.disk(e.pupil_color)?,
                pair.pupil.x - r,
                pair.pupil.y - r,
                r * 2.,
                r * 2.,
                e.pupil_alpha,
            ));
        }
        draws.splice(index..index, face);
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
    let mut frame = Frame {
        identity,
        extent,
        viewport_scale: scale,
        tick: 0,
        draws,
    };
    let mut resources = bank.resources(&frame)?;
    bank.minimap.append(client, &mut frame, &mut resources)?;
    Ok(PreparedFrame { frame, resources })
}
fn finish_plan(
    mut prepared: PreparedFrame,
    bank: &mut Bank,
    plan: &crate::hud::Plan,
) -> Result<PreparedFrame> {
    // Late overlays append to the captured scene. Re-resolving world resources
    // here could replace pixels belonging to an earlier queued Setup picture.
    crate::hud::rasterize(plan, &mut bank.hud)?;
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
}
/// Retained string-only entry for existing callers; no domain parsing of text.
pub fn finish(frame: Frame, bank: &mut Bank, hud: &str) -> Result<PreparedFrame> {
    let plan = crate::hud::plan_text(hud, frame.extent, frame.viewport_scale)?;
    let resources = bank.resources(&frame)?;
    finish_plan(PreparedFrame { frame, resources }, bank, &plan)
}
/// Ordinary native/web gameplay shares this complete Rust projection and composition.
pub fn finish_hud(
    prepared: PreparedFrame,
    bank: &mut Bank,
    hud: &crate::hud::View,
) -> Result<PreparedFrame> {
    let plan = crate::hud::plan(hud, prepared.frame.extent, prepared.frame.viewport_scale)?;
    finish_plan(prepared, bank, &plan)
}
