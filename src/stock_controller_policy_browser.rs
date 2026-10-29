//! Copied Wasm boundary for browser-free stock controller policy.
use crate::stock_controller_policy::{self as policy, ControllerError, ErrorKind};
use wasm_bindgen::prelude::*;
fn error(e: ControllerError) -> JsValue {
    match e.0 {
        ErrorKind::Type => js_sys::TypeError::new(e.1).into(),
        ErrorKind::Range => js_sys::RangeError::new(e.1).into(),
        ErrorKind::State => js_sys::Error::new(e.1).into(),
    }
}
/// Controller scalar state; owns no JS callback, resource, scene or clock.
#[wasm_bindgen]
pub struct StockControllerPolicy {
    inner: policy::StockControllerPolicy,
}
#[wasm_bindgen]
impl StockControllerPolicy {
    /// Allocate one domain owner with no native resources.
    #[wasm_bindgen(constructor)]
    pub fn new(width: f64, height: f64) -> Result<StockControllerPolicy, JsValue> {
        Ok(Self {
            inner: policy::StockControllerPolicy::new(width, height).map_err(error)?,
        })
    }
    /// Validate a backing dimension before controller admission.
    pub fn validate_size(value: f64) -> Result<f64, JsValue> {
        policy::backing_size(value).map_err(error)
    }
    /// Validate a numeric time without coercion.
    pub fn validate_time(value: f64) -> Result<(), JsValue> {
        policy::finite(value, false).map_err(error)
    }
    /// Validate a numeric legacy gaze without coercion.
    pub fn validate_gaze(value: f64) -> Result<(), JsValue> {
        policy::finite(value, true).map_err(error)
    }
    /// Numeric diagnostics tuple; JS copies public fields after this borrow returns.
    pub fn snapshot(&self) -> Vec<f64> {
        let v = self.inner.view();
        vec![
            v.draws,
            v.draws_since_statistics,
            v.width,
            v.height,
            if v.stopped { 1. } else { 0. },
        ]
    }
    /// Next operation-specific boundary.
    pub fn stage(&self) -> u8 {
        self.inner.stage() as u8
    }
    /// Current terminal state for native operation admission.
    pub fn is_stopped(&self) -> bool {
        self.inner.view().stopped
    }
    /// Select the already supplied native control callback.
    pub fn uses_control(&self) -> bool {
        self.inner.uses_control()
    }
    /// Capture shared quality/statistics playing.
    pub fn playing(&self) -> bool {
        self.inner.playing()
    }
    /// Current next-render width.
    pub fn target_width(&self) -> f64 {
        self.inner.target().0
    }
    /// Current next-render height.
    pub fn target_height(&self) -> f64 {
        self.inner.target().1
    }
    /// Count observed immediately before native statistics.
    pub fn statistics_count(&self) -> f64 {
        self.inner.view().draws_since_statistics
    }
    /// Start one explicit native draw or resize.
    pub fn begin_draw(&mut self, resize: bool, width: f64, height: f64) -> Result<(), JsValue> {
        self.inner
            .begin_draw(if resize { Some((width, height)) } else { None })
            .map_err(error)
    }
    /// Start one existing update or frame.
    pub fn begin_update(
        &mut self,
        frame: bool,
        gaze: bool,
        control: bool,
        read_playing: bool,
        observe_step: bool,
        playing: bool,
    ) -> Result<(), JsValue> {
        self.inner
            .begin_update(frame, gaze, control, read_playing, observe_step, playing)
            .map_err(error)
    }
    /// Stop before host cleanup.
    pub fn stop(&mut self) {
        self.inner.stop();
    }
    /// Start one packet.
    pub fn begin_packet(&mut self) -> Result<(), JsValue> {
        self.inner.begin_packet().map_err(error)
    }
    /// Legacy gaze returned.
    pub fn gaze_done(&mut self) -> Result<(), JsValue> {
        self.inner.gaze_done().map_err(error)
    }
    /// Native returned a step.
    pub fn advance_done(&mut self) -> Result<(), JsValue> {
        self.inner.advance_done().map_err(error)
    }
    /// Capture post-control playing.
    pub fn playing_observed(&mut self, playing: bool) -> Result<(), JsValue> {
        self.inner.playing_observed(playing).map_err(error)
    }
    /// Quality interpolation returned.
    pub fn quality_done(&mut self) -> Result<(), JsValue> {
        self.inner.quality_done().map_err(error)
    }
    /// Both optional step getters returned.
    pub fn step_observed(&mut self, whole: f64, delta: f64) -> Result<(), JsValue> {
        self.inner.step_observed(whole, delta).map_err(error)
    }
    /// Step release returned.
    pub fn step_freed(&mut self) -> Result<(), JsValue> {
        self.inner.step_freed().map_err(error)
    }
    /// Optional observer returned synchronously.
    pub fn observer_done(&mut self) -> Result<(), JsValue> {
        self.inner.observer_done().map_err(error)
    }
    /// Native statistics returned with captured truthiness.
    pub fn statistics_result(&mut self, consumed: bool) -> Result<(), JsValue> {
        self.inner.statistics_result(consumed).map_err(error)
    }
    /// Complete packet/report admission before charging.
    pub fn packet_succeeded(&mut self, count: f64) -> Result<(), JsValue> {
        self.inner.packet_succeeded(count).map_err(error)
    }
    /// Commit successful draw and any resize.
    pub fn draw_succeeded(&mut self) -> Result<(), JsValue> {
        self.inner.draw_succeeded().map_err(error)
    }
    /// Complete the successful operation body.
    pub fn finish(&mut self) -> Result<(), JsValue> {
        self.inner.finish().map_err(error)
    }
}
