//! Original synthetic clock/lifecycle cases; no reference inputs or networking.

use slither_client::{
    presentation::{CAMERA_SAMPLES, CameraCorrections, HEAD_SAMPLES, LengthPresentation},
    state::Point,
};

#[test]
fn spawn_mass_changes_target_before_displayed_length() {
    let mut length = LengthPresentation::new(12);
    assert_eq!(length.displayed(), 11.4);
    length.set_length(12, 0.5).unwrap();
    assert_eq!((length.target(), length.offset()), (12.5, -0.5));
    assert_eq!(length.displayed(), 11.4);
    length.advance(0, true);
    assert_eq!(length.displayed(), 11.4);
    assert_eq!(length.pending(), HEAD_SAMPLES as i32);
    length.advance(HEAD_SAMPLES as u32, true);
    assert_eq!(length.displayed(), 11.9);
    assert_eq!(length.pending(), 0);
    length.advance(0, true);
    assert_eq!(length.pending(), -1);
}

#[test]
fn length_changes_accumulate_and_equal_updates_restart_pending_interval() {
    let mut length = LengthPresentation::new(10);
    length.set_length(11, 0.25).unwrap();
    length.advance(7, true);
    let offset = length.offset();
    length.set_length(12, 0.5).unwrap();
    assert_ne!(length.offset(), -1.25);
    assert!(length.offset() < offset);
    let samples = *length.samples();
    let index = length.index();
    length.advance(3, true);
    assert_eq!(length.pending(), HEAD_SAMPLES as i32 - 3);
    let after_consumption = *length.samples();
    length.set_length(12, 0.5).unwrap();
    assert_eq!(length.samples(), &after_consumption);
    assert_eq!(length.pending(), HEAD_SAMPLES as i32);
    assert_eq!(length.index(), (index + 3) % HEAD_SAMPLES);
    assert_ne!(samples, after_consumption);
}

#[test]
fn dead_length_preserves_offsets_and_display_until_live_update() {
    let mut length = LengthPresentation::new(5);
    length.set_length(4, 0.).unwrap();
    let frozen = length.clone();
    length.advance(1000, false);
    assert_eq!(length, frozen);
    length.advance(1, true);
    assert_eq!(length.pending(), HEAD_SAMPLES as i32 - 1);
    assert_eq!(length.displayed(), 4.4);
    length.advance(1000, true);
    assert_eq!(length.pending(), 0);
    let exhausted = length.clone();
    length.advance(0, false);
    assert_eq!(length, exhausted);
    length.advance(0, true);
    assert_eq!(length.pending(), -1);
    assert_eq!(length.displayed(), 3.4);
}

#[test]
fn invalid_mass_preserves_all_length_state() {
    let mut length = LengthPresentation::new(8);
    length.set_length(9, 1.).unwrap();
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.1, 1.1] {
        let before = length.clone();
        assert!(length.set_length(30, invalid).is_err());
        assert_eq!(length, before);
    }
}

#[test]
fn camera_injection_waits_for_draw_and_clears_each_consumed_slot() {
    let mut camera = CameraCorrections::default();
    camera.inject(Point { x: 8., y: -4. }).unwrap();
    assert_eq!(camera.offset(), Point::default());
    assert_eq!(camera.pending(), CAMERA_SAMPLES);
    camera.advance_draw();
    assert_eq!(camera.offset(), Point { x: -8., y: 4. });
    assert_eq!(camera.index(), 1);
    assert_eq!(camera.pending(), CAMERA_SAMPLES - 1);
    assert_eq!((camera.samples()[0][0], camera.samples()[1][0]), (0., 0.));
}

#[test]
fn camera_overlap_uses_current_index_and_double_precision_storage() {
    let mut camera = CameraCorrections::default();
    assert_eq!(camera.weights()[0], 1.);
    assert_eq!(camera.weights()[CAMERA_SAMPLES - 1], 0.);
    assert_ne!(camera.weights()[1], f64::from(camera.weights()[1] as f32));
    camera.inject(Point { x: 1., y: 0. }).unwrap();
    for _ in 0..9 {
        camera.advance_draw();
    }
    let old_offset = camera.offset();
    let current = camera.samples()[0][camera.index()];
    camera.inject(Point { x: 2., y: 0. }).unwrap();
    assert_eq!(camera.offset(), old_offset);
    assert_eq!(camera.pending(), CAMERA_SAMPLES);
    camera.advance_draw();
    assert_eq!(camera.offset().x, current - 2.);
}

#[test]
fn camera_draw_ring_wraps_without_entity_cleanup_sentinel() {
    let mut camera = CameraCorrections::default();
    camera.inject(Point { x: 2., y: 3. }).unwrap();
    for _ in 0..CAMERA_SAMPLES {
        camera.advance_draw();
    }
    assert_eq!((camera.index(), camera.pending()), (0, 0));
    assert_eq!(camera.offset(), Point::default());
    assert_eq!(camera.samples(), &[[0.; CAMERA_SAMPLES]; 2]);
    let exhausted = camera.clone();
    camera.advance_draw();
    assert_eq!(camera, exhausted);
    camera.inject(Point { x: 1., y: 0. }).unwrap();
    camera.advance_draw();
    assert_eq!(camera.offset(), Point { x: -1., y: 0. });
}

#[test]
fn invalid_camera_injection_rolls_back_both_channels_and_pending_state() {
    let mut camera = CameraCorrections::default();
    camera.inject(Point { x: f64::MAX, y: 1. }).unwrap();
    for displacement in [
        Point { x: f64::NAN, y: 0. },
        Point {
            x: 0.,
            y: f64::INFINITY,
        },
        Point { x: f64::MAX, y: 2. },
    ] {
        let before = camera.clone();
        assert!(camera.inject(displacement).is_err());
        assert_eq!(camera, before);
    }
}
