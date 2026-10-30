//! Finite native host: no event loop/window; the existing game owns every packet intent.
use slither_client::{
    presentation::ScoreStatus,
    protocol::{self, ElapsedHeader},
    session_policy::Phase,
};
use slither_wgpu_slice::{
    Result,
    frame::Frame,
    game::{EffectKind, LocalGame, LoginProfile},
    gpu::{Renderer, instance},
    native::{Event, Transport},
    official::Preparation,
};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::BufWriter,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const EXTENT: [u32; 2] = [960, 540];

fn autopilot_heading(seconds: f64) -> f64 {
    // Broad arcs with a slow heading drift; the first minute travels across the map.
    seconds * 0.017 + 0.55 * (seconds / 16.0).sin()
}

struct ViewportPeak {
    seconds: f64,
    frame: u64,
    ids: Vec<u16>,
    body_commands: usize,
}
#[derive(Default)]
struct Encounters {
    received_max: usize,
    received_ids: BTreeSet<u16>,
    visible_max: usize,
    visible_ids: BTreeSet<u16>,
    body_draw_list_max: usize,
    viewport_peak: Option<ViewportPeak>,
}
impl Encounters {
    fn receive(&mut self, game: &LocalGame) {
        let mut count = 0;
        for (_, own, drawn, snake) in game.client().snake_objects() {
            if own {
                continue;
            }
            let m = snake.metrics();
            self.received_ids.insert(m.id);
            count += usize::from(drawn && !m.expired);
        }
        self.received_max = self.received_max.max(count);
    }
    /// Called only after this exact picture completed GPU submission successfully.
    fn presented(&mut self, frame: &Frame, seconds: f64) -> bool {
        let others: Vec<_> = frame.snakes.iter().filter(|s| !s.own).collect();
        self.visible_max = self.visible_max.max(others.len());
        self.visible_ids.extend(others.iter().map(|s| s.id));
        self.body_draw_list_max = self
            .body_draw_list_max
            .max(others.iter().filter(|s| s.body_commands > 0).count());
        let in_view: Vec<_> = others
            .iter()
            .filter(|s| s.viewport_body_commands > 0)
            .collect();
        let previous = self.viewport_peak.as_ref().map_or(0, |p| p.ids.len());
        if in_view.len() > previous {
            self.viewport_peak = Some(ViewportPeak {
                seconds,
                frame: frame.identity,
                ids: in_view.iter().map(|s| s.id).collect(),
                body_commands: in_view.iter().map(|s| s.viewport_body_commands).sum(),
            });
        }
        previous == 0 && !in_view.is_empty()
    }
    fn print(&self) {
        println!(
            "other_snakes: received_max={} received_distinct_ids={} visible_max={} visible_distinct_ids={} viewport_max={} body_draw_list_max={} body_in_draw_list={}",
            self.received_max,
            self.received_ids.len(),
            self.visible_max,
            self.visible_ids.len(),
            self.viewport_peak.as_ref().map_or(0, |p| p.ids.len()),
            self.body_draw_list_max,
            self.body_draw_list_max > 0
        );
        if let Some(p) = &self.viewport_peak {
            println!(
                "other_snakes_viewport_peak: time={:.2}s frame={} count={} sample_ids={:?} viewport_body_commands={}",
                p.seconds,
                p.frame,
                p.ids.len(),
                p.ids.iter().take(8).collect::<Vec<_>>(),
                p.body_commands
            );
        }
    }
}

pub struct Options {
    duration: Duration,
    frame_every: Duration,
    frames: PathBuf,
}
impl Options {
    pub fn new(duration: f64, frame_every: f64, frames: PathBuf) -> Result<Self> {
        if !duration.is_finite()
            || !(0.0..=3600.0).contains(&duration)
            || duration == 0.0
            || !frame_every.is_finite()
            || frame_every < 0.1
            || frame_every > 3600.0
            || duration / frame_every > 600.0
        {
            return Err("Headless requires duration in (0,3600], frame interval in [0.1,3600]s and at most 600 scheduled captures".into());
        }
        Ok(Self {
            duration: Duration::from_secs_f64(duration),
            frame_every: Duration::from_secs_f64(frame_every),
            frames,
        })
    }
}

#[derive(Default)]
struct Summary {
    server: Option<String>,
    version: Option<u16>,
    opened: bool,
    negotiated: bool,
    login_sent: bool,
    setup: bool,
    received_frames: u64,
    received_commands: u64,
    sent: u64,
    headings: u64,
    boosts: u64,
    rendered: u64,
    captured: u64,
    lengths: Vec<(f64, f64, usize)>,
    reason: String,
    encounters: Encounters,
}
impl Summary {
    fn observe(&mut self, game: &LocalGame) {
        self.encounters.receive(game);
        self.negotiated |= game.phase() == Phase::Challenge;
        self.login_sent |= game.phase() == Phase::Setup;
        self.setup |= game.client().score_view().table_max.is_some();
    }
    fn sample(&mut self, game: &LocalGame, seconds: f64) {
        let view = game.client().score_view();
        if let (ScoreStatus::Ready(length), Some(own)) = (view.status, view.own)
            && self.lengths.len() < 32
            && self
                .lengths
                .last()
                .is_none_or(|(time, _, _)| seconds - time > 0.001)
        {
            self.lengths.push((seconds, length, own.logical_segments));
        }
    }
    fn print(&self, elapsed: Duration) {
        println!("Headless summary ({:.2}s):", elapsed.as_secs_f64());
        println!(
            "server={} client_version={}",
            self.server.as_deref().unwrap_or("not selected"),
            self.version
                .map_or_else(|| "not acquired".into(), |v| v.to_string())
        );
        println!(
            "handshake: websocket={} negotiation={} challenge={} login={} Setup={}",
            self.opened,
            self.negotiated,
            self.login_sent,
            if self.setup {
                "accepted (Setup)"
            } else if self.login_sent {
                "sent, unconfirmed"
            } else {
                "not sent"
            },
            self.setup
        );
        println!(
            "received_ws_frames={} decoded_commands={} sent_packets={} heading_packets={} boost_packets={} rendered_frames={} PNGs={}",
            self.received_frames,
            self.received_commands,
            self.sent,
            self.headings,
            self.boosts,
            self.rendered,
            self.captured
        );
        let samples = self
            .lengths
            .iter()
            .map(|(t, length, segments)| format!("{t:.1}s:{length:.0}({segments} segments)"))
            .collect::<Vec<_>>()
            .join(", ");
        println!("own_length=[{samples}]");
        self.encounters.print();
        println!("exit={}", self.reason);
    }
}

fn output_directory(path: &Path) -> Result<()> {
    fs::create_dir(path)
        .map_err(|e| format!("Frames require a new directory with an existing parent: {e}"))?;
    let directory = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let repository = fs::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .map_err(|e| e.to_string())?;
    if directory.starts_with(repository) {
        // Only the new empty directory owned by this call can be removed.
        let _ = fs::remove_dir(path);
        return Err("Frame captures must stay outside the checkout".into());
    }
    Ok(())
}

struct Offscreen {
    renderer: Renderer,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
}
impl Offscreen {
    fn new() -> Result<Self> {
        let renderer = pollster::block_on(Renderer::new(
            &instance(),
            None,
            wgpu::TextureFormat::Rgba8Unorm,
        ))?;
        println!(
            "Offscreen adapter {:?}; MSAA{}",
            renderer.adapter_info, renderer.sample_count
        );
        let texture = renderer.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("headless gameplay"),
            size: wgpu::Extent3d {
                width: EXTENT[0],
                height: EXTENT[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        Ok(Self {
            renderer,
            texture,
            view,
        })
    }
    fn wait(&self) -> Result<()> {
        self.renderer
            .device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(Duration::from_secs(2)),
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    fn draw(&mut self, picture: &slither_wgpu_slice::render::PreparedFrame) -> Result<()> {
        let validation = self
            .renderer
            .device
            .push_error_scope(wgpu::ErrorFilter::Validation);
        let result = self
            .renderer
            .sync_resources(&picture.resources)
            .and_then(|()| self.renderer.render(&picture.frame, &self.view))
            .and_then(|()| self.wait());
        result?;
        let error = pollster::block_on(validation.pop());
        if let Some(error) = error {
            return Err(format!("Offscreen validation: {error}"));
        }
        Ok(())
    }
    fn save(&self, path: &Path) -> Result<()> {
        // 960 RGBA pixels = 3840 bytes, already aligned to COPY_BYTES_PER_ROW_ALIGNMENT.
        let row = EXTENT[0] * 4;
        let buffer = self.renderer.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("headless readback"),
            size: u64::from(row * EXTENT[1]),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .renderer
            .device
            .create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(EXTENT[1]),
                },
            },
            wgpu::Extent3d {
                width: EXTENT[0],
                height: EXTENT[1],
                depth_or_array_layers: 1,
            },
        );
        self.renderer.queue.submit([encoder.finish()]);
        let (tx, rx) = mpsc::sync_channel(1);
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                let _ = tx.send(result);
            });
        self.wait()?;
        rx.recv_timeout(Duration::from_secs(1))
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        let result = {
            let bytes = buffer
                .slice(..)
                .get_mapped_range()
                .map_err(|e| e.to_string())?;
            write_png(path, &bytes)
        };
        buffer.unmap();
        result
    }
}

fn write_png(path: &Path, bytes: &[u8]) -> Result<()> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut encoder = png::Encoder::new(BufWriter::new(file), EXTENT[0], EXTENT[1]);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(bytes).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())
}

struct Host<'a> {
    game: LocalGame,
    transport: Transport,
    gpu: Offscreen,
    started: Instant,
    summary: &'a mut Summary,
    capture_dir: &'a Path,
}
impl Host<'_> {
    fn seconds(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }
    fn effects(&mut self) -> Result<()> {
        for _ in 0..64 {
            let Some(effect) = self.game.effect() else {
                return Ok(());
            };
            if matches!(effect.kind, EffectKind::Connect(_)) {
                self.game
                    .construct(effect.generation, effect.id, self.seconds() * 1000.0)?;
            }
            self.transport.execute(&effect)?;
            self.game.acknowledge(effect.generation, effect.id, true)?;
            if let EffectKind::Send(bytes) = effect.kind {
                self.summary.sent += 1;
                if self.game.phase() == Phase::Playing && bytes.len() == 1 && bytes[0] < 251 {
                    self.summary.headings += 1;
                }
                if matches!(bytes.as_slice(), [253] | [254]) {
                    self.summary.boosts += 1;
                }
            }
            self.summary.observe(&self.game);
        }
        Err("Headless effect drain budget".into())
    }
    fn pictures(&mut self) -> Result<()> {
        for _ in 0..16 {
            self.game.observe_time(self.seconds() * 1000.0)?;
            let Some(picture) = self.game.take_frame() else {
                return Ok(());
            };
            if let Err(error) = self.gpu.draw(&picture) {
                self.game.presented(false)?;
                return Err(error);
            }
            self.game.presented(true)?;
            self.summary.rendered += 1;
            self.summary.observe(&self.game);
            let first_encounter = self
                .summary
                .encounters
                .presented(&picture.frame, self.seconds());
            if first_encounter {
                self.capture("first-other")?;
            }
            self.effects()?;
        }
        if self.game.has_frame() {
            Err("Headless picture drain budget".into())
        } else {
            Ok(())
        }
    }
    fn frame(&mut self, active_seconds: f64) -> Result<()> {
        for event in self.transport.poll() {
            let now = self.seconds() * 1000.0;
            match event {
                Event::Opened(g) => {
                    self.summary.opened = true;
                    self.game.opened(g, now)?;
                }
                Event::Binary(g, bytes) => {
                    self.summary.received_frames += 1;
                    if let Ok(decoded) = protocol::decode_frame(&bytes, ElapsedHeader::Absent) {
                        self.summary.received_commands += decoded.commands.len() as u64;
                    }
                    self.game.receive(g, &bytes, now)?;
                }
                Event::Closed(g) => {
                    self.summary.reason = "remote WebSocket closed".into();
                    self.game.closed(g);
                }
                Event::Failed(_, error) => return Err(error),
            }
            self.summary.observe(&self.game);
            self.effects()?;
            self.pictures()?;
            if terminal_reason(self.game.phase()).is_some() {
                return Ok(());
            }
        }
        if self.game.phase() == Phase::Playing {
            let angle = autopilot_heading(active_seconds);
            self.game.pointer(
                480.0 + 220.0 * angle.cos(),
                270.0 + 220.0 * angle.sin(),
                960.0,
                540.0,
                false,
            )?;
            self.game.key(
                "Space",
                active_seconds % 12.0 >= 8.0 && active_seconds % 12.0 < 9.0,
            );
        }
        self.effects()?;
        self.pictures()?;
        self.game
            .begin_frame(self.seconds() * 1000.0, EXTENT, 1.0)?;
        self.effects()?;
        self.pictures()
    }
    fn play(&mut self, options: &Options) -> Result<()> {
        let mut active_started = None;
        let mut next_capture = Duration::ZERO;
        let mut next_sample = 0.0;
        let mut last_saved_render = 0;
        while self.started.elapsed() < options.duration {
            self.frame(active_started.map_or(0.0, |t: Instant| t.elapsed().as_secs_f64()))?;
            if self.game.phase() == Phase::Playing {
                active_started.get_or_insert_with(Instant::now);
            }
            let elapsed = self.started.elapsed();
            if elapsed.as_secs_f64() >= next_sample {
                self.summary.sample(&self.game, elapsed.as_secs_f64());
                next_sample =
                    elapsed.as_secs_f64() + (options.duration.as_secs_f64() / 30.0).max(1.0);
            }
            if self.summary.rendered > 0 && elapsed >= next_capture {
                self.capture("frame")?;
                last_saved_render = self.summary.rendered;
                next_capture = elapsed + options.frame_every;
            }
            if let Some(reason) = terminal_reason(self.game.phase()) {
                if self.summary.reason.is_empty() {
                    self.summary.reason =
                        self.game.failure.clone().unwrap_or_else(|| reason.into());
                }
                break;
            }
            thread::sleep(
                Duration::from_millis(16)
                    .min(options.duration.saturating_sub(self.started.elapsed())),
            );
        }
        if self.summary.reason.is_empty() {
            self.summary.reason = "duration reached".into();
        }
        self.summary.sample(&self.game, self.seconds());
        if self.summary.rendered > last_saved_render {
            self.capture("frame")?;
        }
        if !self.summary.setup {
            return Err(format!("{} before Setup", self.summary.reason));
        }
        if self.game.phase() == Phase::Failed {
            return Err(self
                .game
                .failure
                .clone()
                .unwrap_or_else(|| "Session failed".into()));
        }
        Ok(())
    }
    fn capture(&mut self, label: &str) -> Result<()> {
        let path = self.capture_dir.join(format!(
            "{label}-{:04}-{:09}ms.png",
            self.summary.captured,
            self.started.elapsed().as_millis()
        ));
        self.gpu.save(&path)?;
        self.summary.captured += 1;
        Ok(())
    }
}
impl Drop for Host<'_> {
    fn drop(&mut self) {
        self.game.key("Space", false);
        self.game.stop();
        self.transport.close();
    }
}

fn terminal_reason(phase: Phase) -> Option<&'static str> {
    match phase {
        Phase::Dead => Some("server death control"),
        Phase::Victory => Some("server victory control"),
        Phase::Disconnected => Some("session disconnected"),
        Phase::Failed => Some("session failed"),
        _ => None,
    }
}

pub fn run(
    options: Options,
    endpoint: Option<&str>,
    official: bool,
    server: Option<&str>,
    nickname: &str,
    skin: u8,
) -> Result<()> {
    let started = Instant::now();
    let mut summary = Summary {
        server: endpoint
            .map(str::to_owned)
            .or_else(|| server.map(str::to_owned)),
        ..Default::default()
    };
    let result = (|| {
        output_directory(&options.frames)?;
        let gpu = Offscreen::new()?;
        let (endpoint, profile) = if official {
            let mut preparation = Preparation::start(server.map(str::to_owned))?;
            loop {
                if started.elapsed() >= options.duration {
                    preparation.cancel();
                    return Err("duration reached during acquisition".into());
                }
                if let Some(result) = preparation.poll() {
                    let prepared = result?;
                    break (prepared.endpoint, prepared.profile);
                }
                thread::sleep(Duration::from_millis(10));
            }
        } else {
            (
                endpoint.ok_or("Headless endpoint required")?.into(),
                LoginProfile::default(),
            )
        };
        summary.server = Some(endpoint.clone());
        summary.version = Some(profile.client_version);
        if started.elapsed() >= options.duration {
            return Err("duration reached before Play".into());
        }
        let mut game = LocalGame::new(started.elapsed().as_secs_f64() * 1000.0)?;
        game.play_with_profile(&endpoint, nickname, skin, &profile)?;
        drop(profile);
        Host {
            game,
            transport: Transport::default(),
            gpu,
            started,
            summary: &mut summary,
            capture_dir: &options.frames,
        }
        .play(&options)
    })();
    if let Err(error) = &result {
        summary.reason = format!("error: {error}");
    }
    summary.print(started.elapsed());
    result
}

#[cfg(test)]
mod tests {
    // ORIGINAL SYNTHETIC settings/output fixtures; no connection or GPU.
    use super::*;
    #[test]
    fn autopilot_crosses_distance_over_the_first_minute_with_gentle_turns() {
        let mut distance = [0.0, 0.0];
        for second in 0..60 {
            let heading = autopilot_heading(f64::from(second));
            distance[0] += heading.cos();
            distance[1] += heading.sin();
            assert!((autopilot_heading(f64::from(second + 1)) - heading).abs() < 0.052);
        }
        // Unit-speed travel cannot collapse back into the previous small closed orbit.
        assert!(distance[0].hypot(distance[1]) > 45.0);
    }
    #[test]
    fn encounter_peaks_use_frame_ownership_and_keep_the_maximum_sample() {
        use slither_wgpu_slice::frame::SnakeDrawObservation as Snake;
        let mut e = Encounters::default();
        let mut frame = Frame {
            identity: 7,
            extent: EXTENT,
            viewport_scale: 1.,
            tick: 0,
            draws: vec![],
            snakes: vec![
                Snake {
                    id: 0,
                    own: true,
                    body_commands: 10,
                    viewport_body_commands: 10,
                },
                Snake {
                    id: 9,
                    own: false,
                    body_commands: 0,
                    viewport_body_commands: 0,
                },
            ],
        };
        assert!(!e.presented(&frame, 1.));
        assert_eq!(e.visible_max, 1);
        assert_eq!(e.body_draw_list_max, 0);
        assert!(e.viewport_peak.is_none());
        frame.identity = 8;
        frame.snakes = vec![
            Snake {
                id: 0,
                own: false,
                body_commands: 3,
                viewport_body_commands: 2,
            },
            Snake {
                id: 9,
                own: false,
                body_commands: 2,
                viewport_body_commands: 1,
            },
        ];
        assert!(e.presented(&frame, 2.));
        frame.identity = 9;
        frame.snakes.truncate(1);
        assert!(!e.presented(&frame, 3.));
        assert_eq!(e.visible_max, 2);
        assert_eq!(e.visible_ids, BTreeSet::from([0, 9]));
        let peak = e.viewport_peak.unwrap();
        assert_eq!(peak.frame, 8);
        assert_eq!(peak.seconds, 2.);
        assert_eq!(peak.ids, vec![0, 9]);
        assert_eq!(peak.body_commands, 3);
    }
    #[test]
    fn finite_budget_rejects_nan_zero_overflow_and_excessive_capture_counts() {
        for (duration, interval) in [
            (0.0, 1.0),
            (f64::NAN, 1.0),
            (f64::INFINITY, 1.0),
            (3601.0, 5.0),
            (30.0, 0.0),
            (30.0, f64::NAN),
            (30.0, f64::MAX),
            (3600.0, 0.1),
        ] {
            assert!(Options::new(duration, interval, PathBuf::from("unused")).is_err());
        }
        assert!(Options::new(30.0, 5.0, PathBuf::from("unused")).is_ok());
    }
    #[test]
    fn captures_never_overwrite_existing_output() {
        let path = std::env::temp_dir().join(format!(
            "slither-headless-test-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        output_directory(&path).unwrap();
        let file = path.join("existing.png");
        fs::write(&file, b"preserve").unwrap();
        assert!(output_directory(&path).is_err());
        assert!(write_png(&file, &[]).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"preserve");
        fs::remove_file(file).unwrap();
        fs::remove_dir(path).unwrap();
    }
    #[test]
    fn death_disconnect_and_failure_are_terminal_without_waiting_for_duration() {
        for phase in [
            Phase::Dead,
            Phase::Victory,
            Phase::Failed,
            Phase::Disconnected,
        ] {
            assert!(terminal_reason(phase).is_some());
        }
        assert!(terminal_reason(Phase::Playing).is_none());
    }
}
