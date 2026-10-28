//! Browser data conversion for the pure Rust end-screen projection.

use js_sys::{Object, Reflect};
use wasm_bindgen::prelude::*;

use crate::presentation::{EndScreenInput, EndScreenPhase, EndScreenState};

/// End-screen projection with no socket, timer, DOM or scene ownership.
#[wasm_bindgen]
#[derive(Default)]
pub struct EndScreenProjector {
    inner: EndScreenState,
}

#[wasm_bindgen]
impl EndScreenProjector {
    /// Start with no accepted result.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Copy the committed session and final-score observation into plain UI data.
    pub fn project(
        &mut self,
        phase: &str,
        playing: bool,
        life_ended: bool,
        local_replay: bool,
        final_score: Option<f64>,
    ) -> Result<JsValue, JsValue> {
        let phase = match phase {
            "ready" | "opening" | "challenge" | "setup" | "playing" => EndScreenPhase::Active,
            "dead" => EndScreenPhase::Dead,
            "victory" => EndScreenPhase::Victory,
            "failed" | "disconnected" => EndScreenPhase::Closed,
            _ => return Err(JsValue::from_str("unknown end-screen session phase")),
        };
        let mut staged = self.inner.clone();
        let view = staged
            .project(EndScreenInput {
                phase,
                playing,
                life_ended,
                local_replay,
                final_score,
            })
            .map_err(JsValue::from_str)?;
        let result = Object::new();
        for (name, value) in [
            ("schema", JsValue::from(1)),
            ("visible", JsValue::from(view.visible)),
            ("title", JsValue::from(view.title)),
            ("scoreText", JsValue::from(view.score_text)),
            ("statusText", JsValue::from(view.status_text)),
        ] {
            if !Reflect::set(&result, &JsValue::from(name), &value)? {
                return Err(JsValue::from_str("could not construct end-screen view"));
            }
        }
        self.inner = staged;
        Ok(result.into())
    }
}
