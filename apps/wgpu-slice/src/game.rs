//! Shared actual local session. Host effects are acknowledged outside every Rust borrow.
use crate::{
    Result,
    bank::Bank,
    render::{self, PreparedFrame},
};
use slither_client::{
    challenge::solve_challenge,
    desktop_input::{DesktopInput, OwnInput},
    gameplay_policy::GameplayPolicy,
    menu_preferences::MenuPreferences,
    presentation::*,
    protocol::{self, ElapsedHeader},
    session_policy::{Command, Phase, ReportEvent, SessionPolicy},
};
use std::{
    cell::{Cell, RefCell},
    collections::VecDeque,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EffectKind {
    Connect(String),
    Send(Vec<u8>),
    Close,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Effect {
    pub id: u64,
    pub generation: u32,
    pub kind: EffectKind,
}
#[derive(Clone, Copy)]
enum After {
    None,
    Socket,
    Opened,
    Challenged,
    Control,
}
struct Pending {
    effect: Effect,
    after: After,
    started: bool,
}
struct Work {
    now: f64,
    lagging: bool,
    step: FrameStep,
    actions: ClientControlActions,
    phase: u8,
    extent: [u32; 2],
    scale: f64,
    hud: HudHistory,
    reset_rows: bool,
    world: Option<AnimatedClient>,
    prepared: Option<PreparedFrame>,
}
enum Probe {
    Captured,
    Core(String),
}
impl From<ClientPresentationError> for Probe {
    fn from(e: ClientPresentationError) -> Self {
        Self::Core(e.to_string())
    }
}
#[derive(Debug)]
struct Ingress(String);
impl From<ClientPresentationError> for Ingress {
    fn from(e: ClientPresentationError) -> Self {
        Self(e.to_string())
    }
}
fn sample(v: ClientScoreView) -> Option<HudSample> {
    if let (ScoreStatus::Ready(score), Some(own)) = (v.status, v.own) {
        Some(HudSample {
            score,
            token: own.token,
        })
    } else {
        None
    }
}

pub fn loopback_endpoint(value: &str) -> Result<u16> {
    let port = value
        .strip_prefix("ws://127.0.0.1:")
        .and_then(|s| s.strip_suffix("/slither"))
        .ok_or("Expected ws://127.0.0.1:<port>/slither")?;
    if port.is_empty() || port.starts_with('0') || !port.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid loopback port".into());
    }
    let p = port.parse::<u16>().map_err(|_| "Invalid loopback port")?;
    if p == 0 {
        return Err("Invalid loopback port".into());
    }
    Ok(p)
}

pub struct LocalGame {
    client: AnimatedClient,
    pub bank: Bank,
    session: SessionPolicy,
    input: DesktopInput,
    policy: GameplayPolicy,
    hud: HudHistory,
    rows: LeaderboardHistory,
    projector: LeaderboardScoreProjector,
    nickname: String,
    login: Vec<u8>,
    endpoint: String,
    effects: VecDeque<Pending>,
    next_effect: u64,
    generation: u32,
    has_socket: bool,
    work: Option<Work>,
    packet_frames: VecDeque<PreparedFrame>,
    inflight: u8,
    deferred: VecDeque<(u32, Vec<u8>, f64)>,
    deferred_bytes: usize,
    own: Option<SnakeObjectToken>,
    extent: [u32; 2],
    scale: f64,
    identity: u64,
    rng: u64,
    pub failure: Option<String>,
    suspended: bool,
}
impl LocalGame {
    pub fn new(now: f64) -> Result<Self> {
        let mut client = AnimatedClient::new(now).map_err(|e| e.to_string())?;
        client.enable_score_tracking().map_err(|e| e.to_string())?;
        let mut session = SessionPolicy::new();
        session.subscribe(2).map_err(|e| e.0)?;
        Ok(Self {
            client,
            bank: Bank::new()?,
            session,
            input: DesktopInput::new(19.).map_err(|e| e.to_string())?,
            policy: GameplayPolicy::new(true, true, true, false, false, false),
            hud: HudHistory::default(),
            rows: LeaderboardHistory::default(),
            projector: LeaderboardScoreProjector::new(),
            nickname: String::new(),
            login: Vec::new(),
            endpoint: String::new(),
            effects: VecDeque::new(),
            next_effect: 1,
            generation: 0,
            has_socket: false,
            work: None,
            packet_frames: VecDeque::new(),
            inflight: 0,
            deferred: VecDeque::new(),
            deferred_bytes: 0,
            own: None,
            extent: [960, 540],
            scale: 1.,
            identity: 0,
            rng: 17,
            failure: None,
            suspended: false,
        })
    }
    pub fn generation(&self) -> u32 {
        self.generation
    }
    pub fn client(&self) -> &AnimatedClient {
        &self.client
    }
    pub fn phase(&self) -> Phase {
        self.session.view().phase
    }
    pub fn can_play(&self) -> bool {
        matches!(
            self.phase(),
            Phase::Ready | Phase::Disconnected | Phase::Failed
        ) && self.effects.is_empty()
            && !self.has_socket
            && self.work.is_none()
            && self.inflight == 0
    }
    pub fn play(&mut self, endpoint: &str, nickname: &str, skin: u8) -> Result<()> {
        if !self.can_play() {
            return Err("Explicit Play unavailable".into());
        }
        loopback_endpoint(endpoint)?;
        let mut menu = MenuPreferences::new(true);
        menu.select(skin, &[])?;
        let login =
            protocol::encode_login(0, &[0; 20], nickname, skin, None).map_err(|e| e.to_string())?;
        if matches!(self.phase(), Phase::Disconnected | Phase::Failed) {
            self.session = SessionPolicy::new();
            self.session.subscribe(2).map_err(|e| e.0)?;
        }
        self.session.check_play(true).map_err(|e| e.0)?;
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or("Generation exhausted")?;
        self.login = login;
        self.nickname = nickname.into();
        self.endpoint = endpoint.into();
        self.session.begin_play();
        self.failure = None;
        Ok(())
    }
    fn enqueue(&mut self, kind: EffectKind, after: After) -> Result<()> {
        if self.effects.len() >= 16 {
            return Err("Effect budget".into());
        }
        let id = self.next_effect;
        self.next_effect = self
            .next_effect
            .checked_add(1)
            .ok_or("Effect identity exhausted")?;
        self.effects.push_back(Pending {
            effect: Effect {
                id,
                generation: self.generation,
                kind,
            },
            after,
            started: false,
        });
        Ok(())
    }
    pub fn effect(&self) -> Option<Effect> {
        self.effects.front().map(|p| p.effect.clone())
    }
    /// Validate and date the one Connect immediately before the host constructor effect.
    /// Retained frame timestamps belong to model work, never to the handshake deadline.
    pub fn construct(&mut self, generation: u32, id: u64, now: f64) -> Result<()> {
        let p = self.effects.front().ok_or("No Connect effect")?;
        if p.effect.generation != generation
            || p.effect.id != id
            || p.started
            || !matches!(p.effect.kind, EffectKind::Connect(_))
        {
            return Err("Stale/repeated Connect construction".into());
        }
        self.session.begin_construct(now).map_err(|e| e.0)?;
        self.effects.front_mut().expect("validated").started = true;
        Ok(())
    }
    /// Wall-clock expiry is independent of model updates, backing extent and retained pictures.
    pub fn observe_time(&mut self, now: f64) -> Result<()> {
        if !now.is_finite() {
            return Err("Invalid host timestamp".into());
        }
        if self.session.handshake_timed_out(now) {
            self.fail("Handshake timed out");
        }
        Ok(())
    }
    pub fn acknowledge(&mut self, generation: u32, id: u64, ok: bool) -> Result<()> {
        if self
            .effects
            .front()
            .is_none_or(|p| p.effect.id != id || p.effect.generation != generation)
        {
            return Err("Stale effect acknowledgement".into());
        }
        if ok
            && matches!(
                self.effects.front().expect("checked").effect.kind,
                EffectKind::Connect(_)
            )
            && !self.effects.front().expect("checked").started
        {
            return Err("Connect must begin before acknowledgement".into());
        }
        let p = self.effects.pop_front().expect("checked");
        if !ok {
            self.fail("Transport effect failed");
            return Ok(());
        }
        match p.after {
            After::None => {
                if p.effect.kind == EffectKind::Close {
                    self.has_socket = false;
                }
            }
            After::Socket => self.has_socket = true,
            After::Opened => self.session.opened(),
            After::Challenged => {
                self.login.fill(0);
                self.login.clear();
                self.session.challenged();
            }
            After::Control => self.control()?,
        }
        Ok(())
    }
    fn active(&self, generation: u32) -> bool {
        generation == self.generation && !self.session.terminal()
    }
    pub fn opened(&mut self, generation: u32, now: f64) -> Result<()> {
        if !self.active(generation) {
            return Ok(());
        }
        self.observe_time(now)?;
        if !self.active(generation) {
            return Ok(());
        }
        self.session.check_open().map_err(|e| e.0)?;
        self.enqueue(
            EffectKind::Send(SessionPolicy::negotiation_packet(0).map_err(|e| e.0)?),
            After::None,
        )?;
        self.enqueue(
            EffectKind::Send(SessionPolicy::negotiation_packet(1).map_err(|e| e.0)?),
            After::Opened,
        )
    }
    pub fn stop(&mut self) {
        self.stop_as(false, "Stopped");
    }
    pub fn fail(&mut self, message: &str) {
        if self.failure.is_none() {
            self.failure = Some(message.into());
        }
        self.stop_as(true, message);
    }
    fn stop_as(&mut self, failed: bool, reason: &str) {
        if !self
            .session
            .begin_stop(failed, reason.encode_utf16().collect())
        {
            return;
        }
        // A terminal send/presentation failure cancels the outstanding control transaction.
        // Consume only its session revision; never commit the rejected world candidate.
        self.session.commit_control(self.has_socket);
        self.login.fill(0);
        self.login.clear();
        self.effects.clear();
        self.work = None;
        self.input.leave_tick();
        self.packet_frames.clear();
        self.inflight = 0;
        self.deferred.clear();
        self.deferred_bytes = 0;
        self.session.stop_actions();
        if self.has_socket {
            let _ = self.enqueue(EffectKind::Close, After::None);
        }
    }
    pub fn closed(&mut self, generation: u32) {
        if self.active(generation) {
            self.has_socket = false;
            self.stop_as(false, "Socket closed");
        }
    }
    pub fn receive(&mut self, generation: u32, bytes: &[u8], now: f64) -> Result<()> {
        if !self.active(generation) {
            return Ok(());
        }
        self.observe_time(now)?;
        if !self.active(generation) {
            return Ok(());
        }
        if !now.is_finite() || bytes.len() > protocol::MAX_FRAME_BYTES {
            return Err("Invalid packet/time".into());
        }
        if self.work.is_some() || self.inflight != 0 || !self.packet_frames.is_empty() {
            if self.deferred.len() >= 64
                || self.deferred_bytes + bytes.len() > protocol::MAX_FRAME_BYTES
            {
                return Err("Deferred receive budget".into());
            }
            self.deferred.push_back((generation, bytes.to_vec(), now));
            self.deferred_bytes += bytes.len();
            return Ok(());
        }
        self.ingest(bytes, now)
    }
    fn ingest(&mut self, bytes: &[u8], now: f64) -> Result<()> {
        let mut session = self.session.clone();
        session.receive_bytes(bytes.len()).map_err(|e| e.0)?;
        let decoded =
            protocol::decode_frame(bytes, ElapsedHeader::Absent).map_err(|e| e.to_string())?;
        if session
            .receive_header(decoded.commands.len(), decoded.commands[0][0])
            .map_err(|e| e.0)?
        {
            let reply = solve_challenge(&decoded.commands[0][1..]).map_err(|e| e.to_string())?;
            self.session = session;
            self.enqueue(EffectKind::Send(reply), After::None)?;
            return self.enqueue(EffectKind::Send(self.login.clone()), After::Challenged);
        }
        for c in &decoded.commands {
            if session
                .command_requires_version(c[0], c.len())
                .map_err(|e| e.0)?
            {
                session
                    .admit_protocol(f64::from(
                        protocol::setup_protocol_version(c).map_err(|e| e.to_string())?,
                    ))
                    .map_err(|e| e.0)?;
            }
        }
        let commands: Vec<_> = decoded
            .commands
            .iter()
            .map(|c| Command {
                opcode: c[0],
                argument: *c.get(1).unwrap_or(&0),
            })
            .collect();
        let plan = session.prepare_controls(&commands, now).map_err(|e| e.0)?;
        let guards: Vec<_> = plan
            .guards
            .iter()
            .map(|g| HudCommandGuard {
                playing: g.playing,
                close_requested: g.close_requested,
                death_pending: g.death_pending,
            })
            .collect();
        let mut client = self.client.clone();
        let bank = RefCell::new(&mut self.bank);
        let rng = Cell::new(self.rng);
        let serial = Cell::new(self.identity);
        let frames = RefCell::new(Vec::new());
        let extent = self.extent;
        let scale = self.scale;
        let units = || {
            let unit = || {
                let state = rng.get().wrapping_mul(1664525).wrapping_add(1013904223) & 0xffff_ffff;
                rng.set(state);
                state as f64 / 4294967296.
            };
            [unit(), unit()]
        };
        let report=client.apply_frame_with_accessory_presentation_and_all_factories_and_setup_and_hud::<Ingress,_,_,_,_>(bytes,ElapsedHeader::Absent,
            |a,_|{let skin=resolve_authored_local_skin(a.skin,&a.custom_skin).map_err(|e|Ingress(e.to_string()))?;Ok(FacePresentation{face:skin.face,antenna:None}.into())},
            |s,_|Ok(bank.borrow().food(s.raw_color,units())),|s,_|Ok(bank.borrow().prey(s.raw_color,units())),
            |c,_|{if frames.borrow().len()>=16{return Err(Ingress("Setup draw budget".into()));}serial.set(serial.get()+1);let frame=render::prepare(c,&mut bank.borrow_mut(),extent,scale,serial.get()).map_err(Ingress)?;frames.borrow_mut().push(frame);Ok(())},
            HudIngressPlan{schema:2,command_count:commands.len(),guards:&guards,final_capture_indices:&plan.final_capture_indices}).map_err(|e|e.0)?;
        let mut events = Vec::new();
        let mut row_events = Vec::new();
        let mut meta = Vec::new();
        for event in report.events() {
            let (kind, h) = match event.kind {
                HudIngressEventKind::Setup { table_max } => {
                    row_events.push(LeaderboardEvent {
                        command_index: event.command_index,
                        kind: LeaderboardEventKind::Setup(table_max),
                    });
                    (0, HudHistoryEvent::Setup)
                }
                HudIngressEventKind::SetupDraw { view } => {
                    (1, HudHistoryEvent::SetupDraw(sample(view)))
                }
                HudIngressEventKind::OwnLengthScheduled { token } => {
                    (4, HudHistoryEvent::OwnLengthScheduled(token))
                }
                HudIngressEventKind::Leaderboard {
                    local_row,
                    rank,
                    population,
                    death_pending,
                } => {
                    let _ = local_row;
                    (
                        2,
                        HudHistoryEvent::Leaderboard {
                            rank,
                            population,
                            death_pending,
                        },
                    )
                }
                HudIngressEventKind::FinalScore { view } => (
                    3,
                    HudHistoryEvent::FinalScore(sample(view).ok_or("Missing final score")?),
                ),
            };
            let death_pending = matches!(
                h,
                HudHistoryEvent::Leaderboard {
                    death_pending: true,
                    ..
                }
            );
            meta.push(ReportEvent {
                command_index: event.command_index,
                kind,
                death_pending,
            });
            events.push(h);
        }
        // Raw row history is admitted independently of the playing-gated HUD journal.
        for rows in report.leaderboard_rows() {
            row_events.push(LeaderboardEvent {
                command_index: rows.command_index(),
                kind: LeaderboardEventKind::Board {
                    local_row: commands[rows.command_index()].argument,
                    rows: rows
                        .rows()
                        .iter()
                        .map(|r| LeaderboardRawRow {
                            count: r.count(),
                            fractional_mass: r.fractional_mass(),
                            raw_color: r.raw_color(),
                            name: r.name().to_vec(),
                        })
                        .collect(),
                },
            });
        }
        row_events.sort_by_key(|e| e.command_index);
        session
            .match_report(&meta, report.setup_draws())
            .map_err(|e| e.0)?;
        session.commit_controls().map_err(|e| e.0)?;
        let hud = self.hud.packet(&events)?;
        let mut rows_plan = self.rows.prepare(&row_events)?;
        rows_plan.begin()?;
        let mut scores = Vec::new();
        for request in rows_plan.requests() {
            let input: Vec<_> = request
                .counts
                .iter()
                .zip(&request.fractional_masses)
                .map(|(&count, &fractional_mass)| LeaderboardScoreInput {
                    count,
                    fractional_mass,
                })
                .collect();
            scores.push(
                self.projector
                    .project(request.table_max, &input)
                    .map_err(|e| e.to_string())?
                    .into_iter()
                    .map(|s| match s {
                        LeaderboardRowScore::Value(v) => v,
                        LeaderboardRowScore::OutOfTable => f64::NAN,
                    })
                    .collect(),
            );
        }
        let rows = self
            .rows
            .stage_complete(&mut rows_plan, &scores, &self.nickname)?;
        let mut pictures = VecDeque::new();
        if !self.suspended {
            let mut bytes = 0;
            let text = Self::format_hud_parts(
                &client,
                &hud,
                &rows,
                &session,
                self.failure.as_deref(),
                false,
            );
            for frame in frames.into_inner() {
                let p = render::finish(frame, &mut self.bank, &text)?;
                bytes += p
                    .resources
                    .iter()
                    .map(|r| r.image.pixels.len())
                    .sum::<usize>();
                if bytes > crate::bank::PIXEL_BUDGET {
                    return Err("Queued Setup pixels budget".into());
                }
                pictures.push_back(p);
            }
        }
        // All packet outputs and their aggregate charge are valid before any world/history publish.
        rows.commit()?;
        self.client = client;
        self.session = session;
        self.hud = hud;
        self.rows = rows;
        self.identity = serial.get();
        self.rng = rng.get();
        self.packet_frames.extend(pictures);
        Ok(())
    }
    /// Probe only the existing transactional clock callback; intentionally abort before entity update.
    /// The same owner commits it exactly once after all staged input send acknowledgements.
    pub fn begin_frame(&mut self, now: f64, extent: [u32; 2], scale: f64) -> Result<()> {
        self.observe_time(now)?;
        self.viewport(extent, scale)?;
        if self.suspended {
            return Ok(());
        }
        if !now.is_finite() {
            return Err("Invalid frame timestamp".into());
        }
        if self.work.is_some()
            || self.inflight != 0
            || !self.effects.is_empty()
            || !self.packet_frames.is_empty()
        {
            return Ok(());
        }
        while let Some((g, b, t)) = self.deferred.pop_front() {
            self.deferred_bytes -= b.len();
            self.receive(g, &b, t)?;
            if !self.packet_frames.is_empty() || !self.effects.is_empty() {
                return Ok(());
            }
        }
        self.session.observe_lag(now);
        self.session.ui_tick(now).map_err(|e| e.0)?;
        let lagging = self.session.view().lagging;
        let mut captured = None;
        let probe = self
            .client
            .advance_with_control::<Probe, _>(now, lagging, |step, control| {
                captured = Some((step, control));
                Err(Probe::Captured)
            });
        if let Err(Probe::Core(e)) = probe {
            return Err(e);
        }
        let (step, view) = captured.ok_or("Missing core step")?;
        self.policy.begin_frame();
        self.policy.begin_control();
        self.input.set_connected(self.session.view().connected);
        if let Some(own) = view.own {
            self.input
                .set_own(
                    OwnInput {
                        wanted_heading: own.wanted_heading,
                        gaze_heading: own.gaze_heading,
                        dead: own.dead,
                        turn_rate: own.turn_rate,
                        size_turn_factor: own.size_turn_factor,
                        speed_turn_factor: own.speed_turn_factor,
                        requested_boost: false,
                        sent_boost: false,
                    },
                    self.own == Some(own.token),
                )
                .map_err(|e| e.to_string())?;
            self.own = Some(own.token);
        } else {
            self.input.clear_own();
            self.own = None;
        }
        self.input
            .accumulate(f64::from(step.whole_steps))
            .map_err(|e| e.to_string())?;
        self.policy.debt_done();
        self.session.check_step(true).map_err(|e| e.0)?;
        let (life, close) = self
            .session
            .advance_step(now, step.delta, f64::from(step.whole_steps))
            .map_err(|e| e.0)?;
        if close {
            self.stop_as(false, "Life returned");
        }
        self.session.finish_step(self.has_socket);
        let (_, pending) = self.session.actions();
        self.policy.lifecycle_done(pending.reset_world);
        let mut hud = self.hud.step(
            step.delta,
            HudLifecycle {
                death_pending: life.death_pending,
                return_active: life.return_active,
                return_completed: life.return_completed,
                return_fraction: life.return_fraction,
            },
        )?;
        if pending.reset_world {
            hud = hud.reset_world();
        }
        let actions = ClientControlActions {
            reset_world: pending.reset_world,
            reset_lag: pending.reset_lag,
            connected: if pending.disconnected {
                Some(false)
            } else {
                Some(self.session.view().connected)
            },
            ..Default::default()
        };
        let phase = if pending.reset_world || !self.session.view().connected {
            self.input.reset();
            4
        } else {
            self.input.enter_tick().map_err(|e| e.to_string())?;
            0
        };
        self.work = Some(Work {
            now,
            lagging,
            step,
            actions,
            phase,
            extent,
            scale,
            hud,
            reset_rows: pending.reset_world,
            world: None,
            prepared: None,
        });
        self.control()
    }
    fn control(&mut self) -> Result<()> {
        loop {
            let Some(w) = &mut self.work else {
                return Ok(());
            };
            let now = w.now;
            let phase = w.phase;
            w.phase += 1;
            let packet = match phase {
                0 => self
                    .input
                    .keyboard_phase(now, 0.)
                    .map_err(|e| e.to_string())?,
                1 => {
                    if self.session.ping_available() && self.session.ping_due(now) {
                        self.session.commit_ping(now)
                    } else {
                        Vec::new()
                    }
                }
                2 => {
                    if self.input.view().own.is_some() {
                        self.input.boost_phase(now).map_err(|e| e.to_string())?
                    } else {
                        Vec::new()
                    }
                }
                3 => {
                    if self.input.view().own.is_some() {
                        self.input.heading_phase(now).map_err(|e| e.to_string())?
                    } else {
                        Vec::new()
                    }
                }
                _ => {
                    self.input.leave_tick();
                    if self.input.view().own.is_some() && self.session.view().connected {
                        w.actions.gaze_heading =
                            Some(self.input.required_gaze().map_err(|e| e.to_string())?);
                    }
                    break;
                }
            };
            if !packet.is_empty() {
                if !SessionPolicy::valid_input(&packet) {
                    return Err("Invalid compact input intent".into());
                }
                self.enqueue(EffectKind::Send(packet), After::Control)?;
                return Ok(());
            }
        }
        let w = self.work.as_mut().expect("work");
        self.policy.control_done();
        let expected = w.step;
        let actions = w.actions;
        let mut world = self.client.clone();
        world
            .advance_with_control::<Probe, _>(w.now, w.lagging, |step, _| {
                if step != expected {
                    return Err(Probe::Core("Step changed before commit".into()));
                }
                Ok(actions)
            })
            .map_err(|e| match e {
                Probe::Core(e) => e,
                Probe::Captured => "Unexpected probe".into(),
            })?;
        self.identity += 1;
        let frame = render::prepare(&mut world, &mut self.bank, w.extent, w.scale, self.identity)?;
        self.policy.controller_done();
        let score = if w.hud.readout_required(self.session.view().playing) {
            sample(world.score_view())
        } else {
            None
        };
        w.hud = w.hud.draw(self.session.view().playing, score)?;
        self.policy.score_done();
        w.world = Some(world);
        let w = self.work.as_ref().expect("work");
        let text = self.format_hud(w.world.as_ref().expect("world"), &w.hud, w.reset_rows);
        let prepared = render::finish(frame, &mut self.bank, &text)?;
        self.work.as_mut().expect("work").prepared = Some(prepared);
        Ok(())
    }
    pub fn take_frame(&mut self) -> Option<PreparedFrame> {
        if self.suspended || self.inflight != 0 {
            return None;
        }
        if let Some(frame) = self.packet_frames.pop_front() {
            self.inflight = 1;
            return Some(frame);
        }
        let prepared = self.work.as_mut()?.prepared.take()?;
        self.inflight = 2;
        Some(prepared)
    }
    /// Non-consuming drain-boundary query: never issue an extra unacknowledged picture.
    pub fn has_frame(&self) -> bool {
        !self.suspended
            && self.inflight == 0
            && (!self.packet_frames.is_empty()
                || self.work.as_ref().is_some_and(|w| w.prepared.is_some()))
    }
    pub fn presented(&mut self, success: bool) -> Result<()> {
        let kind = std::mem::replace(&mut self.inflight, 0);
        if kind == 0 {
            return Err("No issued frame".into());
        }
        if !success {
            self.fail("GPU presentation failed");
            return Ok(());
        }
        if kind == 1 {
            return Ok(());
        }
        let w = self.work.take().ok_or("Missing frame work")?;
        self.client = w.world.ok_or("Missing world candidate")?;
        self.hud = w.hud;
        if w.reset_rows {
            let rows = self.rows.stage_reset()?;
            rows.commit()?;
            self.rows = rows;
        }
        if self.session.commit_control(self.has_socket) {
            self.enqueue(EffectKind::Connect(self.endpoint.clone()), After::Socket)?;
        }
        self.policy.frame_commit_done(self.session.view().connected);
        self.policy.finish_frame();
        Ok(())
    }
    /// Resize supersedes queued intermediate Setup pictures, never their admitted packet state.
    pub fn viewport(&mut self, extent: [u32; 2], scale: f64) -> Result<()> {
        if extent.contains(&0) {
            self.suspended = true;
            self.packet_frames.clear();
            return Ok(());
        }
        render::dimensions(extent, scale)?;
        let changed = self.suspended || self.extent != extent || self.scale != scale;
        self.suspended = false;
        if changed {
            self.extent = extent;
            self.scale = scale;
            self.packet_frames.clear();
            let text = self.hud_text();
            if let Some(w) = &mut self.work {
                w.extent = extent;
                w.scale = scale;
                if let Some(world) = &mut w.world {
                    self.identity += 1;
                    let frame =
                        render::prepare(world, &mut self.bank, extent, scale, self.identity)?;
                    w.prepared = Some(render::finish(frame, &mut self.bank, &text)?);
                }
            }
        }
        Ok(())
    }
    pub fn retry_frame(&mut self, frame: PreparedFrame) -> Result<()> {
        match std::mem::replace(&mut self.inflight, 0) {
            1 => self.packet_frames.push_front(frame),
            2 => self.work.as_mut().ok_or("Missing frame work")?.prepared = Some(frame),
            _ => return Err("No issued frame".into()),
        }
        Ok(())
    }
    pub fn key(&mut self, code: &str, down: bool) -> bool {
        self.input.key(code, down)
    }
    pub fn blur(&mut self) {
        self.input.blur();
    }
    pub fn pointer(&mut self, x: f64, y: f64, width: f64, height: f64, down: bool) -> Result<()> {
        let v = self.client.control_view();
        let head = v.own.map(|o| o.raw_head).unwrap_or_default();
        let args = [
            x,
            y,
            width,
            height,
            f64::from(v.follows),
            f64::from(v.own.is_some()),
            v.camera.x,
            v.camera.y,
            head.x,
            head.y,
            v.zoom,
        ];
        if down {
            self.input.mouse_down(&args).map_err(|e| e.to_string())?;
        } else {
            self.input.pointer(&args).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn mouse_up(&mut self) {
        self.input.mouse_up();
    }
    pub fn hud_text(&self) -> String {
        self.format_hud(&self.client, &self.hud, false)
    }
    fn format_hud(&self, client: &AnimatedClient, hud: &HudHistory, reset_rows: bool) -> String {
        Self::format_hud_parts(
            client,
            hud,
            &self.rows,
            &self.session,
            self.failure.as_deref(),
            reset_rows,
        )
    }
    fn format_hud_parts(
        client: &AnimatedClient,
        hud: &HudHistory,
        rows: &LeaderboardHistory,
        session: &SessionPolicy,
        failure: Option<&str>,
        reset_rows: bool,
    ) -> String {
        let phase = session.view().phase;
        let status = if phase == Phase::Failed {
            "FAILED"
        } else {
            match GameplayPolicy::status(phase.label(), session.view().connected) {
                1 => "READY",
                2 => "CONNECTED",
                4 => "CONNECTING",
                _ => "NOT CONNECTED",
            }
        };
        let score = sample(client.score_view())
            .and_then(|s| hud_score_text(s.score).ok())
            .unwrap_or_else(|| "--".into());
        let final_score = hud
            .final_capture
            .and_then(|v| v.score_text().ok())
            .unwrap_or_else(|| "--".into());
        let top = if reset_rows {
            None
        } else {
            rows.visible_rows().first()
        }
        .map(|r| format!("{} {}", r.name_text, r.score_text))
        .unwrap_or_else(|| "--".into());
        format!(
            "{status} | ENTER PLAY / ESC STOP\nLENGTH {score}  RANK {} / {}\nFINAL {final_score}  TOP {top}\n{}",
            hud.rank,
            hud.population,
            failure.unwrap_or("LOCAL AUTHORED BODY/PAIRED EYES; ARROWS/POINTER/SPACE")
        )
    }
}
