//! Original synthetic protocol fixtures; offline, with no captured/reference input.

use slither_client::{
    protocol::ElapsedHeader,
    state::{
        AppliedFrame, ClientState, Direction, FrameReport, MAX_BODY_POINTS, MAX_FOODS, MAX_SNAKES,
        Point, PresentationEvent, SnakeTarget, StateError,
    },
};
use std::f64::consts::TAU;

fn u24(value: u32) -> [u8; 3] {
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

fn setup() -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    p.extend(430_u16.to_be_bytes());
    p.extend(100_u16.to_be_bytes());
    p.extend(20_u16.to_be_bytes());
    p.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(value.to_be_bytes());
    }
    p.extend([19, 10]);
    p
}

fn appearance(id: u16, direction: u8, speed: u16, points: usize) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.extend(u24(123));
    p.push(direction);
    p.extend(u24(456));
    p.extend(speed.to_be_bytes());
    p.extend(u24(789));
    p.push(5);
    p.extend(u24(5000));
    p.extend(u24(5000));
    p.extend([3, b'A', 255, b'Z', 2, 8, 9, 7]);
    if points > 0 {
        p.extend(u24(5000));
        p.extend(u24(5000));
        for _ in 2..points {
            p.extend([129, 127]);
        }
        if points >= 2 {
            p.extend(0_u16.to_be_bytes());
        }
    }
    p
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for p in commands {
        assert!(p.len() < 8192);
        bytes.extend((p.len() as u16).to_be_bytes());
        bytes.extend(p);
    }
    bytes
}

fn apply(state: &mut ClientState, p: &[u8]) -> AppliedFrame {
    state
        .apply_frame_with_events(p, ElapsedHeader::Absent)
        .unwrap()
}

fn playing() -> ClientState {
    let mut state = ClientState::default();
    apply(&mut state, &bundle(&[setup(), appearance(0, b'1', 539, 3)]));
    state
}

#[test]
fn synthetic_every_motion_opcode_and_length_preserves_optional_fields_and_direction() {
    // (opcode, packet length, heading index, wanted index, speed index, direction)
    let cases = [
        (b'e', 2, Some(1), None, None, None),
        (b'e', 3, Some(1), None, Some(2), None),
        (b'e', 4, Some(3), None, None, None),
        (b'e', 5, Some(3), None, Some(4), None),
        (
            b'e',
            6,
            Some(3),
            Some(4),
            Some(5),
            Some(Direction::Decreasing),
        ),
        (b'E', 2, None, Some(1), None, Some(Direction::Decreasing)),
        (b'E', 3, None, Some(1), Some(2), Some(Direction::Decreasing)),
        (b'E', 4, None, Some(3), None, Some(Direction::Decreasing)),
        (b'E', 5, None, Some(3), Some(4), Some(Direction::Decreasing)),
        (
            b'E',
            6,
            Some(3),
            Some(4),
            Some(5),
            Some(Direction::Increasing),
        ),
        (b'3', 2, None, None, Some(1), None),
        (b'3', 3, Some(1), Some(2), None, Some(Direction::Decreasing)),
        (b'3', 4, None, None, Some(3), None),
        (b'3', 5, Some(3), Some(4), None, Some(Direction::Decreasing)),
        (
            b'3',
            6,
            Some(3),
            Some(4),
            Some(5),
            Some(Direction::Increasing),
        ),
        (b'4', 2, None, Some(1), None, Some(Direction::Increasing)),
        (b'4', 3, None, Some(1), Some(2), Some(Direction::Increasing)),
        (b'4', 4, None, Some(3), None, Some(Direction::Increasing)),
        (b'4', 5, None, Some(3), Some(4), Some(Direction::Increasing)),
        (
            b'4',
            6,
            Some(3),
            Some(4),
            Some(5),
            Some(Direction::Increasing),
        ),
        (b'5', 2, None, None, None, None),
        (b'5', 3, Some(1), Some(2), None, Some(Direction::Increasing)),
        (b'5', 4, None, None, None, None),
        (b'5', 5, Some(3), Some(4), None, Some(Direction::Increasing)),
        (
            b'5',
            6,
            Some(3),
            Some(4),
            Some(5),
            Some(Direction::Increasing),
        ),
        (
            b'd',
            4,
            Some(1),
            Some(2),
            Some(3),
            Some(Direction::Decreasing),
        ),
        (
            b'7',
            4,
            Some(1),
            Some(2),
            Some(3),
            Some(Direction::Increasing),
        ),
    ];
    for code in *b"eE345d7" {
        for len in 1..=8 {
            let mut state = playing();
            apply(&mut state, &appearance(17, b'2', 1001, 2));
            let before = state.clone();
            let mut packet = vec![code];
            packet.extend((1..len).map(|index| (index * 37) as u8));
            let own = matches!(code, b'd' | b'7') || len <= 3;
            let id: u16 = if own { 0 } else { 17 };
            if !own && len >= 3 {
                packet[1..3].copy_from_slice(&id.to_be_bytes());
            }
            let result = state.apply_frame_with_events(&packet, ElapsedHeader::Absent);
            let Some(&(_, _, heading, wanted, speed, direction)) =
                cases.iter().find(|&&(c, n, ..)| c == code && n == len)
            else {
                assert_eq!(result, Err(StateError::InvalidPacket(code)), "{packet:?}");
                assert_eq!(state, before);
                continue;
            };
            let heading = heading.map(|index| f64::from(packet[index]) * TAU / 256.);
            let wanted_heading = wanted.map(|index| f64::from(packet[index]) * TAU / 256.);
            let speed_per_32ms = speed.map(|index| f64::from(packet[index]) / 18.);
            assert_eq!(
                result.unwrap(),
                AppliedFrame {
                    report: FrameReport {
                        commands: 1,
                        ignored: 0
                    },
                    events: if heading.is_none()
                        && wanted_heading.is_none()
                        && speed_per_32ms.is_none()
                    {
                        vec![]
                    } else {
                        vec![PresentationEvent::SnakeMotion {
                            target: if own {
                                SnakeTarget::Own
                            } else {
                                SnakeTarget::Id(id)
                            },
                            heading,
                            wanted_heading,
                            direction,
                            speed_per_32ms,
                        }]
                    },
                },
                "{packet:?}"
            );
            let snake = &state.snakes[&id];
            assert_eq!(snake.heading, heading.unwrap_or(before.snakes[&id].heading));
            assert_eq!(
                snake.wanted_heading,
                wanted_heading.unwrap_or(before.snakes[&id].wanted_heading)
            );
            assert_eq!(
                snake.speed,
                speed_per_32ms
                    .map(|speed| speed / 0.032)
                    .unwrap_or(before.snakes[&id].speed)
            );
            assert_eq!(state.snakes[&(17 - id)], before.snakes[&(17 - id)]);
            let mut legacy = before;
            let legacy_report = legacy.apply_frame(&packet, ElapsedHeader::Absent).unwrap();
            assert_eq!(
                legacy_report,
                FrameReport {
                    commands: 1,
                    ignored: 0
                }
            );
            assert_eq!(state, legacy);
        }
    }
}

#[test]
fn synthetic_raw_speed_scalars_keep_wire_arithmetic_exact() {
    let mut state = playing();
    let mut witnessed_lossy_roundtrip = false;
    for speed in [0_u16, 1, 17, 320, 539, 1001, u16::MAX] {
        let applied = apply(&mut state, &appearance(0, b'0', speed, 2));
        let PresentationEvent::SnakeAppearance(appearance) = &applied.events[0] else {
            panic!()
        };
        let expected = f64::from(speed) / 1000.;
        assert_eq!(appearance.speed_per_32ms.to_bits(), expected.to_bits());
        assert_eq!(appearance.wire_direction, Direction::None);
        assert_eq!(appearance.id, 0);
        witnessed_lossy_roundtrip |=
            expected.to_bits() != (state.snakes[&0].speed * 0.032).to_bits();
    }
    for speed in 0..=255_u8 {
        let applied = apply(&mut state, &[b'3', speed]);
        let PresentationEvent::SnakeMotion {
            speed_per_32ms: Some(scalar),
            ..
        } = applied.events[0]
        else {
            panic!()
        };
        let expected = f64::from(speed) / 18.;
        assert_eq!(scalar.to_bits(), expected.to_bits());
        witnessed_lossy_roundtrip |=
            expected.to_bits() != (state.snakes[&0].speed * 0.032).to_bits();
    }
    assert!(
        witnessed_lossy_roundtrip,
        "fixtures must detect reverse conversion"
    );
}

#[test]
fn synthetic_appearance_keeps_absolute_arithmetic_and_effective_initial_heading() {
    for points in [0, 1, 2, 3] {
        let mut state = playing();
        let mut packet = appearance(0, b'2', 539, points);
        if points >= 2 {
            let end = packet.len();
            packet[end - 2..].copy_from_slice(&2_u16.to_be_bytes());
        }
        let applied = apply(&mut state, &packet);
        let PresentationEvent::SnakeAppearance(appearance) = &applied.events[0] else {
            panic!()
        };
        assert_eq!(appearance.id, 0);
        assert_eq!(appearance.skin, 5);
        assert_eq!(appearance.name, "A\u{ff}Z");
        assert_eq!(appearance.custom_skin, [8, 9]);
        assert_eq!(appearance.cosmetic, 7);
        assert_eq!(appearance.absolute_head, Point { x: 1000., y: 1000. });
        assert_eq!(appearance.wanted_heading, 456. * TAU / 16_777_215.);
        assert_eq!(appearance.fam, 789. / 16_777_215.);
        // This is metadata; consumers initialize active turning to None.
        assert_eq!(appearance.wire_direction, Direction::Increasing);
        let expected_heading = if points >= 2 {
            2. * TAU / 65_536.
        } else {
            123. * TAU / 16_777_215.
        };
        assert_eq!(appearance.heading.to_bits(), expected_heading.to_bits());
        assert_eq!(appearance.absolute_body.len(), points);
        assert_eq!(appearance.anchor_direction, (points >= 2).then_some(2));
        // The received API deliberately retains its previous header heading.
        assert_eq!(state.snakes[&0].heading, 123. * TAU / 16_777_215.);
        if points == 2 {
            let angle = 2. * TAU / 65_536.;
            let absolute = Point {
                x: 1000. + angle.cos() * 10.,
                y: 1000. + angle.sin() * 10.,
            };
            assert_eq!(
                appearance.absolute_body,
                [absolute, Point { x: 1000., y: 1000. }]
            );
            let centered_after = appearance.absolute_body[0].x - 1000.;
            assert_eq!(centered_after.to_bits(), 9.999_999_816_164_29_f64.to_bits());
            assert_ne!(
                centered_after.to_bits(),
                state.snakes[&0].body[0].x.to_bits()
            );
        }
        if points == 3 {
            let angle = 2. * TAU / 65_536.;
            assert_eq!(
                appearance.absolute_body,
                [
                    Point {
                        x: 1001. + angle.cos() * 10.,
                        y: 1000. + angle.sin() * 10.
                    },
                    Point { x: 1001., y: 1000. },
                    Point { x: 1000., y: 1000. },
                ]
            );
        }
        let mut legacy = playing();
        legacy.apply_frame(&packet, ElapsedHeader::Absent).unwrap();
        assert_eq!(state, legacy);
    }
}

#[test]
fn synthetic_compact_own_targets_survive_removal_and_setup_resets_them() {
    let motion_packets = [
        vec![b'e', 1],
        vec![b'e', 1, 2],
        vec![b'E', 1],
        vec![b'E', 1, 2],
        vec![b'3', 1],
        vec![b'3', 1, 2],
        vec![b'4', 1],
        vec![b'4', 1, 2],
        vec![b'5', 1, 2],
        vec![b'd', 1, 2, 3],
        vec![b'7', 1, 2, 3],
    ];
    let anchor_packets = [
        vec![b'G'],
        vec![b'G', 0, 2],
        vec![b'N', 0, 0, 1],
        vec![b'N', 0, 2, 0, 0, 1],
        vec![b'=', 0, 2, 3, 232, 3, 233],
        vec![b'+', 0, 2, 3, 232, 3, 233, 0, 0, 1],
    ];
    for flag in [0, 1] {
        let mut state = playing();
        let mut commands = vec![vec![b's', 0, 0, flag]];
        commands.extend(motion_packets.clone());
        commands.extend(anchor_packets.clone());
        commands.extend([
            vec![b'e', 0, 0, 1],
            vec![b'g', 0, 0, 0, 2],
            vec![b'h', 0, 0, 0, 0, 0],
            vec![b'r', 0, 0],
            vec![b's', 0, 0, 1],
            vec![b'5', 1], // Accepted compact no-op, even with retained own identity.
        ]);
        let result = apply(&mut state, &bundle(&commands));
        assert_eq!(
            result.events[0],
            PresentationEvent::SnakeRemoved {
                id: 0,
                died: flag == 1
            }
        );
        assert_eq!(
            result.events.len(),
            2 + motion_packets.len() + anchor_packets.len()
        );
        for event in &result.events[1..=motion_packets.len()] {
            assert!(matches!(
                event,
                PresentationEvent::SnakeMotion {
                    target: SnakeTarget::Own,
                    ..
                }
            ));
        }
        for event in &result.events[1 + motion_packets.len()..result.events.len() - 1] {
            assert!(matches!(
                event,
                PresentationEvent::SnakeAnchor {
                    target: SnakeTarget::Own,
                    ..
                }
            ));
        }
        assert_eq!(
            result.events.last(),
            Some(&PresentationEvent::SnakeRemoved { id: 0, died: true })
        );
        assert!(state.snakes.is_empty());
        assert_eq!(state.own_snake_id, Some(0));
        let result = apply(&mut state, &bundle(&[setup(), vec![b'e', 1], vec![b'G']]));
        assert!(matches!(&result.events[..], [PresentationEvent::Setup(_)]));
        assert_eq!(state.own_snake_id, None);
    }
    // Explicit ID zero and compact own must remain distinguishable while live.
    let mut state = playing();
    let result = apply(
        &mut state,
        &bundle(&[
            vec![b'e', 0, 0, 1],
            vec![b'e', 1],
            vec![b'g', 0, 0, 0, 2],
            vec![b'G', 0, 2],
        ]),
    );
    assert!(matches!(
        result.events[0],
        PresentationEvent::SnakeMotion {
            target: SnakeTarget::Id(0),
            ..
        }
    ));
    assert!(matches!(
        result.events[1],
        PresentationEvent::SnakeMotion {
            target: SnakeTarget::Own,
            ..
        }
    ));
    assert!(matches!(
        result.events[2],
        PresentationEvent::SnakeAnchor {
            target: SnakeTarget::Id(0),
            ..
        }
    ));
    assert!(matches!(
        result.events[3],
        PresentationEvent::SnakeAnchor {
            target: SnakeTarget::Own,
            ..
        }
    ));
}

#[test]
fn synthetic_spawn_direction_and_removal_contracts() {
    for (wire, expected) in [
        (b'0', Direction::None),
        (b'1', Direction::Decreasing),
        (b'2', Direction::Increasing),
    ] {
        let mut state = playing();
        let applied = apply(&mut state, &appearance(17, wire, 123, 0));
        assert!(
            matches!(&applied.events[..], [PresentationEvent::SnakeAppearance(appearance)] if appearance.wire_direction == expected)
        );
    }
    for wire in 0..=255_u8 {
        if matches!(wire, b'0' | b'1' | b'2') {
            continue;
        }
        let mut state = playing();
        let before = state.clone();
        assert_eq!(
            state.apply_frame_with_events(&appearance(0, wire, 123, 2), ElapsedHeader::Absent),
            Err(StateError::InvalidPacket(b's'))
        );
        assert_eq!(state, before);
        let mut expected = before.clone();
        let expected_report = expected
            .apply_frame(&appearance(0, b'0', 123, 2), ElapsedHeader::Absent)
            .unwrap();
        assert_eq!(
            state
                .apply_frame(&appearance(0, wire, 123, 2), ElapsedHeader::Absent)
                .unwrap(),
            expected_report
        );
        assert_eq!(state, expected);
    }
    // Preserve accepted missing flags and all byte values: only one means death.
    for flag in std::iter::once(None).chain((0..=255).map(Some)) {
        let mut state = playing();
        let mut packet = vec![b's', 0, 0];
        packet.extend(flag);
        assert_eq!(
            apply(&mut state, &packet).events,
            [PresentationEvent::SnakeRemoved {
                id: 0,
                died: flag == Some(1)
            }]
        );
        assert_eq!(state.own_snake_id, Some(0));
        assert_eq!(
            apply(&mut state, &packet).events,
            [PresentationEvent::SnakeRemoved {
                id: 0,
                died: flag == Some(1)
            }]
        );
    }
}

#[test]
fn synthetic_unknown_removal_requests_emit_without_changing_received_entities() {
    for id in [0_u16, 7, u16::MAX] {
        for flag in [None, Some(0), Some(1), Some(2), Some(255)] {
            let mut state = ClientState::default();
            apply(&mut state, &setup());
            let before = state.clone();
            let mut packet = vec![b's'];
            packet.extend(id.to_be_bytes());
            packet.extend(flag);
            let applied = apply(&mut state, &packet);
            assert_eq!(
                applied.events,
                [PresentationEvent::SnakeRemoved {
                    id,
                    died: flag == Some(1)
                }]
            );
            assert_eq!(
                applied.report,
                FrameReport {
                    commands: 1,
                    ignored: 0
                }
            );
            assert_eq!(state.snakes, before.snakes);
            assert_eq!(state.own_snake_id, before.own_snake_id);
            assert_eq!(state.frames_applied, before.frames_applied + 1);
            assert_eq!(state.commands_applied, before.commands_applied + 1);
            assert_eq!(state.ignored_commands, before.ignored_commands);
            let mut legacy = before;
            assert_eq!(
                legacy.apply_frame(&packet, ElapsedHeader::Absent).unwrap(),
                applied.report
            );
            assert_eq!(state, legacy);
        }
    }
    let mut unconfigured = ClientState::default();
    assert_eq!(
        unconfigured.apply_frame_with_events(&[b's', 0, 7], ElapsedHeader::Absent),
        Err(StateError::MissingSetup)
    );
    assert_eq!(unconfigured, ClientState::default());
}

#[test]
fn synthetic_repeated_removals_after_duplicate_appearances_each_emit_one_request() {
    let mut state = playing();
    let mut legacy = state.clone();
    for packet in [appearance(7, b'1', 539, 2), appearance(7, b'2', 1001, 3)] {
        let applied = apply(&mut state, &packet);
        assert!(
            matches!(&applied.events[..], [PresentationEvent::SnakeAppearance(appearance)] if appearance.id == 7)
        );
        assert_eq!(
            legacy.apply_frame(&packet, ElapsedHeader::Absent).unwrap(),
            applied.report
        );
        assert_eq!(state, legacy);
    }
    let mut removal_event_counts = Vec::new();
    for _ in 0..2 {
        let packet = [b's', 0, 7, 0];
        let applied = apply(&mut state, &packet);
        removal_event_counts.push(applied.events.len());
        assert_eq!(
            applied.events,
            [PresentationEvent::SnakeRemoved { id: 7, died: false }]
        );
        assert!(!state.snakes.contains_key(&7));
        assert_eq!(state.own_snake_id, Some(0));
        assert_eq!(
            legacy.apply_frame(&packet, ElapsedHeader::Absent).unwrap(),
            applied.report
        );
        assert_eq!(state, legacy);
    }
    assert_eq!(removal_event_counts, [1, 1]);
}

#[test]
fn synthetic_bundled_removal_requests_preserve_order_and_all_or_nothing_publication() {
    let commands = [
        appearance(7, b'1', 539, 2),
        appearance(7, b'2', 1001, 3),
        vec![b's', 0, 7, 0],
        vec![b's', 0, 7, 0],
        vec![b's', 0, 99, 1],
        vec![b'f', 9, 8, 7, 6, 5],
        vec![b'c', 7, 6, 5, 4],
        vec![b'q'],
    ];
    let mut state = cached_state();
    let before = state.clone();
    let mut legacy = before.clone();
    let bytes = bundle(&commands);
    let applied = apply(&mut state, &bytes);
    assert_eq!(
        applied.report,
        FrameReport {
            commands: commands.len(),
            ignored: 1
        }
    );
    assert_eq!(applied.events.len(), 5);
    assert!(
        matches!(&applied.events[0], PresentationEvent::SnakeAppearance(appearance) if appearance.id == 7 && appearance.wire_direction == Direction::Decreasing)
    );
    assert!(
        matches!(&applied.events[1], PresentationEvent::SnakeAppearance(appearance) if appearance.id == 7 && appearance.wire_direction == Direction::Increasing)
    );
    assert_eq!(
        &applied.events[2..],
        &[
            PresentationEvent::SnakeRemoved { id: 7, died: false },
            PresentationEvent::SnakeRemoved { id: 7, died: false },
            PresentationEvent::SnakeRemoved { id: 99, died: true },
        ]
    );
    assert_eq!(
        legacy.apply_frame(&bytes, ElapsedHeader::Absent).unwrap(),
        applied.report
    );
    assert_eq!(state, legacy);
    let mut split = before.clone();
    let split_events: Vec<_> = commands
        .iter()
        .flat_map(|packet| apply(&mut split, packet).events)
        .collect();
    assert_eq!(split_events, applied.events);
    assert_eq!(split.snakes, state.snakes);
    assert_eq!(split.foods, state.foods);

    for malformed in [
        vec![b's', 0],
        vec![b's', 0, 7, 0, 0],
        vec![b'h', 0, 7],
        vec![b'z', 0, 0, 0],
    ] {
        let mut invalid_commands = commands.to_vec();
        invalid_commands.push(malformed);
        assert_rollback(&mut before.clone(), &bundle(&invalid_commands));
    }
    let mut malformed_framing = bytes;
    malformed_framing.push(0);
    assert_rollback(&mut before.clone(), &malformed_framing);
}

#[test]
fn synthetic_unknown_appearance_direction_preserves_legacy_bundle_rollback() {
    let before = cached_state();
    let frame = bundle(&[
        setup(),
        appearance(1, b'0', 539, 3),
        appearance(17, 255, 123, 2),
        vec![b'r', 0],
    ]);
    let mut legacy = before.clone();
    assert_eq!(
        legacy.apply_frame(&frame, ElapsedHeader::Absent),
        Err(StateError::InvalidPacket(b'r'))
    );
    assert_eq!(legacy, before);
    let mut collecting = before.clone();
    assert_eq!(
        collecting.apply_frame_with_events(&frame, ElapsedHeader::Absent),
        Err(StateError::InvalidPacket(b's'))
    );
    assert_eq!(collecting, before);
}

#[test]
fn synthetic_bundled_changes_retain_order_and_intermediate_geometry() {
    let commands = [
        setup(),
        appearance(0, b'2', 539, 3),
        vec![b'e', 1],
        vec![b'd', 2, 3, 4],
        vec![b'7', 5, 6, 7],
        vec![b'G', 0, 0],
        vec![b'G'],
        vec![b'N', 64, 0, 255, 255, 255],
        vec![b'h', 0, 0, 128, 0, 0],
        vec![b'r', 0, 0],
        vec![b'r', 0, 0, 0, 0, 0],
        vec![b'z', 0, 3, 32],
        vec![b's', 0, 0, 1],
    ];
    let mut state = ClientState::default();
    let result = apply(&mut state, &bundle(&commands));
    assert_eq!(
        result.report,
        FrameReport {
            commands: commands.len(),
            ignored: 0
        }
    );
    assert_eq!(result.events.len(), commands.len());
    let mut initial = ClientState::default();
    let initial_setup = apply(&mut initial, &setup()).events.remove(0);
    let initial_appearance = apply(&mut initial, &appearance(0, b'2', 539, 3))
        .events
        .remove(0);
    assert_eq!(
        &result.events[..2],
        &[initial_setup, initial_appearance.clone()]
    );
    let PresentationEvent::SnakeAppearance(appearance) = initial_appearance else {
        panic!()
    };
    assert_eq!(appearance.absolute_head, Point { x: 1000., y: 1000. });
    assert_eq!(appearance.absolute_body.len(), 3);
    assert!(matches!(
        result.events[2],
        PresentationEvent::SnakeMotion {
            heading: Some(_),
            direction: None,
            ..
        }
    ));
    assert!(matches!(
        result.events[3],
        PresentationEvent::SnakeMotion {
            direction: Some(Direction::Decreasing),
            ..
        }
    ));
    assert!(matches!(
        result.events[4],
        PresentationEvent::SnakeMotion {
            direction: Some(Direction::Increasing),
            ..
        }
    ));
    assert_eq!(
        result.events[5],
        PresentationEvent::SnakeAnchor {
            target: SnakeTarget::Own,
            absolute_position: None,
            direction: Some(0),
            grew: false,
            fam: None
        }
    );
    assert_eq!(
        result.events[6],
        PresentationEvent::SnakeAnchor {
            target: SnakeTarget::Own,
            absolute_position: None,
            direction: None,
            grew: false,
            fam: None
        }
    );
    assert_eq!(
        result.events[7],
        PresentationEvent::SnakeAnchor {
            target: SnakeTarget::Own,
            absolute_position: None,
            direction: Some(16384),
            grew: true,
            fam: Some(1.)
        }
    );
    assert_eq!(
        result.events[8],
        PresentationEvent::SnakeMass {
            id: 0,
            fam: 8_388_608. / 16_777_215.
        }
    );
    assert_eq!(
        result.events[9],
        PresentationEvent::SnakeTailRemoved { id: 0, fam: None }
    );
    assert_eq!(
        result.events[10],
        PresentationEvent::SnakeTailRemoved {
            id: 0,
            fam: Some(0.)
        }
    );
    assert_eq!(result.events[11], PresentationEvent::RadiusTarget(800.));
    assert_eq!(
        result.events[12],
        PresentationEvent::SnakeRemoved { id: 0, died: true }
    );
    assert!(state.snakes.is_empty());
    assert_eq!(state.own_snake_id, Some(0));
    // A sequence split across frames has identical events and world state.
    let mut split = ClientState::default();
    let split_events: Vec<_> = commands
        .iter()
        .flat_map(|p| apply(&mut split, p).events)
        .collect();
    assert_eq!(result.events, split_events);
    assert_eq!(state.snakes, split.snakes);
    assert_eq!(state.setup, split.setup);
}

#[test]
fn synthetic_equal_repeated_changes_are_not_coalesced() {
    let mut state = playing();
    for packet in [
        appearance(0, b'1', 539, 3),
        vec![b'e', 0],
        vec![b'h', 0, 0, 0, 0, 0],
        vec![b'z', 0, 3, 32],
        vec![b'=', 0, 0, 3, 232, 3, 232],
    ] {
        let result = apply(&mut state, &bundle(&[packet.clone(), packet]));
        assert_eq!(result.events.len(), 2);
        assert_eq!(result.events[0], result.events[1]);
    }
}

#[test]
fn synthetic_every_anchor_form_preserves_explicit_and_cached_fields() {
    for code in *b"gnGN=+" {
        let grow = matches!(code, b'n' | b'N' | b'+');
        let absolute = matches!(code, b'=' | b'+');
        let own_forms: &[bool] = match code {
            b'G' | b'N' => &[true],
            b'g' | b'n' => &[false],
            _ => &[false, true],
        };
        for &own in own_forms {
            for explicit in [false, true] {
                if absolute && !explicit {
                    continue;
                }
                let mut state = playing();
                apply(&mut state, &appearance(17, b'1', 539, 3));
                let id: u16 = if own { 0 } else { 17 };
                let mut packet = vec![code];
                if !own {
                    packet.extend(id.to_be_bytes());
                }
                if explicit {
                    packet.extend(0_u16.to_be_bytes());
                }
                if absolute {
                    packet.extend(1040_u16.to_be_bytes());
                    packet.extend(1050_u16.to_be_bytes());
                }
                if grow {
                    packet.extend(u24(123));
                }
                let before_len = state.snakes[&id].body.len();
                assert_eq!(
                    apply(&mut state, &packet).events,
                    [PresentationEvent::SnakeAnchor {
                        target: if own {
                            SnakeTarget::Own
                        } else {
                            SnakeTarget::Id(id)
                        },
                        absolute_position: absolute.then_some(Point { x: 1040., y: 1050. }),
                        direction: explicit.then_some(0),
                        grew: grow,
                        fam: grow.then_some(123. / 16_777_215.),
                    }]
                );
                assert_eq!(state.snakes[&id].body.len(), before_len + usize::from(grow));
            }
        }
    }
}

#[test]
fn synthetic_replacement_and_midframe_setup_are_ordered_reset_markers() {
    let mut state = playing();
    let result = apply(
        &mut state,
        &bundle(&[
            appearance(0, b'2', 123, 1),
            vec![b'e', 12],
            setup(),
            vec![b'e', 34],
            vec![b's', 0, 0],
            appearance(17, b'0', 456, 2),
            vec![b'e', 56],
        ]),
    );
    assert_eq!(result.events.len(), 6);
    assert!(
        matches!(&result.events[0], PresentationEvent::SnakeAppearance(appearance) if appearance.id == 0 && appearance.wire_direction == Direction::Increasing && appearance.absolute_body.len() == 1)
    );
    assert!(matches!(
        result.events[1],
        PresentationEvent::SnakeMotion {
            target: SnakeTarget::Own,
            ..
        }
    ));
    assert!(matches!(result.events[2], PresentationEvent::Setup(_)));
    assert_eq!(
        result.events[3],
        PresentationEvent::SnakeRemoved { id: 0, died: false }
    );
    assert!(
        matches!(&result.events[4], PresentationEvent::SnakeAppearance(appearance) if appearance.id == 17 && appearance.wire_direction == Direction::None)
    );
    assert!(matches!(
        result.events[5],
        PresentationEvent::SnakeMotion {
            target: SnakeTarget::Own,
            ..
        }
    ));
    assert_eq!(state.own_snake_id, Some(17));
    assert!(!state.snakes.contains_key(&0));
    assert_eq!(state.snakes[&17].heading, 56. * TAU / 256.);
    let reset = apply(&mut state, &bundle(&[setup(), setup()]));
    assert_eq!(reset.events.len(), 2);
    assert_eq!(reset.events[0], reset.events[1]);
}

#[test]
fn synthetic_unknown_entity_updates_emit_only_removal_requests_and_do_not_advance() {
    let mut empty = ClientState::default();
    assert!(apply(&mut empty, b"opaque").events.is_empty());
    apply(&mut empty, &setup());
    assert!(
        apply(
            &mut empty,
            &bundle(&[
                vec![b'e', 12],
                vec![b'd', 1, 2, 3],
                vec![b'G', 0, 0],
                vec![b'N', 0, 0, 0],
                vec![b'=', 0, 0, 3, 232, 3, 232]
            ])
        )
        .events
        .is_empty()
    );
    let mut state = playing();
    let before = state.snakes.clone();
    let commands = [
        vec![b'e', 0, 17, 1, 2, 3],
        vec![b'E', 0, 17, 1, 2, 3],
        vec![b'3', 0, 17, 1, 2],
        vec![b'4', 0, 17, 1, 2],
        vec![b'5', 0, 17, 1, 2],
        vec![b'g', 0, 17],
        vec![b'n', 0, 17, 0, 0, 0],
        vec![b'=', 0, 17, 0, 0, 3, 232, 3, 232],
        vec![b'+', 0, 17, 0, 0, 3, 232, 3, 232, 0, 0, 0],
        vec![b'h', 0, 17, 0, 0, 0],
        vec![b'r', 0, 17],
        vec![b's', 0, 17, 1],
        vec![b'q'],
    ];
    let mut bytes = vec![255, 255];
    bytes.extend(bundle(&commands));
    let result = state
        .apply_frame_with_events(&bytes, ElapsedHeader::TwoBytes)
        .unwrap();
    assert_eq!(
        result.events,
        [PresentationEvent::SnakeRemoved { id: 17, died: true }]
    );
    assert_eq!(
        result.report,
        FrameReport {
            commands: commands.len(),
            ignored: 1
        }
    );
    assert_eq!(state.snakes, before);
    assert_eq!(state.last_elapsed_ms, Some(u16::MAX));
}

#[test]
fn synthetic_all_food_families_change_received_state_without_events() {
    let mut state = playing();
    for packet in [
        vec![b'F', 1, 2, 7, 10, 11, 5],
        vec![b'f', 1, 2, 12, 13, 6, 10],
        vec![b'b', 14, 15, 20],
    ] {
        assert!(apply(&mut state, &packet).events.is_empty());
    }
    assert_eq!(state.foods.len(), 3);
    for packet in [
        vec![b'c', 1, 2, 10, 11],
        vec![b'C', 12, 13],
        vec![b'<', 14, 15, 0, 0],
    ] {
        assert!(apply(&mut state, &packet).events.is_empty());
    }
    assert!(state.foods.is_empty());
    assert!(apply(&mut state, &[b'f', 16, 17, 5]).events.is_empty());
    assert_eq!(state.foods.len(), 1);
    assert!(apply(&mut state, &[b'w', 1, 2]).events.is_empty());
    assert!(state.foods.is_empty());
}

fn cached_state() -> ClientState {
    let mut state = playing();
    apply(
        &mut state,
        &bundle(&[vec![b'f', 1, 2, 10, 11, 5], vec![b'c', 3, 4, 12, 13]]),
    );
    state
}

fn assert_rollback(state: &mut ClientState, bytes: &[u8]) {
    let before = state.clone();
    assert!(
        state
            .apply_frame_with_events(bytes, ElapsedHeader::Absent)
            .is_err(),
        "{bytes:?}"
    );
    assert_eq!(
        *state, before,
        "all state, private caches and counters must roll back"
    );
    assert!(state.apply_frame(bytes, ElapsedHeader::Absent).is_err());
    assert_eq!(*state, before);
    let probes = bundle(&[vec![b'f', 20, 21, 5], vec![b'c', 22, 23], vec![b'G']]);
    let mut expected = before.clone();
    let mut actual = state.clone();
    assert_eq!(
        actual.apply_frame_with_events(&probes, ElapsedHeader::Absent),
        expected.apply_frame_with_events(&probes, ElapsedHeader::Absent)
    );
    assert_eq!(actual, expected);
}

#[test]
fn synthetic_all_supported_truncations_and_malformed_tails_are_atomic() {
    let packets = [
        setup(),
        appearance(17, b'2', 539, 3),
        vec![b'g', 0, 0, 0, 0],
        vec![b'n', 0, 0, 0, 0, 0, 0, 0],
        vec![b'G', 0, 0],
        vec![b'N', 0, 0, 0, 0, 0],
        vec![b'=', 0, 0, 0, 0, 3, 232, 3, 232],
        vec![b'+', 0, 0, 0, 0, 3, 232, 3, 232, 0, 0, 0],
        vec![b'e', 0, 0, 1, 2, 3],
        vec![b'E', 0, 0, 1, 2, 3],
        vec![b'3', 0, 0, 1, 2],
        vec![b'4', 0, 0, 1, 2],
        vec![b'5', 0, 0, 1, 2],
        vec![b'd', 1, 2, 3],
        vec![b'7', 1, 2, 3],
        vec![b'h', 0, 0, 1, 2, 3],
        vec![b'r', 0, 0, 1, 2, 3],
        vec![b'F', 1, 2, 3, 4, 5, 6],
        vec![b'f', 1, 2, 3, 4, 5, 6],
        vec![b'b', 1, 2, 3, 4, 5, 6],
        vec![b'c', 1, 2, 3, 4],
        vec![b'C', 1, 2, 3, 4],
        vec![b'<', 1, 2, 3, 4, 0, 0],
        vec![b'w', 1, 2],
        vec![b'z', 0, 3, 32],
    ];
    let staged_prefix = [
        vec![b'q'],
        vec![b'G', 64, 0],
        vec![b'd', 10, 20, 30],
        vec![b'f', 9, 8, 7, 6, 5],
        vec![b'c', 7, 6, 5, 4],
    ];
    for packet in &packets {
        for length in 0..=packet.len() {
            let prefix = packet[..length].to_vec();
            let mut state = cached_state();
            let before = state.clone();
            let mut legacy = before.clone();
            let old_result = legacy.apply_frame(&prefix, ElapsedHeader::Absent);
            let new_result = state.apply_frame_with_events(&prefix, ElapsedHeader::Absent);
            match (old_result, new_result) {
                (Ok(report), Ok(applied)) => {
                    assert_eq!(report, applied.report);
                    assert_eq!(state, legacy);
                }
                (Err(old), Err(new)) => {
                    assert_eq!(old, new);
                    assert_eq!(state, before);
                    let mut commands = staged_prefix.to_vec();
                    commands.push(prefix);
                    assert_rollback(&mut state, &bundle(&commands));
                }
                result => panic!("decoding paths differ: {result:?}"),
            }
        }
        // A structurally incomplete last record must discard all staged events.
        let mut commands = staged_prefix.to_vec();
        commands.push(packet.clone());
        let mut bytes = bundle(&commands);
        bytes.push(0);
        assert_rollback(&mut cached_state(), &bytes);
    }
    for tail in [
        vec![b'z', 0, 0, 0],
        vec![b'r', 0, 0, 0],
        vec![b's', 0, 0, 0, 0],
    ] {
        let mut commands = staged_prefix.to_vec();
        commands.extend([setup(), appearance(1, b'0', 123, 2), tail]);
        assert_rollback(&mut cached_state(), &bundle(&commands));
    }
}

#[test]
fn synthetic_semantic_failures_and_retention_limits_discard_all_events() {
    let mut state = cached_state();
    assert_rollback(&mut state, &bundle(&[setup(), vec![b'f', 1, 2, 3]]));
    assert_rollback(
        &mut state,
        &bundle(&[appearance(17, b'0', 123, 1), vec![b'g', 0, 17]]),
    );
    let mut unsupported = setup();
    unsupported[23] = 18;
    assert_rollback(&mut state, &bundle(&[vec![b'G'], unsupported]));
    let mut invalid = setup();
    invalid[24] = 0;
    assert_rollback(&mut state, &bundle(&[vec![b'G'], invalid]));
    assert_rollback(&mut state, &appearance(1, b'0', 123, MAX_BODY_POINTS + 1));

    state
        .snakes
        .get_mut(&0)
        .unwrap()
        .body
        .resize(MAX_BODY_POINTS, Point::default());
    assert_rollback(
        &mut state,
        &bundle(&[vec![b'd', 1, 2, 3], vec![b'N', 0, 0, 0]]),
    );
    let template = state.snakes[&0].clone();
    for id in 1..16 {
        let mut snake = template.clone();
        snake.id = id;
        state.snakes.insert(id, snake);
    }
    assert_rollback(
        &mut state,
        &bundle(&[vec![b'd', 1, 2, 3], appearance(17, b'0', 123, 1)]),
    );
    state
        .snakes
        .values_mut()
        .for_each(|snake| snake.body.clear());
    for id in 16..MAX_SNAKES as u16 {
        let mut snake = template.clone();
        snake.id = id;
        snake.body.clear();
        state.snakes.insert(id, snake);
    }
    let before = state.clone();
    assert_eq!(
        state.apply_frame_with_events(
            &bundle(&[vec![b'd', 1, 2, 3], appearance(256, b'0', 123, 0)]),
            ElapsedHeader::Absent
        ),
        Err(StateError::Limit)
    );
    assert_eq!(state, before);

    let mut state = cached_state();
    let food = state.foods.values().next().unwrap().clone();
    for key in 0..MAX_FOODS as u32 {
        state.foods.insert(key, food.clone());
    }
    // The cached fixture also has a key outside 0..MAX_FOODS.
    state.foods.remove(&0);
    assert_eq!(state.foods.len(), MAX_FOODS);
    assert_rollback(
        &mut state,
        &bundle(&[vec![b'G'], vec![b'f', 9, 8, 7, 6, 5]]),
    );

    let mut state = cached_state();
    state.snakes.get_mut(&0).unwrap().body[0] = Point {
        x: -16_777_215.,
        y: 0.,
    };
    assert_rollback(
        &mut state,
        &bundle(&[vec![b'd', 1, 2, 3], vec![b'G', 128, 0]]),
    );
}
