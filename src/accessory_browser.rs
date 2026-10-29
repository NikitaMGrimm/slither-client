//! Thin pure-Wasm projections for ready cached accessory capture.

use wasm_bindgen::prelude::*;

/// Scalar-only selected request policy. Every borrow ends before native effects.
#[wasm_bindgen]
pub struct SelectedAccessoryRequest(crate::presentation::SelectedAccessoryRequest);

#[wasm_bindgen]
impl SelectedAccessoryRequest {
    /// Capture the existing startup clock bound without invoking native effects.
    #[wasm_bindgen(constructor)]
    pub fn new(start: f64, deadline: f64) -> Result<Self, JsValue> {
        crate::presentation::SelectedAccessoryRequest::new(start, deadline)
            .map(Self)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    #[allow(clippy::too_many_arguments)]
    /// Return a copied request intent after selected-resource admission.
    pub fn prepare(
        &mut self,
        selection: Option<String>,
        count: u32,
        slot: u8,
        resource: &str,
        image_scale: f64,
        pivot_x: f64,
        pivot_y: f64,
        now: f64,
    ) -> Result<u8, JsValue> {
        self.0
            .prepare(
                crate::presentation::AccessoryRequestInput {
                    selection: selection.as_deref(),
                    count,
                    slot,
                    resource,
                    image_scale,
                    pivot_x,
                    pivot_y,
                },
                now,
            )
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    /// Current private generation.
    pub fn ticket(&self) -> u32 {
        self.0.ticket()
    }
    /// Test late callback ownership outside any borrow.
    pub fn live(&self, ticket: u32) -> bool {
        self.0.live(ticket)
    }
    /// Copy current phase for diagnostics/tests.
    pub fn phase(&self) -> u8 {
        self.0.phase()
    }
    /// Validate the operation generation and monotonic startup bound.
    pub fn check(&mut self, ticket: u32, now: f64) -> Result<(), JsValue> {
        self.0
            .check(ticket, now)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    /// Copy the delay for one native watchdog.
    pub fn remaining(&mut self, now: f64) -> Result<f64, JsValue> {
        self.0
            .remaining(now)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    #[allow(clippy::too_many_arguments)]
    /// Admit complete native element/intrinsic extents before cache publication.
    pub fn loaded(
        &mut self,
        ticket: u32,
        now: f64,
        complete: bool,
        width: f64,
        height: f64,
        intrinsic_width: f64,
        intrinsic_height: f64,
    ) -> Result<(), JsValue> {
        self.0
            .loaded(
                ticket,
                now,
                complete,
                [width, height, intrinsic_width, intrinsic_height],
            )
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    /// Retire the producer after existing decode listeners are installed.
    pub fn handoff(&mut self, ticket: u32, now: f64) -> Result<(), JsValue> {
        self.0
            .handoff(ticket, now)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }
    /// Permanently invalidate a native failure.
    pub fn invalidate(&mut self) {
        self.0.invalidate();
    }
    /// Retire callback ownership before cleanup/free.
    pub fn dispose(&mut self) {
        self.0.dispose();
    }
}

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
