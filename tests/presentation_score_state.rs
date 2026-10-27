//! Authored native score-state fixtures; no external runtime or captured packets.

use slither_client::{
    presentation::{
        AnimatedClient, ClientPresentationError, FacePresentation, ScoreError, ScoreStatus,
        ScoreTables, StandardEyeGeometry,
    },
    protocol::ElapsedHeader,
    state::ClientState,
};

fn u24(value: u32) -> [u8; 3] {
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

fn setup(n: u16) -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for value in [n, 100, 20] {
        p.extend(value.to_be_bytes());
    }
    p.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(value.to_be_bytes());
    }
    p.extend([19, 42]);
    p
}

fn appearance(id: u16, points: usize) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.extend(u24(0));
    p.push(b'0');
    p.extend(u24(0));
    p.extend(4250_u16.to_be_bytes());
    p.extend(u24(0));
    p.push(0);
    p.extend(u24(500_000));
    p.extend(u24(5000));
    p.extend([0, 0, 255]);
    if points > 0 {
        p.extend(u24((100_000 - points as u32 * 42) * 5));
        p.extend(u24(5000));
        for _ in 2..points {
            p.extend([211, 127]);
        }
        if points >= 2 {
            p.extend(0_u16.to_be_bytes());
        }
    }
    p
}

fn mass(id: u16, value: u32) -> Vec<u8> {
    let mut p = vec![b'h'];
    p.extend(id.to_be_bytes());
    p.extend(u24(value));
    p
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for command in commands {
        bytes.extend((command.len() as u16).to_be_bytes());
        bytes.extend(command);
    }
    bytes
}

fn apply(c: &mut AnimatedClient, commands: &[Vec<u8>]) {
    c.apply_frame(&bundle(commands), ElapsedHeader::Absent)
        .unwrap();
}

fn client(n: u16, points: usize) -> AnimatedClient {
    let mut c = AnimatedClient::new(0.).unwrap();
    c.enable_score_tracking().unwrap();
    apply(&mut c, &[setup(n), appearance(7, points)]);
    c
}

fn check_ready(c: &AnimatedClient) {
    let before = c.clone();
    let view = c.score_view();
    let own = view.own.unwrap();
    let metrics = c.own_snake().unwrap().metrics();
    assert_eq!(own.token, c.own_token().unwrap());
    assert_eq!(own.logical_segments, metrics.logical_segments);
    assert_eq!(own.fractional_mass.to_bits(), metrics.fam.to_bits());
    assert_eq!(
        own.score_index,
        metrics.logical_segments + usize::from(own.score_adjustment)
    );
    let expected = ScoreTables::new(view.table_max.unwrap())
        .unwrap()
        .score(own.score_index, own.fractional_mass)
        .unwrap();
    assert_eq!(view.status, ScoreStatus::Ready(expected));
    assert_eq!(c, &before, "pure observation preserves the complete client");
}

#[test]
fn legacy_r_shapes_and_ignored_counts_are_unchanged_until_explicit_enablement() {
    let packets = bundle(&[vec![b'R'], vec![b'R', 4], vec![b'R', 4, 5]]);
    let mut state = ClientState::default();
    let report = state.apply_frame(&packets, ElapsedHeader::Absent).unwrap();
    assert_eq!(report.ignored, 3);
    let mut c = AnimatedClient::new(0.).unwrap();
    assert_eq!(c.score_view().status, ScoreStatus::Disabled);
    assert_eq!(
        c.apply_frame(&packets, ElapsedHeader::Absent)
            .unwrap()
            .ignored,
        3
    );
    let before = c.clone();
    assert_eq!(
        c.enable_score_tracking(),
        Err(ClientPresentationError::ScoreModeRequiresReset)
    );
    assert_eq!(c, before);
    c.reset();
    c.enable_score_tracking().unwrap();
    assert_eq!(c.score_view().status, ScoreStatus::NoTables);
    assert!(c.score_view().own.is_none());
}

#[test]
fn canonical_r_requires_retained_own_at_its_position_and_failures_are_atomic() {
    let mut c = AnimatedClient::new(0.).unwrap();
    c.enable_score_tracking().unwrap();
    for commands in [
        vec![vec![b'R', 5]],
        vec![setup(2), vec![b'R', 5], appearance(7, 3)],
        vec![setup(2), appearance(7, 3), vec![b'R']],
        vec![setup(2), appearance(7, 3), vec![b'R', 5, 6]],
    ] {
        let before = c.clone();
        assert!(
            c.apply_frame(&bundle(&commands), ElapsedHeader::Absent)
                .is_err()
        );
        assert_eq!(c, before);
    }
    apply(&mut c, &[setup(2), appearance(7, 3), vec![b'R', 255]]);
    assert_eq!(c.score_view().own.unwrap().score_adjustment, 255);
    assert_eq!(c.received().ignored_commands, 0);
    check_ready(&c);
}

#[test]
fn r_replaces_without_scheduling_geometry_and_view_uses_latest_mass_and_count() {
    let mut c = client(430, 12);
    c.advance(3., false).unwrap();
    let snake = c.own_snake().unwrap().clone();
    let camera = c.camera().clone();
    apply(&mut c, &[vec![b'R', 8], vec![b'R', 8], vec![b'R', 3]]);
    assert_eq!(c.own_snake(), Some(&snake));
    assert_eq!(c.camera(), &camera);
    assert_eq!(c.score_view().own.unwrap().score_adjustment, 3);
    assert_eq!(c.advance(8., false).unwrap().delta, 5. / 8.);
    apply(&mut c, &[mass(7, 8_388_608), vec![b'r', 0, 7]]);
    let own = c.score_view().own.unwrap();
    assert_eq!(own.logical_segments, 11);
    assert_eq!(
        own.fractional_mass.to_bits(),
        (8_388_608. / 16_777_215_f64).to_bits()
    );
    assert!(c.own_snake().unwrap().body().points().len() > own.logical_segments);
    check_ready(&c);
}

#[test]
fn setup_cache_and_mode_survive_reset_while_own_adjustment_does_not() {
    let mut c = client(2, 3);
    apply(&mut c, &[vec![b'R', 19], setup(2), setup(17)]);
    assert_eq!(c.score_view().table_max, Some(17));
    assert_eq!(c.score_view().own.unwrap().score_adjustment, 19);
    c.enable_score_tracking().unwrap();
    c.reset();
    assert_eq!(c.score_view().table_max, Some(17));
    assert!(c.score_view().enabled);
    assert!(c.score_view().own.is_none());
    assert_eq!(c.score_view().status, ScoreStatus::NoOwn);
    apply(&mut c, &[setup(17), appearance(9, 4)]);
    assert_eq!(c.score_view().own.unwrap().score_adjustment, 0);
    check_ready(&c);
}

#[test]
fn original_own_keeps_score_identity_after_death_expiry_and_wire_id_reuse() {
    let mut c = client(430, 12);
    let token = c.score_view().own.unwrap().token;
    apply(
        &mut c,
        &[vec![b'R', 9], vec![b's', 0, 7, 1], appearance(7, 5)],
    );
    for i in 1..=12 {
        c.advance(f64::from(i) * 40., false).unwrap();
    }
    assert!(c.own_snake().unwrap().metrics().expired);
    let own = c.score_view().own.unwrap();
    apply(&mut c, &[mass(7, 16_777_215), vec![b'R', 23]]);
    let after = c.score_view().own.unwrap();
    assert_eq!(after.token, token);
    assert_eq!(after.logical_segments, own.logical_segments);
    assert_eq!(
        after.fractional_mass.to_bits(),
        own.fractional_mass.to_bits()
    );
    assert_eq!(after.score_adjustment, 23);
    assert_eq!(c.snake(7).unwrap().metrics().fam, 1.);
    check_ready(&c);
}

#[test]
fn unsupported_score_index_is_a_pure_status_and_does_not_reject_valid_geometry() {
    let c = client(1, 2200);
    let before = c.clone();
    assert!(c.score_view().own.unwrap().score_index > 2049);
    assert_eq!(
        c.score_view().status,
        ScoreStatus::Unsupported(ScoreError::IndexOutOfRange)
    );
    assert_eq!(c, before);
}

#[test]
fn ordered_setup_callbacks_see_event_time_tables_and_late_failure_rolls_back() {
    let mut c = AnimatedClient::new(0.).unwrap();
    c.enable_score_tracking().unwrap();
    let mut observed = Vec::new();
    c.apply_frame_with_face_presentation_and_all_factories_and_setup::<ClientPresentationError, _, _, _, _>(
        &bundle(&[setup(2), appearance(7, 3), vec![b'R', 4], setup(17)]),
        ElapsedHeader::Absent,
        |_| Ok(FacePresentation::default()),
        |_, _| unreachable!("no authored food"),
        |_, _| unreachable!("no authored prey"),
        |client, _| { observed.push(client.score_view()); Ok(()) },
    ).unwrap();
    assert_eq!(observed.len(), 2);
    assert_eq!(observed[0].table_max, Some(2));
    assert_eq!(observed[0].status, ScoreStatus::NoOwn);
    assert_eq!(observed[1].table_max, Some(17));
    assert_eq!(observed[1].own.unwrap().score_adjustment, 4);
    let before = c.clone();
    let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup::<ClientPresentationError, _, _, _, _>(
        &bundle(&[vec![b'R', 255], setup(3)]),
        ElapsedHeader::Absent,
        |_| Ok(FacePresentation::default()),
        |_, _| unreachable!("no authored food"),
        |_, _| unreachable!("no authored prey"),
        |_, _| Err(ClientPresentationError::Limit),
    );
    assert_eq!(result, Err(ClientPresentationError::Limit));
    assert_eq!(c, before);
}

#[test]
fn late_received_or_resolver_failure_preserves_prior_tables_r_and_complete_client() {
    let mut c = client(2, 3);
    for commands in [vec![vec![b'R', 99], setup(17), vec![b'h']], vec![setup(0)]] {
        let before = c.clone();
        assert!(
            c.apply_frame(&bundle(&commands), ElapsedHeader::Absent)
                .is_err()
        );
        assert_eq!(c, before);
    }
    let before = c.clone();
    let result = c.apply_frame_with_eye_geometry::<ClientPresentationError, _>(
        &bundle(&[setup(17), vec![b'R', 99], appearance(8, 3)]),
        ElapsedHeader::Absent,
        |_| Err(ClientPresentationError::Limit),
    );
    assert_eq!(result, Err(ClientPresentationError::Limit));
    assert_eq!(c, before);
    c.apply_frame_with_eye_geometry::<ClientPresentationError, _>(
        &bundle(&[vec![b'R', 7]]),
        ElapsedHeader::Absent,
        |_| Ok(StandardEyeGeometry::default()),
    )
    .unwrap();
    assert_eq!(c.score_view().own.unwrap().score_adjustment, 7);
}
