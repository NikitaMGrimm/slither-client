//! Shared validation and world-space Canvas2D setup for browser scene renderers.

use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{CanvasPattern, CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

use crate::presentation::BackgroundPlan;

fn error(message: &str) -> JsValue {
    JsValue::from_str(message)
}

pub(crate) fn validate_background_image(image: &HtmlImageElement) -> Result<(), JsValue> {
    if !image.complete() || image.natural_width() == 0 || image.natural_height() == 0 {
        return Err(error("scene background must be a loaded image"));
    }
    Ok(())
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

/// Native capabilities acquired before any planned frame clears the target.
pub(crate) struct CanvasPreflight {
    context: CanvasRenderingContext2d,
    pattern: CanvasPattern,
    width: u32,
    height: u32,
    camera_x: f64,
    camera_y: f64,
    zoom: f64,
}

#[allow(clippy::too_many_arguments)]
fn validate(
    target: &HtmlCanvasElement,
    sprites: &[HtmlCanvasElement; 3],
    background: &HtmlImageElement,
    width: u32,
    height: u32,
    camera_x: f64,
    camera_y: f64,
    zoom: f64,
) -> Result<(), JsValue> {
    if width == 0 || height == 0 || width > 4096 || height > 4096 {
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
    validate_background_image(background)?;
    Ok(())
}

fn context(target: &HtmlCanvasElement) -> Result<CanvasRenderingContext2d, JsValue> {
    target
        .get_context("2d")?
        .ok_or_else(|| error("no Canvas2D context"))?
        .dyn_into::<CanvasRenderingContext2d>()
        .map_err(|_| error("not a Canvas2D context"))
}

impl CanvasPreflight {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        target: &HtmlCanvasElement,
        sprites: &[HtmlCanvasElement; 3],
        background: &HtmlImageElement,
        width: u32,
        height: u32,
        camera_x: f64,
        camera_y: f64,
        zoom: f64,
        backdrop: Option<&HtmlImageElement>,
    ) -> Result<Self, JsValue> {
        validate(
            target, sprites, background, width, height, camera_x, camera_y, zoom,
        )?;
        if let Some(backdrop) = backdrop {
            validate_background_image(backdrop)?;
        }
        let context = context(target)?;
        let pattern = context
            .create_pattern_with_html_image_element(background, "repeat")?
            .ok_or_else(|| error("could not create background pattern"))?;
        Ok(Self {
            context,
            pattern,
            width,
            height,
            camera_x,
            camera_y,
            zoom,
        })
    }

    pub(crate) fn begin(
        self,
        target: &HtmlCanvasElement,
        plan: &BackgroundPlan,
        backdrop: Option<&HtmlImageElement>,
    ) -> Result<CanvasFrame, JsValue> {
        if target.width() != self.width || target.height() != self.height {
            target.set_width(self.width);
            target.set_height(self.height);
        } else {
            // Each draw must also remove inherited clips, transforms and filters.
            target.set_width(self.width);
        }
        let width = f64::from(self.width);
        let height = f64::from(self.height);
        self.context.save();
        let frame = CanvasFrame {
            context: self.context,
            width,
            height,
            camera_x: self.camera_x,
            camera_y: self.camera_y,
            zoom: self.zoom,
        };
        frame.paint_background_plan(&self.pattern, plan, backdrop)?;
        Ok(frame)
    }
}

impl CanvasFrame {
    fn paint_background_plan(
        &self,
        pattern: &CanvasPattern,
        plan: &BackgroundPlan,
        backdrop: Option<&HtmlImageElement>,
    ) -> Result<(), JsValue> {
        let context = &self.context;
        let [red, green, blue] = plan.clear.color;
        context.set_fill_style_str(&format!("#{red:02x}{green:02x}{blue:02x}"));
        context.set_global_alpha(plan.clear.alpha);
        let [x, y, width, height] = plan.clear.rect;
        context.fill_rect(x, y, width, height);
        if let Some(image) = plan.image {
            let source = backdrop.ok_or_else(|| error("background backdrop source required"))?;
            let [sx, sy, sw, sh] = image.source;
            let [dx, dy, dw, dh] = image.destination;
            context.set_global_alpha(image.alpha);
            context.draw_image_with_html_image_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
                source, sx, sy, sw, sh, dx, dy, dw, dh,
            )?;
        }
        if let Some(layer) = plan.pattern {
            context.save();
            let result = (|| {
                context.translate(layer.center.x, layer.center.y)?;
                context.scale(layer.zoom, layer.zoom)?;
                context.translate(layer.translation.x, layer.translation.y)?;
                context.set_fill_style_canvas_pattern(pattern);
                context.set_global_alpha(layer.alpha);
                let [x, y, width, height] = layer.fill;
                context.fill_rect(x, y, width, height);
                Ok::<_, JsValue>(())
            })();
            context.restore();
            result?;
        }
        context.set_global_alpha(1.);
        // Background phase must not change entity placement or culling coordinates.
        context.translate(
            self.width / 2. - self.camera_x * self.zoom,
            self.height / 2. - self.camera_y * self.zoom,
        )?;
        context.scale(self.zoom, self.zoom)?;
        Ok(())
    }

    /// Reset the target, paint the borrowed tile, and leave world coordinates active.
    pub(crate) fn new(
        target: &HtmlCanvasElement,
        sprites: &[HtmlCanvasElement; 3],
        background: &HtmlImageElement,
        camera_x: f64,
        camera_y: f64,
        zoom: f64,
    ) -> Result<Self, JsValue> {
        validate(
            target,
            sprites,
            background,
            target.width(),
            target.height(),
            camera_x,
            camera_y,
            zoom,
        )?;
        let context = context(target)?;
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
        frame.paint_background(&pattern)?;
        Ok(frame)
    }

    fn paint_background(&self, pattern: &CanvasPattern) -> Result<(), JsValue> {
        self.context.translate(
            self.width / 2. - self.camera_x * self.zoom,
            self.height / 2. - self.camera_y * self.zoom,
        )?;
        self.context.scale(self.zoom, self.zoom)?;
        self.context.set_fill_style_canvas_pattern(pattern);
        let [left, top, _, _] = self.visible_bounds();
        self.context
            .fill_rect(left, top, self.width / self.zoom, self.height / self.zoom);
        Ok(())
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
