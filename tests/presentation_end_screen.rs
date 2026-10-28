//! Authored synthetic session/HUD observations; no reference or server inputs.
use slither_client::presentation::{EndScreenInput, EndScreenPhase, EndScreenState};

fn input(phase: EndScreenPhase) -> EndScreenInput {
    EndScreenInput {
        phase,
        playing: true,
        life_ended: true,
        local_replay: true,
        final_score: Some(1001.),
    }
}

#[test]
fn death_waits_for_existing_return_before_advertising_explicit_play() {
    let mut state = EndScreenState::default();
    let death = state.project(input(EndScreenPhase::Dead)).unwrap();
    assert!(death.visible);
    assert_eq!(death.title, "Game over");
    assert_eq!(death.score_text, "Your final length was 1001!");
    assert_eq!(death.status_text, "Returning to the start screen...");
    let returned = state
        .project(EndScreenInput {
            playing: false,
            ..input(EndScreenPhase::Closed)
        })
        .unwrap();
    assert_eq!(returned.status_text, "Select Play to play again.");
    assert_eq!(returned.score_text, death.score_text);
}

#[test]
fn victory_is_only_selected_by_the_existing_victory_phase_and_survives_close() {
    let mut state = EndScreenState::default();
    assert_eq!(
        state.project(input(EndScreenPhase::Victory)).unwrap().title,
        "Victory"
    );
    assert_eq!(
        state
            .project(EndScreenInput {
                playing: false,
                ..input(EndScreenPhase::Closed)
            })
            .unwrap()
            .title,
        "Victory"
    );
    assert_eq!(
        state.project(input(EndScreenPhase::Dead)).unwrap().title,
        "Game over"
    );
}

#[test]
fn disconnect_alone_cannot_invent_a_result_even_with_a_stale_final_score() {
    let mut state = EndScreenState::default();
    assert!(
        !state
            .project(input(EndScreenPhase::Closed))
            .unwrap()
            .visible
    );
    assert!(
        !state
            .project(input(EndScreenPhase::Active))
            .unwrap()
            .visible
    );
}

#[test]
fn ordinary_play_and_new_session_clear_retained_outcome() {
    let mut state = EndScreenState::default();
    state.project(input(EndScreenPhase::Victory)).unwrap();
    assert!(
        !state
            .project(input(EndScreenPhase::Active))
            .unwrap()
            .visible
    );
    assert!(
        !state
            .project(input(EndScreenPhase::Closed))
            .unwrap()
            .visible
    );
    state.project(input(EndScreenPhase::Dead)).unwrap();
    assert!(
        !state
            .project(EndScreenInput {
                life_ended: false,
                ..input(EndScreenPhase::Closed)
            })
            .unwrap()
            .visible
    );
    assert!(
        !state
            .project(input(EndScreenPhase::Closed))
            .unwrap()
            .visible
    );
}

#[test]
fn remote_return_never_offers_unavailable_replay() {
    let mut state = EndScreenState::default();
    let view = state
        .project(EndScreenInput {
            playing: false,
            local_replay: false,
            ..input(EndScreenPhase::Victory)
        })
        .unwrap();
    assert_eq!(view.status_text, "Session ended.");
}

#[test]
fn final_capture_is_optional_and_keeps_existing_score_domain_and_exclamation_threshold() {
    let mut state = EndScreenState::default();
    assert_eq!(
        state
            .project(EndScreenInput {
                final_score: None,
                ..input(EndScreenPhase::Dead)
            })
            .unwrap()
            .score_text,
        ""
    );
    for (score, text) in [
        (-0., "0"),
        (-42., "-42"),
        (1000., "1000"),
        (1001., "1001!"),
        (9_007_199_254_740_991., "9007199254740991!"),
    ] {
        assert_eq!(
            state
                .project(EndScreenInput {
                    final_score: Some(score),
                    ..input(EndScreenPhase::Dead)
                })
                .unwrap()
                .score_text,
            format!("Your final length was {text}")
        );
    }
}

#[test]
fn rejected_scores_preserve_the_accepted_outcome() {
    let mut state = EndScreenState::default();
    state.project(input(EndScreenPhase::Victory)).unwrap();
    for score in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        0.5,
        9_007_199_254_740_992.,
    ] {
        assert!(
            state
                .project(EndScreenInput {
                    final_score: Some(score),
                    ..input(EndScreenPhase::Dead)
                })
                .is_err()
        );
        assert_eq!(
            state.project(input(EndScreenPhase::Closed)).unwrap().title,
            "Victory"
        );
    }
}
