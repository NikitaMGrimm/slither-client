//! Retained background phase and backend-neutral numeric draw layers.
//!
//! The caller supplies camera positions from the same draw in one coordinate
//! system. The asset-mapping layer supplies the image and repeating-pattern
//! sources. This primitive owns no renderer objects or animation clock.

use crate::{
    presentation::{PresentationError, QualitySnapshot},
    state::Point,
};

/// Fractional tile displacement, retained independently of zoom and viewport.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BackgroundState {
    phase: Point,
}

/// Frozen draw inputs, borrowing the applied quality values without updating them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BackgroundInput {
    /// Viewport backing width in pixels.
    pub width: u32,
    /// Viewport backing height in pixels.
    pub height: u32,
    /// Positive world-to-screen scale for the repeating pattern.
    pub zoom: f64,
    /// Full dimensions of the ready screen-filling image, or no image.
    pub image_size: Option<[u32; 2]>,
    /// Whether a repeating source is available for this draw.
    pub pattern_available: bool,
    /// Read-only applied quality; only HQ and blend affect the image gate.
    pub quality: QualitySnapshot,
    /// Repeating source width in world units.
    pub tile_width: f64,
    /// Repeating source height in world units.
    pub tile_height: f64,
}

/// Black clear first, then optional image, then optional repeating pattern.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BackgroundPlan {
    /// Opaque solid layer covering the viewport.
    pub clear: BackgroundSolidLayer,
    /// Screen-filling image layer, when ready and quality permits it.
    pub image: Option<BackgroundImageLayer>,
    /// Repeating world-scaled layer, when its source is available.
    pub pattern: Option<BackgroundPatternLayer>,
}

/// First layer, in screen coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BackgroundSolidLayer {
    /// x, y, width, height.
    pub rect: [f64; 4],
    /// Red, green and blue channels.
    pub color: [u8; 3],
    /// Solid layer opacity.
    pub alpha: f64,
}

/// Second layer, using the mapped image source and screen coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BackgroundImageLayer {
    /// Source crop: x, y, width, height.
    pub source: [f64; 4],
    /// Screen destination: x, y, width, height.
    pub destination: [f64; 4],
    /// Independent of quality blend.
    pub alpha: f64,
}

/// Third layer, using the mapped repeating-pattern source.
/// Its numeric transform is center translation, uniform scale, then phase
/// translation, in that order; all fields are independent of a graphics API.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BackgroundPatternLayer {
    /// Screen-space translation applied first.
    pub center: Point,
    /// Uniform scale applied second.
    pub zoom: f64,
    /// Pattern-space phase translation applied third.
    pub translation: Point,
    /// Pattern-space rectangle: x, y, width, height.
    pub fill: [f64; 4],
    /// Repeating layer opacity.
    pub alpha: f64,
}

impl BackgroundState {
    /// Start with an explicit phase in 0..=1, preserving negative zero.
    /// One is possible when adding one to a tiny negative remainder rounds up.
    /// The zero default is an authored initial state, not a world-reset policy.
    pub fn new(phase: Point) -> Result<Self, PresentationError> {
        if ![phase.x, phase.y]
            .into_iter()
            .all(|value| (0. ..=1.).contains(&value))
        {
            return Err(PresentationError);
        }
        Ok(Self { phase })
    }

    /// Current fractional tile displacement, including computed signed zeros.
    pub fn phase(&self) -> Point {
        self.phase
    }

    /// Advance once per background draw, even when neither source is available.
    /// Previous/current camera values are explicit: this primitive does not infer
    /// first-draw, reconnect or no-own-camera behavior. Failure preserves phase.
    pub fn advance_draw(
        &mut self,
        previous_camera: Point,
        camera: Point,
        tile_width: f64,
        tile_height: f64,
    ) -> Result<(), PresentationError> {
        if ![
            previous_camera.x,
            previous_camera.y,
            camera.x,
            camera.y,
            tile_width,
            tile_height,
        ]
        .into_iter()
        .all(f64::is_finite)
            || tile_width <= 0.
            || tile_height <= 0.
        {
            return Err(PresentationError);
        }
        let axis = |phase: f64, previous: f64, current: f64, tile: f64| {
            // Divide the displacement before subtracting from retained phase.
            // Remainder and a strict negative check retain a computed -0.
            let mut next = phase - (current - previous) * 1. / tile;
            next %= 1.;
            if next < 0. {
                next += 1.;
            }
            next
        };
        let phase = Point {
            x: axis(self.phase.x, previous_camera.x, camera.x, tile_width),
            y: axis(self.phase.y, previous_camera.y, camera.y, tile_height),
        };
        if !phase.x.is_finite() || !phase.y.is_finite() {
            return Err(PresentationError);
        }
        self.phase = phase;
        Ok(())
    }

    /// Project without advancing phase, camera, quality or a resize clock.
    /// The image gate uses applied HQ or a positive blend; its alpha stays 0.3.
    pub fn plan(&self, input: BackgroundInput) -> Result<BackgroundPlan, PresentationError> {
        if input.width == 0
            || input.height == 0
            || input.image_size.is_some_and(|size| size.contains(&0))
            || !input.zoom.is_finite()
            || input.zoom <= 0.
            || !input.tile_width.is_finite()
            || !input.tile_height.is_finite()
            || input.tile_width <= 0.
            || input.tile_height <= 0.
            || !(0. ..=1.).contains(&input.quality.quality_blend)
        {
            return Err(PresentationError);
        }
        let width = f64::from(input.width);
        let height = f64::from(input.height);
        let clear = BackgroundSolidLayer {
            rect: [0., 0., width, height],
            color: [0, 0, 0],
            alpha: 1.,
        };
        let image = input
            .image_size
            .filter(|_| input.quality.high_quality || input.quality.quality_blend > 0.)
            .map(|[source_width, source_height]| BackgroundImageLayer {
                source: [0., 0., f64::from(source_width), f64::from(source_height)],
                destination: clear.rect,
                alpha: 0.3,
            });
        let pattern = if input.pattern_available {
            let translation = Point {
                x: self.phase.x * input.tile_width,
                y: self.phase.y * input.tile_height,
            };
            let fill = [
                -width * 3. / input.zoom,
                -height * 3. / input.zoom,
                width * 5. / input.zoom,
                height * 5. / input.zoom,
            ];
            if !fill
                .into_iter()
                .chain([translation.x, translation.y])
                .all(f64::is_finite)
            {
                return Err(PresentationError);
            }
            Some(BackgroundPatternLayer {
                center: Point {
                    x: width / 2.,
                    y: height / 2.,
                },
                zoom: input.zoom,
                translation,
                fill,
                alpha: 1.,
            })
        } else {
            None
        };
        Ok(BackgroundPlan {
            clear,
            image,
            pattern,
        })
    }
}
