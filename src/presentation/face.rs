//! Appearance-owned paired faces and the fixed, ordered two-image side lane.

use std::f64::consts::{FRAC_PI_2, PI};

use super::{BodyRect, EyeLayoutInput, PresentationError, StandardEyeGeometry, finite};
use crate::{math, state::Point};

/// Complete numeric style for the supported ordinary paired face. No asset or
/// host identifier is retained here; both side images share one draw-time use.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PairedFaceGeometry {
    /// Authoritative paired-eye style, including pupil travel during updates.
    pub eyes: StandardEyeGeometry,
    /// Optional fixed two-image lane, following both eye/pupil pairs.
    pub decoration: Option<PairedSideGeometry>,
}

impl PairedFaceGeometry {
    /// Validate before installing the appearance or computing any layouts.
    pub fn validate(&self) -> Result<(), PresentationError> {
        self.eyes.validate()?;
        if let Some(geometry) = self.decoration {
            geometry.validate()?;
        }
        Ok(())
    }
}

/// Geometric parameters of one symmetric side-image pair. The lateral bias is
/// unscaled; pivots and nominal dimensions are independent of source dimensions.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PairedSideGeometry {
    /// Forward distance before entity scaling, finite 0..=4096.
    pub forward: f64,
    /// Perpendicular distance before entity scaling, finite 0..=4096.
    pub lateral: f64,
    /// Additional unscaled perpendicular distance, finite 0..=4096.
    pub lateral_bias: f64,
    /// Symmetric rotation around the captured face heading, finite 0..=pi.
    pub rotation_offset: f64,
    /// Positive image multiplier after entity scale times zoom, at most 256.
    pub image_scale: f64,
    /// Signed nominal X pivot, magnitude at most 65535.
    pub pivot_x: f64,
    /// Signed nominal Y pivot, magnitude at most 65535.
    pub pivot_y: f64,
    /// Positive nominal width, at most 65535.
    pub width: f64,
    /// Positive nominal height, at most 65535.
    pub height: f64,
}

/// One screen-space image layout. Negative side is always submitted first.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PairedSideLayout {
    /// Single screen translation after an identity transform.
    pub translation: Point,
    /// Unnormalized rotation, separate from the translation.
    pub rotation: f64,
    /// Local destination rectangle, retaining multiplication order and zero signs.
    pub destination: BodyRect,
}

impl PairedSideGeometry {
    /// Enforce the same numeric envelope as the normalized provider boundary.
    pub fn validate(&self) -> Result<(), PresentationError> {
        if ![self.forward, self.lateral, self.lateral_bias]
            .iter()
            .all(|v| v.is_finite() && (0. ..=4096.).contains(v))
            || !self.rotation_offset.is_finite()
            || !(0. ..=PI).contains(&self.rotation_offset)
            || !self.image_scale.is_finite()
            || self.image_scale <= 0.
            || self.image_scale > 256.
            || ![self.pivot_x, self.pivot_y]
                .iter()
                .all(|v| v.is_finite() && (-65535. ..=65535.).contains(v))
            || ![self.width, self.height]
                .iter()
                .all(|v| v.is_finite() && *v > 0. && *v <= 65535.)
        {
            return Err(PresentationError);
        }
        Ok(())
    }

    /// Exact retained/draw-time coherence, including every signed zero.
    pub fn same_bits(&self, other: &Self) -> bool {
        [
            self.forward,
            self.lateral,
            self.lateral_bias,
            self.rotation_offset,
            self.image_scale,
            self.pivot_x,
            self.pivot_y,
            self.width,
            self.height,
        ]
        .iter()
        .zip([
            other.forward,
            other.lateral,
            other.lateral_bias,
            other.rotation_offset,
            other.image_scale,
            other.pivot_x,
            other.pivot_y,
            other.width,
            other.height,
        ])
        .all(|(a, b)| a.to_bits() == b.to_bits())
    }

    /// Derive both images from the same captured face/view as the paired eyes.
    /// Death/spawn/quality and pupils do not modulate this alpha-one lane.
    pub fn layout(
        &self,
        heading: f64,
        view: EyeLayoutInput,
    ) -> Result<[PairedSideLayout; 2], PresentationError> {
        self.validate()?;
        finite(&[
            heading,
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
        let multiplier = (view.scale * view.zoom) * self.image_scale;
        let lateral = self.lateral * view.scale + self.lateral_bias;
        let forward_x = (math::cos(heading) * self.forward) * view.scale;
        let forward_y = (math::sin(heading) * self.forward) * view.scale;
        let destination = BodyRect {
            x: -self.pivot_x * multiplier,
            y: -self.pivot_y * multiplier,
            width: self.width * multiplier,
            height: self.height * multiplier,
        };
        finite(&[
            multiplier,
            lateral,
            forward_x,
            forward_y,
            destination.x,
            destination.y,
            destination.width,
            destination.height,
        ])?;
        let side = |angle: f64, rotation: f64| -> Result<PairedSideLayout, PresentationError> {
            let local_x = forward_x + math::cos(angle) * lateral;
            let local_y = forward_y + math::sin(angle) * lateral;
            let translation = Point {
                x: view.viewport_half.x
                    + ((local_x + view.corrected_head.x) - view.camera.x) * view.zoom,
                y: view.viewport_half.y
                    + ((local_y + view.corrected_head.y) - view.camera.y) * view.zoom,
            };
            finite(&[
                angle,
                rotation,
                local_x,
                local_y,
                translation.x,
                translation.y,
            ])?;
            Ok(PairedSideLayout {
                translation,
                rotation,
                destination,
            })
        };
        Ok([
            side(heading - FRAC_PI_2, heading - self.rotation_offset)?,
            side(heading + FRAC_PI_2, heading + self.rotation_offset)?,
        ])
    }
}
