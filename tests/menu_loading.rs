//! Authored synthetic presentation cases; no browser, source or server.
use slither_client::{menu_loading::project_menu_loading, start_page::project_start_page};

#[test]
fn startup_is_indeterminate_and_handoff_requires_completed_owner_mounts() {
    for code in ["loading", "waiting-assets"] {
        let pending = project_menu_loading(code, false).unwrap();
        assert!(pending.visible && pending.busy);
        assert!(!pending.text.contains('%'));
        let handed_off = project_menu_loading(code, true).unwrap();
        assert!(!handed_off.visible && !handed_off.busy);
    }
    for code in ["ready-not-connected", "connected", "disconnected"] {
        assert!(project_menu_loading(code, false).unwrap().visible);
        assert!(!project_menu_loading(code, true).unwrap().visible);
    }
}

#[test]
fn terminal_surface_reuses_start_page_labels_without_granting_admission() {
    for (code, status) in [
        ("host-unavailable", "unavailable"),
        ("csp-or-module-unavailable", "unavailable"),
        ("client-failed", "failed"),
        ("disposed", "not-connected"),
    ] {
        for mounted in [false, true] {
            let view = project_menu_loading(code, mounted).unwrap();
            assert!(view.visible && !view.busy);
            assert_eq!(
                view.text,
                project_start_page(status, false, false).unwrap().status
            );
        }
    }
    for code in ["", "ready", "retry", "__proto__", "endpoint private"] {
        assert!(project_menu_loading(code, false).is_err());
    }
}

#[test]
fn connection_busy_uses_the_existing_label_without_reviving_completed_loading() {
    let before_handoff = project_menu_loading("connecting", false).unwrap();
    assert!(before_handoff.visible && before_handoff.busy);
    assert_eq!(before_handoff.text, "Connecting.");
    let after_handoff = project_menu_loading("connecting", true).unwrap();
    assert!(!after_handoff.visible && !after_handoff.busy);
    assert_eq!(after_handoff.text, before_handoff.text);
    let play = project_start_page("connecting", true, false).unwrap();
    assert!(play.busy && play.disabled);
    assert_eq!(play.button, "Connecting…");
}
