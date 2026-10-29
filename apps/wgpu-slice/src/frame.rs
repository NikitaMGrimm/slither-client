//! Validation and the single f64 -> f32 submission boundary; no scene or clock policy.
use crate::Result;
use slither_client::presentation::{
    BodyAsset, BodyAssetStatus, BodyBlend, BodyImageCommand, BodyRect, FoodImageCommand,
    FoodImageDraw,
};
use std::collections::BTreeMap;

pub const MAX_DRAWS: usize = 8192;
pub const MAX_EXTENT: u32 = 8192;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ResourceKey {
    pub handle: u64,
    pub revision: u64,
}
impl From<BodyAsset> for ResourceKey {
    fn from(asset: BodyAsset) -> Self {
        Self {
            handle: asset.handle,
            revision: asset.revision,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Draw {
    /// Backend polygon corners only for existing arena path tessellation; images keep None.
    pub corners: Option<[[f64; 2]; 4]>,
    pub asset: BodyAsset,
    pub source: Option<BodyRect>,
    pub destination: BodyRect,
    /// Translation in logical viewport pixels, followed by local rotation.
    pub translation: [f64; 2],
    pub rotation: f64,
    pub effective_alpha: f64,
    pub blend: BodyBlend,
}
impl From<&BodyImageCommand> for Draw {
    fn from(c: &BodyImageCommand) -> Self {
        Self {
            corners: None,
            asset: c.asset,
            source: c.source_rect,
            destination: c.destination,
            translation: [c.center.x + c.translation.x, c.center.y + c.translation.y],
            rotation: c.rotation.unwrap_or(0.),
            effective_alpha: c.alpha.effective,
            blend: c.blend,
        }
    }
}
impl From<&FoodImageCommand> for Draw {
    fn from(c: &FoodImageCommand) -> Self {
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
        Self {
            corners: None,
            asset: c.source.asset(),
            source,
            destination,
            translation: [0.; 2],
            rotation: 0.,
            effective_alpha: c.alpha.effective,
            blend: c.blend,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Frame {
    pub identity: u64,
    pub extent: [u32; 2],
    pub viewport_scale: f64,
    pub tick: u32,
    pub draws: Vec<Draw>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Quad {
    pub key: ResourceKey,
    pub blend: BodyBlend,
    /// Six vertices: clip X/Y, UV X/Y, effective alpha. Order is never regrouped.
    pub vertices: [[f32; 5]; 6],
}

fn rect_finite(r: BodyRect) -> bool {
    [r.x, r.y, r.width, r.height]
        .into_iter()
        .all(f64::is_finite)
}

impl Frame {
    /// Preflight the whole frame before any GPU submission. Zero backing extent is suspended.
    pub fn quads(&self, resident: &BTreeMap<ResourceKey, BodyAsset>) -> Result<Vec<Quad>> {
        if self.extent.iter().any(|n| *n > MAX_EXTENT)
            || !self.viewport_scale.is_finite()
            || self.viewport_scale <= 0.
            || self.draws.len() > MAX_DRAWS
        {
            return Err("invalid frame extent/scale/budget".into());
        }
        if self.extent.contains(&0) {
            return Ok(Vec::new());
        }
        self.draws
            .iter()
            .map(|d| {
                let key = ResourceKey::from(d.asset);
                if d.asset.status != BodyAssetStatus::Ready
                    || d.asset.width == 0
                    || d.asset.height == 0
                    || resident.get(&key) != Some(&d.asset)
                {
                    return Err("missing, stale or unready resource".into());
                }
                let source = d.source.unwrap_or(BodyRect {
                    x: 0.,
                    y: 0.,
                    width: f64::from(d.asset.width),
                    height: f64::from(d.asset.height),
                });
                if !rect_finite(source)
                    || !rect_finite(d.destination)
                    || !d.rotation.is_finite()
                    || !d.translation.into_iter().all(f64::is_finite)
                    || !(0. ..=1.).contains(&d.effective_alpha)
                    || source.width <= 0.
                    || source.height <= 0.
                    || source.x < 0.
                    || source.y < 0.
                    || source.x + source.width > f64::from(d.asset.width)
                    || source.y + source.height > f64::from(d.asset.height)
                    || d.destination.width < 0.
                    || d.destination.height < 0.
                {
                    return Err("unsupported or invalid image rectangle/alpha/transform".into());
                }
                let r = d.destination;
                let (sin, cos) = d.rotation.sin_cos();
                let mut corners = [[0.; 5]; 4];
                for (i, [u, v]) in [[0., 0.], [1., 0.], [1., 1.], [0., 1.]]
                    .into_iter()
                    .enumerate()
                {
                    let [x, y] = d
                        .corners
                        .map_or([r.x + u * r.width, r.y + v * r.height], |p| p[i]);
                    if !x.is_finite() || !y.is_finite() {
                        return Err("nonfinite polygon corner".into());
                    }
                    let local_x = x;
                    let x = d.translation[0] + cos * x - sin * y;
                    let y = d.translation[1] + sin * local_x + cos * y;
                    let values = [
                        2. * (x * self.viewport_scale) / f64::from(self.extent[0]) - 1.,
                        1. - 2. * (y * self.viewport_scale) / f64::from(self.extent[1]),
                        (source.x + u * source.width) / f64::from(d.asset.width),
                        (source.y + v * source.height) / f64::from(d.asset.height),
                        d.effective_alpha,
                    ];
                    if values
                        .iter()
                        .any(|v| !v.is_finite() || v.abs() > f64::from(f32::MAX))
                    {
                        return Err("GPU conversion overflow".into());
                    }
                    corners[i] = values.map(|v| v as f32);
                }
                Ok(Quad {
                    key,
                    blend: d.blend,
                    vertices: [
                        corners[0], corners[1], corners[2], corners[0], corners[2], corners[3],
                    ],
                })
            })
            .collect()
    }
}
