//! Original synthetic native eye coupling cases; no external references or traffic.

use std::f64::consts::{FRAC_PI_2, PI, TAU};

use slither_client::{
    presentation::{
        AnimatedClient, ClientPresentationError, CurveInput, FrameStep, MAX_CURVE_SAMPLES,
        MAX_DRAW_SAMPLES, MAX_RETAINED_TOTAL_BODY_POINTS, SnakePresentation, StandardEyeGeometry,
        StandardEyeState, Turn, sample_curve,
    },
    protocol::ElapsedHeader,
    state::{Appearance, Direction, Point, Setup},
};

fn u24(value: u32) -> [u8; 3] {
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

fn setup() -> Vec<u8> {
    let mut packet = vec![b'a'];
    packet.extend(u24(1000));
    for value in [430_u16, 100, 20] {
        packet.extend(value.to_be_bytes());
    }
    packet.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        packet.extend(value.to_be_bytes());
    }
    packet.extend([19, 42]);
    packet
}

fn appearance(id: u16, x: u32, points: usize) -> Vec<u8> {
    let mut packet = vec![b's'];
    packet.extend(id.to_be_bytes());
    packet.extend(u24(2_000_000));
    packet.push(b'0');
    packet.extend(u24(4_000_000));
    packet.extend(0_u16.to_be_bytes());
    packet.extend(u24(0));
    packet.push(0);
    packet.extend(u24(x * 5));
    packet.extend(u24(1000 * 5));
    packet.extend([0, 0, 255]);
    if points > 0 {
        packet.extend(u24((x - points as u32 * 42) * 5));
        packet.extend(u24(1000 * 5));
        for _ in 2..points {
            packet.extend([211, 127]);
        }
        if points >= 2 {
            packet.extend(0_u16.to_be_bytes());
        }
    }
    packet
}

fn motion(code: u8, id: u16, fields: &[u8]) -> Vec<u8> {
    let mut packet = vec![code];
    packet.extend(id.to_be_bytes());
    packet.extend(fields);
    packet
}

fn remove(id: u16, died: bool) -> Vec<u8> {
    let mut packet = vec![b's'];
    packet.extend(id.to_be_bytes());
    packet.push(u8::from(died));
    packet
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut frame = Vec::new();
    for command in commands {
        frame.extend((command.len() as u16).to_be_bytes());
        frame.extend(command);
    }
    frame
}

fn apply(client: &mut AnimatedClient, commands: &[Vec<u8>]) {
    client
        .apply_frame(&bundle(commands), ElapsedHeader::Absent)
        .unwrap();
}

fn client(points: usize) -> AnimatedClient {
    let mut client = AnimatedClient::new(0.).unwrap();
    apply(&mut client, &[setup(), appearance(7, 2000, points)]);
    client
}

#[test]
fn spawn_uses_effective_heading_and_independently_wanted_gaze() {
    for points in [0, 1, 3] {
        let c = client(points);
        let snake = c.own_snake().unwrap();
        let effective = if points >= 2 {
            0.
        } else {
            2_000_000. * TAU / 16_777_215.
        };
        assert_eq!(snake.eyes().heading(), effective);
        assert_eq!(snake.eyes().target_heading(), effective);
        assert_eq!(snake.eyes().gaze_heading(), 4_000_000. * TAU / 16_777_215.);
        assert_eq!(snake.eyes().pupil(), Point::default());
        assert_eq!(snake.eyes().turn(), Turn::None);
        assert_eq!(*snake.eye_geometry(), StandardEyeGeometry::default());
        if points >= 2 {
            assert_ne!(snake.eyes().heading(), c.received().snakes[&7].heading);
        }
    }
}

#[test]
fn own_gaze_is_independent_of_packets_metrics_rings_and_transport() {
    let mut c = client(3);
    let before = c.own_snake().unwrap().clone();
    c.set_own_gaze_heading(-0.75).unwrap();
    let own = c.own_snake().unwrap();
    assert_eq!(own.eyes().gaze_heading(), -0.75);
    assert_eq!(own.metrics(), before.metrics());
    assert_eq!(own.head_corrections(), before.head_corrections());
    assert_eq!(own.angle_corrections(), before.angle_corrections());
    assert_eq!(own.body(), before.body());
    assert_eq!(own.length(), before.length());
    apply(&mut c, &[motion(b'E', 7, &[32]), vec![b'E', 64]]);
    assert_eq!(c.own_snake().unwrap().eyes().gaze_heading(), -0.75);
    assert_eq!(c.own_snake().unwrap().metrics().wanted_heading, FRAC_PI_2);
}

#[test]
fn remote_wanted_only_changes_gaze_when_present_and_targets_latest_object() {
    let mut c = client(3);
    apply(&mut c, &[appearance(8, 2100, 3)]);
    apply(&mut c, &[motion(b'E', 8, &[64])]);
    let remote = c.snake(8).unwrap();
    let before = *remote.eyes();
    assert_eq!(before.gaze_heading(), FRAC_PI_2);
    apply(
        &mut c,
        &[
            motion(b'e', 8, &[32]),
            motion(b'3', 8, &[18]),
            motion(b'5', 8, &[7]),
        ],
    );
    assert_eq!(*c.snake(8).unwrap().eyes(), before);

    apply(&mut c, &[appearance(8, 2200, 3), motion(b'4', 8, &[128])]);
    let remotes = c
        .drawn_snakes()
        .filter(|snake| snake.metrics().id == 8)
        .collect::<Vec<_>>();
    assert_eq!(remotes[0].eyes().gaze_heading(), FRAC_PI_2);
    assert_eq!(remotes[1].eyes().gaze_heading(), 128. * TAU / 256.);
}

#[test]
fn reused_own_wire_id_is_remote_while_original_own_accepts_gaze_during_death() {
    for died in [false, true] {
        let mut c = client(3);
        c.set_own_gaze_heading(-0.5).unwrap();
        apply(&mut c, &[remove(7, died), appearance(7, 2050, 3)]);
        c.set_own_gaze_heading(0.75).unwrap();
        apply(&mut c, &[motion(b'E', 7, &[64]), vec![b'E', 128]]);
        assert_eq!(c.own_snake().unwrap().eyes().gaze_heading(), 0.75);
        assert_eq!(c.snake(7).unwrap().eyes().gaze_heading(), FRAC_PI_2);
        assert_eq!(c.drawn_own_snake().is_some(), died);
        assert!(c.active_own_snake().is_none());
    }
}

#[test]
fn finite_gaze_validation_is_atomic_even_without_own_or_after_removal() {
    for mut c in [AnimatedClient::new(0.).unwrap(), client(3)] {
        c.set_own_gaze_heading(0.25).unwrap();
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let before = c.clone();
            assert!(c.set_own_gaze_heading(bad).is_err());
            assert_eq!(c, before);
        }
    }
    let mut c = client(3);
    apply(&mut c, &[remove(7, false)]);
    c.set_own_gaze_heading(-2.).unwrap();
    let own = c.own_snake().unwrap().clone();
    c.advance(40., false).unwrap();
    assert_eq!(c.own_snake().unwrap(), &own);
}

#[test]
fn draw_commits_next_target_but_captures_current_face_and_diagnostics_do_not_commit() {
    let mut c = client(3);
    let output = c.prepare_draw_with_style(800, 600, 1., false).unwrap();
    let curve = output[0].curve.as_ref().unwrap();
    assert_eq!(output[0].face_heading, 0.);
    assert_eq!(c.own_snake().unwrap().eyes().heading(), 0.);
    assert_eq!(
        c.own_snake().unwrap().eyes().target_heading(),
        curve.target_eye_heading
    );
    let before = c.clone();
    let snake = c.own_snake().unwrap();
    let m = snake.metrics();
    let diagnostic = sample_curve(CurveInput {
        corrected_head: m.corrected_head,
        head_fraction: m.corrected_head_fraction,
        body: snake.body().points(),
        displayed_length: m.displayed_length,
        segment_length: snake.body().segment_length(),
        point_spacing: m.point_spacing,
        target_point_spacing: m.point_spacing,
        quality_scale: 1.7,
        detailed_style: true,
    })
    .unwrap();
    assert!(diagnostic.samples.len() >= 2);
    assert_eq!(c, before);
    let mut expected = *snake.eyes();
    let step = c.advance(8., false).unwrap();
    expected
        .advance(step, true, StandardEyeGeometry::default().pupil_travel)
        .unwrap();
    assert_eq!(*c.own_snake().unwrap().eyes(), expected);
    let pupils = expected.pupil();
    let repeated = c.prepare_draw_with_style(800, 600, 1., false).unwrap();
    assert_eq!(repeated[0].face_heading, expected.heading());
    assert_eq!(repeated[0].pupil, pupils);
}

#[test]
fn offscreen_fractional_updates_continue_and_visible_entry_uses_raw_heading() {
    let mut c = client(3);
    c.prepare_draw(800, 600).unwrap();
    c.set_own_gaze_heading(0.).unwrap();
    c.set_follows(false);
    c.set_camera_position(Point {
        x: -100_000.,
        y: 0.,
    })
    .unwrap();
    assert!(
        c.prepare_draw_with_style(100, 100, 1., false)
            .unwrap()
            .is_empty()
    );
    let before = *c.own_snake().unwrap().eyes();
    c.advance(4., false).unwrap();
    assert_eq!(c.own_snake().unwrap().eyes().heading(), before.heading());
    assert_eq!(c.own_snake().unwrap().eyes().pupil().x, 1. / 12.);
    assert_eq!(
        c.own_snake().unwrap().eyes().target_heading(),
        before.target_heading()
    );
    apply(&mut c, &[vec![b'e', 64]]);
    c.advance(8., false).unwrap();
    let snake = c.own_snake().unwrap();
    let before_entry = *snake.eyes();
    let m = snake.metrics();
    assert_ne!(m.heading, m.corrected_heading);
    let body = snake.body().points()[0].position();
    c.set_camera_position(body).unwrap();
    let output = c.prepare_draw_with_style(800, 600, 1., false).unwrap();
    let eyes = c.own_snake().unwrap().eyes();
    assert_eq!(output[0].face_heading, m.heading);
    assert_eq!(eyes.heading(), m.heading);
    assert_ne!(eyes.heading(), m.corrected_heading);
    assert_eq!(eyes.pupil(), before_entry.pupil());
    assert_eq!(eyes.turn(), before_entry.turn());
    assert_eq!(
        eyes.target_heading(),
        output[0].curve.as_ref().unwrap().target_eye_heading
    );
}

#[test]
fn death_clears_direction_and_keeps_pupils_updating_until_expiry() {
    let mut c = client(3);
    c.prepare_draw(800, 600).unwrap();
    c.set_own_gaze_heading(0.).unwrap();
    c.advance(8., false).unwrap();
    assert_ne!(c.own_snake().unwrap().eyes().turn(), Turn::None);
    let before = *c.own_snake().unwrap().eyes();
    apply(
        &mut c,
        &[appearance(8, 2050, 3), remove(7, true), remove(8, true)],
    );
    assert_eq!(c.own_snake().unwrap().eyes().turn(), Turn::None);
    assert_eq!(c.own_snake().unwrap().eyes().heading(), before.heading());
    c.set_own_gaze_heading(-FRAC_PI_2).unwrap();
    c.advance(16., false).unwrap();
    let own = c.drawn_own_snake().unwrap();
    assert_eq!(own.eyes().heading(), before.heading());
    assert_eq!(own.eyes().pupil().y, -1. / 6.);
    let output = c.prepare_draw_with_style(800, 600, 1., false).unwrap();
    assert!(output.iter().any(|snake| snake.own && !snake.metrics.alive));
    for index in 1..=12 {
        c.advance(16. + f64::from(index) * 40., false).unwrap();
    }
    assert!(c.own_snake().unwrap().metrics().expired);
    assert!(c.drawn_own_snake().is_none());
    assert!(c.snake(8).is_none());
    let before = c.own_snake().unwrap().clone();
    c.advance(536., false).unwrap();
    assert_eq!(c.own_snake().unwrap(), &before);
    c.set_own_gaze_heading(0.25).unwrap();
    assert_eq!(c.own_snake().unwrap().eyes().gaze_heading(), 0.25);
    assert_eq!(c.own_snake().unwrap().eyes().pupil(), before.eyes().pupil());
}

#[test]
fn one_anchor_uses_finite_lead_target_without_drawing_missing_suffix() {
    let mut c = client(1);
    let first = c.prepare_draw_with_style(800, 600, 1., false).unwrap();
    assert_eq!(first.len(), 1);
    assert!(first[0].curve.is_none());
    assert_eq!(first[0].face_heading, first[0].metrics.heading);
    let face = first[0].face_heading;
    let target = f64::from(PI as f32) + PI;
    assert_eq!(c.own_snake().unwrap().eyes().target_heading(), target);
    apply(&mut c, &[vec![b'e', 64]]);
    let output = c.prepare_draw_with_style(800, 600, 1., false).unwrap();
    assert!(output[0].curve.is_none());
    assert_eq!(output[0].face_heading, face);
    assert_eq!(c.own_snake().unwrap().eyes().target_heading(), target);
    assert_ne!(target, output[0].metrics.heading);
    let mut expected =
        StandardEyeState::new(face, c.own_snake().unwrap().eyes().gaze_heading()).unwrap();
    expected.commit_draw_target(target).unwrap();
    let step = c.advance(8., false).unwrap();
    expected
        .advance(step, true, StandardEyeGeometry::default().pupil_travel)
        .unwrap();
    assert_eq!(*c.own_snake().unwrap().eyes(), expected);
}

#[test]
fn single_anchor_lead_target_is_independent_of_other_snakes_and_style() {
    for predecessor_points in [0, 2, 12] {
        for detailed in [false, true] {
            let mut c = AnimatedClient::new(0.).unwrap();
            apply(&mut c, &[setup()]);
            if predecessor_points != 0 {
                apply(&mut c, &[appearance(7, 2060, predecessor_points)]);
            }
            let mut remote = appearance(8, 2000, 1);
            let index = remote.len() - 6;
            // A synthetic 3:4 head lead, separate from the packet's face heading.
            remote[index..index + 3].copy_from_slice(&u24(1970 * 5));
            remote[index + 3..].copy_from_slice(&u24(960 * 5));
            apply(&mut c, &[remote]);
            for drained in [false, true] {
                if drained {
                    apply(&mut c, &[vec![b'r', 0, 8]]);
                    for index in 1..=12 {
                        c.advance(f64::from(index) * 40., false).unwrap();
                    }
                    assert_eq!(c.snake(8).unwrap().metrics().displayed_length, -0.6);
                }
                let prepared = c.prepare_draw_with_style(800, 600, 1., detailed).unwrap();
                let remote = prepared.iter().find(|snake| snake.metrics.id == 8).unwrap();
                assert!(remote.curve.is_none());
                assert_eq!(
                    c.snake(8).unwrap().eyes().target_heading(),
                    f64::from((-4_f64).atan2(-3.) as f32) + PI
                );
            }
        }
    }
}

#[test]
fn coincident_single_anchor_keeps_finite_raw_fallback_for_unsupported_suffix() {
    for (mass, remove, length) in [(0, false, 0.4), (10_066_329, true, 0.), (0, true, -0.6)] {
        let mut c = AnimatedClient::new(0.).unwrap();
        let mut spawn = appearance(7, 2000, 1);
        spawn[12..15].copy_from_slice(&u24(mass));
        let index = spawn.len() - 6;
        spawn[index..index + 3].copy_from_slice(&u24(2000 * 5));
        apply(&mut c, &[setup(), spawn]);
        if remove {
            apply(&mut c, &[vec![b'r', 0, 7]]);
            for index in 1..=12 {
                c.advance(f64::from(index) * 40., false).unwrap();
            }
        }
        assert_eq!(c.own_snake().unwrap().metrics().displayed_length, length);
        for detailed in [false, true] {
            let prepared = c.prepare_draw_with_style(800, 600, 1.7, detailed).unwrap();
            assert_eq!(prepared.len(), 1);
            assert!(prepared[0].curve.is_none());
            assert_eq!(
                c.own_snake().unwrap().eyes().target_heading(),
                prepared[0].metrics.heading
            );
        }
    }
}

#[test]
fn one_emitted_sample_retains_body_and_raw_eye_target_after_tail_drain() {
    let mut c = AnimatedClient::new(0.).unwrap();
    // Two synthetic retained anchors with the front exactly at the stationary head.
    let mut spawn = appearance(7, 2000, 2);
    let tail = spawn.len() - 8;
    spawn[tail..tail + 3].copy_from_slice(&u24(1958 * 5));
    apply(
        &mut c,
        &[setup(), spawn, vec![b'r', 0, 7], vec![b'r', 0, 7]],
    );
    for index in 1..=12 {
        c.advance(f64::from(index) * 40., false).unwrap();
    }
    let snake = c.own_snake().unwrap();
    assert_eq!(snake.body().points().len(), 2);
    assert_eq!(snake.metrics().logical_segments, 0);
    assert_eq!(snake.metrics().displayed_length, -0.6);
    for detailed_style in [false, true] {
        let output = c
            .prepare_draw_with_style(800, 600, 1., detailed_style)
            .unwrap();
        assert_eq!(output.len(), 1);
        let curve = output[0].curve.as_ref().unwrap();
        assert_eq!(curve.samples.len(), 1);
        assert_eq!(curve.samples[0].x, 2000.);
        assert_eq!(curve.samples[0].y, 1000.);
        assert_eq!(curve.samples[0].angle, 0.);
        assert_eq!(curve.target_eye_heading, output[0].metrics.heading);
        assert_eq!(
            c.own_snake().unwrap().eyes().target_heading(),
            output[0].metrics.heading
        );
    }
}

#[test]
fn prepared_outputs_keep_draw_order_duplicate_ids_and_culled_ordinal_gaps() {
    let mut c = client(3);
    apply(
        &mut c,
        &[
            appearance(8, 100_000, 3),
            appearance(7, 2050, 3),
            appearance(9, 2100, 1),
        ],
    );
    let output = c.prepare_draw_with_style(800, 600, 1.3, true).unwrap();
    assert_eq!(
        output
            .iter()
            .map(|s| (s.draw_ordinal, s.metrics.id, s.own))
            .collect::<Vec<_>>(),
        vec![(0, 7, true), (2, 7, false), (3, 9, false)]
    );
    let drawn = c.drawn_snakes().collect::<Vec<_>>();
    for prepared in output {
        let snake = drawn[prepared.draw_ordinal];
        assert_eq!(prepared.metrics, snake.metrics());
        assert_eq!(prepared.pupil, snake.eyes().pupil());
        assert_eq!(prepared.eye_geometry, *snake.eye_geometry());
        if let Some(curve) = prepared.curve {
            let m = prepared.metrics;
            let expected = sample_curve(CurveInput {
                corrected_head: m.corrected_head,
                head_fraction: m.corrected_head_fraction,
                body: snake.body().points(),
                displayed_length: m.displayed_length,
                segment_length: snake.body().segment_length(),
                point_spacing: m.point_spacing,
                target_point_spacing: m.point_spacing,
                quality_scale: 1.3,
                detailed_style: true,
            })
            .unwrap();
            assert_eq!(curve, expected);
            assert_eq!(snake.eyes().target_heading(), curve.target_eye_heading);
        }
    }
}

#[test]
fn spacing_advances_once_and_legacy_draw_delegates_to_identical_transaction() {
    let mut c = client(3);
    c.prepare_draw(800, 600).unwrap();
    c.set_zoom(0.5).unwrap();
    let mut grow = vec![b'+'];
    grow.extend(0_u16.to_be_bytes());
    grow.extend(2005_u16.to_be_bytes());
    grow.extend(1005_u16.to_be_bytes());
    grow.extend(u24(0));
    apply(&mut c, &[grow]);
    let before = c.own_snake().unwrap().metrics();
    assert!(before.target_point_spacing > before.point_spacing);
    let mut legacy = c.clone();
    legacy.prepare_draw(800, 600).unwrap();
    let output = c.prepare_draw_with_style(800, 600, 1., false).unwrap();
    assert_eq!(c, legacy);
    assert_eq!(
        output[0].metrics.point_spacing,
        before.point_spacing + 0.0035
    );
    assert_eq!(
        output[0].curve.as_ref().unwrap().point_spacing,
        before.point_spacing + 0.0035
    );
}

#[test]
fn invalid_style_and_dimensions_reject_even_empty_or_culled_draws() {
    let mut culled = client(3);
    culled.set_follows(false);
    culled
        .set_camera_position(Point {
            x: -100_000.,
            y: 0.,
        })
        .unwrap();
    for mut c in [AnimatedClient::new(0.).unwrap(), culled] {
        for quality in [0., -1., f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let before = c.clone();
            assert!(c.prepare_draw_with_style(800, 600, quality, false).is_err());
            assert_eq!(c, before);
        }
        for (width, height) in [(0, 600), (800, 0)] {
            let before = c.clone();
            assert!(c.prepare_draw_with_style(width, height, 1., true).is_err());
            assert_eq!(c, before);
        }
        assert!(
            c.prepare_draw_with_style(800, 600, 1., true)
                .unwrap()
                .is_empty()
        );
    }
}

#[test]
fn aggregate_draw_cap_rolls_back_camera_visibility_spacing_and_eye_targets() {
    assert_eq!(MAX_DRAW_SAMPLES, MAX_RETAINED_TOTAL_BODY_POINTS * 2);
    let mut c = client(2);
    let one = c.prepare_draw_with_style(800, 600, 0.0003, false).unwrap();
    let per_snake = one[0].curve.as_ref().unwrap().samples.len();
    assert!(per_snake <= MAX_CURVE_SAMPLES);
    let fitting = MAX_DRAW_SAMPLES / per_snake;
    assert!((2..=32).contains(&fitting));
    for _ in 1..fitting {
        apply(&mut c, &[appearance(7, 2000, 2)]);
    }
    let fitted = c.prepare_draw_with_style(800, 600, 0.0003, false).unwrap();
    assert_eq!(fitted.len(), fitting);
    assert_eq!(
        fitted
            .iter()
            .map(|s| s.curve.as_ref().unwrap().samples.len())
            .sum::<usize>(),
        per_snake * fitting
    );
    apply(&mut c, &[appearance(7, 2000, 2)]);
    let before = c.clone();
    assert_eq!(
        c.prepare_draw_with_style(800, 600, 0.0003, false),
        Err(ClientPresentationError::Limit)
    );
    assert_eq!(c, before);
}

#[test]
fn late_sampling_overflow_or_curve_cap_discards_prepared_short_face_and_camera() {
    for quality in [f64::MAX, 1e-8] {
        let mut c = client(1);
        apply(&mut c, &[vec![b'e', 64], appearance(8, 2050, 3)]);
        let before = c.clone();
        assert!(c.prepare_draw_with_style(800, 600, quality, false).is_err());
        assert_eq!(c, before);
    }
}

#[test]
fn malformed_late_frame_rolls_back_remote_gaze_together_with_received_world() {
    let mut c = client(3);
    apply(&mut c, &[appearance(8, 2050, 3)]);
    let before = c.clone();
    let frame = bundle(&[motion(b'E', 8, &[64]), vec![b'r', 0]]);
    assert!(c.apply_frame(&frame, ElapsedHeader::Absent).is_err());
    assert_eq!(c, before);
}

#[test]
fn rejected_eye_step_discards_prior_head_length_speed_and_ring_advancement() {
    let setup = Setup {
        protocol: 19,
        grid_center: 1000.,
        radius: 980.,
        sector_size: 100,
        sector_count: 20,
        max_segments: 430,
        body_spacing: 42.,
        body_contraction: 0.43,
        spangdv: 4.8,
        nsp1: 5.39,
        nsp2: 0.4,
        nsp3: 14.,
        mamu: 0.033,
        mamu2: 0.028,
        server_number: None,
        game_mode: None,
        team: None,
    };
    let appearance = Appearance {
        id: 7,
        skin: 0,
        name: "synthetic".into(),
        custom_skin: vec![],
        cosmetic: 0,
        absolute_head: Point { x: 1000., y: 1000. },
        absolute_body: vec![Point { x: 958., y: 1000. }, Point { x: 916., y: 1000. }],
        anchor_direction: Some(0),
        heading: 0.,
        wanted_heading: 1.,
        speed_per_32ms: 2.,
        fam: 0.5,
        wire_direction: Direction::None,
    };
    let mut snake = SnakePresentation::from_appearance(&appearance, &setup, 1.).unwrap();
    snake
        .set_motion(Some(0.25), Some(1.), Some(Direction::Increasing), None)
        .unwrap();
    let before = snake.clone();
    let step = FrameStep {
        delta: 1.,
        unlagged_delta: 1.,
        whole_steps: 250,
        double_steps: 500,
        lag_multiplier: 1.,
        accumulated: 1.,
        doubled_accumulated: 2.,
    };
    assert!(snake.advance(step).is_err());
    assert_eq!(snake, before);
}
