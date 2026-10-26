//! Independently authored synthetic native food cases; no reference execution or assets.

use slither_client::{presentation::*, state::Point};

fn source(handle: u64, width: f64) -> FoodSource {
    FoodSource::new(
        BodyAsset {
            handle,
            revision: 7,
            width: 29,
            height: 31,
            status: BodyAssetStatus::Ready,
        },
        width,
        9.5,
        width / 2.,
        4.75,
    )
    .unwrap()
}

struct Palette {
    body: Vec<FoodSource>,
    outline: Vec<FoodSource>,
    glow: Vec<FoodSource>,
}
impl Palette {
    fn new(n: usize) -> Self {
        Self {
            body: (0..n)
                .map(|i| source(100 + i as u64, 7. + i as f64))
                .collect(),
            outline: (0..n)
                .map(|i| source(200 + i as u64, 11. + i as f64))
                .collect(),
            glow: (0..n)
                .map(|i| source(300 + i as u64, 17. + i as f64))
                .collect(),
        }
    }
    fn input(&self, color: u8, phase: f64, wobble: f64, zoom: f64) -> FoodFactoryInput<'_> {
        FoodFactoryInput {
            random_phase_unit: phase,
            random_wobble_unit: wobble,
            creation_zoom: zoom,
            palette: FoodPalette {
                palette: color,
                image_count: self.body.len(),
                bodies: &self.body,
                outlines: &self.outline,
                glows: &self.glow,
            },
        }
    }
}
fn spawn(key: u32) -> FoodSpawn {
    FoodSpawn {
        key,
        sector: (2, 3),
        position: Point { x: 10., y: 20. },
        base_size: 4.,
        raw_color: 0,
        rapid: false,
    }
}
fn step(delta: f64) -> FrameStep {
    FrameClock::new(0.)
        .unwrap()
        .advance(delta * 8., false, false)
        .unwrap()
}
fn no_eater(_: SnakeObjectToken) -> Result<FoodEaterPose, FoodError> {
    panic!("unexpected eater lookup")
}
fn pose() -> FoodEaterPose {
    FoodEaterPose {
        head: Point {
            x: 88.125,
            y: -37.75,
        },
        head_offset: Point { x: 2.375, y: -1.25 },
        heading: 1.25,
        angle_offset: -0.3,
    }
}
fn snapshot(world: &FoodWorld) -> FoodSnapshot {
    world.foods()[0].snapshot()
}
fn add(world: &mut FoodWorld, palette: &Palette, key: u32) -> FoodInstance {
    world
        .spawn(spawn(key), palette.input(0, 0.25, 0.75, 0.9))
        .unwrap()
}

#[test]
fn factory_retains_independent_randoms_and_preupdate_tiny_state() {
    let p = Palette::new(8);
    let last = f64::from_bits(1_f64.to_bits() - 1);
    for phase in [0., 0.5, last] {
        for wobble in [0., 0.5, last] {
            let mut world = FoodWorld::new();
            world
                .spawn(spawn(1), p.input(0, phase, wobble, 0.9))
                .unwrap();
            let f = snapshot(&world);
            assert_eq!(f.render_position, spawn(1).position);
            assert_eq!(f.animation_phase, phase * 64.);
            assert_eq!(f.wobble_rate, (2. * wobble - 1.) * 0.0225);
            assert_eq!(f.animation_rate, 1.05);
            assert_eq!((f.fade, f.scale, f.uneaten_scale), (0., 0.00001, 0.00001));
            assert_eq!(
                (f.eaten, f.consumption_progress, f.eater),
                (false, 0., None)
            );
            world.advance(step(0.), no_eater).unwrap();
            let f = snapshot(&world);
            assert_eq!((f.fade, f.scale, f.uneaten_scale), (0., 0., 0.));
            assert_eq!(
                f.render_position.x,
                10. + (f.wobble_rate * phase * 64.).cos() * 6.
            );
            assert_eq!(
                f.render_position.y,
                20. + (f.wobble_rate * phase * 64.).sin() * 6.
            );
        }
    }
}

#[test]
fn colors_keep_nine_and_only_normalize_values_above_it() {
    let p = Palette::new(2);
    let mut world = FoodWorld::new();
    for (raw, expected) in [(0, 0), (9, 9), (10, 1), (18, 0), (255, 3)] {
        assert_eq!(food_palette(raw), expected);
        let input = FoodSpawn {
            raw_color: raw,
            ..spawn(u32::from(raw))
        };
        world.spawn(input, p.input(expected, 0., 0., 1.)).unwrap();
        let f = world.foods().last().unwrap().snapshot();
        assert_eq!((f.raw_color, f.effective_palette), (raw, expected));
    }
    let before = world.clone();
    assert_eq!(
        world.spawn(spawn(42), p.input(9, 0., 0., 1.)),
        Err(FoodError::InvalidPalette)
    );
    assert_eq!(world, before);
}

#[test]
fn index_order_floor_clamp_same_glow_family_and_source_freezing() {
    let p = Palette::new(2);
    let mut world = FoodWorld::new();
    // An authored rounding witness: dividing size before multiplication gives
    // 0.9999999999999999 and would select the wrong body source.
    let zoom = 15. / 37.;
    world
        .spawn(
            FoodSpawn {
                base_size: 20.349999999999998,
                ..spawn(1)
            },
            p.input(0, 0., 0., zoom),
        )
        .unwrap();
    let f = snapshot(&world);
    assert_eq!(f.sources.indices, [1, 0, 1]);
    assert_eq!(f.sources.body, p.body[1]);
    assert_eq!(f.sources.outline, p.outline[1]);
    assert_eq!(f.sources.inner, p.glow[0]);
    assert_eq!(f.sources.outer, p.glow[1]);
    assert_eq!(f.creation_zoom, zoom);

    let p = Palette::new(8);
    let mut world = FoodWorld::new();
    world
        .spawn(
            FoodSpawn {
                base_size: 0.,
                ..spawn(2)
            },
            p.input(0, 0., 0.5, 1.),
        )
        .unwrap();
    assert_eq!(snapshot(&world).sources.indices, [0, 2, 4]);
    assert_eq!(snapshot(&world).sources.inner, p.glow[2]);
    assert_eq!(snapshot(&world).sources.outer, p.glow[4]);
    world
        .spawn(
            FoodSpawn {
                base_size: 51.,
                ..spawn(3)
            },
            p.input(0, 0., 0., 100.),
        )
        .unwrap();
    assert_eq!(world.foods()[1].snapshot().sources.indices, [7, 7, 7]);
    let before = snapshot(&world).sources;
    let mut later = Palette::new(1);
    later.body[0] = source(909, 13.25);
    world.spawn(spawn(4), later.input(0, 0., 0., 2.)).unwrap();
    assert_eq!(snapshot(&world).sources, before);
    assert_eq!(world.foods()[2].snapshot().sources.body.asset().handle, 909);
}

#[test]
fn ordered_indices_straddle_creation_zoom_boundary_without_later_reselection() {
    let p = Palette::new(8);
    let mut world = FoodWorld::new();
    let exact: f64 = 16.5 / (8. * 4.);
    for z in [
        f64::from_bits(exact.to_bits() - 1),
        exact,
        f64::from_bits(exact.to_bits() + 1),
    ] {
        world.spawn(spawn(0), p.input(0, 0.5, 0.5, z)).unwrap();
    }
    assert_eq!(
        world
            .foods()
            .iter()
            .map(|f| f.snapshot().sources.indices[0])
            .collect::<Vec<_>>(),
        [0, 1, 1]
    );
    let indices = world
        .foods()
        .iter()
        .map(|f| f.snapshot().sources)
        .collect::<Vec<_>>();
    world.advance(step(5.), no_eater).unwrap();
    assert_eq!(
        world
            .foods()
            .iter()
            .map(|f| f.snapshot().sources)
            .collect::<Vec<_>>(),
        indices
    );
}

#[test]
fn source_metadata_keeps_numeric_odd_halves_and_requires_ready_valid_intrinsics() {
    let asset = source(1, 7.).asset();
    let s = FoodSource::new(asset, 7.25, 11.5, 3.625, 5.75).unwrap();
    assert_eq!(
        (s.width(), s.height(), s.half_width(), s.half_height()),
        (7.25, 11.5, 3.625, 5.75)
    );
    for width in [0., -1., f64::NAN, f64::INFINITY] {
        assert_eq!(
            FoodSource::new(asset, width, 1., 0., 0.),
            Err(FoodError::InvalidSource)
        );
    }
    assert!(FoodSource::new(asset, 1., 1., -0.5, 0.).is_err());
    assert!(FoodSource::new(asset, 1., 1., 0., f64::NAN).is_err());
    for status in [BodyAssetStatus::Pending, BodyAssetStatus::Unsupported] {
        assert_eq!(
            FoodSource::new(BodyAsset { status, ..asset }, 1., 1., 0.5, 0.5),
            Err(FoodError::SourceNotReady)
        );
    }
    for width in [0, 65_536] {
        assert_eq!(
            FoodSource::new(BodyAsset { width, ..asset }, 1., 1., 0.5, 0.5),
            Err(FoodError::InvalidSource)
        );
    }
}

#[test]
fn invalid_factory_inputs_preserve_instances_and_serials() {
    let p = Palette::new(8);
    let mut world = FoodWorld::new();
    let first = add(&mut world, &p, 0);
    let before = world.clone();
    for invalid in [-1., 1., f64::INFINITY, f64::NAN] {
        for first_random in [false, true] {
            let mut input = p.input(0, 0.5, 0.5, 1.);
            if first_random {
                input.random_phase_unit = invalid;
            } else {
                input.random_wobble_unit = invalid;
            }
            assert_eq!(world.spawn(spawn(1), input), Err(FoodError::InvalidInput));
            assert_eq!(world, before);
        }
    }
    for invalid in [-1., f64::INFINITY, f64::NAN] {
        assert!(
            world
                .spawn(
                    FoodSpawn {
                        base_size: invalid,
                        ..spawn(1)
                    },
                    p.input(0, 0., 0., 1.)
                )
                .is_err()
        );
        assert_eq!(world, before);
    }
    for invalid in [0., -1., f64::INFINITY, f64::NAN] {
        assert!(world.spawn(spawn(1), p.input(0, 0., 0., invalid)).is_err());
        assert_eq!(world, before);
    }
    let mut short = p.input(0, 0., 0., 1.);
    short.palette.glows = &p.glow[..1];
    assert_eq!(world.spawn(spawn(1), short), Err(FoodError::InvalidPalette));
    assert_eq!(world, before);
    assert!(
        world
            .spawn(
                FoodSpawn {
                    position: Point { x: f64::NAN, y: 0. },
                    ..spawn(1)
                },
                p.input(0, 0., 0., 1.)
            )
            .is_err()
    );
    assert_eq!(world, before);
    let mut empty = p.input(0, 0., 0., 1.);
    empty.palette.image_count = 0;
    assert_eq!(world.spawn(spawn(1), empty), Err(FoodError::InvalidPalette));
    assert_eq!(world, before);
    assert_eq!(add(&mut world, &p, 1).serial(), first.serial() + 1);
}

#[test]
fn zero_base_size_uses_size_independent_fade_and_wobble() {
    let p = Palette::new(8);
    let mut world = FoodWorld::new();
    world
        .spawn(
            FoodSpawn {
                base_size: 0.,
                ..spawn(1)
            },
            p.input(0, 0., 0.5, 1.),
        )
        .unwrap();
    world.advance(step(5.), no_eater).unwrap();
    let f = snapshot(&world);
    assert_eq!(f.animation_phase, 3.25);
    assert_eq!(f.fade, 5. / 150.);
    assert!(f.scale > 0.);
    assert_eq!(f.render_position, Point { x: 16., y: 20. });
}

#[test]
fn fractional_equal_backward_long_pause_and_disconnected_shared_steps() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    add(&mut world, &p, 1);
    let mut clock = FrameClock::new(0.).unwrap();
    let mut phase = snapshot(&world).animation_phase;
    let mut fade = 0.;
    for (now, lagging) in [
        (3., false),
        (8., false),
        (8., false),
        (-2., false),
        (100_000., true),
        (100_003., true),
        (100_008., false),
    ] {
        let shared = clock.advance(now, lagging, false).unwrap();
        phase += shared.delta * 1.05;
        fade += shared.delta / 150.;
        // Connection is deliberately no input to the food world.
        world.advance(shared, no_eater).unwrap();
        assert_eq!(snapshot(&world).animation_phase, phase);
        assert_eq!(snapshot(&world).fade, fade);
    }
    let mut deliberately_irrelevant = step(0.);
    deliberately_irrelevant.whole_steps = u32::MAX;
    deliberately_irrelevant.double_steps = u32::MAX;
    deliberately_irrelevant.unlagged_delta = f64::NAN;
    deliberately_irrelevant.accumulated = f64::NAN;
    world.advance(deliberately_irrelevant, no_eater).unwrap();
    assert_eq!(snapshot(&world).animation_phase, phase);
}

#[test]
fn rapid_and_slow_two_stage_fade_and_exact_one_boundary() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    world.spawn(spawn(1), p.input(0, 0., 0., 1.)).unwrap();
    world
        .spawn(
            FoodSpawn {
                rapid: true,
                ..spawn(2)
            },
            p.input(0, 0., 0., 1.),
        )
        .unwrap();
    for _ in 0..9 {
        world.advance(step(5.), no_eater).unwrap();
    }
    let slow = world.foods()[0].snapshot();
    let rapid = world.foods()[1].snapshot();
    let mut expected_slow = 0.;
    let mut expected_rapid = 0.;
    for _ in 0..9 {
        expected_slow += 5. / 150.;
        expected_rapid += 3. * 5. / 150.;
    }
    assert_eq!(slow.fade, expected_slow);
    assert_eq!(rapid.fade, expected_rapid);
    for f in [slow, rapid] {
        let first = 0.5 * (1. - (std::f64::consts::PI * f.fade).cos());
        let expected = first + (0.5 * (1. - (std::f64::consts::PI * first).cos()) - first) * 0.66;
        assert_eq!(f.scale, expected);
        assert_eq!(f.uneaten_scale, expected);
    }
    world.advance(step(5.), no_eater).unwrap();
    assert!(world.foods()[1].snapshot().fade < 1.);
    world.advance(step(0.000_001), no_eater).unwrap();
    let rapid = world.foods()[1].snapshot();
    assert_eq!((rapid.fade, rapid.scale, rapid.uneaten_scale), (1., 1., 1.));
    world.advance(step(0.), no_eater).unwrap();
    assert_eq!(world.foods()[1].snapshot().scale, 1.);

    let mut exact = FoodWorld::new();
    exact
        .spawn(
            FoodSpawn {
                rapid: true,
                ..spawn(0)
            },
            p.input(0, 0., 0., 1.),
        )
        .unwrap();
    // This schedule adds exactly 1/16 each time, reaching equality without overshoot.
    for _ in 0..15 {
        exact.advance(step(3.125), no_eater).unwrap();
    }
    assert_eq!(snapshot(&exact).fade, 15. / 16.);
    exact.advance(step(3.125), no_eater).unwrap();
    let f = snapshot(&exact);
    assert_eq!((f.fade, f.scale, f.uneaten_scale), (1., 1., 1.));
}

#[test]
fn consumes_freeze_fade_baseline_and_repeat_on_newest_eaten_instance() {
    let p = Palette::new(3);
    let mut world = FoodWorld::new();
    let older = add(&mut world, &p, 7);
    let newest = add(&mut world, &p, 7);
    let token = SnakeObjectToken::new(101).unwrap();
    world.advance(step(3.25), no_eater).unwrap();
    let before = world.foods()[1].snapshot();
    assert_eq!(
        world.consume(7, FoodConsume::Eaten(Some(token))),
        Some(newest)
    );
    world
        .advance(step(5.), |actual| {
            assert_eq!(actual, token);
            Ok(pose())
        })
        .unwrap();
    let mid = world.foods()[1].snapshot();
    assert_eq!(
        (mid.fade, mid.uneaten_scale),
        (before.fade, before.uneaten_scale)
    );
    assert!(mid.scale < mid.uneaten_scale);
    assert_eq!(
        world.consume(7, FoodConsume::Eaten(Some(token))),
        Some(newest)
    );
    assert_eq!(world.foods()[1].snapshot().consumption_progress, 0.);
    world.advance(step(0.), |_| Ok(pose())).unwrap();
    assert_eq!(world.foods()[1].snapshot().scale, before.uneaten_scale);
    assert_eq!(world.consume(7, FoodConsume::Immediate), Some(newest));
    assert_eq!(snapshot(&world).instance, older);
    assert_eq!(world.referenced_tokens().count(), 0);
}

#[test]
fn consume_before_any_fade_keeps_tiny_scale_and_zero_opacity() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    add(&mut world, &p, 0);
    let token = SnakeObjectToken::new(1).unwrap();
    world.consume(0, FoodConsume::Eaten(Some(token)));
    world.advance(step(0.), |_| Ok(pose())).unwrap();
    let f = snapshot(&world);
    assert_eq!((f.fade, f.scale, f.uneaten_scale), (0., 0.00001, 0.00001));
    assert_ne!(f.render_position, f.position);
    world.advance(step(0.75), |_| Ok(pose())).unwrap();
    assert_eq!(snapshot(&world).fade, 0.);
}

#[test]
fn missing_at_capture_expires_even_at_zero_and_never_resolves_a_later_id() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    add(&mut world, &p, 0);
    world.consume(0, FoodConsume::Eaten(None));
    assert_eq!(world.foods().len(), 1);
    assert_eq!(world.referenced_tokens().count(), 0);
    world.advance(step(0.), no_eater).unwrap();
    assert!(world.foods().is_empty());
}

#[test]
fn captured_token_reads_latest_raw_pose_channels_and_id_reuse_cannot_retarget_it() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    add(&mut world, &p, 5);
    let old = SnakeObjectToken::new(70_001).unwrap();
    let reused = SnakeObjectToken::new(70_002).unwrap();
    world.consume(5, FoodConsume::Eaten(Some(old)));
    let mut progress = 0.;
    for count in 0..5 {
        // These are parent-owned object mutations, including after hypothetical
        // detachment. No wire ID or index is present in the food resolver.
        let mut pose = pose();
        pose.head.x += count as f64 * 17.;
        pose.head_offset.y -= count as f64 * 0.3;
        pose.heading += count as f64 * 0.25;
        let shared = step(2.75);
        world
            .advance(shared, |token| {
                assert_eq!(token, old);
                assert_ne!(token, reused);
                Ok(pose)
            })
            .unwrap();
        progress += 2.75 / 41.;
        let f = snapshot(&world);
        let k = progress * progress;
        assert_eq!(f.scale, 0.00001 * (1. - progress * k));
        let heading = pose.heading + pose.angle_offset;
        let x = 10.
            + (pose.head.x + pose.head_offset.x + heading.cos() * (43. - k * 24.) * (1. - k) - 10.)
                * k;
        let y = 20.
            + (pose.head.y + pose.head_offset.y + heading.sin() * (43. - k * 24.) * (1. - k) - 20.)
                * k;
        assert_eq!(
            f.render_position.x,
            x + (f.wobble_rate * f.animation_phase).cos() * 6. * (1. - progress)
        );
        assert_eq!(
            f.render_position.y,
            y + (f.wobble_rate * f.animation_phase).sin() * 6. * (1. - progress)
        );
        assert_eq!(world.referenced_tokens().collect::<Vec<_>>(), [old]);
    }
    // An explicit later consume may capture a different object.
    world.consume(5, FoodConsume::Eaten(Some(reused)));
    assert_eq!(world.referenced_tokens().collect::<Vec<_>>(), [reused]);
}

#[test]
fn reverse_swap_order_newest_duplicate_and_sector_clear_include_flight() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    for key in [90, 10, 70, 20] {
        add(&mut world, &p, key);
    }
    world.consume(10, FoodConsume::Immediate);
    assert_eq!(
        world
            .foods()
            .iter()
            .map(|f| f.snapshot().key)
            .collect::<Vec<_>>(),
        [90, 20, 70]
    );
    let older = add(&mut world, &p, 90);
    let newest = add(&mut world, &p, 90);
    assert_eq!(world.consume(90, FoodConsume::Immediate), Some(newest));
    assert_eq!(world.consume(90, FoodConsume::Eaten(None)), Some(older));
    assert_eq!(world.clear_sector((9, 9)), 0);
    assert_eq!(world.clear_sector((2, 3)), 4);
    assert!(world.foods().is_empty());

    for (key, sector) in [
        (1, (1, 1)),
        (2, (2, 2)),
        (3, (3, 3)),
        (4, (4, 4)),
        (5, (2, 2)),
    ] {
        world
            .spawn(
                FoodSpawn {
                    sector,
                    ..spawn(key)
                },
                p.input(0, 0., 0.5, 1.),
            )
            .unwrap();
    }
    world.consume(
        2,
        FoodConsume::Eaten(Some(SnakeObjectToken::new(500).unwrap())),
    );
    assert_eq!(world.clear_sector((2, 2)), 2);
    assert_eq!(
        world
            .foods()
            .iter()
            .map(|f| f.snapshot().key)
            .collect::<Vec<_>>(),
        [1, 4, 3]
    );
    assert_eq!(world.referenced_tokens().count(), 0);
}

#[test]
fn reverse_expiry_does_not_reprocess_swapped_tail_and_checks_progress_first() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    for key in [1, 2, 3, 4] {
        add(&mut world, &p, key);
    }
    world.consume(2, FoodConsume::Eaten(None));
    let phase = world.foods()[3].snapshot().animation_phase;
    world.advance(step(2.), no_eater).unwrap();
    assert_eq!(
        world
            .foods()
            .iter()
            .map(|f| f.snapshot().key)
            .collect::<Vec<_>>(),
        [1, 4, 3]
    );
    assert_eq!(
        world.foods()[1].snapshot().animation_phase,
        phase + 2. * 1.05
    );
    let token = SnakeObjectToken::new(1).unwrap();
    world.consume(1, FoodConsume::Eaten(Some(token)));
    for _ in 0..8 {
        world.advance(step(5.), |_| Ok(pose())).unwrap();
    }
    assert!(snapshot(&world).consumption_progress < 1.);
    world.advance(step(1.), no_eater).unwrap();
    assert!(!world.foods().iter().any(|f| f.snapshot().key == 1));
}

#[test]
fn late_pose_error_or_overflow_preserves_every_food_and_removal() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    let token = SnakeObjectToken::new(1).unwrap();
    for key in [1, 2, 3] {
        add(&mut world, &p, key);
    }
    world.consume(1, FoodConsume::Eaten(Some(token)));
    world.consume(2, FoodConsume::Eaten(None));
    let before = world.clone();
    assert_eq!(
        world.advance(step(1.), |t| Err(FoodError::MissingEater(t))),
        Err(FoodError::MissingEater(token))
    );
    assert_eq!(world, before);
    assert_eq!(
        world.advance(step(1.), |_| Ok(FoodEaterPose {
            head: Point { x: f64::MAX, y: 0. },
            head_offset: Point { x: f64::MAX, y: 0. },
            ..pose()
        })),
        Err(FoodError::Arithmetic)
    );
    assert_eq!(world, before);
    assert_eq!(
        world.advance(step(1.), |_| Ok(FoodEaterPose {
            heading: f64::MAX,
            angle_offset: f64::MAX,
            ..pose()
        })),
        Err(FoodError::Arithmetic)
    );
    assert_eq!(world, before);
    for delta in [-1., 5.1, f64::NAN, f64::INFINITY] {
        assert_eq!(
            world.advance(FrameStep { delta, ..step(0.) }, no_eater),
            Err(FoodError::InvalidInput)
        );
        assert_eq!(world, before);
    }
}

#[test]
fn duplicate_and_eaten_capacity_counts_and_clear_releases_without_reusing_serials() {
    let p = Palette::new(1);
    let mut world = FoodWorld::new();
    for _ in 0..MAX_RETAINED_FOODS {
        add(&mut world, &p, 0);
        world.consume(0, FoodConsume::Eaten(None));
    }
    let before = world.clone();
    assert_eq!(
        world.spawn(spawn(0), p.input(0, 0., 0., 1.)),
        Err(FoodError::Capacity)
    );
    assert_eq!(world, before);
    world.clear();
    assert!(world.foods().is_empty());
    assert_eq!(world.referenced_tokens().count(), 0);
    assert_eq!(
        add(&mut world, &p, 1).serial(),
        MAX_RETAINED_FOODS as u64 + 1
    );
    assert!(SnakeObjectToken::new(0).is_err());
    assert_eq!(SnakeObjectToken::new(u64::MAX).unwrap().serial(), u64::MAX);
}
