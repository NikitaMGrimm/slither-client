//! Ready-only stock accessory selection and appearance-dependent forward policy.

use super::{FaceGeometry, PresentationError, StandardEyeGeometry, resolve_skin};

/// Admit the ordinary persisted decimal selection against the captured table.
/// Absent and `-1` mean no selection; noncanonical or out-of-table values reject.
/// This reads no storage, catalog entries, sources or wire cosmetic bytes.
pub fn stock_accessory_id(raw: Option<&str>, count: u32) -> Result<Option<u32>, PresentationError> {
    let Some(raw) = raw.filter(|value| *value != "-1") else {
        return Ok(None);
    };
    let id = raw.parse::<u32>().map_err(|_| PresentationError)?;
    if !(1..=4096).contains(&count) || id >= count || id.to_string() != raw {
        return Err(PresentationError);
    }
    Ok(Some(id))
}

/// Reuse the admitted face's ordinary head-forward distance, without gaze/bias.
/// Mouth retains the ordinary default; accepted custom runs suppress special
/// faces first. A selected SingleImage face is outside the accessory capability.
pub fn stock_accessory_forward(skin: u8, custom: &[u8]) -> Result<f64, PresentationError> {
    match resolve_skin(skin, custom, false)
        .map_err(|_| PresentationError)?
        .face
    {
        FaceGeometry::Paired(face) => Ok(face.eyes.forward),
        FaceGeometry::Mouth(_) => Ok(StandardEyeGeometry::default().forward),
        FaceGeometry::SingleImage(_) => Err(PresentationError),
    }
}
