//! Authored end-screen presentation over committed session and HUD observations.

/// Session phases already selected by the gameplay adapter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndScreenPhase {
    /// Ready, connecting or ordinary gameplay; clears an earlier result.
    Active,
    /// The existing session accepted a normal game-over control.
    Dead,
    /// The existing session accepted the victory game-over control.
    Victory,
    /// The existing session disconnected or failed.
    Closed,
}

/// Copied observations; no snake disappearance or score threshold implies death.
#[derive(Clone, Copy, Debug)]
pub struct EndScreenInput {
    /// Existing committed session phase.
    pub phase: EndScreenPhase,
    /// Existing session playing flag, including its delayed return interval.
    pub playing: bool,
    /// Existing session life-ended flag.
    pub life_ended: bool,
    /// Local explicit replay capability; remote sessions remain one-shot.
    pub local_replay: bool,
    /// Existing command-time final capture, never the last displayed score.
    pub final_score: Option<f64>,
}

/// Plain text and visibility for a passive DOM submitter.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EndScreenView {
    /// Whether the result is selected for display.
    pub visible: bool,
    /// Authored result heading.
    pub title: &'static str,
    /// Captured final score text, or empty when no capture exists.
    pub score_text: String,
    /// Return/replay instruction; never initiates an action.
    pub status_text: &'static str,
}

/// Retains only the accepted outcome across a later socket-close observation.
#[derive(Clone, Debug, Default)]
pub struct EndScreenState {
    victory: Option<bool>,
}

impl EndScreenState {
    /// Project committed observations. Invalid scores preserve retained state.
    pub fn project(&mut self, input: EndScreenInput) -> Result<EndScreenView, &'static str> {
        if let Some(score) = input.final_score
            && (!score.is_finite() || score.fract() != 0. || score.abs() > 9_007_199_254_740_991.)
        {
            return Err("final score must be a safe integer");
        }
        if !input.life_ended || input.phase == EndScreenPhase::Active {
            self.victory = None;
            return Ok(EndScreenView::default());
        }
        match input.phase {
            EndScreenPhase::Victory => self.victory = Some(true),
            EndScreenPhase::Dead => self.victory = Some(false),
            EndScreenPhase::Closed => (),
            EndScreenPhase::Active => unreachable!(),
        }
        let Some(victory) = self.victory else {
            // A close alone supplies no authority for an end-screen outcome.
            return Ok(EndScreenView::default());
        };
        let score_text = input.final_score.map_or_else(String::new, |score| {
            let suffix = if score > 1000. { "!" } else { "" };
            format!("Your final length was {}{suffix}", score as i64)
        });
        let status_text = if input.playing {
            "Returning to the start screen..."
        } else if input.local_replay {
            "Select Play to play again."
        } else {
            "Session ended."
        };
        Ok(EndScreenView {
            visible: true,
            title: if victory { "Victory" } else { "Game over" },
            score_text,
            status_text,
        })
    }
}
