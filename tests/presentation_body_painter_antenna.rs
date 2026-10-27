//! Original synthetic body/antenna barrier cases; no reference or raster inputs.
use slither_client::{presentation::*, state::Point};

fn plan(
    effect: AntennaBarrierEffect,
    dead: bool,
    flags: u8,
) -> Result<BodyPaintPlan, BodyPaintError> {
    let samples = [
        BodyPaintSample {
            ordinal: 0,
            x: 1.,
            y: 0.,
            tangent: 0.,
            flag: flags,
        },
        BodyPaintSample {
            ordinal: 1,
            x: 3.,
            y: 0.,
            tangent: 0.,
            flag: flags,
        },
    ];
    let usage = BodyAssetUse {
        asset: 0,
        source_rect: None,
    };
    let variants = [usage];
    let palettes = [BodyPalette {
        variants: &variants,
        boost_glow: None,
    }];
    let assets = [BodyAsset {
        handle: 1,
        revision: 1,
        width: 1,
        height: 1,
        status: BodyAssetStatus::Ready,
    }];
    let input = BodyPaintInput {
        geometry: BodyPaintGeometry {
            samples: &samples,
            active_count: 2,
            distance_cursor_seed: Point { x: 2., y: 0. },
            eligible: true,
        },
        recipe: BodyPaintRecipe {
            base_palette: 0,
            palettes: &palettes,
            runs: &[],
            variant_mode: BodyVariantMode::First,
            variant_period: 1,
            custom: false,
            style: Some(BodyStyle {
                detailed_segments: false,
                swell: 0.,
                rotate_segments: false,
                head_fade: None,
                tail_fade: None,
            }),
            outline: Some(usage),
            shadow: Some(usage),
            death: Some(usage),
        },
        assets: &assets,
        view: BodyPaintView {
            camera: Point { x: 0., y: 0. },
            zoom: 1.,
            half_width: 10.,
            half_height: 10.,
        },
        quality: BodyPaintQuality {
            high_quality: false,
            blend: 0.,
        },
        visual: BodyPaintVisual {
            scale: 1.,
            spawn: 1.,
            death: 0.25,
            dead,
            smoothed_speed: 4.,
            boost_threshold: 5.,
            cruise_speed: 4.,
            maximum_speed: 10.,
            boost_phase: 0.,
        },
        entry_alpha: 1.,
        command_limit: 100,
    };
    let result = plan_standard_body_with_antenna(input, effect);
    if effect == AntennaBarrierEffect::Disabled {
        assert_eq!(result, plan_standard_body(input));
    }
    result
}

#[test]
fn disabled_is_exact_legacy_for_live_and_death_draws() {
    for dead in [false, true] {
        for flags in [1, 2] {
            plan(AntennaBarrierEffect::Disabled, dead, flags).unwrap();
        }
    }
}

#[test]
fn both_effects_recompute_first_death_distance_without_saturation() {
    let disabled = plan(AntennaBarrierEffect::Disabled, true, 2).unwrap();
    let rejected = plan(
        AntennaBarrierEffect::Rejected {
            cursor: Point { x: 1., y: 0. },
        },
        true,
        2,
    )
    .unwrap();
    let eligible = plan(
        AntennaBarrierEffect::Eligible {
            cursor: Point { x: 2.5, y: 0.25 },
            scoped_alpha: 0.,
        },
        true,
        2,
    )
    .unwrap();
    let barrier = disabled.antenna_barrier;
    assert_eq!(&disabled.commands[..barrier], &rejected.commands[..barrier]);
    assert_eq!(&disabled.commands[..barrier], &eligible.commands[..barrier]);
    let base = disabled.commands[barrier].alpha.requested;
    assert!(base > 0.);
    let death = 0.25;
    let envelope = (0.15 + 0.15 * (5. * std::f64::consts::PI * death).sin().abs())
        * (std::f64::consts::PI * death).sin();
    let expected = |distance| distance * envelope * (0.6 + 0.4 * (1. / 4. - 15. * death).cos());
    assert_eq!(
        rejected.commands[barrier].alpha.requested,
        expected(2. / 6.)
    );
    assert_eq!(
        eligible.commands[barrier].alpha.requested,
        expected(0.75 / 6.)
    );
    // The bulb alpha does not multiply requested death alpha.
    assert!(eligible.commands[barrier].alpha.effective > 0.);
    assert_eq!(
        disabled.commands[barrier + 1],
        eligible.commands[barrier + 1]
    );
    assert_eq!(disabled.final_distance_cursor, Point { x: 1., y: 0. });
    assert_eq!(eligible.final_distance_cursor, Point { x: 1., y: 0. });
}

#[test]
fn no_death_visits_leave_exact_barrier_cursor_in_diagnostics() {
    let cursor = Point { x: 0.125, y: -0.75 };
    for dead in [false, true] {
        let p = plan(
            AntennaBarrierEffect::Eligible {
                cursor,
                scoped_alpha: 0.25,
            },
            dead,
            1,
        )
        .unwrap();
        assert_eq!(p.final_distance_cursor, cursor);
        assert_eq!(p.antenna_barrier, p.commands.len());
    }
}

#[test]
fn invalid_barrier_cursor_or_scoped_alpha_rejects_atomically() {
    assert_eq!(
        plan(
            AntennaBarrierEffect::Rejected {
                cursor: Point { x: f64::NAN, y: 0. }
            },
            true,
            2
        ),
        Err(BodyPaintError::InvalidGeometry)
    );
    for scoped_alpha in [-0.1, 1.1, f64::NAN, f64::INFINITY] {
        assert_eq!(
            plan(
                AntennaBarrierEffect::Eligible {
                    cursor: Point { x: 0., y: 0. },
                    scoped_alpha
                },
                true,
                2
            ),
            Err(BodyPaintError::InvalidVisual)
        );
    }
}
