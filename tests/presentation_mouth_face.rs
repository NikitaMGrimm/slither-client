//! Authored synthetic mouth geometry witnesses; no artwork or external inputs.

use std::f64::consts::{FRAC_PI_2, TAU};

use slither_client::{
    presentation::{
        BodyRect, EyeLayoutInput, FaceGeometry, MouthFaceGeometry, MouthFaceLayout,
        MouthImageLayout, SingleEyeGeometry,
    },
    state::Point,
};

fn geometry() -> MouthFaceGeometry {
    MouthFaceGeometry { pupil_travel: 1.5 }
}

fn view() -> EyeLayoutInput {
    EyeLayoutInput {
        corrected_head: Point { x: 100., y: 200. },
        camera: Point { x: 90., y: 180. },
        viewport_half: Point { x: 400., y: 300. },
        scale: 2.,
        zoom: 0.5,
        death_progress: 0.,
    }
}

fn assert_bits(actual: MouthFaceLayout, expected: [MouthImageLayout; 3]) {
    for (actual, expected) in actual.images.into_iter().zip(expected) {
        for (actual, expected) in [
            actual.translation.x,
            actual.translation.y,
            actual.rotation,
            actual.destination.x,
            actual.destination.y,
            actual.destination.width,
            actual.destination.height,
        ]
        .into_iter()
        .zip([
            expected.translation.x,
            expected.translation.y,
            expected.rotation,
            expected.destination.x,
            expected.destination.y,
            expected.destination.width,
            expected.destination.height,
        ]) {
            assert_eq!(
                actual.to_bits(),
                expected.to_bits(),
                "{actual:?} != {expected:?}"
            );
        }
    }
}

#[test]
fn cardinal_translation_and_order_keep_the_asymmetric_mouth_pivot() {
    let actual = geometry()
        .layout(0., Point { x: 1., y: -0.5 }, view())
        .unwrap();
    let mark = BodyRect {
        x: -6.,
        y: -6.,
        width: 12.,
        height: 12.,
    };
    assert_bits(
        actual,
        [
            MouthImageLayout {
                translation: Point {
                    x: 403.25,
                    y: 302.5,
                },
                rotation: 0.,
                destination: mark,
            },
            MouthImageLayout {
                translation: Point {
                    x: 403.25,
                    y: 316.5,
                },
                rotation: 0.,
                destination: mark,
            },
            MouthImageLayout {
                translation: Point {
                    x: 411.25,
                    y: 309.5,
                },
                rotation: 0.,
                destination: BodyRect {
                    x: -40. * 0.16,
                    y: -65. * 0.16,
                    width: 79. * 0.16,
                    height: 130. * 0.16,
                },
            },
        ],
    );
    assert_ne!(
        actual.images[2].destination.x,
        -actual.images[2].destination.width / 2.
    );
}

// Independent direct transcription of the authored equations, using native trig.
// This oracle checks every output bit across varied inputs; the cancellation
// witnesses below separately discriminate tempting algebraic rewrites.
fn normative(f: f64, r: Point, v: EyeLayoutInput) -> [MouthImageLayout; 3] {
    let de = -3. * v.scale;
    let le = 7. * v.scale;
    let me = (v.scale * v.zoom) * 0.25;
    let dm = 5. * v.scale;
    let mm = (v.scale * v.zoom) * 0.16;
    let translated = |x: f64, y: f64, destination| MouthImageLayout {
        translation: Point {
            x: v.viewport_half.x + ((x + v.corrected_head.x) - v.camera.x) * v.zoom,
            y: v.viewport_half.y + ((y + v.corrected_head.y) - v.camera.y) * v.zoom,
        },
        rotation: f,
        destination,
    };
    let mark = |b: f64| {
        translated(
            (f.cos() * (de + 0.5) + r.x * v.scale) + b.cos() * le,
            (f.sin() * (de + 0.5) + r.y * v.scale) + b.sin() * le,
            BodyRect {
                x: -24. * me,
                y: -24. * me,
                width: 48. * me,
                height: 48. * me,
            },
        )
    };
    [
        mark(f - FRAC_PI_2),
        mark(f + FRAC_PI_2),
        translated(
            f.cos() * (dm + 0.5) + r.x * v.scale,
            f.sin() * (dm + 0.5) + r.y * v.scale,
            BodyRect {
                x: -40. * mm,
                y: -65. * mm,
                width: 79. * mm,
                height: 130. * mm,
            },
        ),
    ]
}

#[test]
fn oblique_unnormalized_rotation_scale_camera_and_gaze_match_exact_equations() {
    for f in [-7.25, -0., 0.37, FRAC_PI_2, TAU + 0.7] {
        for (scale, zoom) in [(0.125, 3.), (1.7, 0.37), (3.25, 1.125)] {
            let v = EyeLayoutInput {
                corrected_head: Point {
                    x: -73.25,
                    y: 192.125,
                },
                camera: Point { x: 14.75, y: -23.5 },
                scale,
                zoom,
                ..view()
            };
            let pupil = Point { x: 1.25, y: -2.75 };
            assert_bits(
                geometry().layout(f, pupil, v).unwrap(),
                normative(f, pupil, v),
            );
        }
    }
    let v = EyeLayoutInput {
        corrected_head: Point::default(),
        camera: Point::default(),
        viewport_half: Point::default(),
        scale: 1.,
        zoom: 1.,
        ..view()
    };
    let resting = geometry().layout(FRAC_PI_2, Point::default(), v).unwrap();
    let gaze = geometry()
        .layout(FRAC_PI_2, Point { x: 2., y: 0. }, v)
        .unwrap();
    for (a, b) in resting.images.into_iter().zip(gaze.images) {
        assert_eq!(b.translation.x, a.translation.x + 2.);
        assert_eq!(b.translation.y.to_bits(), a.translation.y.to_bits());
        assert_eq!(b.rotation, FRAC_PI_2);
    }
}

#[test]
fn large_head_cancellation_must_follow_local_addition_in_both_axes() {
    let huge = 9_007_199_254_740_992.;
    let v = EyeLayoutInput {
        corrected_head: Point { x: huge, y: huge },
        camera: Point { x: huge, y: huge },
        viewport_half: Point::default(),
        scale: 1.,
        zoom: 1.,
        ..view()
    };
    let x = geometry().layout(0., Point::default(), v).unwrap().images[2];
    assert_eq!(x.translation.x, 6.);
    assert_ne!(x.translation.x, 5.5);
    let y = geometry()
        .layout(FRAC_PI_2, Point::default(), v)
        .unwrap()
        .images[2];
    assert_eq!(y.translation.y, 6.);
    assert_ne!(y.translation.y, 5.5);
}

#[test]
fn three_term_mark_sum_is_left_associated_before_head_cancellation() {
    let huge = 9_007_199_254_740_992.;
    let f: f64 = 0.5;
    let v = EyeLayoutInput {
        corrected_head: Point { x: 0., y: -huge },
        camera: Point::default(),
        viewport_half: Point::default(),
        scale: 1.,
        zoom: 1.,
        ..view()
    };
    let actual = geometry().layout(f, Point { x: 0., y: huge }, v).unwrap();
    assert_eq!(actual.images[1].translation.y, 6.);
    let reassociated = (f.sin() * -2.5 + (huge + (f + FRAC_PI_2).sin() * 7.)) - huge;
    assert_eq!(reassociated, 4.);
    assert_ne!(actual.images[1].translation.y, reassociated);
}

#[test]
fn death_and_selected_travel_do_not_change_read_only_layout() {
    let pupil = Point { x: -1., y: 2. };
    let expected = normative(0.7, pupil, view());
    for travel in [0., -0., f64::from_bits(1), 4096.] {
        for death_progress in [-0., 0., 0.25, 0.5, f64::from_bits(1_f64.to_bits() - 1)] {
            let g = MouthFaceGeometry {
                pupil_travel: travel,
            };
            assert_bits(
                g.layout(
                    0.7,
                    pupil,
                    EyeLayoutInput {
                        death_progress,
                        ..view()
                    },
                )
                .unwrap(),
                expected,
            );
        }
    }
}

#[test]
fn travel_bounds_signed_zero_and_closed_family_accessors_are_exact() {
    let positive = MouthFaceGeometry { pupil_travel: 0. };
    let negative = MouthFaceGeometry { pupil_travel: -0. };
    for g in [
        positive,
        negative,
        MouthFaceGeometry {
            pupil_travel: 4096.,
        },
    ] {
        g.validate().unwrap();
        assert!(g.same_bits(&g));
        let face = FaceGeometry::Mouth(g);
        face.validate().unwrap();
        assert_eq!(face.pupil_travel().to_bits(), g.pupil_travel.to_bits());
        assert_eq!(face.mouth(), Some(&g));
        assert!(face.paired().is_none() && face.single_image().is_none());
    }
    assert!(!positive.same_bits(&negative));
    assert!(!positive.same_bits(&geometry()));
    assert!(FaceGeometry::default().mouth().is_none());
    assert!(
        FaceGeometry::SingleImage(SingleEyeGeometry {
            base_size: 1.,
            pupil_size: 1.,
            pupil_travel: 0.
        })
        .mouth()
        .is_none()
    );
    for value in [
        -f64::from_bits(1),
        -1.,
        f64::from_bits(4096_f64.to_bits() + 1),
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
    ] {
        let g = MouthFaceGeometry {
            pupil_travel: value,
        };
        assert!(g.validate().is_err());
        assert!(FaceGeometry::Mouth(g).validate().is_err());
        assert!(g.layout(0., Point::default(), view()).is_err());
    }
}

#[test]
fn every_input_channel_rejects_nonfinite_values_and_all_range_edges_are_enforced() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for channel in 0..12 {
            let mut f = 0.;
            let mut r = Point::default();
            let mut v = view();
            match channel {
                0 => f = bad,
                1 => r.x = bad,
                2 => r.y = bad,
                3 => v.corrected_head.x = bad,
                4 => v.corrected_head.y = bad,
                5 => v.camera.x = bad,
                6 => v.camera.y = bad,
                7 => v.viewport_half.x = bad,
                8 => v.viewport_half.y = bad,
                9 => v.scale = bad,
                10 => v.zoom = bad,
                11 => v.death_progress = bad,
                _ => unreachable!(),
            }
            assert!(geometry().layout(f, r, v).is_err(), "channel {channel}");
        }
    }
    for bad in [-1., -0., 0.] {
        for v in [
            EyeLayoutInput {
                scale: bad,
                ..view()
            },
            EyeLayoutInput {
                zoom: bad,
                ..view()
            },
        ] {
            assert!(geometry().layout(0., Point::default(), v).is_err());
        }
    }
    for bad in [-f64::from_bits(1), -1., 1., 2.] {
        assert!(
            geometry()
                .layout(
                    0.,
                    Point::default(),
                    EyeLayoutInput {
                        death_progress: bad,
                        ..view()
                    }
                )
                .is_err()
        );
    }
    for half in [
        Point {
            x: -f64::from_bits(1),
            y: 0.,
        },
        Point { x: 0., y: -1. },
    ] {
        assert!(
            geometry()
                .layout(
                    0.,
                    Point::default(),
                    EyeLayoutInput {
                        viewport_half: half,
                        ..view()
                    }
                )
                .is_err()
        );
    }
    let zeros = EyeLayoutInput {
        viewport_half: Point { x: -0., y: -0. },
        ..view()
    };
    assert!(geometry().layout(-0., Point::default(), zeros).is_ok());
    let tiny = EyeLayoutInput {
        scale: f64::from_bits(1),
        zoom: f64::from_bits(1),
        ..view()
    };
    let layout = geometry().layout(-0., Point::default(), tiny).unwrap();
    for image in layout.images {
        assert_eq!(image.rotation.to_bits(), (-0_f64).to_bits());
        assert_eq!(image.destination.x.to_bits(), (-0_f64).to_bits());
        assert_eq!(image.destination.y.to_bits(), (-0_f64).to_bits());
    }
}

#[test]
fn finite_inputs_that_overflow_intermediates_fail_without_mutation() {
    let cases = [
        (
            0.,
            Point::default(),
            EyeLayoutInput {
                scale: f64::MAX,
                ..view()
            },
        ),
        (
            0.,
            Point::default(),
            EyeLayoutInput {
                scale: f64::MAX / 8.,
                zoom: 16.,
                ..view()
            },
        ),
        (
            0.,
            Point::default(),
            EyeLayoutInput {
                scale: 1.,
                zoom: f64::MAX / 2.,
                ..view()
            },
        ),
        (0., Point { x: f64::MAX, y: 0. }, view()),
        (
            0.,
            Point {
                x: 0.,
                y: -f64::MAX,
            },
            view(),
        ),
        (
            0.,
            Point {
                x: f64::MAX / 2.,
                y: 0.,
            },
            EyeLayoutInput {
                corrected_head: Point { x: f64::MAX, y: 0. },
                scale: 1.,
                ..view()
            },
        ),
        (
            0.,
            Point::default(),
            EyeLayoutInput {
                corrected_head: Point { x: f64::MAX, y: 0. },
                camera: Point {
                    x: -f64::MAX,
                    y: 0.,
                },
                ..view()
            },
        ),
        (
            0.,
            Point::default(),
            EyeLayoutInput {
                corrected_head: Point {
                    x: f64::MAX / 2.,
                    y: 0.,
                },
                viewport_half: Point { x: f64::MAX, y: 0. },
                scale: 1.,
                zoom: 1.,
                ..view()
            },
        ),
    ];
    let g = geometry();
    let before = g;
    for (f, pupil, v) in cases {
        assert!(g.layout(f, pupil, v).is_err(), "{v:?} {pupil:?}");
        assert!(g.same_bits(&before));
    }
}
