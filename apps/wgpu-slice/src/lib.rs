//! Shared explicit local gameplay and offline diagnostics. The existing core owns state/plans.
#![forbid(unsafe_code)]

pub mod bank;
pub mod frame;
pub mod game;
pub mod gpu;
pub mod hud;
pub mod materials;
#[cfg(not(target_arch = "wasm32"))]
pub mod native;
#[cfg(not(target_arch = "wasm32"))]
pub mod official;
pub mod render;
pub mod scene;

#[cfg(target_arch = "wasm32")]
mod web;

pub type Result<T> = std::result::Result<T, String>;
