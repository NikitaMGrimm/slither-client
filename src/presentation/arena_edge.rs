//! Fixed double-precision arena-edge geometry, independent of update clocks.

use super::{PI, PresentationError, finite};
use crate::{math, state::Point};

/// Retained arena center and draw-prepared camera polar coordinates.
/// Angle and distance remain stale on draws without the original own object.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArenaEdgeView {
    center: f64,
    angle: f64,
    distance: f64,
}

impl Default for ArenaEdgeView {
    fn default() -> Self {
        Self {
            center: 16384.,
            angle: 0.,
            distance: 0.,
        }
    }
}

impl ArenaEdgeView {
    /// Construct a frozen view; the center is the absolute coordinate on both axes.
    pub fn new(center: f64, angle: f64, distance: f64) -> Result<Self, PresentationError> {
        finite(&[center, angle, distance])?;
        if center <= 0. || distance < 0. {
            return Err(PresentationError);
        }
        Ok(Self {
            center,
            angle,
            distance,
        })
    }

    /// Absolute arena center coordinate, shared by x and y.
    pub fn center(self) -> f64 {
        self.center
    }

    /// Retained camera angle in radians, increasing toward positive screen y.
    pub fn angle(self) -> f64 {
        self.angle
    }

    /// Retained camera distance from the arena center, in world units.
    pub fn distance(self) -> f64 {
        self.distance
    }

    pub(super) fn set_center(&mut self, center: f64) -> Result<(), PresentationError> {
        *self = Self::new(center, self.angle, self.distance)?;
        Ok(())
    }

    pub(super) fn prepare_draw(&mut self, camera: Point) -> Result<(), PresentationError> {
        let dx = camera.x - self.center;
        let dy = camera.y - self.center;
        let angle = math::atan2(dy, dx);
        let distance = (dx * dx + dy * dy).sqrt();
        *self = Self::new(self.center, angle, distance)?;
        Ok(())
    }
}

/// Frozen draw inputs; radius is the displayed easing output and may be zero.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArenaEdgeInput {
    /// Event-time center and retained camera polar coordinates.
    pub view: ArenaEdgeView,
    /// Current absolute camera position, independently of retained polar coordinates.
    pub camera: Point,
    /// Positive backing-pixel scale per world unit.
    pub zoom: f64,
    /// Desired backing width in pixels.
    pub width: u32,
    /// Desired backing height in pixels.
    pub height: u32,
    /// Current displayed radius, without a received-target substitution.
    pub radius: f64,
}

/// Screen-coordinate paths: close and fill the band, then stroke the open inner path.
#[derive(Clone, Debug, PartialEq)]
pub struct ArenaEdgePlan {
    /// Initial move point, 41 inner line points, then 41 outer return points.
    pub fill: [Point; 83],
    /// Initial move point and 41 inner line points, including the duplicate start.
    pub stroke: [Point; 42],
    /// Backing-pixel stroke width.
    pub line_width: f64,
}

/// Plan both complete paths before submission, or omit them at the strict distance gate.
/// This has no quality, visibility, connection, lifecycle or update-clock input.
pub fn plan_arena_edge(input: ArenaEdgeInput) -> Result<Option<ArenaEdgePlan>, PresentationError> {
    finite(&[input.camera.x, input.camera.y, input.zoom, input.radius])?;
    if input.width == 0 || input.height == 0 || input.zoom <= 0. || input.radius < 0. {
        return Err(PresentationError);
    }
    let line_width = 23. * input.zoom;
    finite(&[line_width])?;
    if (input.radius - input.view.distance).abs() >= 4000. {
        return Ok(None);
    }
    let mut plan = ArenaEdgePlan {
        fill: [Point::default(); 83],
        stroke: [Point::default(); 42],
        line_width,
    };
    let project = |angle, radius| -> Result<Point, PresentationError> {
        // Keep absolute center addition before camera subtraction; no Float32 boundary.
        let ax = input.view.center + math::cos(angle) * radius;
        let ay = input.view.center + math::sin(angle) * radius;
        let x = f64::from(input.width) / 2. + (ax - input.camera.x) * input.zoom;
        let y = f64::from(input.height) / 2. + (ay - input.camera.y) * input.zoom;
        finite(&[ax, ay, x, y])?;
        Ok(Point { x, y })
    };
    for pass in 0..2 {
        let mut k = input.radius;
        // Division by computed zero intentionally selects this fallback.
        if 4000. / input.radius > 2. * PI {
            k = 4000. / (2. * PI);
        }
        let points = if pass == 0 {
            &mut plan.fill[..]
        } else {
            &mut plan.stroke[..]
        };
        points[0] = project(input.view.angle - 2000. / k, input.radius)?;
        for (index, j) in (-2000..=2000).step_by(100).enumerate() {
            points[index + 1] = project(input.view.angle + f64::from(j) / k, input.radius)?;
        }
        if pass == 0 {
            for index in 0..=40 {
                let j = 2000 - index as i32 * 100;
                points[index + 42] =
                    project(input.view.angle + f64::from(j) / k, input.radius + 4000.)?;
            }
        }
    }
    Ok(Some(plan))
}
