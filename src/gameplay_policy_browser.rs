//! Copied scalar/tuple boundary for the browser-free gameplay owner.
use crate::gameplay_policy::{self, GameplayPolicy as Policy};
use wasm_bindgen::prelude::*;
/// Gameplay semantic state; no native callbacks or issued JS values.
#[wasm_bindgen]
pub struct GameplayPolicy {
    inner: Policy,
}
#[wasm_bindgen]
impl GameplayPolicy {
    /// Allocate independent gameplay policy after existing host preflight.
    #[wasm_bindgen(constructor)]
    pub fn new(
        hud: bool,
        rows: bool,
        local: bool,
        minimap: bool,
        announcements: bool,
        profile: bool,
    ) -> Self {
        Self {
            inner: Policy::new(hud, rows, local, minimap, announcements, profile),
        }
    }
    /// Numeric snapshot; JS object allocation happens after the borrow returns.
    pub fn snapshot(&self) -> Vec<f64> {
        self.inner.snapshot().into_iter().map(f64::from).collect()
    }
    /// Native timer handle observation, without owning a timer.
    pub fn timer_action(needed: bool, present: bool) -> u8 {
        Policy::timer_action(needed, present)
    }
    /// Math.ceil on a host-coerced number; no admission or new layout rule.
    pub fn css_ceil(value: f64) -> f64 {
        gameplay_policy::css_ceil(value)
    }
    /// Exact admitted UTF-16 units, with no JS string conversion during a borrow.
    pub fn set_nickname(&mut self, units: &[u16]) {
        self.inner.set_nickname(units)
    }
    /// Copied UTF-16 output; the host reconstructs its existing string afterward.
    pub fn nickname(&self) -> Vec<u16> {
        self.inner.nickname()
    }
    /// Terminal flag.
    pub fn disposed(&self) -> bool {
        self.inner.disposed()
    }
    /// First-failure presence.
    pub fn fatal(&self) -> bool {
        self.inner.fatal()
    }
    /// Profile stage.
    pub fn profile(&self) -> u8 {
        self.inner.profile() as u8
    }
    /// Frame acquisition lock.
    pub fn acquiring(&self) -> bool {
        self.inner.acquiring()
    }
    /// Selected reentry poisoning.
    pub fn poison_reentry(&self, active: bool, reconciling: bool, checking: bool) -> bool {
        self.inner.poison_reentry(active, reconciling, checking)
    }
    /// Packet resource admission.
    pub fn packet_rejected(&self, active: bool) -> bool {
        self.inner.packet_rejected(active)
    }
    /// Run semantic admission.
    pub fn run_rejected(&self, active: bool, checking: bool, reconciling: bool) -> bool {
        self.inner.run_rejected(active, checking, reconciling)
    }
    /// Manual Play admission.
    pub fn play_rejected(&self, active: bool, checking: bool, reconciling: bool) -> bool {
        self.inner.play_rejected(active, checking, reconciling)
    }
    /// Profile entry admission.
    pub fn live_rejected(&self, active: bool, checking: bool) -> bool {
        self.inner.live_rejected(active, checking)
    }
    /// Selected post-callback failure.
    pub fn post_callback_fatal(&self) -> bool {
        self.inner.post_callback_fatal()
    }
    /// Current-document state gate.
    pub fn current_allowed(&self) -> bool {
        self.inner.current_allowed()
    }
    /// Latch status dirtiness.
    pub fn mark_dirty(&mut self) {
        self.inner.mark_dirty()
    }
    /// Scheduling dirtiness.
    pub fn dirty(&self) -> bool {
        self.inner.snapshot()[2] != 0
    }
    /// Schedule resource observation.
    pub fn may_schedule(&self, queued: bool) -> bool {
        self.inner.may_schedule(queued)
    }
    /// Commit first-error presence.
    pub fn retain_error(&mut self) -> bool {
        self.inner.retain_error()
    }
    /// Next reconciliation action.
    pub fn reconcile_entry(&self, active: bool) -> u8 {
        self.inner.reconcile_entry(active)
    }
    /// Captured connection observation.
    pub fn needs_connected(&self, captured: bool) -> bool {
        self.inner.needs_connected(captured)
    }
    /// Commit successful native connection effect.
    pub fn connected_done(&mut self, captured: bool) {
        self.inner.connected_done(captured)
    }
    /// Commit status observation before callback.
    pub fn take_status(&mut self) -> bool {
        self.inner.take_status()
    }
    /// Select pending or published issued-object slot.
    pub fn packet_base(&self) -> u8 {
        self.inner.packet_base()
    }
    /// Discard companion presence.
    pub fn clear_companion(&mut self) {
        self.inner.clear_companion()
    }
    /// Commit complete companion presence.
    pub fn stage_companion(&mut self) {
        self.inner.stage_companion()
    }
    /// Consume companion before reducers.
    pub fn take_companion(&mut self) -> bool {
        self.inner.take_companion()
    }
    /// Stage a hidden pair after observer.
    pub fn stage_packet(&mut self) -> bool {
        self.inner.stage_packet()
    }
    /// Pair publication after reconciliation.
    pub fn publish_pending(&mut self) -> bool {
        self.inner.publish_pending()
    }
    /// Current draw publication barrier.
    pub fn publication_allowed(&self) -> bool {
        self.inner.publication_allowed()
    }
    /// Start native frame continuation.
    pub fn begin_frame(&mut self) {
        self.inner.begin_frame()
    }
    /// Current frame continuation.
    pub fn frame_stage(&self) -> u8 {
        self.inner.frame_stage() as u8
    }
    /// Input observations precede debt.
    pub fn begin_control(&mut self) {
        self.inner.begin_control()
    }
    /// Debt precedes lifecycle.
    pub fn debt_done(&mut self) {
        self.inner.debt_done()
    }
    /// Select reset versus input.
    pub fn lifecycle_done(&mut self, reset: bool) {
        self.inner.lifecycle_done(reset)
    }
    /// Reset bypasses input.
    pub fn reset_input(&self) -> bool {
        self.inner.reset_input()
    }
    /// Control actions completed.
    pub fn control_done(&mut self) {
        self.inner.control_done()
    }
    /// Selected announcement forwarding.
    pub fn include_announcements(&self) -> bool {
        self.inner.include_announcements()
    }
    /// Selected minimap forwarding.
    pub fn include_minimap(&self, returning: bool) -> bool {
        self.inner.include_minimap(returning)
    }
    /// Native operation and sources returned.
    pub fn controller_done(&mut self) {
        self.inner.controller_done()
    }
    /// Score observation returned.
    pub fn score_done(&mut self) {
        self.inner.score_done()
    }
    /// Consume committed profile intent.
    pub fn commit_profile(&mut self, attempted: bool) -> bool {
        self.inner.commit_profile(attempted)
    }
    /// Observe completed commit.
    pub fn frame_commit_done(&mut self, connected: bool) {
        self.inner.frame_commit_done(connected)
    }
    /// Frame publication completed.
    pub fn finish_frame(&mut self) {
        self.inner.finish_frame()
    }
    /// Profile currency check gate.
    pub fn profile_needs_current(&self) -> bool {
        self.inner.profile_needs_current()
    }
    /// Explicit profile capability mode.
    pub fn profile_available(&self) -> bool {
        self.inner.profile_available()
    }
    /// Correctable profile entry.
    pub fn profile_idle(&self) -> bool {
        self.inner.profile_idle()
    }
    /// Commit acquiring before host reflection.
    pub fn begin_profile(&mut self) {
        self.inner.begin_profile()
    }
    /// Consume attempt before acquirer.
    pub fn profile_started(&mut self) {
        self.inner.profile_started()
    }
    /// Pre-start retry eligibility.
    pub fn profile_retry_allowed(&self) -> bool {
        self.inner.profile_retry_allowed()
    }
    /// Commit correctable retry.
    pub fn profile_retry(&mut self) {
        self.inner.profile_retry()
    }
    /// Commit fulfilled profile and dirty state.
    pub fn profile_ready(&mut self) {
        self.inner.profile_ready()
    }
    /// Commit failed profile phase.
    pub fn profile_failed(&mut self) {
        self.inner.profile_failed()
    }
    /// Explicit local session replacement.
    pub fn replace_local(&self, disconnected: bool, returned_victory: bool) -> bool {
        self.inner.replace_local(disconnected, returned_victory)
    }
    /// Terminal flags precede cleanup.
    pub fn begin_dispose(&mut self) {
        self.inner.begin_dispose()
    }
    /// Claim first fatal notification.
    pub fn claim_fatal_notification(&mut self) -> bool {
        self.inner.claim_fatal_notification()
    }

    /// Native controller return selects required score.
    pub fn frame_score_required(&self) -> bool {
        self.inner.frame_score_required()
    }

    /// Socket commit eligibility.
    pub fn frame_commit_allowed(&self) -> bool {
        self.inner.frame_commit_allowed()
    }

    /// Pair publication follows commit.
    pub fn frame_publication_allowed(&self) -> bool {
        self.inner.frame_publication_allowed()
    }

    /// Only nonreset control sends input.
    pub fn input_allowed(&self) -> bool {
        self.inner.input_allowed()
    }

    /// First reset observation selects history reset.
    pub fn history_reset(&self, reset: bool) -> bool {
        self.inner.history_reset(reset)
    }

    /// Status of the captured session fields.
    pub fn status(phase: &str, connected: bool) -> u8 {
        Policy::status(phase, connected)
    }
}
