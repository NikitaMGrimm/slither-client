//! Original synthetic wire fixtures. No official traffic or reference inputs.

use slither_client::{
    protocol::ElapsedHeader,
    state::{ClientState, MAX_BODY_POINTS, MAX_FOODS, MAX_SNAKES, Point, StateError},
};
use std::f64::consts::TAU;

fn u24(value: u32) -> [u8; 3] {
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

fn setup_with_score_index(score_index: u16) -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    p.extend(score_index.to_be_bytes());
    p.extend(100_u16.to_be_bytes());
    p.extend(20_u16.to_be_bytes());
    p.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(value.to_be_bytes());
    }
    p.extend([19, 10]);
    p.extend(4321_u16.to_be_bytes());
    p.extend(u24(900));
    p
}

fn spawn(id: u16, points: usize) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.extend(u24(0));
    p.push(b'1');
    p.extend(u24(0));
    p.extend(320_u16.to_be_bytes());
    p.extend(u24(0));
    p.push(5);
    p.extend(u24(5000));
    p.extend(u24(5000));
    p.extend([0, 0, 0]); // Empty name/custom skin and cosmetic marker.
    if points > 0 {
        p.extend(u24(5000));
        p.extend(u24(5000));
        if points >= 2 {
            for _ in 0..points - 2 {
                p.extend([129, 127]);
            }
            p.extend([0, 0]); // Final direction: positive x, spacing ten.
        }
    }
    p
}

fn frame(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for command in commands {
        assert!(command.len() < 8192);
        bytes.extend((command.len() as u16).to_be_bytes());
        bytes.extend(command);
    }
    bytes
}

fn apply(state: &mut ClientState, packet: &[u8]) {
    state.apply_frame(packet, ElapsedHeader::Absent).unwrap();
}

fn ready() -> ClientState {
    let mut state = ClientState::default();
    apply(&mut state, &setup_with_score_index(430));
    state
}

fn playing() -> ClientState {
    let mut state = ready();
    apply(&mut state, &spawn(17, 3));
    state
}

#[test]
fn synthetic_setup_values_and_optional_field_boundaries() {
    let full = setup_with_score_index(430);
    for length in 0..25 {
        let mut state = ClientState::default();
        assert!(
            state
                .apply_frame(&full[..length], ElapsedHeader::Absent)
                .is_err()
        );
        assert_eq!(state, ClientState::default());
    }
    for length in [25, 27, 30] {
        let mut state = ClientState::default();
        apply(&mut state, &full[..length]);
        let config = state.setup.unwrap();
        assert_eq!(config.protocol, 19);
        assert_eq!(config.grid_center, 1000.);
        assert_eq!(config.sector_size, 100);
        assert_eq!(config.max_segments, 430);
        assert_eq!(config.body_spacing, 10.);
        assert_eq!(config.body_contraction, 0.43);
        assert_eq!(config.radius, if length == 30 { 900. } else { 980. });
        assert_eq!(
            config.server_number,
            if length >= 27 { Some(4321) } else { None }
        );
    }
    for length in [26, 28, 29] {
        assert!(
            ClientState::default()
                .apply_frame(&full[..length], ElapsedHeader::Absent)
                .is_err()
        );
    }
    let mut team = full.clone();
    team.push(2);
    assert!(
        ClientState::default()
            .apply_frame(&team, ElapsedHeader::Absent)
            .is_err()
    );
    team.push(1);
    let mut state = ClientState::default();
    apply(&mut state, &team);
    assert_eq!(state.setup.unwrap().team, Some(1));
}

#[test]
fn synthetic_invalid_setup_scalars_and_version_preserve_previous_world() {
    let mut state = playing();
    for offsets in [&[1, 2, 3][..], &[4, 5], &[6, 7], &[8, 9], &[24]] {
        let mut packet = setup_with_score_index(430);
        for &offset in offsets {
            packet[offset] = 0;
        }
        let before = state.clone();
        assert!(state.apply_frame(&packet, ElapsedHeader::Absent).is_err());
        assert_eq!(state, before);
    }
    let mut packet = setup_with_score_index(430);
    packet[21..23].copy_from_slice(&1001_u16.to_be_bytes());
    assert!(state.apply_frame(&packet, ElapsedHeader::Absent).is_err());
    packet = setup_with_score_index(430);
    packet[23] = 18;
    assert_eq!(
        state.apply_frame(&packet, ElapsedHeader::Absent),
        Err(StateError::UnsupportedProtocol(18))
    );
}

#[test]
fn synthetic_world_requires_setup_but_unknown_families_are_explicitly_ignored() {
    let mut state = ClientState::default();
    for packet in [
        spawn(1, 2),
        vec![b'F', 1, 2],
        vec![b'g', 0, 1],
        vec![b'w', 1, 2],
    ] {
        assert_eq!(
            state.apply_frame(&packet, ElapsedHeader::Absent),
            Err(StateError::MissingSetup)
        );
        assert_eq!(state, ClientState::default());
    }
    let report = state.apply_frame(b"opaque", ElapsedHeader::Absent).unwrap();
    assert_eq!((report.commands, report.ignored), (1, 1));
    assert_eq!(state.ignored_commands, 1);
    assert!(state.setup.is_none());
}

#[test]
fn synthetic_spawn_anchors_growth_mass_tail_and_removal() {
    let mut state = playing();
    let snake = &state.snakes[&17];
    assert_eq!(snake.id, 17);
    assert_eq!(snake.skin, 5);
    assert_eq!(snake.head, Point { x: 0., y: 0. });
    assert_eq!(
        snake.body,
        [
            Point { x: 11., y: 0. },
            Point { x: 1., y: 0. },
            Point { x: 0., y: 0. }
        ]
    );
    assert_eq!(snake.speed, 10.);
    assert_eq!(state.own_snake_id, Some(17));
    apply(&mut state, &[b'G', 0, 0]);
    assert_eq!(state.snakes[&17].head.x, 21.);
    assert_eq!(state.snakes[&17].body.len(), 3);
    apply(&mut state, &[b'N', 64, 0, 255, 255, 255]);
    assert!((state.snakes[&17].head.y - 10.).abs() < 1e-12);
    assert_eq!(state.snakes[&17].body.len(), 4);
    assert_eq!(state.snakes[&17].fam, 1.);
    apply(&mut state, b"G"); // Reuse previous anchor direction.
    assert!((state.snakes[&17].head.y - 20.).abs() < 1e-12);
    apply(&mut state, &[b'r', 0, 17, 0, 0, 0]);
    assert_eq!(state.snakes[&17].body.len(), 3);
    assert_eq!(state.snakes[&17].fam, 0.);
    apply(&mut state, &[b'h', 0, 17, 255, 255, 255]);
    assert_eq!(state.snakes[&17].fam, 1.);
    apply(&mut state, &[b's', 0, 17, 1]);
    assert!(state.snakes.is_empty());
    apply(&mut state, &spawn(3, 2));
    assert_eq!(state.own_snake_id, Some(17));
    apply(&mut state, &setup_with_score_index(430));
    assert!(state.snakes.contains_key(&3));
    assert_eq!(state.own_snake_id, Some(17));
}

#[test]
fn synthetic_remote_and_absolute_anchors() {
    let mut state = playing();
    apply(&mut state, &spawn(2, 2));
    apply(&mut state, &[b'g', 0, 2, 0, 0]);
    assert_eq!(state.snakes[&2].head.x, 20.);
    apply(&mut state, &[b'n', 0, 2, 0, 0, 0, 0, 1]);
    assert_eq!(state.snakes[&2].head.x, 30.);
    apply(&mut state, &[b'=', 0, 0, 3, 242, 3, 232]); // Own absolute x=1010,y=1000.
    assert_eq!(state.snakes[&17].head, Point { x: 10., y: 0. });
    apply(
        &mut state,
        &[b'+', 0, 2, 0, 0, 3, 252, 3, 232, 255, 255, 255],
    );
    assert_eq!(state.snakes[&2].head.x, 20.);
    assert_eq!(state.snakes[&2].body.len(), 4);
    assert_eq!(state.snakes[&2].fam, 1.);
}

#[test]
fn synthetic_directional_family_covers_local_encoder_forms() {
    let mut state = playing();
    apply(&mut state, &spawn(9, 2));
    for code in *b"d7" {
        apply(&mut state, &[code, 64, 128, 18]);
        assert_eq!(state.snakes[&17].heading, TAU / 4.);
        assert_eq!(state.snakes[&17].wanted_heading, TAU / 2.);
        assert_eq!(state.snakes[&17].speed, 31.25);
    }
    for code in *b"eE" {
        apply(&mut state, &[code, 0, 9, 32, 96, 36]);
        assert_eq!(state.snakes[&9].heading, TAU / 8.);
        assert_eq!(state.snakes[&9].wanted_heading, 3. * TAU / 8.);
        assert_eq!(state.snakes[&9].speed, 62.5);
    }
    for own in [true, false] {
        for (code, values) in [
            (b'e', vec![1]),
            (b'e', vec![2, 3]),
            (b'E', vec![4]),
            (b'4', vec![5]),
            (b'E', vec![6, 7]),
            (b'4', vec![8, 9]),
            (b'3', vec![10, 11]),
            (b'5', vec![12, 13]),
            (b'3', vec![14]),
        ] {
            let mut p = vec![code];
            if !own {
                p.extend([0, 9]);
            }
            p.extend(values);
            apply(&mut state, &p);
        }
    }
}

#[test]
fn synthetic_food_list_add_compact_eat_and_sector_clear() {
    let mut state = ready();
    apply(&mut state, &[b'F', 10, 10, 7, 0, 128, 25]);
    let food = &state.foods[&u32::from_be_bytes([10, 10, 0, 128])];
    assert_eq!(food.position, Point { x: 0., y: 50. });
    assert_eq!((food.size, food.color), (5., 7));
    apply(&mut state, &[b'F', 10, 10, 8, 1, 2, 30]);
    assert_eq!(state.foods.len(), 2); // Split sector listing must preserve earlier chunk.
    apply(&mut state, &[b'f', 10, 11, 3, 4, 9, 35]);
    apply(&mut state, &[b'b', 5, 6, 40]);
    assert_eq!(state.foods[&u32::from_be_bytes([10, 11, 5, 6])].color, 9);
    apply(&mut state, &[b'f', 7, 8, 10, 45]);
    assert_eq!(state.foods.len(), 5);
    assert_eq!(state.foods[&u32::from_be_bytes([10, 11, 7, 8])].color, 10);
    apply(&mut state, &[b'c', 10, 11, 3, 4]);
    apply(&mut state, &[b'C', 5, 6]);
    apply(&mut state, &[b'<', 7, 8, 0, 17]);
    assert_eq!(state.foods.len(), 2);
    apply(&mut state, &[b'w', 10, 10]);
    assert!(state.foods.is_empty());
}

#[test]
fn synthetic_malformed_supported_tail_rolls_back_all_fields_and_caches() {
    let mut state = playing();
    let before = state.clone();
    for malformed in [
        vec![b'r', 0, 17, 0],
        vec![b'F', 1, 2, 0],
        vec![b'G', 0],
        vec![b'd', 1, 2],
    ] {
        let bytes = frame(&[vec![b'G', 0, 0], vec![b'f', 1, 2, 3, 4, 5], malformed]);
        assert!(state.apply_frame(&bytes, ElapsedHeader::Absent).is_err());
        assert_eq!(state, before);
    }
    assert_eq!(
        state.apply_frame(&[b'f', 1, 2, 3], ElapsedHeader::Absent),
        Err(StateError::MissingSector)
    );
    let mut bad_framing = frame(&[vec![b'G', 0, 0]]);
    bad_framing.push(0);
    assert!(
        state
            .apply_frame(&bad_framing, ElapsedHeader::Absent)
            .is_err()
    );
    assert_eq!(state, before);
}

#[test]
fn synthetic_supported_packet_truncations_never_panic_or_partially_apply() {
    let packets = [
        spawn(18, 3),
        vec![b'G', 0, 0],
        vec![b'N', 0, 0, 1, 2, 3],
        vec![b'=', 0, 0, 3, 232, 3, 232],
        vec![b'd', 1, 2, 3],
        vec![b'h', 0, 17, 0, 0, 0],
        vec![b'F', 1, 2, 3, 4, 5, 6],
        vec![b'f', 1, 2, 3, 4, 5, 6],
        vec![b'c', 1, 2, 3, 4],
        vec![b'w', 1, 2],
        vec![b'z', 0, 1, 0],
    ];
    for packet in packets {
        for length in 0..packet.len() {
            let mut state = playing();
            let before = state.clone();
            // Some prefixes are themselves valid short commands (s removal,
            // cached-direction G, F empty listing, and compact food forms).
            if state
                .apply_frame(&packet[..length], ElapsedHeader::Absent)
                .is_err()
            {
                assert_eq!(state, before, "packet {:?}, prefix {length}", packet);
            }
        }
    }
}

#[test]
fn synthetic_exact_supported_lengths_and_missing_direction_are_rejected() {
    let mut state = playing();
    let before = state.clone();
    for packet in [
        vec![b's', 0],
        vec![b's', 0, 1, 0, 0],
        vec![b'g', 0, 17, 0],
        vec![b'n', 0, 17, 0, 0, 0, 0],
        vec![b'G', 0],
        vec![b'N', 0, 0],
        vec![b'=', 0, 0, 0],
        vec![b'+', 0, 0, 0, 0, 0, 0, 0],
        vec![b'd', 0],
        vec![b'7', 0, 0],
        vec![b'h', 0, 17],
        vec![b'r', 0, 17, 0],
        vec![b'F', 1],
        vec![b'F', 1, 2, 0],
        vec![b'f', 1, 2],
        vec![b'b', 1, 2, 3, 4, 5, 6, 7],
        vec![b'c', 1],
        vec![b'C', 1, 2, 3],
        vec![b'<', 1, 2],
        vec![b'w', 1],
        vec![b'z', 0, 1],
    ] {
        assert!(
            state.apply_frame(&packet, ElapsedHeader::Absent).is_err(),
            "{packet:?}"
        );
        assert_eq!(state, before);
    }
    apply(&mut state, &spawn(9, 1));
    let before = state.clone();
    assert_eq!(
        state.apply_frame(&[b'g', 0, 9], ElapsedHeader::Absent),
        Err(StateError::MissingAnchor(9))
    );
    assert_eq!(state, before);
    // A directed absolute report recovers an appearance without a direction.
    apply(&mut state, &[b'=', 0, 9, 0, 0, 3, 232, 3, 232]);
    apply(&mut state, &[b'g', 0, 9]);
    assert_eq!(state.snakes[&9].head.x, 10.);
}

#[test]
fn synthetic_limits_hold_across_frames_and_duplicate_replacement_is_allowed() {
    let mut state = ClientState::default();
    apply(&mut state, &setup_with_score_index(2));
    apply(&mut state, &spawn(1, 3));
    // mscps configures score tables, never the number of retained anchors.
    apply(&mut state, &[b'N', 0, 0, 0, 0, 0]);
    assert_eq!(state.snakes[&1].body.len(), 4);
    apply(&mut state, &spawn(2, 100));
    assert_eq!(state.snakes[&2].body.len(), 100);
    for id in 2..=MAX_SNAKES as u16 {
        apply(&mut state, &spawn(id, 2));
    }
    apply(&mut state, &spawn(1, 2));
    let before = state.clone();
    assert_eq!(
        state.apply_frame(&spawn(257, 2), ElapsedHeader::Absent),
        Err(StateError::Limit)
    );
    assert_eq!(state, before);
}

#[test]
fn synthetic_body_hard_and_global_caps() {
    let mut state = ClientState::default();
    apply(&mut state, &setup_with_score_index(u16::MAX));
    assert_eq!(
        state.apply_frame(&spawn(1, MAX_BODY_POINTS + 1), ElapsedHeader::Absent),
        Err(StateError::Limit)
    );
    for id in 1..=16 {
        apply(&mut state, &spawn(id, MAX_BODY_POINTS));
    }
    let before = state.clone();
    assert_eq!(
        state.apply_frame(&[b'N', 0, 0, 0, 0, 0], ElapsedHeader::Absent),
        Err(StateError::Limit)
    );
    assert_eq!(state, before);
    assert_eq!(
        state.apply_frame(&spawn(17, 1), ElapsedHeader::Absent),
        Err(StateError::Limit)
    );
    assert_eq!(state, before);
}

#[test]
fn synthetic_food_cap_and_replacement() {
    let mut state = ready();
    let mut commands = Vec::new();
    let mut listing = vec![b'F', 1, 1];
    for x in 0..=255_u8 {
        for y in 0..=255_u8 {
            if listing.len() + 4 >= 8192 {
                commands.push(listing);
                listing = vec![b'F', 1, 1];
            }
            listing.extend([0, x, y, 5]);
        }
    }
    commands.push(listing);
    apply(&mut state, &frame(&commands));
    assert_eq!(state.foods.len(), MAX_FOODS);
    apply(&mut state, &[b'f', 1, 1, 0, 0, 10]);
    let before = state.clone();
    assert_eq!(
        state.apply_frame(&[b'f', 2, 2, 0, 0, 10], ElapsedHeader::Absent),
        Err(StateError::Limit)
    );
    assert_eq!(state, before);
}

#[test]
fn synthetic_coordinate_bounds_reject_reconstruction() {
    let mut state = ClientState::default();
    let mut setup = setup_with_score_index(u16::MAX);
    setup[1..4].copy_from_slice(&u24(16_777_215));
    setup[24] = 255;
    apply(&mut state, &setup);
    let mut packet = spawn(1, 2);
    packet[25..31].fill(0);
    packet[31..33].copy_from_slice(&32768_u16.to_be_bytes());
    let before = state.clone();
    assert_eq!(
        state.apply_frame(&packet, ElapsedHeader::Absent),
        Err(StateError::Coordinate)
    );
    assert_eq!(state, before);
}

#[test]
fn synthetic_deterministic_order_headers_counters_and_unknown_updates() {
    let packets = [
        setup_with_score_index(430),
        spawn(17, 3),
        spawn(2, 2),
        vec![b'F', 3, 4, 0, 9, 8, 7],
        vec![b'q'],
        vec![b'g', 255, 255, 0, 0],
    ];
    let mut state = ClientState::default();
    let mut bytes = vec![0, 55];
    bytes.extend(frame(&packets));
    let report = state.apply_frame(&bytes, ElapsedHeader::TwoBytes).unwrap();
    assert_eq!((report.commands, report.ignored), (6, 1));
    assert_eq!(state.snakes.keys().copied().collect::<Vec<_>>(), [2, 17]);
    assert_eq!(state.last_elapsed_ms, Some(55));
    assert_eq!(
        (
            state.frames_applied,
            state.commands_applied,
            state.ignored_commands
        ),
        (1, 6, 1)
    );
    let mut other = ClientState::default();
    other.apply_frame(&bytes, ElapsedHeader::TwoBytes).unwrap();
    assert_eq!(state, other);
    state.frames_applied = u64::MAX;
    state.commands_applied = u64::MAX;
    state.ignored_commands = u64::MAX;
    apply(&mut state, b"q");
    assert_eq!(
        (
            state.frames_applied,
            state.commands_applied,
            state.ignored_commands
        ),
        (u64::MAX, u64::MAX, u64::MAX)
    );
}
