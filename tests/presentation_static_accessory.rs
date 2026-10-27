//! Authored synthetic numeric witnesses; native trig only, no external inputs.

use slither_client::{
    presentation::{EyeLayoutInput, StaticHeadAccessoryGeometry},
    state::Point,
};

fn geometry() -> StaticHeadAccessoryGeometry {
    StaticHeadAccessoryGeometry {
        forward: 5.,
        image_scale: 0.25,
        pivot_x: 3.,
        pivot_y: 7.,
    }
}

fn view() -> EyeLayoutInput {
    EyeLayoutInput {
        corrected_head: Point { x: 100., y: 200. },
        camera: Point { x: 90., y: 180. },
        viewport_half: Point { x: 400., y: 300. },
        scale: 2.,
        zoom: 0.5,
        death_progress: 0.5,
    }
}

fn bits(a: f64, b: f64) {
    assert_eq!(a.to_bits(), b.to_bits(), "{a:?} != {b:?}");
}

#[test]
fn rational_w01_cached_extent_w06_and_squared_alpha_w07() {
    let actual = geometry()
        .layout(0., Point { x: 20., y: 12. }, 0.25, view())
        .unwrap();
    for (actual, expected) in [
        actual.translation.x,
        actual.translation.y,
        actual.rotation,
        actual.destination.x,
        actual.destination.y,
        actual.destination.width,
        actual.destination.height,
        actual.alpha,
    ]
    .into_iter()
    .zip([410., 310., 0., -0.75, -1.75, 5., 3., 0.015625])
    {
        bits(actual, expected);
    }
    let full = geometry()
        .layout(0., Point { x: 40., y: 30. }, 0., view())
        .unwrap();
    bits(full.destination.width, 10.);
    bits(full.destination.height, 7.5);
    bits(full.alpha, 0.);
    let alive = geometry()
        .layout(
            0.,
            Point { x: 20., y: 12. },
            1.,
            EyeLayoutInput {
                death_progress: 0.,
                ..view()
            },
        )
        .unwrap();
    bits(alive.alpha, 1.);
}

#[test]
fn metadata_coherence_and_signed_zero_w03() {
    let g = geometry();
    assert!(g.same_bits(&g));
    for index in 0..4 {
        let mut changed = g;
        match index {
            0 => changed.forward = 6.,
            1 => changed.image_scale = 0.5,
            2 => changed.pivot_x = 4.,
            _ => changed.pivot_y = 8.,
        }
        assert!(!g.same_bits(&changed));
    }
    for field in 0..3 {
        let mut positive = g;
        let mut negative = g;
        match field {
            0 => {
                positive.forward = 0.;
                negative.forward = -0.;
            }
            1 => {
                positive.pivot_x = 0.;
                negative.pivot_x = -0.;
            }
            _ => {
                positive.pivot_y = 0.;
                negative.pivot_y = -0.;
            }
        }
        positive.validate().unwrap();
        negative.validate().unwrap();
        assert!(!positive.same_bits(&negative));
    }
    let a = StaticHeadAccessoryGeometry {
        pivot_x: 0.,
        pivot_y: -0.,
        ..g
    }
    .layout(-0., Point { x: 1., y: 1. }, 1., view())
    .unwrap();
    bits(a.destination.x, -0.);
    bits(a.destination.y, 0.);
    bits(a.rotation, -0.);
}

#[test]
fn cancellation_w04_and_oblique_native_heading() {
    // At 2^53 the next positive representable number is two units away.
    // Adding one first rounds back to 2^53; subtracting the camera first gives one.
    let v = EyeLayoutInput {
        corrected_head: Point {
            x: 9_007_199_254_740_992.,
            y: 0.,
        },
        camera: Point {
            x: 9_007_199_254_740_992.,
            y: 0.,
        },
        viewport_half: Point { x: 0., y: 0. },
        scale: 1.,
        zoom: 1.,
        death_progress: 0.,
    };
    let g = StaticHeadAccessoryGeometry {
        forward: 1.,
        ..geometry()
    };
    let a = g.layout(0., Point { x: 20., y: 12. }, 1., v).unwrap();
    bits(a.translation.x, 0.);
    assert_ne!(a.translation.x, 1. + (v.corrected_head.x - v.camera.x));
    let heading: f64 = 0.73;
    let a = geometry()
        .layout(heading, Point { x: 20., y: 12. }, 0.25, view())
        .unwrap();
    bits(
        a.translation.x,
        400. + ((heading.cos() * 10. + 100.) - 90.) * 0.5,
    );
    bits(
        a.translation.y,
        300. + ((heading.sin() * 10. + 200.) - 180.) * 0.5,
    );
    bits(a.rotation, heading);
}

#[test]
fn finite_underflow_w05_remains_a_layout() {
    let v = EyeLayoutInput {
        scale: f64::MIN_POSITIVE,
        zoom: 2_f64.powi(-54),
        ..view()
    };
    let a = StaticHeadAccessoryGeometry {
        image_scale: 0.5,
        ..geometry()
    }
    .layout(0., Point { x: 20., y: 12. }, f64::from_bits(1), v)
    .unwrap();
    bits(a.destination.x, -0.);
    bits(a.destination.width, 0.);
    bits(a.alpha, 0.);
}

#[test]
fn bounded_metadata_and_all_invalid_input_channels() {
    StaticHeadAccessoryGeometry {
        forward: 4096.,
        image_scale: 256.,
        pivot_x: -65535.,
        pivot_y: 65535.,
    }
    .validate()
    .unwrap();
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        for field in 0..4 {
            let mut g = geometry();
            match field {
                0 => g.forward = invalid,
                1 => g.image_scale = invalid,
                2 => g.pivot_x = invalid,
                _ => g.pivot_y = invalid,
            }
            assert!(g.validate().is_err());
        }
        for field in 0..13 {
            let mut v = view();
            let mut extent = Point { x: 20., y: 12. };
            let mut heading = 0.;
            let mut spawn = 0.25;
            match field {
                0 => v.corrected_head.x = invalid,
                1 => v.corrected_head.y = invalid,
                2 => v.camera.x = invalid,
                3 => v.camera.y = invalid,
                4 => v.viewport_half.x = invalid,
                5 => v.viewport_half.y = invalid,
                6 => v.scale = invalid,
                7 => v.zoom = invalid,
                8 => v.death_progress = invalid,
                9 => extent.x = invalid,
                10 => extent.y = invalid,
                11 => heading = invalid,
                _ => spawn = invalid,
            }
            assert!(geometry().layout(heading, extent, spawn, v).is_err());
        }
    }
    for g in [
        StaticHeadAccessoryGeometry {
            forward: -1.,
            ..geometry()
        },
        StaticHeadAccessoryGeometry {
            forward: 4097.,
            ..geometry()
        },
        StaticHeadAccessoryGeometry {
            image_scale: 0.,
            ..geometry()
        },
        StaticHeadAccessoryGeometry {
            image_scale: 257.,
            ..geometry()
        },
        StaticHeadAccessoryGeometry {
            pivot_x: -65536.,
            ..geometry()
        },
        StaticHeadAccessoryGeometry {
            pivot_y: 65536.,
            ..geometry()
        },
    ] {
        assert!(g.validate().is_err());
    }
    for extent in [
        Point { x: 0., y: 1. },
        Point { x: 1., y: -1. },
        Point { x: 65536., y: 1. },
    ] {
        assert!(geometry().layout(0., extent, 0.25, view()).is_err());
    }
    for spawn in [-0.1, 1.1] {
        assert!(
            geometry()
                .layout(0., Point { x: 1., y: 1. }, spawn, view())
                .is_err()
        );
    }
    for v in [
        EyeLayoutInput {
            death_progress: 1.,
            ..view()
        },
        EyeLayoutInput {
            death_progress: -0.1,
            ..view()
        },
        EyeLayoutInput {
            scale: 0.,
            ..view()
        },
        EyeLayoutInput {
            zoom: -1.,
            ..view()
        },
        EyeLayoutInput {
            viewport_half: Point { x: -1., y: 0. },
            ..view()
        },
    ] {
        assert!(
            geometry()
                .layout(0., Point { x: 1., y: 1. }, 0.25, v)
                .is_err()
        );
    }
}

#[test]
fn nonfinite_intermediates_reject_even_when_final_cancellation_could_hide_them() {
    let extent = Point { x: 1., y: 1. };
    for v in [
        EyeLayoutInput {
            scale: f64::MAX,
            zoom: f64::MIN_POSITIVE,
            ..view()
        },
        EyeLayoutInput {
            scale: f64::MAX / 8.,
            zoom: 32.,
            ..view()
        },
        EyeLayoutInput {
            corrected_head: Point { x: f64::MAX, y: 0. },
            camera: Point { x: f64::MAX, y: 0. },
            scale: f64::MAX / 8.,
            zoom: f64::MIN_POSITIVE,
            ..view()
        },
        EyeLayoutInput {
            camera: Point {
                x: -f64::MAX,
                y: 0.,
            },
            corrected_head: Point { x: f64::MAX, y: 0. },
            ..view()
        },
        EyeLayoutInput {
            viewport_half: Point { x: f64::MAX, y: 0. },
            corrected_head: Point { x: f64::MAX, y: 0. },
            scale: 1.,
            zoom: 1.,
            ..view()
        },
    ] {
        assert!(geometry().layout(0., extent, 0.25, v).is_err());
    }
    let v = EyeLayoutInput {
        scale: 1.,
        zoom: f64::MAX / 2.,
        corrected_head: Point { x: 0., y: 0. },
        camera: Point { x: 0., y: 0. },
        ..view()
    };
    assert!(
        StaticHeadAccessoryGeometry {
            forward: 0.,
            image_scale: 1.,
            pivot_x: 3.,
            ..geometry()
        }
        .layout(0., extent, 1., v)
        .is_err()
    );
}
