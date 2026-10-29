//! Copied player-choice ABI; browser storage and DOM access stay with captured glue.

use wasm_bindgen::prelude::*;

/// Bounded menu policy, independent of scene and session ownership.
#[wasm_bindgen]
pub struct MenuPreferences(crate::menu_preferences::MenuPreferences);

#[wasm_bindgen]
impl MenuPreferences {
    /// Restore a bounded private record or start with defaults.
    #[wasm_bindgen(constructor)]
    pub fn new(local: bool, saved: &str) -> Self {
        Self(crate::menu_preferences::MenuPreferences::restore(
            local, saved,
        ))
    }

    /// Copy and validate the existing nickname wire domain.
    pub fn set_nickname(&mut self, nickname: &str) -> Result<(), JsValue> {
        self.0.set_nickname(nickname).map_err(JsValue::from_str)
    }

    /// Validate and own a caller's selected run bytes before replacing the choice.
    pub fn select(&mut self, skin: f64, custom: &[u8]) -> Result<(), JsValue> {
        if !skin.is_finite() || skin.fract() != 0. || !(0. ..=255.).contains(&skin) {
            return Err(JsValue::from_str("Invalid menu skin"));
        }
        self.0.select(skin as u8, custom).map_err(JsValue::from_str)
    }

    /// Apply a closed native menu action.
    pub fn action(&mut self, action: &str) -> Result<(), JsValue> {
        self.0.action(action).map_err(JsValue::from_str)
    }

    /// Reset nickname and appearance, retaining the route boundary.
    pub fn reset(&mut self) {
        self.0.reset();
    }

    /// Return the canonical ASCII persistence record.
    pub fn serialize(&self) -> String {
        self.0.serialize()
    }

    /// Copy all output; no JS array aliases the Rust selection.
    pub fn view(&self) -> Result<JsValue, JsValue> {
        let view = self.0.view();
        let object = js_sys::Object::new();
        let controls = js_sys::Array::new();
        for control in view.controls {
            let item = js_sys::Object::new();
            for (key, value) in [
                ("action", JsValue::from_str(control.action)),
                ("label", JsValue::from_str(control.label)),
                ("enabled", JsValue::from_bool(control.enabled)),
            ] {
                set(&item, key, value)?;
            }
            controls.push(&js_sys::Object::freeze(&item));
        }
        for (key, value) in [
            ("nickname", JsValue::from_str(&view.nickname)),
            ("skin", JsValue::from(view.skin)),
            (
                "customSkin",
                js_sys::Uint8Array::from(view.custom_skin.as_slice()).into(),
            ),
            ("title", JsValue::from_str(&view.title)),
            ("detail", JsValue::from_str(&view.detail)),
            ("controls", js_sys::Object::freeze(&controls).into()),
        ] {
            set(&object, key, value)?;
        }
        Ok(js_sys::Object::freeze(&object).into())
    }
}

fn set(object: &js_sys::Object, key: &str, value: JsValue) -> Result<(), JsValue> {
    if js_sys::Reflect::set(object, &JsValue::from_str(key), &value)? {
        Ok(())
    } else {
        Err(JsValue::from_str("Cannot copy menu view"))
    }
}
