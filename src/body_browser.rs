//! Bounded normalization and submission of trusted borrowed standard-body recipes.

use js_sys::{Array, Function, Object, Reflect, Uint8Array};
use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, HtmlImageElement};

use crate::presentation::{
    BodyAsset, BodyAssetStatus, BodyAssetUse, BodyBlend, BodyFade, BodyImageCommand,
    BodyPaintRecipe, BodyPalette, BodyRect, BodyRun, BodyStyle, BodyVariantMode,
    ClientPresentationError, PairedFaceGeometry, PairedSideGeometry, PairedSideLayout,
    SnakePresentation, StandardEyeGeometry,
};
use crate::state::Appearance;

pub(crate) fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

pub(crate) struct ResolveError(pub JsValue);

impl From<ClientPresentationError> for ResolveError {
    fn from(value: ClientPresentationError) -> Self {
        Self(error(value))
    }
}

impl From<JsValue> for ResolveError {
    fn from(value: JsValue) -> Self {
        Self(value)
    }
}

// Read own data fields, never inherited metadata or metadata accessors. The
// callback, realm and live DOM sources remain trusted synchronous capabilities.
fn field(value: &JsValue, key: &str) -> Result<JsValue, JsValue> {
    if !value.is_object() || value.is_null() || value.is_instance_of::<js_sys::Promise>() {
        return Err(error(format!("expected record at {key}")));
    }
    let descriptor = Object::get_own_property_descriptor(
        value.unchecked_ref::<Object>(),
        &JsValue::from_str(key),
    );
    if descriptor.is_undefined() {
        return Ok(JsValue::UNDEFINED);
    }
    if !Object::has_own(
        descriptor.unchecked_ref::<Object>(),
        &JsValue::from_str("value"),
    ) {
        return Err(error(format!("metadata accessor at {key}")));
    }
    Reflect::get(&descriptor, &JsValue::from_str("value"))
}

fn num(value: JsValue, min: f64, max: f64) -> Result<f64, JsValue> {
    value
        .as_f64()
        .filter(|n| n.is_finite() && *n >= min && *n <= max)
        .ok_or_else(|| error("invalid bounded metadata number"))
}

fn integer(value: JsValue, min: usize, max: usize) -> Result<usize, JsValue> {
    let n = num(value, min as f64, max as f64)?;
    if n.fract() != 0. {
        return Err(error("metadata integer required"));
    }
    Ok(n as usize)
}

fn flag(value: JsValue) -> Result<bool, JsValue> {
    value
        .as_bool()
        .ok_or_else(|| error("metadata boolean required"))
}

fn text(value: JsValue) -> Result<String, JsValue> {
    value
        .as_string()
        .ok_or_else(|| error("metadata string required"))
}

fn list(value: JsValue, min: usize, max: usize) -> Result<Vec<JsValue>, JsValue> {
    if !Array::is_array(&value) {
        return Err(error("metadata array required"));
    }
    let length = integer(field(&value, "length")?, min, max)?;
    (0..length).map(|i| field(&value, &i.to_string())).collect()
}

fn set(value: &Object, key: &str, field: &JsValue) -> Result<(), JsValue> {
    if !Reflect::set(value, &JsValue::from_str(key), field)? {
        return Err(error("could not construct recipe request"));
    }
    Ok(())
}

/// Appearance-time metadata is independent of visibility and later ID lookup.
pub(crate) fn appearance_request(appearance: &Appearance) -> Result<Object, JsValue> {
    let value = Object::new();
    for (key, n) in [
        ("skin", f64::from(appearance.skin)),
        ("id", f64::from(appearance.id)),
        ("cosmetic", f64::from(appearance.cosmetic)),
        ("x", appearance.absolute_head.x),
        ("y", appearance.absolute_head.y),
    ] {
        set(&value, key, &JsValue::from_f64(n))?;
    }
    set(
        &value,
        "customBytes",
        &Uint8Array::from(appearance.custom_skin.as_slice()).into(),
    )?;
    Ok(value)
}

/// The explicit paired lane accepts normalized own-data metadata only. It does
/// not resolve assets or turn unsupported faces into standard pupils.
pub(crate) fn standard_eyes(value: &JsValue) -> Result<StandardEyeGeometry, JsValue> {
    if value.is_instance_of::<js_sys::Promise>() {
        return Err(error("paired eye metadata must be synchronous"));
    }
    if text(field(value, "kind")?)? != "standard" {
        return Err(error("unsupported paired eye geometry"));
    }
    if integer(field(value, "outlineColor")?, 0, 16_777_215)? != 0
        || num(field(value, "angleSmoothing")?, 0., 1.)?.to_bits() != 0.12_f64.to_bits()
    {
        return Err(error(
            "unsupported eye outline color or effective smoothing",
        ));
    }
    let rgb = |key| -> Result<[u8; 3], JsValue> {
        let packed = integer(field(value, key)?, 0, 16_777_215)? as u32;
        let bytes = packed.to_be_bytes();
        Ok([bytes[1], bytes[2], bytes[3]])
    };
    Ok(StandardEyeGeometry {
        forward: num(field(value, "distance")?, 0., 4096.)?,
        separation: num(field(value, "separation")?, 0., 4096.)?,
        eye_radius: num(field(value, "radius")?, 0., 4096.)?,
        pupil_radius: num(field(value, "pupilRadius")?, 0., 4096.)?,
        pupil_travel: num(field(value, "pupilTravel")?, 0., 4096.)?,
        outline_width: num(field(value, "outlineWidth")?, 0., 4096.)?,
        eye_color: rgb("eyeColor")?,
        pupil_color: rgb("pupilColor")?,
        eye_alpha: num(field(value, "eyeOpacity")?, 0., 1.)?,
        pupil_alpha: num(field(value, "pupilOpacity")?, 0., 1.)?,
    })
}

/// Coherence requires the retained bits, including signed zero. Ordinary model
/// PartialEq remains unchanged for callers that want numeric equality.
pub(crate) fn same_eyes(a: &StandardEyeGeometry, b: &StandardEyeGeometry) -> bool {
    a.eye_color == b.eye_color
        && a.pupil_color == b.pupil_color
        && [
            (a.forward, b.forward),
            (a.separation, b.separation),
            (a.eye_radius, b.eye_radius),
            (a.pupil_radius, b.pupil_radius),
            (a.pupil_travel, b.pupil_travel),
            (a.outline_width, b.outline_width),
            (a.eye_alpha, b.eye_alpha),
            (a.pupil_alpha, b.pupil_alpha),
        ]
        .iter()
        .all(|(a, b)| a.to_bits() == b.to_bits())
}

fn side_geometry(value: &JsValue) -> Result<PairedSideGeometry, JsValue> {
    Ok(PairedSideGeometry {
        forward: num(field(value, "forward")?, 0., 4096.)?,
        lateral: num(field(value, "lateral")?, 0., 4096.)?,
        lateral_bias: num(field(value, "lateralBias")?, 0., 4096.)?,
        rotation_offset: num(field(value, "rotationOffset")?, 0., std::f64::consts::PI)?,
        image_scale: num(field(value, "imageScale")?, f64::from_bits(1), 256.)?,
        pivot_x: num(field(value, "pivotX")?, -65535., 65535.)?,
        pivot_y: num(field(value, "pivotY")?, -65535., 65535.)?,
        width: num(field(value, "width")?, f64::from_bits(1), 65535.)?,
        height: num(field(value, "height")?, f64::from_bits(1), 65535.)?,
    })
}

/// Explicit numeric callback has no provider envelope or readiness dependency.
pub(crate) fn paired_face(value: &JsValue) -> Result<PairedFaceGeometry, JsValue> {
    if value.is_instance_of::<js_sys::Promise>() {
        return Err(error("face metadata must be synchronous"));
    }
    let decoration = field(value, "decoration")?;
    let decoration = match text(field(&decoration, "kind")?)?.as_str() {
        "none" => None,
        "paired-side-images" => Some(side_geometry(&field(&decoration, "geometry")?)?),
        _ => return Err(error("unsupported face decoration")),
    };
    Ok(PairedFaceGeometry {
        eyes: standard_eyes(&field(value, "eyes")?)?,
        decoration,
    })
}

fn revision(value: JsValue) -> Result<JsValue, JsValue> {
    if let Some(s) = value.as_string() {
        if s.is_empty() || s.encode_utf16().count() > 128 {
            return Err(error("invalid revision"));
        }
    } else {
        let n = num(value.clone(), 0., 9_007_199_254_740_991.)?;
        if n.fract() != 0. {
            return Err(error("invalid revision"));
        }
    }
    Ok(value)
}

pub(crate) struct FaceDecoration {
    pub(crate) geometry: PairedSideGeometry,
    asset: BodyAsset,
    source_rect: Option<BodyRect>,
}

pub(crate) fn same_decoration(a: Option<&FaceDecoration>, b: Option<&PairedSideGeometry>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => a.geometry.same_bits(b),
        _ => false,
    }
}

/// Each callback gets a new plain request and a copied custom byte array.
pub(crate) fn request(
    ordinal: usize,
    own: bool,
    snake: &SnakePresentation,
) -> Result<Object, JsValue> {
    let m = snake.metrics();
    if !m.corrected_head.x.is_finite() || !m.corrected_head.y.is_finite() {
        return Err(error("nonfinite recipe request head"));
    }
    let value = Object::new();
    for (key, n) in [
        ("skin", f64::from(m.skin)),
        ("cosmetic", f64::from(snake.cosmetic())),
        ("x", m.corrected_head.x),
        ("y", m.corrected_head.y),
        ("drawOrdinal", ordinal as f64),
        ("id", f64::from(m.id)),
    ] {
        set(&value, key, &JsValue::from_f64(n))?;
    }
    set(&value, "own", &JsValue::from_bool(own))?;
    set(
        &value,
        "customBytes",
        &Uint8Array::from(snake.custom_skin()).into(),
    )?;
    Ok(value)
}

enum Source {
    Canvas(HtmlCanvasElement),
    Image(HtmlImageElement),
}

struct BorrowedSource {
    source: Source,
    object: JsValue,
    revision: JsValue,
    width: u32,
    height: u32,
}

impl BorrowedSource {
    fn validate(&self, target: &HtmlCanvasElement) -> Result<(), JsValue> {
        if self.object == JsValue::from(target.clone()) {
            return Err(error("body source aliases target"));
        }
        let (width, height, ready) = match &self.source {
            Source::Canvas(c) => (c.width(), c.height(), true),
            Source::Image(i) => (i.natural_width(), i.natural_height(), i.complete()),
        };
        if !ready || width != self.width || height != self.height {
            return Err(error("borrowed source changed or is not ready"));
        }
        Ok(())
    }
}

/// Per-call lifetime only. Aliased catalog entries share a source handle; no
/// borrowed object, revision or recipe survives in AnimatedScene after drawing.
#[derive(Default)]
pub(crate) struct BorrowedSources {
    sources: Vec<BorrowedSource>,
    revisions: Vec<JsValue>,
    catalog_entries: usize,
    uses: usize,
}

impl BorrowedSources {
    pub(crate) fn validate_food(
        &self,
        foods: &crate::food_browser::FoodSources,
    ) -> Result<(), JsValue> {
        for source in &self.sources {
            foods.validate_shared(
                &source.object,
                &source.revision,
                source.width,
                source.height,
            )?;
        }
        Ok(())
    }

    pub(crate) fn validate(&self, target: &HtmlCanvasElement) -> Result<(), JsValue> {
        for source in &self.sources {
            source.validate(target)?;
        }
        Ok(())
    }

    /// A normalized face-only projection can be ready while unrelated body
    /// assets are pending. The caller owns the projection's feature coverage.
    pub(crate) fn resolve_face(
        &mut self,
        callback: &Function,
        request: &Object,
        retained: &PairedFaceGeometry,
        target: &HtmlCanvasElement,
    ) -> Result<Option<FaceDecoration>, JsValue> {
        let value = callback.call1(&JsValue::UNDEFINED, request)?;
        if value.is_instance_of::<js_sys::Promise>() {
            return Err(error("face source must be synchronous"));
        }
        let revision = revision(field(&value, "revision")?)?;
        if !same_eyes(&standard_eyes(&field(&value, "eyes")?)?, &retained.eyes) {
            return Err(error(
                "recipe eyes differ from retained appearance geometry",
            ));
        }
        let raw = field(&value, "decoration")?;
        if raw.is_undefined() {
            return Err(error("explicit face decoration or null required"));
        }
        let decoration =
            self.decoration(&raw, &mut Vec::new(), &mut Vec::new(), &revision, target)?;
        if !same_decoration(decoration.as_ref(), retained.decoration.as_ref()) {
            return Err(error(
                "recipe decoration differs from retained appearance geometry",
            ));
        }
        Ok(decoration)
    }

    fn decoration(
        &mut self,
        value: &JsValue,
        assets: &mut Vec<BodyAsset>,
        catalog_ids: &mut Vec<usize>,
        revision: &JsValue,
        target: &HtmlCanvasElement,
    ) -> Result<Option<FaceDecoration>, JsValue> {
        if value.is_null() || value.is_undefined() {
            return Ok(None);
        }
        if text(field(value, "kind")?)? != "paired-side-images" {
            return Err(error("unsupported face decoration"));
        }
        let geometry = side_geometry(&field(value, "geometry")?)?;
        let usage = self.usage(
            assets,
            catalog_ids,
            &field(value, "image")?,
            revision,
            target,
        )?;
        Ok(Some(FaceDecoration {
            geometry,
            asset: assets[usage.asset],
            source_rect: usage.source_rect,
        }))
    }

    pub(crate) fn resolve(
        &mut self,
        callback: &Function,
        request: &Object,
        target: &HtmlCanvasElement,
    ) -> Result<Recipe, JsValue> {
        let snapshot = callback.call1(&JsValue::UNDEFINED, request)?;
        if snapshot.is_instance_of::<js_sys::Promise>() {
            return Err(error("recipe must be synchronous"));
        }
        integer(field(&snapshot, "schema")?, 1, 1)?;
        if text(field(&snapshot, "status")?)? != "ready" {
            return Err(error("standard body recipe is pending or unsupported"));
        }
        let revision = revision(field(&snapshot, "revision")?)?;
        let raw = field(&snapshot, "recipe")?;
        if !field(&raw, "attachment")?.is_null() {
            return Err(error("attachments are unsupported by standard renderer"));
        }
        if !list(field(&raw, "unsupportedFeatures")?, 0, 256)?.is_empty() {
            return Err(error("unsupported standard recipe features"));
        }
        let mut features = Vec::new();
        for feature in list(field(&raw, "supportedFeatures")?, 1, 8)? {
            let feature = text(feature)?;
            if ![
                "body-palettes",
                "standard-eyes",
                "outline",
                "shadow",
                "death-highlight",
                "standard-body-style",
                "paired-side-images",
            ]
            .contains(&feature.as_str())
                || features.contains(&feature)
            {
                return Err(error("unsupported standard recipe feature"));
            }
            features.push(feature);
        }
        let eyes = field(&raw, "eyes")?;
        let eyes = match text(field(&eyes, "kind")?)?.as_str() {
            "none" => None,
            "standard" => Some(standard_eyes(&eyes)?),
            _ => return Err(error("unsupported eye geometry")),
        };
        let decoration = field(&raw, "faceDecoration")?;
        let has_decoration = !decoration.is_null() && !decoration.is_undefined();
        if features.len() != 5 + usize::from(eyes.is_some()) + usize::from(has_decoration)
            || features.iter().any(|f| f == "standard-eyes") != eyes.is_some()
            || features.iter().any(|f| f == "paired-side-images") != has_decoration
            || (has_decoration && eyes.is_none())
        {
            return Err(error("inconsistent standard feature metadata"));
        }
        let mut recipe = Recipe {
            palettes: Vec::new(),
            assets: Vec::new(),
            catalog_ids: Vec::new(),
            runs: Vec::new(),
            base_palette: 0,
            variant_mode: BodyVariantMode::First,
            variant_period: 1,
            custom: flag(field(&raw, "custom")?)?,
            eyes,
            decoration: None,
            style: BodyStyle {
                detailed_segments: false,
                swell: 0.,
                rotate_segments: false,
                head_fade: None,
                tail_fade: None,
            },
            effects: [None; 3],
        };
        recipe.decoration = self.decoration(
            &decoration,
            &mut recipe.assets,
            &mut recipe.catalog_ids,
            &revision,
            target,
        )?;
        for palette in list(field(&raw, "palettes")?, 1, 256)? {
            let mut variants = Vec::new();
            for usage in list(field(&palette, "variants")?, 1, 256)? {
                variants.push(self.usage(
                    &mut recipe.assets,
                    &mut recipe.catalog_ids,
                    &usage,
                    &revision,
                    target,
                )?);
            }
            let glow = field(&palette, "boostGlow")?;
            let glow = if glow.is_undefined() {
                None
            } else {
                Some(self.usage(
                    &mut recipe.assets,
                    &mut recipe.catalog_ids,
                    &glow,
                    &revision,
                    target,
                )?)
            };
            recipe.palettes.push((variants, glow));
        }
        recipe.base_palette = integer(field(&raw, "basePalette")?, 0, recipe.palettes.len() - 1)?;
        recipe.variant_period = integer(field(&raw, "variantPeriod")?, 1, 256)?;
        recipe.variant_mode = match text(field(&raw, "variantMode")?)?.as_str() {
            "first" => BodyVariantMode::First,
            "cycle" => BodyVariantMode::Cycle,
            "ping-pong" => BodyVariantMode::PingPong,
            _ => return Err(error("invalid variant mode")),
        };
        if recipe.custom && recipe.variant_mode != BodyVariantMode::First {
            return Err(error("custom recipe requires first variant mode"));
        }
        let mut total = 0;
        for run in list(field(&raw, "runs")?, 1, 256)? {
            let palette = integer(field(&run, "palette")?, 0, recipe.palettes.len() - 1)?;
            let count = integer(field(&run, "count")?, 1, 65_535)?;
            total += count;
            if total > 65_535 {
                return Err(error("run count limit"));
            }
            recipe.runs.push(BodyRun { palette, count });
        }
        let style = field(&raw, "bodyStyle")?;
        let fade = |key| -> Result<Option<BodyFade>, JsValue> {
            let value = field(&style, key)?;
            if value.is_null() {
                return Ok(None);
            }
            Ok(Some(BodyFade {
                palette: integer(field(&value, "palette")?, 0, recipe.palettes.len() - 1)?,
                length: num(field(&value, "length")?, f64::from_bits(1), 65_535.)?,
            }))
        };
        recipe.style = BodyStyle {
            detailed_segments: flag(field(&style, "detailedSegments")?)?,
            swell: num(field(&style, "swell")?, -4096., 4096.)?,
            rotate_segments: flag(field(&style, "rotateSegments")?)?,
            head_fade: fade("headFade")?,
            tail_fade: fade("tailFade")?,
        };
        for (index, (variants, glow)) in recipe.palettes.iter().enumerate() {
            if (index == recipe.base_palette || recipe.runs.iter().any(|r| r.palette == index))
                && (variants.len() < recipe.variant_period || glow.is_none())
            {
                return Err(error("standard palette lacks variants or glow"));
            }
        }
        for effect in list(field(&raw, "effects")?, 3, 3)? {
            let index = match text(field(&effect, "kind")?)?.as_str() {
                "outline" => 0,
                "shadow" => 1,
                "death-highlight" => 2,
                _ => return Err(error("unsupported standard effect")),
            };
            if recipe.effects[index].is_some() || num(field(&effect, "opacity")?, 1., 1.)? != 1. {
                return Err(error("invalid shared standard effect"));
            }
            recipe.effects[index] = Some(self.usage(
                &mut recipe.assets,
                &mut recipe.catalog_ids,
                &effect,
                &revision,
                target,
            )?);
        }
        Ok(recipe)
    }

    fn usage(
        &mut self,
        assets: &mut Vec<BodyAsset>,
        catalog_ids: &mut Vec<usize>,
        value: &JsValue,
        revision: &JsValue,
        target: &HtmlCanvasElement,
    ) -> Result<BodyAssetUse, JsValue> {
        self.uses += 1;
        if self.uses > 262_144 {
            return Err(error("frame asset-use budget exceeded"));
        }
        let raw = field(value, "asset")?;
        let id = integer(field(&raw, "id")?, 0, 4095)?;
        if text(field(&raw, "status")?)? != "ready" {
            return Err(error("body asset is not ready"));
        }
        let width = integer(field(&raw, "width")?, 1, 65_535)? as u32;
        let height = integer(field(&raw, "height")?, 1, 65_535)? as u32;
        let object = field(&raw, "source")?;
        let kind = text(field(&raw, "kind")?)?;
        let source = match kind.as_str() {
            "canvas" => Source::Canvas(
                object
                    .clone()
                    .dyn_into()
                    .map_err(|_| error("body asset is not a canvas"))?,
            ),
            "image" => Source::Image(
                object
                    .clone()
                    .dyn_into()
                    .map_err(|_| error("body asset is not an image"))?,
            ),
            _ => return Err(error("unsupported body source kind")),
        };
        let borrowed = BorrowedSource {
            source,
            object,
            revision: revision.clone(),
            width,
            height,
        };
        borrowed.validate(target)?;
        let handle = if let Some(index) = self
            .sources
            .iter()
            .position(|s| s.object == borrowed.object)
        {
            let prior = &self.sources[index];
            if !Object::is(&prior.revision, revision)
                || prior.width != width
                || prior.height != height
            {
                return Err(error("incoherent aliased source revision or dimensions"));
            }
            index
        } else {
            if self.sources.len() >= 4096 {
                return Err(error("frame source budget exceeded"));
            }
            self.sources.push(borrowed);
            self.sources.len() - 1
        };
        let revision_token =
            if let Some(index) = self.revisions.iter().position(|v| Object::is(v, revision)) {
                index
            } else {
                self.revisions.push(revision.clone());
                self.revisions.len() - 1
            };
        let asset = BodyAsset {
            handle: handle as u64,
            revision: revision_token as u64,
            width,
            height,
            status: BodyAssetStatus::Ready,
        };
        let asset_index = if let Some(index) = catalog_ids.iter().position(|v| *v == id) {
            if assets[index] != asset {
                return Err(error("incoherent catalog entry"));
            }
            index
        } else {
            self.catalog_entries += 1;
            if self.catalog_entries > 4096 {
                return Err(error("frame catalog budget exceeded"));
            }
            catalog_ids.push(id);
            assets.push(asset);
            assets.len() - 1
        };
        let rect = list(field(value, "sourceRect")?, 4, 4)?;
        let rect = BodyRect {
            x: num(rect[0].clone(), 0., 65_535.)?,
            y: num(rect[1].clone(), 0., 65_535.)?,
            width: num(rect[2].clone(), f64::from_bits(1), 65_535.)?,
            height: num(rect[3].clone(), f64::from_bits(1), 65_535.)?,
        };
        if rect.x + rect.width > f64::from(width) || rect.y + rect.height > f64::from(height) {
            return Err(error("body source rectangle exceeds source"));
        }
        let source_rect = match text(field(value, "sourceMode")?)?.as_str() {
            "crop" => Some(rect),
            "whole"
                if rect
                    == (BodyRect {
                        x: 0.,
                        y: 0.,
                        width: f64::from(width),
                        height: f64::from(height),
                    }) =>
            {
                None
            }
            _ => return Err(error("invalid body source mode")),
        };
        Ok(BodyAssetUse {
            asset: asset_index,
            source_rect,
        })
    }

    pub(crate) fn submit(
        &self,
        context: &CanvasRenderingContext2d,
        command: &BodyImageCommand,
    ) -> Result<(), JsValue> {
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.translate(command.center.x, command.center.y)?;
        context.translate(command.translation.x, command.translation.y)?;
        if let Some(angle) = command.rotation {
            context.rotate(angle)?;
        }
        // Every flattened command carries the planner's effective scoped alpha.
        // Assign the original request too, preserving Canvas's invalid-write rule.
        context.set_global_alpha(command.alpha.effective);
        context.set_global_alpha(command.alpha.requested);
        context.set_global_composite_operation(match command.blend {
            BodyBlend::SourceOver => "source-over",
            BodyBlend::Lighter => "lighter",
        })?;
        let d = command.destination;
        self.image(context, command.asset, command.source_rect, d)
    }

    /// One bounded pair, shared source identity, alpha one and source-over.
    /// Restore even when transform or image submission throws.
    pub(crate) fn submit_face(
        &self,
        context: &CanvasRenderingContext2d,
        decoration: &FaceDecoration,
        layouts: [PairedSideLayout; 2],
    ) -> Result<(), JsValue> {
        for layout in layouts {
            context.save();
            let result = (|| {
                context.set_transform(1., 0., 0., 1., 0., 0.)?;
                context.translate(layout.translation.x, layout.translation.y)?;
                context.rotate(layout.rotation)?;
                self.image(
                    context,
                    decoration.asset,
                    decoration.source_rect,
                    layout.destination,
                )
            })();
            context.restore();
            result?;
        }
        Ok(())
    }

    fn image(
        &self,
        context: &CanvasRenderingContext2d,
        asset: BodyAsset,
        rect: Option<BodyRect>,
        d: BodyRect,
    ) -> Result<(), JsValue> {
        let source = &self.sources[asset.handle as usize].source;
        match (source, rect) {
            (Source::Canvas(c), None) => context
                .draw_image_with_html_canvas_element_and_dw_and_dh(c, d.x, d.y, d.width, d.height),
            (Source::Image(i), None) => context
                .draw_image_with_html_image_element_and_dw_and_dh(i, d.x, d.y, d.width, d.height),
            (Source::Canvas(c), Some(s)) => context
                .draw_image_with_html_canvas_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
                    c, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height,
                ),
            (Source::Image(i), Some(s)) => context
                .draw_image_with_html_image_element_and_sw_and_sh_and_dx_and_dy_and_dw_and_dh(
                    i, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height,
                ),
        }
    }
}

pub(crate) struct Recipe {
    palettes: Vec<(Vec<BodyAssetUse>, Option<BodyAssetUse>)>,
    pub(crate) assets: Vec<BodyAsset>,
    catalog_ids: Vec<usize>,
    runs: Vec<BodyRun>,
    base_palette: usize,
    variant_mode: BodyVariantMode,
    variant_period: usize,
    custom: bool,
    pub(crate) eyes: Option<StandardEyeGeometry>,
    pub(crate) decoration: Option<FaceDecoration>,
    pub(crate) style: BodyStyle,
    effects: [Option<BodyAssetUse>; 3],
}

impl Recipe {
    pub(crate) fn palettes(&self) -> Vec<BodyPalette<'_>> {
        self.palettes
            .iter()
            .map(|(variants, boost_glow)| BodyPalette {
                variants,
                boost_glow: *boost_glow,
            })
            .collect()
    }

    pub(crate) fn borrowed<'a>(&'a self, palettes: &'a [BodyPalette<'a>]) -> BodyPaintRecipe<'a> {
        BodyPaintRecipe {
            base_palette: self.base_palette,
            palettes,
            runs: &self.runs,
            variant_mode: self.variant_mode,
            variant_period: self.variant_period,
            custom: self.custom,
            style: Some(self.style),
            outline: self.effects[0],
            shadow: self.effects[1],
            death: self.effects[2],
        }
    }
}
