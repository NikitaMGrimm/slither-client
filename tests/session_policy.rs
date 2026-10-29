use slither_client::session_policy::{Command, Phase, ReportEvent, SessionPolicy};
fn command(opcode: u8, argument: u8) -> Command {
    Command { opcode, argument }
}
fn connected() -> SessionPolicy {
    let mut p = SessionPolicy::new();
    p.subscribe(2).unwrap();
    p.begin_play();
    p.check_step(true).unwrap();
    p.advance_step(0.0, 1.0, 1.0).unwrap();
    p.finish_step(false);
    assert!(p.commit_control(false));
    p.begin_construct(0.0).unwrap();
    p.check_open().unwrap();
    p.opened();
    assert!(p.receive_header(1, 54).unwrap());
    p.challenged();
    p.prepare_controls(&[command(97, 0)], 1000.0).unwrap();
    p.commit_controls().unwrap();
    p
}
#[test]
fn reset_commit_precedes_single_constructor_intent() {
    let mut p = SessionPolicy::new();
    p.subscribe(0).unwrap();
    p.begin_play();
    assert!(!p.commit_control(false));
    assert!(p.actions().1.reset_world);
    p.finish_step(false);
    assert!(p.commit_control(false));
    assert!(!p.commit_control(false));
    assert!(!p.actions().1.reset_world);
    p.begin_construct(17.0).unwrap();
    assert_eq!(p.view().constructor_attempts, 1);
    assert_eq!(p.view().phase, Phase::Opening);
}
#[test]
fn staged_close_cancels_launch_without_clearing_observable_owner() {
    let mut p = SessionPolicy::new();
    p.begin_play();
    p.finish_step(false);
    assert!(p.begin_stop(false, "cancelled".encode_utf16().collect()));
    p.stop_actions();
    assert!(!p.commit_control(false));
    assert_eq!(p.view().phase, Phase::Disconnected);
    assert!(!p.begin_stop(true, "later".encode_utf16().collect()));
    assert_eq!(
        p.view().reason.as_deref(),
        Some("cancelled".encode_utf16().collect::<Vec<_>>().as_slice())
    );
}
#[test]
fn phase_and_canonical_control_admission_are_closed() {
    let mut p = SessionPolicy::new();
    assert_eq!(SessionPolicy::negotiation_packet(0).unwrap(), vec![1]);
    assert_eq!(SessionPolicy::negotiation_packet(1).unwrap(), vec![99, 0]);
    assert!(SessionPolicy::negotiation_packet(2).is_err());
    assert!(p.receive_header(1, 97).is_err());
    p.begin_play();
    p.opened();
    assert!(p.receive_header(2, 54).is_err());
    assert!(p.receive_header(1, 97).is_err());
    assert!(p.receive_header(1, 54).unwrap());
    p.challenged();
    assert!(p.receive_header(1, 118).is_err());
    assert!(!p.receive_header(1, 97).unwrap());
    for (op, len) in [(54, 1), (112, 2), (118, 1), (118, 3)] {
        assert!(p.command_requires_version(op, len).is_err());
    }
    assert!(p.command_requires_version(97, 25).unwrap());
    assert!(p.admit_protocol(19.0).is_ok());
    assert!(p.admit_protocol(18.0).is_err());
    assert!(p.admit_protocol(f64::NAN).is_err());
}
#[test]
fn receive_budgets_and_handshake_timeout_keep_inclusive_bounds() {
    let mut p = SessionPolicy::new();
    p.begin_construct(1000.0).unwrap();
    assert!(!p.handshake_timed_out(4333.0));
    assert!(p.handshake_timed_out(4333.0001));
    for _ in 0..16 {
        p.receive_bytes(65536).unwrap();
    }
    assert!(p.receive_bytes(0).is_err());
    let mut p = SessionPolicy::new();
    p.receive_bytes(1_048_576).unwrap();
    assert!(p.receive_bytes(1).is_err());
    let mut p = connected();
    assert!(!p.handshake_timed_out(1e9));
    for _ in 0..32 {
        p.receive_bytes(1_048_576).unwrap();
    }
}
#[test]
fn ping_attempt_and_lag_are_separate_strict_commits() {
    let mut p = connected();
    assert!(p.ping_available());
    assert!(!p.ping_due(250.0));
    assert!(p.ping_due(250.0001));
    assert_eq!(p.commit_ping(300.0), vec![251]);
    assert!(!p.ping_available());
    p.observe_lag(1050.0);
    assert!(!p.view().lagging);
    p.observe_lag(1050.0001);
    assert!(p.view().lagging);
    p.prepare_controls(&[command(112, 0)], 1100.0).unwrap();
    assert!(p.view().ping_pending);
    p.commit_controls().unwrap();
    assert!(!p.view().ping_pending);
    assert!(!p.view().lagging);
    assert_eq!(p.view().last_ping_ms, 300.0);
}
#[test]
fn command_history_capture_and_state_are_atomic_until_commit() {
    let mut p = connected();
    let commands = [
        command(118, 1),
        command(108, 0),
        command(118, 1),
        command(97, 0),
        command(118, 2),
        command(118, 0),
    ];
    let plan = p.prepare_controls(&commands, 1200.0).unwrap();
    assert_eq!(plan.final_capture_indices, vec![0, 2]);
    assert!(!plan.guards[0].death_pending);
    assert!(plan.guards[1].death_pending);
    assert!(!plan.guards[4].close_requested);
    assert!(plan.guards[5].close_requested);
    assert_eq!(p.view().phase, Phase::Playing);
    let old_revision = p.actions().0;
    assert!(!p.actions().1.reset_lag);
    p.commit_controls().unwrap();
    assert_eq!(p.actions().0, old_revision + 3.0);
    assert_eq!(p.view().phase, Phase::Playing);
    assert!(p.view().close_requested);
    assert!(p.commit_controls().is_err());
}
#[test]
fn hud_report_order_and_death_guard_reject_before_live_commit() {
    let mut p = connected();
    p.prepare_controls(&[command(118, 1), command(108, 0)], 1200.0)
        .unwrap();
    let event = |command_index, kind, death_pending| ReportEvent {
        command_index,
        kind,
        death_pending,
    };
    assert!(
        p.match_report(&[event(0, 3, false), event(1, 2, false)], 0)
            .is_err()
    );
    assert!(p.match_report(&[event(0, 3, false)], 0).is_err());
    p.match_report(&[event(0, 3, false), event(1, 2, true)], 0)
        .unwrap();
    assert!(!p.view().life_ended);
    p.commit_controls().unwrap();
    assert!(p.view().life_ended);
}
#[test]
fn every_death_advances_revision_while_selective_ack_preserves_reset_order() {
    let mut p = connected();
    p.prepare_controls(&[command(118, 1), command(118, 1)], 1000.0)
        .unwrap();
    p.commit_controls().unwrap();
    let revision = p.actions().0;
    assert!(p.acknowledge(revision - 1.0).is_err());
    p.begin_stop(false, "close".encode_utf16().collect());
    p.stop_actions();
    let (revision, a) = p.actions();
    assert_eq!(
        a.ordered_fields().map(|(key, _)| key).collect::<Vec<_>>(),
        vec!["resetLag", "resetWorld", "connected"]
    );
    p.acknowledge(revision).unwrap();
    let a = p.actions().1;
    assert!(!a.reset_lag);
    assert!(a.reset_world && a.disconnected);
    assert!(p.acknowledge(p.actions().0).is_err());
}
#[test]
fn return_waits_for_fade_in_and_strict_death_delay() {
    let mut p = connected();
    p.prepare_controls(&[command(118, 0)], 1000.0).unwrap();
    p.commit_controls().unwrap();
    let (l, close) = p.advance_step(2601.0, 5.0, 5.0).unwrap();
    assert!(!l.return_active && !close);
    p.ui_tick(1500.0).unwrap();
    let (l, _) = p.advance_step(2600.0, 5.0, 5.0).unwrap();
    assert!(!l.return_active);
    let (l, _) = p.advance_step(2601.0, 5.0, 5.0).unwrap();
    assert!(l.return_active);
    assert_eq!(l.return_fraction, 0.98);
    let mut completed = false;
    for _ in 0..51 {
        let (l, close) = p.advance_step(2700.0, 5.0, 5.0).unwrap();
        if l.return_completed {
            assert!(close);
            completed = true;
            break;
        }
    }
    assert!(completed);
    assert!(!p.view().playing);
    assert!(p.view().connected);
}
#[test]
fn victory_return_retains_connection_and_later_v2_closes() {
    let mut p = connected();
    p.ui_tick(1500.0).unwrap();
    p.prepare_controls(&[command(118, 1)], 1000.0).unwrap();
    p.commit_controls().unwrap();
    for _ in 0..51 {
        let (_, close) = p.advance_step(2700.0, 5.0, 5.0).unwrap();
        assert!(!close);
    }
    assert_eq!(p.view().phase, Phase::Victory);
    assert!(p.view().connected && !p.view().playing);
    p.prepare_controls(&[command(118, 2)], 3000.0).unwrap();
    p.commit_controls().unwrap();
    let (_, close) = p.advance_step(3000.0, 0.0, 0.0).unwrap();
    assert!(close);
}
#[test]
fn action_revision_changed_after_step_is_not_consumed_by_old_commit() {
    let mut p = connected();
    p.finish_step(true);
    p.prepare_controls(&[command(118, 1)], 1200.0).unwrap();
    p.commit_controls().unwrap();
    assert!(!p.commit_control(true));
    assert!(p.actions().1.reset_lag);
}
#[test]
fn arithmetic_preserves_signed_zero_nonfinite_fade_and_compact_packet_edges() {
    let mut p = connected();
    p.ui_tick(975.0).unwrap();
    assert_eq!(p.view().return_fraction, -0.05);
    let (l, _) = p.advance_step(-100.0, -0.0, -0.0).unwrap();
    assert_eq!(l.return_fraction, -0.05);
    let mut p = SessionPolicy::new();
    p.prepare_controls(&[command(97, 0)], f64::MAX).unwrap();
    p.commit_controls().unwrap();
    p.ui_tick(-f64::MAX).unwrap();
    assert_eq!(p.view().return_fraction, f64::NEG_INFINITY);
    p.ui_tick(f64::MAX).unwrap();
    assert!(p.view().return_fraction.is_nan());
    assert!(SessionPolicy::valid_input(&[0]));
    assert!(SessionPolicy::valid_input(&[254]));
    assert!(!SessionPolicy::valid_input(&[252]));
    assert!(!SessionPolicy::valid_input(&[255]));
    assert!(!SessionPolicy::valid_input(&[252, 0]));
    assert!(!SessionPolicy::valid_input(&[252, 128]));
    assert!(SessionPolicy::valid_input(&[252, 255]));
    assert!(SessionPolicy::protocol_allowed(19.0));
    assert!(!SessionPolicy::protocol_allowed(f64::NAN));
}

#[test]
fn arbitrary_reason_retains_all_utf16_units_including_lone_surrogates() {
    let mut p = SessionPolicy::new();
    let units = vec![0, 0xd800, 0x41, 0xdc00];
    p.begin_stop(false, units.clone());
    assert_eq!(p.view().reason, Some(units));
}
