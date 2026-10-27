//! Original synthetic fixtures for the same-clock pre-motion control boundary.

use slither_client::{
    presentation::{AnimatedClient, ClientControlActions, ClientPresentationError, FrameClock},
    protocol::ElapsedHeader,
    state::Point,
};

fn u24(n: u32) -> [u8; 3] {
    let b = n.to_be_bytes();
    [b[1], b[2], b[3]]
}

fn setup() -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for n in [430_u16, 100, 20] {
        p.extend(n.to_be_bytes());
    }
    p.push(48);
    for n in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(n.to_be_bytes());
    }
    p.extend([19, 42]);
    p
}

fn appearance(id: u16, x: u32) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.extend(u24(0));
    p.push(b'0');
    p.extend(u24(0));
    p.extend(4250_u16.to_be_bytes());
    p.extend(u24(0));
    p.push(0);
    p.extend(u24(x * 5));
    p.extend(u24(5000));
    p.extend([0, 0, 255]);
    p.extend(u24((x - 84) * 5));
    p.extend(u24(5000));
    p.extend(0_u16.to_be_bytes());
    p
}

fn apply(c: &mut AnimatedClient, packets: &[Vec<u8>]) {
    let mut bytes = vec![];
    for p in packets {
        bytes.extend((p.len() as u16).to_be_bytes());
        bytes.extend(p);
    }
    c.apply_frame(&bytes, ElapsedHeader::Absent).unwrap();
}

fn client() -> AnimatedClient {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), appearance(7, 2000)]);
    c
}

#[test]
fn no_op_uses_one_clock_and_preserves_legacy_world_exactly() {
    let mut controlled = client();
    let mut legacy = controlled.clone();
    let mut clock = FrameClock::new(0.).unwrap();
    for (now, lagging) in [
        (0., false),
        (0., true),
        (7., true),
        (51., true),
        (51., false),
        (49., false),
        (60., false),
        (1000., true),
    ] {
        let expected = clock.advance(now, lagging, false).unwrap();
        let mut calls = 0;
        let step = controlled
            .advance_with_control::<ClientPresentationError, _>(now, lagging, |step, view| {
                calls += 1;
                assert_eq!(step, expected);
                assert_eq!(view, legacy.control_view());
                Ok(ClientControlActions::default())
            })
            .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(legacy.advance(now, lagging).unwrap(), expected);
        assert_eq!(step, expected);
        assert_eq!(controlled, legacy);
    }
}

#[test]
fn observes_raw_original_own_and_applies_gaze_before_current_pupil_motion() {
    let mut c = client();
    c.set_follows(false);
    c.set_camera_position(Point { x: 812., y: 913. }).unwrap();
    c.set_zoom(1.25).unwrap();
    let before = c.control_view();
    let mut expected = c.clone();
    let gaze = std::f64::consts::FRAC_PI_2;
    expected.set_own_gaze_heading(gaze).unwrap();
    expected.advance(8., false).unwrap();
    c.advance_with_control::<ClientPresentationError, _>(8., false, |step, view| {
        assert_eq!(view, before);
        assert_eq!(view.own.unwrap().raw_head, Point { x: 2000., y: 1000. });
        assert_eq!(view.camera, Point { x: 812., y: 913. });
        assert!(!view.follows);
        assert_eq!(view.zoom, 1.25);
        assert_eq!(step.delta, 1.);
        Ok(ClientControlActions {
            gaze_heading: Some(gaze),
            ..Default::default()
        })
    })
    .unwrap();
    assert_eq!(c, expected);
    assert!(c.own_snake().unwrap().eyes().pupil().y > 0.);
    assert!(c.control_view().own.unwrap().raw_head.x > 2000.);
}

#[test]
fn reset_before_motion_keeps_computed_lagged_step_and_future_clock_phase() {
    let mut c = client();
    let mut clock = FrameClock::new(0.).unwrap();
    let first = clock.advance(8., true, false).unwrap();
    let old_token = c.own_token().unwrap();
    let step = c
        .advance_with_control::<ClientPresentationError, _>(8., true, |step, view| {
            assert_eq!(step, first);
            assert_eq!(view.own.unwrap().token, old_token);
            Ok(ClientControlActions {
                gaze_heading: Some(1.),
                reset_world: true,
                reset_lag: true,
                connected: Some(true),
            })
        })
        .unwrap();
    assert_eq!(step, first);
    assert_eq!(step.lag_multiplier, 0.85);
    assert!(c.own_snake().is_none());
    assert_eq!(c.retained_count(), 0);
    assert!(c.received().setup.is_none());
    assert!(c.connected()); // Explicit gate override follows reset.
    clock.reset_lag();
    assert_eq!(
        c.advance(16., false).unwrap(),
        clock.advance(16., false, false).unwrap()
    );
    apply(&mut c, &[setup(), appearance(7, 3000)]);
    assert!(c.own_token().unwrap().serial() > old_token.serial());
}

#[test]
fn reset_disconnect_precedes_consumption_of_the_current_boundary_step() {
    let mut c = client();
    let mut radius = vec![b'z'];
    radius.extend(u24(1500));
    apply(&mut c, &[radius]);
    let boundary = c.boundary().unwrap().clone();
    let step = c
        .advance_with_control::<ClientPresentationError, _>(40., false, |step, _| {
            assert_eq!(step.whole_steps, 5);
            Ok(ClientControlActions {
                reset_world: true,
                ..Default::default()
            })
        })
        .unwrap();
    assert_eq!(step.whole_steps, 5);
    assert_eq!(c.boundary().unwrap(), &boundary);
    assert!(!c.connected());
    assert!(c.own_snake().is_none());
}

#[test]
fn lag_reset_changes_only_multiplier_and_keeps_time_world_and_phases() {
    let mut c = client();
    let mut clock = FrameClock::new(0.).unwrap();
    for now in [7., 11., 19.] {
        assert_eq!(
            c.advance(now, true).unwrap(),
            clock.advance(now, true, false).unwrap()
        );
    }
    let before = c.clone();
    c.reset_lag();
    let mut expected = before.clone();
    expected.reset_lag();
    assert_eq!(c, expected);
    assert_eq!(c.control_view(), before.control_view());
    assert_eq!(c.received(), before.received());
    assert_eq!(c.own_snake(), before.own_snake());
    assert_eq!(c.camera(), before.camera());
    assert_eq!(c.boundary(), before.boundary());
    clock.reset_lag();
    assert_eq!(
        c.advance(19., false).unwrap(),
        clock.advance(19., false, false).unwrap()
    );
    assert_eq!(
        c.advance(23., true).unwrap(),
        clock.advance(23., true, false).unwrap()
    );
}

#[test]
fn invalid_actions_and_callback_error_preserve_complete_model() {
    let mut c = client();
    for gaze in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let before = c.clone();
        assert!(
            c.advance_with_control::<ClientPresentationError, _>(8., true, |_, _| {
                Ok(ClientControlActions {
                    gaze_heading: Some(gaze),
                    reset_world: true,
                    reset_lag: true,
                    connected: Some(false),
                })
            })
            .is_err()
        );
        assert_eq!(c, before);
    }
    let before = c.clone();
    let mut external_attempts = 0;
    let result = c.advance_with_control::<ClientPresentationError, _>(8., true, |_, _| {
        external_attempts += 1;
        Err(ClientPresentationError::Limit)
    });
    assert_eq!(result, Err(ClientPresentationError::Limit));
    assert_eq!(external_attempts, 1);
    assert_eq!(c, before);
    let mut called = false;
    assert!(
        c.advance_with_control::<ClientPresentationError, _>(f64::NAN, false, |_, _| {
            called = true;
            Ok(Default::default())
        })
        .is_err()
    );
    assert!(!called);
    assert_eq!(c, before);
}

#[test]
fn control_keeps_original_own_through_death_expiry_and_wire_reuse() {
    let mut c = client();
    let original = c.control_view().own.unwrap();
    apply(&mut c, &[vec![b's', 0, 7, 1], appearance(7, 3000)]);
    for now in (40..=4000).step_by(40) {
        c.advance(f64::from(now), false).unwrap();
    }
    let own = c.control_view().own.unwrap();
    assert_eq!(own.token, original.token);
    assert_eq!(own.raw_head, original.raw_head);
    assert!(own.dead);
    assert!(c.drawn_own_snake().is_none());
    assert_eq!(c.snake(7).unwrap().metrics().raw_head.y, 1000.);
    assert_ne!(c.snake(7), c.own_snake());
    c.advance_with_control::<ClientPresentationError, _>(4008., false, |_, view| {
        assert_eq!(view.own.unwrap(), own);
        Ok(ClientControlActions {
            gaze_heading: Some(2.),
            ..Default::default()
        })
    })
    .unwrap();
    assert_eq!(c.control_view().own.unwrap().gaze_heading, 2.);
    c.reset();
    assert!(c.control_view().own.is_none());
    apply(&mut c, &[setup(), appearance(7, 2000)]);
    assert!(c.own_token().unwrap().serial() > original.token.serial());
}

#[test]
fn no_own_gaze_is_validated_and_callback_still_runs() {
    let mut c = AnimatedClient::new(10.).unwrap();
    c.advance_with_control::<ClientPresentationError, _>(10., false, |step, view| {
        assert_eq!(step.delta, 0.);
        assert!(view.own.is_none());
        Ok(ClientControlActions {
            gaze_heading: Some(-0.),
            ..Default::default()
        })
    })
    .unwrap();
    let before = c.clone();
    assert!(
        c.advance_with_control::<ClientPresentationError, _>(10., false, |_, _| {
            Ok(ClientControlActions {
                gaze_heading: Some(f64::NAN),
                ..Default::default()
            })
        })
        .is_err()
    );
    assert_eq!(c, before);
}
