//! Original synthetic prey packets; no captured or external reference inputs.

use slither_client::{
    protocol::ElapsedHeader,
    state::{
        AppliedFrame, ClientState, Direction, FrameReport, Point, PresentationEvent,
        PreyMotionInput, PreySpawnInput, StateError,
    },
};

fn setup() -> Vec<u8> {
    let mut p = vec![b'a', 0, 3, 232];
    for value in [430_u16, 100, 20] {
        p.extend(value.to_be_bytes());
    }
    p.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(value.to_be_bytes());
    }
    p.extend([19, 10]);
    p
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for command in commands {
        bytes.extend(u16::try_from(command.len()).unwrap().to_be_bytes());
        bytes.extend(command);
    }
    bytes
}

fn apply(state: &mut ClientState, bytes: &[u8]) -> AppliedFrame {
    state
        .apply_frame_with_events(bytes, ElapsedHeader::Absent)
        .unwrap()
}

fn configured() -> ClientState {
    let mut state = ClientState::default();
    apply(&mut state, &setup());
    state
}

fn spawn() -> Vec<u8> {
    let mut p = vec![0; 20];
    p[0] = b'y';
    p[11] = b'0';
    p
}

fn motion(tail: &[u8]) -> Vec<u8> {
    // ID zero and opposite coordinate endpoints.
    let mut p = vec![b'j', 0, 0, 0, 0, 255, 255];
    p.extend(tail);
    p
}

fn only_spawn(result: AppliedFrame) -> PreySpawnInput {
    assert_eq!(
        result.report,
        FrameReport {
            commands: 1,
            ignored: 0
        }
    );
    let [PresentationEvent::PreySpawn(input)] = result.events.as_slice() else {
        panic!("expected one prey spawn: {result:?}");
    };
    *input
}

fn only_motion(result: AppliedFrame) -> PreyMotionInput {
    assert_eq!(
        result.report,
        FrameReport {
            commands: 1,
            ignored: 0
        }
    );
    let [PresentationEvent::PreyMotion(input)] = result.events.as_slice() else {
        panic!("expected one prey motion: {result:?}");
    };
    *input
}

fn bits(value: Option<f64>) -> Option<u64> {
    value.map(f64::to_bits)
}

#[test]
fn synthetic_spawn_preserves_raw_fields_endpoints_and_positive_zero() {
    for (direction_byte, direction) in [
        (b'0', Direction::None),
        (b'1', Direction::Decreasing),
        (b'2', Direction::Increasing),
    ] {
        for raw_color in [0, 9, 18, 255] {
            for maximum in [false, true] {
                let mut p = spawn();
                p[3] = raw_color;
                p[11] = direction_byte;
                if maximum {
                    p[1..3].fill(255);
                    p[4..11].fill(255);
                    p[12..20].fill(255);
                }
                let mut state = configured();
                let input = only_spawn(apply(&mut state, &p));
                assert_eq!(input.id, if maximum { u16::MAX } else { 0 });
                assert_eq!(input.raw_color, raw_color);
                assert_eq!(input.direction, direction);
                assert_eq!(input.size_byte, if maximum { 255 } else { 0 });
                let (position, size, angle, speed): (f64, f64, u64, f64) = if maximum {
                    (3_355_443., 51., 0x4019_21fb_5444_2d18, 65.535)
                } else {
                    (0., 0., 0, 0.)
                };
                assert_eq!(input.absolute_position.x.to_bits(), position.to_bits());
                assert_eq!(input.absolute_position.y.to_bits(), position.to_bits());
                assert_eq!(input.base_size.to_bits(), size.to_bits());
                assert_eq!(input.heading.to_bits(), angle);
                assert_eq!(input.wanted_heading.to_bits(), angle);
                assert_eq!(input.speed_per_32ms.to_bits(), speed.to_bits());
                assert!(state.snakes.is_empty());
                assert!(state.foods.is_empty());
                assert_eq!(state.own_snake_id, None);
            }
        }
    }
}

#[test]
fn synthetic_spawn_keeps_fractional_division_and_distinct_angle_offsets() {
    let p = [
        b'y', 0x12, 0x34, 18, 0, 0, 1, 0, 0, 7, 7, b'2', 0x65, 0x43, 0x21, 0x12, 0x34, 0x56, 0x12,
        0x34,
    ];
    let input = only_spawn(apply(&mut configured(), &p));
    assert_eq!(input.id, 0x1234);
    assert_eq!(input.raw_color, 18);
    assert_eq!(input.absolute_position.x.to_bits(), 0.2_f64.to_bits());
    assert_eq!(input.absolute_position.y.to_bits(), 1.4_f64.to_bits());
    assert_eq!(input.base_size.to_bits(), 1.4_f64.to_bits());
    assert_eq!(input.heading.to_bits(), 0x3fdc_9870_62dd_e59f);
    assert_eq!(input.wanted_heading.to_bits(), 0x4003_e1fe_a8b0_b1a7);
    assert_eq!(input.speed_per_32ms.to_bits(), 4.660_f64.to_bits());
}

#[test]
fn synthetic_every_motion_form_has_exact_independent_optional_layout() {
    // Each tail is independently authored in wire order, with distinct angles.
    let cases: &[(&[u8], bool, bool, bool, bool)] = &[
        (&[], false, false, false, false),
        (&[0x12, 0x34], false, false, false, true),
        (&[0x12, 0x34, 0x56], false, true, false, false),
        (&[b'1', 0x65, 0x43, 0x21], true, false, true, false),
        (&[0x12, 0x34, 0x56, 0x12, 0x34], false, true, false, true),
        (
            &[b'1', 0x65, 0x43, 0x21, 0x12, 0x34],
            true,
            false,
            true,
            true,
        ),
        (
            &[b'1', 0x12, 0x34, 0x56, 0x65, 0x43, 0x21],
            true,
            true,
            true,
            false,
        ),
        (
            &[b'1', 0x12, 0x34, 0x56, 0x65, 0x43, 0x21, 0x12, 0x34],
            true,
            true,
            true,
            true,
        ),
    ];
    for &(tail, direction, heading, wanted, speed) in cases {
        let input = only_motion(apply(&mut configured(), &motion(tail)));
        assert_eq!(input.id, 0);
        assert_eq!(input.absolute_position, Point { x: 1., y: 196_606. });
        assert_eq!(input.direction, direction.then_some(Direction::Decreasing));
        assert_eq!(
            bits(input.heading),
            heading.then_some(0x3fdc_9870_62dd_e59f)
        );
        assert_eq!(
            bits(input.wanted_heading),
            wanted.then_some(0x4003_e1fe_a8b0_b1a7)
        );
        assert_eq!(
            bits(input.speed_per_32ms),
            speed.then_some(4.660_f64.to_bits())
        );
    }
}

#[test]
fn synthetic_motion_endpoints_and_present_zero_are_not_omissions() {
    for (direction_byte, direction) in [
        (b'0', Direction::None),
        (b'1', Direction::Decreasing),
        (b'2', Direction::Increasing),
    ] {
        for maximum in [false, true] {
            let value = if maximum { 255 } else { 0 };
            let mut p = vec![value; 16];
            p[0] = b'j';
            p[7] = direction_byte;
            let input = only_motion(apply(&mut configured(), &p));
            assert_eq!(input.id, if maximum { u16::MAX } else { 0 });
            let coordinate = if maximum { 196_606. } else { 1. };
            assert_eq!(
                input.absolute_position,
                Point {
                    x: coordinate,
                    y: coordinate
                }
            );
            assert_eq!(input.direction, Some(direction));
            let angle = if maximum { 0x4019_21fb_5444_2d18 } else { 0 };
            assert_eq!(bits(input.heading), Some(angle));
            assert_eq!(bits(input.wanted_heading), Some(angle));
            let speed: f64 = if maximum { 65.535 } else { 0. };
            assert_eq!(bits(input.speed_per_32ms), Some(speed.to_bits()));
        }
    }
    let mut state = configured();
    assert_eq!(
        only_motion(apply(&mut state, &motion(&[]))).speed_per_32ms,
        None
    );
    assert_eq!(
        bits(only_motion(apply(&mut state, &motion(&[0, 0]))).speed_per_32ms),
        Some(0)
    );
    assert_eq!(
        only_motion(apply(&mut state, &motion(&[]))).speed_per_32ms,
        None
    );
}

#[test]
fn synthetic_lifecycle_ids_are_unsigned_and_capture_eater_zero_is_explicit() {
    for id in [0_u16, 1, 0x1234, u16::MAX] {
        for eater_id in [0_u16, 1, 0x9876, u16::MAX] {
            let mut remove = vec![b'y'];
            remove.extend(id.to_be_bytes());
            let mut capture = remove.clone();
            capture.extend(eater_id.to_be_bytes());
            let result = apply(&mut configured(), &bundle(&[remove, capture]));
            assert_eq!(
                result.events,
                [
                    PresentationEvent::PreyRemoved { id },
                    PresentationEvent::PreyEaten { id, eater_id },
                ]
            );
            assert_eq!(
                result.report,
                FrameReport {
                    commands: 2,
                    ignored: 0
                }
            );
        }
    }
}

#[test]
fn synthetic_all_noncanonical_lengths_reject_even_unknown_ids_on_both_apis() {
    for code in *b"jy" {
        for length in 1..=24 {
            if match code {
                b'j' => matches!(length, 7 | 9 | 10 | 11 | 12 | 13 | 14 | 16),
                b'y' => matches!(length, 3 | 5 | 20),
                _ => unreachable!(),
            } {
                continue;
            }
            let mut p = vec![0; length];
            p[0] = code;
            for with_events in [false, true] {
                let mut state = configured();
                let before = state.clone();
                let result = if with_events {
                    state
                        .apply_frame_with_events(&p, ElapsedHeader::Absent)
                        .map(|result| result.report)
                } else {
                    state.apply_frame(&p, ElapsedHeader::Absent)
                };
                assert_eq!(
                    result,
                    Err(StateError::InvalidPacket(code)),
                    "{code} L{length}"
                );
                assert_eq!(state, before);
            }
        }
    }
}

#[test]
fn synthetic_direction_domain_is_exact_ascii_in_every_direction_form() {
    for code in *b"jy" {
        let lengths: &[usize] = if code == b'y' {
            &[20]
        } else {
            &[11, 13, 14, 16]
        };
        for &length in lengths {
            for direction in 0..=255_u8 {
                let mut p = vec![0; length];
                p[0] = code;
                p[if code == b'y' { 11 } else { 7 }] = direction;
                for with_events in [false, true] {
                    let mut state = configured();
                    let before = state.clone();
                    let result = if with_events {
                        state
                            .apply_frame_with_events(&p, ElapsedHeader::Absent)
                            .map(|result| result.report)
                    } else {
                        state.apply_frame(&p, ElapsedHeader::Absent)
                    };
                    if matches!(direction, b'0'..=b'2') {
                        assert_eq!(
                            result,
                            Ok(FrameReport {
                                commands: 1,
                                ignored: 0
                            })
                        );
                    } else {
                        assert_eq!(result, Err(StateError::InvalidPacket(code)));
                        assert_eq!(state, before);
                    }
                }
            }
        }
    }
}

#[test]
fn synthetic_setup_is_required_for_every_canonical_prey_form() {
    let mut packets = vec![vec![b'y', 0, 0], vec![b'y', 255, 255, 0, 0], spawn()];
    for tail in [
        vec![],
        vec![0; 2],
        vec![0; 3],
        vec![b'0', 0, 0, 0],
        vec![0; 5],
        vec![b'0', 0, 0, 0, 0, 0],
        vec![b'0', 0, 0, 0, 0, 0, 0],
        vec![b'0', 0, 0, 0, 0, 0, 0, 0, 0],
    ] {
        packets.push(motion(&tail));
    }
    for packet in packets {
        for with_events in [false, true] {
            let mut state = ClientState::default();
            let result = if with_events {
                state
                    .apply_frame_with_events(&packet, ElapsedHeader::Absent)
                    .map(|result| result.report)
            } else {
                state.apply_frame(&packet, ElapsedHeader::Absent)
            };
            assert_eq!(result, Err(StateError::MissingSetup));
            assert_eq!(state, ClientState::default());
        }
        let mut state = ClientState::default();
        let result = apply(&mut state, &bundle(&[setup(), packet]));
        assert_eq!(result.events.len(), 2);
        assert_eq!(
            result.report,
            FrameReport {
                commands: 2,
                ignored: 0
            }
        );
    }
}

#[test]
fn synthetic_duplicate_unknown_and_capture_events_keep_wire_order_and_counts() {
    let commands = [
        vec![b'y', 0, 0],
        vec![b'y', 0, 0, 0, 0],
        motion(&[]),
        spawn(),
        spawn(),
        motion(&[]),
        motion(&[]),
        vec![b'y', 0, 0, 255, 255],
        vec![b'y', 0, 0, 0, 0],
        motion(&[]),
        vec![b'y', 0, 0],
        vec![b'y', 0, 0],
        vec![b'y', 0, 0],
        vec![b'q'],
    ];
    let mut state = configured();
    let before = state.clone();
    let result = apply(&mut state, &bundle(&commands));
    let spawn_event = PresentationEvent::PreySpawn(only_spawn(apply(&mut configured(), &spawn())));
    let motion_event =
        PresentationEvent::PreyMotion(only_motion(apply(&mut configured(), &motion(&[]))));
    assert_eq!(
        result.events,
        [
            PresentationEvent::PreyRemoved { id: 0 },
            PresentationEvent::PreyEaten { id: 0, eater_id: 0 },
            motion_event.clone(),
            spawn_event.clone(),
            spawn_event,
            motion_event.clone(),
            motion_event.clone(),
            PresentationEvent::PreyEaten {
                id: 0,
                eater_id: u16::MAX
            },
            PresentationEvent::PreyEaten { id: 0, eater_id: 0 },
            motion_event,
            PresentationEvent::PreyRemoved { id: 0 },
            PresentationEvent::PreyRemoved { id: 0 },
            PresentationEvent::PreyRemoved { id: 0 },
        ]
    );
    assert_eq!(
        result.report,
        FrameReport {
            commands: commands.len(),
            ignored: 1
        }
    );
    assert_eq!(state.frames_applied, before.frames_applied + 1);
    assert_eq!(
        state.commands_applied,
        before.commands_applied + commands.len() as u64
    );
    assert_eq!(state.ignored_commands, before.ignored_commands + 1);
    assert!(state.snakes.is_empty());
    assert!(state.foods.is_empty());
    assert_eq!(state.own_snake_id, None);
    let mut received_only = before;
    assert_eq!(
        received_only
            .apply_frame(&bundle(&commands), ElapsedHeader::Absent)
            .unwrap(),
        result.report
    );
    assert_eq!(received_only, state);
}

#[test]
fn synthetic_elapsed_header_is_explicit_and_does_not_change_decoded_prey() {
    let packet = motion(&[b'2', 0x80, 0, 0, 0, 0, 1, 0, 0]);
    let mut absent = configured();
    let expected = apply(&mut absent, &packet);
    for elapsed in [0_u16, 1, 255, u16::MAX] {
        let mut state = configured();
        let mut timed = elapsed.to_be_bytes().to_vec();
        timed.extend(&packet);
        let actual = state
            .apply_frame_with_events(&timed, ElapsedHeader::TwoBytes)
            .unwrap();
        assert_eq!(actual, expected);
        assert_eq!(state.last_elapsed_ms, Some(elapsed));
        state.last_elapsed_ms = None;
        assert_eq!(state, absent);
    }
    assert_eq!(absent.last_elapsed_ms, None);
    let mut state = configured();
    let before = state.clone();
    assert!(
        state
            .apply_frame_with_events(&packet, ElapsedHeader::TwoBytes)
            .is_err()
    );
    assert_eq!(state, before);
}

#[test]
fn synthetic_interleaved_prey_leaves_all_food_stream_caches_unchanged() {
    let food_commands = [
        vec![b'f', 1, 2, 10, 11, 18, 5],
        vec![b'<', 8, 9, 1, 2, 0x12, 0x34],
        vec![b'b', 12, 13, 10],
        vec![b'C', 3, 4],
        vec![b'F', 6, 7, 255, 1, 2, 0],
        vec![b'f', 3, 4, 14, 15, 20],
        vec![b'<', 5, 6, 0, 0],
        vec![b'C', 7, 8],
        vec![b'w', 6, 7],
    ];
    let prey_commands = [
        spawn(),
        motion(&[]),
        vec![b'y', 0, 0, 255, 255],
        vec![b'y', 0, 0],
    ];
    let mut interleaved = Vec::new();
    for (index, food) in food_commands.iter().enumerate() {
        interleaved.push(prey_commands[index % prey_commands.len()].clone());
        interleaved.push(food.clone());
    }
    let mut control = configured();
    let expected = apply(&mut control, &bundle(&food_commands));
    let mut state = configured();
    let result = apply(&mut state, &bundle(&interleaved));
    let food_events: Vec<_> = result
        .events
        .into_iter()
        .filter(|event| {
            matches!(
                event,
                PresentationEvent::FoodSpawn(_)
                    | PresentationEvent::FoodConsume { .. }
                    | PresentationEvent::FoodSectorClear { .. }
            )
        })
        .collect();
    assert_eq!(food_events, expected.events);
    assert_eq!(result.report.ignored, 0);
    assert_eq!(
        state.commands_applied,
        control.commands_applied + food_commands.len() as u64
    );
    // Full equality also checks all private sector/color/eater caches.
    state.commands_applied = control.commands_applied;
    assert_eq!(state, control);
    let probe = bundle(&[vec![b'b', 21, 22, 25], vec![b'C', 9, 10]]);
    assert_eq!(apply(&mut state, &probe), apply(&mut control, &probe));
    assert_eq!(state, control);
}

#[test]
fn synthetic_malformed_late_bundle_publishes_nothing_and_rolls_back_everything() {
    let mut original = configured();
    apply(
        &mut original,
        &bundle(&[
            vec![b'f', 1, 2, 10, 11, 18, 5],
            vec![b'<', 8, 9, 1, 2, 0, 7],
        ]),
    );
    original.last_elapsed_ms = Some(1234);
    let malformed = [vec![b'y', 0, 0, 0], motion(&[0]), motion(&[b'3', 0, 0, 0])];
    for bad in malformed {
        let code = bad[0];
        let mut changed_setup = setup();
        changed_setup[3] = 1;
        let frame = bundle(&[
            changed_setup,
            spawn(),
            vec![b'f', 5, 6, 1, 2, 255, 0],
            vec![b'<', 3, 4, 1, 2, 0, 0],
            vec![b'q'],
            motion(&[]),
            bad,
        ]);
        for with_events in [false, true] {
            let mut state = original.clone();
            let mut timed = vec![255, 255];
            timed.extend(&frame);
            if with_events {
                let result = state.apply_frame_with_events(&timed, ElapsedHeader::TwoBytes);
                assert_eq!(result, Err(StateError::InvalidPacket(code)));
            } else {
                assert_eq!(
                    state.apply_frame(&timed, ElapsedHeader::TwoBytes),
                    Err(StateError::InvalidPacket(code))
                );
            }
            assert_eq!(state, original);
        }
    }
}
