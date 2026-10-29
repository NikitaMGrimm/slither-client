//! Copied Wasm boundary for the browser-free production session owner.
use crate::session_policy::{self, Command, ReportEvent, SessionError, SessionPolicy as Policy};
use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::*;
fn error(e: SessionError) -> JsValue {
    js_sys::Error::new(e.0).into()
}
fn record(fields: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    // Copied output must not consult inherited data descriptors or setters.
    let result = Object::create(&JsValue::NULL.unchecked_into::<Object>());
    for (name, value) in fields {
        if !Reflect::set(&result, &JsValue::from_str(name), value)? {
            return Err(js_sys::TypeError::new("Session record copy failed").into());
        }
    }
    Ok(result.into())
}
fn actions(a: session_policy::Actions) -> Result<JsValue, JsValue> {
    let fields = a
        .ordered_fields()
        .map(|(key, value)| (key, value.into()))
        .collect::<Vec<_>>();
    record(&fields)
}
/// Production phase/lifecycle owner. Every method returns before host effects run.
#[wasm_bindgen]
pub struct SessionPolicy {
    inner: Policy,
}
impl Default for SessionPolicy {
    fn default() -> Self {
        Self::new()
    }
}
#[wasm_bindgen]
impl SessionPolicy {
    /// Initially ready; owns no host resources.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Policy::new(),
        }
    }
    /// Detached public observation.
    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        let v = self.inner.view();
        record(&[
            ("phase", v.phase.label().into()),
            ("connected", v.connected.into()),
            ("playing", v.playing.into()),
            ("lifeEnded", v.life_ended.into()),
            ("lagging", v.lagging.into()),
            ("pingPending", v.ping_pending.into()),
            ("lastPingMs", v.last_ping_ms.into()),
            ("closeRequested", v.close_requested.into()),
            ("returnFraction", v.return_fraction.into()),
            ("uiTimerNeeded", v.ui_timer_needed.into()),
            (
                "reason",
                v.reason
                    .map(|units| js_sys::Uint16Array::from(units.as_slice()).into())
                    .unwrap_or(JsValue::NULL),
            ),
            ("constructorAttempts", v.constructor_attempts.into()),
        ])
    }
    /// Terminal state at this effect boundary.
    pub fn terminal(&self) -> bool {
        self.inner.terminal()
    }
    /// Selected report schema.
    pub fn schema(&self) -> u8 {
        self.inner.schema()
    }
    /// Subscription check before record admission.
    pub fn check_subscribe(&self) -> Result<(), JsValue> {
        self.inner.check_subscribe().map_err(error)
    }
    /// Commit subscription.
    pub fn subscribe(&mut self, schema: u8) -> Result<(), JsValue> {
        self.inner.subscribe(schema).map_err(error)
    }
    /// Manual launch check before encoder callback.
    pub fn check_play(&self, has_sink: bool) -> Result<(), JsValue> {
        self.inner.check_play(has_sink).map_err(error)
    }
    /// Commit launch/reset before notification.
    pub fn begin_play(&mut self) {
        self.inner.begin_play()
    }
    /// Commit terminal flags before detach callbacks.
    pub fn begin_stop(&mut self, failed: bool, reason: &[u16]) -> bool {
        self.inner.begin_stop(failed, reason.to_vec())
    }
    /// Commit reset after detach callbacks.
    pub fn stop_actions(&mut self) {
        self.inner.stop_actions()
    }
    /// Commit constructor clock and attempt.
    pub fn begin_construct(&mut self, now: f64) -> Result<(), JsValue> {
        self.inner.begin_construct(now).map_err(error)
    }
    /// Validate open before negotiation sends.
    pub fn check_open(&self) -> Result<(), JsValue> {
        self.inner.check_open().map_err(error)
    }
    /// Copy a production negotiation intent.
    pub fn negotiation_packet(index: u8) -> Result<Vec<u8>, JsValue> {
        Policy::negotiation_packet(index).map_err(error)
    }
    /// Commit after negotiation sends.
    pub fn opened(&mut self) {
        self.inner.opened()
    }
    /// Charge undecoded ingress budget.
    pub fn receive_bytes(&mut self, size: u32) -> Result<(), JsValue> {
        self.inner.receive_bytes(size as usize).map_err(error)
    }
    /// Select challenge handling after structural decode.
    pub fn receive_header(&self, count: u32, first: u8) -> Result<bool, JsValue> {
        self.inner
            .receive_header(count as usize, first)
            .map_err(error)
    }
    /// Admit canonical command shape before optional version callback.
    pub fn command_requires_version(&self, opcode: u8, length: u32) -> Result<bool, JsValue> {
        self.inner
            .command_requires_version(opcode, length as usize)
            .map_err(error)
    }
    /// Admit advertised protocol.
    pub fn admit_protocol(&self, version: f64) -> Result<(), JsValue> {
        self.inner.admit_protocol(version).map_err(error)
    }
    /// Commit after reply and login effects.
    pub fn challenged(&mut self) {
        self.inner.challenged()
    }
    /// Copy pre-command guards from admitted opcode/argument pairs.
    pub fn prepare_controls(&mut self, bytes: &[u8], now: f64) -> Result<JsValue, JsValue> {
        let (pairs, remainder) = bytes.as_chunks::<2>();
        if !remainder.is_empty() {
            return Err(js_sys::TypeError::new("Invalid command pairs").into());
        }
        let commands = pairs
            .iter()
            .map(|p| Command {
                opcode: p[0],
                argument: p[1],
            })
            .collect::<Vec<_>>();
        let p = self.inner.prepare_controls(&commands, now).map_err(error)?;
        if p.schema == 0 {
            return Ok(JsValue::NULL);
        }
        let guards = Array::new();
        for g in p.guards {
            guards.push(&record(&[
                ("playing", g.playing.into()),
                ("closeRequested", g.close_requested.into()),
                ("deathPending", g.death_pending.into()),
            ])?);
        }
        let captures = Array::new();
        for i in p.final_capture_indices {
            captures.push(&(i as u32).into());
        }
        record(&[
            ("schema", p.schema.into()),
            ("commandCount", (commands.len() as u32).into()),
            ("guards", guards.into()),
            ("finalCaptureIndices", captures.into()),
        ])
    }
    /// Validate copied event index/kind/death triples against staged controls.
    pub fn match_report(&self, values: &[u32], setups: u32) -> Result<(), JsValue> {
        let (triples, remainder) = values.as_chunks::<3>();
        if !remainder.is_empty() {
            return Err(js_sys::TypeError::new("Invalid event triples").into());
        }
        let events = triples
            .iter()
            .map(|v| ReportEvent {
                command_index: v[0] as usize,
                kind: v[1] as u8,
                death_pending: v[2] != 0,
            })
            .collect::<Vec<_>>();
        self.inner
            .match_report(&events, setups as usize)
            .map_err(|e| JsValue::from(js_sys::TypeError::new(e.0)))
    }
    /// Commit only after callback results and generation fences pass.
    pub fn commit_controls(&mut self) -> Result<(), JsValue> {
        self.inner.commit_controls().map_err(error)
    }
    /// Query strict handshake timeout before error effects.
    pub fn handshake_timed_out(&self, now: f64) -> bool {
        self.inner.handshake_timed_out(now)
    }
    /// Whether a retained host value needs its delayed lag coercion.
    pub fn lag_check_needed(&self) -> bool {
        self.inner.lag_check_needed()
    }
    /// Apply a comparison admitted before opaque host coercion callbacks.
    pub fn observe_lag_elapsed(&mut self, elapsed: f64) {
        self.inner.observe_lag_elapsed(elapsed)
    }
    /// Observe lag after timeout effects.
    pub fn observe_lag(&mut self, now: f64) {
        self.inner.observe_lag(now)
    }
    /// Copy revision and pending scene actions.
    pub fn pending_actions(&self) -> Result<JsValue, JsValue> {
        let (revision, a) = self.inner.actions();
        record(&[("revision", revision.into()), ("actions", actions(a)?)])
    }
    /// Consume selective lag acknowledgement after JS object identity check.
    pub fn acknowledge(&mut self, revision: f64) -> Result<(), JsValue> {
        self.inner.acknowledge(revision).map_err(error)
    }
    /// Check sequencing before JS metadata access.
    pub fn check_step(&self, hud: bool) -> Result<(), JsValue> {
        self.inner.check_step(hud).map_err(error)
    }
    /// Whether the legacy step boundary rereads the time property.
    pub fn has_death(&self) -> bool {
        self.inner.has_death()
    }
    /// Return the lifecycle and a close intent before host effects.
    pub fn advance_step(&mut self, now: f64, delta: f64, whole: f64) -> Result<JsValue, JsValue> {
        let (l, close) = self.inner.advance_step(now, delta, whole).map_err(error)?;
        record(&[
            ("close", close.into()),
            (
                "lifecycle",
                record(&[
                    ("schema", 1.into()),
                    ("deathPending", l.death_pending.into()),
                    ("returnActive", l.return_active.into()),
                    ("returnCompleted", l.return_completed.into()),
                    ("returnFraction", l.return_fraction.into()),
                ])?,
            ),
        ])
    }
    /// Record the post-notification action revision.
    pub fn finish_step(&mut self, has_socket: bool) {
        self.inner.finish_step(has_socket)
    }
    /// Commit native actions before returning a construct intent.
    pub fn commit_control(&mut self, has_socket: bool) -> bool {
        self.inner.commit_control(has_socket)
    }
    /// Query before the caller time getter.
    pub fn ping_available(&self) -> bool {
        self.inner.ping_available()
    }
    /// Whether the copied clock is represented by an opaque host value.
    pub fn ping_external(&self) -> bool {
        self.inner.ping_external()
    }
    /// Apply the threshold after host arithmetic coercion, without rechecking prior gates.
    pub fn ping_due_elapsed(&self, elapsed: f64) -> bool {
        Policy::ping_due_elapsed(elapsed)
    }
    /// Commit an opaque host clock identity without coercing it.
    pub fn commit_opaque_ping(&mut self) -> Vec<u8> {
        self.inner.commit_opaque_ping()
    }
    /// Compare the second time observation.
    pub fn ping_due(&self, now: f64) -> bool {
        self.inner.ping_due(now)
    }
    /// Commit the third time observation before its callback.
    pub fn commit_ping(&mut self, now: f64) -> Vec<u8> {
        self.inner.commit_ping(now)
    }
    /// Production protocol selection.
    pub fn protocol_allowed(version: f64) -> bool {
        Policy::protocol_allowed(version)
    }
    /// Admit copied compact packet values.
    pub fn valid_input(bytes: &[u8]) -> bool {
        Policy::valid_input(bytes)
    }
    /// Advance separate fade-in cadence.
    pub fn ui_tick(&mut self, now: f64) -> Result<(), JsValue> {
        self.inner.ui_tick(now).map_err(error)
    }
}
