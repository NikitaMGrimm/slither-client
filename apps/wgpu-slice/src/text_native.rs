//! Windows adapter: no bundled fonts, desktop APIs or window creation.
use super::{Raster, Weight};
use crate::{Result, materials::RgbaImage};
use fontdue::{Font, FontSettings};

#[derive(Default)]
pub struct Rasterizer {
    regular: Option<Arial>,
    bold: Option<Arial>,
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn ascii_space_advances_match_canvas_without_pair_kerning() {
        let mut rasterizer = Rasterizer::new();
        // Authored strings, absolute advances measured in 15px Arial Canvas.
        for (text, expected) in [("A\u{b}V", 24.1772), ("A V A V A V A V A V A V", 165.9009)] {
            let raster = rasterizer
                .rasterize(text, 15., Weight::Normal, [255; 3])
                .unwrap();
            assert!(
                (raster.advance - expected).abs() < 0.05,
                "{text:?}: {} px, Canvas {expected} px",
                raster.advance
            );
        }
    }
    #[test]
    fn nbsp_retains_pair_kerning() {
        let raster = Rasterizer::new()
            .rasterize("A\u{a0}V", 15., Weight::Normal, [255; 3])
            .unwrap();
        assert!(
            (raster.advance - 23.3496).abs() < 0.05,
            "{}",
            raster.advance
        );
    }
    #[test]
    fn soft_hyphen_is_invisible_and_vertical_tab_is_a_space() {
        let mut rasterizer = Rasterizer::new();
        let mut raster = |s: &str| {
            rasterizer
                .rasterize(s, 15., Weight::Normal, [255; 3])
                .unwrap()
        };
        let soft = raster("A\u{ad}V");
        let invisible = raster("A\u{1d}V");
        assert_eq!(soft.advance, invisible.advance);
        assert_eq!(soft.image.pixels, invisible.image.pixels);
        let tab = raster("A\u{b}V");
        let space = raster("A V");
        assert_eq!(tab.advance, space.advance);
        assert_eq!(tab.image.pixels, space.image.pixels);
        let soft = raster("\u{ad}");
        assert_eq!(soft.advance, 0.);
        assert!(soft.image.pixels.iter().all(|p| *p == 0));
    }
    #[test]
    fn c0_and_c1_rasters_use_canvas_missing_glyph_or_whitespace() {
        let mut rasterizer = Rasterizer::new();
        for weight in [Weight::Normal, Weight::Bold] {
            for px in [15., 30.] {
                for code in (0..=31).chain(128..=159) {
                    let c = char::from_u32(code).unwrap().to_string();
                    // Authored oracle: Chromium uses Arial's missing glyph for
                    // these controls, except ASCII whitespace and U+001D.
                    let equivalent = match code {
                        9..=13 => " ",
                        29 => "",
                        _ => "\u{ffff}",
                    };
                    for (actual, expected) in [
                        (c.clone(), equivalent.to_owned()),
                        (format!("A{c}V"), format!("A{equivalent}V")),
                    ] {
                        // U+001D is a shaping boundary, covered above separately.
                        if code == 29 && actual.len() > 1 {
                            continue;
                        }
                        let actual = rasterizer.rasterize(&actual, px, weight, [255; 3]).unwrap();
                        let expected = rasterizer
                            .rasterize(&expected, px, weight, [255; 3])
                            .unwrap();
                        assert_eq!(
                            actual.advance, expected.advance,
                            "U+{code:04X}, {px}, {weight:?}"
                        );
                        assert_eq!(actual.offset, expected.offset);
                        assert_eq!(actual.image.width, expected.image.width);
                        assert_eq!(actual.image.height, expected.image.height);
                        assert_eq!(
                            actual.image.pixels, expected.image.pixels,
                            "U+{code:04X}, {px}, {weight:?}"
                        );
                        if equivalent == "\u{ffff}" {
                            assert!(actual.image.pixels.iter().any(|p| *p != 0));
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn del_raster_is_blank_with_canvas_fallback_advance() {
        let mut rasterizer = Rasterizer::new();
        for (px, regular, bold) in [
            (8., 4., 4.),
            (12., 6., 7.),
            (12.5, 7., 8.),
            (15., 8., 9.),
            (17.9, 9., 10.),
            (18., 9., 9.),
            (30., 15., 15.),
        ] {
            for (weight, advance) in [(Weight::Normal, regular), (Weight::Bold, bold)] {
                let del = rasterizer
                    .rasterize("\u{7f}", px, weight, [255; 3])
                    .unwrap();
                assert_eq!(del.advance, advance);
                assert!(del.image.pixels.iter().all(|p| *p == 0));
                let av = rasterizer.rasterize("AV", px, weight, [255; 3]).unwrap();
                let padded = rasterizer
                    .rasterize("\u{7f}AV\u{7f}", px, weight, [255; 3])
                    .unwrap();
                assert!((padded.advance - av.advance - 2. * advance).abs() < 0.00001);
            }
        }
    }
}
struct Arial {
    font: Font,
    em_ascent: f64,
}
fn canvas_character(c: char) -> Option<char> {
    match c {
        '\u{9}'..='\u{d}' => Some(' '),
        '\u{1d}' | '\u{ad}' => None,
        // fontdue merges legacy cmaps, where these codes can name unrelated
        // accented glyphs or the null glyph. Canvas uses Arial's .notdef box.
        '\u{0}'..='\u{1f}' | '\u{80}'..='\u{9f}' => Some('\u{ffff}'),
        _ => Some(c),
    }
}
fn del_advance(px: f64, weight: Weight) -> f32 {
    // Windows Chromium's blank SimSun fallback has half-em advances. At these
    // small sizes its hinted widths snap to pixels, plus one for synthetic bold.
    if (12. ..18.).contains(&px) {
        ((px.round() / 2.).round() + f64::from(weight == Weight::Bold)) as f32
    } else {
        (px / 2.) as f32
    }
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
        for c in text.chars() {
            if c == '\u{7f}' {
                pen += del_advance(px, weight) * SAMPLE as f32;
                previous = None;
                continue;
            }
            let Some(c) = canvas_character(c) else {
                // Canvas suppresses these glyphs but keeps a shaping boundary:
                // adjacent letters do not acquire kerning across the control.
                previous = None;
                continue;
            };
            // Canvas breaks kerning at ASCII spaces, including normalized
            // whitespace. NBSP keeps its ordinary glyph-pair behavior.
            if let Some(p) = previous
                && p != ' '
                && c != ' '
            {
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
