//! Fresh copied source-plan ABI. Browser source objects never cross this boundary.

use wasm_bindgen::{JsCast, prelude::*};

use crate::authored_sources::{CanvasRecipe, EntitySourcePalette, PaintCommand};

fn object() -> js_sys::Object {
    // Null prototypes prevent inherited setters while copying data into records.
    js_sys::Object::create(&JsValue::NULL.unchecked_into())
}

fn record(fields: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let result = object();
    for (key, value) in fields {
        if !js_sys::Reflect::set(&result, &JsValue::from_str(key), value)? {
            return Err(JsValue::from_str("Cannot copy authored source recipe"));
        }
    }
    Ok(result.into())
}

fn array(values: impl IntoIterator<Item = JsValue>) -> Result<JsValue, JsValue> {
    let result = js_sys::Array::new();
    for (index, value) in values.into_iter().enumerate() {
        let property = object();
        for (key, value) in [
            ("value", value),
            ("writable", JsValue::TRUE),
            ("enumerable", JsValue::TRUE),
            ("configurable", JsValue::TRUE),
        ] {
            js_sys::Reflect::set(&property, &key.into(), &value)?;
        }
        if !js_sys::Reflect::define_property(&result, &index.to_string().into(), &property)? {
            return Err(JsValue::from_str("Cannot copy authored source array"));
        }
    }
    Ok(result.into())
}

fn numbers(values: &[f64]) -> Result<JsValue, JsValue> {
    array(values.iter().copied().map(JsValue::from))
}

fn command(command: &PaintCommand) -> Result<JsValue, JsValue> {
    let (name, values): (&str, Vec<JsValue>) = match command {
        PaintCommand::FillStyle(color) => ("fillStyle", vec![color.into()]),
        PaintCommand::GlobalAlpha(alpha) => ("globalAlpha", vec![(*alpha).into()]),
        PaintCommand::BeginPath => ("beginPath", vec![]),
        PaintCommand::ClosePath => ("closePath", vec![]),
        PaintCommand::Fill => ("fill", vec![]),
        PaintCommand::Arc(values) => ("arc", values.iter().copied().map(JsValue::from).collect()),
        PaintCommand::MoveTo(values) => (
            "moveTo",
            values.iter().copied().map(JsValue::from).collect(),
        ),
        PaintCommand::LineTo(values) => (
            "lineTo",
            values.iter().copied().map(JsValue::from).collect(),
        ),
        PaintCommand::FillRect(values) => (
            "fillRect",
            values.iter().copied().map(JsValue::from).collect(),
        ),
        PaintCommand::RadialGradient { circles, stops } => (
            "radialGradient",
            vec![
                numbers(circles)?,
                array(
                    stops
                        .iter()
                        .map(|(offset, color)| array([(*offset).into(), color.into()]))
                        .collect::<Result<Vec<_>, _>>()?,
                )?,
            ],
        ),
    };
    array(std::iter::once(name.into()).chain(values))
}

fn canvas(recipe: &CanvasRecipe) -> Result<JsValue, JsValue> {
    record(&[
        ("width", recipe.width.into()),
        ("height", recipe.height.into()),
        ("halfWidth", recipe.half_width.into()),
        ("halfHeight", recipe.half_height.into()),
        (
            "commands",
            array(
                recipe
                    .commands
                    .iter()
                    .map(command)
                    .collect::<Result<Vec<_>, _>>()?,
            )?,
        ),
    ])
}

fn canvases(recipes: &[CanvasRecipe]) -> Result<JsValue, JsValue> {
    array(recipes.iter().map(canvas).collect::<Result<Vec<_>, _>>()?)
}

fn entities(palettes: &[EntitySourcePalette]) -> Result<JsValue, JsValue> {
    array(
        palettes
            .iter()
            .map(|palette| {
                record(&[
                    ("color", palette.color.into()),
                    ("count", (palette.count as u32).into()),
                    ("bodies", canvases(&palette.bodies)?),
                    ("outlines", canvases(&palette.outlines)?),
                    ("glows", canvases(&palette.glows)?),
                ])
            })
            .collect::<Result<Vec<_>, _>>()?,
    )
}

/// Copy the existing authored local source recipes without a scene or browser resource.
#[wasm_bindgen]
pub fn authored_source_recipes() -> Result<JsValue, JsValue> {
    let recipes = crate::authored_sources::authored_source_recipes();
    let body = &recipes.body_sources;
    record(&[
        ("schema", 1.into()),
        (
            "paletteRgb",
            array(
                recipes
                    .palette_rgb
                    .into_iter()
                    .map(|rgb| array(rgb.into_iter().map(JsValue::from)))
                    .collect::<Result<Vec<_>, _>>()?,
            )?,
        ),
        ("palettes", canvases(&recipes.palettes)?),
        ("tile", canvas(&recipes.tile)?),
        ("backdrop", canvas(&recipes.backdrop)?),
        (
            "bodySources",
            record(&[
                (
                    "palettes",
                    array(
                        body.palettes
                            .iter()
                            .map(|palette| {
                                record(&[
                                    ("variants", canvases(&palette.variants)?),
                                    ("boostGlow", canvas(&palette.boost_glow)?),
                                ])
                            })
                            .collect::<Result<Vec<_>, _>>()?,
                    )?,
                ),
                (
                    "effects",
                    record(&[
                        ("outline", canvas(&body.outline)?),
                        ("shadow", canvas(&body.shadow)?),
                        ("deathHighlight", canvas(&body.death_highlight)?),
                    ])?,
                ),
            ])?,
        ),
        ("food", entities(&recipes.food)?),
        ("prey", entities(&recipes.prey)?),
    ])
}
