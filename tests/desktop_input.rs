//! Authored numeric and staged-callback boundaries; no transport or browser.
use slither_client::desktop_input::{DesktopInput, ErrorKind, OwnInput, project_pointer};

fn own() -> OwnInput {
    OwnInput {
        wanted_heading: 0.0,
        gaze_heading: 0.0,
        dead: false,
        turn_rate: 0.03,
        size_turn_factor: 0.5,
        speed_turn_factor: 0.8,
        requested_boost: false,
        sent_boost: false,
    }
}
fn fixture(protocol: f64) -> DesktopInput {
    let mut input = DesktopInput::new(protocol).unwrap();
    input.set_connected(true);
    input.set_own(own(), false).unwrap();
    input
}
fn pointer(x: f64, y: f64) -> [f64; 11] {
    [x, y, 800.0, 600.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
}

#[test]
fn css_projection_orders_centering_before_head_correction() {
    let value = project_pointer(&[
        9_007_199_254_740_992.0,
        0.0,
        2.0,
        2.0,
        0.0,
        1.0,
        2.0,
        1.0,
        0.0,
        0.0,
        1.0,
    ])
    .unwrap();
    assert_eq!(value.point.x, 9_007_199_254_740_992.0);
    assert_eq!(value.point.y, 0.0);
    assert!(project_pointer(&pointer(f64::MAX, 0.0)).is_err());
    let mut input = DesktopInput::new(19.0).unwrap();
    assert!(
        input
            .pointer(&[
                1.0,
                2.0,
                800.0,
                600.0,
                0.0,
                1.0,
                f64::NAN,
                0.0,
                0.0,
                0.0,
                0.0
            ])
            .is_ok()
    );
    input.set_own(own(), false).unwrap();
    assert!(
        input
            .pointer(&[1.0, 2.0, 800.0, 600.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
            .is_err()
    );
}

#[test]
fn turn_boost_heading_have_strict_independent_gates_and_versioned_bytes() {
    for protocol in [4.0, 19.0] {
        let mut input = fixture(protocol);
        input.key("ArrowLeft", true);
        input.key("Space", true);
        input.pointer(&pointer(400.0, 400.0)).unwrap();
        assert!(input.keyboard_phase(50.0, 5.0).unwrap().is_empty());
        assert!(input.boost_phase(50.0).unwrap().is_empty());
        assert!(input.heading_phase(33.0).unwrap().is_empty());
        assert_eq!(
            input.keyboard_phase(51.0, 0.0).unwrap(),
            if protocol >= 5.0 {
                vec![252, 5]
            } else {
                vec![108, 5]
            }
        );
        assert_eq!(
            input.boost_phase(51.0).unwrap(),
            if protocol >= 5.0 {
                vec![253]
            } else {
                vec![109, 1]
            }
        );
        assert_eq!(
            input.heading_phase(34.0).unwrap(),
            if protocol >= 5.0 {
                vec![62]
            } else {
                vec![101, 63, 255, 255]
            }
        );
    }
}

#[test]
fn equal_positive_debts_remain_uncancelled_and_capped_debt_survives() {
    let mut input = fixture(19.0);
    input.key("ArrowLeft", true);
    input.key("ArrowRight", true);
    input.accumulate(5.0).unwrap();
    input.key("ArrowLeft", false);
    input.key("ArrowRight", false);
    assert_eq!(input.keyboard_phase(51.0, 0.0).unwrap(), [252, 5]);
    assert_eq!(input.view().right_steps, 5);
    assert_eq!(input.keyboard_phase(102.0, 0.0).unwrap(), [252, 133]);
    input.key("ArrowRight", true);
    for _ in 0..30 {
        input.accumulate(5.0).unwrap();
    }
    input.key("ArrowRight", false);
    assert_eq!(input.keyboard_phase(153.0, 0.0).unwrap(), [252, 255]);
    assert_eq!(input.view().right_steps, 23);
}

#[test]
fn invalid_turn_arithmetic_does_not_commit_pending_debt_or_clock() {
    let mut input = fixture(19.0);
    let mut next = own();
    next.turn_rate = f64::MAX;
    input.set_own(next, false).unwrap();
    input.key("ArrowLeft", true);
    let before = input.view().clone();
    assert!(input.keyboard_phase(51.0, 5.0).is_err());
    assert_eq!(input.view(), &before);
}

#[test]
fn callback_boundary_keeps_commits_and_observes_replacement_metadata() {
    let mut input = fixture(19.0);
    input.enter_tick().unwrap();
    input.key("ArrowLeft", true);
    input.key("Space", true);
    assert_eq!(input.keyboard_phase(251.0, 3.0).unwrap(), [252, 3]);
    assert_eq!(input.view().last_turn_ms, 251.0);
    assert_eq!(input.view().left_steps, 0);
    assert!(input.accumulate(0.0).is_err());
    assert!(input.enter_tick().is_err());
    // A host callback changes protocol/connection; an admitted tick continues.
    input.set_protocol(4.0).unwrap();
    input.set_connected(false);
    assert_eq!(input.boost_phase(251.0).unwrap(), [109, 1]);
    input.clear_own();
    let before = input.view().clone();
    assert_eq!(
        input.heading_phase(251.0).unwrap_err().kind,
        ErrorKind::Type
    );
    assert_eq!(input.view().last_heading_ms, before.last_heading_ms);
    input.leave_tick();
    input.accumulate(0.0).unwrap();
}

#[test]
fn appearance_identity_retains_gaze_boost_but_reset_only_detaches_current_fields() {
    let mut input = fixture(19.0);
    input.key("Space", true);
    input.boost_phase(51.0).unwrap();
    input.pointer(&pointer(400.0, 400.0)).unwrap();
    input.heading_phase(51.0).unwrap();
    let previous = input.view().own.unwrap();
    let mut next = own();
    next.gaze_heading = 9.0;
    next.dead = true;
    input.set_own(next, true).unwrap();
    assert_eq!(
        input.view().own.unwrap().gaze_heading,
        previous.gaze_heading
    );
    assert!(input.view().own.unwrap().sent_boost);
    input.set_own(next, false).unwrap();
    assert_eq!(input.view().own.unwrap().gaze_heading, 9.0);
    assert!(!input.view().own.unwrap().requested_boost);
    let pointer = input.view().pointer;
    input.reset();
    assert!(!input.view().connected);
    assert!(input.view().own.is_none());
    assert!(input.view().boost_key_held);
    assert_eq!(input.view().pointer, pointer);
    assert_eq!(input.view().last_boost_ms, 51.0);
}

#[test]
fn signed_zero_heading_and_inclusive_small_pointer_dead_zone_are_retained() {
    let mut input = fixture(19.0);
    let mut next = own();
    next.wanted_heading = std::f64::consts::PI;
    input.set_own(next, false).unwrap();
    input.pointer(&pointer(400.0, 316.0)).unwrap();
    assert_eq!(input.heading_phase(34.0).unwrap(), [125]);
    assert_eq!(input.required_gaze().unwrap(), std::f64::consts::FRAC_PI_2);
    next.wanted_heading = -0.0;
    input.set_own(next, true).unwrap();
    input.pointer(&pointer(401.0, 300.0)).unwrap();
    assert_eq!(input.heading_phase(68.0).unwrap(), [0]);
    assert!(input.view().last_quantized_heading.is_sign_negative());
    input.mouse_up();
    input.blur();
    input.pagehide();
    assert!(input.view().own.is_some());
}

#[test]
fn direct_phase_invalid_times_reject_without_commit() {
    let mut input = fixture(19.0);
    input.key("Space", true);
    let before = input.view().clone();
    for now in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(input.keyboard_phase(now, 5.0).is_err());
        assert!(input.boost_phase(now).is_err());
        assert!(input.heading_phase(now).is_err());
        assert_eq!(input.view(), &before);
    }
}
