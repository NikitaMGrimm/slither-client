//! Original synthetic curve fixtures. No external reference inputs or network use.

use slither_client::{
    presentation::{
        BodyGeometry, CurveInput, MAX_CURVE_SAMPLES, sample_curve, sample_curve_with_heading,
    },
    state::{Appearance, Direction, Point, Setup},
};
use std::f64::consts::PI;

fn geometry(points: Vec<Point>, contraction: f64) -> BodyGeometry {
    let setup = Setup {
        protocol: 19,
        grid_center: 1000.,
        radius: 900.,
        sector_size: 100,
        sector_count: 20,
        max_segments: 200,
        body_spacing: 10.,
        body_contraction: contraction,
        spangdv: 4.,
        nsp1: 4.,
        nsp2: 0.5,
        nsp3: 12.,
        mamu: 0.03,
        mamu2: 0.02,
        server_number: None,
        game_mode: None,
        team: None,
    };
    let appearance = Appearance {
        id: 1,
        skin: 0,
        name: String::new(),
        custom_skin: Vec::new(),
        cosmetic: 255,
        absolute_head: Point { x: 10., y: 0. },
        absolute_body: points,
        anchor_direction: Some(0),
        heading: 0.,
        wanted_heading: 0.,
        speed_per_32ms: 4.,
        fam: 0.,
        wire_direction: Direction::None,
    };
    BodyGeometry::from_appearance(&appearance, &setup).unwrap()
}

fn straight() -> BodyGeometry {
    geometry(
        (0..8)
            .map(|i| Point {
                x: -(i as f64) * 10.,
                y: 0.,
            })
            .collect(),
        0.,
    )
}

fn input(body: &BodyGeometry) -> CurveInput<'_> {
    CurveInput {
        corrected_head: Point { x: 10., y: 0. },
        head_fraction: 0.,
        body: body.points(),
        displayed_length: 7.4,
        segment_length: 10.,
        point_spacing: 6.,
        target_point_spacing: 6.,
        quality_scale: 1.,
        detailed_style: false,
    }
}

#[test]
fn explicit_heading_supports_one_sample_without_hiding_other_failures() {
    let body = geometry(vec![Point { x: 0., y: 0. }, Point { x: -10., y: 0. }], 0.);
    let mut args = input(&body);
    args.corrected_head = Point::default();
    args.displayed_length = -0.6;
    let before = body.clone();
    assert!(sample_curve(args).is_err());
    let out = sample_curve_with_heading(args, 7.).unwrap();
    assert_eq!(out.samples.len(), 1);
    assert_eq!(out.samples[0].angle, 0.);
    assert_eq!(out.target_eye_heading, 7.);
    assert_eq!(out.vertices()[0].position, Point::default());
    assert_eq!(out.redistribution_count(), 0);
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(sample_curve_with_heading(args, bad).is_err());
    }
    args.corrected_head.x = f64::MAX;
    assert!(sample_curve_with_heading(args, 7.).is_err());
    args = input(&body);
    args.point_spacing = 1e-5;
    args.target_point_spacing = 1e-5;
    assert!(sample_curve_with_heading(args, 7.).is_err());
    assert_eq!(body, before);
}

#[test]
fn straight_samples_have_ordered_positions_and_tailward_tangents() {
    let body = straight();
    let curve = sample_curve(input(&body)).unwrap();
    assert!(curve.samples.len() > body.points().len());
    assert_eq!(curve.samples[0].x, 10.);
    assert!(
        curve
            .samples
            .iter()
            .all(|p| p.y == 0. && p.angle == PI as f32)
    );
    assert!(curve.samples.windows(2).all(|p| p[0].x >= p[1].x));
    assert_eq!(curve.samples.len(), curve.vertices().len());
    assert_eq!(curve.target_eye_heading, f64::from(PI as f32) + PI);
}

#[test]
fn fractional_terminal_length_and_head_fraction_are_separate() {
    let body = straight();
    let mut args = input(&body);
    args.displayed_length = 0.;
    let zero = sample_curve(args).unwrap();
    args.displayed_length = 0.27;
    let partial = sample_curve(args).unwrap();
    assert!(!zero.samples.is_empty());
    assert!(partial.samples.len() >= zero.samples.len());
    assert_ne!(partial.samples.last(), zero.samples.last());
    args.head_fraction = -2.75;
    assert_eq!(sample_curve(args).unwrap(), partial);
    args.head_fraction = 3.5;
    assert_eq!(sample_curve(args).unwrap(), partial);
}

#[test]
fn density_obeys_quality_and_detailed_style_without_a_clock() {
    let body = straight();
    let mut args = input(&body);
    let standard = sample_curve(args).unwrap();
    args.quality_scale = 1.7;
    let low = sample_curve(args).unwrap();
    args.quality_scale = 1.;
    args.detailed_style = true;
    let detailed = sample_curve(args).unwrap();
    assert!(low.samples.len() < standard.samples.len());
    assert!(detailed.samples.len() > standard.samples.len());
    assert_eq!(sample_curve(args).unwrap(), detailed);
}

#[test]
fn spacing_advances_once_and_clamps_in_both_directions() {
    let body = straight();
    let mut args = input(&body);
    args.point_spacing = 6.2;
    args.target_point_spacing = 6.;
    let first = sample_curve(args).unwrap();
    assert_eq!(first.point_spacing, 6.2 - 0.0035);
    args.point_spacing = first.point_spacing;
    assert_eq!(
        sample_curve(args).unwrap().point_spacing,
        (6.2 - 0.0035) - 0.0035
    );
    args.point_spacing = 6.001;
    assert_eq!(sample_curve(args).unwrap().point_spacing, 6.);
    args.point_spacing = 5.8;
    assert_eq!(sample_curve(args).unwrap().point_spacing, 5.8 + 0.0035);
    args.point_spacing = 5.999;
    assert_eq!(sample_curve(args).unwrap().point_spacing, 6.);
}

#[test]
fn redistribution_is_same_draw_and_angles_use_f64_geometry() {
    let body = geometry(
        vec![
            Point {
                x: 2000.15,
                y: 2000.35,
            },
            Point {
                x: 1992.72,
                y: 1991.13,
            },
            Point {
                x: 1982.97,
                y: 1993.52,
            },
            Point {
                x: 1976.21,
                y: 1983.78,
            },
            Point {
                x: 1968.93,
                y: 1986.84,
            },
            Point {
                x: 1960.01,
                y: 1979.67,
            },
            Point {
                x: 1955.34,
                y: 1969.89,
            },
            Point {
                x: 1948.22,
                y: 1971.34,
            },
        ],
        0.37,
    );
    let mut args = input(&body);
    args.corrected_head = Point {
        x: 2007.22,
        y: 2006.76,
    };
    let out = sample_curve(args).unwrap();
    assert!(out.redistribution_count() >= 3);
    assert!(out.vertices().iter().any(|p| p.position != p.sampled));
    assert!(
        out.vertices()[out.redistribution_count()..]
            .iter()
            .all(|p| p.position == p.sampled)
    );
    let mut rounded_difference = false;
    for i in 1..out.samples.len() {
        let p = out.vertices()[i].position;
        let prior = out.vertices()[i - 1].position;
        assert_eq!(
            out.samples[i].angle,
            (p.y - prior.y).atan2(p.x - prior.x) as f32
        );
        let p = out.samples[i];
        let prior = out.samples[i - 1];
        rounded_difference |= ((f64::from(p.y) - f64::from(prior.y))
            .atan2(f64::from(p.x) - f64::from(prior.x)) as f32)
            != p.angle;
    }
    assert!(rounded_difference);
}

#[test]
fn turns_cross_signed_pi_and_coincident_head_stays_finite() {
    let body = geometry(
        vec![
            Point { x: 0., y: 0. },
            Point { x: -10., y: 0.01 },
            Point { x: -20., y: -0.01 },
            Point { x: -30., y: 0.01 },
        ],
        0.,
    );
    let mut args = input(&body);
    args.displayed_length = 3.4;
    let out = sample_curve(args).unwrap();
    assert!(out.samples.iter().any(|p| p.angle > 3.));
    assert!(out.samples.iter().any(|p| p.angle < -3.));
    args.corrected_head = body.points()[0].position();
    let out = sample_curve(args).unwrap();
    assert!(
        out.samples
            .iter()
            .all(|p| p.x.is_finite() && p.y.is_finite() && p.angle.is_finite())
    );
}

#[test]
fn invalid_or_over_capacity_inputs_return_no_mutation() {
    let body = straight();
    let before = body.clone();
    let baseline = input(&body);
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut args = baseline;
        args.head_fraction = invalid;
        assert!(sample_curve(args).is_err());
        args = baseline;
        args.corrected_head.x = invalid;
        assert!(sample_curve(args).is_err());
        args = baseline;
        args.displayed_length = invalid;
        assert!(sample_curve(args).is_err());
    }
    for invalid in [0., -1., f64::NAN, f64::INFINITY] {
        let mut args = baseline;
        args.point_spacing = invalid;
        assert!(sample_curve(args).is_err());
        args = baseline;
        args.target_point_spacing = invalid;
        assert!(sample_curve(args).is_err());
        args = baseline;
        args.segment_length = invalid;
        assert!(sample_curve(args).is_err());
        args = baseline;
        args.quality_scale = invalid;
        assert!(sample_curve(args).is_err());
    }
    let mut args = baseline;
    args.body = &[];
    assert!(sample_curve(args).is_err());
    args.body = &body.points()[..1];
    assert!(sample_curve(args).is_err());
    args = baseline;
    args.point_spacing = 1e-5;
    args.target_point_spacing = 1e-5;
    assert!(sample_curve(args).is_err());
    args = baseline;
    args.corrected_head.x = f64::MAX;
    assert!(sample_curve(args).is_err());
    args = baseline;
    args.corrected_head = Point { x: 1e100, y: 1e100 };
    assert!(sample_curve(args).is_err());
    assert_eq!(body, before);
    assert!(sample_curve(baseline).unwrap().samples.len() <= MAX_CURVE_SAMPLES);
}

#[test]
fn two_anchor_extension_does_not_expand_redistribution_prefix() {
    let body = geometry(vec![Point { x: 0., y: 0. }, Point { x: -10., y: 0. }], 0.);
    let mut args = input(&body);
    args.corrected_head = Point { x: 5., y: 0. };
    args.displayed_length = 1.4;
    let out = sample_curve(args).unwrap();
    assert!(out.redistribution_count() >= 3);
    assert!(out.redistribution_count() + 1 < out.samples.len());
    assert!(
        out.vertices()
            .iter()
            .skip(out.redistribution_count() + 1)
            .all(|p| p.distance_from_previous.is_none())
    );
    assert!(
        out.vertices()[out.redistribution_count()..]
            .iter()
            .all(|p| p.sampled == p.position)
    );
}

fn stationary_front_client(chord: u16) -> slither_client::presentation::AnimatedClient {
    use slither_client::{presentation::AnimatedClient, protocol::ElapsedHeader};
    let u24 = |n: u32| {
        [
            ((n >> 16) & 255) as u8,
            ((n >> 8) & 255) as u8,
            (n & 255) as u8,
        ]
    };
    let mut setup = vec![b'a'];
    setup.extend(u24(1000));
    for value in [430_u16, 100, 20] {
        setup.extend(value.to_be_bytes());
    }
    setup.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        setup.extend(value.to_be_bytes());
    }
    setup.extend([19, 42]);
    let mut spawn = vec![b's', 0, 7];
    spawn.extend(u24(0));
    spawn.push(b'0');
    spawn.extend(u24(0));
    spawn.extend(4250_u16.to_be_bytes());
    spawn.extend(u24(0));
    spawn.push(0);
    spawn.extend(u24(2000 * 5));
    spawn.extend(u24(1000 * 5));
    spawn.extend([0, 0, 255]);
    spawn.extend(u24((2000 - 12 * 42) * 5));
    spawn.extend(u24(1000 * 5));
    for _ in 0..10 {
        spawn.extend([211, 127]);
    }
    spawn.extend([0, 0]);
    let mut client = AnimatedClient::new(0.).unwrap();
    for packet in [setup, spawn] {
        client.apply_frame(&packet, ElapsedHeader::Absent).unwrap();
    }
    client.prepare_draw(800, 600).unwrap();
    let mut frame = Vec::new();
    for x in [2000_u16, 2000 + chord] {
        let mut anchor = vec![b'=', 0, 7, 0, 0];
        anchor.extend(x.to_be_bytes());
        anchor.extend(1000_u16.to_be_bytes());
        frame.extend((anchor.len() as u16).to_be_bytes());
        frame.extend(anchor);
    }
    client.apply_frame(&frame, ElapsedHeader::Absent).unwrap();
    client.prepare_draw(800, 600).unwrap();
    client
}

fn assert_stationary_front_curve(chord: u16) {
    let client = stationary_front_client(chord);
    let snake = client.own_snake().unwrap();
    let metrics = snake.metrics();
    assert!(metrics.visible);
    let front = &snake.body().points()[0];
    assert_eq!(front.edge_length_offset(), -1.);
    assert_eq!(
        front.edge_length() + front.edge_length_offset(),
        f64::from(chord) / 42. - 1.
    );
    let before = client.clone();
    let curve = sample_curve(CurveInput {
        corrected_head: metrics.corrected_head,
        head_fraction: metrics.corrected_head_fraction,
        body: snake.body().points(),
        displayed_length: metrics.displayed_length,
        segment_length: 42.,
        point_spacing: metrics.point_spacing,
        target_point_spacing: metrics.point_spacing,
        quality_scale: 1.,
        detailed_style: false,
    })
    .unwrap();
    assert!(curve.samples.len() > snake.body().points().len());
    assert!(
        curve
            .samples
            .iter()
            .all(|p| p.x.is_finite() && p.y.is_finite() && p.angle.is_finite())
    );
    assert!(curve.vertices().iter().all(|p| p.sampled.x.is_finite()
        && p.sampled.y.is_finite()
        && p.position.x.is_finite()
        && p.position.y.is_finite()));
    assert_eq!(client, before);
}

#[test]
fn stationary_front_anchor_can_have_zero_corrected_edge() {
    assert_stationary_front_curve(42);
}

#[test]
fn stationary_front_short_chord_can_have_negative_corrected_edge() {
    assert_stationary_front_curve(8);
}
