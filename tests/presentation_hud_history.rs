//! Authored synthetic requirements ported from the existing HUD reducer/view fixtures.

use slither_client::presentation::{
    HudHistory, HudHistoryEvent as Event, HudLifecycle, HudOpacity, HudSample, SnakeObjectToken,
    hud_score_text,
};

fn token(value: u64) -> SnakeObjectToken {
    SnakeObjectToken::new(value).unwrap()
}
fn sample(score: f64, serial: u64) -> HudSample {
    HudSample {
        score,
        token: token(serial),
    }
}
fn board(rank: u16, population: u16, death_pending: bool) -> Event {
    Event::Leaderboard {
        rank,
        population,
        death_pending,
    }
}
fn pending() -> HudHistory {
    HudHistory::default()
        .packet(&[Event::OwnLengthScheduled(token(7)), board(7, 23, false)])
        .unwrap()
}
fn life() -> HudLifecycle {
    HudLifecycle {
        death_pending: false,
        return_active: false,
        return_completed: false,
        return_fraction: 1.,
    }
}
fn opacities(value: f64) -> HudOpacity {
    HudOpacity {
        readout: value,
        header: 0.85 * value,
        rows: value,
        announcement: value,
    }
}

#[test]
fn initial_state_and_dirty_readout_gate() {
    let fresh = HudHistory::default();
    assert_eq!(fresh.own_token, None);
    assert_eq!(fresh.best_rank, 999_999_999);
    assert_eq!(fresh.fade, -1.);
    assert_eq!(fresh.requested_opacity, HudOpacity::default());
    assert!(!fresh.readout_required(true));
    let state = pending();
    assert!(state.readout_required(true));
    assert!(!state.readout_required(false));
    assert_eq!(state.draw(false, None).unwrap(), state);
    for (rank, population) in [(0, 23), (7, 0), (0, 0)] {
        let blocked = state.packet(&[board(rank, population, false)]).unwrap();
        assert!(!blocked.readout_required(true));
        assert!(blocked.draw(true, Some(sample(42., 7))).is_err());
        assert!(blocked.draw(true, None).unwrap().dirty);
    }
}

#[test]
fn extrema_include_zero_and_display_keeps_its_sampled_header() {
    let shown = pending().draw(true, Some(sample(77., 7))).unwrap();
    let state = shown
        .packet(&[board(0, 40, false), board(5, 0, false), board(9, 23, false)])
        .unwrap();
    assert_eq!(state.best_rank, 0);
    assert_eq!(state.max_population, 40);
    assert_eq!(state.current, shown.current);
    let next = state
        .draw(true, Some(sample(88., 7)))
        .unwrap()
        .current
        .unwrap();
    assert_eq!(
        (next.sample.score, next.rank, next.population),
        (88., 9, 23)
    );
}

#[test]
fn ready_number_scores_keep_sign_wide_values_and_lossless_tokens() {
    for score in [-5., -0., 4_294_967_297., 9_007_199_254_740_992., f64::MAX] {
        let state = HudHistory::default()
            .packet(&[board(1, 65535, false)])
            .unwrap()
            .draw(true, Some(sample(score, u64::MAX)))
            .unwrap();
        let value = state.current.unwrap();
        assert_eq!(value.sample.score.to_bits(), score.to_bits());
        assert_eq!(value.sample.token.serial(), u64::MAX);
    }
    for score in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 1.5] {
        assert!(pending().draw(true, Some(sample(score, 7))).is_err());
        assert!(
            pending()
                .packet(&[Event::FinalScore(sample(score, 7))])
                .is_err()
        );
    }
    assert!(pending().draw(true, None).is_err());
}

#[test]
fn equal_schedule_dirties_again_but_empty_journal_does_not() {
    let shown = pending().draw(true, Some(sample(100., 7))).unwrap();
    assert_eq!(shown.packet(&[]).unwrap(), shown);
    assert_eq!(shown.draw(true, None).unwrap(), shown);
    let scheduled = shown
        .packet(&[Event::OwnLengthScheduled(token(7))])
        .unwrap();
    assert!(scheduled.dirty);
    assert_eq!(scheduled.current, shown.current);
    let refreshed = scheduled.draw(true, Some(sample(123., 7))).unwrap();
    assert!(!refreshed.dirty);
    assert_eq!(refreshed.current.unwrap().sample.score, 123.);
}

#[test]
fn setup_draw_consumes_intermediate_sample_before_later_own_and_final_events() {
    let state = pending()
        .packet(&[
            Event::Setup,
            Event::SetupDraw(Some(sample(10., 7))),
            Event::OwnLengthScheduled(token(7)),
            Event::FinalScore(sample(2000., 7)),
        ])
        .unwrap();
    assert_eq!(state.current.unwrap().sample.score, 10.);
    assert_eq!(state.final_capture.unwrap().sample.score, 2000.);
    assert!(state.dirty);
    assert_eq!(state.fade, -1.);
    assert_eq!(state.requested_opacity, HudOpacity::default());
    let later = pending()
        .packet(&[
            Event::Setup,
            Event::SetupDraw(Some(sample(11., 7))),
            board(4, 18, false),
        ])
        .unwrap();
    let current = later.current.unwrap();
    assert_eq!(
        (current.sample.score, current.rank, current.population),
        (11., 7, 23)
    );
    assert_eq!((later.rank, later.population, later.fade), (4, 18, 0.));
    assert!(later.dirty);
}

#[test]
fn repeated_setup_refreshes_only_after_actual_dirty_event() {
    let setup = [
        Event::Setup,
        Event::SetupDraw(Some(sample(10., 7))),
        Event::Setup,
        Event::SetupDraw(Some(sample(20., 7))),
    ];
    let state = pending().packet(&setup).unwrap();
    assert_eq!(state.current.unwrap().sample.score, 10.);
    assert!(!state.dirty);
    let state = pending()
        .packet(&[
            setup[0],
            setup[1],
            Event::OwnLengthScheduled(token(7)),
            setup[2],
            setup[3],
        ])
        .unwrap();
    assert_eq!(state.current.unwrap().sample.score, 20.);
}

#[test]
fn ineligible_setup_ignores_nonready_and_unrelated_token_observations() {
    let fresh = HudHistory::default();
    assert_eq!(
        fresh
            .packet(&[Event::Setup, Event::SetupDraw(None)])
            .unwrap(),
        fresh
    );
    let bound = fresh
        .packet(&[Event::OwnLengthScheduled(token(7))])
        .unwrap();
    for view in [None, Some(sample(9., 8))] {
        let state = bound
            .packet(&[Event::Setup, Event::SetupDraw(view)])
            .unwrap();
        assert_eq!(state.own_token, Some(token(7)));
        assert!(state.dirty);
    }
    assert!(
        pending()
            .packet(&[Event::Setup, Event::SetupDraw(None)])
            .is_err()
    );
    let shown = pending()
        .draw(true, Some(sample(70., 7)))
        .unwrap()
        .packet(&[Event::FinalScore(sample(1200., 7))])
        .unwrap()
        .step(5., life())
        .unwrap();
    let hidden = shown
        .packet(&[Event::Setup, Event::SetupDraw(None)])
        .unwrap();
    assert_eq!(hidden.current, shown.current);
    assert_eq!(hidden.final_capture, shown.final_capture);
    assert_eq!(hidden.own_token, shown.own_token);
    assert_eq!(hidden.fade, -1.);
    assert_eq!(hidden.requested_opacity, HudOpacity::default());
}

#[test]
fn final_capture_is_last_wins_and_threshold_is_strict() {
    let state = pending().step(0.5, life()).unwrap();
    for (score, exclamation, suffix) in [(1000., false, ""), (1001., true, "!"), (-0., false, "")] {
        let next = state
            .packet(&[
                Event::FinalScore(sample(9000., 7)),
                Event::FinalScore(sample(score, 7)),
            ])
            .unwrap();
        let final_value = next.final_capture.unwrap();
        assert_eq!(final_value.sample.score.to_bits(), score.to_bits());
        assert_eq!(final_value.exclamation, exclamation);
        assert_eq!(final_value.suffix(), suffix);
        assert_eq!(next.current, state.current);
        assert_eq!(next.dirty, state.dirty);
        assert_eq!(next.requested_opacity, state.requested_opacity);
    }
}

#[test]
fn token_replacement_on_every_path_and_late_failure_are_atomic() {
    let state = pending();
    let before = state.clone();
    for events in [
        vec![Event::OwnLengthScheduled(token(8))],
        vec![Event::FinalScore(sample(9., 8))],
        vec![Event::Setup, Event::SetupDraw(Some(sample(9., 8)))],
        vec![
            Event::Setup,
            Event::SetupDraw(Some(sample(10., 7))),
            board(1, 99, false),
            Event::OwnLengthScheduled(token(8)),
        ],
        vec![board(1, 99, false), Event::Setup, Event::SetupDraw(None)],
    ] {
        assert!(state.packet(&events).is_err());
        assert_eq!(state, before);
    }
    assert!(state.draw(true, Some(sample(9., 8))).is_err());
    assert_eq!(state, before);
    assert_eq!(
        state
            .draw(true, Some(sample(42., 7)))
            .unwrap()
            .current
            .unwrap()
            .sample
            .score,
        42.
    );
}

#[test]
fn reset_preserves_displayed_history_dirty_and_opacity_while_new_live_token_binds() {
    let state = pending()
        .draw(true, Some(sample(10., 7)))
        .unwrap()
        .step(0.5, life())
        .unwrap()
        .packet(&[
            Event::OwnLengthScheduled(token(7)),
            Event::FinalScore(sample(2000., 7)),
        ])
        .unwrap();
    let reset = state.reset_world();
    assert_eq!(reset.own_token, None);
    assert_eq!(
        (
            reset.rank,
            reset.population,
            reset.max_population,
            reset.best_rank
        ),
        (0, 0, 0, 999_999_999)
    );
    assert_eq!(reset.current, state.current);
    assert_eq!(reset.final_capture, state.final_capture);
    assert_eq!(reset.dirty, state.dirty);
    assert_eq!(reset.requested_opacity, state.requested_opacity);
    let next = reset
        .packet(&[
            Event::Setup,
            Event::SetupDraw(None),
            Event::OwnLengthScheduled(token(8)),
            board(7, 23, false),
        ])
        .unwrap()
        .draw(true, Some(sample(30., 8)))
        .unwrap();
    assert_eq!(next.current.unwrap().sample.token, token(8));
    assert_eq!(next.final_capture.unwrap().sample.token, token(7));
    assert!(!next.reset_world().dirty);
}

#[test]
fn alive_fade_zero_delta_saturation_sentinel_and_pending_death() {
    assert_eq!(
        HudHistory::default().step(0.5, life()).unwrap(),
        HudHistory::default()
    );
    let initial = pending();
    let mut state = initial.step(0.5, life()).unwrap();
    assert_eq!(state.fade, 0.005);
    assert_eq!(state.requested_opacity, opacities(0.005));
    assert_eq!(state.step(0., life()).unwrap(), state);
    state = state.step(5., life()).unwrap();
    assert_eq!(state.fade, 0.055);
    for _ in 0..20 {
        state = state.step(5., life()).unwrap();
    }
    assert_eq!(state.fade, 1.);
    assert_eq!(state.requested_opacity, opacities(1.));
    assert_eq!(state.step(5., life()).unwrap(), state);
    let death = HudLifecycle {
        death_pending: true,
        ..life()
    };
    assert_eq!(state.step(5., death).unwrap(), state);
    let hidden = HudHistory::default().packet(&[board(7, 23, true)]).unwrap();
    assert_eq!(hidden.fade, -1.);
    assert_eq!(hidden.step(5., death).unwrap(), hidden);
    assert_eq!(
        initial
            .step(
                1.,
                HudLifecycle {
                    return_fraction: 0.,
                    ..life()
                }
            )
            .unwrap()
            .fade,
        0.01
    );
}

#[test]
fn return_uses_supplied_fraction_at_zero_delta_completion_wins_and_reset_retains_requests() {
    let active = HudLifecycle {
        death_pending: true,
        return_active: true,
        return_fraction: 0.6,
        ..life()
    };
    let state = pending().step(0., active).unwrap();
    assert_eq!(state.fade, 0.6);
    assert_eq!(state.requested_opacity, opacities(0.6));
    let done = state
        .step(
            0.,
            HudLifecycle {
                return_active: true,
                return_completed: true,
                return_fraction: 0.,
                ..life()
            },
        )
        .unwrap();
    assert_eq!(done.fade, -1.);
    assert_eq!(done.requested_opacity, opacities(-1.));
    assert_eq!(done.reset_world().requested_opacity, done.requested_opacity);
    assert_eq!(done.step(5., life()).unwrap(), done);
    let setup = done
        .packet(&[Event::Setup, Event::SetupDraw(Some(sample(42., 7)))])
        .unwrap();
    assert_eq!(setup.requested_opacity, HudOpacity::default());
}

#[test]
fn lifecycle_validation_rejects_all_out_of_domain_numbers_and_inconsistent_flags() {
    let state = pending();
    for delta in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.01, 5.01] {
        assert!(state.step(delta, life()).is_err());
    }
    for return_fraction in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.01, 1.01] {
        assert!(
            state
                .step(
                    0.5,
                    HudLifecycle {
                        return_fraction,
                        ..life()
                    }
                )
                .is_err()
        );
    }
    for invalid in [
        HudLifecycle {
            return_completed: true,
            return_fraction: 0.,
            ..life()
        },
        HudLifecycle {
            return_completed: true,
            return_active: true,
            death_pending: true,
            return_fraction: 0.,
        },
        HudLifecycle {
            return_completed: true,
            return_active: true,
            return_fraction: 0.1,
            ..life()
        },
        HudLifecycle {
            return_active: true,
            return_fraction: 0.5,
            ..life()
        },
        HudLifecycle {
            return_active: true,
            death_pending: true,
            return_fraction: 0.,
            ..life()
        },
    ] {
        assert!(state.step(0.5, invalid).is_err());
    }
    assert_eq!(state, pending());
}

#[test]
fn bounded_journal_is_not_retained_and_packet_positions_restart() {
    let mut events = Vec::new();
    for _ in 0..4096 {
        events.extend([Event::Setup, Event::SetupDraw(None)]);
    }
    assert_eq!(
        HudHistory::default().packet(&events).unwrap(),
        HudHistory::default()
    );
    events.push(Event::Setup);
    assert!(HudHistory::default().packet(&events).is_err());
    let state = pending()
        .packet(&[board(1, 65535, false)])
        .unwrap()
        .packet(&[board(65535, 1, false)])
        .unwrap();
    assert_eq!(
        (state.rank, state.population, state.max_population),
        (65535, 1, 65535)
    );
}

#[test]
fn semantic_text_preserves_decimal_contract_and_separate_final_capture() {
    for (score, text) in [
        (-0., "0"),
        (-5., "-5"),
        (4_294_967_297., "4294967297"),
        (9_007_199_254_740_991., "9007199254740991"),
        (-9_007_199_254_740_991., "-9007199254740991"),
    ] {
        assert_eq!(hud_score_text(score).unwrap(), text);
    }
    for score in [9_007_199_254_740_992., f64::NAN, f64::INFINITY, 1.5] {
        assert!(hud_score_text(score).is_err());
    }
    let state = pending()
        .packet(&[Event::FinalScore(sample(1001., 7))])
        .unwrap()
        .draw(true, Some(sample(1000., 7)))
        .unwrap();
    let current = state.current.unwrap();
    assert_eq!(
        (
            current.score_text().unwrap(),
            current.rank_text(),
            current.population_text()
        ),
        ("1000".into(), "7".into(), "23".into())
    );
    let final_value = state.final_capture.unwrap();
    assert_eq!(final_value.score_text().unwrap(), "1001");
    assert_eq!(final_value.suffix(), "!");
}
