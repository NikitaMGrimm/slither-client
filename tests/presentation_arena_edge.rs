//! Original synthetic geometry fixtures; native trig is not a browser bit oracle.

use std::f64::consts::PI;

use slither_client::{
    presentation::{ArenaEdgeInput, ArenaEdgeView, BoundaryRadius, plan_arena_edge},
    state::Point,
};

fn input(radius: f64, distance: f64) -> ArenaEdgeInput {
    ArenaEdgeInput {
        view: ArenaEdgeView::new(16384., 0., distance).unwrap(),
        camera: Point {
            x: 17384.,
            y: 16384.,
        },
        zoom: 1.,
        width: 801,
        height: 603,
        radius,
    }
}

fn assert_point(actual: Point, expected: Point) {
    assert_eq!(actual.x.to_bits(), expected.x.to_bits());
    assert_eq!(actual.y.to_bits(), expected.y.to_bits());
}

#[test]
fn strict_distance_gate_includes_neither_threshold_and_uses_retained_distance() {
    for (radius, distance, visible) in [
        (1000., 5000., false),
        (1000., 5000_f64.next_down(), true),
        (1000., 5000_f64.next_up(), false),
        (5000., 1000., false),
        (5000_f64.next_down(), 1000., true),
        (5000_f64.next_up(), 1000., false),
        (3999., 0., true),
        (4000., 0., false),
    ] {
        let frozen = input(radius, distance);
        assert_eq!(plan_arena_edge(frozen).unwrap().is_some(), visible);
    }
    // Geometry may be wholly offscreen: neither viewport nor current camera selects the arc.
    let mut frozen = input(1000., 1000.);
    frozen.camera = Point { x: 1e9, y: -1e9 };
    let plan = plan_arena_edge(frozen).unwrap().unwrap();
    assert!(plan.fill.iter().all(|p| p.x < 0. && p.y > 603.));
}

#[test]
fn fixed_paths_keep_duplicate_start_inner_order_and_outer_return() {
    let frozen = input(1000., 1000.);
    let plan = plan_arena_edge(frozen).unwrap().unwrap();
    assert_eq!((plan.fill.len(), plan.stroke.len()), (83, 42));
    assert_eq!(plan.line_width, 23.);
    assert_eq!(&plan.fill[..42], &plan.stroke);
    assert_point(plan.stroke[0], plan.stroke[1]);
    assert_point(plan.stroke[21], Point { x: 400.5, y: 301.5 });
    assert_point(
        plan.fill[62],
        Point {
            x: 4400.5,
            y: 301.5,
        },
    );
    for index in 0..=40 {
        let theta = (-2000. + index as f64 * 100.) / 1000.;
        assert_point(
            plan.stroke[index + 1],
            Point {
                x: 400.5 + ((16384. + theta.cos() * 1000.) - 17384.),
                y: 301.5 + ((16384. + theta.sin() * 1000.) - 16384.),
            },
        );
        // The outer return pairs with the reverse inner order, using the same k.
        assert_point(
            plan.fill[82 - index],
            Point {
                x: 400.5 + ((16384. + theta.cos() * 5000.) - 17384.),
                y: 301.5 + ((16384. + theta.sin() * 5000.) - 16384.),
            },
        );
    }
    assert!(plan.stroke[1].y < plan.stroke[21].y);
    assert!(plan.stroke[41].y > plan.stroke[21].y);
    assert_ne!(plan.stroke[0], plan.stroke[41]);
}

#[test]
fn small_radius_fallback_has_exact_full_turn_sampling_at_both_radii() {
    for radius in [0.001, 4000. / (2. * PI), (4000. / (2. * PI)).next_up()] {
        let frozen = input(radius, 0.);
        let plan = plan_arena_edge(frozen).unwrap().unwrap();
        let k = if 4000. / radius > 2. * PI {
            4000. / (2. * PI)
        } else {
            radius
        };
        for (slot, j, r) in [
            (0, -2000., radius),
            (41, 2000., radius),
            (42, 2000., radius + 4000.),
            (82, -2000., radius + 4000.),
        ] {
            let theta = j / k;
            assert_point(
                plan.fill[slot],
                Point {
                    x: 400.5 + ((16384. + theta.cos() * r) - 17384.),
                    y: 301.5 + ((16384. + theta.sin() * r) - 16384.),
                },
            );
        }
    }
}

#[test]
fn computed_zero_radius_remains_a_valid_degenerate_inner_path() {
    let mut boundary = BoundaryRadius::new(1000.).unwrap();
    boundary.set_target(1e-14).unwrap();
    boundary.advance(56, true);
    assert_eq!(boundary.displayed().to_bits(), 0_f64.to_bits());
    let plan = plan_arena_edge(input(boundary.displayed(), 0.))
        .unwrap()
        .unwrap();
    assert_eq!(
        plan.stroke,
        [Point {
            x: -599.5,
            y: 301.5
        }; 42]
    );
    assert!(
        plan.fill[42..]
            .iter()
            .all(|p| p.x.is_finite() && p.y.is_finite())
    );
    assert_ne!(plan.fill[42], plan.fill[62]);
    assert!(plan_arena_edge(input(0., 4000.)).unwrap().is_none());
}

#[test]
fn oblique_projection_keeps_f64_absolute_arithmetic_and_odd_backing_halves() {
    let frozen = ArenaEdgeInput {
        view: ArenaEdgeView::new(16777215., 0.731234567890123, 8901.).unwrap(),
        camera: Point {
            x: 16781234.12345679,
            y: 16771001.98765432,
        },
        zoom: 0.731234567890123,
        radius: 9000.123456789,
        width: 1001,
        height: 701,
    };
    let plan = plan_arena_edge(frozen).unwrap().unwrap();
    let theta = frozen.view.angle() + 700. / frozen.radius;
    let ax = frozen.view.center() + theta.cos() * frozen.radius;
    let ay = frozen.view.center() + theta.sin() * frozen.radius;
    let expected = Point {
        x: 500.5 + (ax - frozen.camera.x) * frozen.zoom,
        y: 350.5 + (ay - frozen.camera.y) * frozen.zoom,
    };
    assert_point(plan.stroke[28], expected);
    assert_ne!(expected.x, f64::from(expected.x as f32));
    assert_ne!(expected.y, f64::from(expected.y as f32));
    let reassociated = 500.5
        + ((frozen.view.center() - frozen.camera.x) + theta.cos() * frozen.radius) * frozen.zoom;
    assert_ne!(expected.x.to_bits(), reassociated.to_bits());
    assert_eq!(plan.line_width.to_bits(), (23. * frozen.zoom).to_bits());
    assert_eq!(plan_arena_edge(frozen).unwrap().unwrap(), plan);
}

#[test]
fn view_construction_and_planning_reject_invalid_or_overflowing_values() {
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(ArenaEdgeView::new(value, 0., 0.).is_err());
        assert!(ArenaEdgeView::new(1., value, 0.).is_err());
        assert!(ArenaEdgeView::new(1., 0., value).is_err());
        for field in 0..4 {
            let mut frozen = input(1000., 1000.);
            match field {
                0 => frozen.radius = value,
                1 => frozen.zoom = value,
                2 => frozen.camera.x = value,
                _ => frozen.camera.y = value,
            }
            assert!(plan_arena_edge(frozen).is_err());
        }
    }
    assert!(ArenaEdgeView::new(0., 0., 0.).is_err());
    assert!(ArenaEdgeView::new(1., 0., -1.).is_err());
    let base = input(1000., 1000.);
    for frozen in [
        ArenaEdgeInput {
            radius: -1.,
            ..base
        },
        ArenaEdgeInput { zoom: 0., ..base },
        ArenaEdgeInput { width: 0, ..base },
        ArenaEdgeInput { height: 0, ..base },
        ArenaEdgeInput {
            zoom: f64::MAX,
            ..base
        },
        ArenaEdgeInput {
            camera: Point { x: f64::MAX, y: 0. },
            zoom: 2.,
            ..base
        },
        ArenaEdgeInput {
            view: ArenaEdgeView::new(f64::MAX, 0., f64::MAX).unwrap(),
            radius: f64::MAX,
            ..base
        },
    ] {
        assert!(plan_arena_edge(frozen).is_err());
    }
}
