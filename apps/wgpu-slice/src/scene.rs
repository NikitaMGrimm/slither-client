//! ORIGINAL SYNTHETIC offline packets, not a simulator or recorded server response.
//! Both hosts run this exact fixed-tick schedule through AnimatedClient and its planners.
use crate::{
    Result,
    frame::{Draw, Frame, MAX_EXTENT, ResourceKey},
    materials::{RgbaImage, materialize},
};
use slither_client::{
    authored_sources::{CanvasRecipe, authored_source_recipes},
    presentation::*,
    protocol::ElapsedHeader,
};
use std::collections::BTreeMap;

pub const STEP_MS: f64 = 1000. / 60.;
pub const LAST_TICK: u32 = 600;

fn u24(n: u32) -> [u8; 3] {
    let b = n.to_be_bytes();
    [b[1], b[2], b[3]]
}
fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    commands
        .iter()
        .flat_map(|c| {
            let mut p = (c.len() as u16).to_be_bytes().to_vec();
            p.extend(c);
            p
        })
        .collect()
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
fn appearance() -> Vec<u8> {
    let mut p = vec![b's', 0, 7];
    p.extend(u24(0));
    p.push(b'0');
    p.extend(u24(0));
    p.extend(4250_u16.to_be_bytes());
    p.extend(u24(0));
    p.push(0);
    p.extend(u24(1100 * 5));
    p.extend(u24(1000 * 5));
    p.extend([0, 0, 255]);
    p.extend(u24(956 * 5));
    p.extend(u24(1000 * 5));
    for _ in 2..12 {
        p.extend([151, 127]);
    }
    p.extend([0, 0]);
    p
}

#[derive(Clone, Debug)]
pub struct Resource {
    pub asset: BodyAsset,
    pub image: RgbaImage,
}

pub struct Scene {
    client: AnimatedClient,
    pub resources: Vec<Resource>,
    assets: Vec<BodyAsset>,
    variants: Vec<BodyAssetUse>,
    glow: BodyAssetUse,
    outline: BodyAssetUse,
    shadow: BodyAssetUse,
    death: BodyAssetUse,
    food_factory: FoodFactory,
    skin: SkinDescriptor,
    tick: u32,
    identity: u64,
}
fn add(resources: &mut Vec<Resource>, r: &CanvasRecipe) -> Result<BodyAsset> {
    let image = materialize(r)?;
    let asset = BodyAsset {
        handle: crate::bank::BODY_HANDLE_BASE + 1 + resources.len() as u64,
        revision: 1,
        width: image.width,
        height: image.height,
        status: BodyAssetStatus::Ready,
    };
    resources.push(Resource { asset, image });
    Ok(asset)
}
fn food_source(asset: BodyAsset, r: &CanvasRecipe) -> Result<FoodSource> {
    FoodSource::new(
        asset,
        f64::from(r.width),
        f64::from(r.height),
        r.half_width,
        r.half_height,
    )
    .map_err(|e| e.to_string())
}
impl Scene {
    pub fn new() -> Result<Self> {
        let recipes = authored_source_recipes();
        let mut resources = Vec::new();
        let mut variants = Vec::new();
        for r in &recipes.body_sources.palettes[0].variants {
            let index = resources.len();
            add(&mut resources, r)?;
            variants.push(BodyAssetUse {
                asset: index,
                source_rect: None,
            });
        }
        let glow = BodyAssetUse {
            asset: resources.len(),
            source_rect: None,
        };
        add(&mut resources, &recipes.body_sources.palettes[0].boost_glow)?;
        let outline = BodyAssetUse {
            asset: resources.len(),
            source_rect: None,
        };
        add(&mut resources, &recipes.body_sources.outline)?;
        let shadow = BodyAssetUse {
            asset: resources.len(),
            source_rect: None,
        };
        add(&mut resources, &recipes.body_sources.shadow)?;
        let death = BodyAssetUse {
            asset: resources.len(),
            source_rect: None,
        };
        add(&mut resources, &recipes.body_sources.death_highlight)?;
        let mut family = |rs: &[CanvasRecipe]| -> Result<Vec<FoodSource>> {
            rs.iter()
                .map(|r| {
                    let a = add(&mut resources, r)?;
                    food_source(a, r)
                })
                .collect()
        };
        let p = &recipes.food[0];
        let food_factory = FoodFactory {
            random_phase_unit: 0.25,
            random_wobble_unit: 0.75,
            palette: 0,
            image_count: p.count,
            bodies: family(&p.bodies)?,
            outlines: family(&p.outlines)?,
            glows: family(&p.glows)?,
        };
        let assets = resources.iter().map(|r| r.asset).collect();
        let mut scene = Self {
            client: AnimatedClient::new(0.).map_err(|e| e.to_string())?,
            resources,
            assets,
            variants,
            glow,
            outline,
            shadow,
            death,
            food_factory,
            skin: resolve_authored_local_skin(0, &[]).map_err(|e| e.to_string())?,
            tick: 0,
            identity: 0,
        };
        // Palette zero and fixed input units are explicit synthetic fixture values, not a random fallback.
        let mut packets = vec![setup(), appearance()];
        // Food persists along the finite travelled corridor, including the boost keyframe.
        for sector in [10, 12, 14, 16, 18, 20, 22, 24] {
            let mut foods = vec![b'F', sector, 10];
            for i in 0..6_u8 {
                foods.extend([0, 20 + i * 36, 50 + (i % 3) * 55, 30]);
            }
            packets.push(foods);
        }
        scene.apply(&packets)?;
        scene.client.set_connected(true);
        Ok(scene)
    }
    fn apply(&mut self, packets: &[Vec<u8>]) -> Result<()> {
        let factory = &self.food_factory;
        self.client
            .apply_frame_with_factories::<ClientPresentationError, _, _>(
                &bundle(packets),
                ElapsedHeader::Absent,
                |_| Ok(PairedFaceGeometry::default()),
                |_, _| Ok(factory.clone()),
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    /// Tick120 raises received speed; tick360 returns to cruise. Absolute anchors
    /// every eight ticks are an authored packet schedule, not client-authoritative physics.
    pub fn next_frame(&mut self, extent: [u32; 2], viewport_scale: f64) -> Result<Frame> {
        if extent.contains(&0)
            || extent.iter().any(|v| *v > MAX_EXTENT)
            || !viewport_scale.is_finite()
            || viewport_scale <= 0.
        {
            return Err("suspended/invalid scene extent".into());
        }
        if self.tick >= LAST_TICK {
            return Err("synthetic schedule complete".into());
        }
        logical_extent(extent, viewport_scale)?;
        self.tick += 1;
        if self.tick == 120 {
            self.apply(&[vec![b'd', 0, 0, 234]])?;
        }
        if self.tick == 360 {
            self.apply(&[vec![b'd', 0, 0, 77]])?;
        }
        if self.tick.is_multiple_of(8) {
            let x = 1100 + (self.tick * 2) as u16;
            let mut p = vec![b'=', 0, 0];
            p.extend(x.to_be_bytes());
            p.extend(1000_u16.to_be_bytes());
            self.apply(&[p])?;
        }
        self.client
            .advance(f64::from(self.tick) * STEP_MS, false)
            .map_err(|e| e.to_string())?;
        self.draw_frame(extent, viewport_scale)
    }
    /// Resize/redraw without inventing a packet or advancing the update clock.
    pub fn draw_frame(&mut self, extent: [u32; 2], viewport_scale: f64) -> Result<Frame> {
        let logical = logical_extent(extent, viewport_scale)?;
        let prepared = self
            .client
            .prepare_draw_with_style(
                logical[0],
                logical[1],
                1.,
                self.skin.body_style.detailed_segments,
            )
            .map_err(|e| e.to_string())?;
        let view = BodyPaintView {
            camera: self.client.camera().position(),
            zoom: self.client.camera().zoom(),
            half_width: f64::from(extent[0]) / viewport_scale / 2.,
            half_height: f64::from(extent[1]) / viewport_scale / 2.,
        };
        let quality = BodyPaintQuality {
            high_quality: true,
            blend: 1.,
        };
        let food = plan_food(FoodPaintInput {
            foods: self.client.foods().foods(),
            view,
            quality,
            bounds: self.client.food_bounds(),
            assets: &self.assets,
            target_handle: None,
            entry_alpha: 1.,
            command_limit: 4096,
        })
        .map_err(|e| e.to_string())?;
        let mut draws: Vec<Draw> = food.early.iter().map(Draw::from).collect();
        for snake in prepared {
            let Some(geometry) = snake.body_geometry else {
                continue;
            };
            let m = snake.metrics;
            let palettes = [BodyPalette {
                variants: &self.variants,
                boost_glow: Some(self.glow),
            }];
            let recipe = BodyPaintRecipe {
                base_palette: self.skin.base_palette,
                palettes: &palettes,
                runs: &self.skin.runs,
                variant_mode: self.skin.variant_mode,
                variant_period: self.skin.variant_period,
                custom: self.skin.custom,
                style: Some(self.skin.body_style),
                outline: Some(self.outline),
                shadow: Some(self.shadow),
                death: Some(self.death),
            };
            let body = plan_standard_body(BodyPaintInput {
                geometry: geometry.as_paint_geometry(),
                recipe,
                assets: &self.assets,
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
                command_limit: 4096,
            })
            .map_err(|e| e.to_string())?;
            draws.extend(body.commands.iter().map(Draw::from));
        }
        draws.extend(food.late.iter().map(Draw::from));
        self.identity += 1;
        Ok(Frame {
            identity: self.identity,
            extent,
            viewport_scale,
            tick: self.tick,
            draws,
            snakes: Vec::new(),
        })
    }
    pub fn tick(&self) -> u32 {
        self.tick
    }
    pub fn resident(&self) -> BTreeMap<ResourceKey, BodyAsset> {
        self.assets.iter().map(|a| ((*a).into(), *a)).collect()
    }
}

fn logical_extent(extent: [u32; 2], scale: f64) -> Result<[u32; 2]> {
    if !scale.is_finite()
        || scale <= 0.
        || extent.contains(&0)
        || extent.iter().any(|v| *v > MAX_EXTENT)
    {
        return Err("invalid logical/backing extent".into());
    }
    let values = extent.map(|v| (f64::from(v) / scale).ceil());
    if values
        .iter()
        .any(|v| !v.is_finite() || *v < 1. || *v > f64::from(MAX_EXTENT))
    {
        return Err("logical extent limit".into());
    }
    Ok(values.map(|v| v as u32))
}

/// Shared host pacing. Hidden/suspended gaps over250ms pause the fixture; no
/// model reset, skipped packets or extra connection. Bounded catch-up is8ticks.
pub struct Driver {
    last: Option<f64>,
    pending: f64,
}
impl Default for Driver {
    fn default() -> Self {
        Self {
            last: None,
            pending: 0.,
        }
    }
}
impl Driver {
    pub fn due(&mut self, now_ms: f64) -> Result<u32> {
        if !now_ms.is_finite() || self.last.is_some_and(|v| now_ms < v) {
            return Err("invalid host timestamp".into());
        }
        let delta = self.last.map_or(0., |last| now_ms - last);
        self.last = Some(now_ms);
        if delta <= 250. {
            self.pending += delta;
        }
        let count = (self.pending / STEP_MS).floor().min(8.) as u32;
        self.pending -= f64::from(count) * STEP_MS;
        Ok(count)
    }
    pub fn pause(&mut self) {
        self.last = None;
    }
}
