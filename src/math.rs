//! Match the browser's trigonometric rounding at the Wasm presentation boundary.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = Math, js_name = cos)]
    fn host_cos(value: f64) -> f64;
    #[wasm_bindgen(js_namespace = Math, js_name = sin)]
    fn host_sin(value: f64) -> f64;
}

pub(crate) fn cos(value: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        host_cos(value)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        value.cos()
    }
}

pub(crate) fn sin(value: f64) -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        host_sin(value)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        value.sin()
    }
}
