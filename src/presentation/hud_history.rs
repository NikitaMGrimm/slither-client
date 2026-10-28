//! Bounded semantic HUD history. Inputs are command-time observations, never DOM data.

use super::SnakeObjectToken;

/// One ready command-time or successful-draw score observation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HudSample {
    /// Integer Number score, retaining negative zero and values beyond the safe range.
    pub score: f64,
    /// Original own appearance, independent of wire-ID reuse.
    pub token: SnakeObjectToken,
}

/// Semantic events after complete ingress admission, in original command order.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HudHistoryEvent {
    /// Reset visibility without clearing retained values or dirty state.
    Setup,
    /// A successful Setup draw, possibly with a nonready score observation.
    SetupDraw(Option<HudSample>),
    /// Actual own-length scheduling, including an equal request.
    OwnLengthScheduled(SnakeObjectToken),
    /// Header population/rank, independent of visible rows and snake count.
    Leaderboard {
        /// Header rank, including zero.
        rank: u16,
        /// Header population, including zero.
        population: u16,
        /// Command-time session death flag.
        death_pending: bool,
    },
    /// Ready sample frozen at the accepted game-over command.
    FinalScore(HudSample),
}

/// Existing same-step session lifecycle observation; owns no clock.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HudLifecycle {
    /// A session death timestamp exists.
    pub death_pending: bool,
    /// The existing return transition is active.
    pub return_active: bool,
    /// The return completed in this step.
    pub return_completed: bool,
    /// Fraction supplied by that transition, without recomputation.
    pub return_fraction: f64,
}

/// Requested semantic opacity; native CSS application remains separate.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HudOpacity {
    /// Current readout.
    pub readout: f64,
    /// Leaderboard heading.
    pub header: f64,
    /// Leaderboard rows.
    pub rows: f64,
    /// Announcement role.
    pub announcement: f64,
}

/// Last successfully displayed current score and its header sample.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HudCurrent {
    /// Ready score and original own identity.
    pub sample: HudSample,
    /// Positive rank sampled at display time.
    pub rank: u16,
    /// Positive population sampled at display time.
    pub population: u16,
}

/// Last accepted final capture, independent of current readout and visibility.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HudFinal {
    /// Command-time score and original own identity.
    pub sample: HudSample,
    /// Strictly greater than 1000.
    pub exclamation: bool,
}

impl HudCurrent {
    /// Decimal score under the existing safe-integer display contract.
    pub fn score_text(self) -> Result<String, &'static str> {
        hud_score_text(self.sample.score)
    }
    /// Decimal header rank, without grouping or a prefix.
    pub fn rank_text(self) -> String {
        self.rank.to_string()
    }
    /// Decimal header population, without grouping.
    pub fn population_text(self) -> String {
        self.population.to_string()
    }
}

impl HudFinal {
    /// Decimal score under the existing safe-integer display contract.
    pub fn score_text(self) -> Result<String, &'static str> {
        hud_score_text(self.sample.score)
    }
    /// Existing final punctuation, determined at capture time.
    pub fn suffix(self) -> &'static str {
        if self.exclamation { "!" } else { "" }
    }
}

/// Immutable candidate history; each operation returns a new value or an error.
#[derive(Clone, Debug, PartialEq)]
pub struct HudHistory {
    /// Current world's original own appearance.
    pub own_token: Option<SnakeObjectToken>,
    /// Latest header rank, including zero.
    pub rank: u16,
    /// Latest header population, including zero.
    pub population: u16,
    /// Minimum header rank since reset, including zero.
    pub best_rank: u32,
    /// Maximum header population since reset.
    pub max_population: u16,
    /// A scheduling or header event still needs an eligible successful draw.
    pub dirty: bool,
    /// Existing fade sentinel or lifecycle fraction.
    pub fade: f64,
    /// Last requested role opacities, which can differ from the fade sentinel.
    pub requested_opacity: HudOpacity,
    /// Last displayed readout, retained across reset.
    pub current: Option<HudCurrent>,
    /// Last final capture, retained across reset.
    pub final_capture: Option<HudFinal>,
}

impl Default for HudHistory {
    fn default() -> Self {
        Self {
            own_token: None,
            rank: 0,
            population: 0,
            best_rank: 999_999_999,
            max_population: 0,
            dirty: false,
            fade: -1.,
            requested_opacity: HudOpacity::default(),
            current: None,
            final_capture: None,
        }
    }
}

impl HudHistory {
    /// Decide readout eligibility without observing a native scene.
    pub fn readout_required(&self, playing: bool) -> bool {
        self.dirty && playing && self.rank > 0 && self.population > 0
    }

    fn bind(&mut self, sample: HudSample) -> Result<(), &'static str> {
        if !sample.score.is_finite() || sample.score.fract() != 0. {
            return Err("invalid HUD score");
        }
        self.bind_token(sample.token)
    }

    fn bind_token(&mut self, token: SnakeObjectToken) -> Result<(), &'static str> {
        if self.own_token.is_some_and(|bound| bound != token) {
            return Err("HUD own token changed without reset");
        }
        self.own_token = Some(token);
        Ok(())
    }

    fn display(&mut self, sample: Option<HudSample>) -> Result<(), &'static str> {
        let sample = sample.ok_or("ready HUD sample required")?;
        self.bind(sample)?;
        self.current = Some(HudCurrent {
            sample,
            rank: self.rank,
            population: self.population,
        });
        self.dirty = false;
        Ok(())
    }

    /// Fold an admitted complete journal atomically, without retaining the journal.
    pub fn packet(&self, events: &[HudHistoryEvent]) -> Result<Self, &'static str> {
        if events.len() > 8192 {
            return Err("HUD journal exceeds event bound");
        }
        let mut next = self.clone();
        for event in events {
            match *event {
                HudHistoryEvent::Setup => {
                    next.fade = -1.;
                    next.requested_opacity = HudOpacity::default();
                }
                HudHistoryEvent::SetupDraw(sample) => {
                    if next.readout_required(true) {
                        next.display(sample)?;
                    }
                }
                HudHistoryEvent::OwnLengthScheduled(token) => {
                    next.bind_token(token)?;
                    next.dirty = true;
                }
                HudHistoryEvent::Leaderboard {
                    rank,
                    population,
                    death_pending,
                } => {
                    next.rank = rank;
                    next.population = population;
                    next.best_rank = next.best_rank.min(u32::from(rank));
                    next.max_population = next.max_population.max(population);
                    next.dirty = true;
                    if next.fade == -1. && !death_pending {
                        next.fade = 0.;
                    }
                }
                HudHistoryEvent::FinalScore(sample) => {
                    next.bind(sample)?;
                    next.final_capture = Some(HudFinal {
                        sample,
                        exclamation: sample.score > 1000.,
                    });
                }
            }
        }
        Ok(next)
    }

    /// Consume dirty state only after an eligible successful draw.
    pub fn draw(&self, playing: bool, sample: Option<HudSample>) -> Result<Self, &'static str> {
        let mut next = self.clone();
        if next.readout_required(playing) {
            next.display(sample)?;
        } else if sample.is_some() {
            return Err("unexpected HUD draw sample");
        }
        Ok(next)
    }

    /// Clear live-world fields while retaining dirty, visibility and displayed history.
    pub fn reset_world(&self) -> Self {
        Self {
            own_token: None,
            rank: 0,
            population: 0,
            best_rank: 999_999_999,
            max_population: 0,
            ..self.clone()
        }
    }

    /// Apply the existing same-step lifecycle observation, including zero delta.
    pub fn step(&self, delta: f64, life: HudLifecycle) -> Result<Self, &'static str> {
        if !delta.is_finite()
            || !(0. ..=5.).contains(&delta)
            || !life.return_fraction.is_finite()
            || !(0. ..=1.).contains(&life.return_fraction)
            || if life.return_completed {
                !life.return_active || life.death_pending || life.return_fraction != 0.
            } else {
                life.return_active && (!life.death_pending || life.return_fraction <= 0.)
            }
        {
            return Err("invalid HUD lifecycle");
        }
        let mut next = self.clone();
        if life.return_completed {
            next.fade = -1.;
        } else if life.return_active {
            next.fade = life.return_fraction;
        } else if !life.death_pending && next.fade != -1. && next.fade != 1. {
            next.fade = (next.fade + 0.01 * delta).min(1.);
        } else {
            return Ok(next);
        }
        next.requested_opacity = HudOpacity {
            readout: next.fade,
            header: 0.85 * next.fade,
            rows: next.fade,
            announcement: next.fade,
        };
        Ok(next)
    }
}

/// Existing decimal text contract: safe integer Number values only, normalizing -0.
pub fn hud_score_text(score: f64) -> Result<String, &'static str> {
    if !score.is_finite() || score.fract() != 0. || score.abs() > 9_007_199_254_740_991. {
        return Err("HUD score cannot be formatted safely");
    }
    Ok((score as i64).to_string())
}
