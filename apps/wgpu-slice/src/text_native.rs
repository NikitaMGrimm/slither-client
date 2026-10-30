//! Windows adapter: no bundled fonts, desktop APIs or window creation.
use super::{Raster, Weight};
use crate::{Result, materials::RgbaImage};
use fontdue::{Font, FontSettings};

#[derive(Default)]
pub struct Rasterizer {
    regular: Option<Arial>,
    bold: Option<Arial>,
}
struct Arial {
    font: Font,
    em_ascent: f64,
}
impl Rasterizer {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn rasterize(
        &mut self,
        text: &str,
        px: f64,
        weight: Weight,
        color: [u8; 3],
    ) -> Result<Raster> {
        let slot = match weight {
            Weight::Normal => &mut self.regular,
            Weight::Bold => &mut self.bold,
        };
        if slot.is_none() {
            let file = match weight {
                Weight::Normal => "arial.ttf",
                Weight::Bold => "arialbd.ttf",
            };
            let bytes = std::fs::read(std::path::Path::new("C:/Windows/Fonts").join(file))
                .map_err(|e| format!("system Arial ({file}): {e}"))?;
            let face = ttf_parser::Face::parse(&bytes, 0)
                .map_err(|e| format!("system Arial metrics: {e}"))?;
            let ascent = f64::from(
                face.typographic_ascender()
                    .ok_or("Arial typographic ascent")?,
            );
            let descent = f64::from(
                face.typographic_descender()
                    .ok_or("Arial typographic descent")?,
            );
            if ascent <= descent {
                return Err("Arial typographic metrics".into());
            }
            let em_ascent = ascent / (ascent - descent);
            *slot = Some(Arial {
                font: Font::from_bytes(bytes, FontSettings::default())
                    .map_err(|e| format!("system Arial: {e}"))?,
                em_ascent,
            });
        }
        let arial = slot.as_ref().unwrap();
        let font = &arial.font;
        // Supersampling retains fractional advances and kerning without ClearType
        // color fringes in the renderer's transparent premultiplied textures.
        const SAMPLE: usize = 4;
        let size = px as f32 * SAMPLE as f32;
        let mut glyphs = Vec::new();
        let mut pen = 0_f32;
        let mut previous = None;
        let mut bounds = [0_i32; 4];
        for c in text.chars().map(|c| {
            if matches!(c, '\t' | '\n' | '\r' | '\u{000c}') {
                ' '
            } else {
                c
            }
        }) {
            if let Some(p) = previous {
                pen += font.horizontal_kern(p, c, size).unwrap_or(0.);
            }
            let m = font.metrics(c, size);
            let x = pen.round() as i32 + m.xmin;
            let y = -m.ymin - m.height as i32;
            bounds[0] = bounds[0].min(x);
            bounds[1] = bounds[1].min(y);
            bounds[2] = bounds[2].max(x + m.width as i32);
            bounds[3] = bounds[3].max(y + m.height as i32);
            glyphs.push((x, y, m.width, m.height, c));
            pen += m.advance_width;
            previous = Some(c);
        }
        let left = (f64::from(bounds[0]) / SAMPLE as f64).floor() as i32 - 1;
        let top = (f64::from(bounds[1]) / SAMPLE as f64).floor() as i32 - 1;
        let width =
            ((f64::from(bounds[2]) / SAMPLE as f64).ceil() as i32 - left + 1).max(1) as usize;
        let height =
            ((f64::from(bounds[3]) / SAMPLE as f64).ceil() as i32 - top + 1).max(1) as usize;
        if width > 8192 || height > 512 {
            return Err("text raster extent budget".into());
        }
        let mut mask = vec![0_u8; width * height * SAMPLE * SAMPLE];
        let stride = width * SAMPLE;
        for (x, y, w, h, c) in glyphs {
            let (_, coverage) = font.rasterize(c, size);
            let x = (x - left * SAMPLE as i32) as usize;
            let y = (y - top * SAMPLE as i32) as usize;
            for row in 0..h {
                for col in 0..w {
                    let dst = &mut mask[(y + row) * stride + x + col];
                    let a = u32::from(coverage[row * w + col]);
                    *dst = (a + u32::from(*dst) * (255 - a) / 255) as u8;
                }
            }
        }
        let mut pixels = vec![0; width * height * 4];
        for y in 0..height {
            for x in 0..width {
                let mut sum = 0_u32;
                for dy in 0..SAMPLE {
                    for dx in 0..SAMPLE {
                        sum += u32::from(mask[(y * SAMPLE + dy) * stride + x * SAMPLE + dx]);
                    }
                }
                let a = ((sum + 8) / 16) as u8;
                let dst = &mut pixels[(y * width + x) * 4..][..4];
                for i in 0..3 {
                    dst[i] = ((u16::from(color[i]) * u16::from(a) + 127) / 255) as u8;
                }
                dst[3] = a;
            }
        }
        Ok(Raster {
            image: RgbaImage {
                width: width as u32,
                height: height as u32,
                pixels,
            },
            offset: [f64::from(left), f64::from(top)],
            advance: f64::from(pen) / SAMPLE as f64,
            // Canvas middle uses the em square, not hhea's taller line box.
            // Normalize OS/2 typography to one em, at the browser's 1/64px grid.
            middle: (px * arial.em_ascent * 64.).round() / 64. - px / 2.,
        })
    }
}
