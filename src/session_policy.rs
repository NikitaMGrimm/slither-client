//! Browser-free production session phases, command-time lifecycle and control intents.

/// A policy rejection whose message preserves the existing boundary contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionError(pub &'static str);
/// Result from a pure session transition.
pub type Result<T> = std::result::Result<T, SessionError>;

/// Retained production session phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Awaiting explicit Play.
    Ready,
    /// Launch staged or socket opening.
    Opening,
    /// Negotiation sent; challenge expected.
    Challenge,
    /// Login sent; Setup expected.
    Setup,
    /// Setup committed and gameplay active.
    Playing,
    /// Victory life control retained.
    Victory,
    /// Ordinary death awaiting return.
    Dead,
    /// Terminal failure; no retry.
    Failed,
    /// Terminal close; no automatic reconnect.
    Disconnected,
}
impl Phase {
    /// Existing externally observed phase label.
    pub fn label(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Opening => "opening",
            Self::Challenge => "challenge",
            Self::Setup => "setup",
            Self::Playing => "playing",
            Self::Victory => "victory",
            Self::Dead => "dead",
            Self::Failed => "failed",
            Self::Disconnected => "disconnected",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UiPhase {
    Idle,
    In,
    Out,
}
/// A command after structural decoding and version/canonical-control admission.
#[derive(Debug, Clone, Copy)]
pub struct Command {
    /// Wire opcode.
    pub opcode: u8,
    /// First payload byte, used only for life controls.
    pub argument: u8,
}
/// Pre-command lifecycle observation for HUD ingress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Guard {
    /// Whether this command runs while playing.
    pub playing: bool,
    /// Whether close has already been requested.
    pub close_requested: bool,
    /// Whether death time is retained.
    pub death_pending: bool,
}
/// Copied transaction plan. Preparing it does not commit live controls.
#[derive(Debug, Clone)]
pub struct IngressPlan {
    /// Selected copied report schema, zero without HUD.
    pub schema: u8,
    /// Exactly one guard per command when HUD is selected.
    pub guards: Vec<Guard>,
    /// Ordered exhaustive final-score capture indices.
    pub final_capture_indices: Vec<usize>,
}
/// Copied report event metadata; JS retains record/buffer admission.
#[derive(Debug, Clone, Copy)]
pub struct ReportEvent {
    /// Original command index.
    pub command_index: usize,
    /// Setup=0, setup-draw=1, leaderboard=2, final-score=3, own-length=4.
    pub kind: u8,
    /// Leaderboard pre-command death guard.
    pub death_pending: bool,
}
/// Pending scene actions. Presence of connected=false is retained separately.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Actions {
    /// Reset the native world before transport construction.
    pub reset_world: bool,
    /// Publish disconnected to the scene.
    pub disconnected: bool,
    /// Reset the independent lag multiplier.
    pub reset_lag: bool,
    order: Vec<u8>,
}
impl Actions {
    fn insert_reset(&mut self) {
        if !self.reset_world {
            self.order.push(0);
        }
        if !self.disconnected {
            self.order.push(1);
        }
        self.reset_world = true;
        self.disconnected = true;
    }
    fn insert_lag(&mut self) {
        if !self.reset_lag {
            self.order.push(2);
        }
        self.reset_lag = true;
    }
    fn remove_lag(&mut self) {
        self.reset_lag = false;
        self.order.retain(|key| *key != 2);
    }
    /// Preserve source object insertion order in the copied action record.
    pub fn ordered_fields(&self) -> impl Iterator<Item = (&'static str, bool)> + '_ {
        self.order.iter().map(|key| match key {
            0 => ("resetWorld", true),
            1 => ("connected", false),
            _ => ("resetLag", true),
        })
    }
}
/// Post-step return observation.
#[derive(Debug, Clone, Copy)]
pub struct Lifecycle {
    /// Whether death is still pending.
    pub death_pending: bool,
    /// Whether this step reduces the return fraction.
    pub return_active: bool,
    /// Whether this step completes return.
    pub return_completed: bool,
    /// Current source arithmetic fraction.
    pub return_fraction: f64,
}
/// Detached session observations.
#[derive(Debug, Clone)]
pub struct View {
    /// Session phase.
    pub phase: Phase,
    /// Setup has committed.
    pub connected: bool,
    /// Gameplay remains active.
    pub playing: bool,
    /// Any non-close life control has committed.
    pub life_ended: bool,
    /// Outstanding ping crossed the strict lag threshold.
    pub lagging: bool,
    /// A ping is outstanding.
    pub ping_pending: bool,
    /// Most recent committed ping time.
    pub last_ping_ms: f64,
    /// A close life control is pending.
    pub close_requested: bool,
    /// Current fade/return fraction.
    pub return_fraction: f64,
    /// Fade-in caller timer remains needed.
    pub ui_timer_needed: bool,
    /// Exact arbitrary JS close reason as copied UTF-16 code units.
    pub reason: Option<Vec<u16>>,
    /// Transport constructor attempts.
    pub constructor_attempts: u32,
}
#[derive(Debug, Clone)]
struct Controls {
    phase: Phase,
    connected: bool,
    playing: bool,
    life_ended: bool,
    lagging: bool,
    ping_pending: bool,
    close_requested: bool,
    death_ms: Option<f64>,
    previous_ui_ms: f64,
    ui_phase: UiPhase,
    actions: Actions,
    revision: f64,
}
#[derive(Debug, Clone)]
struct Staged {
    next: Controls,
    commands: Vec<Command>,
    plan: IngressPlan,
}
/// Caller-clocked domain owner. Contains no socket, scheduler, JS identity or callback.
#[derive(Debug, Clone)]
pub struct SessionPolicy {
    control: Controls,
    subscribed: bool,
    schema: u8,
    reason: Option<Vec<u16>>,
    last_ping_ms: f64,
    ping_external: bool,
    started_ms: Option<f64>,
    constructor_attempts: u32,
    launch: bool,
    launch_committed: bool,
    step_revision: Option<f64>,
    return_fraction: f64,
    handshake_frames: u32,
    handshake_bytes: usize,
    staged: Option<Staged>,
}
impl Default for SessionPolicy {
    fn default() -> Self {
        Self::new()
    }
}
impl SessionPolicy {
    /// Create the initially ready, disconnected session.
    pub fn new() -> Self {
        Self {
            control: Controls {
                phase: Phase::Ready,
                connected: false,
                playing: false,
                life_ended: false,
                lagging: false,
                ping_pending: false,
                close_requested: false,
                death_ms: None,
                previous_ui_ms: 0.0,
                ui_phase: UiPhase::Idle,
                actions: Actions::default(),
                revision: 0.0,
            },
            subscribed: false,
            schema: 0,
            reason: None,
            last_ping_ms: 0.0,
            ping_external: false,
            started_ms: None,
            constructor_attempts: 0,
            launch: false,
            launch_committed: false,
            step_revision: None,
            return_fraction: 0.0,
            handshake_frames: 0,
            handshake_bytes: 0,
            staged: None,
        }
    }
    /// Copy current public observations.
    pub fn view(&self) -> View {
        let c = &self.control;
        View {
            phase: c.phase,
            connected: c.connected,
            playing: c.playing,
            life_ended: c.life_ended,
            lagging: c.lagging,
            ping_pending: c.ping_pending,
            last_ping_ms: self.last_ping_ms,
            close_requested: c.close_requested,
            return_fraction: self.return_fraction,
            ui_timer_needed: c.ui_phase == UiPhase::In,
            reason: self.reason.clone(),
            constructor_attempts: self.constructor_attempts,
        }
    }
    /// Whether stop has already committed.
    pub fn terminal(&self) -> bool {
        matches!(self.control.phase, Phase::Failed | Phase::Disconnected)
    }
    /// Current copied HUD mode.
    pub fn schema(&self) -> u8 {
        self.schema
    }
    /// Check the once-only subscription before and after JS admission.
    pub fn check_subscribe(&self) -> Result<()> {
        if self.subscribed || self.control.phase != Phase::Ready {
            Err(SessionError("One subscriber required before Play"))
        } else {
            Ok(())
        }
    }
    /// Commit an admitted subscription mode.
    pub fn subscribe(&mut self, schema: u8) -> Result<()> {
        if schema > 2 {
            return Err(SessionError("Invalid HUD schema"));
        }
        self.subscribed = true;
        self.schema = schema;
        Ok(())
    }
    /// Check manual launch before JS profile/endpoint/encoder admission.
    pub fn check_play(&self, has_sink: bool) -> Result<()> {
        if !has_sink || self.control.phase != Phase::Ready {
            Err(SessionError("One manual Play per session"))
        } else {
            Ok(())
        }
    }
    /// Retain a pending launch and initial reset before notifying JS.
    pub fn begin_play(&mut self) {
        self.launch = true;
        self.control.phase = Phase::Opening;
        self.request_reset();
    }
    fn request_reset(&mut self) {
        self.control.actions.insert_reset();
        self.control.revision += 1.0;
    }
    /// Commit terminal flags before JS login scrubbing, detach and close effects.
    pub fn begin_stop(&mut self, failed: bool, reason: Vec<u16>) -> bool {
        if self.terminal() {
            return false;
        }
        self.control.phase = if failed {
            Phase::Failed
        } else {
            Phase::Disconnected
        };
        self.reason = Some(reason);
        self.control.connected = false;
        self.control.playing = false;
        self.control.lagging = false;
        self.control.ping_pending = false;
        self.control.close_requested = false;
        self.control.ui_phase = UiPhase::Idle;
        self.launch = false;
        true
    }
    /// Commit reset actions after listener-detach callbacks, before socket close.
    pub fn stop_actions(&mut self) {
        self.request_reset();
    }
    /// Commit the clock and attempt before invoking the transport constructor.
    pub fn begin_construct(&mut self, now: f64) -> Result<()> {
        finite(now, "Invalid clock")?;
        self.started_ms = Some(now);
        self.constructor_attempts += 1;
        Ok(())
    }
    /// Validate opening before either prefix send.
    pub fn check_open(&self) -> Result<()> {
        if self.control.phase != Phase::Opening {
            Err(SessionError("Unexpected socket open"))
        } else {
            Ok(())
        }
    }
    /// Copy a selected negotiation packet without changing phase.
    pub fn negotiation_packet(index: u8) -> Result<Vec<u8>> {
        match index {
            0 => Ok(vec![1]),
            1 => Ok(vec![99, 0]),
            _ => Err(SessionError("Invalid negotiation packet")),
        }
    }
    /// Commit challenge phase after both prefix sends return.
    pub fn opened(&mut self) {
        self.control.phase = Phase::Challenge;
    }
    /// Charge pre-Setup frames before invoking structural decode.
    pub fn receive_bytes(&mut self, size: usize) -> Result<()> {
        if !self.control.connected {
            self.handshake_frames += 1;
            self.handshake_bytes += size;
            if self.handshake_frames > 16 || self.handshake_bytes > 1_048_576 {
                return Err(SessionError("Handshake receive budget exceeded"));
            }
        }
        Ok(())
    }
    /// Select challenge handling or admit the phase/header before per-command callbacks.
    pub fn receive_header(&self, count: usize, first: u8) -> Result<bool> {
        if self.control.phase == Phase::Challenge {
            if count != 1 || first != 54 {
                return Err(SessionError("Expected one challenge command"));
            }
            return Ok(true);
        }
        if !self.control.connected && self.control.phase != Phase::Setup {
            return Err(SessionError("Unexpected protocol frame"));
        }
        if self.control.phase == Phase::Setup && first != 97 {
            return Err(SessionError("Expected Setup after login"));
        }
        Ok(false)
    }
    /// Canonical command admission; true requests the existing setup-version capability.
    pub fn command_requires_version(&self, opcode: u8, length: usize) -> Result<bool> {
        match opcode {
            54 => Err(SessionError("Repeated challenge")),
            112 if length != 1 => Err(SessionError("Invalid pong")),
            118 if length != 2 => Err(SessionError("Invalid life control")),
            _ => Ok(opcode == 97),
        }
    }
    /// Admit advertised production protocol without changing the control state.
    pub fn admit_protocol(&self, version: f64) -> Result<()> {
        if version != 19.0 {
            Err(SessionError("Unsupported protocol"))
        } else {
            Ok(())
        }
    }
    /// Commit Setup phase only after reply and login sends complete.
    pub fn challenged(&mut self) {
        self.launch = false;
        self.control.phase = Phase::Setup;
    }
    /// Prepare command-time lifecycle history without committing it before packet success.
    pub fn prepare_controls(&mut self, commands: &[Command], received: f64) -> Result<IngressPlan> {
        finite(received, "Invalid clock")?;
        let mut next = self.control.clone();
        let mut plan = IngressPlan {
            schema: self.schema,
            guards: Vec::new(),
            final_capture_indices: Vec::new(),
        };
        for (index, cmd) in commands.iter().enumerate() {
            if self.schema != 0 {
                plan.guards.push(Guard {
                    playing: next.playing,
                    close_requested: next.close_requested,
                    death_pending: next.death_ms.is_some(),
                });
                if cmd.opcode == 118 && cmd.argument != 2 && next.playing && !next.close_requested {
                    plan.final_capture_indices.push(index)
                }
            }
            match cmd.opcode {
                97 => {
                    next.connected = true;
                    next.playing = true;
                    next.phase = Phase::Playing;
                    next.previous_ui_ms = received;
                    next.ui_phase = UiPhase::In
                }
                112 => {
                    next.ping_pending = false;
                    next.lagging = false
                }
                118 => {
                    if cmd.argument == 2 {
                        next.close_requested = true
                    } else {
                        next.death_ms = Some(received);
                        next.life_ended = true;
                        next.lagging = false;
                        next.actions.insert_lag();
                        next.revision += 1.0;
                        if next.playing && !next.close_requested {
                            if cmd.argument == 1 {
                                next.phase = Phase::Victory
                            } else {
                                next.close_requested = true;
                                next.phase = Phase::Dead
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        self.staged = Some(Staged {
            next,
            commands: commands.to_vec(),
            plan: plan.clone(),
        });
        Ok(plan)
    }
    /// Check admitted HUD report event order against the retained transaction plan.
    pub fn match_report(&self, events: &[ReportEvent], setup_draws: usize) -> Result<()> {
        let staged = self
            .staged
            .as_ref()
            .ok_or(SessionError("No prepared controls"))?;
        if staged.plan.schema == 0 {
            return Err(SessionError("HUD subscription required"));
        }
        let mut event_index = 0;
        let mut capture_index = 0;
        let mut setups = 0;
        for (index, cmd) in staged.commands.iter().enumerate() {
            let expected = if cmd.opcode == 97 {
                setups += 1;
                Some(0)
            } else if cmd.opcode == 108 && staged.plan.guards[index].playing {
                Some(2)
            } else if staged.plan.final_capture_indices.get(capture_index) == Some(&index) {
                capture_index += 1;
                Some(3)
            } else {
                None
            };
            let current = events.get(event_index);
            if let Some(kind) = expected {
                let event = current.ok_or(SessionError("Missing HUD event"))?;
                if event.command_index != index || event.kind != kind {
                    return Err(SessionError("Missing HUD event"));
                }
                if kind == 2 && event.death_pending != staged.plan.guards[index].death_pending {
                    return Err(SessionError("Invalid HUD death guard"));
                }
                event_index += if kind == 0 { 2 } else { 1 };
            } else if let Some(event) = current.filter(|e| e.command_index == index) {
                if event.kind != 4 || ![115, 110, 78, 43, 104, 114].contains(&cmd.opcode) {
                    return Err(SessionError("Unexpected HUD event"));
                }
                event_index += 1
            }
        }
        if event_index != events.len() || setups != setup_draws {
            return Err(SessionError("Unexpected HUD events"));
        }
        Ok(())
    }
    /// Publish prepared controls after packet/result admission and liveness fences.
    pub fn commit_controls(&mut self) -> Result<()> {
        if self.terminal() {
            return Err(SessionError("Session stopped during packet"));
        }
        self.control = self
            .staged
            .take()
            .ok_or(SessionError("No prepared controls"))?
            .next;
        Ok(())
    }
    /// Strict handshake timeout query before JS terminal/error effects.
    pub fn handshake_timed_out(&self, now: f64) -> bool {
        !self.terminal()
            && !self.control.connected
            && self.started_ms.is_some_and(|start| now - start > 3333.0)
    }
    /// Gate arithmetic before an opaque host value can run coercion callbacks.
    pub fn lag_check_needed(&self) -> bool {
        !self.terminal() && !self.control.lagging && self.control.ping_pending
    }
    /// Commit the already-admitted comparison after host coercion has returned.
    /// Earlier gates are deliberately not rechecked: coercion may change phase.
    pub fn observe_lag_elapsed(&mut self, elapsed: f64) {
        if elapsed > 750.0 {
            self.control.lagging = true;
        }
    }
    /// Observe a numeric retained clock without a host coercion callback.
    pub fn observe_lag(&mut self, now: f64) {
        if self.lag_check_needed() && !self.ping_external {
            self.observe_lag_elapsed(now - self.last_ping_ms);
        }
    }
    /// Current action revision and detached actions.
    pub fn actions(&self) -> (f64, Actions) {
        (self.control.revision, self.control.actions.clone())
    }
    /// Selectively consume lag reset after JS offered-record identity admission.
    pub fn acknowledge(&mut self, revision: f64) -> Result<()> {
        if revision != self.control.revision {
            return Err(SessionError("Stale action acknowledgement"));
        }
        if !self.control.actions.reset_lag {
            return Err(SessionError("No lag reset to acknowledge"));
        }
        self.control.actions.remove_lag();
        self.control.revision += 1.0;
        Ok(())
    }
    /// Validate step sequencing before reading the caller's metadata fields.
    pub fn check_step(&self, hud: bool) -> Result<()> {
        if hud && self.schema == 0 {
            return Err(SessionError("HUD subscription required"));
        }
        if self.step_revision.is_some() {
            return Err(SessionError("Previous control step is not committed"));
        }
        Ok(())
    }
    /// Whether step admission must reread the caller's time property.
    pub fn has_death(&self) -> bool {
        self.control.death_ms.is_some()
    }
    /// Capture the right operand after the host's second getter has returned.
    pub fn death_time(&self) -> Option<f64> {
        self.control.death_ms
    }
    /// Numeric expression projection from already captured operands. Null becomes zero.
    pub fn death_elapsed(now: f64, death: Option<f64>) -> f64 {
        now - death.unwrap_or(0.0)
    }
    /// Advance a native numeric step without host coercion callbacks.
    pub fn advance_step(&mut self, now: f64, delta: f64, whole: f64) -> Result<(Lifecycle, bool)> {
        let present = self.has_death();
        let elapsed = Self::death_elapsed(now, self.death_time());
        self.advance_step_elapsed(present, elapsed, delta, whole)
    }
    /// Apply the captured comparison to current post-callback UI/action state.
    /// Do not recapture death or clone controls that may have changed during coercion.
    pub fn advance_step_elapsed(
        &mut self,
        death_present: bool,
        elapsed: f64,
        delta: f64,
        whole: f64,
    ) -> Result<(Lifecycle, bool)> {
        finite(delta, "Invalid lagged step")?;
        if !(0.0..=5.0).contains(&delta)
            || !whole.is_finite()
            || whole.fract() != 0.0
            || !(0.0..=5.0).contains(&whole)
        {
            return Err(SessionError("Invalid lagged step"));
        }
        let mut active = false;
        let mut completed = false;
        if death_present && elapsed > 1600.0 {
            if self.control.ui_phase == UiPhase::Idle {
                self.control.ui_phase = UiPhase::Out
            }
            if self.control.ui_phase == UiPhase::Out {
                active = true;
                self.return_fraction -= 0.004 * delta;
                if self.return_fraction <= 0.0 {
                    completed = true;
                    self.return_fraction = 0.0;
                    self.control.death_ms = None;
                    self.control.playing = false;
                    self.control.ui_phase = UiPhase::Idle
                }
            }
        }
        let close =
            self.control.close_requested && self.control.death_ms.is_none() && !self.terminal();
        Ok((
            Lifecycle {
                death_pending: self.control.death_ms.is_some(),
                return_active: active,
                return_completed: completed,
                return_fraction: self.return_fraction,
            },
            close,
        ))
    }
    /// Record actions only after any close notification side effects have completed.
    pub fn finish_step(&mut self, has_socket: bool) {
        self.step_revision = Some(self.control.revision);
        if self.launch && !has_socket && self.control.actions.reset_world {
            self.launch_committed = true
        }
    }
    /// Consume a native control commit and select one deferred transport construction.
    pub fn commit_control(&mut self, has_socket: bool) -> bool {
        let Some(revision) = self.step_revision.take() else {
            return false;
        };
        if revision == self.control.revision {
            self.control.actions = Actions::default();
            self.control.revision += 1.0
        }
        if self.launch_committed && self.launch && !has_socket && !self.terminal() {
            self.launch_committed = false;
            return true;
        }
        false
    }
    /// Whether the ping boundary should reread caller time.
    pub fn ping_available(&self) -> bool {
        self.control.connected && !self.control.ping_pending
    }
    /// Whether the retained third-read value has an opaque host representation.
    pub fn ping_external(&self) -> bool {
        self.ping_external
    }
    /// Compare elapsed time after all necessary host arithmetic coercions.
    pub fn ping_due_elapsed(elapsed: f64) -> bool {
        // The source uses an early <= gate; NaN deliberately proceeds.
        elapsed > 250.0 || elapsed.is_nan()
    }
    /// Compare a separately observed numeric time against a numeric retained clock.
    pub fn ping_due(&self, now: f64) -> bool {
        Self::ping_due_elapsed(now - self.last_ping_ms)
    }
    /// Commit the uncoerced numeric third read before returning its packet intent.
    pub fn commit_ping(&mut self, now: f64) -> Vec<u8> {
        self.last_ping_ms = now;
        self.ping_external = false;
        self.control.ping_pending = true;
        vec![251]
    }
    /// Commit host-value ownership without evaluating or retaining JS objects here.
    pub fn commit_opaque_ping(&mut self) -> Vec<u8> {
        self.last_ping_ms = f64::NAN;
        self.ping_external = true;
        self.control.ping_pending = true;
        vec![251]
    }
    /// Production protocol selection for launch and ping admission.
    pub fn protocol_allowed(version: f64) -> bool {
        version == 19.0
    }
    /// Admit compact production input packet values without sending them.
    pub fn valid_input(bytes: &[u8]) -> bool {
        matches!(bytes,[v] if *v<=254&&*v!=252) || matches!(bytes,[252,v] if *v!=0&&*v!=128)
    }
    /// Advance the separate fade-in clock with its existing operation order.
    pub fn ui_tick(&mut self, now: f64) -> Result<()> {
        finite(now, "Invalid UI time")?;
        if self.control.ui_phase != UiPhase::In || self.terminal() {
            return Ok(());
        }
        let units = (now - self.control.previous_ui_ms) / 25.0;
        self.control.previous_ui_ms = now;
        self.return_fraction += 0.05 * units;
        if self.return_fraction >= 1.0 {
            self.return_fraction = 1.0;
            self.control.ui_phase = UiPhase::Idle
        }
        Ok(())
    }
}
fn finite(value: f64, message: &'static str) -> Result<()> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(SessionError(message))
    }
}
