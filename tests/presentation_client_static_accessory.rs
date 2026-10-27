//! Authored synthetic packets and metadata; no source objects or external inputs.

use slither_client::{
    presentation::{
        AccessoryPresentation, AnimatedClient, AntennaBulbGeometry, AppearanceContext,
        AppearancePresentation, BodyAsset, BodyAssetStatus, ClientPresentationError,
        EyeLayoutInput, FaceGeometry, FacePresentation, FoodFactory, FoodSource, HudCommandGuard,
        HudIngressPlan, MAX_RETAINED_SNAKES, MouthFaceGeometry, OrdinaryAntennaGeometry,
        PreparedAccessorySnake, PreyFactory, SingleEyeGeometry, StaticHeadAccessoryGeometry,
        food_palette,
    },
    protocol::ElapsedHeader,
    state::Point,
};
use std::cell::RefCell;

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
fn legacy_literal_conversions_select_none() {
    let face = FacePresentation {
        face: Default::default(),
        antenna: None,
    };
    let old = AppearancePresentation {
        face: Default::default(),
        antenna: None,
    };
    assert_eq!(AccessoryPresentation::from(face).accessory, None);
    assert_eq!(AccessoryPresentation::from(old).accessory, None);
    assert!(AppearanceContext { own: true }.own);
}

fn geometry() -> StaticHeadAccessoryGeometry {
    StaticHeadAccessoryGeometry {
        forward: 5.,
        image_scale: 0.25,
        pivot_x: -0.,
        pivot_y: 7.,
    }
}

fn presentation(face: FaceGeometry, selected: bool, antenna: bool) -> AccessoryPresentation {
    AccessoryPresentation {
        presentation: FacePresentation {
            face,
            antenna: antenna.then(|| OrdinaryAntennaGeometry {
                nodes: 8,
                outer_color: 0x102030,
                inner_color: 0x304050,
                inner_opacity: 0.5,
                repeated_inner_strokes: false,
                rotate_bulb: true,
                bulb: AntennaBulbGeometry {
                    offset_x: -2.,
                    offset_y: -3.,
                    width: 4.,
                    height: 6.,
                    scale: 1.,
                    opacity: 0.7,
                },
            }),
        },
        accessory: selected.then(geometry),
    }
}

fn apply(c: &mut AnimatedClient, commands: &[Vec<u8>], p: AccessoryPresentation) {
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &bundle(commands),
        ElapsedHeader::Absent,
        |_, _| Ok(p),
    )
    .unwrap();
}

fn client(p: AccessoryPresentation) -> AnimatedClient {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), spawn(7, 2000, 3)], p);
    c.set_follows(false);
    c.set_zoom(1.).unwrap();
    c.set_camera_position(Point { x: 2000., y: 1000. }).unwrap();
    c
}

fn draw(c: &mut AnimatedClient) -> Vec<PreparedAccessorySnake> {
    c.prepare_draw_with_accessory_presentation::<ClientPresentationError, _>(
        800,
        600,
        1.,
        false,
        |request| Ok(vec![[0.5, 0.5]; request.random_pair_count]),
    )
    .unwrap()
}

fn exact(a: &AnimatedClient, b: &AnimatedClient) {
    assert_eq!(a, b);
    assert_eq!(format!("{a:?}"), format!("{b:?}"));
}

#[test]
fn staged_own_is_recomputed_after_callback_rollback_and_survives_id_reuse_setup_expiry() {
    let p = presentation(FaceGeometry::default(), true, false);
    let mut c = AnimatedClient::new(0.).unwrap();
    let before = c.clone();
    let mut contexts = Vec::new();
    let commands = bundle(&[setup(), spawn(7, 2000, 3), spawn(7, 2100, 3)]);
    let result = c.apply_frame_with_accessory_presentation(
        &commands,
        ElapsedHeader::Absent,
        |_, context| {
            contexts.push(context.own);
            if context.own {
                Ok(p)
            } else {
                Err(ClientPresentationError::Limit)
            }
        },
    );
    assert_eq!(result, Err(ClientPresentationError::Limit));
    exact(&c, &before);
    assert_eq!(contexts, [true, false]);
    contexts.clear();
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &commands,
        ElapsedHeader::Absent,
        |_, context| {
            contexts.push(context.own);
            Ok(presentation(FaceGeometry::default(), context.own, false))
        },
    )
    .unwrap();
    assert_eq!(contexts, [true, false]);
    let own = c.own_token().unwrap();
    assert!(
        c.static_accessory_geometry(own)
            .unwrap()
            .same_bits(&geometry())
    );
    let remote = c.snake_objects().last().unwrap().0;
    assert_eq!(c.static_accessory_geometry(remote), None);
    apply(
        &mut c,
        &[remove(7, true), spawn(7, 2200, 3), setup()],
        presentation(FaceGeometry::default(), false, false),
    );
    assert!(!c.own_snake().unwrap().metrics().alive);
    assert_eq!(c.own_token(), Some(own));
    assert!(
        c.static_accessory_geometry(own)
            .unwrap()
            .same_bits(&geometry())
    );
    c.set_follows(false);
    c.set_zoom(1.).unwrap();
    c.set_camera_position(Point { x: 2000., y: 1000. }).unwrap();
    assert!(
        draw(&mut c)
            .iter()
            .any(|s| s.snake.token == own && s.accessory.is_some())
    );
    for index in 1..=200 {
        c.advance(f64::from(index * 40), false).unwrap();
    }
    assert!(c.drawn_own_snake().is_none());
    assert_eq!(c.own_token(), Some(own));
    assert!(c.static_accessory_geometry(own).is_some());
    let mut context = None;
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &spawn(7, 2300, 3),
        ElapsedHeader::Absent,
        |_, ctx| {
            context = Some(ctx.own);
            Ok(presentation(FaceGeometry::default(), false, false))
        },
    )
    .unwrap();
    assert_eq!(context, Some(false));
    let serial = c.draw_serial();
    c.reset();
    assert!(c.accessory_presentation_enabled());
    assert_eq!(c.draw_serial(), serial);
    assert!(c.static_accessory_geometry(own).is_none());
    let mut context = None;
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        &bundle(&[setup(), spawn(7, 2000, 3)]),
        ElapsedHeader::Absent,
        |_, ctx| {
            context = Some(ctx.own);
            Ok(p)
        },
    )
    .unwrap();
    assert_eq!(context, Some(true));
    assert_ne!(c.own_token(), Some(own));
}

#[test]
fn invalid_geometry_family_callback_and_tail_preserve_the_entire_transaction() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let before = c.clone();
    let commands = bundle(&[setup(), spawn(7, 2000, 3), spawn(8, 2100, 3)]);
    let invalid = [
        AccessoryPresentation {
            accessory: Some(StaticHeadAccessoryGeometry {
                image_scale: 0.,
                ..geometry()
            }),
            ..presentation(FaceGeometry::default(), true, false)
        },
        presentation(
            FaceGeometry::SingleImage(SingleEyeGeometry {
                base_size: 20.,
                pupil_size: 8.,
                pupil_travel: 1.,
            }),
            true,
            false,
        ),
        presentation(
            FaceGeometry::Mouth(MouthFaceGeometry {
                pupil_travel: f64::NAN,
            }),
            true,
            false,
        ),
    ];
    for p in invalid {
        let result = c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
            &commands,
            ElapsedHeader::Absent,
            |a, _| {
                Ok(if a.id == 7 {
                    presentation(FaceGeometry::default(), true, false)
                } else {
                    p
                })
            },
        );
        assert!(result.is_err());
        exact(&c, &before);
    }
    let result =
        c.apply_frame_with_accessory_presentation(&commands, ElapsedHeader::Absent, |_, _| {
            Err::<AccessoryPresentation, _>(ClientPresentationError::Limit)
        });
    assert_eq!(result, Err(ClientPresentationError::Limit));
    exact(&c, &before);
    let invalid_tail = bundle(&[setup(), spawn(7, 2000, 3), vec![b'h', 0, 7]]);
    assert!(
        c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
            &invalid_tail,
            ElapsedHeader::Absent,
            |_, _| panic!("typed tail admission precedes callbacks")
        )
        .is_err()
    );
    exact(&c, &before);
}

#[test]
fn mode_admission_empty_frames_missing_resolvers_and_reset_match_face_mode() {
    let mut c = AnimatedClient::new(0.).unwrap();
    c.apply_frame(b"p", ElapsedHeader::Absent).unwrap();
    let before = c.clone();
    assert_eq!(
        c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
            b"p",
            ElapsedHeader::Absent,
            |_, _| panic!("no appearances")
        ),
        Err(ClientPresentationError::AccessoryPresentationModeRequiresReset)
    );
    exact(&c, &before);
    c.reset();
    c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
        b"p",
        ElapsedHeader::Absent,
        |_, _| panic!("no appearances"),
    )
    .unwrap();
    assert!(
        c.accessory_presentation_enabled()
            && c.face_presentation_enabled()
            && c.appearance_enabled()
    );
    c.reset();
    apply(
        &mut c,
        &[setup(), spawn(7, 2000, 3)],
        presentation(FaceGeometry::default(), false, false),
    );
    let before = c.clone();
    assert_eq!(
        c.apply_frame(&spawn(8, 2000, 3), ElapsedHeader::Absent),
        Err(ClientPresentationError::AccessoryPresentationResolverRequired)
    );
    exact(&c, &before);
    assert_eq!(
        c.apply_frame_with_face_presentation::<ClientPresentationError, _>(
            &spawn(8, 2000, 3),
            ElapsedHeader::Absent,
            |_| panic!("missing context capability")
        ),
        Err(ClientPresentationError::AccessoryPresentationResolverRequired)
    );
    exact(&c, &before);
    assert_eq!(
        c.apply_frame_with_appearance::<ClientPresentationError, _>(
            &spawn(8, 2000, 3),
            ElapsedHeader::Absent,
            |_| panic!("missing context capability")
        ),
        Err(ClientPresentationError::AccessoryPresentationResolverRequired)
    );
    exact(&c, &before);
    c.apply_frame(&setup(), ElapsedHeader::Absent).unwrap();
    assert!(
        c.static_accessory_geometry(c.own_token().unwrap())
            .is_none()
    );
}

#[test]
fn legacy_draws_reject_a_later_visible_accessory_before_randomness_and_preserve_model() {
    let mut c = client(presentation(FaceGeometry::default(), false, true));
    apply(
        &mut c,
        &[spawn(8, 2100, 3)],
        presentation(
            FaceGeometry::Mouth(MouthFaceGeometry { pupil_travel: 1. }),
            true,
            true,
        ),
    );
    let before = c.clone();
    assert_eq!(
        c.prepare_draw(800, 600),
        Err(ClientPresentationError::AccessoryPresentationRequired)
    );
    exact(&c, &before);
    assert_eq!(
        c.prepare_draw_with_style(800, 600, 1., true),
        Err(ClientPresentationError::AccessoryPresentationRequired)
    );
    exact(&c, &before);
    assert_eq!(
        c.prepare_draw_with_antenna::<ClientPresentationError, _>(800, 600, 1., false, |_| panic!(
            "accessory preflight precedes the first antenna"
        )),
        Err(ClientPresentationError::AccessoryPresentationRequired)
    );
    exact(&c, &before);
    assert_eq!(
        c.prepare_draw_with_face_presentation::<ClientPresentationError, _>(
            800,
            600,
            1.,
            false,
            |_| panic!("accessory preflight precedes the first antenna")
        ),
        Err(ClientPresentationError::AccessoryPresentationRequired)
    );
    exact(&c, &before);
    let prepared = draw(&mut c);
    assert_eq!(prepared.len(), 2);
    assert!(prepared[0].accessory.is_none());
    assert!(prepared[1].accessory.is_some());
    c.set_camera_position(Point {
        x: 100000.,
        y: 100000.,
    })
    .unwrap();
    assert!(
        c.prepare_draw_with_face_presentation::<ClientPresentationError, _>(
            800,
            600,
            1.,
            false,
            |_| panic!("all culled")
        )
        .unwrap()
        .is_empty()
    );
}

#[test]
fn none_preserves_all_legacy_faces_and_selected_accessory_adds_no_body_or_clock_transition() {
    for face in [
        FaceGeometry::default(),
        FaceGeometry::Mouth(MouthFaceGeometry { pupil_travel: 0.04 }),
        FaceGeometry::SingleImage(SingleEyeGeometry {
            base_size: 20.,
            pupil_size: 8.,
            pupil_travel: 0.04,
        }),
    ] {
        for antenna in [false, true] {
            let p = presentation(face, false, antenna);
            let mut old = AnimatedClient::new(0.).unwrap();
            old.apply_frame_with_face_presentation::<ClientPresentationError, _>(
                &bundle(&[setup(), spawn(7, 2000, 3)]),
                ElapsedHeader::Absent,
                |_| Ok(p.presentation),
            )
            .unwrap();
            let mut new = AnimatedClient::new(0.).unwrap();
            apply(&mut new, &[setup(), spawn(7, 2000, 3)], p);
            for timestamp in [0., 4., 12., 40., 80.] {
                assert_eq!(
                    old.advance(timestamp, false).unwrap(),
                    new.advance(timestamp, false).unwrap()
                );
                let expected = old
                    .prepare_draw_with_face_presentation::<ClientPresentationError, _>(
                        800,
                        600,
                        1.,
                        false,
                        |request| Ok(vec![[0.5, 0.5]; request.random_pair_count]),
                    )
                    .unwrap();
                let actual = draw(&mut new);
                assert_eq!(
                    actual.iter().map(|s| s.snake.clone()).collect::<Vec<_>>(),
                    expected
                );
                assert!(actual.iter().all(|s| s.accessory.is_none()));
                assert_eq!(old.camera(), new.camera());
                assert_eq!(old.received(), new.received());
                assert_eq!(old.draw_serial(), new.draw_serial());
                assert_eq!(old.own_snake(), new.own_snake());
            }
            if !matches!(face, FaceGeometry::SingleImage(_)) {
                let mut selected = client(presentation(face, true, antenna));
                let mut absent = client(p);
                for timestamp in [4., 12., 40.] {
                    assert_eq!(
                        selected.advance(timestamp, false).unwrap(),
                        absent.advance(timestamp, false).unwrap()
                    );
                    let a = draw(&mut selected);
                    let b = draw(&mut absent);
                    assert_eq!(a[0].snake, b[0].snake);
                    assert!(a[0].accessory.unwrap().same_bits(&geometry()));
                    assert_eq!(selected.camera(), absent.camera());
                    assert_eq!(selected.own_snake(), absent.own_snake());
                    assert_eq!(
                        selected.antenna_snapshot(selected.own_token().unwrap()),
                        absent.antenna_snapshot(absent.own_token().unwrap())
                    );
                }
            }
        }
    }
}

#[test]
fn independent_gaze_w02_changes_pupils_without_changing_accessory_layout() {
    for face in [
        FaceGeometry::default(),
        FaceGeometry::Mouth(MouthFaceGeometry { pupil_travel: 1.5 }),
    ] {
        let mut a = client(presentation(face, true, false));
        let mut b = a.clone();
        a.set_own_gaze_heading(0.).unwrap();
        b.set_own_gaze_heading(1.3).unwrap();
        a.advance(4., false).unwrap();
        b.advance(4., false).unwrap();
        let pa = draw(&mut a).remove(0);
        let pb = draw(&mut b).remove(0);
        assert_ne!(pa.snake.pupil, pb.snake.pupil);
        assert_eq!(
            pa.snake.face_heading.to_bits(),
            pb.snake.face_heading.to_bits()
        );
        let layout = |p: &PreparedAccessorySnake, c: &AnimatedClient| {
            p.accessory
                .unwrap()
                .layout(
                    p.snake.face_heading,
                    Point { x: 20., y: 12. },
                    p.snake.metrics.spawn_progress,
                    EyeLayoutInput {
                        corrected_head: p.snake.metrics.corrected_head,
                        camera: c.camera().position(),
                        viewport_half: Point { x: 400., y: 300. },
                        scale: p.snake.metrics.scale,
                        zoom: c.camera().zoom(),
                        death_progress: p.snake.metrics.death_progress,
                    },
                )
                .unwrap()
        };
        assert_eq!(layout(&pa, &a), layout(&pb, &b));
    }
}

#[test]
fn callback_failure_after_first_antenna_leaves_draw_and_numeric_ownership_unchanged() {
    let mut c = client(presentation(FaceGeometry::default(), true, true));
    apply(
        &mut c,
        &[spawn(8, 2100, 3)],
        presentation(FaceGeometry::default(), true, true),
    );
    let before = c.clone();
    let mut calls = 0;
    let result = c.prepare_draw_with_accessory_presentation(800, 600, 1., false, |r| {
        calls += 1;
        if calls == 1 {
            Ok(vec![[0.5, 0.5]; r.random_pair_count])
        } else {
            Err(ClientPresentationError::Limit)
        }
    });
    assert_eq!(calls, 2);
    assert_eq!(result, Err(ClientPresentationError::Limit));
    exact(&c, &before);
    let result = c.prepare_draw_with_accessory_presentation::<ClientPresentationError, _>(
        800,
        600,
        1.,
        false,
        |r| Ok(vec![[f64::NAN, 0.5]; r.random_pair_count]),
    );
    assert!(result.is_err());
    exact(&c, &before);
}

#[test]
fn retained_limit_is_512_inclusive_and_failed_tail_does_not_consume_identity() {
    assert_eq!(MAX_RETAINED_SNAKES, 512);
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut commands = vec![setup()];
    commands.extend((0..512).map(|_| spawn(7, 2000, 2)));
    apply(
        &mut c,
        &commands,
        presentation(FaceGeometry::default(), true, false),
    );
    assert_eq!(c.retained_count(), 512);
    assert_eq!(draw(&mut c).len(), 512);
    let before = c.clone();
    assert_eq!(
        c.apply_frame_with_accessory_presentation::<ClientPresentationError, _>(
            &spawn(7, 2000, 2),
            ElapsedHeader::Absent,
            |_, context| {
                assert!(!context.own);
                Ok(presentation(FaceGeometry::default(), true, false))
            }
        ),
        Err(ClientPresentationError::Limit)
    );
    exact(&c, &before);
}

#[test]
fn food_and_all_factory_facades_preserve_authoritative_geometry_and_factory_modes() {
    let p = presentation(
        FaceGeometry::Mouth(MouthFaceGeometry { pupil_travel: 0.04 }),
        true,
        false,
    );
    let food_commands = bundle(&[setup(), spawn(7, 2000, 3), vec![b'f', 1, 2, 3, 4, 7, 25]]);
    let mut food = AnimatedClient::new(0.).unwrap();
    food.apply_frame_with_accessory_presentation_and_factories(
        &food_commands,
        ElapsedHeader::Absent,
        |_, context| {
            assert!(context.own);
            Ok::<_, ClientPresentationError>(p)
        },
        |spawn, _| Ok(food_factory(spawn.raw_color)),
    )
    .unwrap();
    let mut food_setup = AnimatedClient::new(0.).unwrap();
    food_setup
        .apply_frame_with_accessory_presentation_and_factories_and_setup(
            &food_commands,
            ElapsedHeader::Absent,
            |_, _| Ok::<_, ClientPresentationError>(p),
            |spawn, _| Ok(food_factory(spawn.raw_color)),
            |_, _| Ok(()),
        )
        .unwrap();
    exact(&food, &food_setup);
    assert!(food.food_enabled() && !food.prey_enabled());
    assert_eq!(food.foods().foods().len(), 1);
    assert!(draw(&mut food)[0].accessory.unwrap().same_bits(&geometry()));
    let commands = bundle(&[
        setup(),
        spawn(7, 2000, 3),
        vec![b'f', 1, 2, 3, 4, 7, 25],
        prey(),
    ]);
    let mut all = AnimatedClient::new(0.).unwrap();
    all.apply_frame_with_accessory_presentation_and_all_factories(
        &commands,
        ElapsedHeader::Absent,
        |_, _| Ok::<_, ClientPresentationError>(p),
        |spawn, _| Ok(food_factory(spawn.raw_color)),
        |spawn, _| Ok(prey_factory(spawn.raw_color)),
    )
    .unwrap();
    let mut all_setup = AnimatedClient::new(0.).unwrap();
    all_setup
        .apply_frame_with_accessory_presentation_and_all_factories_and_setup(
            &commands,
            ElapsedHeader::Absent,
            |_, _| Ok::<_, ClientPresentationError>(p),
            |spawn, _| Ok(food_factory(spawn.raw_color)),
            |spawn, _| Ok(prey_factory(spawn.raw_color)),
            |_, _| Ok(()),
        )
        .unwrap();
    exact(&all, &all_setup);
    assert!(all.food_enabled() && all.prey_enabled());
    assert_eq!(all.preys().preys().len(), 1);
}

#[test]
fn ordered_setup_draws_share_one_transaction_with_staged_own_and_no_update() {
    let p = presentation(FaceGeometry::default(), true, true);
    let commands = [
        setup(),
        spawn(7, 2000, 3),
        vec![b'f', 1, 2, 3, 4, 7, 25],
        prey(),
        setup(),
        spawn(8, 2100, 3),
        setup(),
    ];
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut control = c.clone();
    let order = RefCell::new(Vec::new());
    let mut frames = Vec::new();
    let mut contexts = Vec::new();
    c.apply_frame_with_accessory_presentation_and_all_factories_and_setup(
        &bundle(&commands),
        ElapsedHeader::Absent,
        |_, ctx| {
            order.borrow_mut().push("appearance");
            contexts.push(ctx.own);
            Ok::<_, ClientPresentationError>(p)
        },
        |spawn, _| {
            order.borrow_mut().push("food");
            Ok(food_factory(spawn.raw_color))
        },
        |spawn, _| {
            order.borrow_mut().push("prey");
            Ok(prey_factory(spawn.raw_color))
        },
        |stage, _| {
            order.borrow_mut().push("setup");
            frames.push(draw(stage));
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(
        order.into_inner(),
        [
            "setup",
            "appearance",
            "food",
            "prey",
            "setup",
            "appearance",
            "setup"
        ]
    );
    assert_eq!(contexts, [true, false]);
    assert_eq!(frames.iter().map(Vec::len).collect::<Vec<_>>(), [0, 1, 2]);
    let mut expected = Vec::new();
    for command in &commands {
        control
            .apply_frame_with_accessory_presentation_and_all_factories(
                command,
                ElapsedHeader::Absent,
                |_, _| Ok::<_, ClientPresentationError>(p),
                |spawn, _| Ok(food_factory(spawn.raw_color)),
                |spawn, _| Ok(prey_factory(spawn.raw_color)),
            )
            .unwrap();
        if command[0] == b'a' {
            expected.push(draw(&mut control));
        }
    }
    assert_eq!(frames, expected);
    assert_eq!(c.camera(), control.camera());
    assert_eq!(c.own_snake(), control.own_snake());
    assert_eq!(c.foods(), control.foods());
    assert_eq!(c.preys(), control.preys());
    assert_eq!(c.draw_serial(), 3);
    assert_eq!(
        c.advance(4., false).unwrap(),
        control.advance(4., false).unwrap()
    );
    assert_eq!(c.own_snake(), control.own_snake());
}

#[test]
fn factory_geometry_and_late_setup_errors_rollback_earlier_accessories_draws_and_modes() {
    let commands = bundle(&[
        setup(),
        spawn(7, 2000, 3),
        vec![b'f', 1, 2, 3, 4, 7, 25],
        prey(),
        setup(),
    ]);
    for fail in 0..4 {
        let mut c = AnimatedClient::new(0.).unwrap();
        let before = c.clone();
        let mut setups = 0;
        let result = c.apply_frame_with_accessory_presentation_and_all_factories_and_setup(
            &commands,
            ElapsedHeader::Absent,
            |_, _| {
                Ok::<_, ClientPresentationError>(presentation(FaceGeometry::default(), true, true))
            },
            |spawn, _| {
                if fail == 0 {
                    Err(ClientPresentationError::Limit)
                } else {
                    let mut factory = food_factory(spawn.raw_color);
                    if fail == 1 {
                        factory.random_phase_unit = f64::NAN;
                    }
                    Ok(factory)
                }
            },
            |spawn, _| {
                if fail == 2 {
                    Err(ClientPresentationError::Limit)
                } else {
                    Ok(prey_factory(spawn.raw_color))
                }
            },
            |stage, _| {
                setups += 1;
                draw(stage);
                if fail == 3 && setups == 2 {
                    Err(ClientPresentationError::Limit)
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_err());
        exact(&c, &before);
    }
}

#[test]
fn hud_facade_preserves_indexed_setup_and_geometry_and_admits_all_tails_before_callbacks() {
    let p = presentation(
        FaceGeometry::Mouth(MouthFaceGeometry { pupil_travel: 0.04 }),
        true,
        false,
    );
    let commands = [setup(), spawn(7, 2000, 3), setup()];
    let guards = [HudCommandGuard {
        playing: true,
        close_requested: false,
        death_pending: false,
    }; 3];
    let plan = HudIngressPlan {
        schema: 1,
        command_count: 3,
        guards: &guards,
        final_capture_indices: &[],
    };
    let mut c = AnimatedClient::new(0.).unwrap();
    let before = c.clone();
    assert_eq!(c.apply_frame_with_accessory_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
        &bundle(&commands), ElapsedHeader::Absent, |_, _| panic!("score mode required"), |_, _| panic!("no food"), |_, _| panic!("no prey"), |_, _| panic!("no setup"), plan), Err(ClientPresentationError::ScoreTrackingRequired));
    exact(&c, &before);
    c.enable_score_tracking().unwrap();
    let mut control = c.clone();
    let journal = c.apply_frame_with_accessory_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
        &bundle(&commands), ElapsedHeader::Absent, |_, ctx| { assert!(ctx.own); Ok(p) }, |_, _| panic!("no food"), |_, _| panic!("no prey"), |stage, _| { draw(stage); Ok(()) }, plan).unwrap();
    control.apply_frame_with_accessory_presentation_and_all_factories_and_setup::<ClientPresentationError, _, _, _, _>(
        &bundle(&commands), ElapsedHeader::Absent, |_, _| Ok(p), |_, _| panic!("no food"), |_, _| panic!("no prey"), |stage, _| { draw(stage); Ok(()) }).unwrap();
    exact(&c, &control);
    assert_eq!(journal.setup_draws(), 2);
    let before = c.clone();
    let invalid = bundle(&[spawn(8, 2100, 3), vec![b'l', 0]]);
    let guards = &guards[..2];
    assert!(c.apply_frame_with_accessory_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
        &invalid, ElapsedHeader::Absent, |_, _| panic!("HUD malformed tail admission first"), |_, _| panic!("no food"), |_, _| panic!("no prey"), |_, _| panic!("no setup"),
        HudIngressPlan { command_count: 2, guards, ..plan }).is_err());
    exact(&c, &before);
}
