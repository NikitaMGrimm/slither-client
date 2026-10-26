//! Original synthetic image-command cases, without browser or external source execution.

use slither_client::{presentation::*, state::Point};

fn source(handle: u64, width: f64, height: f64) -> FoodSource {
    FoodSource::new(
        BodyAsset {
            handle,
            revision: 3,
            width: 47,
            height: 53,
            status: BodyAssetStatus::Ready,
        },
        width,
        height,
        width / 2.,
        height / 2.,
    )
    .unwrap()
}
struct Palette {
    body: Vec<FoodSource>,
    outline: Vec<FoodSource>,
    glow: Vec<FoodSource>,
}
impl Palette {
    fn new() -> Self {
        Self {
            body: (0..8)
                .map(|i| source(100 + i, 7.25 + i as f64, 9.5 + i as f64))
                .collect(),
            outline: (0..8)
                .map(|i| source(200 + i, 11.75 + i as f64, 13.25 + i as f64))
                .collect(),
            glow: (0..8)
                .map(|i| source(300 + i, 17.25 + i as f64, 19.5 + i as f64))
                .collect(),
        }
    }
    fn spawn(&self, world: &mut FoodWorld, key: u32, position: Point) -> FoodInstance {
        world
            .spawn(
                FoodSpawn {
                    key,
                    sector: (1, 2),
                    position,
                    base_size: 0.,
                    raw_color: 0,
                    rapid: true,
                },
                FoodFactoryInput {
                    random_phase_unit: 0.375,
                    random_wobble_unit: 0.5,
                    creation_zoom: 1.,
                    palette: FoodPalette {
                        palette: 0,
                        image_count: 8,
                        bodies: &self.body,
                        outlines: &self.outline,
                        glows: &self.glow,
                    },
                },
            )
            .unwrap()
    }
    fn assets(&self) -> Vec<BodyAsset> {
        self.body
            .iter()
            .chain(&self.outline)
            .chain(&self.glow)
            .map(|s| s.asset())
            .collect()
    }
}
fn view() -> BodyPaintView {
    BodyPaintView {
        camera: Point { x: 10.25, y: -20.5 },
        zoom: 0.75,
        half_width: 320.,
        half_height: 240.,
    }
}
fn input<'a>(world: &'a FoodWorld, assets: &'a [BodyAsset]) -> FoodPaintInput<'a> {
    FoodPaintInput {
        foods: world.foods(),
        view: view(),
        quality: BodyPaintQuality {
            high_quality: true,
            blend: 1.,
        },
        bounds: Some(FoodCullBounds::from_view(view()).unwrap()),
        assets,
        target_handle: Some(9999),
        entry_alpha: 0.4,
        command_limit: MAX_FOOD_PAINT_COMMANDS,
    }
}
fn step(delta: f64) -> FrameStep {
    FrameClock::new(0.)
        .unwrap()
        .advance(delta * 8., false, false)
        .unwrap()
}
fn mature(world: &mut FoodWorld) {
    for _ in 0..11 {
        world.advance(step(5.), |_| panic!("uneaten")).unwrap();
    }
    assert!(world.foods().iter().all(|f| f.snapshot().scale == 1.));
}
fn calls(plan: &FoodPaintPlan) -> impl Iterator<Item = &FoodImageCommand> {
    plan.early.iter().chain(&plan.late)
}

#[test]
fn all_outline_all_body_and_per_food_late_glows_are_separate_reverse_passes() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    let a = p.spawn(&mut world, 90, Point { x: 12., y: 13. });
    let b = p.spawn(&mut world, 10, Point { x: 31., y: -7. });
    let before = world.clone();
    let plan = plan_food(input(&world, &assets)).unwrap();
    assert_eq!(world, before);
    assert_eq!(
        plan.counts,
        FoodPaintCounts {
            visible_foods: 2,
            early: 6,
            late: 8
        }
    );
    assert_eq!(plan.counts.total(), 14);
    assert_eq!(plan.outline_barrier, 2);
    let early = plan
        .early
        .iter()
        .map(|c| (c.instance, c.pass))
        .collect::<Vec<_>>();
    assert_eq!(
        early,
        [
            (b, FoodPaintPass::Outline),
            (a, FoodPaintPass::Outline),
            (b, FoodPaintPass::Body),
            (b, FoodPaintPass::Body),
            (a, FoodPaintPass::Body),
            (a, FoodPaintPass::Body)
        ]
    );
    assert_eq!(
        plan.late
            .iter()
            .map(|c| (c.instance, c.pass))
            .collect::<Vec<_>>(),
        [
            (b, FoodPaintPass::InnerGlow),
            (b, FoodPaintPass::InnerGlow),
            (b, FoodPaintPass::OuterGlow),
            (b, FoodPaintPass::OuterGlow),
            (a, FoodPaintPass::InnerGlow),
            (a, FoodPaintPass::InnerGlow),
            (a, FoodPaintPass::OuterGlow),
            (a, FoodPaintPass::OuterGlow)
        ]
    );
    for (sequence, command) in calls(&plan).enumerate() {
        assert_eq!(command.sequence, sequence);
        assert_eq!(
            command.blend,
            if command.pass == FoodPaintPass::Outline {
                BodyBlend::SourceOver
            } else {
                BodyBlend::Lighter
            }
        );
        assert_eq!(
            command.food_index,
            if command.instance == a { 0 } else { 1 }
        );
    }
}

#[test]
fn full_quality_low_quality_and_transition_calls_keep_zero_alpha() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 0, Point { x: 0., y: 0. });
    mature(&mut world);
    for (high, blend, count) in [
        (true, 1., 7),
        (true, 0., 7),
        (false, 0., 2),
        (false, 0.25, 7),
    ] {
        let mut i = input(&world, &assets);
        i.quality = BodyPaintQuality {
            high_quality: high,
            blend,
        };
        let plan = plan_food(i).unwrap();
        assert_eq!(plan.counts.total(), count);
        assert_eq!(plan.early[0].alpha.requested, 0.8);
        assert_eq!(plan.early[1].alpha.requested, 1.);
        if count == 7 {
            assert_eq!(plan.counts.early, 3);
            assert_eq!(plan.counts.late, 4);
            if blend == 0. {
                assert_eq!(plan.early[2].alpha.requested, 0.);
                assert!(plan.late.iter().all(|c| c.alpha.requested == 0.));
            }
        } else {
            assert!(plan.late.is_empty());
        }
        assert!(calls(&plan).all(|c| c.alpha.accepted && c.alpha.requested == c.alpha.effective));
    }
}

#[test]
fn never_updated_food_keeps_seven_zero_alpha_calls_and_nine_argument_draws() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 1, Point { x: 3., y: 7. });
    let plan = plan_food(input(&world, &assets)).unwrap();
    assert_eq!(plan.counts.total(), 7);
    for command in calls(&plan) {
        assert_eq!(
            command.alpha,
            BodyAlpha {
                requested: 0.,
                effective: 0.,
                accepted: true
            }
        );
        let FoodImageDraw::Scaled {
            source,
            destination,
        } = command.draw
        else {
            panic!("scaled overload required")
        };
        assert_eq!(
            source,
            BodyRect {
                x: 0.,
                y: 0.,
                width: command.source.width(),
                height: command.source.height()
            }
        );
        assert_eq!(destination.width, command.source.width() * 0.00001);
        assert_eq!(destination.height, command.source.height() * 0.00001);
    }
}

#[test]
fn zero_delta_zero_scale_still_emits_all_zero_size_calls() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 0, Point { x: 3., y: 7. });
    world.advance(step(0.), |_| panic!("uneaten")).unwrap();
    let plan = plan_food(input(&world, &assets)).unwrap();
    assert_eq!(plan.counts.total(), 7);
    for c in calls(&plan) {
        let FoodImageDraw::Scaled { destination, .. } = c.draw else {
            panic!("zero scale is a nine-argument call")
        };
        assert_eq!((destination.width, destination.height), (0., 0.));
        assert_eq!(c.alpha.requested, 0.);
    }
}

#[test]
fn whole_source_uses_three_arguments_and_odd_halves_without_extra_zoom() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(
        &mut world,
        0,
        Point {
            x: 21.75,
            y: -31.125,
        },
    );
    mature(&mut world);
    let f = world.foods()[0].snapshot();
    for zoom in [0.2, 1., 2.75] {
        let mut i = input(&world, &assets);
        i.view.zoom = zoom;
        let plan = plan_food(i).unwrap();
        let center = Point {
            x: i.view.half_width + zoom * (f.render_position.x - i.view.camera.x),
            y: i.view.half_height + zoom * (f.render_position.y - i.view.camera.y),
        };
        for c in &plan.early {
            assert_eq!(
                c.draw,
                FoodImageDraw::Whole {
                    x: center.x - c.source.half_width(),
                    y: center.y - c.source.half_height()
                }
            );
        }
        assert_eq!(plan.early[1].source.asset().handle, 100);
        assert_eq!(plan.late[0].source.asset().handle, 302);
        assert_eq!(plan.late[2].source.asset().handle, 304);
    }
}

#[test]
fn fractional_scale_keeps_declared_crop_pixels_and_exact_glow_centers_alphas() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(
        &mut world,
        1,
        Point {
            x: 123.5,
            y: -57.25,
        },
    );
    world.advance(step(3.125), |_| panic!("uneaten")).unwrap();
    let f = world.foods()[0].snapshot();
    let mut i = input(&world, &assets);
    i.quality.blend = 0.375;
    i.view.zoom = 1.3;
    let plan = plan_food(i).unwrap();
    let dx = f.render_position.x - i.view.camera.x;
    let dy = f.render_position.y - i.view.camera.y;
    let distance = dx * dx + dy * dy;
    let pulse = 0.5 + 0.5 * (f.animation_phase / 13.).cos();
    assert_eq!(plan.early[2].alpha.requested, 0.375 * pulse * f.fade);
    for (offset, shift, base) in [
        (
            0,
            0.06,
            0.005 + 0.09 * (1. - distance / (86000. + distance)),
        ),
        (2, 0.32, 0.085 * (1. - distance / (16500. + distance))),
    ] {
        let mut alpha = base;
        alpha *= f.scale.powf(0.25);
        alpha *= 0.375;
        assert_eq!(plan.late[offset].alpha.requested, alpha * f.fade);
        assert_eq!(
            plan.late[offset + 1].alpha.requested,
            alpha * pulse * f.fade
        );
        let t = 1. + shift * f.scale;
        let center = Point {
            x: dx * t * i.view.zoom + i.view.half_width,
            y: dy * t * i.view.zoom + i.view.half_height,
        };
        let c = &plan.late[offset];
        assert_eq!(
            c.draw,
            FoodImageDraw::Scaled {
                source: BodyRect {
                    x: 0.,
                    y: 0.,
                    width: c.source.width(),
                    height: c.source.height()
                },
                destination: BodyRect {
                    x: center.x - c.source.half_width() * f.scale,
                    y: center.y - c.source.half_height() * f.scale,
                    width: c.source.width() * f.scale,
                    height: c.source.height() * f.scale
                }
            }
        );
        assert_eq!(c.draw, plan.late[offset + 1].draw);
    }
}

#[test]
fn all_four_fixed_world_edges_are_inclusive_and_one_ulp_outside_is_culled() {
    let p = Palette::new();
    let assets = p.assets();
    let v = BodyPaintView {
        camera: Point { x: 0., y: 0. },
        zoom: 2.,
        half_width: 128.,
        half_height: 64.,
    };
    let bounds = FoodCullBounds::from_view(v).unwrap();
    assert_eq!(bounds.limits(), [-88., 88., -56., 56.]);
    let mut world = FoodWorld::new();
    for (key, position) in [
        (1, Point { x: -88., y: 0. }),
        (2, Point { x: 88., y: 0. }),
        (3, Point { x: 0., y: -56. }),
        (4, Point { x: 0., y: 56. }),
        (
            5,
            Point {
                x: f64::from_bits((-88_f64).to_bits() + 1),
                y: 0.,
            },
        ),
        (
            6,
            Point {
                x: f64::from_bits(88_f64.to_bits() + 1),
                y: 0.,
            },
        ),
        (
            7,
            Point {
                x: 0.,
                y: f64::from_bits((-56_f64).to_bits() + 1),
            },
        ),
        (
            8,
            Point {
                x: 0.,
                y: f64::from_bits(56_f64.to_bits() + 1),
            },
        ),
    ] {
        p.spawn(&mut world, key, position);
    }
    let mut i = input(&world, &assets);
    i.view = v;
    i.bounds = Some(bounds);
    let plan = plan_food(i).unwrap();
    assert_eq!(plan.counts.visible_foods, 4);
    assert_eq!(plan.counts.total(), 28);
    assert_eq!(
        plan.early[..4]
            .iter()
            .map(|c| c.food_index)
            .collect::<Vec<_>>(),
        [3, 2, 1, 0]
    );
}

#[test]
fn cull_uses_current_wobble_center_and_never_reculls_shifted_glows_or_sprite_bounds() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    let v = BodyPaintView {
        camera: Point { x: 0., y: 0. },
        zoom: 1.,
        half_width: 100.,
        half_height: 100.,
    };
    p.spawn(&mut world, 1, Point { x: 120., y: 0. });
    let bounds = FoodCullBounds::from_view(v).unwrap();
    let mut i = input(&world, &assets);
    i.view = v;
    i.bounds = Some(bounds);
    assert_eq!(plan_food(i).unwrap().counts.total(), 7);
    world.advance(step(0.), |_| panic!("uneaten")).unwrap();
    let mut i = input(&world, &assets);
    i.view = v;
    i.bounds = Some(bounds);
    assert_eq!(plan_food(i).unwrap().counts.total(), 0);
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 2, Point { x: 118., y: 0. });
    mature(&mut world); // Wobble puts its center exactly on the right edge.
    let mut i = input(&world, &assets);
    i.view = v;
    i.bounds = Some(bounds);
    let plan = plan_food(i).unwrap();
    assert_eq!(world.foods()[0].snapshot().render_position.x, 124.);
    assert_eq!(plan.counts.total(), 7);
    let FoodImageDraw::Whole { x, .. } = plan.late[2].draw else {
        panic!("whole outer")
    };
    assert!(x > v.half_width + 124.); // shifted outer center remains eligible.

    let mut huge = Palette::new();
    huge.body[0] = source(888, 1_000_000., 1_000_000.);
    let assets = huge.assets();
    let mut world = FoodWorld::new();
    huge.spawn(&mut world, 3, Point { x: 125., y: 0. });
    let mut i = input(&world, &assets);
    i.view = v;
    i.bounds = Some(bounds);
    assert_eq!(plan_food(i).unwrap().counts.total(), 0);
}

#[test]
fn absent_bounds_emit_no_calls_and_retained_bounds_survive_view_changes_and_world_clear() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 0, Point { x: 0., y: 0. });
    let bounds = FoodCullBounds::new(-1., 1., -1., 1.).unwrap();
    let mut i = input(&world, &assets);
    i.bounds = None;
    assert_eq!(plan_food(i).unwrap().counts.total(), 0);
    let mut i = input(&world, &assets);
    i.bounds = Some(bounds);
    i.view.camera = Point { x: 1000., y: 1000. };
    i.view.zoom = 4.;
    assert_eq!(plan_food(i).unwrap().counts.total(), 7);
    world.clear();
    p.spawn(&mut world, 1, Point { x: 0., y: 0. });
    let mut i = input(&world, &assets);
    i.bounds = Some(bounds);
    assert_eq!(plan_food(i).unwrap().counts.total(), 7);
    assert_eq!(bounds.limits(), [-1., 1., -1., 1.]);
}

#[test]
fn swap_removal_changes_paint_order_without_numeric_key_sorting() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    let ids = [90, 1, 70, 2].map(|k| p.spawn(&mut world, k, Point { x: 0., y: 0. }));
    world.consume(1, FoodConsume::Immediate);
    let plan = plan_food(input(&world, &assets)).unwrap();
    assert_eq!(
        plan.early[..3]
            .iter()
            .map(|c| c.instance)
            .collect::<Vec<_>>(),
        [ids[2], ids[3], ids[0]]
    );
}

#[test]
fn aggregate_remaining_budget_is_checked_for_both_insertion_points() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 0, Point { x: 0., y: 0. });
    p.spawn(&mut world, 1, Point { x: 1., y: 0. });
    let before = world.clone();
    for limit in [0, 5, 6, 13] {
        let mut i = input(&world, &assets);
        i.command_limit = limit;
        assert_eq!(plan_food(i), Err(FoodPaintError::CommandLimit));
        assert_eq!(world, before);
    }
    let mut i = input(&world, &assets);
    i.command_limit = 14;
    assert_eq!(plan_food(i).unwrap().counts.total(), 14);
    i.quality = BodyPaintQuality {
        high_quality: false,
        blend: 0.,
    };
    i.command_limit = 4;
    assert_eq!(plan_food(i).unwrap().counts.total(), 4);
    i.command_limit = 3;
    assert_eq!(plan_food(i), Err(FoodPaintError::CommandLimit));
}

#[test]
fn late_numeric_failure_returns_no_early_plan_or_world_mutation() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 0, Point { x: 1e200, y: 0. });
    p.spawn(&mut world, 1, Point { x: 0., y: 0. });
    let before = world.clone();
    let mut i = input(&world, &assets);
    i.bounds = Some(FoodCullBounds::new(-1e201, 1e201, -1., 1.).unwrap());
    assert_eq!(plan_food(i), Err(FoodPaintError::Arithmetic));
    assert_eq!(world, before);
    // Only late effects require squared distance; the LQ path remains finite.
    i.quality = BodyPaintQuality {
        high_quality: false,
        blend: 0.,
    };
    assert_eq!(plan_food(i).unwrap().counts.total(), 4);
}

#[test]
fn all_retained_sources_revalidate_readiness_revision_intrinsics_and_alias_before_drawing() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 0, Point { x: 1e6, y: 0. }); // Culled still requires coherent retained sources.
    let before = world.clone();
    let selected = world.foods()[0].snapshot().sources;
    for source in [
        selected.body,
        selected.outline,
        selected.inner,
        selected.outer,
    ] {
        for mutation in 0..4 {
            let mut bad = assets.clone();
            let asset = bad
                .iter_mut()
                .find(|a| a.handle == source.asset().handle)
                .unwrap();
            match mutation {
                0 => asset.revision += 1,
                1 => asset.width += 1,
                2 => asset.status = BodyAssetStatus::Pending,
                _ => asset.height = 0,
            };
            assert_eq!(
                plan_food(input(&world, &bad)),
                Err(FoodPaintError::InvalidSource)
            );
            assert_eq!(world, before);
        }
        let bad = assets
            .iter()
            .copied()
            .filter(|a| a.handle != source.asset().handle)
            .collect::<Vec<_>>();
        assert_eq!(
            plan_food(input(&world, &bad)),
            Err(FoodPaintError::InvalidSource)
        );
        let mut i = input(&world, &assets);
        i.target_handle = Some(source.asset().handle);
        assert_eq!(plan_food(i), Err(FoodPaintError::TargetAlias));
    }
    let mut conflicting = assets.clone();
    conflicting.push(BodyAsset {
        revision: 99,
        ..selected.body.asset()
    });
    assert_eq!(
        plan_food(input(&world, &conflicting)),
        Err(FoodPaintError::InvalidSource)
    );
}

#[test]
fn invalid_view_quality_entry_alpha_and_bounds_fail_without_a_plan() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 0, Point { x: 0., y: 0. });
    for value in [-1., f64::NAN, f64::INFINITY, 1.1] {
        let mut i = input(&world, &assets);
        i.quality.blend = value;
        assert_eq!(plan_food(i), Err(FoodPaintError::InvalidVisual));
        i = input(&world, &assets);
        i.entry_alpha = value;
        assert_eq!(plan_food(i), Err(FoodPaintError::InvalidVisual));
    }
    for value in [0., -1., f64::NAN, f64::INFINITY] {
        let mut i = input(&world, &assets);
        i.view.zoom = value;
        assert_eq!(plan_food(i), Err(FoodPaintError::InvalidView));
        i = input(&world, &assets);
        i.view.half_width = value;
        assert_eq!(plan_food(i), Err(FoodPaintError::InvalidView));
    }
    assert_eq!(
        FoodCullBounds::new(1., 0., 0., 1.),
        Err(FoodPaintError::InvalidView)
    );
    assert_eq!(
        FoodCullBounds::new(0., 1., f64::NAN, 1.),
        Err(FoodPaintError::InvalidView)
    );
    assert_eq!(
        FoodCullBounds::from_view(BodyPaintView {
            zoom: f64::MIN_POSITIVE,
            ..view()
        }),
        Err(FoodPaintError::InvalidView)
    );
}

#[test]
fn eaten_food_uses_frozen_fade_and_source_opacity_without_any_eater_death_alpha() {
    let p = Palette::new();
    let assets = p.assets();
    let mut world = FoodWorld::new();
    p.spawn(&mut world, 0, Point { x: 0., y: 0. });
    world.advance(step(5.), |_| panic!("uneaten")).unwrap();
    let fade = world.foods()[0].snapshot().fade;
    let token = SnakeObjectToken::new(41).unwrap();
    world.consume(0, FoodConsume::Eaten(Some(token)));
    world
        .advance(step(5.), |_| {
            Ok(FoodEaterPose {
                head: Point { x: 4., y: 5. },
                head_offset: Point { x: 1., y: 2. },
                heading: 0.7,
                angle_offset: 0.1,
            })
        })
        .unwrap();
    let plan = plan_food(input(&world, &assets)).unwrap();
    assert_eq!(plan.early[0].alpha.requested, 0.8 * fade);
    assert_eq!(plan.early[1].alpha.requested, fade);
    assert_eq!(plan.counts.total(), 7);
}
