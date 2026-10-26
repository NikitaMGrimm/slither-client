//! Original synthetic snake transitions; no reference fixtures, sockets, or clocks.

use slither_client::{
    presentation::{AnchorView, FrameClock, FrameStep, HEAD_SAMPLES, SnakePresentation, Turn},
    state::{Appearance, Direction, MAX_BODY_POINTS, Point, Setup},
};
use std::f64::consts::TAU;

fn setup() -> Setup {
    Setup {
        protocol: 19,
        grid_center: 1000.,
        radius: 980.,
        sector_size: 100,
        sector_count: 20,
        max_segments: 430,
        body_spacing: 10.,
        body_contraction: 0.43,
        spangdv: 4.8,
        nsp1: 5.39,
        nsp2: 0.4,
        nsp3: 14.,
        mamu: 0.033,
        mamu2: 0.028,
        server_number: None,
        game_mode: None,
        team: None,
    }
}

fn appearance() -> Appearance {
    Appearance {
        id: 0,
        skin: 17,
        name: "synthetic".into(),
        custom_skin: vec![],
        cosmetic: 0,
        absolute_head: Point { x: 1035., y: 1004. },
        absolute_body: vec![
            Point { x: 1030., y: 1000. },
            Point { x: 1020., y: 1000. },
            Point { x: 1000., y: 1000. },
        ],
        anchor_direction: Some(0),
        heading: 0.,
        wanted_heading: 0.,
        speed_per_32ms: 0.539,
        fam: 0.25,
        wire_direction: Direction::Increasing,
    }
}

fn snake() -> SnakePresentation {
    SnakePresentation::from_appearance(&appearance(), &setup(), 1.).unwrap()
}

fn step(delta: f64, whole_steps: u32) -> FrameStep {
    FrameStep {
        delta,
        unlagged_delta: delta,
        whole_steps,
        double_steps: whole_steps * 2,
        lag_multiplier: 1.,
        accumulated: delta,
        doubled_accumulated: delta * 2.,
    }
}

fn view(zoom: f64, extrapolated_distance: f64) -> AnchorView {
    AnchorView {
        zoom,
        extrapolated_distance,
    }
}

#[test]
fn synthetic_initial_channels_use_absolute_head_and_mass_is_scheduled_after_length() {
    let snake = snake();
    let metrics = snake.metrics();
    assert_eq!((metrics.id, metrics.skin), (0, 17));
    assert_eq!(metrics.raw_head, appearance().absolute_head);
    assert_eq!(metrics.corrected_head, metrics.raw_head);
    assert_ne!(metrics.raw_head, snake.body().points()[0].position());
    assert_eq!(
        (
            metrics.heading,
            metrics.wanted_heading,
            metrics.corrected_heading
        ),
        (0., 0., 0.)
    );
    assert_eq!(metrics.turn, Turn::None); // Ignore wire_direction metadata.
    assert_eq!(
        (metrics.head_fraction, metrics.corrected_head_fraction),
        (0., 0.)
    );
    assert_eq!(metrics.speed_per_32ms.to_bits(), 0.539_f64.to_bits());
    assert_eq!(metrics.speed_turn_factor, 0.539 / 4.8);
    assert_eq!((metrics.fam, metrics.logical_segments), (0.25, 3));
    assert_eq!(snake.length().target(), 3.25);
    assert_eq!(snake.length().offset(), -0.25);
    assert_eq!(metrics.displayed_length, 2.4);
    assert_eq!(snake.length().pending(), HEAD_SAMPLES as i32);
    let scale = 1. + 1. / 106.;
    assert_eq!(metrics.scale, scale);
    assert_eq!(
        metrics.size_turn_factor,
        0.13 + 0.87 * ((7. - scale) / 6.).powf(2.)
    );
    assert_eq!(metrics.cruise_speed, 5.39 + 0.4 * scale);
    assert_eq!(metrics.boost_threshold_speed, metrics.cruise_speed + 0.1);
    assert_eq!(metrics.point_spacing, 6. * scale);
    assert_eq!(metrics.target_point_spacing, metrics.point_spacing);
    assert_eq!(
        (
            metrics.visual_speed,
            metrics.boost_phase,
            metrics.spawn_progress,
            metrics.death_progress
        ),
        (0., 0., 0., 0.)
    );
    assert!(metrics.alive && !metrics.expired && !metrics.visible);
    assert_eq!(snake.head_corrections().offset(), [0.; 3]);
    assert_eq!(snake.angle_corrections().offset(), 0.);
    assert!(
        snake
            .body()
            .points()
            .iter()
            .all(|point| !point.dying() && point.edge_length() == 1.)
    );
    assert_eq!(
        snake.body().points()[1].previous_delta(),
        Point { x: 20., y: 0. }
    );
    assert_eq!(snake.body().points()[2].previous_delta(), Point::default());
    // A wire mass of zero still starts the correction lifetime.
    let mut zero_mass = appearance();
    zero_mass.fam = 0.;
    let zero = SnakePresentation::from_appearance(&zero_mass, &setup(), 0.5).unwrap();
    assert_eq!(zero.length().pending(), HEAD_SAMPLES as i32);
    assert_eq!(zero.length().displayed(), 2.4);
    assert_eq!(zero.metrics().point_spacing, 9.);
    let mut independent_headings = appearance();
    independent_headings.heading = 0.75;
    independent_headings.wanted_heading = 1.25;
    let mut distinct =
        SnakePresentation::from_appearance(&independent_headings, &setup(), 1.).unwrap();
    assert_eq!(distinct.metrics().heading, 0.75);
    assert_eq!(distinct.metrics().wanted_heading, 1.25);
    assert_eq!(distinct.metrics().corrected_heading, 0.75);
    assert_eq!(distinct.metrics().turn, Turn::None);
    distinct.advance(step(0., 0)).unwrap();
    assert_eq!(distinct.metrics().heading, 1.25);
    assert_eq!(distinct.angle_corrections().pending(), 0);
}

#[test]
fn synthetic_empty_and_long_appearances_keep_count_based_size_bounds() {
    let mut input = appearance();
    input.absolute_body.clear();
    input.anchor_direction = None;
    let mut empty = SnakePresentation::from_appearance(&input, &setup(), 1.).unwrap();
    assert_eq!(empty.metrics().logical_segments, 0);
    assert_eq!(empty.length().displayed(), -0.6);
    let before = empty.clone();
    assert!(
        empty
            .apply_anchor(Some(Point::default()), None, None, view(1., 0.))
            .is_err()
    );
    assert_eq!(empty, before);
    // Tail packets with no living point still schedule a new mass target.
    empty.remove_tail(Some(0.75), 1.).unwrap();
    assert_eq!(empty.length().target(), 0.75);
    assert_eq!(empty.length().segments(), 0);
    input.absolute_body = (0..MAX_BODY_POINTS)
        .map(|index| Point {
            x: index as f64,
            y: 0.,
        })
        .collect();
    let maximum = SnakePresentation::from_appearance(&input, &setup(), 1.).unwrap();
    assert_eq!(maximum.metrics().scale, 6.);
    assert_eq!(maximum.metrics().point_spacing, 36.);
}

#[test]
fn synthetic_motion_omissions_overlap_and_equal_heading_restart_only_angle_lifetime() {
    let mut snake = snake();
    let initial_head = *snake.head();
    snake
        .set_motion(
            Some(TAU - 0.1),
            Some(0.5),
            Some(Direction::Decreasing),
            Some(255. / 18.),
        )
        .unwrap();
    assert_eq!(snake.metrics().turn, Turn::Decreasing);
    assert_eq!(snake.metrics().heading, TAU - 0.1);
    assert_eq!(snake.metrics().wanted_heading, 0.5);
    assert_eq!(
        snake.metrics().speed_per_32ms.to_bits(),
        (255_f64 / 18.).to_bits()
    );
    assert_eq!(snake.metrics().speed_turn_factor, 1.);
    assert_eq!(snake.metrics().raw_head, initial_head.position);
    assert_eq!(snake.angle_corrections().offset(), 0.);
    assert_eq!(snake.angle_corrections().pending(), 26);
    assert_eq!(
        snake.angle_corrections().samples()[0],
        (-(TAU - 0.1 - TAU)) as f32
    );
    snake.advance(step(0., 3)).unwrap();
    let prior = snake.clone();
    snake
        .set_motion(Some(prior.metrics().heading + 0.25), None, None, None)
        .unwrap();
    assert_eq!(
        snake.metrics().wanted_heading,
        prior.metrics().wanted_heading
    );
    assert_eq!(
        snake.metrics().speed_per_32ms,
        prior.metrics().speed_per_32ms
    );
    assert_eq!(snake.metrics().turn, prior.metrics().turn);
    assert_eq!(
        snake.angle_corrections().offset(),
        prior.angle_corrections().offset()
    );
    assert_eq!(
        snake.angle_corrections().index(),
        prior.angle_corrections().index()
    );
    let samples = *snake.angle_corrections().samples();
    snake.advance(step(0., 1)).unwrap();
    let samples_after = *snake.angle_corrections().samples();
    assert_ne!(samples, samples_after);
    let same_heading = snake.metrics().heading;
    snake
        .set_motion(Some(same_heading), None, None, None)
        .unwrap();
    assert_eq!(snake.angle_corrections().samples(), &samples_after);
    assert_eq!(snake.angle_corrections().pending(), 26);
    let before = snake.clone();
    snake.set_motion(None, None, None, None).unwrap();
    assert_eq!(snake, before);
    snake
        .set_motion(None, None, Some(Direction::None), None)
        .unwrap();
    assert_eq!(snake.metrics().turn, Turn::None);
}

#[test]
fn synthetic_fractional_clock_moves_head_without_consuming_integer_rings() {
    let mut snake = snake();
    let mut clock = FrameClock::new(100.).unwrap();
    let fractional = clock.advance(102., false, false).unwrap();
    assert_eq!((fractional.delta, fractional.whole_steps), (0.25, 0));
    let prior = snake.metrics();
    assert!(snake.advance(fractional).unwrap());
    let metrics = snake.metrics();
    let travel = 0.539 * 0.25 / 4.;
    assert_eq!(
        metrics.raw_head,
        Point {
            x: prior.raw_head.x + travel,
            y: prior.raw_head.y
        }
    );
    assert_eq!(metrics.head_fraction, travel / 10.);
    assert_eq!(metrics.spawn_progress, 0.25 * 0.015);
    assert_eq!(metrics.visual_speed, 0.539 * 0.1 + 0.0001);
    assert_eq!(snake.length().pending(), HEAD_SAMPLES as i32);
    assert_eq!(snake.head_corrections().pending(), 0);
    let full = clock.advance(108., false, false).unwrap();
    assert_eq!((full.delta, full.whole_steps), (0.75, 1));
    snake.advance(full).unwrap();
    assert_eq!(snake.length().pending(), HEAD_SAMPLES as i32 - 1);
    assert_eq!(snake.head_corrections().pending(), -1);
    assert_eq!(snake.angle_corrections().pending(), -1);
    // Raw high speed is capped at one segment of travel, not one speed unit.
    snake.set_motion(None, None, None, Some(100.)).unwrap();
    let before = snake.metrics();
    snake.advance(step(5., 5)).unwrap();
    assert_eq!(snake.metrics().raw_head.x, before.raw_head.x + 10.);
    assert_eq!(snake.metrics().head_fraction, before.head_fraction + 1.);
}

#[test]
fn synthetic_live_zero_updates_ease_speed_but_do_not_drain_head_or_angle() {
    let mut snake = snake();
    snake
        .set_motion(Some(0.5), Some(0.5), None, Some(100.))
        .unwrap();
    snake
        .apply_anchor(None, Some(0), None, view(1., 3.))
        .unwrap();
    let head = snake.head_corrections().clone();
    let angle = snake.angle_corrections().clone();
    let body = snake.body().clone();
    snake.advance(step(0., 0)).unwrap();
    assert_eq!(snake.metrics().visual_speed, 10.0001);
    assert_eq!(snake.metrics().boost_phase, 0.);
    assert_eq!(snake.head_corrections(), &head);
    assert_eq!(snake.angle_corrections(), &angle);
    assert_eq!(snake.body(), &body);
    assert_eq!(snake.metrics().spawn_progress, 0.);
    snake.advance(step(1., 1)).unwrap();
    let visual = 10.0001 + (100. - 10.0001) * 0.1 + 0.0001;
    assert_eq!(snake.metrics().visual_speed, visual);
    assert_eq!(
        snake.metrics().boost_phase,
        (visual - snake.metrics().boost_threshold_speed) * 0.021
    );
    snake.set_motion(None, None, None, Some(0.)).unwrap();
    snake.advance(step(0., 0)).unwrap();
    assert_eq!(
        snake.metrics().visual_speed,
        visual + (0. - visual) * 0.3 - 0.0001
    );
    for _ in 0..100 {
        snake.advance(step(0., 0)).unwrap();
    }
    assert_eq!(snake.metrics().visual_speed, 0.);
}

#[test]
fn synthetic_anchor_couples_pre_event_corrected_head_body_growth_and_fraction() {
    let mut snake = snake();
    snake.set_visible(true);
    snake.advance(step(2., 2)).unwrap();
    snake
        .apply_anchor(None, Some(0), None, view(1., 2.))
        .unwrap();
    snake.advance(step(1., 1)).unwrap();
    assert_ne!(snake.metrics().raw_head, snake.metrics().corrected_head);
    let prior = snake.clone();
    let mut expected_body = prior.body().clone();
    let position = expected_body
        .apply_anchor(
            None,
            Some(16384),
            true,
            prior.metrics().corrected_head,
            true,
        )
        .unwrap();
    let mut wrong_body = prior.body().clone();
    wrong_body
        .apply_anchor(None, Some(16384), true, prior.metrics().raw_head, true)
        .unwrap();
    assert_ne!(
        expected_body, wrong_body,
        "fixture must discriminate the pre-event corrected head"
    );
    let mut expected_head = *prior.head();
    let mut expected_offsets = prior.head_corrections().clone();
    expected_head
        .reanchor(position, 4., &mut expected_offsets)
        .unwrap();
    snake
        .apply_anchor(None, Some(16384), Some(0.75), view(0.5, 4.))
        .unwrap();
    assert_eq!(snake.body(), &expected_body);
    assert_eq!(snake.head(), &expected_head);
    assert_eq!(snake.head_corrections(), &expected_offsets);
    assert_eq!(snake.metrics().logical_segments, 4);
    assert_eq!(snake.metrics().fam, 0.75);
    assert_eq!(snake.length().target(), 4.75);
    assert_eq!(snake.metrics().scale, 1. + 2. / 106.);
    assert_eq!(snake.metrics().target_point_spacing, 9.);
    assert_eq!(snake.metrics().point_spacing, prior.metrics().point_spacing);
    assert_eq!(snake.metrics().head_fraction, 0.4);
    assert_eq!(snake.angle_corrections(), prior.angle_corrections());
    let mut cached = snake.body().clone();
    let expected = cached
        .apply_anchor(None, None, false, snake.metrics().corrected_head, true)
        .unwrap();
    snake.apply_anchor(None, None, None, view(1., 0.)).unwrap();
    assert_eq!(snake.metrics().raw_head, expected);
    assert_eq!(snake.body().anchor_direction(), Some(16384));
}

#[test]
fn synthetic_invisible_anchor_skips_body_injection_but_keeps_head_and_length_channels() {
    let mut visible = snake();
    let mut invisible = visible.clone();
    visible.set_visible(true);
    for snake in [&mut visible, &mut invisible] {
        snake
            .apply_anchor(
                Some(Point { x: 1040., y: 1007. }),
                Some(42),
                Some(0.),
                view(1., 0.),
            )
            .unwrap();
    }
    assert_eq!(visible.head(), invisible.head());
    assert_eq!(visible.head_corrections(), invisible.head_corrections());
    assert_eq!(visible.length(), invisible.length());
    assert_eq!(visible.body().points()[0].pending(), HEAD_SAMPLES as i32);
    assert_eq!(invisible.body().points()[0].pending(), 0);
    assert_eq!(invisible.metrics().logical_segments, 4);
    assert_eq!(invisible.metrics().fam, 0.);
}

#[test]
fn synthetic_mass_tail_and_zero_step_length_cleanup_preserve_independent_clocks() {
    let mut snake = snake();
    snake.advance(step(0., HEAD_SAMPLES as u32)).unwrap();
    assert_eq!(snake.length().pending(), 0);
    assert_eq!(snake.head_corrections().pending(), -1);
    snake.advance(step(0., 0)).unwrap();
    assert_eq!(snake.length().pending(), -1);
    assert_eq!(snake.length().displayed(), 2.65);
    snake.set_mass(0.25).unwrap();
    assert_eq!(snake.length().pending(), HEAD_SAMPLES as i32);
    let before_head = *snake.head();
    let before_head_corrections = snake.head_corrections().clone();
    let point_spacing = snake.metrics().point_spacing;
    snake.remove_tail(Some(0.5), 0.5).unwrap();
    assert_eq!(snake.metrics().logical_segments, 2);
    assert_eq!(snake.metrics().scale, 1.);
    assert_eq!(snake.metrics().fam, 0.5);
    assert_eq!(snake.length().target(), 2.5);
    assert_eq!(snake.metrics().point_spacing, point_spacing);
    assert_eq!(snake.metrics().target_point_spacing, 9.);
    assert!(snake.body().points()[2].dying());
    assert_eq!(*snake.head(), before_head);
    assert_eq!(snake.head_corrections(), &before_head_corrections);
    snake.remove_tail(None, 1.).unwrap();
    snake.remove_tail(None, 1.).unwrap();
    assert_eq!(snake.metrics().logical_segments, 0);
    let size = snake.metrics().scale;
    let target_spacing = snake.metrics().target_point_spacing;
    snake.remove_tail(Some(0.75), 0.01).unwrap();
    assert_eq!(snake.metrics().fam, 0.75);
    assert_eq!(snake.length().target(), 0.75);
    assert_eq!(snake.metrics().scale, size);
    assert_eq!(snake.metrics().target_point_spacing, target_spacing);
}

#[test]
fn synthetic_point_spacing_changes_per_visible_draw_and_clamps_in_both_directions() {
    let mut snake = snake();
    let spacing = snake.metrics().point_spacing;
    snake.remove_tail(None, 1.).unwrap();
    assert_eq!(snake.metrics().target_point_spacing, 6.);
    snake.advance(step(5., 5)).unwrap();
    assert_eq!(snake.metrics().point_spacing, spacing);
    snake.prepare_draw().unwrap();
    assert_eq!(snake.metrics().point_spacing, spacing);
    snake.set_visible(true);
    snake.prepare_draw().unwrap();
    assert_eq!(snake.metrics().point_spacing, spacing - 0.0035);
    for _ in 0..30 {
        snake.prepare_draw().unwrap();
    }
    assert_eq!(snake.metrics().point_spacing, 6.);
    snake.remove_tail(None, 0.5).unwrap();
    snake.prepare_draw().unwrap();
    assert_eq!(snake.metrics().point_spacing, 6.0035);
    snake.set_visible(false);
    let before = snake.clone();
    snake.prepare_draw().unwrap();
    assert_eq!(snake, before);
    snake.set_visible(true);
    for _ in 0..900 {
        snake.prepare_draw().unwrap();
    }
    assert_eq!(snake.metrics().point_spacing, 9.);
}

#[test]
fn synthetic_dead_heads_turn_and_drain_rings_without_live_travel_length_or_speed() {
    let mut snake = snake();
    snake.set_visible(true);
    snake
        .set_motion(Some(0.), Some(1.), Some(Direction::Increasing), Some(10.))
        .unwrap();
    snake
        .apply_anchor(None, Some(0), None, view(1., 3.))
        .unwrap();
    snake.advance(step(1., 1)).unwrap();
    snake.mark_dead();
    let prior = snake.clone();
    assert!(snake.advance(step(5., 5)).unwrap());
    assert_eq!(snake.metrics().raw_head, prior.metrics().raw_head);
    assert_eq!(snake.metrics().head_fraction, prior.metrics().head_fraction);
    assert!(snake.metrics().heading > prior.metrics().heading);
    assert_eq!(snake.length(), prior.length());
    assert_eq!(snake.metrics().visual_speed, prior.metrics().visual_speed);
    assert_eq!(snake.metrics().boost_phase, prior.metrics().boost_phase);
    assert_eq!(
        snake.metrics().spawn_progress,
        prior.metrics().spawn_progress
    );
    assert_eq!(snake.metrics().death_progress, 0.1);
    assert_eq!(
        snake.head_corrections().pending(),
        prior.head_corrections().pending() - 5
    );
    assert_eq!(
        snake.angle_corrections().pending(),
        prior.angle_corrections().pending() - 5
    );
    assert!(
        snake.body().points().last().unwrap().tail_fade()
            > prior.body().points().last().unwrap().tail_fade()
    );
    let before = snake.clone();
    snake.mark_dead();
    assert_eq!(snake, before);
    let mut iterations = 0;
    while snake.advance(step(5., 5)).unwrap() {
        iterations += 1;
        assert!(iterations < 12);
    }
    assert!(!snake.metrics().alive && snake.metrics().expired);
    assert!(snake.metrics().death_progress >= 1.);
    let expired = snake.clone();
    assert!(!snake.advance(step(5., 5)).unwrap());
    snake.prepare_draw().unwrap();
    assert_eq!(snake, expired);
    // Retained own objects can still receive packets without reviving animation.
    snake
        .set_motion(Some(2.), Some(2.), None, Some(1.))
        .unwrap();
    snake
        .apply_anchor(None, Some(0), Some(0.5), view(1., 0.))
        .unwrap();
    assert!(snake.metrics().expired && !snake.metrics().alive);
    let after_packet = snake.clone();
    assert!(!snake.advance(step(0., 0)).unwrap());
    assert_eq!(snake, after_packet);
}

#[test]
fn synthetic_invalid_motion_mass_tail_and_step_preserve_every_channel() {
    let mut snake = snake();
    snake.set_visible(true);
    snake
        .apply_anchor(None, Some(0), Some(0.5), view(1., 2.))
        .unwrap();
    snake
        .set_motion(Some(0.1), Some(0.2), Some(Direction::Increasing), Some(1.))
        .unwrap();
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let before = snake.clone();
        assert!(
            snake
                .set_motion(
                    Some(invalid),
                    Some(0.3),
                    Some(Direction::Decreasing),
                    Some(2.)
                )
                .is_err()
        );
        assert_eq!(snake, before);
        assert!(
            snake
                .set_motion(
                    Some(0.4),
                    Some(invalid),
                    Some(Direction::Decreasing),
                    Some(2.)
                )
                .is_err()
        );
        assert_eq!(snake, before);
        assert!(
            snake
                .set_motion(
                    Some(0.4),
                    Some(0.3),
                    Some(Direction::Decreasing),
                    Some(invalid)
                )
                .is_err()
        );
        assert_eq!(snake, before);
    }
    for invalid in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
        let before = snake.clone();
        assert!(snake.set_mass(invalid).is_err());
        assert_eq!(snake, before);
        assert!(snake.remove_tail(Some(invalid), 1.).is_err());
        assert_eq!(snake, before);
    }
    let before = snake.clone();
    assert!(
        snake
            .set_motion(Some(1.), Some(1.), Some(Direction::None), Some(-0.1))
            .is_err()
    );
    assert_eq!(snake, before);
    for invalid in [f64::NAN, f64::INFINITY, 0., -1., f64::MIN_POSITIVE / 10.] {
        assert!(snake.remove_tail(None, invalid).is_err());
        assert_eq!(snake, before);
    }
    let mut bad_steps = Vec::new();
    for delta in [f64::NAN, f64::INFINITY, -1., 5.1] {
        let mut invalid = step(1., 1);
        invalid.delta = delta;
        bad_steps.push(invalid);
    }
    let mut invalid = step(1., 1);
    invalid.unlagged_delta = f64::NAN;
    bad_steps.push(invalid);
    let mut invalid = step(1., 1);
    invalid.lag_multiplier = 0.;
    bad_steps.push(invalid);
    let mut invalid = step(1., 1);
    invalid.accumulated = -1.;
    bad_steps.push(invalid);
    let mut invalid = step(1., 1);
    invalid.doubled_accumulated = f64::INFINITY;
    bad_steps.push(invalid);
    for invalid in bad_steps {
        assert!(snake.advance(invalid).is_err());
        assert_eq!(snake, before);
    }
}

#[test]
fn synthetic_anchor_late_head_error_and_body_retention_error_roll_back_all_channels() {
    let mut snake = snake();
    snake.set_visible(true);
    snake
        .set_motion(Some(0.5), Some(0.75), Some(Direction::Increasing), None)
        .unwrap();
    snake
        .apply_anchor(None, Some(0), None, view(1., 0.))
        .unwrap();
    let before = snake.clone();
    // Body/growth/size/length staging succeeds, then the head's f32 ring overflows.
    assert!(
        snake
            .apply_anchor(None, Some(16384), Some(0.75), view(0.5, f64::MAX))
            .is_err()
    );
    assert_eq!(snake, before);
    // Visible zero chord fails in body injection before head reanchoring.
    assert!(
        snake
            .apply_anchor(
                Some(snake.body().points()[0].position()),
                None,
                None,
                view(1., 0.)
            )
            .is_err()
    );
    assert_eq!(snake, before);
    for invalid in [f64::NAN, f64::INFINITY] {
        assert!(
            snake
                .apply_anchor(Some(Point { x: invalid, y: 1. }), None, None, view(1., 0.))
                .is_err()
        );
        assert_eq!(snake, before);
        assert!(
            snake
                .apply_anchor(None, None, None, view(1., invalid))
                .is_err()
        );
        assert_eq!(snake, before);
    }
    let mut input = appearance();
    input.absolute_body = (0..MAX_BODY_POINTS)
        .rev()
        .map(|index| Point {
            x: index as f64,
            y: 0.,
        })
        .collect();
    let mut maximum = SnakePresentation::from_appearance(&input, &setup(), 1.).unwrap();
    let before = maximum.clone();
    assert!(
        maximum
            .apply_anchor(None, Some(0), Some(0.), view(1., 0.))
            .is_err()
    );
    assert_eq!(maximum, before);

    let mut input = appearance();
    input.absolute_body.push(Point { x: -1e40, y: 1000. });
    let mut late_body = SnakePresentation::from_appearance(&input, &setup(), 1.).unwrap();
    late_body.set_visible(true);
    let before = late_body.clone();
    // The new point and its corrections are valid; a later contracted tail
    // displacement cannot fit in its Float32 ring after membership staging.
    assert!(
        late_body
            .apply_anchor(None, Some(0), Some(0.5), view(1., 0.))
            .is_err()
    );
    assert_eq!(late_body, before);
}

#[test]
fn synthetic_late_update_overflow_preserves_speed_length_and_all_pending_rings() {
    let mut snake = snake();
    snake
        .set_motion(
            Some(0.1),
            Some(0.2),
            Some(Direction::Increasing),
            Some(f64::MAX),
        )
        .unwrap();
    snake
        .apply_anchor(None, Some(0), Some(0.5), view(1., 2.))
        .unwrap();
    let before = snake.clone();
    // Live visual speed and length can advance before head travel overflows.
    assert!(snake.advance(step(5., 5)).is_err());
    assert_eq!(snake, before);
    snake.set_motion(None, None, None, Some(0.)).unwrap();
    assert!(snake.advance(step(5., 5)).unwrap());
    assert_eq!(snake.length().pending(), HEAD_SAMPLES as i32 - 5);
}

#[test]
fn synthetic_invalid_construction_rejects_coefficients_and_arithmetic() {
    for zoom in [f64::NAN, f64::INFINITY, 0., -1., f64::MIN_POSITIVE / 10.] {
        assert!(SnakePresentation::from_appearance(&appearance(), &setup(), zoom).is_err());
    }
    let setters: [fn(&mut Setup, f64); 11] = [
        |s, x| s.grid_center = x,
        |s, x| s.radius = x,
        |s, x| s.body_spacing = x,
        |s, x| s.body_contraction = x,
        |s, x| s.spangdv = x,
        |s, x| s.nsp1 = x,
        |s, x| s.nsp2 = x,
        |s, x| s.nsp3 = x,
        |s, x| s.mamu = x,
        |s, x| s.mamu2 = x,
        |s, x| {
            s.nsp1 = x;
            s.nsp2 = x;
        },
    ];
    for setter in setters {
        for invalid in [f64::NAN, f64::INFINITY, -1.] {
            let mut input = setup();
            setter(&mut input, invalid);
            assert!(SnakePresentation::from_appearance(&appearance(), &input, 1.).is_err());
        }
    }
    let mut config = setup();
    config.nsp1 = f64::MAX;
    config.nsp2 = f64::MAX;
    assert!(SnakePresentation::from_appearance(&appearance(), &config, 1.).is_err());
    let setters: [fn(&mut Appearance, f64); 6] = [
        |a, x| a.heading = x,
        |a, x| a.wanted_heading = x,
        |a, x| a.speed_per_32ms = x,
        |a, x| a.fam = x,
        |a, x| a.absolute_head.x = x,
        |a, x| a.absolute_body[0].y = x,
    ];
    for setter in setters {
        for invalid in [f64::NAN, f64::INFINITY] {
            let mut input = appearance();
            setter(&mut input, invalid);
            assert!(SnakePresentation::from_appearance(&input, &setup(), 1.).is_err());
        }
    }
}
