//! Authored synthetic mouth-face lifecycle fixtures adapted from the existing native face suite.

use std::{cell::RefCell, rc::Rc};

use slither_client::{
    presentation::{
        AnimatedClient, AntennaBulbGeometry, BodyAsset, BodyAssetStatus, ClientControlActions,
        ClientPresentationError, FaceGeometry, FacePresentation, FoodFactory, FoodSource,
        MouthFaceGeometry, OrdinaryAntennaGeometry, PreparedSnake, PreyFactory, Turn, food_palette,
    },
    protocol::ElapsedHeader,
    state::Point,
};

fn u24(value: u32) -> [u8; 3] {
    [(value >> 16) as u8, (value >> 8) as u8, value as u8]
}

fn setup() -> Vec<u8> {
    let mut packet = vec![b'a'];
    packet.extend(u24(1000));
    for value in [430_u16, 100, 20] {
        packet.extend(value.to_be_bytes());
    }
    packet.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        packet.extend(value.to_be_bytes());
    }
    packet.extend([19, 42]);
    packet
}

fn spawn(id: u16, x: u32, points: usize) -> Vec<u8> {
    let mut packet = vec![b's'];
    packet.extend(id.to_be_bytes());
    packet.extend(u24(0));
    packet.push(b'0');
    packet.extend(u24(0));
    packet.extend(4250_u16.to_be_bytes());
    packet.extend(u24(0));
    packet.push(0);
    packet.extend(u24(x * 5));
    packet.extend(u24(5000));
    packet.extend([0, 0, 255]);
    if points > 0 {
        packet.extend(u24((x - points as u32 * 42) * 5));
        packet.extend(u24(5000));
        for _ in 2..points {
            packet.extend([211, 127]);
        }
        if points >= 2 {
            packet.extend(0_u16.to_be_bytes());
        }
    }
    packet
}

fn remove(id: u16, death: bool) -> Vec<u8> {
    let mut packet = vec![b's'];
    packet.extend(id.to_be_bytes());
    packet.push(u8::from(death));
    packet
}

fn prey() -> Vec<u8> {
    let mut packet = vec![b'y', 0, 31, 9];
    packet.extend(u24(10_000));
    packet.extend(u24(5000));
    packet.extend([20, b'0']);
    packet.extend(u24(0));
    packet.extend(u24(0));
    packet.extend(1000_u16.to_be_bytes());
    packet
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    commands
        .iter()
        .flat_map(|packet| {
            let mut bytes = (packet.len() as u16).to_be_bytes().to_vec();
            bytes.extend(packet);
            bytes
        })
        .collect()
}

fn mouth(travel: f64) -> FacePresentation {
    FacePresentation {
        face: FaceGeometry::Mouth(MouthFaceGeometry {
            pupil_travel: travel,
        }),
        antenna: None,
    }
}

fn apply(c: &mut AnimatedClient, commands: &[Vec<u8>], travel: f64) {
    c.apply_frame_with_face_presentation::<ClientPresentationError, _>(
        &bundle(commands),
        ElapsedHeader::Absent,
        |_| Ok(mouth(travel)),
    )
    .unwrap();
}

fn client(points: usize) -> AnimatedClient {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), spawn(7, 2000, points)], 0.04);
    c.set_follows(false);
    c.set_zoom(1.).unwrap();
    c.set_camera_position(Point { x: 2000., y: 1000. }).unwrap();
    c
}

fn draw(c: &mut AnimatedClient) -> Vec<PreparedSnake> {
    c.prepare_draw_with_face_presentation::<ClientPresentationError, _>(800, 600, 1., false, |_| {
        panic!("no antenna requests for mouth faces")
    })
    .unwrap()
}

fn source(handle: u64) -> FoodSource {
    FoodSource::new(
        BodyAsset {
            handle,
            revision: 1,
            width: 20,
            height: 16,
            status: BodyAssetStatus::Ready,
        },
        20.,
        16.,
        10.,
        8.,
    )
    .unwrap()
}

fn food_factory(raw: u8) -> FoodFactory {
    FoodFactory {
        random_phase_unit: 0.,
        random_wobble_unit: 0.5,
        palette: food_palette(raw),
        image_count: 1,
        bodies: vec![source(1)],
        outlines: vec![source(2)],
        glows: vec![source(3)],
    }
}

fn prey_factory(raw: u8) -> PreyFactory {
    PreyFactory {
        random_phase_unit: 0.25,
        random_rate_unit: 0.5,
        palette: raw % 9,
        bodies: vec![source(4)],
        glows: vec![source(5)],
    }
}

#[test]
fn selected_geometry_is_owned_before_fractional_updates_and_captured_without_fallback() {
    let mut c = client(3);
    assert!(c.appearance_enabled() && c.face_presentation_enabled());
    let snake = c.own_snake().unwrap();
    assert_eq!(snake.active_face_geometry(), &mouth(0.04).face);
    assert!(snake.eye_geometry().is_none());
    assert!(snake.face_geometry().is_none());
    assert_eq!(snake.eyes().pupil(), Point::default());
    let step = c.advance(4., false).unwrap();
    assert_eq!(step.whole_steps, 0);
    assert_eq!(
        c.own_snake().unwrap().eyes().pupil(),
        Point { x: 0.04, y: 0. }
    );
    let before = *c.own_snake().unwrap().eyes();
    let prepared = draw(&mut c);
    assert_eq!(prepared[0].face_geometry, mouth(0.04).face);
    assert!(prepared[0].eye_geometry.is_none() && prepared[0].face_decoration.is_none());
    assert_eq!(prepared[0].face_heading, before.heading());
    assert_eq!(prepared[0].pupil, before.pupil());
    assert_eq!(
        c.own_snake().unwrap().eyes().target_heading(),
        prepared[0].curve.as_ref().unwrap().target_eye_heading
    );
    let serial = c.draw_serial();
    draw(&mut c);
    assert_eq!(c.draw_serial(), serial + 1);
    assert_eq!(c.own_snake().unwrap().eyes().pupil(), before.pupil());
    assert_eq!(c.clone().advance(8., false).unwrap().delta, 0.5);
}

#[test]
fn full_resolver_mode_persists_after_reset_and_legacy_appearance_free_frames_work() {
    let mut c = client(2);
    c.apply_frame(&setup(), ElapsedHeader::Absent).unwrap();
    assert_eq!(c.own_snake().unwrap().active_face_geometry(), &mouth_face());
    let before = c.clone();
    assert_eq!(
        c.apply_frame_with_appearance::<ClientPresentationError, _>(
            &spawn(8, 2200, 2),
            ElapsedHeader::Absent,
            |_| panic!("paired resolver must not run in generalized mode"),
        ),
        Err(ClientPresentationError::FacePresentationResolverRequired)
    );
    assert_eq!(c, before);
    c.advance(4., false).unwrap();
    c.reset();
    assert!(c.face_presentation_enabled() && c.appearance_enabled());
    assert_eq!(c.drawn_snakes().count(), 0);
    assert_eq!(c.clone().advance(8., false).unwrap().delta, 0.5);
    apply(&mut c, &[setup(), spawn(9, 2200, 2)], 0.02);
    assert_eq!(
        c.own_snake().unwrap().active_face_geometry(),
        &mouth(0.02).face
    );
    assert_eq!(c.advance(8., false).unwrap().delta, 0.5);
    let mut old = AnimatedClient::new(0.).unwrap();
    old.apply_frame(&setup(), ElapsedHeader::Absent).unwrap();
    let before = old.clone();
    assert_eq!(
        old.apply_frame_with_face_presentation::<ClientPresentationError, _>(
            &spawn(7, 2000, 2),
            ElapsedHeader::Absent,
            |_| panic!("late mode must reject"),
        ),
        Err(ClientPresentationError::FacePresentationModeRequiresReset)
    );
    assert_eq!(old, before);
}

#[test]
fn appearance_resolution_is_ordered_and_late_invalid_geometry_rolls_back_everything() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut visits = Vec::new();
    let before = c.clone();
    let result = c.apply_frame_with_face_presentation::<ClientPresentationError, _>(
        &bundle(&[
            setup(),
            spawn(7, 2000, 0),
            spawn(7, 2100, 2),
            remove(7, false),
            spawn(9, 9000, 1),
        ]),
        ElapsedHeader::Absent,
        |a| {
            visits.push((a.id, a.absolute_body.len()));
            Ok(mouth(if a.id == 9 { f64::NAN } else { 0.04 }))
        },
    );
    assert!(matches!(
        result,
        Err(ClientPresentationError::Presentation(_))
    ));
    assert_eq!(visits, [(7, 0), (7, 2), (9, 1)]);
    assert_eq!(c, before);
    let mut invalid = bundle(&[setup(), spawn(7, 2000, 2)]);
    invalid.extend([0, 1, b's']);
    assert!(
        c.apply_frame_with_face_presentation::<ClientPresentationError, _>(
            &invalid,
            ElapsedHeader::Absent,
            |_| panic!("received validation must finish first"),
        )
        .is_err()
    );
    assert_eq!(c, before);
}

#[test]
fn duplicate_ids_and_death_retain_independent_family_gaze_and_own_identity() {
    let mut c = client(3);
    let original = draw(&mut c)[0].token;
    c.set_own_gaze_heading(1.).unwrap();
    apply(&mut c, &[remove(7, true), spawn(7, 2200, 3)], 0.08);
    let newest = c.snake(7).unwrap();
    assert_eq!(newest.active_face_geometry(), &mouth(0.08).face);
    assert_eq!(newest.eyes().gaze_heading(), 0.);
    assert_eq!(
        c.own_snake().unwrap().active_face_geometry(),
        &mouth(0.04).face
    );
    assert_eq!(c.own_snake().unwrap().eyes().gaze_heading(), 1.);
    assert_eq!(c.own_snake().unwrap().eyes().turn(), Turn::None);
    c.advance(4., false).unwrap();
    assert!(c.own_snake().unwrap().eyes().pupil().y > 0.);
    let prepared = draw(&mut c);
    assert_eq!(prepared.len(), 2);
    assert_eq!(prepared[0].token, original);
    assert!(prepared[0].own && !prepared[1].own);
    assert_ne!(prepared[0].token, prepared[1].token);
    for index in 1..=11 {
        c.advance(4. + f64::from(index) * 40., false).unwrap();
    }
    assert!(c.drawn_own_snake().is_none());
    assert!(c.own_snake().is_some());
    assert_eq!(draw(&mut c).len(), 1);
    assert_eq!(
        c.snake(7).unwrap().active_face_geometry(),
        &mouth(0.08).face
    );
}

#[test]
fn offscreen_updates_continue_and_visible_entry_preserves_pupils() {
    let mut c = client(1);
    let prepared = draw(&mut c);
    assert_eq!(prepared.len(), 1);
    assert!(prepared[0].body_geometry.is_none());
    c.set_camera_position(Point { x: 9000., y: 9000. }).unwrap();
    assert!(draw(&mut c).is_empty());
    c.set_own_gaze_heading(-1.).unwrap();
    c.advance(4., false).unwrap();
    let eyes = *c.own_snake().unwrap().eyes();
    assert!(eyes.pupil().x > 0. && eyes.pupil().y < 0.);
    c.set_camera_position(Point { x: 2000., y: 1000. }).unwrap();
    let prepared = draw(&mut c);
    assert_eq!(prepared[0].pupil, eyes.pupil());
    assert_eq!(prepared[0].face_heading, prepared[0].metrics.heading);
    let before = c.clone();
    assert!(
        c.prepare_draw_with_face_presentation::<ClientPresentationError, _>(
            0,
            600,
            1.,
            false,
            |_| panic!("invalid view"),
        )
        .is_err()
    );
    assert_eq!(c, before);
}

#[test]
fn visibility_uses_body_anchors_inclusively_instead_of_head_or_image_bounds() {
    let mut c = client(1);
    // The only body anchor is x=1958. Raw head x=2000 is inside this viewport.
    let mut inclusive = c.clone();
    let mut control = c.clone();
    draw(&mut control);
    let edge = 1958. + (400. / control.camera().zoom() + 84.);
    c.set_camera_position(Point {
        x: edge + 1.,
        y: 1000.,
    })
    .unwrap();
    assert!(draw(&mut c).is_empty());
    inclusive
        .set_camera_position(Point { x: edge, y: 1000. })
        .unwrap();
    assert_eq!(draw(&mut inclusive).len(), 1);
    let mut empty = client(0);
    assert!(draw(&mut empty).is_empty());
}

#[test]
fn legacy_preparations_reject_mouth_faces_atomically_but_culled_faces_need_no_capability() {
    let mut c = client(3);
    let before = c.clone();
    assert_eq!(
        c.prepare_draw(800, 600),
        Err(ClientPresentationError::FacePresentationRequired)
    );
    assert_eq!(c, before);
    assert_eq!(
        c.prepare_draw_with_antenna::<ClientPresentationError, _>(800, 600, 1., false, |_| panic!(
            "legacy rejection precedes RNG"
        ),),
        Err(ClientPresentationError::FacePresentationRequired)
    );
    assert_eq!(c, before);
    c.set_camera_position(Point { x: 9000., y: 9000. }).unwrap();
    assert!(
        c.prepare_draw_with_style(800, 600, 1., false)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn selected_face_does_not_change_curve_cursor_sampling_or_antenna_random_visits() {
    let mut paired = client(3);
    let mut mouth = paired.clone();
    // Replace the world through the same generalized transaction, keeping its timeline.
    paired.reset();
    paired
        .apply_frame_with_face_presentation::<ClientPresentationError, _>(
            &bundle(&[setup(), spawn(7, 2000, 3)]),
            ElapsedHeader::Absent,
            |_| Ok(FacePresentation::default()),
        )
        .unwrap();
    mouth.reset();
    apply(&mut mouth, &[setup(), spawn(7, 2000, 3)], 0.04);
    let a = draw(&mut paired).remove(0);
    let b = draw(&mut mouth).remove(0);
    assert_eq!(a.curve, b.curve);
    assert_eq!(a.body_geometry, b.body_geometry);
    assert_eq!(a.metrics, b.metrics);
    let mut c = AnimatedClient::new(0.).unwrap();
    c.apply_frame_with_face_presentation::<ClientPresentationError, _>(
        &bundle(&[setup(), spawn(7, 2000, 3), spawn(8, 2100, 3)]),
        ElapsedHeader::Absent,
        |a| {
            Ok(FacePresentation {
                face: if a.id == 7 {
                    mouth_face()
                } else {
                    FaceGeometry::default()
                },
                antenna: (a.id == 8).then_some(OrdinaryAntennaGeometry {
                    nodes: 8,
                    outer_color: 0x123456,
                    inner_color: 0xabcdef,
                    inner_opacity: 0.5,
                    repeated_inner_strokes: false,
                    rotate_bulb: false,
                    bulb: AntennaBulbGeometry {
                        offset_x: -5.,
                        offset_y: -5.,
                        width: 10.,
                        height: 10.,
                        scale: 1.,
                        opacity: 1.,
                    },
                }),
            })
        },
    )
    .unwrap();
    let mut requests = Vec::new();
    let prepared = c
        .prepare_draw_with_face_presentation::<ClientPresentationError, _>(
            800,
            600,
            1.,
            false,
            |r| {
                requests.push(r);
                Ok(vec![[0.25, 0.75]; r.random_pair_count])
            },
        )
        .unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].id, 8);
    assert_eq!(requests[0].random_pair_count, 7);
    assert!(prepared[0].antenna.is_none());
    assert!(prepared[1].antenna.is_some());
}

fn mouth_face() -> FaceGeometry {
    mouth(0.04).face
}

#[test]
fn ordered_setup_hooks_and_both_factories_share_one_transaction_and_rollback() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let visits = Rc::new(RefCell::new(Vec::new()));
    let commands = bundle(&[
        setup(),
        spawn(7, 2000, 3),
        vec![b'f', 1, 2, 3, 4, 7, 5],
        prey(),
        setup(),
        remove(7, false),
        setup(),
    ]);
    let face_visits = visits.clone();
    let food_visits = visits.clone();
    let prey_visits = visits.clone();
    let setup_visits = visits.clone();
    c.apply_frame_with_face_presentation_and_all_factories_and_setup::<ClientPresentationError, _, _, _, _>(
        &commands, ElapsedHeader::Absent,
        move |_| { face_visits.borrow_mut().push("face"); Ok(mouth(0.04)) },
        move |f, _| { food_visits.borrow_mut().push("food"); Ok(food_factory(f.raw_color)) },
        move |p, _| { prey_visits.borrow_mut().push("prey"); Ok(prey_factory(p.raw_color)) },
        move |stage, _| {
            setup_visits.borrow_mut().push("setup");
            let prepared = draw(stage);
            if let Some(snake) = prepared.first() { assert_eq!(snake.face_geometry, mouth_face()); }
            Ok(())
        },
    ).unwrap();
    assert_eq!(
        *visits.borrow(),
        ["setup", "face", "food", "prey", "setup", "setup"]
    );
    assert_eq!(c.draw_serial(), 3);
    assert_eq!(c.clone().advance(4., false).unwrap().delta, 0.5);
    assert!(c.face_presentation_enabled() && c.food_enabled() && c.prey_enabled());
    assert_eq!(c.foods().foods().len(), 1);
    assert_eq!(c.preys().preys().len(), 1);
    assert_eq!(c.drawn_snakes().count(), 0);
    let before = c.clone();
    let mut hooks = 0;
    let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup::<ClientPresentationError, _, _, _, _>(
        &bundle(&[spawn(9, 2100, 3), setup(), setup()]), ElapsedHeader::Absent,
        |_| Ok(mouth(0.08)), |f, _| Ok(food_factory(f.raw_color)), |p, _| Ok(prey_factory(p.raw_color)),
        |stage, _| { hooks += 1; draw(stage); if hooks == 2 { Err(ClientPresentationError::Limit) } else { Ok(()) } },
    );
    assert_eq!(result, Err(ClientPresentationError::Limit));
    assert_eq!(hooks, 2);
    assert_eq!(c, before);
}

#[test]
fn food_only_and_all_factory_wrappers_install_the_same_authoritative_face() {
    let mut food = AnimatedClient::new(0.).unwrap();
    food.apply_frame_with_face_presentation_and_factories::<ClientPresentationError, _, _>(
        &bundle(&[setup(), spawn(7, 2000, 2), vec![b'f', 1, 2, 3, 4, 7, 5]]),
        ElapsedHeader::Absent,
        |_| Ok(mouth(0.04)),
        |f, _| Ok(food_factory(f.raw_color)),
    )
    .unwrap();
    assert_eq!(
        food.own_snake().unwrap().active_face_geometry(),
        &mouth_face()
    );
    assert_eq!(food.foods().foods().len(), 1);
    let mut all = AnimatedClient::new(0.).unwrap();
    all.apply_frame_with_face_presentation_and_all_factories::<ClientPresentationError, _, _, _>(
        &bundle(&[setup(), spawn(7, 2000, 2), prey()]),
        ElapsedHeader::Absent,
        |_| Ok(mouth(0.04)),
        |f, _| Ok(food_factory(f.raw_color)),
        |p, _| Ok(prey_factory(p.raw_color)),
    )
    .unwrap();
    assert_eq!(
        all.own_snake().unwrap().active_face_geometry(),
        &mouth_face()
    );
    assert_eq!(all.preys().preys().len(), 1);
    let mut setup_count = 0;
    food.apply_frame_with_face_presentation_and_factories_and_setup::<ClientPresentationError, _, _, _>(
        &setup(), ElapsedHeader::Absent, |_| Ok(mouth(0.04)), |f, _| Ok(food_factory(f.raw_color)),
        |stage, _| { setup_count += 1; assert_eq!(draw(stage)[0].face_geometry, mouth_face()); Ok(()) },
    ).unwrap();
    assert_eq!(setup_count, 1);
}

#[test]
fn late_resolver_error_preserves_the_entire_model_and_next_step() {
    let mut c = client(3);
    c.advance(4., false).unwrap();
    draw(&mut c);
    let before = c.clone();
    let mut visits = Vec::new();
    let result = c.apply_frame_with_face_presentation::<ClientPresentationError, _>(
        &bundle(&[spawn(8, 2100, 3), setup(), spawn(9, 2200, 2)]),
        ElapsedHeader::Absent,
        |a| {
            visits.push(a.id);
            if a.id == 9 {
                Err(ClientPresentationError::Limit)
            } else {
                Ok(mouth(0.08))
            }
        },
    );
    assert_eq!(result, Err(ClientPresentationError::Limit));
    assert_eq!(visits, [8, 9]);
    assert_eq!(c, before);
    let mut control = before;
    assert_eq!(c.advance(8., false), control.advance(8., false));
    assert_eq!(draw(&mut c), draw(&mut control));
    assert_eq!(c, control);
}

#[test]
fn signed_zero_is_retained_and_invalid_travel_is_rejected_atomically() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), spawn(7, 2000, 2)], -0.);
    assert_eq!(
        c.own_snake()
            .unwrap()
            .active_face_geometry()
            .pupil_travel()
            .to_bits(),
        (-0_f64).to_bits()
    );
    assert_eq!(
        draw(&mut c)[0]
            .face_geometry
            .mouth()
            .unwrap()
            .pupil_travel
            .to_bits(),
        (-0_f64).to_bits()
    );
    for bad in [
        -f64::from_bits(1),
        4097.,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
    ] {
        let before = c.clone();
        assert!(
            c.apply_frame_with_face_presentation::<ClientPresentationError, _>(
                &bundle(&[spawn(8, 2100, 2), spawn(9, 2200, 2)]),
                ElapsedHeader::Absent,
                |a| Ok(mouth(if a.id == 9 { bad } else { 0.08 })),
            )
            .is_err()
        );
        assert_eq!(c, before);
    }
}

#[test]
fn own_and_remote_gaze_use_the_shared_pre_motion_step_and_existing_packet_routing() {
    let mut c = client(3);
    apply(&mut c, &[spawn(8, 2100, 3)], 0.02);
    apply(&mut c, &[vec![b'E', 0, 8, 64], vec![b'E', 128]], 0.02);
    assert_eq!(
        c.snake(8).unwrap().eyes().gaze_heading(),
        std::f64::consts::FRAC_PI_2
    );
    let mut control = c.clone();
    control.set_own_gaze_heading(-0.75).unwrap();
    let before_head = c.own_snake().unwrap().metrics().raw_head;
    let mut control_calls = 0;
    let step = c
        .advance_with_control::<ClientPresentationError, _>(4., false, |step, view| {
            control_calls += 1;
            assert_eq!(step.whole_steps, 0);
            assert_eq!(view.own.unwrap().raw_head, before_head);
            Ok(ClientControlActions {
                gaze_heading: Some(-0.75),
                ..ClientControlActions::default()
            })
        })
        .unwrap();
    let other = control.advance(4., false).unwrap();
    assert_eq!(control_calls, 1);
    assert_eq!(step, other);
    assert_eq!(step.whole_steps, 0);
    assert_eq!(
        c.own_snake().unwrap().eyes().pupil(),
        Point {
            x: 0.04 * (-0.75_f64).cos(),
            y: 0.04 * (-0.75_f64).sin()
        }
    );
    assert_eq!(
        c.snake(8).unwrap().eyes().pupil(),
        Point {
            x: 0.02 * std::f64::consts::FRAC_PI_2.cos(),
            y: 0.02
        }
    );
    // Reading the retained family, gaze and metrics does not consume a second step.
    let before = c.clone();
    let snake = c.own_snake().unwrap();
    let _observed = (snake.active_face_geometry(), snake.eyes(), snake.metrics());
    assert_eq!(c, before);
    assert_eq!(draw(&mut c), draw(&mut control));
    assert_eq!(c, control);
}

fn body_plan(
    snake: &PreparedSnake,
    c: &AnimatedClient,
    high: bool,
    detailed: bool,
) -> slither_client::presentation::BodyPaintPlan {
    use slither_client::presentation::{
        BodyAssetUse, BodyPaintInput, BodyPaintQuality, BodyPaintRecipe, BodyPaintView,
        BodyPaintVisual, BodyPalette, BodyStyle, BodyVariantMode, MAX_BODY_PAINT_COMMANDS,
        plan_standard_body,
    };
    let usage = BodyAssetUse {
        asset: 0,
        source_rect: None,
    };
    let variants = [usage];
    let assets = [BodyAsset {
        handle: 1,
        revision: 1,
        width: 20,
        height: 16,
        status: BodyAssetStatus::Ready,
    }];
    let palettes = [BodyPalette {
        variants: &variants,
        boost_glow: Some(usage),
    }];
    let m = snake.metrics;
    plan_standard_body(BodyPaintInput {
        geometry: snake.body_geometry.as_ref().unwrap().as_paint_geometry(),
        recipe: BodyPaintRecipe {
            base_palette: 0,
            palettes: &palettes,
            runs: &[],
            variant_mode: BodyVariantMode::Cycle,
            variant_period: 1,
            custom: false,
            style: Some(BodyStyle {
                detailed_segments: detailed,
                swell: 0.,
                rotate_segments: true,
                head_fade: None,
                tail_fade: None,
            }),
            outline: Some(usage),
            shadow: Some(usage),
            death: Some(usage),
        },
        assets: &assets,
        view: BodyPaintView {
            camera: c.camera().position(),
            zoom: c.camera().zoom(),
            half_width: 400.,
            half_height: 300.,
        },
        quality: BodyPaintQuality {
            high_quality: high,
            blend: if high { 1. } else { 0. },
        },
        visual: BodyPaintVisual {
            scale: m.scale,
            spawn: m.spawn_progress,
            death: m.death_progress,
            dead: !m.alive,
            smoothed_speed: m.visual_speed,
            boost_threshold: m.boost_threshold_speed,
            cruise_speed: m.cruise_speed,
            maximum_speed: m.maximum_speed,
            boost_phase: m.boost_phase,
        },
        entry_alpha: 1.,
        command_limit: MAX_BODY_PAINT_COMMANDS,
    })
    .unwrap()
}

#[test]
fn paired_and_mouth_preserve_complete_body_plans_flags_seeds_and_death_suffixes() {
    use slither_client::presentation::{BodyPaintPass, PairedFaceGeometry, StandardEyeGeometry};
    for high in [false, true] {
        for detailed in [false, true] {
            for dying in [false, true] {
                let mut mouth_client = client(3);
                let mut paired = mouth_client.clone();
                paired.reset();
                paired
                    .apply_frame_with_face_presentation::<ClientPresentationError, _>(
                        &bundle(&[setup(), spawn(7, 2000, 3)]),
                        ElapsedHeader::Absent,
                        |_| {
                            Ok(FacePresentation {
                                face: FaceGeometry::Paired(PairedFaceGeometry {
                                    eyes: StandardEyeGeometry {
                                        pupil_travel: 0.04,
                                        ..StandardEyeGeometry::default()
                                    },
                                    decoration: None,
                                }),
                                antenna: None,
                            })
                        },
                    )
                    .unwrap();
                paired.set_follows(false);
                paired.set_zoom(1.).unwrap();
                paired
                    .set_camera_position(Point { x: 2000., y: 1000. })
                    .unwrap();
                // First preparation includes spawn zero; later ones use the shared update/death clock.
                for now in [0., 4., 44.] {
                    if now > 0. {
                        if dying && now == 4. {
                            apply(&mut mouth_client, &[remove(7, true)], 0.04);
                            apply(&mut paired, &[remove(7, true)], 0.04);
                        }
                        mouth_client.set_own_gaze_heading(0.6).unwrap();
                        paired.set_own_gaze_heading(0.6).unwrap();
                        assert_eq!(mouth_client.advance(now, false), paired.advance(now, false));
                    }
                    let prepare = |c: &mut AnimatedClient| {
                        c.prepare_draw_with_face_presentation::<ClientPresentationError, _>(
                            800,
                            600,
                            1.3,
                            detailed,
                            |_| panic!("face consumes no randomness"),
                        )
                        .unwrap()
                        .remove(0)
                    };
                    let a = prepare(&mut paired);
                    let b = prepare(&mut mouth_client);
                    assert_eq!(a.metrics, b.metrics);
                    assert_eq!(a.curve, b.curve);
                    assert_eq!(a.body_geometry, b.body_geometry);
                    assert_eq!(a.face_heading, b.face_heading);
                    assert_eq!(a.pupil, b.pupil);
                    assert_eq!(paired.camera(), mouth_client.camera());
                    let expected = body_plan(&a, &paired, high, detailed);
                    let actual = body_plan(&b, &mouth_client, high, detailed);
                    assert_eq!(actual, expected);
                    if dying && now > 0. {
                        assert!(
                            actual
                                .commands
                                .iter()
                                .any(|c| c.pass == BodyPaintPass::Death)
                        );
                    }
                    let layout = b
                        .face_geometry
                        .mouth()
                        .unwrap()
                        .layout(
                            b.face_heading,
                            b.pupil,
                            slither_client::presentation::EyeLayoutInput {
                                corrected_head: b.metrics.corrected_head,
                                camera: mouth_client.camera().position(),
                                viewport_half: Point { x: 400., y: 300. },
                                scale: b.metrics.scale,
                                zoom: mouth_client.camera().zoom(),
                                death_progress: b.metrics.death_progress,
                            },
                        )
                        .unwrap();
                    assert_eq!(layout.images.len(), 3);
                }
            }
        }
    }
}
