//! CSS-pixel minimap composition. The shared core owns all map and lifecycle state.
use crate::{
    Result,
    frame::{Draw, Frame},
    materials::RgbaImage,
    scene::Resource,
};
use slither_client::{presentation::*, state::Point};

const HANDLE: u64 = 0x5000_0000_0000_0000;

#[derive(Default)]
pub struct Minimap {
    background: Option<(u16, RgbaImage)>,
    pixels: Vec<u8>,
    tiles: Vec<(Draw, Resource)>,
    revision: u64,
}

fn over(dst: &mut [u8], src: &[u8], opacity: f64) {
    let alpha = f64::from(src[3]) / 255. * opacity;
    for i in 0..4 {
        dst[i] = (f64::from(src[i]) * opacity + f64::from(dst[i]) * (1. - alpha)).round() as u8;
    }
}

fn image(width: u32, height: u32) -> RgbaImage {
    RgbaImage {
        width,
        height,
        pixels: vec![0; width as usize * height as usize * 4],
    }
}

fn coverage(x: f64, y: f64, center: Point, radius: f64) -> f64 {
    let mut count = 0;
    for dy in 0..4 {
        for dx in 0..4 {
            let x = x + (f64::from(dx) + 0.5) / 4. - center.x;
            let y = y + (f64::from(dy) + 0.5) / 4. - center.y;
            count += u8::from(x * x + y * y <= radius * radius);
        }
    }
    f64::from(count) / 16.
}

fn background(plan: MinimapBackgroundPlan, side: u32) -> RgbaImage {
    let mut out = image(side, side);
    let n = side as usize;
    let mut mask = vec![0.; n * n];
    for y in 0..n {
        for x in 0..n {
            mask[y * n + x] = coverage(x as f64, y as f64, plan.center, plan.radius);
        }
    }
    // Match the existing material adapter's Canvas-shadow approximation.
    let sigma = plan.shadow_blur / 2.;
    let radius = (3. * sigma).ceil() as i32;
    let mut weights: Vec<_> = (-radius..=radius)
        .map(|k| (-0.5 * (f64::from(k) / sigma).powi(2)).exp())
        .collect();
    let sum: f64 = weights.iter().sum();
    weights.iter_mut().for_each(|v| *v /= sum);
    let mut horizontal = vec![0.; n * n];
    for y in 0..n {
        for x in 0..n {
            for (k, weight) in (-radius..=radius).zip(&weights) {
                let xx = x as i32 + k;
                let yy = y as i32 - plan.shadow_offset.y as i32;
                if (0..n as i32).contains(&xx) && (0..n as i32).contains(&yy) {
                    horizontal[y * n + x] += mask[yy as usize * n + xx as usize] * weight;
                }
            }
        }
    }
    for y in 0..n {
        for x in 0..n {
            let mut shadow = 0.;
            for (k, weight) in (-radius..=radius).zip(&weights) {
                let yy = y as i32 + k;
                if (0..n as i32).contains(&yy) {
                    shadow += horizontal[yy as usize * n + x] * weight;
                }
            }
            let dst = &mut out.pixels[(y * n + x) * 4..][..4];
            dst[3] = (shadow * 255.).round() as u8;
            let mut rgb = [0.; 3];
            let mut alpha: f64 = 0.;
            for dy in 0..4 {
                for dx in 0..4 {
                    let px = x as f64 + (f64::from(dx) + 0.5) / 4.;
                    let py = y as f64 + (f64::from(dy) + 0.5) / 4.;
                    if (px - plan.center.x).hypot(py - plan.center.y) <= plan.radius {
                        let quadrant = (px >= plan.center.x) == (py >= plan.center.y);
                        let stroke = (px - plan.center.x).abs() < plan.stroke_width / 2.
                            || (py - plan.center.y).abs() < plan.stroke_width / 2.;
                        let color = if stroke {
                            plan.stroke
                        } else if quadrant {
                            plan.quadrant_fill
                        } else {
                            plan.fill
                        };
                        for i in 0..3 {
                            rgb[i] += f64::from(color[i]) / 16.;
                        }
                        alpha += 255. / 16.;
                    }
                }
            }
            over(
                dst,
                &[
                    rgb[0].round() as u8,
                    rgb[1].round() as u8,
                    rgb[2].round() as u8,
                    alpha.round() as u8,
                ],
                1.,
            );
        }
    }
    out
}

fn marker(plan: MinimapMarkerPlan) -> RgbaImage {
    let mut out = image(plan.side as u32, plan.side as u32);
    for y in 0..out.height {
        for x in 0..out.width {
            let outer = coverage(
                f64::from(x),
                f64::from(y),
                plan.center,
                plan.radius + plan.stroke_width / 2.,
            );
            let inner = coverage(f64::from(x), f64::from(y), plan.center, plan.radius);
            let dst = &mut out.pixels[((y * out.width + x) * 4) as usize..][..4];
            dst[3] = (outer * 255.).round() as u8;
            over(dst, &[255; 4], inner);
        }
    }
    out
}

fn draw(asset: BodyAsset, destination: BodyRect, source: Option<BodyRect>, alpha: f64) -> Draw {
    Draw {
        asset,
        destination,
        source,
        repeat_uv: None,
        translation: [0.; 2],
        rotation: 0.,
        effective_alpha: alpha,
        blend: BodyBlend::SourceOver,
        corners: None,
    }
}

fn resource(handle: u64, revision: u64, image: RgbaImage) -> Resource {
    Resource {
        asset: BodyAsset {
            handle,
            revision,
            width: image.width,
            height: image.height,
            status: BodyAssetStatus::Ready,
        },
        image,
    }
}

fn marker_strip(
    asset: BodyAsset,
    bounds: BodyRect,
    origin: [f64; 2],
    [left, top, right, bottom]: [f64; 4],
    alpha: f64,
) -> Option<Draw> {
    let x = (left - bounds.x).clamp(0., f64::from(asset.width));
    let y = (top - bounds.y).clamp(0., f64::from(asset.height));
    // Subtracting fractional CSS coordinates can overshoot the 14px image by
    // one ULP. Keep the source crop inside its texture and the scale at 1:1.
    let width = (right - left).clamp(0., f64::from(asset.width) - x);
    let height = (bottom - top).clamp(0., f64::from(asset.height) - y);
    (width > 0. && height > 0.).then(|| {
        draw(
            asset,
            BodyRect {
                x: left + origin[0],
                y: top + origin[1],
                width,
                height,
            },
            Some(BodyRect {
                x,
                y,
                width,
                height,
            }),
            alpha,
        )
    })
}

// Canvas puts a 14-pixel marker image at a fractional CSS position. Sample that
// image rather than rerasterizing the circle at its destination coordinates.
fn sample(image: &RgbaImage, x: f64, y: f64) -> [u8; 4] {
    let (ix, iy) = (x.floor() as i32, y.floor() as i32);
    let (fx, fy) = (x - x.floor(), y - y.floor());
    let mut out = [0.; 4];
    for (dx, wx) in [(0, 1. - fx), (1, fx)] {
        for (dy, wy) in [(0, 1. - fy), (1, fy)] {
            let (px, py) = (ix + dx, iy + dy);
            if (0..image.width as i32).contains(&px) && (0..image.height as i32).contains(&py) {
                let i = ((py as u32 * image.width + px as u32) * 4) as usize;
                for (c, v) in out.iter_mut().enumerate() {
                    *v += f64::from(image.pixels[i + c]) * wx * wy;
                }
            }
        }
    }
    out.map(|v| v.round() as u8)
}

impl Minimap {
    pub fn append(
        &mut self,
        client: &AnimatedClient,
        frame: &mut Frame,
        resources: &mut Vec<Resource>,
    ) -> Result<()> {
        if !client.minimap_tracking_enabled() {
            return Ok(());
        }
        let plan = client
            .minimap_render_plan(MinimapLayout::default())
            .map_err(|e| e.to_string())?;
        let Some(widget) = plan.widget else {
            return Ok(());
        };
        let alpha = widget.opacity.clamp(0., 1.);
        if alpha == 0. {
            return Ok(());
        }
        let side = widget.side as u32;
        let dimension = widget.images[0].dimension;
        if self
            .background
            .as_ref()
            .is_none_or(|(d, _)| *d != dimension)
        {
            self.background = Some((dimension, background(widget.background, side)));
        }
        let mut composed = self.background.as_ref().unwrap().1.clone();
        for pixel in composed.pixels.as_chunks_mut::<4>().0 {
            for c in pixel {
                *c = (f64::from(*c) * widget.background.opacity).round() as u8;
            }
        }
        for layer in widget.images {
            let n = u32::from(layer.dimension);
            for y in 0..n {
                for x in 0..n {
                    let src = &layer.rgba[((y * n + x) * 4) as usize..][..4];
                    let i = (((y + layer.top_left.y as u32) * side + x + layer.top_left.x as u32)
                        * 4) as usize;
                    over(&mut composed.pixels[i..i + 4], src, layer.opacity);
                }
            }
        }
        let m = widget.marker;
        let marker = marker(m);
        for y in (m.top_left.y.floor().max(0.) as u32)
            ..((m.top_left.y + m.side).ceil().clamp(0., f64::from(side)) as u32)
        {
            for x in (m.top_left.x.floor().max(0.) as u32)
                ..((m.top_left.x + m.side).ceil().clamp(0., f64::from(side)) as u32)
            {
                let src = sample(
                    &marker,
                    f64::from(x) - m.top_left.x,
                    f64::from(y) - m.top_left.y,
                );
                let i = ((y * side + x) * 4) as usize;
                over(&mut composed.pixels[i..i + 4], &src, m.opacity);
            }
        }
        if self.pixels != composed.pixels {
            self.revision = self
                .revision
                .checked_add(1)
                .ok_or("minimap revision exhausted")?;
            self.pixels = composed.pixels;
            self.tiles.clear();
            // One-pixel gutters preserve linear sampling across the 512px source limit.
            for y in (0..side).step_by(510) {
                for x in (0..side).step_by(510) {
                    let (left, top) = (x.saturating_sub(1), y.saturating_sub(1));
                    let (right, bottom) = ((x + 511).min(side), (y + 511).min(side));
                    let mut tile = image(right - left, bottom - top);
                    for row in top..bottom {
                        let src = &self.pixels[((row * side + left) * 4) as usize
                            ..((row * side + right) * 4) as usize];
                        let dst = ((row - top) * tile.width * 4) as usize;
                        tile.pixels[dst..dst + src.len()].copy_from_slice(src);
                    }
                    let r = resource(HANDLE + self.tiles.len() as u64, self.revision, tile);
                    let destination = BodyRect {
                        x: f64::from(x),
                        y: f64::from(y),
                        width: f64::from((side - x).min(510)),
                        height: f64::from((side - y).min(510)),
                    };
                    let source = BodyRect {
                        x: f64::from(x - left),
                        y: f64::from(y - top),
                        ..destination
                    };
                    self.tiles
                        .push((draw(r.asset, destination, Some(source), 1.), r));
                }
            }
        }
        let origin = [
            f64::from(frame.extent[0]) / frame.viewport_scale - widget.right_bottom.x - widget.side,
            f64::from(frame.extent[1]) / frame.viewport_scale - widget.right_bottom.y - widget.side,
        ];
        for (d, r) in &self.tiles {
            let mut d = d.clone();
            d.translation = origin;
            d.effective_alpha = alpha;
            frame.draws.push(d);
            resources.push(r.clone());
        }
        // The DOM holder has visible overflow. Submit only the marker's outside
        // strips separately; its overlap was already flattened with the map.
        let marker = resource(HANDLE + 0x100, 1, marker);
        let bounds = BodyRect {
            x: m.top_left.x,
            y: m.top_left.y,
            width: m.side,
            height: m.side,
        };
        let end_x = bounds.x + bounds.width;
        let end_y = bounds.y + bounds.height;
        let s = f64::from(side);
        let strips = [
            (bounds.x, bounds.y, end_x, end_y.min(0.)),
            (bounds.x, bounds.y.max(s), end_x, end_y),
            (bounds.x, bounds.y.max(0.), end_x.min(0.), end_y.min(s)),
            (bounds.x.max(s), bounds.y.max(0.), end_x, end_y.min(s)),
        ];
        let mut outside = false;
        for (left, top, right, bottom) in strips {
            if let Some(command) = marker_strip(
                marker.asset,
                bounds,
                origin,
                [left, top, right, bottom],
                alpha * m.opacity,
            ) {
                frame.draws.push(command);
                outside = true;
            }
        }
        if outside {
            resources.push(marker);
        }
        self.append_server_label(&widget.label, origin, alpha, frame, resources)?;
        Ok(())
    }

    /// Integration point for the shared text renderer. The server label is the
    /// only deferred minimap primitive; keep its plan and holder opacity intact.
    fn append_server_label(
        &mut self,
        _label: &MinimapLabelPlan,
        _origin: [f64; 2],
        _holder_opacity: f64,
        _frame: &mut Frame,
        _resources: &mut Vec<Resource>,
    ) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fractional_marker_strip_does_not_exceed_its_texture() {
        let asset = resource(HANDLE + 0x100, 1, image(14, 14)).asset;
        for (bounds, strip) in [
            (
                BodyRect {
                    x: 2.1,
                    y: -1.3,
                    width: 14.,
                    height: 14.,
                },
                [2.1, -1.3, 16.1, 0.],
            ),
            (
                BodyRect {
                    x: -1.3,
                    y: 2.1,
                    width: 14.,
                    height: 14.,
                },
                [-1.3, 2.1, 0., 16.1],
            ),
            (
                BodyRect {
                    x: 2.1,
                    y: 31.3,
                    width: 14.,
                    height: 14.,
                },
                [2.1, 32., 16.1, 45.3],
            ),
            (
                BodyRect {
                    x: 31.3,
                    y: 2.1,
                    width: 14.,
                    height: 14.,
                },
                [32., 2.1, 45.3, 16.1],
            ),
        ] {
            let command = marker_strip(asset, bounds, [0.; 2], strip, 1.).unwrap();
            let frame = Frame {
                identity: 1,
                extent: [64, 64],
                viewport_scale: 1.,
                tick: 0,
                draws: vec![command],
                snakes: Vec::new(),
            };
            assert_eq!(
                frame.quads(&[(asset.into(), asset)].into()).unwrap().len(),
                1
            );
        }
    }
}
