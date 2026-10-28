//! Original synthetic packet/event fixtures. No reference arrays, network, or wall clock.

use slither_client::{
    presentation::{
        AnimatedClient, CAMERA_SAMPLES, ClientPresentationError, FacePresentation, HudCommandGuard,
        HudIngressEventKind, HudIngressPlan, INITIAL_ZOOM, MAX_RETAINED_SNAKES,
        MAX_RETAINED_TOTAL_BODY_POINTS, MinimapLayout, ScoreStatus, StandardEyeGeometry,
    },
    protocol::ElapsedHeader,
    state::{Point, StateError},
};

fn u24(value: u32) -> [u8; 3] {
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

fn setup() -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for value in [430_u16, 100, 20] {
        p.extend(value.to_be_bytes());
    }
    p.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(value.to_be_bytes());
    }
    p.extend([19, 42]);
    p
}

fn appearance(id: u16, x: u32, points: usize) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.extend(u24(0));
    p.push(b'0');
    p.extend(u24(0));
    p.extend(4250_u16.to_be_bytes());
    p.extend(u24(0));
    p.push(0);
    p.extend(u24(x * 5));
    p.extend(u24(1000 * 5));
    p.extend([0, 0, 255]);
    if points > 0 {
        p.extend(u24((x - points as u32 * 42) * 5));
        p.extend(u24(1000 * 5));
        for _ in 2..points {
            p.extend([211, 127]);
        }
        if points >= 2 {
            p.extend(0_u16.to_be_bytes());
        }
    }
    p
}

fn anchor(id: Option<u16>, x: u16, y: u16, growth: bool) -> Vec<u8> {
    let mut p = vec![if growth { b'+' } else { b'=' }];
    if let Some(id) = id {
        p.extend(id.to_be_bytes());
    }
    p.extend(0_u16.to_be_bytes());
    p.extend(x.to_be_bytes());
    p.extend(y.to_be_bytes());
    if growth {
        p.extend(u24(8_388_608));
    }
    p
}

fn mass(id: u16, fraction: u32) -> Vec<u8> {
    let mut p = vec![b'h'];
    p.extend(id.to_be_bytes());
    p.extend(u24(fraction));
    p
}

fn tail(id: u16) -> Vec<u8> {
    let mut p = vec![b'r'];
    p.extend(id.to_be_bytes());
    p
}

fn remove(id: u16, flag: u8) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.push(flag);
    p
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for p in commands {
        assert!(p.len() < 8192);
        bytes.extend((p.len() as u16).to_be_bytes());
        bytes.extend(p);
    }
    bytes
}

fn apply(client: &mut AnimatedClient, commands: &[Vec<u8>]) {
    client
        .apply_frame(&bundle(commands), ElapsedHeader::Absent)
        .unwrap();
}

fn client() -> AnimatedClient {
    let mut client = AnimatedClient::new(0.).unwrap();
    apply(&mut client, &[setup(), appearance(7, 2000, 12)]);
    client
}

fn eye_style(travel: f64) -> StandardEyeGeometry {
    StandardEyeGeometry {
        pupil_travel: travel,
        ..StandardEyeGeometry::default()
    }
}

#[test]
fn appearance_resolver_visits_wire_order_including_short_removed_and_reconfigured_objects() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut seen = Vec::new();
    c.apply_frame_with_eye_geometry::<ClientPresentationError, _>(
        &bundle(&[
            setup(),
            appearance(7, 2000, 0),
            appearance(7, 2100, 2),
            remove(7, 0),
            setup(),
            appearance(9, 5000, 1),
            remove(9, 0),
            appearance(9, 6000, 2),
        ]),
        ElapsedHeader::Absent,
        |a| {
            seen.push((a.id, a.absolute_head.x));
            Ok(eye_style(seen.len() as f64 * 0.01))
        },
    )
    .unwrap();
    assert_eq!(seen, [(7, 2000.), (7, 2100.), (9, 5000.), (9, 6000.)]);
    assert_eq!(
        c.own_snake().unwrap().eye_geometry().unwrap(),
        &eye_style(0.01)
    );
    assert_eq!(
        c.snake(9).unwrap().eye_geometry().unwrap(),
        &eye_style(0.04)
    );
    assert_eq!(c.retained_count(), 3);
    assert!(c.drawn_own_snake().is_none());
}

#[test]
fn duplicate_death_and_reused_ids_retain_appearance_styles() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut index = 0;
    c.apply_frame_with_eye_geometry::<ClientPresentationError, _>(
        &bundle(&[
            setup(),
            appearance(7, 2000, 2),
            appearance(7, 2100, 2),
            remove(7, 1),
            appearance(7, 2200, 2),
        ]),
        ElapsedHeader::Absent,
        |_| {
            index += 1;
            Ok(eye_style(f64::from(index) * 0.02))
        },
    )
    .unwrap();
    assert!(!c.own_snake().unwrap().metrics().alive);
    assert_eq!(
        c.own_snake().unwrap().eye_geometry().unwrap(),
        &eye_style(0.02)
    );
    assert_eq!(
        c.snake(7).unwrap().eye_geometry().unwrap(),
        &eye_style(0.06)
    );
    assert_eq!(
        c.drawn_snakes()
            .map(|s| s.eye_geometry().unwrap().pupil_travel)
            .collect::<Vec<_>>(),
        [0.02, 0.04, 0.06]
    );
    c.advance(4., false).unwrap();
    assert_eq!(
        c.drawn_snakes()
            .map(|s| s.eyes().pupil().x)
            .collect::<Vec<_>>(),
        [0.02, 0.04, 0.06]
    );
}

#[test]
fn eye_resolution_errors_rollback_received_model_counters_and_prior_styles() {
    let mut c = client();
    c.advance(4., false).unwrap();
    c.prepare_draw(800, 600).unwrap();
    let before = c.clone();
    let prefix = [appearance(8, 2300, 2), appearance(9, 2400, 2)];
    for invalid_geometry in [false, true] {
        let mut calls = 0;
        let result = c.apply_frame_with_eye_geometry::<ClientPresentationError, _>(
            &bundle(&prefix),
            ElapsedHeader::Absent,
            |_| {
                calls += 1;
                if calls == 2 {
                    if invalid_geometry {
                        return Ok(eye_style(f64::NAN));
                    }
                    return Err(ClientPresentationError::Limit);
                }
                Ok(eye_style(0.02))
            },
        );
        assert!(result.is_err());
        assert_eq!(calls, 2);
        assert_eq!(c, before);
    }
    let received_invalid = bundle(&[appearance(8, 2300, 2), vec![b'r', 0]]);
    let mut framing_invalid = bundle(&prefix);
    framing_invalid.extend([0, 9, b's']);
    for frame in [received_invalid, framing_invalid] {
        let mut calls = 0;
        assert!(
            c.apply_frame_with_eye_geometry::<ClientPresentationError, _>(
                &frame,
                ElapsedHeader::Absent,
                |_| {
                    calls += 1;
                    Ok(eye_style(0.02))
                },
            )
            .is_err()
        );
        assert_eq!(calls, 0);
        assert_eq!(c, before);
    }
}

#[test]
fn default_frame_solver_matches_explicit_style_across_lifecycle_and_draws() {
    let mut legacy = AnimatedClient::new(0.).unwrap();
    let mut explicit = legacy.clone();
    for (now, commands) in [
        (4., vec![setup(), appearance(7, 2000, 3)]),
        (
            12.,
            vec![anchor(None, 2008, 1004, true), appearance(7, 2200, 2)],
        ),
        (52., vec![remove(7, 1), appearance(7, 2300, 2)]),
    ] {
        let frame = bundle(&commands);
        let report = legacy.apply_frame(&frame, ElapsedHeader::Absent).unwrap();
        assert_eq!(
            report,
            explicit
                .apply_frame_with_eye_geometry::<ClientPresentationError, _>(
                    &frame,
                    ElapsedHeader::Absent,
                    |_| Ok(StandardEyeGeometry::default()),
                )
                .unwrap()
        );
        for c in [&mut legacy, &mut explicit] {
            c.advance(now, false).unwrap();
            c.prepare_draw(800, 600).unwrap();
        }
        assert_eq!(legacy, explicit);
    }
}

#[test]
fn synthetic_initial_camera_and_received_absolute_geometry_are_separate() {
    let c = client();
    let own = c.own_snake().unwrap();
    assert_eq!(own.metrics().raw_head, Point { x: 2000., y: 1000. });
    assert_eq!(c.camera().position(), own.body().points()[0].position());
    assert_eq!(c.camera().position().x, 1958.);
    assert_eq!(c.camera().zoom(), INITIAL_ZOOM);
    assert_eq!(c.received().snakes[&7].head.x, 1000.);
    assert!(std::ptr::eq(own, c.snake(7).unwrap()));
    assert_eq!(c.retained_count(), 1);
    assert_eq!(c.retained_body_points(), 12);
    assert!(!own.metrics().visible);
}

#[test]
fn malformed_late_tail_discards_head_body_mass_food_cache_and_counters() {
    let mut c = client();
    c.prepare_draw(800, 600).unwrap();
    let before = c.clone();
    let frame = bundle(&[
        vec![b'e', 0, 7, 20],
        anchor(Some(7), 2001, 1003, true),
        mass(7, 12_582_911),
        vec![b'f', 1, 2, 30, 40, 4, 50],
        vec![b'r', 0],
    ]);
    assert!(matches!(
        c.apply_frame(&frame, ElapsedHeader::Absent),
        Err(ClientPresentationError::State(StateError::InvalidPacket(
            b'r'
        )))
    ));
    assert_eq!(c, before);
    assert!(matches!(
        c.apply_frame(&[b'f', 10, 20, 30], ElapsedHeader::Absent),
        Err(ClientPresentationError::State(StateError::MissingSector))
    ));
    assert_eq!(c, before);
}

#[test]
fn late_presentation_failure_rolls_back_prior_events_midframe_setup_and_clock() {
    let mut c = client();
    c.advance(3., false).unwrap();
    c.prepare_draw(300, 200).unwrap();
    c.set_follows(false);
    let before = c.clone();
    let mut bad_setup = setup();
    bad_setup[10] = 0; // Valid received setup; presentation turn-speed division fails.
    let frame = bundle(&[
        anchor(Some(7), 2000, 1000, true),
        mass(7, 1),
        appearance(8, 2800, 2),
        bad_setup,
        appearance(9, 3000, 4),
    ]);
    assert!(matches!(
        c.apply_frame(&frame, ElapsedHeader::Absent),
        Err(ClientPresentationError::Presentation(_))
    ));
    assert_eq!(c, before);
    let mut control = before;
    let mut callbacks = 0;
    assert!(matches!(
        c.apply_frame_with_eye_geometry::<ClientPresentationError, _>(
            &frame,
            ElapsedHeader::Absent,
            |_| {
                callbacks += 1;
                Ok(eye_style(0.02))
            },
        ),
        Err(ClientPresentationError::Presentation(_))
    ));
    assert_eq!(
        callbacks, 1,
        "received validation can precede a later numeric failure"
    );
    assert_eq!(c, control);
    assert_eq!(c.advance(8., false), control.advance(8., false));
    assert_eq!(c, control);
}

#[test]
fn late_camera_failure_discards_received_and_entity_changes() {
    let mut c = client();
    c.set_follows(false);
    c.set_camera_position(Point { x: f64::MAX, y: 0. }).unwrap();
    let before = c.clone();
    let frame = bundle(&[
        mass(7, 1),
        anchor(Some(7), 2000, 1000, false),
        anchor(Some(7), 2042, 1000, true),
    ]);
    assert!(matches!(
        c.apply_frame(&frame, ElapsedHeader::Absent),
        Err(ClientPresentationError::Presentation(_))
    ));
    assert_eq!(c, before);
}

#[test]
fn ordered_duplicate_appearance_keeps_old_object_and_newest_packet_lookup() {
    let mut c = client();
    apply(
        &mut c,
        &[
            mass(7, 1),
            appearance(8, 3000, 4),
            appearance(7, 4000, 5),
            mass(7, 8_388_608),
        ],
    );
    let drawn = c.drawn_snakes().map(|s| s.metrics()).collect::<Vec<_>>();
    assert_eq!(drawn.iter().map(|m| m.id).collect::<Vec<_>>(), [7, 8, 7]);
    assert_eq!(
        drawn.iter().map(|m| m.raw_head.x).collect::<Vec<_>>(),
        [2000., 3000., 4000.]
    );
    assert_eq!(c.own_snake().unwrap().metrics().fam, 1. / 16_777_215.);
    assert_eq!(c.snake(7).unwrap().metrics().fam, 8_388_608. / 16_777_215.);
    assert_ne!(c.own_snake(), c.snake(7));

    apply(&mut c, &[remove(7, 1)]);
    assert!(c.snake(7).is_none());
    assert!(!c.own_snake().unwrap().metrics().alive);
    let newest = c.drawn_snakes().last().unwrap().metrics();
    assert!(newest.alive);
    assert_eq!(newest.raw_head.x, 4000.);
    let before = c.drawn_snakes().last().unwrap().clone();
    apply(&mut c, &[mass(7, 1), anchor(Some(7), 4100, 1000, false)]);
    assert_eq!(c.drawn_snakes().last().unwrap(), &before);
}

#[test]
fn retained_own_survives_death_expiry_id_reuse_and_compact_updates() {
    let mut c = client();
    apply(
        &mut c,
        &[
            remove(7, 1),
            appearance(7, 4000, 5),
            appearance(8, 3000, 3),
            remove(8, 1),
        ],
    );
    for i in 1..=12 {
        c.advance(f64::from(i) * 40., false).unwrap();
    }
    assert_eq!(c.drawn_snakes().count(), 1);
    assert_eq!(c.retained_count(), 2);
    assert!(c.own_snake().unwrap().metrics().expired);
    let own = c.own_snake().unwrap().clone();
    let newest = c.snake(7).unwrap().clone();
    c.advance(520., false).unwrap();
    assert_eq!(c.own_snake().unwrap(), &own);
    apply(&mut c, &[anchor(None, 2050, 1010, true), vec![b'e', 64]]);
    assert_eq!(
        c.own_snake().unwrap().metrics().raw_head,
        Point { x: 2050., y: 1010. }
    );
    assert_eq!(c.own_snake().unwrap().metrics().logical_segments, 13);
    assert_ne!(
        c.own_snake().unwrap().metrics().heading,
        own.metrics().heading
    );
    // The reused ID's object advances normally, then compact packets leave it alone.
    assert_ne!(c.snake(7).unwrap(), &newest);
    let latest = c.snake(7).unwrap().clone();
    apply(&mut c, &[anchor(None, 2092, 1010, false)]);
    assert_eq!(c.snake(7).unwrap(), &latest);
}

#[test]
fn immediate_removal_flags_keep_own_undrawn_and_drop_other_objects() {
    let mut c = client();
    apply(
        &mut c,
        &[appearance(8, 3000, 3), remove(7, 2), remove(8, 0)],
    );
    assert_eq!(c.drawn_snakes().count(), 0);
    assert_eq!(c.retained_count(), 1);
    assert!(c.snake(7).is_none());
    let own = c.own_snake().unwrap().clone();
    assert!(own.metrics().alive); // Only exactly flag one starts death.
    c.advance(40., false).unwrap();
    assert_eq!(c.own_snake().unwrap(), &own);
    apply(&mut c, &[anchor(None, 2000, 1000, false)]);
    assert_ne!(c.own_snake().unwrap(), &own);
    assert_eq!(c.drawn_snakes().count(), 0);
}

#[test]
fn cached_direction_compact_anchors_keep_addressing_undrawn_original_own() {
    let mut c = client();
    apply(&mut c, &[remove(7, 0), appearance(7, 4000, 4)]);
    let original_front = c.own_snake().unwrap().body().points()[0].position();
    let newest = c.snake(7).unwrap().clone();
    let mut grow = vec![b'N'];
    grow.extend(u24(1));
    apply(&mut c, &[vec![b'G'], grow]);
    let own = c.own_snake().unwrap();
    assert_eq!(own.metrics().logical_segments, 13);
    assert_eq!(
        own.body().points()[0].position(),
        Point {
            x: original_front.x + 84.,
            y: original_front.y,
        }
    );
    assert_eq!(own.metrics().fam, 1. / 16_777_215.);
    assert_eq!(c.snake(7).unwrap(), &newest);
    assert_eq!(c.drawn_snakes().count(), 1);
}

#[test]
fn follow_preference_survives_first_setup_reset_and_repeated_setup() {
    for follows in [false, true] {
        for reset in [false, true] {
            let mut c = AnimatedClient::new(0.).unwrap();
            c.set_follows(follows);
            if reset {
                apply(&mut c, &[setup(), appearance(7, 2000, 12)]);
                c.reset();
                assert_eq!(c.camera().follows(), follows);
            }
            apply(
                &mut c,
                &[setup(), appearance(7, 4000, 12), appearance(8, 4445, 1)],
            );
            assert_eq!(c.camera().follows(), follows);
            c.prepare_draw(800, 600).unwrap();
            assert_eq!(
                c.camera().position(),
                Point {
                    x: if follows { 4000. } else { 3958. },
                    y: 1000.,
                }
            );
            assert_eq!(c.snake(8).unwrap().metrics().visible, follows);
            let camera = c.camera().clone();
            apply(&mut c, &[setup()]);
            assert_eq!(c.camera(), &camera);
        }
    }
}

#[test]
fn repeated_setup_preserves_existing_world_camera_and_animation_phase() {
    let mut c = client();
    apply(&mut c, &[vec![b'f', 1, 2, 30, 40, 4, 50]]);
    c.set_follows(false);
    c.advance(3., false).unwrap();
    c.prepare_draw(800, 600).unwrap();
    let own = c.own_snake().unwrap().clone();
    let camera = c.camera().clone();
    let foods = c.received().foods.clone();
    let received_own = c.received().own_snake_id;

    apply(&mut c, &[setup()]);

    assert_eq!(c.retained_count(), 1);
    assert_eq!(c.own_snake().unwrap(), &own);
    assert_eq!(c.camera(), &camera);
    assert_eq!(c.received().own_snake_id, received_own);
    assert_eq!(c.received().foods, foods);
    assert!(c.connected());
    let step = c.advance(8., false).unwrap();
    assert_eq!(step.delta, 5. / 8.);
    assert_eq!(step.accumulated, 1.);
    assert_eq!(step.whole_steps, 1);
}

#[test]
fn repeated_setup_refreshes_globals_but_retains_appearance_segment_length_and_maximum_speed() {
    let mut c = client();
    let metrics = c.own_snake().unwrap().metrics();
    let mut configuration = setup();
    configuration[10] = 96;
    configuration[11..13].copy_from_slice(&1000_u16.to_be_bytes());
    configuration[13..15].copy_from_slice(&0_u16.to_be_bytes());
    configuration[15..17].copy_from_slice(&2000_u16.to_be_bytes());
    configuration[17..19].copy_from_slice(&100_u16.to_be_bytes());
    configuration[21..23].copy_from_slice(&800_u16.to_be_bytes());
    configuration[24] = 84;
    apply(&mut c, &[configuration, appearance(8, 3000, 12)]);
    assert_eq!(c.own_snake().unwrap().metrics(), metrics);
    assert_eq!(c.own_snake().unwrap().body().segment_length(), 42.);
    assert_eq!(c.own_snake().unwrap().body().contraction(), 0.8);
    assert_eq!(c.snake(8).unwrap().body().segment_length(), 84.);
    assert_eq!(c.snake(8).unwrap().metrics().maximum_speed, 20.);
    assert_eq!(c.own_snake().unwrap().metrics().maximum_speed, 14.);

    let received_x = c.received().snakes[&7].body[0].x;
    apply(&mut c, &[vec![b'G']]);
    assert_eq!(c.received().snakes[&7].head.x, received_x + 42.);
    assert_eq!(c.own_snake().unwrap().metrics().raw_head.x, 2000.);
    assert_eq!(
        c.own_snake().unwrap().body().points()[3].position().x,
        1882.4
    );
    assert_eq!(c.own_snake().unwrap().metrics().cruise_speed, 10.);
    apply(&mut c, &[vec![b'3', 18]]);
    assert_eq!(c.own_snake().unwrap().metrics().speed_turn_factor, 1. / 9.6);
}

#[test]
fn setup_rebases_received_projection_without_moving_retained_absolute_geometry() {
    let mut c = client();
    apply(&mut c, &[vec![b'f', 1, 2, 30, 40, 4, 50]]);
    let own = c.own_snake().unwrap().clone();
    let received_head = c.received().snakes[&7].head;
    let food = c.received().foods.values().next().unwrap().position;
    let mut configuration = setup();
    configuration[1..4].copy_from_slice(&u24(2000));
    apply(&mut c, &[configuration]);
    assert_eq!(c.own_snake(), Some(&own));
    assert_eq!(
        c.received().snakes[&7].head,
        Point {
            x: received_head.x - 1000.,
            y: received_head.y - 1000.
        }
    );
    assert_eq!(
        c.received().foods.values().next().unwrap().position,
        Point {
            x: food.x - 1000.,
            y: food.y - 1000.
        }
    );
}

#[test]
fn setup_preserves_identity_camera_and_fractional_update_timeline() {
    let mut c = client();
    assert_eq!(c.advance(3., false).unwrap().whole_steps, 0);
    c.set_follows(false);
    c.set_zoom(0.5).unwrap();
    apply(
        &mut c,
        &[
            appearance(8, 3000, 3),
            setup(),
            appearance(9, 4000, 4),
            mass(9, 1),
        ],
    );
    assert_eq!(c.retained_count(), 3);
    assert_eq!(c.own_snake().unwrap().metrics().id, 7);
    assert_eq!(c.camera().zoom(), 0.5);
    assert!(!c.camera().follows());
    assert!(c.snake(7).is_some());
    let step = c.advance(8., false).unwrap();
    assert_eq!(step.delta, 5. / 8.);
    assert_eq!(step.accumulated, 1.);
    assert_eq!(step.whole_steps, 1);
    c.reset();
    assert!(c.own_snake().is_none());
    assert!(c.received().setup.is_none());
    assert_eq!(c.advance(8., false).unwrap().accumulated, 1.);
}

#[test]
fn reset_clears_camera_corrections_without_changing_the_ring_phase() {
    for draws in [1, CAMERA_SAMPLES - 1, CAMERA_SAMPLES] {
        let mut c = client();
        c.set_follows(false);
        apply(&mut c, &[anchor(Some(7), 2010, 1000, false)]);
        for _ in 0..draws {
            c.prepare_draw(800, 600).unwrap();
        }
        let cursor = c.camera().corrections().index();
        let position = c.camera().position();
        let weights = *c.camera().corrections().weights();
        assert_eq!(cursor, draws % CAMERA_SAMPLES);
        c.reset();
        assert_eq!(c.camera().corrections().index(), cursor);
        assert_eq!(c.camera().corrections().pending(), 0);
        assert_eq!(c.camera().corrections().offset(), Point::default());
        assert!(
            c.camera()
                .corrections()
                .samples()
                .iter()
                .flatten()
                .all(|v| v.to_bits() == 0)
        );
        assert_eq!(c.camera().corrections().weights(), &weights);
        assert_eq!(c.camera().position(), position);
        assert!(!c.camera().follows());
        assert_eq!(c.camera().zoom(), INITIAL_ZOOM);
        c.reset();
        c.prepare_draw(800, 600).unwrap();
        assert_eq!(
            c.camera().corrections().index(),
            cursor,
            "reset and pre-own draws consume no sample"
        );
        apply(&mut c, &[setup(), appearance(7, 2000, 12)]);
        apply(&mut c, &[anchor(Some(7), 2010, 1000, false)]);
        assert_eq!(c.camera().corrections().index(), cursor);
        c.prepare_draw(800, 600).unwrap();
        assert_eq!(
            c.camera().corrections().index(),
            (cursor + 1) % CAMERA_SAMPLES
        );
        assert_eq!(c.camera().corrections().pending(), CAMERA_SAMPLES - 1);
    }
}

#[test]
fn empty_body_appearance_uses_head_for_camera_and_is_not_visible() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup()]);
    c.set_follows(false);
    c.set_zoom(1.).unwrap();
    apply(&mut c, &[appearance(0, 2000, 0)]);
    assert!(!c.camera().follows());
    assert_eq!(c.camera().position(), Point { x: 2000., y: 1000. });
    c.prepare_draw(800, 600).unwrap();
    assert!(!c.own_snake().unwrap().metrics().visible);
    assert_eq!(c.retained_body_points(), 0);
}

#[test]
fn header_time_does_not_extrapolate_and_camera_reanchors_only_for_own() {
    let mut c = client();
    apply(&mut c, &[appearance(8, 3000, 3)]);
    let before = c.camera().clone();
    apply(&mut c, &[anchor(Some(8), 3010, 1010, false)]);
    assert_eq!(c.camera(), &before);
    let mut frame = vec![0xff, 0xff];
    frame.extend(anchor(Some(7), 2000, 1000, false));
    c.apply_frame(&frame, ElapsedHeader::TwoBytes).unwrap();
    assert_eq!(c.received().last_elapsed_ms, Some(65535));
    assert_eq!(c.own_snake().unwrap().head().head_fraction, 0.);
    assert_eq!(c.camera().corrections().pending(), 62);
    assert_eq!(
        c.camera().position(),
        c.own_snake().unwrap().metrics().corrected_head
    );
}

#[test]
fn draw_and_update_clocks_are_independent_and_follow_off_still_drains_camera() {
    let mut c = client();
    c.prepare_draw(800, 600).unwrap();
    apply(&mut c, &[anchor(Some(7), 2000, 1000, false)]);
    let pending = c.camera().corrections().pending();
    let index = c.camera().corrections().index();
    c.advance(0., false).unwrap();
    c.advance(8., false).unwrap();
    assert_eq!(c.camera().corrections().pending(), pending);
    c.set_follows(false);
    c.set_camera_position(Point { x: 1700., y: 900. }).unwrap();
    c.set_zoom(0.5).unwrap();
    let head = *c.own_snake().unwrap().head();
    c.prepare_draw(800, 600).unwrap();
    assert_eq!(c.camera().position(), Point { x: 1700., y: 900. });
    assert_eq!(c.camera().corrections().pending(), pending - 1);
    assert_eq!(c.camera().corrections().index(), (index + 1) % 62);
    assert_eq!(c.camera().zoom(), 0.5002);
    assert_eq!(c.own_snake().unwrap().head(), &head);
    assert_eq!(c.advance(8., false).unwrap().delta, 0.);

    apply(&mut c, &[remove(7, 0)]);
    let pending = c.camera().corrections().pending();
    c.prepare_draw(800, 600).unwrap();
    assert_eq!(c.camera().corrections().pending(), pending - 1);
}

#[test]
fn culling_is_inclusive_84_margin_uses_body_not_head_and_only_visible_spacing_eases() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(
        &mut c,
        &[setup(), appearance(7, 1000, 0), appearance(8, 2000, 2)],
    );
    c.set_follows(false);
    c.set_zoom(1.).unwrap();
    let point = c.snake(8).unwrap().body().points()[0].position();
    // Account for the draw's single automatic zoom step before testing the boundary.
    let right_half = 100. / 2. / 1.0002 + 84.;
    c.set_camera_position(Point {
        x: point.x - right_half,
        y: point.y,
    })
    .unwrap();
    c.prepare_draw(100, 100).unwrap();
    assert!(c.snake(8).unwrap().metrics().visible);
    assert!(!c.own_snake().unwrap().metrics().visible);
    c.set_camera_position(Point { x: 0., y: 0. }).unwrap();
    c.prepare_draw(100, 100).unwrap();
    assert!(!c.snake(8).unwrap().metrics().visible);
    let before = c.snake(8).unwrap().metrics().point_spacing;
    c.set_zoom(0.5).unwrap();
    apply(&mut c, &[anchor(Some(8), 2000, 1000, true)]);
    c.prepare_draw(100, 100).unwrap();
    assert_eq!(c.snake(8).unwrap().metrics().point_spacing, before);
    c.set_camera_position(Point { x: 2000., y: 1000. }).unwrap();
    c.prepare_draw(100, 100).unwrap();
    assert!(c.snake(8).unwrap().metrics().visible);
    assert_eq!(c.snake(8).unwrap().metrics().point_spacing, before + 0.0035);
}

#[test]
fn culling_uses_displayed_body_offsets_after_visible_anchor() {
    let mut c = client();
    c.prepare_draw(100, 100).unwrap();
    apply(&mut c, &[anchor(Some(7), 2100, 1200, false)]);
    let newest = &c.own_snake().unwrap().body().points()[0];
    assert_ne!(newest.position_offset(), Point::default());
    let displayed = Point {
        x: newest.position().x + newest.position_offset().x,
        y: newest.position().y + newest.position_offset().y,
    };
    c.set_follows(false);
    c.set_zoom(1000.).unwrap();
    c.set_camera_position(Point {
        x: displayed.x + 84.,
        y: displayed.y,
    })
    .unwrap();
    c.prepare_draw(1, 1).unwrap();
    assert!(c.own_snake().unwrap().metrics().visible);
    let raw = c.own_snake().unwrap().body().points()[0].position();
    assert!(raw.x < c.camera().position().x - 84. - 0.5 / c.camera().zoom());
    assert!(c.own_snake().unwrap().body().points().iter().all(|point| {
        point.position().x < c.camera().position().x - 84. - 0.5 / c.camera().zoom()
    }));
}

#[test]
fn food_and_unknown_events_commit_received_state_without_advancing_presentation() {
    let mut c = client();
    let own = c.own_snake().unwrap().clone();
    let camera = c.camera().clone();
    apply(
        &mut c,
        &[
            vec![b'f', 1, 2, 30, 40, 4, 50],
            vec![b'f', 50, 60, 40],
            vec![b'W', 4, 5],
            mass(999, 1),
            tail(999),
        ],
    );
    assert_eq!(c.received().foods.len(), 2);
    assert_eq!(c.received().ignored_commands, 1);
    assert_eq!(c.own_snake().unwrap(), &own);
    assert_eq!(c.camera(), &camera);
}

#[test]
fn view_and_clock_errors_are_atomic() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(AnimatedClient::new(bad).is_err());
    }
    let mut c = client();
    let before = c.clone();
    assert!(c.set_zoom(0.).is_err());
    assert!(c.set_zoom(f64::INFINITY).is_err());
    assert!(c.set_camera_position(Point { x: f64::NAN, y: 0. }).is_err());
    assert!(c.prepare_draw(0, 200).is_err());
    assert!(c.advance(f64::NAN, false).is_err());
    assert_eq!(c, before);
    let mut empty = AnimatedClient::new(0.).unwrap();
    empty.set_zoom(f64::from_bits(1)).unwrap();
    let before = empty.clone();
    assert!(empty.prepare_draw(800, 600).is_err());
    assert_eq!(empty, before);
}

#[test]
fn retained_object_limit_includes_duplicates_and_rejects_whole_frame() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut commands = vec![setup()];
    commands.extend((0..MAX_RETAINED_SNAKES).map(|_| appearance(7, 2000, 2)));
    apply(&mut c, &commands);
    assert_eq!(c.received().snakes.len(), 1);
    assert_eq!(c.retained_count(), 512);
    let before = c.clone();
    assert_eq!(
        c.apply_frame(
            &bundle(&[mass(7, 1), appearance(7, 2100, 2)]),
            ElapsedHeader::Absent
        ),
        Err(ClientPresentationError::Limit)
    );
    assert_eq!(c, before);
}

#[test]
fn retained_physical_point_limit_is_aggregate_and_rolls_back_prior_events() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let points = 2048;
    let appearances = MAX_RETAINED_TOTAL_BODY_POINTS / points;
    let mut commands = vec![setup()];
    commands.extend((0..appearances).map(|_| appearance(7, 100_000, points)));
    apply(&mut c, &commands);
    assert_eq!(c.retained_body_points(), 131_072);
    assert_eq!(c.received().snakes[&7].body.len(), points);
    let before = c.clone();
    assert_eq!(
        c.apply_frame(
            &bundle(&[mass(7, 1), anchor(Some(7), 65535, 1000, false)]),
            ElapsedHeader::Absent
        ),
        Err(ClientPresentationError::Limit)
    );
    assert_eq!(c, before);
}

#[test]
fn team_mode_rejection_is_atomic_before_and_after_an_existing_world() {
    let mut team = setup();
    team.extend(1_u16.to_be_bytes());
    team.extend(u24(900));
    team.extend([2, 0]);
    let mut empty = AnimatedClient::new(0.).unwrap();
    let before = empty.clone();
    assert_eq!(
        empty.apply_frame(&team, ElapsedHeader::Absent),
        Err(ClientPresentationError::UnsupportedMode(2))
    );
    assert_eq!(empty, before);
    let mut existing = client();
    existing.advance(13., false).unwrap();
    existing.prepare_draw(800, 600).unwrap();
    let before = existing.clone();
    assert_eq!(
        existing.apply_frame(
            &bundle(&[mass(7, 8_388_608), anchor(None, 2020, 1002, false), team]),
            ElapsedHeader::Absent
        ),
        Err(ClientPresentationError::UnsupportedMode(2))
    );
    assert_eq!(existing, before);
}

#[test]
fn repeated_removals_reach_each_surviving_duplicate_even_without_received_lookup() {
    for bundled in [false, true] {
        let mut c = client();
        apply(&mut c, &[appearance(7, 4000, 5)]);
        assert_eq!(c.drawn_snakes().count(), 2);
        if bundled {
            apply(&mut c, &[remove(7, 0), remove(7, 0)]);
        } else {
            apply(&mut c, &[remove(7, 0)]);
            assert_eq!(c.drawn_snakes().count(), 1);
            assert!(c.received().snakes.is_empty());
            apply(&mut c, &[remove(7, 0)]);
        }
        assert_eq!(c.drawn_snakes().count(), 0);
        assert!(
            c.own_snake().is_some(),
            "own object remains addressable compactly"
        );
    }
}

#[test]
fn input_own_lifecycle_cannot_be_revived_by_wire_id_reuse() {
    for flag in [0, 1] {
        for bundled in [false, true] {
            let mut c = client();
            assert!(c.active_own_snake().is_some());
            if bundled {
                apply(&mut c, &[remove(7, flag), appearance(7, 4000, 5)]);
            } else {
                apply(&mut c, &[remove(7, flag)]);
                assert!(c.active_own_snake().is_none());
                apply(&mut c, &[appearance(7, 4000, 5)]);
            }
            assert!(c.snake(7).unwrap().metrics().alive);
            assert!(c.active_own_snake().is_none());
            assert_eq!(c.drawn_own_snake().is_some(), flag == 1);
            assert!(c.own_snake().is_some());
        }
    }
}

// The minimap packets and name/world schedules below are authored synthetic inputs.
fn minimap_pixel(plane: &[u8], index: usize) -> [u8; 4] {
    plane[4 * index..4 * index + 4].try_into().unwrap()
}

#[test]
fn successful_minimap_updates_preserve_existing_names_geometry_and_world_cadence() {
    let mut legacy = AnimatedClient::new(0.).unwrap();
    let mut tracked = AnimatedClient::new(0.).unwrap();
    legacy.enable_nicknames().unwrap();
    tracked.enable_nicknames().unwrap();
    tracked.enable_minimap_tracking().unwrap();
    let mut named = appearance(7, 2000, 12);
    named.splice(22..23, [9].into_iter().chain(b"Synthetic".iter().copied()));
    let frame = bundle(&[
        setup(),
        named,
        vec![b'M', 0, 3, 64],
        anchor(None, 2020, 1000, false),
        vec![b'V', 64],
    ]);
    let ordinary_report = legacy.apply_frame(&frame, ElapsedHeader::Absent).unwrap();
    let tracked_report = tracked.apply_frame(&frame, ElapsedHeader::Absent).unwrap();
    assert_eq!((ordinary_report.ignored, tracked_report.ignored), (2, 0));
    for now in [8., 151., 159.] {
        assert_eq!(
            legacy.advance(now, false).unwrap(),
            tracked.advance(now, false).unwrap()
        );
        legacy.prepare_draw(800, 600).unwrap();
        tracked.prepare_draw(800, 600).unwrap();
        assert_eq!(tracked.own_snake(), legacy.own_snake());
        assert_eq!(tracked.received().snakes, legacy.received().snakes);
        assert_eq!(tracked.nickname_draws(), legacy.nickname_draws());
        assert_eq!(tracked.camera(), legacy.camera());
        assert_eq!(tracked.boundary(), legacy.boundary());
        assert_eq!(tracked.background(), legacy.background());
        assert_eq!(tracked.draw_serial(), legacy.draw_serial());
    }
}

#[test]
fn disabled_minimap_and_public_received_wrappers_remain_opaque() {
    let malformed_map = *b"M";
    let mut client = AnimatedClient::new(0.).unwrap();
    let report = client
        .apply_frame(&malformed_map, ElapsedHeader::Absent)
        .unwrap();
    assert_eq!((report.commands, report.ignored), (1, 1));
    assert!(!client.minimap_tracking_enabled());
    assert_eq!(client.minimap_view().dimension, None);
    assert_eq!(
        client.enable_minimap_tracking(),
        Err(ClientPresentationError::MinimapModeRequiresReset)
    );
    let mut received = slither_client::state::ClientState::default();
    assert_eq!(
        received
            .apply_frame(&malformed_map, ElapsedHeader::Absent)
            .unwrap()
            .ignored,
        1
    );
    assert_eq!(
        received
            .apply_frame_with_events(&malformed_map, ElapsedHeader::Absent)
            .unwrap()
            .report
            .ignored,
        1
    );
    client.reset();
    client.enable_minimap_tracking().unwrap();
    client.enable_minimap_tracking().unwrap();
    assert!(client.minimap_tracking_enabled());
}

#[test]
fn map_only_admission_supports_all_families_without_enabling_score_r() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_minimap_tracking().unwrap();
    let report = client
        .apply_frame(
            &bundle(&[
                setup(),
                vec![b'M', 0, 2, 64],
                vec![b'V', 64],
                vec![b'U', 0, 2, 32],
                vec![b'L', 2, 0, 1, 64, 64],
                vec![b'u', 64],
                vec![b'R'],
                vec![b'R', 3],
            ]),
            ElapsedHeader::Absent,
        )
        .unwrap();
    assert_eq!((report.commands, report.ignored), (8, 2));
    assert_eq!(client.received().ignored_commands, 2);
    assert_eq!(client.score_view().status, ScoreStatus::Disabled);
    assert_eq!(client.minimap_view().dimension, Some(80));
    assert_eq!(minimap_pixel(client.minimap_view().base_rgba, 0), [255; 4]);
    assert!(client.minimap_view().alternate_rgba.iter().all(|&v| v == 0));
    assert!(client.minimap_view().toggles.iter().all(|&v| v == 0));
}

#[test]
fn mixed_setup_map_world_events_and_setup_hooks_keep_wire_positions() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_minimap_tracking().unwrap();
    let mut shifted_setup = setup();
    shifted_setup[1..4].copy_from_slice(&u24(1200));
    let mut observations = Vec::new();
    let report = client
        .apply_frame_with_face_presentation_and_factories_and_setup(
            &bundle(&[
                setup(),
                vec![b'M', 0, 3, 64],
                appearance(7, 2000, 12),
                shifted_setup,
                vec![b'V', 64],
                anchor(None, 2020, 1000, false),
            ]),
            ElapsedHeader::Absent,
            |_| Ok(FacePresentation::default()),
            |_, _| panic!("no synthetic food"),
            |stage, setup| {
                let view = stage.minimap_view();
                observations.push((
                    view.dimension,
                    view.image_revision,
                    view.base_rgba.iter().all(|&v| v == 0),
                    view.alternate_rgba.iter().all(|&v| v == 0),
                    stage.own_snake().map(|snake| snake.metrics().raw_head.x),
                    setup.grid_center,
                ));
                Ok::<_, ClientPresentationError>(())
            },
        )
        .unwrap();
    assert_eq!(report.ignored, 0);
    assert_eq!(
        observations,
        [
            (Some(24), 1, true, true, None, 1000.),
            (Some(24), 3, true, true, Some(2000.), 1200.)
        ]
    );
    assert_eq!(client.minimap_view().dimension, Some(24));
    assert_eq!(client.minimap_view().toggles[575], 1);
    assert_eq!(client.own_snake().unwrap().metrics().raw_head.x, 2020.);
    assert_eq!(client.received().snakes[&7].head.x, 820.);
    assert_eq!(client.score_view().status, ScoreStatus::Disabled);
    assert_eq!(client.minimap_view().fade, 0.);
    assert_eq!(client.minimap_view().last_marker_ms, 0.);
}

#[test]
fn marker_uses_shared_timestamp_eased_radius_and_pre_prediction_raw_head() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_minimap_tracking().unwrap();
    apply(
        &mut client,
        &[setup(), appearance(7, 2000, 12), vec![b'M', 0, 2, 64]],
    );
    let mut radius = vec![b'z'];
    radius.extend(u24(500));
    apply(&mut client, &[radius]);
    let revision = client.minimap_view().image_revision;
    let raw = client.own_snake().unwrap().metrics().raw_head;
    let mut expected_boundary = client.boundary().unwrap().clone();
    expected_boundary.advance(5, true);
    let displayed = expected_boundary.displayed();
    let step = client.advance(151., false).unwrap();
    let view = client.minimap_view();
    let project = |head: f64| (10_f64 * (1. + 12. + (head - 1000.) / displayed - 7.)).round() / 10.;
    assert_eq!(step.whole_steps, 5);
    assert_eq!(
        client.boundary().unwrap().displayed().to_bits(),
        displayed.to_bits()
    );
    assert_ne!(displayed, 500.);
    assert_eq!(view.marker.x.to_bits(), project(raw.x).to_bits());
    assert_eq!(view.marker.y.to_bits(), project(raw.y).to_bits());
    assert_eq!(view.last_marker_ms, 151.);
    assert_eq!(view.image_revision, revision);
    assert_ne!(client.own_snake().unwrap().metrics().raw_head.x, raw.x);
    assert_eq!(view.transition, step.delta / 230.);
    client.observe_minimap_ui_fraction(0.5).unwrap();
    assert_eq!(
        client.minimap_view().holder_opacity,
        0.5 * client.minimap_view().fade
    );
    assert_eq!(client.minimap_view().image_revision, revision);
}

#[test]
fn marker_retains_original_own_through_removal_death_expiry_and_id_reuse() {
    for flag in [0, 1] {
        let mut client = AnimatedClient::new(0.).unwrap();
        client.enable_minimap_tracking().unwrap();
        apply(
            &mut client,
            &[setup(), appearance(7, 2000, 12), vec![b'M', 0, 2, 64]],
        );
        let own = client.own_token().unwrap();
        apply(&mut client, &[remove(7, flag), appearance(7, 4000, 12)]);
        let retained_head = client.own_snake().unwrap().metrics().raw_head;
        client.set_connected(false);
        let revision = client.minimap_view().image_revision;
        for index in 1..=25 {
            client.advance(f64::from(index) * 160., false).unwrap();
        }
        let view = client.minimap_view();
        let expected = (10_f64 * (1. + 12. + (retained_head.x - 1000.) / 980. - 7.)).round() / 10.;
        assert_eq!(client.own_token(), Some(own));
        assert!(client.active_own_snake().is_none());
        assert!(client.drawn_own_snake().is_none());
        assert_eq!(view.marker.x.to_bits(), expected.to_bits());
        assert_eq!(view.last_marker_ms, 4000.);
        assert_eq!(view.fade, 0.);
        assert_eq!(view.image_revision, revision);
        assert!(client.snake(7).unwrap().metrics().raw_head.x > 4000.);
    }
}

#[test]
fn normal_reset_preserves_selection_timeline_and_marker_but_requires_setup() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_minimap_tracking().unwrap();
    apply(
        &mut client,
        &[setup(), appearance(7, 2000, 12), vec![b'M', 0, 2, 64]],
    );
    client.advance(200., false).unwrap();
    let marker = client.minimap_view().marker;
    let revision = client.minimap_view().image_revision;
    client.reset();
    assert!(client.minimap_tracking_enabled());
    assert_eq!(client.minimap_view().image_revision, revision + 1);
    assert_eq!(client.minimap_view().marker, marker);
    assert_eq!(client.minimap_view().last_marker_ms, 200.);
    assert_eq!(client.minimap_view().fade, 0.);
    assert_eq!(client.minimap_view().toggles, [0, 0, 0, 1]);
    assert!(client.minimap_view().base_rgba.iter().all(|&v| v == 0));
    let before = client.clone();
    assert_eq!(
        client.apply_frame(&[b'V', 64], ElapsedHeader::Absent),
        Err(ClientPresentationError::State(StateError::MissingSetup))
    );
    assert_eq!(client, before);
    apply(&mut client, &[setup()]);
    assert_eq!(client.minimap_view().dimension, Some(24));
    assert!(client.minimap_view().toggles.iter().all(|&v| v == 0));
    assert_eq!(client.advance(208., false).unwrap().delta, 1.);
    assert_eq!(client.minimap_view().marker, marker);
}

#[test]
fn later_bad_map_or_team_setup_preserves_world_names_and_map() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_minimap_tracking().unwrap();
    client.enable_nicknames().unwrap();
    let mut named = appearance(7, 2000, 12);
    named.splice(22..23, [9].into_iter().chain(b"Synthetic".iter().copied()));
    apply(&mut client, &[setup(), named, vec![b'M', 0, 3, 64]]);
    client.advance(200., false).unwrap();
    client.prepare_draw(800, 600).unwrap();
    assert_eq!(client.nickname_draws()[0].text, "Synthetic");
    let before = client.clone();
    assert!(
        client
            .apply_frame(
                &bundle(&[vec![b'M', 0, 3, 32], mass(7, 123), vec![b'V', 64, 255]]),
                ElapsedHeader::Absent
            )
            .is_err()
    );
    assert_eq!(client, before);
    let mut team = setup();
    team.extend(1_u16.to_be_bytes());
    team.extend(u24(900));
    team.extend([2, 0]);
    assert_eq!(
        client.apply_frame(
            &bundle(&[vec![b'U', 0, 2, 64], team]),
            ElapsedHeader::Absent
        ),
        Err(ClientPresentationError::UnsupportedMode(2))
    );
    assert_eq!(client, before);
}

#[test]
fn minimaps_share_hud_command_boundaries_for_both_schemas() {
    for schema in [1, 2] {
        let mut client = AnimatedClient::new(0.).unwrap();
        client.enable_minimap_tracking().unwrap();
        client.enable_score_tracking().unwrap();
        let mut server_setup = setup();
        server_setup.extend(1_u16.to_be_bytes());
        let commands = [
            server_setup.clone(),
            vec![b'M', 0, 2, 64],
            appearance(7, 2000, 12),
            vec![b'l', 0, 0, 1, 0, 2],
            vec![b'V', 64],
            server_setup,
            vec![b'u', 64],
        ];
        let guards = vec![
            HudCommandGuard {
                playing: true,
                close_requested: false,
                death_pending: false
            };
            commands.len()
        ];
        let mut setups = Vec::new();
        let report = client
            .apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud(
                &bundle(&commands),
                ElapsedHeader::Absent,
                |_| Ok(FacePresentation::default()),
                |_, _| panic!("no synthetic food"),
                |_, _| panic!("no synthetic prey"),
                |stage, _| {
                    setups.push(stage.minimap_view().image_revision);
                    Ok::<_, ClientPresentationError>(())
                },
                HudIngressPlan {
                    schema,
                    command_count: commands.len(),
                    guards: &guards,
                    final_capture_indices: &[],
                },
            )
            .unwrap();
        assert_eq!(report.frame_report().ignored, 0);
        assert_eq!(setups, [1, 4]);
        let indices: Vec<_> = report
            .events()
            .iter()
            .filter_map(|event| {
                matches!(event.kind, HudIngressEventKind::Setup { .. })
                    .then_some(event.command_index)
            })
            .collect();
        assert_eq!(indices, [0, 5]);
        assert_eq!(client.minimap_view().dimension, Some(80));
        assert_eq!(client.received().snakes.len(), 1);
        assert!(matches!(client.score_view().status, ScoreStatus::Ready(_)));
        assert_eq!(
            client
                .minimap_render_plan(MinimapLayout::default())
                .unwrap()
                .widget
                .unwrap()
                .label
                .text,
            "server 1"
        );
    }
}

#[test]
fn minimap_session_fraction_precedes_the_connected_fade_writer() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_minimap_tracking().unwrap();
    apply(&mut client, &[setup(), vec![b'M', 0, 24, 64]]);
    client.advance(40., false).unwrap();
    client
        .advance_with_control::<ClientPresentationError, _>(80., false, |_, _| {
            Ok(slither_client::presentation::ClientControlActions {
                minimap_ui_fraction: Some(0.5),
                ..Default::default()
            })
        })
        .unwrap();
    assert_eq!(client.minimap_view().holder_opacity, 0.05);
    for index in 3..=40 {
        client.advance(f64::from(index) * 40., false).unwrap();
    }
    assert_eq!(client.minimap_view().fade, 1.);
    client
        .advance_with_control::<ClientPresentationError, _>(1640., false, |_, _| {
            Ok(slither_client::presentation::ClientControlActions {
                minimap_ui_fraction: Some(0.5),
                ..Default::default()
            })
        })
        .unwrap();
    assert_eq!(client.minimap_view().holder_opacity, 0.5);
}
