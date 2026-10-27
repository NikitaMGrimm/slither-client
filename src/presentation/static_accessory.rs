//! Numeric placement of one ready-source static head image, independent of gaze.

use super::{BodyRect, EyeLayoutInput, PresentationError, finite};
use crate::{math, state::Point};

/// Appearance-owned geometry; source dimensions and objects are draw-local inputs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StaticHeadAccessoryGeometry {
    /// Forward distance before entity scaling, finite 0..=4096.
    pub forward: f64,
    /// Positive image multiplier after entity scale times zoom, at most 256.
    pub image_scale: f64,
    /// Signed nominal X pivot, magnitude at most 65535.
    pub pivot_x: f64,
    /// Signed nominal Y pivot, magnitude at most 65535.
    pub pivot_y: f64,
}

/// One fixed image placement, including its squared spawn/death opacity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StaticHeadAccessoryLayout {
    /// Screen translation, applied separately from rotation.
    pub translation: Point,
    /// Captured unnormalized face heading.
    pub rotation: f64,
    /// Local destination; finite zero sizes and signed zero pivots remain valid.
    pub destination: BodyRect,
    /// Squared spawn/death factor, independent of eyes, quality and boost.
    pub alpha: f64,
}

impl StaticHeadAccessoryGeometry {
    /// Validate the bounded appearance metadata without normalizing signed zeros.
    pub fn validate(&self) -> Result<(), PresentationError> {
        finite(&[self.forward, self.image_scale, self.pivot_x, self.pivot_y])?;
        if !(0. ..=4096.).contains(&self.forward)
            || self.image_scale <= 0.
            || self.image_scale > 256.
            || !(-65535. ..=65535.).contains(&self.pivot_x)
            || !(-65535. ..=65535.).contains(&self.pivot_y)
        {
            return Err(PresentationError);
        }
        Ok(())
    }

    /// Bit-exact appearance/draw coherence, including admitted negative zero.
    pub fn same_bits(&self, other: &Self) -> bool {
        [self.forward, self.image_scale, self.pivot_x, self.pivot_y]
            .into_iter()
            .zip([
                other.forward,
                other.image_scale,
                other.pivot_x,
                other.pivot_y,
            ])
            .all(|(a, b)| a.to_bits() == b.to_bits())
    }

    /// Lay out one origin-crop image in the captured face/view, without pupil input.
    /// Every intermediate is checked before later cancellation or underflow can hide it.
    pub fn layout(
        &self,
        face_heading: f64,
        source_extent: Point,
        spawn_progress: f64,
        view: EyeLayoutInput,
    ) -> Result<StaticHeadAccessoryLayout, PresentationError> {
        self.validate()?;
        finite(&[
            face_heading,
            source_extent.x,
            source_extent.y,
            spawn_progress,
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
        if source_extent.x <= 0.
            || source_extent.x > 65535.
            || source_extent.y <= 0.
            || source_extent.y > 65535.
            || !(0. ..=1.).contains(&spawn_progress)
            || !(0. ..1.).contains(&view.death_progress)
            || view.scale <= 0.
            || view.zoom <= 0.
            || view.viewport_half.x < 0.
            || view.viewport_half.y < 0.
        {
            return Err(PresentationError);
        }
        let distance = self.forward * view.scale;
        let scale_zoom = view.scale * view.zoom;
        finite(&[distance, scale_zoom])?;
        let offset_x = math::cos(face_heading) * distance;
        let offset_y = math::sin(face_heading) * distance;
        let multiplier = scale_zoom * self.image_scale;
        finite(&[offset_x, offset_y, multiplier])?;
        let head_x = offset_x + view.corrected_head.x;
        let head_y = offset_y + view.corrected_head.y;
        finite(&[head_x, head_y])?;
        let relative_x = head_x - view.camera.x;
        let relative_y = head_y - view.camera.y;
        finite(&[relative_x, relative_y])?;
        let screen_x = relative_x * view.zoom;
        let screen_y = relative_y * view.zoom;
        finite(&[screen_x, screen_y])?;
        let translation = Point {
            x: view.viewport_half.x + screen_x,
            y: view.viewport_half.y + screen_y,
        };
        let destination = BodyRect {
            x: (-multiplier) * self.pivot_x,
            y: (-multiplier) * self.pivot_y,
            width: multiplier * source_extent.x,
            height: multiplier * source_extent.y,
        };
        let remaining = 1. - view.death_progress;
        let fade = spawn_progress * remaining;
        let alpha = fade * fade;
        finite(&[
            translation.x,
            translation.y,
            destination.x,
            destination.y,
            destination.width,
            destination.height,
            remaining,
            fade,
            alpha,
        ])?;
        Ok(StaticHeadAccessoryLayout {
            translation,
            rotation: face_heading,
            destination,
            alpha,
        })
    }
}
