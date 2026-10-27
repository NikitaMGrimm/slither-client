//! Generalized numeric face metadata and draw-local borrowed face selections.

use wasm_bindgen::prelude::*;

use crate::antenna_browser::{AntennaDecoration, geometry};
use crate::body_browser::{FaceDecoration, error, field, num, side_geometry, standard_eyes, text};
use crate::presentation::{
    AccessoryPresentation, BodyAsset, BodyRect, FaceGeometry, FacePresentation, MouthFaceGeometry,
    PairedFaceGeometry, SingleEyeGeometry, StandardEyeGeometry, StaticHeadAccessoryGeometry,
};

pub(crate) struct SingleEyeSources {
    pub(crate) geometry: SingleEyeGeometry,
    pub(crate) images: [(BodyAsset, BodyRect); 2],
}

pub(crate) struct MouthFaceSources {
    pub(crate) geometry: MouthFaceGeometry,
    pub(crate) eye_marks: BodyAsset,
    pub(crate) mouth: BodyAsset,
}

pub(crate) enum FaceSources {
    Paired {
        eyes: StandardEyeGeometry,
        decoration: Option<FaceDecoration>,
    },
    SingleImage(SingleEyeSources),
    Mouth(MouthFaceSources),
}

pub(crate) struct FacePresentationSources {
    pub(crate) face: FaceSources,
    pub(crate) antenna: Option<AntennaDecoration>,
}

pub(crate) struct AccessorySources {
    pub(crate) geometry: StaticHeadAccessoryGeometry,
    pub(crate) asset: BodyAsset,
    pub(crate) source_rect: BodyRect,
}

pub(crate) fn accessory_geometry(
    value: &JsValue,
    scale_key: &str,
) -> Result<StaticHeadAccessoryGeometry, JsValue> {
    let geometry = StaticHeadAccessoryGeometry {
        forward: num(field(value, "forward")?, 0., 4096.)?,
        image_scale: num(field(value, scale_key)?, f64::from_bits(1), 256.)?,
        pivot_x: num(field(value, "pivotX")?, -65_535., 65_535.)?,
        pivot_y: num(field(value, "pivotY")?, -65_535., 65_535.)?,
    };
    geometry.validate().map_err(error)?;
    Ok(geometry)
}

/// The additive callback requires an explicit selection; legacy shapes stay unchanged.
pub(crate) fn accessory_appearance(value: &JsValue) -> Result<AccessoryPresentation, JsValue> {
    let presentation = appearance(value)?;
    let raw = field(value, "accessory")?;
    let accessory = if raw.is_null() {
        None
    } else {
        if matches!(presentation.face, FaceGeometry::SingleImage(_)) {
            return Err(error("single image eyes cannot have a static accessory"));
        }
        Some(accessory_geometry(&raw, "imageScale")?)
    };
    Ok(AccessoryPresentation {
        presentation,
        accessory,
    })
}

pub(crate) fn single_eye_geometry(value: &JsValue) -> Result<SingleEyeGeometry, JsValue> {
    let geometry = SingleEyeGeometry {
        base_size: num(field(value, "baseSize")?, f64::from_bits(1), 4096.)?,
        pupil_size: num(field(value, "pupilSize")?, f64::from_bits(1), 4096.)?,
        pupil_travel: num(field(value, "pupilTravel")?, 0., 4096.)?,
    };
    geometry.validate().map_err(error)?;
    Ok(geometry)
}

pub(crate) fn mouth_geometry(value: &JsValue) -> Result<MouthFaceGeometry, JsValue> {
    let geometry = MouthFaceGeometry {
        pupil_travel: num(field(value, "pupilTravel")?, 0., 4096.)?,
    };
    geometry.validate().map_err(error)?;
    Ok(geometry)
}

/// Numeric appearance installation has no source or readiness dependency.
pub(crate) fn appearance(value: &JsValue) -> Result<FacePresentation, JsValue> {
    let face = field(value, "face")?;
    let face = match text(field(&face, "kind")?)?.as_str() {
        "paired" => {
            let decoration = field(&face, "decoration")?;
            let decoration = if decoration.is_null() {
                None
            } else {
                match text(field(&decoration, "kind")?)?.as_str() {
                    "none" => None,
                    "paired-side-images" => Some(side_geometry(&field(&decoration, "geometry")?)?),
                    _ => return Err(error("unsupported face decoration")),
                }
            };
            FaceGeometry::Paired(PairedFaceGeometry {
                eyes: standard_eyes(&field(&face, "eyes")?)?,
                decoration,
            })
        }
        "single-image" => {
            let decoration = field(&face, "decoration")?;
            if !decoration.is_null() && !decoration.is_undefined() {
                return Err(error("single image eyes cannot have paired decoration"));
            }
            FaceGeometry::SingleImage(single_eye_geometry(&field(&face, "geometry")?)?)
        }
        "mouth-face" => {
            let decoration = field(&face, "decoration")?;
            if !decoration.is_null() && !decoration.is_undefined() {
                return Err(error("mouth faces cannot have paired decoration"));
            }
            FaceGeometry::Mouth(mouth_geometry(&field(&face, "geometry")?)?)
        }
        _ => return Err(error("unsupported face family")),
    };
    face.validate().map_err(error)?;
    let antenna = field(value, "antenna")?;
    if antenna.is_undefined() {
        return Err(error("explicit appearance antenna or null required"));
    }
    Ok(FacePresentation {
        face,
        antenna: if antenna.is_null() {
            None
        } else {
            Some(geometry(&antenna)?)
        },
    })
}
