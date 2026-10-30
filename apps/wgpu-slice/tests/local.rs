//! ORIGINAL SYNTHETIC protocol/session integration; no socket, GPU or OS effects.
use slither_client::{presentation::*, session_policy::Phase};
use slither_wgpu_slice::{
    bank::Bank,
    frame::{Draw, Frame},
    game::{EffectKind, LocalGame, loopback_endpoint},
    render,
};
fn u24(n: u32) -> [u8; 3] {
    let b = n.to_be_bytes();
    [b[1], b[2], b[3]]
}
fn bundle(cs: &[Vec<u8>]) -> Vec<u8> {
    cs.iter()
        .flat_map(|p| {
            let mut b = (p.len() as u16).to_be_bytes().to_vec();
            b.extend(p);
            b
        })
        .collect()
}
fn setup() -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for v in [430u16, 100, 20] {
        p.extend(v.to_be_bytes());
    }
    p.push(48);
    for v in [539u16, 40, 1400, 33, 28, 430] {
        p.extend(v.to_be_bytes());
    }
    p.extend([19, 42]);
    p
}
fn snake(skin: u8) -> Vec<u8> {
    let mut p = vec![b's', 0, 7];
    p.extend(u24(0));
    p.push(b'0');
    p.extend(u24(0));
    p.extend(4250u16.to_be_bytes());
    p.extend(u24(0));
    p.push(skin);
    p.extend(u24(5500));
    p.extend(u24(5000));
    p.extend([0, 0, 255]);
    p.extend(u24(4780));
    p.extend(u24(5000));
    for _ in 2..12 {
        p.extend([151, 127]);
    }
    p.extend([0, 0]);
    p
}
fn food() -> Vec<u8> {
    vec![b'F', 41, 4, 76, 3, 232, 20]
}
fn prey() -> Vec<u8> {
    let mut p = vec![b'y', 0, 31, 9];
    p.extend(u24(5500));
    p.extend(u24(5000));
    p.extend([20, b'0']);
    p.extend(u24(0));
    p.extend(u24(0));
    p.extend(1000u16.to_be_bytes());
    p
}
fn board() -> Vec<u8> {
    let mut p = vec![b'l', 1, 0, 2, 0, 9, 0, 12];
    p.extend(u24(0));
    p.extend([41, 3, b'B', b'O', b'T']);
    p
}
fn challenge() -> Vec<u8> {
    // Original grammar-token generator, not a copied challenge.
    let first = format!("\"{}\"", "A".repeat(5));
    let second = format!("\"{}\"", "A".repeat(22));
    let tokens = [
        "var",
        "a",
        "=",
        &first,
        ";",
        "a",
        "+=",
        &second,
        ";",
        "for",
        "(",
        "var",
        "i",
        "=",
        "0",
        ";",
        "i",
        "<",
        "27",
        ";",
        "i",
        "++",
        ")",
        "{",
        "idba",
        "[",
        "i",
        "]",
        "=",
        "a",
        ".",
        "charCodeAt",
        "(",
        "i",
        ")",
        ";",
        "}",
    ];
    let mut p = vec![54];
    let mut key = 23;
    for b in tokens.join(" ").bytes() {
        for n in [b >> 4, b & 15] {
            p.push(b'a' + (n + key) % 26);
            key = (key + 17) % 26;
        }
    }
    p
}
fn effects(g: &mut LocalGame) -> Vec<Vec<u8>> {
    let mut packets = Vec::new();
    for _ in 0..16 {
        let Some(e) = g.effect() else { return packets };
        if let EffectKind::Send(ref b) = e.kind {
            packets.push(b.clone());
        }
        if matches!(&e.kind, EffectKind::Connect(_)) {
            g.construct(e.generation, e.id, 1.).unwrap();
        }
        g.acknowledge(e.generation, e.id, true).unwrap();
    }
    panic!("effect loop")
}
fn pictures(g: &mut LocalGame) {
    for _ in 0..16 {
        let Some(p) = g.take_frame() else { return };
        assert!(!p.resources.is_empty());
        let r = p
            .resources
            .iter()
            .map(|r| (r.asset.into(), r.asset))
            .collect();
        p.frame.quads(&r).unwrap();
        g.presented(true).unwrap();
    }
    assert!(!g.has_frame(), "picture loop");
}
fn pump(g: &mut LocalGame, t: f64) -> Vec<Vec<u8>> {
    g.begin_frame(t, [960, 540], 1.).unwrap();
    let p = effects(g);
    pictures(g);
    p
}
fn negotiating() -> LocalGame {
    let mut g = LocalGame::new(0.).unwrap();
    g.play("ws://127.0.0.1:19491/slither", "Player", 44)
        .unwrap();
    pump(&mut g, 1.);
    let e = g.effect().unwrap();
    assert!(matches!(e.kind, EffectKind::Connect(_)));
    g.construct(e.generation, e.id, 1.).unwrap();
    g.acknowledge(e.generation, e.id, true).unwrap();
    g.opened(g.generation(), 2.).unwrap();
    assert_eq!(g.phase(), Phase::Opening);
    assert_eq!(effects(&mut g), [vec![1], vec![99, 0]]);
    assert_eq!(g.phase(), Phase::Challenge);
    g.receive(g.generation(), &bundle(&[challenge()]), 2.)
        .unwrap();
    let packets = effects(&mut g);
    assert_eq!(packets[0], b"DHLPTXBFJNRVZDHLPTXBFJNRVZD");
    assert_eq!(packets[1][24], 44);
    assert_eq!(&packets[1][26..32], b"Player");
    assert_eq!(&packets[1][32..], [0, 255]);
    assert_eq!(g.phase(), Phase::Setup);
    g
}
fn playing() -> LocalGame {
    let mut g = negotiating();
    g.receive(
        g.generation(),
        &bundle(&[setup(), snake(44), food(), prey(), board()]),
        3.,
    )
    .unwrap();
    pictures(&mut g);
    pump(&mut g, 20.);
    g
}

fn zero_header_preserves_readout(rank: u16, population: u16) {
    let mut g = playing();
    let before = g.hud_view();
    assert_eq!(before.score, "165");
    assert_eq!((&*before.rank, &*before.population), ("2", "9"));
    let mut packet = board();
    packet[2..4].copy_from_slice(&rank.to_be_bytes());
    packet[4..6].copy_from_slice(&population.to_be_bytes());
    g.receive(g.generation(), &bundle(&[packet]), 30.).unwrap();
    pump(&mut g, 40.);
    let after = g.hud_view();
    assert_eq!(
        (&after.score, &after.rank, &after.population),
        (&before.score, &before.rank, &before.population)
    );
    let mut valid = board();
    valid[2..4].copy_from_slice(&3u16.to_be_bytes());
    valid[4..6].copy_from_slice(&12u16.to_be_bytes());
    g.receive(g.generation(), &bundle(&[valid]), 50.).unwrap();
    pump(&mut g, 60.);
    let restored = g.hud_view();
    assert_eq!((&*restored.rank, &*restored.population), ("3", "12"));
}

#[test]
fn zero_rank_packet_preserves_the_complete_retained_readout() {
    zero_header_preserves_readout(0, 9);
}

#[test]
fn zero_population_packet_preserves_the_complete_retained_readout() {
    zero_header_preserves_readout(2, 0);
}
#[test]
fn endpoint_and_play_are_explicit_and_atomic() {
    for bad in [
        "ws://localhost:9000/slither",
        "wss://127.0.0.1:9000/slither",
        "ws://127.0.0.1:0/slither",
        "ws://127.0.0.1:0900/slither",
        "ws://127.0.0.1:9000/",
        "ws://127.0.0.1:9000/slither?q=1",
    ] {
        assert!(loopback_endpoint(bad).is_err());
    }
    let mut g = LocalGame::new(0.).unwrap();
    pump(&mut g, 0.);
    assert!(g.effect().is_none());
    assert!(g.play("ws://127.0.0.1:19491/slither", "Name", 66).is_err());
    assert_eq!(g.phase(), Phase::Ready);
    g.play("ws://127.0.0.1:19491/slither", "Name", 0).unwrap();
    assert!(g.effect().is_none());
    g.begin_frame(1., [960, 540], 1.).unwrap();
    assert!(g.effect().is_none());
    let p = g.take_frame().unwrap();
    g.retry_frame(p).unwrap();
    assert!(g.effect().is_none());
    let _p = g.take_frame().unwrap();
    g.presented(true).unwrap();
    assert!(matches!(g.effect().unwrap().kind, EffectKind::Connect(_)));
}
#[test]
fn synthetic_profile_reaches_existing_challenge_login_without_local_credentials() {
    use slither_wgpu_slice::game::LoginProfile;
    let mut g = LocalGame::new(0.).unwrap();
    let profile = LoginProfile {
        client_version: 4242,
        password: [123; 20],
    };
    g.play_with_profile("ws://192.0.2.1:445/slither", "Synthetic", 9, &profile)
        .unwrap();
    pump(&mut g, 1.);
    let e = g.effect().unwrap();
    assert_eq!(
        e.kind,
        EffectKind::Connect("ws://192.0.2.1:445/slither".into())
    );
    g.construct(e.generation, e.id, 1.).unwrap();
    g.acknowledge(e.generation, e.id, true).unwrap();
    g.opened(g.generation(), 2.).unwrap();
    assert_eq!(effects(&mut g), [vec![1], vec![99, 0]]);
    g.receive(g.generation(), &bundle(&[challenge()]), 3.)
        .unwrap();
    let packets = effects(&mut g);
    assert_eq!(
        packets[1],
        slither_client::protocol::encode_login(4242, &[123; 20], "Synthetic", 9, None).unwrap()
    );
    assert_eq!(g.phase(), Phase::Setup);
    g.stop();
    effects(&mut g);
    g.play("ws://127.0.0.1:19491/slither", "Local", 0).unwrap();
}
#[test]
fn actual_ingress_food_prey_face_score_and_board_reach_plans() {
    let mut g = playing();
    assert_eq!(g.phase(), Phase::Playing);
    assert_eq!(g.client().foods().foods().len(), 1);
    assert_eq!(g.client().preys().preys().len(), 1);
    assert!(g.hud_text().contains("RANK 2 / 9"));
    assert!(g.hud_text().contains("Player"));
    assert!(matches!(
        g.client().score_view().status,
        ScoreStatus::Ready(_)
    ));
    g.begin_frame(40., [960, 540], 1.).unwrap();
    effects(&mut g);
    let p = g.take_frame().unwrap();
    assert!(
        p.frame
            .draws
            .iter()
            .any(|d| d.asset.width == 64 && d.asset.height == 64)
    );
    assert!(p.resources.len() < 200);
    assert!(g.bank.cached_sources() < 200);
    g.presented(true).unwrap();
}

fn minimap_draws(p: &render::PreparedFrame) -> Vec<&Draw> {
    p.frame
        .draws
        .iter()
        .filter(|d| d.asset.handle >> 60 == 5)
        .collect()
}

#[test]
fn minimap_packets_fade_resize_and_keep_issued_pixels() {
    let mut g = playing();
    assert!(g.client().minimap_tracking_enabled());
    g.begin_frame(30., [960, 540], 1.).unwrap();
    effects(&mut g);
    let hidden = g.take_frame().unwrap();
    assert!(minimap_draws(&hidden).is_empty());
    g.presented(true).unwrap();
    g.receive(g.generation(), &bundle(&[vec![b'M', 0, 8, 64]]), 31.)
        .unwrap();
    assert_eq!(g.client().minimap_view().alternate_rgba[63 * 4..], [255; 4]);
    g.begin_frame(40., [960, 540], 1.).unwrap();
    effects(&mut g);
    let first = g.take_frame().unwrap();
    let map = minimap_draws(&first);
    assert_eq!(map[0].translation, [912., 492.]);
    assert_eq!(map[0].effective_alpha, 0.025);
    let retained = first
        .resources
        .iter()
        .find(|r| r.asset == map[0].asset)
        .unwrap()
        .clone();
    g.retry_frame(first).unwrap();
    let retry = g.take_frame().unwrap();
    assert_eq!(minimap_draws(&retry)[0].asset, retained.asset);
    assert_eq!(
        retry
            .resources
            .iter()
            .find(|r| r.asset == retained.asset)
            .unwrap()
            .image
            .pixels,
        retained.image.pixels
    );
    g.presented(true).unwrap();
    let old = g.client().minimap_view().image_revision;
    assert!(
        g.receive(g.generation(), &bundle(&[vec![b'V', 255]]), 41.)
            .is_err()
    );
    assert_eq!(g.client().minimap_view().image_revision, old);
    g.receive(g.generation(), &bundle(&[vec![b'V', 64]]), 42.)
        .unwrap();
    assert_eq!(g.client().minimap_view().alternate_rgba[63 * 4..], [0; 4]);
    g.begin_frame(200., [1920, 1080], 2.).unwrap();
    effects(&mut g);
    let resized = g.take_frame().unwrap();
    assert_eq!(minimap_draws(&resized)[0].translation, [912., 492.]);
    assert_eq!(retained.image.pixels.len(), 32 * 32 * 4);
    g.presented(true).unwrap();
    assert_eq!(g.client().minimap_view().last_marker_ms, 200.);
}

#[test]
fn minimap_uses_session_return_opacity_and_stays_hidden_on_restart_setup() {
    let mut g = playing();
    g.receive(g.generation(), &bundle(&[vec![b'M', 0, 8, 64]]), 30.)
        .unwrap();
    for t in (40..=1040).step_by(16) {
        pump(&mut g, f64::from(t));
        g.receive(g.generation(), &bundle(&[vec![b'p']]), f64::from(t))
            .unwrap();
    }
    assert_eq!(g.client().minimap_view().holder_opacity, 1.);
    g.receive(g.generation(), &bundle(&[vec![b'v', 0]]), 1050.)
        .unwrap();
    for t in (1060..=5000).step_by(16) {
        pump(&mut g, f64::from(t));
        g.receive(g.generation(), &bundle(&[vec![b'p']]), f64::from(t))
            .unwrap();
    }
    assert_eq!(g.client().minimap_view().holder_opacity, 0.);
    g.begin_frame(5020., [960, 540], 1.).unwrap();
    effects(&mut g);
    assert!(minimap_draws(&g.take_frame().unwrap()).is_empty());
    g.presented(true).unwrap();
    g.stop();
    effects(&mut g);
    pump(&mut g, 5040.);
    assert!(g.client().minimap_tracking_enabled());
    assert!(!g.client().minimap_view().has_setup);
}

#[test]
fn largest_minimap_tiles_within_source_budget_and_marker_is_not_clamped() {
    let mut g = negotiating();
    let mut far = snake(44);
    far[16..19].copy_from_slice(&u24(500_000));
    far[19..22].copy_from_slice(&u24(500_000));
    g.receive(g.generation(), &bundle(&[setup(), far]), 3.)
        .unwrap();
    pictures(&mut g);
    g.receive(g.generation(), &bundle(&[vec![b'M', 2, 0, 64]]), 30.)
        .unwrap();
    g.begin_frame(200., [960, 540], 1.).unwrap();
    effects(&mut g);
    let p = g.take_frame().unwrap();
    let maps = minimap_draws(&p);
    assert!(maps.len() >= 4);
    assert!(
        maps.iter()
            .all(|d| d.asset.width <= 512 && d.asset.height <= 512)
    );
    let plan = g.client().minimap_view();
    // A prepared candidate has not committed its marker or fade yet.
    assert_eq!(plan.fade, 0.);
    g.presented(true).unwrap();
    let widget = g
        .client()
        .minimap_render_plan(MinimapLayout::default())
        .unwrap()
        .widget
        .unwrap();
    assert!(widget.marker.top_left.x > widget.side || widget.marker.top_left.y > widget.side);
    assert!(maps.iter().any(|d| d.asset.width == 14));
}

#[test]
fn other_snake_observations_separate_retained_culled_and_submitted_bodies() {
    let mut g = playing();
    let mut near = snake(9);
    near[1..3].copy_from_slice(&0u16.to_be_bytes()); // Zero is a valid other ID.
    near[19..22].copy_from_slice(&u24(5060));
    near[28..31].copy_from_slice(&u24(5060));
    let mut far = snake(9);
    far[1..3].copy_from_slice(&42u16.to_be_bytes());
    far[16..19].copy_from_slice(&u24(10500));
    far[19..22].copy_from_slice(&u24(10000));
    far[25..28].copy_from_slice(&u24(9780));
    far[28..31].copy_from_slice(&u24(10000));
    g.receive(g.generation(), &bundle(&[near, far]), 21.)
        .unwrap();
    assert_eq!(
        g.client()
            .snake_objects()
            .filter(|(_, own, _, _)| !own)
            .count(),
        2
    );
    g.begin_frame(100., [960, 540], 1.).unwrap();
    effects(&mut g);
    let picture = g.take_frame().unwrap();
    let own = picture.frame.snakes.iter().find(|s| s.own).unwrap();
    assert_eq!(own.id, 7);
    let other = picture.frame.snakes.iter().find(|s| !s.own).unwrap();
    assert_eq!(other.id, 0);
    assert!(other.body_commands > 0);
    assert!(other.viewport_body_commands > 0);
    assert!(other.viewport_body_commands <= other.body_commands);
    assert!(!picture.frame.snakes.iter().any(|s| s.id == 42));
    let resident = picture
        .resources
        .iter()
        .map(|r| (r.asset.into(), r.asset))
        .collect();
    assert_eq!(
        picture.frame.quads(&resident).unwrap().len(),
        picture.frame.draws.len()
    );
    g.presented(true).unwrap();
}
#[test]
fn control_ack_barrier_and_exact_keyboard_ping_boost_heading_order() {
    let mut g = playing();
    g.key("ArrowLeft", true);
    g.key("Space", true);
    g.pointer(900., 450., 960., 540., false).unwrap();
    let head = g.client().control_view().own.unwrap().raw_head;
    g.begin_frame(300., [960, 540], 1.).unwrap();
    let e = g.effect().unwrap();
    assert!(matches!(&e.kind,EffectKind::Send(b)if b[0]==252));
    assert!(g.take_frame().is_none());
    assert_eq!(g.client().control_view().own.unwrap().raw_head, head);
    let packets = effects(&mut g);
    assert_eq!(packets[0][0], 252);
    assert_eq!(packets[1], vec![251]);
    assert_eq!(packets[2], vec![253]);
    assert!(packets[3][0] < 251);
    pictures(&mut g);
    g.key("Space", false);
    assert!(pump(&mut g, 360.).contains(&vec![254]));
}
#[test]
fn send_failure_is_terminal_and_suppresses_remaining_control_and_world_commit() {
    let mut g = playing();
    g.key("ArrowRight", true);
    g.key("Space", true);
    let before = g.client().control_view().own.unwrap().raw_head;
    g.begin_frame(300., [960, 540], 1.).unwrap();
    let e = g.effect().unwrap();
    g.acknowledge(e.generation, e.id, false).unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    assert_eq!(g.client().control_view().own.unwrap().raw_head, before);
    assert!(g.take_frame().is_none());
    let e = g.effect().unwrap();
    assert_eq!(e.kind, EffectKind::Close);
    effects(&mut g);
    pump(&mut g, 320.);
    assert!(g.effect().is_none());
    assert!(g.can_play());
}
#[test]
fn malformed_ingress_rolls_back_and_stale_callbacks_never_reconnect() {
    let mut g = playing();
    let before = g.client().received().foods.clone();
    assert!(
        g.receive(
            g.generation(),
            &bundle(&[vec![b'F', 1, 0], vec![b's', 0]]),
            25.
        )
        .is_err()
    );
    assert_eq!(before, g.client().received().foods);
    let old = g.generation();
    g.closed(old);
    effects(&mut g);
    pump(&mut g, 40.);
    assert!(g.effect().is_none());
    assert!(g.can_play());
    g.play("ws://127.0.0.1:19491/slither", "Next", 65).unwrap();
    assert!(g.generation() > old);
    g.opened(old, 42.).unwrap();
    g.receive(old, &[0], 41.).unwrap();
    g.closed(old);
    assert_eq!(g.phase(), Phase::Opening);
}
#[test]
fn zero_resize_retry_retains_generation_state_and_pending_world() {
    let mut g = playing();
    let generation = g.generation();
    let head = g.client().control_view().own.unwrap().raw_head;
    g.begin_frame(40., [960, 540], 1.).unwrap();
    effects(&mut g);
    let p = g.take_frame().unwrap();
    let hud_draws = p.frame.draws[p.frame.draws.len() - 2..].to_vec();
    g.retry_frame(p).unwrap();
    g.viewport([0, 0], 1.).unwrap();
    assert!(g.take_frame().is_none());
    assert_eq!(g.client().control_view().own.unwrap().raw_head, head);
    g.viewport([1920, 1080], 2.).unwrap();
    let p = g.take_frame().unwrap();
    assert_eq!(p.frame.extent, [1920, 1080]);
    assert_eq!(p.frame.viewport_scale, 2.);
    assert_eq!(&p.frame.draws[p.frame.draws.len() - 2..], &hud_draws);
    g.presented(true).unwrap();
    assert_eq!(g.generation(), generation);
    assert_eq!(g.phase(), Phase::Playing);
    assert!(g.effect().is_none());
}
fn received_food(index: u16) -> Vec<u8> {
    let mut packet = food();
    packet[2..4].copy_from_slice(&(1200 + index).to_be_bytes());
    packet
}
fn stalled_ingress_case(zero: bool, setup_picture: bool) {
    let mut game = playing();
    let mut control = playing();
    let generation = game.generation();
    if setup_picture {
        for g in [&mut game, &mut control] {
            g.receive(g.generation(), &bundle(&[setup()]), 30.).unwrap();
        }
        pictures(&mut control);
    } else {
        for g in [&mut game, &mut control] {
            g.begin_frame(40., [960, 540], 1.).unwrap();
            effects(g);
        }
        pictures(&mut control);
        if !zero {
            let frame = game.take_frame().unwrap();
            game.retry_frame(frame).unwrap();
        }
    }
    if zero {
        game.viewport([0, 0], 1.).unwrap();
    }
    for i in 0..80 {
        let packet = bundle(&[received_food(i)]);
        for g in [&mut game, &mut control] {
            g.receive(g.generation(), &packet, 50. + f64::from(i))
                .unwrap();
        }
    }
    assert_eq!(game.phase(), Phase::Playing);
    assert_eq!(game.generation(), generation);
    assert!(game.failure.is_none());
    assert!(game.effect().is_none());
    assert_eq!(game.client().foods().foods().len(), 81);
    assert_eq!(
        format!("{:?}", game.client().foods().foods()),
        format!("{:?}", control.client().foods().foods())
    );
    assert_eq!(
        game.client().control_view().own.unwrap().raw_head,
        control.client().control_view().own.unwrap().raw_head
    );
    assert_eq!(game.hud_text(), control.hud_text());
    pump(&mut game, 140.);
    pump(&mut control, 140.);
    assert_eq!(
        game.client().control_view().own.unwrap().raw_head,
        control.client().control_view().own.unwrap().raw_head
    );
    assert_eq!(game.phase(), Phase::Playing);
    assert!(game.failure.is_none());
}
#[test]
fn presentation_retry_pressure_preserves_all_packets_and_one_model_update() {
    stalled_ingress_case(false, false);
}
#[test]
fn zero_backing_with_prepared_work_recovers_ingress_without_disconnect() {
    stalled_ingress_case(true, false);
}
#[test]
fn queued_setup_picture_pressure_preserves_the_admitted_world() {
    stalled_ingress_case(false, true);
}
#[test]
fn new_ingress_cannot_overtake_older_deferred_packets() {
    let mut game = playing();
    let mut control = playing();
    for g in [&mut game, &mut control] {
        g.begin_frame(40., [960, 540], 1.).unwrap();
        effects(g);
    }
    pictures(&mut control);
    let first = bundle(&[received_food(1)]);
    game.receive(game.generation(), &first, 41.).unwrap();
    control.receive(control.generation(), &first, 41.).unwrap();
    pictures(&mut game);
    let second = bundle(&[received_food(2)]);
    game.receive(game.generation(), &second, 42.).unwrap();
    control.receive(control.generation(), &second, 42.).unwrap();
    pump(&mut game, 60.);
    pump(&mut control, 60.);
    assert_eq!(
        format!("{:?}", game.client().foods().foods()),
        format!("{:?}", control.client().foods().foods())
    );
}
#[test]
fn ingress_budget_never_cancels_a_host_owned_picture() {
    let mut g = playing();
    g.begin_frame(40., [960, 540], 1.).unwrap();
    effects(&mut g);
    let frame = g.take_frame().unwrap();
    for _ in 0..64 {
        g.receive(g.generation(), &bundle(&[vec![b'p']]), 41.)
            .unwrap();
    }
    let error = g
        .receive(g.generation(), &bundle(&[vec![b'p']]), 42.)
        .unwrap_err();
    assert_eq!(error, "Deferred receive budget");
    g.retry_frame(frame).unwrap();
    pictures(&mut g);
    pump(&mut g, 60.);
    assert_eq!(g.phase(), Phase::Playing);
}
#[test]
fn death_final_score_and_explicit_stop() {
    let mut g = playing();
    g.receive(g.generation(), &bundle(&[vec![b'v', 0]]), 30.)
        .unwrap();
    assert!(!g.hud_text().contains("FINAL --"));
    g.stop();
    effects(&mut g);
    pump(&mut g, 40.);
    assert_eq!(g.phase(), Phase::Disconnected);
    assert!(g.can_play());
}
#[test]
fn handshake_timeout_closes_without_retry() {
    let mut g = negotiating();
    g.begin_frame(4000., [960, 540], 1.).unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    assert_eq!(g.effect().unwrap().kind, EffectKind::Close);
    effects(&mut g);
    pump(&mut g, 4020.);
    assert!(g.effect().is_none());
}
#[test]
fn lazy_resources_preserve_full_palette_and_reject_unknowns() {
    let mut bank = Bank::new().unwrap();
    assert_eq!(bank.bodies.len(), 42);
    assert_eq!(bank.cached_sources(), 0);
    let draw = |a| Draw {
        corners: None,
        asset: a,
        source: None,
        destination: BodyRect {
            x: 0.,
            y: 0.,
            width: 10.,
            height: 10.,
        },
        translation: [0., 0.],
        rotation: 0.,
        effective_alpha: 1.,
        blend: BodyBlend::SourceOver,
    };
    let mut frame = Frame {
        identity: 1,
        tick: 0,
        extent: [100, 100],
        viewport_scale: 1.,
        draws: vec![],
        snakes: Vec::new(),
    };
    for color in 0..42 {
        frame.draws = vec![draw(bank.assets[bank.bodies[color].variants[0].asset])];
        let r = bank.resources(&frame).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(bank.cached_sources(), 1);
        assert_eq!(r[0].asset, frame.draws[0].asset);
    }
    frame.draws[0].asset.handle = u64::MAX;
    assert!(bank.resources(&frame).is_err());
    assert!(render::dimensions([960, 540], 0.).is_err());
}

#[test]
fn failed_initial_picture_never_constructs_and_next_play_is_explicit() {
    let mut g = LocalGame::new(0.).unwrap();
    g.play("ws://127.0.0.1:19491/slither", "Player", 0).unwrap();
    g.begin_frame(1., [960, 540], 1.).unwrap();
    assert!(g.take_frame().is_some());
    g.presented(false).unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    assert!(g.effect().is_none());
    assert!(g.can_play());
    g.play("ws://127.0.0.1:19491/slither", "Player", 65)
        .unwrap();
    pump(&mut g, 20.);
    assert!(matches!(g.effect().unwrap().kind, EffectKind::Connect(_)));
}

#[test]
fn stale_ack_and_packet_during_control_preserve_the_transaction() {
    let mut g = playing();
    g.key("ArrowLeft", true);
    g.begin_frame(300., [960, 540], 1.).unwrap();
    let e = g.effect().unwrap();
    assert!(g.acknowledge(e.generation, e.id + 1, true).is_err());
    assert_eq!(g.effect().unwrap(), e);
    let mut f = food();
    f[2] = 4;
    f[3] = 77;
    g.receive(g.generation(), &bundle(&[f]), 301.).unwrap();
    assert_eq!(g.client().foods().foods().len(), 1);
    effects(&mut g);
    pictures(&mut g);
    pump(&mut g, 320.);
    assert_eq!(g.client().foods().foods().len(), 2);
    assert_eq!(g.phase(), Phase::Playing);
}

#[test]
fn protocol_mismatch_and_prefix_failure_do_not_advance_admission() {
    let mut g = negotiating();
    let mut p = setup();
    p[23] = 20;
    assert!(g.receive(g.generation(), &bundle(&[p]), 3.).is_err());
    assert_eq!(g.phase(), Phase::Setup);
    assert!(g.client().received().setup.is_none());
    let mut g = LocalGame::new(0.).unwrap();
    g.play("ws://127.0.0.1:19491/slither", "Player", 0).unwrap();
    pump(&mut g, 1.);
    effects(&mut g);
    g.opened(g.generation(), 2.).unwrap();
    let e = g.effect().unwrap();
    g.acknowledge(e.generation, e.id, false).unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    assert_eq!(g.effect().unwrap().kind, EffectKind::Close);
    effects(&mut g);
    assert!(g.effect().is_none());
}

#[test]
fn regression_exact_sixteen_setup_pictures_drain_successfully() {
    let mut g = negotiating();
    g.receive(g.generation(), &bundle(&vec![setup(); 16]), 3.)
        .unwrap();
    pictures(&mut g);
    assert!(g.take_frame().is_none());
    assert_eq!(g.phase(), Phase::Playing);
}
#[test]
fn regression_seventeenth_setup_rejects_without_publication() {
    let mut g = negotiating();
    let before = g.hud_text();
    let e = g
        .receive(g.generation(), &bundle(&vec![setup(); 17]), 3.)
        .unwrap_err();
    assert!(e.contains("Setup draw budget"), "{e}");
    assert_eq!(g.phase(), Phase::Setup);
    assert_eq!(g.hud_text(), before);
    assert!(g.take_frame().is_none());
}
#[test]
fn regression_retained_picture_does_not_defer_handshake_expiry() {
    let mut g = negotiating();
    g.begin_frame(20., [960, 540], 1.).unwrap();
    let p = g.take_frame().unwrap();
    g.retry_frame(p).unwrap();
    let world = format!("{:?}", g.client().received());
    g.begin_frame(3335., [960, 540], 1.).unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    assert_eq!(format!("{:?}", g.client().received()), world);
    assert!(g.take_frame().is_none());
    assert_eq!(g.effect().unwrap().kind, EffectKind::Close);
    effects(&mut g);
    g.begin_frame(3336., [0, 0], 1.).unwrap();
    assert!(g.effect().is_none());
}
#[test]
fn regression_zero_backing_expires_and_fences_late_setup() {
    let mut g = negotiating();
    g.viewport([0, 0], 1.).unwrap();
    g.begin_frame(3335., [0, 0], 1.).unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    g.receive(g.generation(), &bundle(&[setup()]), 3336.)
        .unwrap();
    assert!(g.client().received().setup.is_none());
    let e = g.effect().unwrap();
    assert_eq!(e.kind, EffectKind::Close);
    effects(&mut g);
    g.receive(g.generation(), &bundle(&[setup()]), 3337.)
        .unwrap();
    assert!(g.effect().is_none());
}
#[test]
fn regression_late_ingress_expires_without_a_frame_pump() {
    let mut g = negotiating();
    g.receive(g.generation(), &bundle(&[setup()]), 3335.)
        .unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    assert!(g.client().received().setup.is_none());
    assert_eq!(g.effect().unwrap().kind, EffectKind::Close);
}
#[test]
fn regression_delayed_initial_picture_gets_fresh_constructor_budget() {
    let mut g = LocalGame::new(0.).unwrap();
    g.play("ws://127.0.0.1:19491/slither", "Player", 0).unwrap();
    g.begin_frame(1., [960, 540], 1.).unwrap();
    let p = g.take_frame().unwrap();
    g.retry_frame(p).unwrap();
    g.begin_frame(5000., [960, 540], 1.).unwrap();
    assert!(g.effect().is_none());
    assert!(g.take_frame().is_some());
    g.presented(true).unwrap();
    let e = g.effect().unwrap();
    assert!(matches!(e.kind, EffectKind::Connect(_)));
    // The corrected host must begin construction here using its fresh5000ms clock.
    g.construct(e.generation, e.id, 5000.).unwrap();
    g.acknowledge(e.generation, e.id, true).unwrap();
    g.begin_frame(5001., [960, 540], 1.).unwrap();
    assert_eq!(g.phase(), Phase::Opening);
    pictures(&mut g);
    assert!(g.construct(e.generation, e.id, 5001.).is_err());
    g.observe_time(8333.).unwrap();
    assert_eq!(g.phase(), Phase::Opening);
    g.begin_frame(8334., [960, 540], 1.).unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    assert_eq!(g.effect().unwrap().kind, EffectKind::Close);
    effects(&mut g);
    assert!(g.effect().is_none());
}
fn late_budget_packet() -> Vec<u8> {
    let mut cs = vec![setup()];
    for i in 0..1140 {
        let f = vec![b'F', 11, 10, 41, (i % 40) as u8, (i / 40) as u8, 20];
        cs.push(f);
    }
    for id in 1000u16..1100 {
        let mut p = prey();
        p[1..3].copy_from_slice(&id.to_be_bytes());
        cs.push(p);
    }
    cs.push(vec![b'h', 0, 7, 128, 0, 0]);
    cs.push(setup());
    let mut b = board();
    b[3] = 3;
    cs.push(b);
    bundle(&cs)
}
#[test]
fn repeated_setup_rejects_resource_heavy_snapshots_during_capture() {
    let mut g = playing();
    let foods: Vec<_> = (0..42)
        .flat_map(|color| (1..=21).map(move |size| vec![b'F', 11, 10, color, size, color, size]))
        .collect();
    assert_eq!(foods.len(), 882);
    g.receive(g.generation(), &bundle(&foods), 25.).unwrap();
    let world = format!("{:?}", g.client().received());
    let hud = g.hud_text();
    let frames = g.client().received().frames_applied;
    let setups = bundle(&vec![setup(); 16]);
    let error = g.receive(g.generation(), &setups, 30.).unwrap_err();
    assert_eq!(error, "Setup capture pixels budget");
    assert_eq!(format!("{:?}", g.client().received()), world);
    assert_eq!(g.hud_text(), hud);
    assert_eq!(g.client().received().frames_applied, frames);
    assert!(g.take_frame().is_none());
    // One picture still fits after the rejected aggregate; no queue or draw
    // preparation state from the rejected packet may have been published.
    g.receive(g.generation(), &bundle(&[setup()]), 40.).unwrap();
    pictures(&mut g);
}

#[test]
fn regression_late_combined_draw_budget_is_atomic() {
    let mut g = playing();
    let before = format!("{:?}", g.client().received());
    let hud = g.hud_text();
    let error = g
        .receive(g.generation(), &late_budget_packet(), 30.)
        .unwrap_err();
    assert!(
        error.contains("frame extent/scale/budget"),
        "Expected late combined frame validation, got {error}"
    );
    let same_world = format!("{:?}", g.client().received()) == before;
    let same_hud = g.hud_text() == hud;
    let no_partial_queue = g.take_frame().is_none();
    assert_eq!(
        (same_world, same_hud, no_partial_queue),
        (true, true, true),
        "late frame/resource rejection must publish nothing"
    );
    // A later valid factory request must also retain the prior RNG and frame serial.
    let mut control = playing();
    let packet = bundle(&[vec![b'F', 11, 10, 41, 50, 50, 20]]);
    g.receive(g.generation(), &packet, 40.).unwrap();
    control.receive(control.generation(), &packet, 40.).unwrap();
    let foods = |g: &LocalGame| {
        g.client()
            .foods()
            .foods()
            .iter()
            .map(|f| f.snapshot())
            .collect::<Vec<_>>()
    };
    assert_eq!(foods(&g), foods(&control));
    g.begin_frame(60., [960, 540], 1.).unwrap();
    control.begin_frame(60., [960, 540], 1.).unwrap();
    effects(&mut g);
    effects(&mut control);
    assert_eq!(
        g.take_frame().unwrap().frame.identity,
        control.take_frame().unwrap().frame.identity
    );
}

#[test]
fn constructor_admission_is_single_use_and_late_open_is_fenced() {
    let mut g = LocalGame::new(0.).unwrap();
    g.play("ws://127.0.0.1:19491/slither", "Player", 0).unwrap();
    pump(&mut g, 1.);
    let e = g.effect().unwrap();
    assert!(g.acknowledge(e.generation, e.id, true).is_err());
    assert!(g.construct(e.generation, e.id + 1, 1.).is_err());
    g.construct(e.generation, e.id, 1.).unwrap();
    assert!(g.construct(e.generation, e.id, 1000.).is_err());
    g.acknowledge(e.generation, e.id, true).unwrap();
    let before = format!("{:?}", g.client().received());
    g.opened(g.generation(), 3335.).unwrap();
    assert_eq!(g.phase(), Phase::Failed);
    assert_eq!(g.effect().unwrap().kind, EffectKind::Close);
    assert_eq!(format!("{:?}", g.client().received()), before);
    effects(&mut g);
    g.opened(g.generation(), 4000.).unwrap();
    assert!(g.effect().is_none());
}
