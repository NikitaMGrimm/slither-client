//! Original synthetic, hand-derived eye cases. No external inputs or recipes.

use std::f64::consts::{FRAC_PI_2, PI, TAU};

use slither_client::{
    presentation::{EyeLayoutInput, FrameStep, StandardEyeGeometry, StandardEyeState, Turn},
    state::Point,
};

fn step(delta: f64, whole_steps: u32) -> FrameStep {
    FrameStep {
        delta,
        unlagged_delta: delta,
        whole_steps,
        double_steps: 0,
        lag_multiplier: 1.,
        accumulated: 0.,
        doubled_accumulated: 0.,
    }
}

fn view() -> EyeLayoutInput {
    EyeLayoutInput {
        corrected_head: Point::default(),
        camera: Point::default(),
        viewport_half: Point::default(),
        scale: 1.,
        zoom: 1.,
        death_progress: 0.,
    }
}

fn coefficient(index: u32) -> f64 {
    f64::from(StandardEyeState::easing_coefficient(index).unwrap())
}

#[test]
fn appearance_and_gaze_are_independent_and_diagnostics_are_read_only() {
    let mut eyes = StandardEyeState::new(0.5, -1.).unwrap();
    let before = eyes;
    assert_eq!(eyes.heading(), 0.5);
    assert_eq!(eyes.target_heading(), 0.5);
    assert_eq!(eyes.turn(), Turn::None);
    assert_eq!(eyes.gaze_heading(), -1.);
    assert_eq!(eyes.pupil(), Point::default());
    assert_eq!(eyes, before);
    eyes.set_gaze(2.).unwrap();
    assert_eq!(eyes.heading(), before.heading());
    assert_eq!(eyes.target_heading(), before.target_heading());
    assert_eq!(eyes.pupil(), before.pupil());
    assert_eq!(eyes.gaze_heading(), 2.);
}

#[test]
fn coefficients_round_only_the_stored_double_recurrence() {
    let mut accumulator = 0_f64;
    for index in 0..250 {
        assert_eq!(coefficient(index), f64::from(accumulator as f32));
        accumulator += (1. - accumulator) * 0.12;
    }
    // K[2] = .12 + .88 * .12, rounded once, not an f32 recurrence.
    assert_eq!(coefficient(2), f64::from(0.2256_f32));
    assert!(StandardEyeState::easing_coefficient(250).is_err());
    assert!(StandardEyeState::easing_coefficient(u32::MAX).is_err());
}

#[test]
fn fractional_updates_choose_direction_without_face_displacement() {
    let mut eyes = StandardEyeState::new(0., 0.).unwrap();
    eyes.commit_draw_target(1.).unwrap();
    eyes.advance(step(0.5, 0), true, 2.).unwrap();
    assert_eq!(eyes.heading(), 0.);
    assert_eq!(eyes.turn(), Turn::Increasing);
    assert_eq!(eyes.pupil(), Point { x: 1. / 12., y: 0. });
    eyes.advance(step(0.5, 1), true, 2.).unwrap();
    assert_eq!(eyes.heading(), coefficient(1));
    assert_eq!(eyes.pupil().x, 1. / 6.);
}

#[test]
fn batching_preserves_float32_coefficient_rounding() {
    let mut batched = StandardEyeState::new(0., 0.).unwrap();
    batched.commit_draw_target(1.).unwrap();
    let mut split = batched;
    batched.advance(step(2., 2), true, 0.).unwrap();
    split.advance(step(1., 1), true, 0.).unwrap();
    split.advance(step(1., 1), true, 0.).unwrap();
    let k = coefficient(1);
    assert_eq!(batched.heading(), coefficient(2));
    assert_eq!(split.heading(), k + (1. - k) * k);
    assert_ne!(batched.heading(), split.heading());
}

#[test]
fn both_antipodal_signs_choose_positive_pi() {
    for target in [PI, -PI] {
        let mut eyes = StandardEyeState::new(0., 0.).unwrap();
        eyes.commit_draw_target(target).unwrap();
        eyes.advance(step(1., 1), true, 0.).unwrap();
        assert_eq!(eyes.turn(), Turn::Increasing);
        assert_eq!(eyes.heading(), PI * coefficient(1));
        assert_eq!(eyes.target_heading(), target);
    }
}

#[test]
fn shortest_arcs_wrap_in_both_directions() {
    let mut up = StandardEyeState::new(TAU - 0.25, 0.).unwrap();
    up.commit_draw_target(0.25).unwrap();
    up.advance(step(1., 1), true, 0.).unwrap();
    assert_eq!(up.heading(), TAU - 0.25 + 0.5 * coefficient(1));
    assert_eq!(up.turn(), Turn::Increasing);
    let mut down = StandardEyeState::new(0.25, 0.).unwrap();
    down.commit_draw_target(TAU - 0.25).unwrap();
    down.advance(step(1., 1), true, 0.).unwrap();
    assert_eq!(down.heading(), 0.25 - 0.5 * coefficient(1));
    assert_eq!(down.turn(), Turn::Decreasing);
    // A longer supported step crosses the zero boundary without crossing target.
    up.advance(step(5., 20), true, 0.).unwrap();
    down.advance(step(5., 20), true, 0.).unwrap();
    assert!((0. ..0.25).contains(&up.heading()));
    assert!((TAU - 0.25..TAU).contains(&down.heading()));
}

#[test]
fn modular_equality_and_exact_landing_retain_direction() {
    let mut equal = StandardEyeState::new(TAU, 0.).unwrap();
    equal.commit_draw_target(0.).unwrap();
    equal.advance(step(1., 1), true, 0.).unwrap();
    assert_eq!(equal.heading(), TAU);
    assert_eq!(equal.turn(), Turn::None);

    let mut active = StandardEyeState::new(0., 0.).unwrap();
    active.commit_draw_target(1.).unwrap();
    assert_eq!(coefficient(249), 1.);
    active.advance(step(0., 249), true, 0.).unwrap();
    assert_eq!(active.heading(), 1.);
    assert_eq!(active.turn(), Turn::Increasing);
    active.advance(step(0., 0), true, 0.).unwrap();
    assert_eq!(active.turn(), Turn::Increasing);
    active.commit_draw_target(1. + TAU).unwrap();
    active.advance(step(0., 0), true, 0.).unwrap();
    assert_eq!(active.heading(), 1.);
    assert_eq!(active.turn(), Turn::Increasing);
}

#[test]
fn stale_dead_direction_crossing_snaps_to_raw_unwrapped_target() {
    for (initial, first_target, next_target, direction) in [
        (1., 0., TAU + 2., Turn::Decreasing),
        (0., 1., -1., Turn::Increasing),
    ] {
        let mut eyes = StandardEyeState::new(initial, 0.).unwrap();
        eyes.commit_draw_target(first_target).unwrap();
        eyes.advance(step(0., 0), true, 0.).unwrap();
        assert_eq!(eyes.turn(), direction);
        eyes.commit_draw_target(next_target).unwrap();
        eyes.advance(step(1., 1), false, 0.).unwrap();
        assert_eq!(eyes.heading(), next_target);
        assert_eq!(eyes.turn(), Turn::None);
    }
}

#[test]
fn pupils_approach_each_world_axis_and_clamp_without_rotating_with_face() {
    let mut eyes = StandardEyeState::new(2., 0.).unwrap();
    eyes.advance(step(5., 5), true, 0.25).unwrap();
    assert_eq!(eyes.pupil(), Point { x: 0.25, y: 0. });
    eyes.set_gaze(FRAC_PI_2).unwrap();
    eyes.advance(step(0.5, 0), true, 0.25).unwrap();
    assert_eq!(eyes.pupil().x, 0.25 - 1. / 12.);
    assert_eq!(eyes.pupil().y, 1. / 12.);
    eyes.advance(step(5., 5), true, 0.25).unwrap();
    assert_eq!(eyes.pupil().x, FRAC_PI_2.cos() * 0.25);
    assert_eq!(eyes.pupil().y, 0.25);
    assert_eq!(eyes.heading(), 2.);
    eyes.advance(step(2., 2), true, 0.).unwrap();
    assert_eq!(eyes.pupil(), Point::default());
}

#[test]
fn death_freezes_face_but_not_pupils_or_gaze() {
    let mut eyes = StandardEyeState::new(0., 0.).unwrap();
    eyes.commit_draw_target(1.).unwrap();
    eyes.advance(step(0.5, 0), true, 2.).unwrap();
    let before = eyes;
    eyes.mark_dead();
    assert_eq!(eyes.heading(), before.heading());
    assert_eq!(eyes.target_heading(), before.target_heading());
    assert_eq!(eyes.pupil(), before.pupil());
    eyes.set_gaze(-FRAC_PI_2).unwrap();
    eyes.advance(step(1., 1), false, 2.).unwrap();
    assert_eq!(eyes.heading(), 0.);
    assert_eq!(eyes.turn(), Turn::None);
    assert_eq!(eyes.pupil().y, -1. / 6.);
}

#[test]
fn visible_entry_preserves_pupils_and_direction_and_draw_target_waits() {
    let mut eyes = StandardEyeState::new(0., 0.).unwrap();
    eyes.commit_draw_target(1.).unwrap();
    eyes.advance(step(1., 1), true, 2.).unwrap();
    let before = eyes;
    eyes.visible_entry(0.5).unwrap();
    assert_eq!(eyes.heading(), 0.5);
    assert_eq!(eyes.target_heading(), 0.5);
    assert_eq!(eyes.turn(), before.turn());
    assert_eq!(eyes.pupil(), before.pupil());
    assert_eq!(eyes.commit_draw_target(TAU + 0.25).unwrap(), 0.5);
    assert_eq!(eyes.heading(), 0.5);
    assert_eq!(eyes.target_heading(), TAU + 0.25);
    assert_eq!(eyes.commit_draw_target(1.).unwrap(), 0.5);
    assert_eq!(eyes.pupil(), before.pupil());
    eyes.advance(step(1., 1), true, 2.).unwrap();
    assert_eq!(eyes.heading(), 0.5 + 0.5 * coefficient(1));
}

#[test]
fn invalid_state_inputs_and_arithmetic_overflow_are_atomic() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(StandardEyeState::new(bad, 0.).is_err());
        assert!(StandardEyeState::new(0., bad).is_err());
        let mut eyes = StandardEyeState::new(0., 0.).unwrap();
        let before = eyes;
        assert!(eyes.set_gaze(bad).is_err());
        assert!(eyes.visible_entry(bad).is_err());
        assert!(eyes.commit_draw_target(bad).is_err());
        assert!(eyes.advance(step(bad, 0), true, 1.).is_err());
        assert!(eyes.advance(step(1., 1), true, bad).is_err());
        assert_eq!(eyes, before);
    }
    let mut eyes = StandardEyeState::new(-f64::MAX, 0.).unwrap();
    eyes.commit_draw_target(f64::MAX).unwrap();
    let before = eyes;
    assert!(eyes.advance(step(1., 1), true, 1.).is_err());
    assert_eq!(eyes, before);
    for invalid in [step(-0.1, 0), step(5.1, 5), step(1., 250)] {
        assert!(eyes.advance(invalid, false, 1.).is_err());
        assert_eq!(eyes, before);
    }
    assert!(eyes.advance(step(1., 1), false, -1.).is_err());
    assert_eq!(eyes, before);
}

#[test]
fn layout_half_units_follow_scale_and_pairs_are_ordered() {
    let geometry = StandardEyeGeometry::default();
    assert_eq!(geometry.pupil_travel, 2.3);
    for scale in [1., 2.] {
        let layout = geometry
            .layout(
                0.,
                Point { x: 0.25, y: 0. },
                EyeLayoutInput { scale, ..view() },
            )
            .unwrap();
        assert_eq!(
            layout.pairs[0].eye,
            Point {
                x: 6. * scale,
                y: -(6. * scale + 0.5)
            }
        );
        assert_eq!(
            layout.pairs[1].eye,
            Point {
                x: 6. * scale,
                y: 6. * scale + 0.5
            }
        );
        assert_eq!(
            layout.pairs[0].pupil,
            Point {
                x: 6. * scale + 0.5 + 0.25 * scale,
                y: -6. * scale
            }
        );
        assert_eq!(
            layout.pairs[1].pupil,
            Point {
                x: 6. * scale + 0.5 + 0.25 * scale,
                y: 6. * scale
            }
        );
        assert_eq!(layout.eye_radius, 6. * scale);
        assert_eq!(layout.pupil_radius, 3.5 * scale);
    }
}

#[test]
fn layout_preserves_absolute_addition_before_camera_subtraction() {
    let large = 9_007_199_254_740_992.;
    let layout = StandardEyeGeometry::default()
        .layout(
            0.,
            Point::default(),
            EyeLayoutInput {
                corrected_head: Point { x: large, y: 0.125 },
                camera: Point { x: large, y: 0.25 },
                viewport_half: Point { x: 10., y: 20. },
                zoom: 0.5,
                ..view()
            },
        )
        .unwrap();
    // At 2^53 the pupil's 6.5-unit offset rounds to 6 before subtracting camera.
    assert_eq!(layout.pairs[0].eye.x, 13.);
    assert_eq!(layout.pairs[0].pupil.x, 13.);
    assert_eq!(layout.pairs[0].eye.y, 16.6875);
    assert_eq!(layout.pairs[0].pupil.y, 16.9375);
}

#[test]
fn supplied_style_uses_sqrt_death_fade_and_zoom_only_outline() {
    let geometry = StandardEyeGeometry {
        eye_radius: 4.,
        pupil_radius: 2.,
        forward: 3.,
        separation: 5.,
        eye_color: [12, 34, 56],
        pupil_color: [78, 90, 123],
        eye_alpha: 0.5,
        pupil_alpha: 0.25,
        outline_width: 3.,
        ..StandardEyeGeometry::default()
    };
    let layout = geometry
        .layout(
            0.,
            Point::default(),
            EyeLayoutInput {
                scale: 2.,
                zoom: 0.5,
                death_progress: 0.75,
                ..view()
            },
        )
        .unwrap();
    assert_eq!(layout.eye_radius, 4.);
    assert_eq!(layout.pupil_radius, 2.);
    assert_eq!(layout.outline_width, 1.5);
    assert_eq!(layout.eye_alpha, 0.25);
    assert_eq!(layout.pupil_alpha, 0.125);
    assert_eq!(layout.eye_color, [12, 34, 56]);
    assert_eq!(layout.pupil_color, [78, 90, 123]);
    let alive = StandardEyeGeometry::default()
        .layout(0., Point::default(), view())
        .unwrap();
    assert_eq!((alive.eye_alpha, alive.pupil_alpha), (0.75, 1.));
}

#[test]
fn layout_rejects_nonfinite_invalid_life_and_late_coordinate_overflow() {
    let geometry = StandardEyeGeometry::default();
    for invalid in [
        EyeLayoutInput {
            death_progress: 1.,
            ..view()
        },
        EyeLayoutInput {
            death_progress: -0.1,
            ..view()
        },
        EyeLayoutInput { zoom: 0., ..view() },
        EyeLayoutInput {
            scale: -1.,
            ..view()
        },
        EyeLayoutInput {
            camera: Point { x: f64::NAN, y: 0. },
            ..view()
        },
        EyeLayoutInput {
            corrected_head: Point { x: f64::MAX, y: 0. },
            camera: Point {
                x: -f64::MAX,
                y: 0.,
            },
            ..view()
        },
        EyeLayoutInput {
            scale: f64::MAX,
            ..view()
        },
    ] {
        assert!(geometry.layout(0., Point::default(), invalid).is_err());
    }
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(geometry.layout(bad, Point::default(), view()).is_err());
        assert!(
            geometry
                .layout(0., Point { x: bad, y: 0. }, view())
                .is_err()
        );
        assert!(
            StandardEyeGeometry {
                forward: bad,
                ..geometry
            }
            .layout(0., Point::default(), view())
            .is_err()
        );
    }
    for invalid in [
        StandardEyeGeometry {
            eye_radius: -1.,
            ..geometry
        },
        StandardEyeGeometry {
            eye_alpha: 1.1,
            ..geometry
        },
        StandardEyeGeometry {
            pupil_alpha: -0.1,
            ..geometry
        },
        StandardEyeGeometry {
            outline_width: -1.,
            ..geometry
        },
    ] {
        assert!(invalid.layout(0., Point::default(), view()).is_err());
    }
}
