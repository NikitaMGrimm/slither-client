//! Copied numeric ABI for browser-free desktop input. Host callbacks stay in JS.
use crate::desktop_input::{
    self, DesktopInput as Policy, ErrorKind, InputError, OwnInput, Point, PointerView,
};
use js_sys::{Object, Reflect};
use wasm_bindgen::prelude::*;

fn failure(value: InputError) -> JsValue {
    match value.kind {
        ErrorKind::Type => js_sys::TypeError::new(value.message).into(),
        ErrorKind::Range => js_sys::RangeError::new(value.message).into(),
        ErrorKind::State => js_sys::Error::new(value.message).into(),
    }
}
fn record(fields: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let result = Object::new();
    for (name, value) in fields {
        if !Reflect::set(&result, &JsValue::from_str(name), value)? {
            return Err(JsValue::from_str("Input view copy failed"));
        }
    }
    Ok(result.into())
}
fn point(value: Point) -> Result<JsValue, JsValue> {
    record(&[("x", value.x.into()), ("y", value.y.into())])
}
fn pointer(value: PointerView) -> Result<JsValue, JsValue> {
    record(&[
        ("x", value.point.x.into()),
        ("y", value.point.y.into()),
        ("gazeHeading", value.gaze_heading.into()),
    ])
}

/// Pure input owner. No DOM, scheduler, transport or JavaScript callbacks.
#[wasm_bindgen]
pub struct DesktopInput {
    inner: Policy,
}
#[wasm_bindgen]
impl DesktopInput {
    /// Create initially disconnected input.
    #[wasm_bindgen(constructor)]
    pub fn new(protocol_version: f64) -> Result<DesktopInput, JsValue> {
        Ok(Self {
            inner: Policy::new(protocol_version).map_err(failure)?,
        })
    }
    /// Project a copied CSS pointer observation without storing it.
    pub fn project_pointer(values: &[f64]) -> Result<JsValue, JsValue> {
        pointer(desktop_input::project_pointer(values).map_err(failure)?)
    }
    /// Store and copy a projected pointer.
    pub fn pointer(&mut self, values: &[f64]) -> Result<JsValue, JsValue> {
        pointer(self.inner.pointer(values).map_err(failure)?)
    }
    /// Version current at this callback boundary.
    pub fn protocol_version(&self) -> u8 {
        self.inner.view().protocol
    }
    /// Whether a tick should enter its connected phases.
    pub fn is_connected(&self) -> bool {
        self.inner.view().connected
    }
    /// Whether an own appearance currently exists.
    pub fn has_own(&self) -> bool {
        self.inner.view().own.is_some()
    }
    /// Optional gaze at disconnected/no-own return boundaries.
    pub fn gaze(&self) -> Option<f64> {
        self.inner.view().own.map(|x| x.gaze_heading)
    }
    /// Required gaze after the final send callback.
    pub fn required_gaze(&self) -> Result<f64, JsValue> {
        self.inner.required_gaze().map_err(failure)
    }
    /// Replace the current wire version.
    pub fn set_protocol_version(&mut self, value: f64) -> Result<(), JsValue> {
        self.inner.set_protocol(value).map_err(failure)
    }
    /// Replace tick admission state.
    pub fn set_connected(&mut self, value: bool) {
        self.inner.set_connected(value);
    }
    /// Replace copied appearance numbers after JS token identity comparison.
    pub fn set_own(&mut self, values: &[f64], same: bool) -> Result<(), JsValue> {
        if values.len() != 6 || ![0.0, 1.0].contains(&values[2]) {
            return Err(js_sys::TypeError::new("Invalid own appearance").into());
        }
        self.inner
            .set_own(
                OwnInput {
                    wanted_heading: values[0],
                    gaze_heading: values[1],
                    dead: values[2] != 0.0,
                    turn_rate: values[3],
                    size_turn_factor: values[4],
                    speed_turn_factor: values[5],
                    requested_boost: false,
                    sent_boost: false,
                },
                same,
            )
            .map_err(failure)
    }
    /// Detach own without changing global fields.
    pub fn clear_own(&mut self) {
        self.inner.clear_own();
    }
    /// Recognized key press.
    pub fn key_down(&mut self, code: &str) -> bool {
        self.inner.key(code, true)
    }
    /// Recognized key release.
    pub fn key_up(&mut self, code: &str) -> bool {
        self.inner.key(code, false)
    }
    /// Mouse press, gated by retained own.
    pub fn mouse_down(&mut self, values: &[f64]) -> Result<(), JsValue> {
        self.inner.mouse_down(values).map_err(failure)
    }
    /// Mouse boost release.
    pub fn mouse_up(&mut self) {
        self.inner.mouse_up();
    }
    /// Preserve the no-release blur policy.
    pub fn blur(&mut self) {
        self.inner.blur();
    }
    /// Gate future tick sends.
    pub fn pagehide(&mut self) {
        self.inner.pagehide();
    }
    /// Reset connection/own only.
    pub fn reset(&mut self) {
        self.inner.reset();
    }
    /// Test the Rust reentry guard before host admission.
    pub fn ensure_idle(&self) -> Result<(), JsValue> {
        self.inner.ensure_idle().map_err(failure)
    }
    /// Acquire the Rust tick guard.
    pub fn enter_tick(&mut self) -> Result<(), JsValue> {
        self.inner.enter_tick().map_err(failure)
    }
    /// Release the Rust tick guard in JS finally.
    pub fn leave_tick(&mut self) {
        self.inner.leave_tick();
    }
    /// Validate scalars before any phase mutation.
    pub fn validate_tick(&self, now_ms: f64, whole_steps: f64) -> Result<(), JsValue> {
        self.inner
            .validate_tick(now_ms, whole_steps)
            .map_err(failure)
    }
    /// Retain pre-close keyboard debt.
    pub fn accumulate_step(&mut self, whole_steps: f64) -> Result<(), JsValue> {
        self.inner.accumulate(whole_steps).map_err(failure)
    }
    /// Commit keyboard and return a fresh packet (empty means no send).
    pub fn keyboard_phase(&mut self, now_ms: f64, whole_steps: f64) -> Result<Vec<u8>, JsValue> {
        self.inner
            .keyboard_phase(now_ms, whole_steps)
            .map_err(failure)
    }
    /// Commit boost and return a fresh packet.
    pub fn boost_phase(&mut self, now_ms: f64) -> Result<Vec<u8>, JsValue> {
        self.inner.boost_phase(now_ms).map_err(failure)
    }
    /// Commit gaze/heading and return a fresh packet.
    pub fn heading_phase(&mut self, now_ms: f64) -> Result<Vec<u8>, JsValue> {
        self.inner.heading_phase(now_ms).map_err(failure)
    }
    /// Copy numeric state without serializing floats or tokens.
    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        let s = self.inner.view();
        let own = s
            .own
            .map(|x| {
                record(&[
                    ("wantedHeading", x.wanted_heading.into()),
                    ("gazeHeading", x.gaze_heading.into()),
                    ("dead", x.dead.into()),
                    ("turnRate", x.turn_rate.into()),
                    ("sizeTurnFactor", x.size_turn_factor.into()),
                    ("speedTurnFactor", x.speed_turn_factor.into()),
                    ("requestedBoost", x.requested_boost.into()),
                    ("sentBoost", x.sent_boost.into()),
                ])
            })
            .transpose()?
            .unwrap_or(JsValue::NULL);
        record(&[
            ("protocolVersion", s.protocol.into()),
            ("connected", s.connected.into()),
            ("pointer", point(s.pointer)?),
            ("comparedPointer", point(s.compared_pointer)?),
            ("wantHeading", s.want_heading.into()),
            ("lastHeadingMs", s.last_heading_ms.into()),
            ("lastBoostMs", s.last_boost_ms.into()),
            ("lastTurnMs", s.last_turn_ms.into()),
            ("lastQuantizedHeading", s.last_quantized_heading.into()),
            ("leftHeld", s.left_held.into()),
            ("rightHeld", s.right_held.into()),
            ("boostKeyHeld", s.boost_key_held.into()),
            ("leftSteps", (s.left_steps as f64).into()),
            ("rightSteps", (s.right_steps as f64).into()),
            ("own", own),
        ])
    }
}
