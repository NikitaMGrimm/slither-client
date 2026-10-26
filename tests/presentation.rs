//! Original synthetic timing, motion, and correction cases, with no external inputs.

use std::f64::consts::{PI, TAU};

use slither_client::{
    presentation::{
        ANGLE_SAMPLES, AngleCorrections, FrameClock, FrameStep, HEAD_SAMPLES, HeadCorrections,
        HeadMotion, Turn,
    },
    state::Point,
};

fn close(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-12, "{actual} != {expected}");
}

fn step(delta: f64) -> FrameStep {
    FrameStep {
        delta,
        unlagged_delta: delta,
        whole_steps: delta.floor() as u32,
        double_steps: (delta * 2.).floor() as u32,
        lag_multiplier: 1.,
        accumulated: delta,
        doubled_accumulated: delta * 2.,
    }
}

fn head() -> HeadMotion {
    HeadMotion {
        position: Point::default(),
        heading: 0.,
        wanted_heading: 0.,
        turn: Turn::None,
        speed_per_32ms: 3.2,
        segment_length: 10.,
        head_fraction: 0.25,
    }
}

#[test]
fn fractional_clock_uses_floor_differences_for_both_accumulators() {
    let mut clock = FrameClock::new(100.).unwrap();
    let first = clock.advance(103., false, false).unwrap();
    assert_eq!(
        (first.delta, first.whole_steps, first.double_steps),
        (0.375, 0, 0)
    );
    let second = clock.advance(106., false, false).unwrap();
    assert_eq!(
        (second.accumulated, second.doubled_accumulated),
        (0.75, 1.5)
    );
    assert_eq!((second.whole_steps, second.double_steps), (0, 1));
    let third = clock.advance(109., false, false).unwrap();
    assert_eq!((third.whole_steps, third.double_steps), (1, 1));
    let fourth = clock.advance(112., false, false).unwrap();
    assert_eq!((fourth.whole_steps, fourth.double_steps), (0, 1));
}

#[test]
fn clock_clamps_skew_and_moves_timestamp_backwards() {
    let mut clock = FrameClock::new(100.).unwrap();
    assert_eq!(clock.advance(1000., false, false).unwrap().delta, 5.);
    let backward = clock.advance(992., false, false).unwrap();
    assert_eq!(backward.delta, 0.);
    assert_eq!(backward.whole_steps, 0);
    assert_eq!(clock.advance(1000., false, false).unwrap().delta, 1.);
}

#[test]
fn lag_adjusts_before_delta_and_preview_freezes_adjustment_only() {
    let mut clock = FrameClock::new(0.).unwrap();
    let lagged = clock.advance(80., true, false).unwrap();
    assert_eq!(lagged.unlagged_delta, 5.);
    assert_eq!(lagged.lag_multiplier, 0.85);
    assert_eq!(lagged.delta, 4.25);
    let preview = clock.advance(88., true, true).unwrap();
    assert_eq!(preview.lag_multiplier, 0.85);
    assert_eq!(preview.delta, 0.85);
    assert_eq!(
        clock.advance(96., false, false).unwrap().lag_multiplier,
        0.9
    );
    for index in 0..40 {
        clock
            .advance(104. + index as f64 * 8., true, false)
            .unwrap();
    }
    let floor = clock.advance(500., true, false).unwrap();
    assert_eq!(floor.lag_multiplier, 0.2);
    for index in 0..20 {
        clock
            .advance(508. + index as f64 * 8., false, false)
            .unwrap();
    }
    assert_eq!(
        clock.advance(700., false, false).unwrap().lag_multiplier,
        1.
    );
}

#[test]
fn resetting_lag_preserves_phase_and_last_backward_timestamp() {
    let mut clock = FrameClock::new(1000.).unwrap();
    clock.advance(1003., false, false).unwrap();
    let lagged = clock.advance(1100., true, false).unwrap();
    assert_eq!(lagged.delta, 4.25);
    let backward = clock.advance(1096., true, false).unwrap();
    assert_eq!(backward.accumulated, 4.625);
    assert_eq!(backward.doubled_accumulated, 9.25);
    clock.reset_lag();
    clock.reset_lag();
    // Preview freezes adjustment, exposing the reset multiplier directly.
    let next = clock.advance(1100., true, true).unwrap();
    assert_eq!(next.lag_multiplier, 1.);
    assert_eq!(next.delta, 0.5);
    assert_eq!((next.accumulated, next.doubled_accumulated), (5.125, 10.25));
    assert_eq!((next.whole_steps, next.double_steps), (1, 1));
}

#[test]
fn clock_rejects_nonfinite_and_overflow_without_partial_updates() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(FrameClock::new(bad).is_err());
        let mut clock = FrameClock::new(0.).unwrap();
        clock.advance(8., true, false).unwrap();
        let before = clock.clone();
        assert!(clock.advance(bad, true, false).is_err());
        assert_eq!(clock, before);
        assert_eq!(clock.advance(16., false, false).unwrap().unlagged_delta, 1.);
    }
    let mut clock = FrameClock::new(-f64::MAX).unwrap();
    let before = clock.clone();
    assert!(clock.advance(f64::MAX, true, false).is_err());
    assert_eq!(clock, before);
}

#[test]
fn head_uses_raw_32ms_speed_and_caps_each_update_at_one_segment() {
    let mut motion = head();
    motion.advance(step(1.), 0., 1., 1., true).unwrap();
    close(motion.position.x, 0.8);
    close(motion.head_fraction, 0.33);
    motion.speed_per_32ms = 320.;
    motion.advance(step(5.), 0., 1., 1., true).unwrap();
    close(motion.position.x, 10.8);
    close(motion.head_fraction, 1.33);
    motion.wanted_heading = PI / 2.;
    motion.advance(step(1.), 0., 1., 1., true).unwrap();
    close(motion.position.y, 10.);
    close(motion.heading, PI / 2.);
}

#[test]
fn head_reanchor_consumes_fraction_and_preserves_both_states_on_failure() {
    let mut motion = head();
    let mut corrections = HeadCorrections::default();
    motion.head_fraction = 1.5;
    motion
        .reanchor(Point { x: 42., y: -3. }, 2.5, &mut corrections)
        .unwrap();
    assert_eq!(motion.position, Point { x: 42., y: -3. });
    assert_eq!(motion.head_fraction, 0.25);
    assert_eq!(corrections.offset(), [-42., 3., 0.25]);
    assert_eq!(corrections.pending(), 53);
    corrections.advance(7);
    motion
        .reanchor(Point { x: 50., y: 0. }, 0., &mut corrections)
        .unwrap();
    assert_eq!(corrections.index(), 7);
    assert_eq!(corrections.pending(), 53);
    let before = (motion, corrections.clone());
    assert!(
        motion
            .reanchor(Point { x: f64::MAX, y: 0. }, 0., &mut corrections)
            .is_err()
    );
    assert_eq!((motion, corrections.clone()), before);
    assert!(
        motion
            .reanchor(Point::default(), f64::INFINITY, &mut corrections)
            .is_err()
    );
    assert_eq!((motion, corrections), before);
}

#[test]
fn head_travel_preserves_producer_speed_and_operation_order_exactly() {
    let delta = 0.85;
    for speed in [1_f64 / 18., 128_f64 / 1000.] {
        let mut motion = head();
        motion.speed_per_32ms = speed;
        motion.advance(step(delta), 0., 1., 1., true).unwrap();
        let expected = speed * delta / 4.;
        assert_eq!(motion.position.x.to_bits(), expected.to_bits());
    }
    let speed = 1_f64 / 18.;
    let expected = speed * delta / 4.;
    let converted_through_seconds = (speed / 0.032) * delta * 0.008;
    assert_ne!(expected.to_bits(), converted_through_seconds.to_bits());
}

#[test]
fn head_wraps_in_each_direction_and_snaps_only_after_crossing() {
    let mut increasing = head();
    increasing.heading = TAU - 0.1;
    increasing.wanted_heading = 0.2;
    increasing.turn = Turn::Increasing;
    increasing.advance(step(1.), 0.2, 1., 1., false).unwrap();
    close(increasing.heading, 0.1);
    assert_eq!(increasing.turn, Turn::Increasing);
    increasing.advance(step(1.), 0.2, 1., 1., false).unwrap();
    assert_eq!((increasing.heading, increasing.turn), (0.2, Turn::None));

    let mut decreasing = head();
    decreasing.heading = 0.1;
    decreasing.wanted_heading = TAU - 0.2;
    decreasing.turn = Turn::Decreasing;
    decreasing.advance(step(1.), 0.2, 1., 1., false).unwrap();
    close(decreasing.heading, TAU - 0.1);
    assert_eq!(decreasing.turn, Turn::Decreasing);
    decreasing.advance(step(1.), 0.2, 1., 1., false).unwrap();
    assert_eq!(
        (decreasing.heading, decreasing.turn),
        (TAU - 0.2, Turn::None)
    );

    for (direction, start) in [(Turn::Increasing, 0.5), (Turn::Decreasing, 1.5)] {
        let mut motion = head();
        motion.heading = start;
        motion.wanted_heading = 1.;
        motion.turn = direction;
        motion.advance(step(1.), 0.5, 1., 1., false).unwrap();
        assert_eq!((motion.heading, motion.turn), (1., direction));
        motion.advance(step(1.), 0.5, 1., 1., false).unwrap();
        assert_eq!((motion.heading, motion.turn), (1., Turn::None));
    }
}

#[test]
fn head_turn_factors_apply_when_dead_without_moving() {
    let mut motion = head();
    motion.wanted_heading = 2.;
    motion.turn = Turn::Increasing;
    motion.advance(step(2.), 0.4, 0.5, 0.25, false).unwrap();
    close(motion.heading, 0.1);
    assert_eq!(motion.position, Point::default());
    assert_eq!(motion.head_fraction, 0.25);
}

#[test]
fn head_rejects_invalid_and_intermediate_overflow_atomically() {
    for bad in [f64::NAN, f64::INFINITY, -1.] {
        let mut motion = head();
        let before = motion;
        assert!(motion.advance(step(bad), 0.1, 1., 1., true).is_err());
        assert_eq!(motion, before);
        assert!(motion.advance(step(1.), bad, 1., 1., true).is_err());
        assert_eq!(motion, before);
    }
    let mut motion = head();
    motion.segment_length = 0.;
    let before = motion;
    assert!(motion.advance(step(1.), 0.1, 1., 1., true).is_err());
    assert_eq!(motion, before);
    let mut motion = head();
    motion.speed_per_32ms = f64::MAX;
    let before = motion;
    assert!(motion.advance(step(5.), 0.1, 1., 1., true).is_err());
    assert_eq!(motion, before);
    let mut motion = head();
    let before = motion;
    assert!(motion.advance(step(5.), f64::MAX, 1., 1., true).is_err());
    assert_eq!(motion, before);
}

#[test]
fn head_corrections_overlap_at_current_index_and_keep_float32_assignments() {
    let mut ring = HeadCorrections::default();
    assert_eq!(
        (ring.index(), ring.pending(), ring.offset()),
        (0, 0, [0.; 3])
    );
    assert_eq!(
        (ring.weights()[0], ring.weights()[HEAD_SAMPLES - 1]),
        (1., 0.)
    );
    ring.inject(10., -5., 0.25).unwrap();
    assert_eq!(ring.offset(), [-10., 5., -0.25]);
    ring.advance(7);
    let previous = *ring.samples();
    let index = ring.index();
    ring.inject(-3., 2., -0.125).unwrap();
    assert_eq!((ring.index(), ring.pending()), (7, HEAD_SAMPLES as i32));
    assert_eq!(
        ring.samples()[0][index],
        (f64::from(previous[0][index]) + 3.) as f32
    );
    assert_eq!(
        ring.offset(),
        [
            f64::from(ring.samples()[0][index]),
            f64::from(ring.samples()[1][index]),
            f64::from(ring.samples()[2][index])
        ]
    );
    let mut rounding = HeadCorrections::default();
    rounding.inject(16_777_217.25, 0., 0.).unwrap();
    assert_eq!(rounding.offset()[0], -16_777_218.);
    rounding.inject(-16_777_217., 0., 0.).unwrap();
    assert_eq!(rounding.offset()[0], -1.);
}

#[test]
fn head_ring_clears_consumed_slots_wraps_and_defers_cleanup() {
    let mut ring = HeadCorrections::default();
    ring.advance(0);
    assert_eq!(ring.pending(), 0);
    ring.advance(1);
    assert_eq!(ring.pending(), -1);
    ring.inject(4., 2., 1.).unwrap();
    ring.advance(1);
    assert_eq!(ring.index(), 1);
    assert!(ring.samples().iter().all(|channel| channel[0] == 0.));
    ring.inject(1., 1., 1.).unwrap();
    ring.advance((HEAD_SAMPLES - 1) as u32);
    assert_eq!((ring.index(), ring.pending()), (0, 1));
    let last = [
        ring.samples()[0][0],
        ring.samples()[1][0],
        ring.samples()[2][0],
    ]
    .map(f64::from);
    assert_eq!(last, [0.; 3]);
    ring.advance(u32::MAX);
    assert_eq!((ring.index(), ring.pending(), ring.offset()), (1, 0, last));
    assert!(ring.samples().iter().flatten().all(|value| *value == 0.));
    ring.advance(0);
    assert_eq!(ring.pending(), 0);
    ring.advance(1);
    assert_eq!(
        (ring.index(), ring.pending(), ring.offset()),
        (1, -1, [0.; 3])
    );
}

#[test]
fn head_injection_failure_preserves_all_channels_offset_and_pending() {
    let mut ring = HeadCorrections::default();
    ring.inject(1., 2., 3.).unwrap();
    ring.advance(7);
    for bad in [f64::NAN, f64::INFINITY, f64::MAX] {
        let before = ring.clone();
        assert!(ring.inject(9., bad, 1.).is_err());
        assert_eq!(ring, before);
    }
}

#[test]
fn angle_weights_shortest_arc_and_half_turn_tie() {
    let mut ring = AngleCorrections::default();
    assert_eq!(ring.weights().len(), ANGLE_SAMPLES);
    assert_eq!(
        (ring.weights()[0], ring.weights()[ANGLE_SAMPLES - 1]),
        (1., 0.)
    );
    ring.inject(0.1 - (TAU - 0.1)).unwrap();
    close(f64::from(ring.samples()[0]), f64::from(-0.2_f32));
    let mut reverse = AngleCorrections::default();
    reverse.inject((TAU - 0.1) - 0.1).unwrap();
    assert_eq!(reverse.samples()[0], 0.2_f32);
    let mut tie = AngleCorrections::default();
    tie.inject(-PI).unwrap();
    assert_eq!(tie.samples()[0], -PI as f32);
}

#[test]
fn angle_injection_preserves_offset_until_a_positive_advance() {
    let mut ring = AngleCorrections::default();
    ring.inject(1.).unwrap();
    assert_eq!(ring.offset(), 0.);
    ring.advance(0);
    assert_eq!(ring.offset(), 0.);
    ring.advance(1);
    assert_eq!(ring.offset(), -1.);
    ring.inject(0.25).unwrap();
    assert_eq!(ring.offset(), -1.);
    let next = f64::from(ring.samples()[ring.index()]);
    ring.advance(1);
    assert_eq!(ring.offset(), next);
}

#[test]
fn head_failure_after_turn_or_movement_does_not_commit_any_field() {
    let mut motion = head();
    motion.position.x = f64::MAX;
    motion.segment_length = f64::MAX;
    motion.speed_per_32ms = f64::MAX;
    motion.turn = Turn::Increasing;
    motion.wanted_heading = 0.1;
    let before = motion;
    assert!(motion.advance(step(1.), 0.2, 1., 1., true).is_err());
    assert_eq!(motion, before);
    for (size, speed) in [(-1., 1.), (1., -1.), (f64::INFINITY, 1.)] {
        let mut motion = head();
        let before = motion;
        assert!(motion.advance(step(1.), 0.1, size, speed, true).is_err());
        assert_eq!(motion, before);
    }
}

#[test]
fn angle_overlap_wrap_drain_and_later_cleanup() {
    let mut ring = AngleCorrections::default();
    ring.inject(1.).unwrap();
    ring.advance(20);
    let previous = *ring.samples();
    ring.inject(0.25).unwrap();
    assert_eq!((ring.index(), ring.pending()), (20, ANGLE_SAMPLES as i32));
    for sample in 0..ANGLE_SAMPLES {
        let physical = (20 + sample) % ANGLE_SAMPLES;
        let expected =
            (f64::from(previous[physical]) - 0.25 * f64::from(ring.weights()[sample])) as f32;
        assert_eq!(ring.samples()[physical], expected);
    }
    let next = ring.samples()[20];
    ring.advance(1);
    assert_eq!(ring.offset(), f64::from(next));
    assert_eq!(ring.samples()[20], 0.);
    ring.advance(u32::MAX);
    assert_eq!((ring.index(), ring.pending()), (20, 0));
    assert!(ring.samples().iter().all(|value| *value == 0.));
    ring.advance(0);
    assert_eq!(ring.pending(), 0);
    ring.advance(1);
    assert_eq!((ring.index(), ring.pending(), ring.offset()), (20, -1, 0.));
}

#[test]
fn angle_f64_math_precedes_each_f32_assignment_and_invalid_is_atomic() {
    let mut ring = AngleCorrections::default();
    ring.inject(1.).unwrap();
    ring.inject(-1. - 2_f64.powi(-26)).unwrap();
    assert_eq!(ring.samples()[0], 2_f32.powi(-26));
    ring.advance(3);
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let before = ring.clone();
        assert!(ring.inject(bad).is_err());
        assert_eq!(ring, before);
    }
}
