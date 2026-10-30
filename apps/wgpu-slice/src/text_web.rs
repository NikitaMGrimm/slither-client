//! Browser adapter: actual Canvas glyph rasterization, no DOM or scheduling.
use super::{FONT_FAMILY, Raster, Weight};
use crate::{Result, materials::RgbaImage};
use wasm_bindgen::JsCast;
use web_sys::{OffscreenCanvas, OffscreenCanvasRenderingContext2d};

#[derive(Default)]
pub struct Rasterizer;
impl Rasterizer {
    pub fn new() -> Self {
        Self
    }
    pub fn rasterize(
        &mut self,
        text: &str,
        px: f64,
        weight: Weight,
        color: [u8; 3],
    ) -> Result<Raster> {
        let error = |e| format!("Canvas text: {e:?}");
        let canvas = OffscreenCanvas::new(1, 1).map_err(error)?;
        let context: OffscreenCanvasRenderingContext2d = canvas
            .get_context("2d")
            .map_err(error)?
            .ok_or("Canvas text context unavailable")?
            .dyn_into()
            .map_err(|e: js_sys::Object| error(e.into()))?;
        let font = format!(
            "{} {px}px {FONT_FAMILY}",
            match weight {
                Weight::Normal => "normal",
                Weight::Bold => "bold",
            }
        );
        context.set_font(&font);
        let metrics = context.measure_text(text).map_err(error)?;
        let advance = metrics.width();
        let left = (-metrics.actual_bounding_box_left()).floor() - 1.;
        let top = (-metrics.actual_bounding_box_ascent()).floor() - 1.;
        let width = (metrics.actual_bounding_box_right().ceil() - left + 1.).max(1.);
        let height = (metrics.actual_bounding_box_descent().ceil() - top + 1.).max(1.);
        context.set_text_baseline("middle");
        let middle = metrics.actual_bounding_box_ascent()
            - context
                .measure_text(text)
                .map_err(error)?
                .actual_bounding_box_ascent();
        if ![width, height, left, top, advance, middle]
            .into_iter()
            .all(f64::is_finite)
            || width > 8192.
            || height > 512.
        {
            return Err("text raster extent budget".into());
        }
        canvas.set_width(width as u32);
        canvas.set_height(height as u32);
        context.set_font(&font);
        context.set_text_baseline("alphabetic");
        let [r, g, b] = color;
        context.set_fill_style_str(&format!("#{r:02x}{g:02x}{b:02x}"));
        context.fill_text(text, -left, -top).map_err(error)?;
        let mut pixels = context
            .get_image_data(0., 0., width, height)
            .map_err(error)?
            .data()
            .0;
        // Canvas readback is straight RGBA; the shared texture convention is
        // encoded-sRGB premultiplied RGBA, including anti-aliased edge coverage.
        for p in pixels.as_chunks_mut::<4>().0 {
            for i in 0..3 {
                p[i] = ((u16::from(p[i]) * u16::from(p[3]) + 127) / 255) as u8;
            }
        }
        Ok(Raster {
            image: RgbaImage {
                width: width as u32,
                height: height as u32,
                pixels,
            },
            offset: [left, top],
            advance,
            middle,
        })
    }
}
