//! Shared validation and world-space Canvas2D setup for browser scene renderers.

use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

fn error(message: &str) -> JsValue {
    JsValue::from_str(message)
}

/// A validated frame whose world-space save is restored when the frame drops.
pub(crate) struct CanvasFrame {
    context: CanvasRenderingContext2d,
    width: f64,
    height: f64,
    camera_x: f64,
    camera_y: f64,
    zoom: f64,
}

impl CanvasFrame {
    /// Reset the target, paint the borrowed tile, and leave world coordinates active.
    pub(crate) fn new(
        target: &HtmlCanvasElement,
        sprites: &[HtmlCanvasElement; 3],
        background: &HtmlImageElement,
        camera_x: f64,
        camera_y: f64,
        zoom: f64,
    ) -> Result<Self, JsValue> {
        if target.width() == 0
            || target.height() == 0
            || target.width() > 4096
            || target.height() > 4096
        {
            return Err(error("scene target dimensions must be in 1..=4096"));
        }
        if !camera_x.is_finite()
            || !camera_y.is_finite()
            || camera_x.abs() > 16_777_215.
            || camera_y.abs() > 16_777_215.
            || !zoom.is_finite()
            || !(0.05..=8.).contains(&zoom)
        {
            return Err(error("invalid scene camera or zoom"));
        }
        if sprites
            .iter()
            .any(|s| s == target || s.width() == 0 || s.height() == 0)
        {
            return Err(error(
                "scene sprites must be nonempty source canvases distinct from target",
            ));
        }
        if !background.complete()
            || background.natural_width() == 0
            || background.natural_height() == 0
        {
            return Err(error("scene background must be a loaded image"));
        }
        let context = target
            .get_context("2d")?
            .ok_or_else(|| error("no Canvas2D context"))?
            .dyn_into::<CanvasRenderingContext2d>()
            .map_err(|_| error("not a Canvas2D context"))?;
        // Resizing also clears hostile inherited clips, transforms and filters.
        target.set_width(target.width());
        let width = f64::from(target.width());
        let height = f64::from(target.height());
        context.set_fill_style_str("#111820");
        context.fill_rect(0., 0., width, height);
        let pattern = context
            .create_pattern_with_html_image_element(background, "repeat")?
            .ok_or_else(|| error("could not create background pattern"))?;
        context.save();
        let frame = Self {
            context,
            width,
            height,
            camera_x,
            camera_y,
            zoom,
        };
        // A world-locked tile gives a camera reference without loading assets.
        frame
            .context
            .translate(width / 2. - camera_x * zoom, height / 2. - camera_y * zoom)?;
        frame.context.scale(zoom, zoom)?;
        frame.context.set_fill_style_canvas_pattern(&pattern);
        let [left, top, _, _] = frame.visible_bounds();
        frame
            .context
            .fill_rect(left, top, width / zoom, height / zoom);
        Ok(frame)
    }

    pub(crate) fn context(&self) -> &CanvasRenderingContext2d {
        &self.context
    }

    /// World-space left, top, right and bottom edges, before radius padding.
    pub(crate) fn visible_bounds(&self) -> [f64; 4] {
        [
            self.camera_x - self.width / (2. * self.zoom),
            self.camera_y - self.height / (2. * self.zoom),
            self.camera_x + self.width / (2. * self.zoom),
            self.camera_y + self.height / (2. * self.zoom),
        ]
    }

    /// Retain the received-anchor renderer's centered culling arithmetic.
    pub(crate) fn visible(&self, x: f64, y: f64, radius: f64) -> bool {
        (x - self.camera_x).abs() <= self.width / (2. * self.zoom) + radius
            && (y - self.camera_y).abs() <= self.height / (2. * self.zoom) + radius
    }
}

impl Drop for CanvasFrame {
    fn drop(&mut self) {
        self.context.restore();
    }
}

pub(crate) fn draw_sprite(
    context: &CanvasRenderingContext2d,
    sprite: &HtmlCanvasElement,
    x: f64,
    y: f64,
    radius: f64,
) -> Result<(), JsValue> {
    context.draw_image_with_html_canvas_element_and_dw_and_dh(
        sprite,
        x - radius,
        y - radius,
        radius * 2.,
        radius * 2.,
    )
}
