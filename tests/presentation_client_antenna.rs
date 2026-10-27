//! Original synthetic protocol-19 fixtures and supplied random pairs; no external inputs.

use slither_client::{
    presentation::{
        AnimatedClient, AntennaBarrierEffect, AntennaBulbGeometry, AntennaCullBounds, AntennaError,
        AntennaRandomRequest, AppearancePresentation, BodyPaintView, ClientPresentationError,
        OrdinaryAntennaGeometry, PreparedSnake,
    },
    protocol::ElapsedHeader,
    state::Point,
};

fn u24(v: u32) -> [u8; 3] {
    [(v >> 16) as u8, (v >> 8) as u8, v as u8]
}

fn setup() -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for v in [430_u16, 100, 20] {
        p.extend(v.to_be_bytes());
    }
    p.push(48);
    for v in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(v.to_be_bytes());
    }
    p.extend([19, 42]);
    p
}

fn spawn(id: u16, x: u32, points: usize) -> Vec<u8> {
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
    if points > 0 {
        p.extend(u24((x - points as u32 * 42) * 5));
        p.extend(u24(5000));
        for _ in 2..points {
            p.extend([211, 127]);
        }
        if points >= 2 {
            p.extend(0_u16.to_be_bytes());
        }
    }
    p
}

fn remove(id: u16, death: bool) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.push(u8::from(death));
    p
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    commands
        .iter()
        .flat_map(|p| {
            let mut bytes = (p.len() as u16).to_be_bytes().to_vec();
            bytes.extend(p);
            bytes
        })
        .collect()
}

fn geometry(nodes: usize) -> OrdinaryAntennaGeometry {
    OrdinaryAntennaGeometry {
        nodes,
        outer_color: 0x13579b,
        inner_color: 0xabcdef,
        inner_opacity: 0.43,
        repeated_inner_strokes: true,
        rotate_bulb: true,
        bulb: AntennaBulbGeometry {
            offset_x: -9.5,
            offset_y: -13.25,
            width: 27.,
            height: 31.,
            scale: 0.7,
            opacity: 0.8,
        },
    }
}

fn style(nodes: usize) -> AppearancePresentation {
    AppearancePresentation {
        antenna: Some(geometry(nodes)),
        ..AppearancePresentation::default()
    }
}

fn apply(c: &mut AnimatedClient, commands: &[Vec<u8>]) {
    c.apply_frame_with_appearance::<ClientPresentationError, _>(
        &bundle(commands),
        ElapsedHeader::Absent,
        |_| Ok(style(9)),
    )
    .unwrap();
}

fn client() -> AnimatedClient {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), spawn(7, 2000, 12)]);
    c.set_follows(false);
    c.set_zoom(1.).unwrap();
    c.set_camera_position(Point { x: 2000., y: 1000. }).unwrap();
    c
}

fn pairs(r: AntennaRandomRequest) -> Result<Vec<[f64; 2]>, ClientPresentationError> {
    Ok(vec![[0.2, 0.8]; r.random_pair_count])
}

fn draw(c: &mut AnimatedClient) -> Vec<PreparedSnake> {
    c.prepare_draw_with_antenna(800, 600, 1., false, pairs)
        .unwrap()
}

#[test]
fn appearance_mode_is_explicit_persistent_and_legacy_callbacks_cannot_replace_metadata() {
    let mut c = client();
    assert!(c.appearance_enabled());
    let before = c.clone();
    let error = c.apply_frame_with_face_geometry::<ClientPresentationError, _>(
        &spawn(8, 2200, 2),
        ElapsedHeader::Absent,
        |_| panic!("missing full resolver must reject before invoking legacy callback"),
    );
    assert_eq!(
        error,
        Err(ClientPresentationError::AppearanceResolverRequired)
    );
    assert!(c == before);
    c.apply_frame(&setup(), ElapsedHeader::Absent).unwrap();
    let before = c.clone();
    assert_eq!(
        c.prepare_draw(800, 600),
        Err(ClientPresentationError::AntennaRandomRequired)
    );
    assert!(c == before);
    c.reset();
    assert!(c.appearance_enabled());
    apply(&mut c, &[setup(), spawn(9, 2000, 2)]);

    let mut legacy = AnimatedClient::new(0.).unwrap();
    legacy.apply_frame(&setup(), ElapsedHeader::Absent).unwrap();
    let before = legacy.clone();
    assert_eq!(
        legacy.apply_frame_with_appearance::<ClientPresentationError, _>(
            &spawn(8, 2000, 2),
            ElapsedHeader::Absent,
            |_| panic!("mode is too late"),
        ),
        Err(ClientPresentationError::AppearanceModeRequiresReset)
    );
    assert!(legacy == before);
    legacy.reset();
    apply(&mut legacy, &[setup(), spawn(8, 2000, 2)]);
}

#[test]
fn malformed_whole_frame_precedes_callbacks_and_late_geometry_failure_rolls_back() {
    let mut c = client();
    let before = c.clone();
    assert!(
        c.apply_frame_with_appearance::<ClientPresentationError, _>(
            &bundle(&[spawn(8, 2100, 12), vec![b'r', 0]]),
            ElapsedHeader::Absent,
            |_| panic!("all received validation must finish first"),
        )
        .is_err()
    );
    assert!(c == before);
    let mut calls = 0;
    let error = c.apply_frame_with_appearance::<ClientPresentationError, _>(
        &bundle(&[spawn(8, 2100, 12), spawn(9, 2200, 12)]),
        ElapsedHeader::Absent,
        |_| {
            calls += 1;
            Ok(style(if calls == 2 { 10 } else { 8 }))
        },
    );
    assert_eq!(
        error,
        Err(ClientPresentationError::Antenna(
            AntennaError::InvalidGeometry
        ))
    );
    assert_eq!(calls, 2);
    assert!(c == before);
}

#[test]
fn every_draw_steps_once_without_advancing_the_update_clock_or_double_sampling() {
    let mut c = client();
    let token = c.own_token().unwrap();
    let initial = c.antenna_snapshot(token).unwrap();
    let mut no_antenna = AnimatedClient::new(0.).unwrap();
    no_antenna
        .apply_frame(
            &bundle(&[setup(), spawn(7, 2000, 12)]),
            ElapsedHeader::Absent,
        )
        .unwrap();
    no_antenna.set_follows(false);
    no_antenna.set_zoom(1.).unwrap();
    no_antenna
        .set_camera_position(Point { x: 2000., y: 1000. })
        .unwrap();
    let first = draw(&mut c);
    let legacy = no_antenna
        .prepare_draw_with_style(800, 600, 1., false)
        .unwrap();
    assert_eq!(first[0].metrics, legacy[0].metrics);
    assert_eq!(first[0].curve, legacy[0].curve);
    assert_eq!(first[0].body_geometry, legacy[0].body_geometry);
    assert_eq!(c.camera(), no_antenna.camera());
    assert_eq!(first[0].token, token);
    assert_eq!(first[0].metrics.spawn_progress, 0.);
    assert!(first[0].antenna.as_ref().unwrap().bulb.is_some());
    let once = c.antenna_snapshot(token).unwrap();
    assert!(once.shown);
    assert_ne!(once.x, initial.x);
    draw(&mut c);
    let twice = c.antenna_snapshot(token).unwrap();
    assert_ne!(twice, once);
    assert_eq!(c.draw_serial(), 2);
    let snapshot = c.clone();
    assert_eq!(c.antenna_snapshot(token).unwrap(), twice);
    assert!(c == snapshot);
    c.advance(0., false).unwrap();
    assert_eq!(c.antenna_snapshot(token).unwrap(), twice);
    assert_eq!(c.own_snake().unwrap().metrics().spawn_progress, 0.);
}

#[test]
fn no_antenna_draws_match_legacy_exactly_without_random_callbacks() {
    let mut c = AnimatedClient::new(3.).unwrap();
    c.apply_frame(
        &bundle(&[setup(), spawn(7, 2000, 12), spawn(8, 2100, 12)]),
        ElapsedHeader::Absent,
    )
    .unwrap();
    c.advance(9., false).unwrap();
    let mut other = c.clone();
    for detailed in [false, true, false] {
        let expected = c.prepare_draw_with_style(800, 600, 1.3, detailed).unwrap();
        let actual = other
            .prepare_draw_with_antenna::<ClientPresentationError, _>(
                800,
                600,
                1.3,
                detailed,
                |_| panic!("disabled means no randomness"),
            )
            .unwrap();
        assert_eq!(actual, expected);
        assert!(c == other);
        assert!(
            actual
                .iter()
                .all(|snake| snake.antenna.is_none() && snake.antenna_geometry.is_none())
        );
    }
}

#[test]
fn callbacks_follow_draw_order_with_stable_duplicate_tokens_and_serials() {
    let mut c = client();
    apply(&mut c, &[spawn(7, 2100, 12), spawn(8, 2200, 12)]);
    let objects: Vec<_> = c
        .snake_objects()
        .map(|(token, own, drawn, snake)| {
            assert!(drawn);
            (token, own, snake.metrics().id)
        })
        .collect();
    assert_ne!(objects[0].0, objects[1].0);
    let mut calls = Vec::new();
    for serial in 1..=2 {
        let snakes = c
            .prepare_draw_with_antenna::<ClientPresentationError, _>(800, 600, 1., false, |r| {
                calls.push(r);
                pairs(r)
            })
            .unwrap();
        assert_eq!(snakes.len(), 3);
        let round = &calls[(serial - 1) * 3..serial * 3];
        for (ordinal, r) in round.iter().enumerate() {
            assert_eq!((r.token, r.own, r.id), objects[ordinal]);
            assert_eq!(r.draw_ordinal, ordinal);
            assert_eq!(r.draw_serial, serial as u64);
            assert_eq!(r.node_count, 9);
            assert_eq!(r.random_pair_count, 8);
        }
    }
    assert_ne!(
        c.antenna_snapshot(objects[0].0),
        c.antenna_snapshot(objects[1].0)
    );
}

#[test]
fn whole_cull_preserves_latch_while_inner_rejection_clears_only_latch_and_reentry_runs() {
    let mut c = client();
    let token = c.own_token().unwrap();
    draw(&mut c);
    let shown = c.antenna_snapshot(token).unwrap();
    assert!(
        shown
            .velocity_x
            .iter()
            .chain(&shown.velocity_y)
            .any(|v| *v != 0.)
    );
    c.set_camera_position(Point {
        x: 20_000.,
        y: 1000.,
    })
    .unwrap();
    assert!(
        c.prepare_draw_with_antenna::<ClientPresentationError, _>(200, 200, 1., false, |_| panic!(
            "whole cull requests no random pairs"
        ),)
            .unwrap()
            .is_empty()
    );
    assert_eq!(c.antenna_snapshot(token).unwrap(), shown);
    c.set_camera_position(Point { x: 1500., y: 1000. }).unwrap();
    let rejected = c
        .prepare_draw_with_antenna::<ClientPresentationError, _>(200, 200, 1., false, |_| {
            panic!("root outside 210-unit bounds requests no pairs")
        })
        .unwrap();
    assert_eq!(rejected.len(), 1);
    assert!(matches!(
        rejected[0].antenna.as_ref().unwrap().barrier_effect,
        AntennaBarrierEffect::Rejected { .. }
    ));
    let mut expected = shown;
    expected.shown = false;
    assert_eq!(c.antenna_snapshot(token).unwrap(), expected);
    c.set_camera_position(Point { x: 2000., y: 1000. }).unwrap();
    draw(&mut c);
    let returned = c.antenna_snapshot(token).unwrap();
    assert!(returned.shown);
    assert_ne!(returned.velocity_x, expected.velocity_x);
    assert!(returned.velocity_x.iter().any(|v| *v != 0.));
}

#[test]
fn short_visible_antenna_returns_rejected_barrier_without_randomness() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), spawn(7, 2000, 1)]);
    let token = c.own_token().unwrap();
    let before = c.antenna_snapshot(token).unwrap();
    let snakes = c
        .prepare_draw_with_antenna::<ClientPresentationError, _>(800, 600, 1., false, |_| {
            panic!("short curve must not request randomness")
        })
        .unwrap();
    assert_eq!(snakes.len(), 1);
    assert!(snakes[0].curve.is_none());
    let antenna = snakes[0].antenna.as_ref().unwrap();
    assert!(antenna.outer_path.is_empty());
    assert!(antenna.bulb.is_none());
    assert!(matches!(
        antenna.barrier_effect,
        AntennaBarrierEffect::Rejected { .. }
    ));
    assert_eq!(c.antenna_snapshot(token).unwrap(), before);
}

#[test]
fn invalid_or_late_callback_inputs_rollback_every_numeric_draw_channel() {
    for failure in 0..5 {
        let mut c = client();
        apply(&mut c, &[spawn(8, 2100, 12)]);
        draw(&mut c);
        let before = c.clone();
        let mut calls = 0;
        let result =
            c.prepare_draw_with_antenna::<ClientPresentationError, _>(800, 600, 1., true, |r| {
                calls += 1;
                if calls == 1 {
                    return pairs(r);
                }
                match failure {
                    0 => Err(ClientPresentationError::Limit),
                    1 => Ok(vec![[0.5, 0.5]; r.random_pair_count - 1]),
                    2 => Ok(vec![[f64::NAN, 0.5]; r.random_pair_count]),
                    3 => Ok(vec![[0.5, 1.]; r.random_pair_count]),
                    _ => Ok(vec![[0.5, -0.01]; r.random_pair_count]),
                }
            });
        assert!(result.is_err());
        assert_eq!(
            calls, 2,
            "external callbacks remain consumed after model rollback"
        );
        assert!(
            c == before,
            "failure {failure} must preserve camera, eyes, chains, counters and serial"
        );
        assert_eq!(draw(&mut c), draw(&mut before.clone()));
    }
}

#[test]
fn bounds_use_retained_own_after_camera_even_when_undrawn_follow_off_or_expired() {
    let mut c = AnimatedClient::new(0.).unwrap();
    assert!(c.antenna_bounds().is_none());
    c.prepare_draw_with_antenna::<ClientPresentationError, _>(800, 600, 1., false, |_| {
        panic!("empty")
    })
    .unwrap();
    assert!(c.antenna_bounds().is_none());
    apply(&mut c, &[setup(), spawn(7, 2000, 12)]);
    c.set_follows(false);
    c.set_zoom(0.8).unwrap();
    c.set_camera_position(Point {
        x: -1000.,
        y: 4000.,
    })
    .unwrap();
    c.prepare_draw_with_antenna::<ClientPresentationError, _>(800, 600, 1., false, |_| {
        panic!("culled")
    })
    .unwrap();
    let bounds = c.antenna_bounds().unwrap();
    assert_eq!(
        bounds,
        AntennaCullBounds::from_view(BodyPaintView {
            camera: c.camera().position(),
            zoom: c.camera().zoom(),
            half_width: 400.,
            half_height: 300.,
        })
        .unwrap()
    );
    assert!(bounds.min_x < c.food_bounds().unwrap().limits()[0]);
    apply(&mut c, &[remove(7, false)]);
    c.set_camera_position(Point {
        x: 10_000.,
        y: 5000.,
    })
    .unwrap();
    draw(&mut c);
    assert_ne!(c.antenna_bounds().unwrap(), bounds);
    let retained = c.antenna_bounds();
    c.reset();
    assert_eq!(c.antenna_bounds(), retained);
    draw(&mut c);
    assert_eq!(c.antenna_bounds(), retained, "no own keeps stale bounds");

    let mut dead = client();
    apply(&mut dead, &[remove(7, true)]);
    for i in 1..=12 {
        dead.advance(f64::from(i) * 40., false).unwrap();
    }
    assert!(dead.own_snake().unwrap().metrics().expired);
    dead.set_camera_position(Point { x: 4000., y: 5000. })
        .unwrap();
    assert!(draw(&mut dead).is_empty());
    assert_eq!(
        dead.antenna_bounds().unwrap(),
        AntennaCullBounds::from_view(BodyPaintView {
            camera: dead.camera().position(),
            zoom: dead.camera().zoom(),
            half_width: 400.,
            half_height: 300.,
        })
        .unwrap()
    );
}

#[test]
fn death_reused_ids_and_reset_keep_appearance_lifetimes_independent() {
    let mut c = client();
    let own = c.own_token().unwrap();
    draw(&mut c);
    apply(&mut c, &[remove(7, true), spawn(7, 2100, 12)]);
    let newcomer = c.snake_objects().last().unwrap().0;
    let old = c.antenna_snapshot(own).unwrap();
    let fresh = c.antenna_snapshot(newcomer).unwrap();
    assert!(!fresh.shown);
    c.advance(4., false).unwrap();
    draw(&mut c);
    assert_ne!(
        c.antenna_snapshot(own).unwrap(),
        old,
        "death still advances by draws"
    );
    assert!(c.antenna_snapshot(newcomer).unwrap().shown);
    for i in 1..=12 {
        c.advance(f64::from(i) * 40. + 4., false).unwrap();
    }
    assert!(c.drawn_own_snake().is_none());
    let expired = c.antenna_snapshot(own).unwrap();
    let drawn = draw(&mut c);
    assert_eq!(drawn.len(), 1);
    assert_eq!(drawn[0].token, newcomer);
    assert_eq!(c.antenna_snapshot(own).unwrap(), expired);
    let bounds = c.antenna_bounds();
    let serial = c.draw_serial();
    let mut control = c.clone();
    c.reset();
    assert_eq!(c.antenna_bounds(), bounds);
    assert_eq!(c.draw_serial(), serial);
    assert_eq!(c.retained_count(), 0);
    assert!(c.antenna_snapshot(own).is_none());
    assert!(c.appearance_enabled());
    assert_eq!(
        c.advance(484., false).unwrap().accumulated,
        control.advance(484., false).unwrap().accumulated
    );
    apply(&mut c, &[setup(), spawn(7, 2200, 12)]);
    assert_ne!(c.own_token().unwrap(), own);
    assert_ne!(c.own_token().unwrap(), newcomer);
    let reset = c.antenna_snapshot(c.own_token().unwrap()).unwrap();
    assert!(!reset.shown);
    assert!(
        reset
            .velocity_x
            .iter()
            .chain(&reset.velocity_y)
            .all(|v| v.to_bits() == 0)
    );
}
