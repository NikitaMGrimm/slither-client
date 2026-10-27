//! Original synthetic antenna tests; native trig is not a browser bit oracle.
use slither_client::{presentation::*, state::Point};

fn geometry(nodes: usize, rotate_bulb: bool) -> OrdinaryAntennaGeometry {
    OrdinaryAntennaGeometry {
        nodes,
        outer_color: 0x123456,
        inner_color: 0xaabbcc,
        inner_opacity: 0.375,
        repeated_inner_strokes: true,
        rotate_bulb,
        bulb: AntennaBulbGeometry {
            offset_x: -7.25,
            offset_y: -13.5,
            width: 27.,
            height: 31.,
            scale: 0.7,
            opacity: 0.625,
        },
    }
}
fn input() -> AntennaDrawInput {
    let view = BodyPaintView {
        camera: Point {
            x: 97.125,
            y: 101.75,
        },
        zoom: 0.75,
        half_width: 320.,
        half_height: 180.,
    };
    AntennaDrawInput {
        raw_heading: 0.375,
        corrected_head: Point {
            x: 101.23456789,
            y: 105.98765432,
        },
        scale: 1.125,
        spawn: 0.6,
        death: 0.25,
        active_curve_count: 12,
        whole_snake_visible: true,
        view,
        bounds: Some(AntennaCullBounds::from_view(view).unwrap()),
    }
}
fn state(nodes: usize, rotate: bool) -> AntennaState {
    AntennaState::from_appearance(
        geometry(nodes, rotate),
        Point {
            x: 12.123456789,
            y: 21.987654321,
        },
    )
    .unwrap()
}
fn step(state: &AntennaState, input: AntennaDrawInput) -> (AntennaState, PreparedAntenna) {
    let request = state.prepare_draw(input).unwrap();
    let tape: Vec<_> = (0..request.random_pair_count())
        .map(|i| [0.1 + i as f64 * 0.03, 0.8 - i as f64 * 0.02])
        .collect();
    request.finish(&tape).unwrap()
}

#[test]
fn constructor_copies_six_active_channels_without_randomness() {
    for n in [8, 9, 11] {
        let s = state(n, false).snapshot();
        assert_eq!(s.x, vec![12.123456789_f64 as f32; n]);
        assert_eq!(s.y, vec![21.987654321_f64 as f32; n]);
        for channel in [
            &s.velocity_x,
            &s.velocity_y,
            &s.acceleration_x,
            &s.acceleration_y,
        ] {
            assert_eq!(channel.len(), n);
            assert!(channel.iter().all(|v| v.to_bits() == 0));
        }
        assert!(!s.shown);
        assert_eq!(s.bulb_rotation.to_bits(), 0);
    }
}

#[test]
fn metadata_validation_and_signed_zero_coherence() {
    let a = geometry(8, false);
    let mut b = a;
    for n in [0, 7, 10, 12, usize::MAX] {
        b.nodes = n;
        assert!(b.validate().is_err());
    }
    b = a;
    b.outer_color = 0x1000000;
    assert!(b.validate().is_err());
    b = a;
    b.bulb.scale = 0.;
    assert!(b.validate().is_err());
    b = a;
    b.bulb.width = f64::INFINITY;
    assert!(b.validate().is_err());
    b = a;
    b.inner_opacity = f64::NAN;
    assert!(b.validate().is_err());
    b = a;
    b.bulb.offset_x = 0.;
    let mut c = b;
    c.bulb.offset_x = -0.;
    assert!(b.validate().is_ok());
    assert!(c.validate().is_ok());
    assert!(!b.same_bits(&c));
    assert!(b.same_bits(&b));
    assert!(AntennaState::from_appearance(a, Point { x: f64::MAX, y: 0. }).is_err());
}

#[test]
fn gate_reports_exact_pair_count_and_rejects_extra_tape() {
    for n in [8, 9, 11] {
        assert_eq!(
            state(n, false)
                .prepare_draw(input())
                .unwrap()
                .random_pair_count(),
            n - 1
        );
    }
    for count in [0, 1] {
        let mut i = input();
        i.active_curve_count = count;
        let s = state(8, false);
        let request = s.prepare_draw(i).unwrap();
        assert_eq!(request.random_pair_count(), 0);
        assert!(request.clone().finish(&[[0.5, 0.5]]).is_err());
        let (next, plan) = request.finish(&[]).unwrap();
        assert!(!next.snapshot().shown);
        assert!(plan.bulb.is_none());
        assert!(plan.strokes.is_empty());
        assert_eq!(
            plan.barrier_effect,
            AntennaBarrierEffect::Rejected {
                cursor: Point {
                    x: i.raw_heading.cos(),
                    y: i.raw_heading.sin()
                }
            }
        );
    }
}

#[test]
fn rejected_gate_clears_only_latch_and_whole_cull_preserves_everything() {
    let (s, _) = step(&state(9, true), input());
    let before = s.snapshot();
    assert!(before.shown);
    let mut i = input();
    i.whole_snake_visible = false;
    let (hidden, plan) = step(&s, i);
    assert_eq!(hidden, s);
    assert_eq!(plan.barrier_effect, AntennaBarrierEffect::Disabled);
    i.whole_snake_visible = true;
    i.bounds = None;
    let (rejected, _) = step(&s, i);
    let mut expected = before;
    expected.shown = false;
    assert_eq!(rejected.snapshot(), expected);
}

#[test]
fn retained_bounds_gate_is_inclusive_and_uses_unrounded_root() {
    let s = state(8, false);
    let mut i = input();
    let root = Point {
        x: i.corrected_head.x - i.raw_heading.cos() * 8. * i.scale,
        y: i.corrected_head.y - i.raw_heading.sin() * 8. * i.scale,
    };
    i.bounds = Some(AntennaCullBounds {
        min_x: root.x,
        max_x: root.x,
        min_y: root.y,
        max_y: root.y,
    });
    assert_eq!(s.prepare_draw(i).unwrap().random_pair_count(), 7);
    i.bounds.as_mut().unwrap().min_x = root.x + 1e-10;
    i.bounds.as_mut().unwrap().max_x = root.x + 1.;
    assert_eq!(s.prepare_draw(i).unwrap().random_pair_count(), 0);
    let b = AntennaCullBounds::from_view(i.view).unwrap();
    assert_eq!(
        b.min_x,
        i.view.camera.x - (i.view.half_width / i.view.zoom + 210.)
    );
    assert_eq!(
        b.max_y,
        i.view.camera.y + (i.view.half_height / i.view.zoom + 210.)
    );
}

#[test]
fn zero_alpha_draws_keep_solver_paths_strokes_and_bulb() {
    let mut i = input();
    i.spawn = 0.;
    let (s, p) = step(&state(11, true), i);
    assert!(s.snapshot().shown);
    assert_eq!(p.strokes.len(), 4);
    assert!(p.strokes.iter().all(|s| s.alpha == 0.));
    assert_eq!(p.bulb.unwrap().alpha, 0.);
    assert!(!p.inner_path.is_empty());
    assert!(!p.outer_path.is_empty());
    assert!(s.snapshot().velocity_x[1..].iter().any(|v| *v != 0.));
}

#[test]
fn both_bulb_modes_preserve_separate_transforms_and_arithmetic() {
    for rotate in [false, true] {
        let i = input();
        let (s, p) = step(&state(9, rotate), i);
        let snapshot = s.snapshot();
        let b = geometry(9, rotate).bulb;
        let bulb = p.bulb.unwrap();
        let m = i.scale * i.view.zoom;
        assert_eq!(bulb.center, Point { x: 320., y: 180. });
        assert_eq!(bulb.destination.width, b.width * b.scale * m);
        assert_eq!(bulb.destination.height, b.height * b.scale * m);
        let mut a = i.spawn * (1. - i.death);
        a *= a;
        assert_eq!(bulb.alpha, a * b.opacity);
        if rotate {
            assert_eq!(bulb.translation, p.inner_path[0]);
            assert_eq!(bulb.rotation, Some(snapshot.bulb_rotation));
            assert_eq!(bulb.destination.x, b.offset_x * b.scale * m);
        } else {
            assert_eq!(bulb.translation, Point { x: 0., y: 0. });
            assert_eq!(bulb.rotation, None);
            assert_eq!(
                bulb.destination.x,
                (f64::from(snapshot.x[8]) - i.view.camera.x + b.offset_x * b.scale * i.scale)
                    * i.view.zoom
            );
        }
        assert_eq!(
            p.barrier_effect,
            AntennaBarrierEffect::Eligible {
                cursor: *p.inner_path.last().unwrap(),
                scoped_alpha: bulb.alpha
            }
        );
        assert_eq!(
            p.strokes.iter().map(|s| s.width).collect::<Vec<_>>(),
            vec![5. * m, 4. * m, 3. * m, 2. * m]
        );
    }
}

#[test]
fn tiny_zoom_keeps_single_vertex_paths_and_zero_length_barrier_cursor() {
    let mut i = input();
    i.view.zoom = 1e-6;
    let (_, p) = step(&state(8, false), i);
    assert_eq!(p.outer_path.len(), 1);
    assert_eq!(p.inner_path.len(), 1);
    assert!(
        matches!(p.barrier_effect,AntennaBarrierEffect::Eligible{cursor,..} if cursor==p.inner_path[0])
    );
}

#[test]
fn invalid_or_late_overflow_discards_request_without_mutating_original() {
    let original = state(9, true);
    let before = original.clone();
    for pair in [
        [f64::NAN, 0.5],
        [-0.1, 0.5],
        [0.5, 1.],
        [0.5, f64::INFINITY],
    ] {
        let mut tape = vec![[0.5, 0.5]; 8];
        tape[7] = pair;
        assert!(
            original
                .prepare_draw(input())
                .unwrap()
                .finish(&tape)
                .is_err()
        );
        assert_eq!(original, before);
    }
    let mut i = input();
    i.view.zoom = f64::MAX;
    assert!(
        original
            .prepare_draw(i)
            .unwrap()
            .finish(&[[0.5, 0.5]; 8])
            .is_err()
    );
    assert_eq!(original, before);
    i = input();
    i.scale = 0.;
    assert!(original.prepare_draw(i).is_err());
    i = input();
    i.bounds.as_mut().unwrap().max_x = f64::NAN;
    assert!(original.prepare_draw(i).is_err());
}

#[test]
fn rounded_lut_endpoint_returns_arithmetic_error_without_mutating_state() {
    let original =
        AntennaState::from_appearance(geometry(8, false), Point { x: 0., y: 0. }).unwrap();
    let before = original.snapshot();
    let heading = 5. * std::f64::consts::PI / 4.;
    let scale = 1.5;
    let mut draw = input();
    draw.raw_heading = heading;
    draw.corrected_head = Point {
        x: heading.cos() * 8. * scale,
        y: heading.sin() * 8. * scale,
    };
    draw.scale = scale;
    draw.spawn = 1.;
    draw.death = 0.;
    draw.active_curve_count = 2;
    let mut pairs = [[0.5, 0.5]; 7];
    pairs[0] = [0.6213202476501467; 2];
    assert!(matches!(
        original.prepare_draw(draw).unwrap().finish(&pairs),
        Err(AntennaError::Arithmetic)
    ));
    assert_eq!(original.snapshot(), before);
}

#[test]
fn repeated_draws_advance_and_snapshot_mutation_has_no_effect() {
    let s = state(8, false);
    let (first, _) = step(&s, input());
    let (second, _) = step(&first, input());
    assert_ne!(first.snapshot().x, second.snapshot().x);
    let mut diagnostic = second.snapshot();
    diagnostic.x.fill(0.);
    diagnostic.shown = false;
    assert_ne!(second.snapshot(), diagnostic);
    assert!(!s.snapshot().shown);
}
