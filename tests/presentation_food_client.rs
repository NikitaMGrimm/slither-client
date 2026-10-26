//! Authored packet/update/lifecycle food integration fixtures; no external inputs.

use slither_client::{
    presentation::{
        AnimatedClient, BodyAsset, BodyAssetStatus, ClientPresentationError, FoodError,
        FoodFactory, FoodSnapshot, FoodSource, PairedFaceGeometry, PairedSideGeometry,
        StandardEyeGeometry, food_palette,
    },
    protocol::ElapsedHeader,
    state::FoodSpawnInput,
};

fn u24(value: u32) -> [u8; 3] {
    let b = value.to_be_bytes();
    [b[1], b[2], b[3]]
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
    p.extend(u24((x - 126) * 5));
    p.extend(u24(5000));
    p.extend([211, 127, 0, 0]);
    p
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    commands
        .iter()
        .flat_map(|p| {
            let mut out = (p.len() as u16).to_be_bytes().to_vec();
            out.extend(p);
            out
        })
        .collect()
}

fn factory(raw: u8) -> FoodFactory {
    let palette = food_palette(raw);
    let source = |handle| {
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
    };
    FoodFactory {
        random_phase_unit: 0.,
        random_wobble_unit: 0.5,
        palette,
        image_count: 1,
        bodies: vec![source(u64::from(palette) + 1)],
        outlines: vec![source(u64::from(palette) + 20)],
        glows: vec![source(u64::from(palette) + 40)],
    }
}

fn apply(c: &mut AnimatedClient, commands: &[Vec<u8>]) {
    c.apply_frame_with_factories::<ClientPresentationError, _, _>(
        &bundle(commands),
        ElapsedHeader::Absent,
        |_| Ok(PairedFaceGeometry::default()),
        |spawn, _| Ok(factory(spawn.raw_color)),
    )
    .unwrap();
}

fn food(c: &AnimatedClient) -> Vec<FoodSnapshot> {
    c.foods().foods().iter().map(|f| f.snapshot()).collect()
}

fn client() -> AnimatedClient {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), appearance(7, 2000)]);
    c
}

#[test]
fn packet_creation_uses_wire_order_cached_color_and_current_zoom() {
    let mut c = client();
    c.prepare_draw(800, 600).unwrap();
    let zoom = c.camera().zoom();
    let mut requests = Vec::new();
    c.apply_frame_with_factories::<ClientPresentationError, _, _>(
        &bundle(&[
            vec![b'F', 1, 2, 9, 3, 4, 5, 18, 3, 4, 10],
            vec![b'f', 1, 2, 8, 9, 255, 5],
            vec![b'b', 10, 11, 5],
        ]),
        ElapsedHeader::Absent,
        |_| Ok(PairedFaceGeometry::default()),
        |spawn, at_zoom| {
            requests.push((spawn.key, spawn.raw_color, spawn.rapid, at_zoom));
            Ok(factory(spawn.raw_color))
        },
    )
    .unwrap();
    assert_eq!(
        requests.iter().map(|r| r.1).collect::<Vec<_>>(),
        [9, 18, 255, 255]
    );
    assert_eq!(
        requests.iter().map(|r| r.2).collect::<Vec<_>>(),
        [true, true, false, true]
    );
    assert!(requests.iter().all(|r| r.3 == zoom));
    assert_eq!(
        food(&c)
            .iter()
            .map(|f| f.effective_palette)
            .collect::<Vec<_>>(),
        [9, 0, 3, 3]
    );
    assert_eq!(food(&c).len(), 4);
    assert_eq!(c.received().foods.len(), 3);
    assert!(
        food(&c)
            .iter()
            .all(|f| f.creation_zoom == zoom && f.scale == 0.00001)
    );
}

#[test]
fn consume_reads_captured_eater_after_that_same_snake_update() {
    let mut c = client();
    apply(
        &mut c,
        &[vec![b'f', 1, 2, 3, 4, 7, 5], vec![b'<', 1, 2, 3, 4, 0, 7]],
    );
    let before = food(&c)[0];
    let token = c.own_token().unwrap();
    assert_eq!(before.eater, Some(token));
    assert_eq!(before.consumption_progress, 0.);
    let step = c.advance(8., false).unwrap();
    assert_eq!(step.delta, 1.);
    let eater = c.snake_object(token).unwrap().metrics();
    assert_eq!(eater.raw_head.x, 2001.0625);
    let p = 1. / 41.;
    let k = p * p;
    let expected = before.position.x
        + ((eater.raw_head.x + (43. - k * 24.) * (1. - k)) - before.position.x) * k
        + 6. * (1. - p);
    let after = food(&c)[0];
    assert_eq!(after.render_position.x, expected);
    assert_eq!(after.consumption_progress, p);
    assert_eq!(after.fade, before.fade);
    assert_eq!(after.uneaten_scale, before.uneaten_scale);
}

#[test]
fn detached_eater_survives_wire_id_reuse_and_is_released_after_food_expiry() {
    let mut c = client();
    apply(
        &mut c,
        &[
            appearance(8, 3000),
            vec![b'f', 1, 2, 3, 4, 7, 5],
            vec![b'<', 1, 2, 3, 4, 0, 8],
        ],
    );
    let token = food(&c)[0].eater.unwrap();
    let pose = c.snake_object(token).unwrap().clone();
    apply(&mut c, &[vec![b's', 0, 8, 0], appearance(8, 5000)]);
    assert_eq!(c.retained_count(), 3);
    assert_eq!(c.snake_object(token), Some(&pose));
    assert_eq!(c.snake(8).unwrap().metrics().raw_head.x, 5000.);
    for now in (8..=336).step_by(8) {
        c.advance(now as f64, false).unwrap();
    }
    assert!(food(&c).is_empty());
    assert!(c.snake_object(token).is_none());
    assert_eq!(c.retained_count(), 2);
}

#[test]
fn an_unknown_captured_eater_is_not_rebound_by_a_later_appearance() {
    let mut c = client();
    apply(
        &mut c,
        &[
            vec![b'f', 1, 2, 3, 4, 7, 5],
            vec![b'<', 1, 2, 3, 4, 0, 9],
            appearance(9, 3000),
        ],
    );
    assert!(food(&c)[0].eaten);
    assert_eq!(food(&c)[0].eater, None);
    assert_eq!(c.advance(0., false).unwrap().delta, 0.);
    assert!(food(&c).is_empty());
    assert!(c.snake(9).is_some());
}

#[test]
fn repeated_setup_retains_food_and_reset_releases_it_without_losing_phase_or_bounds() {
    let mut c = client();
    apply(&mut c, &[vec![b'f', 1, 2, 3, 4, 7, 5]]);
    c.advance(3., false).unwrap();
    c.prepare_draw(800, 600).unwrap();
    let retained = food(&c);
    let bounds = c.food_bounds();
    let camera = c.camera().position();
    apply(&mut c, &[setup()]);
    assert_eq!(food(&c), retained);
    c.reset();
    assert!(food(&c).is_empty());
    assert!(c.food_enabled());
    assert_eq!(c.food_bounds(), bounds);
    assert_eq!(c.camera().position(), camera);
    apply(
        &mut c,
        &[setup(), appearance(7, 4000), vec![b'f', 1, 2, 3, 4, 7, 5]],
    );
    assert!(food(&c)[0].instance.serial() > retained[0].instance.serial());
    assert_eq!(c.advance(8., false).unwrap().whole_steps, 1);
}

#[test]
fn late_factory_failure_rolls_back_received_caches_tokens_and_food_together() {
    let mut c = client();
    let before = c.clone();
    let mut calls = 0;
    let result = c.apply_frame_with_factories::<ClientPresentationError, _, _>(
        &bundle(&[
            appearance(8, 3000),
            vec![b'f', 1, 2, 3, 4, 18, 5],
            vec![b'b', 5, 6, 5],
        ]),
        ElapsedHeader::Absent,
        |_| Ok(PairedFaceGeometry::default()),
        |spawn, _| {
            calls += 1;
            let mut value = factory(spawn.raw_color);
            if calls == 2 {
                value.random_phase_unit = f64::NAN;
            }
            Ok(value)
        },
    );
    assert_eq!(
        result,
        Err(ClientPresentationError::Food(FoodError::InvalidInput))
    );
    assert_eq!(calls, 2);
    assert_eq!(c, before);
}

#[test]
fn food_factory_ownership_cannot_be_enabled_late_or_silently_dropped() {
    let mut c = AnimatedClient::new(0.).unwrap();
    c.apply_frame(&bundle(&[setup()]), ElapsedHeader::Absent)
        .unwrap();
    let before = c.clone();
    let result = c.apply_frame_with_factories::<ClientPresentationError, _, _>(
        &bundle(&[appearance(7, 2000)]),
        ElapsedHeader::Absent,
        |_| Ok(PairedFaceGeometry::default()),
        |_: &FoodSpawnInput, _| Ok(factory(0)),
    );
    assert_eq!(result, Err(ClientPresentationError::FoodModeRequiresReset));
    assert_eq!(c, before);
    c.reset();
    apply(&mut c, &[setup(), appearance(7, 2000)]);
    let before = c.clone();
    assert_eq!(
        c.apply_frame(
            &bundle(&[vec![b'f', 1, 2, 3, 4, 7, 5]]),
            ElapsedHeader::Absent
        ),
        Err(ClientPresentationError::FoodFactoryRequired)
    );
    assert_eq!(c, before);
}

#[test]
fn full_factories_retain_face_geometry_alongside_food_and_rollback_together() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let face = PairedFaceGeometry {
        eyes: StandardEyeGeometry {
            pupil_travel: 0.02,
            ..StandardEyeGeometry::default()
        },
        decoration: Some(PairedSideGeometry {
            forward: 11.,
            lateral: 7.,
            lateral_bias: 1.5,
            rotation_offset: 0.3,
            image_scale: 0.5,
            pivot_x: 8.,
            pivot_y: 19.,
            width: 53.,
            height: 27.,
        }),
    };
    c.apply_frame_with_factories::<ClientPresentationError, _, _>(
        &bundle(&[setup(), appearance(7, 2000), vec![b'f', 1, 2, 3, 4, 7, 5]]),
        ElapsedHeader::Absent,
        |_| Ok(face),
        |spawn, _| Ok(factory(spawn.raw_color)),
    )
    .unwrap();
    c.advance(4., false).unwrap();
    assert_eq!(c.own_snake().unwrap().face_geometry(), &face);
    assert_eq!(c.own_snake().unwrap().eyes().pupil().x, 0.02);
    assert_eq!(food(&c).len(), 1);
    let before = c.clone();
    assert!(
        c.apply_frame_with_factories::<ClientPresentationError, _, _>(
            &bundle(&[appearance(8, 3000), vec![b'b', 5, 6, 5]]),
            ElapsedHeader::Absent,
            |_| Ok(PairedFaceGeometry::default()),
            |spawn, _| {
                let mut invalid = factory(spawn.raw_color);
                invalid.random_wobble_unit = 1.;
                Ok(invalid)
            },
        )
        .is_err()
    );
    assert_eq!(c, before);
}
