//! Authored synthetic image-eye arithmetic; no artwork or external reference inputs.

use slither_client::{
    presentation::{EyeLayoutInput, FaceGeometry, PairedFaceGeometry, SingleEyeGeometry},
    state::Point,
};

fn geometry() -> SingleEyeGeometry {
    SingleEyeGeometry {
        base_size: 20.,
        pupil_size: 8.,
        pupil_travel: 3.,
    }
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

#[test]
fn translated_two_image_witness_keeps_unscaled_bias_and_world_axis_gaze() {
    let layout = geometry()
        .layout(0., Point { x: 1., y: -0.5 }, view())
        .unwrap();
    let [base, pupil] = layout.destinations;
    assert_eq!(
        (base.x, base.y, base.width, base.height),
        (398., 300., 20., 20.)
    );
    assert_eq!(
        (pupil.x, pupil.y, pupil.width, pupil.height),
        (405.075, 305.5, 8., 8.)
    );
    assert_eq!(layout.alpha, 1.);
    let mut v = view();
    v.corrected_head = Point::default();
    v.camera = Point::default();
    v.viewport_half = Point::default();
    v.scale = 1.;
    v.zoom = 1.;
    let layout = geometry()
        .layout(std::f64::consts::FRAC_PI_2, Point { x: 2., y: 0. }, v)
        .unwrap();
    // Horizontal gaze remains horizontal when the face points vertically.
    assert_eq!(layout.destinations[1].x, -2.);
    assert_eq!(layout.destinations[1].y, -0.8500000000000001);
}

#[test]
fn absolute_head_addition_and_centering_precede_camera_subtraction() {
    let mut v = view();
    v.corrected_head.x = 9_007_199_254_740_992.;
    v.camera.x = v.corrected_head.x;
    v.viewport_half.x = 0.;
    v.scale = 1.;
    v.zoom = 1.;
    let g = SingleEyeGeometry {
        base_size: 2.,
        pupil_size: 2.,
        pupil_travel: 0.,
    };
    assert_eq!(
        g.layout(0., Point::default(), v).unwrap().destinations[0].x,
        4.
    );
    // Subtracting the camera first would instead give 3 - 1 = 2.
}

#[test]
fn death_alpha_has_a_live_branch_and_no_geometry_multiplier() {
    let g = geometry();
    let live = g.layout(0.7, Point { x: -1., y: 2. }, view()).unwrap();
    for (death_progress, alpha) in [(-0., 1.), (0.75, 0.5), (0.9375, 0.25)] {
        let mut v = view();
        v.death_progress = death_progress;
        let dead = g.layout(0.7, Point { x: -1., y: 2. }, v).unwrap();
        assert_eq!(dead.destinations, live.destinations);
        assert_eq!(dead.alpha, alpha);
    }
}

#[test]
fn geometry_bounds_and_signed_zero_coherence_are_explicit() {
    let g = geometry();
    for value in [
        0.,
        -0.,
        -1.,
        4096.00001,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NAN,
    ] {
        assert!(
            SingleEyeGeometry {
                base_size: value,
                ..g
            }
            .validate()
            .is_err()
        );
        assert!(
            SingleEyeGeometry {
                pupil_size: value,
                ..g
            }
            .validate()
            .is_err()
        );
    }
    for value in [-1., 4096.00001, f64::INFINITY, f64::NAN] {
        assert!(
            SingleEyeGeometry {
                pupil_travel: value,
                ..g
            }
            .validate()
            .is_err()
        );
    }
    let positive = SingleEyeGeometry {
        base_size: f64::from_bits(1),
        pupil_size: 4096.,
        pupil_travel: 0.,
    };
    let negative = SingleEyeGeometry {
        pupil_travel: -0.,
        ..positive
    };
    positive.validate().unwrap();
    negative.validate().unwrap();
    assert!(positive.same_bits(&positive));
    assert!(!positive.same_bits(&negative));
    assert!(negative.pupil_travel.is_sign_negative());
    assert!(!g.same_bits(&SingleEyeGeometry {
        base_size: 21.,
        ..g
    }));
    assert!(!g.same_bits(&SingleEyeGeometry {
        pupil_size: 9.,
        ..g
    }));
}

#[test]
fn active_family_has_no_paired_fallback_and_selects_its_own_travel() {
    let single = FaceGeometry::SingleImage(geometry());
    assert!(single.paired().is_none());
    assert_eq!(single.single_image(), Some(&geometry()));
    assert_eq!(single.pupil_travel(), 3.);
    let paired = FaceGeometry::Paired(PairedFaceGeometry::default());
    assert!(paired.single_image().is_none());
    assert_eq!(paired.paired(), Some(&PairedFaceGeometry::default()));
    assert_eq!(paired.pupil_travel(), 2.3);
    single.validate().unwrap();
    paired.validate().unwrap();
}

#[test]
fn layout_rejects_invalid_views_and_nonfinite_arithmetic() {
    let g = geometry();
    for value in [0., -0., -1., f64::INFINITY, f64::NAN] {
        assert!(
            g.layout(
                0.,
                Point::default(),
                EyeLayoutInput {
                    scale: value,
                    ..view()
                }
            )
            .is_err()
        );
        assert!(
            g.layout(
                0.,
                Point::default(),
                EyeLayoutInput {
                    zoom: value,
                    ..view()
                }
            )
            .is_err()
        );
    }
    for value in [-1., 1., f64::INFINITY, f64::NAN] {
        assert!(
            g.layout(
                0.,
                Point::default(),
                EyeLayoutInput {
                    death_progress: value,
                    ..view()
                }
            )
            .is_err()
        );
    }
    assert!(g.layout(f64::NAN, Point::default(), view()).is_err());
    assert!(
        g.layout(
            0.,
            Point {
                x: f64::INFINITY,
                y: 0.
            },
            view()
        )
        .is_err()
    );
    assert!(
        g.layout(
            0.,
            Point::default(),
            EyeLayoutInput {
                viewport_half: Point { x: -1., y: 0. },
                ..view()
            }
        )
        .is_err()
    );
    assert!(
        g.layout(
            0.,
            Point::default(),
            EyeLayoutInput {
                corrected_head: Point { x: f64::NAN, y: 0. },
                ..view()
            }
        )
        .is_err()
    );
    assert!(
        g.layout(
            0.,
            Point::default(),
            EyeLayoutInput {
                camera: Point { x: 0., y: f64::NAN },
                ..view()
            }
        )
        .is_err()
    );
    assert!(
        g.layout(
            0.,
            Point::default(),
            EyeLayoutInput {
                scale: f64::MAX,
                ..view()
            }
        )
        .is_err()
    );
    assert!(
        g.layout(
            0.,
            Point::default(),
            EyeLayoutInput {
                zoom: f64::MAX,
                ..view()
            }
        )
        .is_err()
    );
    assert!(g.layout(0., Point { x: f64::MAX, y: 0. }, view()).is_err());
    let before = g;
    assert!(g.layout(f64::NAN, Point::default(), view()).is_err());
    assert_eq!(g, before);
}
