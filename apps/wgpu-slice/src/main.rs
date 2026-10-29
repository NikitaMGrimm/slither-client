#![forbid(unsafe_code)]
#[cfg(target_arch = "wasm32")]
fn main() {}
#[cfg(not(target_arch = "wasm32"))]
mod desktop {
    use slither_wgpu_slice::{
        Result,
        game::LocalGame,
        gpu::{SurfaceHost, instance},
        native::{Event, Transport},
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
    }
    pub fn options() -> Result<Option<Options>> {
        let mut o = Options {
            nickname: "Player".into(),
            ..Default::default()
        };
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--help" | "-h" => {
                    println!(
                        "Offline by default. Native window requires manual launch.\nslither-wgpu-desktop [--endpoint ws://127.0.0.1:<port>/slither] [--nickname NAME] [--skin 0..65]\nEnter: explicit Play. Escape: Stop. Pointer/arrows/Space: existing Rust input.\nNo automatic connection/reconnect; no official profiles. Diagnostic: slither-wgpu-diagnostic."
                    );
                    return Ok(None);
                }
                "--endpoint" => {
                    let e = args.next().ok_or("Endpoint value required")?;
                    slither_wgpu_slice::game::loopback_endpoint(&e)?;
                    o.endpoint = Some(e);
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
    }
    impl Running {
        fn effects(&mut self) -> Result<()> {
            for _ in 0..64 {
                let Some(e) = self.game.effect() else {
                    return Ok(());
                };
                match self.transport.execute(&e) {
                    Ok(()) => self.game.acknowledge(e.generation, e.id, true)?,
                    Err(error) => self.game.fail(&error),
                }
            }
            Err("Effect drain budget".into())
        }
        fn pictures(&mut self) -> Result<()> {
            for _ in 0..16 {
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
            Err("Frame drain budget".into())
        }
        fn frame(&mut self) -> Result<()> {
            let size = self.window.inner_size();
            let extent = [size.width, size.height];
            let scale = self.window.scale_factor();
            self.host.resize(extent)?;
            self.game.viewport(extent, scale)?;
            let now = self.started.elapsed().as_secs_f64() * 1000.;
            for event in self.transport.poll() {
                match event {
                    Event::Opened(g) => {
                        if let Err(e) = self.game.opened(g) {
                            self.game.fail(&e)
                        }
                    }
                    Event::Binary(g, b) => {
                        if let Err(e) = self.game.receive(g, &b, now) {
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
            self.game.begin_frame(now, extent, scale)?;
            self.effects()?;
            self.pictures()?;
            self.window.set_title(&format!(
                "SlitherClient local | {} | MSAA{}",
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
            eprintln!("Local GPU host stopped: {e}");
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
                        .with_title("SlitherClient local — Enter Play / Escape Stop")
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
                                if r.game.can_play() {
                                    if let Some(endpoint) = &self.options.endpoint {
                                        r.game.play(
                                            endpoint,
                                            &self.options.nickname,
                                            self.options.skin,
                                        )?;
                                    } else {
                                        eprintln!(
                                            "Explicit --endpoint is required; no socket opened"
                                        );
                                    }
                                }
                            }
                            PhysicalKey::Code(KeyCode::Escape) if down => {
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
    pub fn run(options: Options) -> Result<()> {
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
}
#[cfg(not(target_arch = "wasm32"))]
fn main() {
    let result = desktop::options().and_then(|o| o.map_or(Ok(()), desktop::run));
    if let Err(e) = result {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
