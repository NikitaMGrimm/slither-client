//! Complete three-image mouth geometry on the existing face and gaze timeline.

use std::f64::consts::FRAC_PI_2;

use super::{BodyRect, EyeLayoutInput, PresentationError, finite};
use crate::{math, state::Point};

/// Appearance-owned pupil travel; image sources belong to the draw caller.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MouthFaceGeometry {
    /// Nonnegative world-axis pupil travel, finite and at most 4096.
    pub pupil_travel: f64,
}

/// One whole-source image with separate screen translation and local rotation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MouthImageLayout {
    /// Screen translation after an identity transform.
    pub translation: Point,
    /// Captured, unnormalized face heading.
    pub rotation: f64,
    /// Local destination, independent of intrinsic source dimensions.
    pub destination: BodyRect,
}

/// Complete exclusive face; submission establishes the modeled root alpha one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MouthFaceLayout {
    /// Negative-side mark, positive-side mark, then mouth.
    pub images: [MouthImageLayout; 3],
}

impl MouthFaceGeometry {
    /// Validate appearance metadata before any update or layout.
    pub fn validate(&self) -> Result<(), PresentationError> {
        if !self.pupil_travel.is_finite() || !(0. ..=4096.).contains(&self.pupil_travel) {
            return Err(PresentationError);
        }
        Ok(())
    }

    /// Exact appearance/draw coherence, including accepted negative zero.
    pub fn same_bits(&self, other: &Self) -> bool {
        self.pupil_travel.to_bits() == other.pupil_travel.to_bits()
    }

    /// Lay out all three images using the captured heading and world-axis gaze.
    pub fn layout(
        &self,
        face_heading: f64,
        pupil: Point,
        view: EyeLayoutInput,
    ) -> Result<MouthFaceLayout, PresentationError> {
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

        let mark_forward = -3. * view.scale;
        let lateral = 7. * view.scale;
        let mouth_forward = 5. * view.scale;
        let scaled_zoom = view.scale * view.zoom;
        let mark_multiplier = scaled_zoom * 0.25;
        let mouth_multiplier = scaled_zoom * 0.16;
        // The half-unit biases follow entity scaling and must not be scaled again.
        let mark_distance = mark_forward + 0.5;
        let mouth_distance = mouth_forward + 0.5;
        let forward_cos = math::cos(face_heading);
        let forward_sin = math::sin(face_heading);
        let pupil_x = pupil.x * view.scale;
        let pupil_y = pupil.y * view.scale;
        let mark_x = forward_cos * mark_distance;
        let mark_y = forward_sin * mark_distance;
        let mouth_x = forward_cos * mouth_distance;
        let mouth_y = forward_sin * mouth_distance;
        let mark_gaze_x = mark_x + pupil_x;
        let mark_gaze_y = mark_y + pupil_y;
        let mouth_gaze_x = mouth_x + pupil_x;
        let mouth_gaze_y = mouth_y + pupil_y;
        finite(&[
            mark_forward,
            lateral,
            mouth_forward,
            scaled_zoom,
            mark_multiplier,
            mouth_multiplier,
            mark_distance,
            mouth_distance,
            forward_cos,
            forward_sin,
            pupil_x,
            pupil_y,
            mark_x,
            mark_y,
            mouth_x,
            mouth_y,
            mark_gaze_x,
            mark_gaze_y,
            mouth_gaze_x,
            mouth_gaze_y,
        ])?;
        let mark_destination = BodyRect {
            x: -24. * mark_multiplier,
            y: -24. * mark_multiplier,
            width: 48. * mark_multiplier,
            height: 48. * mark_multiplier,
        };
        let mouth_destination = BodyRect {
            x: -40. * mouth_multiplier,
            y: -65. * mouth_multiplier,
            width: 79. * mouth_multiplier,
            height: 130. * mouth_multiplier,
        };
        let image = |x: f64, y: f64, destination: BodyRect| {
            // Absolute-head addition precedes camera cancellation, even at large magnitudes.
            let head_x = x + view.corrected_head.x;
            let head_y = y + view.corrected_head.y;
            let relative_x = head_x - view.camera.x;
            let relative_y = head_y - view.camera.y;
            let screen_x = relative_x * view.zoom;
            let screen_y = relative_y * view.zoom;
            let translation = Point {
                x: view.viewport_half.x + screen_x,
                y: view.viewport_half.y + screen_y,
            };
            finite(&[
                x,
                y,
                head_x,
                head_y,
                relative_x,
                relative_y,
                screen_x,
                screen_y,
                translation.x,
                translation.y,
                destination.x,
                destination.y,
                destination.width,
                destination.height,
            ])?;
            Ok(MouthImageLayout {
                translation,
                rotation: face_heading,
                destination,
            })
        };
        let mark = |side: f64| -> Result<MouthImageLayout, PresentationError> {
            let side_cos = math::cos(side);
            let side_sin = math::sin(side);
            let side_x = side_cos * lateral;
            let side_y = side_sin * lateral;
            finite(&[side, side_cos, side_sin, side_x, side_y])?;
            image(mark_gaze_x + side_x, mark_gaze_y + side_y, mark_destination)
        };
        Ok(MouthFaceLayout {
            images: [
                mark(face_heading - FRAC_PI_2)?,
                mark(face_heading + FRAC_PI_2)?,
                image(mouth_gaze_x, mouth_gaze_y, mouth_destination)?,
            ],
        })
    }
}
