//! Authored synthetic announcement transaction and command-order witnesses.

use slither_client::{
    presentation::{
        AnimatedClient, AnnouncementLifecycle, ClientControlActions, ClientPresentationError,
        FacePresentation, HudCommandGuard, HudIngressPlan,
    },
    protocol::ElapsedHeader,
};
use std::cell::Cell;

fn setup(n: u16) -> Vec<u8> {
    let mut bytes = vec![b'a', 0, 3, 232];
    for value in [n, 100, 20] {
        bytes.extend(value.to_be_bytes());
    }
    bytes.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        bytes.extend(value.to_be_bytes());
    }
    bytes.extend([19, 42]);
    bytes
}
fn message(name: &str) -> Vec<u8> {
    let mut bytes = vec![b'm', 0, 0, 1, 255, 255, 255, name.len() as u8];
    bytes.extend(name.bytes());
    bytes.extend(b"hello");
    bytes
}
fn apply(
    client: &mut AnimatedClient,
    commands: &[Vec<u8>],
    calls: &Cell<u32>,
) -> Result<(), ClientPresentationError> {
    let mut bytes = Vec::new();
    for command in commands {
        bytes.extend((command.len() as u16).to_be_bytes());
        bytes.extend(command);
    }
    let guards = vec![
        HudCommandGuard {
            playing: false,
            close_requested: false,
            death_pending: false
        };
        commands.len()
    ];
    client
        .apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud(
            &bytes,
            ElapsedHeader::Absent,
            |_| Ok(FacePresentation::default()),
            |_, _| panic!("unexpected food/prey factory"),
            |_, _| panic!("unexpected food/prey factory"),
            |_, _| {
                calls.set(calls.get() + 1);
                Ok(())
            },
            HudIngressPlan {
                schema: 2,
                command_count: commands.len(),
                guards: &guards,
                final_capture_indices: &[],
            },
        )
        .map(|_| ())
}

#[test]
fn receipt_ignores_playing_guard_and_freezes_score_before_later_setup_and_reset() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_score_tracking().unwrap();
    client.enable_announcement_tracking().unwrap();
    let calls = Cell::new(0);
    apply(
        &mut client,
        &[setup(1), message("first"), setup(29)],
        &calls,
    )
    .unwrap();
    let view = client.announcement_view();
    assert_eq!(view.lines[1].text, "By first");
    assert_eq!(view.lines[2].text, "Longest today: 10");
    assert_eq!(view.opacity, 0.);
    assert_eq!(calls.get(), 2);
    client.reset();
    assert_eq!(client.announcement_view(), view);
    apply(
        &mut client,
        &[setup(1), message("next"), message("last")],
        &calls,
    )
    .unwrap();
    assert_eq!(client.announcement_view().lines[1].text, "By last");
}

#[test]
fn malformed_late_input_precedes_callbacks_and_score_or_callback_failure_rolls_back_history() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_score_tracking().unwrap();
    client.enable_announcement_tracking().unwrap();
    let calls = Cell::new(0);
    apply(&mut client, &[setup(1), message("old")], &calls).unwrap();
    let before = client.clone();
    calls.set(0);
    assert!(
        apply(
            &mut client,
            &[setup(17), message("new"), vec![b'm']],
            &calls
        )
        .is_err()
    );
    assert_eq!(calls.get(), 0);
    assert_eq!(client, before);
    let mut outside = message("new");
    outside[1..4].copy_from_slice(&[255; 3]);
    assert!(apply(&mut client, &[message("new"), outside], &calls).is_err());
    assert_eq!(client, before);
    let setup = setup(2);
    let guards = [HudCommandGuard {
        playing: false,
        close_requested: false,
        death_pending: false,
    }];
    let result: Result<_, ClientPresentationError> = client
        .apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud(
            &setup,
            ElapsedHeader::Absent,
            |_| Ok(FacePresentation::default()),
            |_, _| panic!("unexpected food/prey factory"),
            |_, _| panic!("unexpected food/prey factory"),
            |_, _| Err(slither_client::presentation::PresentationError.into()),
            HudIngressPlan {
                schema: 2,
                command_count: 1,
                guards: &guards,
                final_capture_indices: &[],
            },
        );
    assert!(result.is_err());
    assert_eq!(client, before);
}

#[test]
fn lifecycle_uses_the_existing_fixed_frame_step_and_invalid_observation_rolls_it_back() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_score_tracking().unwrap();
    client.enable_announcement_tracking().unwrap();
    apply(&mut client, &[setup(1), message("N")], &Cell::new(0)).unwrap();
    let life = AnnouncementLifecycle {
        death_pending: true,
        return_active: true,
        return_completed: false,
        return_fraction: 0.6,
    };
    client
        .advance_with_control(20., false, |_, _| {
            Ok::<_, ClientPresentationError>(ClientControlActions {
                announcement_lifecycle: Some(life),
                ..ClientControlActions::default()
            })
        })
        .unwrap();
    assert_eq!(client.announcement_view().opacity, 0.6);
    let before = client.clone();
    assert!(
        client
            .advance_with_control(40., false, |_, _| Ok::<_, ClientPresentationError>(
                ClientControlActions {
                    announcement_lifecycle: Some(AnnouncementLifecycle {
                        return_fraction: f64::NAN,
                        ..life
                    }),
                    ..ClientControlActions::default()
                }
            ))
            .is_err()
    );
    assert_eq!(client, before);
}

#[test]
fn unselected_hud_and_received_only_paths_keep_announcements_opaque() {
    let mut client = AnimatedClient::new(0.).unwrap();
    client.enable_score_tracking().unwrap();
    apply(&mut client, &[setup(1), vec![b'm']], &Cell::new(0)).unwrap();
    assert!(!client.announcement_view().present);
    client.apply_frame(b"m", ElapsedHeader::Absent).unwrap();
}
