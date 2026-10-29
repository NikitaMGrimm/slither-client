//! Thin pure-Wasm projections for ready cached accessory capture.

use wasm_bindgen::prelude::*;

/// Copy the bounded persisted selection as an ID, or the no-selection sentinel.
#[wasm_bindgen]
pub fn stock_accessory_id(raw: Option<String>, count: u32) -> Result<i32, JsValue> {
    crate::presentation::stock_accessory_id(raw.as_deref(), count)
        .map(|id| id.map_or(-1, |id| id as i32))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Resolve appearance-owned accessory forward distance using the Rust skin policy.
#[wasm_bindgen]
pub fn stock_accessory_forward(skin: u8, custom: &[u8]) -> Result<f64, JsValue> {
    crate::presentation::stock_accessory_forward(skin, custom)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
