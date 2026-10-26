//! Transactional ownership of caller-supplied desktop food raster snapshots.

use std::collections::BTreeSet;

use js_sys::{Array, Function, Object, Reflect};
use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

use crate::{
    presentation::{
        BodyAsset, BodyAssetStatus, BodyBlend, FoodFactory, FoodImageCommand, FoodImageDraw,
        FoodPresentation, FoodSource, MAX_RETAINED_FOODS, food_palette,
    },
    state::FoodSpawnInput,
};

const MAX_FAMILY: usize = 4096;
// A transaction can inspect at most this many catalog entries, including aliases
// and unselected entries. Selected old handles remain outside that temporary budget.
const MAX_TRANSACTION_ENTRIES: usize = 262_144;
const MAX_SNAPSHOTS: usize = 4 * MAX_RETAINED_FOODS + MAX_TRANSACTION_ENTRIES;

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn field(value: &JsValue, key: &str) -> Result<JsValue, JsValue> {
    if !value.is_object() || value.is_null() {
        return Err(error("food metadata record required"));
    }
    let descriptor = Reflect::get_own_property_descriptor(
        value.unchecked_ref::<Object>(),
        &JsValue::from_str(key),
    )?;
    if descriptor.is_undefined()
        || !Object::has_own(
            descriptor.unchecked_ref::<Object>(),
            &JsValue::from_str("value"),
        )
    {
        return Err(error(format!(
            "food metadata requires own data field {key}"
        )));
    }
    Reflect::get(&descriptor, &JsValue::from_str("value"))
}

fn number(value: JsValue, min: f64, max: f64) -> Result<f64, JsValue> {
    value
        .as_f64()
        .filter(|n| n.is_finite() && *n >= min && *n <= max)
        .ok_or_else(|| error("invalid food metadata number"))
}

fn integer(value: JsValue, min: usize, max: usize) -> Result<usize, JsValue> {
    let n = number(value, min as f64, max as f64)?;
    if n.fract() != 0. {
        return Err(error("food metadata integer required"));
    }
    Ok(n as usize)
}

fn text(value: JsValue) -> Result<String, JsValue> {
    value
        .as_string()
        .ok_or_else(|| error("food metadata string required"))
}

fn record(value: &JsValue) -> Result<(), JsValue> {
    if !value.is_object() || value.is_null() || Array::is_array(value) {
        return Err(error("plain food metadata record required"));
    }
    let prototype = Reflect::get_prototype_of(value)?;
    if !prototype.is_null() && !Object::is(&prototype, &Object::get_prototype_of(&Object::new())) {
        return Err(error("plain synchronous food metadata record required"));
    }
    Ok(())
}

fn revision(value: JsValue) -> Result<JsValue, JsValue> {
    if let Some(s) = value.as_string() {
        if s.is_empty() || s.encode_utf16().count() > 128 {
            return Err(error(
                "food revision string must contain 1..128 UTF-16 units",
            ));
        }
    } else {
        let n = number(value.clone(), 0., 9_007_199_254_740_991.)?;
        if n.fract() != 0. {
            return Err(error(
                "food revision number must be a safe unsigned integer",
            ));
        }
    }
    Ok(value)
}

// Define own data properties so inherited setters cannot consume request fields.
fn set(object: &Object, key: &str, value: JsValue) -> Result<(), JsValue> {
    let descriptor = Object::create(&JsValue::NULL.unchecked_into::<Object>());
    Reflect::set(&descriptor, &JsValue::from_str("value"), &value)?;
    Reflect::set(
        &descriptor,
        &JsValue::from_str("enumerable"),
        &JsValue::TRUE,
    )?;
    if !Reflect::define_property(object, &JsValue::from_str(key), &descriptor)? {
        return Err(error("could not construct food request"));
    }
    Ok(())
}

fn request(event: &FoodSpawnInput, zoom: f64) -> Result<Object, JsValue> {
    if !zoom.is_finite() || zoom <= 0. {
        return Err(error("positive finite food creation zoom required"));
    }
    let object = Object::new();
    for (key, n) in [
        ("key", f64::from(event.key)),
        ("sectorX", f64::from(event.sector.0)),
        ("sectorY", f64::from(event.sector.1)),
        ("x", event.absolute_position.x),
        ("y", event.absolute_position.y),
        ("size", event.base_size),
        ("sizeByte", f64::from(event.size_byte)),
        ("rawColor", f64::from(event.raw_color)),
        ("palette", f64::from(food_palette(event.raw_color))),
    ] {
        if !n.is_finite() {
            return Err(error("nonfinite food request"));
        }
        set(&object, key, JsValue::from_f64(n))?;
    }
    set(&object, "rapid", JsValue::from_bool(event.rapid))?;
    set(&object, "zoom", JsValue::from_f64(zoom))?;
    Ok(object)
}

#[derive(Clone)]
enum Raster {
    Canvas(HtmlCanvasElement),
    Image(HtmlImageElement),
}

#[derive(Clone)]
struct Snapshot {
    raster: Raster,
    object: JsValue,
    revision: JsValue,
    asset: BodyAsset,
}

impl Snapshot {
    fn validate(&self, target: Option<&HtmlCanvasElement>) -> Result<(), JsValue> {
        if target.is_some_and(|t| Object::is(&self.object, t.as_ref())) {
            return Err(error("food source aliases target"));
        }
        let (width, height, ready) = match &self.raster {
            Raster::Canvas(c) => (c.width(), c.height(), true),
            Raster::Image(i) => (i.natural_width(), i.natural_height(), i.complete()),
        };
        if !ready || width != self.asset.width || height != self.asset.height {
            return Err(error(
                "frozen food source changed dimensions or is not ready",
            ));
        }
        Ok(())
    }

    fn coherent(&self, other: &Self) -> bool {
        Object::is(&self.revision, &other.revision)
            && self.asset.width == other.asset.width
            && self.asset.height == other.asset.height
            && matches!(
                (&self.raster, &other.raster),
                (Raster::Canvas(_), Raster::Canvas(_)) | (Raster::Image(_), Raster::Image(_))
            )
    }
}

/// Clone starts a disposable packet transaction: retained snapshots/counters are
/// copied, while alias observations and the temporary catalog budget start empty.
/// Commit this value only with the complete client. Callback effects and raster
/// pixel mutations cannot be rolled back or detected by this metadata boundary.
/// Revisions are nonempty strings (<=128 UTF-16 units) or safe unsigned integer
/// Numbers, including signed zero; equality is Object.is. Tokens stay Rust u64.
#[derive(Default)]
pub(crate) struct FoodSources {
    sources: Vec<Snapshot>,
    observed: BTreeSet<u64>,
    entries: usize,
    last_handle: u64,
    last_revision: u64,
}

impl Clone for FoodSources {
    fn clone(&self) -> Self {
        Self {
            sources: self.sources.clone(),
            observed: BTreeSet::new(),
            entries: 0,
            last_handle: self.last_handle,
            last_revision: self.last_revision,
        }
    }
}

impl FoodSources {
    pub(crate) fn clear(&mut self) {
        self.sources.clear();
        self.observed.clear();
        self.entries = 0;
    }

    /// Check every staged reference, including catalog entries not selected by
    /// the factory. Call after the final callback before retain/commit as well.
    pub(crate) fn validate_ready(&self) -> Result<(), JsValue> {
        for source in &self.sources {
            source.validate(None)?;
        }
        Ok(())
    }

    pub(crate) fn validate(&self, target: &HtmlCanvasElement) -> Result<(), JsValue> {
        for source in &self.sources {
            source.validate(Some(target))?;
        }
        Ok(())
    }

    /// Body/face tokens belong to a separate per-draw pool. Compare actual
    /// object and revision identity before either pool submits to the target.
    pub(crate) fn validate_shared(
        &self,
        object: &JsValue,
        revision: &JsValue,
        width: u32,
        height: u32,
    ) -> Result<(), JsValue> {
        for (asset, _, actual_revision) in self
            .object_snapshots()
            .filter(|(_, source, _)| Object::is(source, object))
        {
            if !Object::is(actual_revision, revision)
                || asset.width != width
                || asset.height != height
            {
                return Err(error(
                    "incoherent shared body/face and food source snapshot",
                ));
            }
        }
        Ok(())
    }

    pub(crate) fn len(&self) -> usize {
        self.sources.len()
    }

    pub(crate) fn assets(&self) -> Result<Vec<BodyAsset>, JsValue> {
        let mut assets = Vec::new();
        assets
            .try_reserve(self.sources.len())
            .map_err(|_| error("food asset allocation failed"))?;
        assets.extend(self.sources.iter().map(|s| s.asset));
        Ok(assets)
    }

    /// Pin observations only for the new ordered multi-draw transaction. Old
    /// retained revisions remain legal until a draw actually selects them.
    pub(crate) fn observe_draw_sources(
        &mut self,
        plan: &crate::presentation::FoodPaintPlan,
    ) -> Result<(), JsValue> {
        for command in plan.early.iter().chain(&plan.late) {
            let source = self.lookup(command.source.asset())?;
            for prior in self
                .sources
                .iter()
                .filter(|s| self.observed.contains(&s.asset.handle))
            {
                if Object::is(&source.object, &prior.object) && !source.coherent(prior) {
                    return Err(error("incoherent food source across planned draws"));
                }
            }
            self.observed.insert(command.source.asset().handle);
        }
        Ok(())
    }

    /// Expose exact borrowed identity for coherence with the body's per-call
    /// pool; token spaces belong to separate registries and must not be compared.
    pub(crate) fn object_snapshots(&self) -> impl Iterator<Item = (BodyAsset, &JsValue, &JsValue)> {
        self.sources
            .iter()
            .map(|s| (s.asset, &s.object, &s.revision))
    }

    fn lookup(&self, asset: BodyAsset) -> Result<&Snapshot, JsValue> {
        self.sources
            .iter()
            .find(|s| s.asset.handle == asset.handle)
            .filter(|s| s.asset == asset)
            .ok_or_else(|| error("missing or incoherent frozen food handle"))
    }

    /// Stage all selectable catalog refs. No selection arithmetic occurs here.
    /// A failed resolve leaves this registry's references and counters unchanged.
    pub(crate) fn resolve(
        &mut self,
        callback: &Function,
        event: &FoodSpawnInput,
        zoom: f64,
    ) -> Result<FoodFactory, JsValue> {
        let raw = callback.call1(&JsValue::UNDEFINED, &request(event, zoom)?.into())?;
        record(&raw)?;
        let random_phase_unit = number(field(&raw, "randomPhaseUnit")?, 0., 1.)?;
        let random_wobble_unit = number(field(&raw, "randomWobbleUnit")?, 0., 1.)?;
        if random_phase_unit == 1. || random_wobble_unit == 1. {
            return Err(error("food random units must be less than one"));
        }
        let palette = field(&raw, "palette")?;
        record(&palette)?;
        let color = integer(field(&palette, "color")?, 0, 9)? as u8;
        if color != food_palette(event.raw_color) {
            return Err(error("food palette does not match raw color"));
        }
        let count = integer(field(&palette, "count")?, 1, MAX_FAMILY)?;
        let entries = self
            .entries
            .checked_add(3 * count)
            .filter(|n| *n <= MAX_TRANSACTION_ENTRIES)
            .ok_or_else(|| error("food transaction catalog budget exceeded"))?;
        let mut stage = Registration {
            registry: self,
            added: Vec::new(),
            observed: BTreeSet::new(),
            last_handle: self.last_handle,
            last_revision: self.last_revision,
        };
        let factory = FoodFactory {
            random_phase_unit,
            random_wobble_unit,
            palette: color,
            image_count: count,
            bodies: stage.family(field(&palette, "bodies")?, count)?,
            outlines: stage.family(field(&palette, "outlines")?, count)?,
            glows: stage.family(field(&palette, "glows")?, count)?,
        };
        // A later callback or metadata proxy can mutate an earlier source.
        self.validate_ready()?;
        for source in &stage.added {
            source.validate(None)?;
        }
        let Registration {
            added,
            observed,
            last_handle,
            last_revision,
            ..
        } = stage;
        self.sources
            .try_reserve(added.len())
            .map_err(|_| error("food source allocation failed"))?;
        self.sources.extend(added);
        self.observed.extend(observed);
        self.entries = entries;
        self.last_handle = last_handle;
        self.last_revision = last_revision;
        Ok(factory)
    }

    /// GC only after the complete disposable model succeeds and all staged refs
    /// have been revalidated. Missing handles stay missing so planning fails.
    pub(crate) fn retain(&mut self, foods: &[FoodPresentation]) {
        let selected: BTreeSet<u64> = foods
            .iter()
            .flat_map(|food| {
                let s = food.snapshot().sources;
                [s.body, s.outline, s.inner, s.outer].map(|s| s.asset().handle)
            })
            .collect();
        self.sources.retain(|s| selected.contains(&s.asset.handle));
        self.observed.clear();
        self.entries = 0;
    }

    pub(crate) fn submit(
        &self,
        context: &CanvasRenderingContext2d,
        command: &FoodImageCommand,
    ) -> Result<(), JsValue> {
        let source = self.lookup(command.source.asset())?;
        let target = context
            .canvas()
            .ok_or_else(|| error("food context has no target canvas"))?;
        source.validate(Some(&target))?;
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.set_global_alpha(command.alpha.effective);
        context.set_global_alpha(command.alpha.requested);
        context.set_global_composite_operation(match command.blend {
            BodyBlend::SourceOver => "source-over",
            BodyBlend::Lighter => "lighter",
        })?;
        match (&source.raster, command.draw) {
            (Raster::Canvas(c), FoodImageDraw::Whole { x, y }) => {
                context.draw_image_with_html_canvas_element(c, x, y)
            }
            (Raster::Image(i), FoodImageDraw::Whole { x, y }) => {
                context.draw_image_with_html_image_element(i, x, y)
            }
            (
                Raster::Canvas(c),
                FoodImageDraw::Scaled {
                    source: s,
                    destination: d,
                },
            ) => context
                .draw_image_with_html_canvas_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
                    c, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height,
                ),
            (
                Raster::Image(i),
                FoodImageDraw::Scaled {
                    source: s,
                    destination: d,
                },
            ) => context
                .draw_image_with_html_image_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
                    i, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height,
                ),
        }
    }
}

struct Registration<'a> {
    registry: &'a FoodSources,
    added: Vec<Snapshot>,
    observed: BTreeSet<u64>,
    last_handle: u64,
    last_revision: u64,
}

impl Registration<'_> {
    fn family(&mut self, value: JsValue, count: usize) -> Result<Vec<FoodSource>, JsValue> {
        if !Array::is_array(&value) {
            return Err(error("food source array required"));
        }
        // Extra tail entries are outside the selectable prefix and are not read.
        integer(field(&value, "length")?, count, u32::MAX as usize)?;
        let mut result = Vec::new();
        result
            .try_reserve_exact(count)
            .map_err(|_| error("food family allocation failed"))?;
        for index in 0..count {
            result.push(self.entry(&field(&value, &index.to_string())?)?);
        }
        Ok(result)
    }

    fn entry(&mut self, value: &JsValue) -> Result<FoodSource, JsValue> {
        record(value)?;
        let raw = field(value, "asset")?;
        record(&raw)?;
        if text(field(&raw, "status")?)? != "ready" {
            return Err(error("food asset must be ready"));
        }
        let object = field(&raw, "source")?;
        let raster = match text(field(&raw, "kind")?)?.as_str() {
            "canvas" => Raster::Canvas(
                object
                    .clone()
                    .dyn_into()
                    .map_err(|_| error("food source is not a canvas"))?,
            ),
            "image" => Raster::Image(
                object
                    .clone()
                    .dyn_into()
                    .map_err(|_| error("food source is not an image"))?,
            ),
            _ => return Err(error("unsupported food source kind")),
        };
        let mut snapshot = Snapshot {
            raster,
            object,
            revision: revision(field(&raw, "revision")?)?,
            asset: BodyAsset {
                handle: 0,
                revision: 0,
                width: integer(field(&raw, "width")?, 1, 65_535)? as u32,
                height: integer(field(&raw, "height")?, 1, 65_535)? as u32,
                status: BodyAssetStatus::Ready,
            },
        };
        snapshot.validate(None)?;
        let width = number(field(value, "width")?, f64::from_bits(1), f64::MAX)?;
        let height = number(field(value, "height")?, f64::from_bits(1), f64::MAX)?;
        let half_width = number(field(value, "halfWidth")?, 0., f64::MAX)?;
        let half_height = number(field(value, "halfHeight")?, 0., f64::MAX)?;
        for prior in self
            .registry
            .sources
            .iter()
            .chain(&self.added)
            .filter(|s| Object::is(&s.object, &snapshot.object))
        {
            let in_transaction = self.registry.observed.contains(&prior.asset.handle)
                || self.observed.contains(&prior.asset.handle);
            if in_transaction && !prior.coherent(&snapshot) {
                return Err(error("incoherent aliased food revision or dimensions"));
            }
            if prior.coherent(&snapshot) {
                snapshot.asset = prior.asset;
            }
        }
        if snapshot.asset.handle == 0 {
            if self.registry.sources.len() + self.added.len() >= MAX_SNAPSHOTS {
                return Err(error("food source snapshot budget exceeded"));
            }
            let handle = self
                .last_handle
                .checked_add(1)
                .ok_or_else(|| error("food source token exhausted"))?;
            let revision = self
                .last_revision
                .checked_add(1)
                .ok_or_else(|| error("food revision token exhausted"))?;
            snapshot.asset.handle = handle;
            snapshot.asset.revision = revision;
            self.added
                .try_reserve(1)
                .map_err(|_| error("food source allocation failed"))?;
            self.added.push(snapshot.clone());
            self.last_handle = handle;
            self.last_revision = revision;
        }
        self.observed.insert(snapshot.asset.handle);
        FoodSource::new(snapshot.asset, width, height, half_width, half_height).map_err(error)
    }
}
