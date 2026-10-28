//! Original synthetic selection witnesses from the authored numeric skin rules.

use slither_client::presentation::*;

fn selected(skin: u8) -> SkinDescriptor {
    resolve_skin(skin, &[], false).unwrap()
}

fn custom(pairs: &[(u8, u8)]) -> Vec<u8> {
    let mut bytes = vec![255, 40, 7, 99, 0, 255, 64, 3];
    bytes.extend(pairs.iter().flat_map(|&(count, palette)| [count, palette]));
    bytes
}

#[test]
fn authored_local_policy_preserves_three_choices_and_plain_faces() {
    for (skin, palette) in [
        (0, 0),
        (1, 1),
        (2, 2),
        (24, 0),
        (25, 1),
        (26, 2),
        (27, 0),
        (40, 1),
        (41, 2),
        (60, 0),
        (255, 0),
    ] {
        let descriptor = resolve_authored_local_skin(skin, &custom(&[(7, 41)])).unwrap();
        let mut expected = selected(palette);
        expected.skin = skin;
        assert_eq!(descriptor, expected);
        assert!(!descriptor.custom);
        assert_eq!(descriptor.variant_mode, BodyVariantMode::PingPong);
        assert_eq!(descriptor.variant_period, 7);
        assert_eq!(descriptor.face, FaceGeometry::default());
        assert_eq!(descriptor.antenna, None);
    }
}

#[test]
fn authored_local_policy_bounds_but_does_not_display_custom_data() {
    assert_eq!(
        resolve_authored_local_skin(41, &[255; 255]).unwrap(),
        resolve_authored_local_skin(41, &[]).unwrap()
    );
    assert_eq!(resolve_authored_local_skin(41, &[0; 256]), Err(SkinError));
}

fn pairs(rule: &SkinDescriptor) -> Vec<(usize, usize)> {
    rule.runs
        .iter()
        .map(|run| (run.palette, run.count))
        .collect()
}

fn expanded(rule: &SkinDescriptor) -> Vec<usize> {
    rule.runs
        .iter()
        .flat_map(|run| std::iter::repeat_n(run.palette, run.count))
        .collect()
}

#[test]
fn builtin_patterns_preserve_head_origin_run_lengths_and_cycle_seams() {
    let rule = selected(9);
    assert_eq!(
        expanded(&rule),
        [
            7, 9, 7, 9, 7, 9, 7, 9, 7, 9, 7, 10, 10, 10, 10, 10, 10, 10, 10, 10
        ]
    );
    assert_eq!(expanded(&selected(15)), (0..9).collect::<Vec<_>>());
    for (skin, expected) in [
        (10, vec![(9, 5), (1, 5), (7, 5)]),
        (
            21,
            vec![
                (3, 7),
                (18, 6),
                (20, 1),
                (19, 1),
                (20, 1),
                (19, 1),
                (20, 1),
                (19, 1),
                (20, 1),
                (18, 6),
            ],
        ),
        (29, vec![(11, 2), (4, 1), (11, 4), (4, 1), (11, 2)]),
        (
            30,
            vec![(10, 2), (19, 1), (20, 1), (10, 2), (20, 1), (19, 1)],
        ),
        (
            34,
            vec![
                (7, 2),
                (9, 1),
                (13, 2),
                (9, 1),
                (16, 2),
                (9, 1),
                (12, 2),
                (9, 1),
                (7, 2),
                (9, 1),
                (16, 2),
                (9, 1),
            ],
        ),
        (45, vec![(7, 3), (9, 8), (7, 3)]),
        (47, vec![(16, 3), (18, 9), (7, 8), (16, 4)]),
        (49, vec![(23, 5), (9, 8), (23, 2)]),
        (51, vec![(7, 3), (9, 2), (16, 6), (9, 2)]),
        (
            61,
            vec![(30, 6), (35, 6), (33, 6), (31, 6), (32, 6), (34, 6)],
        ),
    ] {
        let rule = selected(skin);
        assert_eq!(pairs(&rule), expected, "skin {skin}");
        assert_eq!(rule.base_palette, expected[0].0);
        assert!(!rule.custom);
    }
    for skin in [0, 8, 66, 128, 255] {
        assert_eq!(pairs(&selected(skin)), [(usize::from(skin % 9), 1)]);
    }
    for skin in 53..=58 {
        assert_eq!(pairs(&selected(skin)), [(usize::from(skin - 23), 1)]);
    }
}

#[test]
fn custom_runs_admit_normal_colors_merge_after_skips_and_keep_the_seam() {
    let mut bytes = custom(&[
        (1, 5),
        (9, 36),
        (0, 7),
        (2, 5),
        (3, 38),
        (4, 40),
        (2, 41),
        (1, 5),
    ]);
    bytes.push(255); // An unmatched count does not form a run.
    let rule = resolve_skin(27, &bytes, false).unwrap();
    assert_eq!(pairs(&rule), [(5, 3), (41, 2), (5, 1)]);
    assert_eq!((rule.skin, rule.base_palette, rule.custom), (27, 5, true));
    assert_eq!(rule.variant_mode, BodyVariantMode::First);
    assert_eq!(rule.variant_period, 1);
    for palette in [0, 35, 37, 39, 41] {
        assert_eq!(
            pairs(&resolve_skin(0, &custom(&[(2, palette)]), false).unwrap()),
            [(usize::from(palette), 2)]
        );
    }
}

#[test]
fn empty_rejected_short_and_header_only_custom_data_fall_back() {
    for skin in [24, 27, 40, 41, 60] {
        for bytes in [
            vec![],
            vec![255; 8],
            vec![255; 9],
            custom(&[(0, 7)]),
            custom(&[(2, 36), (2, 38), (2, 40), (2, 42), (2, 255)]),
        ] {
            assert_eq!(resolve_skin(skin, &bytes, false).unwrap(), selected(skin));
        }
    }
}

#[test]
fn custom_length_limit_bounds_merged_counts_without_expanding_segments() {
    let mut bytes = vec![0; 255];
    for pair in bytes[8..].as_chunks_mut::<2>().0 {
        pair[0] = 255;
    }
    let rule = resolve_skin(60, &bytes, false).unwrap();
    assert_eq!(pairs(&rule), [(0, 31_365)]);
    assert_eq!(resolve_skin(0, &[0; 256], false), Err(SkinError));
    assert_eq!(SkinError.to_string(), "custom skin data exceeds 255 bytes");
}

#[test]
fn accepted_custom_runs_override_every_special_face_body_and_antenna() {
    for skin in [
        24, 25, 27, 37, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 59, 60, 62, 63, 64,
    ] {
        let rule = resolve_skin(skin, &custom(&[(1, 26)]), false).unwrap();
        assert_eq!(rule.face, FaceGeometry::default(), "skin {skin}");
        assert_eq!(rule.face_sources, SkinFaceSources::None);
        assert_eq!(rule.antenna, None);
        assert_eq!(rule.body_style, selected(0).body_style);
        assert_eq!(rule.variant_mode, BodyVariantMode::First);
        assert_eq!(rule.variant_period, 1);
    }
}

#[test]
fn nsr_changes_only_segment_rotation_for_builtin_and_custom_selection() {
    for skin in [0, 24, 27, 40, 41, 60] {
        for bytes in [vec![], custom(&[(2, 37)])] {
            let rotating = resolve_skin(skin, &bytes, false).unwrap();
            let mut fixed = resolve_skin(skin, &bytes, true).unwrap();
            assert!(rotating.body_style.rotate_segments);
            assert!(!fixed.body_style.rotate_segments);
            fixed.body_style.rotate_segments = true;
            assert_eq!(fixed, rotating);
        }
    }
}

#[test]
fn body_variants_and_dense_fades_retain_stock_palette_ids() {
    let ordinary = selected(0);
    assert_eq!(ordinary.variant_mode, BodyVariantMode::PingPong);
    assert_eq!(ordinary.variant_period, 7);
    assert_eq!(ordinary.body_style.swell.to_bits(), 0_f64.to_bits());
    assert_eq!(ordinary.body_style.head_fade, None);
    assert_eq!(ordinary.body_style.tail_fade, None);
    assert!(!ordinary.body_style.detailed_segments);
    let dense = selected(60);
    assert_eq!(pairs(&dense), [(36, 1)]);
    assert_eq!(dense.variant_mode, BodyVariantMode::Cycle);
    assert_eq!(dense.variant_period, 60);
    assert_eq!(
        dense.body_style,
        BodyStyle {
            detailed_segments: true,
            swell: 0.,
            rotate_segments: true,
            head_fade: Some(BodyFade {
                palette: 37,
                length: 30.
            }),
            tail_fade: Some(BodyFade {
                palette: 38,
                length: 30.
            }),
        }
    );
    assert_eq!(selected(27).body_style.swell, 0.06);
}

#[test]
fn ordinary_paired_eye_overrides_are_exact() {
    assert_eq!(
        selected(0).face,
        FaceGeometry::Paired(PairedFaceGeometry::default())
    );
    for (skin, color, alpha) in [
        (25, [255, 86, 9], 1.),
        (44, [212; 3], 0.75),
        (63, [0; 3], 1.),
        (64, [255, 255, 128], 1.),
    ] {
        let rule = selected(skin);
        let mut expected = StandardEyeGeometry {
            eye_color: color,
            eye_alpha: alpha,
            ..StandardEyeGeometry::default()
        };
        if skin == 63 {
            expected.pupil_color = [204; 3];
            expected.pupil_radius = 2.5;
        }
        assert_eq!(rule.face.paired().unwrap().eyes, expected);
        rule.face.validate().unwrap();
    }
}

#[test]
fn single_image_face_has_exact_geometry_roles_and_source_crops() {
    let rule = selected(27);
    assert_eq!(
        rule.face,
        FaceGeometry::SingleImage(SingleEyeGeometry {
            base_size: 29.,
            pupil_size: 14.,
            pupil_travel: 4.
        })
    );
    let SkinFaceSources::SingleImage { base, pupil } = rule.face_sources else {
        panic!("single-image sources required")
    };
    assert_eq!(base.source, SkinSourceRole::SingleEyeBase);
    assert_eq!(pupil.source, SkinSourceRole::SingleEyePupil);
    assert_eq!(
        base.source_rect,
        Some(BodyRect {
            x: 0.,
            y: 0.,
            width: 64.,
            height: 64.
        })
    );
    assert_eq!(
        pupil.source_rect,
        Some(BodyRect {
            x: 0.,
            y: 0.,
            width: 48.,
            height: 48.
        })
    );
    assert_eq!(rule.antenna, None);
    rule.face.validate().unwrap();
}

#[test]
fn mouth_and_paired_side_sources_stay_separate_from_numeric_geometry() {
    let mouth = selected(40);
    assert_eq!(
        mouth.face,
        FaceGeometry::Mouth(MouthFaceGeometry { pupil_travel: 2.3 })
    );
    assert_eq!(
        mouth.face_sources,
        SkinFaceSources::Mouth {
            eye_marks: SkinSourceRole::MouthEyeMarks,
            mouth: SkinSourceRole::Mouth
        }
    );
    assert_eq!(mouth.antenna, None);
    mouth.face.validate().unwrap();
    let side = selected(41);
    assert_eq!(
        side.face,
        FaceGeometry::Paired(PairedFaceGeometry {
            eyes: StandardEyeGeometry {
                forward: 34.,
                separation: 14.,
                eye_radius: 8.,
                pupil_radius: 4.5,
                pupil_travel: 3.,
                outline_width: 3.,
                eye_alpha: 1.,
                ..StandardEyeGeometry::default()
            },
            decoration: Some(PairedSideGeometry {
                forward: 13.,
                lateral: 6.,
                lateral_bias: 0.5,
                rotation_offset: 0.4,
                image_scale: 0.25,
                pivot_x: 28.,
                pivot_y: 44.,
                width: 105.,
                height: 88.,
            }),
        })
    );
    assert_eq!(
        side.face_sources,
        SkinFaceSources::PairedSide(SkinSourceRole::PairedSide)
    );
    side.face.validate().unwrap();
}

#[test]
fn ordinary_antenna_roles_topology_and_fractional_offset_bits_match_authored_witnesses() {
    use SkinSourceRole::*;
    for (skin, nodes, source, rotate_bulb, repeated_inner_strokes, offset_bits) in [
        (24, 8, AcBulb, false, true, 0xc024000000000000),
        (25, 9, CdBulb, true, false, 0xc014000000000000),
        (37, 9, KwkBulb, true, true, 0xc043800000000000),
        (39, 9, PwdBulb, true, true, 0xc042000000000000),
        (42, 9, PlayBulb, true, true, 0xc03d000000000000),
        (45, 9, LeafBulb, true, true, 0xc0400e147ae147ae),
        (46, 9, SwissBulb, true, true, 0xc03fc7ae147ae148),
        (47, 9, MoldovaBulb, true, true, 0xc04119999999999a),
        (48, 9, VietnamBulb, true, true, 0xc03f733333333333),
        (49, 11, ArgentinaBulb, true, true, 0xc0408ccccccccccd),
        (59, 11, MovBulb, true, true, 0xc044800000000000),
        (62, 9, BonkBulb, true, true, 0xc03d000000000000),
    ] {
        let rule = selected(skin);
        let antenna = rule.antenna.unwrap();
        let geometry = antenna.geometry;
        assert_eq!(antenna.source, source);
        assert_eq!(
            (
                geometry.nodes,
                geometry.rotate_bulb,
                geometry.repeated_inner_strokes
            ),
            (nodes, rotate_bulb, repeated_inner_strokes)
        );
        assert_eq!(geometry.bulb.offset_x.to_bits(), offset_bits, "skin {skin}");
        assert_eq!(
            rule.face.paired().unwrap().eyes.eye_alpha,
            if skin == 24 { 0.75 } else { 1. }
        );
        geometry.validate().unwrap();
    }
    assert_eq!(selected(0).antenna, None);
}

#[test]
fn representative_antenna_colors_opacity_and_nominal_dimensions_are_exact() {
    for (skin, expected) in [
        (
            24,
            OrdinaryAntennaGeometry {
                nodes: 8,
                outer_color: 0x00688c,
                inner_color: 0x64c8e7,
                inner_opacity: 0.35,
                repeated_inner_strokes: true,
                rotate_bulb: false,
                bulb: AntennaBulbGeometry {
                    offset_x: -10.,
                    offset_y: -10.,
                    width: 20.,
                    height: 20.,
                    scale: 1.,
                    opacity: 0.75,
                },
            },
        ),
        (
            25,
            OrdinaryAntennaGeometry {
                nodes: 9,
                outer_color: 0,
                inner_color: 0x5630d7,
                inner_opacity: 1.,
                repeated_inner_strokes: false,
                rotate_bulb: true,
                bulb: AntennaBulbGeometry {
                    offset_x: -5.,
                    offset_y: -10.,
                    width: 20.,
                    height: 20.,
                    scale: 1.6,
                    opacity: 1.,
                },
            },
        ),
        (
            49,
            OrdinaryAntennaGeometry {
                nodes: 11,
                outer_color: 0x64accf,
                inner_color: 0x84dcff,
                inner_opacity: 0.7,
                repeated_inner_strokes: true,
                rotate_bulb: true,
                bulb: AntennaBulbGeometry {
                    offset_x: f64::from_bits(0xc0408ccccccccccd),
                    offset_y: -76.,
                    width: 152.,
                    height: 152.,
                    scale: 0.3,
                    opacity: 1.,
                },
            },
        ),
    ] {
        assert!(
            selected(skin)
                .antenna
                .unwrap()
                .geometry
                .same_bits(&expected)
        );
    }
}
