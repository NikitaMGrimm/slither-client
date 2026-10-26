//! Original synthetic native cases; these do not execute an external runtime.

use slither_client::{
    presentation::*,
    state::{Direction, Point, PreyMotionInput, PreySpawnInput},
};
use std::f64::consts::PI;

fn source(handle: u64) -> PreySource {
    PreySource::new(
        BodyAsset {
            handle,
            revision: 3,
            width: 31,
            height: 37,
            status: BodyAssetStatus::Ready,
        },
        11.25,
        13.5,
        2.75,
        -0.,
    )
    .unwrap()
}
fn factory() -> PreyFactory {
    PreyFactory {
        random_phase_unit: 0.25,
        random_rate_unit: 0.5,
        palette: 0,
        bodies: (0..9).map(|i| source(100 + i)).collect(),
        glows: (0..3).map(|i| source(200 + i)).collect(),
    }
}
fn spawn(id: u16) -> PreySpawnInput {
    PreySpawnInput {
        id,
        absolute_position: Point { x: 10., y: 20. },
        size_byte: 5,
        base_size: 1.,
        raw_color: 9,
        direction: Direction::None,
        heading: 0.,
        wanted_heading: 0.,
        speed_per_32ms: 4.,
    }
}
fn motion(id: u16, x: f64, y: f64) -> PreyMotionInput {
    PreyMotionInput {
        id,
        absolute_position: Point { x, y },
        direction: None,
        heading: None,
        wanted_heading: None,
        speed_per_32ms: None,
    }
}
fn step(delta: f64) -> FrameStep {
    FrameClock::new(0.)
        .unwrap()
        .advance(delta * 8., false, false)
        .unwrap()
}
fn absent(_: SnakeObjectToken) -> Result<PreyEaterPose, PreyError> {
    panic!("uneaten prey must not resolve a snake")
}
fn pose() -> PreyEaterPose {
    PreyEaterPose {
        head: Point { x: 100., y: 200. },
        head_offset: Point { x: 2., y: 3. },
        heading: 0.,
        angle_offset: 0.,
    }
}
fn snapshot(w: &PreyWorld) -> PreySnapshot {
    w.preys()[0].snapshot()
}

#[test]
fn factory_freezes_independent_sources_entropy_and_fractional_metadata() {
    let mut w = PreyWorld::new();
    let mut f = factory();
    f.random_phase_unit = -0.;
    f.random_rate_unit = 0.75;
    let mut s = spawn(0);
    s.raw_color = 255;
    f.palette = 3;
    w.spawn(s, f.input(2.5)).unwrap();
    let p = snapshot(&w);
    assert_eq!(p.sources.indices, [2, 2]);
    assert_eq!(p.sources.family_counts, [9, 3]);
    assert_eq!(p.sources.body, f.bodies[2]);
    assert_eq!(p.sources.glow, f.glows[2]);
    assert_eq!(p.sources.body.half_width(), 2.75);
    assert_eq!(p.sources.body.half_height().to_bits(), (-0_f64).to_bits());
    assert_eq!(p.random_phase_unit.to_bits(), (-0_f64).to_bits());
    assert_eq!(p.glow_phase.to_bits(), (-0_f64).to_bits());
    assert_eq!(p.glow_rate.to_bits(), 0.7125_f64.to_bits());
    assert_eq!(
        (p.scale, p.fade, p.palette, p.creation_zoom),
        (0.00001, 0., 3, 2.5)
    );
    f.bodies.clear();
    f.glows.clear();
    assert_eq!(snapshot(&w).sources, p.sources);
}

#[test]
fn selection_boundaries_use_body_count_and_clamp_independently() {
    let f = factory();
    for (zoom, expected) in [
        (0.9999999999999999, 0),
        (1., 1),
        (1.0000000000000002, 1),
        (100., 8),
    ] {
        let mut w = PreyWorld::new();
        w.spawn(spawn(1), f.input(zoom)).unwrap();
        assert_eq!(snapshot(&w).sources.indices, [expected, 2]);
    }
    let mut w = PreyWorld::new();
    let mut s = spawn(2);
    s.size_byte = 0;
    s.base_size = 0.;
    w.spawn(s, f.input(100.)).unwrap();
    assert_eq!(snapshot(&w).sources.indices, [0, 2]);
    for raw in [0, 9, 18, 255] {
        let mut f = factory();
        f.palette = raw % 9;
        let mut s = spawn(0);
        s.raw_color = raw;
        let mut w = PreyWorld::new();
        w.spawn(s, f.input(1.)).unwrap();
        assert_eq!(
            (snapshot(&w).raw_color, snapshot(&w).palette),
            (raw, raw % 9)
        );
    }
}

#[test]
fn duplicate_zero_ids_select_newest_and_erase_stably() {
    let mut w = PreyWorld::new();
    let f = factory();
    let a = w.spawn(spawn(0), f.input(1.)).unwrap();
    let b = w.spawn(spawn(1), f.input(1.)).unwrap();
    let c = w.spawn(spawn(0), f.input(1.)).unwrap();
    let d = w.spawn(spawn(2), f.input(1.)).unwrap();
    assert_eq!(w.motion(motion(0, 50., 60.), 1.).unwrap(), Some(c));
    assert_eq!(w.preys()[0].snapshot().position, Point { x: 10., y: 20. });
    assert_eq!(w.remove(0), Some(c));
    assert_eq!(
        w.snapshots().map(|p| p.instance).collect::<Vec<_>>(),
        vec![a, b, d]
    );
    assert_eq!(w.motion(motion(0, 70., 80.), 1.).unwrap(), Some(a));
    assert_eq!(w.remove(555), None);
    assert_eq!(w.consume(0, None), Some(a));
    assert_eq!(
        w.snapshots().map(|p| p.instance).collect::<Vec<_>>(),
        vec![b, d]
    );
    w.clear();
    let e = w.spawn(spawn(0), f.input(1.)).unwrap();
    assert_eq!(e.serial(), 5);
}

#[test]
fn zero_delta_recomputes_spawn_and_capture_scales_without_ring_cleanup() {
    let mut w = PreyWorld::new();
    let f = factory();
    w.spawn(spawn(0), f.input(1.)).unwrap();
    w.motion(motion(0, 11., 22.), 1.).unwrap();
    let ring = snapshot(&w).corrections;
    w.advance(step(0.), 0.5, absent).unwrap();
    assert_eq!(snapshot(&w).scale, 0.);
    assert_eq!(snapshot(&w).corrections, ring);
    let token = SnakeObjectToken::new(1).unwrap();
    w.consume(0, Some(token));
    w.advance(step(0.), 0.5, |t| {
        assert_eq!(t, token);
        Ok(pose())
    })
    .unwrap();
    assert_eq!(snapshot(&w).scale, 1.);
    assert_eq!(snapshot(&w).corrections, ring);
}

#[test]
fn nonzero_primitive_uses_old_speed_new_heading_then_accumulates_float32() {
    let f = factory();
    let mut w = PreyWorld::new();
    w.spawn(spawn(0), f.input(1.)).unwrap();
    let mut m = motion(0, 30., 40.);
    m.heading = Some(PI / 2.);
    m.speed_per_32ms = Some(20.);
    w.motion_with_extrapolation(m, 16., 0.5).unwrap();
    let p = snapshot(&w);
    // Old speed four gives two units before lag, then one; new speed twenty must not give five.
    assert_eq!(p.position, Point { x: 30., y: 41. });
    assert_eq!(p.speed_per_32ms, 20.);
    assert_eq!(p.corrections.offset(), [-20., -21.]);
    assert_eq!(p.corrections.samples()[0][0], -20.);
    assert_eq!(p.corrections.samples()[1][0], -21.);
    w.motion(motion(0, 31., 43.), 1.).unwrap();
    let p = snapshot(&w);
    assert_eq!(p.position, Point { x: 31., y: 43. });
    assert_eq!(p.corrections.offset(), [-21., -23.]);
    assert_eq!(p.corrections.index(), 0);
    assert_eq!(p.corrections.pending(), 53);
}

#[test]
fn ring_wrap_overlap_final_sample_and_delayed_cleanup_are_exact() {
    let f = factory();
    let mut w = PreyWorld::new();
    let mut s = spawn(0);
    s.speed_per_32ms = 0.;
    w.spawn(s, f.input(1.)).unwrap();
    w.motion(motion(0, 63., 126.), 1.).unwrap();
    let original = snapshot(&w).corrections;
    assert_eq!((original.weights()[0], original.weights()[52]), (1., 0.));
    assert_eq!(original.samples()[0][26], -26.5);
    let mut one = step(0.);
    one.whole_steps = 51;
    w.advance(one, 0., absent).unwrap();
    let p = snapshot(&w);
    assert_eq!(p.corrections.index(), 51);
    assert_eq!(p.corrections.pending(), 2);
    assert_eq!(
        p.corrections.offset()[0],
        f64::from(original.samples()[0][50])
    );
    assert!(
        p.corrections.samples()[0][..51]
            .iter()
            .all(|x| x.to_bits() == 0)
    );
    w.motion(motion(0, 65., 130.), 1.).unwrap();
    let injected = snapshot(&w).corrections;
    assert_eq!(
        injected.samples()[0][51],
        (f64::from(original.samples()[0][51]) - 2.) as f32
    );
    assert_eq!(
        injected.samples()[0][0],
        (-2. * f64::from(injected.weights()[2])) as f32
    );
    one.whole_steps = 53;
    w.advance(one, 0., absent).unwrap();
    let exhausted = snapshot(&w).corrections;
    assert_eq!((exhausted.index(), exhausted.pending()), (51, 0));
    assert_eq!(
        exhausted.offset(),
        [
            f64::from(injected.samples()[0][50]),
            f64::from(injected.samples()[1][50])
        ]
    );
    w.advance(step(0.), 0., absent).unwrap();
    assert_eq!(snapshot(&w).corrections, exhausted);
    one.whole_steps = 1;
    w.advance(one, 0., absent).unwrap();
    assert_eq!(snapshot(&w).corrections.pending(), -1);
    assert_eq!(snapshot(&w).corrections.offset(), [0., 0.]);
}

#[test]
fn float32_ties_round_each_accumulated_assignment() {
    let f = factory();
    let mut w = PreyWorld::new();
    let mut s = spawn(0);
    s.absolute_position = Point { x: 0., y: 0. };
    w.spawn(s, f.input(1.)).unwrap();
    w.motion(motion(0, 16_777_216., 0.), 1.).unwrap();
    w.motion(motion(0, 16_777_217., 0.), 1.).unwrap();
    assert_eq!(snapshot(&w).corrections.samples()[0][0], -16_777_216.);
    w.motion(motion(0, 16_777_219., 0.), 1.).unwrap();
    assert_eq!(snapshot(&w).corrections.samples()[0][0], -16_777_218.);
}

#[test]
fn float32_underflow_preserves_negative_zero_until_each_slot_is_cleared() {
    let f = factory();
    let mut w = PreyWorld::new();
    let mut s = spawn(0);
    s.absolute_position = Point { x: 0., y: 0. };
    s.speed_per_32ms = 0.;
    w.spawn(s, f.input(1.)).unwrap();
    w.motion(motion(0, f64::MIN_POSITIVE, 0.), 1.).unwrap();
    let p = snapshot(&w);
    assert_eq!(p.corrections.offset()[0].to_bits(), (-0_f64).to_bits());
    assert_eq!(p.corrections.samples()[0][0].to_bits(), (-0_f32).to_bits());
    assert_eq!(p.corrections.samples()[0][52].to_bits(), 0_f32.to_bits());
    // Equal packets still inject, retaining the existing signed-zero sample.
    w.motion(motion(0, f64::MIN_POSITIVE, 0.), 1.).unwrap();
    let mut first = step(0.);
    first.whole_steps = 1;
    w.advance(first, 0., absent).unwrap();
    let p = snapshot(&w);
    assert_eq!(p.corrections.offset()[0].to_bits(), (-0_f64).to_bits());
    assert_eq!(p.corrections.samples()[0][0].to_bits(), 0_f32.to_bits());
    assert_eq!((p.corrections.index(), p.corrections.pending()), (1, 52));
}

#[test]
fn active_turn_strict_crossings_half_turn_and_endpoint_are_preserved() {
    let f = factory();
    for (dir, h, wanted, turn, expected, expected_dir) in [
        (
            Direction::Increasing,
            0.,
            0.5,
            0.5,
            0.5,
            Direction::Increasing,
        ),
        (Direction::Increasing, 0., 0.5, 0.75, 0.5, Direction::None),
        (
            Direction::Decreasing,
            1.,
            0.5,
            0.5,
            0.5,
            Direction::Decreasing,
        ),
        (Direction::Decreasing, 1., 0.5, 0.75, 0.5, Direction::None),
        (Direction::Decreasing, 0., PI, 0., PI, Direction::None),
        (Direction::Increasing, 0., PI, 0., 0., Direction::Increasing),
        (Direction::None, 0., 2. * PI, 0.5, 2. * PI, Direction::None),
        (
            Direction::Increasing,
            2. * PI,
            0.,
            0.,
            0.,
            Direction::Increasing,
        ),
    ] {
        let mut w = PreyWorld::new();
        let mut s = spawn(0);
        s.direction = dir;
        s.heading = h;
        s.wanted_heading = wanted;
        s.speed_per_32ms = 0.;
        w.spawn(s, f.input(1.)).unwrap();
        w.advance(step(1.), turn, absent).unwrap();
        let p = snapshot(&w);
        assert_eq!(p.heading.to_bits(), expected.to_bits());
        assert_eq!(p.direction, expected_dir);
    }
    let mut w = PreyWorld::new();
    let mut s = spawn(0);
    s.wanted_heading = -0.;
    s.speed_per_32ms = 0.;
    w.spawn(s, f.input(1.)).unwrap();
    w.advance(step(0.), 0., absent).unwrap();
    assert_eq!(snapshot(&w).heading.to_bits(), (-0_f64).to_bits());
}

#[test]
fn travel_is_uncapped_and_fade_and_phase_follow_fractional_units() {
    let f = factory();
    let mut w = PreyWorld::new();
    let mut s = spawn(0);
    s.speed_per_32ms = 1000.;
    w.spawn(s, f.input(1.)).unwrap();
    w.advance(step(2.), 0., absent).unwrap();
    let p = snapshot(&w);
    assert_eq!(p.position, Point { x: 510., y: 20. });
    assert_eq!(p.fade, 1. / 75.);
    assert_eq!(p.glow_phase, 17.35);
    // Independently authored two-stage spawn easing, evaluated with native cosine only.
    let first = (1. - (PI / 75.).cos()) / 2.;
    let expected = first + ((1. - (PI * first).cos()) / 2. - first) * 0.66;
    assert_eq!(p.scale.to_bits(), expected.to_bits());
}

#[test]
fn repeated_capture_retargets_without_resetting_motion_fade_or_rings() {
    let f = factory();
    let mut w = PreyWorld::new();
    let i = w.spawn(spawn(0), f.input(1.)).unwrap();
    let a = SnakeObjectToken::new(1).unwrap();
    let b = SnakeObjectToken::new(2).unwrap();
    w.motion(motion(0, 20., 30.), 1.).unwrap();
    w.consume(0, Some(a));
    w.advance(step(5.), 0., |_| Ok(pose())).unwrap();
    let old = snapshot(&w);
    assert_eq!(old.position, Point { x: 25., y: 30. });
    assert_eq!(old.fade, 1. / 30.);
    assert_eq!(old.consumption_progress, 5. / 47.);
    assert_eq!(old.scale, 1. - (5_f64 / 47.).powf(3.));
    assert_eq!(w.consume(0, Some(b)), Some(i));
    let p = snapshot(&w);
    assert_eq!(p.eater, Some(b));
    assert_eq!(p.consumption_progress, 0.);
    assert_eq!(
        (p.scale, p.fade, p.position, p.corrections),
        (old.scale, old.fade, old.position, old.corrections)
    );
    assert_eq!(w.referenced_eaters().collect::<Vec<_>>(), vec![b]);
    w.consume(0, None);
    assert!(w.preys().is_empty());
    assert_eq!(w.referenced_eaters().count(), 0);
}

#[test]
fn reverse_update_and_expiry_stably_preserve_survivors() {
    let f = factory();
    let mut w = PreyWorld::new();
    for id in 0..4 {
        w.spawn(spawn(id), f.input(1.)).unwrap();
    }
    for id in [0, 2, 3] {
        w.consume(id, Some(SnakeObjectToken::new(u64::from(id) + 1).unwrap()));
    }
    let mut order = Vec::new();
    w.advance(step(0.), 0., |token| {
        order.push(token.serial());
        Ok(pose())
    })
    .unwrap();
    assert_eq!(order, vec![4, 3, 1]);
    for _ in 0..10 {
        w.advance(step(5.), 0., |_| Ok(pose())).unwrap();
    }
    assert_eq!(w.snapshots().map(|p| p.id).collect::<Vec<_>>(), vec![1]);
}

#[test]
fn invalid_input_source_arithmetic_and_lost_eater_roll_back_exactly() {
    let f = factory();
    let mut w = PreyWorld::new();
    w.spawn(spawn(0), f.input(1.)).unwrap();
    let before = w.clone();
    for bad in [f64::NAN, f64::INFINITY, -1.] {
        let mut f = factory();
        f.random_rate_unit = bad;
        assert!(w.spawn(spawn(1), f.input(1.)).is_err());
        assert_eq!(w, before);
    }
    let mut f = factory();
    f.glows[0] = source(100);
    let mut a = f.glows[0].asset();
    a.revision = 4;
    f.glows[0] = PreySource::new(a, 1., 1., 0., 0.).unwrap();
    assert_eq!(
        w.spawn(spawn(1), f.input(1.)),
        Err(PreyError::InvalidSource)
    );
    assert_eq!(w, before);
    assert!(w.motion(motion(999, f64::NAN, 0.), 1.).is_err());
    assert_eq!(w, before);
    assert_eq!(
        w.motion(motion(0, f64::MAX, 0.), 1.),
        Err(PreyError::Arithmetic)
    );
    assert_eq!(w, before);
    let t = SnakeObjectToken::new(7).unwrap();
    w.consume(0, Some(t));
    let before = w.clone();
    assert_eq!(
        w.advance(step(1.), 0., |t| Err(PreyError::MissingEater(t))),
        Err(PreyError::MissingEater(t))
    );
    assert_eq!(w, before);
    let mut bad = step(0.);
    bad.delta = f64::NAN;
    assert!(w.advance(bad, 0., absent).is_err());
    assert_eq!(w, before);
}

#[test]
fn retention_and_family_limits_are_exact_and_transactional() {
    let f = factory();
    let mut w = PreyWorld::new();
    for _ in 0..MAX_RETAINED_PREYS {
        w.spawn(spawn(0), f.input(1.)).unwrap();
    }
    assert_eq!(w.spawn(spawn(0), f.input(1.)), Err(PreyError::Capacity));
    assert_eq!(w.preys().last().unwrap().snapshot().instance.serial(), 4096);
    w.clear();
    let mut f = factory();
    f.bodies = vec![source(1); 4096];
    f.glows = vec![source(2); 1];
    assert!(w.spawn(spawn(0), f.input(1.)).is_ok());
    let before = w.clone();
    f.bodies.push(source(1));
    assert_eq!(
        w.spawn(spawn(0), f.input(1.)),
        Err(PreyError::InvalidPalette)
    );
    assert_eq!(w, before);
    f.bodies.clear();
    assert_eq!(
        w.spawn(spawn(0), f.input(1.)),
        Err(PreyError::InvalidPalette)
    );
    assert_eq!(w, before);
    f.bodies = vec![source(1)];
    f.glows = vec![source(2); 4096];
    assert!(w.spawn(spawn(0), f.input(1.)).is_ok());
    let before = w.clone();
    f.glows.push(source(2));
    assert_eq!(
        w.spawn(spawn(0), f.input(1.)),
        Err(PreyError::InvalidPalette)
    );
    assert_eq!(w, before);
}
