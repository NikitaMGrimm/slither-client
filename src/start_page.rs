//! Authored start/ready view policy, independent of browser and session ownership.

/// A copied Play-panel projection. It grants no connection or replay authority.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StartPageView {
    /// Hide the entire panel while the existing session still owns gameplay.
    pub visible: bool,
    /// An admitted connection attempt is preparing or opening.
    pub busy: bool,
    /// Native button availability, including the caller's admission lock.
    pub disabled: bool,
    /// Fixed plain status text; never includes endpoint, nickname or errors.
    pub status: &'static str,
    /// Fixed button text.
    pub button: &'static str,
}

/// Project the existing UI status, admission lock and committed session flag.
///
/// `playing` stays true during the existing death/return transition. This view
/// must not reveal editable controls early or decide when a session can restart.
/// Unknown statuses fail closed without changing the caller's state.
pub fn project_start_page(
    status: &str,
    locked: bool,
    playing: bool,
) -> Result<StartPageView, &'static str> {
    let (text, busy, unavailable) = match status {
        "ready" => ("Ready.", false, false),
        "empty-endpoint" => ("Enter a server address.", false, false),
        "invalid-endpoint" => ("Enter a valid server address.", false, false),
        "invalid-nickname" => ("Check the nickname.", false, false),
        "preparing" => ("Preparing connection.", true, false),
        "connecting" => ("Connecting.", true, false),
        "connected" => ("Connected.", false, false),
        "not-connected" => ("Not connected.", false, false),
        "unavailable" => ("Play unavailable on this page.", false, true),
        "failed" => ("Play failed. Reload to start again.", false, true),
        _ => return Err("Unknown start page status"),
    };
    Ok(StartPageView {
        visible: !playing,
        busy: busy && !playing,
        disabled: locked || playing || busy || unavailable,
        status: text,
        button: if busy { "Connecting…" } else { "Play" },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_validation_and_unavailable_states_do_not_grant_admission() {
        for status in [
            "ready",
            "empty-endpoint",
            "invalid-endpoint",
            "invalid-nickname",
            "not-connected",
        ] {
            let ready = project_start_page(status, false, false).unwrap();
            assert!(ready.visible);
            assert!(!ready.disabled);
            assert!(!ready.busy);
            assert_eq!(ready.button, "Play");
            assert!(project_start_page(status, true, false).unwrap().disabled);
        }
        for status in ["unavailable", "failed"] {
            assert!(project_start_page(status, false, false).unwrap().disabled);
        }
        for status in ["", "READY", "__proto__", "private endpoint"] {
            assert!(project_start_page(status, false, false).is_err());
        }
    }

    #[test]
    fn busy_and_active_gameplay_are_distinct() {
        for status in ["preparing", "connecting"] {
            let view = project_start_page(status, true, false).unwrap();
            assert!(view.visible && view.busy && view.disabled);
            assert_eq!(view.button, "Connecting…");
            let playing = project_start_page(status, false, true).unwrap();
            assert!(!playing.visible && !playing.busy && playing.disabled);
        }
    }

    #[test]
    fn death_and_return_follow_the_existing_playing_flag() {
        let alive = project_start_page("connected", true, true).unwrap();
        let dying = project_start_page("connected", true, true).unwrap();
        assert_eq!(alive, dying);
        assert!(!dying.visible);
        let returned_remote = project_start_page("not-connected", true, false).unwrap();
        assert!(returned_remote.visible && returned_remote.disabled);
        let returned_local = project_start_page("not-connected", false, false).unwrap();
        assert!(returned_local.visible && !returned_local.disabled);
    }
}
