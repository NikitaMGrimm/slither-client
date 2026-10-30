#![forbid(unsafe_code)]
#[cfg(target_arch = "wasm32")]
fn main() {}
#[cfg(not(target_arch = "wasm32"))]
mod headless;
#[cfg(not(target_arch = "wasm32"))]
mod desktop {
    use slither_wgpu_slice::{
        Result,
        game::LocalGame,
        gpu::{SurfaceHost, instance},
        native::{Event, Transport},
        official::{self, Preparation},
    };
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    use winit::{
        application::ApplicationHandler,
        event::{ElementState, MouseButton, WindowEvent},
        event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
        keyboard::{KeyCode, PhysicalKey},
        window::{Window, WindowId},
    };
    #[derive(Default)]
    pub struct Options {
        endpoint: Option<String>,
        nickname: String,
        skin: u8,
        official: bool,
        server: Option<String>,
        headless: Option<crate::headless::Options>,
    }
    pub fn options() -> Result<Option<Options>> {
        parse_options(std::env::args().skip(1))
    }
    fn parse_options(mut args: impl Iterator<Item = String>) -> Result<Option<Options>> {
        let mut o = Options {
            nickname: "Player".into(),
            ..Default::default()
        };
        let mut headless = false;
        let mut duration = 30.0;
        let mut frame_every = 5.0;
        let mut frames = None;
        let mut headless_arguments = false;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--help" | "-h" => {
                    println!(
                        "Offline by default.\nslither-wgpu-desktop [--official [--server host:port] | --endpoint ws://host:port/slither] [--nickname NAME] [--skin 0..65]\n[--headless --duration SECONDS --frames NEW_EXTERNAL_DIRECTORY --frame-every SECONDS]\nHeadless: automatic Play, deterministic circles/boost, offscreen PNGs and exit summary. Defaults: duration 30s, frame interval 5s.\nWindow: Enter Play, Escape Stop/cancel. Pointer/arrows/Space: existing Rust input.\nNo automatic reconnect. --endpoint uses authored zero credentials for simulators. Diagnostic: slither-wgpu-diagnostic."
                    );
                    return Ok(None);
                }
                "--endpoint" => {
                    let e = args.next().ok_or("Endpoint value required")?;
                    slither_wgpu_slice::game::server_endpoint(&e)?;
                    o.endpoint = Some(e);
                }
                "--official" => o.official = true,
                "--headless" => headless = true,
                "--duration" | "--frame-every" => {
                    let value = args
                        .next()
                        .ok_or("Time value required")?
                        .parse::<f64>()
                        .map_err(|_| "Invalid time value")?;
                    if arg == "--duration" {
                        duration = value;
                    } else {
                        frame_every = value;
                    }
                    headless_arguments = true;
                }
                "--frames" => {
                    frames = Some(args.next().ok_or("Frame directory required")?.into());
                    headless_arguments = true;
                }
                "--server" => {
                    let server = args.next().ok_or("Server value required")?;
                    official::explicit_endpoint(&server)?;
                    o.server = Some(server);
                }
                "--nickname" => o.nickname = args.next().ok_or("Nickname required")?,
                "--skin" => {
                    o.skin = args
                        .next()
                        .ok_or("Skin required")?
                        .parse()
                        .map_err(|_| "Invalid skin")?
                }
                _ => return Err(format!("Unknown option {arg}")),
            }
        }
        if o.official && o.endpoint.is_some() {
            return Err("Use --official or --endpoint".into());
        }
        if o.server.is_some() && !o.official {
            return Err("--server requires --official".into());
        }
        if headless {
            if !o.official && o.endpoint.is_none() {
                return Err("Headless requires --official or --endpoint".into());
            }
            o.headless = Some(crate::headless::Options::new(
                duration,
                frame_every,
                frames.ok_or("Headless requires --frames NEW_EXTERNAL_DIRECTORY")?,
            )?);
        } else if headless_arguments {
            return Err("--duration, --frames and --frame-every require --headless".into());
        }
        let mut menu = slither_client::menu_preferences::MenuPreferences::new(true);
        menu.select(o.skin, &[])?;
        slither_client::protocol::encode_login(0, &[0; 20], &o.nickname, o.skin, None)
            .map_err(|e| e.to_string())?;
        Ok(Some(o))
    }
    struct Running {
        window: Arc<Window>,
        host: SurfaceHost,
        game: LocalGame,
        transport: Transport,
        started: Instant,
        cursor: [f64; 2],
        preparation: Option<Preparation>,
        nickname: String,
        skin: u8,
    }
    impl Running {
        fn effects(&mut self) -> Result<()> {
            for _ in 0..64 {
                let Some(e) = self.game.effect() else {
                    return Ok(());
                };
                if matches!(&e.kind, slither_wgpu_slice::game::EffectKind::Connect(_)) {
                    self.game.construct(
                        e.generation,
                        e.id,
                        self.started.elapsed().as_secs_f64() * 1000.,
                    )?;
                }
                match self.transport.execute(&e) {
                    Ok(()) => self.game.acknowledge(e.generation, e.id, true)?,
                    Err(error) => self.game.fail(&error),
                }
            }
            Err("Effect drain budget".into())
        }
        fn pictures(&mut self) -> Result<()> {
            for _ in 0..16 {
                self.game
                    .observe_time(self.started.elapsed().as_secs_f64() * 1000.)?;
                let Some(p) = self.game.take_frame() else {
                    return Ok(());
                };
                if let Err(e) = self.host.renderer.sync_resources(&p.resources) {
                    self.game.presented(false)?;
                    return Err(e);
                }
                match self.host.present(&p.frame) {
                    Ok(true) => self.game.presented(true)?,
                    Ok(false) => {
                        self.game.retry_frame(p)?;
                        return Ok(());
                    }
                    Err(e) => {
                        self.game.presented(false)?;
                        return Err(e);
                    }
                }
                self.effects()?;
            }
            if self.game.has_frame() {
                Err("Frame drain budget".into())
            } else {
                Ok(())
            }
        }
        fn frame(&mut self) -> Result<()> {
            if let Some(preparation) = &mut self.preparation
                && let Some(result) = preparation.poll()
            {
                let cancelled = preparation.cancelled();
                self.preparation.take();
                if !cancelled {
                    match result {
                        Ok(prepared) => {
                            println!("Selected {}; starting explicit Play", prepared.endpoint);
                            self.game.play_with_profile(
                                &prepared.endpoint,
                                &self.nickname,
                                self.skin,
                                &prepared.profile,
                            )?;
                        }
                        Err(e) => {
                            eprintln!("Official discovery failed: {e}");
                            self.game.fail(&e);
                        }
                    }
                }
            }
            let size = self.window.inner_size();
            let extent = [size.width, size.height];
            let scale = self.window.scale_factor();
            self.host.resize(extent)?;
            self.game.viewport(extent, scale)?;
            for event in self.transport.poll() {
                match event {
                    Event::Opened(g) => {
                        if let Err(e) = self
                            .game
                            .opened(g, self.started.elapsed().as_secs_f64() * 1000.)
                        {
                            self.game.fail(&e)
                        }
                    }
                    Event::Binary(g, b) => {
                        if let Err(e) =
                            self.game
                                .receive(g, &b, self.started.elapsed().as_secs_f64() * 1000.)
                        {
                            self.game.fail(&e)
                        }
                    }
                    Event::Closed(g) => self.game.closed(g),
                    Event::Failed(g, e) => {
                        if g == self.game.generation() {
                            self.game.fail(&e);
                        }
                    }
                }
                self.effects()?;
                self.pictures()?;
            }
            self.effects()?;
            self.pictures()?;
            self.game
                .begin_frame(self.started.elapsed().as_secs_f64() * 1000., extent, scale)?;
            self.effects()?;
            self.pictures()?;
            self.window.set_title(&format!(
                "SlitherClient | {}{} | MSAA{}",
                if self.preparation.is_some() {
                    "Acquiring official profile/server | "
                } else {
                    ""
                },
                self.game.hud_text().replace('\n', " | "),
                self.host.renderer.sample_count
            ));
            Ok(())
        }
        fn pointer(&mut self, down: bool) -> Result<()> {
            let s = self.window.inner_size();
            let d = self.window.scale_factor();
            if s.width == 0 || s.height == 0 {
                return Ok(());
            }
            self.game.pointer(
                self.cursor[0],
                self.cursor[1],
                f64::from(s.width) / d,
                f64::from(s.height) / d,
                down,
            )
        }
    }
    pub struct App {
        options: Options,
        running: Option<Running>,
        failure: Option<String>,
    }
    impl App {
        fn fail(&mut self, l: &ActiveEventLoop, e: String) {
            eprintln!("GPU host stopped: {e}");
            self.failure = Some(e);
            if let Some(r) = &mut self.running {
                r.game.stop();
                r.transport.close();
            }
            l.exit();
        }
        fn open(l: &ActiveEventLoop) -> Result<Running> {
            let window = Arc::new(
                l.create_window(
                    Window::default_attributes()
                        .with_title("SlitherClient — Enter Play / Escape Stop")
                        .with_inner_size(winit::dpi::LogicalSize::new(960., 540.)),
                )
                .map_err(|e| e.to_string())?,
            );
            let s = window.inner_size();
            let i = instance();
            let surface = i
                .create_surface(window.clone())
                .map_err(|e| e.to_string())?;
            let host = pollster::block_on(SurfaceHost::new(&i, surface, [s.width, s.height]))?;
            println!(
                "Actual adapter {:?}; MSAA{}; no transport until explicit Play",
                host.renderer.adapter_info, host.renderer.sample_count
            );
            Ok(Running {
                window,
                host,
                game: LocalGame::new(0.)?,
                transport: Transport::default(),
                started: Instant::now(),
                cursor: [480., 270.],
                preparation: None,
                nickname: String::new(),
                skin: 0,
            })
        }
    }
    impl ApplicationHandler for App {
        fn resumed(&mut self, l: &ActiveEventLoop) {
            if self.running.is_none() {
                match Self::open(l) {
                    Ok(r) => self.running = Some(r),
                    Err(e) => self.fail(l, e),
                }
            }
        }
        fn window_event(&mut self, l: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
            let Some(r) = &mut self.running else { return };
            if r.window.id() != id {
                return;
            }
            let result = (|| -> Result<()> {
                match event {
                    WindowEvent::CloseRequested => {
                        if let Some(p) = &r.preparation {
                            p.cancel();
                        }
                        r.game.stop();
                        r.transport.close();
                        l.exit();
                    }
                    WindowEvent::RedrawRequested => r.frame()?,
                    WindowEvent::Resized(s) => {
                        r.host.resize([s.width, s.height])?;
                        r.game
                            .viewport([s.width, s.height], r.window.scale_factor())?;
                    }
                    WindowEvent::CursorMoved { position, .. } => {
                        let d = r.window.scale_factor();
                        r.cursor = [position.x / d, position.y / d];
                        r.pointer(false)?;
                    }
                    WindowEvent::MouseInput {
                        state,
                        button: MouseButton::Left,
                        ..
                    } => {
                        if state == ElementState::Pressed {
                            r.pointer(true)?;
                        } else {
                            r.game.mouse_up();
                        }
                    }
                    WindowEvent::Focused(false) => r.game.blur(),
                    WindowEvent::KeyboardInput { event, .. } => {
                        let down = event.state == ElementState::Pressed;
                        match event.physical_key {
                            PhysicalKey::Code(KeyCode::Enter) if down && !event.repeat => {
                                if r.game.can_play() && r.preparation.is_none() {
                                    if self.options.official {
                                        r.nickname.clone_from(&self.options.nickname);
                                        r.skin = self.options.skin;
                                        println!(
                                            "Acquiring official profile and server; Escape cancels"
                                        );
                                        r.preparation =
                                            Some(Preparation::start(self.options.server.clone())?);
                                    } else if let Some(endpoint) = &self.options.endpoint {
                                        r.game.play(
                                            endpoint,
                                            &self.options.nickname,
                                            self.options.skin,
                                        )?;
                                    } else {
                                        eprintln!("Use --official or --endpoint before Play");
                                    }
                                }
                            }
                            PhysicalKey::Code(KeyCode::Escape) if down => {
                                if let Some(p) = &r.preparation {
                                    p.cancel();
                                }
                                r.game.stop();
                                r.effects()?;
                            }
                            PhysicalKey::Code(code) => {
                                let name = match code {
                                    KeyCode::ArrowLeft => "ArrowLeft",
                                    KeyCode::ArrowRight => "ArrowRight",
                                    KeyCode::ArrowUp => "ArrowUp",
                                    KeyCode::Space => "Space",
                                    _ => "",
                                };
                                r.game.key(name, down);
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
                Ok(())
            })();
            if let Err(e) = result {
                self.fail(l, e);
            }
        }
        fn about_to_wait(&mut self, l: &ActiveEventLoop) {
            if let Some(r) = &self.running {
                r.window.request_redraw();
            }
            l.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(16),
            ));
        }
    }
    pub fn run(mut options: Options) -> Result<()> {
        if let Some(headless) = options.headless.take() {
            return crate::headless::run(
                headless,
                options.endpoint.as_deref(),
                options.official,
                options.server.as_deref(),
                &options.nickname,
                options.skin,
            );
        }
        let event_loop = EventLoop::new().map_err(|e| e.to_string())?;
        let mut app = App {
            options,
            running: None,
            failure: None,
        };
        event_loop.run_app(&mut app).map_err(|e| e.to_string())?;
        app.running.take();
        app.failure.map_or(Ok(()), Err)
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        fn parse(args: &[&str]) -> Result<Option<Options>> {
            parse_options(args.iter().map(|s| s.to_string()))
        }
        #[test]
        fn cli_modes_are_explicit_and_validate_before_window_or_network() {
            let official = parse(&[
                "--official",
                "--server",
                "game.example:445",
                "--nickname",
                "Player",
                "--skin",
                "65",
            ])
            .unwrap()
            .unwrap();
            assert!(official.official);
            assert_eq!(official.server.as_deref(), Some("game.example:445"));
            assert_eq!(official.skin, 65);
            assert!(parse(&["--endpoint", "ws://localhost:19491/slither"]).is_ok());
            assert!(parse(&["--help"]).unwrap().is_none());
            for args in [
                vec!["--official", "--endpoint", "ws://127.0.0.1:19491/slither"],
                vec!["--server", "x:445"],
                vec!["--official", "--skin", "66"],
                vec!["--official", "--server"],
                vec![
                    "--official",
                    "--nickname",
                    "this nickname is too long to encode",
                ],
            ] {
                assert!(parse(&args).is_err());
            }
        }
        #[test]
        fn headless_admits_both_modes_and_requires_bounded_explicit_output() {
            for mode in [
                vec!["--official"],
                vec!["--endpoint", "ws://127.0.0.1:19491/slither"],
            ] {
                let args = [
                    mode,
                    vec![
                        "--headless",
                        "--duration",
                        "10",
                        "--frames",
                        "external-frames",
                        "--frame-every",
                        "2",
                    ],
                ]
                .concat();
                assert!(parse(&args).unwrap().unwrap().headless.is_some());
            }
            for args in [
                vec!["--headless"],
                vec!["--official", "--headless"],
                vec!["--official", "--frames", "unused"],
                vec![
                    "--official",
                    "--headless",
                    "--frames",
                    "unused",
                    "--duration",
                    "NaN",
                ],
                vec![
                    "--official",
                    "--headless",
                    "--frames",
                    "unused",
                    "--frame-every",
                    "inf",
                ],
            ] {
                assert!(parse(&args).is_err());
            }
        }
    }
}
#[cfg(not(target_arch = "wasm32"))]
fn main() {
    let result = desktop::options().and_then(|o| o.map_or(Ok(()), desktop::run));
    if let Err(e) = result {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
