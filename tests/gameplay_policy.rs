use slither_client::gameplay_policy::{
    FrameStage, GameplayPolicy as Policy, ProfilePhase, css_ceil,
};

fn owner() -> Policy {
    Policy::new(true, true, true, true, true, true)
}

#[test]
fn pending_pair_coalesces_and_first_fatal_discards_both() {
    let mut p = owner();
    assert_eq!(p.packet_base(), 0);
    p.stage_companion();
    assert!(p.take_companion());
    assert!(!p.take_companion());
    assert!(p.stage_packet());
    assert_eq!(p.packet_base(), 1);
    assert!(p.stage_packet());
    assert!(p.retain_error());
    assert!(!p.retain_error());
    assert_eq!(p.packet_base(), 0);
    assert!(!p.publish_pending());
    assert!(!p.publication_allowed());
    assert!(p.claim_fatal_notification());
    assert!(!p.claim_fatal_notification());
}

#[test]
fn status_capture_commits_before_callback_but_connected_commit_follows_effect() {
    let mut p = owner();
    assert!(p.needs_connected(true));
    assert!(p.take_status());
    assert_eq!(Policy::status("playing", true), 2);
    assert!(!p.take_status());
    // Reentrant callback dirtiness and a changed session do not alter captured status.
    p.mark_dirty();
    p.connected_done(true);
    assert!(!p.needs_connected(true));
    assert!(p.needs_connected(false));
    assert!(p.take_status());
    assert_eq!(Policy::status("ready", false), 1);
    assert_eq!(Policy::timer_action(true, false), 1);
    assert_eq!(Policy::timer_action(false, true), 2);
    assert_eq!(Policy::timer_action(true, true), 0);
}

#[test]
fn reset_skips_tick_and_commit_waits_for_controller_score_and_session() {
    let mut p = owner();
    p.begin_frame();
    assert_eq!(p.frame_stage(), FrameStage::Controller);
    assert!(!p.frame_score_required());
    assert!(!p.frame_commit_allowed());
    assert!(!p.frame_publication_allowed());
    p.begin_control();
    assert!(!p.input_allowed());
    p.debt_done();
    p.lifecycle_done(true);
    assert!(p.reset_input());
    assert!(!p.input_allowed());
    p.control_done();
    p.begin_control();
    p.debt_done();
    p.lifecycle_done(false);
    assert!(p.input_allowed());
    assert!(!p.reset_input());
    p.control_done();
    p.controller_done();
    assert!(p.frame_score_required());
    assert!(!p.frame_commit_allowed());
    p.score_done();
    assert!(p.frame_commit_allowed());
    assert!(!p.frame_publication_allowed());
    p.frame_commit_done(true);
    assert!(p.frame_publication_allowed());
    p.finish_frame();
    assert!(!p.frame_publication_allowed());
}

#[test]
fn profile_stages_retain_correctable_vs_consumed_attempt_and_dispose_order() {
    let mut p = owner();
    assert!(p.profile_idle());
    p.begin_profile();
    assert!(p.acquiring());
    assert_eq!(p.reconcile_entry(false), 0);
    assert!(p.profile_retry_allowed());
    p.profile_retry();
    assert!(p.profile_idle());
    p.begin_profile();
    p.profile_started();
    assert!(!p.profile_retry_allowed());
    p.profile_ready();
    assert!(p.profile_needs_current());
    assert!(!p.commit_profile(false));
    assert!(p.commit_profile(true));
    assert_eq!(p.profile(), ProfilePhase::Committed);
    assert!(!p.commit_profile(true));
    p.begin_dispose();
    assert!(p.disposed());
    assert_eq!(p.profile(), ProfilePhase::Disposed);
    assert!(!p.current_allowed());
    assert!(!p.may_schedule(false));
}

#[test]
fn exact_nickname_code_units_and_nonfinite_css_ceiling() {
    let mut p = owner();
    let units = [0, 0x41, 0xd800, 0xdc00, 0xd83d, 0xde00, 0xffff];
    p.set_nickname(&units);
    assert_eq!(p.nickname(), units);
    p.begin_dispose();
    assert!(p.nickname().is_empty());
    for value in [-0., -0.1, -0.99] {
        assert_eq!(css_ceil(value).to_bits(), (-0_f64).to_bits());
    }
    assert_eq!(css_ceil(-1.5), -1.);
    assert_eq!(css_ceil(f64::INFINITY), f64::INFINITY);
    assert_eq!(css_ceil(f64::NEG_INFINITY), f64::NEG_INFINITY);
    assert!(css_ceil(f64::NAN).is_nan());
}

#[test]
fn host_reentry_modes_and_current_publication_barriers_remain_distinct() {
    let mut selected = owner();
    let legacy = Policy::new(false, false, false, false, false, false);
    assert!(selected.poison_reentry(true, false, false));
    assert!(!legacy.poison_reentry(true, true, true));
    assert!(selected.run_rejected(false, false, true));
    assert!(!legacy.run_rejected(false, false, true));
    assert!(selected.replace_local(false, true));
    assert!(!legacy.replace_local(true, true));
    assert!(!selected.post_callback_fatal());
    selected.retain_error();
    assert!(selected.post_callback_fatal());
    let mut p = owner();
    p.stage_packet();
    assert!(p.publish_pending());
    assert_eq!(p.packet_base(), 0);
    p.stage_packet();
    p.begin_dispose();
    assert!(!p.publish_pending());
    assert!(!p.publication_allowed());
}

#[test]
fn pending_connection_phases_are_busy_until_setup_or_a_terminal_change() {
    assert_eq!(Policy::status("ready", false), 1);
    assert_eq!(Policy::status("ready", true), 1);
    for phase in ["opening", "challenge", "setup"] {
        assert_eq!(Policy::status(phase, false), 4);
        assert_eq!(Policy::status(phase, true), 2);
    }
    for phase in [
        "playing",
        "victory",
        "dead",
        "failed",
        "disconnected",
        "unknown",
    ] {
        assert_eq!(Policy::status(phase, false), 3);
        assert_eq!(Policy::status(phase, true), 2);
    }
}
