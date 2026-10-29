//! Explicit owned-menu Play admission, independent of browser and session ownership.

use crate::menu_preferences::MenuPreferences;

/// Retains only menu admission, never credentials, selected bytes or session state.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayAdmission {
    local: bool,
    available: bool,
    accepted: bool,
    return_pending: bool,
}

impl PlayAdmission {
    /// Observe existing route/profile capability availability; grant no new capability.
    pub fn new(local: bool, profile_available: bool) -> Self {
        Self {
            local,
            available: local || profile_available,
            accepted: false,
            return_pending: false,
        }
    }

    /// Whether the captured route supports the existing explicit Play path.
    pub fn available(&self) -> bool {
        self.available
    }

    /// Whether admission has been consumed, including an unavailable initial lock.
    pub fn accepted(&self) -> bool {
        self.accepted
    }

    /// Reuse the menu's existing nickname wire domain without changing preferences.
    pub fn nickname_valid(&self, nickname: &str) -> bool {
        MenuPreferences::new(self.local)
            .set_nickname(nickname)
            .is_ok()
    }

    /// Consume an available attempt before UI locking or browser launch effects.
    pub fn accept(&mut self) -> bool {
        if !self.available || self.accepted {
            return false;
        }
        self.accepted = true;
        true
    }

    /// Consume unavailable admission at the existing post-binding UI-lock seam.
    pub fn lock_unavailable(&mut self) -> bool {
        if self.available {
            return false;
        }
        self.accepted = true;
        true
    }

    /// Observe a copied session phase/playing flag without changing that session.
    /// Unknown phases cannot authorize a return. Disconnect retains its original
    /// unconditional return rule; victory requires the completed nonplaying return.
    pub fn return_ready(&mut self, phase: &str, playing: bool) -> bool {
        self.return_pending = self.local
            && self.accepted
            && (phase == "disconnected" || phase == "victory" && !playing);
        self.return_pending
    }

    /// Release local admission only after the caller's UI unlock has succeeded.
    /// Failures before this commit leave acceptance consumed. A new attempt still
    /// requires explicit Play; remote attempts are never released here.
    pub fn complete_return(&mut self) -> Result<(), &'static str> {
        if !self.return_pending {
            return Err("No accepted local Play to return");
        }
        self.accepted = false;
        self.return_pending = false;
        Ok(())
    }
}
