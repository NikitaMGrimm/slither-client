//! Original synthetic desktop quality cases, without reference files or networking.

use slither_client::presentation::{FrameClock, QualityMode, QualityState};

fn advance(state: &mut QualityState, delta: f64, playing: bool) {
    let mut clock = FrameClock::new(0.).unwrap();
    state
        .advance(clock.advance(delta * 8., false, false).unwrap(), playing)
        .unwrap();
}

#[test]
fn stored_preference_is_distinct_from_startup_and_connection_quality() {
    let mut state = QualityState::new(QualityMode::Low, 17.).unwrap();
    assert!(state.snapshot().high_quality);
    assert_eq!(state.snapshot().quality_blend, 1.);
    assert_eq!(state.snapshot().quality_scale, 1.);
    state.begin_connection();
    assert!(!state.snapshot().high_quality);
    assert_eq!(state.snapshot().quality_blend, 0.);
    assert_eq!(state.snapshot().quality_scale, 1.7);
    state.set_requested_mode(QualityMode::High);
    assert!(!state.snapshot().high_quality);
    state.begin_connection();
    assert!(state.snapshot().high_quality);
    assert_eq!(state.snapshot().quality_blend, 1.);
    assert_eq!(state.snapshot().quality_scale, 1.);
    assert_eq!(state.last_statistics_ms(), 17.);
}

#[test]
fn statistics_use_strict_interval_and_raw_counts_without_catchup() {
    let mut state = QualityState::new(QualityMode::High, 100.).unwrap();
    assert!(!state.update_statistics(1100., 0, true).unwrap());
    assert!(!state.update_statistics(-500., 0, true).unwrap());
    assert!(state.snapshot().high_quality);
    assert!(state.update_statistics(1100.25, 24, true).unwrap());
    assert!(!state.snapshot().high_quality);
    assert_eq!(state.snapshot().low_fps_counter, 1.);
    assert!(state.update_statistics(100_000., 32, true).unwrap());
    assert_eq!(state.snapshot().low_fps_counter, 0.887);
    assert_eq!(state.last_statistics_ms(), 100_000.);
    assert!(!state.update_statistics(100_000., 0, true).unwrap());
}

#[test]
fn draw_count_thresholds_and_negative_recovery_residual_are_preserved() {
    let mut state = QualityState::new(QualityMode::High, 0.).unwrap();
    state.update_statistics(1001., 25, true).unwrap();
    assert!(state.snapshot().high_quality);
    state.update_statistics(2002., 24, true).unwrap();
    for (index, count) in [25, 31].into_iter().enumerate() {
        state
            .update_statistics(3003. + index as f64 * 1001., count, true)
            .unwrap();
        assert_eq!(state.snapshot().low_fps_counter, 1.);
    }
    let mut now = 4004.;
    let mut expected = 1.;
    while expected > 0. {
        now += 1001.;
        expected *= 0.987;
        expected -= 0.1;
        state.update_statistics(now, 32, true).unwrap();
        assert_eq!(state.snapshot().low_fps_counter, expected);
        assert_eq!(state.snapshot().high_quality, expected <= 0.);
    }
    assert!(expected < 0.);
    // One poor interval after recovery can leave the counter below one.
    state.update_statistics(now + 1001., 0, true).unwrap();
    assert!(state.snapshot().high_quality);
    assert_eq!(state.snapshot().low_fps_counter, expected + 1.);
    // While already HQ, 25 draws suffice to decay that remaining history.
    state.update_statistics(now + 2002., 25, true).unwrap();
    assert_eq!(
        state.snapshot().low_fps_counter,
        (expected + 1.) * 0.987 - 0.1
    );
    state.update_statistics(now + 3003., 24, true).unwrap();
    assert!(!state.snapshot().high_quality);
}

#[test]
fn interpolation_precedes_statistics_and_uses_lag_adjusted_fractional_delta() {
    let mut state = QualityState::new(QualityMode::High, 0.).unwrap();
    advance(&mut state, 2., true);
    state.update_statistics(1001., 0, true).unwrap();
    assert_eq!(state.snapshot().quality_blend, 1.);
    assert_eq!(state.snapshot().quality_scale, 1.);
    let mut clock = FrameClock::new(0.).unwrap();
    let step = clock.advance(4., true, false).unwrap();
    state.advance(step, true).unwrap();
    assert_eq!(state.snapshot().quality_blend, 1. - 0.425 * 0.0075);
    assert_eq!(state.snapshot().quality_scale, 1. + 0.425 * 4E-5);
    let frozen = state.clone();
    advance(&mut state, 5., false);
    advance(&mut state, 0., true);
    assert_eq!(state, frozen);
}

#[test]
fn density_and_blend_reach_both_endpoints_on_their_distinct_timescales() {
    let mut state = QualityState::new(QualityMode::High, 0.).unwrap();
    state.update_statistics(1001., 0, true).unwrap();
    for _ in 0..30 {
        advance(&mut state, 5., true);
    }
    assert_eq!(state.snapshot().quality_blend, 0.);
    assert!(state.snapshot().quality_scale < 1.01);
    for _ in 0..3600 {
        advance(&mut state, 5., true);
    }
    assert_eq!(state.snapshot().quality_scale, 1.7);
    let mut now = 1001.;
    while !state.snapshot().high_quality {
        now += 1001.;
        state.update_statistics(now, 40, true).unwrap();
    }
    assert_eq!(state.snapshot().quality_blend, 0.);
    advance(&mut state, 0.5, true);
    assert_eq!(state.snapshot().quality_blend, 0.00375);
    assert_eq!(state.snapshot().quality_scale, 1.7 - 0.5 * 4E-5);
    for _ in 0..3600 {
        advance(&mut state, 5., true);
    }
    assert_eq!(state.snapshot().quality_blend, 1.);
    assert_eq!(state.snapshot().quality_scale, 1.);
}

#[test]
fn low_preference_disables_statistics_without_forcing_runtime_low() {
    let mut state = QualityState::new(QualityMode::Low, 0.).unwrap();
    state.begin_connection();
    for index in 1..=20 {
        assert!(
            state
                .update_statistics(index as f64 * 1001., 60, true)
                .unwrap()
        );
    }
    assert!(!state.snapshot().high_quality);
    state.begin_skin_preview();
    assert!(state.snapshot().high_quality);
    assert_eq!(state.snapshot().requested, QualityMode::Low);
    state.update_statistics(21_021., 0, true).unwrap();
    assert!(state.snapshot().high_quality);
    assert_eq!(state.snapshot().low_fps_counter, 0.);
}

#[test]
fn preference_changes_preserve_history_and_do_not_supply_a_recovery_trigger() {
    let mut state = QualityState::new(QualityMode::Low, 0.).unwrap();
    state.begin_connection();
    state.set_requested_mode(QualityMode::High);
    state.update_statistics(1001., 60, true).unwrap();
    assert!(!state.snapshot().high_quality);
    assert_eq!(state.snapshot().low_fps_counter, 0.);
    state.update_statistics(2002., 24, true).unwrap();
    state.set_requested_mode(QualityMode::Low);
    state.update_statistics(3003., 60, true).unwrap();
    assert_eq!(state.snapshot().low_fps_counter, 1.);
    state.set_requested_mode(QualityMode::High);
    state.update_statistics(4004., 60, true).unwrap();
    assert_eq!(state.snapshot().low_fps_counter, 0.887);
    state.begin_connection();
    assert!(state.snapshot().high_quality);
    assert_eq!(state.snapshot().low_fps_counter, 0.);
}

#[test]
fn inactive_statistics_consume_interval_and_resets_preserve_its_clock() {
    let mut state = QualityState::new(QualityMode::High, 0.).unwrap();
    assert!(state.update_statistics(1001., 0, false).unwrap());
    assert_eq!(state.snapshot().low_fps_counter, 0.);
    assert!(!state.update_statistics(2001., 0, true).unwrap());
    state.update_statistics(2002., 0, true).unwrap();
    assert_eq!(state.snapshot().low_fps_counter, 1.);
    state.begin_skin_preview();
    assert_eq!(state.snapshot().low_fps_counter, 0.);
    assert_eq!(state.last_statistics_ms(), 2002.);
    state.begin_connection();
    assert_eq!(state.last_statistics_ms(), 2002.);
    // The preview exception initializes HQ; it does not suppress later fallback.
    state.update_statistics(3003., 24, true).unwrap();
    assert!(!state.snapshot().high_quality);
}

#[test]
fn invalid_inputs_and_elapsed_overflow_leave_all_state_unchanged() {
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(QualityState::new(QualityMode::High, invalid).is_err());
    }
    let mut state = QualityState::new(QualityMode::High, -f64::MAX).unwrap();
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, f64::MAX] {
        let before = state.clone();
        assert!(state.update_statistics(invalid, 0, true).is_err());
        assert_eq!(state, before);
    }
    let mut clock = FrameClock::new(0.).unwrap();
    let valid = clock.advance(8., false, false).unwrap();
    for playing in [true, false] {
        for delta in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.1, 5.1] {
            let mut invalid = valid;
            invalid.delta = delta;
            let before = state.clone();
            assert!(state.advance(invalid, playing).is_err());
            assert_eq!(state, before);
        }
    }
}
