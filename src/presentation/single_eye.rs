//! Appearance-owned image eyes, sharing the existing face and gaze timeline.

use super::{
    BodyRect, EyeLayoutInput, MouthFaceGeometry, PairedFaceGeometry, PresentationError, finite,
};
use crate::{math, state::Point};

/// Authoritative numeric face family. Image sources belong to the draw caller.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FaceGeometry {
    /// Ordinary paired eyes and their optional fixed side images.
    Paired(PairedFaceGeometry),
    /// One image eye followed by one image pupil.
    SingleImage(SingleEyeGeometry),
    /// Two gaze-following marks followed by a mouth image.
    Mouth(MouthFaceGeometry),
}

impl Default for FaceGeometry {
    fn default() -> Self {
        Self::Paired(PairedFaceGeometry::default())
    }
}

impl FaceGeometry {
    /// Validate the selected family before installing it on an appearance.
    pub fn validate(&self) -> Result<(), PresentationError> {
        match self {
            Self::Paired(geometry) => geometry.validate(),
            Self::SingleImage(geometry) => geometry.validate(),
            Self::Mouth(geometry) => geometry.validate(),
        }
    }

    /// Selected world-axis pupil travel, consumed by the shared update clock.
    pub fn pupil_travel(&self) -> f64 {
        match self {
            Self::Paired(geometry) => geometry.eyes.pupil_travel,
            Self::SingleImage(geometry) => geometry.pupil_travel,
            Self::Mouth(geometry) => geometry.pupil_travel,
        }
    }

    /// Paired-only metadata; a single image face has no paired substitute.
    pub fn paired(&self) -> Option<&PairedFaceGeometry> {
        match self {
            Self::Paired(geometry) => Some(geometry),
            Self::SingleImage(_) | Self::Mouth(_) => None,
        }
    }

    /// Image-eye metadata, without selecting or retaining artwork.
    pub fn single_image(&self) -> Option<&SingleEyeGeometry> {
        match self {
            Self::Paired(_) | Self::Mouth(_) => None,
            Self::SingleImage(geometry) => Some(geometry),
        }
    }

    /// Complete three-image mouth metadata, without retaining artwork.
    pub fn mouth(&self) -> Option<&MouthFaceGeometry> {
        match self {
            Self::Mouth(geometry) => Some(geometry),
            Self::Paired(_) | Self::SingleImage(_) => None,
        }
    }
}

/// Destination sizes and update-time pupil travel, independent of source dimensions.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SingleEyeGeometry {
    /// Positive unscaled square eye-base size, at most 4096.
    pub base_size: f64,
    /// Positive unscaled square pupil size, at most 4096.
    pub pupil_size: f64,
    /// Nonnegative world-axis pupil travel, at most 4096.
    pub pupil_travel: f64,
}

/// Base image then pupil image, using identity screen coordinates and explicit crops.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SingleEyeLayout {
    /// Ordered destination rectangles; neither image is rotated.
    pub destinations: [BodyRect; 2],
    /// Assign once before the base; the pupil inherits this death-only alpha.
    pub alpha: f64,
}

impl SingleEyeGeometry {
    /// Enforce finite appearance metadata before any update or draw.
    pub fn validate(&self) -> Result<(), PresentationError> {
        if ![self.base_size, self.pupil_size]
            .iter()
            .all(|value| value.is_finite() && *value > 0. && *value <= 4096.)
            || !self.pupil_travel.is_finite()
            || !(0. ..=4096.).contains(&self.pupil_travel)
        {
            return Err(PresentationError);
        }
        Ok(())
    }

    /// Exact appearance/draw coherence, including accepted signed-zero travel.
    pub fn same_bits(&self, other: &Self) -> bool {
        self.base_size.to_bits() == other.base_size.to_bits()
            && self.pupil_size.to_bits() == other.pupil_size.to_bits()
            && self.pupil_travel.to_bits() == other.pupil_travel.to_bits()
    }

    /// Read-only layout from a previously captured face heading and world-axis pupil.
    /// The forward pupil bias follows entity scaling; centering precedes camera subtraction.
    pub fn layout(
        &self,
        face_heading: f64,
        pupil: Point,
        view: EyeLayoutInput,
    ) -> Result<SingleEyeLayout, PresentationError> {
        self.validate()?;
        finite(&[
            face_heading,
            pupil.x,
            pupil.y,
            view.corrected_head.x,
            view.corrected_head.y,
            view.camera.x,
            view.camera.y,
            view.viewport_half.x,
            view.viewport_half.y,
            view.scale,
            view.zoom,
            view.death_progress,
        ])?;
        if view.scale <= 0.
            || view.zoom <= 0.
            || view.viewport_half.x < 0.
            || view.viewport_half.y < 0.
            || !(0. ..1.).contains(&view.death_progress)
        {
            return Err(PresentationError);
        }
        let forward = 3. * view.scale;
        let base_x = math::cos(face_heading) * forward;
        let base_y = math::sin(face_heading) * forward;
        let pupil_forward = forward + 0.15;
        let pupil_x = math::cos(face_heading) * pupil_forward + pupil.x * view.scale;
        let pupil_y = math::sin(face_heading) * pupil_forward + pupil.y * view.scale;
        finite(&[forward, base_x, base_y, pupil_forward, pupil_x, pupil_y])?;
        let destination = |x: f64, y: f64, size: f64| -> Result<BodyRect, PresentationError> {
            let size = view.scale * size;
            let head_x = x + view.corrected_head.x;
            let head_y = y + view.corrected_head.y;
            let centered_x = head_x - size / 2.;
            let centered_y = head_y - size / 2.;
            let relative_x = centered_x - view.camera.x;
            let relative_y = centered_y - view.camera.y;
            let screen_x = relative_x * view.zoom;
            let screen_y = relative_y * view.zoom;
            let rectangle = BodyRect {
                x: view.viewport_half.x + screen_x,
                y: view.viewport_half.y + screen_y,
                width: size * view.zoom,
                height: size * view.zoom,
            };
            finite(&[
                size,
                head_x,
                head_y,
                centered_x,
                centered_y,
                relative_x,
                relative_y,
                screen_x,
                screen_y,
                rectangle.x,
                rectangle.y,
                rectangle.width,
                rectangle.height,
            ])?;
            Ok(rectangle)
        };
        Ok(SingleEyeLayout {
            destinations: [
                destination(base_x, base_y, self.base_size)?,
                destination(pupil_x, pupil_y, self.pupil_size)?,
            ],
            alpha: if view.death_progress == 0. {
                1.
            } else {
                (1. - view.death_progress).sqrt()
            },
        })
    }
}
