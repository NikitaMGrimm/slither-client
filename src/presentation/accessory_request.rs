//! One selected-resource attempt. Native authority and source objects stay outside Rust.

use super::{PresentationError, StaticHeadAccessoryGeometry, stock_accessory_id};

/// Copied input from a privately captured selected entry, never resource authority.
pub struct AccessoryRequestInput<'a> {
    /// Canonical persisted selected value, unrelated to wire cosmetic bytes.
    pub selection: Option<&'a str>,
    /// Captured existing table count.
    pub count: u32,
    /// Zero: missing image; one: existing unloaded image; two: already loaded.
    pub slot: u8,
    /// Captured selected entry's initial resource scalar; not native authority.
    pub resource: &'a str,
    /// Captured nominal source multiplier.
    pub image_scale: f64,
    /// Captured horizontal pivot.
    pub pivot_x: f64,
    /// Captured vertical pivot.
    pub pivot_y: f64,
}

/// One startup-owned request and generation; no sockets, callbacks or source objects.
pub struct SelectedAccessoryRequest {
    phase: u8,
    generation: u32,
    last: f64,
    deadline: f64,
}

impl SelectedAccessoryRequest {
    /// Retain the existing bounded startup lifetime in monotonic milliseconds.
    pub fn new(start: f64, deadline: f64) -> Result<Self, PresentationError> {
        if !start.is_finite() || !deadline.is_finite() || start < 0. || deadline <= start {
            return Err(PresentationError);
        }
        Ok(Self {
            phase: 0,
            generation: 1,
            last: start,
            deadline,
        })
    }

    /// A source-established initial resource shape, not catalog membership or a load grant.
    pub fn resource_valid(value: &str) -> bool {
        value
            .strip_prefix("http://slither.io/s/a_")
            .and_then(|s| s.strip_suffix(".png"))
            .is_some_and(|token| {
                (3..=11).contains(&token.len())
                    && token
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
            })
    }

    /// Copied phase: new/none/existing/requested/published/committed/invalid/disposed.
    pub fn phase(&self) -> u8 {
        self.phase
    }
    /// Current one-use native generation, zero after invalidation.
    pub fn ticket(&self) -> u32 {
        self.generation
    }
    /// Whether a late native callback still belongs to this live generation.
    pub fn live(&self, ticket: u32) -> bool {
        ticket != 0 && ticket == self.generation && self.phase < 6
    }

    /// Permanently consume failed ownership; restoration never revives it.
    pub fn invalidate(&mut self) {
        self.phase = 6;
        self.generation = 0;
    }
    /// Retire native ownership before resource cleanup.
    pub fn dispose(&mut self) {
        self.phase = 7;
        self.generation = 0;
    }

    /// Reject stale generation, backwards time or an expired active startup.
    pub fn check(&mut self, ticket: u32, now: f64) -> Result<(), PresentationError> {
        if !self.live(ticket)
            || !now.is_finite()
            || now < self.last
            || (!matches!(self.phase, 1 | 5) && now >= self.deadline)
        {
            self.invalidate();
            return Err(PresentationError);
        }
        self.last = now;
        Ok(())
    }

    /// Remaining startup delay for the single native watchdog.
    pub fn remaining(&mut self, now: f64) -> Result<f64, PresentationError> {
        self.check(self.generation, now)?;
        Ok((self.deadline - now).max(0.))
    }

    /// Return only a copied effect: 0 none, 1 borrow/wait existing, 2 request once.
    pub fn prepare(
        &mut self,
        input: AccessoryRequestInput<'_>,
        now: f64,
    ) -> Result<u8, PresentationError> {
        self.check(self.generation, now)?;
        let result = (|| {
            if self.phase != 0 {
                return Err(PresentationError);
            }
            if stock_accessory_id(input.selection, input.count)?.is_none() {
                self.phase = 1;
                return Ok(0);
            }
            StaticHeadAccessoryGeometry {
                forward: 0.,
                image_scale: input.image_scale,
                pivot_x: input.pivot_x,
                pivot_y: input.pivot_y,
            }
            .validate()?;
            if input.slot > 2 || !Self::resource_valid(input.resource) {
                return Err(PresentationError);
            }
            if input.slot == 0 {
                // Commit the sole attempt before any native allocation or callback.
                self.phase = 3;
                Ok(2)
            } else {
                self.phase = 2;
                Ok(1)
            }
        })();
        if result.is_err() {
            self.invalidate();
        }
        result
    }

    /// Admit a matching load before native cache publication; duplicate loads terminate.
    pub fn loaded(
        &mut self,
        ticket: u32,
        now: f64,
        complete: bool,
        extents: [f64; 4],
    ) -> Result<(), PresentationError> {
        self.check(ticket, now)?;
        let [width, height, intrinsic_width, intrinsic_height] = extents;
        if self.phase != 3
            || !complete
            || extents
                .iter()
                .any(|v| !v.is_finite() || v.fract() != 0. || *v <= 0. || *v > 65535.)
            || width != intrinsic_width
            || height != intrinsic_height
        {
            self.invalidate();
            return Err(PresentationError);
        }
        self.phase = 4;
        Ok(())
    }

    /// Called only after the same source's existing decode-lease listeners are installed.
    pub fn handoff(&mut self, ticket: u32, now: f64) -> Result<(), PresentationError> {
        self.check(ticket, now)?;
        if !matches!(self.phase, 2 | 4) {
            self.invalidate();
            return Err(PresentationError);
        }
        self.phase = 5;
        Ok(())
    }
}
