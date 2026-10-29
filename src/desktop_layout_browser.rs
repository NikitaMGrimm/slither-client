//! Fresh copied viewport policy output; native dimensions and DOM remain JS-owned.

use wasm_bindgen::prelude::*;

/// Project numeric viewport dimensions without reading a scene, window or Canvas.
#[wasm_bindgen]
pub fn desktop_backing_size(width: f64, height: f64) -> Result<JsValue, JsValue> {
    let size = crate::desktop_layout::desktop_backing_size(width, height)
        .map_err(|message| JsValue::from(js_sys::Error::new(message)))?;
    let object = js_sys::Object::new();
    for (key, value) in [("width", size.width), ("height", size.height)] {
        if !js_sys::Reflect::set(&object, &JsValue::from_str(key), &JsValue::from(value))? {
            return Err(js_sys::Error::new("Cannot copy desktop backing size").into());
        }
    }
    Ok(js_sys::Object::freeze(&object).into())
}
