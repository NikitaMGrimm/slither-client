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
    /// Unbounded normalized UV rectangle for a repeating image; crops remain bounded.
    pub repeat_uv: Option<BodyRect>,
    pub destination: BodyRect,
    /// Translation in logical viewport pixels, followed by local rotation.
    pub translation: [f64; 2],
    pub rotation: f64,
    pub effective_alpha: f64,
    pub blend: BodyBlend,
}
impl Draw {
    /// Diagnostic geometry overlap only; transparent source pixels are not inspected.
    pub(crate) fn image_intersects_viewport(&self, extent: [u32; 2], scale: f64) -> bool {
        let r = self.destination;
        if self.corners.is_some()
            || self.effective_alpha <= 0.0
            || r.width == 0.0
            || r.height == 0.0
        {
            return false;
        }
        let (sin, cos) = self.rotation.sin_cos();
        let points = [
            [r.x, r.y],
            [r.x + r.width, r.y],
            [r.x + r.width, r.y + r.height],
            [r.x, r.y + r.height],
        ]
        .map(|[x, y]| {
            [
                self.translation[0] + cos * x - sin * y,
                self.translation[1] + sin * x + cos * y,
            ]
        });
        let width = f64::from(extent[0]) / scale;
        let height = f64::from(extent[1]) / scale;
        let viewport = [[0.0, 0.0], [width, 0.0], [width, height], [0.0, height]];
        // Separating axes for a rotated image rectangle and the viewport, with positive area.
        [[1.0, 0.0], [0.0, 1.0], [cos, sin], [-sin, cos]]
            .into_iter()
            .all(|[x, y]| {
                let span = |points: [[f64; 2]; 4]| {
                    points
                        .map(|p| p[0] * x + p[1] * y)
                        .into_iter()
                        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| {
                            (lo.min(v), hi.max(v))
                        })
                };
                let (lo, hi) = span(points);
                let (view_lo, view_hi) = span(viewport);
                hi > view_lo && view_hi > lo
            })
    }
}
impl From<&BodyImageCommand> for Draw {
    fn from(c: &BodyImageCommand) -> Self {
        Self {
            corners: None,
            asset: c.asset,
            source: c.source_rect,
            repeat_uv: None,
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
            repeat_uv: None,
            destination,
            translation: [0.; 2],
            rotation: 0.,
            effective_alpha: c.alpha.effective,
            blend: c.blend,
        }
    }
}

/// Observations from this frame's existing culling and actual normal-body commands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnakeDrawObservation {
    pub id: u16,
    pub own: bool,
    pub body_commands: usize,
    pub viewport_body_commands: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Frame {
    pub identity: u64,
    pub extent: [u32; 2],
    pub viewport_scale: f64,
    pub tick: u32,
    pub draws: Vec<Draw>,
    /// Diagnostic only: does not participate in GPU submission or scene policy.
    pub snakes: Vec<SnakeDrawObservation>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Quad {
    pub key: ResourceKey,
    pub repeat: bool,
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
                    || d.repeat_uv.is_some_and(|uv| {
                        !rect_finite(uv) || uv.width <= 0. || uv.height <= 0. || d.source.is_some()
                    })
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
                    let [uv_x, uv_y] = d.repeat_uv.map_or_else(
                        || {
                            [
                                (source.x + u * source.width) / f64::from(d.asset.width),
                                (source.y + v * source.height) / f64::from(d.asset.height),
                            ]
                        },
                        |uv| [uv.x + u * uv.width, uv.y + v * uv.height],
                    );
                    let values = [
                        2. * (x * self.viewport_scale) / f64::from(self.extent[0]) - 1.,
                        1. - 2. * (y * self.viewport_scale) / f64::from(self.extent[1]),
                        uv_x,
                        uv_y,
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
                    repeat: d.repeat_uv.is_some(),
                    blend: d.blend,
                    vertices: [
                        corners[0], corners[1], corners[2], corners[0], corners[2], corners[3],
                    ],
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn viewport_overlap_uses_rotated_geometry_positive_alpha_and_backing_scale() {
        // ORIGINAL SYNTHETIC image rectangles; no source image or GPU.
        let mut d = Draw {
            corners: None,
            repeat_uv: None,
            asset: BodyAsset {
                handle: 1,
                revision: 1,
                width: 100,
                height: 2,
                status: BodyAssetStatus::Ready,
            },
            source: None,
            destination: BodyRect {
                x: 0.,
                y: 0.,
                width: 100.,
                height: 2.,
            },
            translation: [-20., 45.],
            rotation: -std::f64::consts::FRAC_PI_4,
            effective_alpha: 1.,
            blend: BodyBlend::SourceOver,
        };
        // Its axis-aligned bounds overlap, but the diagonal misses the viewport corner.
        assert!(!d.image_intersects_viewport([10, 10], 1.));
        d.translation[1] = 39.;
        assert!(d.image_intersects_viewport([10, 10], 1.));
        assert!(d.image_intersects_viewport([20, 20], 2.));
        d.effective_alpha = 0.;
        assert!(!d.image_intersects_viewport([10, 10], 1.));
        d.effective_alpha = 1.;
        d.rotation = 0.;
        d.translation = [10., 0.];
        assert!(!d.image_intersects_viewport([10, 10], 1.));
    }
}
