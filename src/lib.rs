//! Bounded, offline protocol primitives for an independent browser prototype.
//!
//! Runtime credentials and existing browser image objects are supplied by callers.
//! This crate neither opens connections nor fetches assets.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod math;

pub mod challenge;
pub mod presentation;
pub mod protocol;
pub mod start_page;
pub mod state;

#[cfg(target_arch = "wasm32")]
mod start_page_browser;

#[cfg(target_arch = "wasm32")]
mod browser;

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
