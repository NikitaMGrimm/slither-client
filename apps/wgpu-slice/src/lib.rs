//! Offline synthetic gameplay slice. The existing client owns prediction and paint plans.
#![forbid(unsafe_code)]

pub mod frame;
pub mod gpu;
pub mod materials;
pub mod scene;

#[cfg(target_arch = "wasm32")]
mod web;

pub type Result<T> = std::result::Result<T, String>;
