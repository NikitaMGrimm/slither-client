//! Camera following and automatic zoom have an explicit draw clock.

use super::{CameraCorrections, PresentationError, finite};
use crate::state::Point;

/// Initial desktop zoom before draw-driven length adjustment.
pub const INITIAL_ZOOM: f64 = 0.9 * 18. / 14.;

/// Absolute camera position, zoom, and independently sampled correction state.
#[derive(Clone, Debug, PartialEq)]
pub struct FollowCamera {
    position: Point,
    zoom: f64,
    follows: bool,
    corrections: CameraCorrections,
}

impl Default for FollowCamera {
    fn default() -> Self {
        Self {
            position: Point::default(),
            zoom: INITIAL_ZOOM,
            follows: true,
            corrections: CameraCorrections::default(),
        }
    }
}

impl FollowCamera {
    /// Clear draw corrections and restore initial zoom, retaining position and preference.
    pub(crate) fn reset_world(&mut self) {
        self.zoom = INITIAL_ZOOM;
        self.corrections = CameraCorrections::default();
    }

    /// Initialize at the newest own body anchor; the head remains separate.
    pub fn new(position: Point, zoom: f64) -> Result<Self, PresentationError> {
        finite(&[position.x, position.y, zoom])?;
        if zoom <= 0. {
            return Err(PresentationError);
        }
        Ok(Self {
            position,
            zoom,
            ..Self::default()
        })
    }

    /// Toggle following without discarding pending draw samples or moving now.
    pub fn set_follows(&mut self, follows: bool) {
        self.follows = follows;
    }

    /// Set a finite absolute camera position for explicit view control.
    pub fn set_position(&mut self, position: Point) -> Result<(), PresentationError> {
        finite(&[position.x, position.y])?;
        self.position = position;
        Ok(())
    }

    /// Set a positive zoom; automatic adjustment resumes on the next draw.
    pub fn set_zoom(&mut self, zoom: f64) -> Result<(), PresentationError> {
        finite(&[zoom])?;
        if zoom <= 0. {
            return Err(PresentationError);
        }
        self.zoom = zoom;
        Ok(())
    }

    /// Schedule an own anchor after head correction has committed.
    /// The discontinuity uses the prior displayed head, even with follow off.
    /// Current camera offsets remain unchanged until a draw consumes a sample.
    pub fn reanchor(
        &mut self,
        previous_head: Point,
        corrected_head: Point,
    ) -> Result<(), PresentationError> {
        finite(&[
            previous_head.x,
            previous_head.y,
            corrected_head.x,
            corrected_head.y,
        ])?;
        let position = if self.follows {
            corrected_head
        } else {
            self.position
        };
        let mut corrections = self.corrections.clone();
        corrections.inject(Point {
            x: position.x - previous_head.x,
            y: position.y - previous_head.y,
        })?;
        self.position = position;
        self.corrections = corrections;
        Ok(())
    }

    /// Prepare one draw while an own object exists, including after its removal
    /// from the visible collection. Calls without an own object must skip this.
    /// Zoom and camera samples advance once per call, independently of updates.
    pub fn prepare_draw(
        &mut self,
        corrected_head: Point,
        logical_segments: u32,
    ) -> Result<(), PresentationError> {
        finite(&[corrected_head.x, corrected_head.y])?;
        let target = 0.64285 + 0.514285714 / ((f64::from(logical_segments) + 16.) / 36.).max(1.);
        let zoom = if self.zoom < target {
            (self.zoom + 0.0002).min(target)
        } else if self.zoom > target {
            (self.zoom - 0.0002).max(target)
        } else {
            self.zoom
        };
        let mut corrections = self.corrections.clone();
        corrections.advance_draw();
        let offset = corrections.offset();
        let position = if self.follows {
            Point {
                x: corrected_head.x + offset.x,
                y: corrected_head.y + offset.y,
            }
        } else {
            self.position
        };
        finite(&[position.x, position.y, zoom])?;
        self.position = position;
        self.zoom = zoom;
        self.corrections = corrections;
        Ok(())
    }

    /// Absolute camera coordinates from the latest anchor or prepared draw.
    pub fn position(&self) -> Point {
        self.position
    }

    /// Current desktop zoom.
    pub fn zoom(&self) -> f64 {
        self.zoom
    }

    /// Whether the next anchor/draw follows the own head.
    pub fn follows(&self) -> bool {
        self.follows
    }

    /// Read-only draw-clock corrections and diagnostic samples.
    pub fn corrections(&self) -> &CameraCorrections {
        &self.corrections
    }
}
