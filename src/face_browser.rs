//! Generalized numeric face metadata and draw-local borrowed face selections.

use wasm_bindgen::prelude::*;

use crate::antenna_browser::{AntennaDecoration, geometry};
use crate::body_browser::{FaceDecoration, error, field, num, side_geometry, standard_eyes, text};
use crate::presentation::{
    BodyAsset, BodyRect, FaceGeometry, FacePresentation, PairedFaceGeometry, SingleEyeGeometry,
    StandardEyeGeometry,
};

pub(crate) struct SingleEyeSources {
    pub(crate) geometry: SingleEyeGeometry,
    pub(crate) images: [(BodyAsset, BodyRect); 2],
}

pub(crate) enum FaceSources {
    Paired {
        eyes: StandardEyeGeometry,
        decoration: Option<FaceDecoration>,
    },
    SingleImage(SingleEyeSources),
}

pub(crate) struct FacePresentationSources {
    pub(crate) face: FaceSources,
    pub(crate) antenna: Option<AntennaDecoration>,
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
