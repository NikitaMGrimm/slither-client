//! Numeric source binding with lazy CPU materialization. No host objects or game state.
use crate::{
    Result,
    frame::{Frame, ResourceKey},
    materials::materialize,
    scene::Resource,
};
use slither_client::{
    authored_sources::{CanvasRecipe, authored_source_recipes},
    presentation::*,
};
use std::collections::{BTreeMap, BTreeSet};
pub const PIXEL_BUDGET: usize = 64 * 1024 * 1024;
// Each producer owns one high-nibble namespace; low bits identify its textures.
pub const HANDLE_NAMESPACE_SIZE: u64 = 1 << 60;
pub const BODY_HANDLE_BASE: u64 = 0x1000_0000_0000_0000;
pub const HUD_HANDLE_BASE: u64 = 0x3000_0000_0000_0000;
pub const TEXT_HANDLE_BASE: u64 = 0x4000_0000_0000_0000;
pub const MINIMAP_HANDLE_BASE: u64 = 0x5000_0000_0000_0000;
pub const COSMETIC_HANDLE_BASE: u64 = 0x6000_0000_0000_0000;
#[derive(Clone)]
pub struct Family {
    pub variants: Vec<BodyAssetUse>,
    pub glow: BodyAssetUse,
}
pub struct Bank {
    pub cosmetics: Option<crate::cosmetics::Cosmetics>,
    pub assets: Vec<BodyAsset>,
    recipes: Vec<CanvasRecipe>,
    pub bodies: Vec<Family>,
    pub outline: BodyAssetUse,
    pub shadow: BodyAssetUse,
    pub death: BodyAssetUse,
    pub tile: BodyAssetUse,
    pub backdrop: BodyAssetUse,
    food: Vec<FoodFactory>,
    prey: Vec<PreyFactory>,
    cache: BTreeMap<usize, Resource>,
    disks: BTreeMap<[u8; 3], BodyAsset>,
    solids: BTreeMap<[u8; 3], BodyAsset>,
    pub hud: Resource,
    pub minimap: crate::minimap::Minimap,
    pub text: crate::text::TextCache,
    text_frames: BTreeMap<u64, Vec<Resource>>,
    pub palette_rgb: Vec<[u8; 3]>,
}
fn use_at(i: usize) -> BodyAssetUse {
    BodyAssetUse {
        asset: i,
        source_rect: None,
    }
}
impl Bank {
    pub fn new() -> Result<Self> {
        let r = authored_source_recipes();
        let mut b = Self {
            cosmetics: None,
            assets: Vec::new(),
            recipes: Vec::new(),
            bodies: Vec::new(),
            outline: use_at(0),
            shadow: use_at(0),
            death: use_at(0),
            tile: use_at(0),
            backdrop: use_at(0),
            food: Vec::new(),
            prey: Vec::new(),
            cache: BTreeMap::new(),
            disks: BTreeMap::new(),
            solids: BTreeMap::new(),
            hud: crate::hud::resource(),
            minimap: crate::minimap::Minimap::default(),
            text: crate::text::TextCache::default(),
            text_frames: BTreeMap::new(),
            palette_rgb: r.palette_rgb,
        };
        for p in r.body_sources.palettes {
            let variants = p.variants.into_iter().map(|r| b.add(r)).collect();
            let glow = b.add(p.boost_glow);
            b.bodies.push(Family { variants, glow });
        }
        b.outline = b.add(r.body_sources.outline);
        b.shadow = b.add(r.body_sources.shadow);
        b.death = b.add(r.body_sources.death_highlight);
        b.tile = b.add(r.tile);
        b.backdrop = b.add(r.backdrop);
        for p in r.food {
            let mut family = |rs: Vec<CanvasRecipe>| -> Result<Vec<FoodSource>> {
                rs.into_iter()
                    .map(|r| {
                        let w = r.width;
                        let h = r.height;
                        let hw = r.half_width;
                        let hh = r.half_height;
                        let u = b.add(r);
                        FoodSource::new(b.assets[u.asset], f64::from(w), f64::from(h), hw, hh)
                            .map_err(|e| e.to_string())
                    })
                    .collect()
            };
            let bodies = family(p.bodies)?;
            let outlines = family(p.outlines)?;
            let glows = family(p.glows)?;
            b.food.push(FoodFactory {
                random_phase_unit: 0.,
                random_wobble_unit: 0.,
                palette: p.color as u8,
                image_count: p.count,
                bodies,
                outlines,
                glows,
            });
        }
        for p in r.prey {
            let mut family = |rs: Vec<CanvasRecipe>| -> Result<Vec<PreySource>> {
                rs.into_iter()
                    .map(|r| {
                        let w = r.width;
                        let h = r.height;
                        let hw = r.half_width;
                        let hh = r.half_height;
                        let u = b.add(r);
                        PreySource::new(b.assets[u.asset], f64::from(w), f64::from(h), hw, hh)
                            .map_err(|e| e.to_string())
                    })
                    .collect()
            };
            let bodies = family(p.bodies)?;
            let glows = family(p.glows)?;
            b.prey.push(PreyFactory {
                random_phase_unit: 0.,
                random_rate_unit: 0.,
                palette: p.color as u8,
                bodies,
                glows,
            });
        }
        Ok(b)
    }
    fn add(&mut self, r: CanvasRecipe) -> BodyAssetUse {
        let index = self.recipes.len();
        self.assets.push(BodyAsset {
            handle: BODY_HANDLE_BASE + 1 + index as u64,
            revision: 1,
            width: r.width,
            height: r.height,
            status: BodyAssetStatus::Ready,
        });
        self.recipes.push(r);
        use_at(index)
    }
    pub fn food(&self, raw: u8, units: [f64; 2]) -> FoodFactory {
        let mut f = self.food[usize::from(food_palette(raw))].clone();
        f.random_phase_unit = units[0];
        f.random_wobble_unit = units[1];
        f
    }
    pub fn prey(&self, raw: u8, units: [f64; 2]) -> PreyFactory {
        let mut f = self.prey[usize::from(raw % 9)].clone();
        f.random_phase_unit = units[0];
        f.random_rate_unit = units[1];
        f
    }
    pub fn disk(&mut self, color: [u8; 3]) -> Result<BodyAsset> {
        if let Some(a) = self.disks.get(&color) {
            return Ok(*a);
        }
        use slither_client::authored_sources::PaintCommand as P;
        let u = self.add(CanvasRecipe {
            width: 64,
            height: 64,
            half_width: 32.,
            half_height: 32.,
            commands: vec![
                P::FillStyle(format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2])),
                P::BeginPath,
                P::Arc([32., 32., 32., 0., std::f64::consts::TAU]),
                P::Fill,
            ],
        });
        let a = self.assets[u.asset];
        self.disks.insert(color, a);
        Ok(a)
    }
    /// Only the frame's actual draw resources become pixel buffers. Metadata alone is not GPU residency.
    pub fn resources(&mut self, frame: &Frame) -> Result<Vec<Resource>> {
        let keys: BTreeSet<ResourceKey> = frame.draws.iter().map(|d| d.asset.into()).collect();
        let indices: BTreeSet<usize> = keys
            .iter()
            .filter_map(|k| self.assets.iter().position(|a| ResourceKey::from(*a) == *k))
            .collect();
        // Consume this candidate's staging even if later validation fails.
        let text = self.text_frames.remove(&frame.identity).unwrap_or_default();
        let bytes = indices
            .iter()
            .map(|i| self.assets[*i].width as usize * self.assets[*i].height as usize * 4)
            .sum::<usize>()
            + self
                .cosmetics
                .iter()
                .flat_map(|c| c.resources())
                .filter(|r| keys.contains(&r.asset.into()))
                .map(|r| r.image.pixels.len())
                .sum::<usize>()
            + if keys.contains(&self.hud.asset.into()) {
                self.hud.image.pixels.len()
            } else {
                0
            }
            + text.iter().map(|r| r.image.pixels.len()).sum::<usize>();
        if bytes > PIXEL_BUDGET {
            return Err("Active resource pixel budget exceeded".into());
        }
        self.cache.retain(|i, _| indices.contains(i));
        for i in &indices {
            if !self.cache.contains_key(i) {
                let image = materialize(&self.recipes[*i])?;
                self.cache.insert(
                    *i,
                    Resource {
                        asset: self.assets[*i],
                        image,
                    },
                );
            }
        }
        let mut resources: Vec<_> = self.cache.values().cloned().collect();
        resources.extend_from_slice(&text);
        resources.extend(
            self.cosmetics
                .iter()
                .flat_map(|c| c.resources())
                .filter(|r| keys.contains(&r.asset.into()))
                .cloned(),
        );
        if keys.contains(&self.hud.asset.into()) {
            resources.push(self.hud.clone());
        }
        if resources.len() != keys.len() {
            return Err("Unknown prepared resource".into());
        }
        if resources
            .iter()
            .map(|r| r.image.pixels.len())
            .sum::<usize>()
            > PIXEL_BUDGET
        {
            return Err("Active resource pixel budget exceeded".into());
        }
        let resident = resources
            .iter()
            .map(|r| (r.asset.into(), r.asset))
            .collect();
        frame.quads(&resident)?;
        Ok(resources)
    }
    pub(crate) fn discard_text(&mut self, identity: u64) {
        self.text_frames.remove(&identity);
    }
    /// Own the pixels of queued Setup pictures independently of LRU eviction.
    pub fn stage_text(&mut self, identity: u64, resources: Vec<Resource>) -> Result<()> {
        // Preparation is ordered. Reused identities replace only unpublished
        // pixels left by an aborted candidate; admitted pictures own their copies.
        self.text_frames.retain(|key, _| *key < identity);
        if resources.is_empty() {
            return Ok(());
        }
        let bytes = self
            .text_frames
            .values()
            .flatten()
            .chain(&resources)
            .map(|r| r.image.pixels.len())
            .sum::<usize>();
        if self.text_frames.len() >= 16 || bytes > PIXEL_BUDGET {
            return Err("queued text resource budget".into());
        }
        self.text_frames.insert(identity, resources);
        Ok(())
    }
    pub fn cached_sources(&self) -> usize {
        self.cache.len()
    }
    pub fn solid(&mut self, color: [u8; 3]) -> BodyAsset {
        if let Some(a) = self.solids.get(&color) {
            return *a;
        }
        use slither_client::authored_sources::PaintCommand as P;
        let u = self.add(CanvasRecipe {
            width: 1,
            height: 1,
            half_width: 0.5,
            half_height: 0.5,
            commands: vec![P::Pixels {
                width: 1,
                height: 1,
                rgba: vec![color[0], color[1], color[2], 255],
            }],
        });
        let a = self.assets[u.asset];
        self.solids.insert(color, a);
        a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texture_handle_namespaces_are_disjoint() {
        let bases = [
            BODY_HANDLE_BASE,
            HUD_HANDLE_BASE,
            TEXT_HANDLE_BASE,
            MINIMAP_HANDLE_BASE,
            COSMETIC_HANDLE_BASE,
        ];
        for (i, base) in bases.iter().enumerate() {
            assert_eq!(base % HANDLE_NAMESPACE_SIZE, 0);
            for other in &bases[i + 1..] {
                assert!(
                    base + HANDLE_NAMESPACE_SIZE <= *other
                        || other + HANDLE_NAMESPACE_SIZE <= *base
                );
            }
        }
    }
}
