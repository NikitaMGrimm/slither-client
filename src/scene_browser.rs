//! Thin browser ownership around the offline state and a Canvas2D anchor renderer.

use std::f64::consts::TAU;

use wasm_bindgen::prelude::*;
use web_sys::{HtmlCanvasElement, HtmlImageElement};

use crate::{
    canvas_browser::{CanvasFrame, draw_sprite},
    protocol::ElapsedHeader,
    state::ClientState,
};

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

/// An independent world; each received frame either commits fully or throws.
#[wasm_bindgen]
#[derive(Default)]
pub struct Scene {
    state: ClientState,
}

#[wasm_bindgen]
impl Scene {
    /// Create an empty scene with no setup or entities.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Apply one complete frame with explicit elapsed-header selection.
    pub fn apply_frame(&mut self, bytes: &[u8], elapsed_header: bool) -> Result<(), JsValue> {
        self.state
            .apply_frame(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
            )
            .map_err(error)?;
        Ok(())
    }

    /// Reset the world before a new independent session.
    pub fn reset(&mut self) {
        self.state = ClientState::default();
    }

    /// Return numeric diagnostics as JSON, without names or arbitrary packet data.
    pub fn snapshot(&self) -> String {
        let own = self
            .state
            .own_snake_id
            .and_then(|id| self.state.snakes.get(&id));
        let own_head = own.map_or_else(
            || "null".into(),
            |s| {
                format!(
                    "{{\"x\":{},\"y\":{},\"skin\":{}}}",
                    s.head.x, s.head.y, s.skin
                )
            },
        );
        format!(
            "{{\"frames\":{},\"commands\":{},\"ignored\":{},\"snakes\":{},\"foods\":{},\"protocol\":{},\"radius\":{},\"ownId\":{},\"ownHead\":{}}}",
            self.state.frames_applied,
            self.state.commands_applied,
            self.state.ignored_commands,
            self.state.snakes.len(),
            self.state.foods.len(),
            self.state
                .setup
                .as_ref()
                .map_or_else(|| "null".into(), |s| s.protocol.to_string()),
            self.state.setup.as_ref().map_or(0., |s| s.radius),
            self.state
                .own_snake_id
                .map_or_else(|| "null".into(), |id| id.to_string()),
            own_head,
        )
    }

    /// Draw received anchors using three caller-owned sprites and a loaded tile.
    /// Skins and food colors select `value % 3`; this is a small palette preview.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        camera_x: f64,
        camera_y: f64,
        zoom: f64,
    ) -> Result<(), JsValue> {
        let sprites = [palette_0, palette_1, palette_2];
        let frame = CanvasFrame::new(&target, &sprites, &background, camera_x, camera_y, zoom)?;
        let context = frame.context();
        if let Some(setup) = &self.state.setup {
            context.begin_path();
            context.arc(0., 0., setup.radius, 0., TAU)?;
            context.set_stroke_style_str("#647481");
            context.set_line_width(1. / zoom);
            context.stroke();
        }
        for food in self.state.foods.values() {
            if !frame.visible(food.position.x, food.position.y, food.size.max(1.)) {
                continue;
            }
            draw_sprite(
                context,
                &sprites[usize::from(food.color) % 3],
                food.position.x,
                food.position.y,
                food.size.max(1.),
            )?;
        }
        for snake in self.state.snakes.values() {
            let sprite = &sprites[usize::from(snake.skin) % 3];
            // Retain transmitted anchors; there is no local physics or extrapolation.
            for point in snake.body.iter().rev() {
                if frame.visible(point.x, point.y, snake.radius) {
                    draw_sprite(context, sprite, point.x, point.y, snake.radius)?;
                }
            }
            if !frame.visible(snake.head.x, snake.head.y, snake.radius) {
                continue;
            }
            draw_sprite(context, sprite, snake.head.x, snake.head.y, snake.radius)?;
            context.set_fill_style_str("#ffffff");
            for offset in [-0.5_f64, 0.5] {
                let angle = snake.heading + offset;
                context.begin_path();
                context.arc(
                    snake.head.x + angle.cos() * snake.radius * 0.65,
                    snake.head.y + angle.sin() * snake.radius * 0.65,
                    snake.radius * 0.18,
                    0.,
                    TAU,
                )?;
                context.fill();
            }
        }
        Ok(())
    }
}
