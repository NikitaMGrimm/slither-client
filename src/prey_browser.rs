//! Transactional ownership of normalized caller-supplied prey raster snapshots.

use std::collections::BTreeSet;

use js_sys::{Array, Function, Object};
use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

use crate::{
    food_browser::{FoodSources, error, field, integer, number, record, set},
    presentation::{
        BodyAsset, MAX_PREY_FAMILY_SOURCES, PreyFactory, PreyImageCommand, PreyPaintPlan,
        PreyPresentation,
    },
    state::{Direction, PreySpawnInput},
};

const MAX_TRANSACTION_ENTRIES: usize = 262_144;
const MAX_SNAPSHOTS: usize = 524_288;

fn request(event: &PreySpawnInput, zoom: f64) -> Result<Object, JsValue> {
    if !zoom.is_finite() || zoom <= 0. {
        return Err(error("positive finite prey creation zoom required"));
    }
    let object = Object::new();
    for (key, value) in [
        ("id", f64::from(event.id)),
        ("x", event.absolute_position.x),
        ("y", event.absolute_position.y),
        ("size", event.base_size),
        ("sizeByte", f64::from(event.size_byte)),
        ("rawColor", f64::from(event.raw_color)),
        ("palette", f64::from(event.raw_color % 9)),
        (
            "direction",
            match event.direction {
                Direction::None => 0.,
                Direction::Decreasing => 1.,
                Direction::Increasing => 2.,
            },
        ),
        ("heading", event.heading),
        ("wantedHeading", event.wanted_heading),
        ("speedPer32ms", event.speed_per_32ms),
        ("zoom", zoom),
    ] {
        if !value.is_finite() {
            return Err(error("nonfinite prey request"));
        }
        set(&object, key, JsValue::from_f64(value))?;
    }
    Ok(object)
}

fn family(value: JsValue) -> Result<(JsValue, usize), JsValue> {
    if !Array::is_array(&value) {
        return Err(error("prey source array required"));
    }
    let count = integer(field(&value, "length")?, 1, MAX_PREY_FAMILY_SOURCES)?;
    Ok((value, count))
}

/// A separate pool instance gives prey its own handle/revision namespace. Clone
/// starts a transaction, preserving retained snapshots and monotonic tokens but
/// resetting temporary catalog charges and ordered-draw observations.
#[derive(Clone, Default)]
pub(crate) struct PreySources {
    pool: FoodSources,
}

impl PreySources {
    pub(crate) fn clear(&mut self) {
        self.pool.clear();
    }

    pub(crate) fn resolve(
        &mut self,
        callback: &Function,
        event: &PreySpawnInput,
        zoom: f64,
    ) -> Result<PreyFactory, JsValue> {
        self.resolve_limited(
            callback,
            event,
            zoom,
            MAX_TRANSACTION_ENTRIES,
            MAX_SNAPSHOTS,
        )
    }

    /// Limits are this pool's permitted totals, after charging the other pool.
    /// Failed parsing or registration leaves all references and counters intact.
    pub(crate) fn resolve_limited(
        &mut self,
        callback: &Function,
        event: &PreySpawnInput,
        zoom: f64,
        catalog_limit: usize,
        snapshot_limit: usize,
    ) -> Result<PreyFactory, JsValue> {
        let raw = callback.call1(&JsValue::UNDEFINED, &request(event, zoom)?.into())?;
        record(&raw)?;
        let random_phase_unit = number(field(&raw, "randomPhaseUnit")?, 0., 1.)?;
        let random_rate_unit = number(field(&raw, "randomRateUnit")?, 0., 1.)?;
        if random_phase_unit == 1. || random_rate_unit == 1. {
            return Err(error("prey random units must be less than one"));
        }
        let palette = field(&raw, "palette")?;
        record(&palette)?;
        let color = integer(field(&palette, "color")?, 0, 8)? as u8;
        if color != event.raw_color % 9 {
            return Err(error("prey palette does not match raw color"));
        }
        let families = [
            family(field(&palette, "bodies")?)?,
            family(field(&palette, "glows")?)?,
        ];
        let [bodies, glows] = self.pool.register_families(
            families,
            catalog_limit.min(MAX_TRANSACTION_ENTRIES),
            snapshot_limit.min(MAX_SNAPSHOTS),
            true,
        )?;
        Ok(PreyFactory {
            random_phase_unit,
            random_rate_unit,
            palette: color,
            bodies,
            glows,
        })
    }

    /// Recheck after every later appearance/recipe callback and before commit.
    pub(crate) fn validate_ready(&self) -> Result<(), JsValue> {
        self.pool.validate_ready()
    }

    pub(crate) fn validate(&self, target: &HtmlCanvasElement) -> Result<(), JsValue> {
        self.pool.validate(target)
    }

    pub(crate) fn validate_shared(
        &self,
        object: &JsValue,
        revision: &JsValue,
        width: u32,
        height: u32,
    ) -> Result<(), JsValue> {
        self.pool.validate_shared(object, revision, width, height)
    }

    /// Borrow actual objects and revisions; never compare tokens across pools.
    pub(crate) fn object_snapshots(&self) -> impl Iterator<Item = (BodyAsset, &JsValue, &JsValue)> {
        self.pool.object_snapshots()
    }

    pub(crate) fn assets(&self) -> Result<Vec<BodyAsset>, JsValue> {
        self.pool.assets()
    }

    pub(crate) fn len(&self) -> usize {
        self.pool.len()
    }

    pub(crate) fn entry_count(&self) -> usize {
        self.pool.entry_count()
    }

    /// Run only after every ordered Setup plan has finished using the pool.
    pub(crate) fn retain(&mut self, preys: &[PreyPresentation]) {
        let selected: BTreeSet<u64> = preys
            .iter()
            .flat_map(|prey| {
                let sources = prey.snapshot().sources;
                [sources.body.asset().handle, sources.glow.asset().handle]
            })
            .collect();
        self.pool.retain_handles(&selected);
    }

    pub(crate) fn observe_draw_sources(&mut self, plan: &PreyPaintPlan) -> Result<(), JsValue> {
        self.pool.observe_assets(
            plan.early
                .iter()
                .chain(&plan.late)
                .map(|c| c.source.asset()),
        )
    }

    pub(crate) fn submit(
        &self,
        context: &CanvasRenderingContext2d,
        command: &PreyImageCommand,
    ) -> Result<(), JsValue> {
        self.pool.submit_image(
            context,
            command.source.asset(),
            command.draw,
            command.alpha,
            command.blend,
        )
    }
}
