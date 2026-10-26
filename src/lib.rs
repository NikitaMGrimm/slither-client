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
pub mod state;

#[cfg(target_arch = "wasm32")]
mod browser;

#[cfg(target_arch = "wasm32")]
mod canvas_browser;

#[cfg(target_arch = "wasm32")]
mod animated_browser;

#[cfg(target_arch = "wasm32")]
mod scene_browser;

#[cfg(target_arch = "wasm32")]
mod presentation_browser;

#[cfg(target_arch = "wasm32")]
mod quality_browser;
