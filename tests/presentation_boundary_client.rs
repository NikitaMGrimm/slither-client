//! Original synthetic packet and explicit-clock fixtures; no reference or network.

use slither_client::{presentation::AnimatedClient, protocol::ElapsedHeader};

fn u24(value: u32) -> [u8; 3] {
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

fn setup(radius: u32) -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for value in [430_u16, 100, 20] {
        p.extend(value.to_be_bytes());
    }
    p.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(value.to_be_bytes());
    }
    p.extend([19, 42, 0, 1]);
    p.extend(u24(radius));
    p
}

fn target(radius: u32) -> Vec<u8> {
    let mut p = vec![b'z'];
    p.extend(u24(radius));
    p
}

fn appearance() -> Vec<u8> {
    let mut p = vec![b's', 0, 7, 0, 0, 0, b'0', 0, 0, 0, 0, 128, 0, 0, 0, 0];
    p.extend(u24(2000 * 5));
    p.extend(u24(1000 * 5));
    p.extend([0, 0, 255]);
    p.extend(u24(1958 * 5));
    p.extend(u24(1000 * 5));
    p.extend([211, 127, 0, 0]);
    p
}

fn frame(commands: &[Vec<u8>]) -> Vec<u8> {
    commands
        .iter()
        .flat_map(|p| {
            let mut bytes = (p.len() as u16).to_be_bytes().to_vec();
            bytes.extend(p);
            bytes
        })
        .collect()
}

fn apply(client: &mut AnimatedClient, commands: &[Vec<u8>]) {
    client
        .apply_frame(&frame(commands), ElapsedHeader::Absent)
        .unwrap();
}

#[test]
fn setup_and_targets_apply_in_order_without_advancing_clock() {
    let mut c = AnimatedClient::new(0.).unwrap();
    assert!(!c.connected());
    assert!(c.boundary().is_none());
    assert!(c.apply_frame(&target(400), ElapsedHeader::Absent).is_err());
    apply(&mut c, &[setup(1000), target(400)]);
    let ring = c.boundary().unwrap();
    assert!(c.connected());
    assert_eq!(ring.displayed(), 1000.);
    assert_eq!(ring.target(), 400.);
    assert_eq!(ring.index(), 0);
    assert_eq!(ring.pending(), 56);
    assert_eq!(ring.samples()[0], 1000.);
    assert_eq!(ring.samples()[55], 400.);
    assert_eq!(c.received().setup.as_ref().unwrap().radius, 400.);
    assert_eq!(c.advance(4., false).unwrap().whole_steps, 0);
    assert_eq!(c.boundary().unwrap().index(), 0);
    assert_eq!(c.advance(8., false).unwrap().whole_steps, 1);
    assert_eq!(c.boundary().unwrap().displayed(), 1000.);
    assert_eq!(c.advance(48., false).unwrap().whole_steps, 5);
    let ring = c.boundary().unwrap();
    assert_eq!((ring.index(), ring.pending()), (6, 50));
    assert!(ring.displayed() > 400. && ring.displayed() < 1000.);
}

#[test]
fn equal_and_overlapping_targets_are_not_coalesced() {
    let mut bundled = AnimatedClient::new(0.).unwrap();
    let mut separate = bundled.clone();
    apply(
        &mut bundled,
        &[setup(1000), target(400), target(400), target(800)],
    );
    for command in [setup(1000), target(400), target(400), target(800)] {
        apply(&mut separate, &[command]);
    }
    assert_eq!(bundled.boundary(), separate.boundary());
    let mut coalesced = AnimatedClient::new(0.).unwrap();
    apply(&mut coalesced, &[setup(1000), target(800)]);
    assert_ne!(
        bundled.boundary().unwrap().samples(),
        coalesced.boundary().unwrap().samples()
    );
    let mut once = AnimatedClient::new(0.).unwrap();
    apply(&mut once, &[setup(1000), target(400)]);
    let samples = *once.boundary().unwrap().samples();
    apply(&mut once, &[target(400)]);
    assert!(once.boundary().unwrap().samples()[28] < samples[28]);
    assert_eq!(once.boundary().unwrap().displayed(), 1000.);
}

#[test]
fn connection_pauses_only_boundary_consumption_and_does_not_accumulate_backlog() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(1000), appearance(), target(400)]);
    c.advance(8., false).unwrap();
    let mut connected = c.clone();
    let ring = c.boundary().unwrap().clone();
    c.set_connected(false);
    assert_eq!(c.boundary(), Some(&ring));
    for now in [12., 16., 56.] {
        assert_eq!(
            c.advance(now, false).unwrap(),
            connected.advance(now, false).unwrap()
        );
        assert_eq!(c.own_snake(), connected.own_snake());
        assert_eq!(c.boundary(), Some(&ring));
    }
    c.set_connected(true);
    assert_eq!(c.boundary(), Some(&ring));
    assert_eq!(c.advance(60., false).unwrap().whole_steps, 0);
    assert_eq!(c.advance(64., false).unwrap().whole_steps, 1);
    assert_eq!(c.boundary().unwrap().index(), 2);
    assert_eq!(c.boundary().unwrap().displayed(), ring.samples()[1]);
    c.set_connected(false);
    let mut connected = c.clone();
    connected.set_connected(true);
    apply(&mut c, &[vec![b's', 0, 7, 1]]);
    apply(&mut connected, &[vec![b's', 0, 7, 1]]);
    let paused = c.boundary().unwrap().clone();
    let death = c.own_snake().unwrap().metrics().death_progress;
    for now in [72., 112.] {
        c.advance(now, false).unwrap();
        connected.advance(now, false).unwrap();
        assert_eq!(c.own_snake(), connected.own_snake());
        assert_eq!(c.boundary(), Some(&paused));
    }
    assert!(c.own_snake().unwrap().metrics().death_progress > death);
}

#[test]
fn repeated_and_midframe_setup_replace_samples_but_retain_cadence() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(1000), target(400)]);
    c.advance(20., false).unwrap();
    c.set_connected(false);
    apply(
        &mut c,
        &[
            target(800),
            setup(600),
            appearance(),
            target(300),
            setup(700),
        ],
    );
    assert!(c.connected());
    assert!(c.own_snake().is_some());
    let ring = c.boundary().unwrap();
    assert_eq!(
        (
            ring.displayed(),
            ring.target(),
            ring.index(),
            ring.pending()
        ),
        (700., 700., 2, 56)
    );
    assert_eq!(ring.samples(), &[700.; 56]);
    assert_eq!(c.advance(24., false).unwrap().whole_steps, 1);
    assert_eq!(
        (
            c.boundary().unwrap().index(),
            c.boundary().unwrap().pending()
        ),
        (3, 55)
    );
}

#[test]
fn reset_retains_ring_and_setup_preserves_exhaustion_cleanup() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(1000), target(400)]);
    c.advance(8., false).unwrap();
    let ring = c.boundary().unwrap().clone();
    c.reset();
    assert!(!c.connected());
    assert!(c.received().setup.is_none());
    assert_eq!(c.boundary(), Some(&ring));
    c.prepare_draw(960, 540).unwrap();
    c.advance(140., false).unwrap();
    assert_eq!(c.boundary(), Some(&ring));
    apply(&mut c, &[setup(900)]);
    assert_eq!(
        (
            c.boundary().unwrap().index(),
            c.boundary().unwrap().pending()
        ),
        (1, 55)
    );
    assert_eq!(c.boundary().unwrap().samples(), &[900.; 56]);
    for i in 1..=11 {
        c.advance(140. + f64::from(i) * 40., false).unwrap();
    }
    assert_eq!(
        (
            c.boundary().unwrap().index(),
            c.boundary().unwrap().pending()
        ),
        (0, 0)
    );
    apply(&mut c, &[setup(800)]);
    c.advance(584., false).unwrap();
    assert_eq!(c.boundary().unwrap().pending(), 0);
    c.advance(588., false).unwrap();
    assert_eq!(c.boundary().unwrap().pending(), -1);
}

#[test]
fn fractional_reset_preserves_timeline_and_boundary_without_consuming_a_step() {
    let mut c = AnimatedClient::new(1000.).unwrap();
    apply(&mut c, &[setup(1200), appearance(), target(600)]);
    c.set_follows(false);
    c.set_zoom(2.).unwrap();
    let first = c.advance(1003., false).unwrap();
    assert_eq!((first.whole_steps, first.double_steps), (0, 0));
    let ring = c.boundary().unwrap().clone();
    let position = c.camera().position();
    c.reset();
    assert!(!c.connected());
    assert_eq!(c.received(), AnimatedClient::new(0.).unwrap().received());
    assert_eq!(c.retained_count(), 0);
    assert!(c.own_snake().is_none());
    let mut expected = AnimatedClient::new(0.).unwrap();
    expected.set_follows(false);
    expected.set_camera_position(position).unwrap();
    assert_eq!(c.camera(), expected.camera());
    assert_eq!(c.boundary(), Some(&ring));
    apply(&mut c, &[setup(1300), target(700)]);
    assert!(c.connected());
    assert_eq!(c.boundary().unwrap().index(), 0);
    assert_eq!(c.boundary().unwrap().pending(), 56);
    let next = c.advance(1008., false).unwrap();
    assert_eq!(
        (next.delta, next.whole_steps, next.double_steps),
        (0.625, 1, 2)
    );
    assert_eq!((next.accumulated, next.doubled_accumulated), (1., 2.));
    let ring = c.boundary().unwrap();
    assert_eq!(
        (ring.index(), ring.pending(), ring.samples()[0]),
        (1, 55, 700.)
    );
    c.reset();
    c.reset();
    apply(&mut c, &[setup(1400)]);
    let ring = c.boundary().unwrap().clone();
    assert_eq!((ring.index(), ring.pending()), (1, 55));
    assert_eq!(ring.samples(), &[1400.; 56]);
    let same_time = c.advance(1008., false).unwrap();
    assert_eq!((same_time.whole_steps, same_time.double_steps), (0, 0));
    assert_eq!(
        (same_time.accumulated, same_time.doubled_accumulated),
        (1., 2.)
    );
    assert_eq!(c.boundary(), Some(&ring));
}

#[test]
fn reset_restores_lag_and_retains_elapsed_time_after_skew_and_clamping() {
    for (updates, next_ms, elapsed) in [
        (vec![1003.], 1024., 2.625),
        (vec![1003., 999.], 1003., 0.5),
        (vec![1003., 2000.], 3000., 5.),
    ] {
        let mut c = AnimatedClient::new(1000.).unwrap();
        apply(&mut c, &[setup(1200), target(600)]);
        let mut before = None;
        for now in updates {
            before = Some(c.advance(now, true).unwrap());
        }
        let before = before.unwrap();
        assert!(before.lag_multiplier < 1.);
        let ring = c.boundary().unwrap().clone();
        c.reset();
        assert_eq!(c.boundary(), Some(&ring));
        let next = c.advance(next_ms, false).unwrap();
        assert_eq!(next.lag_multiplier, 1.);
        assert_eq!(next.delta, elapsed);
        assert_eq!(next.accumulated, before.accumulated + elapsed);
        assert_eq!(
            next.doubled_accumulated,
            before.doubled_accumulated + elapsed * 2.
        );
        assert_eq!(
            c.boundary(),
            Some(&ring),
            "reset disconnects boundary consumption"
        );
    }
}

#[test]
fn draws_and_failures_preserve_boundary_and_atomic_connection_state() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(1000), appearance(), target(400)]);
    c.advance(12., false).unwrap();
    let ring = c.boundary().unwrap().clone();
    for _ in 0..3 {
        c.prepare_draw(960, 540).unwrap();
    }
    assert_eq!(c.boundary(), Some(&ring));
    c.set_connected(false);
    let before = c.clone();
    let mut bad_setup = setup(700);
    bad_setup[10] = 0; // Received-valid setup, but appearance cannot derive turn speed.
    for commands in [
        vec![target(800), setup(900), vec![b'r', 0]],
        vec![
            target(800),
            setup(900),
            target(500),
            bad_setup,
            appearance(),
        ],
    ] {
        assert!(
            c.apply_frame(&frame(&commands), ElapsedHeader::Absent)
                .is_err()
        );
        assert_eq!(c, before);
    }
    assert!(c.advance(f64::NAN, false).is_err());
    assert!(c.prepare_draw_with_style(960, 540, f64::NAN, true).is_err());
    assert_eq!(c, before);
    c.set_connected(true);
    let mut control = before;
    control.set_connected(true);
    assert_eq!(
        c.advance(16., false).unwrap(),
        control.advance(16., false).unwrap()
    );
    assert_eq!(c, control);
}
