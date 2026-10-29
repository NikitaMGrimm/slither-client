//! Primitive copied Play ABI. No browser callback runs with a retained Rust borrow.

use wasm_bindgen::prelude::*;

/// Browser-free owned-menu admission; native guards and effects remain in JS.
#[wasm_bindgen]
pub struct PlayAdmission(crate::play_admission::PlayAdmission);

#[wasm_bindgen]
impl PlayAdmission {
    /// Bind existing route and profile availability observations.
    #[wasm_bindgen(constructor)]
    pub fn new(local: bool, profile_available: bool) -> Self {
        Self(crate::play_admission::PlayAdmission::new(
            local,
            profile_available,
        ))
    }

    /// Copy route availability.
    pub fn available(&self) -> bool {
        self.0.available()
    }

    /// Copy consumed admission.
    pub fn accepted(&self) -> bool {
        self.0.accepted()
    }

    /// Reuse the nickname policy without changing menu preferences.
    pub fn nickname_valid(&self, nickname: &str) -> bool {
        self.0.nickname_valid(nickname)
    }

    /// Consume admission before any UI lock/status or launch callback.
    pub fn accept(&mut self) -> bool {
        self.0.accept()
    }

    /// Consume unavailable admission at the existing initial-lock seam.
    pub fn lock_unavailable(&mut self) -> bool {
        self.0.lock_unavailable()
    }

    /// Copy a local return decision from the existing session's observations.
    pub fn return_ready(&mut self, phase: &str, playing: bool) -> bool {
        self.0.return_ready(phase, playing)
    }

    /// Commit only after a successful native UI unlock, outside all Rust borrows.
    pub fn complete_return(&mut self) -> Result<(), JsValue> {
        self.0.complete_return().map_err(JsValue::from_str)
    }
}
