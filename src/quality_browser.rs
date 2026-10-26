//! Standalone desktop quality bindings; no renderer or animation startup.

use wasm_bindgen::prelude::*;

use crate::{
    presentation::{QualityMode, QualityState},
    presentation_browser::AnimationStep,
};

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn mode(requested: f64) -> Result<QualityMode, JsValue> {
    match requested {
        0. => Ok(QualityMode::Low),
        1. => Ok(QualityMode::High),
        _ => Err(error("requested quality must be 0 or 1")),
    }
}

fn draw_count(value: f64) -> Result<u32, JsValue> {
    if !value.is_finite() || value.fract() != 0. || !(0. ..=f64::from(u32::MAX)).contains(&value) {
        return Err(error("draw count must be an unsigned 32-bit integer"));
    }
    Ok(value as u32)
}

/// Caller-owned desktop quality state, independent of renderer/session objects.
#[wasm_bindgen]
pub struct DesktopQuality {
    inner: QualityState,
}

impl DesktopQuality {
    pub(crate) fn applied(&self) -> crate::presentation::QualitySnapshot {
        self.inner.snapshot()
    }
}

#[wasm_bindgen]
impl DesktopQuality {
    /// Store exactly 0 (low) or 1 (high), with an explicit statistics start time.
    /// Runtime quality starts high until connection/preview initialization.
    #[wasm_bindgen(constructor)]
    pub fn new(requested: f64, start_ms: f64) -> Result<DesktopQuality, JsValue> {
        Ok(Self {
            inner: QualityState::new(mode(requested)?, start_ms).map_err(error)?,
        })
    }

    /// Store exactly 0 or 1 without changing applied runtime quality.
    pub fn set_requested_mode(&mut self, requested: f64) -> Result<(), JsValue> {
        self.inner.set_requested_mode(mode(requested)?);
        Ok(())
    }

    /// Apply the stored preference and reset fallback history on connection open.
    pub fn begin_connection(&mut self) {
        self.inner.begin_connection();
    }

    /// Initialize skin preview in high quality regardless of the preference.
    pub fn begin_skin_preview(&mut self) {
        self.inner.begin_skin_preview();
    }

    /// Borrow a step for interpolation before this update's statistics and draw.
    /// The caller frees the step after all consumers have advanced.
    pub fn advance(&mut self, step: &AnimationStep, playing: bool) -> Result<(), JsValue> {
        self.inner.advance(step.inner, playing).map_err(error)
    }

    /// Consume at most one due statistics interval, using an exact u32 draw count.
    /// A true result tells the caller to reset its counter before the next draw.
    pub fn update_statistics(
        &mut self,
        now_ms: f64,
        draws: f64,
        playing: bool,
    ) -> Result<bool, JsValue> {
        self.inner
            .update_statistics(now_ms, draw_count(draws)?, playing)
            .map_err(error)
    }

    /// Copied numeric diagnostics; applied quality can differ from the preference.
    pub fn snapshot(&self) -> String {
        let state = self.inner.snapshot();
        let requested = match state.requested {
            QualityMode::Low => 0,
            QualityMode::High => 1,
        };
        format!(
            "{{\"requested\":{},\"highQuality\":{},\"qualityBlend\":{},\"qualityScale\":{},\"lowFpsCounter\":{},\"lastStatisticsMs\":{}}}",
            requested,
            state.high_quality,
            state.quality_blend,
            state.quality_scale,
            state.low_fps_counter,
            self.inner.last_statistics_ms()
        )
    }
}
