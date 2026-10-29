//! Authored synthetic Play policy cases; no browser, server or reference.

use slither_client::{menu_preferences::MenuPreferences, play_admission::PlayAdmission};

#[test]
fn existing_capability_availability_and_initial_lock_are_distinct_from_acceptance() {
    for local in [false, true] {
        for profile in [false, true] {
            let mut policy = PlayAdmission::new(local, profile);
            assert_eq!(policy.available(), local || profile);
            assert!(!policy.accepted());
            assert_eq!(policy.lock_unavailable(), !(local || profile));
            assert_eq!(policy.accepted(), !(local || profile));
            assert_eq!(policy.accept(), local || profile);
            assert!(policy.accepted());
            assert!(!policy.accept());
        }
    }
}

#[test]
fn nickname_admission_reuses_menu_domain_and_never_consumes_an_attempt() {
    for local in [false, true] {
        let policy = PlayAdmission::new(local, true);
        for nickname in [
            "",
            " \u{7f} ",
            "ASCII",
            "\u{1f}",
            "\u{80}",
            &"x".repeat(24),
            &"x".repeat(25),
        ] {
            assert_eq!(
                policy.nickname_valid(nickname),
                MenuPreferences::new(local).set_nickname(nickname).is_ok()
            );
            assert!(!policy.accepted());
        }
    }
}

#[test]
fn only_local_terminal_observations_offer_return_and_only_commit_releases_it() {
    for local in [false, true] {
        let mut policy = PlayAdmission::new(local, true);
        assert!(policy.complete_return().is_err());
        for phase in [
            "idle",
            "opening",
            "connected",
            "disconnected",
            "victory",
            "error",
            "",
            "unknown",
        ] {
            for playing in [false, true] {
                assert!(!policy.return_ready(phase, playing));
            }
        }
        assert!(policy.accept());
        for phase in [
            "idle",
            "opening",
            "connected",
            "disconnected",
            "victory",
            "error",
            "",
            "unknown",
        ] {
            for playing in [false, true] {
                let expected = local && (phase == "disconnected" || phase == "victory" && !playing);
                assert_eq!(policy.return_ready(phase, playing), expected);
                assert!(
                    policy.accepted(),
                    "observation/unlock failure must not release admission"
                );
                assert!(
                    !policy.accept(),
                    "no implicit retry after error or return observation"
                );
            }
        }
        if local {
            assert!(
                policy.complete_return().is_err(),
                "unknown phase cannot authorize a commit"
            );
            assert!(policy.return_ready("disconnected", false));
            policy.complete_return().unwrap();
            assert!(!policy.accepted());
            assert!(!policy.return_ready("disconnected", false));
            assert!(policy.complete_return().is_err());
            assert!(policy.accept(), "next attempt requires this explicit call");
        } else {
            assert!(policy.complete_return().is_err());
            assert!(policy.accepted());
        }
    }
}
