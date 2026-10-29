//! Selected recipe adapter, not a general Canvas implementation. Unsupported tapes fail closed.
use crate::Result;
use slither_client::authored_sources::{CanvasRecipe, PaintCommand};

#[derive(Clone, Debug)]
pub struct RgbaImage {
    pub width: u32,
    pub height: u32,
    /// Premultiplied, encoded-sRGB components, for Rgba8Unorm (not an sRGB texture).
    pub pixels: Vec<u8>,
}

fn color(s: &str) -> Result<[f64; 4]> {
    if s.len() == 7 && s.starts_with('#') && s.is_ascii() {
        let mut out = [0., 0., 0., 1.];
        for i in 0..3 {
            out[i] = f64::from(
                u8::from_str_radix(&s[1 + i * 2..3 + i * 2], 16).map_err(|_| "invalid hex")?,
            ) / 255.;
        }
        return Ok(out);
    }
    if let Some(inner) = s.strip_prefix("rgba(").and_then(|s| s.strip_suffix(')')) {
        let values: Vec<f64> = inner
            .split(',')
            .map(|s| s.parse::<f64>().map_err(|_| "invalid rgba"))
            .collect::<std::result::Result<_, _>>()?;
        if values.len() == 4
            && values.iter().all(|v| v.is_finite())
            && values[..3].iter().all(|v| (0. ..=255.).contains(v))
            && (0. ..=1.).contains(&values[3])
        {
            return Ok([
                values[0] / 255.,
                values[1] / 255.,
                values[2] / 255.,
                values[3],
            ]);
        }
    }
    Err("unsupported recipe color".into())
}

#[derive(Clone)]
enum Fill {
    Solid([f64; 4]),
    Radial([f64; 6], Vec<(f64, [f64; 4])>),
}
impl Fill {
    fn at(&self, x: f64, y: f64) -> [f64; 4] {
        match self {
            Self::Solid(c) => *c,
            Self::Radial(c, stops) => {
                let t = (((x - c[0]).hypot(y - c[1]) - c[2]) / (c[5] - c[2])).clamp(0., 1.);
                let right = stops
                    .iter()
                    .position(|(p, _)| *p >= t)
                    .unwrap_or(stops.len() - 1);
                if right == 0 {
                    return stops[0].1;
                }
                let (a, ca) = stops[right - 1];
                let (b, cb) = stops[right];
                let t = if b > a { (t - a) / (b - a) } else { 1. };
                // Canvas stop interpolation is straight RGBA; premultiply only when painting.
                std::array::from_fn(|i| ca[i] + (cb[i] - ca[i]) * t)
            }
        }
    }
}

fn over(target: &mut [f64; 4], c: [f64; 4], coverage: f64, alpha: f64, destination_in: bool) {
    let a = c[3] * coverage * alpha;
    if destination_in {
        for v in target {
            *v *= a;
        }
    } else {
        for i in 0..3 {
            target[i] = c[i] * a + target[i] * (1. - a);
        }
        target[3] = a + target[3] * (1. - a);
    }
}

/// Finite CPU materialization for the slice's Pixels, full-circle mask/solid,
/// concentric radial FillRect, and black disk-shadow tapes. Coverage is 4x4;
/// shadow uses a truncated separable Gaussian (sigma=blur/2). Raster equality
/// with native Canvas is deliberately not claimed.
pub fn materialize(recipe: &CanvasRecipe) -> Result<RgbaImage> {
    let (w, h) = (recipe.width as usize, recipe.height as usize);
    if w == 0 || h == 0 || w > 512 || h > 512 || recipe.commands.len() > 128 {
        return Err("recipe extent/budget".into());
    }
    let mut pixels = vec![[0.; 4]; w * h];
    let mut fill = Fill::Solid([0., 0., 0., 1.]);
    let mut alpha = 1.;
    let mut destination_in = false;
    let mut circle = None;
    let mut polygon: Vec<[f64; 2]> = Vec::new();
    let mut shadow = None;
    for cmd in &recipe.commands {
        match cmd {
            PaintCommand::Pixels {
                width,
                height,
                rgba,
            } => {
                if *width != recipe.width || *height != recipe.height || rgba.len() != w * h * 4 {
                    return Err("pixel dimensions".into());
                }
                for (dst, src) in pixels.iter_mut().zip(rgba.as_chunks::<4>().0) {
                    let a = f64::from(src[3]) / 255.;
                    *dst = [
                        f64::from(src[0]) / 255. * a,
                        f64::from(src[1]) / 255. * a,
                        f64::from(src[2]) / 255. * a,
                        a,
                    ];
                }
            }
            PaintCommand::Composite("source-over") => destination_in = false,
            PaintCommand::Composite("destination-in") => destination_in = true,
            PaintCommand::FillStyle(s) => fill = Fill::Solid(color(s)?),
            PaintCommand::GlobalAlpha(a) if (0. ..=1.).contains(a) => alpha = *a,
            PaintCommand::BeginPath => {
                circle = None;
                polygon.clear();
            }
            PaintCommand::MoveTo(p)
                if polygon.is_empty() && circle.is_none() && p.iter().all(|v| v.is_finite()) =>
            {
                polygon.push(*p)
            }
            PaintCommand::LineTo(p)
                if !polygon.is_empty()
                    && polygon.len() < 128
                    && p.iter().all(|v| v.is_finite()) =>
            {
                polygon.push(*p)
            }
            PaintCommand::ClosePath if polygon.len() >= 3 => {}
            PaintCommand::Arc(c)
                if c.iter().all(|v| v.is_finite())
                    && c[2] > 0.
                    && c[3] == 0.
                    && c[4] == std::f64::consts::TAU
                    && circle.is_none()
                    && polygon.is_empty() =>
            {
                circle = Some(*c)
            }
            PaintCommand::RadialGradient { circles: c, stops } => {
                if !c.iter().all(|v| v.is_finite())
                    || c[0] != c[3]
                    || c[1] != c[4]
                    || c[2] < 0.
                    || c[5] <= c[2]
                    || stops.len() < 2
                    || stops.len() > 16
                {
                    return Err("unsupported gradient".into());
                }
                let mut colors = Vec::new();
                let mut last = -1.;
                for (p, s) in stops {
                    if !(0. ..=1.).contains(p) || *p <= last {
                        return Err("gradient stops".into());
                    }
                    colors.push((*p, color(s)?));
                    last = *p;
                }
                fill = Fill::Radial(*c, colors);
            }
            PaintCommand::Shadow {
                blur,
                offset_y,
                color: s,
            } if blur.is_finite()
                && *blur > 0.
                && *blur <= 32.
                && offset_y.is_finite()
                && offset_y.abs() <= 32. =>
            {
                shadow = Some((*blur, *offset_y, color(s)?))
            }
            PaintCommand::Fill | PaintCommand::FillRect(_) => {
                let rect = if let PaintCommand::FillRect(r) = cmd {
                    Some(*r)
                } else {
                    None
                };
                if rect.is_none() && circle.is_none() && polygon.len() < 3 {
                    return Err("missing full circle or polygon".into());
                }
                if let Some(r) = rect
                    && r != [0., 0., w as f64, h as f64]
                {
                    return Err("unsupported rectangle".into());
                }
                let coverage = |x: f64, y: f64| -> f64 {
                    if rect.is_some() {
                        return 1.;
                    }
                    let mut n = 0.;
                    for sy in 0..4 {
                        for sx in 0..4 {
                            let px = x + (sx as f64 + 0.5) / 4.;
                            let py = y + (sy as f64 + 0.5) / 4.;
                            let inside = if let Some(c) = circle {
                                (px - c[0]).hypot(py - c[1]) <= c[2]
                            } else {
                                winding(&polygon, px, py) != 0
                            };
                            if inside {
                                n += 1.;
                            }
                        }
                    }
                    n / 16.
                };
                if let Some((blur, offset, shadow_color)) = shadow {
                    if destination_in || rect.is_some() {
                        return Err("unsupported shadow composite".into());
                    }
                    let sigma = blur / 2.;
                    let radius = (sigma * 3.).ceil() as i32;
                    let weights: Vec<f64> = (-radius..=radius)
                        .map(|v| (-0.5 * (f64::from(v) / sigma).powi(2)).exp())
                        .collect();
                    let sum: f64 = weights.iter().sum();
                    let mut horizontal = vec![0.; w * h];
                    for y in 0..h {
                        for x in 0..w {
                            for (k, weight) in (-radius..=radius).zip(&weights) {
                                horizontal[y * w + x] +=
                                    coverage(x as f64 + f64::from(k), y as f64 - offset) * weight
                                        / sum;
                            }
                        }
                    }
                    for y in 0..h {
                        for x in 0..w {
                            let mut a = 0.;
                            for (k, weight) in (-radius..=radius).zip(&weights) {
                                let yy = y as i32 + k;
                                if (0..h as i32).contains(&yy) {
                                    a += horizontal[yy as usize * w + x] * weight / sum;
                                }
                            }
                            over(&mut pixels[y * w + x], shadow_color, a, alpha, false);
                        }
                    }
                }
                for y in 0..h {
                    for x in 0..w {
                        over(
                            &mut pixels[y * w + x],
                            fill.at(x as f64 + 0.5, y as f64 + 0.5),
                            coverage(x as f64, y as f64),
                            alpha,
                            destination_in,
                        );
                    }
                }
            }
            _ => return Err(format!("unsupported Canvas recipe operation: {cmd:?}")),
        }
    }
    Ok(RgbaImage {
        width: recipe.width,
        height: recipe.height,
        pixels: pixels
            .into_iter()
            .flat_map(|p| p.map(|v| (v.clamp(0., 1.) * 255.).round() as u8))
            .collect(),
    })
}

fn winding(points: &[[f64; 2]], x: f64, y: f64) -> i32 {
    let mut n = 0;
    for i in 0..points.len() {
        let a = points[i];
        let b = points[(i + 1) % points.len()];
        let cross = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
        if a[1] <= y && b[1] > y && cross > 0. {
            n += 1;
        } else if a[1] > y && b[1] <= y && cross < 0. {
            n -= 1;
        }
    }
    n
}
