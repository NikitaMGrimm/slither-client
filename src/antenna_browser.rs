//! Numeric ordinary-antenna metadata; borrowed sources live only in the draw pool.

use wasm_bindgen::prelude::*;

use crate::body_browser::{FaceDecoration, error, field, flag, integer, num, paired_face, text};
use crate::presentation::{
    AntennaBulbGeometry, AppearancePresentation, BodyAsset, OrdinaryAntennaGeometry,
};

pub(crate) struct AntennaDecoration {
    pub(crate) geometry: OrdinaryAntennaGeometry,
    pub(crate) asset: BodyAsset,
}

pub(crate) struct PresentationSources {
    pub(crate) decoration: Option<FaceDecoration>,
    pub(crate) antenna: Option<AntennaDecoration>,
}

// Native state deliberately has no post-bulb field. Reject it at the metadata
// boundary instead of silently losing a required stroke branch in conversion.
pub(crate) fn reject_post_bulb(value: &JsValue) -> Result<(), JsValue> {
    let post = field(value, "postBulbStrokes")?;
    if !post.is_undefined() && flag(post)? {
        return Err(error("post-bulb strokes are unsupported"));
    }
    Ok(())
}

pub(crate) fn geometry(value: &JsValue) -> Result<OrdinaryAntennaGeometry, JsValue> {
    if text(field(value, "kind")?)? != "ordinary-chain" {
        return Err(error("unsupported antenna topology"));
    }
    reject_post_bulb(value)?;
    let bulb = field(value, "bulb")?;
    let geometry = OrdinaryAntennaGeometry {
        nodes: integer(field(value, "nodes")?, 8, 11)?,
        outer_color: integer(field(value, "outerColor")?, 0, 0xff_ffff)? as u32,
        inner_color: integer(field(value, "innerColor")?, 0, 0xff_ffff)? as u32,
        inner_opacity: num(field(value, "innerOpacity")?, 0., 1.)?,
        repeated_inner_strokes: flag(field(value, "repeatedInnerStrokes")?)?,
        rotate_bulb: flag(field(value, "rotateBulb")?)?,
        bulb: AntennaBulbGeometry {
            offset_x: num(field(&bulb, "offsetX")?, -65_535., 65_535.)?,
            offset_y: num(field(&bulb, "offsetY")?, -65_535., 65_535.)?,
            width: num(field(&bulb, "width")?, f64::from_bits(1), 65_535.)?,
            height: num(field(&bulb, "height")?, f64::from_bits(1), 65_535.)?,
            scale: num(field(&bulb, "scale")?, f64::from_bits(1), 256.)?,
            opacity: num(field(&bulb, "opacity")?, 0., 1.)?,
        },
    };
    geometry.validate().map_err(error)?;
    Ok(geometry)
}

pub(crate) fn appearance(value: &JsValue) -> Result<AppearancePresentation, JsValue> {
    let antenna = field(value, "antenna")?;
    if antenna.is_undefined() {
        return Err(error("explicit appearance antenna or null required"));
    }
    Ok(AppearancePresentation {
        face: paired_face(&field(value, "face")?)?,
        antenna: if antenna.is_null() {
            None
        } else {
            Some(geometry(&antenna)?)
        },
    })
}

pub(crate) fn same_antenna(
    actual: Option<&AntennaDecoration>,
    retained: Option<&OrdinaryAntennaGeometry>,
) -> bool {
    match (actual, retained) {
        (None, None) => true,
        (Some(actual), Some(retained)) => actual.geometry.same_bits(retained),
        _ => false,
    }
}
