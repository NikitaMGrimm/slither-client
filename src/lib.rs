//! Bounded, offline protocol primitives for an independent browser prototype.
//!
//! Runtime credentials and existing browser image objects are supplied by callers.
//! This crate neither opens connections nor fetches assets.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod math;

#[cfg(target_arch = "wasm32")]
mod accessory_browser;

pub mod challenge;
pub mod desktop_input;
pub mod desktop_layout;
pub mod menu_preferences;
pub mod play_admission;
pub mod presentation;
pub mod profile_literals;
pub mod protocol;
pub mod session_policy;
pub mod stock_controller_policy;
pub mod start_page;
pub mod state;

#[cfg(target_arch = "wasm32")]
mod start_page_browser;

#[cfg(target_arch = "wasm32")]
mod menu_preferences_browser;

#[cfg(target_arch = "wasm32")]
mod play_admission_browser;

#[cfg(target_arch = "wasm32")]
mod desktop_layout_browser;

#[cfg(target_arch = "wasm32")]
mod profile_literals_browser;

#[cfg(target_arch = "wasm32")]
mod browser;

#[cfg(target_arch = "wasm32")]
mod desktop_input_browser;

#[cfg(target_arch = "wasm32")]
mod session_policy_browser;

#[cfg(target_arch = "wasm32")]
mod stock_controller_policy_browser;

#[cfg(target_arch = "wasm32")]
mod canvas_browser;

#[cfg(target_arch = "wasm32")]
mod pattern_browser;

#[cfg(target_arch = "wasm32")]
mod animated_browser;

#[cfg(target_arch = "wasm32")]
mod announcement_browser;

#[cfg(target_arch = "wasm32")]
mod body_browser;

#[cfg(target_arch = "wasm32")]
mod face_browser;

#[cfg(target_arch = "wasm32")]
mod antenna_browser;

#[cfg(target_arch = "wasm32")]
mod food_browser;

#[cfg(target_arch = "wasm32")]
mod prey_browser;

#[cfg(target_arch = "wasm32")]
mod scene_browser;

#[cfg(target_arch = "wasm32")]
mod presentation_browser;

#[cfg(target_arch = "wasm32")]
mod quality_browser;

#[cfg(target_arch = "wasm32")]
mod end_screen_browser;

#[cfg(target_arch = "wasm32")]
mod hud_history_browser;

#[cfg(target_arch = "wasm32")]
mod leaderboard_history_browser;
