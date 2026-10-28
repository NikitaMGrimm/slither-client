//! Copied start-page view ABI; no DOM access, session mutation or startup hook.

use wasm_bindgen::prelude::*;

/// Project existing committed observations into a frozen plain view.
#[wasm_bindgen]
pub fn start_page_view(status: &str, locked: bool, playing: bool) -> Result<JsValue, JsValue> {
    let view = crate::start_page::project_start_page(status, locked, playing)
        .map_err(JsValue::from_str)?;
    let object = js_sys::Object::new();
    for (key, value) in [
        ("visible", JsValue::from_bool(view.visible)),
        ("busy", JsValue::from_bool(view.busy)),
        ("disabled", JsValue::from_bool(view.disabled)),
        ("status", JsValue::from_str(view.status)),
        ("button", JsValue::from_str(view.button)),
    ] {
        if !js_sys::Reflect::set(&object, &JsValue::from_str(key), &value)? {
            return Err(JsValue::from_str("Cannot copy start page view"));
        }
    }
    Ok(js_sys::Object::freeze(&object).into())
}
