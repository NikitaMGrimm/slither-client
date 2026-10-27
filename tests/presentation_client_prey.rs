//! Authored prey packet/lifecycle integration; no external source or assets.

use slither_client::{
    presentation::{
        AnimatedClient, BodyAsset, BodyAssetStatus, ClientPresentationError, FoodSource,
        PairedFaceGeometry, PreyFactory, PreySnapshot,
    },
    protocol::ElapsedHeader,
};
use std::{cell::RefCell, rc::Rc};

fn u24(n: u32) -> [u8; 3] {
    [(n >> 16) as u8, (n >> 8) as u8, n as u8]
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
fn snake(id: u16, x: u32) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.extend(u24(0));
    p.push(b'0');
    p.extend(u24(0));
    p.extend(1000_u16.to_be_bytes());
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
fn spawn(id: u16, x: u32) -> Vec<u8> {
    let mut p = vec![b'y'];
    p.extend(id.to_be_bytes());
    p.push(9);
    p.extend(u24(x * 5));
    p.extend(u24(5000));
    p.extend([20, b'0']);
    p.extend(u24(0));
    p.extend(u24(0));
    p.extend(1000_u16.to_be_bytes());
    p
}
fn remove(id: u16) -> Vec<u8> {
    let mut p = vec![b'y'];
    p.extend(id.to_be_bytes());
    p
}
fn capture(id: u16, eater: u16) -> Vec<u8> {
    let mut p = remove(id);
    p.extend(eater.to_be_bytes());
    p
}
fn raster(handle: u64) -> FoodSource {
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
fn factory(raw: u8) -> PreyFactory {
    PreyFactory {
        random_phase_unit: 0.25,
        random_rate_unit: 0.5,
        palette: raw % 9,
        bodies: vec![raster(100), raster(101)],
        glows: vec![raster(102), raster(103), raster(104)],
    }
}
fn apply(client: &mut AnimatedClient, commands: &[Vec<u8>]) {
    client
        .apply_frame_with_all_factories::<ClientPresentationError, _, _, _>(
            &bundle(commands),
            ElapsedHeader::Absent,
            |_| Ok(PairedFaceGeometry::default()),
            |_, _| Err(ClientPresentationError::FoodFactoryRequired),
            |p, _| Ok(factory(p.raw_color)),
        )
        .unwrap();
}
fn states(c: &AnimatedClient) -> Vec<PreySnapshot> {
    c.preys().snapshots().collect()
}

#[test]
fn creation_is_opt_in_and_a_late_enable_requires_reset() {
    let mut c = AnimatedClient::new(0.).unwrap();
    c.apply_frame(&bundle(&[setup(), spawn(1, 2100)]), ElapsedHeader::Absent)
        .unwrap();
    assert!(!c.prey_enabled());
    assert!(states(&c).is_empty());
    assert_eq!(c.received().ignored_commands, 0);
    let old = c.clone();
    assert!(
        c.apply_frame_with_all_factories::<ClientPresentationError, _, _, _>(
            &bundle(&[setup()]),
            ElapsedHeader::Absent,
            |_| Ok(PairedFaceGeometry::default()),
            |_, _| Err(ClientPresentationError::FoodFactoryRequired),
            |p, _| Ok(factory(p.raw_color))
        )
        .is_err()
    );
    assert_eq!(c, old);
    c.reset();
    apply(&mut c, &[setup(), spawn(1, 2100)]);
    assert!(c.prey_enabled());
    assert!(c.food_enabled());
    assert_eq!(states(&c).len(), 1);
    let s = states(&c).remove(0);
    assert_eq!(s.palette, 0);
    assert_eq!(s.sources.family_counts, [2, 3]);
    assert_eq!(s.sources.indices[1], 2);
    assert_eq!(s.scale.to_bits(), 0.00001_f64.to_bits());
}

#[test]
fn captured_eater_survives_removal_and_reuse_until_last_prey_reference() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(
        &mut c,
        &[
            setup(),
            snake(7, 2000),
            snake(8, 2200),
            spawn(31, 2190),
            spawn(32, 2180),
            capture(31, 8),
            capture(32, 8),
        ],
    );
    let token = states(&c)[0].eater.unwrap();
    c.apply_frame(&bundle(&[vec![b's', 0, 8, 0]]), ElapsedHeader::Absent)
        .unwrap();
    assert!(c.snake(8).is_none());
    assert!(c.snake_object(token).is_some());
    let frozen = c.snake_object(token).unwrap().clone();
    apply(&mut c, &[snake(8, 2500), spawn(33, 2490), capture(33, 8)]);
    assert_ne!(states(&c)[2].eater, Some(token));
    c.advance(8., false).unwrap();
    assert_eq!(c.snake_object(token), Some(&frozen));
    c.apply_frame(&bundle(&[remove(31)]), ElapsedHeader::Absent)
        .unwrap();
    assert!(c.snake_object(token).is_some());
    c.apply_frame(&bundle(&[remove(32)]), ElapsedHeader::Absent)
        .unwrap();
    assert!(c.snake_object(token).is_none());
    assert_eq!(states(&c).iter().map(|p| p.id).collect::<Vec<_>>(), [33]);
}

#[test]
fn duplicate_remove_exposes_older_and_missing_eater_erases_immediately() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(
        &mut c,
        &[setup(), spawn(31, 2000), spawn(32, 2100), spawn(31, 2200)],
    );
    let original = states(&c);
    c.apply_frame(&bundle(&[capture(31, 999)]), ElapsedHeader::Absent)
        .unwrap();
    assert_eq!(states(&c), original[..2]);
    let mut motion = vec![b'j', 0, 31];
    motion.extend(700_u16.to_be_bytes());
    motion.extend(400_u16.to_be_bytes());
    c.apply_frame(&bundle(&[motion]), ElapsedHeader::Absent)
        .unwrap();
    let current = states(&c);
    assert_eq!(current[0].position.x, 2101.);
    assert_eq!(current[0].position.y, 1201.);
    assert_eq!(current[0].corrections.pending(), 53);
    assert_eq!(current[1], original[1]);
    c.apply_frame(&bundle(&[remove(31)]), ElapsedHeader::Absent)
        .unwrap();
    assert_eq!(states(&c).iter().map(|p| p.id).collect::<Vec<_>>(), [32]);
}

#[test]
fn zero_delta_capture_and_reset_keep_clock_phase_but_clear_entities() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), snake(7, 2000), spawn(31, 2100)]);
    let old_serial = states(&c)[0].instance.serial();
    c.advance(0., false).unwrap();
    assert_eq!(states(&c)[0].scale.to_bits(), 0_f64.to_bits());
    c.apply_frame(&bundle(&[capture(31, 7)]), ElapsedHeader::Absent)
        .unwrap();
    c.advance(0., false).unwrap();
    assert_eq!(states(&c)[0].scale, 1.);
    assert_eq!(states(&c)[0].consumption_progress, 0.);
    c.advance(3., false).unwrap();
    c.set_follows(false);
    c.reset();
    assert!(c.prey_enabled());
    assert!(states(&c).is_empty());
    assert!(!c.camera().follows());
    apply(&mut c, &[setup(), spawn(31, 2100)]);
    assert!(states(&c)[0].instance.serial() > old_serial);
    assert_eq!(c.advance(8., false).unwrap().whole_steps, 1);
}

#[test]
fn malformed_late_packets_run_no_callbacks_and_numeric_failure_rolls_back() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), snake(7, 2000)]);
    let old = c.clone();
    let calls = Rc::new(RefCell::new(Vec::new()));
    let face = calls.clone();
    let prey = calls.clone();
    let invalid = bundle(&[snake(8, 2200), spawn(31, 2100), vec![b'j', 0, 31]]);
    assert!(
        c.apply_frame_with_all_factories::<ClientPresentationError, _, _, _>(
            &invalid,
            ElapsedHeader::Absent,
            |_| {
                face.borrow_mut().push("face");
                Ok(PairedFaceGeometry::default())
            },
            |_, _| Err(ClientPresentationError::FoodFactoryRequired),
            |p, _| {
                prey.borrow_mut().push("prey");
                Ok(factory(p.raw_color))
            }
        )
        .is_err()
    );
    assert!(calls.borrow().is_empty());
    assert_eq!(c, old);
    let result = c.apply_frame_with_all_factories::<ClientPresentationError, _, _, _>(
        &bundle(&[spawn(31, 2100)]),
        ElapsedHeader::Absent,
        |_| Ok(PairedFaceGeometry::default()),
        |_, _| Err(ClientPresentationError::FoodFactoryRequired),
        |p, _| {
            calls.borrow_mut().push("prey");
            let mut f = factory(p.raw_color);
            f.random_rate_unit = 1.;
            Ok(f)
        },
    );
    assert!(matches!(result, Err(ClientPresentationError::Prey(_))));
    assert_eq!(&*calls.borrow(), &["prey"]);
    assert_eq!(c, old);
}

#[test]
fn old_apply_routes_can_update_retained_prey_but_cannot_create_without_a_factory() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), spawn(31, 2100)]);
    let old = c.clone();
    assert_eq!(
        c.apply_frame(&bundle(&[spawn(32, 2200)]), ElapsedHeader::Absent),
        Err(ClientPresentationError::PreyFactoryRequired)
    );
    assert_eq!(c, old);
    c.apply_frame_with_factories::<ClientPresentationError, _, _>(
        &bundle(&[remove(31)]),
        ElapsedHeader::Absent,
        |_| Ok(PairedFaceGeometry::default()),
        |_, _| Err(ClientPresentationError::FoodFactoryRequired),
    )
    .unwrap();
    assert!(states(&c).is_empty());
    assert!(c.prey_enabled());
}
