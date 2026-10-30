//! Platform-rasterized Arial runs, submitted as ordinary ordered image draws.
use crate::{Result, frame::Draw, materials::RgbaImage, scene::Resource};
use slither_client::presentation::{BodyAsset, BodyAssetStatus, BodyBlend, BodyRect};
use std::collections::BTreeMap;

#[cfg(not(target_arch = "wasm32"))]
#[path = "text_native.rs"]
mod platform;
#[cfg(target_arch = "wasm32")]
#[path = "text_web.rs"]
mod platform;

pub const CACHE_BYTES: usize = 4 * 1024 * 1024;
pub const CACHE_RUNS: usize = 256;

/// The shared Canvas font stack. Native Windows loads Arial from the system fonts.
pub const FONT_FAMILY: &str = "Arial, Helvetica Neue, Helvetica, sans-serif";

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Weight {
    Normal,
    Bold,
}
#[derive(Clone, Copy, Debug)]
pub struct TextStyle {
    /// Logical viewport pixels. Divide a fixed backing-pixel size by the scale.
    pub size: f64,
    pub weight: Weight,
    pub color: [u8; 3],
}
#[derive(Clone, Copy, Debug)]
pub enum Align {
    Left,
    Center,
    Right,
}
#[derive(Clone, Copy, Debug)]
pub enum Baseline {
    Alphabetic,
    Middle,
}
pub struct TextRun<'a> {
    pub text: &'a str,
    pub style: TextStyle,
    pub position: [f64; 2],
    pub align: Align,
    pub baseline: Baseline,
    pub alpha: f64,
}

/// Pixel bounds relative to a left-aligned alphabetic anchor, plus advance and
/// the alphabetic-to-middle baseline shift, all in raster pixels.
pub(super) struct Raster {
    pub image: RgbaImage,
    pub offset: [f64; 2],
    pub advance: f64,
    pub middle: f64,
}
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Key {
    text: String,
    size: u64,
    weight: Weight,
    color: [u8; 3],
}
struct Entry {
    tiles: Vec<Tile>,
    bytes: usize,
    offset: [f64; 2],
    advance: f64,
    middle: f64,
    used: u64,
}
struct Tile {
    resource: Resource,
    start: u32,
    source_x: u32,
    width: u32,
}

pub struct TextCache {
    rasterizer: platform::Rasterizer,
    entries: BTreeMap<Key, Entry>,
    bytes: usize,
    clock: u64,
    next_handle: u64,
}
impl Default for TextCache {
    fn default() -> Self {
        Self {
            rasterizer: platform::Rasterizer::new(),
            entries: BTreeMap::new(),
            bytes: 0,
            clock: 0,
            next_handle: crate::bank::TEXT_HANDLE_BASE,
        }
    }
}
impl TextCache {
    /// Rasterize at backing resolution. Position and opacity are deliberately
    /// outside the cache key, so movement/fading never uploads a new texture.
    /// The returned owned resource remains valid after cache eviction.
    /// Invalid or unrasterizable cosmetic labels produce no draws, so missing
    /// fonts, platform errors and raster budgets cannot terminate gameplay.
    pub fn draw(&mut self, run: TextRun<'_>, backing_scale: f64) -> Result<Vec<(Draw, Resource)>> {
        Ok(self.try_draw(run, backing_scale).unwrap_or_default())
    }
    fn try_draw(&mut self, run: TextRun<'_>, backing_scale: f64) -> Result<Vec<(Draw, Resource)>> {
        let px = run.style.size * backing_scale;
        if !run.position.into_iter().all(f64::is_finite)
            || !(0. ..=1.).contains(&run.alpha)
            || !backing_scale.is_finite()
            || backing_scale <= 0.
            || !run.style.size.is_finite()
            || run.style.size <= 0.
            || !(1. ..=128.).contains(&px)
            || run.text.len() > 1024
        {
            return Err("invalid text run/style/budget".into());
        }
        if run.text.is_empty() {
            return Ok(Vec::new());
        }
        let key = Key {
            text: run.text.into(),
            size: px.to_bits(),
            weight: run.style.weight,
            color: run.style.color,
        };
        self.clock += 1;
        if !self.entries.contains_key(&key) {
            let raster =
                self.rasterizer
                    .rasterize(run.text, px, run.style.weight, run.style.color)?;
            let [w, h] = [raster.image.width, raster.image.height];
            if w == 0
                || h == 0
                || w > 8192
                || h > 512
                || raster.image.pixels.len() != w as usize * h as usize * 4
                || !raster
                    .offset
                    .into_iter()
                    .chain([raster.advance, raster.middle])
                    .all(f64::is_finite)
            {
                return Err("text raster bounds".into());
            }
            let mut tiles = Vec::new();
            let mut bytes = 0;
            for start in (0..w).step_by(510) {
                let end = (start + 510).min(w);
                let left = start.saturating_sub(1);
                let right = (end + 1).min(w);
                let width = right - left;
                let mut pixels = Vec::with_capacity(width as usize * h as usize * 4);
                for row in raster.image.pixels.chunks_exact(w as usize * 4) {
                    pixels.extend_from_slice(&row[left as usize * 4..right as usize * 4]);
                }
                bytes += pixels.len();
                self.next_handle = self
                    .next_handle
                    .checked_add(1)
                    .filter(|handle| {
                        *handle < crate::bank::TEXT_HANDLE_BASE + crate::bank::HANDLE_NAMESPACE_SIZE
                    })
                    .ok_or("text handle overflow")?;
                tiles.push(Tile {
                    resource: Resource {
                        asset: BodyAsset {
                            handle: self.next_handle,
                            revision: 1,
                            width,
                            height: h,
                            status: BodyAssetStatus::Ready,
                        },
                        image: RgbaImage {
                            width,
                            height: h,
                            pixels,
                        },
                    },
                    start,
                    source_x: start - left,
                    width: end - start,
                });
            }
            if bytes > CACHE_BYTES {
                return Err("text cache run budget".into());
            }
            while self.entries.len() >= CACHE_RUNS || self.bytes + bytes > CACHE_BYTES {
                let oldest = self
                    .entries
                    .iter()
                    .min_by_key(|(_, e)| e.used)
                    .map(|(k, _)| k.clone())
                    .ok_or("text cache budget")?;
                self.bytes -= self.entries.remove(&oldest).unwrap().bytes;
            }
            self.bytes += bytes;
            self.entries.insert(
                key.clone(),
                Entry {
                    tiles,
                    bytes,
                    offset: raster.offset,
                    advance: raster.advance,
                    middle: raster.middle,
                    used: self.clock,
                },
            );
        }
        let entry = self.entries.get_mut(&key).unwrap();
        entry.used = self.clock;
        let x = match run.align {
            Align::Left => 0.,
            Align::Center => entry.advance / 2.,
            Align::Right => entry.advance,
        };
        let y = match run.baseline {
            Baseline::Alphabetic => 0.,
            Baseline::Middle => entry.middle,
        };
        Ok(entry
            .tiles
            .iter()
            .map(|tile| {
                (
                    Draw {
                        corners: None,
                        repeat_uv: None,
                        black_effect: false,
                        asset: tile.resource.asset,
                        // Neighbor pixels outside the crop preserve linear sampling
                        // across tile seams at fractional screen positions.
                        source: Some(BodyRect {
                            x: f64::from(tile.source_x),
                            y: 0.,
                            width: f64::from(tile.width),
                            height: f64::from(tile.resource.asset.height),
                        }),
                        destination: BodyRect {
                            x: (entry.offset[0] + f64::from(tile.start) - x) / backing_scale,
                            y: (entry.offset[1] + y) / backing_scale,
                            width: f64::from(tile.width) / backing_scale,
                            height: f64::from(tile.resource.asset.height) / backing_scale,
                        },
                        translation: run.position,
                        rotation: 0.,
                        effective_alpha: run.alpha,
                        blend: BodyBlend::SourceOver,
                    },
                    tile.resource.clone(),
                )
            })
            .collect())
    }
    pub fn cached_runs(&self) -> usize {
        self.entries.len()
    }
    pub fn cached_bytes(&self) -> usize {
        self.bytes
    }
}
