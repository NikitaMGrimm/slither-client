use slither_client::stock_controller_policy::{
    Stage, StockControllerPolicy as Policy, backing_size, finite, observed_step,
};

fn update(p: &mut Policy, frame: bool, playing: bool) {
    p.begin_update(frame, false, true, true, true, true)
        .unwrap();
    assert!(p.uses_control());
    p.advance_done().unwrap();
    p.playing_observed(playing).unwrap();
    p.quality_done().unwrap();
    p.step_observed(-0., -0.).unwrap();
    p.step_freed().unwrap();
    p.observer_done().unwrap();
}

#[test]
fn captured_playing_and_statistics_precede_current_frame_draw() {
    let mut p = Policy::new(960., 540.).unwrap();
    p.begin_packet().unwrap();
    p.packet_succeeded(2.).unwrap();
    p.finish().unwrap();
    update(&mut p, true, false);
    assert!(!p.playing());
    assert_eq!(p.view().draws_since_statistics, 2.);
    assert!(p.draw_succeeded().is_err());
    p.statistics_result(true).unwrap();
    assert_eq!(p.view().draws_since_statistics, 0.);
    p.draw_succeeded().unwrap();
    p.finish().unwrap();
    assert_eq!(p.view().draws, 3.);
    assert_eq!(p.view().draws_since_statistics, 1.);
}

#[test]
fn release_failure_retains_resize_and_draw_partial_commit() {
    let mut p = Policy::new(960., 540.).unwrap();
    p.begin_draw(Some((800., 600.))).unwrap();
    assert_eq!(p.target(), (800., 600.));
    assert_eq!(p.view().width, 960.);
    p.draw_succeeded().unwrap();
    p.finish().unwrap();
    p.stop();
    assert_eq!(p.view().width, 800.);
    assert_eq!(p.view().height, 600.);
    assert_eq!(p.view().draws, 1.);
    assert!(p.begin_packet().is_err());
}

#[test]
fn exhausted_interval_commits_both_additions_before_failure() {
    let mut p = Policy::new(1., 4096.).unwrap();
    p.begin_packet().unwrap();
    p.packet_succeeded(f64::from(u32::MAX)).unwrap();
    p.finish().unwrap();
    p.begin_draw(Some((2., 2.))).unwrap();
    assert!(p.draw_succeeded().is_err());
    assert_eq!(p.view().draws, 4_294_967_296.);
    assert_eq!(p.view().draws_since_statistics, 4_294_967_296.);
    assert_eq!(
        p.view().width,
        1.,
        "dimension commit follows successful count check"
    );
}

#[test]
fn invalid_packet_count_is_uncommitted_and_no_observer_can_skip_free() {
    for count in [-1., 0.5, f64::NAN, f64::INFINITY, 4_294_967_296.] {
        let mut p = Policy::new(1., 1.).unwrap();
        p.begin_packet().unwrap();
        assert!(p.packet_succeeded(count).is_err());
        assert_eq!(p.view().draws, 0.);
    }
    let mut p = Policy::new(1., 1.).unwrap();
    p.begin_update(false, true, false, false, true, true)
        .unwrap();
    assert!(p.advance_done().is_err());
    p.gaze_done().unwrap();
    p.advance_done().unwrap();
    p.quality_done().unwrap();
    assert!(p.observer_done().is_err());
    assert!(p.step_observed(6., 1.).is_err());
    assert_eq!(p.stage(), Stage::Step);
    p.step_observed(0., -0.).unwrap();
    assert!(p.statistics_result(true).is_err());
    p.step_freed().unwrap();
    p.observer_done().unwrap();
    p.statistics_result(false).unwrap();
    p.finish().unwrap();
}

#[test]
fn pure_admission_matches_strict_numeric_bounds() {
    for v in [0., -0., 4097., 1.5, f64::INFINITY, f64::NAN] {
        assert!(backing_size(v).is_err());
    }
    assert_eq!(backing_size(1.).unwrap(), 1.);
    assert_eq!(backing_size(4096.).unwrap(), 4096.);
    assert!(finite(-0., false).is_ok());
    assert!(finite(f64::NAN, true).is_err());
    assert!(observed_step(0., -0.).is_ok());
    assert!(observed_step(5., 5.).is_ok());
    for (whole, delta) in [(6., 0.), (0.1, 1.), (0., -0.1), (0., 5.1), (0., f64::NAN)] {
        assert!(observed_step(whole, delta).is_err());
    }
}
