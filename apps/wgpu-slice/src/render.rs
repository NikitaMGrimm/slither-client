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
    applied: QualitySnapshot,
) -> Result<PreparedFrame> {
    let logical = dimensions(extent, scale)?;
    let prepared = client
        .prepare_draw_resolved(
            logical[0],
            logical[1],
            applied.quality_scale,
            |_, _, snake| {
                resolve_authored_local_skin(snake.metrics().skin, snake.custom_skin())
                    .map(|skin| skin.body_style.detailed_segments)
                    .map_err(|e| PreparationError(e.to_string()))
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
    let palettes: Vec<_> = bank
        .bodies
        .iter()
        .map(|p| BodyPalette {
            variants: &p.variants,
            boost_glow: Some(p.glow),
        })
        .collect();
    draws.extend(food.early.iter().map(Draw::from));
    draws.extend(prey_plan.early.iter().map(prey));
    draws.extend(text_draws);
    let mut eyes = Vec::new();
    let mut snakes = Vec::new();
    for snake in prepared {
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
            for command in &body.commands {
                let draw = Draw::from(command);
                if command.pass == BodyPaintPass::Body {
                    observation.body_commands += 1;
                    if draw.image_intersects_viewport(extent, scale) {
                        observation.viewport_body_commands += 1;
                    }
                }
                draws.push(draw);
            }
        }
        snakes.push(observation);
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
