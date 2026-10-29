//! Copied loading view; browser construction and effects remain in JS.

use wasm_bindgen::{JsCast, prelude::*};

/// Project an existing status observation without retaining browser or admission state.
#[wasm_bindgen]
pub fn menu_loading_view(code: &str, owners_mounted: bool) -> Result<JsValue, JsValue> {
    let view = crate::menu_loading::project_menu_loading(code, owners_mounted)
        .map_err(JsValue::from_str)?;
    let object = js_sys::Object::create(&JsValue::NULL.unchecked_into());
    for (key, value) in [
        ("visible", JsValue::from_bool(view.visible)),
        ("busy", JsValue::from_bool(view.busy)),
        ("text", JsValue::from_str(view.text)),
    ] {
        if !js_sys::Reflect::set(&object, &JsValue::from_str(key), &value)? {
            return Err(JsValue::from_str("Cannot copy loading view"));
        }
    }
    Ok(js_sys::Object::freeze(&object).into())
}
