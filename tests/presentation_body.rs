//! Original synthetic body fixtures; no reference data or network access.

use slither_client::{
    presentation::{BODY_SAMPLES, BodyGeometry, MAX_RETAINED_BODY_POINTS},
    state::{Appearance, Direction, MAX_BODY_POINTS, Point, Setup},
};

fn setup() -> Setup {
    Setup {
        protocol: 19,
        grid_center: 1000.,
        radius: 900.,
        sector_size: 100,
        sector_count: 20,
        max_segments: 200,
        body_spacing: 10.,
        body_contraction: 0.5,
        spangdv: 4.,
        nsp1: 4.,
        nsp2: 0.5,
        nsp3: 12.,
        mamu: 0.03,
        mamu2: 0.02,
        server_number: None,
        game_mode: None,
        team: None,
    }
}

fn appearance(count: usize) -> Appearance {
    Appearance {
        id: 3,
        skin: 0,
        name: String::new(),
        custom_skin: Vec::new(),
        cosmetic: 255,
        absolute_head: Point {
            x: count as f64 * 10. + 0.25,
            y: 4.,
        },
        absolute_body: (0..count)
            .map(|index| Point {
                x: (count - index - 1) as f64 * 10. + 0.25,
                y: 4.,
            })
            .collect(),
        anchor_direction: Some(0),
        heading: 0.,
        wanted_heading: 0.,
        speed_per_32ms: 4.,
        fam: 0.,
        wire_direction: Direction::None,
    }
}

fn body(count: usize) -> BodyGeometry {
    BodyGeometry::from_appearance(&appearance(count), &setup()).unwrap()
}

fn append(body: &mut BodyGeometry, grew: bool, visible: bool) {
    let front = body.points()[0].position();
    body.apply_anchor(
        Some(Point {
            x: front.x + 10.,
            y: front.y + 2.,
        }),
        None,
        grew,
        Point {
            x: front.x + 3.,
            y: front.y,
        },
        visible,
    )
    .unwrap();
}

#[test]
fn appearance_keeps_absolute_order_initial_edges_and_tail_delta() {
    let a = appearance(12);
    let b = BodyGeometry::from_appearance(&a, &setup()).unwrap();
    assert_eq!(b.logical_segments(), 12);
    assert_eq!(b.anchor_direction(), Some(0));
    for (index, point) in b.points().iter().enumerate() {
        assert_eq!(point.position(), a.absolute_body[index]);
        assert_eq!(point.edge_length(), 1.);
        assert_eq!(
            point.previous_delta(),
            Point {
                x: if index == 11 { 0. } else { 10. },
                y: 0.
            }
        );
        assert_eq!(
            point.spacing_multiplier(),
            f64::from(b.spacing_multipliers()[index])
        );
        assert_eq!(point.offset(), [0.; 4]);
        assert_eq!((point.index(), point.pending()), (0, 0));
    }
    assert_eq!(
        &b.spacing_multipliers()[..9],
        &[1., 1., 1., 1., 0.875, 0.75, 0.625, 0.5, 0.5]
    );
    assert_eq!(b.weights()[0], 1.);
    assert_eq!(b.weights()[BODY_SAMPLES - 1], 0.);
}

#[test]
fn anchor_contraction_is_sequential_and_includes_dying_tail() {
    let mut b = body(12);
    let before = b.clone();
    append(&mut b, false, true);
    assert_eq!(b.logical_segments(), 12);
    assert_eq!(b.points().len(), 13);
    assert!(b.points().last().unwrap().dying());
    assert_eq!(b.points().iter().filter(|point| !point.dying()).count(), 12);
    assert_eq!(b.points()[1].position(), before.points()[0].position());
    assert_eq!(b.points()[2].position(), before.points()[1].position());
    let mut neighbor = before.points()[1].position();
    for index in 3..b.points().len() {
        let previous = before.points()[index - 1].position();
        let weight = 0.5 * (index - 2).min(4) as f64 / 4.;
        let expected = Point {
            x: previous.x + (neighbor.x - previous.x) * weight,
            y: previous.y + (neighbor.y - previous.y) * weight,
        };
        let point = &b.points()[index];
        assert_eq!(point.position(), expected);
        assert_eq!(
            point.offset()[0],
            f64::from((-(expected.x - previous.x)) as f32)
        );
        assert_eq!(point.pending(), BODY_SAMPLES as i32);
        neighbor = expected;
    }
    assert_ne!(
        b.points().last().unwrap().position(),
        before.points().last().unwrap().position()
    );
}

#[test]
fn invisible_anchors_contract_without_scheduling_body_corrections() {
    let mut b = body(8);
    let before = b.clone();
    append(&mut b, true, false);
    assert_eq!(b.logical_segments(), 9);
    assert_ne!(
        b.points().last().unwrap().position(),
        before.points().last().unwrap().position()
    );
    for point in b.points() {
        assert_eq!(point.offset(), [0.; 4]);
        assert_eq!(point.pending(), 0);
        assert!(point.samples().iter().flatten().all(|sample| *sample == 0.));
    }
    append(&mut b, false, true);
    assert!(
        b.points()
            .iter()
            .any(|point| point.pending() == BODY_SAMPLES as i32)
    );
}

#[test]
fn body_ring_overlap_wrap_and_positive_step_cleanup() {
    let mut b = body(8);
    append(&mut b, false, true);
    b.advance(7);
    let before = b.clone();
    b.advance(0);
    assert_eq!(b, before);
    append(&mut b, false, true);
    let prior = &before.points()[3];
    let point = &b.points()[4];
    let delta = point.position().x - prior.position().x;
    assert_eq!((point.index(), point.pending()), (7, BODY_SAMPLES as i32));
    for i in 0..BODY_SAMPLES {
        let slot = (7 + i) % BODY_SAMPLES;
        assert_eq!(
            point.samples()[0][slot],
            (f64::from(prior.samples()[0][slot]) - delta * f64::from(b.weights()[i])) as f32
        );
    }
    b.advance(BODY_SAMPLES as u32);
    let drained = b.clone();
    assert_eq!(b.points()[4].pending(), 0);
    assert_eq!(b.points()[4].index(), 7);
    assert!(
        b.points()[4]
            .samples()
            .iter()
            .flatten()
            .all(|value| *value == 0.)
    );
    b.advance(0);
    assert_eq!(b, drained);
    b.advance(1);
    for point in b.points() {
        assert_eq!(point.pending(), -1);
        assert_eq!(point.offset(), [0.; 4]);
    }
}

#[test]
fn contraction_refresh_preserves_displayed_edge_offset_until_advance() {
    let mut b = body(8);
    append(&mut b, true, true);
    b.advance(2);
    let edge = b.points()[0].edge_length_offset();
    let edge_samples = b.points()[0].samples()[2];
    assert_ne!(edge, f64::from(edge_samples[2]));
    for _ in 0..3 {
        append(&mut b, true, true);
    }
    let moved = &b.points()[3];
    assert_eq!(moved.index(), 2);
    assert_eq!(moved.samples()[2], edge_samples);
    assert_eq!(moved.edge_length_offset(), edge);
    for channel in [0, 1, 3] {
        assert_eq!(
            moved.offset()[channel],
            f64::from(moved.samples()[channel][2])
        );
    }
    b.advance(1);
    assert_eq!(
        b.points()[3].edge_length_offset(),
        f64::from(edge_samples[2])
    );
}

#[test]
fn tail_removal_and_fading_keep_three_newest_dying_records() {
    let mut b = body(8);
    for _ in 0..5 {
        assert!(b.remove_tail().unwrap());
    }
    assert_eq!(b.logical_segments(), 3);
    assert_eq!(b.points().len(), 8);
    b.advance(666);
    assert_eq!(b.points().len(), 8);
    assert!(b.points()[3..].iter().all(|point| point.tail_fade() < 1.));
    b.advance(1);
    assert_eq!(b.points().len(), 6);
    assert!(
        b.points()[3..]
            .iter()
            .all(|point| point.tail_fade() == 1. && point.dying())
    );
    b.advance(u32::MAX);
    assert_eq!(b.points().len(), 6);
    for _ in 0..3 {
        assert!(b.remove_tail().unwrap());
    }
    assert!(!b.remove_tail().unwrap());
    assert_eq!(b.logical_segments(), 0);
}

#[test]
fn exhausted_non_growth_preserves_protocol_count_and_negative_removal_is_atomic() {
    for count in [1, 2] {
        for relative in [false, true] {
            let mut b = body(count);
            for _ in 0..count {
                assert!(b.remove_tail().unwrap());
            }
            let exhausted = b.clone();
            assert!(!b.remove_tail().unwrap());
            assert_eq!(b, exhausted);
            let front = b.points()[0].position();
            b.apply_anchor(
                (!relative).then_some(Point {
                    x: front.x + 10.,
                    y: front.y + 2.,
                }),
                None,
                false,
                front,
                false,
            )
            .unwrap();
            assert_eq!(b.logical_segments(), 0);
            assert_eq!(b.points().len(), count + 1);
            assert_eq!(b.points().iter().filter(|p| !p.dying()).count(), 1);
            for _ in 0..2 {
                let before = b.clone();
                assert!(b.remove_tail().is_err());
                assert_eq!(b, before);
            }
        }
    }
}

#[test]
fn exhausted_growth_restores_one_logical_point_for_later_removal() {
    for count in [1, 2] {
        for relative in [false, true] {
            let mut b = body(count);
            for _ in 0..count {
                assert!(b.remove_tail().unwrap());
            }
            let front = b.points()[0].position();
            b.apply_anchor(
                (!relative).then_some(Point {
                    x: front.x + 10.,
                    y: front.y + 2.,
                }),
                None,
                true,
                front,
                false,
            )
            .unwrap();
            assert_eq!(b.logical_segments(), 1);
            assert_eq!(b.points().iter().filter(|p| !p.dying()).count(), 1);
            assert!(b.remove_tail().unwrap());
            assert_eq!(b.logical_segments(), 0);
            assert!(b.points().iter().all(|p| p.dying()));
            assert!(!b.remove_tail().unwrap());
        }
    }
}

#[test]
fn relative_anchors_use_wire_angle_and_preserve_cache_when_omitted() {
    let mut b = body(4);
    let start = b.points()[0].position();
    let angle = f64::from(12345_u16) * (std::f64::consts::TAU / 65536.);
    let expected = Point {
        x: start.x + angle.cos() * 10.,
        y: start.y + angle.sin() * 10.,
    };
    assert_eq!(
        b.apply_anchor(None, Some(12345), false, start, false)
            .unwrap(),
        expected
    );
    assert_eq!(b.anchor_direction(), Some(12345));
    b.apply_anchor(
        Some(Point { x: 500., y: 200. }),
        None,
        false,
        expected,
        false,
    )
    .unwrap();
    assert_eq!(b.anchor_direction(), Some(12345));
    let before = b.clone();
    b.apply_anchor(None, None, false, expected, false).unwrap();
    assert_eq!(
        b.points()[0].position(),
        Point {
            x: 500. + angle.cos() * 10.,
            y: 200. + angle.sin() * 10.
        }
    );
    assert_eq!(b.logical_segments(), before.logical_segments());
}

#[test]
fn invalid_inputs_and_visible_degenerate_edge_are_atomic() {
    let mut b = body(5);
    append(&mut b, false, true);
    for invalid in [
        Point { x: f64::NAN, y: 0. },
        Point { x: f64::MAX, y: 0. },
        Point { x: 1e40, y: 0. },
        b.points()[0].position(),
    ] {
        let before = b.clone();
        assert!(
            b.apply_anchor(Some(invalid), Some(999), true, Point::default(), true)
                .is_err()
        );
        assert_eq!(b, before);
    }
    let before = b.clone();
    assert!(
        b.apply_anchor(
            None,
            None,
            false,
            Point {
                x: f64::INFINITY,
                y: 0.
            },
            false
        )
        .is_err()
    );
    assert_eq!(b, before);
    let same = b.points()[0].position();
    b.apply_anchor(Some(same), None, false, same, false)
        .unwrap();
    assert_eq!(b.points()[0].edge_length(), 0.);
    let mut a = appearance(4);
    a.anchor_direction = None;
    let mut no_direction = BodyGeometry::from_appearance(&a, &setup()).unwrap();
    let before = no_direction.clone();
    assert!(
        no_direction
            .apply_anchor(None, None, false, Point::default(), false)
            .is_err()
    );
    assert_eq!(no_direction, before);
}

#[test]
fn new_edge_projection_preserves_subunit_vector_and_long_head_branches() {
    let mut short = body(4);
    let front = short.points()[0].position();
    let anchor = Point {
        x: front.x + 10.,
        y: front.y,
    };
    short
        .apply_anchor(
            Some(anchor),
            None,
            false,
            Point {
                x: front.x + 0.5,
                y: front.y,
            },
            true,
        )
        .unwrap();
    // A sub-unit vector stays unnormalized before multiplication by distance.
    assert_eq!(
        short.points()[0].position_offset(),
        Point { x: -9.75, y: 0. }
    );
    assert_eq!(short.points()[0].edge_length_offset(), f64::from(-0.95_f32));
    let mut long = body(4);
    let anchor = Point {
        x: front.x + 20.,
        y: front.y,
    };
    long.apply_anchor(
        Some(anchor),
        None,
        false,
        Point {
            x: front.x + 11.,
            y: front.y,
        },
        true,
    )
    .unwrap();
    // Head distance beyond one configured segment projects the complete new chord.
    assert_eq!(long.points()[0].edge_length(), 2.);
    assert_eq!(long.points()[0].position_offset(), Point::default());
    assert_eq!(long.points()[0].edge_length_offset(), 0.);
}

#[test]
fn late_contraction_overflow_rolls_back_membership_and_earlier_moves() {
    let mut a = appearance(4);
    a.absolute_body = [0., f64::MAX / 2., 0., -f64::MAX]
        .into_iter()
        .map(|x| Point { x, y: 0. })
        .collect();
    let mut b = BodyGeometry::from_appearance(&a, &setup()).unwrap();
    let before = b.clone();
    assert!(
        b.apply_anchor(
            Some(Point { x: 10., y: 0. }),
            Some(321),
            false,
            Point::default(),
            false
        )
        .is_err()
    );
    assert_eq!(b, before);
}

#[test]
fn empty_single_point_and_invalid_appearances_are_bounded() {
    let mut empty = body(0);
    assert!(!empty.remove_tail().unwrap());
    assert!(
        empty
            .apply_anchor(
                Some(Point::default()),
                Some(0),
                true,
                Point::default(),
                false
            )
            .is_err()
    );
    let mut single = body(1);
    assert_eq!(single.points()[0].previous_delta(), Point::default());
    append(&mut single, false, true);
    assert_eq!(single.logical_segments(), 1);
    assert!(single.points()[1].dying());
    let mut bad_setup = setup();
    for spacing in [0., -1., f64::NAN] {
        bad_setup.body_spacing = spacing;
        assert!(BodyGeometry::from_appearance(&appearance(1), &bad_setup).is_err());
    }
    bad_setup = setup();
    bad_setup.body_contraction = 1.01;
    assert!(BodyGeometry::from_appearance(&appearance(1), &bad_setup).is_err());
    let mut bad = appearance(2);
    bad.absolute_body[1].x = f64::INFINITY;
    assert!(BodyGeometry::from_appearance(&bad, &setup()).is_err());
    assert!(BodyGeometry::from_appearance(&appearance(MAX_BODY_POINTS + 1), &setup()).is_err());
}

#[test]
fn logical_and_retained_caps_reject_without_any_mutation() {
    let mut b = body(MAX_BODY_POINTS);
    let before = b.clone();
    let point = Point { x: -10., y: 4. };
    assert!(
        b.apply_anchor(Some(point), Some(0), true, point, false)
            .is_err()
    );
    assert_eq!(b, before);
    // No clock runs here: every non-growing anchor retains another dying record.
    for index in 0..MAX_RETAINED_BODY_POINTS - MAX_BODY_POINTS {
        b.apply_anchor(
            Some(Point {
                x: index as f64,
                y: 0.,
            }),
            Some(0),
            false,
            point,
            false,
        )
        .unwrap();
    }
    assert_eq!(b.points().len(), MAX_RETAINED_BODY_POINTS);
    assert_eq!(b.logical_segments(), MAX_BODY_POINTS);
    let before = b.clone();
    assert!(
        b.apply_anchor(Some(point), Some(999), false, point, false)
            .is_err()
    );
    assert_eq!(b, before);
    b.advance(667);
    assert_eq!(b.points().len(), MAX_BODY_POINTS + 3);
    b.apply_anchor(Some(point), Some(999), false, point, false)
        .unwrap();
}
