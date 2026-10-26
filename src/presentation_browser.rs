//! Browser access to explicit-time presentation primitives; no animation startup.

use wasm_bindgen::prelude::*;

use crate::{
    presentation::{
        AngleCorrections, CameraCorrections, FrameClock, FrameStep, HeadCorrections, HeadMotion,
        LengthPresentation, Turn,
    },
    state::Point,
};

fn error(message: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&message.to_string())
}

fn turn(value: f64) -> Result<Turn, JsValue> {
    match value {
        0. => Ok(Turn::None),
        1. => Ok(Turn::Decreasing),
        2. => Ok(Turn::Increasing),
        _ => Err(error("turn must be 0, 1 or 2")),
    }
}

fn segments(value: f64) -> Result<u32, JsValue> {
    if !value.is_finite() || value.fract() != 0. || !(0. ..=f64::from(u32::MAX)).contains(&value) {
        return Err(error("segment count must be an unsigned 32-bit integer"));
    }
    Ok(value as u32)
}

/// One caller-owned animation step. Free it after its consumers have advanced.
#[wasm_bindgen]
pub struct AnimationStep {
    pub(crate) inner: FrameStep,
}

#[wasm_bindgen]
impl AnimationStep {
    #[wasm_bindgen(getter)]
    pub fn delta(&self) -> f64 {
        self.inner.delta
    }
    #[wasm_bindgen(getter)]
    pub fn unlagged_delta(&self) -> f64 {
        self.inner.unlagged_delta
    }
    #[wasm_bindgen(getter)]
    pub fn whole_steps(&self) -> u32 {
        self.inner.whole_steps
    }
    #[wasm_bindgen(getter)]
    pub fn double_steps(&self) -> u32 {
        self.inner.double_steps
    }
    #[wasm_bindgen(getter)]
    pub fn lag_multiplier(&self) -> f64 {
        self.inner.lag_multiplier
    }
    #[wasm_bindgen(getter)]
    pub fn accumulated(&self) -> f64 {
        self.inner.accumulated
    }
    #[wasm_bindgen(getter)]
    pub fn doubled_accumulated(&self) -> f64 {
        self.inner.doubled_accumulated
    }
}

/// Explicit millisecond clock; the caller owns update cadence and lag detection.
#[wasm_bindgen]
pub struct AnimationClock {
    inner: FrameClock,
}

#[wasm_bindgen]
impl AnimationClock {
    #[wasm_bindgen(constructor)]
    pub fn new(start_ms: f64) -> Result<AnimationClock, JsValue> {
        Ok(Self {
            inner: FrameClock::new(start_ms).map_err(error)?,
        })
    }

    pub fn advance(
        &mut self,
        now_ms: f64,
        lagging: bool,
        skin_preview: bool,
    ) -> Result<AnimationStep, JsValue> {
        Ok(AnimationStep {
            inner: self
                .inner
                .advance(now_ms, lagging, skin_preview)
                .map_err(error)?,
        })
    }
}

/// A single head's motion and correction state, independent of packet/session I/O.
#[wasm_bindgen]
pub struct HeadPredictor {
    motion: HeadMotion,
    head: HeadCorrections,
    angle: AngleCorrections,
}

#[wasm_bindgen]
impl HeadPredictor {
    /// Speed is distance per 32 ms, retaining its decoded scalar and arithmetic.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        x: f64,
        y: f64,
        heading: f64,
        wanted_heading: f64,
        direction: f64,
        speed_per_32ms: f64,
        segment_length: f64,
        head_fraction: f64,
    ) -> Result<HeadPredictor, JsValue> {
        let motion = HeadMotion {
            position: Point { x, y },
            heading,
            wanted_heading,
            turn: turn(direction)?,
            speed_per_32ms,
            segment_length,
            head_fraction,
        };
        // Validate without moving or changing the initial heading.
        if ![
            x,
            y,
            heading,
            wanted_heading,
            speed_per_32ms,
            segment_length,
            head_fraction,
        ]
        .iter()
        .all(|v| v.is_finite())
            || speed_per_32ms < 0.
            || segment_length <= 0.
        {
            return Err(error("invalid head presentation input"));
        }
        Ok(Self {
            motion,
            head: HeadCorrections::default(),
            angle: AngleCorrections::default(),
        })
    }

    /// Set target motion; speed is distance per 32 ms and direction is 0, 1 or 2.
    pub fn set_target(
        &mut self,
        wanted_heading: f64,
        direction: f64,
        speed_per_32ms: f64,
    ) -> Result<(), JsValue> {
        let direction = turn(direction)?;
        if !wanted_heading.is_finite() || !speed_per_32ms.is_finite() || speed_per_32ms < 0. {
            return Err(error("invalid head target"));
        }
        self.motion.wanted_heading = wanted_heading;
        self.motion.turn = direction;
        self.motion.speed_per_32ms = speed_per_32ms;
        Ok(())
    }

    /// Accumulate a discontinuity before replacing raw head position and fraction.
    pub fn correct_head(&mut self, x: f64, y: f64, fraction: f64) -> Result<(), JsValue> {
        if ![x, y, fraction].iter().all(|v| v.is_finite()) {
            return Err(error("invalid head correction"));
        }
        self.head
            .inject(
                x - self.motion.position.x,
                y - self.motion.position.y,
                fraction - self.motion.head_fraction,
            )
            .map_err(error)?;
        self.motion.position = Point { x, y };
        self.motion.head_fraction = fraction;
        Ok(())
    }

    /// Apply only an anchor's head discontinuity, including its consumed segment.
    /// Extrapolated distance is supplied explicitly; packet elapsed time is separate.
    pub fn reanchor(&mut self, x: f64, y: f64, extrapolated_distance: f64) -> Result<(), JsValue> {
        self.motion
            .reanchor(Point { x, y }, extrapolated_distance, &mut self.head)
            .map_err(error)
    }

    /// Accumulate shortest-arc heading correction before replacing raw heading.
    pub fn correct_heading(&mut self, heading: f64) -> Result<(), JsValue> {
        if !heading.is_finite() {
            return Err(error("invalid heading correction"));
        }
        self.angle
            .inject(heading - self.motion.heading)
            .map_err(error)?;
        self.motion.heading = heading;
        Ok(())
    }

    /// Advance motion first, then consume head/angle offsets on integer steps.
    pub fn advance(
        &mut self,
        step: &AnimationStep,
        turn_rate: f64,
        size_turn_factor: f64,
        speed_turn_factor: f64,
        alive: bool,
    ) -> Result<(), JsValue> {
        self.motion
            .advance(
                step.inner,
                turn_rate,
                size_turn_factor,
                speed_turn_factor,
                alive,
            )
            .map_err(error)?;
        self.head.advance(step.inner.whole_steps);
        self.angle.advance(step.inner.whole_steps);
        Ok(())
    }

    /// Numeric diagnostics. Corrected positions are raw position plus ring offset.
    pub fn snapshot(&self) -> String {
        let offset = self.head.offset();
        let direction = match self.motion.turn {
            Turn::None => 0,
            Turn::Decreasing => 1,
            Turn::Increasing => 2,
        };
        format!(
            "{{\"x\":{},\"y\":{},\"heading\":{},\"wantedHeading\":{},\"turn\":{},\"fraction\":{},\"offsetX\":{},\"offsetY\":{},\"fractionOffset\":{},\"angleOffset\":{},\"headIndex\":{},\"headPending\":{},\"angleIndex\":{},\"anglePending\":{}}}",
            self.motion.position.x,
            self.motion.position.y,
            self.motion.heading,
            self.motion.wanted_heading,
            direction,
            self.motion.head_fraction,
            offset[0],
            offset[1],
            offset[2],
            self.angle.offset(),
            self.head.index(),
            self.head.pending(),
            self.angle.index(),
            self.angle.pending()
        )
    }

    /// Float32 head channels in x, y, fraction order, for numerical inspection.
    pub fn head_samples(&self) -> Vec<f32> {
        self.head.samples().iter().flatten().copied().collect()
    }
    /// Float32 angle samples in ring storage order.
    pub fn angle_samples(&self) -> Vec<f32> {
        self.angle.samples().to_vec()
    }
}

/// Standalone desktop visual length; packet/body membership remains caller-owned.
#[wasm_bindgen]
pub struct LengthSmoother {
    inner: LengthPresentation,
}

#[wasm_bindgen]
impl LengthSmoother {
    /// Begin with a logical segment count and zero mass, before spawn scheduling.
    #[wasm_bindgen(constructor)]
    pub fn new(segment_count: f64) -> Result<LengthSmoother, JsValue> {
        Ok(Self {
            inner: LengthPresentation::new(segments(segment_count)?),
        })
    }

    /// Schedule even equal values; validate JavaScript integers before narrowing.
    pub fn set_length(&mut self, segment_count: f64, fractional_mass: f64) -> Result<(), JsValue> {
        self.inner
            .set_length(segments(segment_count)?, fractional_mass)
            .map_err(error)
    }

    /// Consume the supplied integer clock step only while alive.
    pub fn advance(&mut self, step: &AnimationStep, alive: bool) {
        self.inner.advance(step.inner.whole_steps, alive);
    }

    /// Numeric diagnostics; no body geometry or score calculation is implied.
    pub fn snapshot(&self) -> String {
        format!(
            "{{\"segments\":{},\"mass\":{},\"target\":{},\"displayed\":{},\"offset\":{},\"index\":{},\"pending\":{}}}",
            self.inner.segments(),
            self.inner.fractional_mass(),
            self.inner.target(),
            self.inner.displayed(),
            self.inner.offset(),
            self.inner.index(),
            self.inner.pending()
        )
    }

    /// A copy of the Float32 correction samples.
    pub fn samples(&self) -> Vec<f32> {
        self.inner.samples().to_vec()
    }

    /// A copy of the Float32 entity weights.
    pub fn weights(&self) -> Vec<f32> {
        self.inner.weights().to_vec()
    }
}

/// Camera offsets with an explicit draw clock, independent of following/zoom.
#[wasm_bindgen]
#[derive(Default)]
pub struct CameraSmoother {
    inner: CameraCorrections,
}

#[wasm_bindgen]
impl CameraSmoother {
    /// Create an empty double-precision camera correction ring.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Accumulate new-minus-old displacement while retaining the current offset.
    pub fn inject(&mut self, x: f64, y: f64) -> Result<(), JsValue> {
        self.inner.inject(Point { x, y }).map_err(error)
    }

    /// Consume one pending sample for an eligible draw.
    pub fn draw(&mut self) {
        self.inner.advance_draw();
    }

    /// Numeric offset and ring-position diagnostics.
    pub fn snapshot(&self) -> String {
        let offset = self.inner.offset();
        format!(
            "{{\"offsetX\":{},\"offsetY\":{},\"index\":{},\"pending\":{}}}",
            offset.x,
            offset.y,
            self.inner.index(),
            self.inner.pending()
        )
    }

    /// A copy of both double-precision channels, x followed by y.
    pub fn samples(&self) -> Vec<f64> {
        self.inner.samples().iter().flatten().copied().collect()
    }

    /// A copy of the reshaped double-precision camera weights.
    pub fn weights(&self) -> Vec<f64> {
        self.inner.weights().to_vec()
    }
}
