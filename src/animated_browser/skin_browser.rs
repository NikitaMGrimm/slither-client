use super::*;

/// Pure stock numeric selection, copied into fresh JS records without scene state
/// or borrowed artwork. Source strings name existing authored binding slots.
#[wasm_bindgen]
pub fn resolve_skin(
    skin: u8,
    custom_bytes: &[u8],
    no_segment_rotation: bool,
) -> Result<JsValue, JsValue> {
    skin_record(native_resolve_skin(skin, custom_bytes, no_segment_rotation).map_err(error)?)
}

/// Pure local selection preserves standard palette IDs, run counts/order and
/// shading across procedural body families. Admitted custom runs retain normal
/// admission and first-variant shading. Built-ins 25/44/63/64 reuse ordinary
/// paired-eye policy; admitted custom runs keep plain eyes. Local body geometry
/// stays default, with no antenna or face images. Visual acceptance is separate.
#[wasm_bindgen]
pub fn resolve_local_skin(skin: u8, custom_bytes: &[u8]) -> Result<JsValue, JsValue> {
    skin_record(resolve_authored_local_skin(skin, custom_bytes).map_err(error)?)
}

/// Pure host-mask admission sharing the native custom-run palette policy.
#[wasm_bindgen]
pub fn stock_custom_palette_mask_valid(mask: &[u8]) -> bool {
    crate::presentation::stock_custom_palette_mask_valid(mask)
}

fn skin_fade_record(fade: Option<BodyFade>) -> Result<JsValue, JsValue> {
    match fade {
        None => Ok(JsValue::NULL),
        Some(fade) => record([
            ("palette", (fade.palette as u32).into()),
            ("length", fade.length.into()),
        ]),
    }
}

fn skin_whole_source(source: SkinSourceRole) -> Result<JsValue, JsValue> {
    record([
        ("source", source.as_str().into()),
        ("sourceMode", "whole".into()),
    ])
}

fn skin_image_record(image: SkinImage) -> Result<JsValue, JsValue> {
    match image.source_rect {
        None => skin_whole_source(image.source),
        Some(rect) => record([
            ("source", image.source.as_str().into()),
            (
                "sourceRect",
                [rect.x, rect.y, rect.width, rect.height]
                    .into_iter()
                    .map(JsValue::from)
                    .collect::<js_sys::Array>()
                    .into(),
            ),
        ]),
    }
}

fn skin_face_records(
    face: FaceGeometry,
    sources: SkinFaceSources,
) -> Result<(JsValue, JsValue), JsValue> {
    match (face, sources) {
        (FaceGeometry::Paired(face), sources) => {
            let eyes = face.eyes;
            let rgb =
                |[r, g, b]: [u8; 3]| (u32::from(r) << 16 | u32::from(g) << 8 | u32::from(b)).into();
            let eyes = record([
                ("kind", "standard".into()),
                ("distance", eyes.forward.into()),
                ("separation", eyes.separation.into()),
                ("radius", eyes.eye_radius.into()),
                ("pupilRadius", eyes.pupil_radius.into()),
                ("pupilTravel", eyes.pupil_travel.into()),
                ("outlineWidth", eyes.outline_width.into()),
                ("eyeColor", rgb(eyes.eye_color)),
                ("pupilColor", rgb(eyes.pupil_color)),
                ("outlineColor", 0.into()),
                ("eyeOpacity", eyes.eye_alpha.into()),
                ("pupilOpacity", eyes.pupil_alpha.into()),
                // The retained paired-eye timeline uses this fixed smoothing.
                ("angleSmoothing", 0.12.into()),
            ])?;
            let decoration = match (face.decoration, sources) {
                (None, SkinFaceSources::None) => JsValue::NULL,
                (Some(geometry), SkinFaceSources::PairedSide(source)) => record([
                    ("kind", "paired-side-images".into()),
                    ("source", source.as_str().into()),
                    (
                        "geometry",
                        record([
                            ("forward", geometry.forward.into()),
                            ("lateral", geometry.lateral.into()),
                            ("lateralBias", geometry.lateral_bias.into()),
                            ("rotationOffset", geometry.rotation_offset.into()),
                            ("imageScale", geometry.image_scale.into()),
                            ("pivotX", geometry.pivot_x.into()),
                            ("pivotY", geometry.pivot_y.into()),
                            ("width", geometry.width.into()),
                            ("height", geometry.height.into()),
                        ])?,
                    ),
                ])?,
                _ => return Err(error("inconsistent skin face sources")),
            };
            Ok((eyes, decoration))
        }
        (FaceGeometry::SingleImage(geometry), SkinFaceSources::SingleImage { base, pupil }) => {
            Ok((
                record([
                    ("kind", "single-image".into()),
                    (
                        "geometry",
                        record([
                            ("baseSize", geometry.base_size.into()),
                            ("pupilSize", geometry.pupil_size.into()),
                            ("pupilTravel", geometry.pupil_travel.into()),
                        ])?,
                    ),
                    ("baseImage", skin_image_record(base)?),
                    ("pupilImage", skin_image_record(pupil)?),
                ])?,
                JsValue::NULL,
            ))
        }
        (FaceGeometry::Mouth(geometry), SkinFaceSources::Mouth { eye_marks, mouth }) => Ok((
            record([
                ("kind", "mouth-face".into()),
                (
                    "geometry",
                    record([("pupilTravel", geometry.pupil_travel.into())])?,
                ),
                ("eyeMarks", skin_whole_source(eye_marks)?),
                ("mouth", skin_whole_source(mouth)?),
            ])?,
            JsValue::NULL,
        )),
        _ => Err(error("inconsistent skin face sources")),
    }
}

fn skin_record(skin: SkinDescriptor) -> Result<JsValue, JsValue> {
    let runs = js_sys::Array::new();
    for run in skin.runs {
        runs.push(&record([
            ("palette", (run.palette as u32).into()),
            ("count", (run.count as u32).into()),
        ])?);
    }
    let (eyes, face_decoration) = skin_face_records(skin.face, skin.face_sources)?;
    let antenna = match skin.antenna {
        None => JsValue::NULL,
        Some(antenna) => {
            let geometry = antenna.geometry;
            let bulb = geometry.bulb;
            record([
                ("source", antenna.source.as_str().into()),
                (
                    "geometry",
                    record([
                        ("kind", "ordinary-chain".into()),
                        ("nodes", (geometry.nodes as u32).into()),
                        ("outerColor", geometry.outer_color.into()),
                        ("innerColor", geometry.inner_color.into()),
                        ("innerOpacity", geometry.inner_opacity.into()),
                        (
                            "repeatedInnerStrokes",
                            geometry.repeated_inner_strokes.into(),
                        ),
                        ("rotateBulb", geometry.rotate_bulb.into()),
                        (
                            "bulb",
                            record([
                                ("offsetX", bulb.offset_x.into()),
                                ("offsetY", bulb.offset_y.into()),
                                ("width", bulb.width.into()),
                                ("height", bulb.height.into()),
                                ("scale", bulb.scale.into()),
                                ("opacity", bulb.opacity.into()),
                            ])?,
                        ),
                    ])?,
                ),
            ])?
        }
    };
    let style = skin.body_style;
    record([
        ("skin", skin.skin.into()),
        ("custom", skin.custom.into()),
        ("basePalette", (skin.base_palette as u32).into()),
        ("runs", runs.into()),
        (
            "variantMode",
            match skin.variant_mode {
                BodyVariantMode::First => "first",
                BodyVariantMode::Cycle => "cycle",
                BodyVariantMode::PingPong => "ping-pong",
            }
            .into(),
        ),
        ("variantPeriod", (skin.variant_period as u32).into()),
        (
            "bodyStyle",
            record([
                ("detailedSegments", style.detailed_segments.into()),
                ("swell", style.swell.into()),
                ("rotateSegments", style.rotate_segments.into()),
                ("headFade", skin_fade_record(style.head_fade)?),
                ("tailFade", skin_fade_record(style.tail_fade)?),
            ])?,
        ),
        ("eyes", eyes),
        ("faceDecoration", face_decoration),
        ("antenna", antenna),
        ("unsupportedFeatures", js_sys::Array::new().into()),
    ])
}
