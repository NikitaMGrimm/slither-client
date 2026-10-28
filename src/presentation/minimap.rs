//! Native minimap images, retained transitions and backend-neutral widget data.
//!
//! Callers supply the original retained own head before prediction, the eased
//! boundary radius and samples of their existing clock. This module selects no
//! snake identities and owns no timer, connection, browser object or artwork.

use std::{f64::consts::PI, fmt};

use crate::{
    presentation::FrameStep,
    protocol::minimap::{MAX_MINIMAP_DIMENSION, MinimapDecodeError, MinimapFormat, MinimapPacket},
    state::{Point, Setup},
};

/// Effective composition of subsequent alternate-image pixel writes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MinimapComposite {
    /// An opaque write replaces the previous pixel.
    SourceOver,
    /// Opaque channels add with saturation until the next resize or Setup.
    Lighter,
}

/// Native admission or numeric failure.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MinimapError {
    /// A reachable wire run is incomplete.
    Decode(MinimapDecodeError),
    /// Initial Setup, or fresh Setup following reset, is required.
    MissingSetup,
    /// A used clock, delta, coordinate or derived value is invalid.
    InvalidNumericInput,
    /// Widget insets must be finite, nonnegative CSS pixels.
    InvalidLayout,
    /// A borrowed view has inconsistent dimensions, planes or scalars.
    InvalidRenderPlan,
}

impl fmt::Display for MinimapError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Decode(error) => error.fmt(f),
            Self::MissingSetup => f.write_str("minimap requires a fresh Setup"),
            Self::InvalidNumericInput => f.write_str("invalid minimap numeric input"),
            Self::InvalidLayout => f.write_str("invalid minimap layout"),
            Self::InvalidRenderPlan => f.write_str("inconsistent minimap render view"),
        }
    }
}

impl std::error::Error for MinimapError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Decode(error) => Some(error),
            _ => None,
        }
    }
}

impl From<MinimapDecodeError> for MinimapError {
    fn from(error: MinimapDecodeError) -> Self {
        Self::Decode(error)
    }
}

/// Event-time inputs copied from the existing scene update.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinimapUpdateInput {
    /// First sample of the caller's existing clock, in milliseconds.
    pub now_ms: f64,
    /// Shared lag-adjusted scene step, in eight-millisecond units.
    pub step: FrameStep,
    /// Existing connection gate, affecting fade and image transition only.
    pub connected: bool,
    /// Initialized Setup center, identical on both world axes.
    pub center: Option<f64>,
    /// Displayed boundary radius after the existing connected easing step.
    pub displayed_radius: Option<f64>,
    /// Raw absolute head of the original retained own object, before motion.
    pub own_raw_head: Option<Point>,
}

/// Two retained RGBA images and the separate binary toggle history.
#[derive(Clone, Debug, PartialEq)]
pub struct MinimapState {
    image_revision: u64,
    dimension: Option<u16>,
    base_rgba: Vec<u8>,
    alternate_rgba: Vec<u8>,
    toggles: Vec<u8>,
    composite: MinimapComposite,
    has_setup: bool,
    entering: bool,
    fade: f64,
    transition: f64,
    target_opacity: f64,
    base_opacity: f64,
    alternate_opacity: f64,
    holder_opacity: f64,
    last_marker_ms: f64,
    marker: Point,
    server_number: Option<u16>,
    game_mode: Option<u8>,
}

impl Default for MinimapState {
    fn default() -> Self {
        Self {
            image_revision: 0,
            dimension: None,
            base_rgba: Vec::new(),
            alternate_rgba: Vec::new(),
            toggles: Vec::new(),
            composite: MinimapComposite::SourceOver,
            has_setup: false,
            entering: false,
            fade: 0.,
            transition: 0.,
            target_opacity: 0.475,
            base_opacity: 0.475,
            alternate_opacity: 0.475,
            holder_opacity: 0.,
            last_marker_ms: 0.,
            marker: Point::default(),
            server_number: None,
            game_mode: None,
        }
    }
}

impl MinimapState {
    /// Force fresh 24-square planes and composition while retaining animation
    /// progress and marker history. This does not enable integrated team play.
    pub fn apply_setup(&mut self, setup: &Setup) -> Result<(), MinimapError> {
        self.target_opacity = if setup.game_mode == Some(2) {
            0.7
        } else {
            0.475
        };
        self.resize(24);
        self.has_setup = true;
        self.server_number = setup.server_number;
        self.game_mode = setup.game_mode;
        self.holder_opacity = 0.;
        self.image_revision = self.image_revision.wrapping_add(1);
        Ok(())
    }

    fn resize(&mut self, dimension: u16) {
        let cells = usize::from(dimension) * usize::from(dimension);
        self.base_rgba = vec![0; 4 * cells];
        self.alternate_rgba = vec![0; 4 * cells];
        self.toggles = vec![0; cells];
        self.dimension = Some(dimension);
        self.composite = MinimapComposite::SourceOver;
        self.base_opacity = self.target_opacity;
        self.alternate_opacity = self.target_opacity;
    }

    /// Apply a complete command. Reachable V operands are checked before any
    /// mutation; outer frame staging remains the integrating caller's concern.
    pub fn apply_packet(&mut self, packet: MinimapPacket<'_>) -> Result<(), MinimapError> {
        if !self.has_setup {
            return Err(MinimapError::MissingSetup);
        }
        let dimension = packet.dimension().unwrap_or(self.dimension.unwrap());
        packet.visit_selected(dimension, |_, _| {})?;
        let legacy = packet.format() == MinimapFormat::LegacyU;
        if legacy {
            self.entering = true;
        }
        if self.dimension != Some(dimension) {
            self.resize(dimension);
        }
        if legacy {
            self.base_rgba.fill(0);
        } else {
            // U deliberately keeps a stale base on repeated replacements.
            if (packet.format() == MinimapFormat::UpperU && !self.entering)
                || (packet.format() != MinimapFormat::UpperU && self.entering)
            {
                self.base_rgba.copy_from_slice(&self.alternate_rgba);
            }
            self.transition = 0.;
            self.base_opacity = self.target_opacity;
            self.alternate_opacity = 0.;
            if packet.format() != MinimapFormat::ToggleV {
                self.alternate_rgba.fill(0);
            }
            if packet.format() == MinimapFormat::SnapshotM {
                self.toggles.fill(0);
            }
            if packet.format() == MinimapFormat::LayeredL && packet.layer_count() == 2 {
                self.composite = MinimapComposite::Lighter;
            }
        }
        packet.visit_selected(dimension, |layer, index| {
            let pixel = 4 * index;
            if legacy {
                self.base_rgba[pixel..pixel + 4].copy_from_slice(&[255; 4]);
                return;
            }
            if packet.format() == MinimapFormat::ToggleV {
                self.toggles[index] ^= 1;
                if self.toggles[index] == 0 {
                    self.alternate_rgba[pixel..pixel + 4].fill(0);
                    return;
                }
            } else if packet.format() == MinimapFormat::SnapshotM {
                self.toggles[index] = 1;
            }
            let rgb = if packet.format() == MinimapFormat::LayeredL {
                if layer == 0 {
                    if packet.layer_count() == 2 {
                        [255, 128, 128]
                    } else {
                        [255; 3]
                    }
                } else {
                    [153, 170, 255]
                }
            } else {
                [255; 3]
            };
            for (channel, value) in rgb.into_iter().enumerate() {
                let cell = &mut self.alternate_rgba[pixel + channel];
                *cell = match self.composite {
                    MinimapComposite::SourceOver => value,
                    MinimapComposite::Lighter => cell.saturating_add(value),
                };
            }
            self.alternate_rgba[pixel + 3] = 255;
        })?;
        if !self.entering {
            self.entering = true;
            self.base_rgba.copy_from_slice(&self.alternate_rgba);
        }
        self.image_revision = self.image_revision.wrapping_add(1);
        Ok(())
    }

    /// Clear visual images and fade without hiding the holder or erasing toggle,
    /// transition, composition, dimension or marker history. Require new Setup.
    pub fn reset_world(&mut self) {
        self.base_rgba.fill(0);
        self.alternate_rgba.fill(0);
        self.fade = 0.;
        self.entering = false;
        self.has_setup = false;
        self.image_revision = self.image_revision.wrapping_add(1);
    }

    /// Whether this update needs one additional sample of the same clock.
    /// Equality at 150 milliseconds is not due. No connection/alive gate applies.
    pub fn marker_refresh_due(&self, input: MinimapUpdateInput) -> bool {
        self.dimension.is_some()
            && input.center.is_some()
            && input.own_raw_head.is_some()
            && input.now_ms - self.last_marker_ms > 150.
    }

    /// Advance from the existing scene step. When `marker_refresh_due` is true,
    /// `marker_sample_ms` must contain the fresh second clock sample; otherwise
    /// it is unused. All used numbers are validated before state changes.
    pub fn advance(
        &mut self,
        input: MinimapUpdateInput,
        marker_sample_ms: Option<f64>,
    ) -> Result<(), MinimapError> {
        if !input.now_ms.is_finite()
            || !input.step.delta.is_finite()
            || !(0. ..=5.).contains(&input.step.delta)
        {
            return Err(MinimapError::InvalidNumericInput);
        }
        let marker_update = if self.marker_refresh_due(input) {
            let sample = marker_sample_ms.ok_or(MinimapError::InvalidNumericInput)?;
            let center = input.center.unwrap();
            let head = input.own_raw_head.unwrap();
            let boundary = input
                .displayed_radius
                .ok_or(MinimapError::InvalidNumericInput)?;
            if ![sample, center, head.x, head.y, boundary]
                .into_iter()
                .all(f64::is_finite)
                || boundary <= 0.
            {
                return Err(MinimapError::InvalidNumericInput);
            }
            let radius = f64::from(self.dimension.unwrap()) / 2.;
            let project = |coordinate| {
                js_round(10. * (radius + 12. + radius * (coordinate - center) / boundary - 7.))
                    / 10.
            };
            let position = Point {
                x: project(head.x),
                y: project(head.y),
            };
            if !position.x.is_finite() || !position.y.is_finite() {
                return Err(MinimapError::InvalidNumericInput);
            }
            Some((sample, position))
        } else {
            None
        };
        if input.connected && self.entering {
            if self.fade != 1. {
                self.fade = (self.fade + 0.025).min(1.);
                self.holder_opacity = self.fade;
            }
            if self.transition < 1. {
                self.transition = (self.transition + input.step.delta / 230.).min(1.);
                self.base_opacity = self.target_opacity * (1. - self.transition);
                self.alternate_opacity = 1.
                    - (1. - self.target_opacity)
                        / (1. - self.target_opacity * (1. - self.transition));
            }
        }
        if let Some((sample, position)) = marker_update {
            self.last_marker_ms = sample;
            self.marker = position;
        }
        Ok(())
    }

    /// Apply an existing session UI-fraction observation in event order. Finite
    /// fractions are not clamped; this is a requested CSS opacity write.
    pub fn observe_ui_fraction(&mut self, fraction: f64) -> Result<(), MinimapError> {
        let opacity = fraction * self.fade;
        if !fraction.is_finite() || !opacity.is_finite() {
            return Err(MinimapError::InvalidNumericInput);
        }
        self.holder_opacity = opacity;
        Ok(())
    }

    /// Borrow all native diagnostics without advancing a clock or copying planes.
    pub fn view(&self) -> MinimapView<'_> {
        MinimapView {
            image_revision: self.image_revision,
            dimension: self.dimension,
            radius: self.dimension.map(|size| f64::from(size) / 2.),
            base_rgba: &self.base_rgba,
            alternate_rgba: &self.alternate_rgba,
            toggles: &self.toggles,
            composite: self.composite,
            has_setup: self.has_setup,
            entering: self.entering,
            fade: self.fade,
            transition: self.transition,
            target_opacity: self.target_opacity,
            base_opacity: self.base_opacity,
            alternate_opacity: self.alternate_opacity,
            holder_opacity: self.holder_opacity,
            last_marker_ms: self.last_marker_ms,
            marker: self.marker,
            server_number: self.server_number,
            game_mode: self.game_mode,
        }
    }
}

// Comparing the fractional part avoids adding 0.5 before rounding, which can
// cross a tie for the representable value immediately below it. copysign keeps
// negative zero for negative values rounded toward zero.
fn js_round(value: f64) -> f64 {
    let integer = value.trunc();
    let fraction = value - integer;
    if fraction >= 0.5 {
        integer + 1.
    } else if fraction < -0.5 {
        integer - 1.
    } else {
        integer.copysign(value)
    }
}

#[cfg(test)]
mod rounding_tests {
    use super::js_round;

    #[test]
    fn authored_synthetic_rounding_boundaries_keep_exact_bits() {
        for (value, expected) in [
            (0.5_f64.next_down(), 0_f64),
            (0.5, 1.),
            (-0.5, -0.),
            ((-0.5_f64).next_down(), -1.),
            (-1.5, -1.),
            (-2.5, -2.),
            (-0., -0.),
            (f64::from_bits(1).copysign(-1.), -0.),
        ] {
            assert_eq!(js_round(value).to_bits(), expected.to_bits());
        }
    }
}

/// Borrowed native images and copied retained metadata.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinimapView<'a> {
    /// Changes only when Setup, a map packet or reset writes image planes.
    /// Consumers may retain their copied pixel buffers across numeric updates.
    pub image_revision: u64,
    /// Effective side length; None precedes initial Setup.
    pub dimension: Option<u16>,
    /// Half the dimension, including odd and zero sizes.
    pub radius: Option<f64>,
    /// Top-left row-major RGBA base image.
    pub base_rgba: &'a [u8],
    /// Top-left row-major RGBA alternate image.
    pub alternate_rgba: &'a [u8],
    /// Independent row-major binary toggle history, for native diagnostics.
    pub toggles: &'a [u8],
    /// Effective alternate-image composition retained until resize.
    pub composite: MinimapComposite,
    /// Fresh Setup has been received since the latest reset.
    pub has_setup: bool,
    /// At least one map packet entered the map presentation.
    pub entering: bool,
    /// Callback-count fade progress.
    pub fade: f64,
    /// Shared-step image transition progress.
    pub transition: f64,
    /// Normal or team target image opacity.
    pub target_opacity: f64,
    /// Last assigned base-image CSS opacity.
    pub base_opacity: f64,
    /// Last assigned alternate-image CSS opacity.
    pub alternate_opacity: f64,
    /// Last assigned holder CSS opacity, including explicit UI writes.
    pub holder_opacity: f64,
    /// Fresh second clock sample retained at the latest marker refresh.
    pub last_marker_ms: f64,
    /// Marker top-left in local CSS pixels.
    pub marker: Point,
    /// Setup server number, independent of endpoint or own identity.
    pub server_number: Option<u16>,
    /// Setup mode metadata; pure minimap support does not enable team gameplay.
    pub game_mode: Option<u8>,
}

/// Explicit desktop UI offsets in CSS pixels, independent of world transforms.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MinimapLayout {
    /// Additional right inset beyond the fixed sixteen pixels.
    pub right_ui_inset: f64,
    /// Additional bottom inset beyond the fixed sixteen pixels.
    pub bottom_ui_offset: f64,
}

/// Complete numeric plan; no widget exists before initial Setup.
#[derive(Clone, Debug, PartialEq)]
pub struct MinimapRenderPlan<'a> {
    /// None means hidden. Zero dimension still produces a 24-pixel holder.
    pub widget: Option<MinimapWidgetPlan<'a>>,
}

/// Ordered background, base, alternate, marker and label widget primitives.
#[derive(Clone, Debug, PartialEq)]
pub struct MinimapWidgetPlan<'a> {
    /// Square holder side length in CSS pixels.
    pub side: f64,
    /// Right and bottom CSS offsets.
    pub right_bottom: Point,
    /// Holder stacking level.
    pub z_index: u8,
    /// Last requested holder opacity; do not multiply by fade again.
    pub opacity: f64,
    /// Procedural background, below both images.
    pub background: MinimapBackgroundPlan,
    /// Base followed by alternate; preserve independent CSS opacities.
    pub images: [MinimapImageLayer<'a>; 2],
    /// Marker follows alternate at the same stacking level.
    pub marker: MinimapMarkerPlan,
    /// Plain text and numeric label geometry.
    pub label: MinimapLabelPlan,
}

/// Received image upload and its independent layer style.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinimapImageLayer<'a> {
    /// Borrowed top-left row-major RGBA bytes; skip upload when dimension is zero.
    pub rgba: &'a [u8],
    /// Square backing side, without DPR or world zoom scaling.
    pub dimension: u16,
    /// Image top-left within the holder.
    pub top_left: Point,
    /// Local CSS opacity.
    pub opacity: f64,
    /// Layer stacking level.
    pub z_index: u8,
}

/// Original procedural disc; received image pixels are not circularly clipped.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinimapBackgroundPlan {
    /// Local disc center.
    pub center: Point,
    /// Disc radius, including fractional odd-size radius.
    pub radius: f64,
    /// Disc fill RGB.
    pub fill: [u8; 3],
    /// Brighter quadrant fill RGB.
    pub quadrant_fill: [u8; 3],
    /// Clockwise quadrant angle ranges in radians.
    pub quadrant_angles: [[f64; 2]; 2],
    /// Two dark diameter strokes.
    pub diameters: [[Point; 2]; 2],
    /// Diameter stroke RGB.
    pub stroke: [u8; 3],
    /// Diameter stroke width in CSS pixels.
    pub stroke_width: f64,
    /// Black shadow blur radius in CSS pixels.
    pub shadow_blur: f64,
    /// Black shadow offset.
    pub shadow_offset: Point,
    /// Local CSS opacity.
    pub opacity: f64,
    /// Layer stacking level.
    pub z_index: u8,
}

/// Marker circle, stroked black first and then filled white.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MinimapMarkerPlan {
    /// Retained local top-left, without clipping or active-own visibility gating.
    pub top_left: Point,
    /// Square marker side in CSS pixels.
    pub side: f64,
    /// Circle center inside marker.
    pub center: Point,
    /// Circle radius in CSS pixels.
    pub radius: f64,
    /// Stroke RGB, submitted before the fill.
    pub stroke: [u8; 3],
    /// Stroke width in CSS pixels.
    pub stroke_width: f64,
    /// Fill RGB.
    pub fill: [u8; 3],
    /// Local CSS opacity.
    pub opacity: f64,
    /// Same layer as alternate, appended later.
    pub z_index: u8,
}

/// Plain-text server label, centered with hidden overflow.
#[derive(Clone, Debug, PartialEq)]
pub struct MinimapLabelPlan {
    /// Empty in team mode, for server zero, or without a server number.
    pub text: String,
    /// Label top-left inside the holder.
    pub top_left: Point,
    /// Width and height in CSS pixels.
    pub size: Point,
    /// Font size in CSS pixels; use Arial, Helvetica, sans-serif.
    pub font_size: f64,
    /// Authored font stack for the plain server label.
    pub font_family: &'static str,
    /// Horizontal label alignment.
    pub text_align: &'static str,
    /// Label overflow is hidden rather than changing holder geometry.
    pub overflow_hidden: bool,
    /// Text RGB.
    pub fill: [u8; 3],
    /// Local CSS opacity.
    pub opacity: f64,
    /// Black text shadow offset.
    pub shadow_offset: Point,
    /// Black text shadow blur in CSS pixels.
    pub shadow_blur: f64,
}

/// Build borrowed pixel layers and complete local geometry without consuming a
/// clock, changing state, reconstructing world occupancy or copying pixel planes.
pub fn plan_minimap(
    view: MinimapView<'_>,
    layout: MinimapLayout,
) -> Result<MinimapRenderPlan<'_>, MinimapError> {
    if ![layout.right_ui_inset, layout.bottom_ui_offset]
        .into_iter()
        .all(|value| value.is_finite() && value >= 0.)
    {
        return Err(MinimapError::InvalidLayout);
    }
    if ![
        view.fade,
        view.transition,
        view.target_opacity,
        view.base_opacity,
        view.alternate_opacity,
    ]
    .into_iter()
    .all(|value| value.is_finite() && (0. ..=1.).contains(&value))
        || ![
            view.holder_opacity,
            view.last_marker_ms,
            view.marker.x,
            view.marker.y,
        ]
        .into_iter()
        .all(f64::is_finite)
    {
        return Err(MinimapError::InvalidRenderPlan);
    }
    let Some(dimension) = view.dimension else {
        if view.radius.is_some()
            || !view.base_rgba.is_empty()
            || !view.alternate_rgba.is_empty()
            || !view.toggles.is_empty()
        {
            return Err(MinimapError::InvalidRenderPlan);
        }
        return Ok(MinimapRenderPlan { widget: None });
    };
    let cells = usize::from(dimension) * usize::from(dimension);
    let size = f64::from(dimension);
    let radius = size / 2.;
    if dimension > MAX_MINIMAP_DIMENSION
        || view.radius != Some(radius)
        || view.base_rgba.len() != 4 * cells
        || view.alternate_rgba.len() != 4 * cells
        || view.toggles.len() != cells
    {
        return Err(MinimapError::InvalidRenderPlan);
    }
    let center = Point {
        x: radius + 12.,
        y: radius + 12.,
    };
    let image = |rgba, opacity, z_index| MinimapImageLayer {
        rgba,
        dimension,
        top_left: Point { x: 12., y: 12. },
        opacity,
        z_index,
    };
    let text = match view.server_number {
        Some(number) if number > 0 && view.game_mode != Some(2) => format!("server {number}"),
        _ => String::new(),
    };
    Ok(MinimapRenderPlan {
        widget: Some(MinimapWidgetPlan {
            side: size + 24.,
            right_bottom: Point {
                x: 16. + layout.right_ui_inset,
                y: 16. + layout.bottom_ui_offset,
            },
            z_index: 10,
            opacity: view.holder_opacity,
            background: MinimapBackgroundPlan {
                center,
                radius,
                fill: [32, 38, 48],
                quadrant_fill: [64, 70, 80],
                quadrant_angles: [[0., PI / 2.], [PI, 3. * PI / 2.]],
                diameters: [
                    [
                        Point {
                            x: 12.,
                            y: center.y,
                        },
                        Point {
                            x: size + 12.,
                            y: center.y,
                        },
                    ],
                    [
                        Point {
                            x: center.x,
                            y: 12.,
                        },
                        Point {
                            x: center.x,
                            y: size + 12.,
                        },
                    ],
                ],
                stroke: [32, 38, 48],
                stroke_width: 1.,
                shadow_blur: 12.,
                shadow_offset: Point { x: 0., y: 3. },
                opacity: 0.45,
                z_index: 11,
            },
            images: [
                image(view.base_rgba, view.base_opacity, 12),
                image(view.alternate_rgba, view.alternate_opacity, 13),
            ],
            marker: MinimapMarkerPlan {
                top_left: view.marker,
                side: 14.,
                center: Point { x: 7., y: 7. },
                radius: 2.5,
                stroke: [0; 3],
                stroke_width: 2.,
                fill: [255; 3],
                opacity: 1.,
                z_index: 13,
            },
            label: MinimapLabelPlan {
                text,
                top_left: Point {
                    x: 0.,
                    y: size + 17.,
                },
                size: Point {
                    x: size + 24.,
                    y: 37.,
                },
                font_size: 14.,
                font_family: "Arial, Helvetica, sans-serif",
                text_align: "center",
                overflow_hidden: true,
                fill: [255; 3],
                opacity: 0.5,
                shadow_offset: Point { x: 0., y: 1. },
                shadow_blur: 8.,
            },
        }),
    })
}
