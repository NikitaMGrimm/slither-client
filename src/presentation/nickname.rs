//! Draw-clock nickname fading and backend-neutral text placement.
//!
//! Retain one state per appearance, independently of wire-ID reuse. The caller
//! supplies admitted text and either a resolved light color or tint inputs; this
//! module neither filters text nor selects a palette. Submit eligible names
//! before snake bodies.

use crate::{presentation::PresentationError, state::Point};

/// Authored neutral light color used when an appearance supplies no tint metadata.
pub const NEUTRAL_NICKNAME_COLOR: [u8; 3] = [238, 238, 238];

/// Caller-owned appearance-time inputs for one nickname light color.
///
/// The base is the selected skin's first resolved palette color. The three
/// units are independent red, green and blue draws, consumed once per appearance.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NicknameTint {
    /// Base palette channels in red, green and blue order.
    pub base_rgb: [u8; 3],
    /// One unit in `0..1` per channel, in red, green and blue order.
    pub random_units: [f64; 3],
}

impl NicknameTint {
    /// Resolve the light color, or reject any unit outside finite `0..1`.
    ///
    /// Each channel adds `floor(unit * 20)` and saturates at 255. The light value
    /// is `(256 + channel) / 2` with integer division, which equals rounding
    /// `(255 + channel) / 2` half up for every byte-valued channel.
    pub fn light_color(&self) -> Result<[u8; 3], PresentationError> {
        if !self
            .random_units
            .iter()
            .all(|unit| (0. ..1.).contains(unit))
        {
            return Err(PresentationError);
        }
        let mut color = [0; 3];
        for ((light, base), unit) in color.iter_mut().zip(self.base_rgb).zip(self.random_units) {
            // The unit range bounds the jitter to 0..=19 before conversion.
            let channel = (u16::from(base) + (unit * 20.).floor() as u16).min(255);
            *light = ((256 + channel) / 2) as u8;
        }
        Ok(color)
    }
}

/// Existing snake cull rectangle in the corrected head's world coordinate system.
/// Name culling adds its own horizontal margin and tests the head 40 units down.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NicknameCullBounds {
    /// Left snake cull boundary, before the name's 100-unit extension.
    pub left: f64,
    /// Right snake cull boundary, before the name's 100-unit extension.
    pub right: f64,
    /// Top snake cull boundary.
    pub top: f64,
    /// Bottom snake cull boundary.
    pub bottom: f64,
}

/// Inputs from the current draw's prepared camera and snake metrics.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NicknameInput<'a> {
    /// Caller-admitted text, including an admitted empty name. No conversion occurs.
    pub text: &'a str,
    /// Caller-resolved light nickname color, as red, green and blue channels.
    pub color: [u8; 3],
    /// Predicted head plus displayed correction, before camera projection.
    pub corrected_head: Point,
    /// Displayed camera in the same world coordinate system as the head and bounds.
    pub camera: Point,
    /// Half the backing viewport width and height, in screen pixels.
    pub viewport_half: Point,
    /// Positive world-to-screen zoom.
    pub zoom: f64,
    /// Positive snake scale from the existing metrics.
    pub scale: f64,
    /// Current spawn progress in 0..=1.
    pub spawn_progress: f64,
    /// Current death progress in 0..=1.
    pub death_progress: f64,
    /// Retained original-own identity, independently of active input or wire ID.
    pub own: bool,
    /// Existing snake bounds, independently of body visibility or curve eligibility.
    pub bounds: NicknameCullBounds,
}

/// Horizontal text alignment.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NicknameAlignment {
    /// Center the text on its screen position.
    Center,
}

/// Vertical text baseline.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NicknameBaseline {
    /// Center the text vertically on its screen position.
    Middle,
}

/// One owned text submission, frozen in backing pixels for this draw's scene.
#[derive(Clone, Debug, PartialEq)]
pub struct NicknameDraw {
    /// Exact caller-admitted text.
    pub text: String,
    /// Final screen anchor, including the fixed and scale-dependent vertical offset.
    pub position: Point,
    /// Fixed font size in backing pixels; zoom does not scale the font.
    pub font_size: f64,
    /// Ordered font family fallbacks.
    pub font_family: &'static str,
    /// Horizontal alignment at the anchor.
    pub alignment: NicknameAlignment,
    /// Vertical baseline at the anchor.
    pub baseline: NicknameBaseline,
    /// Resolved light color, unchanged from the caller.
    pub color: [u8; 3],
    /// Linear name, spawn and death opacity product, including zero-alpha draws.
    pub alpha: f64,
}

/// Small appearance-owned state. Updates, packet ingress and observations do not tick it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NicknameState {
    opacity: f64,
    own_draw_count: u32,
}

impl NicknameState {
    /// Start a fresh appearance with caller-selected initial name opacity in 0..=1.
    /// Appearance initialization outside the bounded draw contract remains caller-owned.
    pub fn new(opacity: f64) -> Result<Self, PresentationError> {
        if !(0. ..=1.).contains(&opacity) {
            return Err(PresentationError);
        }
        Ok(Self {
            opacity,
            own_draw_count: 0,
        })
    }

    /// Current name opacity, before spawn/death multiplication.
    pub fn opacity(&self) -> f64 {
        self.opacity
    }

    /// Count of own-name draws that passed the opacity and name-cull gates.
    pub fn own_draw_count(&self) -> u32 {
        self.own_draw_count
    }

    /// Advance once per actual name pass and produce its text command, if eligible.
    ///
    /// The first 200 eligible own draws retain opacity; each later draw subtracts
    /// 0.004 before alpha is computed. Culled or already transparent names pause
    /// the counter. Remote names never advance it. Empty text and zero spawn/death
    /// alpha still submit and tick when the name gates pass. Failure preserves state.
    pub fn draw(
        &mut self,
        input: NicknameInput<'_>,
    ) -> Result<Option<NicknameDraw>, PresentationError> {
        let bounds = input.bounds;
        if ![
            input.corrected_head.x,
            input.corrected_head.y,
            input.camera.x,
            input.camera.y,
            input.viewport_half.x,
            input.viewport_half.y,
            input.zoom,
            input.scale,
            bounds.left,
            bounds.right,
            bounds.top,
            bounds.bottom,
        ]
        .into_iter()
        .all(f64::is_finite)
            || input.viewport_half.x < 0.
            || input.viewport_half.y < 0.
            || input.zoom <= 0.
            || input.scale <= 0.
            || !(0. ..=1.).contains(&input.spawn_progress)
            || !(0. ..=1.).contains(&input.death_progress)
            || bounds.left > bounds.right
            || bounds.top > bounds.bottom
        {
            return Err(PresentationError);
        }
        if self.opacity <= 0. {
            return Ok(None);
        }
        let cull_y = input.corrected_head.y + 40.;
        if input.corrected_head.x < bounds.left - 100.
            || input.corrected_head.x > bounds.right + 100.
            || cull_y < bounds.top
            || cull_y > bounds.bottom
        {
            return Ok(None);
        }
        let mut next = *self;
        if input.own {
            // Opacity only decreases, so the bounded initial value reaches zero
            // after at most 450 eligible own draws; this counter cannot overflow.
            next.own_draw_count += 1;
            if next.own_draw_count > 200 {
                next.opacity = (next.opacity - 0.004).max(0.);
            }
        }
        let position = Point {
            x: input.viewport_half.x + (input.corrected_head.x - input.camera.x) * input.zoom,
            y: input.viewport_half.y
                + (input.corrected_head.y - input.camera.y) * input.zoom
                + 32.
                + 11. * input.scale * input.zoom,
        };
        let alpha = 0.5 * next.opacity * input.spawn_progress * (1. - input.death_progress);
        if ![position.x, position.y, alpha]
            .into_iter()
            .all(f64::is_finite)
        {
            return Err(PresentationError);
        }
        *self = next;
        Ok(Some(NicknameDraw {
            text: input.text.to_owned(),
            position,
            font_size: 15.,
            font_family: "Arial, Helvetica Neue, Helvetica, sans-serif",
            alignment: NicknameAlignment::Center,
            baseline: NicknameBaseline::Middle,
            color: input.color,
            alpha,
        }))
    }
}
