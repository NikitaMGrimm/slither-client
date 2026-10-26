//! Original synthetic boundary schedules, without reference artifacts or networking.

use slither_client::presentation::{BOUNDARY_SAMPLES, BoundaryRadius};

#[test]
fn target_waits_for_connected_whole_steps_and_consumes_absolute_samples() {
    let mut boundary = BoundaryRadius::new(1000.).unwrap();
    boundary.set_target(700.).unwrap();
    assert_eq!((boundary.displayed(), boundary.target()), (1000., 700.));
    assert_eq!(boundary.samples()[0], 1000.);
    assert_eq!(boundary.samples()[BOUNDARY_SAMPLES - 1], 700.);
    let frozen = boundary.clone();
    boundary.advance(0, true);
    boundary.advance(100, false);
    assert_eq!(boundary, frozen);
    boundary.advance(1, true);
    assert_eq!(boundary.displayed(), 1000.);
    assert_eq!(boundary.samples()[0], 700.);
    assert_eq!((boundary.index(), boundary.pending()), (1, 55));
    let last = boundary.samples()[3];
    boundary.advance(3, true);
    assert_eq!(boundary.displayed(), last);
    assert_eq!((boundary.index(), boundary.pending()), (4, 52));
}

#[test]
fn exhaustion_clamps_large_steps_and_defers_cleanup_until_positive_connected_step() {
    let mut boundary = BoundaryRadius::new(2000.).unwrap();
    boundary.set_target(4000.).unwrap();
    boundary.advance(u32::MAX, true);
    assert_eq!(boundary.displayed(), 4000.);
    assert_eq!((boundary.index(), boundary.pending()), (0, 0));
    assert_eq!(boundary.samples(), &[4000.; BOUNDARY_SAMPLES]);
    boundary.advance(0, true);
    boundary.advance(1, false);
    assert_eq!(boundary.pending(), 0);
    boundary.advance(1, true);
    assert_eq!(boundary.pending(), -1);
    let clean = boundary.clone();
    boundary.advance(u32::MAX, true);
    assert_eq!(boundary, clean);
}

#[test]
fn overlapping_targets_reblend_existing_absolute_samples_at_current_cursor() {
    let mut boundary = BoundaryRadius::new(1500.).unwrap();
    boundary.set_target(900.).unwrap();
    boundary.advance(9, true);
    let previous = *boundary.samples();
    let displayed = boundary.displayed();
    boundary.set_target(1200.).unwrap();
    assert_eq!(boundary.displayed(), displayed);
    assert_eq!((boundary.index(), boundary.pending()), (9, 56));
    assert_eq!(boundary.samples()[9], previous[9]);
    assert_eq!(boundary.samples()[8], 1200.);
    assert!(boundary.samples()[10] < previous[10]);
    assert!(boundary.samples()[10] > 1200.);
    let once = *boundary.samples();
    boundary.set_target(1200.).unwrap();
    assert_ne!(boundary.samples(), &once);
    assert_eq!(boundary.samples()[9], once[9]);
    boundary.advance(56, true);
    assert_eq!((boundary.index(), boundary.pending()), (9, 0));
    assert_eq!(boundary.displayed(), 1200.);
}

#[test]
fn setup_replaces_all_radii_without_changing_cursor_or_pending_state() {
    let mut boundary = BoundaryRadius::new(800.).unwrap();
    boundary.set_target(400.).unwrap();
    boundary.advance(17, true);
    boundary.apply_setup(1600.).unwrap();
    assert_eq!((boundary.index(), boundary.pending()), (17, 39));
    assert_eq!((boundary.displayed(), boundary.target()), (1600., 1600.));
    assert_eq!(boundary.samples(), &[1600.; BOUNDARY_SAMPLES]);
    boundary.advance(39, true);
    boundary.advance(1, true);
    boundary.apply_setup(900.).unwrap();
    assert_eq!((boundary.index(), boundary.pending()), (0, -1));
    assert_eq!(boundary.displayed(), 900.);
}

#[test]
fn weights_and_samples_keep_double_precision() {
    let mut boundary = BoundaryRadius::new(1. / 3.).unwrap();
    assert_eq!(boundary.weights()[0], 0.);
    assert_eq!(boundary.weights()[BOUNDARY_SAMPLES - 1], 1.);
    assert_ne!(
        boundary.weights()[1],
        f64::from(boundary.weights()[1] as f32)
    );
    assert!(boundary.weights().windows(2).all(|pair| pair[0] < pair[1]));
    boundary.set_target(1. / 7.).unwrap();
    assert_ne!(
        boundary.samples()[1],
        f64::from(boundary.samples()[1] as f32)
    );
}

#[test]
fn invalid_radii_preserve_the_complete_ring() {
    let mut boundary = BoundaryRadius::new(600.).unwrap();
    boundary.set_target(300.).unwrap();
    boundary.advance(11, true);
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 0., -0., -1.] {
        assert!(BoundaryRadius::new(invalid).is_err());
        let before = boundary.clone();
        assert!(boundary.set_target(invalid).is_err());
        assert_eq!(boundary, before);
        assert!(boundary.apply_setup(invalid).is_err());
        assert_eq!(boundary, before);
    }
}
