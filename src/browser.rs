//! Browser bindings without startup hooks, asset loaders, or socket APIs.

use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

use crate::{challenge, protocol};

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

#[wasm_bindgen]
pub fn encode_login(
    client_version: u16,
    password: &[u8],
    nickname: &str,
    skin: u8,
    custom_skin: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let password = password
        .try_into()
        .map_err(|_| error("password must contain exactly 20 bytes"))?;
    protocol::encode_login(client_version, password, nickname, skin, Some(custom_skin))
        .map_err(error)
}

#[wasm_bindgen]
pub fn solve_challenge(encoded: &[u8]) -> Result<Vec<u8>, JsValue> {
    challenge::solve_challenge(encoded).map_err(error)
}

/// Pack complete commands as repeated u32 big-endian lengths and command bytes.
#[wasm_bindgen]
pub fn decode_frame(bytes: &[u8], elapsed_header: bool) -> Result<Vec<u8>, JsValue> {
    let mode = if elapsed_header {
        protocol::ElapsedHeader::TwoBytes
    } else {
        protocol::ElapsedHeader::Absent
    };
    let frame = protocol::decode_frame(bytes, mode).map_err(error)?;
    let mut packed = Vec::new();
    for command in frame.commands {
        packed.extend((command.len() as u32).to_be_bytes());
        packed.extend(command);
    }
    Ok(packed)
}

#[wasm_bindgen]
pub fn setup_protocol_version(command: &[u8]) -> Result<u8, JsValue> {
    protocol::setup_protocol_version(command).map_err(error)
}

/// Draw caller-owned, ready sources into two rectangles with a one-pixel gutter.
/// The output canvas contents and drawing state are reset before drawing.
#[wasm_bindgen]
pub fn render_borrowed_assets(
    target: HtmlCanvasElement,
    generated: HtmlCanvasElement,
    downloaded: HtmlImageElement,
) -> Result<(), JsValue> {
    if target.width() < 3 || target.height() == 0 {
        return Err(error(
            "target canvas must be at least 3 pixels wide and 1 pixel high",
        ));
    }
    if target == generated {
        return Err(error("target and generated source canvases must differ"));
    }
    if generated.width() == 0 || generated.height() == 0 {
        return Err(error(
            "generated source canvas must have nonzero dimensions",
        ));
    }
    if !downloaded.complete() || downloaded.natural_width() == 0 || downloaded.natural_height() == 0
    {
        return Err(error(
            "downloaded source image must be complete with nonzero natural dimensions",
        ));
    }
    let context = target
        .get_context("2d")?
        .ok_or_else(|| error("target has no Canvas2D context"))?
        .dyn_into::<CanvasRenderingContext2d>()
        .map_err(|_| error("target context is not Canvas2D"))?;
    let width = f64::from(target.width());
    let height = f64::from(target.height());
    let left = f64::from((target.width() - 1) / 2);
    // Reset even an existing clip, filter, shadow, or transform so the output
    // rectangles and empty gutter do not depend on the caller's drawing state.
    target.set_width(target.width());
    context.draw_image_with_html_canvas_element_and_dw_and_dh(&generated, 0., 0., left, height)?;
    context.draw_image_with_html_image_element_and_dw_and_dh(
        &downloaded,
        left + 1.,
        0.,
        width - left - 1.,
        height,
    )
}
