//! Authored synthetic nickname inputs; no original source, assets or runtime oracle.

use presentation::{
    NicknameAlignment, NicknameBaseline, NicknameCullBounds, NicknameInput, NicknameState,
};
use slither_client::{presentation, state};
use state::Point;

fn input() -> NicknameInput<'static> {
    NicknameInput {
        text: "Synthetic pilot",
        color: [170, 210, 240],
        corrected_head: Point { x: 100., y: 200. },
        camera: Point { x: 90., y: 180. },
        viewport_half: Point { x: 400., y: 300. },
        zoom: 0.5,
        scale: 2.,
        spawn_progress: 0.25,
        death_progress: 0.5,
        own: false,
        bounds: NicknameCullBounds {
            left: -500.,
            right: 500.,
            top: -400.,
            bottom: 400.,
        },
    }
}

#[test]
fn projected_position_fixed_font_and_linear_opacity() {
    let mut state = NicknameState::new(0.8).unwrap();
    let draw = state.draw(input()).unwrap().unwrap();
    assert_eq!(draw.text, "Synthetic pilot");
    assert_eq!(draw.color, [170, 210, 240]);
    assert_eq!(draw.position, Point { x: 405., y: 353. });
    assert_eq!(draw.alpha, 0.05);
    assert_eq!(draw.font_size, 15.);
    assert_eq!(
        draw.font_family,
        "Arial, Helvetica Neue, Helvetica, sans-serif"
    );
    assert_eq!(draw.alignment, NicknameAlignment::Center);
    assert_eq!(draw.baseline, NicknameBaseline::Middle);
    assert_eq!(state.opacity(), 0.8);
    assert_eq!(state.own_draw_count(), 0);

    let zoomed = state
        .draw(NicknameInput {
            zoom: 2.,
            ..input()
        })
        .unwrap()
        .unwrap();
    assert_eq!(zoomed.position, Point { x: 420., y: 416. });
    assert_eq!(zoomed.font_size, draw.font_size);
    assert_eq!(zoomed.alpha, draw.alpha);
}

#[test]
fn own_fade_starts_on_201st_eligible_draw_and_reaches_zero() {
    let mut state = NicknameState::new(1.).unwrap();
    let own = NicknameInput {
        own: true,
        spawn_progress: 1.,
        death_progress: 0.,
        ..input()
    };
    for count in 1..=200 {
        assert_eq!(state.draw(own).unwrap().unwrap().alpha, 0.5);
        assert_eq!(state.own_draw_count(), count);
    }
    assert_eq!(state.draw(own).unwrap().unwrap().alpha, 0.498);
    assert_eq!(state.opacity(), 0.996);
    for _ in 202..=449 {
        assert!(state.draw(own).unwrap().unwrap().alpha > 0.);
    }
    // The draw that exhausts opacity still submits; the next draw is omitted.
    assert_eq!(state.draw(own).unwrap().unwrap().alpha, 0.);
    assert_eq!(state.opacity(), 0.);
    assert_eq!(state.own_draw_count(), 450);
    assert_eq!(state.draw(own).unwrap(), None);
    assert_eq!(state.own_draw_count(), 450);
}

#[test]
fn offscreen_draws_pause_both_hold_and_fade() {
    let mut state = NicknameState::new(1.).unwrap();
    let own = NicknameInput {
        own: true,
        ..input()
    };
    let culled = NicknameInput {
        corrected_head: Point { x: 700., y: 200. },
        ..own
    };
    for _ in 0..199 {
        state.draw(own).unwrap();
    }
    let before = state;
    for _ in 0..300 {
        assert_eq!(state.draw(culled).unwrap(), None);
    }
    assert_eq!(state, before);
    state.draw(own).unwrap();
    assert_eq!(state.opacity(), 1.);
    state.draw(own).unwrap();
    assert_eq!(state.opacity(), 0.996);
    let before = state;
    state.draw(culled).unwrap();
    assert_eq!(state, before);
    state.draw(own).unwrap();
    assert_eq!(state.opacity(), 0.992);
}

#[test]
fn name_cull_is_inclusive_with_horizontal_margin_and_shifted_head_y() {
    let bounds = NicknameCullBounds {
        left: -50.,
        right: 50.,
        top: -20.,
        bottom: 80.,
    };
    for (x, y, expected) in [
        (-150., 0., true),
        (150., 0., true),
        (0., -60., true),
        (0., 40., true),
        (-150.01, 0., false),
        (150.01, 0., false),
        (0., -60.01, false),
        (0., 40.01, false),
    ] {
        let mut state = NicknameState::new(1.).unwrap();
        let draw = state
            .draw(NicknameInput {
                corrected_head: Point { x, y },
                bounds,
                own: true,
                ..input()
            })
            .unwrap();
        assert_eq!(draw.is_some(), expected, "head ({x}, {y})");
        assert_eq!(state.own_draw_count(), u32::from(expected));
    }
}

#[test]
fn remote_names_and_new_appearances_have_independent_fade_state() {
    let mut own = NicknameState::new(0.5).unwrap();
    let mut remote = NicknameState::new(0.75).unwrap();
    for _ in 0..400 {
        own.draw(NicknameInput {
            own: true,
            ..input()
        })
        .unwrap();
        assert_eq!(remote.draw(input()).unwrap().unwrap().alpha, 0.046875);
    }
    assert_eq!(own.opacity(), 0.);
    assert_eq!(remote.opacity(), 0.75);
    assert_eq!(remote.own_draw_count(), 0);
    // A replacement, including one reusing the same wire ID, gets a fresh state.
    let replacement = NicknameState::new(1.).unwrap();
    assert_eq!(replacement.opacity(), 1.);
    assert_eq!(replacement.own_draw_count(), 0);
}

#[test]
fn empty_text_and_zero_lifecycle_alpha_still_count_as_draws() {
    let mut state = NicknameState::new(1.).unwrap();
    for (spawn, death) in [(0., 0.), (1., 1.)] {
        let draw = state
            .draw(NicknameInput {
                text: "",
                own: true,
                spawn_progress: spawn,
                death_progress: death,
                ..input()
            })
            .unwrap()
            .unwrap();
        assert_eq!(draw.text, "");
        assert_eq!(draw.alpha, 0.);
    }
    assert_eq!(state.own_draw_count(), 2);
    let mut hidden = NicknameState::new(0.).unwrap();
    assert_eq!(
        hidden
            .draw(NicknameInput {
                own: true,
                ..input()
            })
            .unwrap(),
        None
    );
    assert_eq!(hidden.own_draw_count(), 0);
}

#[test]
fn admitted_latin1_text_is_frozen_unchanged() {
    let text = String::from("Synthetic \u{00c4}\u{00e9}\u{00ff}\u{007f}");
    let mut state = NicknameState::new(1.).unwrap();
    let draw = state
        .draw(NicknameInput {
            text: &text,
            ..input()
        })
        .unwrap()
        .unwrap();
    assert_eq!(draw.text, text);
    drop(text);
    assert_eq!(draw.text, "Synthetic \u{00c4}\u{00e9}\u{00ff}\u{007f}");
}

#[test]
fn invalid_normal_inputs_return_presentation_error_without_ticking() {
    for opacity in [-0.01, 1.01, f64::NAN] {
        assert_eq!(
            NicknameState::new(opacity),
            Err(presentation::PresentationError)
        );
    }
    let mut state = NicknameState::new(1.).unwrap();
    let own = NicknameInput {
        own: true,
        ..input()
    };
    state.draw(own).unwrap();
    for bad in [
        NicknameInput { zoom: 0., ..own },
        NicknameInput { scale: -1., ..own },
        NicknameInput {
            spawn_progress: 1.1,
            ..own
        },
        NicknameInput {
            death_progress: f64::NAN,
            ..own
        },
        NicknameInput {
            camera: Point { x: f64::NAN, y: 0. },
            ..own
        },
        NicknameInput {
            bounds: NicknameCullBounds {
                left: 600.,
                ..own.bounds
            },
            ..own
        },
    ] {
        let before = state;
        assert_eq!(state.draw(bad), Err(presentation::PresentationError));
        assert_eq!(state, before);
    }
}

// Authored protocol-19 packets exercising the actual retained-client seam.
fn setup() -> Vec<u8> {
    let mut packet = vec![b'a', 0, 3, 232];
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

fn appearance(id: u16, name: &[u8], head_x: u32, body: bool) -> Vec<u8> {
    let u24 = |value: u32| value.to_be_bytes()[1..].to_vec();
    let mut packet = vec![b's'];
    packet.extend(id.to_be_bytes());
    packet.extend([0, 0, 0, 48, 0, 0, 0]);
    packet.extend(128_u16.to_be_bytes());
    packet.extend([0, 0, 0, 0]);
    packet.extend(u24(head_x * 5));
    packet.extend(u24(1000 * 5));
    packet.push(name.len() as u8);
    packet.extend(name);
    packet.extend([0, 255]);
    if body {
        packet.extend(u24((head_x - 84) * 5));
        packet.extend(u24(1000 * 5));
        packet.extend([211, 127, 0, 0]);
    }
    packet
}

fn apply(client: &mut presentation::AnimatedClient, packets: &[Vec<u8>]) {
    let bytes: Vec<u8> = packets
        .iter()
        .flat_map(|packet| {
            (packet.len() as u16)
                .to_be_bytes()
                .into_iter()
                .chain(packet.iter().copied())
        })
        .collect();
    client
        .apply_frame(&bytes, slither_client::protocol::ElapsedHeader::Absent)
        .unwrap();
}

#[test]
fn retained_client_draws_names_without_body_geometry_and_preserves_draw_cadence() {
    let mut client = presentation::AnimatedClient::new(0.).unwrap();
    client.enable_nicknames().unwrap();
    apply(
        &mut client,
        &[setup(), appearance(0, b"Synthetic own", 2000, false)],
    );
    client.advance(40., false).unwrap();
    let own = client.own_snake().unwrap().metrics();
    assert!(
        client
            .prepare_draw_with_style(960, 540, 1., false)
            .unwrap()
            .is_empty()
    );
    let name = &client.nickname_draws()[0];
    assert_eq!(name.text, "Synthetic own");
    assert_eq!(name.color, [238, 238, 238]);
    assert_eq!(name.alpha, 0.5 * own.spawn_progress);
    let camera = client.camera();
    assert_eq!(
        name.position.x,
        480. + (own.corrected_head.x - camera.position().x) * camera.zoom()
    );
    assert_eq!(
        name.position.y,
        270. + (own.corrected_head.y - camera.position().y) * camera.zoom()
            + 32.
            + 11. * own.scale * camera.zoom()
    );
    for _ in 1..200 {
        client.prepare_draw(960, 540).unwrap();
    }
    let held_alpha = client.nickname_draws()[0].alpha;
    // Repeated observations and packet-only Setup consume no name draw.
    for _ in 0..3 {
        assert_eq!(client.nickname_draws()[0].alpha, held_alpha);
    }
    apply(&mut client, &[setup()]);
    client.prepare_draw(960, 540).unwrap();
    assert_eq!(
        client.nickname_draws()[0].alpha,
        0.5 * 0.996 * own.spawn_progress
    );
    client.reset();
    assert!(client.nickname_draws().is_empty());
    apply(
        &mut client,
        &[setup(), appearance(0, b"New life", 2000, false)],
    );
    client.advance(80., false).unwrap();
    client.prepare_draw(960, 540).unwrap();
    assert_eq!(
        client.nickname_draws()[0].alpha,
        0.5 * client.own_snake().unwrap().metrics().spawn_progress
    );
}

#[test]
fn retained_own_name_fades_independently_of_reused_wire_id() {
    let mut client = presentation::AnimatedClient::new(0.).unwrap();
    client.enable_nicknames().unwrap();
    apply(
        &mut client,
        &[setup(), appearance(7, b"Original own", 2000, true)],
    );
    client.advance(40., false).unwrap();
    for _ in 0..200 {
        client.prepare_draw(960, 540).unwrap();
    }
    apply(
        &mut client,
        &[
            vec![b's', 0, 7, 1],
            appearance(7, b"Reused remote", 2020, true),
        ],
    );
    client.advance(80., false).unwrap();
    client.prepare_draw(960, 540).unwrap();
    let metrics: Vec<_> = client.drawn_snakes().map(|snake| snake.metrics()).collect();
    let names = client.nickname_draws();
    assert_eq!(
        names
            .iter()
            .map(|name| name.text.as_str())
            .collect::<Vec<_>>(),
        ["Original own", "Reused remote"]
    );
    assert_eq!(
        names[0].alpha,
        0.5 * 0.996 * metrics[0].spawn_progress * (1. - metrics[0].death_progress)
    );
    assert_eq!(names[1].alpha, 0.5 * metrics[1].spawn_progress);
    client.prepare_draw(960, 540).unwrap();
    assert_eq!(
        client.nickname_draws()[1].alpha,
        0.5 * metrics[1].spawn_progress
    );
    for index in 3..=13 {
        client.advance(f64::from(index) * 40., false).unwrap();
    }
    client.prepare_draw(960, 540).unwrap();
    assert_eq!(client.nickname_draws().len(), 1);
    assert_eq!(client.nickname_draws()[0].text, "Reused remote");
    assert_eq!(
        client.nickname_draws()[0].alpha,
        0.5 * client
            .drawn_snakes()
            .next()
            .unwrap()
            .metrics()
            .spawn_progress
    );
}

#[test]
fn enabling_before_ingress_preserves_legacy_geometry_and_reset_selection() {
    let mut legacy = presentation::AnimatedClient::new(0.).unwrap();
    let mut named = legacy.clone();
    named.enable_nicknames().unwrap();
    named.enable_nicknames().unwrap();
    for client in [&mut legacy, &mut named] {
        apply(
            client,
            &[setup(), appearance(0, &[b'S', 0xe9, 0xff], 2000, true)],
        );
        client.advance(40., false).unwrap();
    }
    for _ in 0..3 {
        let before = legacy.prepare_draw_with_style(960, 540, 1., false).unwrap();
        let after = named.prepare_draw_with_style(960, 540, 1., false).unwrap();
        assert_eq!(after, before);
        assert_eq!(named.camera(), legacy.camera());
    }
    assert!(legacy.nickname_draws().is_empty());
    assert_eq!(named.nickname_draws()[0].text, "S\u{00e9}\u{00ff}");
    assert_eq!(
        legacy.enable_nicknames(),
        Err(presentation::ClientPresentationError::NicknameModeRequiresReset)
    );
    legacy.reset();
    legacy.enable_nicknames().unwrap();
}
