//! Authored synthetic arithmetic/layer cases; no reference runtime or artwork.

use slither_client::{
    presentation::{BackgroundInput, BackgroundState, QualityMode, QualityState},
    state::Point,
};

fn point(x: f64, y: f64) -> Point {
    Point { x, y }
}

fn input() -> BackgroundInput {
    BackgroundInput {
        width: 801,
        height: 603,
        zoom: 2.,
        image_loaded: true,
        pattern_available: true,
        quality: QualityState::new(QualityMode::High, 0.).unwrap().snapshot(),
        tile_width: 64.,
        tile_height: 32.,
    }
}

#[test]
fn phase_retains_history_and_uses_independent_tile_dimensions() {
    let mut background = BackgroundState::new(point(0.25, 0.5)).unwrap();
    background
        .advance_draw(point(100., 200.), point(116., 192.), 64., 32.)
        .unwrap();
    assert_eq!(background.phase(), point(0., 0.75));
    background
        .advance_draw(point(116., 192.), point(132., 200.), 64., 32.)
        .unwrap();
    assert_eq!(background.phase(), point(0.75, 0.5));
    // Changing tile size without moving does not reproject absolute camera.
    background
        .advance_draw(point(132., 200.), point(132., 200.), 8., 16.)
        .unwrap();
    assert_eq!(background.phase(), point(0.75, 0.5));
}

#[test]
fn negative_and_multi_period_displacements_use_remainder_then_adjustment() {
    let mut background = BackgroundState::default();
    background
        .advance_draw(point(0., 0.), point(136., -164.), 32., 16.)
        .unwrap();
    assert_eq!(background.phase(), point(0.75, 0.25));
    background
        .advance_draw(point(136., -164.), point(128., -168.), 32., 16.)
        .unwrap();
    assert_eq!(background.phase(), point(0., 0.5));
}

#[test]
fn displacement_is_divided_without_reciprocal_reassociation() {
    let mut background = BackgroundState::default();
    background
        .advance_draw(point(0., 0.), point(17., -17.), 10., 10.)
        .unwrap();
    assert_eq!(
        background.phase().x.to_bits(),
        0.30000000000000004f64.to_bits()
    );
    assert_eq!(background.phase().y.to_bits(), 0.7f64.to_bits());
    assert_ne!(background.phase().x, 1. - (17. * (1. / 10.) % 1.));
}

#[test]
fn signed_zero_survives_remainder_and_pattern_translation() {
    let mut background = BackgroundState::default();
    background
        .advance_draw(point(0., 0.), point(64., -32.), 64., 32.)
        .unwrap();
    assert_eq!(background.phase().x.to_bits(), (-0.0f64).to_bits());
    assert_eq!(background.phase().y.to_bits(), 0.0f64.to_bits());
    let pattern = background.plan(input()).unwrap().pattern.unwrap();
    assert_eq!(pattern.translation.x.to_bits(), (-0.0f64).to_bits());
    let restored = BackgroundState::new(background.phase()).unwrap();
    assert_eq!(restored.phase().x.to_bits(), (-0.0f64).to_bits());
    // Subtracting a negative zero camera delta can change a retained -0 to +0.
    background
        .advance_draw(point(0., 0.), point(-0., 0.), 64., 32.)
        .unwrap();
    assert_eq!(background.phase().x.to_bits(), 0.0f64.to_bits());
}

#[test]
fn layer_geometry_keeps_screen_image_separate_from_zoomed_pattern() {
    let background = BackgroundState::new(point(0.25, 0.75)).unwrap();
    let plan = background.plan(input()).unwrap();
    assert_eq!(plan.clear.rect, [0., 0., 801., 603.]);
    assert_eq!(plan.clear.color, [0, 0, 0]);
    assert_eq!(plan.clear.alpha, 1.);
    let image = plan.image.unwrap();
    assert_eq!(image.source, [0., 0., 512., 512.]);
    assert_eq!(image.destination, plan.clear.rect);
    assert_eq!(image.alpha, 0.3);
    let pattern = plan.pattern.unwrap();
    assert_eq!(pattern.center, point(400.5, 301.5));
    assert_eq!(pattern.zoom, 2.);
    assert_eq!(pattern.translation, point(16., 24.));
    assert_eq!(pattern.fill, [-1201.5, -904.5, 2002.5, 1507.5]);
    assert_eq!(pattern.alpha, 1.);
}

#[test]
fn quality_only_gates_image_and_keeps_constant_alpha_through_fade() {
    let background = BackgroundState::default();
    let mut input = input();
    input.quality.high_quality = false;
    for blend in [1., 0.25, f64::MIN_POSITIVE] {
        input.quality.quality_blend = blend;
        assert_eq!(background.plan(input).unwrap().image.unwrap().alpha, 0.3);
    }
    input.quality.quality_blend = -0.;
    let low = background.plan(input).unwrap();
    assert!(low.image.is_none());
    assert!(low.pattern.is_some());
    input.quality.high_quality = true;
    assert!(background.plan(input).unwrap().image.is_some());
    input.image_loaded = false;
    assert!(background.plan(input).unwrap().image.is_none());
}

#[test]
fn unavailable_sources_do_not_prevent_phase_advancement_or_black_clear() {
    let mut background = BackgroundState::default();
    let mut input = input();
    input.image_loaded = false;
    input.pattern_available = false;
    background
        .advance_draw(point(0., 0.), point(8., -8.), 64., 32.)
        .unwrap();
    let plan = background.plan(input).unwrap();
    assert_eq!(plan.clear.rect, [0., 0., 801., 603.]);
    assert!(plan.image.is_none());
    assert!(plan.pattern.is_none());
    input.image_loaded = true;
    assert!(background.plan(input).unwrap().image.is_some());
    input.pattern_available = true;
    let pattern = background.plan(input).unwrap().pattern.unwrap();
    assert_eq!(pattern.translation, point(56., 8.));
}

#[test]
fn resize_and_zoom_reproject_without_moving_retained_phase() {
    let background = BackgroundState::new(point(0.25, 0.5)).unwrap();
    let original = background.plan(input()).unwrap();
    let mut resized = input();
    resized.width = 1280;
    resized.height = 720;
    resized.zoom = 0.5;
    let plan = background.plan(resized).unwrap();
    assert_eq!(plan.image.unwrap().destination, [0., 0., 1280., 720.]);
    let pattern = plan.pattern.unwrap();
    assert_eq!(pattern.center, point(640., 360.));
    assert_eq!(pattern.translation, original.pattern.unwrap().translation);
    assert_eq!(pattern.fill, [-7680., -4320., 12800., 7200.]);
    assert_eq!(background.phase(), point(0.25, 0.5));
}

#[test]
fn pattern_fill_multiplies_before_dividing() {
    let mut input = input();
    input.width = 1;
    input.height = 7;
    input.zoom = 10.;
    let fill = BackgroundState::default()
        .plan(input)
        .unwrap()
        .pattern
        .unwrap()
        .fill;
    assert_eq!(fill, [-0.3, -2.1, 0.5, 3.5]);
    assert_ne!(fill[0], -(1. / input.zoom) * 3.);
}

#[test]
fn invalid_inputs_and_late_axis_overflow_preserve_phase() {
    assert!(BackgroundState::new(point(f64::NAN, 0.)).is_err());
    assert!(BackgroundState::new(point(-0.5, 0.)).is_err());
    let mut background = BackgroundState::new(point(0.25, 0.5)).unwrap();
    let previous = background;
    assert!(
        background
            .advance_draw(point(0., -f64::MAX), point(1., f64::MAX), 64., 32.)
            .is_err()
    );
    assert_eq!(background, previous);
    assert!(
        background
            .advance_draw(point(0., 0.), point(1., 1.), 0., 32.)
            .is_err()
    );
    assert_eq!(background, previous);
    let mut input = input();
    input.zoom = 0.;
    assert!(background.plan(input).is_err());
    input.zoom = f64::from_bits(1);
    assert!(background.plan(input).is_err());
    input.zoom = 1.;
    input.quality.quality_blend = f64::NAN;
    assert!(background.plan(input).is_err());
    assert_eq!(background, previous);
}
