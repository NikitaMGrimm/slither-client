#![forbid(unsafe_code)]
#[cfg(target_arch = "wasm32")]
fn main() {}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use slither_wgpu_slice::{
        Result,
        frame::Frame,
        gpu::{SurfaceHost, instance},
        scene::{Driver, LAST_TICK, Scene},
    };
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    use winit::{
        application::ApplicationHandler,
        event::WindowEvent,
        event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
        window::{Window, WindowId},
    };
    struct Running {
        window: Arc<Window>,
        host: SurfaceHost,
        scene: Scene,
        driver: Driver,
        started: Instant,
        frame: Option<Frame>,
    }
    #[derive(Default)]
    struct App {
        running: Option<Running>,
        failure: Option<String>,
    }
    impl App {
        fn fail(&mut self, event_loop: &ActiveEventLoop, e: String) {
            eprintln!("slice stopped: {e}");
            self.failure = Some(e);
            event_loop.exit();
        }
        fn open(event_loop: &ActiveEventLoop) -> Result<Running> {
            let window = Arc::new(
                event_loop
                    .create_window(
                        Window::default_attributes()
                            .with_title("SlitherClient — synthetic wgpu slice")
                            .with_inner_size(winit::dpi::LogicalSize::new(960., 540.)),
                    )
                    .map_err(|e| e.to_string())?,
            );
            let size = window.inner_size();
            let i = instance();
            let surface = i
                .create_surface(window.clone())
                .map_err(|e| e.to_string())?;
            let mut host =
                pollster::block_on(SurfaceHost::new(&i, surface, [size.width, size.height]))?;
            let scene = Scene::new()?;
            for r in &scene.resources {
                host.renderer.upload(r)?;
            }
            println!(
                "adapter: {:?}; synthetic only,600ticks",
                host.renderer.adapter_info
            );
            Ok(Running {
                window,
                host,
                scene,
                driver: Driver::default(),
                started: Instant::now(),
                frame: None,
            })
        }
    }
    impl ApplicationHandler for App {
        fn resumed(&mut self, event_loop: &ActiveEventLoop) {
            if self.running.is_none() {
                match Self::open(event_loop) {
                    Ok(r) => self.running = Some(r),
                    Err(e) => self.fail(event_loop, e),
                }
            }
        }
        fn suspended(&mut self, _: &ActiveEventLoop) {
            if let Some(r) = &mut self.running {
                r.driver.pause();
            }
        }
        fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
            let Some(r) = &mut self.running else { return };
            if id != r.window.id() {
                return;
            }
            let result = (|| -> Result<()> {
                match event {
                    WindowEvent::CloseRequested => event_loop.exit(),
                    WindowEvent::Resized(size) => {
                        r.host.resize([size.width, size.height])?;
                        r.frame = None;
                        if size.width == 0 || size.height == 0 {
                            r.driver.pause();
                        }
                    }
                    WindowEvent::RedrawRequested => {
                        let size = r.window.inner_size();
                        let extent = [size.width, size.height];
                        if extent.contains(&0) {
                            r.driver.pause();
                            return Ok(());
                        }
                        let due = r.driver.due(r.started.elapsed().as_secs_f64() * 1000.)?;
                        for _ in 0..due {
                            if r.scene.tick() < LAST_TICK {
                                r.frame =
                                    Some(r.scene.next_frame(extent, r.window.scale_factor())?);
                            }
                        }
                        if r.frame.as_ref().is_none_or(|f| {
                            f.extent != extent || f.viewport_scale != r.window.scale_factor()
                        }) {
                            r.frame = Some(r.scene.draw_frame(extent, r.window.scale_factor())?);
                        }
                        if let Some(frame) = &r.frame
                            && frame.extent == extent
                        {
                            r.host.present(frame)?;
                        }
                    }
                    _ => {}
                }
                Ok(())
            })();
            if let Err(e) = result {
                self.fail(event_loop, e);
            }
        }
        fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
            if let Some(r) = &self.running {
                r.window.request_redraw();
            }
            event_loop.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(16),
            ));
        }
    }
    pub fn run() -> Result<()> {
        let event_loop = EventLoop::new().map_err(|e| e.to_string())?;
        let mut app = App::default();
        event_loop.run_app(&mut app).map_err(|e| e.to_string())?;
        app.running.take();
        if let Some(e) = app.failure {
            Err(e)
        } else {
            Ok(())
        }
    }
}
#[cfg(not(target_arch = "wasm32"))]
fn main() {
    if let Err(e) = native::run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
