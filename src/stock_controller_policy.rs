//! Browser-free stock controller sequencing and successful-draw accounting.

/// Failure category retained by the copied boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    /// Invalid finite scalar.
    Type,
    /// Numeric bound or exhausted counter.
    Range,
    /// Stopped controller or invalid internal continuation.
    State,
}

/// An authored controller failure, without host error values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ControllerError(pub ErrorKind, pub &'static str);
type Result<T> = std::result::Result<T, ControllerError>;

/// One operation-specific effect boundary. No host effect executes in this owner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Stage {
    /// No unfinished operation.
    Idle = 0,
    /// Optional legacy gaze before advance.
    Gaze = 1,
    /// Exactly one scene advance.
    Advance = 2,
    /// Observe post-control playing once.
    Playing = 3,
    /// Advance existing quality with the returned step.
    Quality = 4,
    /// Copy optional step numbers, after quality and before free.
    Step = 5,
    /// Release the returned step, including when an earlier effect failed.
    FreeStep = 6,
    /// Optional observer after step release.
    Observer = 7,
    /// Existing quality statistics, before this frame's draw.
    Statistics = 8,
    /// One explicit or frame render.
    Draw = 9,
    /// Body succeeded; source release may still fail.
    Complete = 10,
    /// Ordered Setup packet draw result.
    Packet = 11,
}

/// Copied public diagnostics.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ControllerView {
    /// All successful draws, using JS-number addition semantics.
    pub draws: f64,
    /// Successful draws not yet consumed by statistics.
    pub draws_since_statistics: f64,
    /// Last committed backing width.
    pub width: f64,
    /// Last committed backing height.
    pub height: f64,
    /// Failure or explicit stop; the owner remains observable until release.
    pub stopped: bool,
}

/// Validate an existing stock backing dimension; this does not calculate layout.
pub fn backing_size(value: f64) -> Result<f64> {
    if !value.is_finite() || value.fract() != 0. || !(1. ..=4096.).contains(&value) {
        return Err(ControllerError(
            ErrorKind::Range,
            "Invalid stock backing size",
        ));
    }
    Ok(value)
}

/// Validate an already admitted numeric time or gaze scalar.
pub fn finite(value: f64, gaze: bool) -> Result<()> {
    if !value.is_finite() {
        return Err(ControllerError(
            ErrorKind::Type,
            if gaze {
                "Finite gaze heading required"
            } else {
                "Finite time required"
            },
        ));
    }
    Ok(())
}

/// Validate copied optional observation numbers after both original getters ran.
pub fn observed_step(whole: f64, delta: f64) -> Result<()> {
    if !whole.is_finite()
        || whole.fract() != 0.
        || !(0. ..=5.).contains(&whole)
        || !delta.is_finite()
        || !(0. ..=5.).contains(&delta)
    {
        return Err(ControllerError(
            ErrorKind::Range,
            "Invalid observed animation step",
        ));
    }
    Ok(())
}

/// Domain state independent of scene, native callbacks, leases and JS errors.
#[derive(Clone, Debug)]
pub struct StockControllerPolicy {
    view: ControllerView,
    stage: Stage,
    frame: bool,
    control: bool,
    read_playing: bool,
    observe_step: bool,
    playing: bool,
    resize: Option<(f64, f64)>,
}

impl StockControllerPolicy {
    /// Begin with no draws and caller-admitted backing dimensions.
    pub fn new(width: f64, height: f64) -> Result<Self> {
        Ok(Self {
            view: ControllerView {
                draws: 0.,
                draws_since_statistics: 0.,
                width: backing_size(width)?,
                height: backing_size(height)?,
                stopped: false,
            },
            stage: Stage::Idle,
            frame: false,
            control: false,
            read_playing: false,
            observe_step: false,
            playing: true,
            resize: None,
        })
    }
    /// Copy committed state, including partial commits after failure.
    pub fn view(&self) -> ControllerView {
        self.view
    }
    /// Observe the next domain boundary without executing an effect.
    pub fn stage(&self) -> Stage {
        self.stage
    }
    /// Select the existing pre-motion control ABI.
    pub fn uses_control(&self) -> bool {
        self.control
    }
    /// The same post-native playing observation is shared by quality and statistics.
    pub fn playing(&self) -> bool {
        self.playing
    }
    /// Dimensions used by the next render, before resize commits.
    pub fn target(&self) -> (f64, f64) {
        self.resize.unwrap_or((self.view.width, self.view.height))
    }
    fn expect(&self, stage: Stage) -> Result<()> {
        if self.view.stopped {
            return Err(ControllerError(
                ErrorKind::State,
                "Stock controller stopped",
            ));
        }
        if self.stage != stage {
            return Err(ControllerError(
                ErrorKind::State,
                "Invalid stock controller stage",
            ));
        }
        Ok(())
    }
    /// Start one packet body after native busy admission.
    pub fn begin_packet(&mut self) -> Result<()> {
        self.expect(Stage::Idle)?;
        self.stage = Stage::Packet;
        Ok(())
    }
    /// Start explicit render or resize; resize dimensions were validated before busy.
    pub fn begin_draw(&mut self, resize: Option<(f64, f64)>) -> Result<()> {
        self.expect(Stage::Idle)?;
        if let Some((w, h)) = resize {
            backing_size(w)?;
            backing_size(h)?;
        }
        self.resize = resize;
        self.stage = Stage::Draw;
        Ok(())
    }
    /// Start update/frame with already captured optional callback presence.
    pub fn begin_update(
        &mut self,
        frame: bool,
        gaze: bool,
        control: bool,
        read_playing: bool,
        observe_step: bool,
        playing: bool,
    ) -> Result<()> {
        self.expect(Stage::Idle)?;
        self.frame = frame;
        self.control = control;
        self.read_playing = read_playing;
        self.observe_step = observe_step;
        self.playing = playing;
        self.resize = None;
        self.stage = if gaze { Stage::Gaze } else { Stage::Advance };
        Ok(())
    }
    /// Commit a successful legacy gaze effect.
    pub fn gaze_done(&mut self) -> Result<()> {
        self.expect(Stage::Gaze)?;
        self.stage = Stage::Advance;
        Ok(())
    }
    /// Native returned one owned step; only now may playing be observed.
    pub fn advance_done(&mut self) -> Result<()> {
        self.expect(Stage::Advance)?;
        self.stage = if self.read_playing {
            Stage::Playing
        } else {
            Stage::Quality
        };
        Ok(())
    }
    /// Capture the boolean used by both downstream quality consumers.
    pub fn playing_observed(&mut self, playing: bool) -> Result<()> {
        self.expect(Stage::Playing)?;
        self.playing = playing;
        self.stage = Stage::Quality;
        Ok(())
    }
    /// Quality interpolation completed before optional step getters.
    pub fn quality_done(&mut self) -> Result<()> {
        self.expect(Stage::Quality)?;
        self.stage = if self.observe_step {
            Stage::Step
        } else {
            Stage::FreeStep
        };
        Ok(())
    }
    /// Validate both copied getter results without losing signed zeros.
    pub fn step_observed(&mut self, whole: f64, delta: f64) -> Result<()> {
        self.expect(Stage::Step)?;
        observed_step(whole, delta)?;
        self.stage = Stage::FreeStep;
        Ok(())
    }
    /// Only a successful ordinary-finally free permits observer/statistics effects.
    pub fn step_freed(&mut self) -> Result<()> {
        self.expect(Stage::FreeStep)?;
        self.stage = if self.observe_step {
            Stage::Observer
        } else {
            Stage::Statistics
        };
        Ok(())
    }
    /// The post-free observer and its then-property check completed.
    pub fn observer_done(&mut self) -> Result<()> {
        self.expect(Stage::Observer)?;
        self.stage = Stage::Statistics;
        Ok(())
    }
    /// Apply native callback truthiness only after statistics successfully returns.
    pub fn statistics_result(&mut self, consumed: bool) -> Result<()> {
        self.expect(Stage::Statistics)?;
        if consumed {
            self.view.draws_since_statistics = 0.;
        }
        self.stage = if self.frame {
            Stage::Draw
        } else {
            Stage::Complete
        };
        Ok(())
    }
    fn charge(&mut self, count: f64) -> Result<()> {
        if !count.is_finite()
            || count.fract() != 0.
            || !(0. ..=f64::from(u32::MAX)).contains(&count)
        {
            return Err(ControllerError(
                ErrorKind::Range,
                "Invalid successful Setup draw count",
            ));
        }
        // The original JS commits BOTH additions before checking exhaustion.
        self.view.draws += count;
        self.view.draws_since_statistics += count;
        if self.view.draws > 9_007_199_254_740_991.
            || self.view.draws_since_statistics > f64::from(u32::MAX)
        {
            return Err(ControllerError(
                ErrorKind::Range,
                "Stock draw counter exhausted",
            ));
        }
        Ok(())
    }
    /// Charge native Setup draws after the full copied HUD report is admitted.
    pub fn packet_succeeded(&mut self, count: f64) -> Result<()> {
        self.expect(Stage::Packet)?;
        self.charge(count)?;
        self.stage = Stage::Complete;
        Ok(())
    }
    /// Charge a render, then commit resize, before source release.
    pub fn draw_succeeded(&mut self) -> Result<()> {
        self.expect(Stage::Draw)?;
        self.charge(1.)?;
        if let Some((w, h)) = self.resize {
            self.view.width = w;
            self.view.height = h;
        }
        self.stage = Stage::Complete;
        Ok(())
    }
    /// End a successful body before the native source lease is released.
    pub fn finish(&mut self) -> Result<()> {
        self.expect(Stage::Complete)?;
        self.stage = Stage::Idle;
        Ok(())
    }
    /// Stop before cleanup callbacks, preserving all earlier committed state.
    pub fn stop(&mut self) {
        self.view.stopped = true;
        self.stage = Stage::Idle;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn total_safe_integer_exhaustion_keeps_js_rounded_additions() {
        let mut p = StockControllerPolicy::new(1., 1.).unwrap();
        // Seed only the private native unit test, without a production state setter.
        p.view.draws = 9_007_199_254_740_990.;
        p.charge(1.).unwrap();
        assert!(p.charge(2.).is_err());
        assert_eq!(p.view.draws, 9_007_199_254_740_992.);
        assert_eq!(p.view.draws_since_statistics, 3.);
    }

    #[test]
    fn invalid_counts_do_not_mutate_and_negative_zero_adds_as_js_number() {
        let mut p = StockControllerPolicy::new(1., 1.).unwrap();
        p.charge(-0.).unwrap();
        assert_eq!(p.view.draws.to_bits(), 0_f64.to_bits());
        let before = p.view;
        for count in [-1., 0.5, f64::NAN, f64::INFINITY] {
            assert!(p.charge(count).is_err());
            assert_eq!(p.view, before);
        }
    }
}
