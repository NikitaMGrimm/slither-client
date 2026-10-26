//! Original synthetic geometry-collection fixtures; no reference inputs or network.

use slither_client::{
    presentation::{
        AnimatedClient, ClientPresentationError, MAX_CURVE_SAMPLES, MAX_DRAW_SAMPLES, PreparedSnake,
    },
    protocol::ElapsedHeader,
    state::Point,
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
    packet.extend(u24(0));
    packet.push(b'0');
    packet.extend(u24(0));
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

fn apply(client: &mut AnimatedClient, packets: &[Vec<u8>]) {
    let mut frame = Vec::new();
    for packet in packets {
        frame.extend((packet.len() as u16).to_be_bytes());
        frame.extend(packet);
    }
    client.apply_frame(&frame, ElapsedHeader::Absent).unwrap();
}

fn client(points: usize) -> AnimatedClient {
    let mut client = AnimatedClient::new(0.).unwrap();
    apply(&mut client, &[setup(), appearance(7, 2000, points)]);
    client
}

// Freeze zoom at its draw target so camera bounds are independently reproducible.
fn fixed_view(client: &mut AnimatedClient, position: Point) {
    let count = client.own_snake().unwrap().metrics().logical_segments as f64;
    let zoom = 0.64285 + 0.514285714 / ((count + 16.) / 36.).max(1.);
    client.set_zoom(zoom).unwrap();
    client.set_follows(false);
    client.set_camera_position(position).unwrap();
}

fn bounds(client: &AnimatedClient, width: u32, height: u32) -> [f64; 4] {
    let p = client.camera().position();
    let hw = f64::from(width) / 2. / client.camera().zoom() + 84.;
    let hh = f64::from(height) / 2. / client.camera().zoom() + 84.;
    [p.x - hw, p.x + hw, p.y - hh, p.y + hh]
}

fn inside(p: Point, [left, right, top, bottom]: [f64; 4]) -> bool {
    p.x >= left && p.x <= right && p.y >= top && p.y <= bottom
}

fn flags(snake: &PreparedSnake) -> Vec<u8> {
    snake
        .body_geometry
        .as_ref()
        .unwrap()
        .samples
        .iter()
        .map(|s| s.flag)
        .collect()
}

#[test]
fn stored_samples_and_actual_unrounded_seed_reach_the_planner_boundary() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut spawn = appearance(7, 2000, 3);
    // Fractional coordinates and a bent body expose both storage boundaries.
    spawn[16..19].copy_from_slice(&u24(10_001));
    spawn[19..22].copy_from_slice(&u24(5_001));
    spawn[28..31].copy_from_slice(&u24(4_901));
    spawn[32] = 137;
    apply(&mut c, &[setup(), spawn]);
    let output = c.prepare_draw_with_style(800, 600, 1.3, false).unwrap();
    let snake = &output[0];
    let curve = snake.curve.as_ref().unwrap();
    let geometry = snake.body_geometry.as_ref().unwrap();
    assert!(curve.redistribution_count() >= 3);
    assert_eq!(geometry.samples.len(), curve.samples.len());
    for (ordinal, (sample, stored)) in geometry.samples.iter().zip(&curve.samples).enumerate() {
        assert_eq!(sample.ordinal, ordinal);
        assert_eq!(sample.x.to_bits(), stored.x.to_bits());
        assert_eq!(sample.y.to_bits(), stored.y.to_bits());
        assert_eq!(sample.tangent.to_bits(), stored.angle.to_bits());
        assert_eq!(sample.flag, 2);
    }
    let n = curve.samples.len();
    let a = curve.vertices()[n - 2].position;
    let b = curve.vertices()[n - 1].position;
    let actual = Point {
        x: b.x - a.x,
        y: b.y - a.y,
    };
    let rounded = Point {
        x: f64::from(curve.samples[n - 1].x) - f64::from(curve.samples[n - 2].x),
        y: f64::from(curve.samples[n - 1].y) - f64::from(curve.samples[n - 2].y),
    };
    assert_ne!(actual, rounded);
    assert_ne!(actual, b);
    assert_eq!(curve.distance_cursor_seed(), Some(actual));
    assert_eq!(
        geometry.distance_cursor_seed.x.to_bits(),
        actual.x.to_bits()
    );
    assert_eq!(
        geometry.distance_cursor_seed.y.to_bits(),
        actual.y.to_bits()
    );
    let borrowed = geometry.as_paint_geometry();
    assert!(borrowed.eligible);
    assert_eq!(borrowed.active_count, n);
    assert_eq!(borrowed.samples, geometry.samples);
    assert_eq!(borrowed.distance_cursor_seed, actual);
    assert_eq!(
        c.own_snake().unwrap().eyes().target_heading(),
        curve.target_eye_heading
    );
}

#[test]
fn exact_inclusive_bounds_admit_all_four_edges() {
    for edge in 0..4 {
        let mut c = AnimatedClient::new(0.).unwrap();
        let mut spawn = appearance(7, 2000, 2);
        spawn[25..28].copy_from_slice(&u24(1958 * 5));
        spawn[19..22].copy_from_slice(&u24(2000 * 5));
        spawn[28..31].copy_from_slice(&u24(2000 * 5));
        apply(&mut c, &[setup(), spawn]);
        fixed_view(&mut c, Point { x: 2000., y: 2000. });
        // The front anchor, unlike the head, also establishes whole-snake visibility.
        let p = c.own_snake().unwrap().body().points()[0].position();
        let hw = 200. / c.camera().zoom() + 84.;
        let hh = 200. / c.camera().zoom() + 84.;
        let camera = match edge {
            0 => Point {
                x: p.x + hw,
                y: p.y,
            },
            1 => Point {
                x: p.x - hw,
                y: p.y,
            },
            2 => Point {
                x: p.x,
                y: p.y + hh,
            },
            _ => Point {
                x: p.x,
                y: p.y - hh,
            },
        };
        c.set_camera_position(camera).unwrap();
        let limits = bounds(&c, 400, 400);
        assert_eq!(limits[edge], if edge < 2 { p.x } else { p.y });
        let output = c.prepare_draw_with_style(400, 400, 1., false).unwrap();
        assert_eq!(output.len(), 1);
        let curve = output[0].curve.as_ref().unwrap();
        let geometry = output[0].body_geometry.as_ref().unwrap();
        let mut on_edge = 0;
        for (vertex, sample) in curve.vertices().iter().zip(&geometry.samples) {
            assert_eq!(
                sample.flag,
                if inside(vertex.position, limits) {
                    2
                } else {
                    0
                }
            );
            let coordinate = if edge < 2 {
                vertex.position.x
            } else {
                vertex.position.y
            };
            if coordinate == limits[edge] {
                assert_eq!(sample.flag, 2);
                on_edge += 1;
            }
        }
        assert!(on_edge > 0);
    }
}

#[test]
fn flags_use_unrounded_post_redistribution_positions_when_f32_crosses_the_bound() {
    let mut original = AnimatedClient::new(0.).unwrap();
    let mut spawn = appearance(7, 2000, 3);
    // Every anchor lies exactly on y=1000.2, whose Float32 value is larger.
    spawn[19..22].copy_from_slice(&u24(5_001));
    spawn[28..31].copy_from_slice(&u24(5_001));
    apply(&mut original, &[setup(), spawn]);
    fixed_view(
        &mut original,
        Point {
            x: 2000.,
            y: 1000.2,
        },
    );
    let y = 1000.2;
    let rounded = f64::from(y as f32);
    assert!(rounded > y);
    let hh = 150. / original.camera().zoom() + 84.;
    let boundary = (y + rounded) / 2.;
    original
        .set_camera_position(Point {
            x: 2000.,
            y: boundary - hh,
        })
        .unwrap();
    let limits = bounds(&original, 400, 300);
    assert!(y < limits[3] && rounded > limits[3]);
    let output = original
        .prepare_draw_with_style(400, 300, 1.3, false)
        .unwrap();
    let curve = output[0].curve.as_ref().unwrap();
    assert!(curve.vertices().iter().any(|v| v.sampled != v.position));
    for (vertex, sample) in curve
        .vertices()
        .iter()
        .zip(&output[0].body_geometry.as_ref().unwrap().samples)
    {
        assert!(inside(vertex.position, limits));
        assert!(!inside(
            Point {
                x: f64::from(sample.x),
                y: f64::from(sample.y)
            },
            limits
        ));
        assert_eq!(sample.flag, 2);
    }

    // Put only the head beyond the right bound: rounded x is inside, actual x outside.
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut spawn = appearance(7, 2000, 3);
    spawn[16..19].copy_from_slice(&u24(10_001));
    apply(&mut c, &[setup(), spawn]);
    fixed_view(&mut c, Point { x: 2000., y: 1000. });
    let x = 2000.2;
    let rounded = f64::from(x as f32);
    assert!(rounded < x);
    let hw = 200. / c.camera().zoom() + 84.;
    c.set_camera_position(Point {
        x: (x + rounded) / 2. - hw,
        y: 1000.,
    })
    .unwrap();
    let limits = bounds(&c, 400, 300);
    assert!(rounded < limits[1] && x > limits[1]);
    let output = c.prepare_draw_with_style(400, 300, 1., false).unwrap();
    let samples = &output[0].body_geometry.as_ref().unwrap().samples;
    assert_eq!(samples[0].ordinal, 0);
    assert_eq!(samples[0].flag, 0);
    assert!(samples.iter().skip(1).any(|s| s.flag == 2));
}

#[test]
fn detailed_flags_follow_original_ordinals_without_compaction() {
    let mut c = client(6);
    let output = c.prepare_draw_with_style(4000, 600, 1., true).unwrap();
    let geometry = output[0].body_geometry.as_ref().unwrap();
    assert!(geometry.samples.len() > 9);
    for (ordinal, sample) in geometry.samples.iter().enumerate() {
        assert_eq!(sample.ordinal, ordinal);
        assert_eq!(sample.flag, if ordinal % 3 == 0 { 2 } else { 1 });
    }
}

#[test]
fn culling_uses_redistributed_vertices_instead_of_the_original_traversal() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut spawn = appearance(7, 2000, 6);
    spawn[31..33].copy_from_slice(&[171, 167]);
    apply(&mut c, &[setup(), spawn]);
    fixed_view(&mut c, Point { x: 2000., y: 1000. });
    let wide = c
        .clone()
        .prepare_draw_with_style(4000, 600, 1., false)
        .unwrap();
    let curve = wide[0].curve.as_ref().unwrap();
    let (ordinal, vertex) = curve
        .vertices()
        .iter()
        .enumerate()
        .find(|(_, v)| (v.sampled.x - v.position.x).abs() > 0.01)
        .unwrap();
    let boundary = (vertex.sampled.x + vertex.position.x) / 2.;
    let hw = 200. / c.camera().zoom() + 84.;
    c.set_camera_position(Point {
        x: boundary - hw,
        y: 1000.,
    })
    .unwrap();
    let limits = bounds(&c, 400, 600);
    assert_ne!(
        inside(vertex.sampled, limits),
        inside(vertex.position, limits)
    );
    let output = c.prepare_draw_with_style(400, 600, 1., false).unwrap();
    assert_eq!(output[0].curve.as_ref().unwrap(), curve);
    assert_eq!(
        flags(&output[0])[ordinal],
        if inside(vertex.position, limits) {
            2
        } else {
            0
        }
    );
}

#[test]
fn whole_snake_anchor_culling_suppresses_collection_even_with_an_onscreen_head() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut spawn = appearance(7, 2000, 2);
    spawn[25..28].copy_from_slice(&u24(2500 * 5));
    apply(&mut c, &[setup(), spawn, appearance(8, 2100, 2)]);
    fixed_view(&mut c, Point { x: 2000., y: 1000. });
    let limits = bounds(&c, 1, 600);
    assert!(inside(
        c.own_snake().unwrap().metrics().corrected_head,
        limits
    ));
    let output = c.prepare_draw_with_style(1, 600, 1., false).unwrap();
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].draw_ordinal, 1);
    assert_eq!(flags(&output[0])[0], 0);
    assert!(!c.own_snake().unwrap().metrics().visible);
}

#[test]
fn wide_to_narrow_draw_retains_offscreen_flags_and_overwrites_only_visible_ordinals() {
    let mut c = client(6);
    fixed_view(&mut c, Point { x: 2000., y: 1000. });
    let mut fresh = c.clone();
    let wide = c.prepare_draw_with_style(4000, 600, 1., false).unwrap();
    let prior_count = wide[0].curve.as_ref().unwrap().samples.len();
    let warm = c.prepare_draw_with_style(1, 600, 1., true).unwrap();
    let cold = fresh.prepare_draw_with_style(1, 600, 1., true).unwrap();
    let limits = bounds(&c, 1, 600);
    let curve = warm[0].curve.as_ref().unwrap();
    assert_eq!(cold[0].curve.as_ref().unwrap(), curve);
    let mut retained = 0;
    let mut overwritten = 0;
    for (ordinal, vertex) in curve.vertices().iter().enumerate() {
        let a = warm[0].body_geometry.as_ref().unwrap().samples[ordinal];
        let b = cold[0].body_geometry.as_ref().unwrap().samples[ordinal];
        if inside(vertex.position, limits) {
            assert_eq!(a.flag, if ordinal % 3 == 0 { 2 } else { 1 });
            assert_eq!(a.flag, b.flag);
            overwritten += usize::from(a.flag == 1);
        } else {
            // The ordinary warmup is shorter than detailed sampling: beyond
            // its active prefix even the warmed scratch remains zero.
            assert_eq!(a.flag, if ordinal < prior_count { 2 } else { 0 });
            assert_eq!(b.flag, 0);
            retained += usize::from(a.flag == 2);
        }
    }
    assert!(retained > 0 && overwritten > 0);
}

#[test]
fn cross_snake_history_uses_existing_paint_order_and_owned_snapshots() {
    for reversed in [false, true] {
        let mut c = AnimatedClient::new(0.).unwrap();
        let (first, last) = if reversed { (2100, 2000) } else { (2000, 2100) };
        apply(
            &mut c,
            &[
                setup(),
                appearance(7, first, 2),
                appearance(9, 100_000, 2),
                appearance(8, last, 2),
            ],
        );
        fixed_view(&mut c, Point { x: 2000., y: 1000. });
        let output = c.prepare_draw_with_style(1, 600, 1., false).unwrap();
        assert_eq!(
            output
                .iter()
                .map(|s| (s.draw_ordinal, s.metrics.id))
                .collect::<Vec<_>>(),
            [(0, 7), (2, 8)]
        );
        assert_eq!(flags(&output[0])[0], if reversed { 0 } else { 2 });
        assert_eq!(flags(&output[1])[0], 2);
        let again = c.prepare_draw_with_style(1, 600, 1., false).unwrap();
        assert_eq!(flags(&again[0])[0], 2);
        // A later scratch write must not mutate an earlier owned snapshot.
        assert_eq!(flags(&output[0])[0], if reversed { 0 } else { 2 });
    }
}

#[test]
fn setup_and_reset_preserve_flags_while_new_clients_start_zero() {
    for reset in [false, true] {
        let mut warm = client(3);
        warm.prepare_draw_with_style(800, 600, 1., false).unwrap();
        warm.advance(17., false).unwrap();
        if reset {
            let before = warm.clone();
            assert!(warm.reset(f64::NAN).is_err());
            assert_eq!(warm, before);
            warm.reset(100.).unwrap();
            assert!(warm.own_snake().is_none());
            assert_eq!(warm.advance(100., false).unwrap().accumulated, 0.);
        }
        apply(&mut warm, &[setup(), appearance(8, 2100, 2)]);
        if !reset {
            assert_eq!(warm.advance(17., false).unwrap().accumulated, 17. / 8.);
        }
        let mut cold = AnimatedClient::new(0.).unwrap();
        apply(&mut cold, &[setup(), appearance(8, 2100, 2)]);
        for c in [&mut warm, &mut cold] {
            fixed_view(c, Point { x: 2000., y: 1000. });
        }
        let warm = warm.prepare_draw_with_style(1, 600, 1., false).unwrap();
        let cold = cold.prepare_draw_with_style(1, 600, 1., false).unwrap();
        assert_eq!(flags(&warm[0])[0], 2);
        assert_eq!(flags(&cold[0])[0], 0);
    }
}

#[test]
fn one_sample_or_one_anchor_omits_geometry_seed_and_flag_writes() {
    for points in [1, 2] {
        let mut c = AnimatedClient::new(0.).unwrap();
        let mut spawn = appearance(7, 2000, points);
        if points == 2 {
            // The decoded front is at the head; tail drain leaves one sample.
            spawn[25..28].copy_from_slice(&u24(1958 * 5));
        }
        apply(&mut c, &[setup(), spawn]);
        if points == 2 {
            apply(&mut c, &[vec![b'r', 0, 7], vec![b'r', 0, 7]]);
            for index in 1..=12 {
                c.advance(f64::from(index) * 40., false).unwrap();
            }
        }
        let output = c.prepare_draw_with_style(800, 600, 1., false).unwrap();
        assert_eq!(output.len(), 1);
        assert!(output[0].body_geometry.is_none());
        if let Some(curve) = &output[0].curve {
            assert_eq!(curve.samples.len(), 1);
            assert_eq!(curve.distance_cursor_seed(), None);
            assert_eq!(curve.samples[0].angle, 0.);
            assert_eq!(curve.target_eye_heading, output[0].metrics.heading);
        } else {
            assert_eq!(points, 1);
        }
        apply(&mut c, &[setup(), appearance(8, 2100, 2)]);
        fixed_view(&mut c, Point { x: 2000., y: 1000. });
        let output = c.prepare_draw_with_style(1, 600, 1., false).unwrap();
        assert_eq!(flags(&output[0])[0], 0);
    }
}

#[test]
fn legacy_draw_and_single_spacing_transition_remain_identical() {
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
    assert_eq!(legacy, c);
    assert_eq!(
        output[0].metrics.point_spacing,
        before.point_spacing + 0.0035
    );
    assert_eq!(
        output[0].curve.as_ref().unwrap().point_spacing,
        output[0].metrics.point_spacing
    );
}

#[test]
fn aggregate_sample_bound_rolls_back_retained_flags_and_every_draw_channel() {
    let mut c = client(2);
    c.prepare_draw_with_style(800, 600, 1., true).unwrap();
    let one = c
        .clone()
        .prepare_draw_with_style(800, 600, 0.0003, false)
        .unwrap();
    let per_snake = one[0].body_geometry.as_ref().unwrap().samples.len();
    assert!(per_snake <= MAX_CURVE_SAMPLES);
    let fitting = MAX_DRAW_SAMPLES / per_snake;
    assert!((2..=32).contains(&fitting));
    for _ in 1..fitting {
        apply(&mut c, &[appearance(7, 2000, 2)]);
    }
    let fitted = c
        .clone()
        .prepare_draw_with_style(800, 600, 0.0003, false)
        .unwrap();
    let total = fitted
        .iter()
        .map(|s| s.body_geometry.as_ref().unwrap().samples.len())
        .sum::<usize>();
    assert_eq!(total, per_snake * fitting);
    assert!(total <= MAX_DRAW_SAMPLES);
    apply(&mut c, &[appearance(7, 2000, 2)]);
    let before = c.clone();
    assert_eq!(
        c.prepare_draw_with_style(800, 600, 0.0003, false),
        Err(ClientPresentationError::Limit)
    );
    assert_eq!(c, before);
    // Probe the retained detailed flag after the failed ordinary writes.
    apply(&mut c, &[setup(), appearance(8, 2200, 6)]);
    fixed_view(&mut c, Point { x: 2000., y: 1000. });
    let output = c.prepare_draw_with_style(1, 600, 1., false).unwrap();
    assert_eq!(flags(&output[0])[1], 1);
}

#[test]
fn late_curve_cap_failure_rolls_back_successful_prior_collection_camera_eyes_and_spacing() {
    let mut c = client(2);
    c.prepare_draw_with_style(800, 600, 1., true).unwrap();
    c.set_zoom(0.5).unwrap();
    let mut grow = vec![b'+'];
    grow.extend(0_u16.to_be_bytes());
    grow.extend(2005_u16.to_be_bytes());
    grow.extend(1005_u16.to_be_bytes());
    grow.extend(u24(0));
    apply(&mut c, &[grow]);
    let before = c.clone();
    let good = c.prepare_draw_with_style(800, 600, 0.001, false).unwrap();
    assert!(good[0].body_geometry.as_ref().unwrap().samples.len() < MAX_CURVE_SAMPLES);
    assert_ne!(c.camera(), before.camera());
    assert_ne!(
        c.own_snake().unwrap().eyes().target_heading(),
        before.own_snake().unwrap().eyes().target_heading()
    );
    assert_eq!(
        c.own_snake().unwrap().metrics().point_spacing,
        before.own_snake().unwrap().metrics().point_spacing + 0.0035
    );
    assert_eq!(flags(&good[0])[1], 2);
    c = before;
    apply(&mut c, &[appearance(8, 6000, 100)]);
    let before = c.clone();
    assert!(c.prepare_draw_with_style(800, 600, 0.001, false).is_err());
    assert_eq!(c, before);
    apply(&mut c, &[setup(), appearance(8, 2200, 6)]);
    fixed_view(&mut c, Point { x: 2000., y: 1000. });
    let output = c.prepare_draw_with_style(1, 600, 1., false).unwrap();
    assert_eq!(flags(&output[0])[1], 1);
}
