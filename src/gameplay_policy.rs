//! Browser-free reconciliation, publication and profile-stage policy.
//!
//! Native callbacks, issued object identities, scheduling leases and error values
//! are host observations. Each method returns before any host effect executes.

/// Semantic profile stage, independent of the native acquirer's lifetime.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ProfilePhase {
    /// No profile capabilities were selected.
    Unavailable,
    /// A correctable request can start.
    Idle,
    /// Frames and draws stay locked while acquisition fulfills.
    Acquiring,
    /// Fully acquired; check document currency before and after native work.
    Ready,
    /// The staged constructor attempt committed.
    Committed,
    /// The started attempt failed and cannot retry.
    Failed,
    /// Explicit teardown committed.
    Disposed,
}

/// Current continuation of one nonreentrant native frame, not a clock or driver.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameStage {
    /// No unfinished frame.
    #[default]
    Idle,
    /// Native control may synchronously observe the one existing scene step.
    Controller,
    /// Controller, step, statistics, render and source release all returned.
    Score,
    /// Required score observation/reduction returned; socket commit is next.
    Commit,
    /// Socket commit and its captured session observation returned.
    Publish,
}

/// Small control continuation; no new owner borrow spans the native callback.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum ControlStage {
    /// No current control observation.
    #[default]
    Idle,
    /// Input own/connection observations precede whole-step debt.
    Debt,
    /// Debt committed; invoke the existing session lifecycle fold.
    Lifecycle,
    /// Reset returns immediately; otherwise run the existing staged input tick.
    Reset,
    /// Input tick, including keyboard/ping/boost/heading, is permitted.
    Input,
    /// Ready to return admitted actions to the already-borrowed native scene.
    Complete,
}

/// Pure gameplay state. History values themselves remain their existing owners.
#[derive(Clone, Debug)]
pub struct GameplayPolicy {
    hud: bool,
    rows: bool,
    local: bool,
    minimap: bool,
    announcements: bool,
    disposed: bool,
    fatal: bool,
    notified: bool,
    dirty: bool,
    native_connected: bool,
    pending_pair: bool,
    companion: bool,
    profile: ProfilePhase,
    attempt_started: bool,
    nickname: Vec<u16>,
    frame: FrameStage,
    control: ControlStage,
}

impl GameplayPolicy {
    /// Modes have already passed host capability/boolean admission.
    pub fn new(
        hud: bool,
        rows: bool,
        local: bool,
        minimap: bool,
        announcements: bool,
        profile: bool,
    ) -> Self {
        Self {
            hud,
            rows,
            local,
            minimap,
            announcements,
            disposed: false,
            fatal: false,
            notified: false,
            dirty: true,
            native_connected: false,
            pending_pair: false,
            companion: false,
            profile: if profile {
                ProfilePhase::Idle
            } else {
                ProfilePhase::Unavailable
            },
            attempt_started: false,
            nickname: Vec::new(),
            frame: FrameStage::Idle,
            control: ControlStage::Idle,
        }
    }
    /// Copied flags for diagnostics and retired host observations.
    pub fn snapshot(&self) -> [u8; 8] {
        [
            u8::from(self.disposed),
            u8::from(self.fatal),
            u8::from(self.dirty),
            self.profile as u8,
            u8::from(self.native_connected),
            u8::from(self.pending_pair),
            u8::from(self.companion),
            u8::from(self.attempt_started),
        ]
    }
    /// Terminal resource observation, still readable during cleanup.
    pub fn disposed(&self) -> bool {
        self.disposed
    }
    /// First error presence; its exact opaque value belongs to JS.
    pub fn fatal(&self) -> bool {
        self.fatal
    }
    /// Current semantic profile stage.
    pub fn profile(&self) -> ProfilePhase {
        self.profile
    }
    /// Frame/draw suppression while acquisition fulfills.
    pub fn acquiring(&self) -> bool {
        self.profile == ProfilePhase::Acquiring
    }
    /// Selected modes poison caught owner reentry, unlike the legacy path.
    pub fn poison_reentry(&self, active: bool, reconciling: bool, checking: bool) -> bool {
        (self.rows || self.local) && (active || reconciling || checking)
    }
    /// Native packet entry guard does not add the run/fatal policy.
    pub fn packet_rejected(&self, active: bool) -> bool {
        self.disposed || active
    }
    /// Generic public operation admission, preserving mode-specific reconcile guard.
    pub fn run_rejected(&self, active: bool, checking: bool, reconciling: bool) -> bool {
        self.disposed || active || self.fatal || checking || (self.hud && reconciling)
    }
    /// External Play uses local-only reconciliation admission.
    pub fn play_rejected(&self, active: bool, checking: bool, reconciling: bool) -> bool {
        self.disposed || active || self.fatal || checking || (self.local && reconciling)
    }
    /// Live profile entry never adds a reconciliation guard.
    pub fn live_rejected(&self, active: bool, checking: bool) -> bool {
        self.disposed || active || self.fatal || checking
    }
    /// Selected modes check a newly retained fatal after callback return.
    pub fn post_callback_fatal(&self) -> bool {
        (self.rows || self.local) && self.fatal
    }
    /// Current native-document checks cannot proceed after terminal state.
    pub fn current_allowed(&self) -> bool {
        !self.disposed && !self.fatal
    }
    /// Notification committed before native scheduling.
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }
    /// Should the host try to enqueue its one captured microtask?
    pub fn may_schedule(&self, queued: bool) -> bool {
        !self.disposed && !queued
    }
    /// Pair first-error presence with the opaque host value without callbacks.
    pub fn retain_error(&mut self) -> bool {
        let first = !self.fatal;
        self.fatal = true;
        self.pending_pair = false;
        self.companion = false;
        self.dirty = true;
        first
    }
    /// Current reconciliation entry: skip, defer, dispose, or observe session.
    pub fn reconcile_entry(&self, active: bool) -> u8 {
        if self.disposed || self.acquiring() {
            0
        } else if active {
            1
        } else if self.fatal {
            2
        } else {
            3
        }
    }
    /// Compare after lag reset/acknowledgement using the original captured boolean.
    pub fn needs_connected(&self, captured: bool) -> bool {
        self.native_connected != captured
    }
    /// Commit only after the native connection effect returned.
    pub fn connected_done(&mut self, captured: bool) {
        self.native_connected = captured;
    }
    /// Timer intent from the original session snapshot and current handle presence.
    pub fn timer_action(needed: bool, present: bool) -> u8 {
        if needed && !present {
            1
        } else if !needed {
            2
        } else {
            0
        }
    }
    /// Clear dirtiness before reading captured session status fields or calling the host.
    pub fn take_status(&mut self) -> bool {
        if !self.dirty {
            return false;
        }
        self.dirty = false;
        true
    }
    /// Project the captured session phase without replacing pending connection presentation.
    pub fn status(phase: &str, connected: bool) -> u8 {
        if phase == "ready" {
            1
        } else if connected {
            2
        } else if matches!(phase, "opening" | "challenge" | "setup") {
            4
        } else {
            3
        }
    }
    /// Choose opaque pending pair slot 1 over committed slot 0.
    pub fn packet_base(&self) -> u8 {
        u8::from(self.pending_pair)
    }
    /// Discard companion before a new native packet operation.
    pub fn clear_companion(&mut self) {
        self.companion = false;
    }
    /// A complete projector operation returned and its host object can be retained.
    pub fn stage_companion(&mut self) {
        self.companion = true;
    }
    /// Remove before reducers/observer; selected rows require an issued companion.
    pub fn take_companion(&mut self) -> bool {
        let present = self.companion;
        self.companion = false;
        !self.rows || present
    }
    /// Packet candidates remain hidden until the later safe reconciliation barrier.
    pub fn stage_packet(&mut self) -> bool {
        if !self.publication_allowed() {
            return false;
        }
        self.pending_pair = true;
        true
    }
    /// Coalesced pair selection is committed only after all current reconciliation effects.
    pub fn publish_pending(&mut self) -> bool {
        if self.fatal || self.disposed || !self.pending_pair {
            return false;
        }
        self.pending_pair = false;
        true
    }
    /// Native draw/frame candidates publish only at the existing post-callback gate.
    pub fn publication_allowed(&self) -> bool {
        self.hud && !self.fatal && !self.disposed
    }
    /// Frame control entry follows input connected/own observation.
    pub fn begin_frame(&mut self) {
        self.frame = FrameStage::Controller;
        self.control = ControlStage::Idle;
    }
    /// Current frame continuation, for one next domain effect only.
    pub fn frame_stage(&self) -> FrameStage {
        self.frame
    }
    /// Native frame return permits the selected score observation next.
    pub fn frame_score_required(&self) -> bool {
        self.hud && self.frame == FrameStage::Score
    }
    /// Socket construction cannot precede controller/source and score completion.
    pub fn frame_commit_allowed(&self) -> bool {
        self.frame == FrameStage::Commit
    }
    /// Pair publication follows the successful session commit observation.
    pub fn frame_publication_allowed(&self) -> bool {
        self.frame == FrameStage::Publish && self.publication_allowed()
    }
    /// Native input observation must precede debt, then lifecycle.
    pub fn begin_control(&mut self) {
        self.control = ControlStage::Debt;
    }
    /// Whole-step input debt has committed before session afterStep.
    pub fn debt_done(&mut self) {
        self.control = ControlStage::Lifecycle;
    }
    /// Preserve truthiness of admitted native action resetWorld at its original read.
    pub fn lifecycle_done(&mut self, reset: bool) {
        self.control = if reset {
            ControlStage::Reset
        } else {
            ControlStage::Input
        };
    }
    /// Only reset bypasses input sends and returns actions immediately.
    pub fn reset_input(&self) -> bool {
        self.control == ControlStage::Reset
    }
    /// Native control may send only on the nonreset branch after lifecycle.
    pub fn input_allowed(&self) -> bool {
        self.control == ControlStage::Input
    }
    /// The first resetWorld observation controls selected history resets.
    pub fn history_reset(&self, reset: bool) -> bool {
        self.hud && reset
    }
    /// After input reset or the complete existing input tick.
    pub fn control_done(&mut self) {
        self.control = ControlStage::Complete;
    }
    /// Existing selected announcement fields accompany session lifecycle.
    pub fn include_announcements(&self) -> bool {
        self.announcements
    }
    /// Existing return-only minimap observation does not add a clock.
    pub fn include_minimap(&self, returning: bool) -> bool {
        self.minimap && returning
    }
    /// Controller and held-source release returned; required HUD draw comes next.
    pub fn controller_done(&mut self) {
        self.frame = FrameStage::Score;
    }
    /// Required score/readout operation returned before socket commitment.
    pub fn score_done(&mut self) {
        self.frame = FrameStage::Commit;
    }
    /// Observe constructor count then connected in their original host expression order.
    pub fn commit_profile(&mut self, attempted: bool) -> bool {
        if self.profile == ProfilePhase::Ready && attempted {
            self.profile = ProfilePhase::Committed;
            true
        } else {
            false
        }
    }
    /// Complete native/session commit observations before paired publication.
    pub fn frame_commit_done(&mut self, connected: bool) {
        self.native_connected = connected;
        self.frame = FrameStage::Publish;
    }
    /// End frame only after its paired publication gate.
    pub fn finish_frame(&mut self) {
        self.frame = FrameStage::Idle;
    }
    /// Whether source readiness must be checked around native operations.
    pub fn profile_needs_current(&self) -> bool {
        self.profile == ProfilePhase::Ready
    }
    /// Admission of one new live-profile request; native buffers remain JS-owned.
    pub fn profile_available(&self) -> bool {
        self.profile != ProfilePhase::Unavailable
    }
    /// Preserve short-circuit before reading session phase on an already used attempt.
    pub fn profile_idle(&self) -> bool {
        self.profile == ProfilePhase::Idle
    }
    /// The acquiring phase commits before any request reflection/allocation.
    pub fn begin_profile(&mut self) {
        self.profile = ProfilePhase::Acquiring;
        self.attempt_started = false;
    }
    /// Start one consumed attempt before constructing its native acquirer.
    pub fn profile_started(&mut self) {
        self.attempt_started = true;
    }
    /// Failure before the attempt is correctable only while still live.
    pub fn profile_retry_allowed(&self) -> bool {
        !self.attempt_started && !self.disposed
    }
    /// Preserve the existing unconditional assignments after owned request cleanup.
    pub fn profile_retry(&mut self) {
        self.profile = ProfilePhase::Idle;
    }
    /// Fulfillment and all current-document/quality/clear effects have returned.
    pub fn profile_ready(&mut self) {
        self.profile = ProfilePhase::Ready;
        self.dirty = true;
    }
    /// A failed current-document/acquisition observation consumes the semantic phase.
    pub fn profile_failed(&mut self) {
        self.profile = ProfilePhase::Failed;
    }
    /// Local replacement requires the next explicit Play, never automatic reconnect.
    pub fn replace_local(&self, disconnected: bool, returned_victory: bool) -> bool {
        self.local && (disconnected || returned_victory)
    }
    /// Exact admitted nickname code units, after session.play and fatal observation.
    pub fn set_nickname(&mut self, units: &[u16]) {
        self.nickname = units.to_vec();
    }
    /// Copied nickname, with no UTF-8/lossy string conversion.
    pub fn nickname(&self) -> Vec<u16> {
        self.nickname.clone()
    }
    /// Commit terminal semantics before ordered host cleanup; no resources are freed here.
    pub fn begin_dispose(&mut self) {
        self.disposed = true;
        self.profile = ProfilePhase::Disposed;
        self.pending_pair = false;
        self.companion = false;
        self.nickname.clear();
    }
    /// Claim once before invoking onFatal, retaining exact opaque failure in JS.
    pub fn claim_fatal_notification(&mut self) -> bool {
        if self.fatal && !self.notified {
            self.notified = true;
            true
        } else {
            false
        }
    }
}

/// Math.ceil semantics, including negative zero/nonfinite values; host performs ToNumber first.
pub fn css_ceil(value: f64) -> f64 {
    value.ceil()
}
