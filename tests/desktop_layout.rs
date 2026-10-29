//! Authored synthetic numeric cases; no viewport, browser, server or reference.
use slither_client::desktop_layout::{DesktopBackingSize, desktop_backing_size};

#[test]
fn ceiled_fractional_tiny_and_extreme_aspect_dimensions_keep_exact_results() {
    for (width, height, expected_width, expected_height) in [
        (800., 600., 1440, 1080),
        (799.25, 599.5, 1440, 1080),
        (1920., 1080., 1500, 845),
        (1080., 1920., 845, 1500),
        (1., 1., 1273, 1273),
        (0.01, 0.01, 1273, 1273),
        (f64::from_bits(1), f64::from_bits(1), 1273, 1273),
        (1e154, 1., 1500, 1),
        (1., 1e154, 1, 1500),
    ] {
        assert_eq!(
            desktop_backing_size(width, height).unwrap(),
            DesktopBackingSize {
                width: expected_width,
                height: expected_height
            }
        );
    }
}

#[test]
fn nonpositive_nonfinite_and_squared_sum_overflow_reject() {
    for value in [
        0.,
        -0.,
        -1.,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        1e200,
        f64::MAX,
    ] {
        assert!(desktop_backing_size(value, 600.).is_err());
        assert!(desktop_backing_size(800., value).is_err());
    }
    assert!(
        desktop_backing_size(1e154, 1e154).is_err(),
        "a finite hypot must not rescue an overflowing squared sum"
    );
    assert_eq!(desktop_backing_size(1e154, 1.).unwrap().height, 1);
}

#[test]
fn ordered_ceiling_and_caps_keep_every_output_inside_the_existing_canvas_bounds() {
    for width in [
        1., 1.01, 994., 995., 1000., 1273., 1499.99, 1500., 1500.01, 1800., 4096., 1e100,
    ] {
        for height in [
            1., 1.01, 994., 995., 1000., 1273., 1499.99, 1500., 1500.01, 1800., 4096., 1e100,
        ] {
            let size = desktop_backing_size(width, height).unwrap();
            assert!((1..=1500).contains(&size.width));
            assert!((1..=1500).contains(&size.height));
            assert_eq!(
                size,
                desktop_backing_size(width.ceil(), height.ceil()).unwrap()
            );
        }
    }
}
