//! Original synthetic planner cases. No reference inputs, artwork or networking.

use slither_client::{
    presentation::{
        BodyAsset, BodyAssetStatus, BodyAssetUse, BodyBlend, BodyFade, BodyImageCommand,
        BodyPaintError, BodyPaintGeometry, BodyPaintInput, BodyPaintPass, BodyPaintPlan,
        BodyPaintQuality, BodyPaintRecipe, BodyPaintSample, BodyPaintView, BodyPaintVisual,
        BodyPalette, BodyRect, BodyRun, BodyStyle, BodyVariantMode, MAX_BODY_PAINT_COMMANDS,
        MAX_BODY_PAINT_SAMPLES, plan_standard_body,
    },
    state::Point,
};

use BodyPaintPass::*;

fn usage(asset: usize) -> BodyAssetUse {
    BodyAssetUse {
        asset,
        source_rect: None,
    }
}

struct Fixture {
    samples: Vec<BodyPaintSample>,
    active_count: usize,
    seed: Point,
    assets: Vec<BodyAsset>,
    variants: Vec<Vec<BodyAssetUse>>,
    glows: Vec<Option<BodyAssetUse>>,
    runs: Vec<BodyRun>,
    style: Option<BodyStyle>,
    mode: BodyVariantMode,
    period: usize,
    custom: bool,
    base: usize,
    effects: [Option<BodyAssetUse>; 3],
    view: BodyPaintView,
    quality: BodyPaintQuality,
    visual: BodyPaintVisual,
    eligible: bool,
    entry_alpha: f64,
    limit: usize,
}

impl Fixture {
    fn new(n: usize) -> Self {
        Self {
            samples: (0..n)
                .map(|i| BodyPaintSample {
                    ordinal: i,
                    x: (7 * i + 20) as f32,
                    y: (3 * i + 10) as f32,
                    tangent: (0.3 + i as f64 * 0.071) as f32,
                    flag: 2,
                })
                .collect(),
            active_count: n,
            seed: Point {
                x: 0.123_456_789,
                y: -0.765_432_109,
            },
            assets: (0..15)
                .map(|i| BodyAsset {
                    handle: 800 + i,
                    revision: 300 + i,
                    width: 40,
                    height: 24,
                    status: BodyAssetStatus::Ready,
                })
                .collect(),
            variants: (0..3)
                .map(|p| (0..3).map(|v| usage(p * 3 + v)).collect())
                .collect(),
            glows: vec![Some(usage(9)), Some(usage(10)), Some(usage(11))],
            runs: vec![],
            style: Some(BodyStyle {
                detailed_segments: false,
                swell: 0.,
                rotate_segments: true,
                head_fade: None,
                tail_fade: None,
            }),
            mode: BodyVariantMode::Cycle,
            period: 3,
            custom: false,
            base: 0,
            effects: [Some(usage(12)), Some(usage(13)), Some(usage(14))],
            view: BodyPaintView {
                camera: Point { x: 2., y: 4. },
                zoom: 0.75,
                half_width: 320.,
                half_height: 180.,
            },
            quality: BodyPaintQuality {
                high_quality: true,
                blend: 1.,
            },
            visual: BodyPaintVisual {
                scale: 1.,
                spawn: 1.,
                death: 0.,
                dead: false,
                smoothed_speed: 4.,
                boost_threshold: 5.,
                cruise_speed: 4.,
                maximum_speed: 10.,
                boost_phase: 0.7,
            },
            eligible: true,
            entry_alpha: 1.,
            limit: MAX_BODY_PAINT_COMMANDS,
        }
    }

    fn plan(&self) -> Result<BodyPaintPlan, BodyPaintError> {
        let palettes: Vec<_> = self
            .variants
            .iter()
            .zip(&self.glows)
            .map(|(variants, glow)| BodyPalette {
                variants,
                boost_glow: *glow,
            })
            .collect();
        plan_standard_body(BodyPaintInput {
            geometry: BodyPaintGeometry {
                samples: &self.samples,
                active_count: self.active_count,
                distance_cursor_seed: self.seed,
                eligible: self.eligible,
            },
            recipe: BodyPaintRecipe {
                base_palette: self.base,
                palettes: &palettes,
                runs: &self.runs,
                variant_mode: self.mode,
                variant_period: self.period,
                custom: self.custom,
                style: self.style,
                outline: self.effects[0],
                shadow: self.effects[1],
                death: self.effects[2],
            },
            assets: &self.assets,
            view: self.view,
            quality: self.quality,
            visual: self.visual,
            entry_alpha: self.entry_alpha,
            command_limit: self.limit,
        })
    }

    fn low_quality(&mut self) {
        self.quality = BodyPaintQuality {
            high_quality: false,
            blend: 0.,
        };
    }

    fn mixed(&mut self) {
        self.runs = vec![
            BodyRun {
                palette: 1,
                count: 2,
            },
            BodyRun {
                palette: 2,
                count: 1,
            },
            BodyRun {
                palette: 0,
                count: 1,
            },
        ];
    }
}

fn pass(plan: &BodyPaintPlan, which: BodyPaintPass) -> Vec<&BodyImageCommand> {
    plan.commands.iter().filter(|c| c.pass == which).collect()
}

fn close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1e-14,
        "{actual:?} != {expected:?}"
    );
}

#[test]
fn ordered_hq_passes_include_interleaved_shadows_and_tail_coverage() {
    let f = Fixture::new(6);
    let plan = f.plan().unwrap();
    let expected: Vec<_> = (0..6)
        .rev()
        .flat_map(|i| [(Outline, i), (NearHeadShadow, i)])
        .chain(
            (2..6)
                .rev()
                .flat_map(|i| [(TailOutline, i), (TailShadow, i)]),
        )
        .chain([
            (BodyShadow, 1),
            (Body, 5),
            (BodyShadow, 0),
            (Body, 4),
            (Body, 3),
            (Body, 2),
            (Body, 1),
            (Body, 0),
        ])
        .collect();
    assert_eq!(
        plan.commands
            .iter()
            .map(|c| (c.pass, c.ordinal))
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(plan.antenna_barrier, 28);
    assert_eq!(plan.final_distance_cursor, Point { x: 20., y: 10. });
    for (i, c) in plan.commands.iter().enumerate() {
        assert_eq!(c.sequence, i);
        assert_eq!(c.blend, BodyBlend::SourceOver);
        assert_eq!(c.center, Point { x: 320., y: 180. });
        assert_eq!(c.rotation.is_some(), c.pass == Body);
    }
}

#[test]
fn independent_quality_flag_and_blend_gate_effects_and_zero_alpha_commands() {
    for (hq, blend, effects) in [
        (false, 0., false),
        (false, 0.2, true),
        (true, 0., true),
        (true, 1., true),
    ] {
        let mut f = Fixture::new(6);
        f.quality = BodyPaintQuality {
            high_quality: hq,
            blend,
        };
        f.visual.smoothed_speed = 8.;
        let plan = f.plan().unwrap();
        assert_eq!(pass(&plan, OuterBoost).len(), 6);
        assert_eq!(pass(&plan, Outline).len(), if effects { 6 } else { 0 });
        assert_eq!(pass(&plan, InnerBoost).len(), if effects { 6 } else { 0 });
        assert_eq!(pass(&plan, BodyShadow).len(), 2);
        assert_eq!(pass(&plan, Body).len(), 6);
        if hq && blend == 0. {
            assert!(pass(&plan, Outline).iter().all(|c| c.alpha.effective == 0.));
            assert!(
                pass(&plan, InnerBoost)
                    .iter()
                    .all(|c| c.alpha.effective == 0.)
            );
            assert!(
                pass(&plan, NearHeadShadow)
                    .iter()
                    .any(|c| c.alpha.effective > 0.)
            );
        }
    }
}

#[test]
fn boost_and_death_order_blends_and_antenna_barrier_are_explicit() {
    let mut f = Fixture::new(6);
    f.visual.smoothed_speed = 8.;
    f.visual.death = 0.4;
    f.visual.dead = true;
    let plan = f.plan().unwrap();
    assert!(plan.commands[..6].iter().all(|c| c.pass == OuterBoost));
    assert!(
        plan.commands[plan.antenna_barrier - 6..plan.antenna_barrier]
            .iter()
            .all(|c| c.pass == InnerBoost)
    );
    assert!(
        plan.commands[plan.antenna_barrier..]
            .iter()
            .all(|c| c.pass == Death)
    );
    assert_eq!(plan.commands.len(), 46);
    for c in &plan.commands {
        assert_eq!(
            c.blend,
            if matches!(c.pass, OuterBoost | InnerBoost | Death) {
                BodyBlend::Lighter
            } else {
                BodyBlend::SourceOver
            }
        );
    }
    f.low_quality();
    let low = f.plan().unwrap();
    assert_eq!(low.commands.len(), 20);
    assert_eq!(pass(&low, Death).len(), 6);
    assert_eq!(pass(&low, InnerBoost).len(), 0);
}

#[test]
fn speed_threshold_is_strict_and_boost_fraction_is_clamped_before_lifecycle() {
    let mut f = Fixture::new(3);
    f.visual.spawn = 0.5;
    f.visual.death = 0.2;
    f.visual.smoothed_speed = f.visual.boost_threshold;
    assert!(pass(&f.plan().unwrap(), OuterBoost).is_empty());
    f.visual.smoothed_speed = 100.;
    let plan = f.plan().unwrap();
    let outline = pass(&plan, Outline)[0];
    close(
        outline.alpha.effective,
        (0.5_f64 * 0.8).powi(2) * (1. - 0.4),
    );
    f.visual.boost_threshold = 1.;
    f.visual.smoothed_speed = 2.;
    let zero_boost = f.plan().unwrap();
    assert_eq!(pass(&zero_boost, OuterBoost).len(), 3);
    assert!(
        pass(&zero_boost, OuterBoost)
            .iter()
            .all(|c| c.alpha.effective == 0.)
    );
}

#[test]
fn mixed_runs_select_body_and_glow_without_resetting_spatial_variants() {
    let mut f = Fixture::new(10);
    f.mixed();
    f.visual.smoothed_speed = 9.;
    let plan = f.plan().unwrap();
    for c in &plan.commands {
        let palette = [1, 1, 2, 0][c.ordinal % 4];
        match c.pass {
            Body => assert_eq!(c.asset_index, palette * 3 + c.ordinal % 3),
            OuterBoost | InnerBoost => assert_eq!(c.asset_index, 9 + palette),
            _ => (),
        }
    }
    f.glows[1] = None;
    assert_eq!(f.plan(), Err(BodyPaintError::MissingAsset));
}

#[test]
fn ping_pong_repeats_endpoints_and_custom_always_uses_variant_zero() {
    let mut f = Fixture::new(14);
    f.low_quality();
    f.mode = BodyVariantMode::PingPong;
    let p = f.plan().unwrap();
    let mut bodies = pass(&p, Body);
    bodies.reverse();
    assert_eq!(
        bodies.iter().map(|c| c.asset_index).collect::<Vec<_>>(),
        [0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 0, 1]
    );
    f.custom = true;
    f.mixed();
    assert!(
        pass(&f.plan().unwrap(), Body)
            .iter()
            .all(|c| c.asset_index % 3 == 0)
    );
    f.custom = false;
    f.mode = BodyVariantMode::First;
    assert!(
        pass(&f.plan().unwrap(), Body)
            .iter()
            .all(|c| c.asset_index % 3 == 0)
    );
}

#[test]
fn cycle_period_and_base_palette_apply_across_run_palettes() {
    let mut f = Fixture::new(13);
    f.base = 2;
    f.period = 2;
    f.runs = vec![BodyRun {
        palette: 1,
        count: 3,
    }];
    for c in pass(&f.plan().unwrap(), Body) {
        assert_eq!(c.asset_index, 3 + c.ordinal % 2);
    }
    f.runs.clear();
    assert!(
        pass(&f.plan().unwrap(), Body)
            .iter()
            .all(|c| c.asset_index == 6 + c.ordinal % 2)
    );
}

#[test]
fn retained_flags_are_consumed_without_recomputed_cadence_or_compaction() {
    let mut f = Fixture::new(10);
    f.style.as_mut().unwrap().detailed_segments = true;
    f.visual.smoothed_speed = 8.;
    let flags = [2, 1, 0, 2, 1, 2, 0, 1, 0, 2];
    for (s, flag) in f.samples.iter_mut().zip(flags) {
        s.flag = flag;
    }
    let original = f.samples.clone();
    let plan = f.plan().unwrap();
    assert_eq!(f.samples, original);
    assert_eq!(
        pass(&plan, OuterBoost)
            .iter()
            .map(|c| c.ordinal)
            .collect::<Vec<_>>(),
        [9, 5, 3, 0]
    );
    assert_eq!(
        pass(&plan, Body)
            .iter()
            .map(|c| c.ordinal)
            .collect::<Vec<_>>(),
        [9, 7, 5, 4, 3, 1, 0]
    );
    assert!(
        pass(&plan, Body)
            .iter()
            .all(|c| c.asset_index == c.ordinal % 3)
    );
    assert_eq!(
        pass(&plan, BodyShadow)
            .iter()
            .map(|c| c.ordinal)
            .collect::<Vec<_>>(),
        [5, 3, 0]
    );
    let c = pass(&plan, OuterBoost)[0];
    let boost = (8_f64 - 4.) / (10. - 4.);
    close(
        c.alpha.requested,
        boost.powf(0.5) * 0.38 * (0.6 + 0.4 * (9_f64 / 12. - 1.15 * 0.7).cos()),
    );
}

#[test]
fn active_prefix_ignores_inactive_cache_records_but_requires_original_ordinals() {
    let mut f = Fixture::new(5);
    f.active_count = 3;
    f.samples[4].x = f32::NAN;
    f.samples[4].ordinal = 900;
    assert!(pass(&f.plan().unwrap(), Body).iter().all(|c| c.ordinal < 3));
    f.samples[1].ordinal = 2;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidGeometry));
}

#[test]
fn fades_overlap_in_head_then_tail_order_and_tail_boundary_is_strict() {
    let mut f = Fixture::new(5);
    f.low_quality();
    f.mixed();
    let style = f.style.as_mut().unwrap();
    style.head_fade = Some(BodyFade {
        palette: 1,
        length: 4.,
    });
    style.tail_fade = Some(BodyFade {
        palette: 2,
        length: 4.,
    });
    let plan = f.plan().unwrap();
    let per_ordinal: Vec<_> = plan
        .commands
        .iter()
        .filter(|c| c.ordinal == 2)
        .map(|c| c.pass)
        .collect();
    assert_eq!(per_ordinal, [Body, HeadFade, TailFade]);
    assert_eq!(
        pass(&plan, HeadFade)
            .iter()
            .map(|c| c.ordinal)
            .collect::<Vec<_>>(),
        [3, 2, 1, 0]
    );
    assert_eq!(
        pass(&plan, TailFade)
            .iter()
            .map(|c| c.ordinal)
            .collect::<Vec<_>>(),
        [4, 3, 2]
    );
    for c in pass(&plan, HeadFade) {
        assert_eq!(c.asset_index, 3);
    }
    for c in pass(&plan, TailFade) {
        assert_eq!(c.asset_index, 6);
    }
    close(pass(&plan, TailFade)[2].alpha.effective, 0.25);
    close(pass(&plan, HeadFade)[1].alpha.effective, 0.5);
}

#[test]
fn fades_use_original_ordinals_fractional_lengths_and_unguarded_swell() {
    let mut f = Fixture::new(8);
    f.mixed();
    f.samples[6].flag = 0;
    let style = f.style.as_mut().unwrap();
    style.swell = 0.1;
    style.head_fade = Some(BodyFade {
        palette: 1,
        length: 6.5,
    });
    style.tail_fade = Some(BodyFade {
        palette: 2,
        length: 2.5,
    });
    let plan = f.plan().unwrap();
    assert_eq!(
        pass(&plan, TailFade)
            .iter()
            .map(|c| c.ordinal)
            .collect::<Vec<_>>(),
        [7]
    );
    let fade = pass(&plan, HeadFade)
        .into_iter()
        .find(|c| c.ordinal == 5)
        .unwrap();
    let progress = 1. - 5. / 6.5;
    close(
        fade.destination.width,
        0.75 * 2. * ((1. + 0.05 * progress) * 14.5 * 0.9),
    );
    let base = pass(&plan, Body)
        .into_iter()
        .find(|c| c.ordinal == 5)
        .unwrap();
    assert_eq!(base.destination.width, 0.75 * 2. * 14.5);
}

#[test]
fn source_identity_revision_crop_and_non_square_dimensions_survive() {
    let mut f = Fixture::new(2);
    f.variants[0][1].source_rect = Some(BodyRect {
        x: 3.,
        y: 2.,
        width: 11.,
        height: 7.,
    });
    f.assets[1].handle = f.assets[0].handle;
    f.assets[1].revision = 9000;
    let plan = f.plan().unwrap();
    let c = pass(&plan, Body)[0];
    assert_eq!(c.asset, f.assets[1]);
    assert_eq!(c.source_rect, f.variants[0][1].source_rect);
    assert_eq!(c.destination.width, c.destination.height);
    assert_eq!(pass(&plan, Body)[1].source_rect, None);
}

#[test]
fn tangent_rotation_is_stored_f32_and_only_body_and_fades_rotate() {
    let mut f = Fixture::new(5);
    f.mixed();
    f.style.as_mut().unwrap().head_fade = Some(BodyFade {
        palette: 2,
        length: 3.,
    });
    f.visual.smoothed_speed = 8.;
    f.visual.dead = true;
    let plan = f.plan().unwrap();
    for c in &plan.commands {
        assert_eq!(
            c.rotation,
            if matches!(c.pass, Body | HeadFade | TailFade) {
                Some(f64::from(f.samples[c.ordinal].tangent))
            } else {
                None
            }
        );
        assert_eq!(
            c.translation,
            Point {
                x: (f64::from(f.samples[c.ordinal].x) - 2.) * 0.75,
                y: (f64::from(f.samples[c.ordinal].y) - 4.) * 0.75,
            }
        );
    }
    f.style.as_mut().unwrap().rotate_segments = false;
    assert!(
        f.plan()
            .unwrap()
            .commands
            .iter()
            .all(|c| c.rotation.is_none())
    );
}

#[test]
fn swell_affects_head_body_glows_shadows_and_death_but_never_outline() {
    let mut f = Fixture::new(5);
    f.visual.smoothed_speed = 8.;
    f.visual.dead = true;
    let normal = f.plan().unwrap();
    f.style.as_mut().unwrap().swell = 0.15;
    let swollen = f.plan().unwrap();
    assert_eq!(normal.commands.len(), swollen.commands.len());
    for (a, b) in normal.commands.iter().zip(&swollen.commands) {
        assert_eq!((a.pass, a.ordinal), (b.pass, b.ordinal));
        let factor = if a.ordinal < 4 && !matches!(a.pass, Outline | TailOutline) {
            1. + (4 - a.ordinal) as f64 * 0.15
        } else {
            1.
        };
        close(b.destination.width, a.destination.width * factor);
    }
    f.style.as_mut().unwrap().swell = -1.;
    assert!(
        pass(&f.plan().unwrap(), Body)
            .iter()
            .any(|c| c.destination.width < 0.)
    );
}

#[test]
fn unrounded_seed_and_shared_cursor_change_only_distance_bearing_visits() {
    let mut f = Fixture::new(3);
    for (i, s) in f.samples.iter_mut().enumerate() {
        s.x = i as f32;
        s.y = 0.;
    }
    f.seed = Point {
        x: 1.812_345_678_901,
        y: -0.031_415_926_535,
    };
    let plan = f.plan().unwrap();
    let expected_d = (2. - f.seed.x + 0.031_415_926_535) / 6.;
    close(
        pass(&plan, NearHeadShadow)[0].alpha.requested,
        expected_d * (1. - 2. / 9.),
    );
    // The outline pass leaves the cursor at the head before tail coverage starts.
    close(
        pass(&plan, TailShadow)[0].alpha.requested,
        (2_f64 / 6.) * (2. / 9.),
    );
    // With outer boost, the next outline starts from the head, not the seed.
    f.visual.smoothed_speed = 8.;
    let boosted = f.plan().unwrap();
    close(
        pass(&boosted, NearHeadShadow)[0].alpha.requested,
        (2_f64 / 6.) * (1. - 2. / 9.),
    );
    let seed_first = pass(&boosted, OuterBoost)[0].alpha.requested;
    f.seed.x = 2.;
    f.seed.y = 0.;
    assert_eq!(pass(&f.plan().unwrap(), OuterBoost)[0].alpha.requested, 0.);
    assert!(seed_first > 0.);
}

#[test]
fn inner_boost_cursor_continues_after_interleaved_near_head_shadow() {
    let mut f = Fixture::new(6);
    f.low_quality();
    f.quality.blend = 0.5;
    for (i, s) in f.samples.iter_mut().enumerate() {
        s.x = i as f32;
        s.y = 0.;
    }
    f.visual.smoothed_speed = 10.;
    f.visual.boost_phase = 0.;
    let plan = f.plan().unwrap();
    // Final body-shadow visit is ordinal zero; body images do not move the cursor.
    let inner = pass(&plan, InnerBoost)[0];
    close(
        inner.alpha.requested,
        (5_f64 / 6.) * 0.37 * 0.5 * (0.5 + 0.5 * (5_f64 / 4.).cos()),
    );
}

#[test]
fn invalid_tail_alpha_retains_saved_outline_alpha_without_clamping_or_leaking() {
    let mut f = Fixture::new(17);
    f.quality.blend = 0.3;
    let plan = f.plan().unwrap();
    let tails = pass(&plan, TailShadow);
    assert_eq!(tails.len(), 4);
    for c in tails {
        assert!(c.alpha.requested > 1.);
        assert!(!c.alpha.accepted);
        assert_eq!(c.alpha.effective, 0.3);
    }
    assert!(
        pass(&plan, TailOutline)
            .iter()
            .all(|c| c.alpha.effective == 0.3)
    );
    assert!(pass(&plan, Body).iter().all(|c| c.alpha.effective == 1.));
    assert!(
        pass(&plan, NearHeadShadow)
            .iter()
            .any(|c| c.alpha.effective > 0.3)
    );
}

#[test]
fn nonfinite_alpha_expression_from_finite_phase_is_ignored_by_canvas_semantics() {
    let mut f = Fixture::new(2);
    f.visual.smoothed_speed = 8.;
    f.visual.boost_phase = f64::MAX;
    f.entry_alpha = 0.43;
    let plan = f.plan().unwrap();
    for c in pass(&plan, OuterBoost) {
        assert!(c.alpha.requested.is_nan());
        assert!(!c.alpha.accepted);
        assert_eq!(c.alpha.effective, 0.43);
    }
}

#[test]
fn dead_highlight_uses_its_own_envelope_even_at_zero_spawn() {
    let mut f = Fixture::new(5);
    f.visual.dead = true;
    f.visual.death = 0.37;
    let alive_spawn = f.plan().unwrap();
    f.visual.spawn = 0.;
    let zero_spawn = f.plan().unwrap();
    assert!(
        pass(&zero_spawn, Body)
            .iter()
            .all(|c| c.alpha.effective == 0.)
    );
    assert_eq!(pass(&zero_spawn, Death), pass(&alive_spawn, Death));
    assert!(
        pass(&zero_spawn, Death)
            .iter()
            .any(|c| c.alpha.effective > 0.)
    );
}

#[test]
fn missing_style_or_required_assets_fail_explicitly() {
    let mut f = Fixture::new(3);
    f.style = None;
    assert_eq!(f.plan(), Err(BodyPaintError::MissingStyle));
    for i in 0..3 {
        let mut f = Fixture::new(3);
        f.effects[i] = None;
        assert_eq!(f.plan(), Err(BodyPaintError::MissingAsset));
    }
    let mut f = Fixture::new(3);
    f.glows.fill(None);
    assert!(f.plan().is_ok());
    f.visual.smoothed_speed = 6.;
    assert_eq!(f.plan(), Err(BodyPaintError::MissingAsset));
}

#[test]
fn unsupported_short_ineligible_and_degenerate_geometry_are_rejected() {
    for n in 0..2 {
        assert_eq!(
            Fixture::new(n).plan(),
            Err(BodyPaintError::UnsupportedGeometry)
        );
    }
    let mut f = Fixture::new(3);
    f.eligible = false;
    assert_eq!(f.plan(), Err(BodyPaintError::UnsupportedGeometry));
    f.eligible = true;
    for s in &mut f.samples {
        s.x = 1.;
        s.y = 2.;
    }
    assert_eq!(f.plan(), Err(BodyPaintError::UnsupportedGeometry));
}

#[test]
fn invalid_geometry_and_visual_scalars_fail_without_mutating_inputs() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut f = Fixture::new(3);
        f.seed.x = bad;
        assert_eq!(f.plan(), Err(BodyPaintError::InvalidGeometry));
        f.seed.x = 0.;
        f.visual.boost_phase = bad;
        assert_eq!(f.plan(), Err(BodyPaintError::InvalidVisual));
        f.visual.boost_phase = 0.;
        f.style.as_mut().unwrap().swell = bad;
        assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    }
    let mut f = Fixture::new(3);
    f.samples[1].flag = 3;
    let original = f.samples.clone();
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidGeometry));
    assert_eq!(f.samples, original);
    f.samples[1].flag = 2;
    f.samples[1].tangent = f32::NAN;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidGeometry));
    f.samples[1].tangent = 0.;
    f.visual.maximum_speed = f.visual.cruise_speed;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidVisual));
    f.visual.maximum_speed = 10.;
    f.quality.blend = 1.01;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidVisual));
}

#[test]
fn malformed_recipes_sources_and_dimensions_fail_atomically() {
    let mut f = Fixture::new(3);
    f.runs = vec![BodyRun {
        palette: 0,
        count: 0,
    }];
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.runs[0].count = 65_536;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.runs[0] = BodyRun {
        palette: 3,
        count: 1,
    };
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.runs.clear();
    f.period = 4;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.period = 3;
    f.variants[0][2].asset = 9000;
    assert_eq!(f.plan(), Err(BodyPaintError::MissingAsset));
    f.variants[0][2] = usage(2);
    f.assets[2].status = BodyAssetStatus::Pending;
    assert_eq!(f.plan(), Err(BodyPaintError::AssetNotReady));
    f.assets[2].status = BodyAssetStatus::Unsupported;
    assert_eq!(f.plan(), Err(BodyPaintError::AssetNotReady));
    f.assets[2].status = BodyAssetStatus::Ready;
    f.assets[2].width = 0;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidAsset));
    f.assets[2].width = 65_536;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidAsset));
    f.assets[2].width = 40;
    f.variants[0][2].source_rect = Some(BodyRect {
        x: 39.,
        y: 0.,
        width: 2.,
        height: 3.,
    });
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidAsset));
    f.variants[0][2].source_rect = None;
    f.style.as_mut().unwrap().head_fade = Some(BodyFade {
        palette: 0,
        length: 2.,
    });
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
}

#[test]
fn exact_budget_and_active_count_caps_are_checked_before_producing_commands() {
    let mut f = Fixture::new(6);
    f.limit = 28;
    assert_eq!(f.plan().unwrap().commands.len(), 28);
    f.limit = 27;
    assert_eq!(f.plan(), Err(BodyPaintError::CommandLimit));
    f.limit = MAX_BODY_PAINT_COMMANDS + 1;
    assert_eq!(f.plan(), Err(BodyPaintError::CommandLimit));
    f.active_count = 7;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidGeometry));
    f.active_count = MAX_BODY_PAINT_SAMPLES + 1;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidGeometry));
}

#[test]
fn invisible_samples_preserve_empty_plan_and_cursor_without_skipping_validation() {
    let mut f = Fixture::new(3);
    for s in &mut f.samples {
        s.flag = 0;
    }
    f.limit = 0;
    let plan = f.plan().unwrap();
    assert!(plan.commands.is_empty());
    assert_eq!(plan.antenna_barrier, 0);
    assert_eq!(plan.final_distance_cursor, f.seed);
    f.assets[12].status = BodyAssetStatus::Pending;
    assert_eq!(f.plan(), Err(BodyPaintError::AssetNotReady));
}

#[test]
fn late_numeric_overflow_returns_only_an_error_and_read_only_inputs_survive() {
    let mut f = Fixture::new(4);
    f.view.zoom = f64::MAX;
    let samples = f.samples.clone();
    let assets = f.assets.clone();
    assert_eq!(f.plan(), Err(BodyPaintError::Arithmetic));
    assert_eq!(f.samples, samples);
    assert_eq!(f.assets, assets);
    f.view.zoom = 0.;
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidView));
}

#[test]
fn maximum_active_prefix_with_small_budget_is_bounded_without_expanding_runs() {
    let mut f = Fixture::new(MAX_BODY_PAINT_SAMPLES);
    f.low_quality();
    f.runs = vec![BodyRun {
        palette: 0,
        count: 65_535,
    }];
    f.limit = 1;
    assert_eq!(f.plan(), Err(BodyPaintError::CommandLimit));
}

#[test]
fn palette_run_variant_and_catalog_caps_reject_oversized_metadata() {
    let mut f = Fixture::new(3);
    f.runs = vec![
        BodyRun {
            palette: 0,
            count: 1
        };
        257
    ];
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.runs = vec![
        BodyRun {
            palette: 0,
            count: 40_000
        };
        2
    ];
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.runs.clear();
    f.variants[0] = vec![usage(0); 257];
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.variants[0] = vec![usage(0); 3];
    f.variants.resize(257, vec![usage(0); 3]);
    f.glows.resize(257, Some(usage(9)));
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.variants.truncate(3);
    f.glows.truncate(3);
    f.assets.resize(4097, f.assets[0]);
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
}

#[test]
fn fade_lengths_palette_indices_and_entry_state_require_valid_metadata() {
    let mut f = Fixture::new(3);
    f.mixed();
    for length in [0., -1., f64::NAN, f64::INFINITY, 65_536.] {
        f.style.as_mut().unwrap().head_fade = Some(BodyFade { palette: 1, length });
        assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    }
    f.style.as_mut().unwrap().head_fade = Some(BodyFade {
        palette: 3,
        length: 2.,
    });
    assert_eq!(f.plan(), Err(BodyPaintError::InvalidRecipe));
    f.style.as_mut().unwrap().head_fade = None;
    for alpha in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
        f.entry_alpha = alpha;
        assert_eq!(f.plan(), Err(BodyPaintError::InvalidVisual));
    }
}

#[test]
fn mixed_runs_do_not_need_an_unused_base_palette_glow() {
    let mut f = Fixture::new(5);
    f.runs = vec![
        BodyRun {
            palette: 1,
            count: 2,
        },
        BodyRun {
            palette: 2,
            count: 1,
        },
    ];
    f.visual.smoothed_speed = 8.;
    f.glows[0] = None;
    assert!(f.plan().is_ok());
}

#[test]
fn signed_zero_distance_and_stored_geometry_bits_survive() {
    let mut f = Fixture::new(2);
    f.visual.smoothed_speed = 8.;
    f.samples[0].flag = 0;
    f.samples[1].x = 0.;
    f.samples[1].y = 0.;
    f.samples[1].tangent = -0.;
    f.seed = Point { x: -0., y: -0. };
    let plan = f.plan().unwrap();
    assert_eq!(
        pass(&plan, OuterBoost)[0].alpha.requested.to_bits(),
        (-0_f64).to_bits()
    );
    assert_eq!(
        pass(&plan, OuterBoost)[0].alpha.effective.to_bits(),
        (-0_f64).to_bits()
    );
    assert_eq!(
        pass(&plan, Body)[0].rotation.unwrap().to_bits(),
        (-0_f64).to_bits()
    );
    f.samples[0].flag = 1;
    f.samples[0].x = 16_777_217_u32 as f32;
    f.view.camera.x = 16_777_216.5;
    let plan = f.plan().unwrap();
    let body = pass(&plan, Body)
        .into_iter()
        .find(|c| c.ordinal == 0)
        .unwrap();
    assert_eq!(body.translation.x, -0.375);
}

#[test]
fn host_math_formula_association_and_pass_specific_dimensions_are_exact_natively() {
    let mut f = Fixture::new(15);
    f.visual.scale = 1.17;
    f.visual.spawn = 0.7;
    f.visual.death = 0.2;
    f.visual.dead = true;
    f.visual.smoothed_speed = 7.;
    f.visual.boost_phase = 0.71;
    f.view.zoom = 0.83;
    f.quality.blend = 0.43;
    f.style.as_mut().unwrap().swell = 0.035;
    let plan = f.plan().unwrap();
    let line = (29_f64 * 1.17) * 0.5;
    let mut a = 0.7_f64 * (1. - 0.2);
    a *= a;
    let b = 0.7_f64 * (1. - 0.2) * ((7_f64 - 4.) / (10. - 4.));
    let expansion = b.powf(0.5);
    let outer = pass(&plan, OuterBoost)
        .into_iter()
        .find(|c| c.ordinal == 1)
        .unwrap();
    let outer_half =
        (1.5 * 0.83 * line * (1. + (62_f64 / 32. - 1.) * expansion)) * (1. + 3. * 0.035);
    assert_eq!(outer.destination.x.to_bits(), (-outer_half).to_bits());
    assert_eq!(
        outer.destination.width.to_bits(),
        (2. * outer_half).to_bits()
    );
    let outer_alpha = 1_f64 * a * expansion * 0.38 * (0.6 + 0.4 * (1_f64 / 4. - 1.15 * 0.71).cos());
    assert_eq!(outer.alpha.requested.to_bits(), outer_alpha.to_bits());
    let body = pass(&plan, Body)
        .into_iter()
        .find(|c| c.ordinal == 1)
        .unwrap();
    let body_size = line * (1. + 3. * 0.035);
    assert_eq!(body.destination.x.to_bits(), (-0.83 * body_size).to_bits());
    assert_eq!(
        body.destination.width.to_bits(),
        (0.83 * 2. * body_size).to_bits()
    );
    let outline = pass(&plan, Outline)[0];
    assert_eq!(
        outline.destination.width.to_bits(),
        (2. * (0.83 * line * 52. / 32.)).to_bits()
    );
    assert_eq!(
        outline.alpha.requested.to_bits(),
        ((a * (1. - b)) * 0.43).to_bits()
    );
    let inner = pass(&plan, InnerBoost)
        .into_iter()
        .find(|c| c.ordinal == 1)
        .unwrap();
    let glow_size = (line * 2.) * (1. + 3. * 0.035);
    assert_eq!(
        inner.destination.width.to_bits(),
        (0.83 * 2. * glow_size).to_bits()
    );
    let inner_alpha = 1_f64 * a * (b * 0.37) * 0.43 * (0.5 + 0.5 * (1_f64 / 4. - 0.71).cos());
    assert_eq!(inner.alpha.requested.to_bits(), inner_alpha.to_bits());
    let death = pass(&plan, Death)
        .into_iter()
        .find(|c| c.ordinal == 1)
        .unwrap();
    let envelope = (0.15 + 0.15 * (5. * std::f64::consts::PI * 0.2).sin().abs())
        * (std::f64::consts::PI * 0.2).sin();
    let death_alpha = 1_f64 * envelope * (0.6 + 0.4 * (1_f64 / 4. - 15. * 0.2).cos());
    assert_eq!(death.alpha.requested.to_bits(), death_alpha.to_bits());
}
